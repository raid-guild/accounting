import { NextResponse } from "next/server";

import { getAuthSession, serializeSession } from "@/lib/auth/session";

type ViewModeRequest = {
  mode?: unknown;
};

export async function POST(request: Request) {
  try {
    const session = await getAuthSession();

    if (!session.address || !session.permissions?.canAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | ViewModeRequest
      | null;

    if (body?.mode !== "admin" && body?.mode !== "member") {
      return NextResponse.json({ error: "Invalid view mode" }, { status: 400 });
    }

    const mode = body.mode;

    session.viewMode = mode;
    await session.save();

    return NextResponse.json(serializeSession(session));
  } catch (error) {
    console.error("View mode update failed", error);

    return NextResponse.json(
      { error: "View mode update failed" },
      { status: 500 },
    );
  }
}
