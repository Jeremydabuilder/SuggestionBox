"use client";

import { useActionState } from "react";
import { requestStudentLink } from "../actions";

const INITIAL = { ok: false, message: "" };

export default function StudentLoginForm() {
  const [state, action, pending] = useActionState(requestStudentLink, INITIAL);
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="student-login-email" className="text-sm font-semibold text-navy">School email</label>
        <input id="student-login-email" name="email" type="email" required autoComplete="email" placeholder="you@school.org" className="field mt-2" />
      </div>
      {state.message && (
        <p role="status" className={`rounded-[10px] border px-3 py-2 text-sm ${state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
