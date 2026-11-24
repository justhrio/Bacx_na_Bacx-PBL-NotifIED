import nodemailer, { type TestAccount, type Transporter } from "nodemailer";
import { env } from "../config/env.js";

export type EmailProviderType = "smtp" | "resend" | "sandbox";

export interface EmailProviderStatus {
  configured: boolean;
  provider: EmailProviderType;
  mode: "live" | "sandbox";
  requireLiveEmail: boolean;
  fromAddress: string | null;
  detail: string;
}

export interface SendInstitutionalEmailParams {
  recipients: string[];
  subject: string;
  html: string;
  text: string;
}

export interface SendInstitutionalEmailResult {
  provider: EmailProviderType;
  isSandbox: boolean;
  previewUrl: string | null;
  recipientCount: number;
  batchCount: number;
  messageIds: string[];
}

const MAX_BCC_BATCH_SIZE = 50;

let cachedSmtpTransporter: Transporter | null = null;
let cachedEtherealAccount: TestAccount | null = null;
let cachedEtherealTransporter: Transporter | null = null;

function isSmtpConfigured(): boolean {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

function isResendConfigured(): boolean {
  return Boolean(env.resend.apiKey);
}

export function getEmailProviderStatus(): EmailProviderStatus {
  if (isSmtpConfigured()) {
    return {
      configured: true,
      provider: "smtp",
      mode: "live",
      requireLiveEmail: env.requireLiveEmail,
      fromAddress: env.smtp.from || `CampusSync Notifications <${env.smtp.user}>`,
      detail: `Live SMTP transport ready (${env.smtp.host}:${env.smtp.port})`,
    };
  }
  if (isResendConfigured()) {
    return {
      configured: true,
      provider: "resend",
      mode: "live",
      requireLiveEmail: env.requireLiveEmail,
      fromAddress: env.resend.from,
      detail: "Live Resend REST API transport ready",
    };
  }
  return {
    configured: false,
    provider: "sandbox",
    mode: "sandbox",
    requireLiveEmail: env.requireLiveEmail,
    fromAddress: null,
    detail: env.requireLiveEmail
      ? "Live email transport required (REQUIRE_LIVE_EMAIL=true), but SMTP_USER/SMTP_PASS or RESEND_API_KEY are not set."
      : "Sandbox Preview Mode (Nodemailer Ethereal relay). Add SMTP_USER & SMTP_PASS (Gmail/Outlook) or RESEND_API_KEY in Vercel to enable live inbox delivery.",
  };
}

function getSmtpTransporter(): Transporter {
  if (!cachedSmtpTransporter) {
    const isOffice365 =
      env.smtp.host.toLowerCase().includes("office365.com") ||
      env.smtp.host.toLowerCase().includes("outlook");
    cachedSmtpTransporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      ...(isOffice365 && !env.smtp.secure ? { requireTLS: true } : {}),
      auth: {
        user: env.smtp.user,
        pass: env.smtp.pass,
      },
    });
  }
  return cachedSmtpTransporter;
}

async function getEtherealTransporter(): Promise<{
  transporter: Transporter;
  fromAddress: string;
}> {
  if (!cachedEtherealAccount || !cachedEtherealTransporter) {
    cachedEtherealAccount = await nodemailer.createTestAccount();
    cachedEtherealTransporter = nodemailer.createTransport({
      host: cachedEtherealAccount.smtp.host,
      port: cachedEtherealAccount.smtp.port,
      secure: cachedEtherealAccount.smtp.secure,
      auth: {
        user: cachedEtherealAccount.user,
        pass: cachedEtherealAccount.pass,
      },
    });
  }
  return {
    transporter: cachedEtherealTransporter,
    fromAddress: `CampusSync Notifications <${cachedEtherealAccount.user}>`,
  };
}

