import { withX402 } from "@x402/next";
import { NextRequest, NextResponse } from "next/server";

import { isQuarterExportReady } from "@/lib/quarter-export-readiness";
import { getQuarterReportData } from "@/lib/quarter-report";
import { listQuarterReportingPeriods } from "@/lib/quarters";
import {
  MachineApiAuthError,
  verifyMachineApiRequest,
} from "@/lib/machine-api/auth";
import {
  MachineApiNonceError,
} from "@/lib/machine-api/nonces";
import {
  MachineApiRateLimitError,
  checkMachineApiRateLimit,
} from "@/lib/machine-api/rate-limit";
import { getMachineReportSlice } from "@/lib/machine-api/report-slices";
import { createAccountingX402Server } from "@/lib/machine-api/x402";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getMachineApiErrorResponse(error: unknown) {
  if (error instanceof MachineApiAuthError) {
    return errorResponse(error.message, error.status);
  }

  if (error instanceof MachineApiNonceError) {
    return errorResponse(error.message, 409);
  }

  if (error instanceof MachineApiRateLimitError) {
    return errorResponse(error.message, 429);
  }

  if (error instanceof Error) {
    return errorResponse(error.message, 500);
  }

  return errorResponse("Machine API request failed.", 500);
}

async function handler(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const quarter = (await listQuarterReportingPeriods()).find(
    (item) => item.id === id,
  );

  if (!quarter) {
    return errorResponse("Report not found.", 404);
  }

  if (quarter.status !== "published" || !isQuarterExportReady(quarter)) {
    return errorResponse("Only published reports are available.", 403);
  }

  try {
    const payload = (await request.json().catch(() => null)) as {
      auth?: unknown;
      reportSlice?: unknown;
    } | null;

    if (!payload || typeof payload.auth !== "object" || !payload.auth) {
      return errorResponse("Machine API auth payload is required.", 400);
    }

    const resource = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const verified = await verifyMachineApiRequest({
      auth: payload.auth,
      method: request.method,
      quarterId: quarter.id,
      reportSlice: payload.reportSlice,
      resource,
    });

    await checkMachineApiRateLimit({
      key: `${verified.delegator}:${verified.agent}`,
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const report = await getQuarterReportData(quarter);
    const response = getMachineReportSlice({
      quarter,
      report,
      reportSlice: verified.reportSlice,
    });

    return NextResponse.json({
      ...response,
      access: {
        agent: verified.agent,
        delegatedBy: verified.delegator,
      },
    });
  } catch (error) {
    return getMachineApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteParams) {
  try {
    const { config, server } = createAccountingX402Server();
    const paidHandler = withX402<unknown>(
      (paidRequest) => handler(paidRequest, context),
      {
        accepts: {
          maxTimeoutSeconds: config.maxTimeoutSeconds,
          network: config.network,
          payTo: config.payTo,
          price: config.price,
          scheme: "exact",
        },
        description: config.description,
      },
      server,
    );

    return await paidHandler(request);
  } catch (error) {
    return getMachineApiErrorResponse(error);
  }
}
