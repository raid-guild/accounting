"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/ui/toast";

type RaidToastError =
  | "duplicate-address"
  | "invalid-address"
  | "invalid-chain"
  | "missing-address";
type RaidToastSubject = "address" | "client" | "raid" | "subcontractor";

function getSubjectLabel(subject: RaidToastSubject) {
  if (subject === "subcontractor") {
    return "Subcontractor";
  }

  if (subject === "raid") {
    return "Raid";
  }

  if (subject === "address") {
    return "Address";
  }

  return "Client";
}

function getErrorMessage(error: RaidToastError) {
  if (error === "duplicate-address") {
    return "That address is already assigned to an entity.";
  }

  if (error === "invalid-address") {
    return "Enter a valid EVM address.";
  }

  if (error === "invalid-chain") {
    return "Chain ID must be a whole number.";
  }

  return "Address is required.";
}

export function RaidManagementToast({
  added,
  deleted,
  error,
  flow,
}: {
  added: RaidToastSubject | null;
  deleted: RaidToastSubject | null;
  error: RaidToastError | null;
  flow: "client" | "raid" | "subcontractor" | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const shownToastKey = useRef<string | null>(null);

  useEffect(() => {
    const toastKey = `${added ?? ""}:${deleted ?? ""}:${error ?? ""}:${flow ?? ""}`;

    if (toastKey === ":::" || shownToastKey.current === toastKey) {
      return;
    }

    shownToastKey.current = toastKey;

    if (added) {
      showToast(`${getSubjectLabel(added)} added.`);
      router.replace("/raids", { scroll: false });
      return;
    }

    if (deleted) {
      showToast(`${getSubjectLabel(deleted)} permanently deleted.`);
      router.replace("/raids", { scroll: false });
      return;
    }

    if (error) {
      showToast(getErrorMessage(error));
      router.replace(flow ? `/raids?flow=${flow}` : "/raids", {
        scroll: false,
      });
    }
  }, [added, deleted, error, flow, router, showToast]);

  return null;
}
