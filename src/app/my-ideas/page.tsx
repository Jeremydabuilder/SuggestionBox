import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, STATUS_LABELS, STATUS_STYLES, type Suggestion } from "@/lib/types";
import { signOutStudent } from "./actions";

export const dynamic = "force-dynamic";

export default async function MyIdeasPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/my-ideas/login");

  const { data, error } = await supabase.from("suggestions").select("*").eq("submitter_user_id", user.id).order("created_at", { ascending: false });
  const suggestions = (data ?? []) as Suggestion[];

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

      <div className="mt-8 space-y-3">
        {error ? (
          <div className="paper p-6"><h2 className="font-bold text-navy">Tracking needs one final setup step</h2><p className="mt-2 text-sm text-navy-soft">The student-tracking migration has not been applied yet. Your existing suggestions are safe.</p></div>
        ) : suggestions.length === 0 ? (
          <div className="paper px-6 py-14 text-center"><h2 className="text-xl font-bold text-navy">Nothing here yet</h2><p className="mt-2 text-sm text-navy-soft">Sign in before sending a non-anonymous idea and its progress will appear here.</p></div>
        ) : suggestions.map((suggestion) => (
          <article key={suggestion.id} className="paper p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[12px] font-semibold text-navy-soft">{CATEGORY_LABELS[suggestion.category]}</p><h2 className="mt-1 text-lg font-bold text-navy">{suggestion.title}</h2></div>
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[12px] font-semibold ${STATUS_STYLES[suggestion.status]}`}>{STATUS_LABELS[suggestion.status]}</span>
            </div>
            <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-navy-soft">{suggestion.description}</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-rule pt-3 text-[12px] text-navy-soft">
              <span>Sent {new Date(suggestion.created_at).toLocaleDateString()}</span>
              <span>{suggestion.is_read ? "Viewed by a co-president" : "Not viewed yet"}</span>
            </div>
          </article>
        ))}
      </div>

      <Link
        href="/"
        className="btn-primary mt-8 flex w-full items-center justify-center py-4 text-base sm:text-lg"
      >
        Send another idea
      </Link>
    </main>
  );
}
