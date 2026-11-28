import type {
  DispatchStatus,
  GeneratedSurveyResult,
  PreScreenResult,
  RecipientRole,
} from "./aiClient";

const MARKER_START = "\n\n<!--CAMPUSSYNC_ATTACHMENTS:";
const MARKER_END = ":END_CAMPUSSYNC_ATTACHMENTS-->";

// Keep inline base64 carry-over safely under ~3 MB raw file size (~4 MB base64)
const MAX_INLINE_FILE_BYTES = 3 * 1024 * 1024;

export type ProposalAiLifecycleStatus = "PROCESSING" | "COMPLETE" | "DEFECTIVE" | "FAILED";

export interface CarriedAttachmentFile {
  name: string;
  mimeType: string;
  size: number;
  dataBase64?: string;
  storageUrl?: string;
  tooLargeForInline?: boolean;
}

export interface CarriedPublishedSurvey {
  surveyId: string;
  surveyToken: string;
  surveyUrl: string;
  draft: GeneratedSurveyResult;
  publishedAt: string;
}

export interface CarriedEmailDispatchMeta {
  id: string;
  status: DispatchStatus;
  deliveryProvider?: "smtp" | "resend" | "sandbox" | null;
  previewUrl?: string | null;
  targetGroups: RecipientRole[];
  recipientCount: number;
  emailSubject: string | null;
  surveyUrl: string | null;
  sentAt: string | null;
  errorMessage: string | null;
}

export type DeptHeadClearanceStatus = "pending" | "approved" | "revision" | "rejected";

export interface CarriedDeptHeadClearance {
  requiresDeptHeadReview?: boolean;
  status?: DeptHeadClearanceStatus | null;
  feedback?: string | null;
  approvedAt?: string | null;
  reviewedBy?: string | null;
  estimatedBudget?: number | null;
}

export interface CarriedProposalBundle {
  files: CarriedAttachmentFile[];
  preScreen?: PreScreenResult | null;
  aiStatus?: ProposalAiLifecycleStatus | null;
  aiUpdatedAt?: string | null;
  publishedSurvey?: CarriedPublishedSurvey | null;
  emailDispatch?: CarriedEmailDispatchMeta | null;
  deptHeadClearance?: CarriedDeptHeadClearance | null;
}

export interface DecodedProposalDescription {
  cleanDescription: string;
  files: CarriedAttachmentFile[];
  preScreen: PreScreenResult | null;
  aiStatus: ProposalAiLifecycleStatus | null;
  aiUpdatedAt: string | null;
  publishedSurvey: CarriedPublishedSurvey | null;
  emailDispatch: CarriedEmailDispatchMeta | null;
  deptHeadClearance: CarriedDeptHeadClearance | null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function fileToCarriedAttachment(
  file: File,
  storageUrl?: string | null
): Promise<CarriedAttachmentFile> {
  const mimeType =
    file.type === "image/jpg"
      ? "image/jpeg"
      : file.type ||
        (file.name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : file.name.toLowerCase().endsWith(".png")
          ? "image/png"
          : "image/jpeg");

  if (storageUrl) {
    return {
      name: file.name,
      mimeType,
      size: file.size,
      storageUrl,
    };
  }

  if (file.size > MAX_INLINE_FILE_BYTES) {
    return {
      name: file.name,
      mimeType,
      size: file.size,
      tooLargeForInline: true,
    };
  }

  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    mimeType,
    size: file.size,
    dataBase64: arrayBufferToBase64(buffer),
  };
}

export function encodeProposalDescriptionWithAttachments(
  cleanDescription: string,
  bundle: CarriedProposalBundle
): string {
  const trimmed = cleanDescription.trim();
  if (
    bundle.files.length === 0 &&
    !bundle.preScreen &&
    !bundle.aiStatus &&
    !bundle.publishedSurvey &&
    !bundle.emailDispatch &&
    !bundle.deptHeadClearance
  ) {
    return trimmed;
  }
  const serialized = JSON.stringify({
    files: bundle.files,
    preScreen: bundle.preScreen ?? null,
    aiStatus: bundle.aiStatus ?? null,
    aiUpdatedAt: bundle.aiUpdatedAt ?? new Date().toISOString(),
    ...(bundle.publishedSurvey ? { publishedSurvey: bundle.publishedSurvey } : {}),
    ...(bundle.emailDispatch ? { emailDispatch: bundle.emailDispatch } : {}),
    ...(bundle.deptHeadClearance ? { deptHeadClearance: bundle.deptHeadClearance } : {}),
  });
  return `${trimmed}${MARKER_START}${serialized}${MARKER_END}`;
}

export function decodeProposalDescription(
  rawDescription?: string | null
): DecodedProposalDescription {
  const empty: DecodedProposalDescription = {
    cleanDescription: rawDescription || "",
    files: [],
    preScreen: null,
    aiStatus: null,
    aiUpdatedAt: null,
    publishedSurvey: null,
    emailDispatch: null,
    deptHeadClearance: null,
  };
  if (!rawDescription) {
    return { ...empty, cleanDescription: "" };
  }

  const startIdx = rawDescription.indexOf(MARKER_START);
  if (startIdx === -1) {
    return empty;
  }

  const endIdx = rawDescription.indexOf(MARKER_END, startIdx + MARKER_START.length);
  if (endIdx === -1) {
    return empty;
  }

  const cleanDescription = rawDescription.slice(0, startIdx).trim();
  const jsonSlice = rawDescription.slice(startIdx + MARKER_START.length, endIdx);

  try {
    const parsed = JSON.parse(jsonSlice) as Partial<CarriedProposalBundle>;
    return {
      cleanDescription,
      files: Array.isArray(parsed.files) ? parsed.files : [],
      preScreen: parsed.preScreen ?? null,
      aiStatus: parsed.aiStatus ?? null,
      aiUpdatedAt: parsed.aiUpdatedAt ?? null,
      publishedSurvey: parsed.publishedSurvey ?? null,
      emailDispatch: parsed.emailDispatch ?? null,
      deptHeadClearance: parsed.deptHeadClearance ?? null,
    };
  } catch {
    return {
      ...empty,
      cleanDescription,
    };
  }
}

export function isFreshProcessingState(
  aiStatus?: string | null,
  aiUpdatedAt?: string | null
): boolean {
  if ((aiStatus || "").toUpperCase() !== "PROCESSING") return false;
  if (!aiUpdatedAt) return true;
  const ts = new Date(aiUpdatedAt).getTime();
  if (Number.isNaN(ts)) return true;
  // Treat PROCESSING older than 90 seconds as stale so Admin view auto-triggers recovery
  return Date.now() - ts < 90_000;
}

export function carriedAttachmentToFile(att: CarriedAttachmentFile): File | null {
  if (!att.dataBase64) return null;
  try {
    const bytes = base64ToUint8Array(att.dataBase64);
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return new File([arrayBuffer], att.name, { type: att.mimeType });
  } catch {
    return null;
  }
}

export function carriedAttachmentToBlobUrl(att: CarriedAttachmentFile): string | null {
  if (att.storageUrl) return att.storageUrl;
  const file = carriedAttachmentToFile(att);
  if (!file) return null;
  return URL.createObjectURL(file);
}
