export interface OpenAiTextResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

export type OpenAiTextClient = (
  body: Record<string, unknown>,
  apiKey: string,
) => Promise<OpenAiTextResponse>;

const DEFAULT_OPENAI_TEXT_MODEL = "gpt-5-mini";

export function resolveOpenAiTextModel(env: Record<string, string | undefined> = process.env): string {
  return env.OPENAI_TEXT_MODEL?.trim() || DEFAULT_OPENAI_TEXT_MODEL;
}

export function buildOpenAiTextRequest(
  prompt: string,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  return {
    model: resolveOpenAiTextModel(env),
    input: prompt,
    max_output_tokens: 1024,
    reasoning: { effort: "minimal" },
  };
}

export function extractOpenAiText(response: OpenAiTextResponse): string {
  const collectText = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(collectText);
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const ownText = typeof record.text === "string" ? [record.text] : [];
    const nestedText = [record.output, record.content].flatMap(collectText);
    return [...ownText, ...nestedText];
  };
  const rawText = response.output_text || collectText(response.output).join("") || "";
  const text = rawText.trim();
  if (!text) throw new Error("OpenAI APIからの応答が空です");
  return text;
}

export const defaultOpenAiTextClient: OpenAiTextClient = async (body, apiKey) => {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI text generation failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<OpenAiTextResponse>;
};
