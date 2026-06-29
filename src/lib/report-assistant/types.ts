export const REPORT_ASSISTANT_INTENTS = [
  "quarter_summary",
  "top_raids_by_revenue",
  "top_clients_by_revenue",
  "top_subcontractors_by_payout",
  "top_providers_by_expense",
  "expenses_by_category",
  "revenue_by_month",
  "expenses_by_month",
  "unsupported_report_question",
] as const;

export type ReportAssistantIntent = (typeof REPORT_ASSISTANT_INTENTS)[number];

export type ReportAssistantChartType = "bar" | "pie" | "table" | null;
export type ReportAssistantUnsupportedReason =
  | "outside_report_data"
  | "small_talk"
  | "nonsense"
  | null;

export type ReportAssistantPlan = {
  chart: ReportAssistantChartType;
  intent: ReportAssistantIntent;
  limit: number | null;
  unsupportedReason: ReportAssistantUnsupportedReason;
};

export type ReportAssistantTableRow = {
  entries?: number;
  label: string;
  value: number;
};

export type ReportAssistantChart = {
  rows: ReportAssistantTableRow[];
  title: string;
  type: Exclude<ReportAssistantChartType, null | "table">;
};

export type ReportAssistantProvenance = {
  grouping: string;
  lastPublishedAt: string | null;
  metric: string;
  quarter: string;
};

export type ReportAssistantResponse = {
  answer: string;
  chart: ReportAssistantChart | null;
  plan: ReportAssistantPlan;
  provenance: ReportAssistantProvenance;
  table: ReportAssistantTableRow[];
};
