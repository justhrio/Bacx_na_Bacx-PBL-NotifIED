/// <reference types="vite/client" />

const ENV_API_URL = (
  import.meta.env.VITE_AI_API_URL ||
  import.meta.env.VITE_AI_BACKEND_URL ||
  ""
)
  .trim()
  .replace(/\/$/, "");

const DEFAULT_DEPLOYED_BACKEND_URL = "https://bacxnabacx-pbl-notified-backend.vercel.app";

export const DEFAULT_STORAGE_BUCKET = "proposal-documents";

function isLocalhostHost(): boolean {
  if (typeof window === "undefined") return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function isPlaceholderUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("your-backend-project.vercel.app") ||
    lower.includes("your-ai-backend.vercel.app") ||
    lower.includes("your-backend.vercel.app")
  );
}

export function getAiBackendUrl(): string {
  if (ENV_API_URL && !isPlaceholderUrl(ENV_API_URL)) return ENV_API_URL;
  return isLocalhostHost() ? "http://localhost:4000" : DEFAULT_DEPLOYED_BACKEND_URL;
}

export function isAiBackendConfigured(): boolean {
  return Boolean(getAiBackendUrl());
}

function requireAiBackendUrl(): string {
  const baseUrl = getAiBackendUrl();
  if (!baseUrl) {
    throw new Error("The AI auditing service is not configured for this environment.");
  }
  return baseUrl;
}

// ============================================================================
// Shared AI Types (matching backend/src/schemas/aiSchemas.ts)
// ============================================================================

export interface SignatureCheckResult {
  signaturesDetected: boolean;
  detectedSignatories: string[];
  missingSignatureLines: string[];
  visualNotes: string;
}

export interface ChecklistEvaluationItem {
  requirement: string;
  met: boolean;
  evidence: string;
}

export interface ExecutiveEventSummary {
  headline: string;
  overview: string;
  keyHighlights: string[];
}

export interface PreScreenResult {
  auditStatus?: "COMPLETE" | "DEFECTIVE";
  verdictMessage?: string;
  eventSummary?: ExecutiveEventSummary;
  overallStatus: "PASSED" | "NEEDS_REVISION" | "FLAGGED";
  completenessScore: number;
  missingFiles?: string[];
  missingFields?: string[];
  signatureCheck: SignatureCheckResult;
  checklistEvaluation: ChecklistEvaluationItem[];
  inconsistencies: string[];
  reviewerSummary: string;
  _meta?: {
    modelUsed?: string;
    inspectedFiles?: Array<{ filename: string; mimeType: string }>;
    persisted?: boolean;
  };
}

export function deriveAuditStatus(result: PreScreenResult): "COMPLETE" | "DEFECTIVE" {
  if (result.auditStatus === "COMPLETE" || result.auditStatus === "DEFECTIVE") {
    return result.auditStatus;
  }
  const hasDefects =
    !result.signatureCheck?.signaturesDetected ||
    (result.signatureCheck?.missingSignatureLines?.length || 0) > 0 ||
    (result.missingFiles?.length || 0) > 0 ||
    (result.missingFields?.length || 0) > 0 ||
    (result.inconsistencies?.length || 0) > 0 ||
    (result.checklistEvaluation || []).some((c) => !c.met) ||
    result.overallStatus !== "PASSED";
  return hasDefects ? "DEFECTIVE" : "COMPLETE";
}

export interface CategorizedDefect {
  category: "Missing File" | "Missing Signature" | "Missing Section" | "Inconsistency";
  detail: string;
}

