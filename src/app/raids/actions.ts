"use server";

import { redirect } from "next/navigation";

import {
  addAddressForAccess,
  archiveEntityForAccess,
  archiveRaidForAccess,
  createEntityForAccess,
  CoreEntityValidationError,
  createRaidForAccess,
  deleteEntityForAccess,
  deleteRaidForAccess,
  removeAddressForAccess,
  restoreEntityForAccess,
  restoreRaidForAccess,
  updateEntityForAccess,
  updateRaidForAccess,
} from "@/lib/core-entity-mutations";

type RaidActionError =
  | "client-has-raids"
  | "duplicate-address"
  | "invalid-address"
  | "invalid-chain"
  | "missing-address";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getEntityKind(formData: FormData) {
  const type = getString(formData, "type");

  return type === "subcontractor" ? "subcontractor" : "client";
}

function getAddressError(error: unknown) {
  if (error instanceof CoreEntityValidationError) {
    if (error.code === "client_has_raids") {
      return "client-has-raids";
    }

    if (error.code === "duplicate_address") {
      return "duplicate-address";
    }

    if (error.code === "invalid_address") {
      return "invalid-address";
    }

    if (error.code === "invalid_chain") {
      return "invalid-chain";
    }

    if (error.code === "missing_address") {
      return "missing-address";
    }
  }

  if (!(error instanceof Error)) {
    return null;
  }

  if (
    error.message === "That address is already assigned to an entity" ||
    error.message.includes("entity_addresses_chain_address_unique")
  ) {
    return "duplicate-address";
  }

  if (error.message === "Address must be a valid EVM address") {
    return "invalid-address";
  }

  if (
    error.message === "Chain ID must be a whole number" ||
    error.message === "Chain ID must be a positive whole number"
  ) {
    return "invalid-chain";
  }

  if (error.message === "Address is required") {
    return "missing-address";
  }

  if (
    error.message ===
    "Client cannot be permanently deleted while raids reference it"
  ) {
    return "client-has-raids";
  }

  return null;
}

function getAddressErrorMessage(error: unknown) {
  const addressError = getAddressError(error);

  if (addressError === "duplicate-address") {
    return "That address is already assigned to an entity.";
  }

  if (addressError === "invalid-address") {
    return "Enter a valid EVM address.";
  }

  if (addressError === "invalid-chain") {
    return "Chain ID must be a positive whole number.";
  }

  if (addressError === "missing-address") {
    return "Address is required.";
  }

  if (addressError === "client-has-raids") {
    return "Client cannot be permanently deleted while raids reference it.";
  }

  return null;
}

export type RaidFormState = {
  message: string;
};

export async function createRaidEntity(formData: FormData) {
  const entityKind = getEntityKind(formData);
  let redirectPath = `/raids?added=${entityKind}`;

  try {
    await createEntityForAccess(formData, "raid-related");
  } catch (error) {
    const addressError = getAddressError(error);

    if (!addressError) {
      throw error;
    }

    redirectPath = `/raids?flow=${entityKind}&error=${addressError}`;
  }

  redirect(redirectPath);
}

export async function createRaidEntityWithState(
  _previousState: RaidFormState,
  formData: FormData,
): Promise<RaidFormState> {
  const entityKind = getEntityKind(formData);

  try {
    await createEntityForAccess(formData, "raid-related");
  } catch (error) {
    const message = getAddressErrorMessage(error);

    if (message) {
      return { message };
    }

    throw error;
  }

  redirect(`/raids?added=${entityKind}`);
}

export async function updateRaidEntity(formData: FormData) {
  await updateEntityForAccess(formData, "raid-related");
}

export async function archiveRaidEntity(formData: FormData) {
  await archiveEntityForAccess(formData, "raid-related");
}

export async function restoreRaidEntity(formData: FormData) {
  await restoreEntityForAccess(formData, "raid-related");
}

export async function deleteRaidEntity(formData: FormData) {
  const entityKind = getEntityKind(formData);

  try {
    await deleteEntityForAccess(formData, "raid-related");
  } catch (error) {
    const actionError: RaidActionError | null = getAddressError(error);

    if (actionError !== "client-has-raids") {
      throw error;
    }

    redirect(`/raids?error=${actionError}`);
  }

  redirect(`/raids?deleted=${entityKind}`);
}

export async function addRaidEntityAddress(formData: FormData) {
  let redirectPath = "/raids?added=address";

  try {
    await addAddressForAccess(formData, "raid-related");
  } catch (error) {
    const addressError = getAddressError(error);

    if (!addressError) {
      throw error;
    }

    redirectPath = `/raids?error=${addressError}`;
  }

  redirect(redirectPath);
}

export async function addRaidEntityAddressWithState(
  _previousState: RaidFormState,
  formData: FormData,
): Promise<RaidFormState> {
  try {
    await addAddressForAccess(formData, "raid-related");
  } catch (error) {
    const message = getAddressErrorMessage(error);

    if (message) {
      return { message };
    }

    throw error;
  }

  redirect("/raids?added=address");
}

export async function removeRaidEntityAddress(formData: FormData) {
  await removeAddressForAccess(formData, "raid-related");
}

export async function createRaid(formData: FormData) {
  await createRaidForAccess(formData);
  redirect("/raids?added=raid");
}

export async function updateRaid(formData: FormData) {
  const id = getString(formData, "id");

  await updateRaidForAccess(formData);
  redirect(id ? `/raids?raid=${id}` : "/raids");
}

export async function archiveRaid(formData: FormData) {
  await archiveRaidForAccess(formData);
}

export async function restoreRaid(formData: FormData) {
  await restoreRaidForAccess(formData);
}

export async function deleteRaid(formData: FormData) {
  await deleteRaidForAccess(formData);
  redirect("/raids?deleted=raid");
}
