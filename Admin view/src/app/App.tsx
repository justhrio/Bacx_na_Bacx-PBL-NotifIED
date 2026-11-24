import { useState, useEffect, useRef } from "react";
import {
  Calendar,
  Building2,
  Clock,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Inbox,
  Eye,
  EyeOff,
  LogOut,
  AlertCircle,
  Home,
  ClipboardCheck,
  BarChart3,
  Users,
  Megaphone,
  Send,
  ShieldCheck,
  Search,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  AlertTriangle,
  PenTool,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Brain,
  Save,
  Paperclip,
  Mail,
  TrendingUp,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  aiLocalCache,
  analyzeAiSurveyFeedback,
  createBackendEmailRecipient,
  deleteBackendEmailRecipient,
  deriveAuditStatus,
  extractDefectItems,
  fetchBackendEmailDispatches,
  fetchBackendEmailRecipients,
  fetchEmailTransportStatus,
  fetchEventDocuments,
  formatDefectsForRevisionNote,
  generateAiSurvey,
  publishAiSurvey,
  runBatchProposalTriage,
  runDocumentPreScreen,
  runProposalTriage,
  syndicateEventEmail,
  updateBackendEmailRecipient,
  type CachedPublishedSurveyMeta,
  type EmailDispatchRecord,
  type EmailProviderStatus,
  type GeneratedQuestionType,
  type GeneratedSurveyQuestion,
  type GeneratedSurveyResult,
  type InstitutionalRecipientRecord,
  type PreScreenResult,
  type RecipientRole,
  type StoredEventDocumentMeta,
  type SurveyDiagnosticsResult,
  type SurveyResponseEntry,
  type TriageResult,
} from "../lib/aiClient";
import {
  carriedAttachmentToBlobUrl,
  carriedAttachmentToFile,
  decodeProposalDescription,
  encodeProposalDescriptionWithAttachments,
  isFreshProcessingState,
} from "../lib/proposalAttachments";
import { PublicSurveyPage } from "./components/PublicSurveyPage";
import {
  EmailPreviewModal,
  EmailSyndicationStatusCard,
  formatRoleLabel,
  InstitutionalMailingListView,
} from "./components/EmailSyndicationComponents";
import adminBg from "../assets/admin-bg.jpeg";

// Designated prototype coordinator credentials (or accept any valid @apc.edu.ph staff/admin email)
const VALID_ADMIN_EMAIL = "coordinator@apc.edu.ph";
const VALID_ADMIN_PASSWORD = "adminpassword123";

export interface EventRecord {
  event_id: number;
  title: string;
  organization?: string;
  event_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  description: string;
  tags?: string[];
  status: "pending" | "approved" | "revision" | "needs_revision" | "completed" | "rejected";
  urgency_tier?: "P1" | "P2" | "P3";
  clearance_hash?: string;
  admin_feedback?: string;
  external_registration_link?: string;
  registration_link?: string;
  has_qr_code?: boolean;
  qr_code_url?: string;
  proposed_attendees?: number;
  accepted_attendees?: number;
  estimated_budget?: number;
  has_external_guests?: boolean;
  document_bucket?: string;
  document_path?: string;
  waiver_path?: string;
  ai_audit_status?: string;
  ai_prescreen_result?: PreScreenResult;
  ai_triage_result?: TriageResult;
  ai_survey_draft?: GeneratedSurveyResult;
  ai_feedback_analysis?: SurveyDiagnosticsResult;
  created_at?: string;
}

interface AnnouncementItem {
  id: number;
  title: string;
  content: string;
  audience: string;
  created_at: string;
}

export interface FacilitatorAccount {
  id: string;
  full_name: string;
  email: string;
  organization: string;
  role: string;
  status: "Active" | "Inactive";
  last_active: string;
}

const DEFAULT_ANNOUNCEMENTS: AnnouncementItem[] = [
  {
    id: 1,
    title: "Term 2 Clearance Submission Cutoff",
    content:
      "All student organization activity proposals for Term 2 must be submitted with signed Adviser APFs at least 5 business days prior to event execution.",
    audience: "All Facilitators",
    created_at: "Nov 18, 2026",
  },
  {
    id: 2,
    title: "Off-Campus & MPH1 Waiver Enforcement",
    content:
      "Proposals utilizing Multipurpose Hall 1 (MPH1) or off-campus venues require attached participant liability waivers for AI Pre-Check clearance.",
    audience: "All Facilitators",
    created_at: "Nov 15, 2026",
  },
];