export function extractDefectItems(result: PreScreenResult): CategorizedDefect[] {
  const defects: CategorizedDefect[] = [];
  for (const file of result.missingFiles || []) {
    defects.push({ category: "Missing File", detail: file });
  }
  if (!result.signatureCheck?.signaturesDetected && (result.signatureCheck?.missingSignatureLines?.length || 0) === 0) {
    defects.push({
      category: "Missing Signature",
      detail: "No handwritten/digital signatures or official stamps were detected on the attached document(s).",
    });
  }
  for (const line of result.signatureCheck?.missingSignatureLines || []) {
    defects.push({ category: "Missing Signature", detail: line });
  }
  for (const field of result.missingFields || []) {
    defects.push({ category: "Missing Section", detail: field });
  }
  for (const inc of result.inconsistencies || []) {
    defects.push({ category: "Inconsistency", detail: inc });
  }
  // Include unmet checklist gaps only if not already captured above
  if (defects.length === 0) {
    for (const row of result.checklistEvaluation || []) {
      if (!row.met) {
        defects.push({
          category: "Missing Section",
          detail: `${row.requirement}: ${row.evidence}`,
        });
      }
    }
  }
  return defects;
}

export function formatDefectsForRevisionNote(result: PreScreenResult): string {
  const defects = extractDefectItems(result);
  if (defects.length === 0) {
    return result.verdictMessage || result.reviewerSummary || "Please review and update your submission.";
  }
  const lines = defects.map((d) => `- [${d.category}] ${d.detail}`);
  return `Please address the following items before resubmitting:\n${lines.join("\n")}`;
}

export interface TriageResult {
  priorityTier: "P1" | "P2" | "P3";
  complexityScore: number;
  riskFlags: string[];
  rationale: string;
}

export interface BatchTriageItem extends TriageResult {
  eventId: number;
}

export type GeneratedQuestionType = "rating_1_to_5" | "multiple_choice" | "open_text";

export interface GeneratedSurveyQuestion {
  id: string;
  text: string;
  type: GeneratedQuestionType;
  required: boolean;
  options: string[];
}

export interface GeneratedSurveyResult {
  surveyTitle: string;
  description: string;
  questions: GeneratedSurveyQuestion[];
}

export interface SurveyResponseEntry {
  rating?: number;
  comment?: string;
  answers?: Record<string, string | number>;
}

export interface SurveyDiagnosticsResult {
  overallSentiment: "Positive" | "Mixed" | "Negative";
  sentimentScore: number;
  keyStrengths: string[];
  areasForImprovement: string[];
  actionableRecommendations: string[];
  executiveSummary: string;
}

export interface ProposalFormMetadata {
  title?: string;
  organization?: string;
  eventDate?: string;
  startTime?: string;
  endTime?: string;
  venue?: string;
  description?: string;
  budget?: string | number;
  expectedAttendees?: number;
  hasExternalGuests?: boolean;
}

export interface TriageProposalInput {
  eventId?: number;
  title: string;
  organization?: string;
  eventDate?: string;
  daysUntilEvent?: number;
  venue?: string;
  description?: string;
  expectedCrowdSize?: number;
  budget?: number | string;
  hasExternalGuests?: boolean;
  tags?: string[];
}

export interface SurveyGeneratorInput {
  eventId?: number;
  eventTitle: string;
  category?: string;
  organization?: string;
  venue?: string;
  objectives: string;
  questionCount?: number;
}

export interface SurveyDiagnosticsInput {
  eventId?: number;
  eventTitle: string;
  organization?: string;
  eventDate?: string;
  averageRating?: number;
  totalResponses?: number;
  responses: SurveyResponseEntry[];
}

export interface StoredEventDocumentMeta {
  index: number;
  filename: string;
  mimeType: string;
  size: number;
  downloadPath: string;
  downloadUrl: string;
}

export interface EventDocumentsPayload {
  eventId: number;
  documents: StoredEventDocumentMeta[];
  preScreenResult: PreScreenResult | null;
}

// ============================================================================
// HTTP Helpers
// ============================================================================

