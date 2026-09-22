import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Suggestion } from "@/lib/types";
import { signOutStudent } from "./actions";
import MyIdeasList from "./MyIdeasList";

export const dynamic = "force-dynamic";

export default async function MyIdeasPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/my-ideas/login");

  const { data, error } = await supabase.from("suggestions").select("*").eq("submitter_user_id", user.id).order("created_at", { ascending: false });
  const suggestions = (data ?? []) as Suggestion[];

  // A trashed idea is never returned by the query above (RLS excludes it
  // the same way it does for a president's ordinary reads) — this is the
  // only thing a student is ever told about one: how many, never which
  // one, never why, never who. No email is sent for this either.
  const { data: removedCount } = await supabase.rpc("count_my_removed_suggestions");

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Private to you</p>
          <h1 className="mt-2 text-3xl font-bold text-navy">My ideas</h1>
          <p className="mt-1 text-sm text-navy-soft">Signed in as {user.email}</p>
        </div>
        <form action={signOutStudent}><button className="btn-quiet" type="submit">Sign out</button></form>
      </header>

      {typeof removedCount === "number" && removedCount > 0 && (
        <div className="mt-6 rounded-[10px] border border-rule bg-white/70 px-4 py-3 text-sm text-navy-soft">
          {removedCount === 1 ? "One of your ideas is" : `${removedCount} of your ideas are`} no longer shown here — removed from active review.
        </div>
      )}

      {error ? (
        <div className="paper mt-8 p-6"><h2 className="font-bold text-navy">Tracking needs one final setup step</h2><p className="mt-2 text-sm text-navy-soft">The student-tracking migration has not been applied yet. Your existing suggestions are safe.</p></div>
      ) : suggestions.length === 0 ? (
        <div className="paper mt-8 px-6 py-14 text-center"><h2 className="text-xl font-bold text-navy">Nothing here yet</h2><p className="mt-2 text-sm text-navy-soft">Sign in before sending a non-anonymous idea and its progress will appear here.</p></div>
      ) : (
        <MyIdeasList suggestions={suggestions} />
      )}

      <Link
        href="/"
        className="btn-primary mt-8 flex w-full items-center justify-center py-4 text-base sm:text-lg"
      >
        Send another idea
      </Link>
    </main>
  );
}
