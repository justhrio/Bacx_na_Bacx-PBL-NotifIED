import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FlaskConical,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type {
  EmailDispatchRecord,
  EmailProviderStatus,
  InstitutionalRecipientRecord,
  RecipientRole,
} from "../../lib/aiClient";

const DEPARTMENT_SUGGESTIONS = [
  "All Departments",
  "SoCIT",
  "SoE",
  "SoM",
  "SoA",
  "SHS",
  "SAO",
];

export function formatRoleLabel(role: RecipientRole | string): string {
  const lower = String(role).toLowerCase();
  if (lower === "student") return "Students";
  if (lower === "faculty") return "Faculty";
  if (lower === "staff") return "Staff";
  if (lower === "all_campus") return "All Campus";
  return role;
}

export function formatTargetGroupLabel(groups?: RecipientRole[] | string[]): string {
  if (!groups || groups.length === 0) return "Students & Faculty";
  const labels = groups.map((g) => formatRoleLabel(g));
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
}

export function EmailPreviewModal({
  dispatch,
  eventTitle,
  onClose,
  onRetry,
  retrying = false,
}: {
  dispatch: EmailDispatchRecord;
  eventTitle?: string;
  onClose: () => void;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const [viewMode, setViewMode] = useState<"html" | "text">("html");
  const isSandbox =
    dispatch.delivery_provider === "sandbox" || Boolean(dispatch.preview_url);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#18212F]/60 backdrop-blur-xs">
      <div className="w-full max-w-4xl max-h-[92vh] rounded-none bg-white border border-[#DDE2EA] shadow-2xl flex flex-col overflow-hidden text-left">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#1C2D63] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-[#F2B84B] shrink-0" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#F2B84B]">
                Institutional Email Syndication Preview
              </span>
              {isSandbox && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-[#FFF4DC] text-[#8A5A00] text-[10px] font-bold">
                  <FlaskConical className="size-3" /> Sandbox Preview
                </span>
              )}
            </div>
            <h3 className="text-sm font-bold text-white truncate mt-0.5">
              {dispatch.email_subject || eventTitle || "Approved Event Announcement"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-none text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Dispatch Metadata Bar */}
        <div className="px-6 py-3 bg-[#F7F8FA] border-b border-[#DDE2EA] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-none text-[11px] font-bold border ${
                dispatch.status === "SENT"
                  ? isSandbox
                    ? "bg-[#FFF4DC] text-[#8A5A00] border-[#E5C98B]"
                    : "bg-[#E6F3EC] text-[#1F7A4D] border-[#B6DFC8]"
                  : dispatch.status === "FAILED"
                  ? "bg-[#FBEDEC] text-[#B3261E] border-[#E2B3AF]"
                  : "bg-[#EAEFFA] text-[#24408E] border-[#C5D3F3]"
              }`}
            >
              {dispatch.status === "SENT"
                ? `${isSandbox ? "Sandbox Dispatched" : "✓ Dispatched"} to ${dispatch.recipient_count} Distribution List${
                    dispatch.recipient_count === 1 ? "" : "s"
                  }`
                : dispatch.status === "FAILED"
                ? "! Delivery Failed"
                : "Sending..."}
            </span>
            <span className="text-[#5B6678]">
              Audience:{" "}
              <b className="text-[#18212F]">{formatTargetGroupLabel(dispatch.target_groups)}</b>{" "}
              (BCC Private)
            </span>
            {dispatch.sent_at && (
              <span className="text-[#5B6678]">
                Dispatched:{" "}
                <b className="text-[#18212F]">
                  {new Date(dispatch.sent_at).toLocaleString()}
                </b>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 bg-white p-0.5 rounded-none border border-[#DDE2EA] text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode("html")}
              className={`px-2.5 py-1 rounded-none font-semibold cursor-pointer transition ${
                viewMode === "html"
                  ? "bg-[#24408E] text-white"
                  : "text-[#5B6678] hover:text-[#18212F]"
              }`}
            >
              HTML Email
            </button>
            <button
              type="button"
              onClick={() => setViewMode("text")}
              className={`px-2.5 py-1 rounded-none font-semibold cursor-pointer transition ${
                viewMode === "text"
                  ? "bg-[#24408E] text-white"
                  : "text-[#5B6678] hover:text-[#18212F]"
              }`}
            >
              Plain Text Fallback
            </button>
          </div>
        </div>

        {/* Sandbox Notice Bar when sent through Ethereal */}
        {isSandbox && dispatch.status === "SENT" && (
          <div className="px-6 py-2.5 bg-[#FFF4DC] border-b border-[#E5C98B] text-xs text-[#6B4600] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <span className="flex items-center gap-1.5">
              <FlaskConical className="size-3.5 text-[#8A5A00] shrink-0" />
              Sent via Nodemailer Ethereal Sandbox Relay. Add live SMTP or Resend credentials in Vercel to deliver to real institutional inboxes.
            </span>
            {dispatch.preview_url && (
              <a
                href={dispatch.preview_url}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded-none bg-white hover:bg-[#F7F8FA] border border-[#E5C98B] text-[#8A5A00] font-semibold text-[11px] flex items-center gap-1 shrink-0"
              >
                Open Ethereal Test Inbox <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}

        {/* Error Banner if Delivery Failed */}
        {dispatch.status === "FAILED" && dispatch.error_message && (
          <div className="px-6 py-3 bg-[#FBEDEC] border-b border-[#E2B3AF] text-xs text-[#B3261E] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <span className="flex items-start gap-2">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{dispatch.error_message}</span>
            </span>
            {onRetry && (
              <button
                type="button"
                disabled={retrying}
                onClick={onRetry}
                className="px-3 py-1.5 rounded-none bg-[#B3261E] hover:bg-[#8C1D18] text-white text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
              >
                {retrying ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Retry Email Dispatch
              </button>
            )}
          </div>
        )}

        {/* Email Preview Body */}
        <div className="flex-1 overflow-y-auto p-5 bg-[#F2F4F7]">
          {viewMode === "html" ? (
            dispatch.email_html_preview ? (
              <iframe
                title="Institutional Email Preview"
                srcDoc={dispatch.email_html_preview}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                className="w-full min-h-[480px] h-[54vh] bg-white rounded-none border border-[#DDE2EA] shadow-xs"
              />
            ) : (
              <div className="p-10 rounded-none bg-white border border-[#DDE2EA] text-center text-xs text-[#5B6678]">
                HTML email preview is not available for this dispatch record.
              </div>
            )
          ) : (
            <pre className="p-5 rounded-none bg-white border border-[#DDE2EA] text-xs text-[#18212F] font-mono whitespace-pre-wrap leading-relaxed">
              {dispatch.email_text_fallback || "No plain-text fallback captured."}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-white border-t border-[#DDE2EA] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-4">
            {dispatch.survey_url && (
              <a
                href={dispatch.survey_url}
                target="_blank"
                rel="noreferrer"
                className="text-[#24408E] hover:underline font-medium flex items-center gap-1"
              >
                Open Public Survey Link <ExternalLink className="size-3 shrink-0" />
              </a>
            )}
            {dispatch.preview_url && (
              <a
                href={dispatch.preview_url}
                target="_blank"
                rel="noreferrer"
                className="text-[#8A5A00] hover:underline font-medium flex items-center gap-1"
              >
                Open Ethereal Inbox <ExternalLink className="size-3 shrink-0" />
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-none bg-[#24408E] hover:bg-[#1B3270] text-white font-semibold cursor-pointer"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmailSyndicationStatusCard({
  dispatch,
  surveyUrl,
  isSending,
  compact = false,
  onPreview,
  onRetry,
  onOpenSurveyTab,
}: {
  dispatch?: EmailDispatchRecord | null;
  surveyUrl?: string | null;
  isSending?: boolean;
  compact?: boolean;
  onPreview?: (dispatch: EmailDispatchRecord) => void;
  onRetry?: () => void;
  onOpenSurveyTab?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const effectiveStatus = isSending
    ? "SENDING"
    : dispatch?.status || "PENDING_SURVEY";
  const isSandbox =
    dispatch?.delivery_provider === "sandbox" || Boolean(dispatch?.preview_url);

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div
      className={`rounded-none border text-xs space-y-2.5 ${
        compact ? "p-3.5" : "p-4"
      } ${
        effectiveStatus === "SENT"
          ? isSandbox
            ? "bg-[#FFF9EB] border-[#E5C98B]"
            : "bg-[#E6F3EC]/60 border-[#B6DFC8]"
          : effectiveStatus === "FAILED"
          ? "bg-[#FBEDEC]/70 border-[#E2B3AF]"
          : effectiveStatus === "SENDING"
          ? "bg-[#EAEFFA] border-[#C5D3F3]"
          : "bg-[#F7F8FA] border-[#DDE2EA]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-bold text-[#18212F]">
          {effectiveStatus === "SENDING" ? (
            <Loader2 className="size-4 animate-spin text-[#24408E] shrink-0" />
          ) : effectiveStatus === "SENT" ? (
            isSandbox ? (
              <FlaskConical className="size-4 text-[#8A5A00] shrink-0" />
            ) : (
              <CheckCircle2 className="size-4 text-[#1F7A4D] shrink-0" />
            )
          ) : effectiveStatus === "FAILED" ? (
            <AlertCircle className="size-4 text-[#B3261E] shrink-0" />
          ) : (
            <Clock className="size-4 text-[#24408E] shrink-0" />
          )}

          <span>
            {effectiveStatus === "SENDING"
              ? "AI Formatting & Pushing to Institutional Distribution Lists..."
              : effectiveStatus === "SENT"
              ? `Dispatched to ${dispatch?.recipient_count || 0} distribution list${
                  (dispatch?.recipient_count || 0) === 1 ? "" : "s"
                } (${formatTargetGroupLabel(dispatch?.target_groups)})`
              : effectiveStatus === "FAILED"
              ? "Institutional Email Dispatch Failed"
              : "Waiting for Survey Generation"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {effectiveStatus === "SENT" && isSandbox && (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-none bg-[#FFF4DC] text-[#8A5A00] border border-[#E5C98B] uppercase">
              <FlaskConical className="size-3" /> Sandbox Preview
            </span>
          )}
          <span
            className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-none uppercase border ${
              effectiveStatus === "SENT"
                ? isSandbox
                  ? "bg-white text-[#8A5A00] border-[#E5C98B]"
                  : "bg-white text-[#1F7A4D] border-[#B6DFC8]"
                : effectiveStatus === "FAILED"
                ? "bg-white text-[#B3261E] border-[#E2B3AF]"
                : effectiveStatus === "SENDING"
                ? "bg-white text-[#24408E] border-[#C5D3F3]"
                : "bg-white text-[#5B6678] border-[#DDE2EA]"
            }`}
          >
            {effectiveStatus === "PENDING_SURVEY"
              ? "Pending Survey"
              : effectiveStatus === "SENDING"
              ? "Auto-Dispatching"
              : effectiveStatus === "SENT"
              ? isSandbox
                ? "Ethereal Relay"
                : "Live Sent"
              : "Failed"}
          </span>
        </div>
      </div>

      {/* Lifecycle Mini Stepper */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[#5B6678]">
        <span className="px-1.5 py-0.5 rounded-none bg-[#E6F3EC] text-[#1F7A4D] font-semibold">
          1. Approved (SHA-256)
        </span>
        <span>→</span>
        <span
          className={`px-1.5 py-0.5 rounded-none font-semibold ${
            surveyUrl || dispatch?.survey_url
              ? "bg-[#E6F3EC] text-[#1F7A4D]"
              : "bg-white border border-[#DDE2EA] text-[#5B6678]"
          }`}
        >
          2. Post-Event Survey
        </span>
        <span>→</span>
        <span
          className={`px-1.5 py-0.5 rounded-none font-semibold ${
            effectiveStatus === "SENT"
              ? isSandbox
                ? "bg-[#FFF4DC] text-[#8A5A00]"
                : "bg-[#E6F3EC] text-[#1F7A4D]"
              : effectiveStatus === "SENDING"
              ? "bg-[#24408E] text-white"
              : effectiveStatus === "FAILED"
              ? "bg-[#FBEDEC] text-[#B3261E]"
              : "bg-white border border-[#DDE2EA] text-[#5B6678]"
          }`}
        >
          3. AI Institutional Email Push
        </span>
      </div>

      {effectiveStatus === "PENDING_SURVEY" && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5B6678]">
          <span>
            Once this approved event&apos;s post-event survey is generated, CampusSync AI will automatically format and dispatch the announcement to active institutional distribution lists.
          </span>
          {onOpenSurveyTab && (
            <button
              type="button"
              onClick={onOpenSurveyTab}
              className="px-3 py-1.5 rounded-none bg-[#24408E] hover:bg-[#1B3270] text-white font-semibold text-[11px] flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Send className="size-3" /> Generate Survey &amp; Syndicate
            </button>
          )}
        </div>
      )}

      {effectiveStatus === "FAILED" && dispatch?.error_message && (
        <p className="text-[11px] text-[#8C1D18] bg-white/80 p-2.5 rounded-none border border-[#E2B3AF] leading-relaxed">
          {dispatch.error_message}
        </p>
      )}

      {(surveyUrl || dispatch?.survey_url) && (
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-none bg-white border border-[#DDE2EA] text-[11px]">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-mono uppercase text-[#5B6678] block">
              Public Post-Event Survey Link (No Student Login)
            </span>
            <a
              href={surveyUrl || dispatch?.survey_url || "#"}
              target="_blank"
              rel="noreferrer"
              className="text-[#24408E] hover:underline font-medium truncate block"
            >
              {surveyUrl || dispatch?.survey_url}
            </a>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => copyLink(surveyUrl || dispatch?.survey_url || "")}
              className="px-2 py-1 rounded-none bg-[#F2F4F7] hover:bg-[#EAEFFA] border border-[#DDE2EA] text-[#18212F] text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Copy className="size-3" /> {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={surveyUrl || dispatch?.survey_url || "#"}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 rounded-none bg-[#EAEFFA] hover:bg-[#DCE6FA] border border-[#C5D3F3] text-[#24408E] text-[10px] font-semibold flex items-center gap-1"
            >
              Open <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      )}

      {/* Action Buttons: Ethereal Preview (if sandbox), HTML Preview Modal, & Retry (ONLY when FAILED) */}
      {(dispatch?.email_html_preview || dispatch?.preview_url || effectiveStatus === "FAILED") && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          {dispatch?.sent_at ? (
            <span className={`text-[10px] ${isSandbox ? "text-[#8A5A00]" : "text-[#1F7A4D]"}`}>
              {isSandbox ? "Sandbox preview sent" : "Dispatched"}{" "}
              {new Date(dispatch.sent_at).toLocaleString()}
            </span>
          ) : (
            <span className="text-[10px] text-[#5B6678]">
              {dispatch?.email_subject ? `Subject: ${dispatch.email_subject}` : ""}
            </span>
          )}

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {dispatch?.preview_url && (
              <a
                href={dispatch.preview_url}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-none bg-white hover:bg-[#FFF4DC] border border-[#E5C98B] text-[#8A5A00] text-[11px] font-semibold flex items-center gap-1.5 transition"
              >
                <FlaskConical className="size-3.5" /> Open Ethereal Inbox <ExternalLink className="size-3" />
              </a>
            )}
            {dispatch?.email_html_preview && onPreview && (
              <button
                type="button"
                onClick={() => onPreview(dispatch)}
                className="px-3 py-1.5 rounded-none bg-white hover:bg-[#EAEFFA] border border-[#C5D3F3] text-[#24408E] text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition"
              >
                <Eye className="size-3.5" /> Preview Dispatched Email
              </button>
            )}
            {effectiveStatus === "FAILED" && onRetry && (
              <button
                type="button"
                disabled={isSending}
                onClick={onRetry}
                className="px-3 py-1.5 rounded-none bg-[#B3261E] hover:bg-[#8C1D18] text-white text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition disabled:opacity-50"
              >
                {isSending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Retry Email Dispatch
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function InstitutionalMailingListView({
  recipients,
  dispatches,
  emailProvider,
  eventTitleMap,
  loading,
  retryingProposalId,
  onAddRecipient,
  onToggleRecipient,
  onDeleteRecipient,
  onRefresh,
  onPreviewDispatch,
  onRetryDispatch,
}: {
  recipients: InstitutionalRecipientRecord[];
  dispatches: EmailDispatchRecord[];
  emailProvider: EmailProviderStatus | null;
  eventTitleMap: Record<number, string>;
  loading: boolean;
  retryingProposalId: number | null;
  onAddRecipient: (input: {
    email: string;
    role: RecipientRole;
    department: string;
  }) => Promise<void>;
  onToggleRecipient: (recipient: InstitutionalRecipientRecord) => Promise<void>;
  onDeleteRecipient: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onPreviewDispatch: (dispatch: EmailDispatchRecord) => void;
  onRetryDispatch: (dispatch: EmailDispatchRecord) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RecipientRole>("student");
  const [department, setDepartment] = useState("All Departments");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | RecipientRole>("all");

  const activeStudents = recipients.filter((r) => r.is_active && r.role === "student").length;
  const activeFaculty = recipients.filter((r) => r.is_active && r.role === "faculty").length;
  const activeOther = recipients.filter(
    (r) => r.is_active && (r.role === "staff" || r.role === "all_campus")
  ).length;
  const sentDispatchesCount = dispatches.filter((d) => d.status === "SENT").length;

  const filteredRecipients = recipients.filter((r) => {
    if (roleFilter !== "all" && r.role !== roleFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.email.toLowerCase().includes(q) ||
      r.department.toLowerCase().includes(q) ||
      formatRoleLabel(r.role).toLowerCase().includes(q)
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");
    if (!email.trim()) {
      setFormError("Distribution email address is required.");
      return;
    }
    setSaving(true);
    try {
      await onAddRecipient({
        email: email.trim().toLowerCase(),
        role,
        department: department.trim() || "All Departments",
      });
      setEmail("");
      setDepartment("All Departments");
      setFormSuccess("Distribution list added to CampusSync institutional broadcasting.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not add distribution list.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 text-left">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#DDE2EA] pb-4">
        <div>
          <h1 className="text-lg font-bold text-[#18212F] flex items-center gap-2">
            <Mail className="size-4 text-[#24408E]" /> Institutional Distribution Lists (Outlook / Campus Group Emails)
          </h1>
          <p className="text-xs text-[#5B6678] mt-0.5">
            Configure singular campus group aliases (such as <span className="font-mono text-[#18212F]">allstudents@apc.edu.ph</span> or <span className="font-mono text-[#18212F]">socit-students@apc.edu.ph</span>) that automatically receive AI-formatted event announcements via private BCC once an approved event&apos;s survey is finalized.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {emailProvider && (
            <span
              title={emailProvider.detail}
              className={`px-2.5 py-1 rounded-none text-[11px] font-semibold border flex items-center gap-1.5 ${
                emailProvider.configured
                  ? "bg-[#E6F3EC] text-[#1F7A4D] border-[#B6DFC8]"
                  : "bg-[#FFF4DC] text-[#8A5A00] border-[#E5C98B]"
              }`}
            >
              {emailProvider.configured ? (
                <ShieldCheck className="size-3.5" />
              ) : (
                <FlaskConical className="size-3.5" />
              )}
              {emailProvider.configured
                ? `Live Delivery Active (${emailProvider.provider.toUpperCase()})`
                : "Sandbox Preview Mode (Ethereal Relay)"}
            </span>
          )}
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="px-3 py-1.5 rounded-none bg-white hover:bg-[#F2F4F7] border border-[#C9D0DB] text-xs font-semibold text-[#18212F] flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`size-3.5 text-[#24408E] ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-none bg-white border border-[#DDE2EA] shadow-xs">
          <div className="text-[10px] font-mono uppercase text-[#5B6678]">Student Distribution Lists</div>
          <div className="text-2xl font-black text-[#24408E] mt-1">{activeStudents}</div>
          <div className="text-[11px] text-[#5B6678]">Active student group aliases</div>
        </div>
        <div className="p-4 rounded-none bg-white border border-[#DDE2EA] shadow-xs">
          <div className="text-[10px] font-mono uppercase text-[#5B6678]">Faculty Distribution Lists</div>
          <div className="text-2xl font-black text-[#24408E] mt-1">{activeFaculty}</div>
          <div className="text-[11px] text-[#5B6678]">Active faculty &amp; adviser lists</div>
        </div>
        <div className="p-4 rounded-none bg-white border border-[#DDE2EA] shadow-xs">
          <div className="text-[10px] font-mono uppercase text-[#5B6678]">Staff &amp; All-Campus Lists</div>
          <div className="text-2xl font-black text-[#18212F] mt-1">{activeOther}</div>
          <div className="text-[11px] text-[#5B6678]">Campus-wide &amp; staff aliases</div>
        </div>
        <div className="p-4 rounded-none bg-white border border-[#B6DFC8] shadow-xs">
          <div className="text-[10px] font-mono uppercase text-[#5B6678]">Dispatched Announcements</div>
          <div className="text-2xl font-black text-[#1F7A4D] mt-1">{sentDispatchesCount}</div>
          <div className="text-[11px] text-[#1F7A4D]/80">BCC-protected group pushes</div>
        </div>
      </div>

      {/* Add Distribution List Form + Distribution Directory Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 rounded-none bg-white border border-[#C5D3F3] p-5 shadow-xs h-fit space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#24408E] flex items-center gap-1.5">
            <Plus className="size-4" /> Add Distribution List Email
          </h2>
          <p className="text-[11px] text-[#5B6678]">
            Enter a single campus/Outlook group alias or your test inbox email for live defense demos.
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-[#18212F] block mb-1">
                Distribution Email Address *
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="allstudents@apc.edu.ph"
                className="w-full p-2.5 rounded-none bg-white border border-[#C9D0DB] text-xs font-mono text-[#18212F] placeholder:text-[#6B778A] focus:border-[#24408E] outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[#18212F] block mb-1">
                Role / Audience *
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as RecipientRole)}
                className="w-full p-2.5 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] focus:border-[#24408E] outline-none"
              >
                <option value="student">Students</option>
                <option value="faculty">Faculty</option>
                <option value="staff">Staff</option>
                <option value="all_campus">All Campus</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#18212F] block mb-1">
                Department *
              </label>
              <input
                list="campussync-departments"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="All Departments, SoCIT, SoE, SoM, SoA..."
                className="w-full p-2.5 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] placeholder:text-[#6B778A] focus:border-[#24408E] outline-none"
              />
              <datalist id="campussync-departments">
                {DEPARTMENT_SUGGESTIONS.map((dept) => (
                  <option key={dept} value={dept} />
                ))}
              </datalist>
            </div>

            {formError && (
              <div className="p-2.5 rounded-none bg-[#FBEDEC] border border-[#E2B3AF] text-[11px] text-[#B3261E]">
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="p-2.5 rounded-none bg-[#E6F3EC] border border-[#B6DFC8] text-[11px] text-[#1F7A4D]">
                {formSuccess}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 rounded-none bg-[#24408E] hover:bg-[#1B3270] text-white font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
              Add Distribution List
            </button>
          </form>
        </div>

        <div className="lg:col-span-8 rounded-none bg-white border border-[#DDE2EA] shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-[#DDE2EA] flex flex-wrap items-center justify-between gap-3 bg-[#F7F8FA]">
            <div className="flex flex-wrap items-center gap-1 bg-white p-1 rounded-none border border-[#DDE2EA] text-[11px]">
              {(["all", "student", "faculty", "staff", "all_campus"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  className={`px-2.5 py-1 rounded-none font-semibold cursor-pointer transition ${
                    roleFilter === r
                      ? "bg-[#24408E] text-white"
                      : "text-[#5B6678] hover:text-[#18212F]"
                  }`}
                >
                  {r === "all" ? `All (${recipients.length})` : formatRoleLabel(r)}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-56">
              <Search className="size-3.5 text-[#5B6678] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter email or dept..."
                className="w-full pl-8 pr-3 py-1.5 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] placeholder:text-[#6B778A] focus:border-[#24408E] outline-none"
              />
            </div>
          </div>

          {filteredRecipients.length === 0 ? (
            <div className="p-10 text-center text-xs text-[#5B6678] space-y-1.5">
              <Users className="size-8 mx-auto text-[#24408E]/30" />
              <p className="font-semibold text-[#18212F]">No matching distribution lists</p>
              <p>Add an institutional group email alias using the form on the left.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F8FA] border-b border-[#DDE2EA] text-[10px] font-mono font-semibold text-[#24408E] uppercase">
                    <th className="p-3">Distribution Email Address</th>
                    <th className="p-3">Role / Audience</th>
                    <th className="p-3">Department</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DDE2EA]">
                  {filteredRecipients.map((rec) => (
                    <tr key={rec.id} className="hover:bg-[#F7F8FA] transition-colors">
                      <td className="p-3 font-mono font-semibold text-[#18212F]">
                        {rec.email}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-none bg-[#EAEFFA] text-[#24408E] border border-[#C5D3F3] text-[10px] font-semibold">
                          {formatRoleLabel(rec.role)}
                        </span>
                      </td>
                      <td className="p-3 text-[#4B5563]">{rec.department}</td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => void onToggleRecipient(rec)}
                          className={`px-2.5 py-0.5 rounded-none text-[10px] font-bold border cursor-pointer transition ${
                            rec.is_active
                              ? "bg-[#E6F3EC] text-[#1F7A4D] border-[#B6DFC8] hover:bg-[#D5ECDF]"
                              : "bg-[#F2F4F7] text-[#5B6678] border-[#DDE2EA] hover:bg-[#E5E9F0]"
                          }`}
                        >
                          {rec.is_active ? "● Active" : "○ Paused"}
                        </button>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          title="Remove distribution list"
                          onClick={() => void onDeleteRecipient(rec.id)}
                          className="p-1.5 rounded-none text-[#5B6678] hover:text-[#B3261E] hover:bg-[#FBEDEC] cursor-pointer"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Dispatched Institutional Announcements Audit Log */}
      <div className="rounded-none bg-white border border-[#DDE2EA] shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#DDE2EA] bg-[#F7F8FA] flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#24408E] flex items-center gap-2">
            <Send className="size-3.5" /> Institutional Email Dispatch Log ({dispatches.length})
          </h2>
          <span className="text-[11px] text-[#5B6678]">
            Automatically populated when approved event surveys finalize
          </span>
        </div>

        {dispatches.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#5B6678]">
            No institutional email dispatches recorded yet. Approve a proposal and generate its post-event survey to trigger automatic email syndication.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F7F8FA] border-b border-[#DDE2EA] text-[10px] font-mono font-semibold text-[#24408E] uppercase">
                  <th className="p-3">Event / Subject</th>
                  <th className="p-3">Target Distribution Lists</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDE2EA]">
                {dispatches.map((d) => {
                  const isSandbox =
                    d.delivery_provider === "sandbox" || Boolean(d.preview_url);
                  return (
                    <tr key={d.id} className="hover:bg-[#F7F8FA]">
                      <td className="p-3">
                        <div className="font-semibold text-[#18212F]">
                          {eventTitleMap[d.proposal_id] || `Event #${d.proposal_id}`}
                        </div>
                        <div className="text-[11px] text-[#5B6678] truncate max-w-md">
                          {d.email_subject || d.error_message || "Generating digest..."}
                        </div>
                      </td>
                      <td className="p-3 text-[#4B5563]">
                        <div>{formatTargetGroupLabel(d.target_groups)}</div>
                        <div className="text-[10px] font-mono text-[#5B6678]">
                          {d.recipient_count} distribution list{d.recipient_count === 1 ? "" : "s"}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-none text-[10px] font-bold border ${
                              d.status === "SENT"
                                ? isSandbox
                                  ? "bg-[#FFF4DC] text-[#8A5A00] border-[#E5C98B]"
                                  : "bg-[#E6F3EC] text-[#1F7A4D] border-[#B6DFC8]"
                                : d.status === "FAILED"
                                ? "bg-[#FBEDEC] text-[#B3261E] border-[#E2B3AF]"
                                : "bg-[#EAEFFA] text-[#24408E] border-[#C5D3F3]"
                            }`}
                          >
                            {d.status === "SENT" && isSandbox ? "SANDBOX SENT" : d.status}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-[11px] text-[#5B6678]">
                        {new Date(d.sent_at || d.updated_at || d.created_at).toLocaleString()}
                      </td>
                      <td className="p-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {d.preview_url && (
                            <a
                              href={d.preview_url}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-1 rounded-none bg-[#FFF4DC] hover:bg-[#FCE8BA] border border-[#E5C98B] text-[#8A5A00] text-[10px] font-semibold flex items-center gap-1"
                            >
                              Ethereal <ExternalLink className="size-3" />
                            </a>
                          )}
                          {d.email_html_preview && (
                            <button
                              type="button"
                              onClick={() => onPreviewDispatch(d)}
                              className="px-2.5 py-1 rounded-none bg-[#EAEFFA] hover:bg-[#DCE6FA] border border-[#C5D3F3] text-[#24408E] text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="size-3" /> Preview
                            </button>
                          )}
                          {d.status === "FAILED" && (
                            <button
                              type="button"
                              disabled={retryingProposalId === d.proposal_id}
                              onClick={() => void onRetryDispatch(d)}
                              className="px-2.5 py-1 rounded-none bg-[#B3261E] hover:bg-[#8C1D18] text-white text-[10px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              {retryingProposalId === d.proposal_id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <RefreshCw className="size-3" />
                              )}
                              Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
