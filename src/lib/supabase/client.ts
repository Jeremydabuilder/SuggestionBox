"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

let cached: ReturnType<typeof createBrowserClient> | null = null;

/** Browser client — anon key only, always constrained by RLS. */
export function createSupabaseBrowserClient() {
  if (!cached) {
    cached = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
  }
  return cached;
}
