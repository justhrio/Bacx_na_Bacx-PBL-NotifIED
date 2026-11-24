import { Router, type Request, type Response } from "express";
import multer from "multer";
import { env } from "../config/env.js";
import { getSupabaseAdmin, getSupabaseClient, persistOptionalEventFields } from "../config/supabase.js";
import { type GeneratedSurveyResult, type PreScreenResult } from "../schemas/aiSchemas.js";
import {
  ALLOWED_MIME_TYPES,
  analyzeSurveyFeedback,
  type ApprovedEventEmailData,
  downloadFromDocumentUrl,
  downloadFromSupabaseStorage,
  formatApprovedEventEmailDigest,
  generatePostEventSurvey,
  preScreenDocuments,
  triageProposal,
  triageProposalBatch,
  type DocumentInput,
  type ProposalFormMetadata,
  type PublicDocumentUrlRef,
  type StorageDocumentRef,
} from "../services/aiService.js";
import {
  getEmailProviderStatus,
  sendInstitutionalAnnouncementEmail,
} from "../services/emailService.js";
import {
  createEmailDispatchRecord,
  findPublishedSurveyByTokenOrId,
  listEmailDispatches,
  listInstitutionalRecipients,
  listPublicSurveyResponses,
  type RecipientRole,
  savePublicSurveyResponse,
  updateEmailDispatchRecord,
  upsertPublishedSurvey,
} from "../services/syndicationStore.js";

const router = Router();

interface StoredEventAttachments {
  documents: DocumentInput[];
  preScreenResult?: PreScreenResult;
  updatedAt: string;
}

