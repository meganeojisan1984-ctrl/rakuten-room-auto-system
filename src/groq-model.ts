export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

type EnvLike = Record<string, string | undefined>;

export function resolveGroqModel(env: EnvLike = process.env, envKey = "GROQ_MODEL"): string {
  const configured = env[envKey]?.trim();
  return configured || DEFAULT_GROQ_MODEL;
}