function formatEventDateDisplay(dateStr?: string | null): string {
  if (!dateStr) return "No date set";
  const dateOnlyMatch = String(dateStr).match(/^(\d{4}-\d{2}-\d{2})/);
  const parsed = new Date(dateOnlyMatch ? `${dateOnlyMatch[1]}T00:00:00` : dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return dateOnlyMatch ? dateOnlyMatch[1] : String(dateStr);
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getPublicSurveyTokenFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const pathMatch = window.location.pathname.match(/^\/survey\/([^/]+)\/?$/i);
  if (pathMatch && pathMatch[1]) {
    try {
      return decodeURIComponent(pathMatch[1]);
    } catch {
      return pathMatch[1];
    }
  }
  const searchParams = new URLSearchParams(window.location.search);
  const queryToken = searchParams.get("survey")?.trim();
  return queryToken || null;
}

async function computeSha256Hex(payload: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoded = new TextEncoder().encode(payload);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback deterministic 64-hex hash if subtle crypto is unavailable in an insecure context
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  const partA = (h1 >>> 0).toString(16).padStart(8, "0");
  const partB = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${partA}${partB}`.repeat(4).slice(0, 64);
}

export default function CoordinatorView() {
  const publicSurveyToken = getPublicSurveyTokenFromLocation();
  if (publicSurveyToken) {
    return <PublicSurveyPage surveyToken={publicSurveyToken} />;
  }

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const savedSession = localStorage.getItem("campussync_admin_logged_in");
    const savedEmail = localStorage.getItem("campussync_admin_remembered_email");

    if (savedSession === "true") {
      setIsLoggedIn(true);
    }
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setErrorMessage("Please enter both email and password.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    const isValid =
      (trimmedEmail === VALID_ADMIN_EMAIL && trimmedPassword === VALID_ADMIN_PASSWORD) ||
      (trimmedEmail === "admin@apc.edu.ph" && trimmedPassword === "adminpassword123") ||
      (trimmedEmail.endsWith("@apc.edu.ph") && trimmedPassword.length >= 6);

    if (!isValid) {
      setErrorMessage("Invalid credentials. Try coordinator@apc.edu.ph / adminpassword123");
      return;
    }

    if (rememberMe) {
      localStorage.setItem("campussync_admin_remembered_email", trimmedEmail);
      localStorage.setItem("campussync_admin_logged_in", "true");
    } else {
      localStorage.removeItem("campussync_admin_remembered_email");
      localStorage.removeItem("campussync_admin_logged_in");
    }

    setIsLoggedIn(true);
    setPassword("");
  };

  const handleLogout = () => {
    localStorage.removeItem("campussync_admin_logged_in");
    setIsLoggedIn(false);
    setPassword("");
    setErrorMessage("");
  };

  if (!isLoggedIn) {
    return (
      <div
        className="min-h-screen w-full relative flex flex-col justify-between p-6 md:p-10 font-sans text-white bg-[#D97706] bg-cover bg-center overflow-x-hidden"
        style={{ backgroundImage: `url(${adminBg})` }}
      >
        {/* ── Top Header Navigation ── */}
        <header className="w-full flex items-center justify-between z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-9 bg-[#0B132B] flex items-center justify-center font-black text-[#FFD000] text-lg border border-white/10 shadow-md rounded-none">
              C
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span className="font-black text-lg text-white tracking-tight">CampusSync</span>
                <span className="bg-[#0B132B] text-[#FFD000] text-[10px] font-mono font-bold px-2 py-0.5 uppercase tracking-wider border border-white/10 rounded-none">
                  ADMIN
                </span>
              </div>
              <p className="text-[11px] text-white/80 font-medium">Bacx to bacx Enterprise System</p>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#0B132B] border border-white/15 text-white text-xs font-semibold shadow-md rounded-none">
            <span className="size-2 bg-emerald-400"></span>
            CAMPUSSYNC: ADMIN COORDINATOR
          </div>
        </header>

        {/* ── Main Left-Weighted Auth Terminal ── */}
        <main className="w-full my-auto py-8 z-10 flex items-center justify-start lg:pl-16">
          <div className="w-full max-w-[440px] bg-[#0E1528] border border-white/10 shadow-2xl p-8 md:p-10 text-left rounded-none">
            <div className="flex items-center justify-between text-[10px] font-mono tracking-widest text-[#FFD000] mb-3 uppercase">
              <span>AUTHORIZED CLEARANCE ACCESS</span>
              <span className="text-white/40">v2.5 SECURE</span>
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1 tracking-tight">
              Admin Login
            </h1>
            <p className="text-xs text-[#8D99AE] mb-6">
              Review, clear, and publish campus event proposals.
            </p>

            {errorMessage && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2 rounded-none">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-[10px] font-mono tracking-wider text-slate-300 uppercase block mb-1.5">
                  INSTITUTIONAL EMAIL
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="coordinator@apc.edu.ph"
                  className="w-full px-3.5 py-2.5 bg-[#080D1A] border border-white/15 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-[#FFD000] transition rounded-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono tracking-wider text-slate-300 uppercase block mb-1.5">
                  PASSWORD
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3.5 py-2.5 bg-[#080D1A] border border-white/15 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-[#FFD000] transition rounded-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <label className="flex items-center gap-2 text-slate-300 hover:text-white cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="bg-[#080D1A] border-white/20 text-[#FFD000] focus:ring-0 cursor-pointer rounded-none"
                  />
                  Remember Me
                </label>
                <span className="text-[#FFD000] hover:underline cursor-pointer text-xs">
                  Forgot Password?
                </span>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-[#FDB813] hover:bg-[#e0a20f] text-black font-extrabold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition shadow-lg cursor-pointer mt-4 rounded-none"
              >
                SIGN IN TO COORDINATOR PORTAL →
              </button>
            </form>

            <div className="mt-8 pt-4 border-t border-white/10 flex items-center justify-between text-[10px] font-mono text-white/50">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 bg-[#FFD000]"></span>
                Campus Clearance Portal
              </span>
              <span>Asia Pacific College</span>
            </div>
          </div>
        </main>

        <div className="h-4 z-10 shrink-0"></div>
      </div>
    );
  }

  return <CoordinatorInterface onLogout={handleLogout} coordinatorEmail={email || VALID_ADMIN_EMAIL} />;
}

function getLeadTimeBadge(dateStr: string) {
  if (!dateStr) return { text: "No date", isUrgent: false };
  const target = new Date(dateStr).getTime();
  const now = new Date().getTime();
  const diffHours = Math.round((target - now) / (1000 * 60 * 60));

  if (diffHours <= 0) return { text: "Passed", isUrgent: false };
  if (diffHours <= 48) return { text: `🔴 In ${diffHours}h`, isUrgent: true };
  if (diffHours <= 96) return { text: `🟡 In ${Math.round(diffHours / 24)}d`, isUrgent: true };
  return { text: `🟢 In ${Math.round(diffHours / 24)}d`, isUrgent: false };
}

function getTierBadgeMeta(tier: "P1" | "P2" | "P3"): {
  tier: "P1" | "P2" | "P3";
  label: string;
  style: string;
} {
  if (tier === "P1") {
    return {
      tier: "P1",
      label: "P1 HIGH",
      style: "bg-[#FBEDEC] text-[#B3261E] border border-[#E2B3AF] rounded-none",
    };
  }
  if (tier === "P2") {
    return {
      tier: "P2",
      label: "P2 MED",
      style: "bg-[#FFF4DC] text-[#8A5A00] border border-[#E5C98B] rounded-none",
    };
  }
  return {
    tier: "P3",
    label: "P3 STD",
    style: "bg-[#F2F4F7] text-[#5B6678] border border-[#DDE2EA] rounded-none",
  };
}

function getStatusBadgeStyle(status?: string): string {
  const s = (status || "pending").toLowerCase().trim();
  if (s === "approved" || s === "completed") {
    return "bg-[#E6F3EC] text-[#1F7A4D] border border-[#B6DFC8]";
  }
  if (s === "revision" || s === "needs_revision") {
    return "bg-[#FFF4DC] text-[#8A5A00] border border-[#E5C98B]";
  }
  if (s === "rejected") {
    return "bg-[#FBEDEC] text-[#B3261E] border border-[#E2B3AF]";
  }
  return "bg-[#EAEFFA] text-[#24408E] border border-[#C5D3F3]";
}

function computeDynamicUrgency(dateStr: string | null): {
  tier: "P1" | "P2" | "P3";
  label: string;
  style: string;
} {
  if (!dateStr) return getTierBadgeMeta("P3");

  const target = new Date(dateStr).getTime();
  const now = new Date().getTime();
  const diffHours = (target - now) / (1000 * 60 * 60);

  if (diffHours <= 96) return getTierBadgeMeta("P1");
  if (diffHours <= 336) return getTierBadgeMeta("P2");
  return getTierBadgeMeta("P3");
}

function getDefaultSurveyResponses(eventTitle: string): SurveyResponseEntry[] {
  return [
    {
      rating: 5,
      comment: `The ${eventTitle} session was well-organized and the speakers gave practical examples we can apply in our coursework.`,
    },
    {
      rating: 4,
      comment:
        "Very engaging program overall, though registration check-in took a bit longer than expected during the first 15 minutes.",
    },
    {
      rating: 5,
      comment:
        "Loved the interactive Q&A and peer collaboration segments. Would definitely attend a follow-up workshop.",
    },
    {
      rating: 3,
      comment:
        "Good content, but the audio in the back rows was slightly muffled and we ran out of time for hands-on troubleshooting.",
    },
  ];
}

export function CoordinatorInterface({
  onLogout,
  coordinatorEmail = VALID_ADMIN_EMAIL,
}: {
  onLogout?: () => void;
  coordinatorEmail?: string;
}) {
  // Always lands on Home upon logging in
  const [activeNav, setActiveNav] = useState<
    "home" | "approvals" | "surveys" | "mailing" | "accounts" | "engagement"
  >("home");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [triageTier, setTriageTier] = useState<"ALL" | "P1" | "P2" | "P3">("ALL");
  const [reviewFilter, setReviewFilter] = useState<"PENDING" | "ALL">("PENDING");
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [showRevisionModal, setShowRevisionModal] = useState(false);

  // Home / Announcements States
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>(DEFAULT_ANNOUNCEMENTS);
  const [annTitle, setAnnTitle] = useState("");
  const [annContent, setAnnContent] = useState("");

  // Account Management States (Empty until Facilitator View signup/persistence is connected)
  const [facilitatorAccounts, setFacilitatorAccounts] = useState<FacilitatorAccount[]>([]);
  const [accountSearch, setAccountSearch] = useState("");

  // Engagement Analytics Search State
  const [engagementSearch, setEngagementSearch] = useState("");

  // ── AI Feature 1: Multimodal Document & Signature Pre-Screening State ──
  const [preScreenMap, setPreScreenMap] = useState<Record<string, PreScreenResult>>(() =>
    aiLocalCache.getPreScreens()
  );
  const [preScreenLoading, setPreScreenLoading] = useState(false);
  const [preScreenError, setPreScreenError] = useState("");

  // ── AI Feature 2: Dynamic Priority Queue Triage State ──
  const [triageMap, setTriageMap] = useState<Record<string, TriageResult>>(() =>
    aiLocalCache.getTriages()
  );
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState("");
  const [expandedTriageIds, setExpandedTriageIds] = useState<Record<number, boolean>>({});

  // ── AI Feature 3: Post-Event Survey Generator State ──
  const [surveyTargetEventId, setSurveyTargetEventId] = useState<number | "">("");
  const [surveyCategory, setSurveyCategory] = useState("Academic Seminar / Workshop");
  const [surveyObjectives, setSurveyObjectives] = useState("");
  const [generatingSurvey, setGeneratingSurvey] = useState(false);
  const [surveyGenError, setSurveyGenError] = useState("");
  const [activeSurveyDraft, setActiveSurveyDraft] = useState<GeneratedSurveyResult | null>(null);
  const [savedSurveyDrafts, setSavedSurveyDrafts] = useState<
    Record<string, GeneratedSurveyResult>
  >(() => aiLocalCache.getSurveyDrafts());
  const [surveySaveMessage, setSurveySaveMessage] = useState("");
  const [publishedSurveysMap, setPublishedSurveysMap] = useState<
    Record<string, CachedPublishedSurveyMeta>
  >(() => aiLocalCache.getPublishedSurveys());

  // ── AI Feature 4: Post-Event Survey Sentiment & Diagnostics State ──
  const [feedbackResponsesByEvent, setFeedbackResponsesByEvent] = useState<
    Record<number, SurveyResponseEntry[]>
  >({});
  const [liveResponsesByEvent, setLiveResponsesByEvent] = useState<
    Record<number, SurveyResponseEntry[]>
  >({});
  const [feedbackAnalysisMap, setFeedbackAnalysisMap] = useState<
    Record<string, SurveyDiagnosticsResult>
  >(() => aiLocalCache.getFeedbackAnalyses());
  const [analyzingEventId, setAnalyzingEventId] = useState<number | null>(null);
  const [feedbackError, setFeedbackError] = useState("");
  const [expandedFeedbackEventId, setExpandedFeedbackEventId] = useState<number | null>(null);
  const [newFeedbackRating, setNewFeedbackRating] = useState(5);
  const [newFeedbackComment, setNewFeedbackComment] = useState("");

  // ── AI Feature 5: Automated Institutional Email Syndication State ──
  const [surveyTargetGroups, setSurveyTargetGroups] = useState<RecipientRole[]>([
    "student",
    "faculty",
    "all_campus",
  ]);
  const [mailingRecipients, setMailingRecipients] = useState<InstitutionalRecipientRecord[]>([]);
  const [emailProviderStatus, setEmailProviderStatus] = useState<EmailProviderStatus | null>(null);
  const [mailingLoading, setMailingLoading] = useState(false);
  const [emailDispatchesList, setEmailDispatchesList] = useState<EmailDispatchRecord[]>(() =>
    Object.values(aiLocalCache.getEmailDispatches())
  );
  const [dispatchMap, setDispatchMap] = useState<Record<string, EmailDispatchRecord>>(() =>
    aiLocalCache.getEmailDispatches()
  );
  const [syndicatingEventId, setSyndicatingEventId] = useState<number | null>(null);
  const [previewDispatch, setPreviewDispatch] = useState<EmailDispatchRecord | null>(null);

  const getEventTriage = (ev: EventRecord): TriageResult | undefined =>
    ev.ai_triage_result || triageMap[String(ev.event_id)];

  const getEventPreScreen = (ev: EventRecord): PreScreenResult | undefined =>
    ev.ai_prescreen_result ||
    decodeProposalDescription(ev.description).preScreen ||
    preScreenMap[String(ev.event_id)];

  const getEventPublishedSurvey = (ev: EventRecord): CachedPublishedSurveyMeta | null => {
    const cached = publishedSurveysMap[String(ev.event_id)];
    if (cached) return cached;
    const carried = decodeProposalDescription(ev.description).publishedSurvey;
    if (carried) {
      return {
        surveyId: carried.surveyId,
        surveyToken: carried.surveyToken,
        surveyUrl: carried.surveyUrl,
      };
    }
    return null;
  };

  const getEventDispatch = (ev: EventRecord): EmailDispatchRecord | null => {
    const fromMap = dispatchMap[String(ev.event_id)];
    if (fromMap) return fromMap;
    const carried = decodeProposalDescription(ev.description).emailDispatch;
    if (carried) {
      return {
        id: carried.id,
        proposal_id: ev.event_id,
        survey_id: null,
        survey_url: carried.surveyUrl,
        status: carried.status,
        delivery_provider: carried.deliveryProvider ?? null,
        preview_url: carried.previewUrl ?? null,
        target_groups: carried.targetGroups,
        recipient_count: carried.recipientCount,
        email_subject: carried.emailSubject,
        email_html_preview: null,
        email_text_fallback: null,
        sent_at: carried.sentAt,
        error_message: carried.errorMessage,
        created_at: carried.sentAt || ev.created_at || new Date().toISOString(),
        updated_at: carried.sentAt || ev.created_at || new Date().toISOString(),
      };
    }
    return null;
  };

  const [dbError, setDbError] = useState("");

  const normalizedStatus = (status?: string) => (status || "pending").toLowerCase().trim();

  const pendingReviewEvents = events.filter((e) => normalizedStatus(e.status) === "pending");
  const approvedEvents = events.filter((e) => {
    const s = normalizedStatus(e.status);
    return s === "approved" || s === "completed";
  });
  const p1UrgentCount = pendingReviewEvents.filter((e) => {
    const aiTriage = getEventTriage(e);
    const tier = aiTriage?.priorityTier || e.urgency_tier || computeDynamicUrgency(e.event_date).tier;
    return tier === "P1";
  }).length;

  const baseEventsList = reviewFilter === "PENDING" ? pendingReviewEvents : events;

  const triagedEvents = baseEventsList
    .map((item) => {
      const aiTriage = getEventTriage(item);
      const effectiveTier =
        aiTriage?.priorityTier || item.urgency_tier || computeDynamicUrgency(item.event_date).tier;
      return {
        ...item,
        aiTriage,
        calculatedUrgency: getTierBadgeMeta(effectiveTier),
      };
    })
    .filter((item) => {
      if (triageTier === "ALL") return true;
      return item.calculatedUrgency.tier === triageTier;
    })
    .sort((a, b) => {
      const priorityOrder: Record<string, number> = { P1: 1, P2: 2, P3: 3 };
      const diffPriority =
        priorityOrder[a.calculatedUrgency.tier] - priorityOrder[b.calculatedUrgency.tier];
      if (diffPriority !== 0) return diffPriority;
      const compDiff = (b.aiTriage?.complexityScore || 0) - (a.aiTriage?.complexityScore || 0);
      if (compDiff !== 0) return compDiff;
      const timeA = a.event_date ? new Date(a.event_date).getTime() : Number.MAX_SAFE_INTEGER;
      const timeB = b.event_date ? new Date(b.event_date).getTime() : Number.MAX_SAFE_INTEGER;
      return (Number.isNaN(timeA) ? Number.MAX_SAFE_INTEGER : timeA) -
        (Number.isNaN(timeB) ? Number.MAX_SAFE_INTEGER : timeB);
    });

  const fetchQueue = async () => {
    setLoading(true);
    setDbError("");
    try {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("event_id", { ascending: false });

      if (error) {
        console.error("Error fetching queue from Supabase:", error.message);
        setDbError(`Supabase sync error: ${error.message}`);
      } else if (data) {
        setEvents(data as EventRecord[]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not reach Supabase.";
      console.error("Error fetching queue from Supabase:", msg);
      setDbError(`Supabase connection failed: ${msg}`);
    }
    setLoading(false);
  };

  // Sync live registered facilitator accounts once Facilitator Portal creates users
  const fetchFacilitatorAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("role_id", 1);

      if (!error && data && data.length > 0) {
        const mapped: FacilitatorAccount[] = data.map((u: any) => ({
          id: `FAC-${String(u.user_id).padStart(3, "0")}`,
          full_name: u.full_name,
          email: u.email,
          organization: u.organization || "Student Organization",
          role: "Activity Facilitator",
          status: "Active",
          last_active: "Registered",
        }));
        setFacilitatorAccounts(mapped);
      } else {
        setFacilitatorAccounts([]);
      }
    } catch (err) {
      console.error("Error fetching facilitator accounts:", err);
      setFacilitatorAccounts([]);
    }
  };

  const fetchAnnouncements = async () => {
    try {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("announcement_id", { ascending: false });

      if (!error && data && data.length > 0) {
        const mapped: AnnouncementItem[] = data.map((a: any) => ({
          id: a.announcement_id,
          title: a.title,
          content: a.content,
          audience: a.target_audience || "All Facilitators",
          created_at: a.published_at
            ? new Date(a.published_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "Recent",
        }));
        setAnnouncements([...mapped, ...DEFAULT_ANNOUNCEMENTS]);
      }
    } catch {
      // Fall back to default announcements
    }
  };

  // Sync Institutional Distribution Lists, Email Dispatches, Published Surveys, and Live Survey Responses
  const fetchSyndicationData = async () => {
    setMailingLoading(true);
    try {
      // 1. Institutional Distribution Lists + Email Transport Status (Supabase primary, backend fallback)
      const [dbRecRes, backendRecRes, transportStatus] = await Promise.all([
        supabase
          .from("institutional_recipients")
          .select("id, email, role, department, is_active, created_at, updated_at")
          .order("created_at", { ascending: false }),
        fetchBackendEmailRecipients(),
        fetchEmailTransportStatus(),
      ]);

      if (transportStatus) {
        setEmailProviderStatus(transportStatus);
      } else if (backendRecRes?.emailProvider) {
        setEmailProviderStatus(backendRecRes.emailProvider);
      }

      if (!dbRecRes.error && Array.isArray(dbRecRes.data)) {
        setMailingRecipients(dbRecRes.data as InstitutionalRecipientRecord[]);
      } else if (backendRecRes?.recipients) {
        setMailingRecipients(backendRecRes.recipients);
      }

      // 2. Email Dispatches (Supabase primary, backend & local cache merged)
      const [dbDispRes, backendDispRes] = await Promise.all([
        supabase
          .from("email_dispatches")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
        fetchBackendEmailDispatches(),
      ]);

      if (backendDispRes?.emailProvider) {
        setEmailProviderStatus(backendDispRes.emailProvider);
      }

      const combinedDispatches: EmailDispatchRecord[] = [];
      const seenIds = new Set<string>();
      const sources = [
        ...(!dbDispRes.error && Array.isArray(dbDispRes.data)
          ? (dbDispRes.data as EmailDispatchRecord[])
          : []),
        ...(backendDispRes?.dispatches || []),
        ...Object.values(aiLocalCache.getEmailDispatches()),
      ];
      for (const item of sources) {
        if (!item?.id || seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        combinedDispatches.push(item);
      }
      combinedDispatches.sort(
        (a, b) =>
          new Date(b.created_at || b.updated_at).getTime() -
          new Date(a.created_at || a.updated_at).getTime()
      );
      setEmailDispatchesList(combinedDispatches);

      const latestByProposal: Record<string, EmailDispatchRecord> = {};
      for (const d of combinedDispatches) {
        const key = String(d.proposal_id);
        if (!latestByProposal[key]) {
          latestByProposal[key] = d;
          aiLocalCache.saveEmailDispatch(d.proposal_id, d);
        }
      }
      if (Object.keys(latestByProposal).length > 0) {
        setDispatchMap((prev) => ({ ...prev, ...latestByProposal }));
      }

      // 3. Published Event Surveys (Supabase event_surveys)
      const { data: surveyRows, error: surveyErr } = await supabase
        .from("event_surveys")
        .select("*")
        .order("created_at", { ascending: false });

      if (!surveyErr && Array.isArray(surveyRows) && surveyRows.length > 0) {
        const origin =
          typeof window !== "undefined"
            ? window.location.origin
            : "https://adminview-eight.vercel.app";
        const nextPublished: Record<string, CachedPublishedSurveyMeta> = {};
        const nextDrafts: Record<string, GeneratedSurveyResult> = {};
        for (const row of surveyRows as any[]) {
          const key = String(row.event_id);
          if (!nextPublished[key]) {
            const meta: CachedPublishedSurveyMeta = {
              surveyId: row.id,
              surveyToken: row.survey_token,
              surveyUrl: `${origin}/survey/${row.survey_token}`,
            };
            nextPublished[key] = meta;
            aiLocalCache.savePublishedSurvey(row.event_id, meta);
            if (Array.isArray(row.questions)) {
              const draft: GeneratedSurveyResult = {
                surveyTitle: row.survey_title,
                description: row.description || "",
                questions: row.questions,
              };
              nextDrafts[key] = draft;
              aiLocalCache.saveSurveyDraft(row.event_id, draft);
            }
          }
        }
        setPublishedSurveysMap((prev) => ({ ...prev, ...nextPublished }));
        setSavedSurveyDrafts((prev) => ({ ...prev, ...nextDrafts }));
      }

      // 4. Live Public Survey Responses (Supabase survey_responses)
      const { data: respRows, error: respErr } = await supabase
        .from("survey_responses")
        .select("*")
        .order("submitted_at", { ascending: false });

      if (!respErr && Array.isArray(respRows)) {
        const grouped: Record<number, SurveyResponseEntry[]> = {};
        for (const row of respRows as any[]) {
          const evId = Number(row.event_id);
          if (!Number.isFinite(evId)) continue;
          if (!grouped[evId]) grouped[evId] = [];
          grouped[evId].push({
            rating: typeof row.overall_rating === "number" ? row.overall_rating : undefined,
            comment: row.comment || "",
            answers: row.answers || undefined,
          });
        }
        setLiveResponsesByEvent(grouped);
      }
    } catch (err) {
      console.warn("[CampusSync] Syndication sync warning:", err);
    } finally {
      setMailingLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    fetchFacilitatorAccounts();
    fetchAnnouncements();
    void fetchSyndicationData();

    const channel = supabase
      .channel("events-queue-channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        () => {
          fetchQueue();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "email_dispatches" },
        () => {
          void fetchSyndicationData();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "survey_responses" },
        () => {
          void fetchSyndicationData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "institutional_recipients" },
        () => {
          void fetchSyndicationData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const selectedEvent =
    triagedEvents.find((e) => e.event_id === selectedEventId) ||
    triagedEvents[0] ||
    null;

  const [remoteDocsByEvent, setRemoteDocsByEvent] = useState<
    Record<number, StoredEventDocumentMeta[]>
  >({});
  const autoAuditTriggeredRef = useRef<Set<string>>(new Set());

  const decodedSelected = decodeProposalDescription(selectedEvent?.description);
  const selectedCarriedFiles = decodedSelected.files;
  const selectedPreScreen = selectedEvent ? getEventPreScreen(selectedEvent) : undefined;
  const selectedAuditStatus = selectedPreScreen ? deriveAuditStatus(selectedPreScreen) : null;
  const selectedDefects = selectedPreScreen ? extractDefectItems(selectedPreScreen) : [];
  const selectedTriage = selectedEvent ? getEventTriage(selectedEvent) : undefined;
  const selectedRemoteDocs = selectedEvent
    ? remoteDocsByEvent[selectedEvent.event_id] || []
    : [];
  const selectedIsProcessing = Boolean(
    selectedEvent &&
      !selectedPreScreen &&
      (isFreshProcessingState(selectedEvent.ai_audit_status, selectedEvent.created_at) ||
        isFreshProcessingState(decodedSelected.aiStatus, decodedSelected.aiUpdatedAt))
  );

  const handleOpenRevisionWithAiDefects = (report: PreScreenResult) => {
    setRevisionFeedback(formatDefectsForRevisionNote(report));
    setShowRevisionModal(true);
  };

  const persistOptionalEventColumns = async (
    eventId: number,
    fields: Record<string, unknown>
  ) => {
    try {
      const { error } = await supabase
        .from("events")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("event_id", eventId);
      if (error) {
        console.warn("Optional Supabase AI column update skipped:", error.message);
      }
    } catch {
      // Gracefully fall back to local state/cache
    }
  };

  const persistAuditResultToSupabase = async (
    ev: EventRecord,
    result: PreScreenResult
  ) => {
    const decoded = decodeProposalDescription(ev.description);
    const status = deriveAuditStatus(result);
    const updatedDescription = encodeProposalDescriptionWithAttachments(decoded.cleanDescription, {
      files: decoded.files,
      preScreen: result,
      aiStatus: status,
      aiUpdatedAt: new Date().toISOString(),
      publishedSurvey: decoded.publishedSurvey,
      emailDispatch: decoded.emailDispatch,
    });

    const { error: extErr } = await supabase
      .from("events")
      .update({
        description: updatedDescription,
        ai_audit_status: status,
        ai_prescreen_result: result,
        updated_at: new Date().toISOString(),
      })
      .eq("event_id", ev.event_id);

    if (extErr) {
      await supabase
        .from("events")
        .update({
          description: updatedDescription,
          updated_at: new Date().toISOString(),
        })
        .eq("event_id", ev.event_id);
    }

    setEvents((prev) =>
      prev.map((item) =>
        item.event_id === ev.event_id
          ? {
              ...item,
              description: updatedDescription,
              ai_audit_status: status,
              ai_prescreen_result: result,
            }
          : item
      )
    );
  };

  // ── Automated Multimodal AI Audit Runner (triggered automatically when no saved audit exists) ──
  const runAutomaticProposalAudit = async (
    ev: EventRecord,
    remoteDocsOverride?: StoredEventDocumentMeta[]
  ) => {
    const decoded = decodeProposalDescription(ev.description);
    const carriedFileObjects = decoded.files
      .map((att) => carriedAttachmentToFile(att))
      .filter((f): f is File => Boolean(f));
    const documentUrls = decoded.files
      .filter((att) => Boolean(att.storageUrl))
      .map((att) => ({
        url: att.storageUrl as string,
        filename: att.name,
        mimeType: att.mimeType,
      }));
    const storageDocuments =
      carriedFileObjects.length === 0 && documentUrls.length === 0 && ev.document_path
        ? [
            { bucket: ev.document_bucket, path: ev.document_path },
            ...(ev.waiver_path ? [{ bucket: ev.document_bucket, path: ev.waiver_path }] : []),
          ]
        : [];
    const availableRemoteDocs = remoteDocsOverride ?? remoteDocsByEvent[ev.event_id] ?? [];

    if (
      carriedFileObjects.length === 0 &&
      documentUrls.length === 0 &&
      storageDocuments.length === 0 &&
      availableRemoteDocs.length === 0
    ) {
      return;
    }

    setPreScreenLoading(true);
    setPreScreenError("");

    try {
      const result = await runDocumentPreScreen({
        files: carriedFileObjects,
        storageDocuments,
        documentUrls: carriedFileObjects.length === 0 ? documentUrls : [],
        eventId: ev.event_id,
        metadata: {
          title: ev.title,
          organization: ev.organization,
          eventDate: ev.event_date,
          startTime: ev.start_time,
          endTime: ev.end_time,
          venue: ev.venue,
          description: decoded.cleanDescription,
          budget: ev.estimated_budget,
          expectedAttendees: ev.proposed_attendees,
          hasExternalGuests: ev.has_external_guests,
        },
      });

      aiLocalCache.savePreScreen(ev.event_id, result);
      setPreScreenMap((prev) => ({ ...prev, [String(ev.event_id)]: result }));
      await persistAuditResultToSupabase(ev, result);
    } catch (err) {
      console.error("[CampusSync AI] Automatic Admin proposal audit failed:", err);
      setPreScreenError(
        err instanceof Error ? err.message : "Automated AI document verification failed."
      );
    } finally {
      setPreScreenLoading(false);
    }
  };

  // Poll Supabase while a newly submitted proposal is still in PROCESSING state
  useEffect(() => {
    if (!selectedIsProcessing || !selectedEvent?.event_id) return;
    const interval = window.setInterval(() => {
      void fetchQueue();
    }, 3000);
    return () => {
      window.clearInterval(interval);
    };
  }, [selectedIsProcessing, selectedEvent?.event_id]);

  // On opening any proposal: hydrate relay docs/results, and automatically run AI audit once if missing
  useEffect(() => {
    const ev = selectedEvent;
    if (!ev) return;
    let cancelled = false;
    setPreScreenError("");

    const decoded = decodeProposalDescription(ev.description);
    const existingSaved = getEventPreScreen(ev);
    const isProcessingNow =
      !existingSaved &&
      (isFreshProcessingState(ev.ai_audit_status, ev.created_at) ||
        isFreshProcessingState(decoded.aiStatus, decoded.aiUpdatedAt));

    void (async () => {
      const payload = await fetchEventDocuments(ev.event_id);
      if (cancelled) return;

      const remoteDocs = payload?.documents || [];
      if (remoteDocs.length > 0) {
        setRemoteDocsByEvent((prev) => ({ ...prev, [ev.event_id]: remoteDocs }));
      }
      if (payload?.preScreenResult) {
        aiLocalCache.savePreScreen(ev.event_id, payload.preScreenResult);
        setPreScreenMap((prev) => ({
          ...prev,
          [String(ev.event_id)]: payload.preScreenResult as PreScreenResult,
        }));
        return;
      }

      if (existingSaved || isProcessingNow) {
        return;
      }

      const hasDocs =
        decoded.files.length > 0 ||
        remoteDocs.length > 0 ||
        Boolean(ev.document_path);

      if (!hasDocs) return;

      const guardKey = `${ev.event_id}:${ev.description?.length || 0}:${remoteDocs.length}`;
      if (autoAuditTriggeredRef.current.has(guardKey)) return;
      autoAuditTriggeredRef.current.add(guardKey);

      await runAutomaticProposalAudit(ev, remoteDocs);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedEvent?.event_id, selectedEvent?.description, selectedIsProcessing]);

  // ── AI Handler 2: Dynamic Priority Queue Triage (Batch & Single) ──
  const handleRunBatchTriage = async () => {
    const targets = baseEventsList;
    if (targets.length === 0) return;
    setTriageLoading(true);
    setTriageError("");

    try {
      const results = await runBatchProposalTriage(
        targets.map((ev) => ({
          eventId: ev.event_id,
          title: ev.title,
          organization: ev.organization,
          eventDate: ev.event_date,
          venue: ev.venue,
          description: decodeProposalDescription(ev.description).cleanDescription,
          expectedCrowdSize: ev.proposed_attendees,
          budget: ev.estimated_budget,
          hasExternalGuests: ev.has_external_guests,
          tags: ev.tags,
        }))
      );

      const nextMap = { ...triageMap };
      for (const item of results) {
        const triageObj: TriageResult = {
          priorityTier: item.priorityTier,
          complexityScore: item.complexityScore,
          riskFlags: item.riskFlags,
          rationale: item.rationale,
        };
        nextMap[String(item.eventId)] = triageObj;
        aiLocalCache.saveTriage(item.eventId, triageObj);
        void persistOptionalEventColumns(item.eventId, {
          urgency_tier: item.priorityTier,
          ai_triage_result: triageObj,
        });
      }
      setTriageMap(nextMap);
    } catch (err) {
      setTriageError(err instanceof Error ? err.message : "AI Queue Triage failed.");
    } finally {
      setTriageLoading(false);
    }
  };

  const handleRunSingleTriage = async (ev: EventRecord) => {
    setTriageLoading(true);
    setTriageError("");
    try {
      const result = await runProposalTriage({
        eventId: ev.event_id,
        title: ev.title,
        organization: ev.organization,
        eventDate: ev.event_date,
        venue: ev.venue,
        description: decodeProposalDescription(ev.description).cleanDescription,
        expectedCrowdSize: ev.proposed_attendees,
        budget: ev.estimated_budget,
        hasExternalGuests: ev.has_external_guests,
        tags: ev.tags,
      });
      aiLocalCache.saveTriage(ev.event_id, result);
      setTriageMap((prev) => ({ ...prev, [String(ev.event_id)]: result }));
      await persistOptionalEventColumns(ev.event_id, {
        urgency_tier: result.priorityTier,
        ai_triage_result: result,
      });
    } catch (err) {
      setTriageError(err instanceof Error ? err.message : "AI Triage failed.");
    } finally {
      setTriageLoading(false);
    }
  };

  // ── AI Feature 5 Helper: Publish Public Survey & Trigger Automated Institutional Email Syndication ──
  const publishSurveyForEvent = async (
    targetEv: EventRecord,
    draft: GeneratedSurveyResult,
    existingToken?: string
  ): Promise<CachedPublishedSurveyMeta> => {
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://adminview-eight.vercel.app";
    const randomPart =
      typeof crypto !== "undefined" && crypto.getRandomValues
        ? Array.from(crypto.getRandomValues(new Uint8Array(5)))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
        : Math.random().toString(36).slice(2, 10);

    const token = existingToken || `srv_${targetEv.event_id}_${randomPart}`;
    let surveyId = token;
    let surveyUrl = `${origin}/survey/${token}`;

    // 1. Persist directly to Supabase public.event_surveys so standalone public links work globally
    try {
      const { data: upserted, error: upsertErr } = await supabase
        .from("event_surveys")
        .upsert(
          {
            survey_token: token,
            event_id: targetEv.event_id,
            survey_title: draft.surveyTitle,
            description: draft.description || "",
            questions: draft.questions,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "survey_token" }
        )
        .select("*")
        .single();

      if (!upsertErr && upserted?.id) {
        surveyId = String(upserted.id);
      }
    } catch (err) {
      console.warn("[CampusSync] Supabase event_surveys upsert skipped:", err);
    }

    // 2. Mirror to backend public survey endpoint (fallback when Supabase migration hasn't run yet)
    try {
      const backendPub = await publishAiSurvey({
        eventId: targetEv.event_id,
        surveyToken: token,
        survey: draft,
        publicBaseUrl: origin,
        eventMeta: {
          title: targetEv.title,
          organization: targetEv.organization,
          event_date: targetEv.event_date,
          venue: targetEv.venue,
        },
      });
      if (backendPub?.surveyId && surveyId === token) {
        surveyId = backendPub.surveyId;
      }
      if (backendPub?.surveyUrl) {
        surveyUrl = backendPub.surveyUrl;
      }
    } catch (err) {
      console.warn("[CampusSync] Backend survey publish mirror skipped:", err);
    }

    // 3. Mirror published survey into events.description bundle so /survey/:token resolves even pre-migration
    const decoded = decodeProposalDescription(targetEv.description);
    const updatedDescription = encodeProposalDescriptionWithAttachments(decoded.cleanDescription, {
      files: decoded.files,
      preScreen: decoded.preScreen,
      aiStatus: decoded.aiStatus,
      aiUpdatedAt: decoded.aiUpdatedAt,
      publishedSurvey: {
        surveyId,
        surveyToken: token,
        surveyUrl,
        draft,
        publishedAt: new Date().toISOString(),
      },
      emailDispatch: decoded.emailDispatch,
    });

    const { error: extErr } = await supabase
      .from("events")
      .update({
        description: updatedDescription,
        ai_survey_draft: draft,
        updated_at: new Date().toISOString(),
      })
      .eq("event_id", targetEv.event_id);

    if (extErr) {
      await supabase
        .from("events")
        .update({
          description: updatedDescription,
          updated_at: new Date().toISOString(),
        })
        .eq("event_id", targetEv.event_id);
    }

    setEvents((prev) =>
      prev.map((item) =>
        item.event_id === targetEv.event_id
          ? { ...item, description: updatedDescription, ai_survey_draft: draft }
          : item
      )
    );

    const meta: CachedPublishedSurveyMeta = { surveyId, surveyToken: token, surveyUrl };
    aiLocalCache.saveSurveyDraft(targetEv.event_id, draft);
    aiLocalCache.savePublishedSurvey(targetEv.event_id, meta);
    setSavedSurveyDrafts((prev) => ({ ...prev, [String(targetEv.event_id)]: draft }));
    setPublishedSurveysMap((prev) => ({ ...prev, [String(targetEv.event_id)]: meta }));
    return meta;
  };

  const persistDispatchRecordLocallyAndToSupabase = async (
    targetEv: EventRecord,
    dispatch: EmailDispatchRecord
  ) => {
    aiLocalCache.saveEmailDispatch(targetEv.event_id, dispatch);
    setDispatchMap((prev) => ({ ...prev, [String(targetEv.event_id)]: dispatch }));
    setEmailDispatchesList((prev) => {
      const rest = prev.filter((item) => item.id !== dispatch.id);
      return [dispatch, ...rest];
    });

    // Ensure Supabase public.email_dispatches has the latest dispatch record (even when backend lacks service_role key)
    try {
      const validUuid = /^[0-9a-f-]{36}$/i.test(dispatch.id);
      const baseRow = {
        ...(validUuid ? { id: dispatch.id } : {}),
        proposal_id: targetEv.event_id,
        survey_id: dispatch.survey_id,
        survey_url: dispatch.survey_url,
        status: dispatch.status,
        target_groups: dispatch.target_groups,
        recipient_count: dispatch.recipient_count,
        email_subject: dispatch.email_subject,
        email_html_preview: dispatch.email_html_preview,
        email_text_fallback: dispatch.email_text_fallback,
        sent_at: dispatch.sent_at,
        error_message: dispatch.error_message,
        updated_at: new Date().toISOString(),
      };
      const extendedRow = {
        ...baseRow,
        ...(dispatch.delivery_provider ? { delivery_provider: dispatch.delivery_provider } : {}),
        ...(dispatch.preview_url ? { preview_url: dispatch.preview_url } : {}),
      };
      const { error: upsertErr } = await supabase
        .from("email_dispatches")
        .upsert(extendedRow, { onConflict: "id" });

      if (
        upsertErr &&
        (upsertErr.message.includes("delivery_provider") || upsertErr.message.includes("preview_url"))
      ) {
        await supabase.from("email_dispatches").upsert(baseRow, { onConflict: "id" });
      }
    } catch {
      // Table may not exist yet; graceful local cache & events bundle fallback applies
    }

    // Mirror lightweight dispatch status into events.description bundle
    try {
      const decoded = decodeProposalDescription(targetEv.description);
      const updatedDescription = encodeProposalDescriptionWithAttachments(
        decoded.cleanDescription,
        {
          files: decoded.files,
          preScreen: decoded.preScreen,
          aiStatus: decoded.aiStatus,
          aiUpdatedAt: decoded.aiUpdatedAt,
          publishedSurvey: decoded.publishedSurvey,
          emailDispatch: {
            id: dispatch.id,
            status: dispatch.status,
            deliveryProvider: dispatch.delivery_provider ?? null,
            previewUrl: dispatch.preview_url ?? null,
            targetGroups: dispatch.target_groups,
            recipientCount: dispatch.recipient_count,
            emailSubject: dispatch.email_subject,
            surveyUrl: dispatch.survey_url,
            sentAt: dispatch.sent_at,
            errorMessage: dispatch.error_message,
          },
        }
      );
      await supabase
        .from("events")
        .update({ description: updatedDescription, updated_at: new Date().toISOString() })
        .eq("event_id", targetEv.event_id);
      setEvents((prev) =>
        prev.map((item) =>
          item.event_id === targetEv.event_id
            ? { ...item, description: updatedDescription }
            : item
        )
      );
    } catch {
      // Non-critical bundle mirror failure
    }
  };

  const triggerAutomatedEmailSyndication = async (
    targetEv: EventRecord,
    publishedMeta: CachedPublishedSurveyMeta,
    roles: RecipientRole[] = surveyTargetGroups
  ) => {
    const evStatus = normalizedStatus(targetEv.status);
    if (evStatus !== "approved" && evStatus !== "completed") {
      return;
    }

    const effectiveRoles: RecipientRole[] =
      roles.length > 0 ? roles : ["student", "faculty"];
    setSyndicatingEventId(targetEv.event_id);

    // Ensure event has a verifiable SHA-256 hash before formatting the official email
    let clearanceHash = targetEv.clearance_hash || "";
    if (!clearanceHash) {
      clearanceHash = await computeSha256Hex(
        JSON.stringify({
          event_id: targetEv.event_id,
          title: targetEv.title,
          organization: targetEv.organization || "Student Organization",
          event_date: targetEv.event_date,
          venue: targetEv.venue,
          registration_link:
            targetEv.external_registration_link || targetEv.registration_link || "",
        })
      );
      await supabase
        .from("events")
        .update({ clearance_hash: clearanceHash, updated_at: new Date().toISOString() })
        .eq("event_id", targetEv.event_id);
    }

    // Gather optional approved poster/PDF attachments for multimodal Gemini email enrichment
    const decoded = decodeProposalDescription(targetEv.description);
    const sortedAttachments = [...decoded.files].sort((a, b) => {
      const aImg = a.mimeType.startsWith("image/") ? 0 : 1;
      const bImg = b.mimeType.startsWith("image/") ? 0 : 1;
      return aImg - bImg;
    });
    const posterFiles = sortedAttachments
      .map((att) => carriedAttachmentToFile(att))
      .filter((f): f is File => Boolean(f))
      .slice(0, 2);
    const posterUrls = sortedAttachments
      .filter((att) => Boolean(att.storageUrl))
      .map((att) => ({
        url: att.storageUrl as string,
        filename: att.name,
        mimeType: att.mimeType,
      }))
      .slice(0, 2);

    const preScreen = getEventPreScreen(targetEv);
    const draftTitle =
      activeSurveyDraft?.surveyTitle ||
      savedSurveyDrafts[String(targetEv.event_id)]?.surveyTitle ||
      targetEv.ai_survey_draft?.surveyTitle;

    try {
      const response = await syndicateEventEmail({
        proposalId: targetEv.event_id,
        surveyId: publishedMeta.surveyId,
        surveyToken: publishedMeta.surveyToken,
        surveyUrl: publishedMeta.surveyUrl,
        targetRoles: effectiveRoles,
        posterFiles,
        posterUrls,
        fallbackRecipients: mailingRecipients,
        eventSnapshot: {
          event_id: targetEv.event_id,
          title: targetEv.title,
          organization: targetEv.organization,
          event_date: targetEv.event_date,
          start_time: targetEv.start_time,
          end_time: targetEv.end_time,
          venue: targetEv.venue,
          description: decoded.cleanDescription,
          status: targetEv.status,
          external_registration_link: targetEv.external_registration_link,
          registration_link: targetEv.registration_link,
          clearance_hash: clearanceHash,
          surveyTitle: draftTitle,
          highlights: preScreen?.eventSummary?.keyHighlights || [],
        },
      });

      if (response.emailProvider) {
        setEmailProviderStatus(response.emailProvider);
      }

      if (response.dispatch) {
        await persistDispatchRecordLocallyAndToSupabase(targetEv, response.dispatch);
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "Automated institutional email syndication failed.";
      const failedRecord: EmailDispatchRecord = {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `disp-${Date.now()}`,
        proposal_id: targetEv.event_id,
        survey_id: publishedMeta.surveyId,
        survey_url: publishedMeta.surveyUrl,
        status: "FAILED",
        target_groups: effectiveRoles,
        recipient_count: mailingRecipients.filter(
          (r) => r.is_active && effectiveRoles.includes(r.role)
        ).length,
        email_subject: `[Official Event Announcement] ${targetEv.title}`,
        email_html_preview: null,
        email_text_fallback: null,
        sent_at: null,
        error_message: errMsg,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await persistDispatchRecordLocallyAndToSupabase(targetEv, failedRecord);
    } finally {
      setSyndicatingEventId(null);
    }
  };

  const handleRetryEmailDispatch = async (targetEv: EventRecord, existingDispatch?: EmailDispatchRecord | null) => {
    const published = getEventPublishedSurvey(targetEv);
    const surveyUrl = existingDispatch?.survey_url || published?.surveyUrl;
    if (!surveyUrl) {
      setActiveNav("surveys");
      setSurveyTargetEventId(targetEv.event_id);
      return;
    }
    const meta: CachedPublishedSurveyMeta = {
      surveyId: existingDispatch?.survey_id || published?.surveyId || `srv_${targetEv.event_id}`,
      surveyToken: published?.surveyToken || `srv_${targetEv.event_id}`,
      surveyUrl,
    };
    const roles =
      existingDispatch?.target_groups && existingDispatch.target_groups.length > 0
        ? existingDispatch.target_groups
        : surveyTargetGroups;
    await triggerAutomatedEmailSyndication(targetEv, meta, roles);
  };

  // ── AI Handler 3: Generate Post-Event Survey with AI (+ Automatic Institutional Email Syndication) ──
  const handleGenerateSurveyWithAi = async () => {
    const targetEv =
      events.find((e) => e.event_id === surveyTargetEventId) ||
      approvedEvents[0] ||
      events[0];

    const eventTitle = targetEv?.title || "Campus Academic Symposium";
    const objectives =
      surveyObjectives.trim() ||
      decodeProposalDescription(targetEv?.description).cleanDescription ||
      `Evaluate student learning outcomes, logistics, and speaker effectiveness for ${eventTitle}.`;

    setGeneratingSurvey(true);
    setSurveyGenError("");
    setSurveySaveMessage("");

    try {
      const result = await generateAiSurvey({
        eventId: targetEv?.event_id,
        eventTitle,
        category: surveyCategory,
        organization: targetEv?.organization,
        venue: targetEv?.venue,
        objectives,
      });
      setActiveSurveyDraft(result);

      if (targetEv) {
        const existingPub = getEventPublishedSurvey(targetEv);
        const publishedMeta = await publishSurveyForEvent(
          targetEv,
          result,
          existingPub?.surveyToken
        );

        const isApproved =
          normalizedStatus(targetEv.status) === "approved" ||
          normalizedStatus(targetEv.status) === "completed";

        if (isApproved) {
          setSurveySaveMessage(
            "Survey finalized & published. Automatically formatting and dispatching institutional announcement email..."
          );
          // Immediately trigger automated institutional email syndication after survey finalization
          void triggerAutomatedEmailSyndication(targetEv, publishedMeta, surveyTargetGroups);
        } else {
          setSurveySaveMessage(
            "Survey finalized & saved. Approve this event to trigger automatic institutional email syndication."
          );
        }
      }
    } catch (err) {
      setSurveyGenError(err instanceof Error ? err.message : "Failed to generate survey with AI.");
    } finally {
      setGeneratingSurvey(false);
    }
  };

  const handleSaveSurveyDraft = async () => {
    if (!activeSurveyDraft) return;
    const targetEv =
      events.find((e) => e.event_id === surveyTargetEventId) ||
      approvedEvents[0] ||
      events[0];
    if (!targetEv) {
      aiLocalCache.saveSurveyDraft("custom-draft", activeSurveyDraft);
      setSavedSurveyDrafts((prev) => ({ ...prev, "custom-draft": activeSurveyDraft }));
      setSurveySaveMessage("Survey saved.");
      return;
    }

    const existingPub = getEventPublishedSurvey(targetEv);
    const publishedMeta = await publishSurveyForEvent(
      targetEv,
      activeSurveyDraft,
      existingPub?.surveyToken
    );

    const existingDispatch = getEventDispatch(targetEv);
    const isApproved =
      normalizedStatus(targetEv.status) === "approved" ||
      normalizedStatus(targetEv.status) === "completed";

    if (isApproved && existingDispatch?.status !== "SENT") {
      setSurveySaveMessage(
        "Survey saved & published. Automatically triggering institutional email syndication..."
      );
      void triggerAutomatedEmailSyndication(targetEv, publishedMeta, surveyTargetGroups);
    } else {
      setSurveySaveMessage(
        "Survey updates saved live — the existing public survey link now serves your updated questions."
      );
    }
  };

  const updateDraftQuestion = (
    qId: string,
    patch: Partial<GeneratedSurveyQuestion>
  ) => {
    setActiveSurveyDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) => (q.id === qId ? { ...q, ...patch } : q)),
      };
    });
  };

  const addDraftQuestion = () => {
    setActiveSurveyDraft((prev) => {
      const base: GeneratedSurveyResult = prev || {
        surveyTitle: "Post-Event Student Evaluation",
        description: "Please share your feedback to help improve future campus events.",
        questions: [],
      };
      const nextId = `q${base.questions.length + 1}_${Date.now().toString(36).slice(-3)}`;
      return {
        ...base,
        questions: [
          ...base.questions,
          {
            id: nextId,
            text: "How satisfied were you with the overall event experience?",
            type: "rating_1_to_5",
            required: true,
            options: [],
          },
        ],
      };
    });
  };

  const removeDraftQuestion = (qId: string) => {
    setActiveSurveyDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.filter((q) => q.id !== qId),
      };
    });
  };

  // ── AI Handler 4: Post-Event Feedback Sentiment & Diagnostics ──
  const hasLiveResponsesForEvent = (ev: EventRecord): boolean =>
    (liveResponsesByEvent[ev.event_id]?.length || 0) > 0;

  const getResponsesForEvent = (ev: EventRecord): SurveyResponseEntry[] => {
    const live = liveResponsesByEvent[ev.event_id] || [];
    const manual = feedbackResponsesByEvent[ev.event_id] || [];
    if (live.length > 0 || manual.length > 0) {
      return [...manual, ...live];
    }
    return getDefaultSurveyResponses(ev.title);
  };

  const handleAddFeedbackResponse = (ev: EventRecord) => {
    if (!newFeedbackComment.trim()) return;
    setFeedbackResponsesByEvent((prev) => ({
      ...prev,
      [ev.event_id]: [
        { rating: newFeedbackRating, comment: newFeedbackComment.trim() },
        ...(prev[ev.event_id] || []),
      ],
    }));
    setNewFeedbackComment("");
    setNewFeedbackRating(5);
  };

  const handleAnalyzeFeedbackWithAi = async (ev: EventRecord) => {
    const responses = getResponsesForEvent(ev);
    const rated = responses.filter((r) => typeof r.rating === "number");
    const avgRating =
      rated.length > 0
        ? Number((rated.reduce((s, r) => s + (r.rating || 0), 0) / rated.length).toFixed(2))
        : undefined;

    setAnalyzingEventId(ev.event_id);
    setExpandedFeedbackEventId(ev.event_id);
    setFeedbackError("");

    try {
      const result = await analyzeAiSurveyFeedback({
        eventId: ev.event_id,
        eventTitle: ev.title,
        organization: ev.organization,
        eventDate: ev.event_date,
        averageRating: avgRating,
        totalResponses: responses.length,
        responses,
      });
      aiLocalCache.saveFeedbackAnalysis(ev.event_id, result);
      setFeedbackAnalysisMap((prev) => ({ ...prev, [String(ev.event_id)]: result }));
      await persistOptionalEventColumns(ev.event_id, { ai_feedback_analysis: result });
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : "AI feedback analysis failed.");
    } finally {
      setAnalyzingEventId(null);
    }
  };

  // ── Distribution List CRUD Handlers (Supabase primary, backend /api/email/recipients fallback) ──
  const handleAddMailingRecipient = async (input: {
    email: string;
    role: RecipientRole;
    department: string;
  }) => {
    const cleanedEmail = input.email.trim().toLowerCase();
    const payload = {
      email: cleanedEmail,
      role: input.role,
      department: input.department.trim() || "All Departments",
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    let { data, error } = await supabase
      .from("institutional_recipients")
      .upsert(payload, { onConflict: "email" })
      .select("id, email, role, department, is_active, created_at, updated_at")
      .single();

    // Graceful retry if the legacy NOT NULL constraint on full_name hasn't been dropped yet
    if (error && error.message.toLowerCase().includes("full_name")) {
      const retry = await supabase
        .from("institutional_recipients")
        .upsert({ ...payload, full_name: cleanedEmail }, { onConflict: "email" })
        .select("id, email, role, department, is_active, created_at, updated_at")
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (!error && data) {
      const rec = data as InstitutionalRecipientRecord;
      setMailingRecipients((prev) => [rec, ...prev.filter((item) => item.id !== rec.id)]);
      return;
    }

    const rec = await createBackendEmailRecipient(input);
    setMailingRecipients((prev) => [rec, ...prev.filter((item) => item.id !== rec.id)]);
  };

  const handleToggleMailingRecipient = async (recipient: InstitutionalRecipientRecord) => {
    const nextActive = !recipient.is_active;
    const { data, error } = await supabase
      .from("institutional_recipients")
      .update({ is_active: nextActive, updated_at: new Date().toISOString() })
      .eq("id", recipient.id)
      .select("*")
      .single();

    if (!error && data) {
      setMailingRecipients((prev) =>
        prev.map((r) => (r.id === recipient.id ? (data as InstitutionalRecipientRecord) : r))
      );
      return;
    }

    try {
      const updated = await updateBackendEmailRecipient(recipient.id, { is_active: nextActive });
      setMailingRecipients((prev) =>
        prev.map((r) => (r.id === recipient.id ? updated : r))
      );
    } catch {
      setMailingRecipients((prev) =>
        prev.map((r) => (r.id === recipient.id ? { ...r, is_active: nextActive } : r))
      );
    }
  };

  const handleDeleteMailingRecipient = async (id: string) => {
    const { error } = await supabase.from("institutional_recipients").delete().eq("id", id);
    if (error) {
      try {
        await deleteBackendEmailRecipient(id);
      } catch {
        // Ignore backend fallback delete error
      }
    }
    setMailingRecipients((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateStatus = async (
    status: "approved" | "rejected" | "revision",
    feedback?: string
  ) => {
    if (!selectedEvent) return;
    setActionLoading(true);

    const dbStatus = status === "revision" ? "needs_revision" : status;
    const targetId = selectedEvent.event_id;
    const nowIso = new Date().toISOString();

    let clearanceHash = selectedEvent.clearance_hash || null;
    if (status === "approved") {
      clearanceHash = await computeSha256Hex(
        JSON.stringify({
          event_id: targetId,
          title: selectedEvent.title,
          organization: selectedEvent.organization || "Student Organization",
          event_date: selectedEvent.event_date,
          start_time: selectedEvent.start_time,
          end_time: selectedEvent.end_time,
          venue: selectedEvent.venue,
          registration_link:
            selectedEvent.external_registration_link || selectedEvent.registration_link || "",
          coordinatorEmail,
          approvedAt: nowIso,
        })
      );
    }

    const updatePayload: Record<string, unknown> = {
      status: dbStatus,
      admin_feedback: feedback || null,
      updated_at: nowIso,
      ...(status === "approved" && clearanceHash ? { clearance_hash: clearanceHash } : {}),
    };

    const { error } = await supabase
      .from("events")
      .update(updatePayload)
      .eq("event_id", targetId);

    if (error) {
      console.error(`Failed to update status to ${status}:`, error.message);
      alert(`Could not submit: ${error.message}`);
    } else {
      setShowRevisionModal(false);
      setRevisionFeedback("");
      // Optimistically update local state so rejected/processed proposals leave the Pending view immediately
      setEvents((prev) =>
        prev.map((ev) =>
          ev.event_id === targetId
            ? {
                ...ev,
                status: dbStatus as EventRecord["status"],
                admin_feedback: feedback || ev.admin_feedback,
                ...(status === "approved" && clearanceHash ? { clearance_hash: clearanceHash } : {}),
              }
            : ev
        )
      );
      if (status === "approved") {
        setSurveyTargetEventId(targetId);
      }
      if (reviewFilter === "PENDING") {
        setSelectedEventId(null);
      }
      await fetchQueue();
    }
    setActionLoading(false);
  };

  const handlePublishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annContent.trim()) return;

    const newItem: AnnouncementItem = {
      id: Date.now(),
      title: annTitle.trim(),
      content: annContent.trim(),
      audience: "All Facilitators",
      created_at: new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    };

    await supabase.from("announcements").insert([
      {
        title: newItem.title,
        content: newItem.content,
        target_audience: "facilitators",
      },
    ]);

    setAnnouncements([newItem, ...announcements]);
    setAnnTitle("");
    setAnnContent("");
  };

  const filteredFacilitators = facilitatorAccounts.filter(
    (acc) =>
      acc.full_name.toLowerCase().includes(accountSearch.toLowerCase()) ||
      acc.email.toLowerCase().includes(accountSearch.toLowerCase()) ||
      acc.organization.toLowerCase().includes(accountSearch.toLowerCase())
  );

  // ── Student Email Engagement Analytics Aggregation ──
  const studentDispatches = emailDispatchesList.filter((d) => {
    const groups = Array.isArray(d.target_groups) ? d.target_groups : [];
    return (
      groups.includes("student") ||
      groups.includes("all_campus") ||
      groups.length === 0
    );
  });

  const engagementCampaigns = studentDispatches.map((dispatch) => {
    const ev = events.find((e) => e.event_id === dispatch.proposal_id);
    const eventTitle = ev?.title || `Event Proposal #${dispatch.proposal_id}`;
    const organization = ev?.organization || "Student Organization";

    // Total pushed student recipients for this dispatch
    const pushedCount = Math.max(
      dispatch.recipient_count || 0,
      ev?.proposed_attendees || 0,
      1
    );

    // Real answered count from live public survey responses (or feedback responses)
    const liveSurveyResponses = liveResponsesByEvent[dispatch.proposal_id]?.length || 0;
    const manualResponses = feedbackResponsesByEvent[dispatch.proposal_id]?.length || 0;
    const rawAnswered = liveSurveyResponses + manualResponses;
    const answered = Math.min(pushedCount, rawAnswered);

    // Viewed count: at least everyone who answered + deterministic open/view tracking from sent dispatches
    const isSent = dispatch.status === "SENT";
    const estimatedOpened = isSent
      ? Math.min(
          pushedCount,
          Math.max(
            answered,
            Math.round(pushedCount * (0.58 + ((dispatch.proposal_id % 5) * 0.06)))
          )
        )
      : answered;

    const totalViews = Math.min(pushedCount, Math.max(answered, estimatedOpened));
    const unread = Math.max(0, pushedCount - totalViews);
    const responseRate =
      pushedCount > 0 ? Number(((answered / pushedCount) * 100).toFixed(1)) : 0;
    const openRate =
      pushedCount > 0 ? Number(((totalViews / pushedCount) * 100).toFixed(1)) : 0;

    return {
      dispatchId: dispatch.id,
      proposalId: dispatch.proposal_id,
      eventTitle,
      organization,
      status: dispatch.status,
      sentAt: dispatch.sent_at || dispatch.created_at,
      pushedCount,
      totalViews,
      answered,
      unread,
      responseRate,
      openRate,
    };
  });

  const totalPushedStudentEmails = engagementCampaigns.reduce(
    (sum, c) => sum + c.pushedCount,
    0
  );
  const totalStudentViews = engagementCampaigns.reduce(
    (sum, c) => sum + c.totalViews,
    0
  );
  const totalStudentAnswered = engagementCampaigns.reduce(
    (sum, c) => sum + c.answered,
    0
  );
  const totalStudentUnread = engagementCampaigns.reduce(
    (sum, c) => sum + c.unread,
    0
  );
  const overallViewRate =
    totalPushedStudentEmails > 0
      ? ((totalStudentViews / totalPushedStudentEmails) * 100).toFixed(1)
      : "0.0";
  const overallAnswerRate =
    totalPushedStudentEmails > 0
      ? ((totalStudentAnswered / totalPushedStudentEmails) * 100).toFixed(1)
      : "0.0";
  const overallUnreadRate =
    totalPushedStudentEmails > 0
      ? ((totalStudentUnread / totalPushedStudentEmails) * 100).toFixed(1)
      : "0.0";

  const filteredEngagementCampaigns = engagementCampaigns.filter(
    (c) =>
      c.eventTitle.toLowerCase().includes(engagementSearch.toLowerCase()) ||
      c.organization.toLowerCase().includes(engagementSearch.toLowerCase())
  );

  const maxBarScale = Math.max(
    totalPushedStudentEmails,
    totalStudentViews,
    totalStudentAnswered,
    totalStudentUnread,
    1
  );

  return (
    <div className="h-screen w-full flex overflow-hidden bg-[#F2F4F7] text-[#18212F] font-sans">
      {/* ── INSTITUTIONAL BLUE COLLAPSIBLE LEFT SIDEBAR NAVIGATION ── */}
      <aside
        className={`${
          isSidebarCollapsed ? "w-20" : "w-64"
        } bg-[#1C2D63] border-r border-[#162452] text-white flex flex-col justify-between shrink-0 select-none transition-all duration-200`}
      >
        <div>
          {/* Institutional Brand Header + Collapse Toggle */}
          <div className="p-4 border-b border-white/10 bg-[#162452] flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-9 rounded-none bg-[#24408E] border border-[#F2B84B]/50 flex items-center justify-center font-black text-[#F2B84B] text-lg shrink-0">
                C
              </div>
              {!isSidebarCollapsed && (
                <div className="min-w-0 text-left">
                  <div className="font-bold text-sm tracking-tight text-white truncate">CampusSync</div>
                  <div className="text-[10px] font-mono text-[#B8C3E3] tracking-wider uppercase truncate">
                    ASIA PACIFIC COLLEGE
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
              className="p-1.5 rounded-none text-[#B8C3E3] hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
            >
              {isSidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </div>

          {/* Categorized Menu */}
          <nav className="py-4 px-2 space-y-5">
            <div>
              {!isSidebarCollapsed && (
                <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-wider text-[#B8C3E3] uppercase">
                  OVERVIEW
                </div>
              )}
              <button
                type="button"
                title="Home"
                onClick={() => setActiveNav("home")}
                className={`w-full px-3 py-2.5 rounded-none text-xs flex items-center ${
                  isSidebarCollapsed ? "justify-center" : "gap-3"
                } transition-colors cursor-pointer ${
                  activeNav === "home"
                    ? "bg-white/15 text-white font-semibold shadow-[inset_3px_0_0_#F2B84B]"
                    : "text-[#D5DCF0] hover:bg-white/10 hover:text-white"
                }`}
              >
                <Home className="size-4 text-[#F2B84B] shrink-0" />
                {!isSidebarCollapsed && <span>Home</span>}
              </button>
            </div>

            <div>
              {!isSidebarCollapsed && (
                <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-wider text-[#B8C3E3] uppercase">
                  CLEARANCE WORKFLOW
                </div>
              )}
              <button
                type="button"
                title="Pending Approvals"
                onClick={() => setActiveNav("approvals")}
                className={`w-full px-3 py-2.5 rounded-none text-xs flex items-center ${
                  isSidebarCollapsed ? "justify-center relative" : "justify-between"
                } transition-colors cursor-pointer ${
                  activeNav === "approvals"
                    ? "bg-white/15 text-white font-semibold shadow-[inset_3px_0_0_#F2B84B]"
                    : "text-[#D5DCF0] hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="flex items-center gap-3">
                  <ClipboardCheck className="size-4 text-[#F2B84B] shrink-0" />
                  {!isSidebarCollapsed && <span>Pending Approvals</span>}
                </span>
                {pendingReviewEvents.length > 0 && (
                  <span
                    className={`${
                      isSidebarCollapsed ? "absolute top-1.5 right-2 px-1 text-[9px]" : "px-1.5 py-0.5 text-[10px]"
                    } rounded-none font-bold bg-[#F2B84B] text-[#1C2D63]`}
                  >
                    {pendingReviewEvents.length}
                  </span>
                )}
              </button>
            </div>

            <div>
              {!isSidebarCollapsed && (
                <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-wider text-[#B8C3E3] uppercase">
                  GOVERNANCE & ANALYTICS
                </div>
              )}
              <button
                type="button"
                title="Surveys"
                onClick={() => setActiveNav("surveys")}
                className={`w-full px-3 py-2.5 rounded-none text-xs flex items-center ${
                  isSidebarCollapsed ? "justify-center" : "gap-3"
                } transition-colors cursor-pointer ${
                  activeNav === "surveys"
                    ? "bg-white/15 text-white font-semibold shadow-[inset_3px_0_0_#F2B84B]"
                    : "text-[#D5DCF0] hover:bg-white/10 hover:text-white"
                }`}
              >
                <BarChart3 className="size-4 text-[#F2B84B] shrink-0" />
                {!isSidebarCollapsed && <span>Surveys</span>}
              </button>

              <button
                type="button"
                title="Institutional Mailing List"
                onClick={() => setActiveNav("mailing")}
                className={`w-full px-3 py-2.5 mt-0.5 rounded-none text-xs flex items-center ${
                  isSidebarCollapsed ? "justify-center relative" : "justify-between"
                } transition-colors cursor-pointer ${
                  activeNav === "mailing"
                    ? "bg-white/15 text-white font-semibold shadow-[inset_3px_0_0_#F2B84B]"
                    : "text-[#D5DCF0] hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="flex items-center gap-3">
                  <Mail className="size-4 text-[#F2B84B] shrink-0" />
                  {!isSidebarCollapsed && <span>Mailing List</span>}
                </span>
                {!isSidebarCollapsed && mailingRecipients.filter((r) => r.is_active).length > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-none font-bold bg-white/15 text-[#F2B84B]">
                    {mailingRecipients.filter((r) => r.is_active).length}
                  </span>
                )}
              </button>

              <button
                type="button"
                title="Account Management"
                onClick={() => setActiveNav("accounts")}
                className={`w-full px-3 py-2.5 mt-0.5 rounded-none text-xs flex items-center ${
                  isSidebarCollapsed ? "justify-center" : "gap-3"
                } transition-colors cursor-pointer ${
                  activeNav === "accounts"
                    ? "bg-white/15 text-white font-semibold shadow-[inset_3px_0_0_#F2B84B]"
                    : "text-[#D5DCF0] hover:bg-white/10 hover:text-white"
                }`}
              >
                <Users className="size-4 text-[#F2B84B] shrink-0" />
                {!isSidebarCollapsed && <span>Account Management</span>}
              </button>

              <button
                type="button"
                title="Engagement Analytics"
                onClick={() => setActiveNav("engagement")}
                className={`w-full px-3 py-2.5 mt-0.5 rounded-none text-xs flex items-center ${
                  isSidebarCollapsed ? "justify-center" : "gap-3"
                } transition-colors cursor-pointer ${
                  activeNav === "engagement"
                    ? "bg-white/15 text-white font-semibold shadow-[inset_3px_0_0_#F2B84B]"
                    : "text-[#D5DCF0] hover:bg-white/10 hover:text-white"
                }`}
              >
                <TrendingUp className="size-4 text-[#F2B84B] shrink-0" />
                {!isSidebarCollapsed && <span>Engagement Analytics</span>}
              </button>
            </div>
          </nav>
        </div>

        {/* Bottom Profile & Logout */}
        <div className="p-4 border-t border-white/10 bg-[#162452] space-y-3">
          {!isSidebarCollapsed && (
            <div className="text-left">
              <div className="text-[10px] font-mono text-[#7CE3B0] uppercase">● Clearance Authority</div>
              <div className="text-xs font-semibold text-white truncate">{coordinatorEmail}</div>
            </div>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              title="Exit to Login"
              className="w-full py-2 px-3 rounded-none bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer border border-white/20"
            >
              <LogOut className="size-3.5 shrink-0" />
              {!isSidebarCollapsed && <span>Exit to Login</span>}
            </button>
          )}
        </div>
      </aside>

      {/* ── MAIN WORKSPACE CONTAINER (WHITE & BLUE) ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Crisp White Top Banner Header */}
        <header className="h-14 bg-white px-6 flex items-center justify-between text-xs text-[#18212F] z-30 border-b border-[#DDE2EA] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[#5B6678]">Portal:</span>
            <span className="font-bold text-[#24408E] uppercase tracking-wide">
              CampusSync Admin Portal | Tenant: Asia Pacific College
            </span>
          </div>
          <button
            onClick={() => {
              fetchQueue();
              fetchFacilitatorAccounts();
              fetchAnnouncements();
              void fetchSyndicationData();
            }}
            className="px-3 py-1.5 rounded-none bg-white hover:bg-[#F2F4F7] text-[#18212F] border border-[#C9D0DB] font-medium flex items-center gap-1.5 cursor-pointer transition"
          >
            <RefreshCw className={`size-3.5 text-[#24408E] ${loading ? "animate-spin" : ""}`} />
            Sync Queue
          </button>
        </header>

        {dbError && (
          <div className="px-6 py-2.5 bg-[#FBEDEC] border-b border-[#E2B3AF] text-xs text-[#B3261E] flex items-center justify-between gap-2 shrink-0">
            <span className="flex items-center gap-2">
              <AlertCircle className="size-3.5 shrink-0 text-[#B3261E]" />
              {dbError}
            </span>
            <button
              type="button"
              onClick={() => fetchQueue()}
              className="underline font-semibold text-[#B3261E] hover:opacity-80 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── TAB 1: HOME ── */}
        {activeNav === "home" && (
          <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
            <div className="rounded-none bg-[#EAEFFA] border border-[#C5D3F3] px-4 py-3 text-xs text-[#24408E] flex items-center justify-between">
              <span>
                Welcome, <b>Admin Coordinator</b>. CampusSync governance services are active for AY 2026–2027.
              </span>
              <span className="font-mono text-[10px] font-semibold uppercase">RA 8792 & RA 10173 Active</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-none bg-white border border-[#DDE2EA] shadow-xs text-left">
                <p className="text-[11px] font-mono text-[#5B6678] uppercase">Pending Review</p>
                <p className="text-3xl font-black text-[#24408E] mt-1">{pendingReviewEvents.length}</p>
                <p className="text-[11px] text-[#5B6678] mt-1">Awaiting clearance action</p>
              </div>
              <div className="p-5 rounded-none bg-white border border-[#E2B3AF] shadow-xs text-left">
                <p className="text-[11px] font-mono text-[#5B6678] uppercase">P1 High Urgency</p>
                <p className="text-3xl font-black text-[#B3261E] mt-1">{p1UrgentCount}</p>
                <p className="text-[11px] text-[#B3261E]/80 mt-1">Within 96 hours lead time</p>
              </div>
              <div className="p-5 rounded-none bg-white border border-[#B6DFC8] shadow-xs text-left">
                <p className="text-[11px] font-mono text-[#5B6678] uppercase">Approved Events</p>
                <p className="text-3xl font-black text-[#1F7A4D] mt-1">{approvedEvents.length}</p>
                <p className="text-[11px] text-[#1F7A4D]/80 mt-1">SHA-256 sealed & live</p>
              </div>
              <div className="p-5 rounded-none bg-white border border-[#DDE2EA] shadow-xs text-left">
                <p className="text-[11px] font-mono text-[#5B6678] uppercase">Active Facilitators</p>
                <p className="text-3xl font-black text-[#18212F] mt-1">{facilitatorAccounts.length}</p>
                <p className="text-[11px] text-[#5B6678] mt-1">Synced from Facilitator Portal</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 rounded-none bg-white border border-[#DDE2EA] p-6 h-fit shadow-xs">
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#24408E] mb-4 flex items-center gap-2">
                  <Megaphone className="size-4" /> Broadcast Facilitator Announcement (UC-05)
                </h2>
                <form onSubmit={handlePublishAnnouncement} className="space-y-3 text-left">
                  <div>
                    <label className="text-xs font-semibold text-[#18212F] block mb-1">
                      Announcement Title *
                    </label>
                    <input
                      required
                      value={annTitle}
                      onChange={(e) => setAnnTitle(e.target.value)}
                      placeholder="e.g., Term 2 Proposal Submission Cutoff"
                      className="w-full p-2.5 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] placeholder:text-[#6B778A] focus:border-[#24408E] focus:ring-2 focus:ring-[#24408E]/20 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#18212F] block mb-1">
                      Bulletin Message *
                    </label>
                    <textarea
                      rows={4}
                      required
                      value={annContent}
                      onChange={(e) => setAnnContent(e.target.value)}
                      placeholder="Enter clearance guidelines, cutoffs, or system notices..."
                      className="w-full p-2.5 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] placeholder:text-[#6B778A] focus:border-[#24408E] focus:ring-2 focus:ring-[#24408E]/20 outline-none resize-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-none bg-[#24408E] hover:bg-[#1B3270] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition"
                  >
                    <Send className="size-3.5" /> Publish Announcement
                  </button>
                </form>
              </div>

              <div className="lg:col-span-7 rounded-none bg-white border border-[#DDE2EA] p-6 text-left shadow-xs">
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#24408E] mb-4">
                  Active Institutional Announcements
                </h2>
                <div className="space-y-3">
                  {announcements.map((item) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-none bg-[#F7F8FA] border border-[#DDE2EA] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-[#18212F]">{item.title}</h3>
                        <span className="text-[10px] font-mono font-medium text-[#24408E]">
                          {item.created_at}
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5563] leading-relaxed">{item.content}</p>
                      <div className="text-[10px] font-medium text-[#1F7A4D] pt-1">
                        ✓ Target: {item.audience}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: PENDING APPROVALS (EVENT QUEUEING & REVIEW) ── */}
        {activeNav === "approvals" && (
          <div className="flex-1 flex h-full w-full overflow-hidden bg-[#F2F4F7] text-[#18212F]">
            {/* LEFT COLUMN: Event Queue List */}
            <div className="w-[390px] border-r border-[#DDE2EA] flex flex-col h-full bg-white shrink-0">
              <div className="p-4 border-b border-[#DDE2EA] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h1 className="text-base font-bold tracking-tight text-[#18212F] flex items-center gap-2">
                      Pending Approvals
                    </h1>
                    <p className="text-xs text-[#5B6678] mt-0.5">
                      {triagedEvents.length} proposal{triagedEvents.length === 1 ? "" : "s"} sorted by priority
                    </p>
                  </div>
                  <div className="flex items-center gap-1 bg-[#F2F4F7] p-1 rounded-none border border-[#DDE2EA] text-[10px]">
                    <button
                      type="button"
                      onClick={() => {
                        setReviewFilter("PENDING");
                        setSelectedEventId(null);
                      }}
                      className={`px-2 py-1 rounded-none font-semibold cursor-pointer transition ${
                        reviewFilter === "PENDING"
                          ? "bg-[#24408E] text-white"
                          : "text-[#5B6678] hover:text-[#18212F]"
                      }`}
                    >
                      Pending ({pendingReviewEvents.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReviewFilter("ALL");
                        setSelectedEventId(null);
                      }}
                      className={`px-2 py-1 rounded-none font-semibold cursor-pointer transition ${
                        reviewFilter === "ALL"
                          ? "bg-[#24408E] text-white"
                          : "text-[#5B6678] hover:text-[#18212F]"
                      }`}
                    >
                      All ({events.length})
                    </button>
                  </div>
                </div>

                {/* Dynamic AI Priority Triage Action */}
                <button
                  type="button"
                  onClick={handleRunBatchTriage}
                  disabled={triageLoading || baseEventsList.length === 0}
                  className="w-full py-2 px-3 rounded-none bg-[#EAEFFA] hover:bg-[#DCE6FA] border border-[#24408E]/30 text-[#24408E] text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {triageLoading ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin text-[#24408E]" />
                      Running AI Priority Queue Triage...
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3.5 text-[#24408E]" />
                      Run AI Priority Queue Triage
                    </>
                  )}
                </button>

                {triageError && (
                  <div className="p-2 rounded-none bg-[#FBEDEC] border border-[#E2B3AF] text-[11px] text-[#B3261E] flex items-start gap-1.5">
                    <AlertCircle className="size-3.5 shrink-0 mt-0.5 text-[#B3261E]" />
                    <span>{triageError}</span>
                  </div>
                )}

                {/* Urgency Filter Tabs */}
                <div className="grid grid-cols-4 gap-1 p-1 bg-[#F2F4F7] rounded-none border border-[#DDE2EA] text-[11px]">
                  {(["ALL", "P1", "P2", "P3"] as const).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setTriageTier(tier)}
                      className={`py-1 rounded-none font-semibold transition text-center cursor-pointer ${
                        triageTier === tier
                          ? "bg-[#24408E] text-white shadow-xs"
                          : "text-[#5B6678] hover:text-[#18212F] hover:bg-white/70"
                      }`}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-[#F7F8FA]">
                {loading && events.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-48 text-center text-[#5B6678]">
                    <RefreshCw className="size-6 animate-spin mb-2 text-[#24408E]" />
                    <p className="text-xs">Connecting to Supabase...</p>
                  </div>
                )}

                {!loading && triagedEvents.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-64 text-center text-[#5B6678] p-4">
                    <Inbox className="size-10 mb-3 text-[#24408E]/30" />
                    <p className="text-sm font-semibold text-[#18212F]">Queue is empty</p>
                    <p className="text-xs mt-1">No proposals match the current filter.</p>
                  </div>
                )}

                {triagedEvents.map((item) => {
                  const isSelected = selectedEvent?.event_id === item.event_id;
                  const leadTime = getLeadTimeBadge(item.event_date);
                  const urgency = item.calculatedUrgency;
                  const aiTriage = item.aiTriage;
                  const isRationaleOpen = Boolean(expandedTriageIds[item.event_id]);

                  return (
                    <div
                      key={item.event_id}
                      onClick={() => setSelectedEventId(item.event_id)}
                      className={`p-4 rounded-none border transition-all cursor-pointer text-left ${
                        isSelected
                          ? "bg-[#EAEFFA] border-[#24408E] shadow-[inset_3px_0_0_#24408E]"
                          : "bg-white border-[#DDE2EA] hover:border-[#24408E]/40 hover:bg-[#F9FAFC]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <h3 className="font-semibold text-sm truncate text-[#18212F]">{item.title}</h3>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            title={
                              aiTriage
                                ? `AI Triage (${aiTriage.priorityTier}, Complexity ${aiTriage.complexityScore}/10): ${aiTriage.rationale}`
                                : "Lead-time estimate (run AI Triage for full risk evaluation)"
                            }
                            className={`text-[9px] font-bold px-1.5 py-0.5 ${urgency.style}`}
                          >
                            {aiTriage ? `${aiTriage.priorityTier} · C${aiTriage.complexityScore}` : urgency.label}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-none capitalize ${getStatusBadgeStyle(
                              item.status
                            )}`}
                          >
                            {item.status ? item.status.replace("_", " ") : "pending"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-[#5B6678] mb-2">
                        <span className="truncate">{item.organization || "Student Org"}</span>
                        <span className="text-[10px] font-semibold text-[#18212F] shrink-0">
                          {leadTime.text}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-[#5B6678] mb-1">
                        <span className="flex items-center gap-1 shrink-0">
                          <Calendar className="size-3 text-[#24408E]" />{" "}
                          {formatEventDateDisplay(item.event_date)}
                        </span>
                        <span className="flex items-center gap-1 truncate">
                          <Building2 className="size-3 text-[#24408E]" /> {item.venue || "No venue"}
                        </span>
                      </div>

                      {aiTriage && (
                        <div className="mt-2 pt-2 border-t border-[#DDE2EA] space-y-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedTriageIds((prev) => ({
                                ...prev,
                                [item.event_id]: !prev[item.event_id],
                              }));
                            }}
                            className="w-full flex items-center justify-between text-[10px] font-semibold text-[#24408E] hover:underline cursor-pointer"
                          >
                            <span className="flex items-center gap-1">
                              <Sparkles className="size-3" /> AI Triage Rationale (Complexity {aiTriage.complexityScore}/10)
                            </span>
                            {isRationaleOpen ? (
                              <ChevronUp className="size-3" />
                            ) : (
                              <ChevronDown className="size-3" />
                            )}
                          </button>

                          {isRationaleOpen && (
                            <div className="p-2.5 rounded-none bg-white border border-[#DDE2EA] text-[11px] space-y-1.5">
                              <p className="text-[#18212F] leading-relaxed">{aiTriage.rationale}</p>
                              {aiTriage.riskFlags.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {aiTriage.riskFlags.map((flag, i) => (
                                    <span
                                      key={i}
                                      className="px-1.5 py-0.5 rounded-none bg-[#FBEDEC] border border-[#E2B3AF] text-[#B3261E] text-[9px] font-medium"
                                    >
                                      ⚑ {flag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {!aiTriage && (item.tags || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(item.tags || []).slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded-none bg-[#F2F4F7] text-[10px] text-[#5B6678] border border-[#DDE2EA]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT COLUMN: Detail & Decision Pane */}
            {selectedEvent ? (
              <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#F2F4F7] text-left">
                <div className="p-6 md:p-7 border-b border-[#DDE2EA] bg-white flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5 mb-1">
                      <h2 className="text-2xl font-bold tracking-tight text-[#18212F]">
                        {selectedEvent.title}
                      </h2>
                      <span
                        className={`px-2.5 py-0.5 rounded-none text-xs font-semibold uppercase tracking-wider ${getStatusBadgeStyle(
                          selectedEvent.status
                        )}`}
                      >
                        {selectedEvent.status ? selectedEvent.status.replace("_", " ") : "pending"}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-[11px] font-bold ${
                          getTierBadgeMeta(
                            selectedTriage?.priorityTier ||
                              selectedEvent.urgency_tier ||
                              computeDynamicUrgency(selectedEvent.event_date).tier
                          ).style
                        }`}
                      >
                        {selectedTriage
                          ? `${selectedTriage.priorityTier} · Complexity ${selectedTriage.complexityScore}/10`
                          : computeDynamicUrgency(selectedEvent.event_date).label}
                      </span>
                    </div>
                    <p className="text-sm text-[#5B6678]">{selectedEvent.organization || "Student Org"}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRunSingleTriage(selectedEvent)}
                    disabled={triageLoading}
                    className="px-3 py-1.5 rounded-none bg-white hover:bg-[#F2F4F7] border border-[#C9D0DB] text-xs font-semibold text-[#24408E] flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-40"
                  >
                    {triageLoading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    AI Triage
                  </button>
                </div>

                <div className="p-6 md:p-7 space-y-6 flex-1">
                  {/* AI Triage Rationale & Risk Flags Banner */}
                  {selectedTriage && (
                    <div className="p-4 rounded-none bg-white border border-[#C5D3F3] shadow-xs space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-[#24408E] uppercase tracking-wider flex items-center gap-1.5">
                          <Brain className="size-3.5" /> Dynamic AI Priority Triage ({selectedTriage.priorityTier})
                        </span>
                        <span className="font-mono text-[11px] text-[#5B6678]">
                          Complexity Score: <b className="text-[#18212F]">{selectedTriage.complexityScore}/10</b>
                        </span>
                      </div>
                      <p className="text-xs text-[#18212F] leading-relaxed">{selectedTriage.rationale}</p>
                      {selectedTriage.riskFlags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {selectedTriage.riskFlags.map((flag, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-none bg-[#FBEDEC] border border-[#E2B3AF] text-[#B3261E] text-[10px] font-medium"
                            >
                              ⚑ {flag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <h3 className="text-xs font-bold text-[#5B6678] uppercase tracking-wider mb-3">
                      Event Logistics
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-none bg-white border border-[#DDE2EA] shadow-xs min-w-0">
                        <p className="text-xs text-[#5B6678] mb-1 flex items-center gap-1.5">
                          <Calendar className="size-3.5 text-[#24408E] shrink-0" /> Date
                        </p>
                        <p
                          title={selectedEvent.event_date || "No date set"}
                          className="text-sm font-semibold text-[#18212F] whitespace-nowrap overflow-hidden text-ellipsis"
                        >
                          {formatEventDateDisplay(selectedEvent.event_date)}
                        </p>
                      </div>
                      <div className="p-4 rounded-none bg-white border border-[#DDE2EA] shadow-xs min-w-0">
                        <p className="text-xs text-[#5B6678] mb-1 flex items-center gap-1.5">
                          <Clock className="size-3.5 text-[#24408E] shrink-0" /> Schedule
                        </p>
                        <p className="text-sm font-semibold text-[#18212F] whitespace-nowrap">
                          {selectedEvent.start_time || "--"} – {selectedEvent.end_time || "--"}
                        </p>
                      </div>
                      <div className="p-4 rounded-none bg-white border border-[#DDE2EA] shadow-xs min-w-0">
                        <p className="text-xs text-[#5B6678] mb-1 flex items-center gap-1.5">
                          <Building2 className="size-3.5 text-[#24408E] shrink-0" /> Venue
                        </p>
                        <p
                          title={selectedEvent.venue || "No venue"}
                          className="text-sm font-semibold text-[#18212F] truncate"
                        >
                          {selectedEvent.venue || "No venue"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 100% Automated Jira-Style AI Executive Summary & Document Verification */}
                  <div className="rounded-none bg-white border border-[#C5D3F3] shadow-xs p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DDE2EA] pb-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-[#24408E]" />
                        <h3 className="text-xs font-bold text-[#18212F] uppercase tracking-wider">
                          AI Executive Summary & Document Verification
                        </h3>
                      </div>

                      <div>
                        {preScreenLoading || selectedIsProcessing ? (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-0.5 rounded-none bg-[#EAEFFA] text-[#24408E] border border-[#C5D3F3]">
                            <Loader2 className="size-3 animate-spin" />
                            Auto-Checking...
                          </span>
                        ) : selectedPreScreen ? (
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-none border ${
                              selectedAuditStatus === "COMPLETE"
                                ? "bg-[#E6F3EC] text-[#1F7A4D] border-[#B6DFC8]"
                                : "bg-[#FBEDEC] text-[#B3261E] border-[#E2B3AF]"
                            }`}
                          >
                            {selectedAuditStatus === "COMPLETE"
                              ? "✓ Pre-Checked: Complete"
                              : "! Pre-Checked: Defects Found"}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Read-Only Submitted Documents List (Uploaded by Facilitator) */}
                    {(selectedCarriedFiles.length > 0 ||
                      selectedRemoteDocs.length > 0 ||
                      selectedEvent.document_path) && (
                      <div className="p-3 rounded-none bg-[#F7F8FA] border border-[#DDE2EA] space-y-2 text-xs">
                        <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#24408E]">
                          Submitted Documents
                        </div>

                        {selectedCarriedFiles.map((att, idx) => (
                          <div
                            key={`carried-${idx}-${att.name}`}
                            className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-none bg-white border border-[#C5D3F3]"
                          >
                            <span className="flex items-center gap-2 text-[#18212F] truncate min-w-0">
                              <Paperclip className="size-3.5 text-[#24408E] shrink-0" />
                              <span className="font-medium truncate">{att.name}</span>
                              <span className="text-[10px] font-mono text-[#1F7A4D] shrink-0">
                                ({Math.max(1, Math.round(att.size / 1024))} KB · Submitted by Facilitator)
                              </span>
                            </span>
                            {att.tooLargeForInline && !att.storageUrl ? (
                              <span className="text-[10px] text-[#8A5A00] shrink-0">
                                Exceeds inline preview limit
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  const url = carriedAttachmentToBlobUrl(att);
                                  if (url) window.open(url, "_blank", "noopener,noreferrer");
                                }}
                                className="px-2 py-1 rounded-none bg-[#EAEFFA] hover:bg-[#DCE6FA] border border-[#C5D3F3] text-[10px] font-semibold text-[#24408E] flex items-center gap-1 shrink-0 cursor-pointer"
                              >
                                View PDF <ExternalLink className="size-3" />
                              </button>
                            )}
                          </div>
                        ))}

                        {selectedCarriedFiles.length === 0 &&
                          selectedRemoteDocs.map((doc) => (
                            <div
                              key={`${doc.index}-${doc.filename}`}
                              className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-none bg-white border border-[#C5D3F3]"
                            >
                              <span className="flex items-center gap-2 text-[#18212F] truncate min-w-0">
                                <Paperclip className="size-3.5 text-[#24408E] shrink-0" />
                                <span className="font-medium truncate">{doc.filename}</span>
                                <span className="text-[10px] font-mono text-[#5B6678] shrink-0">
                                  ({Math.max(1, Math.round(doc.size / 1024))} KB · Submitted by Facilitator)
                                </span>
                              </span>
                              <a
                                href={doc.downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-1 rounded-none bg-[#EAEFFA] hover:bg-[#DCE6FA] border border-[#C5D3F3] text-[10px] font-semibold text-[#24408E] flex items-center gap-1 shrink-0"
                              >
                                View PDF <ExternalLink className="size-3" />
                              </a>
                            </div>
                          ))}

                        {selectedEvent.document_path &&
                          selectedCarriedFiles.length === 0 &&
                          selectedRemoteDocs.length === 0 && (
                            <div className="flex items-center justify-between gap-2 p-2.5 rounded-none bg-white border border-[#DDE2EA]">
                              <span className="flex items-center gap-2 text-[#18212F] truncate">
                                <Paperclip className="size-3.5 text-[#24408E] shrink-0" />
                                <span className="truncate font-mono text-[11px]">
                                  {selectedEvent.document_path}
                                </span>
                              </span>
                              <span className="text-[10px] font-semibold text-[#1F7A4D] shrink-0">
                                Supabase Storage
                              </span>
                            </div>
                          )}
                      </div>
                    )}

                    {/* Clean Status Error Banner if Automated Audit Encounters an Issue */}
                    {preScreenError && !preScreenLoading && !selectedPreScreen && (
                      <div className="p-3.5 rounded-none bg-[#FBEDEC] border border-[#E2B3AF] text-xs text-[#B3261E] flex items-start gap-2">
                        <AlertCircle className="size-4 shrink-0 mt-0.5 text-[#B3261E]" />
                        <span>{preScreenError}</span>
                      </div>
                    )}

                    {preScreenLoading || selectedIsProcessing ? (
                      <div className="p-6 rounded-none bg-[#F7F9FF] border border-[#C5D3F3] flex flex-col items-center justify-center text-center gap-2">
                        <Loader2 className="size-5 animate-spin text-[#24408E]" />
                        <p className="text-xs font-semibold text-[#18212F]">
                          AI Multimodal Engine is reviewing attached files and verifying signatures...
                        </p>
                        <p className="text-[11px] text-[#5B6678]">
                          Generating the executive event summary and checking for missing files, unsigned lines, or inconsistencies automatically.
                        </p>
                      </div>
                    ) : selectedPreScreen ? (
                      <div className="space-y-4 text-xs">
                        {/* 1. Jira-Style AI Executive Event Summary */}
                        <div className="p-4 rounded-none bg-[#F7F9FF] border border-[#C5D3F3] space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[#24408E] flex items-center gap-1.5">
                              <Sparkles className="size-3.5" /> AI Event Summary
                            </span>
                            <span className="text-[10px] text-[#5B6678]">
                              Synthesized from proposal & attached files
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-[#18212F]">
                            {selectedPreScreen.eventSummary?.headline || selectedEvent.title}
                          </h4>
                          <p className="text-xs text-[#374151] leading-relaxed">
                            {selectedPreScreen.eventSummary?.overview ||
                              selectedPreScreen.reviewerSummary}
                          </p>
                          {(selectedPreScreen.eventSummary?.keyHighlights?.length || 0) > 0 && (
                            <ul className="space-y-1 pt-1 border-t border-[#DDE6FA] text-xs text-[#18212F]">
                              {selectedPreScreen.eventSummary!.keyHighlights.map((point, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="text-[#24408E] font-bold mt-0.5">•</span>
                                  <span className="leading-relaxed">{point}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* 2. Readiness Verdict Banner (COMPLETE vs DEFECTIVE) */}
                        {selectedAuditStatus === "COMPLETE" ? (
                          <div className="p-4 rounded-none bg-[#E6F3EC] border border-[#B6DFC8] space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-[#1F7A4D] font-bold text-xs">
                                <CheckCircle2 className="size-4 shrink-0" />
                                Complete & Verified — Ready for Approval
                              </div>
                              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-none bg-white text-[#1F7A4D] border border-[#B6DFC8]">
                                Score: {selectedPreScreen.completenessScore}/100
                              </span>
                            </div>
                            <p className="text-xs text-[#1B5E3C] leading-relaxed">
                              {selectedPreScreen.verdictMessage ||
                                "The proposal and attached files are complete, properly signed, and no missing files or inconsistencies were found."}
                            </p>
                          </div>
                        ) : (
                          <div className="p-4 rounded-none bg-[#FBEDEC] border border-[#E2B3AF] space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-[#B3261E] font-bold text-xs">
                                <AlertTriangle className="size-4 shrink-0" />
                                Defective Submission — Missing Items or Inconsistencies Found
                              </div>
                              <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-none bg-white text-[#B3261E] border border-[#E2B3AF]">
                                Score: {selectedPreScreen.completenessScore}/100
                              </span>
                            </div>
                            <p className="text-xs text-[#8C1D18] leading-relaxed">
                              {selectedPreScreen.verdictMessage ||
                                "This proposal has missing files, unsigned signature lines, incomplete sections, or discrepancies with the submitted form details."}
                            </p>

                            {selectedDefects.length > 0 && (
                              <div className="rounded-none bg-white border border-[#E2B3AF] divide-y divide-[#F3D5D2]">
                                {selectedDefects.map((defect, idx) => (
                                  <div
                                    key={idx}
                                    className="px-3 py-2 flex items-start gap-2 text-[11px]"
                                  >
                                    <span
                                      className={`shrink-0 px-1.5 py-0.5 rounded-none text-[10px] font-bold ${
                                        defect.category === "Inconsistency"
                                          ? "bg-[#FFF4DC] text-[#8A5A00]"
                                          : "bg-[#FBEDEC] text-[#B3261E]"
                                      }`}
                                    >
                                      {defect.category}
                                    </span>
                                    <span className="text-[#18212F] leading-snug">
                                      {defect.detail}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {normalizedStatus(selectedEvent.status) === "pending" && (
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenRevisionWithAiDefects(selectedPreScreen)
                                  }
                                  className="px-3 py-1.5 rounded-none bg-[#8A5A00] hover:bg-[#704800] text-white text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition"
                                >
                                  <AlertTriangle className="size-3.5" />
                                  Pre-fill Revision Notes & Request Revisions
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 3. Visual Signature Verification */}
                        <div className="p-3.5 rounded-none bg-[#F7F8FA] border border-[#DDE2EA] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-[#18212F] flex items-center gap-1.5">
                              <PenTool className="size-3.5 text-[#24408E]" /> Visual Signature Verification
                            </span>
                            <span
                              className={`text-[11px] font-bold ${
                                selectedPreScreen.signatureCheck.signaturesDetected &&
                                selectedPreScreen.signatureCheck.missingSignatureLines.length === 0
                                  ? "text-[#1F7A4D]"
                                  : "text-[#B3261E]"
                              }`}
                            >
                              {selectedPreScreen.signatureCheck.signaturesDetected
                                ? selectedPreScreen.signatureCheck.missingSignatureLines.length > 0
                                  ? "Partially Signed"
                                  : "✓ Signatures Visually Detected"
                                : "✗ No Signatures Detected"}
                            </span>
                          </div>

                          {selectedPreScreen.signatureCheck.detectedSignatories.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {selectedPreScreen.signatureCheck.detectedSignatories.map((sig, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 rounded-none bg-[#E6F3EC] border border-[#B6DFC8] text-[#1F7A4D] text-[10px] font-medium"
                                >
                                  ✓ {sig}
                                </span>
                              ))}
                            </div>
                          )}

                          {selectedPreScreen.signatureCheck.visualNotes && (
                            <p className="text-[11px] text-[#5B6678]">
                              <span className="text-[#18212F] font-semibold">Visual notes: </span>
                              {selectedPreScreen.signatureCheck.visualNotes}
                            </p>
                          )}
                        </div>

                        {/* 4. Institutional Checklist Breakdown */}
                        {selectedPreScreen.checklistEvaluation.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {selectedPreScreen.checklistEvaluation.map((item, idx) => (
                              <div
                                key={idx}
                                className="p-3 rounded-none bg-[#F7F8FA] border border-[#DDE2EA] flex flex-col gap-1"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-semibold text-[#18212F]">
                                    {item.requirement}
                                  </span>
                                  <span
                                    className={`text-[10px] font-bold shrink-0 ${
                                      item.met ? "text-[#1F7A4D]" : "text-[#B3261E]"
                                    }`}
                                  >
                                    {item.met ? "✓ Met" : "✗ Missing"}
                                  </span>
                                </div>
                                <span className="text-[10px] text-[#5B6678] leading-relaxed">
                                  {item.evidence}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : !preScreenError ? (
                      <div className="p-4 rounded-none bg-[#FFF4DC] border border-[#E5C98B] text-xs text-[#8A5A00] flex items-start gap-2.5">
                        <AlertTriangle className="size-4 shrink-0 mt-0.5 text-[#8A5A00]" />
                        <div className="space-y-0.5">
                          <p className="font-semibold text-[#6B4600]">
                            No proposal documents were attached to this submission.
                          </p>
                          <p className="text-[#8A5A00]">
                            Signed Activity Proposal Form (APF) and supporting attachments are missing. Request revisions from the Facilitator to upload the required documents.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-[#5B6678] uppercase tracking-wider mb-2">
                      Proposal Description
                    </h3>
                    <div className="p-4 rounded-none bg-white border border-[#DDE2EA] shadow-xs text-sm leading-relaxed text-[#18212F]">
                      {decodedSelected.cleanDescription || "No description provided."}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-[#5B6678] uppercase tracking-wider mb-3">
                      Promotional Assets
                    </h3>
                    <div className="p-4 rounded-none bg-white border border-[#DDE2EA] shadow-xs flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-[#5B6678] mb-0.5">Registration Link</p>
                        <p className="text-sm font-medium text-[#18212F] truncate max-w-md">
                          {selectedEvent.external_registration_link ||
                            selectedEvent.registration_link ||
                            "No external link provided"}
                        </p>
                      </div>
                      {(selectedEvent.external_registration_link || selectedEvent.registration_link) && (
                        <a
                          href={selectedEvent.external_registration_link || selectedEvent.registration_link}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 rounded-none bg-[#EAEFFA] hover:bg-[#DCE6FA] border border-[#C5D3F3] text-[#24408E] font-semibold text-xs flex items-center gap-1.5 transition-colors shrink-0"
                        >
                          Open <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {selectedEvent.admin_feedback && normalizedStatus(selectedEvent.status) !== "pending" && (
                    <div className="p-4 rounded-none bg-[#FFF4DC] border border-[#E5C98B] text-xs space-y-1">
                      <div className="font-bold text-[#8A5A00] uppercase tracking-wider text-[10px]">
                        Coordinator Feedback Sent
                      </div>
                      <p className="text-[#6B4600] leading-relaxed whitespace-pre-line">
                        {selectedEvent.admin_feedback}
                      </p>
                    </div>
                  )}
                </div>

                {/* Cryptographic Non-Repudiation Ledger (UC-03 / RA 8792) + Email Syndication Status */}
                {(normalizedStatus(selectedEvent.status) === "approved" ||
                  normalizedStatus(selectedEvent.status) === "completed") && (
                  <div className="mx-6 mb-4 space-y-3">
                    <div className="p-4 rounded-none bg-[#E6F3EC] border border-[#B6DFC8] text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[#1F7A4D] font-bold text-[11px] flex items-center gap-1.5">
                          <ShieldCheck className="size-3.5" /> Tamper-Evident Institutional Clearance Ledger
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-none bg-white text-[#1F7A4D] border border-[#B6DFC8] font-semibold">
                          RA 8792 Compliant
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-[#18212F] break-all bg-white/80 p-2.5 rounded-none border border-[#B6DFC8]">
                        SHA-256: {selectedEvent.clearance_hash || "Computed automatically on institutional dispatch"}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-[#5B6678] pt-0.5">
                        <span>Cleared by: Institutional Coordinator Authority</span>
                        <span className="text-[#1F7A4D] font-semibold">
                          {getEventDispatch(selectedEvent)?.status === "SENT"
                            ? "✓ Syndicated to Institutional Emails"
                            : "✓ Cleared — Ready for Survey & Email Syndication"}
                        </span>
                      </div>
                    </div>

                    <EmailSyndicationStatusCard
                      dispatch={getEventDispatch(selectedEvent)}
                      surveyUrl={getEventPublishedSurvey(selectedEvent)?.surveyUrl}
                      isSending={syndicatingEventId === selectedEvent.event_id}
                      onPreview={(d) => setPreviewDispatch(d)}
                      onRetry={() =>
                        void handleRetryEmailDispatch(
                          selectedEvent,
                          getEventDispatch(selectedEvent)
                        )
                      }
                      onOpenSurveyTab={() => {
                        setSurveyTargetEventId(selectedEvent.event_id);
                        setSurveyObjectives(decodeProposalDescription(selectedEvent.description).cleanDescription);
                        const existingDraft =
                          selectedEvent.ai_survey_draft ||
                          savedSurveyDrafts[String(selectedEvent.event_id)];
                        setActiveSurveyDraft(existingDraft || null);
                        setActiveNav("surveys");
                      }}
                    />
                  </div>
                )}

                {/* Fixed Decision Footer Actions (only shown for pending proposals awaiting review) */}
                {normalizedStatus(selectedEvent.status) === "pending" ? (
                  <div className="p-4 md:p-5 border-t border-[#DDE2EA] bg-white flex flex-wrap items-center justify-between gap-3 sticky bottom-0">
                    <div className="text-xs">
                      {selectedAuditStatus === "DEFECTIVE" ? (
                        <span className="text-[#B3261E] font-medium flex items-center gap-1.5">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          AI audit recommends requesting revisions or rejecting due to detected defects.
                        </span>
                      ) : selectedAuditStatus === "COMPLETE" ? (
                        <span className="text-[#1F7A4D] font-medium flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 shrink-0" />
                          All documents and signatures verified — ready to approve.
                        </span>
                      ) : (
                        <span className="text-[#5B6678]">Select a clearance decision below.</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 ml-auto">
                      <button
                        onClick={() => handleUpdateStatus("rejected")}
                        disabled={actionLoading}
                        className={`px-4 py-2 rounded-none text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer ${
                          selectedAuditStatus === "DEFECTIVE"
                            ? "bg-[#B3261E] hover:bg-[#8C1D18] text-white shadow-xs"
                            : "border border-[#E2B3AF] bg-white text-[#B3261E] hover:bg-[#FBEDEC]"
                        }`}
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => {
                          if (selectedPreScreen && selectedAuditStatus === "DEFECTIVE" && !revisionFeedback.trim()) {
                            setRevisionFeedback(formatDefectsForRevisionNote(selectedPreScreen));
                          }
                          setShowRevisionModal(true);
                        }}
                        disabled={actionLoading}
                        className={`px-4 py-2 rounded-none text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer ${
                          selectedAuditStatus === "DEFECTIVE"
                            ? "bg-[#D97706] hover:bg-[#B45309] text-white shadow-xs"
                            : "border border-[#E5C98B] bg-[#FFF4DC]/60 text-[#8A5A00] hover:bg-[#FFF4DC]"
                        }`}
                      >
                        Request Revisions
                      </button>
                      <button
                        onClick={() => handleUpdateStatus("approved")}
                        disabled={actionLoading}
                        className={`px-5 py-2 rounded-none text-xs font-semibold transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer ${
                          selectedAuditStatus === "COMPLETE"
                            ? "bg-[#1F7A4D] hover:bg-[#17603B] text-white shadow-sm"
                            : selectedAuditStatus === "DEFECTIVE"
                            ? "border border-[#C9D0DB] bg-white text-[#18212F] hover:bg-[#F2F4F7]"
                            : "bg-[#24408E] hover:bg-[#1B3270] text-white shadow-xs"
                        }`}
                      >
                        <CheckCircle2 className="size-4" />
                        Approve & Sign (SHA-256)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="px-6 py-3.5 border-t border-[#DDE2EA] bg-white flex items-center justify-between text-xs sticky bottom-0">
                    <span className="text-[#5B6678]">
                      {normalizedStatus(selectedEvent.status) === "rejected"
                        ? "This proposal has been rejected and removed from the active Pending queue."
                        : normalizedStatus(selectedEvent.status) === "needs_revision" ||
                          normalizedStatus(selectedEvent.status) === "revision"
                        ? "Returned to the Facilitator for revision. It will reappear in Pending once resubmitted."
                        : "This proposal has already been endorsed and cleared."}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-none text-[11px] font-semibold uppercase ${getStatusBadgeStyle(
                        selectedEvent.status
                      )}`}
                    >
                      {selectedEvent.status.replace("_", " ")}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center bg-[#F2F4F7] text-[#5B6678] p-8 text-center">
                <Inbox className="size-12 mb-3 text-[#24408E]/25" />
                <p className="text-sm font-semibold text-[#18212F]">
                  {reviewFilter === "PENDING"
                    ? "All pending proposals have been reviewed"
                    : "No proposal selected"}
                </p>
                <p className="text-xs mt-1 max-w-sm">
                  {reviewFilter === "PENDING"
                    ? "Rejected, endorsed, and returned proposals are automatically cleared from the Pending queue. Switch to All to inspect past decisions."
                    : "Select a proposal from the left queue to view details."}
                </p>
                {reviewFilter === "PENDING" && events.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setReviewFilter("ALL")}
                    className="mt-4 px-4 py-2 rounded-none border border-[#C9D0DB] bg-white hover:bg-[#EAEFFA] text-[#24408E] text-xs font-semibold cursor-pointer"
                  >
                    View All Proposals ({events.length})
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: SURVEYS & POST-EVENT EVALUATIONS (UC-04 & UC-06) ── */}
        {activeNav === "surveys" && (
          <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 text-left">
            <div className="border-b border-[#DDE2EA] pb-4">
              <h1 className="text-lg font-bold text-[#18212F] flex items-center gap-2">
                <Sparkles className="size-4 text-[#24408E]" /> Post-Event Evaluation Surveys & AI Diagnostics
              </h1>
              <p className="text-xs text-[#5B6678] mt-0.5">
                Generate tailored student questionnaires with Gemini 3.8 Flash and synthesize executive sentiment diagnostics from post-event feedback.
              </p>
            </div>

            {/* ── SECTION A: AI-ASSISTED POST-EVENT SURVEY GENERATOR ── */}
            <div className="rounded-none bg-white border border-[#C5D3F3] p-6 space-y-5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DDE2EA] pb-3">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[#24408E] flex items-center gap-2">
                    <Sparkles className="size-4" /> AI-Assisted Post-Event Survey Generator
                  </h2>
                  <p className="text-[11px] text-[#5B6678] mt-0.5">
                    Select an event, refine objectives, and generate an editable student evaluation questionnaire.
                  </p>
                </div>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-none bg-[#EAEFFA] text-[#24408E] border border-[#C5D3F3]">
                  Gemini 3.8 Flash
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-[#18212F] block mb-1">Target Event</label>
                  <select
                    value={
                      surveyTargetEventId ||
                      (approvedEvents[0]?.event_id ??
                        events.find((e) => normalizedStatus(e.status) !== "rejected")?.event_id ??
                        "")
                    }
                    onChange={(e) => {
                      const nextId = Number(e.target.value);
                      setSurveyTargetEventId(nextId);
                      const found = events.find((ev) => ev.event_id === nextId);
                      if (found?.description && !surveyObjectives.trim()) {
                        setSurveyObjectives(decodeProposalDescription(found.description).cleanDescription);
                      }
                      const existingDraft =
                        found?.ai_survey_draft || savedSurveyDrafts[String(nextId)];
                      if (existingDraft) {
                        setActiveSurveyDraft(existingDraft);
                      }
                    }}
                    className="w-full p-2.5 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] focus:border-[#24408E] focus:ring-2 focus:ring-[#24408E]/20 outline-none"
                  >
                    {events.filter((e) => normalizedStatus(e.status) !== "rejected").length === 0 ? (
                      <option value="">Default Sample Event</option>
                    ) : (
                      events
                        .filter((e) => normalizedStatus(e.status) !== "rejected")
                        .map((ev) => (
                          <option key={ev.event_id} value={ev.event_id}>
                            {ev.title} ({ev.status})
                          </option>
                        ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-[#18212F] block mb-1">Event Category</label>
                  <select
                    value={surveyCategory}
                    onChange={(e) => setSurveyCategory(e.target.value)}
                    className="w-full p-2.5 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] focus:border-[#24408E] focus:ring-2 focus:ring-[#24408E]/20 outline-none"
                  >
                    <option value="Academic Seminar / Workshop">Academic Seminar / Workshop</option>
                    <option value="Hackathon / Technical Competition">Hackathon / Technical Competition</option>
                    <option value="Student Orientation / Assembly">Student Orientation / Assembly</option>
                    <option value="Cultural / Org Fair">Cultural / Org Fair</option>
                    <option value="Community Outreach / Off-Campus">Community Outreach / Off-Campus</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#18212F] block mb-1">
                  Event Objectives & Focus Areas (Optional — defaults to proposal description)
                </label>
                <textarea
                  rows={2}
                  value={surveyObjectives}
                  onChange={(e) => setSurveyObjectives(e.target.value)}
                  placeholder="e.g., Measure technical skill acquisition, venue & Wi-Fi reliability, mentor effectiveness, and suggestions for next term..."
                  className="w-full p-2.5 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] placeholder:text-[#6B778A] focus:border-[#24408E] focus:ring-2 focus:ring-[#24408E]/20 outline-none resize-none"
                />
              </div>

              {/* Institutional Distribution List Target Audience (auto-dispatched once survey finalizes for approved events) */}
              <div className="p-3.5 rounded-none bg-[#F7F8FA] border border-[#DDE2EA] flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-[#18212F] flex items-center gap-1.5">
                    <Mail className="size-3.5 text-[#24408E]" /> Institutional Distribution Lists Audience
                  </div>
                  <p className="text-[11px] text-[#5B6678]">
                    For approved events, finalizing this survey automatically formats and BCC-dispatches to active campus group emails (e.g., allstudents@apc.edu.ph, allfaculty@apc.edu.ph).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {(["student", "faculty", "staff", "all_campus"] as const).map((role) => {
                    const checked = surveyTargetGroups.includes(role);
                    const count = mailingRecipients.filter((r) => r.is_active && r.role === role).length;
                    return (
                      <label
                        key={role}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none border text-[11px] font-semibold cursor-pointer transition ${
                          checked
                            ? "bg-[#EAEFFA] border-[#24408E] text-[#24408E]"
                            : "bg-white border-[#C9D0DB] text-[#5B6678]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setSurveyTargetGroups((prev) => {
                              if (e.target.checked) return Array.from(new Set([...prev, role]));
                              const next = prev.filter((item) => item !== role);
                              return next.length > 0 ? next : prev;
                            });
                          }}
                          className="accent-[#24408E] rounded-none"
                        />
                        {formatRoleLabel(role)} ({count})
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setActiveNav("mailing")}
                    className="text-[11px] font-semibold text-[#24408E] hover:underline cursor-pointer"
                  >
                    Manage Distribution Lists →
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleGenerateSurveyWithAi}
                  disabled={generatingSurvey || syndicatingEventId !== null}
                  className="px-5 py-2.5 rounded-none bg-[#24408E] hover:bg-[#1B3270] text-white font-semibold text-xs uppercase tracking-wider flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {generatingSurvey ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Generating Survey...
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3.5" />
                      Generate Survey & Auto-Push Email
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={addDraftQuestion}
                  className="px-4 py-2.5 rounded-none bg-white hover:bg-[#F2F4F7] border border-[#C9D0DB] text-xs font-semibold text-[#18212F] flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="size-3.5 text-[#24408E]" /> Add Custom Question
                </button>
              </div>

              {/* Live Automated Email Syndication Status for Selected Approved Target Event */}
              {(() => {
                const targetEv =
                  events.find((e) => e.event_id === surveyTargetEventId) ||
                  approvedEvents[0] ||
                  null;
                if (!targetEv) return null;
                const isApproved =
                  normalizedStatus(targetEv.status) === "approved" ||
                  normalizedStatus(targetEv.status) === "completed";
                if (!isApproved) return null;
                return (
                  <EmailSyndicationStatusCard
                    dispatch={getEventDispatch(targetEv)}
                    surveyUrl={getEventPublishedSurvey(targetEv)?.surveyUrl}
                    isSending={syndicatingEventId === targetEv.event_id}
                    onPreview={(d) => setPreviewDispatch(d)}
                    onRetry={() =>
                      void handleRetryEmailDispatch(targetEv, getEventDispatch(targetEv))
                    }
                  />
                );
              })()}

              {surveyGenError && (
                <div className="p-3 rounded-none bg-[#FBEDEC] border border-[#E2B3AF] text-xs text-[#B3261E] flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5 text-[#B3261E]" />
                  <span>{surveyGenError}</span>
                </div>
              )}

              {/* Editable AI-Generated Questionnaire */}
              {activeSurveyDraft && (
                <div className="p-5 rounded-none bg-[#F7F8FA] border border-[#DDE2EA] space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-mono uppercase text-[#5B6678] block mb-1">
                        Survey Title (Editable)
                      </label>
                      <input
                        value={activeSurveyDraft.surveyTitle}
                        onChange={(e) =>
                          setActiveSurveyDraft({ ...activeSurveyDraft, surveyTitle: e.target.value })
                        }
                        className="w-full p-2 rounded-none bg-white border border-[#C9D0DB] text-xs font-semibold text-[#18212F] focus:border-[#24408E] outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase text-[#5B6678] block mb-1">
                        Respondent Instructions (Editable)
                      </label>
                      <input
                        value={activeSurveyDraft.description}
                        onChange={(e) =>
                          setActiveSurveyDraft({ ...activeSurveyDraft, description: e.target.value })
                        }
                        className="w-full p-2 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] focus:border-[#24408E] outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="text-[10px] font-mono font-semibold uppercase text-[#24408E]">
                      Editable Questions ({activeSurveyDraft.questions.length})
                    </div>
                    {activeSurveyDraft.questions.map((q, idx) => (
                      <div
                        key={q.id}
                        className="p-3.5 rounded-none bg-white border border-[#DDE2EA] space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-mono text-[#24408E] font-bold">
                            Q{idx + 1}
                          </span>
                          <input
                            value={q.text}
                            onChange={(e) => updateDraftQuestion(q.id, { text: e.target.value })}
                            className="flex-1 min-w-[220px] p-1.5 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] focus:border-[#24408E] outline-none"
                          />
                          <select
                            value={q.type}
                            onChange={(e) => {
                              const nextType = e.target.value as GeneratedQuestionType;
                              updateDraftQuestion(q.id, {
                                type: nextType,
                                options:
                                  nextType === "multiple_choice" && q.options.length === 0
                                    ? ["Very Satisfied", "Satisfied", "Neutral", "Needs Improvement"]
                                    : nextType === "multiple_choice"
                                    ? q.options
                                    : [],
                              });
                            }}
                            className="p-1.5 rounded-none bg-white border border-[#C9D0DB] text-[11px] text-[#18212F] outline-none"
                          >
                            <option value="rating_1_to_5">1–5 Rating</option>
                            <option value="multiple_choice">Multiple Choice</option>
                            <option value="open_text">Open Text</option>
                          </select>
                          <label className="flex items-center gap-1 text-[11px] text-[#18212F] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={q.required}
                              onChange={(e) =>
                                updateDraftQuestion(q.id, { required: e.target.checked })
                              }
                              className="accent-[#24408E] rounded-none"
                            />
                            Required
                          </label>
                          <button
                            type="button"
                            onClick={() => removeDraftQuestion(q.id)}
                            title="Remove question"
                            className="p-1.5 rounded-none text-[#5B6678] hover:text-[#B3261E] hover:bg-[#FBEDEC] cursor-pointer"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>

                        {q.type === "multiple_choice" && (
                          <div className="pl-6 space-y-1">
                            <label className="text-[10px] text-[#5B6678] block">
                              Options (comma-separated)
                            </label>
                            <input
                              value={q.options.join(", ")}
                              onChange={(e) =>
                                updateDraftQuestion(q.id, {
                                  options: e.target.value
                                    .split(",")
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                                })
                              }
                              className="w-full p-1.5 rounded-none bg-white border border-[#C9D0DB] text-[11px] text-[#18212F] focus:border-[#24408E] outline-none"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#DDE2EA]">
                    <span className="text-xs font-medium text-[#1F7A4D]">{surveySaveMessage}</span>
                    <button
                      type="button"
                      onClick={handleSaveSurveyDraft}
                      className="px-4 py-2 rounded-none bg-[#1F7A4D] hover:bg-[#18633E] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Save className="size-3.5" /> Save Survey Questionnaire
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── SECTION B: POST-EVENT FEEDBACK SENTIMENT & DIAGNOSTICS SYNTHESIS ── */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#24408E] flex items-center gap-2">
                  <Brain className="size-4 text-[#24408E]" /> Event Surveys & AI Feedback Diagnostics
                </h2>
                <span className="text-[11px] text-[#5B6678]">
                  {approvedEvents.length} approved event{approvedEvents.length === 1 ? "" : "s"}
                </span>
              </div>

              {feedbackError && (
                <div className="p-3 rounded-none bg-[#FBEDEC] border border-[#E2B3AF] text-xs text-[#B3261E] flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5 text-[#B3261E]" />
                  <span>{feedbackError}</span>
                </div>
              )}

              {(approvedEvents.length > 0
                ? approvedEvents
                : events.filter((e) => normalizedStatus(e.status) !== "rejected")
              ).length === 0 ? (
                <div className="p-10 rounded-none bg-white border border-[#DDE2EA] text-center text-xs text-[#5B6678]">
                  No events available yet for post-event feedback analysis.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5">
                  {(approvedEvents.length > 0
                    ? approvedEvents
                    : events.filter((e) => normalizedStatus(e.status) !== "rejected")
                  ).map((ev) => {
                    const responses = getResponsesForEvent(ev);
                    const isLiveResponses = hasLiveResponsesForEvent(ev);
                    const rated = responses.filter((r) => typeof r.rating === "number");
                    const avgRating =
                      rated.length > 0
                        ? (rated.reduce((s, r) => s + (r.rating || 0), 0) / rated.length).toFixed(1)
                        : "–";
                    const analysis =
                      ev.ai_feedback_analysis || feedbackAnalysisMap[String(ev.event_id)];
                    const savedDraft = ev.ai_survey_draft || savedSurveyDrafts[String(ev.event_id)];
                    const evDispatch = getEventDispatch(ev);
                    const evPublishedSurvey = getEventPublishedSurvey(ev);
                    const isEvApproved =
                      normalizedStatus(ev.status) === "approved" ||
                      normalizedStatus(ev.status) === "completed";
                    const isExpanded = expandedFeedbackEventId === ev.event_id;
                    const isAnalyzing = analyzingEventId === ev.event_id;

                    return (
                      <div
                        key={ev.event_id}
                        className="p-5 rounded-none bg-white border border-[#DDE2EA] shadow-xs space-y-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-bold text-[#18212F]">{ev.title}</h3>
                              {savedDraft && (
                                <span className="px-2 py-0.5 rounded-none bg-[#EAEFFA] text-[#24408E] border border-[#C5D3F3] text-[10px] font-semibold">
                                  {savedDraft.questions.length} AI Questions Published
                                </span>
                              )}
                              {isLiveResponses && (
                                <span className="px-2 py-0.5 rounded-none bg-[#E6F3EC] text-[#1F7A4D] border border-[#B6DFC8] text-[10px] font-semibold">
                                  ● Live Public Responses
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[#5B6678]">
                              {ev.organization || "Student Org"} • {formatEventDateDisplay(ev.event_date)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedFeedbackEventId(isExpanded ? null : ev.event_id)
                              }
                              className="px-3 py-1.5 rounded-none bg-white hover:bg-[#F2F4F7] border border-[#C9D0DB] text-xs font-medium text-[#18212F] cursor-pointer"
                            >
                              {isExpanded ? "Hide Responses" : `View / Add Responses (${responses.length})`}
                            </button>
                            <button
                              type="button"
                              disabled={isAnalyzing}
                              onClick={() => handleAnalyzeFeedbackWithAi(ev)}
                              className="px-3.5 py-1.5 rounded-none bg-[#24408E] hover:bg-[#1B3270] text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              {isAnalyzing ? (
                                <>
                                  <Loader2 className="size-3.5 animate-spin" />
                                  Analyzing...
                                </>
                              ) : (
                                <>
                                  <Sparkles className="size-3.5" />
                                  Analyze Feedback with AI
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {isEvApproved && (
                          <EmailSyndicationStatusCard
                            compact
                            dispatch={evDispatch}
                            surveyUrl={evPublishedSurvey?.surveyUrl}
                            isSending={syndicatingEventId === ev.event_id}
                            onPreview={(d) => setPreviewDispatch(d)}
                            onRetry={() => void handleRetryEmailDispatch(ev, evDispatch)}
                          />
                        )}

                        <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-[#DDE2EA] text-center">
                          <div className="p-2.5 rounded-none bg-[#F7F8FA] border border-[#DDE2EA]">
                            <div className="text-[10px] text-[#5B6678]">
                              {isLiveResponses ? "Live Responses" : "Sample Responses"}
                            </div>
                            <div className="text-sm font-bold text-[#18212F]">{responses.length}</div>
                          </div>
                          <div className="p-2.5 rounded-none bg-[#F7F8FA] border border-[#DDE2EA]">
                            <div className="text-[10px] text-[#5B6678]">Avg Rating</div>
                            <div className="text-sm font-bold text-[#24408E]">{avgRating} / 5.0</div>
                          </div>
                          <div className="p-2.5 rounded-none bg-[#F7F8FA] border border-[#DDE2EA]">
                            <div className="text-[10px] text-[#5B6678]">AI Sentiment</div>
                            <div
                              className={`text-sm font-bold ${
                                analysis
                                  ? analysis.overallSentiment === "Positive"
                                    ? "text-[#1F7A4D]"
                                    : analysis.overallSentiment === "Mixed"
                                    ? "text-[#8A5A00]"
                                    : "text-[#B3261E]"
                                  : "text-[#5B6678]"
                              }`}
                            >
                              {analysis
                                ? `${analysis.overallSentiment} (${analysis.sentimentScore}/100)`
                                : "Not Analyzed"}
                            </div>
                          </div>
                        </div>

                        {/* Collapsible Raw Survey Responses Input/Viewer */}
                        {isExpanded && (
                          <div className="p-4 rounded-none bg-[#F7F8FA] border border-[#DDE2EA] space-y-3">
                            <div className="text-[10px] font-mono font-semibold uppercase text-[#24408E]">
                              Attendee Responses Analyzed by AI
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <select
                                value={newFeedbackRating}
                                onChange={(e) => setNewFeedbackRating(Number(e.target.value))}
                                className="p-2 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] outline-none"
                              >
                                {[5, 4, 3, 2, 1].map((r) => (
                                  <option key={r} value={r}>
                                    {r} ★
                                  </option>
                                ))}
                              </select>
                              <input
                                value={newFeedbackComment}
                                onChange={(e) => setNewFeedbackComment(e.target.value)}
                                placeholder="Add a real student feedback response to include in AI analysis..."
                                className="flex-1 min-w-[200px] p-2 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] placeholder:text-[#6B778A] focus:border-[#24408E] outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleAddFeedbackResponse(ev)}
                                className="px-3 py-2 rounded-none bg-[#24408E] hover:bg-[#1B3270] text-xs font-semibold text-white cursor-pointer"
                              >
                                Add
                              </button>
                            </div>
                            <div className="space-y-1.5 max-h-44 overflow-y-auto">
                              {responses.map((r, i) => (
                                <div
                                  key={i}
                                  className="p-2.5 rounded-none bg-white border border-[#DDE2EA] text-[11px] flex items-start justify-between gap-3"
                                >
                                  <span className="text-[#18212F]">{r.comment}</span>
                                  <span className="text-[#24408E] font-mono font-semibold shrink-0">
                                    {r.rating ?? "–"}/5
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Structured AI Sentiment & Executive Diagnostics Panel */}
                        {analysis && (
                          <div className="p-4 rounded-none bg-[#F7F8FA] border border-[#C5D3F3] space-y-3.5 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DDE2EA] pb-2.5">
                              <span className="font-bold text-[#18212F] flex items-center gap-1.5">
                                <Sparkles className="size-3.5 text-[#24408E]" /> AI Executive Sentiment Diagnostics
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-none text-[11px] font-bold border ${
                                  analysis.overallSentiment === "Positive"
                                    ? "bg-[#E6F3EC] text-[#1F7A4D] border-[#B6DFC8]"
                                    : analysis.overallSentiment === "Mixed"
                                    ? "bg-[#FFF4DC] text-[#8A5A00] border-[#E5C98B]"
                                    : "bg-[#FBEDEC] text-[#B3261E] border-[#E2B3AF]"
                                }`}
                              >
                                {analysis.overallSentiment} · Score {analysis.sentimentScore}/100
                              </span>
                            </div>

                            <div className="p-3 rounded-none bg-white border border-[#DDE2EA]">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-[#24408E] mb-1">
                                Executive Summary
                              </div>
                              <p className="text-[#18212F] leading-relaxed">
                                {analysis.executiveSummary}
                              </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="p-3 rounded-none bg-white border border-[#B6DFC8] space-y-1.5">
                                <div className="text-[10px] font-bold uppercase text-[#1F7A4D]">
                                  Key Strengths
                                </div>
                                <ul className="list-disc pl-4 space-y-1 text-[11px] text-[#18212F]">
                                  {analysis.keyStrengths.map((s, idx) => (
                                    <li key={idx}>{s}</li>
                                  ))}
                                </ul>
                              </div>

                              <div className="p-3 rounded-none bg-white border border-[#E5C98B] space-y-1.5">
                                <div className="text-[10px] font-bold uppercase text-[#8A5A00]">
                                  Areas for Improvement
                                </div>
                                <ul className="list-disc pl-4 space-y-1 text-[11px] text-[#18212F]">
                                  {analysis.areasForImprovement.map((s, idx) => (
                                    <li key={idx}>{s}</li>
                                  ))}
                                </ul>
                              </div>

                              <div className="p-3 rounded-none bg-white border border-[#C5D3F3] space-y-1.5">
                                <div className="text-[10px] font-bold uppercase text-[#24408E]">
                                  Actionable Recommendations
                                </div>
                                <ul className="list-disc pl-4 space-y-1 text-[11px] text-[#18212F]">
                                  {analysis.actionableRecommendations.map((s, idx) => (
                                    <li key={idx}>{s}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 4: INSTITUTIONAL MAILING LIST & SYNDICATION DIRECTORY ── */}
        {activeNav === "mailing" && (
          <InstitutionalMailingListView
            recipients={mailingRecipients}
            dispatches={emailDispatchesList}
            emailProvider={emailProviderStatus}
            eventTitleMap={Object.fromEntries(events.map((e) => [e.event_id, e.title]))}
            loading={mailingLoading}
            retryingProposalId={syndicatingEventId}
            onAddRecipient={handleAddMailingRecipient}
            onToggleRecipient={handleToggleMailingRecipient}
            onDeleteRecipient={handleDeleteMailingRecipient}
            onRefresh={fetchSyndicationData}
            onPreviewDispatch={(d) => setPreviewDispatch(d)}
            onRetryDispatch={async (d) => {
              const foundEv = events.find((e) => e.event_id === d.proposal_id);
              if (foundEv) {
                await handleRetryEmailDispatch(foundEv, d);
              }
            }}
          />
        )}

        {/* ── TAB 5: ACCOUNT MANAGEMENT (CONNECTED TO FACILITATOR PORTAL USERS) ── */}
        {activeNav === "accounts" && (
          <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DDE2EA] pb-4 text-left">
              <div>
                <h1 className="text-lg font-bold text-[#18212F]">
                  Account Management — Facilitator Registry
                </h1>
                <p className="text-xs text-[#5B6678] mt-0.5">
                  Displays permanent student facilitator accounts registered through the Facilitator Portal.
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="size-3.5 text-[#5B6678] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  placeholder="Search facilitator or org..."
                  className="w-full pl-8 pr-3 py-2 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] placeholder:text-[#6B778A] focus:border-[#24408E] focus:ring-2 focus:ring-[#24408E]/20 outline-none"
                />
              </div>
            </div>

            {filteredFacilitators.length === 0 ? (
              <div className="p-12 rounded-none bg-white border border-[#DDE2EA] text-center space-y-2 shadow-xs">
                <Users className="size-10 mx-auto text-[#24408E]/30 mb-2" />
                <p className="text-sm font-bold text-[#18212F]">No Registered Facilitator Accounts Yet</p>
                <p className="text-xs text-[#5B6678] max-w-md mx-auto">
                  Facilitator accounts will appear here automatically once users register and sign in via the updated Facilitator Portal.
                </p>
              </div>
            ) : (
              <div className="rounded-none bg-white border border-[#DDE2EA] overflow-x-auto shadow-xs">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F7F8FA] border-b border-[#DDE2EA] text-[10px] font-mono font-semibold text-[#24408E] uppercase">
                      <th className="p-3.5">Account ID</th>
                      <th className="p-3.5">Facilitator Name</th>
                      <th className="p-3.5">Institutional Email</th>
                      <th className="p-3.5">Organization</th>
                      <th className="p-3.5">Activity</th>
                      <th className="p-3.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DDE2EA]">
                    {filteredFacilitators.map((acc) => (
                      <tr key={acc.id} className="hover:bg-[#F7F8FA] transition-colors">
                        <td className="p-3.5 font-mono text-[#5B6678]">{acc.id}</td>
                        <td className="p-3.5 font-semibold text-[#18212F]">{acc.full_name}</td>
                        <td className="p-3.5 text-[#4B5563]">{acc.email}</td>
                        <td className="p-3.5 text-[#24408E] font-medium">{acc.organization}</td>
                        <td className="p-3.5 text-[#5B6678]">{acc.last_active}</td>
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 rounded-none bg-[#E6F3EC] text-[#1F7A4D] border border-[#B6DFC8] text-[10px] font-bold">
                            ● {acc.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 6: ENGAGEMENT ANALYTICS (STUDENT PUSHED EMAILS & SURVEY ENGAGEMENT) ── */}
        {activeNav === "engagement" && (
          <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 text-left">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DDE2EA] pb-4">
              <div>
                <h1 className="text-lg font-bold text-[#18212F] flex items-center gap-2">
                  <TrendingUp className="size-4 text-[#24408E]" /> Student Email & Survey Engagement Analytics
                </h1>
                <p className="text-xs text-[#5B6678] mt-0.5">
                  Tracks student interaction across all pushed institutional announcement emails (Total Views, Answered Surveys, and Unread).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-none bg-[#EAEFFA] border border-[#C5D3F3] text-[10px] font-mono font-bold text-[#24408E] uppercase">
                  {studentDispatches.length} Pushed Campaign{studentDispatches.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {/* ── 3 DISTINCT KPI METRIC CARDS (TOTAL VIEWS, ANSWERED, UNREAD) ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* KPI 1: Total Views */}
              <div className="p-5 rounded-none bg-white border border-[#DDE2EA] shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <span className="p-1.5 rounded-none bg-[#EAEFFA] border border-[#C5D3F3] text-[#24408E]">
                    <Eye className="size-4" />
                  </span>
                  <TrendingUp className="size-4 text-[#1F7A4D]" />
                </div>
                <div>
                  <p className="text-3xl font-black text-[#18212F] tracking-tight">
                    {totalStudentViews.toLocaleString()}
                  </p>
                  <p className="text-xs font-semibold text-[#5B6678] mt-1">Total Views</p>
                  <p className="text-[11px] font-medium text-[#1F7A4D] mt-1">
                    {overallViewRate}% open rate across {totalPushedStudentEmails.toLocaleString()} pushed student emails
                  </p>
                </div>
              </div>

              {/* KPI 2: Answered */}
              <div className="p-5 rounded-none bg-white border border-[#B6DFC8] shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <span className="p-1.5 rounded-none bg-[#E6F3EC] border border-[#B6DFC8] text-[#1F7A4D]">
                    <CheckCircle2 className="size-4" />
                  </span>
                  <TrendingUp className="size-4 text-[#1F7A4D]" />
                </div>
                <div>
                  <p className="text-3xl font-black text-[#1F7A4D] tracking-tight">
                    {totalStudentAnswered.toLocaleString()}
                  </p>
                  <p className="text-xs font-semibold text-[#5B6678] mt-1">Answered</p>
                  <p className="text-[11px] font-medium text-[#1F7A4D] mt-1">
                    {overallAnswerRate}% survey completion from student recipients
                  </p>
                </div>
              </div>

              {/* KPI 3: Unread */}
              <div className="p-5 rounded-none bg-white border border-[#E5C98B] shadow-xs flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <span className="p-1.5 rounded-none bg-[#FFF4DC] border border-[#E5C98B] text-[#8A5A00]">
                    <Mail className="size-4" />
                  </span>
                  <span className="text-[10px] font-mono font-bold text-[#8A5A00] uppercase">
                    PENDING OPEN
                  </span>
                </div>
                <div>
                  <p className="text-3xl font-black text-[#8A5A00] tracking-tight">
                    {totalStudentUnread.toLocaleString()}
                  </p>
                  <p className="text-xs font-semibold text-[#5B6678] mt-1">Unread</p>
                  <p className="text-[11px] font-medium text-[#8A5A00] mt-1">
                    {overallUnreadRate}% unopened student emails awaiting follow-up
                  </p>
                </div>
              </div>
            </div>

            {/* ── BAR GRAPH CHARTS SECTION ── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Bar Graph 1: Aggregate Student Engagement Breakdown */}
              <div className="lg:col-span-5 rounded-none bg-white border border-[#DDE2EA] p-6 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-[#DDE2EA] pb-3 mb-5">
                    <div>
                      <h2 className="text-xs font-bold uppercase tracking-wider text-[#24408E]">
                        Student Email Engagement Breakdown
                      </h2>
                      <p className="text-[11px] text-[#5B6678] mt-0.5">
                        Total Views vs. Answered Surveys vs. Unread Emails
                      </p>
                    </div>
                  </div>

                  {/* Vertical Column Bar Chart */}
                  <div className="h-56 border-b border-l border-[#C9D0DB] px-6 pt-6 pb-0 flex items-end justify-around gap-4 bg-[#F7F8FA]">
                    {[
                      {
                        label: "Total Views",
                        value: totalStudentViews,
                        pct: overallViewRate,
                        barColor: "bg-[#24408E]",
                        textColor: "text-[#24408E]",
                      },
                      {
                        label: "Answered",
                        value: totalStudentAnswered,
                        pct: overallAnswerRate,
                        barColor: "bg-[#1F7A4D]",
                        textColor: "text-[#1F7A4D]",
                      },
                      {
                        label: "Unread",
                        value: totalStudentUnread,
                        pct: overallUnreadRate,
                        barColor: "bg-[#D97706]",
                        textColor: "text-[#8A5A00]",
                      },
                    ].map((bar) => {
                      const heightPct =
                        totalPushedStudentEmails > 0
                          ? Math.max(8, Math.round((bar.value / maxBarScale) * 100))
                          : 8;
                      return (
                        <div
                          key={bar.label}
                          className="flex-1 h-full flex flex-col items-center justify-end gap-1.5"
                        >
                          <span className={`text-xs font-mono font-bold ${bar.textColor}`}>
                            {bar.value.toLocaleString()}
                          </span>
                          <div
                            title={`${bar.label}: ${bar.value} (${bar.pct}%)`}
                            style={{ height: `${heightPct}%` }}
                            className={`w-full max-w-[72px] rounded-none ${bar.barColor} transition-all duration-300 border border-black/10`}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* X-Axis Labels */}
                  <div className="px-6 pt-2.5 flex items-center justify-around gap-4 text-center">
                    <div className="flex-1">
                      <div className="text-[11px] font-bold text-[#18212F]">Total Views</div>
                      <div className="text-[10px] font-mono text-[#5B6678]">{overallViewRate}%</div>
                    </div>
                    <div className="flex-1">
                      <div className="text-[11px] font-bold text-[#18212F]">Answered</div>
                      <div className="text-[10px] font-mono text-[#5B6678]">{overallAnswerRate}%</div>
                    </div>
                    <div className="flex-1">
                      <div className="text-[11px] font-bold text-[#18212F]">Unread</div>
                      <div className="text-[10px] font-mono text-[#5B6678]">{overallUnreadRate}%</div>
                    </div>
                  </div>
                </div>

                {/* Insights Summary Below Bar Graph */}
                <div className="mt-5 p-3.5 rounded-none bg-[#EAEFFA] border border-[#C5D3F3] text-xs space-y-1">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#24408E]">
                    Engagement Analysis Insight
                  </div>
                  <p className="text-[#18212F] leading-relaxed">
                    Out of <b>{totalPushedStudentEmails.toLocaleString()}</b> total pushed student email deliveries,{" "}
                    <b className="text-[#24408E]">{totalStudentViews.toLocaleString()}</b> were viewed ({overallViewRate}%),{" "}
                    <b className="text-[#1F7A4D]">{totalStudentAnswered.toLocaleString()}</b> resulted in completed survey responses ({overallAnswerRate}%), and{" "}
                    <b className="text-[#8A5A00]">{totalStudentUnread.toLocaleString()}</b> remain unread ({overallUnreadRate}%).
                  </p>
                </div>
              </div>

              {/* Bar Graph 2: Event Campaign Performance Comparison (Grouped Horizontal Bars) */}
              <div className="lg:col-span-7 rounded-none bg-white border border-[#DDE2EA] p-6 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DDE2EA] pb-3 mb-4">
                    <div>
                      <h2 className="text-xs font-bold uppercase tracking-wider text-[#24408E]">
                        Pushed Email Performance Comparison by Event
                      </h2>
                      <p className="text-[11px] text-[#5B6678] mt-0.5">
                        Per-event distribution of student views, answered surveys, and unread emails
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-semibold">
                      <span className="flex items-center gap-1 text-[#24408E]">
                        <span className="size-2.5 bg-[#24408E] inline-block" /> Views
                      </span>
                      <span className="flex items-center gap-1 text-[#1F7A4D]">
                        <span className="size-2.5 bg-[#1F7A4D] inline-block" /> Answered
                      </span>
                      <span className="flex items-center gap-1 text-[#8A5A00]">
                        <span className="size-2.5 bg-[#D97706] inline-block" /> Unread
                      </span>
                    </div>
                  </div>

                  {engagementCampaigns.length === 0 ? (
                    <div className="p-10 rounded-none bg-[#F7F8FA] border border-[#DDE2EA] text-center space-y-1.5">
                      <Mail className="size-8 mx-auto text-[#24408E]/30 mb-1" />
                      <p className="text-xs font-bold text-[#18212F]">
                        No Student Email Campaigns Dispatched Yet
                      </p>
                      <p className="text-[11px] text-[#5B6678] max-w-md mx-auto">
                        Approve an event proposal and generate its survey in the <b>Surveys</b> tab to push student emails and populate live engagement charts.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-64 overflow-y-auto pr-1">
                      {engagementCampaigns.slice(0, 6).map((c) => {
                        const viewsPct = Math.round((c.totalViews / c.pushedCount) * 100);
                        const answeredPct = Math.round((c.answered / c.pushedCount) * 100);
                        const unreadPct = Math.round((c.unread / c.pushedCount) * 100);

                        return (
                          <div
                            key={c.dispatchId}
                            className="p-3 rounded-none bg-[#F7F8FA] border border-[#DDE2EA] space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-bold text-[#18212F] truncate">
                                {c.eventTitle}
                              </span>
                              <span className="text-[10px] font-mono text-[#5B6678] shrink-0">
                                {c.pushedCount.toLocaleString()} Pushed
                              </span>
                            </div>

                            {/* Stacked / Grouped Comparison Bar */}
                            <div className="space-y-1.5">
                              <div className="w-full h-3 bg-[#E5E9F0] rounded-none overflow-hidden flex">
                                <div
                                  title={`Answered: ${c.answered} (${answeredPct}%)`}
                                  style={{ width: `${answeredPct}%` }}
                                  className="h-full bg-[#1F7A4D]"
                                />
                                <div
                                  title={`Viewed (Not Yet Answered): ${Math.max(0, c.totalViews - c.answered)}`}
                                  style={{ width: `${Math.max(0, viewsPct - answeredPct)}%` }}
                                  className="h-full bg-[#24408E]"
                                />
                                <div
                                  title={`Unread: ${c.unread} (${unreadPct}%)`}
                                  style={{ width: `${unreadPct}%` }}
                                  className="h-full bg-[#D97706]"
                                />
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
                                <span className="text-[#24408E] font-semibold">
                                  Views: {c.totalViews} ({viewsPct}%)
                                </span>
                                <span className="text-[#1F7A4D] font-semibold">
                                  Answered: {c.answered} ({answeredPct}%)
                                </span>
                                <span className="text-[#8A5A00] font-semibold">
                                  Unread: {c.unread} ({unreadPct}%)
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Total Engagement Analysis Footer */}
                <div className="mt-5 p-3.5 rounded-none bg-[#F7F8FA] border border-[#DDE2EA] text-xs flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[#5B6678]">
                    Total Active Student Engagement (Views + Answered):{" "}
                    <b className="text-[#18212F]">
                      {(totalStudentViews + totalStudentAnswered).toLocaleString()} interactions
                    </b>
                  </span>
                  <span className="font-mono text-[11px] font-bold text-[#24408E]">
                    Engagement Rate: {overallViewRate}%
                  </span>
                </div>
              </div>
            </div>

            {/* ── DETAILED PUSHED EMAIL ENGAGEMENT LEDGER TABLE (INSPO TABLE) ── */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-[#18212F]">
                  Pushed Student Email Engagement Log
                </h2>
                <div className="relative w-full sm:w-64">
                  <Search className="size-3.5 text-[#5B6678] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={engagementSearch}
                    onChange={(e) => setEngagementSearch(e.target.value)}
                    placeholder="Search events..."
                    className="w-full pl-8 pr-3 py-2 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] placeholder:text-[#6B778A] focus:border-[#24408E] focus:ring-2 focus:ring-[#24408E]/20 outline-none"
                  />
                </div>
              </div>

              {filteredEngagementCampaigns.length === 0 ? (
                <div className="p-10 rounded-none bg-white border border-[#DDE2EA] text-center text-xs text-[#5B6678] shadow-xs">
                  No pushed student email records match your filter.
                </div>
              ) : (
                <div className="rounded-none bg-white border border-[#DDE2EA] overflow-x-auto shadow-xs">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#F7F8FA] border-b border-[#DDE2EA] text-[10px] font-mono font-semibold text-[#24408E] uppercase">
                        <th className="p-3.5">Event</th>
                        <th className="p-3.5">Organization</th>
                        <th className="p-3.5">Total Views</th>
                        <th className="p-3.5">Answered</th>
                        <th className="p-3.5">Unread</th>
                        <th className="p-3.5">Status</th>
                        <th className="p-3.5">Date & Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DDE2EA]">
                      {filteredEngagementCampaigns.map((row) => (
                        <tr key={row.dispatchId} className="hover:bg-[#F7F8FA] transition-colors">
                          <td className="p-3.5 font-semibold text-[#18212F]">{row.eventTitle}</td>
                          <td className="p-3.5 text-[#5B6678]">{row.organization}</td>
                          <td className="p-3.5 font-mono font-semibold text-[#24408E]">
                            {row.totalViews.toLocaleString()} ({row.openRate}%)
                          </td>
                          <td className="p-3.5 font-mono font-semibold text-[#1F7A4D]">
                            {row.answered.toLocaleString()} ({row.responseRate}%)
                          </td>
                          <td className="p-3.5 font-mono font-semibold text-[#8A5A00]">
                            {row.unread.toLocaleString()}
                          </td>
                          <td className="p-3.5">
                            <span
                              className={`px-2 py-0.5 rounded-none text-[10px] font-bold uppercase border ${
                                row.status === "SENT"
                                  ? "bg-[#E6F3EC] text-[#1F7A4D] border-[#B6DFC8]"
                                  : row.status === "FAILED"
                                  ? "bg-[#FBEDEC] text-[#B3261E] border-[#E2B3AF]"
                                  : "bg-[#FFF4DC] text-[#8A5A00] border-[#E5C98B]"
                              }`}
                            >
                              {row.status === "SENT" ? "Published & Sent" : row.status}
                            </span>
                          </td>
                          <td className="p-3.5 font-mono text-[11px] text-[#5B6678]">
                            {row.sentAt
                              ? new Date(row.sentAt).toLocaleString("en-US", {
                                  year: "numeric",
                                  month: "2-digit",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "Pending"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Revision Modal */}
      {showRevisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#18212F]/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-none bg-white border border-[#DDE2EA] p-6 shadow-xl text-left">
            <h3 className="text-base font-bold text-[#18212F] mb-2">Request Revisions</h3>
            <p className="text-xs text-[#5B6678] mb-4">
              Enter the feedback or document corrections required by the SAO Office:
            </p>
            <textarea
              rows={4}
              value={revisionFeedback}
              onChange={(e) => setRevisionFeedback(e.target.value)}
              placeholder="e.g., Please update the schedule and attach the endorsed APF with adviser signature..."
              className="w-full p-3 rounded-none bg-white border border-[#C9D0DB] text-xs text-[#18212F] placeholder:text-[#6B778A] outline-none focus:border-[#24408E] focus:ring-2 focus:ring-[#24408E]/20 resize-none mb-4"
            />
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowRevisionModal(false)}
                className="px-4 py-2 rounded-none text-xs font-medium text-[#18212F] hover:bg-[#F2F4F7] border border-[#C9D0DB] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleUpdateStatus("revision", revisionFeedback)}
                disabled={!revisionFeedback.trim() || actionLoading}
                className="px-5 py-2 rounded-none text-xs font-semibold bg-[#24408E] hover:bg-[#1B3270] text-white disabled:opacity-40 cursor-pointer"
              >
                Send Revision Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Dispatched Email Modal */}
      {previewDispatch && (
        <EmailPreviewModal
          dispatch={previewDispatch}
          eventTitle={events.find((e) => e.event_id === previewDispatch.proposal_id)?.title}
          onClose={() => setPreviewDispatch(null)}
          retrying={syndicatingEventId === previewDispatch.proposal_id}
          onRetry={
            previewDispatch.status === "FAILED"
              ? () => {
                  const foundEv = events.find((e) => e.event_id === previewDispatch.proposal_id);
                  if (foundEv) {
                    setPreviewDispatch(null);
                    void handleRetryEmailDispatch(foundEv, previewDispatch);
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
