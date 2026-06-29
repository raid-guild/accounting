import { NextResponse } from "next/server";

import { getAuthSession, serializeSession } from "@/lib/auth/session";
import { isQuarterExportReady } from "@/lib/quarter-export-readiness";
import { getQuarterReportData } from "@/lib/quarter-report";
import { listQuarterReportingPeriods } from "@/lib/quarters";
import { planReportAssistantQuery } from "@/lib/report-assistant/openai-planner";
import { guardReportAssistantPrompt } from "@/lib/report-assistant/prompt-guard";
import { executeReportAssistantPlan } from "@/lib/report-assistant/query-executor";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string) {
  const now = Date.now();
  const current = rateLimits.get(key);

  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    throw new Error("Report assistant rate limit reached. Try again in a minute.");
  }

  current.count += 1;
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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
    checkRateLimit(`${session.address ?? "unknown"}:${id}`);
    const payload = (await request.json().catch(() => null)) as {
      prompt?: unknown;
    } | null;
    const prompt = guardReportAssistantPrompt(payload?.prompt);
    const plan = await planReportAssistantQuery({ prompt });
    const report = await getQuarterReportData(quarter);
    const result = executeReportAssistantPlan({ plan, quarter, report });

    console.info("report_assistant_query", {
      actorWalletAddress: session.address ?? null,
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
      actorWalletAddress: session.address ?? null,
      error: error instanceof Error ? error.message : "Unknown error",
      quarterId: quarter.id,
    });

    return errorResponse(
      error instanceof Error ? error.message : "Report assistant failed.",
      error instanceof Error && error.message.includes("rate limit") ? 429 : 400,
    );
  }
}
