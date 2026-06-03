"use server";

import { redirect } from "next/navigation";

import {
  addAddressForAccess,
  archiveEntityForAccess,
  createEntityForAccess,
  deleteEntityForAccess,
  removeAddressForAccess,
  restoreEntityForAccess,
  updateEntityForAccess,
} from "@/lib/core-entity-mutations";

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

export type ProviderFormState = {
  message: string;
};

export async function createProvider(formData: FormData) {
  let redirectPath = "/admin/providers?added=provider";

  try {
    await createEntityForAccess(formData, "provider");
  } catch (error) {
    const addressError = getAddressError(error);

    if (!addressError) {
      throw error;
    }

    redirectPath = `/admin/providers?error=${addressError}`;
  }

  redirect(redirectPath);
}

export async function createProviderWithState(
  _previousState: ProviderFormState,
  formData: FormData,
): Promise<ProviderFormState> {
  try {
    await createEntityForAccess(formData, "provider");
  } catch (error) {
    const message = getAddressErrorMessage(error);

    if (message) {
      return { message };
    }

    throw error;
  }

  redirect("/admin/providers?added=provider");
}

export async function updateProvider(formData: FormData) {
  await updateEntityForAccess(formData, "provider");
}

export async function archiveProvider(formData: FormData) {
  await archiveEntityForAccess(formData, "provider");
}

export async function restoreProvider(formData: FormData) {
  await restoreEntityForAccess(formData, "provider");
}

export async function deleteProvider(formData: FormData) {
  await deleteEntityForAccess(formData, "provider");
}

export async function addProviderAddress(formData: FormData) {
  let redirectPath = "/admin/providers?added=address";

  try {
    await addAddressForAccess(formData, "provider");
  } catch (error) {
    const addressError = getAddressError(error);

    if (!addressError) {
      throw error;
    }

    redirectPath = `/admin/providers?error=${addressError}`;
  }

  redirect(redirectPath);
}

export async function addProviderAddressWithState(
  _previousState: ProviderFormState,
  formData: FormData,
): Promise<ProviderFormState> {
  try {
    await addAddressForAccess(formData, "provider");
  } catch (error) {
    const message = getAddressErrorMessage(error);

    if (message) {
      return { message };
    }

    throw error;
  }

  redirect("/admin/providers?added=address");
}

export async function removeProviderAddress(formData: FormData) {
  await removeAddressForAccess(formData, "provider");
}
