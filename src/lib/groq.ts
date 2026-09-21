import { serverEnv } from "./env.ts";
import { buildMeetingPrompt, parseMeetingBrief, type AnonymousSuggestion, type MeetingScope } from "./meeting-agent.ts";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models";
const DEFAULT_MODELS = ["openai/gpt-oss-20b", "llama-3.1-8b-instant"];

class GroqRequestError extends Error {
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

export function meetingAgentError(error: unknown): string {
  if (error instanceof GroqRequestError) {
    if (error.status === 401 || error.status === 403) return "The private Groq key is missing or invalid. Update GROQ_API_KEY in Render.";
    if (error.status === 429) return "The free AI limit is busy or used up. Wait a little and try again—your dashboard still works.";
  }
  if (error instanceof Error && error.name === "AbortError") return "The meeting agent took too long. Try again in a moment.";
  return "The meeting agent could not prepare a brief just now. No suggestions were changed.";
}
