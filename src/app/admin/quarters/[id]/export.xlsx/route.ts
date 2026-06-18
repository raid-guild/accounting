import { getAuthSession, serializeSession } from "@/lib/auth/session";
import { listQuarterReportingPeriods } from "@/lib/quarters";
import {
  buildQuarterXlsxExport,
  getQuarterExportFilename,
} from "@/lib/quarter-xlsx-export";
import { isQuarterExportReady } from "@/lib/quarter-export-readiness";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{
    id: string;
  }>;
};

function responseText(message: string, status: number) {
  return new Response(message, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
    status,
  });
}

export async function GET(_request: Request, { params }: RouteParams) {
  const session = serializeSession(await getAuthSession());

  if (!session.authenticated || !session.permissions?.canAccess) {
    return responseText("Unauthorized", 401);
  }

  const { id } = await params;
  const quarter = (await listQuarterReportingPeriods()).find(
    (item) => item.id === id,
  );

  if (!quarter) {
    return responseText("Quarter not found", 404);
  }

  if (!session.permissions.canAdmin && quarter.status !== "published") {
    return responseText("Quarter is not published", 403);
  }

  if (!isQuarterExportReady(quarter)) {
    return responseText(
      "Quarter export is not ready. Sync activity and classify every transaction first.",
      409,
    );
  }

  const buffer = await buildQuarterXlsxExport(quarter);
  const filename = getQuarterExportFilename(quarter);

  return new Response(buffer, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