function sanitizeErrorMessage(raw?: string, status?: number): string {
  const defaultMsg =
    status !== undefined
      ? `Automated AI analysis failed (HTTP ${status}).`
      : "The AI service is temporarily unavailable. Please retry in a moment.";
  if (!raw) return defaultMsg;
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.includes("\"error\":{")) {
    if (trimmed.includes("503") || trimmed.includes("UNAVAILABLE") || trimmed.includes("high demand")) {
      return "The Gemini AI service is temporarily experiencing high demand. Please refresh in a moment.";
    }
    if (trimmed.includes("404") || trimmed.includes("NOT_FOUND") || trimmed.includes("no longer available")) {
      return "The deployed AI backend is still serving an older Gemini model build (404). Promote the latest backend deployment to Production in Vercel.";
    }
    return defaultMsg;
  }
  return trimmed;
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    console.error("[CampusSync AI] Network fetch error:", { url, err });
    throw new Error("Unable to reach the AI backend service. Check network connectivity or backend status.");
  }
}

async function handleApiResponse<T>(url: string, res: Response): Promise<T> {
  let payload: any = null;
  let rawText = "";
  try {
    rawText = await res.text();
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    // Non-JSON response
  }
  if (!res.ok) {
    console.error("[CampusSync AI] Endpoint error:", {
      url,
      status: res.status,
      error: payload?.error ?? rawText,
    });
    if (res.status === 413) {
      throw new Error(
        "The uploaded file exceeds the 4.5 MB serverless payload limit. Please upload a smaller PDF or scan."
      );
    }
    throw new Error(sanitizeErrorMessage(payload?.error || rawText, res.status));
  }
  return payload as T;
}

export async function uploadEventDocuments(
  eventId: number,
  files: File[],
  preScreenResult?: PreScreenResult | null
): Promise<EventDocumentsPayload | null> {
  const baseUrl = getAiBackendUrl();
  if (!baseUrl || (files.length === 0 && !preScreenResult)) return null;

  try {
    const formData = new FormData();
    files.forEach((f) => formData.append("documents", f));
    if (preScreenResult) {
      formData.append("preScreenResult", JSON.stringify(preScreenResult));
    }

    const res = await fetch(`${baseUrl}/api/ai/events/${eventId}/documents`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      eventId: data.eventId,
      documents: (data.documents || []).map((d: any) => ({
        ...d,
        downloadUrl: `${baseUrl}${d.downloadPath}`,
      })),
      preScreenResult: data.preScreenResult ?? null,
    };
  } catch (err) {
    console.error("[CampusSync AI] Document relay upload failed:", err);
    return null;
  }
}

export async function fetchEventDocuments(
  eventId: number
): Promise<EventDocumentsPayload | null> {
  const baseUrl = getAiBackendUrl();
  if (!baseUrl) return null;

  try {
    const res = await fetch(`${baseUrl}/api/ai/events/${eventId}/documents`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      eventId: data.eventId,
      documents: (data.documents || []).map((d: any) => ({
        ...d,
        downloadUrl: `${baseUrl}${d.downloadPath}`,
      })),
      preScreenResult: data.preScreenResult ?? null,
    };
  } catch (err) {
    console.error("[CampusSync AI] Fetch event documents failed:", err);
    return null;
  }
}

export async function runDocumentPreScreen(params: {
  files?: File[];
  storageDocuments?: Array<{ bucket?: string; path: string }>;
  documentUrls?: Array<{ url: string; filename?: string; mimeType?: string }>;
  metadata: ProposalFormMetadata;
  eventId?: number;
}): Promise<PreScreenResult> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/ai/prescreen`;
  const { files = [], storageDocuments = [], documentUrls = [], metadata, eventId } = params;

  if (files.length > 0) {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("documents", file);
    });
    formData.append("metadata", JSON.stringify(metadata));
    if (storageDocuments.length > 0) {
      formData.append("storageDocuments", JSON.stringify(storageDocuments));
    }
    if (documentUrls.length > 0) {
      formData.append("documentUrls", JSON.stringify(documentUrls));
    }
    if (eventId !== undefined) {
      formData.append("eventId", String(eventId));
    }

    const res = await safeFetch(endpoint, {
      method: "POST",
      body: formData,
    });
    return handleApiResponse<PreScreenResult>(endpoint, res);
  }

  const res = await safeFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documents: storageDocuments,
      documentUrls,
      metadata,
      eventId,
    }),
  });
  return handleApiResponse<PreScreenResult>(endpoint, res);
}

export async function runProposalTriage(
  proposal: TriageProposalInput
): Promise<TriageResult> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/ai/triage`;
  const res = await safeFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proposal),
  });
  return handleApiResponse<TriageResult>(endpoint, res);
}

