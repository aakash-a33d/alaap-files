import { Reveal } from '../../../components/ui/Reveal'

/* ============================================================================
   Four things a visitor can check, stated in their terms.

   The earlier version counted internal systems — "6 isolated vaults", "3/5
   keys to break glass" — which is inward-facing jargon that asks the reader to
   understand our architecture before they can feel reassured. These four are
   promises about what happens to *them*.

   The five-day post expiry used to sit here. It belongs to the free plan only,
   so it now appears once, on that pricing card, and nowhere else.
   ========================================================================= */

const FACTS = [
  {
    n: '2',
    label: 'separate identities',
    sub: 'Your name never travels with your words. Nothing joins them together.',
  },
  {
    n: '0',
    label: 'trackers',
    sub: 'No ad pixels, no behavioural profiling. Nothing here is sold, ever.',
  },
  {
    n: '100%',
    label: 'of replies checked',
    sub: 'Every response is reviewed for harm before it is shown to you.',
  },
  {
    n: '3 of 5',
    label: 'approvals to reach you',
    sub: 'Independent sign-offs required before anyone can contact your emergency contact.',
  },
]

export function TrustStrip() {
  return (
    <section
      aria-labelledby="trust-title"
      className="theme-light relative border-y border-[var(--border)] bg-surface"
    >
      <div className="px-[clamp(1.1rem,4vw,4rem)] py-[clamp(4rem,8vw,7rem)]">
        {/* Centred, because this is the page's plainest promise and it should
            read like a statement rather than a column of body copy. */}
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="u-eyebrow justify-center">Built privacy-first</p>
          <h2 id="trust-title" className="u-h2 mt-5">
            Built so nobody has to take our word for it.
          </h2>
          <p className="u-lede mx-auto mt-6">
            Anonymity here is not a policy we promise to follow. It is how the
            thing is put together — your identity and your words are kept apart,
            and no part of the system is able to put them back together.
          </p>
        </Reveal>

        <Reveal
          className="mt-[clamp(3rem,6vw,5rem)] grid gap-x-10 gap-y-12 border-t border-[var(--border)] pt-[clamp(2.5rem,5vw,3.5rem)] sm:grid-cols-2 lg:grid-cols-4"
          stagger={0.09}
        >
          {FACTS.map((f) => (
            <div key={f.label} className="flex flex-col">
              <span className="font-[family-name:var(--font-display)] text-[clamp(3rem,5.2vw,4.4rem)] font-medium leading-[0.9] tracking-[-0.05em] text-accent">
                {f.n}
              </span>
              <span className="mt-3 text-[1.02rem] font-semibold leading-tight text-ink">
                {f.label}
              </span>
              <span className="mt-2 text-[0.86rem] leading-relaxed text-muted">
                {f.sub}
              </span>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
