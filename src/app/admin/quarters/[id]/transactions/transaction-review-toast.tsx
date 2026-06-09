"use client";

import { useEffect } from "react";

import { useToast } from "@/components/ui/toast";

const shownToastKeys = new Set<string>();

export function TransactionReviewToast({
  classifiedId,
  saved,
  syncErrorCount,
  syncImportedCount,
  syncId,
  syncStatus,
}: {
  classifiedId: string | null;
  saved: boolean;
  syncErrorCount: number;
  syncImportedCount: number;
  syncId: string | null;
  syncStatus: "complete" | "partial" | null;
}) {
  const { showToast } = useToast();

  useEffect(() => {
    const classificationToastKey = classifiedId
      ? `classification:${classifiedId}`
      : null;
    const syncToastKey = syncId ? `sync:${syncId}` : null;

    if (
      (classificationToastKey &&
        shownToastKeys.has(classificationToastKey)) ||
      (syncToastKey && shownToastKeys.has(syncToastKey))
    ) {
      return;
    }

    if (syncStatus === "complete") {
      if (syncToastKey) {
        shownToastKeys.add(syncToastKey);
      }

      showToast(
        syncImportedCount > 0
          ? `Quarter transactions synced. ${syncImportedCount} new transfer${syncImportedCount === 1 ? "" : "s"} imported.`
          : "Quarter transactions synced. No new transfers imported.",
      );
    }

    if (syncStatus === "partial") {
      if (syncToastKey) {
        shownToastKeys.add(syncToastKey);
      }

      showToast(
        `Transaction sync finished with ${syncErrorCount} account error${syncErrorCount === 1 ? "" : "s"}.`,
      );
    }

    if (saved) {
      if (classificationToastKey) {
        shownToastKeys.add(classificationToastKey);
      }

      showToast("Transaction classification saved.");
    }
  }, [
    classifiedId,
    saved,
    showToast,
    syncErrorCount,
    syncId,
    syncImportedCount,
    syncStatus,
  ]);

  return null;
}
