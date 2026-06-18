import type { QuarterReportingPeriod } from "@/lib/quarters";
import { isQuarterSyncFresh } from "@/lib/quarter-sync";
import { isQuarterBalanceValidationSatisfied } from "@/lib/quarter-balance-validation";

export function isQuarterExportReady(
  quarter: Pick<
    QuarterReportingPeriod,
    "balanceValidation" | "classificationSummary" | "endsOn" | "syncStatus"
  >,
) {
  return (
    isQuarterSyncFresh({ quarter, syncStatus: quarter.syncStatus }) &&
    quarter.syncStatus?.balancesStatus === "success" &&
    quarter.classificationSummary.unclassifiedTransfers === 0 &&
    isQuarterBalanceValidationSatisfied(quarter.balanceValidation)
  );
}
