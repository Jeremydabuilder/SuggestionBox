# Suggestion Box

A private, working suggestion box for a middle-school student government.

- **Students** submit ideas at `/` — no account, no login, nothing public to browse.
- **The two co-presidents** read and manage every suggestion at `/president`, behind
  real server-side authentication.

There is no public ideas feed, no voting, no comments, no student accounts, no
teacher accounts, and no demo mode. **No email is sent when a suggestion arrives** —
the dashboard is the inbox. An optional daily digest is available and is off by default.

---

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Framer Motion ·
Supabase (Postgres, Auth, Realtime, Row Level Security) · Resend *(optional)* · Vercel

---

## What's in the box

### Student page (`/`)
Headline **"Have an idea? Put it in the box."**, then a form with a title, the details,
a category, why it would improve the school, and an optional name and email — or a
checkbox to submit with no name at all. Character counters, inline validation,
loading and error states, and a mobile layout that holds up on a phone.

### The submission animation
Once — and only once — the database confirms the row was written, the form turns into
a sheet of paper, folds across and down, flies to the illustrated suggestion box,
slides into the slot, the box bounces, and **"Your idea is in the box!"** appears with a
**Submit another idea** button. `prefers-reduced-motion` skips straight to the message.

### President panel (`/president`)
Counters for total / unread / being discussed / completed; search; category, status and
read-state filters; newest-or-oldest sorting; an archive toggle; a prominent banner when
new suggestions arrive; and per-suggestion: full text, submission date and time, the
student's name and email when given, a copy-email button, the eight statuses, shared
internal notes, a status-change history, and archive. Both co-presidents see the same
data, updated live over Supabase Realtime with a 45-second polling fallback.

### Statuses
New · Reviewing · Discussing · Approved · In Progress · Completed · Declined · Archived

---

## Security

| Concern | How it's handled |
|---|---|
| Server-side validation | Every field re-validated in `/api/suggestions`; the client checks are only a convenience |
| Sanitisation | HTML tags, control characters and zero-width/bidi characters stripped before the insert |
| Rate limiting | 3 submissions per 10 minutes and 12 per day per source, tracked in Postgres; IPs are SHA-256 hashed with a salt, never stored raw |
| Bot protection | Cloudflare Turnstile, plus a hidden honeypot field |
| Row Level Security | Students (the `anon` role) may `INSERT` into `suggestions` and nothing else — no select, update or delete, on any table |
| President access | `is_president()` checks the signed-in JWT's email against `authorized_presidents`; only then do the select/update policies pass |
| Note integrity | A note can only be written under the author's own signed-in address, and only its author can delete it |
| Route protection | `/president` is gated on the server and redirects before rendering. The URL grants nothing |
| Secrets | The service-role key and all other private values are server-only; nothing private reaches the browser |

Deleting a suggestion is not possible from any client — archive instead.

---

## 1. Create the Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Pick a name, a strong database password and the region closest to your school.
3. Wait for it to finish provisioning (a minute or two).
4. Open **Project Settings → Data API** and copy the **Project URL**.
5. Open **Project Settings → API Keys** and copy the **anon / public** key and the
   **service_role** key. The service-role key is a master key — never put it in
   frontend code, a screenshot, or a commit.

## 2. Run the database migration

1. In the Supabase dashboard open **SQL Editor → New query**.
2. Paste the whole contents of `supabase/migrations/20260101000000_init.sql` and **Run**.
3. You should see it finish without errors. It creates the four tables the app needs —
   `suggestions`, `internal_notes`, `authorized_presidents`, `status_history` — plus the
   rate-limit and digest bookkeeping tables, the triggers, the grants, every RLS policy,
   and the realtime publication.

If you prefer the CLI: `supabase link --project-ref <ref> && supabase db push`.

## 3. Add the two authorized president email addresses

1. Open `supabase/migrations/20260101000100_seed_presidents.sql`.
2. Replace the two placeholder addresses with the real co-president addresses.
3. Run it in the SQL editor.
4. Confirm: `select * from authorized_presidents;` should show exactly two rows.

Put **the same two addresses** in the `PRESIDENT_EMAILS` environment variable in step 5.
An address has to be in both places to get in, so removing a graduating president from
either one locks them out.

**Also configure Supabase Auth** (**Authentication → URL Configuration**):

- **Site URL**: your production URL, e.g. `https://suggestions.yourschool.org`
- **Redirect URLs**: add `https://suggestions.yourschool.org/auth/callback`
  and, for local work, `http://localhost:3000/auth/callback`

Under **Authentication → Providers**, leave **Email** enabled; everything else can be off.
The app only ever sends a magic link to an address already on the roster.

## 4. Configure Resend *(optional — skip this and everything still works)*

The app never emails on submission. Resend is only for the optional once-a-day digest.

