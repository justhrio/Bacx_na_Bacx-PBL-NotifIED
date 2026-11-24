# CampusSync Multimodal AI Backend (`gemini-3.8-flash`)

Express + TypeScript service wrapping Google's `@google/genai` SDK (`gemini-3.8-flash` with automatic Flash fallback) with strict JSON Structured Outputs (`responseSchema`) for CampusSync's automated event clearance workflow.

## Setup

1. Copy `.env.example` to `.env` and set your **server-side** credentials:
   ```bash
   cp .env.example .env
   ```
   - `GEMINI_API_KEY` *(required)* — Never place this in any frontend `.env` file.
   - `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY` *(recommended)* — Server-side Supabase Storage document retrieval, institutional recipient lookup, and audit logging.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` *(for Institutional Email Syndication via Nodemailer BCC batching)* — Or configure `RESEND_API_KEY` + `RESEND_FROM` as an optional fallback.
   - `PUBLIC_SURVEY_BASE_URL` *(optional, defaults to `https://adminview-eight.vercel.app`)* — Base URL for standalone public post-event survey links embedded in emails.

2. Install dependencies and start the server:
   ```bash
   npm install
   npm run dev
   ```
   The API listens on `http://localhost:4000` by default.

3. Run SQL migrations in the Supabase SQL Editor:
   - `supabase-ai-migration.sql` — Optional AI JSONB columns on `public.events` and `proposal-documents` Storage bucket.
   - `supabase_email_syndication.sql` — Creates `institutional_recipients` (with `student | faculty | staff` ENUM and sample seed rows), `event_surveys`, `survey_responses`, and `email_dispatches`.

## Endpoints

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service status, active model, and Gemini / Supabase / Email transport readiness |
| `POST` | `/api/ai/prescreen` | Automated multimodal PDF/PNG/JPEG executive summary, signature & consistency audit (accepts `multipart/form-data`, Supabase Storage `{ bucket, path }`, or Supabase Storage URLs) |
| `POST` | `/api/ai/triage` | Single or batch (`{ proposals: [...] }`) dynamic `P1`/`P2`/`P3` priority queue triage |
| `POST` | `/api/ai/surveys/generate` | AI-assisted post-event student evaluation questionnaire generator |
| `POST` | `/api/ai/surveys/publish` | Finalizes a post-event survey and generates a unique standalone public survey link (`/survey/:token`) |
| `GET` | `/api/ai/surveys/public/:token` | Unauthenticated public survey lookup for students & faculty (no login required) |
| `POST` | `/api/ai/surveys/public/:token/responses` | Unauthenticated public survey response submission feeding sentiment analytics |
| `POST` | `/api/ai/surveys/analyze` | Post-event survey sentiment score & executive diagnostics synthesis |
| `POST` | `/api/ai/syndicate-email` | Multimodal AI institutional HTML email synthesizer + BCC-batched dispatch for approved events |
| `GET` / `POST` | `/api/email/recipients` | List and add institutional mailing list recipients (`student` / `faculty` / `staff`) |
| `PATCH` / `DELETE` | `/api/email/recipients/:id` | Toggle active status, edit, or delete an institutional mailing list recipient |
| `GET` | `/api/email/dispatches` | Fetch institutional email syndication dispatch audit logs |

## Frontend Configuration

Each frontend app (`Facilitator view/`, `Admin view/`, `Department haed view/`) connects via `src/lib/aiClient.ts` using `VITE_AI_API_URL`.
