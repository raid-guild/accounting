import "server-only";

import { validateReportAssistantPlan } from "@/lib/report-assistant/query-validator";
import type { ReportAssistantPlan } from "@/lib/report-assistant/types";

const DEFAULT_MODEL = "gpt-4.1-mini";
const OUTSIDE_REPORT_DATA_PATTERNS = [
  /\b(new\s+members?|member\s+joins?|members?\s+joined|membership|joined\s+this\s+quarter)\b/i,
  /\b(proposal\s+details?|daohaus|votes?|voting)\b/i,
  /\b(raw\s+transactions?|transaction\s+hashes?|wallet\s+addresses?|individual\s+members?)\b/i,
];
const NONSENSE_PATTERNS = [
  /\b(weather|recipe|sports|capital\s+of|tell\s+me\s+a\s+joke)\b/i,
  /^[^a-z0-9]*$/i,
  /^[a-z]{1,2}$/i,
];
const SMALL_TALK_PATTERNS = [
  /^(hello|hi|hey|gm|good\s+(morning|afternoon|evening)|yo)[.!?\s]*$/i,
  /^(thanks|thank\s+you|ok|okay|cool|nice)[.!?\s]*$/i,
];
const BEST_REVENUE_MONTH_PATTERN =
  /\b(best|top|highest|largest|most)\s+month\b.*\brevenue\b|\brevenue\b.*\b(best|top|highest|largest|most)\s+month\b/i;
const REVENUE_BY_MONTH_PATTERN =
  /\brevenue\b.*\b(by|per|each)\s+month\b|\bmonthly\s+revenue\b/i;
const BEST_EXPENSE_MONTH_PATTERN =
  /\b(best|top|highest|largest|most)\s+month\b.*\b(expenses?|spend|spending|costs?)\b|\b(expenses?|spend|spending|costs?)\b.*\b(best|top|highest|largest|most)\s+month\b/i;
const EXPENSES_BY_MONTH_PATTERN =
  /\b(expenses?|spend|spending|costs?)\b.*\b(by|per|each)\s+month\b|\bmonthly\s+(expenses?|spend|spending|costs?)\b/i;

const PLAN_SCHEMA = {
  additionalProperties: false,
  properties: {
    chart: {
      enum: ["bar", "pie", "table", null],
      type: ["string", "null"],
    },
    intent: {
      enum: [
        "quarter_summary",
        "top_raids_by_revenue",
        "top_clients_by_revenue",
        "top_subcontractors_by_payout",
        "top_providers_by_expense",
        "expenses_by_category",
        "revenue_by_month",
        "expenses_by_month",
        "unsupported_report_question",
      ],
      type: "string",
    },
    limit: {
      maximum: 10,
      minimum: 1,
      type: ["integer", "null"],
    },
    unsupportedReason: {
      enum: ["outside_report_data", "small_talk", "nonsense", null],
      type: ["string", "null"],
    },
  },
  required: ["intent", "limit", "chart", "unsupportedReason"],
  type: "object",
} as const;

function extractOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const output = Array.isArray(response.output) ? response.output : [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];

    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }

      const text = (contentItem as Record<string, unknown>).text;

      if (typeof text === "string") {
        return text;
      }
    }
  }

  return null;
}

function getPlannerModel() {
  return process.env.OPENAI_REPORT_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL;
}

function getUnsupportedPlan(prompt: string): ReportAssistantPlan | null {
  if (SMALL_TALK_PATTERNS.some((pattern) => pattern.test(prompt))) {
    return {
      chart: null,
      intent: "unsupported_report_question",
      limit: null,
      unsupportedReason: "small_talk",
    };
  }

  if (OUTSIDE_REPORT_DATA_PATTERNS.some((pattern) => pattern.test(prompt))) {
    return {
      chart: null,
      intent: "unsupported_report_question",
      limit: null,
      unsupportedReason: "outside_report_data",
    };
  }

  if (NONSENSE_PATTERNS.some((pattern) => pattern.test(prompt))) {
    return {
      chart: null,
      intent: "unsupported_report_question",
      limit: null,
      unsupportedReason: "nonsense",
    };
  }

  return null;
}

function getDeterministicPlan(prompt: string): ReportAssistantPlan | null {
  if (BEST_REVENUE_MONTH_PATTERN.test(prompt)) {
    return {
      chart: null,
      intent: "revenue_by_month",
      limit: 1,
      unsupportedReason: null,
    };
  }

  if (REVENUE_BY_MONTH_PATTERN.test(prompt)) {
    return {
      chart: null,
      intent: "revenue_by_month",
      limit: null,
      unsupportedReason: null,
    };
  }

  if (BEST_EXPENSE_MONTH_PATTERN.test(prompt)) {
    return {
      chart: null,
      intent: "expenses_by_month",
      limit: 1,
      unsupportedReason: null,
    };
  }

  if (EXPENSES_BY_MONTH_PATTERN.test(prompt)) {
    return {
      chart: null,
      intent: "expenses_by_month",
      limit: null,
      unsupportedReason: null,
    };
  }

  return null;
}

export async function planReportAssistantQuery({
  prompt,
}: {
  prompt: string;
}): Promise<ReportAssistantPlan> {
  const deterministicPlan = getDeterministicPlan(prompt);

  if (deterministicPlan) {
    return deterministicPlan;
  }

  const unsupportedPlan = getUnsupportedPlan(prompt);

  if (unsupportedPlan) {
    return unsupportedPlan;
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for the report assistant.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: [
        {
          content:
            [
              "You convert RaidGuild published accounting report questions into one allowed JSON query plan.",
              "Prefer concise text answers. Set chart to null unless the user explicitly asks for a chart, graph, visual, plot, or breakdown visualization.",
              "Use limit 1 for winner questions such as 'which', 'who', 'most', 'highest', 'largest', or 'top subcontractor'.",
              "Use revenue_by_month for questions about best revenue month, highest revenue month, monthly revenue, or revenue by month.",
              "Use expenses_by_month for questions about highest expense month, most expensive month, monthly expenses, spending by month, or expenses by month.",
              "Use the requested limit for top-N questions. If no limit is stated for a ranking/list question, use 5.",
              "Use unsupported_report_question with unsupportedReason outside_report_data when the question asks about data not in this published report analysis surface, including member joins, new members, individual members, proposal details, raw transactions, wallet identity, or private/internal context.",
              "Use unsupported_report_question with unsupportedReason small_talk for greetings, thanks, acknowledgements, or other conversational messages that are not report questions.",
              "Use unsupported_report_question with unsupportedReason nonsense when the question is gibberish, a joke request, unrelated trivia, or not an accounting/report question.",
              "Only use ranking, summary, and chart intents. Never request raw records, secrets, audit metadata, draft data, SQL, or database access.",
            ].join(" "),
          role: "developer",
        },
        {
          content: `Question: ${prompt}`,
          role: "user",
        },
      ],
      max_output_tokens: 250,
      model: getPlannerModel(),
      store: false,
      text: {
        format: {
          name: "report_assistant_plan",
          schema: PLAN_SCHEMA,
          strict: true,
          type: "json_schema",
        },
      },
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : "OpenAI planner request failed.";

    throw new Error(message);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI planner returned an empty response.");
  }

  return validateReportAssistantPlan(JSON.parse(outputText));
}
