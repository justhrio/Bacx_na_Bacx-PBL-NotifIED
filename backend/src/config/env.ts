import dotenv from "dotenv";

dotenv.config();

const rawCorsOrigins =
  process.env.CORS_ORIGINS ||
  "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:3000";

function resolvePrimaryGeminiModel(): string {
  const configured = (process.env.GEMINI_MODEL || "").trim().replace(/^models\//, "");
  // Automatically upgrade any unset or retired pre-3.x Gemini model string to gemini-3.8-flash
  if (!configured || /^gemini-(1|2)\./i.test(configured)) {
    return "gemini-3.8-flash";
  }
  return configured;
}

const primaryGeminiModel = resolvePrimaryGeminiModel();

export const env = {
  port: Number(process.env.PORT || 4000),
  corsOrigins: rawCorsOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: primaryGeminiModel,
  geminiFallbackModels: [
    primaryGeminiModel,
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
  ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx),
  supabaseUrl: (process.env.SUPABASE_URL || "https://zloybmlteeihnvpabuuy.supabase.co").trim(),
  supabaseServiceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || "").trim(),
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || "proposal-documents",
  publicSurveyBaseUrl: (
    process.env.PUBLIC_SURVEY_BASE_URL || "https://adminview-eight.vercel.app"
  )
    .trim()
    .replace(/\/$/, ""),
  smtp: {
    host: (process.env.SMTP_HOST || "").trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure:
      process.env.SMTP_SECURE !== undefined
        ? process.env.SMTP_SECURE.toLowerCase() === "true"
        : Number(process.env.SMTP_PORT || 587) === 465,
    user: (process.env.SMTP_USER || "").trim(),
    pass: (process.env.SMTP_PASS || "").trim(),
    from: (process.env.SMTP_FROM || process.env.SMTP_USER || "").trim(),
  },
  resend: {
    apiKey: (process.env.RESEND_API_KEY || "").trim(),
    from: (
      process.env.RESEND_FROM ||
      process.env.SMTP_FROM ||
      "CampusSync Institutional Events <onboarding@resend.dev>"
    ).trim(),
  },
};
