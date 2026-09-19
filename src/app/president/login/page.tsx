import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import LoginForm from "./LoginForm";
import { getPresidentSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "President sign-in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getPresidentSession();
  if (session) redirect("/president");

  const { error } = await searchParams;
  const notice =
    error === "denied"
      ? "That account isn't one of the two approved co-presidents."
      : error === "link"
        ? "That sign-in link has expired or has already been used. Request a new one."
        : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-16">
      <Link
        href="/"
        className="mb-8 self-start text-sm font-medium text-navy-soft underline-offset-4 hover:text-navy hover:underline"
      >
        ← Back to the suggestion box
      </Link>

      <div className="paper p-8">
        <p className="eyebrow">Private</p>
        <h1 className="mt-3 text-2xl font-bold text-navy">Co-president sign-in</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-navy-soft">
          Enter your school email and we&rsquo;ll send a one-time sign-in link. Sign-in links
          work for the two approved co-president addresses.
        </p>

        {notice && (
          <p
            role="alert"
            className="mt-5 rounded-[10px] border border-[#f0c4bb] bg-[#fdeee7] px-4 py-3 text-sm font-medium text-[#8d2b0d]"
          >
            {notice}
          </p>
        )}

        <LoginForm />
      </div>
    </main>
  );
}
