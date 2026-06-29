import "server-only";

const MAX_PROMPT_LENGTH = 500;
const BLOCKED_PATTERNS = [
  /\bignore\b.*\b(instruction|system|developer|previous)\b/i,
  /\bshow\b.*\b(secret|api key|private key|env|password)\b/i,
  /\b(sql|database|schema|table)\b.*\b(query|dump|raw|select|insert|update|delete)\b/i,
  /\bdecrypt(ed)?\b/i,
  /\baudit[- ]only\b/i,
];

export function guardReportAssistantPrompt(prompt: unknown) {
  if (typeof prompt !== "string") {
    throw new Error("Ask a report question first.");
  }

  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();

  if (!normalizedPrompt) {
    throw new Error("Ask a report question first.");
  }

  if (normalizedPrompt.length > MAX_PROMPT_LENGTH) {
    throw new Error("Ask a shorter report question.");
  }

  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(normalizedPrompt))) {
    throw new Error("Ask a question about published report totals or rankings.");
  }

  return normalizedPrompt;
}
