import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";

export class MachineApiNonceError extends Error {
  constructor(message = "Machine API request nonce has already been used.") {
    super(message);
    this.name = "MachineApiNonceError";
  }
}

export async function consumeMachineApiNonce({
  agentAddress,
  delegatorAddress,
  expiresAt,
  nonce,
  quarterId,
  reportSlice,
}: {
  agentAddress: string;
  delegatorAddress: string;
  expiresAt: Date;
  nonce: string;
  quarterId: string;
  reportSlice: string;
}) {
  const result = await getDb().execute<{ nonce: string }>(sql`
    with cleanup as (
      delete from machine_api_request_nonces
      where expires_at < now()
    )
    insert into machine_api_request_nonces (
      nonce,
      agent_address,
      delegator_address,
      quarter_id,
      report_slice,
      expires_at
    )
    values (
      ${nonce},
      ${agentAddress},
      ${delegatorAddress},
      ${quarterId},
      ${reportSlice},
      ${expiresAt}
    )
    on conflict (nonce) do nothing
    returning nonce
  `);

  if (result.rows.length === 0) {
    throw new MachineApiNonceError();
  }
}