// Lightweight in-memory attachment relay for cross-portal PDF testing when Supabase Storage bucket isn't provisioned yet
const eventAttachmentStore = new Map<number, StoredEventAttachments>();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB per file
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    const normalized = file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype;
    if (ALLOWED_MIME_TYPES.has(normalized)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file format (${file.mimetype}). Please upload a PDF, PNG, or JPEG file.`
        )
      );
    }
  },
});

function parseMetadataField(raw: unknown): ProposalFormMetadata {
  if (!raw) return {};
  if (typeof raw === "object") return raw as ProposalFormMetadata;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ProposalFormMetadata;
    } catch {
      return {};
    }
  }
  return {};
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * POST /api/ai/events/:eventId/documents
 * Stores Facilitator-uploaded PDF/image attachments (and optional PreScreenResult) so Admin & Dept Head portals can view and inspect them.
 */
router.post(
  "/events/:eventId/documents",
  upload.any(),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const eventId = parseOptionalNumber(req.params.eventId);
      if (!eventId) {
        res.status(400).json({ error: "Valid numeric eventId is required." });
        return;
      }

      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      const docs: DocumentInput[] = uploadedFiles.map((file) => ({
        filename: file.originalname,
        mimeType: file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype,
        buffer: file.buffer,
      }));

      let preScreenResult: PreScreenResult | undefined;
      if (req.body?.preScreenResult) {
        try {
          preScreenResult =
            typeof req.body.preScreenResult === "string"
              ? (JSON.parse(req.body.preScreenResult) as PreScreenResult)
              : (req.body.preScreenResult as PreScreenResult);
        } catch {
          // Ignore malformed JSON
        }
      }

      const existing = eventAttachmentStore.get(eventId);
      const mergedDocs = docs.length > 0 ? docs : existing?.documents || [];
      const mergedPreScreen = preScreenResult ?? existing?.preScreenResult;

      eventAttachmentStore.set(eventId, {
        documents: mergedDocs,
        preScreenResult: mergedPreScreen,
        updatedAt: new Date().toISOString(),
      });

      // Optionally mirror to Supabase Storage if server credentials are configured
      const supabase = getSupabaseAdmin();
      const uploadedPaths: string[] = [];
      if (supabase && docs.length > 0) {
        for (const doc of docs) {
          const safeName = doc.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `events/${eventId}/${Date.now()}_${safeName}`;
          const { error } = await supabase.storage
            .from(env.supabaseStorageBucket)
            .upload(path, doc.buffer, { contentType: doc.mimeType, upsert: true });
          if (!error) uploadedPaths.push(path);
        }
        if (uploadedPaths.length > 0) {
          await persistOptionalEventFields(eventId, {
            document_bucket: env.supabaseStorageBucket,
            document_path: uploadedPaths[0],
            ...(uploadedPaths[1] ? { waiver_path: uploadedPaths[1] } : {}),
            ...(mergedPreScreen ? { ai_prescreen_result: mergedPreScreen } : {}),
          });
        }
      }

      res.json({
        eventId,
        documents: mergedDocs.map((d, index) => ({
          index,
          filename: d.filename,
          mimeType: d.mimeType,
          size: d.buffer.length,
          downloadPath: `/api/ai/events/${eventId}/documents/${index}`,
        })),
        preScreenResult: mergedPreScreen ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to store event documents";
      res.status(400).json({ error: message });
    }
  }
);

/**
 * GET /api/ai/events/:eventId/documents
 * Lists stored PDF/image attachments and any cached PreScreenResult for a proposal.
 */
router.get("/events/:eventId/documents", (req: Request, res: Response): void => {
  const eventId = parseOptionalNumber(req.params.eventId);
  if (!eventId) {
    res.status(400).json({ error: "Valid numeric eventId is required." });
    return;
  }

  const record = eventAttachmentStore.get(eventId);
  if (!record) {
    res.json({ eventId, documents: [], preScreenResult: null });
    return;
  }

  res.json({
    eventId,
    documents: record.documents.map((d, index) => ({
      index,
      filename: d.filename,
      mimeType: d.mimeType,
      size: d.buffer.length,
      downloadPath: `/api/ai/events/${eventId}/documents/${index}`,
    })),
    preScreenResult: record.preScreenResult ?? null,
    updatedAt: record.updatedAt,
  });
});

/**
 * GET /api/ai/events/:eventId/documents/:index
 * Streams a stored PDF/image inline so reviewers can view it in a new tab.
 */
router.get("/events/:eventId/documents/:index", (req: Request, res: Response): void => {
  const eventId = parseOptionalNumber(req.params.eventId);
  const index = parseOptionalNumber(req.params.index);
  if (!eventId || index === undefined) {
    res.status(400).json({ error: "Valid eventId and document index are required." });
    return;
  }

  const record = eventAttachmentStore.get(eventId);
  const doc = record?.documents[index];
  if (!doc) {
    res.status(404).json({ error: "Attached document not found." });
    return;
  }

  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${doc.filename.replace(/"/g, "")}"`
  );
  res.send(doc.buffer);
});

/**
 * POST /api/ai/prescreen
 * Supports:
 *  - multipart/form-data: `documents` (1..5 files) or `document`/`apfFile`/`waiverFile` + JSON `metadata` or individual form fields
 *  - application/json: `{ bucket, path }` or `{ documents: [{ bucket, path }] }` or `{ eventId }` (uses stored event docs) + `metadata`
 */
