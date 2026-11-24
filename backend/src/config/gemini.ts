import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { env } from "./env.js";

let client: GoogleGenAI | null = null;

// Remember models that recently timed out or returned 503/429/404 so subsequent calls skip straight to a healthy model
const degradedModelUntil = new Map<string, number>();
const MODEL_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

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

  // Try healthy models first; keep cooling-down models at the end as last resort
  return [...healthy, ...coolingDown];
}

async function generateWithTimeout(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">,
  model: string,
  timeoutMs: number
): Promise<GenerateContentResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`MODEL_TIMEOUT: "${model}" did not respond within ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const requestPromise = ai.models.generateContent({
      ...params,
      model,
      config: {
        ...(params.config || {}),
        abortSignal: controller.signal,
      },
    });
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function generateContentWithModelFallback(
  params: Omit<GenerateContentParameters, "model">
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const ai = getGeminiClient();
  const orderedModels = getOrderedModelsForRequest();
  let lastError: unknown;

  // Keep worst-case cumulative latency well inside Vercel's 60s serverless timeout
  for (let i = 0; i < orderedModels.length; i++) {
    const model = orderedModels[i];
    const timeoutMs = i < 2 ? 10_000 : 12_000;
    try {
      const response = await generateWithTimeout(ai, params, model, timeoutMs);
      degradedModelUntil.delete(model);
      return { response, modelUsed: model };
    } catch (err) {
      lastError = err;
      if (isFallbackableModelError(err)) {
        degradedModelUntil.set(model, Date.now() + MODEL_COOLDOWN_MS);
        console.warn(
          `[Gemini] Model "${model}" unavailable/slow (${
            err instanceof Error ? err.message : String(err)
          }), trying next fallback model...`
        );
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The AI service is temporarily unavailable. Please retry shortly.");
}
