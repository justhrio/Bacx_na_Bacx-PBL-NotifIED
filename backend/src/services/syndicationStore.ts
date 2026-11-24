import crypto from "crypto";
import { getSupabaseClient } from "../config/supabase.js";
import type { GeneratedSurveyResult } from "../schemas/aiSchemas.js";

export type RecipientRole = "student" | "faculty" | "staff";
export type DispatchStatus = "PENDING_SURVEY" | "SENDING" | "SENT" | "FAILED";

export interface InstitutionalRecipientRecord {
  id: string;
  full_name: string;
  email: string;
  role: RecipientRole;
  department: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface EmailDispatchRecord {
  id: string;
  proposal_id: number;
  survey_id: string | null;
  survey_url: string | null;
  status: DispatchStatus;
  target_groups: RecipientRole[];
  recipient_count: number;
  email_subject: string | null;
  email_html_preview: string | null;
  email_text_fallback: string | null;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublishedEventSurveyRecord {
  id: string;
  survey_token: string;
  event_id: number;
  survey_title: string;
  description: string;
  questions: GeneratedSurveyResult["questions"];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  event_meta?: {
    title: string;
    organization?: string;
    event_date?: string;
    venue?: string;
  };
}

export interface PublicSurveyResponseRecord {
  id: string;
  survey_id: string | null;
  event_id: number;
  respondent_role: string;
  overall_rating: number | null;
  comment: string | null;
  answers: Record<string, string | number>;
  submitted_at: string;
}

// ============================================================================
// Graceful In-Memory Fallback Stores (used only when Supabase credentials or
// migration tables have not yet been applied in the target environment)
// ============================================================================

const memoryRecipients = new Map<string, InstitutionalRecipientRecord>([
  [
    "seed-student-1",
    {
      id: "seed-student-1",
      full_name: "Maria Santos (Demo Student)",
      email: "maria.santos.demo@apc.edu.ph",
      role: "student",
      department: "School of Computing and Information Technologies",
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ],
  [
    "seed-student-2",
    {
      id: "seed-student-2",
      full_name: "Juan Dela Cruz (Demo Student)",
      email: "juan.delacruz.demo@apc.edu.ph",
      role: "student",
      department: "School of Engineering",
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ],
  [
    "seed-faculty-1",
    {
      id: "seed-faculty-1",
      full_name: "Prof. Elena Reyes (Demo Faculty)",
      email: "elena.reyes.demo@apc.edu.ph",
      role: "faculty",
      department: "School of Computing and Information Technologies",
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ],
]);

const memoryDispatches = new Map<string, EmailDispatchRecord>();
const memorySurveysByToken = new Map<string, PublishedEventSurveyRecord>();
const memoryResponsesByEvent = new Map<number, PublicSurveyResponseRecord[]>();

function normalizeRoles(roles?: unknown): RecipientRole[] {
  const valid: RecipientRole[] = ["student", "faculty", "staff"];
  if (!Array.isArray(roles) || roles.length === 0) {
    return ["student", "faculty"];
  }
  const filtered = roles
    .map((r) => String(r).toLowerCase().trim())
    .filter((r): r is RecipientRole => valid.includes(r as RecipientRole));
  return filtered.length > 0 ? Array.from(new Set(filtered)) : ["student", "faculty"];
}

export function generateSurveyToken(eventId: number): string {
  const randomSuffix = crypto.randomBytes(6).toString("hex");
  return `srv_${eventId}_${randomSuffix}`;
}

// ============================================================================
// 1. Institutional Recipients Directory
// ============================================================================

export async function listInstitutionalRecipients(options?: {
  roles?: RecipientRole[];
  activeOnly?: boolean;
}): Promise<{ recipients: InstitutionalRecipientRecord[]; storage: "supabase" | "memory" }> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      let query = supabase
        .from("institutional_recipients")
        .select("*")
        .order("created_at", { ascending: false });

      if (options?.activeOnly) {
        query = query.eq("is_active", true);
      }
      if (options?.roles && options.roles.length > 0) {
        query = query.in("role", options.roles);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        return {
          recipients: data as InstitutionalRecipientRecord[],
          storage: "supabase",
        };
      }
      if (error) {
        console.warn("[SyndicationStore] institutional_recipients query fallback:", error.message);
      }
    } catch (err) {
      console.warn("[SyndicationStore] institutional_recipients query exception:", err);
    }
  }

  let items = Array.from(memoryRecipients.values());
  if (options?.activeOnly) {
    items = items.filter((r) => r.is_active);
  }
  if (options?.roles && options.roles.length > 0) {
    const allowed = new Set(options.roles);
    items = items.filter((r) => allowed.has(r.role));
  }
  return { recipients: items, storage: "memory" };
}

export async function addInstitutionalRecipient(input: {
  full_name: string;
  email: string;
  role: RecipientRole;
  department?: string;
  is_active?: boolean;
}): Promise<{ recipient: InstitutionalRecipientRecord; storage: "supabase" | "memory" }> {
  const cleanedEmail = input.email.trim().toLowerCase();
  const payload = {
    full_name: input.full_name.trim(),
    email: cleanedEmail,
    role: input.role,
    department: (input.department || "General").trim() || "General",
    is_active: input.is_active ?? true,
    updated_at: new Date().toISOString(),
  };

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("institutional_recipients")
        .upsert(payload, { onConflict: "email" })
        .select("*")
        .single();

      if (!error && data) {
        return { recipient: data as InstitutionalRecipientRecord, storage: "supabase" };
      }
      if (error) {
        console.warn("[SyndicationStore] institutional_recipients insert fallback:", error.message);
      }
    } catch (err) {
      console.warn("[SyndicationStore] institutional_recipients insert exception:", err);
    }
  }

