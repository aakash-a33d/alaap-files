import { Link } from 'react-router-dom'
import { BRAND } from '../../../content/site'
import { Reveal } from '../../../components/ui/Reveal'

const VERIFICATION = [
  { k: 'Registration verified', v: 'Before a therapist is ever listed' },
  { k: 'Category shown', v: 'Psychologist, clinical, counsellor or psychiatrist' },
  { k: 'Access is scoped', v: 'Active care relationship and your consent only' },
  { k: 'Every look is logged', v: 'Written to a permanent log nobody can edit' },
]

export function FinalCTA() {
  return (
    <>
      {/* --------------------------------------------- therapist verification */}
      <section
        id="verified"
        className="theme-dark relative border-t border-[var(--border)] bg-surface py-[clamp(3rem,6vw,5rem)]"
      >
        <div className="u-shell">
          <Reveal className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_1fr] lg:items-center">
            <div>
              <p className="u-eyebrow">Verified care</p>
              <h2 className="mt-4 text-[clamp(1.5rem,2.6vw,2.1rem)] leading-snug text-ink">
                Nobody practises here on a claim
              </h2>
            </div>

            <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
              {VERIFICATION.map((v) => (
                <div key={v.k} className="border-t border-[var(--border-seam)] pt-4">
                  <dt className="text-[0.875rem] font-semibold text-ink">{v.k}</dt>
                  <dd className="mt-1.5 text-[0.8125rem] leading-relaxed text-faint">
                    {v.v}
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------- close
          `theme-dark` is doing real work here. This section paints a dark
          photograph and a near-black scrim, but without the scope it inherited
          the light palette — near-black headings on a near-black ground, which
          measured 1.6:1. A section that paints dark must declare dark. */}
      <section
        id="start"
        className="theme-dark grain relative isolate overflow-hidden bg-[var(--ink-950)]"
      >
        <img
          src="/media/beat-4-seam.webp"
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full scale-105 object-cover opacity-40"
        />

        {/* Two scrims: a vertical one to seat the section against the bands
            above and below, and a radial one that darkens hardest exactly
            where the copy sits. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,var(--ink-950)_0%,rgb(6_5_5/0.62)_30%,rgb(6_5_5/0.78)_68%,var(--ink-950)_100%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_52%,rgb(6_5_5/0.86)_0%,rgb(6_5_5/0.55)_55%,transparent_85%)]"
        />

        <div className="relative z-10 px-[clamp(1.1rem,4vw,4rem)] py-[clamp(5.5rem,13vw,10rem)]">
          {/* Centred, as the page's final beat — every other band is
              left-anchored or two-up, so the close reads as an arrival. */}
          <Reveal className="mx-auto max-w-4xl text-center">
            <p className="u-eyebrow justify-center">Kintsugi</p>

            <h2 className="mx-auto mt-6 max-w-[18ch] text-[clamp(2.2rem,5.4vw,4.4rem)] leading-[1.02] text-ink">
              The repair is meant to show.
            </h2>

            <p className="u-lede mx-auto mt-7 text-balance">
              You do not have to arrive with the right words, a diagnosis, or any
              intention of paying for anything. Post once, anonymously, and see
              what comes back.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link to="/join" className="btn btn--primary">
                {BRAND.cta}
                <svg width="15" height="12" viewBox="0 0 15 12" aria-hidden="true">
                  <path
                    d="M1 6h12M9 2l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <a href="#privacy" className="btn btn--ghost">
                Read the privacy model first
              </a>
            </div>

            <ul className="mt-9 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
              {['No card required', 'Free tier never expires', 'Passkey login'].map(
                (t) => (
                  <li key={t} className="chip">
                    {t}
                  </li>
                ),
              )}
            </ul>
          </Reveal>
        </div>
      </section>
    </>
  )
}
