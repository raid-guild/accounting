"use server";

import { redirect } from "next/navigation";

import {
  addAddressForAccess,
  archiveEntityForAccess,
  archiveRaidForAccess,
  createEntityForAccess,
  createRaidForAccess,
  deleteEntityForAccess,
  deleteRaidForAccess,
  removeAddressForAccess,
  restoreEntityForAccess,
  restoreRaidForAccess,
  updateEntityForAccess,
  updateRaidForAccess,
} from "@/lib/core-entity-mutations";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function getEntityKind(formData: FormData) {
  const type = getString(formData, "type");

  return type === "subcontractor" ? "subcontractor" : "client";
}

function getAddressError(error: unknown) {
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

  if (error.message === "Chain ID must be a whole number") {
    return "invalid-chain";
  }

  if (error.message === "Address is required") {
    return "missing-address";
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
    return "Chain ID must be a whole number.";
  }

  if (addressError === "missing-address") {
    return "Address is required.";
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
  await deleteEntityForAccess(formData, "raid-related");
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
  await updateRaidForAccess(formData);
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
