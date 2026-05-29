import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth/session";

export async function POST() {
  try {
    const session = await getAuthSession();
    session.destroy();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Wallet logout failed", error);

    return NextResponse.json(
      { error: "Logout failed" },
      { status: 500 },
    );
  }
}
