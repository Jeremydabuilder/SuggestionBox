import { serverEnv } from "./env.ts";
import { buildMeetingPrompt, parseMeetingBrief, type AnonymousSuggestion, type MeetingScope } from "./meeting-agent.ts";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models";
const DEFAULT_MODELS = ["openai/gpt-oss-20b", "llama-3.1-8b-instant"];

export class GroqRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function rankGroqModels(available: string[], override?: string) {
  const availableSet = new Set(available);
  const compatible = available.filter((id) =>
    /(gpt-oss|llama.*(?:instruct|instant|versatile)|qwen.*(?:instruct|32b|27b))/i.test(id) &&
    !/(guard|prompt-guard|whisper|audio|tts|distil)/i.test(id),
  );
  const preferred = [override, ...DEFAULT_MODELS, ...compatible].filter(Boolean) as string[];
  return [...new Set(preferred)].filter((id) => available.length === 0 || availableSet.has(id)).slice(0, 4);
}

let discoveredModels: Promise<string[]> | null = null;

async function candidateModels() {
  if (!discoveredModels) {
    discoveredModels = fetch(GROQ_MODELS_ENDPOINT, {
      headers: { authorization: `Bearer ${serverEnv.groqApiKey}` },
      signal: AbortSignal.timeout(8_000),
    })
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = await response.json() as { data?: Array<{ id?: string }> };
        return (payload.data ?? []).map((model) => model.id).filter(Boolean) as string[];
      })
      .catch(() => []);
  }
  const available = await discoveredModels;
  const ranked = rankGroqModels(available, serverEnv.groqModel);
  return ranked.length > 0 ? ranked : rankGroqModels([], serverEnv.groqModel);
}

async function askModel(model: string, records: AnonymousSuggestion[], scope: MeetingScope) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serverEnv.groqApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_completion_tokens: 2400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a precise planning agent. Follow privacy and output-format rules exactly.",
          },
          { role: "user", content: buildMeetingPrompt(records, scope) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Never log or return the upstream body: providers sometimes echo
      // request details, and student suggestions belong only in the panel.
      throw new GroqRequestError(`Groq returned HTTP ${response.status}.`, response.status);
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("The model returned an empty response.");
    return parseMeetingBrief(content);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateMeetingBrief(records: AnonymousSuggestion[], scope: MeetingScope) {
  let lastError: unknown;
  for (const model of await candidateModels()) {
    try {
      return { brief: await askModel(model, records, scope), model };
    } catch (error) {
      lastError = error;
      // A missing/retired/incompatible model should not break the feature:
      // try the next known low-cost model. Auth and quota errors will not be
      // fixed by another model, so stop without burning another request.
      if (!(error instanceof GroqRequestError) || ![400, 404, 422].includes(error.status)) throw error;
    }
  }
  throw lastError ?? new Error("No compatible Groq model was available.");
}

/** The hard ceiling: configured model, plus at most one explicit fallback. Never more. */
export const CLASSIFIER_MAX_REQUESTS = 2;

export type ClassifierErrorCategory =
  | "rate_limited"
  | "unauthorized"
  | "upstream_error"
  | "timeout"
  | "network_error"
  | "no_compatible_model";

export type ClassifierCallOutcome =
  | { ok: true; content: string; model: string; requestCount: number }
  | { ok: false; requestCount: number; errorCategory: ClassifierErrorCategory };

function classifierErrorCategory(error: unknown): ClassifierErrorCategory {
  if (error instanceof GroqRequestError) {
    if (error.status === 429) return "rate_limited";
    if (error.status === 401 || error.status === 403) return "unauthorized";
    return "upstream_error";
  }
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "network_error";
}

/**
 * Bounded classifier completion: the configured model gets exactly one
 * request. If — and only if — that model itself is unavailable or
 * incompatible (400/404/422, the same "this model doesn't exist/doesn't
 * support this request" signal generateMeetingBrief already treats as
 * model-not-request trouble), this makes exactly one more request to a
 * single explicit fallback (the next entry in the ranked candidate list)
 * and stops — it never cycles through the full four-model list the way
 * generateMeetingBrief does. A rate limit, auth failure, timeout, or
 * network error on either attempt is NOT retried with another model —
 * those aren't fixed by a different model, and every caller gets back the
 * exact number of requests actually made (0, 1, or 2), never a silent
 * unbounded retry loop.
 */
export async function generateClassifierCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<ClassifierCallOutcome> {
  const candidates = await candidateModels();
  const primary = candidates[0];
  if (!primary) return { ok: false, requestCount: 0, errorCategory: "no_compatible_model" };

  let requestCount = 0;
  try {
    requestCount += 1;
    const content = await askJsonModel(primary, systemPrompt, userPrompt, options);
    return { ok: true, content, model: primary, requestCount };
  } catch (error) {
    if (!(error instanceof GroqRequestError) || ![400, 404, 422].includes(error.status)) {
      return { ok: false, requestCount, errorCategory: classifierErrorCategory(error) };
    }

    const fallback = candidates[1];
    if (!fallback) return { ok: false, requestCount, errorCategory: "no_compatible_model" };

    try {
      requestCount += 1;
      const content = await askJsonModel(fallback, systemPrompt, userPrompt, options);
      return { ok: true, content, model: fallback, requestCount };
    } catch (fallbackError) {
      // Both the primary and the one allowed fallback turned out to be
      // model-incompatible — call that what it is rather than a generic
      // upstream error, even though no third attempt will be made.
      const category =
        fallbackError instanceof GroqRequestError && [400, 404, 422].includes(fallbackError.status)
          ? "no_compatible_model"
          : classifierErrorCategory(fallbackError);
      return { ok: false, requestCount, errorCategory: category };
    }
  }
}

async function askJsonModel(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number; timeoutMs?: number },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serverEnv.groqApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: options.maxTokens ?? 300,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new GroqRequestError(`Groq returned HTTP ${response.status}.`, response.status);
    }

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("The model returned an empty response.");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** The hard ceiling for a single Ask the Inbox answer: configured model, plus at most one explicit fallback. Never more. */
export const ANSWER_MAX_REQUESTS = 2;

