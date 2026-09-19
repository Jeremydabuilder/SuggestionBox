"use client";

import { useActionState } from "react";
import { requestMagicLink } from "../actions";

const initialState = { ok: false, message: "" };

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(requestMagicLink, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="mb-2 block text-sm font-semibold text-navy">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          disabled={pending}
          placeholder="you@school.org"
          className="field"
        />
      </div>

      {state.message && (
        <p
          role="status"
          className={`rounded-[10px] border px-4 py-3 text-sm font-medium ${
            state.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-[#f0c4bb] bg-[#fdeee7] text-[#8d2b0d]"
          }`}
        >
          {state.message}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Sending…" : "Send sign-in link"}
      </button>
    </form>
  );
}
