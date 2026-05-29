import { NextResponse } from "next/server";
import { generateNonce } from "siwe";

import { getAuthSession } from "@/lib/auth/session";

export async function GET() {
  try {
    const session = await getAuthSession();
    session.nonce = generateNonce();
    await session.save();

    return NextResponse.json({ nonce: session.nonce });
  } catch (error) {
    console.error("Wallet nonce creation failed", error);

    return NextResponse.json(
      { error: "Nonce generation failed" },
      { status: 500 },
    );
  }
}
