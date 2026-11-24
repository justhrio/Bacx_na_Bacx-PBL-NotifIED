import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { env } from "./env.js";

let client: GoogleGenAI | null = null;

// Remember models that recently timed out or returned 503/429/404 so subsequent calls skip straight to a healthy fast model
const degradedModelUntil = new Map<string, number>();
const MODEL_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
const SLOW_PRIMARY_COOLDOWN_MS = 90 * 1000; // 90 seconds if a hedged backup beat the primary

export interface FallbackGenerationOptions {
  /** Wait before launching backup Flash models in parallel if primary hasn't responded yet (ms) */
  hedgeDelayMs?: number;
  /** Overall hard deadline across all raced models so Express always responds well before Vercel's 60s cutoff (ms) */
  maxTotalTimeoutMs?: number;
}

export function getGeminiClient(): GoogleGenAI {
  if (!env.geminiApiKey) {
    throw new Error(
      "AI service is not configured on the backend server. Please configure GEMINI_API_KEY."
    );
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  }
  return client;
}

export const GEMINI_MODEL = env.geminiModel;
export const GEMINI_FALLBACK_MODELS = env.geminiFallbackModels;

function isFallbackableModelError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 404 || status === 503 || status === 429 || status === 408 || status === 504) {
    return true;
  }
  const name = err instanceof Error ? err.name : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("MODEL_TIMEOUT") ||
    msg.includes("aborted") ||
    msg.includes("timed out") ||
    msg.includes("NOT_FOUND") ||
    msg.includes("404") ||
    msg.includes("no longer available") ||
    msg.includes("not found for API version") ||
    msg.includes("503") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
    msg.includes("429") ||
    msg.includes("RESOURCE_EXHAUSTED")
  );
}

function getOrderedModelsForRequest(): string[] {
  const now = Date.now();
  const healthy: string[] = [];
  const coolingDown: string[] = [];

  for (const model of GEMINI_FALLBACK_MODELS) {
    const until = degradedModelUntil.get(model) || 0;
    if (until > now) {
      coolingDown.push(model);
    } else {
      if (until > 0) degradedModelUntil.delete(model);
      healthy.push(model);
    }
  }

  // Try proven healthy models first; keep cooling-down models at the end
  return [...healthy, ...coolingDown];
}

/**
 * Hedged Request Racing across Gemini Flash fallback models:
 * - Launches the top healthy model immediately (zero extra calls when fast).
 * - If it returns 503/429/404 OR hasn't responded within `hedgeDelayMs` (default 3.5s),
 *   races the remaining fallback Flash models in parallel — first valid response wins immediately
 *   and cleanly aborts slower in-flight requests.
 */
export async function generateContentWithModelFallback(
  params: Omit<GenerateContentParameters, "model">,
  options?: FallbackGenerationOptions
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const ai = getGeminiClient();
  const orderedModels = getOrderedModelsForRequest();
  const hedgeDelayMs = options?.hedgeDelayMs ?? 3_500;
  const maxTotalTimeoutMs = options?.maxTotalTimeoutMs ?? 24_000;

  if (orderedModels.length === 0) {
    throw new Error("No Gemini models configured.");
  }

  return new Promise<{ response: GenerateContentResponse; modelUsed: string }>((resolve, reject) => {
    let settled = false;
    let backupsLaunched = false;
    let launchedCount = 0;
    let completedFailures = 0;
    let lastError: unknown = null;

    const controllers = new Map<string, AbortController>();
    const pendingModels = new Set<string>();
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (winnerModel?: string) => {
      if (hedgeTimer) {
        clearTimeout(hedgeTimer);
        hedgeTimer = undefined;
      }
      if (totalTimer) {
        clearTimeout(totalTimer);
        totalTimer = undefined;
      }
      for (const [m, ctrl] of controllers.entries()) {
        if (m !== winnerModel) {
          try {
            ctrl.abort();
          } catch {
            // Ignore abort errors on already-closed streams
          }
        }
      }
      controllers.clear();
    };

    const finishSuccess = (response: GenerateContentResponse, modelUsed: string) => {
      if (settled) return;
      settled = true;
      degradedModelUntil.delete(modelUsed);
      // If a backup beat a slow primary that was still hanging, softly cool down the primary for 90s
      const primary = orderedModels[0];
      if (modelUsed !== primary && pendingModels.has(primary)) {
        degradedModelUntil.set(primary, Date.now() + SLOW_PRIMARY_COOLDOWN_MS);
      }
      cleanup(modelUsed);
      resolve({ response, modelUsed });
    };

    const finishFailure = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        err instanceof Error
          ? err
          : new Error("The AI service is temporarily unavailable. Please retry shortly.")
      );
    };

    const launchModel = (model: string, isPrimary: boolean) => {
      if (settled) return;
      const controller = new AbortController();
      controllers.set(model, controller);
      pendingModels.add(model);
      launchedCount += 1;

      ai.models
        .generateContent({
          ...params,
          model,
          config: {
            ...(params.config || {}),
            abortSignal: controller.signal,
          },
        })
        .then((response) => {
          pendingModels.delete(model);
          if (settled) return;
          if (!response.text) {
            throw new Error(`MODEL_TIMEOUT: "${model}" returned an empty response.`);
          }
          finishSuccess(response, model);
        })
        .catch((err) => {
          pendingModels.delete(model);
          if (settled) return;

          lastError = err;
          completedFailures += 1;

          if (!isFallbackableModelError(err)) {
            finishFailure(err);
            return;
          }

          degradedModelUntil.set(model, Date.now() + MODEL_COOLDOWN_MS);
          console.warn(
            `[Gemini] Model "${model}" unavailable/slow (${
              err instanceof Error ? err.message : String(err)
            })`
          );

          // If primary failed early, fire backups immediately without waiting for hedgeDelayMs
          if (isPrimary && !backupsLaunched) {
            launchBackups();
            return;
          }

          if (backupsLaunched && completedFailures >= launchedCount) {
            finishFailure(lastError);
          }
        });
    };

    const launchBackups = () => {
      if (settled || backupsLaunched) return;
      backupsLaunched = true;
      if (hedgeTimer) {
        clearTimeout(hedgeTimer);
        hedgeTimer = undefined;
      }

      const backups = orderedModels.slice(1);
      if (backups.length === 0) {
        if (completedFailures >= launchedCount) {
          finishFailure(lastError);
        }
        return;
      }

      console.warn(
        `[Gemini] Hedging request across fallback models in parallel: ${backups.join(", ")}`
      );
      for (const backup of backups) {
        launchModel(backup, false);
      }
    };

    // Start primary model immediately
    launchModel(orderedModels[0], true);

    // If primary hasn't responded quickly, race backups in parallel
    if (orderedModels.length > 1) {
      hedgeTimer = setTimeout(() => {
        launchBackups();
      }, hedgeDelayMs);
    } else {
      backupsLaunched = true;
    }

    // Hard deadline across the entire race so Vercel never hits 504 timeout
    totalTimer = setTimeout(() => {
      if (settled) return;
      for (const stalledModel of pendingModels) {
        degradedModelUntil.set(stalledModel, Date.now() + MODEL_COOLDOWN_MS);
      }
      finishFailure(
        new Error(
          `MODEL_TIMEOUT: Gemini models did not respond within ${maxTotalTimeoutMs}ms.`
        )
      );
    }, maxTotalTimeoutMs);
  });
}
