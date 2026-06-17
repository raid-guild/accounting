"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import { LinkIcon, Plus, Save, Swords } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  createClassificationProvider,
  createClassificationRaid,
  createClassificationRip,
  createClassificationSubcontractor,
  type InlineCreateState,
} from "@/app/admin/quarters/[id]/transactions/actions";

type QuickCreateFlow = "provider" | "raid" | "rip" | "subcontractor";

type CategoryOption = {
  label: string;
  value: string;
};

type EntityOption = {
  id: string;
  label: string;
  type: "client" | "provider" | "subcontractor";
};

type RaidOption = {
  clientName: string;
  id: string;
  name: string;
};

type RipOption = {
  id: string;
  title: string;
};

function getEntityTypeLabel(type: EntityOption["type"]) {
  if (type === "client") {
    return "Client";
  }

  if (type === "provider") {
    return "Provider";
  }

  return "Subcontractor";
}

export function ClassificationLinkedFields({
  categories,
  children,
  defaultCategory,
  defaultCounterpartyEntityId,
  defaultRaidId,
  defaultRipId,
  entities,
  quarterId,
  rips,
  raids,
}: {
  categories: CategoryOption[];
  children: ReactNode;
  defaultCategory: string | null;
  defaultCounterpartyEntityId: string | null;
  defaultRaidId: string | null;
  defaultRipId: string | null;
  entities: EntityOption[];
  quarterId: string;
  rips: RipOption[];
  raids: RaidOption[];
}) {
  const [category, setCategory] = useState(defaultCategory ?? "");
  const [createFlow, setCreateFlow] = useState<QuickCreateFlow | null>(null);
  const isTreasuryTransfer = category === "treasury_transfer";
  const isRipExpense = category === "rip_expense";
  const isRaidLinkedCategory =
    category === "raid_revenue" ||
    category === "raid_spoils" ||
    category === "subcontractor_payout";
  const isCounterpartyLinkedCategory =
    category === "provider_expense" ||
    category === "raid_revenue" ||
    category === "subcontractor_payout";
  const isRipLinkedCategory = isRipExpense;
  const counterpartyType =
    category === "subcontractor_payout"
      ? "subcontractor"
      : category === "raid_revenue"
        ? "client"
        : category === "provider_expense"
          ? "provider"
          : null;
  const filteredEntities = counterpartyType
    ? entities.filter((entity) => entity.type === counterpartyType)
    : entities;
  const counterpartyDisabled =
    isTreasuryTransfer || !isCounterpartyLinkedCategory;
  const raidDisabled = isTreasuryTransfer || !isRaidLinkedCategory;
  const ripDisabled = isTreasuryTransfer || !isRipLinkedCategory;
  const counterpartyCreateFlow: QuickCreateFlow =
    category === "subcontractor_payout" ? "subcontractor" : "provider";
  const counterpartyCreateLabel =
    counterpartyCreateFlow === "subcontractor"
      ? "Add Subcontractor"
      : "Add Provider";
  const clients = entities.filter((entity) => entity.type === "client");

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Category">
          <select
            name="category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            required
          >
            <option value="">Choose category</option>
            {categories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {children}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          action={
            counterpartyDisabled || counterpartyType === "client" ? null : (
              <button
                type="button"
                onClick={() => setCreateFlow(counterpartyCreateFlow)}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                <Plus className="size-3" aria-hidden="true" />
                {counterpartyCreateLabel}
              </button>
            )
          }
          label="Counterparty"
        >
          <select
            name={counterpartyDisabled ? undefined : "counterpartyEntityId"}
            defaultValue={defaultCounterpartyEntityId ?? ""}
            disabled={counterpartyDisabled}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
          >
            <option value="">
              {counterpartyDisabled
                ? "Not needed for this category"
                : "No entity link"}
            </option>
            {filteredEntities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.label} ({getEntityTypeLabel(entity.type)})
              </option>
            ))}
          </select>
          {counterpartyDisabled ? (
            <input type="hidden" name="counterpartyEntityId" value="" />
          ) : null}
        </Field>
        <Field
          action={
            raidDisabled ? null : (
              <button
                type="button"
                onClick={() => setCreateFlow("raid")}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                <Plus className="size-3" aria-hidden="true" />
                Add Raid
              </button>
            )
          }
          label="Raid"
        >
          <select
            name={raidDisabled ? undefined : "raidId"}
            defaultValue={defaultRaidId ?? ""}
            disabled={raidDisabled}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
          >
            <option value="">
              {raidDisabled ? "Not needed for this category" : "No raid link"}
            </option>
            {raids.map((raid) => (
              <option key={raid.id} value={raid.id}>
                {raid.name} ({raid.clientName})
              </option>
            ))}
          </select>
          {raidDisabled ? (
            <input type="hidden" name="raidId" value="" />
          ) : null}
        </Field>
      </div>
      <Field
        action={
          ripDisabled ? null : (
            <button
              type="button"
              onClick={() => setCreateFlow("rip")}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
            >
              <Plus className="size-3" aria-hidden="true" />
              Add RIP
            </button>
          )
        }
        label="RIP"
      >
        <select
          name={ripDisabled ? undefined : "ripId"}
          defaultValue={defaultRipId ?? ""}
          disabled={ripDisabled}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
        >
          <option value="">
            {ripDisabled ? "Not needed for this category" : "No RIP link"}
          </option>
          {rips.map((rip) => (
            <option key={rip.id} value={rip.id}>
              {rip.title}
            </option>
          ))}
        </select>
        {ripDisabled ? (
          <input type="hidden" name="ripId" value="" />
        ) : null}
      </Field>
      {createFlow ? (
        <QuickCreateDialog
          clients={clients}
          flow={createFlow}
          onClose={() => setCreateFlow(null)}
          quarterId={quarterId}
        />
      ) : null}
    </>
  );
}

