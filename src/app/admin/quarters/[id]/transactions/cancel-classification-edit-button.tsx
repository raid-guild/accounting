"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

export function CancelClassificationEditButton() {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={(event) => {
        const details = event.currentTarget.closest("details");

        if (details) {
          details.open = false;
        }
      }}
    >
      <X data-icon="inline-start" />
      Cancel
    </Button>
  );
}
