# Handoff — Alaap landing page

State as of the end of the build session. Read this plus `README.md` before
changing anything; `SETUP.md` covers running it on another machine.

---

## What this is

Landing page for **Alaap**, a privacy-preserving mental wellness platform,
built from two architecture documents in `~/Downloads`:

- `Privacy-Preserving Mental Wellness Platform Architecture.docx`
- `Frontend and Backend Architecture for the Privacy-Preserving Mental Wellness Platform.docx`

Stack: React 19 + TypeScript + Vite 8 + Tailwind v4 + GSAP + react-router-dom.
`npm ci && npm run dev` → http://localhost:5177

## Current section order

Themes alternate deliberately so no two adjacent bands share a ground.

| # | Section | Theme |
|---|---|---|
| 1 | `Hero` | dark |
| 2 | `TrustStrip` | light |
| 3 | `Beats` (3 features) | light |
| 4 | `Shield` | **dark** |
| 5 | `HowItWorks` | light |
| 6 | `LivePosts` | **dark** |
| 7 | `ConsentStudio` | light |
| 8 | `Privacy` | **dark** |
| 9 | `AITransparency` | light |
| 10 | `Pricing` | light |
| 11 | `Safety` | light |
| 12 | `FAQ` | light |
| 13 | `FinalCTA` / `Footer` | dark |

Plus a second route: `/community` and `/community/:slug` — the forum page,
lazy-loaded as its own chunk.

---

## Decisions that are load-bearing

Change these only deliberately — each one was a specific correction.

**No invented metrics.** The platform has not launched, so no "10,000+ members"
or "95% satisfaction". The trust band uses promises to the reader (2 separate
identities, 0 trackers, 100% of replies checked, 3 of 5 approvals). The Shield
counts only what its own demo catches while you watch, and says so on screen.
Community posts and forum threads are labelled illustrative. Avatar stack is
pseudonymous identicons, not stock faces.

**No internal system names in user-facing copy.** "Identity Vault", "Clinical
Vault", "Privacy Gateway", "Privacy Mode 3" were all removed at the client's
request. Everything is now phrased as a guarantee to the reader. If you add
copy, keep to that register.

**Five-day post expiry appears once**, on the Anonymous Community pricing card,
and nowhere else — it is a free-plan limit, not a platform-wide feature.

**Three features, not four.** Anonymous posting and AI filtration are one story;
splitting them made free-plan limits read as product features.

---

## Traps this codebase has already hit

Each of these was a real bug. They are cheap to reintroduce.

**Tailwind v4 `@theme` substitutes at the declaration site.** Aliasing
`--color-ink: var(--on-surface)` once on `:root` resolves there permanently and
will *not* re-resolve inside `.theme-dark`. Every theme scope in
`src/styles/tokens.css` therefore redeclares the `--color-*` names with concrete
values. Symptom when broken: dark-on-dark headline.

**A section that paints dark must declare `theme-dark`.** The closing `#start`
CTA painted a dark photograph and a near-black scrim but never declared the
scope, so it inherited the light palette — near-black headings on a near-black
ground, measured at **1.6:1**. Every section is now audited; if you add one that
paints its own background, set the matching scope on the same element.

**Theme classes must never paint.** `.theme-dark` setting `background` in
`@layer utilities` beats `bg-transparent` and turned the transparent hero nav
into an opaque slab. The scopes only re-point tokens; the rule that sets
`color` lives in `@layer base` so `text-*` utilities still win.

**GSAP leaves an inline transform, which outranks CSS `:hover`.** This silently
killed the pricing card lift. `Reveal` now passes `clearProps: 'transform'`.
Anything that both reveals and has a CSS hover transform depends on this.

**The hero's envelope returns 0 when progress equals a window boundary.** The
last scene's window ended exactly at 1 and vanished at the bottom of the pin;
the first started exactly at 0 and fell back to the soft video. Windows in
`Hero.tsx` overshoot at both ends on purpose.

**Do not add a dependency array to the hero's `useGSAP`.** It builds a second
pinned ScrollTrigger and throws the hero thousands of pixels down the page.

**In a `preserve-3d` context, a flat parent wins the hit test over children
pushed to negative Z.** The marquee track is `pointer-events-none` and the cards
`pointer-events-auto`, otherwise only the near-centre card is clickable.

**Beware scripted edits keyed on strings that repeat.** An edit matching
`id: 'care'` hit `SCENES` instead of `BEATS` and duplicated ~100 lines of
`content.ts`. When editing that file by script, check each export appears
**exactly once**, not merely that it is present.

---

## The hero, briefly

`Hero.tsx` pins for 7.5 viewport heights and maps scroll to video time through a
piecewise ramp in `TIMELINE`. Flat runs are dwells; the gradient of a sloped run
*is* the playback rate, so slowing a shot means giving its segment more
progress, not changing easing.

Measured holds at a 900px viewport: scenes hold 550px / 600px / 1050px; the
stones-to-dust shot plays over ~650px; the hands-and-thread sequence over
~1050px. High-resolution stills crossfade over the video during each dwell
because a scrubbed h.264 frame is much softer than the original render.

---

## Verification harness

Throwaway Playwright scripts live in the session scratchpad, not the repo. They
are trivial to rewrite; the checks worth repeating after any visual change:

- **Contrast against rendered pixels**, not token values — screenshot the text's
  own box and compare foreground to the median background. Two ways this lies:
  a partly-clipped element gives a nonsense ratio (produced a false 1.09:1), and
  `scroll-behavior: smooth` means a fixed wait can screenshot *mid-scroll* and
  sample a completely different band (produced a false 1.11:1 on text that
  actually measures 16.3:1). Inject `html{scroll-behavior:auto !important}`
  before measuring, and scroll the target to viewport centre.
- **Reduced motion** — page height should drop (~22,400px → ~15,600px) with zero
  elements below 0.15 opacity.
- **Structure** — one `h1`, no heading-level skips, every `img` has `alt`.
- **Network** — no 4xx. Use `waitUntil: 'domcontentloaded'`; `networkidle`
  never fires because the hero video keeps streaming.

Current contrast: hero 15.2:1, shield 16.2:1, consent 16.9:1, pricing 16.9:1,
light body 9.3:1 — all above WCAG AA.

---

## Open items

- **Nano Banana Pro image prompts were written but the images were never
  generated.** Six prompts (the Shield barrier, Consent Studio, two vaults, peer
  matching, five-day expiry, break-glass threshold) are in the session
  transcript. The Shield and Consent Studio are built as layered containers
  expecting a background plate, so artwork drops straight in.
- All links are `#` anchors except `/community`. No backend.
- Prices come from the architecture doc (₹0 / ₹99 / ₹799 and the ₹49 / ₹399
  Care Access rates). Wire to the Billing service with real funder names before
  launch.
- Bundle is 94 kB gzipped app + 47 kB gsap. Fine, but gsap is the obvious lever
  if that ever matters.
- Never verified on real GPU hardware or a physical phone — all checks ran in
  headless Chrome at 390px and 1440px.
