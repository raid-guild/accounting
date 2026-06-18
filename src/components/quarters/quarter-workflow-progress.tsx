import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  LockKeyhole,
} from "lucide-react";

import type { QuarterWorkflowStep } from "@/lib/quarter-sync";

const STEP_TONE: Record<
  QuarterWorkflowStep["status"],
  { className: string; icon: typeof CircleDashed }
> = {
  blocked: {
    className: "border-border bg-background text-muted-foreground",
    icon: LockKeyhole,
  },
  complete: {
    className: "border-emerald-600/25 bg-emerald-600/10 text-emerald-800",
    icon: CheckCircle2,
  },
  current: {
    className: "border-primary/25 bg-primary/10 text-primary",
    icon: CircleDashed,
  },
  failed: {
    className: "border-destructive/25 bg-destructive/10 text-destructive",
    icon: AlertTriangle,
  },
  pending: {
    className: "border-border bg-background text-muted-foreground",
    icon: CircleDashed,
  },
};

export function QuarterWorkflowProgress({
  compact = false,
  steps,
}: {
  compact?: boolean;
  steps: QuarterWorkflowStep[];
}) {
  return (
    <ol
      className={
        compact
          ? "grid gap-2 md:grid-cols-5"
          : "grid gap-3 md:grid-cols-4 xl:grid-cols-5"
      }
    >
      {steps.map((step, index) => {
        const tone = STEP_TONE[step.status];
        const Icon = tone.icon;

        return (
          <li
            key={step.key}
            className={`rounded-md border ${
              compact ? "px-2.5 py-2.5" : "px-3 py-3"
            } ${tone.className}`}
          >
            <div className="flex items-center gap-2">
              <Icon
                className={
                  step.status === "current"
                    ? compact
                      ? "size-3.5 animate-pulse"
                      : "size-4 animate-pulse"
                    : compact
                      ? "size-3.5"
                      : "size-4"
                }
                aria-hidden="true"
              />
              <span
                className={
                  compact ? "text-xs font-semibold" : "type-label-sm"
                }
              >
                {index + 1}. {step.label}
              </span>
            </div>
            <p
              className={
                compact
                  ? "mt-1 text-xs text-current/75"
                  : "mt-2 text-sm text-current/75"
              }
            >
              {step.detail}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
