# Session handoff — 24 October 2026

Written at the end of a session so the next one can pick up without re-deriving
anything. Everything below was verified in this session unless it says otherwise.

---

## 1. Where the project stands

Alaap — privacy-preserving mental wellness platform for India, solo founder
(Aakash). All ten milestones M0–M9 complete; the product runs end to end on one
machine and every function a member can press has been driven in a browser.

Standing constraints, unchanged:

- **No advertising revenue, ever.**
- **5-day post expiry** for freemium.
- **Journals and short stories are paid-only** (Interaction Plus or above).
- **Full government subsidy at ₹99/month**, not ₹49.
- **A1 runs on Aakash's own PC.** He runs `train.py` himself and pastes
  results — prepare the corpus and hand over the command, do not run training.

---

## 2. What was done this session

Seven commits, all on `main`, working tree clean.

```
cf917b2  Let the dev server answer to a VS Code dev tunnel
701b9c2  Fix the crash on the All three tab, and the typecheck that missed it
a6692df  Draw the whole calendar month, and plot only as far as today
1a454c2  Make the month and year views run from the 1st to today
323afb4  Fix the chart's axis, its bounds, and a mood step that could not be saved
e4c809c  Store the stress number the dashboard was already collecting
e61d058  Initial commit: Alaap platform through M9
```

### 2.1 The repository did not exist

The project had **never been committed** — a `.gitignore` and `.github/` but no
`.git`. `e61d058` is the baseline: 1,089 files, 74,351 lines. No `.env`, key or
`node_modules` went in; the existing `.gitignore` was already thorough and the
staged list was checked rather than trusted.

Two incidental changes: `*.egg-info/` added to `.gitignore`, and a **repo-local**
git identity set (`Aakash <dhill.sunita90@gmail.com>`) because none existed and
the commit would otherwise have failed.

### 2.2 Stress was collected and thrown away

The dashboard asked for mood, sleep and stress; `mood_checkins` had columns for
two. Stress was read off the member and discarded.

- `database/migrations/clinical-vault/0002_stress_score.sql` — appended, never
  editing the applied `0001` whose SHA is in the ledger. Nullable on purpose.
- Registered in `scripts/db/migrate.mjs` (an **explicit ordered list**, not a
  directory scan — new migrations must be added there or they silently skip).
- Carried through `records.ts`, `purge.ts` (so it leaves on export — it is
  member data), the API schema and the application type.
- No grant change needed: `0004` grants on `mood_checkins` as a table.

### 2.3 Three chart faults, one of them serious

- **The lowest mood step could not be saved at all.** `mood_score` is 1–10 and
  the API rejects below 1; the UI sent the 0-based index, so "Heavy" went as `0`
  and returned **400** under "That could not be saved just now". The member
  having the heaviest day was the only one who could not record it. Confirmed in
  the network log before and after. The seven word-steps are **1–7** now.
- **Lines ran outside the card.** `sleep` was scaled `[4,10]` against a control
  allowing 0–12; `mood` was scaled on the index. `projectGapped` now clamps too.
- **The axis described a generic window.** Fixed strings left from the deleted
  `trend()` generator.

A standing guard was added to `clinical-flows.mjs`: both ends of all three
controls. This class of bug — UI scale vs API scale — escaped every suite
because each half was correct alone.

### 2.4 The chart axis — settled after three attempts

Final shape, and the one the user asked for explicitly:

> the horizontal scale should remain as per the number of days in the testing
> month (28/29 for February, 30/31 otherwise); only the graph up to the present
> date should be plotted.

`rangeWindow(range, now)` returns `{ start, length }` for whole calendar
periods: week Monday→Sunday, month 1st→last day, year Jan→Dec. February's leap
year comes from the calendar (day 0 of the next month), not arithmetic. Days
after today are null and draw nothing.

Two earlier attempts were wrong in opposite directions and are worth not
repeating: a fixed axis over a rolling window (labelled the last reading with a
future date), then a window that ended at today (shrank the month to fit).

Fell out of it:
- The history fetch asked for 30 days while the year view spanned 365.
- A one-day span drew nothing — `M x,y` has no length. Single-point runs now get
  a zero-length segment rendered as a dot by the round linecap.
