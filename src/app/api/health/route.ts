import { NextResponse } from "next/server";

/**
 * Health check for the hosting platform.
 *
 * Render polls this to decide whether a new deploy is live and whether the
 * running instance is still healthy. It therefore has to be cheap, and it
 * has to be honest about ONE thing only: is this Next.js server up and
 * serving?
 *
 * It deliberately does NOT touch Supabase. A health check that talks to the
 * database turns a brief Supabase blip into a failed deploy or a restart
 * loop, and restarting the web server does nothing to fix a database. The
 * app already degrades sensibly on its own when Supabase is unreachable.
 *
 * It returns nothing about the environment, the build or the version — a
 * public, unauthenticated endpoint is no place to advertise any of that.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { status: "ok" },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
