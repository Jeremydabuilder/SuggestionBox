import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import StudentLoginForm from "./StudentLoginForm";

export const dynamic = "force-dynamic";

export default async function StudentLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/my-ideas");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-16">
      <Link href="/" className="mb-8 self-start text-sm font-medium text-navy-soft hover:text-navy">← Back to the suggestion box</Link>
      <div className="paper p-7 sm:p-8">
        <p className="eyebrow">Your ideas</p>
        <h1 className="mt-3 text-2xl font-bold text-navy">See what happened next</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-navy-soft">
          Use your school email to see the non-anonymous suggestions you sent while signed in. Anonymous ideas are never connected to an account.
        </p>
        {error === "link" && (
          <p role="alert" className="mt-5 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            That link expired or has already been used. Request a new one below.
          </p>
        )}
        <StudentLoginForm />
      </div>
    </main>
  );
}
