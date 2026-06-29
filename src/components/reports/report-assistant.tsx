"use client";

import { Bot, Pin, PinOff, Send, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ReportAssistantResponse } from "@/lib/report-assistant/types";

type ReportAssistantProps = {
  quarterId: string;
  walletAddress: string | null;
};

const SUGGESTED_PROMPTS = [
  "What were our top 5 raids by revenue?",
  "Which clients brought in the most revenue?",
  "Which subcontractor had the highest payout?",
  "Which providers had the highest expenses?",
  "Summarize revenue, expenses, spoils, and net.",
];
const NON_REPORT_PROMPT_PATTERNS = [
  /^(hello|hi|hey|gm|good\s+(morning|afternoon|evening)|yo)[.!?\s]*$/i,
  /^(thanks|thank\s+you|ok|okay|cool|nice)[.!?\s]*$/i,
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function getPinnedStorageKey(quarterId: string, walletAddress: string | null) {
  return `raidguild-report-assistant:${quarterId}:${walletAddress ?? "member"}`;
}

function getStoredPinnedResponses(storageKey: string) {
  try {
    const stored = window.localStorage.getItem(storageKey);

    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);

    return Array.isArray(parsed) ? (parsed as ReportAssistantResponse[]) : [];
  } catch {
    return [];
  }
}

function getResponseKey(response: ReportAssistantResponse) {
  return [
    response.plan.intent,
    response.plan.limit ?? "all",
    response.plan.chart ?? "none",
    response.plan.unsupportedReason ?? "supported",
    response.provenance.metric,
    response.provenance.grouping,
  ].join(":");
}

function MiniChart({ response }: { response: ReportAssistantResponse }) {
  if (!response.chart || response.chart.rows.length === 0) {
    return null;
  }

  const total = response.chart.rows.reduce((sum, row) => sum + row.value, 0);
  const max = Math.max(...response.chart.rows.map((row) => row.value), 1);

  if (response.chart.type === "pie") {
    return (
      <div className="mt-4 grid gap-2">
        {response.chart.rows.map((row, index) => (
          <div key={`${row.label}-${index}`} className="grid gap-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-medium">{row.label}</span>
              <span className="text-muted-foreground">
                {total > 0 ? `${Math.round((row.value / total) * 100)}%` : "0%"}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${total > 0 ? Math.max((row.value / total) * 100, 2) : 0}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-2">
      {response.chart.rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="grid gap-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium">{row.label}</span>
            <span className="text-muted-foreground">
              {formatCurrency(row.value)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max((row.value / max) * 100, 2)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function AssistantCard({
  isPinned,
  onPinToggle,
  response,
}: {
  isPinned: boolean;
  onPinToggle: () => void;
  response: ReportAssistantResponse;
}) {
  return (
    <article className="rounded-md border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="type-label-sm text-muted-foreground">
            {response.provenance.metric} by {response.provenance.grouping}
          </p>
          <p className="mt-2 text-sm leading-6">{response.answer}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onPinToggle}
          aria-label={isPinned ? "Unpin widget" : "Pin widget"}
          title={isPinned ? "Unpin widget" : "Pin widget"}
        >
          {isPinned ? <PinOff /> : <Pin />}
        </Button>
      </div>

      {response.table.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[360px] text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 text-right font-medium">Entries</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {response.table.map((row, index) => (
                <tr key={`${row.label}-${index}`}>
                  <td className="px-3 py-2 font-medium">{row.label}</td>
                  <td className="px-3 py-2 text-right">
                    {row.entries ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatCurrency(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <MiniChart response={response} />

      <p className="mt-4 text-xs text-muted-foreground">
        Source: {response.provenance.quarter}
        {response.provenance.lastPublishedAt
          ? `, published ${new Intl.DateTimeFormat("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(response.provenance.lastPublishedAt))}`
          : ""}
      </p>
    </article>
  );
}

export function ReportAssistant({
  quarterId,
  walletAddress,
}: ReportAssistantProps) {
  const { showToast } = useToast();
  const storageKey = useMemo(
    () => getPinnedStorageKey(quarterId, walletAddress),
    [quarterId, walletAddress],
  );
  const [prompt, setPrompt] = useState("");
  const [responses, setResponses] = useState<ReportAssistantResponse[]>([]);
  const [pinnedResponses, setPinnedResponses] = useState<
    ReportAssistantResponse[]
  >([]);
  const [isPending, setIsPending] = useState(false);
  const hasLoadedPinnedResponses = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      hasLoadedPinnedResponses.current = true;
      setPinnedResponses(getStoredPinnedResponses(storageKey));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [storageKey]);

  useEffect(() => {
    if (!hasLoadedPinnedResponses.current) {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(pinnedResponses));
  }, [pinnedResponses, storageKey]);

  const pinnedKeys = useMemo(
    () => new Set(pinnedResponses.map(getResponseKey)),
    [pinnedResponses],
  );

  function togglePinned(response: ReportAssistantResponse) {
    const key = getResponseKey(response);

    setPinnedResponses((current) =>
      current.some((item) => getResponseKey(item) === key)
        ? current.filter((item) => getResponseKey(item) !== key)
        : [response, ...current],
    );
  }

  async function askAssistant(nextPrompt = prompt) {
    const trimmedPrompt = nextPrompt.trim();

    if (!trimmedPrompt) {
      showToast("Ask a report question first.");
      return;
    }

    if (NON_REPORT_PROMPT_PATTERNS.some((pattern) => pattern.test(trimmedPrompt))) {
      showToast("Ask a question relevant to this published report.");
      return;
    }

    setIsPending(true);

    try {
      const response = await fetch(
        `/api/reports/quarters/${quarterId}/assistant`,
        {
          body: JSON.stringify({ prompt: trimmedPrompt }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const payload = (await response.json()) as
        | ReportAssistantResponse
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Assistant failed.");
      }

      setResponses((current) => [payload, ...current]);
      setPrompt("");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Assistant failed.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="type-label-sm text-muted-foreground">Assistant</p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Published report analysis
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Ask about published report rankings and totals.
          </p>
        </div>
        <span className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
          Published data only
        </span>
      </div>

      {pinnedResponses.length > 0 ? (
        <div className="mt-5 grid gap-3">
          <p className="type-label-sm text-muted-foreground">Pinned Widgets</p>
          {pinnedResponses.map((response, index) => (
            <AssistantCard
              key={`${getResponseKey(response)}:${index}`}
              isPinned
              onPinToggle={() => togglePinned(response)}
              response={response}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {SUGGESTED_PROMPTS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => void askAssistant(suggestion)}
            disabled={isPending}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void askAssistant();
        }}
      >
        <label className="sr-only" htmlFor="report-assistant-prompt">
          Ask the report assistant
        </label>
        <input
          id="report-assistant-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask about ranked raids, clients, subcontractors, providers, or totals"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          maxLength={500}
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <Bot data-icon="inline-start" />
          ) : (
            <Send data-icon="inline-start" />
          )}
          {isPending ? "Analyzing" : "Ask"}
        </Button>
      </form>

      {responses.length > 0 ? (
        <div className="mt-5 grid gap-3">
          <p className="type-label-sm text-muted-foreground">Answers</p>
          {responses.map((response, index) => (
            <AssistantCard
              key={`${getResponseKey(response)}:${index}`}
              isPinned={pinnedKeys.has(getResponseKey(response))}
              onPinToggle={() => togglePinned(response)}
              response={response}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
