"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/ui/toast";

type ProviderToastError =
  | "duplicate-address"
  | "invalid-address"
  | "invalid-chain"
  | "missing-address";
type ProviderToastSubject = "address" | "provider";

function getSubjectLabel(subject: ProviderToastSubject) {
  return subject === "address" ? "Address" : "Provider";
}

function getErrorMessage(error: ProviderToastError) {
  if (error === "duplicate-address") {
    return "That address is already assigned to an entity.";
  }

  if (error === "invalid-address") {
    return "Enter a valid EVM address.";
  }

  if (error === "invalid-chain") {
    return "Chain ID must be a positive whole number.";
  }

  return "Address is required.";
}

export function ProviderManagementToast({
  added,
  error,
}: {
  added: ProviderToastSubject | null;
  error: ProviderToastError | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const shownToastKey = useRef<string | null>(null);

  useEffect(() => {
    const toastKey = `${added ?? ""}:${error ?? ""}`;

    if (!added && !error) {
      shownToastKey.current = null;
      return;
    }

    if (shownToastKey.current === toastKey) {
      return;
    }

    shownToastKey.current = toastKey;

    if (added) {
      showToast(`${getSubjectLabel(added)} added.`);
      router.replace("/admin/providers", { scroll: false });
      return;
    }

    if (error) {
      showToast(getErrorMessage(error));
      router.replace("/admin/providers", { scroll: false });
    }
  }, [added, error, router, showToast]);

  return null;
}
