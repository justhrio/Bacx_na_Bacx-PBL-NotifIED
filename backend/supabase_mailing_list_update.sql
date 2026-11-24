-- ============================================================================
-- CampusSync Migration: Refactor Institutional Mailing List to Group /
-- Distribution Emails & Add Sandbox Preview Metadata to Email Dispatches
-- Run this idempotent script in Supabase SQL Editor.
-- ============================================================================

-- 1. Support 'all_campus' audience alongside 'student', 'faculty', 'staff'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'institutional_recipient_role') THEN
    BEGIN
      ALTER TYPE public.institutional_recipient_role ADD VALUE IF NOT EXISTS 'all_campus';
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END
$$;

-- 2. Make full_name nullable (institutional distribution lists use group aliases, not individual names)
--    and update default department to 'All Departments'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'institutional_recipients'
      AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.institutional_recipients
      ALTER COLUMN full_name DROP NOT NULL;
  END IF;
END
$$;

ALTER TABLE public.institutional_recipients
  ALTER COLUMN department SET DEFAULT 'All Departments';

-- 3. Remove legacy individual demo seed rows (if present) and seed campus distribution lists
DELETE FROM public.institutional_recipients
WHERE email IN (
  'maria.santos.demo@apc.edu.ph',
  'juan.delacruz.demo@apc.edu.ph',
  'elena.reyes.demo@apc.edu.ph',
  'sao.staff.demo@apc.edu.ph'
);

INSERT INTO public.institutional_recipients (email, role, department, is_active)
VALUES
  ('allstudents@apc.edu.ph', 'student', 'All Departments', true),
  ('allfaculty@apc.edu.ph', 'faculty', 'All Departments', true),
  ('socit-students@apc.edu.ph', 'student', 'SoCIT', true),
  ('allcampus@apc.edu.ph', 'all_campus', 'All Departments', false)
ON CONFLICT (email) DO NOTHING;

-- 4. Track email transport provider ('smtp' | 'resend' | 'sandbox') & Ethereal preview URL
ALTER TABLE public.email_dispatches
  ADD COLUMN IF NOT EXISTS delivery_provider text,
  ADD COLUMN IF NOT EXISTS preview_url text;
