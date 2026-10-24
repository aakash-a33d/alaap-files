import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BRAND } from '../../content/site'

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#community', label: 'Community' },
  { href: '#care', label: 'Care' },
  { href: '#pricing', label: 'Pricing' },
]

function Mark({ className = '' }: { className?: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      {/* Inherited from the Unsaid identity: a closed mouth with a gold seam.
          The rename to Alaap — the opening utterance — argues for an opening
          mouth or a first sounded line instead. Design decision, not yet made. */}
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
  )
}

function Wordmark() {
  return (
    <a
      href="#top"
      className="inline-flex min-h-11 items-center gap-2.5 text-ink"
      aria-label={`${BRAND.name} — home`}
    >
      <Mark />
      <span className="font-[family-name:var(--font-display)] text-[1.28rem] font-medium tracking-[-0.035em]">
        {BRAND.name}
      </span>
    </a>
  )
}

function ArrowGlyph() {
  return (
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
  )
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  /* The bar sits on the dark film at the top and on light paper below it.
     A permanently dark bar reads as a heavy black slab over the light body. */
  const [onLight, setOnLight] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /* The hero is pinned for several viewport heights, so "past the hero" cannot
     be a scroll-position guess — it would flip to light while the film is
     still on screen. Watch a sentinel sitting immediately after the hero
     instead, which is correct whatever the pin length becomes. */
  useEffect(() => {
    const sentinel = document.getElementById('hero-end')
    if (!sentinel) return
    const io = new IntersectionObserver(
      ([e]) => setOnLight(e.boundingClientRect.top <= 72 && !e.isIntersecting),
      { rootMargin: '-72px 0px 0px 0px', threshold: 0 },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <>
      <a
        href="#main"
        className="btn btn--primary sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[400]"
      >
        Skip to content
      </a>

      {/* Sits over the dark hero, so the bar itself is always dark-themed.
          Once scrolled past the hero it gains a solid ground of its own. */}
      <header
        className={[
          'fixed inset-x-0 top-0 z-[200] transition-colors duration-300',
          onLight ? 'theme-light' : 'theme-dark',
          /* Over the film the bar stays transparent so it reads as part of the
             picture. It only gains a ground once the light body starts. */
          onLight && scrolled
            ? 'border-b border-[var(--border)] bg-[rgb(252_251_248/0.88)] backdrop-blur-xl'
            : 'border-b border-transparent bg-transparent',
        ].join(' ')}
      >
        {/* Full width with a small inset rather than the centred shell, so the
            wordmark and CTA sit near the edges of the frame as in the
            references — not tucked into a centred column. */}
        <nav
          className="flex items-center gap-6 px-[clamp(1rem,2.4vw,2.25rem)] pb-[clamp(0.85rem,1.3vw,1.15rem)] pt-[clamp(1.15rem,2.1vw,1.9rem)]"
          aria-label="Primary"
        >
          <Wordmark />

          <ul className="mx-auto hidden items-center gap-[clamp(0.5rem,2vw,1.75rem)] lg:flex">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="flex min-h-11 items-center rounded-full px-2 text-[0.9rem] text-muted transition-colors duration-200 hover:text-ink"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <Link
              to="/join"
              className="btn btn--primary max-sm:min-h-11 max-sm:px-4 max-sm:text-[0.8125rem]"
            >
              {BRAND.cta}
            </Link>

            {/* The round companion from refs 1 and 2, now carrying sign-in for
                returning members. It was decorative before — a second link to
                the same place — so it was deliberately kept out of the tab
                order and the a11y tree. Now that it goes somewhere of its own
                it has to be reachable: real label, real focus stop, and a
                tooltip, since an arrow alone does not say "sign in". */}
            <Link
              to="/signin"
              aria-label="Sign in"
              title="Sign in"
              className="btn btn--round hidden sm:inline-flex"
            >
              <ArrowGlyph />
            </Link>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="grid h-12 w-12 place-items-center rounded-full border border-[var(--border-strong)] text-ink lg:hidden"
            >
              <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
                <path
                  d={open ? 'M2 2l14 8M2 10L16 2' : 'M0 1h18M0 11h18'}
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </nav>
      </header>

      <div
        id="mobile-nav"
        hidden={!open}
        className="theme-dark fixed inset-0 z-[190] bg-[rgb(6_5_5/0.97)] backdrop-blur-xl lg:hidden"
      >
        <div className="u-shell flex h-full flex-col justify-center gap-1 pb-16">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="border-b border-[var(--border)] py-5 font-[family-name:var(--font-display)] text-[2rem] font-medium tracking-[-0.035em] text-ink"
            >
              {l.label}
            </a>
          ))}
          <Link
            to="/join"
            onClick={() => setOpen(false)}
            className="btn btn--primary mt-8 w-full"
          >
            {BRAND.cta}
          </Link>
          <Link
            to="/signin"
            onClick={() => setOpen(false)}
            className="btn btn--ghost mt-3 w-full"
          >
            Sign in
          </Link>
        </div>
      </div>
    </>
  )
}