  const existing = Array.from(memoryRecipients.values()).find((r) => r.email === cleanedEmail);
  const id = existing?.id || crypto.randomUUID();
  const record: InstitutionalRecipientRecord = {
    id,
    ...payload,
    created_at: existing?.created_at || new Date().toISOString(),
  };
  memoryRecipients.set(id, record);
  return { recipient: record, storage: "memory" };
}

export async function updateInstitutionalRecipient(
  id: string,
  patch: Partial<Pick<InstitutionalRecipientRecord, "full_name" | "email" | "role" | "department" | "is_active">>
): Promise<{ recipient: InstitutionalRecipientRecord | null; storage: "supabase" | "memory" }> {
  const cleanedPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.full_name !== undefined) cleanedPatch.full_name = patch.full_name.trim();
  if (patch.email !== undefined) cleanedPatch.email = patch.email.trim().toLowerCase();
  if (patch.role !== undefined) cleanedPatch.role = patch.role;
  if (patch.department !== undefined) cleanedPatch.department = patch.department.trim() || "General";
  if (patch.is_active !== undefined) cleanedPatch.is_active = Boolean(patch.is_active);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("institutional_recipients")
        .update(cleanedPatch)
        .eq("id", id)
        .select("*")
        .single();

      if (!error && data) {
        return { recipient: data as InstitutionalRecipientRecord, storage: "supabase" };
      }
    } catch (err) {
      console.warn("[SyndicationStore] institutional_recipients update exception:", err);
    }
  }

  const existing = memoryRecipients.get(id);
  if (!existing) return { recipient: null, storage: "memory" };
  const updated: InstitutionalRecipientRecord = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  memoryRecipients.set(id, updated);
  return { recipient: updated, storage: "memory" };
}

export async function deleteInstitutionalRecipient(
  id: string
): Promise<{ deleted: boolean; storage: "supabase" | "memory" }> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase
        .from("institutional_recipients")
        .delete()
        .eq("id", id);
      if (!error) {
        return { deleted: true, storage: "supabase" };
      }
    } catch (err) {
      console.warn("[SyndicationStore] institutional_recipients delete exception:", err);
    }
  }

  const existed = memoryRecipients.delete(id);
  return { deleted: existed, storage: "memory" };
}

// ============================================================================
// 2. Email Dispatch Audit Log
// ============================================================================

