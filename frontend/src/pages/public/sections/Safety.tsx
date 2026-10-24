import { Reveal } from '../../../components/ui/Reveal'

const TIERS = [
  {
    tier: 'Low',
    title: 'You are offered something to do',
    body: 'Breathing and grounding exercises, a prompt to contact someone you trust, local crisis resources, and a "take a pause" screen. Nothing is escalated.',
  },
  {
    tier: 'Moderate',
    title: 'A trained human becomes available',
    body: 'You can chat with a trained safety responder, book a session sooner, or build a safety-plan checklist. If you are in a live session, your therapist is notified. You are asked before anyone is contacted.',
  },
  {
    tier: 'High',
    title: 'A break-glass case opens — and it is slow on purpose',
    body: 'A trained reviewer assesses the signal, a second authorised reviewer must agree, and a threshold of separate cryptographic keys must be combined before one contact detail can be decrypted. Access is time-limited and expires with the case.',
  },
]

const KEYHOLDERS = [
  'HSM / KMS service',
  'Independent security account',
  'Clinical safety officer',
  'Privacy officer',
  'Independent audit trustee',
]

export function Safety() {
  return (
    <section
      id="safety"
      className="theme-light section-y relative border-t border-[var(--border)] bg-surface"
    >
      <div className="u-shell">
        <Reveal className="max-w-3xl">
          <p className="u-eyebrow">Safety and crisis</p>
          <h2 className="mt-5 text-[clamp(2rem,4.2vw,3.4rem)] text-ink">
            AI can raise a hand. It cannot open a door.
          </h2>
          <p className="u-lede mt-6">
            No model on this platform can contact the police, an NGO, your
            family or your emergency contact. It can only signal a human. What
            happens next is proportionate, and it is written down.
          </p>
        </Reveal>

        <Reveal className="mt-16 flex flex-col gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--border)]" stagger={0.08}>
          {TIERS.map((t, i) => (
            <div
              key={t.tier}
              className="grid gap-4 bg-surface p-[clamp(1.4rem,2.6vw,2.25rem)] md:grid-cols-[9rem_1fr] md:gap-10"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-2 block h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      i === 0
                        ? 'var(--sage-400)'
                        : i === 1
                          ? 'var(--gold-500)'
                          : 'var(--ember-500)',
                  }}
                />
                <span className="font-[family-name:var(--font-mono)] text-[0.75rem] uppercase tracking-[0.12em] text-muted">
                  {t.tier} risk
                </span>
              </div>
              <div>
                <h3 className="text-[1.25rem] leading-snug text-ink">{t.title}</h3>
                <p className="mt-2.5 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
                  {t.body}
                </p>
              </div>
            </div>
          ))}
        </Reveal>

        {/* threshold keys */}
        <Reveal className="mt-14 grid gap-10 rounded-[var(--radius-lg)] border border-[var(--border-seam)] bg-[linear-gradient(180deg,rgb(228_177_85/0.05),transparent)] p-[clamp(1.5rem,3vw,2.5rem)] lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="max-w-xl">
            <h3 className="text-[1.4rem] leading-snug text-ink">
              Three of five keys, held by five different parties
            </h3>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
              Emergency identity data is sealed behind a threshold. No founder,
              engineer, therapist, moderator or administrator holds enough alone
              — by construction, not by policy.
            </p>
          </div>

          <ul className="flex flex-wrap gap-2 lg:max-w-xs lg:justify-end">
            {KEYHOLDERS.map((k, i) => (
              <li
                key={k}
                className={[
                  'rounded-full border px-3 py-1.5 font-[family-name:var(--font-mono)] text-[0.6875rem]',
                  i < 3
                    ? 'border-[var(--border-seam)] bg-[rgb(228_177_85/0.1)] text-accent'
                    : 'border-[var(--border)] text-faint',
                ].join(' ')}
              >
                {k}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal className="mt-10">
          <p className="max-w-3xl rounded-[var(--radius-md)] border border-[var(--border)] bg-[rgb(217_116_63/0.07)] p-5 text-[0.875rem] leading-relaxed text-muted">
            <strong className="font-semibold text-ink">
              If you are in immediate danger, do not wait for this platform.
            </strong>{' '}
            Alaap is not an emergency service and cannot guarantee rescue.
            Contact your local emergency number or a crisis helpline directly.
            Region-specific helplines are listed on every safety screen inside
            the product.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