export async function runBatchProposalTriage(
  proposals: Array<TriageProposalInput & { eventId: number }>
): Promise<BatchTriageItem[]> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/ai/triage`;
  const res = await safeFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proposals }),
  });
  const data = await handleApiResponse<{ results: BatchTriageItem[] }>(endpoint, res);
  return data.results || [];
}

export async function generateAiSurvey(
  input: SurveyGeneratorInput
): Promise<GeneratedSurveyResult> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/ai/surveys/generate`;
  const res = await safeFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleApiResponse<GeneratedSurveyResult>(endpoint, res);
}

export async function analyzeAiSurveyFeedback(
  input: SurveyDiagnosticsInput
): Promise<SurveyDiagnosticsResult> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/ai/surveys/analyze`;
  const res = await safeFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleApiResponse<SurveyDiagnosticsResult>(endpoint, res);
}

// ============================================================================
// 5. Institutional Email Syndication & Public Survey APIs
// ============================================================================

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

export interface EmailProviderStatus {
  provider: "smtp" | "resend" | "unconfigured";
  configured: boolean;
  fromAddress: string | null;
  detail: string;
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

export interface PublishedSurveyResponse {
  surveyId: string;
  surveyToken: string;
  surveyUrl: string;
  survey: {
    id: string;
    survey_token: string;
    event_id: number;
    survey_title: string;
    description: string;
    questions: GeneratedSurveyQuestion[];
    is_active: boolean;
    created_at: string;
    updated_at: string;
    event_meta?: {
      title: string;
      organization?: string;
      event_date?: string;
      venue?: string;
    };
  };
}

export interface SyndicateEmailParams {
  proposalId: number;
  surveyId?: string | null;
  surveyToken?: string | null;
  surveyUrl: string;
  targetRoles?: RecipientRole[];
  eventSnapshot?: Record<string, unknown>;
  fallbackRecipients?: InstitutionalRecipientRecord[];
  posterUrls?: Array<{ url: string; filename?: string; mimeType?: string }>;
  posterFiles?: File[];
}

export interface SyndicateEmailResponse {
  dispatch: EmailDispatchRecord;
  provider?: "smtp" | "resend";
  batchCount?: number;
  modelUsed?: string;
  emailProvider?: EmailProviderStatus;
  error?: string;
}

export async function publishAiSurvey(params: {
  eventId: number;
  surveyToken?: string;
  survey: GeneratedSurveyResult;
  publicBaseUrl?: string;
  eventMeta?: {
    title: string;
    organization?: string;
    event_date?: string;
    venue?: string;
  };
}): Promise<PublishedSurveyResponse> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/ai/surveys/publish`;
  const res = await safeFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return handleApiResponse<PublishedSurveyResponse>(endpoint, res);
}