export async function createEmailDispatchRecord(input: {
  proposalId: number;
  surveyId?: string | null;
  surveyUrl?: string | null;
  status: DispatchStatus;
  targetGroups?: RecipientRole[];
  recipientCount?: number;
}): Promise<EmailDispatchRecord> {
  const now = new Date().toISOString();
  const targetGroups = normalizeRoles(input.targetGroups);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("email_dispatches")
        .insert([
          {
            proposal_id: input.proposalId,
            survey_id: input.surveyId ?? null,
            survey_url: input.surveyUrl ?? null,
            status: input.status,
            target_groups: targetGroups,
            recipient_count: input.recipientCount ?? 0,
            updated_at: now,
          },
        ])
        .select("*")
        .single();

      if (!error && data) {
        const record = data as EmailDispatchRecord;
        memoryDispatches.set(record.id, record);
        return record;
      }
      if (error) {
        console.warn("[SyndicationStore] email_dispatches insert fallback:", error.message);
      }
    } catch (err) {
      console.warn("[SyndicationStore] email_dispatches insert exception:", err);
    }
  }

  const record: EmailDispatchRecord = {
    id: crypto.randomUUID(),
    proposal_id: input.proposalId,
    survey_id: input.surveyId ?? null,
    survey_url: input.surveyUrl ?? null,
    status: input.status,
    target_groups: targetGroups,
    recipient_count: input.recipientCount ?? 0,
    email_subject: null,
    email_html_preview: null,
    email_text_fallback: null,
    sent_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  };
  memoryDispatches.set(record.id, record);
  return record;
}

export async function updateEmailDispatchRecord(
  id: string,
  patch: Partial<
    Pick<
      EmailDispatchRecord,
      | "status"
      | "survey_id"
      | "survey_url"
      | "recipient_count"
      | "email_subject"
      | "email_html_preview"
      | "email_text_fallback"
      | "sent_at"
      | "error_message"
    >
  >
): Promise<EmailDispatchRecord | null> {
  const now = new Date().toISOString();
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("email_dispatches")
        .update({
          ...patch,
          updated_at: now,
        })
        .eq("id", id)
        .select("*")
        .single();

      if (!error && data) {
        const record = data as EmailDispatchRecord;
        memoryDispatches.set(record.id, record);
        return record;
      }
    } catch (err) {
      console.warn("[SyndicationStore] email_dispatches update exception:", err);
    }
  }

  const existing = memoryDispatches.get(id);
  if (!existing) return null;
  const updated: EmailDispatchRecord = {
    ...existing,
    ...patch,
    updated_at: now,
  };
  memoryDispatches.set(id, updated);
  return updated;
}

export async function listEmailDispatches(proposalId?: number): Promise<EmailDispatchRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      let query = supabase
        .from("email_dispatches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (proposalId !== undefined) {
        query = query.eq("proposal_id", proposalId);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        return data as EmailDispatchRecord[];
      }
    } catch (err) {
      console.warn("[SyndicationStore] email_dispatches list exception:", err);
    }
  }

  const all = Array.from(memoryDispatches.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return proposalId !== undefined ? all.filter((d) => d.proposal_id === proposalId) : all;
}

// ============================================================================
// 3. Published Public Event Surveys & Responses
// ============================================================================

export async function upsertPublishedSurvey(input: {
  eventId: number;
  surveyToken?: string;
  survey: GeneratedSurveyResult;
  eventMeta?: PublishedEventSurveyRecord["event_meta"];
}): Promise<PublishedEventSurveyRecord> {
  const now = new Date().toISOString();
  const token = (input.surveyToken || "").trim() || generateSurveyToken(input.eventId);

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("event_surveys")
        .upsert(
          {
            survey_token: token,
            event_id: input.eventId,
            survey_title: input.survey.surveyTitle,
            description: input.survey.description,
            questions: input.survey.questions,
            is_active: true,
            updated_at: now,
          },
          { onConflict: "survey_token" }
        )
        .select("*")
        .single();

      if (!error && data) {
        const record: PublishedEventSurveyRecord = {
          ...(data as PublishedEventSurveyRecord),
          event_meta: input.eventMeta,
        };
        memorySurveysByToken.set(record.survey_token, record);
        return record;
      }
      if (error) {
        console.warn("[SyndicationStore] event_surveys upsert fallback:", error.message);
      }
    } catch (err) {
      console.warn("[SyndicationStore] event_surveys upsert exception:", err);
    }
  }

  const existing = memorySurveysByToken.get(token);
  const record: PublishedEventSurveyRecord = {
    id: existing?.id || crypto.randomUUID(),
    survey_token: token,
    event_id: input.eventId,
    survey_title: input.survey.surveyTitle,
    description: input.survey.description,
    questions: input.survey.questions,
    is_active: true,
    created_at: existing?.created_at || now,
    updated_at: now,
    event_meta: input.eventMeta || existing?.event_meta,
  };
  memorySurveysByToken.set(token, record);
  return record;
}

