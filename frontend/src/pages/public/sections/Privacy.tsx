import { PROTECTIONS } from '../../../content/site'
import { Reveal } from '../../../components/ui/Reveal'

/* ============================================================================
   What protects you, in your own terms.

   This section used to name each internal data domain and list what it holds
   and who is denied access. That is a description of our architecture, not a
   reason for anyone to trust us — and it put component names on a public page
   for no benefit. Each item here is a guarantee the reader can hold us to.
   ========================================================================= */

export function Privacy() {
  return (
    <section
      id="privacy"
      aria-labelledby="privacy-title"
      className="theme-dark relative bg-surface"
    >
      <div className="px-[clamp(1.1rem,4vw,4rem)] py-[clamp(4rem,8vw,7rem)]">
        <Reveal className="grid gap-x-16 gap-y-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="u-eyebrow">How you are protected</p>
            <h2 id="privacy-title" className="u-h2 mt-5">
              Six promises,
              <br />
              not six paragraphs.
            </h2>
          </div>
          <p className="u-lede lg:pb-2">
            Every one of these is something you can hold us to, and something a
            breach in one place cannot undo everywhere else.
          </p>
        </Reveal>

        <Reveal
          className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-px overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3"
          stagger={0.07}
        >
          {PROTECTIONS.map((p, i) => (
            <div
              key={p.title}
              className="flex flex-col gap-3 bg-surface p-[clamp(1.4rem,2.4vw,2rem)]"
            >
              <span className="font-[family-name:var(--font-mono)] text-[0.7rem] text-accent">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="text-[1.12rem] leading-snug text-ink">{p.title}</h3>
              <p className="text-[0.9rem] leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </Reveal>

        <Reveal className="mt-10">
          <p className="max-w-2xl text-[0.86rem] leading-relaxed text-faint">
            One honest exception: a verified high-risk safety case can require
            reaching your emergency contact. That needs two trained reviewers and
            three of five independent approvals, releases only the minimum
            necessary, and is logged permanently.{' '}
            <a
              href="#safety"
              className="text-accent underline decoration-[var(--border-seam)] underline-offset-4 transition-colors hover:decoration-[var(--gold-400)]"
            >
              How that works
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  )
}
