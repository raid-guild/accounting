import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { getAuthSession, serializeSession } from "@/lib/auth/session";
import { isQuarterExportReady } from "@/lib/quarter-export-readiness";
import { getQuarterReportData } from "@/lib/quarter-report";
import { listQuarterReportingPeriods } from "@/lib/quarters";
import { planReportAssistantQuery } from "@/lib/report-assistant/openai-planner";
import { guardReportAssistantPrompt } from "@/lib/report-assistant/prompt-guard";
import { executeReportAssistantPlan } from "@/lib/report-assistant/query-executor";
import {
  checkReportAssistantRateLimit,
  ReportAssistantRateLimitError,
} from "@/lib/report-assistant/rate-limit";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;

const CLIENT_SAFE_ERROR_MESSAGES = new Set([
  "Ask a report question first.",
  "Ask a shorter report question.",
  "Ask a question about published report totals or rankings.",
]);

function getActorLogIdentifier(address: string | null) {
  if (!address) {
    return null;
  }

  return createHash("sha256")
    .update(address.toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getAssistantErrorResponse(error: unknown) {
  if (error instanceof ReportAssistantRateLimitError) {
    return errorResponse(error.message, 429);
  }

  if (
    error instanceof Error &&
    CLIENT_SAFE_ERROR_MESSAGES.has(error.message)
  ) {
    return errorResponse(error.message, 400);
  }

  return errorResponse("Report assistant failed.", 500);
}

export async function POST(request: Request, { params }: RouteParams) {
  const session = serializeSession(await getAuthSession());

  if (!session.authenticated || !session.permissions?.canAccess) {
    return errorResponse("Member access required.", 401);
  }

  const { id } = await params;
  const quarter = (await listQuarterReportingPeriods()).find(
    (item) => item.id === id,
  );

  if (!quarter) {
    return errorResponse("Report not found.", 404);
  }

  if (quarter.status !== "published" || !isQuarterExportReady(quarter)) {
    return errorResponse("The assistant only supports published reports.", 403);
  }

  try {
    await checkReportAssistantRateLimit({
      key: `${session.address ?? "unknown"}:${id}`,
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    const payload = (await request.json().catch(() => null)) as {
      prompt?: unknown;
    } | null;
    const prompt = guardReportAssistantPrompt(payload?.prompt);
    const plan = await planReportAssistantQuery({ prompt });
    const report = await getQuarterReportData(quarter);
    const result = executeReportAssistantPlan({ plan, quarter, report });

    console.info("report_assistant_query", {
      actorWalletHash: getActorLogIdentifier(session.address),
      chart: plan.chart,
      grouping: result.provenance.grouping,
      intent: plan.intent,
      limit: plan.limit,
      promptLength: prompt.length,
      quarterId: quarter.id,
      resultRows: result.table.length,
      unsupportedReason: plan.unsupportedReason,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.warn("report_assistant_error", {
      actorWalletHash: getActorLogIdentifier(session.address),
      error: error instanceof Error ? error.message : "Unknown error",
      quarterId: quarter.id,
    });

    return getAssistantErrorResponse(error);
  }
}