router.post(
  "/prescreen",
  upload.any(),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const documents: DocumentInput[] = [];

      // 1. Direct multipart uploads from browser
      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      for (const file of uploadedFiles) {
        documents.push({
          filename: file.originalname,
          mimeType: file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype,
          buffer: file.buffer,
        });
      }

      // 2. Supabase Storage references (bucket + path)
      const body = req.body || {};
      const storageRefs: StorageDocumentRef[] = [];

      if (body.path && typeof body.path === "string") {
        storageRefs.push({
          bucket: typeof body.bucket === "string" ? body.bucket : undefined,
          path: body.path,
        });
      }

      if (body.storageDocuments) {
        const parsedRefs =
          typeof body.storageDocuments === "string"
            ? JSON.parse(body.storageDocuments)
            : body.storageDocuments;
        if (Array.isArray(parsedRefs)) {
          for (const ref of parsedRefs) {
            if (ref?.path) storageRefs.push(ref);
          }
        }
      } else if (Array.isArray(body.documents)) {
        for (const ref of body.documents) {
          if (ref?.path) storageRefs.push(ref);
        }
      }

      for (const ref of storageRefs) {
        const downloaded = await downloadFromSupabaseStorage(ref);
        documents.push(downloaded);
      }

      // 2b. Direct Supabase Storage public URLs (if passed in body.documentUrls)
      const urlRefs: PublicDocumentUrlRef[] = [];
      if (body.documentUrls) {
        const parsedUrls =
          typeof body.documentUrls === "string"
            ? JSON.parse(body.documentUrls)
            : body.documentUrls;
        if (Array.isArray(parsedUrls)) {
          for (const item of parsedUrls) {
            if (typeof item === "string" && item.trim()) {
              urlRefs.push({ url: item.trim() });
            } else if (item?.url && typeof item.url === "string") {
              urlRefs.push({
                url: item.url.trim(),
                filename: item.filename,
                mimeType: item.mimeType,
              });
            }
          }
        }
      }
      for (const urlRef of urlRefs) {
        const downloaded = await downloadFromDocumentUrl(urlRef);
        documents.push(downloaded);
      }

      const eventId = parseOptionalNumber(body.eventId ?? body.event_id);

      // 3. Fallback to backend attachment store if eventId already has uploaded documents
      if (documents.length === 0 && eventId) {
        const stored = eventAttachmentStore.get(eventId);
        if (stored && stored.documents.length > 0) {
          documents.push(...stored.documents);
        }
      }

      if (documents.length === 0) {
        res.status(400).json({
          error:
            "No documents provided. Upload at least one PDF/PNG/JPEG file or specify a Supabase Storage bucket + path or URL.",
        });
        return;
      }

      const parsedMeta = parseMetadataField(body.metadata);
      const metadata: ProposalFormMetadata = {
        title: parsedMeta.title ?? body.title,
        organization: parsedMeta.organization ?? body.organization,
        eventDate: parsedMeta.eventDate ?? body.eventDate ?? body.event_date,
        startTime: parsedMeta.startTime ?? body.startTime ?? body.start_time,
        endTime: parsedMeta.endTime ?? body.endTime ?? body.end_time,
        venue: parsedMeta.venue ?? body.venue,
        description: parsedMeta.description ?? body.description,
        budget: parsedMeta.budget ?? body.budget ?? body.estimated_budget,
        expectedAttendees:
          parsedMeta.expectedAttendees ??
          parseOptionalNumber(body.expectedAttendees ?? body.proposed_attendees),
        hasExternalGuests:
          parsedMeta.hasExternalGuests ??
          (body.hasExternalGuests === "true" || body.hasExternalGuests === true),
      };

      const { modelUsed, ...result } = await preScreenDocuments(documents, metadata);

      if (eventId) {
        eventAttachmentStore.set(eventId, {
          documents,
          preScreenResult: result,
          updatedAt: new Date().toISOString(),
        });
      }

      const persisted = await persistOptionalEventFields(eventId, {
        ai_audit_status: result.auditStatus,
        ai_prescreen_result: result,
      });

      res.json({
        ...result,
        _meta: {
          modelUsed,
          inspectedFiles: documents.map((d) => ({
            filename: d.filename,
            mimeType: d.mimeType,
          })),
          persisted,
        },
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Automated AI audit failed.";
      const isUpstreamBusy =
        rawMessage.includes("503") ||
        rawMessage.includes("UNAVAILABLE") ||
        rawMessage.includes("high demand") ||
        rawMessage.includes("429");
      const friendlyMessage = isUpstreamBusy
        ? "The AI auditing service is experiencing high demand. Please retry in a moment."
        : rawMessage.startsWith("{")
        ? "The AI auditing service could not process this request. Please retry shortly."
        : rawMessage;
      const statusCode =
        rawMessage.includes("GEMINI_API_KEY") || rawMessage.includes("SUPABASE_") || isUpstreamBusy
          ? 503
          : 400;
      console.error("[/api/ai/prescreen]", err);
      res.status(statusCode).json({ error: friendlyMessage });
    }
  }
);