export async function findPublishedSurveyByTokenOrId(
  tokenOrId: string
): Promise<PublishedEventSurveyRecord | null> {
  const key = tokenOrId.trim();
  if (!key) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      // Try matching by survey_token first, then UUID id
      const { data: byToken, error: tokenErr } = await supabase
        .from("event_surveys")
        .select("*")
        .eq("survey_token", key)
        .maybeSingle();

      let surveyRow = !tokenErr && byToken ? (byToken as PublishedEventSurveyRecord) : null;

      if (!surveyRow && /^[0-9a-f-]{36}$/i.test(key)) {
        const { data: byId, error: idErr } = await supabase
          .from("event_surveys")
          .select("*")
          .eq("id", key)
          .maybeSingle();
        if (!idErr && byId) {
          surveyRow = byId as PublishedEventSurveyRecord;
        }
      }

      if (surveyRow) {
        const { data: ev } = await supabase
          .from("events")
          .select("title, organization, event_date, venue")
          .eq("event_id", surveyRow.event_id)
          .maybeSingle();
        return {
          ...surveyRow,
          event_meta: ev
            ? {
                title: ev.title,
                organization: ev.organization,
                event_date: ev.event_date,
                venue: ev.venue,
              }
            : surveyRow.event_meta,
        };
      }
    } catch (err) {
      console.warn("[SyndicationStore] event_surveys lookup exception:", err);
    }
  }

  if (memorySurveysByToken.has(key)) {
    return memorySurveysByToken.get(key) || null;
  }
  for (const item of memorySurveysByToken.values()) {
    if (item.id === key) return item;
  }
  return null;
}

export async function savePublicSurveyResponse(input: {
  surveyId?: string | null;
  eventId: number;
  respondentRole?: string;
  overallRating?: number | null;
  comment?: string | null;
  answers: Record<string, string | number>;
}): Promise<PublicSurveyResponseRecord> {
  const now = new Date().toISOString();
  const payload = {
    survey_id: input.surveyId && /^[0-9a-f-]{36}$/i.test(input.surveyId) ? input.surveyId : null,
    event_id: input.eventId,
    respondent_role: (input.respondentRole || "student").trim().toLowerCase() || "student",
    overall_rating:
      typeof input.overallRating === "number" && Number.isFinite(input.overallRating)
        ? Math.max(1, Math.min(5, Math.round(input.overallRating)))
        : null,
    comment: input.comment ? input.comment.trim() : null,
    answers: input.answers || {},
    submitted_at: now,
  };

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("survey_responses")
        .insert([payload])
        .select("*")
        .single();

      if (!error && data) {
        return data as PublicSurveyResponseRecord;
      }
      if (error) {
        console.warn("[SyndicationStore] survey_responses insert fallback:", error.message);
      }
    } catch (err) {
      console.warn("[SyndicationStore] survey_responses insert exception:", err);
    }
  }

  const record: PublicSurveyResponseRecord = {
    id: crypto.randomUUID(),
    ...payload,
  };
  const existing = memoryResponsesByEvent.get(input.eventId) || [];
  memoryResponsesByEvent.set(input.eventId, [record, ...existing]);
  return record;
}

export async function listPublicSurveyResponses(
  eventId: number
): Promise<PublicSurveyResponseRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("survey_responses")
        .select("*")
        .eq("event_id", eventId)
        .order("submitted_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        return data as PublicSurveyResponseRecord[];
      }
    } catch (err) {
      console.warn("[SyndicationStore] survey_responses list exception:", err);
    }
  }

  return memoryResponsesByEvent.get(eventId) || [];
}
