import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

export type EmailProviderType = "smtp" | "resend" | "unconfigured";

export interface EmailProviderStatus {
  provider: EmailProviderType;
  configured: boolean;
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
  provider: Exclude<EmailProviderType, "unconfigured">;
  recipientCount: number;
  batchCount: number;
  messageIds: string[];
}

const MAX_BCC_BATCH_SIZE = 50;

let cachedTransporter: Transporter | null = null;

function isSmtpConfigured(): boolean {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

function isResendConfigured(): boolean {
  return Boolean(env.resend.apiKey);
}

export function getEmailProviderStatus(): EmailProviderStatus {
  if (isSmtpConfigured()) {
    return {
      provider: "smtp",
      configured: true,
      fromAddress: env.smtp.from || env.smtp.user,
      detail: `Nodemailer SMTP configured (${env.smtp.host}:${env.smtp.port})`,
    };
  }
  if (isResendConfigured()) {
    return {
      provider: "resend",
      configured: true,
      fromAddress: env.resend.from,
      detail: "Resend REST API configured",
    };
  }
  return {
    provider: "unconfigured",
    configured: false,
    fromAddress: null,
    detail:
      "Email transport not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM (or RESEND_API_KEY) in backend/.env or Vercel Environment Variables.",
  };
}

function getSmtpTransporter(): Transporter {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: {
        user: env.smtp.user,
        pass: env.smtp.pass,
      },
    });
  }
  return cachedTransporter;
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
  const fromAddress = env.smtp.from || env.smtp.user;

  // Use BCC batching so recipient institutional email addresses stay strictly private (RA 10173).
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

/**
 * Dispatches an institutional HTML + plain-text event announcement using privacy-preserving BCC batching.
 * Uses Nodemailer SMTP primarily, with optional Resend REST API fallback.
 */
export async function sendInstitutionalAnnouncementEmail(
  params: SendInstitutionalEmailParams
): Promise<SendInstitutionalEmailResult> {
  const recipients = normalizeAndDedupeRecipients(params.recipients);
  if (recipients.length === 0) {
    throw new Error(
      "No active institutional recipients matched the selected target groups. Add active student or faculty emails in Institutional Mailing List first."
    );
  }

  const providerStatus = getEmailProviderStatus();
  if (!providerStatus.configured || providerStatus.provider === "unconfigured") {
    throw new Error(providerStatus.detail);
  }

  const batches = chunkArray(recipients, MAX_BCC_BATCH_SIZE);
  const messageIds: string[] = [];

  if (providerStatus.provider === "smtp") {
    try {
      for (const batch of batches) {
        const id = await sendBatchViaSmtp(batch, params.subject, params.html, params.text);
        messageIds.push(id);
      }
      return {
        provider: "smtp",
        recipientCount: recipients.length,
        batchCount: batches.length,
        messageIds,
      };
    } catch (smtpError) {
      // Optional automatic failover to Resend if both SMTP and RESEND_API_KEY are configured
      if (isResendConfigured()) {
        console.warn(
          "[EmailService] SMTP dispatch failed; falling back to Resend API:",
          smtpError instanceof Error ? smtpError.message : smtpError
        );
        const fallbackIds: string[] = [];
        for (const batch of batches) {
          const id = await sendBatchViaResend(batch, params.subject, params.html, params.text);
          fallbackIds.push(id);
        }
        return {
          provider: "resend",
          recipientCount: recipients.length,
          batchCount: batches.length,
          messageIds: fallbackIds,
        };
      }
      throw smtpError;
    }
  }

  for (const batch of batches) {
    const id = await sendBatchViaResend(batch, params.subject, params.html, params.text);
    messageIds.push(id);
  }
  return {
    provider: "resend",
    recipientCount: recipients.length,
    batchCount: batches.length,
    messageIds,
  };
}
