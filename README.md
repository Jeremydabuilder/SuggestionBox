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
Supabase (Postgres, Auth, Realtime, Row Level Security) · Resend *(optional)* ·
Render (Node web service)

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

### Duplicate detection
When several students send in the same idea, the dashboard says so. Matches are
suggested, never acted on: see [How duplicate detection works](#how-duplicate-detection-works).

---

## How duplicate detection works

Students often have the same idea in the same week. The dashboard flags likely
repeats so the presidents can see how much support an idea really has — and it
stops there. **Nothing is ever deleted, archived, merged or rejected
automatically.** Every submission is kept exactly as it was sent, including the
name and email of whoever sent it. A president makes every decision.

### How a match is found

No AI service and no API key. The comparison is local, deterministic and free,
in `src/lib/duplicates/similarity.ts`. For each pair it looks at:

| Signal | Weight | What it does |
|---|---|---|
| Title similarity | 50% | Word overlap plus character overlap, so case, punctuation and a typo don't matter |
| Description + reason | 30% | Word overlap across the body of both suggestions |
| Shared keywords | 20% | How much of the smaller suggestion's vocabulary is shared |
| Same category | ×0.75 if not | A mismatch lowers the score rather than vetoing the pair — the same idea does get filed under two categories |

Text is lowercased, stripped of accents and punctuation, and lightly stemmed, so
"Longer lunch period" and "longer lunch periods!!" are the same words.

**Common words are removed first.** Almost every suggestion contains *school*,
*students*, *better*, *more*, *please*, *idea* and *suggestion*, so those words
say nothing about whether two suggestions match — leaving them in is exactly
what produces confident nonsense. The list is in
`src/lib/duplicates/stop-words.ts`; add to it if a word starts showing up in
every match.

On top of that, a pair has to share **at least two meaningful words**, and if
none of them appear in either title it needs **four**. Two long descriptions
that happen to share a couple of incidental words never get scored.

A pair is shown at **0.62** and above, labelled *Possible match* (0.62),
*Likely match* (0.70) or *Strong match* (0.78). Every stored score also keeps
the parts it was made of, so you can see why a pair was flagged.

### When it runs

- **On submission.** Every new suggestion is compared with the active ones
  already in the box. It runs after the row is saved and can never affect the
  student: if it fails, the submission still succeeded and the error is only
  logged.
- **On demand.** **Scan existing suggestions** in the dashboard toolbar
  re-compares everything. Use it for suggestions that predate this feature.
  Decisions already made are never overwritten by a scan.

Archived suggestions are not candidates — a president has already filed them
away, and resurfacing them would undo that.

### What presidents can do

On a card in the list:

- a **Possible duplicate (n)** badge, with the number of matches
- **n related submissions** once several are filed as one idea
- a **Possible duplicates** filter in the toolbar, with a count

In **Similar suggestions** inside a suggestion, each match shows the other
suggestion's title, category, status, submission date, a similarity level and
percentage, and the words the two share. From there:

| Action | What it does |
|---|---|
| **Open** | Jumps to the other suggestion |
| **Mark as related** | Confirms the two are the same idea. Both are left untouched |
| **Make this one primary** | Files the other suggestion under this one, so the idea is tracked in one place |
| **Not a duplicate** | Dismisses the match. The row is *kept*, not deleted, so the same pair is never raised again |
| **Undo dismissal** | Changes your mind. Dismissed matches are tucked behind a **Show n dismissed matches** toggle, and restoring one puts it back in the list |
| **Unlink** | Removes the link. Both suggestions carry on separately |

Dismissing and undoing are both recorded. `decided_by` / `decided_at` keep who
dismissed the pair and when; undoing does not erase them, it stamps
`reopened_by` / `reopened_at` alongside. The row is never deleted, so the whole
decision trail stays readable.

**Scan existing suggestions** in the toolbar rechecks older suggestions. New
suggestions are already checked automatically as they arrive, so you only need
this for suggestions submitted before duplicate detection existed, or after
changing how matching works.

Filing one suggestion under another only sets a pointer. The duplicate keeps its
own text, status, history, notes and submitter details, and still appears in the
inbox on its own.

### Adding semantic matching later

The database, the API route and the dashboard all talk to the
`SimilarityStrategy` interface, and every stored score records the `method` that
produced it (`lexical-v1` today). To add embeddings, write a second strategy
with the same interface and point `defaultStrategy` at it. Old scores stay
readable because each row says how it was computed, and no dashboard code has to
change.

### Tables

`suggestion_matches` holds one row per pair — always with the lower id first, so
one relationship is one row — with the score, its breakdown, the method, the
state (`suggested` / `confirmed` / `dismissed`), who decided and when.
`suggestions.primary_suggestion_id` points a duplicate at the suggestion the
idea is being tracked under.

RLS is unchanged in shape and extended the same way: **students have no
privileges on duplicate data at all** — they cannot read matches, create them,
or see which suggestions are linked. Presidents can read, record and decide.
Nobody can DELETE a match row, which is what guarantees a dismissed pair stays
dismissed.

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
| Duplicate data | Students have no privileges on `suggestion_matches` and cannot read `primary_suggestion_id`. Nobody can delete a match, so a dismissal cannot be undone by a later scan |
| Secrets | The service-role key and all other private values are server-only; nothing private reaches the browser |
| Placeholder accounts | The placeholder co-president addresses fail the build and never authorize anyone at runtime |
| Email privacy | The two real addresses exist only in your Supabase project. They are not in this repository, not in deploy settings, and never printed in a build log |

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

## 2. Run the database migrations

Two ways. Both end in the same place; pick whichever you prefer.

### Option A — the SQL Editor (no tools, no secrets)

1. Supabase dashboard → **SQL Editor → New query**.
2. Run the three files in `supabase/migrations/` **in order**, each as its own
   query:
   1. `20260101000000_init.sql`
   2. `20260102000000_duplicates.sql`
   3. `20260103000000_duplicate_reversals.sql`

### Option B — the Supabase CLI

Run this **on your own machine**, so your access token and database password
stay there. `supabase/config.toml` is committed, so the CLI works in this
repository with no further setup.

```bash
# 1. Sign in. Opens a browser; no token is typed anywhere.
npx supabase login

# 2. Link this checkout to your project. Your project ref is in the
#    dashboard URL: https://supabase.com/dashboard/project/<ref>
#    You will be prompted for your database password — type it at the
#    prompt, never as a command-line argument (arguments land in shell
#    history).
npx supabase link --project-ref <your-project-ref>

# 3. See what would be applied, before applying it.
npx supabase db push --dry-run

# 4. Apply.
npx supabase db push
```

Expected output from step 4:

```
Applying migration 20260101000000_init.sql...
Applying migration 20260102000000_duplicates.sql...
Applying migration 20260103000000_duplicate_reversals.sql...
Finished supabase db push.
```

### Either way, verify

Run `supabase/tests/verify_schema.sql` in the SQL Editor. It is read-only and
adds no data. You want four `PASS` lines:

```
PASS: all 7 expected tables exist
PASS: RLS enabled on all 7 public tables
PASS: anon holds INSERT on suggestions and nothing more
PASS: anon holds no privileges on any other table
PASS: is_president() exists
```

The seven tables are `suggestions`, `internal_notes`, `authorized_presidents`,
`status_history` and `suggestion_matches`, plus the `submission_log` and
`digest_runs` bookkeeping tables.

## 3. Add the two co-presidents

The `authorized_presidents` table in your Supabase project is the **one list** of
co-presidents. There is no environment variable for them and nothing to commit.

1. Open `supabase/maintenance/add_presidents.sql`.
2. Copy it into your editor and replace the placeholders with the two real
   addresses and names. **Do not commit your edited copy** — the file in the
   repository stays as placeholders.
3. Paste the result into the Supabase SQL editor and **Run**.
4. The file ends with a `select` so you can confirm exactly two rows.

Why one list and not two: the RLS policies that actually guard the data call
`is_president()`, which reads this table and nothing else. An environment
variable holding the same addresses would add no real barrier, but it could
drift out of step with the table and lock a president out of a site that looks
perfectly healthy — and it would put the two real addresses somewhere they do
not need to be. Only the service role can write to this table, so it is already
the protected copy.

To remove a president later — a graduating co-president, say — delete their row.
They lose access on their next request. There is nothing else to change.

**Also configure Supabase Auth** (**Authentication → URL Configuration**). You will
come back to this in step 6 with your real Render address; for now:

- **Site URL**: `http://localhost:3000`
- **Redirect URLs**: add `http://localhost:3000/auth/callback`

Under **Authentication → Providers**, leave **Email** enabled; everything else can be
off. The app only ever sends a magic link to an address already on the roster.

## 4. Configure Resend *(optional — skip this and everything still works)*

The app never emails on submission. Resend is only for the optional once-a-day digest.

1. Create an account at [resend.com](https://resend.com) and verify your sending domain.
2. Create an API key and copy it.
3. Set `RESEND_API_KEY`, `DIGEST_FROM_EMAIL` (an address on the verified domain),
   `CRON_SECRET` and `DIGEST_ENABLED=true`.
4. Something has to call `/api/cron/digest` once a day. On Render that means adding a
   separate **Cron Job** service that runs
   `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/cron/digest`.

**Leave all of this until the site is working.** The digest is off by default, the
dashboard is the inbox, and nothing about the app depends on it. Adding a scheduled
function before the main site runs only gives you two things to debug at once.

With `DIGEST_ENABLED` unset or `false`, no email is ever sent. When enabled, the digest
goes out at most once per calendar day, and only if unread suggestions are waiting.

## 5. Add the environment variables

Copy `.env.example` to `.env.local` for local development. In Render the same
variables go under your service → **Environment** (you will add them in step 6,
when the service exists).

| Variable | Required | What it's for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public key; always constrained by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only; writes submissions and the rate-limit log |
| `NEXT_PUBLIC_SITE_URL` | once you have a domain | Used to build sign-in links. Falls back to Render's own `RENDER_EXTERNAL_URL`, so you can leave it unset while testing on the temporary address |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | recommended | Turnstile widget key |
| `TURNSTILE_SECRET_KEY` | recommended | Turnstile verification key |
| `IP_HASH_SALT` | recommended | Salt for hashing IPs in the rate-limit log |
| `DIGEST_ENABLED` | no | Leave `false` for launch |
| `RESEND_API_KEY` | no | Digest only |
| `DIGEST_FROM_EMAIL` | no | Digest only |
| `CRON_SECRET` | no | Required only if the digest is on |

There is **no** `PRESIDENT_EMAILS` variable. The co-presidents live in Supabase
(step 3), and nowhere else.

For Turnstile keys: [Cloudflare dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
→ **Add site**, choose the **Managed** widget, and add your Render address plus
`localhost`.

Run locally with:

```bash
npm install
npm run dev
```

## 6. Deploy to Render

A **Web Service**, not a Static Site. This app has route handlers, server actions,
middleware and server-guarded pages; all of them need a running Node process.
A static site would serve the landing page and nothing else would work.

Render only runs the web server. **Do not create a Render database** — Supabase
stays the database and the auth provider.

### Create the service

1. Push this repository to GitHub.
2. At [dashboard.render.com](https://dashboard.render.com) → **New → Web
   Service** → **Build and deploy from a Git repository** → connect GitHub and
   pick this repository.
3. Settings:

   | Setting | Value |
   |---|---|
   | Language / runtime | **Node** |
   | Branch | the branch you deploy from — **`main`** unless you have changed it |
   | Build command | `npm ci && npm run build` |
   | Start command | `npm start` |
   | Health check path | `/api/health` |
   | Instance type | **Starter** or above (see below) |

   These are the project's real scripts — `npm start` runs `next start`, which
   binds the `PORT` Render provides. Nothing needs overriding.

4. **Node version.** Render reads `engines.node` from `package.json` (`>=20.9.0`).
   To pin it exactly, add an environment variable `NODE_VERSION` = `22.11.0`.

5. **Environment variables** — your service → **Environment** → add the ones
   from step 5. Add them *before* the first deploy: the build runs a check that
   fails if Supabase is unreachable or the co-presidents are not set up.

   Leave `NEXT_PUBLIC_SITE_URL` unset for now. The app falls back to Render's
   own `RENDER_EXTERNAL_URL`, which is your temporary address.

6. **Auto-deploy.** Render defaults to deploying on every push to the branch you
   chose. Confirm it under **Settings → Build & Deploy → Auto-Deploy = Yes**,
   and that **Branch** is the one you actually merge into.

7. Deploy. Render gives you a temporary address like
   `https://suggestion-box-abc1.onrender.com`. Note it down.

### A note on the instance type

On the **Free** instance type Render spins the service down when idle, and the
cold start can take longer than someone's patience after clicking a magic-link
email — which looks exactly like broken authentication. **Starter** or above
stays warm. If you do use Free, expect the first request after a quiet period
to be slow, and warn your co-presidents.

### Point Supabase at the Render address

**Authentication → URL Configuration**:

- **Site URL**: your `https://….onrender.com` address
- **Redirect URLs**: add `https://….onrender.com/auth/callback`, and keep
  `http://localhost:3000/auth/callback` for local work

If you set Turnstile keys, add the `.onrender.com` hostname to the widget's
allowed domains in the Cloudflare dashboard.

### Health checking

`/api/health` returns `{"status":"ok"}` and nothing else. Render polls it to
decide whether a deploy went live and whether the instance is still healthy.

It deliberately does **not** touch Supabase. A health check that talks to the
database turns a brief Supabase blip into a failed deploy or a restart loop, and
restarting the web server does nothing to fix a database.

### Production logging

Render captures everything the process writes to stdout and stderr — your
service → **Logs**, with a filter box and a live tail.

The app logs deliberately and quietly. Worth recognising:

| Log line | Means |
|---|---|
| `[auth] roster lookup failed:` | Supabase was unreachable during a sign-in check |
| `[auth] Refused a placeholder co-president address` | a placeholder is still in `authorized_presidents` |
| `[suggestions] insert failed:` | a student's submission could not be saved |
| `[rate-limit] lookup failed:` | the limiter could not check, so it refused — fails closed |
| `[turnstile] TURNSTILE_SECRET_KEY is not set` | bot protection is off |
| `[duplicates] rescan failed:` | a president's manual scan errored |

No log line contains a student's name, a student's email, a co-president's
address, or any key.

### Changing a `NEXT_PUBLIC_*` value later

`NEXT_PUBLIC_*` variables are compiled into the build, not read at run time.
Changing one in Render's dashboard therefore needs a **new build** — **Manual
Deploy → Deploy latest commit** — not just a restart. This matters in step 7,
when `NEXT_PUBLIC_SITE_URL` changes to your custom domain.

Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `IP_HASH_SALT`, `CRON_SECRET`,
`RENDER_EXTERNAL_URL`) is read at run time and takes effect on restart.

### If the build fails

- **Out of memory during `next build`** — the Free instance type has limited
  build memory. Move to Starter or above.
- **`npm ci` fails on a lockfile mismatch** — `package-lock.json` is out of step
  with `package.json`. Run `npm install` locally and commit the updated lockfile.
- **The deploy check stops the build** — read the message; it names what is
  missing. It never prints anybody's address.

## 7. Connect your own custom domain

Only once step 9's tests pass on the `.onrender.com` address.

1. Render → your service → **Settings → Custom Domains → Add Custom Domain**.
2. Enter your domain, e.g. `suggestions.yourschool.org`.
3. Add the DNS record Render shows you, at your registrar:
   - subdomain → a `CNAME` to your `….onrender.com` address
   - apex domain → the `A` record Render gives you
4. Wait for Render to verify the domain and issue the certificate (usually
   minutes). Render shows the status next to the domain.
5. Then, **in this order**:
   1. Render → **Environment** → set `NEXT_PUBLIC_SITE_URL` to
      `https://your-domain` (no trailing slash).
   2. **Manual Deploy → Deploy latest commit.** A restart is not enough:
      `NEXT_PUBLIC_*` is compiled into the build.
   3. Supabase → **Authentication → URL Configuration** → change **Site URL** to
      the custom domain, and **add** `https://your-domain/auth/callback` to the
      redirect URLs. Leave the `.onrender.com` callback in place if you still
      want the temporary address to work.
   4. Cloudflare Turnstile → add the custom domain to the widget.
6. Sign in once on the custom domain to confirm the magic link arrives with the
   right host in it.

## 8. Clear any test submissions

If you submitted test ideas into this Supabase project while setting it up, take
them out before students arrive. A brand-new project has nothing to clean, so
you can skip this.

Open `supabase/maintenance/clear_test_data.sql` and run it in the SQL editor. As
written it **only shows you what is in the box** — the deletes are commented
out. Read the list, then uncomment the one option that matches your situation
and run it again.

There is deliberately no button for this in the dashboard. Emptying the
suggestion box should not be something anyone can do by misclicking while
reading students' ideas.

## 9. Test a real student submission

1. Open your live site in a private window — the `…onrender.com` address, not a
   custom domain.
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
8. Submit a second idea worded much like the first. In the dashboard both should carry a
   **Possible duplicate (1)** badge, and opening either should show the other under
   **Similar suggestions**. Try **Mark as related**, then **Not a duplicate**, then
   **Show 1 dismissed match → Undo dismissal**.

## 10. Confirm that unauthorized people cannot enter the president panel

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
supabase/config.toml             Makes `supabase link` / `db push` work in this repo
supabase/tests/                  Schema verification and access-control checks
supabase/maintenance/            One-off operator scripts (clearing test data)
scripts/check-deployment.mjs     Pre-build check: keys, site URL, and the roster
render.yaml                      Optional Render Blueprint: the service, written down
src/app/api/health/route.ts      Health check Render polls (no Supabase call)
```

## Commands

```bash
npm run dev           # local development
npm run build         # production build (runs the deployment check first)
npm run check:deploy  # deployment check on its own
npm run typecheck     # TypeScript, no emit
npm run lint          # ESLint
npm test              # unit tests (node:test, no extra dependencies)
```

### The deployment check

`npm run build` runs `scripts/check-deployment.mjs` first, so it runs on Render
too. Its main job is to confirm the two co-presidents actually exist in
Supabase, because a site with nobody on the roster looks completely finished
and has no way in:

```
ERROR   No co-presidents are set up in Supabase.
        Add the two of them with supabase/maintenance/add_presidents.sql.
        Until you do, nobody can sign in to /president.
```

**It never prints a real address.** It queries the roster with the service-role
key and judges it by count: a roster that looks wrong is reported as
"Supabase lists 1 authorized presidents, not 2", and you look in your own SQL
editor to see who that is. The only addresses it ever names are the
placeholders from this repository, which are safe by definition. A test asserts
this rather than trusting it.

It also errors on a missing `authorized_presidents` table (you have not run the
migrations), a rejected service-role key, missing Supabase keys, and a
`NEXT_PUBLIC_SITE_URL` pointing at localhost. It warns — without stopping the
build — about a missing Turnstile key, a missing `IP_HASH_SALT`, a digest
switched on without Resend, and a roster that is not exactly two people. If
Supabase cannot be reached at all it warns rather than failing, so a network
blip cannot block a deploy. A checkout with no environment is treated as a
local build and passes quietly.

Belt and braces: a placeholder address never authorizes anyone at runtime
either, even if one is left in the `authorized_presidents` table.

### Tests

`npm test` covers the duplicate-detection logic: near-identical titles, the same
wording in different case and punctuation, clearly unrelated suggestions,
similar titles in different categories, the common-word guard, pair ordering,
dismissed matches not being counted, confirmed links holding, and no suggestion
being removed by any of it.

Access control and the "a dismissal is permanent" guarantee are database
behaviour, so they are tested against a real Postgres:

```bash
psql "$DATABASE_URL" -f supabase/tests/duplicates_rls.sql
```

It prints PASS/FAIL per check and rolls back, leaving no data behind. Run it
against a development database, not production.

Test data never reaches production by any automatic route — there is no seeding
step and no demo mode — but if you tested against the project you are about to
launch, clear it with `supabase/maintenance/clear_test_data.sql` (step 8 above).
