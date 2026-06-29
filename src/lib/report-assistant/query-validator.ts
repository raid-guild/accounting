import "server-only";

import {
  REPORT_ASSISTANT_INTENTS,
  type ReportAssistantChartType,
  type ReportAssistantIntent,
  type ReportAssistantPlan,
  type ReportAssistantUnsupportedReason,
} from "@/lib/report-assistant/types";

const CHART_TYPES = ["bar", "pie", "table", null] as const;
const UNSUPPORTED_REASONS = [
  "outside_report_data",
  "small_talk",
  "nonsense",
  null,
] as const;

function isIntent(value: unknown): value is ReportAssistantIntent {
  return (
    typeof value === "string" &&
    REPORT_ASSISTANT_INTENTS.includes(value as ReportAssistantIntent)
  );
}

function isChartType(value: unknown): value is ReportAssistantChartType {
  return CHART_TYPES.includes(value as ReportAssistantChartType);
}

function isUnsupportedReason(
  value: unknown,
): value is ReportAssistantUnsupportedReason {
  return UNSUPPORTED_REASONS.includes(value as ReportAssistantUnsupportedReason);
}

function normalizeLimit(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value) || typeof value !== "number") {
    throw new Error("Unsupported report query limit.");
  }

  return Math.min(Math.max(value, 1), 10);
}

export function validateReportAssistantPlan(value: unknown): ReportAssistantPlan {
  if (!value || typeof value !== "object") {
    throw new Error("Unsupported report query.");
  }

  const candidate = value as Record<string, unknown>;

  if (!isIntent(candidate.intent)) {
    throw new Error("Unsupported report question.");
  }

  if (!isChartType(candidate.chart)) {
    throw new Error("Unsupported chart request.");
  }

  if (!isUnsupportedReason(candidate.unsupportedReason)) {
    throw new Error("Unsupported report question.");
  }

  return {
    chart: candidate.chart,
    intent: candidate.intent,
    limit: normalizeLimit(candidate.limit),
    unsupportedReason: candidate.unsupportedReason,
  };
}