function Field({
  action,
  children,
  label,
}: {
  action?: ReactNode;
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="grid min-w-0 gap-2 text-sm font-medium">
      <span className="flex min-h-4 items-center justify-between gap-3">
        <span className="type-label-sm text-muted-foreground">{label}</span>
        {action}
      </span>
      {children}
    </label>
  );
}

function QuickCreateDialog({
  clients,
  flow,
  onClose,
  quarterId,
}: {
  clients: EntityOption[];
  flow: QuickCreateFlow;
  onClose: () => void;
  quarterId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<InlineCreateState>({
    message: "",
    success: false,
  });
  const [isPending, startTransition] = useTransition();
  const isProvider = flow === "provider";
  const isRaid = flow === "raid";
  const isSubcontractor = flow === "subcontractor";
  const title = isProvider
    ? "Add Provider"
    : isSubcontractor
      ? "Add Subcontractor"
      : isRaid
        ? "Add Raid"
        : "Add RIP";

  function submit(formData: FormData) {
    formData.set("quarterId", quarterId);

    startTransition(async () => {
      const result = isProvider
        ? await createClassificationProvider(state, formData)
        : isSubcontractor
          ? await createClassificationSubcontractor(state, formData)
          : isRaid
            ? await createClassificationRaid(state, formData)
            : await createClassificationRip(state, formData);

      setState(result);

      if (result.success) {
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4 py-8">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-xl min-w-0 rounded-lg border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
              {isRaid ? (
                <Swords className="size-5" aria-hidden="true" />
              ) : flow === "rip" ? (
                <LinkIcon className="size-5" aria-hidden="true" />
              ) : (
                <Plus className="size-5" aria-hidden="true" />
              )}
            </div>
            <div>
              <p className="type-label-sm text-muted-foreground">
                Classification helper
              </p>
              <h3 className="text-lg font-semibold">{title}</h3>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <QuickCreateFields
          clients={clients}
          flow={flow}
          isPending={isPending}
          message={state.message}
          onSubmit={submit}
        />
      </div>
    </div>
  );
}

function QuickCreateFields({
  clients,
  flow,
  isPending,
  message,
  onSubmit,
}: {
  clients: EntityOption[];
  flow: QuickCreateFlow;
  isPending: boolean;
  message: string;
  onSubmit: (formData: FormData) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  function getValue(name: string) {
    return values[name] ?? "";
  }

  function setValue(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function submit() {
    const formData = new FormData();

    for (const [key, value] of Object.entries(values)) {
      formData.set(key, value);
    }

    if (flow === "provider" || flow === "subcontractor") {
      formData.set("type", "provider");
    }

    onSubmit(formData);
  }

  return (
    <div className="mt-5 grid gap-4">
      {flow === "provider" || flow === "subcontractor" ? (
        <>
          <TextInput
            label="Name"
            name="name"
            required
            value={getValue("name")}
            onChange={setValue}
          />
          <TextInput
            label="Website"
            name="website"
            value={getValue("website")}
            onChange={setValue}
          />
          <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(7rem,10rem)]">
            <TextInput
              label="Address"
              name="address"
              placeholder="0x..."
              value={getValue("address")}
              onChange={setValue}
            />
            <TextInput
              label="Chain ID"
              name="chainId"
              placeholder="100"
              value={getValue("chainId")}
              onChange={setValue}
            />
          </div>
        </>
      ) : null}
      {flow === "raid" ? (
        <>
          <TextInput
            label="Name"
            name="name"
            required
            value={getValue("name")}
            onChange={setValue}
          />
          <label className="grid gap-2 text-sm font-medium">
            <span className="type-label-sm text-muted-foreground">Client</span>
            <select
              value={getValue("clientEntityId")}
              onChange={(event) =>
                setValue("clientEntityId", event.target.value)
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {flow === "rip" ? (
        <>
          <TextInput
            label="Title"
            name="title"
            required
            value={getValue("title")}
            onChange={setValue}
          />
          <TextInput
            label="RIP URL"
            name="url"
            placeholder="https://..."
            required
            value={getValue("url")}
            onChange={setValue}
          />
        </>
      ) : null}
      {message ? (
        <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          {message}
        </p>
      ) : null}
      <div>
        <Button type="button" onClick={submit} disabled={isPending}>
          <Save data-icon="inline-start" />
          {isPending
            ? "Adding..."
            : `Add ${flow === "rip" ? "RIP" : flow}`}
        </Button>
      </div>
    </div>
  );
}

function TextInput({
  label,
  name,
  onChange,
  placeholder,
  required,
  value,
}: {
  label: string;
  name: string;
  onChange: (name: string, value: string) => void;
  placeholder?: string;
  required?: boolean;
  value: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="type-label-sm text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
      />
    </label>
  );
}
