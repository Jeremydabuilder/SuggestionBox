import { redirect } from "next/navigation";
import PresidentPanel from "@/components/president/PresidentPanel";
import { getPresidentSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Suggestion, SuggestionMatch } from "@/lib/types";

// The panel is always rendered fresh for the signed-in president.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PresidentPage() {
  // Server-side gate. The URL itself grants nothing.
  const session = await getPresidentSession();
  if (!session) redirect("/president/login");

  const supabase = await createSupabaseServerClient();
  const [{ data, error }, matchResult] = await Promise.all([
    supabase.from("suggestions").select("*").order("created_at", { ascending: false }).limit(2000),
    // Dismissed pairs are deliberately left behind: a president has already
    // said they are not duplicates, so they never come back to the surface.
    supabase
      .from("suggestion_matches")
      .select("*")
      .neq("state", "dismissed")
      .order("score", { ascending: false }),
  ]);

  if (matchResult.error) {
    console.error("[president] could not load duplicate matches:", matchResult.error.message);
  }

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-5 py-24">
        <div className="paper p-8">
          <h1 className="text-xl font-bold text-navy">We couldn&rsquo;t load the inbox</h1>
          <p className="mt-2 text-sm text-navy-soft">
            The database returned: {error.message}
          </p>
          <p className="mt-4 text-sm text-navy-soft">
            Check that the migration has been run and that your address is in the
            <code className="mx-1 rounded bg-paper-deep px-1 py-0.5">authorized_presidents</code>
            table.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh">
      <PresidentPanel
        suggestions={(data ?? []) as Suggestion[]}
        matches={((matchResult.data ?? []) as SuggestionMatch[]).map((m) => ({
          ...m,
          // numeric arrives as a string from some drivers; the UI wants a number.
          score: Number(m.score),
        }))}
        currentEmail={session.email}
      />
    </main>
  );
}
