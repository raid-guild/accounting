import type { QuarterReportingPeriod } from "@/lib/quarters";
import { isQuarterSyncFresh } from "@/lib/quarter-sync";

export function isQuarterExportReady(
  quarter: Pick<
    QuarterReportingPeriod,
    "classificationSummary" | "endsOn" | "syncStatus"
  >,
) {
  return (
    isQuarterSyncFresh({ quarter, syncStatus: quarter.syncStatus }) &&
    quarter.syncStatus?.balancesStatus === "success" &&
    quarter.classificationSummary.unclassifiedTransfers === 0
  );
}
