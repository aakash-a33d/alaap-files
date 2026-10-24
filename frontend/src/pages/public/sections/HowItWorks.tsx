import { HOW_STEPS } from '../../../content/site'
import { Reveal } from '../../../components/ui/Reveal'

export function HowItWorks() {
  return (
    <section
      id="how"
      className="theme-light section-y relative border-t border-[var(--border)] bg-surface"
    >
      <div className="u-shell">
        <Reveal>
          <p className="u-eyebrow">The mechanism</p>
          <h2 className="mt-5 max-w-3xl text-[clamp(2rem,4.2vw,3.4rem)] text-ink">
            Two identities. They are never allowed to meet.
          </h2>
          <p className="u-lede mt-6">
            Most platforms promise privacy as a policy. Here it is a structural
            separation: the system that knows who you are and the system that
            holds what you wrote live in different databases, with different
            keys, and no query that joins them.
          </p>
        </Reveal>

        <Reveal className="mt-16 grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--border)] md:grid-cols-3" stagger={0.1}>
          {HOW_STEPS.map((step) => (
            <div key={step.n} className="bg-surface p-[clamp(1.5rem,2.4vw,2.25rem)]">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-[family-name:var(--font-display)] text-[2.75rem] leading-none text-accent">
                  {step.n}
                </span>
                <span className="u-label text-[0.625rem]">{step.tag}</span>
              </div>
              <h3 className="mt-6 text-[1.3rem] leading-snug text-ink">{step.title}</h3>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
                {step.body}
              </p>
            </div>
          ))}
        </Reveal>

        <Reveal className="mt-10">
          <p className="max-w-2xl text-[0.875rem] leading-relaxed text-faint">
            The one exception is a verified high-risk safety case, which needs
            two trained human reviewers and a threshold of separate
            cryptographic approvals before any contact detail can be read — and
            releases only the minimum necessary.{' '}
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
