"use client";

import { useActionState } from "react";
import { MapPin, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  addProviderAddressWithState,
  createProviderWithState,
  type ProviderFormState,
} from "@/app/admin/providers/actions";

const INITIAL_STATE: ProviderFormState = { message: "" };

function TextInput({
  defaultValue,
  inputMode,
  label,
  name,
  placeholder,
  required,
}: {
  defaultValue?: string | null;
  inputMode?: "numeric";
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="type-label-sm text-muted-foreground">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        inputMode={inputMode}
        placeholder={placeholder}
        required={required}
        className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
      />
    </label>
  );
}

function NotesField() {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="type-label-sm text-muted-foreground">Notes</span>
      <textarea
        name="notes"
        className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

function AddressInputs() {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.45fr)_minmax(0,1fr)]">
      <TextInput label="Address" name="address" placeholder="0x..." />
      <TextInput
        inputMode="numeric"
        label="Chain ID"
        name="chainId"
        placeholder="100"
      />
      <TextInput label="Address Label" name="addressLabel" />
    </div>
  );
}

function FormError({ message }: { message: string }) {
  if (!message) {
    return null;
  }

  return (
    <p
      className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
      aria-live="polite"
    >
      {message}
    </p>
  );
}

export function ProviderCreateForm() {
  const [state, action, pending] = useActionState(
    createProviderWithState,
    INITIAL_STATE,
  );

  return (
    <form action={action} className="mt-6 grid gap-4">
      <input type="hidden" name="type" value="provider" />
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput label="Name" name="name" required />
        <TextInput label="Website" name="website" />
      </div>
      <AddressInputs />
      <label className="inline-flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="isMember"
          className="size-4 rounded border-input"
        />
        DAO member
      </label>
      <NotesField />
      <FormError message={state.message} />
      <div>
        <Button type="submit" disabled={pending}>
          <Save data-icon="inline-start" />
          {pending ? "Adding..." : "Add Provider"}
        </Button>
      </div>
    </form>
  );
}

export function ProviderAddressForm({ entityId }: { entityId: string }) {
  const [state, action, pending] = useActionState(
    addProviderAddressWithState,
    INITIAL_STATE,
  );

  return (
    <form action={action} className="grid gap-4 px-4 pb-4" noValidate>
      <input type="hidden" name="entityId" value={entityId} />
      <AddressInputs />
      <FormError message={state.message} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          <MapPin data-icon="inline-start" />
          {pending ? "Adding..." : "Add Address"}
        </Button>
      </div>
    </form>
  );
}