function normalizeAndDedupeRecipients(recipients: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  for (const raw of recipients) {
    const email = raw.trim().toLowerCase();
    if (!email || !emailPattern.test(email) || seen.has(email)) continue;
    seen.add(email);
    cleaned.push(email);
  }
  return cleaned;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function sendBatchViaSmtp(
  batch: string[],
  subject: string,
  html: string,
  text: string
): Promise<string> {
  const transporter = getSmtpTransporter();
  const fromAddress = env.smtp.from || `CampusSync Notifications <${env.smtp.user}>`;

  // Use BCC batching so distribution aliases remain private under RA 10173 data privacy guidelines.
  const info = await transporter.sendMail({
    from: fromAddress,
    to: fromAddress,
    bcc: batch,
    subject,
    html,
    text,
  });

  return info.messageId || `smtp-${Date.now()}`;
}

async function sendBatchViaResend(
  batch: string[],
  subject: string,
  html: string,
  text: string
): Promise<string> {
  const fromAddress = env.resend.from;
  const senderEmailMatch = fromAddress.match(/<([^>]+)>/);
  const toSelf = senderEmailMatch ? senderEmailMatch[1] : fromAddress;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resend.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [toSelf],
      bcc: batch,
      subject,
      html,
      text,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { id?: string; message?: string; error?: { message?: string } }
    | null;

  if (!response.ok) {
    const errMsg =
      payload?.message ||
      payload?.error?.message ||
      `Resend API request failed with HTTP ${response.status}`;
    throw new Error(errMsg);
  }

  return payload?.id || `resend-${Date.now()}`;
}

async function sendBatchesViaEtherealSandbox(
  batches: string[][],
  subject: string,
  html: string,
  text: string
): Promise<{ messageIds: string[]; previewUrl: string | null }> {
  const messageIds: string[] = [];
  let previewUrl: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { transporter, fromAddress } = await getEtherealTransporter();
      for (const batch of batches) {
        const info = await transporter.sendMail({
          from: fromAddress,
          to: fromAddress,
          bcc: batch,
          subject,
          html,
          text,
        });
        messageIds.push(info.messageId || `ethereal-${Date.now()}`);
        if (!previewUrl) {
          const url = nodemailer.getTestMessageUrl(info);
          if (typeof url === "string" && url.startsWith("http")) {
            previewUrl = url;
          }
        }
      }
      return { messageIds, previewUrl };
    } catch (err) {
      // Reset cached Ethereal credentials once in case the ephemeral account expired
      cachedEtherealAccount = null;
      cachedEtherealTransporter = null;
      if (attempt === 1) {
        throw err;
      }
    }
  }

  return { messageIds, previewUrl };
}

/**
 * Dispatches an institutional HTML + plain-text event announcement using privacy-preserving BCC batching.
 * Priority: Live SMTP (Gmail/Outlook/Custom) -> Live Resend API -> Automatic Ethereal Sandbox Relay (unless REQUIRE_LIVE_EMAIL=true).
 */
export async function sendInstitutionalAnnouncementEmail(
  params: SendInstitutionalEmailParams
): Promise<SendInstitutionalEmailResult> {
  const recipients = normalizeAndDedupeRecipients(params.recipients);
  if (recipients.length === 0) {
    throw new Error(
      "No active institutional distribution lists matched the selected audience. Add or activate a campus group email in the Mailing List tab first."
    );
  }

  const batches = chunkArray(recipients, MAX_BCC_BATCH_SIZE);
  const messageIds: string[] = [];

  // 1. Live Nodemailer SMTP
  if (isSmtpConfigured()) {
    try {
      for (const batch of batches) {
        const id = await sendBatchViaSmtp(batch, params.subject, params.html, params.text);
        messageIds.push(id);
      }
      return {
        provider: "smtp",
        isSandbox: false,
        previewUrl: null,
        recipientCount: recipients.length,
        batchCount: batches.length,
        messageIds,
      };
    } catch (smtpError) {
      if (isResendConfigured()) {
        console.warn(
          "[EmailService] Live SMTP failed; failing over to Resend API:",
          smtpError instanceof Error ? smtpError.message : smtpError
        );
        const fallbackIds: string[] = [];
        for (const batch of batches) {
          const id = await sendBatchViaResend(batch, params.subject, params.html, params.text);
          fallbackIds.push(id);
        }
        return {
          provider: "resend",
          isSandbox: false,
          previewUrl: null,
          recipientCount: recipients.length,
          batchCount: batches.length,
          messageIds: fallbackIds,
        };
      }
      throw smtpError;
    }
  }

  // 2. Live Resend REST API
  if (isResendConfigured()) {
    for (const batch of batches) {
      const id = await sendBatchViaResend(batch, params.subject, params.html, params.text);
      messageIds.push(id);
    }
    return {
      provider: "resend",
      isSandbox: false,
      previewUrl: null,
      recipientCount: recipients.length,
      batchCount: batches.length,
      messageIds,
    };
  }

  // 3. No live credentials set: fail only if REQUIRE_LIVE_EMAIL=true, otherwise use Nodemailer Ethereal Sandbox Relay
  if (env.requireLiveEmail) {
    throw new Error(
      "Live email delivery is required (REQUIRE_LIVE_EMAIL=true), but neither SMTP_USER/SMTP_PASS nor RESEND_API_KEY is configured in backend/.env or Vercel Environment Variables."
    );
  }

  const sandboxResult = await sendBatchesViaEtherealSandbox(
    batches,
    params.subject,
    params.html,
    params.text
  );

  return {
    provider: "sandbox",
    isSandbox: true,
    previewUrl: sandboxResult.previewUrl,
    recipientCount: recipients.length,
    batchCount: batches.length,
    messageIds: sandboxResult.messageIds,
  };
}