export async function fetchPublicSurveyFromBackend(
  token: string
): Promise<PublishedSurveyResponse["survey"] | null> {
  const baseUrl = getAiBackendUrl();
  if (!baseUrl) return null;
  try {
    const res = await fetch(
      `${baseUrl}/api/ai/surveys/public/${encodeURIComponent(token)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.survey ?? null;
  } catch {
    return null;
  }
}

export async function submitPublicSurveyResponseToBackend(
  token: string,
  payload: {
    eventId?: number;
    surveyId?: string | null;
    respondentRole: string;
    overallRating: number | null;
    comment: string | null;
    answers: Record<string, string | number>;
  }
): Promise<boolean> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/ai/surveys/public/${encodeURIComponent(token)}/responses`;
  const res = await safeFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handleApiResponse(endpoint, res);
  return true;
}

export async function fetchBackendSurveyResponses(
  eventId: number
): Promise<SurveyResponseEntry[]> {
  const baseUrl = getAiBackendUrl();
  if (!baseUrl) return [];
  try {
    const res = await fetch(`${baseUrl}/api/ai/surveys/event/${eventId}/responses`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.responses)) return [];
    return data.responses.map((r: any) => ({
      rating: typeof r.overall_rating === "number" ? r.overall_rating : undefined,
      comment: r.comment || "",
      answers: r.answers || undefined,
    }));
  } catch {
    return [];
  }
}

export async function syndicateEventEmail(
  params: SyndicateEmailParams
): Promise<SyndicateEmailResponse> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/ai/syndicate-email`;

  // Filter poster attachments strictly under 2.5 MB to stay safely within serverless limits
  const eligibleFiles = (params.posterFiles || [])
    .filter((f) => f.size > 0 && f.size <= 2.5 * 1024 * 1024)
    .slice(0, 2);

  let res: Response;
  if (eligibleFiles.length > 0) {
    const formData = new FormData();
    eligibleFiles.forEach((file) => formData.append("poster", file));
    formData.append("proposalId", String(params.proposalId));
    if (params.surveyId) formData.append("surveyId", params.surveyId);
    if (params.surveyToken) formData.append("surveyToken", params.surveyToken);
    formData.append("surveyUrl", params.surveyUrl);
    if (params.targetRoles) {
      formData.append("targetRoles", JSON.stringify(params.targetRoles));
    }
    if (params.eventSnapshot) {
      formData.append("eventSnapshot", JSON.stringify(params.eventSnapshot));
    }
    if (params.fallbackRecipients) {
      formData.append("fallbackRecipients", JSON.stringify(params.fallbackRecipients));
    }
    if (params.posterUrls && params.posterUrls.length > 0) {
      formData.append("posterUrls", JSON.stringify(params.posterUrls));
    }
    res = await safeFetch(endpoint, {
      method: "POST",
      body: formData,
    });
  } else {
    res = await safeFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId: params.proposalId,
        surveyId: params.surveyId,
        surveyToken: params.surveyToken,
        surveyUrl: params.surveyUrl,
        targetRoles: params.targetRoles,
        eventSnapshot: params.eventSnapshot,
        fallbackRecipients: params.fallbackRecipients,
        posterUrls: params.posterUrls,
      }),
    });
  }

  let payload: any = null;
  let rawText = "";
  try {
    rawText = await res.text();
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    // Non-JSON response
  }

  // On 502 delivery failure, backend still returns the saved FAILED dispatch record + AI HTML preview
  if (payload?.dispatch) {
    return payload as SyndicateEmailResponse;
  }

  if (!res.ok) {
    console.error("[CampusSync AI] Email syndication error:", {
      url: endpoint,
      status: res.status,
      error: payload?.error ?? rawText,
    });
    throw new Error(sanitizeErrorMessage(payload?.error || rawText, res.status));
  }

  return payload as SyndicateEmailResponse;
}

export async function fetchBackendEmailRecipients(): Promise<{
  recipients: InstitutionalRecipientRecord[];
  storage: "supabase" | "memory";
  emailProvider: EmailProviderStatus;
} | null> {
  const baseUrl = getAiBackendUrl();
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/email/recipients`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function createBackendEmailRecipient(input: {
  full_name: string;
  email: string;
  role: RecipientRole;
  department: string;
  is_active?: boolean;
}): Promise<InstitutionalRecipientRecord> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/email/recipients`;
  const res = await safeFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await handleApiResponse<{ recipient: InstitutionalRecipientRecord }>(endpoint, res);
  return data.recipient;
}

export async function updateBackendEmailRecipient(
  id: string,
  patch: Partial<Pick<InstitutionalRecipientRecord, "full_name" | "email" | "role" | "department" | "is_active">>
): Promise<InstitutionalRecipientRecord> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/email/recipients/${encodeURIComponent(id)}`;
  const res = await safeFetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await handleApiResponse<{ recipient: InstitutionalRecipientRecord }>(endpoint, res);
  return data.recipient;
}

