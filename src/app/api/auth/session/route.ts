import { NextResponse } from "next/server";

import { getAuthSession, serializeSession } from "@/lib/auth/session";

export async function GET() {
  try {
    const session = await getAuthSession();

    return NextResponse.json(serializeSession(session));
  } catch (error) {
    console.error("Wallet session lookup failed", error);

    return NextResponse.json(
      { error: "Session lookup failed" },
      { status: 500 },
    );
  }
}
