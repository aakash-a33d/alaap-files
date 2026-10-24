import { Link } from 'react-router-dom'
import { BRAND, DISCLAIMERS } from '../../../content/site'

const COLUMNS = [
  {
    title: 'Platform',
    links: [
      'How it works',
      'Anonymous community',
      'Interaction Plus',
      'Guided group care',
      'One-to-one care',
      'Therapist directory',
    ],
  },
  {
    title: 'Trust',
    links: [
      'Privacy centre',
      'AI transparency centre',
      'Community guidelines',
      'Safety and crisis support',
      'Data export and deletion',
      'Grievance portal',
    ],
  },
  {
    title: 'Partners',
    links: [
      'Subsidised care',
      'NGO and CSR programme',
      'Universities and employers',
      'Join as a therapist',
      'Clinical governance',
      'Help centre',
    ],
  },
]

export function Footer() {
  return (
    <footer className="theme-dark border-t border-[var(--border)] bg-sunken">
      <div className="u-shell py-[clamp(3rem,6vw,5rem)]">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
                <circle
                  cx="16"
                  cy="16"
                  r="15"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.35"
                />
                <path
                  d="M9 17.5c2.6 2 4.6 2.8 7 2.8s4.4-.8 7-2.8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M11.5 12.2c1.6-1.1 3-1.6 4.5-1.6s2.9.5 4.5 1.6"
                  stroke="var(--gold-500)"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
              <span className="font-[family-name:var(--font-display)] text-[1.28rem] font-medium tracking-[-0.035em] text-ink">
                {BRAND.name}
              </span>
            </div>

            <p className="mt-5 max-w-xs text-[0.875rem] leading-relaxed text-faint">
              {BRAND.tagline}. Built so that your public identity stays private
              and your information stays separated, encrypted and
              consent-controlled.
            </p>

            <Link to="/join" className="btn btn--primary mt-7">
              {BRAND.cta}
            </Link>
          </div>

          <div className="grid gap-10 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h2 className="u-label mb-4 text-[0.5625rem]">{col.title}</h2>
                <ul className="flex flex-col gap-2.5">
                  {col.links.map((l) => (
                    <li key={l}>
                      <a
                        href="#top"
                        className="inline-flex min-h-6 items-center py-1 text-[0.875rem] text-muted transition-colors duration-200 hover:text-ink"
                      >
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="rule-seam my-10" />

        <ul className="flex flex-col gap-2">
          {DISCLAIMERS.map((d) => (
            <li key={d} className="text-[0.8125rem] leading-relaxed text-faint">
              {d}
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-7">
          <p className="font-[family-name:var(--font-mono)] text-[0.6875rem] text-faint">
            © {new Date().getFullYear()} {BRAND.name}. Concept landing page.
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {['Privacy policy', 'Terms', 'Grievance officer', 'Accessibility'].map(
              (l) => (
                <li key={l}>
                  <a
                    href="#top"
                    className="inline-flex min-h-6 items-center py-1 text-[0.75rem] text-faint transition-colors duration-200 hover:text-muted"
                  >
                    {l}
                  </a>
                </li>
              ),
            )}
          </ul>
        </div>
      </div>
    </footer>
  )
}
