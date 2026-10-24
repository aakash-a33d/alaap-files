import { AI_DOES, AI_NEVER } from '../../../content/site'
import { Reveal } from '../../../components/ui/Reveal'

function List({
  items,
  tone,
}: {
  items: readonly string[]
  tone: 'does' | 'never'
}) {
  const isDoes = tone === 'does'
  return (
    <ul className="mt-7 flex flex-col gap-4">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-[0.9375rem] leading-relaxed">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
            className={[
              'mt-[0.28rem] shrink-0',
              isDoes ? 'text-safe' : 'text-caution',
            ].join(' ')}
          >
            {isDoes ? (
              <path
                d="M3 8.4l3.2 3.2L13 4.8"
                stroke="currentColor"
                strokeWidth="1.7"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <path
                d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2"
                stroke="currentColor"
                strokeWidth="1.7"
                fill="none"
                strokeLinecap="round"
              />
            )}
          </svg>
          <span className={isDoes ? 'text-ink/90' : 'text-muted'}>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function AITransparency() {
  return (
    <section
      id="ai"
      className="theme-light section-y relative border-t border-[var(--border)] bg-surface"
    >
      <div className="u-shell">
        <Reveal className="max-w-3xl">
          <p className="u-eyebrow">AI transparency centre</p>
          <h2 className="mt-5 text-[clamp(2rem,4.2vw,3.4rem)] text-ink">
            The AI here is a filter and an assistant. It is not a clinician.
          </h2>
          <p className="u-lede mt-6">
            Moderation is a visible feature, not a hidden backend process. When
            something you wrote is held, you are told the category of concern,
            the reason, how to reword it, and how to appeal to a human.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--border)] lg:grid-cols-2">
          <Reveal className="bg-surface p-[clamp(1.5rem,3vw,2.5rem)]">
            <h3 className="font-[family-name:var(--font-mono)] text-[0.75rem] uppercase tracking-[0.14em] text-safe">
              What it does
            </h3>
            <List items={AI_DOES} tone="does" />
          </Reveal>

          <Reveal className="bg-surface p-[clamp(1.5rem,3vw,2.5rem)]" delay={0.08}>
            <h3 className="font-[family-name:var(--font-mono)] text-[0.75rem] uppercase tracking-[0.14em] text-caution">
              What it never does
            </h3>
            <List items={AI_NEVER} tone="never" />
          </Reveal>
        </div>

        {/* a worked example of the moderation screen */}
        <Reveal className="mt-12">
          <figure className="card max-w-3xl">
            <figcaption className="u-label mb-4 text-[0.5625rem]">
              Example — an explainable moderation result
            </figcaption>
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip chip--accent">Held for review</span>
              <span className="chip">Category: pressuring language</span>
            </div>
            <p className="mt-5 text-[1.0625rem] leading-relaxed text-ink/90">
              “This reply was not published because it may pressure another
              person or increase emotional distress. You can rewrite it with
              supportive, non-directive language.”
            </p>
            <p className="mt-4 text-[0.8125rem] text-faint">
              This decision was made by automated safety systems and may be
              reviewed by a human moderator.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <span className="btn btn--ghost pointer-events-none min-h-11 text-[0.8125rem]">
                Rewrite
              </span>
              <span className="btn btn--ghost pointer-events-none min-h-11 text-[0.8125rem]">
                Appeal to a human
              </span>
            </div>
          </figure>
        </Reveal>
      </div>
    </section>
  )
}
