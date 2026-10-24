# Alaap — landing page

Landing page for the privacy-preserving mental wellness platform described in
the architecture documents. React + TypeScript + Vite + Tailwind v4 + GSAP,
matching the frontend stack the architecture specifies.

```bash
npm install
npm run dev      # http://localhost:5177
npm run build    # typecheck + production build to dist/
```

---

## The design direction

Reference-driven, following the Meditate.ai, WELL-NESS and Mindwise boards.

| Axis | Decision | Why |
| --- | --- | --- |
| Display | Outfit, 400 weight on the hero and 500 below, `-0.035em` tracking | Geometric sans matching the references. No serif anywhere. Lighter strokes on the hero so a large headline sits over the film without shouting |
| Body | Manrope | Humanist geometry, calm at 16–18px, low cognitive load |
| Data | JetBrains Mono | Used **only** for machine-generated strings: pseudo-handles, vault names, expiry timers. The mono treatment is the visual proof of "you are a number here, not a name" |
| Palette | Studio ink and molten gold on the hero, warm paper below | Sampled from the film's own grade, so page and footage share one darkness |
| Layout | Left-anchored three-line headline under a pill badge, clear of the subject | Keeps the figure visible and gives all four scenes one alignment |
| Rhythm | Dark hero, light body, two dark bands to punctuate | The film should hit; pricing and privacy are read in daylight |

The hero's floating composer panel is the product's actual first action — post
categories from the specification, a five-day expiry stamp — not a decorative
widget.

Structural devices encode real information. Section eyebrows are not
`01 / 02 / 03` decoration — they are the actual vault and privacy mode from the
architecture (`COMMUNITY VAULT · PRIVACY MODE 1`), because the system genuinely
has numbered privacy modes and named vaults.

### Theming

Two scopes, `.theme-dark` and `.theme-light`, declared on section roots.
Semantic names never say dark or light — they say `surface`, `on-surface`.

One trap worth knowing: Tailwind v4's `@theme` substitutes custom properties at
their declaration site. Aliasing `--color-ink: var(--on-surface)` once on
`:root` resolves there permanently and will *not* re-resolve inside
`.theme-dark`, so every themed section renders in the default palette — which
showed up as a dark-on-dark headline. Each theme scope therefore redeclares the
`--color-*` names with concrete values.

### Section rhythm

Sections alternate ground deliberately — light, light, dark, light, dark,
light, dark — so no two adjacent bands share a background. A uniform run of
light sections with the same eyebrow → heading → lede → grid shape is what made
the page read as an article rather than a product.

Every section is full-bleed with a `clamp(1.1rem, 4vw, 4rem)` inset instead of
a centred `max-width` shell, and headings sit in a two-up grid beside their
lede rather than stacked in a left column. Measured: all sections now use
1287–1389px of a 1440px viewport; the trust band alone went from 768px to
1325px.

### Social proof

The references run a big-number row (10,000+ Members, 95% Satisfaction). Alaap
has not launched, so those numbers would be fabricated. The stat band uses
architectural facts from the specification instead — 6 vaults, 5-day expiry,
3-of-5 break-glass keys — which are verifiable and more relevant to someone
deciding whether to trust it. The hero's avatar stack is pseudonymous
identicons, not stock faces, for the same reason.

The Shield section counts blocked replies, but counts only what its own demo
has caught while you watch, and says so on screen. A running total of real
blocked messages would be fabricated for a platform that has not launched —
and you can see each sample arrive and get caught, so it reads as a
demonstration rather than a metric.

---

## Structure

| Section | Notes |
| --- | --- |
| `Hero` | Full-screen pinned section, left-anchored headline under a pill badge, floating composer panel; the film scrubs to scroll position |
| `TrustStrip` | Four structural facts, not vanity metrics |
| `Beats` | The four narrative keyframes as feature sections, each ending in an honest limit |
| `HowItWorks` | The two-identity separation |
| `Shield` | Full-bleed dark. A live demonstration of the moderation filter with per-category tallies |
| `LivePosts` | Auto-scrolling 3D marquee of illustrative community posts, on a dark band |
| `ConsentStudio` | Interactive: flip the two consent switches, watch who gains and loses sight of a record |
| `Privacy` | The six protected data domains |
| `AITransparency` | What the AI does / never does, plus a worked moderation screen |
| `Pricing` | Four plans with a standard ↔ Care Access toggle |
| `Safety` | Three risk tiers and the 3-of-5 threshold break-glass model |
| `FAQ`, `FinalCTA`, `Footer` | Including the required non-diagnosis disclaimers |

---

## Implementation notes worth knowing

