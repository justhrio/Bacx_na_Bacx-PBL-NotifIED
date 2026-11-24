import dotenv from "dotenv";

dotenv.config();

const rawCorsOrigins =
  process.env.CORS_ORIGINS ||
  "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:3000";

function trimEnv(value?: string): string {
  return (value || "").trim();
}

function resolvePrimaryGeminiModel(): string {
  const configured = trimEnv(process.env.GEMINI_MODEL).replace(/^models\//, "");
  // Automatically upgrade any unset or retired pre-3.x Gemini model string to gemini-3.8-flash
  if (!configured || /^gemini-(1|2)\./i.test(configured)) {
    return "gemini-3.8-flash";
  }
  return configured;
}

function resolveSmtpConfig() {
  const service = trimEnv(process.env.SMTP_SERVICE).toLowerCase();
  const user = trimEnv(process.env.SMTP_USER);
  const pass = trimEnv(process.env.SMTP_PASS);
  const rawHost = trimEnv(process.env.SMTP_HOST);
  const rawPort = trimEnv(process.env.SMTP_PORT);
  const rawSecure = trimEnv(process.env.SMTP_SECURE).toLowerCase();
  const rawFrom = trimEnv(process.env.SMTP_FROM);

  const lowerUser = user.toLowerCase();
  const isGmailUser = lowerUser.endsWith("@gmail.com") || service === "gmail";
  const isOutlookUser =
    lowerUser.endsWith("@outlook.com") ||
    lowerUser.endsWith("@office365.com") ||
    lowerUser.endsWith("@hotmail.com") ||
    lowerUser.endsWith("@live.com") ||
    service === "outlook" ||
    service === "office365" ||
    service === "microsoft365";

  let host = rawHost;
  let defaultPort = 587;
  let defaultSecure = false;

  if (!host) {
    if (isGmailUser) {
      host = "smtp.gmail.com";
      defaultPort = 465;
      defaultSecure = true;
    } else if (isOutlookUser) {
      host = "smtp.office365.com";
      defaultPort = 587;
      defaultSecure = false;
    }
  } else if (host.toLowerCase().includes("gmail.com")) {
    defaultPort = 465;
    defaultSecure = true;
  } else if (host.toLowerCase().includes("office365.com") || host.toLowerCase().includes("outlook")) {
    defaultPort = 587;
    defaultSecure = false;
  }

  const parsedPort = rawPort ? Number(rawPort) : defaultPort;
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : defaultPort;
  const secure =
    rawSecure === "true" || rawSecure === "1"
      ? true
      : rawSecure === "false" || rawSecure === "0"
      ? false
      : rawPort
      ? port === 465
      : defaultSecure;

  const from = rawFrom || (user ? `CampusSync Notifications <${user}>` : "");

  return {
    service,
    host,
    port,
    secure,
    user,
    pass,
    from,
  };
}

const primaryGeminiModel = resolvePrimaryGeminiModel();
const smtpConfig = resolveSmtpConfig();

export const env = {
  port: Number(trimEnv(process.env.PORT) || 4000),
  corsOrigins: rawCorsOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  geminiApiKey: trimEnv(process.env.GEMINI_API_KEY),
  geminiModel: primaryGeminiModel,
  geminiFallbackModels: [
    primaryGeminiModel,
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
  ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx),
  supabaseUrl: trimEnv(process.env.SUPABASE_URL) || "https://zloybmlteeihnvpabuuy.supabase.co",
  supabaseServiceRoleKey: trimEnv(process.env.SUPABASE_SERVICE_ROLE_KEY),
  supabaseAnonKey: trimEnv(process.env.SUPABASE_ANON_KEY),
  supabaseStorageBucket: trimEnv(process.env.SUPABASE_STORAGE_BUCKET) || "proposal-documents",
  publicSurveyBaseUrl: (
    trimEnv(process.env.PUBLIC_SURVEY_BASE_URL) || "https://adminview-eight.vercel.app"
  ).replace(/\/$/, ""),
  requireLiveEmail: trimEnv(process.env.REQUIRE_LIVE_EMAIL).toLowerCase() === "true",
  smtp: smtpConfig,
  resend: {
    apiKey: trimEnv(process.env.RESEND_API_KEY),
    from:
      trimEnv(process.env.RESEND_FROM) ||
      smtpConfig.from ||
      "CampusSync Notifications <onboarding@resend.dev>",
  },
};