/**
 * The same bounded configured-model-plus-one-fallback shape as
 * generateClassifierCompletion above, kept as its own function (rather
 * than sharing one implementation) so a change to one call site can never
 * silently change the other's tested request-count guarantee. Used only
 * by general_workspace_question ("Ask the Inbox") — a plain-text answer,
 * not JSON, so no response_format is requested and no JSON parsing
 * happens here; the caller (chat-answer.ts) is responsible for citation
 * validation against its own retrieved-evidence allowlist.
 */
export async function generateAnswerCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<ClassifierCallOutcome> {
  const candidates = await candidateModels();
  const primary = candidates[0];
  if (!primary) return { ok: false, requestCount: 0, errorCategory: "no_compatible_model" };

  let requestCount = 0;
  try {
    requestCount += 1;
    const content = await askTextModel(primary, systemPrompt, userPrompt, options);
    return { ok: true, content, model: primary, requestCount };
  } catch (error) {
    if (!(error instanceof GroqRequestError) || ![400, 404, 422].includes(error.status)) {
      return { ok: false, requestCount, errorCategory: classifierErrorCategory(error) };
    }

    const fallback = candidates[1];
    if (!fallback) return { ok: false, requestCount, errorCategory: "no_compatible_model" };

    try {
      requestCount += 1;
      const content = await askTextModel(fallback, systemPrompt, userPrompt, options);
      return { ok: true, content, model: fallback, requestCount };
    } catch (fallbackError) {
      const category =
        fallbackError instanceof GroqRequestError && [400, 404, 422].includes(fallbackError.status)
          ? "no_compatible_model"
          : classifierErrorCategory(fallbackError);
      return { ok: false, requestCount, errorCategory: category };
    }
  }
}

async function askTextModel(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number; timeoutMs?: number },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serverEnv.groqApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_completion_tokens: options.maxTokens ?? 400,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new GroqRequestError(`Groq returned HTTP ${response.status}.`, response.status);
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("The model returned an empty response.");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export function meetingAgentError(error: unknown): string {
  if (error instanceof GroqRequestError) {
    if (error.status === 401 || error.status === 403) return "The private Groq key is missing or invalid. Update GROQ_API_KEY in Render.";
    if (error.status === 429) return "The free AI limit is busy or used up. Wait a little and try again—your dashboard still works.";
  }
  if (error instanceof Error && error.name === "AbortError") return "The meeting agent took too long. Try again in a moment.";
  return "The meeting agent could not prepare a brief just now. No suggestions were changed.";
}
