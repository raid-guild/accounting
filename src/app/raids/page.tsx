import {
  Archive,
  ArrowLeft,
  BriefcaseBusiness,
  CircleDollarSign,
  Plus,
  RotateCcw,
  Save,
  Swords,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { getAuthSession, serializeSession } from "@/lib/auth/session";
import {
  listEntitiesByTypes,
  listRaids,
  type CoreEntityView,
  type RaidRelatedEntityType,
  type RaidView,
} from "@/lib/core-entities";
import {
  archiveRaid,
  archiveRaidEntity,
  createRaid,
  deleteRaid,
  deleteRaidEntity,
  removeRaidEntityAddress,
  restoreRaid,
  restoreRaidEntity,
  updateRaid,
  updateRaidEntity,
} from "@/app/raids/actions";
import {
  RaidAddressForm,
  RaidEntityCreateForm,
} from "@/app/raids/raid-management-forms";
import { RaidManagementToast } from "@/app/raids/raid-management-toast";

type FormAction = (formData: FormData) => Promise<void>;
type RaidFlow = "client" | "raid" | "subcontractor";
type RaidToastError =
  | "duplicate-address"
  | "invalid-address"
  | "invalid-chain"
  | "missing-address";
type RaidToastSubject = "address" | RaidFlow;

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getEntityLabel(type: RaidRelatedEntityType) {
  return type === "client" ? "Client" : "Subcontractor";
}

function getFlowHref(flow: RaidFlow) {
  return `/raids?flow=${flow}`;
}

function TextInput({
  defaultValue,
  inputMode,
  label,
  name,
  pattern,
  placeholder,
  required,
  title,
}: {
  defaultValue?: string | null;
  inputMode?: "numeric";
  label: string;
  name: string;
  pattern?: string;
  placeholder?: string;
  required?: boolean;
  title?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="type-label-sm text-muted-foreground">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        inputMode={inputMode}
        pattern={pattern}
        placeholder={placeholder}
        required={required}
        title={title}
        className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
      />
    </label>
  );
}

function NotesField({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span className="type-label-sm text-muted-foreground">Notes</span>
      <textarea
        name="notes"
        defaultValue={defaultValue ?? ""}
        className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

function FlowButton({
  description,
  flow,
  icon,
  title,
}: {
  description: string;
  flow: RaidFlow;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Link
      href={getFlowHref(flow)}
      className="group rounded-lg border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground transition-all group-hover:bg-primary group-hover:text-primary-foreground">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        <Plus className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}

function FlowLauncher() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <FlowButton
        description="Create a client profile for raid revenue."
        flow="client"
        icon={<BriefcaseBusiness className="size-5" aria-hidden="true" />}
        title="Add Client"
      />
      <FlowButton
        description="Link a raid to an active client."
        flow="raid"
        icon={<Swords className="size-5" aria-hidden="true" />}
        title="Add Raid"
      />
      <FlowButton
        description="Add a payout recipient for raid work."
        flow="subcontractor"
        icon={<CircleDollarSign className="size-5" aria-hidden="true" />}
        title="Add Subcontractor"
      />
    </section>
  );
}

function CreateEntityFlow({ type }: { type: RaidRelatedEntityType }) {
  const label = getEntityLabel(type);

  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
          {type === "client" ? (
            <BriefcaseBusiness className="size-5" aria-hidden="true" />
          ) : (
            <CircleDollarSign className="size-5" aria-hidden="true" />
          )}
        </div>
        <div>
          <p className="type-label-sm text-muted-foreground">New {label}</p>
          <h2 className="text-lg font-semibold">Add {label}</h2>
        </div>
      </div>

      <RaidEntityCreateForm label={label} type={type} />
    </section>
  );
}

function AddressList({
  entity,
  removeAction,
}: {
  entity: CoreEntityView;
  removeAction: FormAction;
}) {
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="type-label-sm text-muted-foreground">Addresses</p>
      {entity.addresses.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {entity.addresses.map((address) => (
            <div
              key={address.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-mono">{formatAddress(address.address)}</p>
                <p className="text-xs text-muted-foreground">
                  {address.label ? `${address.label} · ` : ""}
                  {address.chainId ? `Chain ${address.chainId}` : "Any chain"}
                </p>
              </div>
              <form action={removeAction}>
                <input type="hidden" name="id" value={address.id} />
                <Button type="submit" variant="ghost" size="icon">
                  <Trash2 className="size-4" aria-hidden="true" />
                  <span className="sr-only">Remove address</span>
                </Button>
              </form>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No addresses yet.</p>
      )}
    </div>
  );
}

function AddAddressForm({ entityId }: { entityId: string }) {
  return (
    <details className="mt-4 overflow-hidden rounded-md border border-border bg-background">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium marker:text-muted-foreground">
        Add address
      </summary>
      <RaidAddressForm entityId={entityId} />
    </details>
  );
}

function EntityCard({ entity }: { entity: CoreEntityView }) {
  const type = entity.type as RaidRelatedEntityType;

  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            {type === "client" ? (
              <BriefcaseBusiness className="size-5" aria-hidden="true" />
            ) : (
              <CircleDollarSign className="size-5" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <p className="type-label-sm text-muted-foreground">
              {getEntityLabel(type)}
            </p>
            <h3 className="truncate text-base font-semibold">{entity.name}</h3>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {type === "subcontractor" && entity.isMember ? (
            <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              Member
            </span>
          ) : null}
          {entity.archivedAt ? (
            <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              Archived
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <dt className="type-label-sm text-muted-foreground">Website</dt>
          <dd className="mt-1 text-sm font-medium">
            {entity.website || "Not recorded"}
          </dd>
        </div>
        <div>
          <dt className="type-label-sm text-muted-foreground">Address Count</dt>
          <dd className="mt-1 text-sm font-medium">
            {entity.addresses.length}
          </dd>
        </div>
      </dl>

      {entity.notes ? (
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          {entity.notes}
        </p>
      ) : null}

      <AddressList entity={entity} removeAction={removeRaidEntityAddress} />
      <AddAddressForm entityId={entity.id} />

      <details className="mt-4 rounded-md border border-border bg-background">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Edit
        </summary>
        <form action={updateRaidEntity} className="grid gap-4 px-4 pb-4">
          <input type="hidden" name="id" value={entity.id} />
          <input type="hidden" name="type" value={entity.type} />
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput label="Name" name="name" defaultValue={entity.name} required />
            <TextInput
              label="Website"
              name="website"
              defaultValue={entity.website}
            />
          </div>
          {type === "subcontractor" ? (
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="isMember"
                defaultChecked={entity.isMember}
                className="size-4 rounded border-input"
              />
              DAO member
            </label>
          ) : null}
          <NotesField defaultValue={entity.notes} />
          <div>
            <Button type="submit">
              <Save data-icon="inline-start" />
              Save
            </Button>
          </div>
        </form>
      </details>

      <form
        action={entity.archivedAt ? restoreRaidEntity : archiveRaidEntity}
        className="mt-3"
      >
        <input type="hidden" name="id" value={entity.id} />
        <Button
          type="submit"
          variant={entity.archivedAt ? "outline" : "destructive"}
          size="sm"
        >
          {entity.archivedAt ? (
            <RotateCcw data-icon="inline-start" />
          ) : (
            <Archive data-icon="inline-start" />
          )}
          {entity.archivedAt ? "Restore" : "Archive"}
        </Button>
      </form>

      {entity.archivedAt ? (
        <form action={deleteRaidEntity} className="mt-2">
          <input type="hidden" name="id" value={entity.id} />
          <input type="hidden" name="type" value={entity.type} />
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 data-icon="inline-start" />
            Permanently Delete
          </Button>
        </form>
      ) : null}
    </article>
  );
}

function EntityList({
  entities,
  emptyLabel,
  title,
}: {
  entities: CoreEntityView[];
  emptyLabel: string;
  title: string;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="type-label-sm text-muted-foreground">
          {entities.length} records
        </span>
      </div>
      {entities.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {entities.map((entity) => (
            <EntityCard key={entity.id} entity={entity} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

function CreateRaidFlow({ clients }: { clients: CoreEntityView[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
          <Swords className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="type-label-sm text-muted-foreground">Raid</p>
          <h2 className="text-lg font-semibold">Add raid</h2>
        </div>
      </div>

      <form action={createRaid} className="mt-6 grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput label="Name" name="name" required />
          <label className="grid gap-2 text-sm font-medium">
            <span className="type-label-sm text-muted-foreground">Client</span>
            <select
              name="clientEntityId"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <NotesField />
        <div>
          <Button type="submit" disabled={clients.length === 0}>
            <Save data-icon="inline-start" />
            Add Raid
          </Button>
          <Link
            href="/raids"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
          >
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}

function RaidCard({
  clients,
  raid,
}: {
  clients: CoreEntityView[];
  raid: RaidView;
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="type-label-sm text-muted-foreground">Raid</p>
          <h3 className="text-base font-semibold">{raid.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Client: {raid.client.name}
          </p>
        </div>
        {raid.archivedAt ? (
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
            Archived
          </span>
        ) : null}
      </div>

      {raid.notes ? (
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          {raid.notes}
        </p>
      ) : null}

      <details className="mt-4 rounded-md border border-border bg-background">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Edit
        </summary>
        <form action={updateRaid} className="grid gap-4 px-4 pb-4">
          <input type="hidden" name="id" value={raid.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput label="Name" name="name" defaultValue={raid.name} required />
            <label className="grid gap-2 text-sm font-medium">
              <span className="type-label-sm text-muted-foreground">Client</span>
              <select
                name="clientEntityId"
                defaultValue={raid.clientEntityId}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                required
              >
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <NotesField defaultValue={raid.notes} />
          <div>
            <Button type="submit">
              <Save data-icon="inline-start" />
              Save
            </Button>
          </div>
        </form>
      </details>

      <form
        action={raid.archivedAt ? restoreRaid : archiveRaid}
        className="mt-3"
      >
        <input type="hidden" name="id" value={raid.id} />
        <Button
          type="submit"
          variant={raid.archivedAt ? "outline" : "destructive"}
          size="sm"
        >
          {raid.archivedAt ? (
            <RotateCcw data-icon="inline-start" />
          ) : (
            <Archive data-icon="inline-start" />
          )}
          {raid.archivedAt ? "Restore" : "Archive"}
        </Button>
      </form>

      {raid.archivedAt ? (
        <form action={deleteRaid} className="mt-2">
          <input type="hidden" name="id" value={raid.id} />
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 data-icon="inline-start" />
            Permanently Delete
          </Button>
        </form>
      ) : null}
    </article>
  );
}

function RaidList({
  clients,
  emptyLabel,
  raids,
  title,
}: {
  clients: CoreEntityView[];
  emptyLabel: string;
  raids: RaidView[];
  title: string;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="type-label-sm text-muted-foreground">
          {raids.length} raids
        </span>
      </div>
      {raids.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {raids.map((raid) => (
            <RaidCard key={raid.id} clients={clients} raid={raid} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

function parseFlow(value: string | string[] | undefined): RaidFlow | null {
  const flow = Array.isArray(value) ? value[0] : value;

  if (flow === "client" || flow === "raid" || flow === "subcontractor") {
    return flow;
  }

  return null;
}

function parseToastSubject(
  value: string | string[] | undefined,
): RaidToastSubject | null {
  const subject = Array.isArray(value) ? value[0] : value;

  if (subject === "address") {
    return subject;
  }

  return parseFlow(subject);
}

function parseToastError(
  value: string | string[] | undefined,
): RaidToastError | null {
  const error = Array.isArray(value) ? value[0] : value;

  if (
    error === "duplicate-address" ||
    error === "invalid-address" ||
    error === "invalid-chain" ||
    error === "missing-address"
  ) {
    return error;
  }

  return null;
}

function SelectedFlow({
  activeClients,
  flow,
}: {
  activeClients: CoreEntityView[];
  flow: RaidFlow | null;
}) {
  if (flow === "client" || flow === "subcontractor") {
    return <CreateEntityFlow type={flow} />;
  }

  if (flow === "raid") {
    return <CreateRaidFlow clients={activeClients} />;
  }

  return null;
}

export default async function RaidsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    added?: string | string[];
    deleted?: string | string[];
    error?: string | string[];
    flow?: string | string[];
  }>;
}) {
  const session = await getAuthSession();
  const sessionState = serializeSession(session);

  if (
    !sessionState.authenticated ||
    !sessionState.permissions?.canWriteRaidAccounting
  ) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <section className="container-custom py-10">
          <Link
            href="/"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
          >
            <ArrowLeft data-icon="inline-start" />
            Home
          </Link>
          <div className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm">
            <p className="type-label-sm text-muted-foreground">Raid Records</p>
            <h1 className="mt-2 text-2xl font-semibold">
              Raid accounting access required
            </h1>
          </div>
        </section>
      </main>
    );
  }

  const [entities, raids] = await Promise.all([
    listEntitiesByTypes(["client", "subcontractor"]),
    listRaids(),
  ]);
  const activeClients = entities.filter(
    (entity) => entity.type === "client" && !entity.archivedAt,
  );
  const activeSubcontractors = entities.filter(
    (entity) => entity.type === "subcontractor" && !entity.archivedAt,
  );
  const archivedEntities = entities.filter((entity) => entity.archivedAt);
  const activeRaids = raids.filter((raid) => !raid.archivedAt);
  const archivedRaids = raids.filter((raid) => raid.archivedAt);
  const params = await searchParams;
  const flow = parseFlow(params?.flow);
  const added = parseToastSubject(params?.added);
  const deleted = parseToastSubject(params?.deleted);
  const error = parseToastError(params?.error);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <RaidManagementToast
        added={added}
        deleted={deleted}
        error={error}
        flow={flow}
      />
      <header className="border-b border-moloch-800 bg-moloch-800 text-scroll-100">
        <div className="container-custom flex h-16 items-center justify-between gap-4">
          <div>
            <p className="type-label-sm text-scroll-200">Cleric</p>
            <h1 className="text-base font-semibold leading-none">
              Raid Management
            </h1>
          </div>
          <Link
            href="/"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted"
          >
            <ArrowLeft data-icon="inline-start" />
            Home
          </Link>
        </div>
      </header>

      <section className="container-custom grid gap-8 py-8 md:py-12">
        <FlowLauncher />
        <SelectedFlow activeClients={activeClients} flow={flow} />
        <RaidList
          clients={activeClients}
          emptyLabel="No active raids yet."
          raids={activeRaids}
          title="Active raids"
        />
        <EntityList
          emptyLabel="No active clients yet."
          entities={activeClients}
          title="Clients"
        />
        <EntityList
          emptyLabel="No active subcontractors yet."
          entities={activeSubcontractors}
          title="Subcontractors"
        />
        <RaidList
          clients={activeClients}
          emptyLabel="No archived raids."
          raids={archivedRaids}
          title="Archived raids"
        />
        <EntityList
          emptyLabel="No archived clients or subcontractors."
          entities={archivedEntities}
          title="Archived entities"
        />
      </section>
    </main>
  );
}