**The hero is a dwell timeline, not a linear scrub.** Scroll progress maps to
video time through a piecewise ramp: sloped runs are the transitions the film
was shot to carry, flat runs are *dwells* where video time stops advancing so
the picture holds still and the copy can be read. Measured hold, at a 900px
viewport: **550px, 600px and 1050px** of scroll per scene.

Four shots between the key scenes carry no copy but make the metaphor legible:
the stones breaking into dust, the dust drawing into a gold thread, the thread
entering a stone held in cupped hands, and the thread passing hand to hand. At
an even scrub rate each flashed past in well under 100px of scroll. They now
get their own shallow ramps, plus short holds on the dust column and on the
first pair of hands. Measured: the stones-to-dust shot plays over ~650px, and
the hands sequence (18.5–23.5s of film) over **1050px**, up from ~320px.

The gradient of each segment *is* the playback rate, so slowing a shot means
giving its segment more progress, not changing any easing.

During every dwell a high-resolution still crossfades over the video, because a
scrubbed h.264 frame is much softer than the original render. The stills are the
same four frames the film passes through, so the crossfade is invisible.

Every opacity in the hero is derived from one number each frame — a pure
function of scroll progress — rather than a dozen overlapping tweens. Two bugs
came out of the envelope maths and are worth not reintroducing:

- A window returns 0 when progress *equals* its start or end. The last scene's
  window ended exactly at 1, so the closing still and its copy vanished at the
  bottom of the pin; the first scene's started exactly at 0, so the opening
  frame fell back to the soft video. Windows now overshoot at both ends.

Copy is anchored to whichever part of the frame the subject is not occupying.
The seated figure in scene 1 is centred, so the opening copy sits left of her;
scenes 2 and 4 are composed hard right so their text takes the empty left; scene
3 fills the middle band so its text sits above it. Every scene therefore reads
left-aligned, which is also why the opening block is a badge, a headline and one
line — a centred sub-paragraph and button pair stacked four blocks over her
face. The persistent nav CTA carries the conversion path instead. The opening
block clears within the first 5% of scroll rather than lingering.

Seeks are *scheduled*, not applied inline: scroll sets a target, and a
`gsap.ticker` callback applies it only when `readyState >= 2` and the element is
not already seeking. Without that decoupling, fast scrolling stalls the decoder.

**Theme classes must never paint.** `.theme-dark` in `@layer utilities` setting
`background` beats `bg-transparent`, which silently turned the transparent hero
nav into an opaque slab. The scopes now only re-point tokens.

**The nav's light/dark switch uses a sentinel, not a scroll threshold.** The
hero is pinned for 7.5 viewport heights, so any scroll-position guess flips the
bar to light while the film is still on screen. An `IntersectionObserver` on a
1px element after the hero is correct whatever the pin length becomes.

**Do not add a dependency array to the hero's `useGSAP`.** Re-running it builds
a second pinned ScrollTrigger on the same element, which translates the hero
several thousand pixels down the page. This was a real bug during the build.

**3D marquee.** A duplicated track loops at `xPercent: -50`. Each card's
`rotationY` / `z` / `opacity` is driven per frame from its distance to the
viewport centre using `gsap.quickSetter`. It slows to 12% on hover or focus,
and pauses entirely when the section is off-screen. The duplicate half is
`aria-hidden` so screen readers read the set once.

**Reduced motion is a real branch, not a stylesheet override.** Under
`prefers-reduced-motion: reduce` the hero does not pin or scrub, all copy
stacks statically and the marquee does not animate. Verified: page height drops
from ~16,850px to ~14,500px and zero elements sit below 0.15 opacity.

---

## Verification performed

- Contrast measured against **rendered pixels** in both themes: hero headline
  13.4:1, hero sub 6.8:1, light-section headings 18.1:1, light body 9.3:1,
  dark-band mono labels 5.0:1, footer links 18.0:1 — all above WCAG AA
- One `h1`, no heading-level skips, every `img` has an `alt`
- No interactive target under 24px outside the inline-in-sentence exception
- Visible 2px focus ring on every tab stop; skip link is the first stop
- Zero console errors; production build clean
- Checked at 390px and 1440px

## Known gaps

- Links are `#` anchors — this is the landing page only, no routes behind it.
- Community posts in the marquee are illustrative copy written for this page,
  labelled as such on the page itself. They are not real user content and must
  not be presented as testimonials.
- Prices come from the architecture document (₹0 / ₹99 / ₹799 and the ₹49 /
  ₹399 Care Access rates). Wire them to the Billing & Subsidy service before
  launch, along with real funder names and slot counts.