1. Create an account at [resend.com](https://resend.com) and verify your sending domain.
2. Create an API key and copy it.
3. Set `RESEND_API_KEY`, `DIGEST_FROM_EMAIL` (an address on the verified domain) and
   `DIGEST_ENABLED=true`.
4. `vercel.json` already schedules `/api/cron/digest` daily at 22:00 UTC. Adjust the cron
   expression if you'd rather have it at a different time.

With `DIGEST_ENABLED` unset or `false`, no email is ever sent. When enabled, the digest
goes out at most once per calendar day, and only if unread suggestions are waiting.

## 5. Add all required environment variables

Copy `.env.example` to `.env.local` for local development, and add the same variables in
Vercel under **Project Settings → Environment Variables**.

| Variable | Required | What it's for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public key; always constrained by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only; writes submissions and the rate-limit log |
| `PRESIDENT_EMAILS` | yes | The two co-president addresses, comma separated |
| `NEXT_PUBLIC_SITE_URL` | yes in prod | Your domain; used to build sign-in links |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | recommended | Turnstile widget key |
| `TURNSTILE_SECRET_KEY` | recommended | Turnstile verification key |
| `IP_HASH_SALT` | recommended | Salt for hashing IPs in the rate-limit log |
| `DIGEST_ENABLED` | no | `true` turns the daily digest on. Default off |
| `RESEND_API_KEY` | no | Digest only |
| `DIGEST_FROM_EMAIL` | no | Digest only; must be on a verified domain |
| `CRON_SECRET` | no | Required if the digest is on; guards the cron endpoint |

For Turnstile keys: [Cloudflare dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
→ **Add site**, choose the **Managed** widget, and add your domain plus `localhost`.

Run locally with:

```bash
npm install
npm run dev
```

## 6. Deploy to Vercel

1. Push this repository to GitHub.
2. At [vercel.com/new](https://vercel.com/new), import the repository. Vercel detects
   Next.js; leave the build settings alone.
3. Add every environment variable from step 5 **before** the first deploy, for the
   Production, Preview and Development environments.
4. Deploy. Vercel picks up `vercel.json` and registers the daily cron automatically.
5. Set `NEXT_PUBLIC_SITE_URL` to your real domain once you have it, then redeploy —
   sign-in links are built from it.

## 7. Connect your own custom domain

1. Vercel → your project → **Settings → Domains → Add**.
2. Enter your domain, e.g. `suggestions.yourschool.org`.
3. Add the DNS record Vercel shows you at your registrar:
   - subdomain → a `CNAME` to `cname.vercel-dns.com`
   - apex domain → an `A` record to `76.76.21.21`
4. Wait for the certificate to issue (usually minutes).
5. Then update, in this order:
   - `NEXT_PUBLIC_SITE_URL` in Vercel → redeploy
   - Supabase **Authentication → URL Configuration**: Site URL and the
     `https://your-domain/auth/callback` redirect URL
   - Cloudflare Turnstile: add the domain to your widget

## 8. Test a real student submission

1. Open your live site in a private window.
2. Fill in a title, details, a category and the improvement reason. Leave the name and
   email blank, or tick **Submit without my name**.
3. Submit. The form should fold into paper, drop into the box, and show
   **"Your idea is in the box!"** — that animation only runs after the database confirms
   the write, so seeing it means the row is saved.
4. In Supabase → **Table Editor → suggestions**, confirm the row exists with
   `status = new` and `is_read = false`.
5. Sign in at `/president` and confirm it appears at the top of the inbox, marked unread.
6. Open it, change the status, add an internal note, and confirm the history entry
   appears. If your co-president has the panel open, it should update on their screen
   within a second or two.
7. Submit four ideas in a row from the same device — the fourth should be refused with a
   "give it a little while" message. That's the rate limiter.

## 9. Confirm that unauthorized people cannot enter the president panel

Work through all five:

1. **Signed out.** Open `/president` in a private window → you're redirected to
   `/president/login`. The panel never renders.
2. **An address that isn't a co-president.** Request a link from `/president/login` using
   any other address. You get the same neutral "if that address is approved…" message,
   and **no email arrives** — the panel doesn't reveal who the presidents are.
3. **A signed-in outsider.** If someone has a Supabase account on this project by some
   other route, `/president` still redirects them to the login page: the roster check
   runs on every request, not just at sign-in.
4. **Direct database access.** With the anon key, `select * from suggestions` returns a
   permissions error. Students can insert and nothing else. Verify in the SQL editor:
   ```sql
   set role anon;
   select * from public.suggestions;   -- permission denied
   select * from public.internal_notes; -- permission denied
   reset role;
   ```
5. **Search engines.** `/president` sends `X-Robots-Tag: noindex, nofollow` and is
   disallowed in `robots.txt`. It is not findable — though the real protection is the
   server-side check, not obscurity.

To remove a president later, delete their row from `authorized_presidents` **and** take
them out of `PRESIDENT_EMAILS`. They lose access on their next request.

---

## Project layout

```
src/
  app/
    page.tsx                     Student landing page
    api/suggestions/route.ts     Validate → rate-limit → Turnstile → sanitise → save
    api/cron/digest/route.ts     Optional daily digest, secret-protected
    auth/callback/route.ts       Magic-link exchange + roster check
    president/                   The private panel, its login page and server actions
  components/
    SubmissionFlow.tsx           The form and the fold-and-post animation
    SuggestionBoxArt.tsx         The illustrated box
    Turnstile.tsx                Cloudflare Turnstile widget
    president/                   Panel, detail pane, shared UI
  lib/                           env, auth, validation, sanitising, rate limiting, digest
  middleware.ts                  Refreshes the Supabase session cookie
supabase/migrations/             Schema, policies, triggers, grants, president roster
```

## Commands

```bash
npm run dev        # local development
npm run build      # production build
npm run typecheck  # TypeScript, no emit
npm run lint       # ESLint
```