export async function deleteBackendEmailRecipient(id: string): Promise<void> {
  const baseUrl = requireAiBackendUrl();
  const endpoint = `${baseUrl}/api/email/recipients/${encodeURIComponent(id)}`;
  const res = await safeFetch(endpoint, { method: "DELETE" });
  await handleApiResponse(endpoint, res);
}

export async function fetchBackendEmailDispatches(): Promise<{
  dispatches: EmailDispatchRecord[];
  emailProvider: EmailProviderStatus;
} | null> {
  const baseUrl = getAiBackendUrl();
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/email/dispatches`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ============================================================================
// Graceful Local Cache Fallback (when optional Supabase JSONB columns don't exist)
// ============================================================================

function readCacheMap<T>(storageKey: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeCacheEntry<T>(storageKey: string, id: string | number, value: T): void {
  try {
    const existing = readCacheMap<T>(storageKey);
    existing[String(id)] = value;
    localStorage.setItem(storageKey, JSON.stringify(existing));
  } catch {
    // Ignore storage quota errors
  }
}

const CACHE_KEYS = {
  prescreen: "campussync_ai_prescreen_cache",
  triage: "campussync_ai_triage_cache",
  surveyDraft: "campussync_ai_survey_draft_cache",
  feedbackAnalysis: "campussync_ai_feedback_analysis_cache",
  emailDispatch: "campussync_email_dispatch_cache",
  publishedSurvey: "campussync_published_survey_cache",
};

export interface CachedPublishedSurveyMeta {
  surveyId: string;
  surveyToken: string;
  surveyUrl: string;
}

export const aiLocalCache = {
  getPreScreens: () => readCacheMap<PreScreenResult>(CACHE_KEYS.prescreen),
  savePreScreen: (eventId: number | string, result: PreScreenResult) =>
    writeCacheEntry(CACHE_KEYS.prescreen, eventId, result),

  getTriages: () => readCacheMap<TriageResult>(CACHE_KEYS.triage),
  saveTriage: (eventId: number | string, result: TriageResult) =>
    writeCacheEntry(CACHE_KEYS.triage, eventId, result),

  getSurveyDrafts: () => readCacheMap<GeneratedSurveyResult>(CACHE_KEYS.surveyDraft),
  saveSurveyDraft: (eventId: number | string, result: GeneratedSurveyResult) =>
    writeCacheEntry(CACHE_KEYS.surveyDraft, eventId, result),

  getFeedbackAnalyses: () =>
    readCacheMap<SurveyDiagnosticsResult>(CACHE_KEYS.feedbackAnalysis),
  saveFeedbackAnalysis: (eventId: number | string, result: SurveyDiagnosticsResult) =>
    writeCacheEntry(CACHE_KEYS.feedbackAnalysis, eventId, result),

  getEmailDispatches: () => readCacheMap<EmailDispatchRecord>(CACHE_KEYS.emailDispatch),
  saveEmailDispatch: (eventId: number | string, dispatch: EmailDispatchRecord) =>
    writeCacheEntry(CACHE_KEYS.emailDispatch, eventId, dispatch),

  getPublishedSurveys: () =>
    readCacheMap<CachedPublishedSurveyMeta>(CACHE_KEYS.publishedSurvey),
  savePublishedSurvey: (eventId: number | string, meta: CachedPublishedSurveyMeta) =>
    writeCacheEntry(CACHE_KEYS.publishedSurvey, eventId, meta),
};

