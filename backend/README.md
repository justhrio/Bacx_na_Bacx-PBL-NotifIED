# CampusSync Multimodal AI Backend (`gemini-3.8-flash`)

Express + TypeScript service wrapping Google's `@google/genai` SDK (`gemini-3.8-flash` with automatic Flash fallback) with strict JSON Structured Outputs (`responseSchema`) for CampusSync's automated event clearance workflow.

## Setup

1. Copy `.env.example` to `.env` and set your **server-side** credentials:
   ```bash
   cp .env.example .env
   ```
   - `GEMINI_API_KEY` *(required)* — Never place this in any frontend `.env` file.
   - `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY` *(recommended)* — Server-side Supabase Storage document retrieval, institutional recipient lookup, and audit logging.
   - `SMTP_USER`, `SMTP_PASS` *(plus optional `SMTP_SERVICE=outlook`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`)* — Smart defaults auto-configure Gmail (`smtp.gmail.com:465`) and Outlook/Microsoft 365 (`smtp.office365.com:587`), or set `RESEND_API_KEY`. When omitted, Nodemailer's **Ethereal Sandbox Relay** activates automatically with a clickable preview URL (unless `REQUIRE_LIVE_EMAIL=true`).
   - `PUBLIC_SURVEY_BASE_URL` *(optional, defaults to `https://adminview-eight.vercel.app`)* — Base URL for standalone public post-event survey links embedded in emails.

2. Install dependencies and start the server:
   ```bash
   npm install
   npm run dev
   ```
   The API listens on `http://localhost:4000` by default.

3. Run SQL migrations in the Supabase SQL Editor:
   - `supabase-ai-migration.sql` — Optional AI JSONB columns on `public.events` and `proposal-documents` Storage bucket.
   - `supabase_email_syndication.sql` — Initial schema for `institutional_recipients`, `event_surveys`, `survey_responses`, and `email_dispatches`.
   - `supabase_mailing_list_update.sql` — Idempotent upgrade making `full_name` nullable for campus distribution lists, adding `all_campus` role, seeding group aliases (`allstudents@apc.edu.ph`, `allfaculty@apc.edu.ph`), and adding `delivery_provider` / `preview_url` to `email_dispatches`.

## Endpoints

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service status, active model, and Gemini / Supabase / Email transport readiness |
| `GET` | `/api/email/status` | Lightweight transport readiness (`{ configured, provider: "resend" \| "smtp" \| "sandbox" }`, zero secrets) |
| `POST` | `/api/ai/prescreen` | Automated multimodal PDF/PNG/JPEG executive summary, signature & consistency audit (accepts `multipart/form-data`, Supabase Storage `{ bucket, path }`, or Supabase Storage URLs) |
| `POST` | `/api/ai/triage` | Single or batch (`{ proposals: [...] }`) dynamic `P1`/`P2`/`P3` priority queue triage |
| `POST` | `/api/ai/surveys/generate` | AI-assisted post-event student evaluation questionnaire generator |
| `POST` | `/api/ai/surveys/publish` | Finalizes a post-event survey and generates a unique standalone public survey link (`/survey/:token`) |
| `GET` | `/api/ai/surveys/public/:token` | Unauthenticated public survey lookup for students & faculty (no login required) |
| `POST` | `/api/ai/surveys/public/:token/responses` | Unauthenticated public survey response submission feeding sentiment analytics |
| `POST` | `/api/ai/surveys/analyze` | Post-event survey sentiment score & executive diagnostics synthesis |
| `POST` | `/api/ai/syndicate-email` | Multimodal AI institutional HTML email synthesizer + BCC-batched dispatch (Live SMTP/Resend or Ethereal Sandbox fallback) |
| `GET` / `POST` | `/api/email/recipients` | List and add institutional distribution list emails (`student` / `faculty` / `staff` / `all_campus`, no `full_name` required) |
| `PATCH` / `DELETE` | `/api/email/recipients/:id` | Toggle active status, edit, or delete a distribution list entry |
| `GET` | `/api/email/dispatches` | Fetch institutional email syndication dispatch audit logs |

## Frontend Configuration

Each frontend app (`Facilitator view/`, `Admin view/`, `Department haed view/`) connects via `src/lib/aiClient.ts` using `VITE_AI_API_URL`.