- The area fill closed at the card's right edge, shading unlived days.
- **A UTC/local date bug.** `seriesFrom` keyed days with `toISOString()` while
  `entry_date` is a local calendar day. It only worked because it was called
  with the current time-of-day attached; anchored to local midnight it would be
  a day out everywhere east of UTC. The same bug sat in the effect seeding the
  controls, where before 05:30 IST it would miss today's row and let Save
  overwrite it. Both use a `localDay` helper now.

### 2.5 The typecheck was reporting nothing

**Read this before trusting a green typecheck.**

`npx tsc --noEmit -p frontend` checks **zero files** and exits 0 —
`frontend/tsconfig.json` is solution-style (`"files": []` plus references).
Every frontend typecheck reported earlier in the session was vacuous, which is
how `701b9c2`'s crash shipped.

- Correct: **`npx tsc -b frontend`** (185 files), or `npx turbo run typecheck`.
- `frontend/package.json` now has a `typecheck` script, so `pnpm typecheck`
  covers the frontend. All 21 packages pass.

### 2.6 Dev tunnel

Vite 403'd the VS Code dev tunnel host, so a second device got an error for
every module request and rendered its cache — which looked like stale code. The
code was current. Fixed with `allowedHosts: ['.devtunnels.ms']` in
`frontend/vite.config.ts`, scoped rather than `true`, because that check is
DNS-rebinding protection on an origin that proxies `/api` with a live session
cookie.

---

## 3. Current machine state

- Docker: five containers healthy. Services: all 8 + ai-orchestrator up.
- **One** dev server: port **5177** (the user's own, which the tunnel points at).
  The 5179 preview was stopped at the user's request.
- Demo account `9000000001`, handle `SepiaPeepal-9767`, pseudo_id
  `2166178054412074`. Mood data: **30 rows, 24 Sep → 23 Oct, today empty** so
  pressing Save today visibly extends the line.
- Dev sign-in prints the OTP on the page — so anyone who can open the tunnel can
  sign in as any number. The user was advised to keep the tunnel **Private**.

---

## 4. Open items

**Blocking, needs the user:**

- **The push.** `git remote -v` is empty. `gh` is **not installed** and there are
  no stored credentials or SSH keys, so the repo must be created under the
  user's account. Git Credential Manager *is* present
  (`D:\Git\mingw64\bin\git-credential-manager.exe`) and is set as this repo's
  helper, so the first push will open a browser sign-in. Waiting on the URL;
  seven commits queued. Private recommended.

**Not blocking, not requested:**

- A1: `self_harm_encouragement` has no adjudicated training data — the binding
  constraint on public launch. `sexual_exploitation` has zero rows and
  enforcement is OFF. `religious_coercion` has 14 unique texts. Generation
  prompts are written (`docs/ai/dataset-repair-prompts.md`, Prompts 6 & 7);
  nothing generated or staged.
- Pair datasets fix the reply-only shortcut (0.333) but have the mirror:
  context-only F1 **0.93**, 0 of 4,383 contexts under more than one label.
- No human reviews anything — appeals, reports, crisis alerts all recorded, none
  routed. Nobody can set a legal hold, though deletion honours one.
- Journal *reading* surface unbuilt (entries can be written, not listed/reopened).
- "Safety plan" panel disabled; "Message Care" needs care-therapy-service.

---

## 5. Working notes that save time

- **Bash heredocs eat a backslash level.** For content with backslashes or
  backticks, write a `.py` file to the scratchpad and run it.
- **LibreOffice must be invoked directly** on Windows —
  `/c/Program Files/LibreOffice/program/soffice.exe --headless --convert-to pdf`;
  the docx skill's `soffice.py` uses `AF_UNIX` and fails. Render pages with
  `pymupdf`; `pdftoppm` is unavailable.
- **The status doc generator now lives in the repo** at
  `tools/generators/status-doc.js` (it was lost twice from scratch directories).
  `node tools/generators/status-doc.js` regenerates
  `docs/Alaap-Status-and-Roadmap.docx`. Its header lists the commands to
  re-measure the numbers.
- **Services do not run with `--watch`** — restart after editing backend code.
  `node scripts/dev/up.mjs` (`--status`, `--stop`) handles the whole stack
  including OpenBao key re-provisioning and `ALAAP_SERVICE_AUTH_SECRET`.
- **Verify charts by reading path geometry, not screenshots.** The browser pane
  scales and the numbers are decisive.
- The console buffer in the browser pane **persists across navigations**; check
  module timestamps before believing an error is current.