/**
 * POST /api/ai/triage
 * Accepts either:
 *  - Single proposal object `{ title, eventDate, daysUntilEvent, expectedCrowdSize, budget, hasExternalGuests, venue, description, eventId? }`
 *  - Batch payload `{ proposals: [{ eventId, title, ... }] }`
 */
router.post("/triage", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body || {};

    if (Array.isArray(body.proposals)) {
      if (body.proposals.length === 0) {
        res.status(400).json({ error: "proposals array must contain at least one proposal." });
        return;
      }

      const results = await triageProposalBatch(body.proposals);

      await Promise.all(
        results.map((item) =>
          persistOptionalEventFields(item.eventId, {
            urgency_tier: item.priorityTier,
            ai_triage_result: {
              priorityTier: item.priorityTier,
              complexityScore: item.complexityScore,
              riskFlags: item.riskFlags,
              rationale: item.rationale,
            },
          })
        )
      );

      res.json({ results });
      return;
    }

    if (!body.title || typeof body.title !== "string") {
      res.status(400).json({ error: "Proposal title is required for triage." });
      return;
    }

    const result = await triageProposal({
      eventId: parseOptionalNumber(body.eventId ?? body.event_id),
      title: body.title,
      organization: body.organization,
      eventDate: body.eventDate ?? body.event_date,
      daysUntilEvent: parseOptionalNumber(body.daysUntilEvent),
      venue: body.venue,
      description: body.description,
      expectedCrowdSize: parseOptionalNumber(
        body.expectedCrowdSize ?? body.expectedAttendees ?? body.proposed_attendees
      ),
      budget: body.budget ?? body.estimated_budget,
      hasExternalGuests: Boolean(body.hasExternalGuests ?? body.has_external_guests),
      tags: Array.isArray(body.tags) ? body.tags : undefined,
    });

    const eventId = parseOptionalNumber(body.eventId ?? body.event_id);
    await persistOptionalEventFields(eventId, {
      urgency_tier: result.priorityTier,
      ai_triage_result: result,
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Triage evaluation failed";
    const statusCode = message.includes("GEMINI_API_KEY") ? 503 : 400;
    console.error("[/api/ai/triage]", err);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * POST /api/ai/surveys/generate
 */
router.post("/surveys/generate", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    const eventTitle = (body.eventTitle || body.title || "").trim();
    const objectives = (body.objectives || body.description || "").trim();

    if (!eventTitle) {
      res.status(400).json({ error: "eventTitle is required to generate a survey." });
      return;
    }

    const result = await generatePostEventSurvey({
      eventTitle,
      category: body.category,
      organization: body.organization,
      venue: body.venue,
      objectives: objectives || `Evaluate attendee experience and learning outcomes for ${eventTitle}.`,
      questionCount: parseOptionalNumber(body.questionCount),
    });

    const eventId = parseOptionalNumber(body.eventId ?? body.event_id);
    await persistOptionalEventFields(eventId, {
      ai_survey_draft: result,
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Survey generation failed";
    const statusCode = message.includes("GEMINI_API_KEY") ? 503 : 400;
    console.error("[/api/ai/surveys/generate]", err);
    res.status(statusCode).json({ error: message });
  }
});

/**
 * POST /api/ai/surveys/analyze
 */
router.post("/surveys/analyze", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    const eventTitle = (body.eventTitle || body.title || "").trim();
    const responses = Array.isArray(body.responses) ? body.responses : [];

    if (!eventTitle) {
      res.status(400).json({ error: "eventTitle is required to analyze feedback." });
      return;
    }
    if (responses.length === 0) {
      res.status(400).json({ error: "At least one survey response is required for analysis." });
      return;
    }

    const result = await analyzeSurveyFeedback({
      eventTitle,
      organization: body.organization,
      eventDate: body.eventDate ?? body.event_date,
      averageRating: parseOptionalNumber(body.averageRating),
      totalResponses: parseOptionalNumber(body.totalResponses),
      responses,
    });

    const eventId = parseOptionalNumber(body.eventId ?? body.event_id);
    await persistOptionalEventFields(eventId, {
      ai_feedback_analysis: result,
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Feedback analysis failed";
    const statusCode = message.includes("GEMINI_API_KEY") ? 503 : 400;
    console.error("[/api/ai/surveys/analyze]", err);
    res.status(statusCode).json({ error: message });
  }
});

// ============================================================================
// Public Standalone Post-Event Survey Endpoints (No Student Login Required)
// ============================================================================

/**
 * POST /api/ai/surveys/publish
 * Finalizes an AI-generated (or edited) post-event survey and generates a unique public survey link.
 */
router.post("/surveys/publish", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body || {};
    const eventId = parseOptionalNumber(body.eventId ?? body.event_id ?? body.proposalId);
    const survey = body.survey as GeneratedSurveyResult | undefined;

    if (!eventId) {
      res.status(400).json({ error: "Valid numeric eventId is required to publish a survey." });
      return;
    }
    if (!survey || !survey.surveyTitle || !Array.isArray(survey.questions)) {
      res.status(400).json({ error: "Valid survey payload with surveyTitle and questions is required." });
      return;
    }

    const record = await upsertPublishedSurvey({
      eventId,
      surveyToken: typeof body.surveyToken === "string" ? body.surveyToken : undefined,
      survey,
      eventMeta: body.eventMeta,
    });

    await persistOptionalEventFields(eventId, {
      ai_survey_draft: survey,
    });

    const baseUrl =
      typeof body.publicBaseUrl === "string" && /^https?:\/\//i.test(body.publicBaseUrl.trim())
        ? body.publicBaseUrl.trim().replace(/\/$/, "")
        : env.publicSurveyBaseUrl;

    const surveyUrl = `${baseUrl}/survey/${record.survey_token}`;

    res.json({
      surveyId: record.id,
      surveyToken: record.survey_token,
      surveyUrl,
      survey: record,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to publish survey.";
    console.error("[/api/ai/surveys/publish]", err);
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/ai/surveys/public/:token
 * Public, unauthenticated endpoint returning a published event survey for attendees.
 */
router.get("/surveys/public/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) {
      res.status(400).json({ error: "Survey token is required." });
      return;
    }
    const survey = await findPublishedSurveyByTokenOrId(token);
    if (!survey || !survey.is_active) {
      res.status(404).json({ error: "This post-event evaluation survey could not be found or has been closed." });
      return;
    }
    res.json({ survey });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load survey.";
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/ai/surveys/public/:token/responses
 * Public, unauthenticated endpoint accepting student/faculty survey responses.
 */
router.post("/surveys/public/:token/responses", async (req: Request, res: Response): Promise<void> => {
  try {
    const token = String(req.params.token || "").trim();
    const body = req.body || {};

    const published = await findPublishedSurveyByTokenOrId(token);
    const eventId =
      published?.event_id ?? parseOptionalNumber(body.eventId ?? body.event_id);

    if (!eventId) {
      res.status(404).json({ error: "Associated event survey not found." });
      return;
    }

    const responseRecord = await savePublicSurveyResponse({
      surveyId: published?.id ?? (typeof body.surveyId === "string" ? body.surveyId : null),
      eventId,
      respondentRole: typeof body.respondentRole === "string" ? body.respondentRole : "student",
      overallRating: parseOptionalNumber(body.overallRating) ?? null,
      comment: typeof body.comment === "string" ? body.comment : null,
      answers: typeof body.answers === "object" && body.answers ? body.answers : {},
    });

    res.status(201).json({ response: responseRecord });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit survey response.";
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/ai/surveys/event/:eventId/responses
 * Lists collected public responses for an event (used by Post-Event Sentiment Analytics).
 */
router.get("/surveys/event/:eventId/responses", async (req: Request, res: Response): Promise<void> => {
  try {
    const eventId = parseOptionalNumber(req.params.eventId);
    if (!eventId) {
      res.status(400).json({ error: "Valid numeric eventId is required." });
      return;
    }
    const responses = await listPublicSurveyResponses(eventId);
    res.json({ eventId, responses });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load survey responses.";
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// 5. Automated Institutional Email Syndication (Approval -> Survey -> AI Email)
// ============================================================================

function parseTargetRoles(raw: unknown): RecipientRole[] {
  const allowed: RecipientRole[] = ["student", "faculty", "staff"];
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = raw.split(",");
    }
  }
  const normalized = items
    .map((r) => String(r).trim().toLowerCase())
    .filter((r): r is RecipientRole => allowed.includes(r as RecipientRole));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["student", "faculty"];
}

/**
 * POST /api/ai/syndicate-email
 * Triggered automatically once an approved event's post-event survey is generated & saved.
 * Synthesizes an institutional HTML email with Gemini multimodal AI and dispatches via BCC batching.
 */
router.post(
  "/syndicate-email",
  upload.any(),
  async (req: Request, res: Response): Promise<void> => {
    let dispatchId: string | null = null;
    try {
      const body = req.body || {};
      const proposalId = parseOptionalNumber(
        body.proposalId ?? body.proposal_id ?? body.eventId ?? body.event_id
      );

      if (!proposalId) {
        res.status(400).json({ error: "Valid numeric proposalId (or eventId) is required." });
        return;
      }

      const targetRoles = parseTargetRoles(body.targetRoles ?? body.target_groups);
      const rawSurveyId =
        typeof body.surveyId === "string"
          ? body.surveyId.trim()
          : typeof body.survey_id === "string"
          ? body.survey_id.trim()
          : "";
      const rawSurveyToken =
        typeof body.surveyToken === "string" ? body.surveyToken.trim() : "";

      let eventSnapshot: Record<string, any> = {};
      if (body.eventSnapshot) {
        if (typeof body.eventSnapshot === "string") {
          try {
            eventSnapshot = JSON.parse(body.eventSnapshot);
          } catch {
            eventSnapshot = {};
          }
        } else if (typeof body.eventSnapshot === "object") {
          eventSnapshot = body.eventSnapshot as Record<string, any>;
        }
      }

      // 1. Fetch authoritative approved proposal from Supabase when server credentials are configured
      let dbEvent: Record<string, any> | null = null;
      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from("events")
            .select("*")
            .eq("event_id", proposalId)
            .maybeSingle();
          if (!error && data) {
            dbEvent = data as Record<string, any>;
          }
        } catch (err) {
          console.warn("[/api/ai/syndicate-email] Supabase events lookup fallback:", err);
        }
      }

      const mergedEvent = {
        ...eventSnapshot,
        ...(dbEvent || {}),
      };

      if (!mergedEvent.title) {
        res.status(404).json({
          error: `Event proposal #${proposalId} could not be found. Provide a valid approved proposalId.`,
        });
        return;
      }

      const normalizedEventStatus = String(mergedEvent.status || "").toLowerCase().trim();
      if (normalizedEventStatus !== "approved" && normalizedEventStatus !== "completed") {
        res.status(400).json({
          error: `Event #${proposalId} is currently "${mergedEvent.status || "pending"}". Only approved events can be syndicated to institutional emails.`,
        });
        return;
      }

      // 2. Resolve published survey & public survey URL (no student login required)
      const publishedSurvey =
        (rawSurveyToken ? await findPublishedSurveyByTokenOrId(rawSurveyToken) : null) ||
        (rawSurveyId ? await findPublishedSurveyByTokenOrId(rawSurveyId) : null);

      const resolvedSurveyId = publishedSurvey?.id || rawSurveyId || rawSurveyToken || null;
      const resolvedSurveyToken = publishedSurvey?.survey_token || rawSurveyToken || rawSurveyId;

      const explicitSurveyUrl =
        typeof body.surveyUrl === "string" ? body.surveyUrl.trim() : "";
      const surveyUrl =
        explicitSurveyUrl ||
        (resolvedSurveyToken
          ? `${env.publicSurveyBaseUrl}/survey/${resolvedSurveyToken}`
          : "");

      if (!surveyUrl) {
        res.status(400).json({
          error:
            "Post-event survey must be generated before syndicating institutional announcement emails.",
        });
        return;
      }

      // 3. Resolve active institutional recipients matching targetRoles
      const { recipients: dbRecipients, storage: recipientStorage } =
        await listInstitutionalRecipients({
          roles: targetRoles,
          activeOnly: true,
        });

      let recipientEmails = dbRecipients.map((r) => r.email);

      // If backend has not connected to Supabase yet and caller passed Supabase-loaded active recipients, use those
      if (recipientStorage === "memory" && Array.isArray(body.fallbackRecipients)) {
        const filteredFallback = (body.fallbackRecipients as Array<Record<string, any>>)
          .filter(
            (r) =>
              r &&
              typeof r.email === "string" &&
              r.is_active !== false &&
              targetRoles.includes(String(r.role || "student").toLowerCase() as RecipientRole)
          )
          .map((r) => String(r.email).trim().toLowerCase());
        if (filteredFallback.length > 0) {
          recipientEmails = filteredFallback;
        }
      }

      // 4. Create dispatch record in 'SENDING' state
      const initialDispatch = await createEmailDispatchRecord({
        proposalId,
        surveyId: resolvedSurveyId,
        surveyUrl,
        status: "SENDING",
        targetGroups: targetRoles,
        recipientCount: recipientEmails.length,
      });
      dispatchId = initialDispatch.id;

      // 5. Gather optional poster / promotional PDF attachments for multimodal inlineData enrichment
      const posterAttachments: DocumentInput[] = [];
      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      for (const file of uploadedFiles.slice(0, 2)) {
        posterAttachments.push({
          filename: file.originalname,
          mimeType: file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype,
          buffer: file.buffer,
        });
      }

      if (posterAttachments.length === 0) {
        const stored = eventAttachmentStore.get(proposalId);
        if (stored && stored.documents.length > 0) {
          posterAttachments.push(...stored.documents.slice(0, 2));
        }
      }

      if (posterAttachments.length === 0 && Array.isArray(body.posterUrls)) {
        for (const item of (body.posterUrls as Array<{ url?: string; filename?: string; mimeType?: string }>).slice(0, 2)) {
          if (item?.url && typeof item.url === "string") {
            try {
              const doc = await downloadFromDocumentUrl({
                url: item.url,
                filename: item.filename,
                mimeType: item.mimeType,
              });
              posterAttachments.push(doc);
            } catch (err) {
              console.warn("[/api/ai/syndicate-email] Skipped poster URL:", err);
            }
          }
        }
      }

      if (posterAttachments.length === 0 && mergedEvent.document_path && getSupabaseAdmin()) {
        try {
          const doc = await downloadFromSupabaseStorage({
            bucket: mergedEvent.document_bucket || env.supabaseStorageBucket,
            path: mergedEvent.document_path,
          });
          posterAttachments.push(doc);
        } catch (err) {
          console.warn("[/api/ai/syndicate-email] Skipped Storage poster attachment:", err);
        }
      }

      // 6. Synthesize institutional HTML + plain-text email via Gemini multimodal engine
      const eventEmailData: ApprovedEventEmailData = {
        eventId: proposalId,
        title: String(mergedEvent.title),
        organization: mergedEvent.organization || "Student Organization",
        eventDate: mergedEvent.event_date || mergedEvent.eventDate,
        startTime: mergedEvent.start_time || mergedEvent.startTime,
        endTime: mergedEvent.end_time || mergedEvent.endTime,
        venue: mergedEvent.venue,
        description: mergedEvent.description,
        registrationLink:
          mergedEvent.external_registration_link ||
          mergedEvent.registration_link ||
          mergedEvent.registrationLink ||
          null,
        clearanceHash: mergedEvent.clearance_hash || mergedEvent.clearanceHash || null,
        surveyTitle: publishedSurvey?.survey_title || mergedEvent.surveyTitle,
        highlights: Array.isArray(mergedEvent.highlights) ? mergedEvent.highlights : undefined,
      };

      const digest = await formatApprovedEventEmailDigest(
        eventEmailData,
        surveyUrl,
        posterAttachments.length > 0 ? posterAttachments : undefined
      );

      // Persist synthesized preview immediately so Admin can inspect it even if SMTP transport fails
      await updateEmailDispatchRecord(dispatchId, {
        email_subject: digest.emailSubject,
        email_html_preview: digest.htmlBody,
        email_text_fallback: digest.plainTextFallback,
      });

      // 7. Dispatch emails via BCC batching (Nodemailer SMTP or Resend fallback)
      try {
        const delivery = await sendInstitutionalAnnouncementEmail({
          recipients: recipientEmails,
          subject: digest.emailSubject,
          html: digest.htmlBody,
          text: digest.plainTextFallback,
        });

        const sentRecord = await updateEmailDispatchRecord(dispatchId, {
          status: "SENT",
          recipient_count: delivery.recipientCount,
          sent_at: new Date().toISOString(),
          error_message: null,
        });

        res.json({
          dispatch: sentRecord,
          provider: delivery.provider,
          batchCount: delivery.batchCount,
          modelUsed: digest.modelUsed,
          emailProvider: getEmailProviderStatus(),
        });
      } catch (deliveryErr) {
        const errMessage =
          deliveryErr instanceof Error ? deliveryErr.message : "Email transport delivery failed.";
        const failedRecord = await updateEmailDispatchRecord(dispatchId, {
          status: "FAILED",
          recipient_count: recipientEmails.length,
          error_message: errMessage,
        });
        console.error("[/api/ai/syndicate-email] Delivery failed:", errMessage);
        res.status(502).json({
          error: errMessage,
          dispatch: failedRecord,
          modelUsed: digest.modelUsed,
          emailProvider: getEmailProviderStatus(),
        });
      }
    } catch (err) {
      const rawMessage =
        err instanceof Error ? err.message : "Institutional email syndication failed.";
      const friendlyMessage = rawMessage.startsWith("{")
        ? "The AI email synthesizer encountered a temporary error. Please retry shortly."
        : rawMessage;
      if (dispatchId) {
        await updateEmailDispatchRecord(dispatchId, {
          status: "FAILED",
          error_message: friendlyMessage,
        });
      }
      const statusCode = rawMessage.includes("GEMINI_API_KEY") ? 503 : 400;
      console.error("[/api/ai/syndicate-email]", err);
      res.status(statusCode).json({ error: friendlyMessage });
    }
  }
);

/**
 * GET /api/ai/syndicate-email/:proposalId
 * Convenience alias returning the latest email syndication dispatch for a proposal.
 */
router.get("/syndicate-email/:proposalId", async (req: Request, res: Response): Promise<void> => {
  try {
    const proposalId = parseOptionalNumber(req.params.proposalId);
    if (!proposalId) {
      res.status(400).json({ error: "Valid numeric proposalId is required." });
      return;
    }
    const dispatches = await listEmailDispatches(proposalId);
    res.json({
      proposalId,
      latest: dispatches[0] ?? null,
      dispatches,
      emailProvider: getEmailProviderStatus(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch syndication status.";
    res.status(500).json({ error: message });
  }
});

export default router;

