import { NextResponse, type NextRequest } from "next/server";
import { getAddress } from "viem";
import { SiweMessage } from "siwe";

import {
  getAuthSession,
  serializeSession,
} from "@/lib/auth/session";
import { getWalletPermissions } from "@/lib/auth/permissions";

type VerifyRequestBody = {
  message?: string;
  signature?: string;
};

function getPublicErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Wallet verification failed";
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("session_secret")) {
    return "Session configuration is missing";
  }

  if (lowerMessage.includes("gnosis_rpc_url")) {
    return "GNOSIS_RPC_URL is required for permission checks";
  }

  if (lowerMessage.includes("dao_share_token_address")) {
    return "DAO_SHARE_TOKEN_ADDRESS is required for member access checks";
  }

  if (lowerMessage.includes("dao_share_threshold")) {
    return "DAO_SHARE_THRESHOLD is required for member access checks";
  }

  if (lowerMessage.includes("hats_contract_address")) {
    return "HATS_CONTRACT_ADDRESS must be a valid EVM address";
  }

  if (
    lowerMessage.includes("execution reverted") ||
    lowerMessage.includes("contract function")
  ) {
    return "Permission contract read failed";
  }

  if (lowerMessage.includes("database_url")) {
    return "DATABASE_URL is required for permission checks";
  }

  return "Wallet verification failed";
}

function getExpectedDomain(request: NextRequest) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (configuredUrl) {
    return new URL(configuredUrl).host;
  }

  return request.headers.get("host") ?? request.nextUrl.host;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const { message, signature } = (await request.json()) as VerifyRequestBody;

    if (!session.nonce || !message || !signature) {
      return NextResponse.json(
        { error: "Missing SIWE nonce, message, or signature" },
        { status: 400 },
      );
    }

    let siweMessage: SiweMessage;

    try {
      siweMessage = new SiweMessage(message);
    } catch {
      session.destroy();
      return NextResponse.json(
        { error: "Invalid SIWE message" },
        { status: 400 },
      );
    }

    const verification = await siweMessage.verify({
      domain: getExpectedDomain(request),
      nonce: session.nonce,
      signature,
    });

    if (!verification.success) {
      session.destroy();
      return NextResponse.json(
        { error: "Wallet signature could not be verified" },
        { status: 401 },
      );
    }

    const address = getAddress(verification.data.address);
    const permissions = await getWalletPermissions(address);

    if (!permissions.canAccess) {
      session.destroy();
      return NextResponse.json(
        { error: "Wallet does not have RaidGuild accounting access" },
        { status: 403 },
      );
    }

    session.address = address;
    session.authenticatedAt = new Date().toISOString();
    session.chainId = verification.data.chainId;
    session.permissions = permissions;
    delete session.nonce;
    await session.save();

    return NextResponse.json(serializeSession(session));
  } catch (error) {
    console.error("Wallet verification failed", error);

    return NextResponse.json(
      { error: getPublicErrorMessage(error) },
      { status: 500 },
    );
  }
}
