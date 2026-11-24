import { useEffect, useState } from "react";
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Loader2,
  ShieldCheck,
  Star,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  fetchPublicSurveyFromBackend,
  submitPublicSurveyResponseToBackend,
  type GeneratedSurveyQuestion,
} from "../../lib/aiClient";
import { decodeProposalDescription } from "../../lib/proposalAttachments";

interface LoadedPublicSurvey {
  surveyId: string | null;
  surveyToken: string;
  eventId: number;
  surveyTitle: string;
  description: string;
  questions: GeneratedSurveyQuestion[];
  eventTitle: string;
  organization: string;
  eventDate: string;
  venue: string;
}

const RATING_LABELS: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Very Good",
  5: "Excellent",
};

export function PublicSurveyPage({ surveyToken }: { surveyToken: string }) {
  const [survey, setSurvey] = useState<LoadedPublicSurvey | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [respondentRole, setRespondentRole] = useState<"student" | "faculty" | "staff">("student");
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadSurvey = async () => {
      setLoading(true);
      setLoadError("");
      const token = surveyToken.trim();

      try {
        // 1. Primary path: Load directly from Supabase public.event_surveys (no login needed)
        const { data: byToken, error: tokenErr } = await supabase
          .from("event_surveys")
          .select("*")
          .eq("survey_token", token)
          .eq("is_active", true)
          .maybeSingle();

        let surveyRow: any = !tokenErr ? byToken : null;

        if (!surveyRow && /^[0-9a-f-]{36}$/i.test(token)) {
          const { data: byId, error: idErr } = await supabase
            .from("event_surveys")
            .select("*")
            .eq("id", token)
            .eq("is_active", true)
            .maybeSingle();
          if (!idErr && byId) {
            surveyRow = byId;
          }
        }

        if (surveyRow && !cancelled) {
          const { data: ev } = await supabase
            .from("events")
            .select("title, organization, event_date, venue")
            .eq("event_id", surveyRow.event_id)
            .maybeSingle();

          setSurvey({
            surveyId: surveyRow.id,
            surveyToken: surveyRow.survey_token,
            eventId: Number(surveyRow.event_id),
            surveyTitle: surveyRow.survey_title,
            description: surveyRow.description || "",
            questions: Array.isArray(surveyRow.questions) ? surveyRow.questions : [],
            eventTitle: ev?.title || surveyRow.survey_title,
            organization: ev?.organization || "Student Organization",
            eventDate: ev?.event_date || "",
            venue: ev?.venue || "",
          });
          setLoading(false);
          return;
        }

        // 2. Fallback path: Resolve from public.events description bundle (if event_surveys table isn't migrated yet)
        const tokenEventMatch = token.match(/^srv_(\d+)_/);
        if (tokenEventMatch) {
          const parsedEventId = Number(tokenEventMatch[1]);
          const { data: ev } = await supabase
            .from("events")
            .select("*")
            .eq("event_id", parsedEventId)
            .maybeSingle();

          if (ev && !cancelled) {
            const decoded = decodeProposalDescription(ev.description);
            const carried = decoded.publishedSurvey;
            const draft = carried?.draft || ev.ai_survey_draft;
            if (draft && Array.isArray(draft.questions) && draft.questions.length > 0) {
              setSurvey({
                surveyId: carried?.surveyId || null,
                surveyToken: carried?.surveyToken || token,
                eventId: Number(ev.event_id),
                surveyTitle: draft.surveyTitle || `${ev.title} — Post-Event Evaluation`,
                description: draft.description || "",
                questions: draft.questions,
                eventTitle: ev.title,
                organization: ev.organization || "Student Organization",
                eventDate: ev.event_date || "",
                venue: ev.venue || "",
              });
              setLoading(false);
              return;
            }
          }
        }

        // 3. Final fallback: Query backend public survey endpoint
        const backendSurvey = await fetchPublicSurveyFromBackend(token);
        if (backendSurvey && !cancelled) {
          setSurvey({
            surveyId: backendSurvey.id,
            surveyToken: backendSurvey.survey_token,
            eventId: Number(backendSurvey.event_id),
            surveyTitle: backendSurvey.survey_title,
            description: backendSurvey.description || "",
            questions: Array.isArray(backendSurvey.questions) ? backendSurvey.questions : [],
            eventTitle: backendSurvey.event_meta?.title || backendSurvey.survey_title,
            organization: backendSurvey.event_meta?.organization || "Student Organization",
            eventDate: backendSurvey.event_meta?.event_date || "",
            venue: backendSurvey.event_meta?.venue || "",
          });
          setLoading(false);
          return;
        }

        if (!cancelled) {
          setLoadError(
            "This post-event evaluation survey link is invalid, expired, or has been closed by the institution."
          );
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Unable to load the post-event evaluation survey."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSurvey();
    return () => {
      cancelled = true;
    };
  }, [surveyToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!survey || submitting) return;
    setSubmitError("");

    for (let i = 0; i < survey.questions.length; i++) {
      const q = survey.questions[i];
      const val = answers[q.id];
      if (q.required && (val === undefined || val === null || String(val).trim() === "")) {
        setSubmitError(`Please answer Question ${i + 1} before submitting.`);
        return;
      }
    }

    // Derive aggregate rating (1-5) and synthesized feedback comment for Post-Event Sentiment Analytics
    const ratingValues = survey.questions
      .filter((q) => q.type === "rating_1_to_5")
      .map((q) => Number(answers[q.id]))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);

    const overallRating =
      ratingValues.length > 0
        ? Math.round(ratingValues.reduce((sum, v) => sum + v, 0) / ratingValues.length)
        : null;

    const textParts: string[] = [];
    for (const q of survey.questions) {
      const val = answers[q.id];
      if (val === undefined || val === null || String(val).trim() === "") continue;
      if (q.type === "open_text") {
        textParts.push(String(val).trim());
      } else if (q.type === "multiple_choice") {
        textParts.push(`${q.text}: ${String(val).trim()}`);
      }
    }
    const synthesizedComment =
      textParts.join(" | ").trim() ||
      (overallRating ? `Submitted ${overallRating}/5 evaluation rating.` : "Survey response submitted.");

    setSubmitting(true);
    try {
      const uuidValid = survey.surveyId && /^[0-9a-f-]{36}$/i.test(survey.surveyId);
      const { error: dbErr } = await supabase.from("survey_responses").insert([
        {
          survey_id: uuidValid ? survey.surveyId : null,
          event_id: survey.eventId,
          respondent_role: respondentRole,
          overall_rating: overallRating,
          comment: synthesizedComment,
          answers,
          submitted_at: new Date().toISOString(),
        },
      ]);

      if (dbErr) {
        // Fallback to backend submission endpoint if Supabase survey_responses table isn't migrated yet
        await submitPublicSurveyResponseToBackend(survey.surveyToken, {
          eventId: survey.eventId,
          surveyId: survey.surveyId,
          respondentRole,
          overallRating,
          comment: synthesizedComment,
          answers,
        });
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Could not submit your response. Please try again in a moment."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#F2F4F7] text-[#18212F] font-sans flex flex-col">
      {/* Institutional Banner Header — Public Evaluation Form (No Login Required) */}
      <header className="bg-[#1C2D63] text-white border-b border-[#162452]">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-md bg-[#24408E] border border-[#F2B84B]/50 flex items-center justify-center font-black text-[#F2B84B] text-lg shrink-0">
              C
            </div>
            <div className="text-left">
              <div className="font-bold text-sm tracking-tight text-white">CampusSync</div>
              <div className="text-[10px] font-mono text-[#B8C3E3] uppercase tracking-wider">
                Asia Pacific College · Post-Event Evaluation
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono uppercase tracking-wider text-[#F2B84B]">
            <ShieldCheck className="size-3.5" /> No Login Required
          </span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="rounded-lg bg-white border border-[#DDE2EA] shadow-xs p-12 flex flex-col items-center justify-center text-center gap-3">
            <Loader2 className="size-7 animate-spin text-[#24408E]" />
            <p className="text-sm font-semibold text-[#18212F]">Loading Post-Event Evaluation...</p>
            <p className="text-xs text-[#5B6678]">Fetching the official institutional survey questionnaire.</p>
          </div>
        ) : loadError || !survey ? (
          <div className="rounded-lg bg-white border border-[#E2B3AF] shadow-xs p-8 text-center space-y-3">
            <AlertCircle className="size-10 text-[#B3261E] mx-auto" />
            <h1 className="text-base font-bold text-[#18212F]">Survey Unavailable</h1>
            <p className="text-xs text-[#5B6678] max-w-md mx-auto leading-relaxed">
              {loadError || "This evaluation survey could not be located."}
            </p>
          </div>
        ) : submitted ? (
          <div className="rounded-lg bg-white border border-[#B6DFC8] shadow-xs p-10 text-center space-y-4">
            <div className="size-12 rounded-full bg-[#E6F3EC] border border-[#B6DFC8] flex items-center justify-center mx-auto">
              <CheckCircle2 className="size-6 text-[#1F7A4D]" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-[#18212F]">Thank You for Your Feedback!</h1>
              <p className="text-xs text-[#5B6678] max-w-md mx-auto leading-relaxed">
                Your anonymous evaluation for <b className="text-[#18212F]">{survey.eventTitle}</b> has been recorded and sent directly to CampusSync Institutional Post-Event Analytics.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#E6F3EC] border border-[#B6DFC8] text-[11px] font-semibold text-[#1F7A4D]">
              <ShieldCheck className="size-3.5" /> Response Logged Successfully
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 text-left">
            {/* Event & Survey Overview Card */}
            <div className="rounded-lg bg-white border border-[#C5D3F3] shadow-xs overflow-hidden">
              <div className="h-1.5 bg-[#24408E]" />
              <div className="p-6 space-y-3">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#EAEFFA] text-[#24408E] border border-[#C5D3F3] text-[10px] font-mono font-semibold uppercase">
                  <ClipboardList className="size-3" /> Official Post-Event Survey
                </div>
                <h1 className="text-xl font-bold text-[#18212F] tracking-tight">
                  {survey.surveyTitle}
                </h1>
                <p className="text-sm font-semibold text-[#24408E]">{survey.eventTitle}</p>
                {survey.description && (
                  <p className="text-xs text-[#4B5563] leading-relaxed">{survey.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-[#DDE2EA] text-xs text-[#5B6678]">
                  <span className="font-medium text-[#18212F]">{survey.organization}</span>
                  {survey.eventDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3.5 text-[#24408E]" /> {survey.eventDate}
                    </span>
                  )}
                  {survey.venue && (
                    <span className="flex items-center gap-1">
                      <Building2 className="size-3.5 text-[#24408E]" /> {survey.venue}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Anonymous Respondent Role Selector */}
            <div className="rounded-lg bg-white border border-[#DDE2EA] shadow-xs p-5 space-y-2.5">
              <label className="text-xs font-bold text-[#18212F] block">
                Your Institutional Role (Anonymous)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["student", "faculty", "staff"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setRespondentRole(role)}
                    className={`py-2 px-3 rounded-md text-xs font-semibold capitalize border transition cursor-pointer ${
                      respondentRole === role
                        ? "bg-[#24408E] text-white border-[#24408E]"
                        : "bg-white text-[#18212F] border-[#C9D0DB] hover:bg-[#F7F8FA]"
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>

            {/* AI-Generated Evaluation Questions */}
            <div className="space-y-4">
              {survey.questions.map((q, idx) => {
                const currentVal = answers[q.id];
                return (
                  <div
                    key={q.id}
                    className="rounded-lg bg-white border border-[#DDE2EA] shadow-xs p-5 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <label className="text-sm font-semibold text-[#18212F] leading-snug">
                        <span className="font-mono text-[#24408E] mr-1.5">Q{idx + 1}.</span>
                        {q.text}
                        {q.required && <span className="text-[#B3261E] ml-1">*</span>}
                      </label>
                    </div>

                    {q.type === "rating_1_to_5" && (
                      <div className="grid grid-cols-5 gap-2 pt-1">
                        {[1, 2, 3, 4, 5].map((rating) => {
                          const isSelected = Number(currentVal) === rating;
                          return (
                            <button
                              key={rating}
                              type="button"
                              onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: rating }))}
                              className={`p-2.5 rounded-md border flex flex-col items-center justify-center gap-1 transition cursor-pointer ${
                                isSelected
                                  ? "bg-[#EAEFFA] border-[#24408E] text-[#24408E] ring-1 ring-[#24408E]"
                                  : "bg-[#F7F8FA] border-[#DDE2EA] text-[#5B6678] hover:border-[#24408E]/50"
                              }`}
                            >
                              <div className="flex items-center gap-0.5">
                                <span className="text-sm font-bold">{rating}</span>
                                <Star
                                  className={`size-3.5 ${
                                    isSelected ? "fill-[#24408E] text-[#24408E]" : "text-[#9AA4B2]"
                                  }`}
                                />
                              </div>
                              <span className="text-[10px] font-medium hidden sm:inline">
                                {RATING_LABELS[rating]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {q.type === "multiple_choice" && (
                      <div className="space-y-2 pt-1">
                        {(q.options && q.options.length > 0
                          ? q.options
                          : ["Very Satisfied", "Satisfied", "Neutral", "Needs Improvement"]
                        ).map((opt) => {
                          const isSelected = currentVal === opt;
                          return (
                            <label
                              key={opt}
                              className={`flex items-center gap-2.5 p-3 rounded-md border text-xs cursor-pointer transition ${
                                isSelected
                                  ? "bg-[#EAEFFA] border-[#24408E] text-[#18212F] font-semibold"
                                  : "bg-[#F7F8FA] border-[#DDE2EA] text-[#18212F] hover:border-[#24408E]/40"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`question-${q.id}`}
                                checked={isSelected}
                                onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                                className="accent-[#24408E]"
                              />
                              <span>{opt}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {q.type === "open_text" && (
                      <textarea
                        rows={3}
                        required={q.required}
                        value={typeof currentVal === "string" ? currentVal : ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                        }
                        placeholder="Share your honest thoughts, highlights, or suggestions for improvement..."
                        className="w-full p-3 rounded-md bg-white border border-[#C9D0DB] text-xs text-[#18212F] placeholder:text-[#6B778A] focus:border-[#24408E] focus:ring-2 focus:ring-[#24408E]/20 outline-none resize-none"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {submitError && (
              <div className="p-3.5 rounded-md bg-[#FBEDEC] border border-[#E2B3AF] text-xs text-[#B3261E] flex items-start gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-[11px] text-[#5B6678]">
                Responses are anonymous and used for institutional event improvement (RA 10173).
              </p>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2.5 rounded-md bg-[#24408E] hover:bg-[#1B3270] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition cursor-pointer disabled:opacity-50 shrink-0"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" />
                    Submit Evaluation
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </main>

      <footer className="py-4 text-center text-[11px] text-[#5B6678] border-t border-[#DDE2EA] bg-white">
        CampusSync Institutional Governance · Asia Pacific College
      </footer>
    </div>
  );
}
