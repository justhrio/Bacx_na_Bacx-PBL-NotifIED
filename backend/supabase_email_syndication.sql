-- ============================================================================
-- CampusSync Institutional Email Syndication & Public Post-Event Survey Schema
-- Run this idempotent migration once in Supabase SQL Editor.
-- ============================================================================

-- 1. Institutional Distribution Audience Role ENUM
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'institutional_recipient_role'
  ) THEN
    CREATE TYPE public.institutional_recipient_role AS ENUM ('student', 'faculty', 'staff', 'all_campus');
  ELSE
    BEGIN
      ALTER TYPE public.institutional_recipient_role ADD VALUE IF NOT EXISTS 'all_campus';
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END
$$;

-- 2. Institutional Distribution Lists (Outlook / Campus Group Email Aliases)
CREATE TABLE IF NOT EXISTS public.institutional_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text,
  email text NOT NULL UNIQUE,
  role public.institutional_recipient_role NOT NULL DEFAULT 'student',
  department text NOT NULL DEFAULT 'All Departments',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_institutional_recipients_role_active
  ON public.institutional_recipients (role, is_active);

-- Sample campus distribution list seed rows (Admin Coordinator can toggle or add test emails in the UI)
INSERT INTO public.institutional_recipients (email, role, department, is_active)
VALUES
  ('allstudents@apc.edu.ph', 'student', 'All Departments', true),
  ('allfaculty@apc.edu.ph', 'faculty', 'All Departments', true),
  ('socit-students@apc.edu.ph', 'student', 'SoCIT', true),
  ('allcampus@apc.edu.ph', 'all_campus', 'All Departments', false)
ON CONFLICT (email) DO NOTHING;

-- 3. Standalone Public Post-Event Evaluation Surveys (No Student Login Required)
CREATE TABLE IF NOT EXISTS public.event_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_token text NOT NULL UNIQUE,
  event_id bigint NOT NULL REFERENCES public.events(event_id) ON DELETE CASCADE,
  survey_title text NOT NULL,
  description text NOT NULL DEFAULT '',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_surveys_event_id
  ON public.event_surveys (event_id);

CREATE INDEX IF NOT EXISTS idx_event_surveys_token
  ON public.event_surveys (survey_token);

-- 4. Public Post-Event Survey Responses (Feeds Post-Event Sentiment Analytics)
CREATE TABLE IF NOT EXISTS public.survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid REFERENCES public.event_surveys(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.events(event_id) ON DELETE CASCADE,
  respondent_role text NOT NULL DEFAULT 'student',
  overall_rating integer CHECK (overall_rating IS NULL OR (overall_rating >= 1 AND overall_rating <= 5)),
  comment text,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_event_id
  ON public.survey_responses (event_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_survey_responses_survey_id
  ON public.survey_responses (survey_id);

-- 5. Institutional Email Syndication Dispatch Logs
CREATE TABLE IF NOT EXISTS public.email_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id bigint NOT NULL REFERENCES public.events(event_id) ON DELETE CASCADE,
  survey_id text,
  survey_url text,
  status text NOT NULL DEFAULT 'PENDING_SURVEY'
    CHECK (status IN ('PENDING_SURVEY', 'SENDING', 'SENT', 'FAILED')),
  delivery_provider text,
  preview_url text,
  target_groups text[] NOT NULL DEFAULT ARRAY['student', 'faculty']::text[],
  recipient_count integer NOT NULL DEFAULT 0,
  email_subject text,
  email_html_preview text,
  email_text_fallback text,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_dispatches_proposal_id
  ON public.email_dispatches (proposal_id, created_at DESC);

-- 6. Row-Level Security Policies (supports public survey access & Admin portal management)
ALTER TABLE public.institutional_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_dispatches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'institutional_recipients' AND policyname = 'campussync_recipients_all'
  ) THEN
    CREATE POLICY campussync_recipients_all
      ON public.institutional_recipients FOR ALL
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'event_surveys' AND policyname = 'campussync_event_surveys_all'
  ) THEN
    CREATE POLICY campussync_event_surveys_all
      ON public.event_surveys FOR ALL
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'survey_responses' AND policyname = 'campussync_survey_responses_all'
  ) THEN
    CREATE POLICY campussync_survey_responses_all
      ON public.survey_responses FOR ALL
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'email_dispatches' AND policyname = 'campussync_email_dispatches_all'
  ) THEN
    CREATE POLICY campussync_email_dispatches_all
      ON public.email_dispatches FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END
$$;

-- 7. Enable Realtime updates for live Admin status & incoming public survey responses
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.email_dispatches;
EXCEPTION WHEN others THEN
  NULL;
END
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.survey_responses;
EXCEPTION WHEN others THEN
  NULL;
END
$$;
