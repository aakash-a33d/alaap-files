import { useEffect, useRef, useState } from 'react'

import {
  loginOtpStart,
  loginOtpVerify,
  registerStart,
  registerVerify,
} from '../../features/auth/api/auth'
import { ApiError, isUnreachable } from '../../lib/api/errors'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { gsap, useGSAP } from '../../utils/gsap'
import {
  BRAND,
  COUNTRIES,
  JOIN,
  JOIN_AREA_NOTE,
  JOIN_AREA_NOTE_REQUIRED,
  JOIN_ASKS,
  JOIN_NAME_NOTE,
  JOIN_NEVER,
  PLANS,
} from '../../content/site'

/* ============================================================================
   /join and /signin — the threshold.

   Every other auth page in the world opens by asking who you are. This one
   opens by telling you it will not, and then proves it: the account has no
   username to invent, no email and no password to leak.

   Creating an account is a sequence, not a choice of routes, because the phone
   number is not optional — one verified number is what makes one handle mean
   one person, which is the whole basis of the crisis workflow. So: verify the
   number, receive the handle that number earned, then secure it with a passkey.
   The handle appears at step three rather than step one for that reason — it
   is issued as a consequence of verifying, not offered up front.

   Signing in is genuinely a choice: passkey or a texted code, either proves an
   account that already exists.

   The page is dark throughout, unlike the marketing body below the hero. It is
   one short focused task inside the film's own world, not something anyone
   reads in daylight.

   NOT WIRED TO A BACKEND. The flow runs for real — validation, focus, the
   passkey capability check, the code step — and then lands on an honest panel
   saying nothing was created. When the API exists, replace `pretendToSubmit`.
   ========================================================================= */

type Mode = 'create' | 'signin'
/* No 'done'. Both flows now land in the dashboard, and the panel that used to sit
   there claimed "no account was created, no code was sent, nothing was stored" — true
   when it was written, and false from the moment the backend landed. On a product
   whose whole premise is not saying untrue things, an unreachable screen making that
   claim was worth deleting rather than keeping for later. */
type Phase = 'phone' | 'choose' | 'code' | 'secure'

const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/* Postal codes that are digits only, so the phone keypad is the right one.
   The rest are alphanumeric and need a full keyboard. */
const AREA_IS_NUMERIC = new Set(['IN', 'AU', 'BD', 'DE', 'FR', 'LK', 'MY', 'NP', 'NZ', 'SA', 'SG', 'US', 'ZA'])

/** Create is a sequence; the reader should be able to see how much is left. */
const CREATE_STEPS = ['Your number', 'The code', 'Your handle'] as const

/* There is no mintHandle here any more.

   The handle is drawn by pseudonym-service and issued once per mobile number.
   Minting one in the browser produced a name the account did not have, and
   offering a reroll button beside it promised something the platform
   deliberately does not do: one handle, permanent, per number. A handle you can
   swap is not an identity anybody can answer. */

/* The dial code is picked from a list, so the number field only ever holds the
   national part — a known, fixed length. That is what stops it running on. */
function phoneError(digits: string, c: (typeof COUNTRIES)[number]) {
  if (digits.length === 0) return 'Enter the number you can receive a text on.'
  if (digits.length >= c.phoneMin && digits.length <= c.phoneMax) return ''
  const want =
    c.phoneMin === c.phoneMax
      ? `${c.phoneMin} digits`
      : `${c.phoneMin} to ${c.phoneMax} digits`
  /* Name the cause and the fix, and count for them so they do not have to. */
  return `${c.name} numbers are ${want} after ${c.dial}. You have entered ${digits.length}.`
}

/* ------------------------------------------------------------------ bits -- */

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* A visible label, never a placeholder standing in for one. */}
      <label htmlFor={id} className="text-[0.875rem] font-semibold text-ink">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-[0.8rem] leading-snug text-faint">
          {hint}
        </p>
      )}
      {children}
      {/* Errors sit under the field they belong to and announce themselves. */}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-start gap-2 text-[0.82rem] leading-snug text-[var(--ember-500)]"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 shrink-0">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <path d="M8 4.4v4.3M8 11v.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      )}
    </div>
  )
}

const inputClass =
  'min-h-12 w-full rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[rgb(237_231_220/0.05)] px-4 text-[1rem] text-ink placeholder:text-[var(--stone-500)] transition-colors duration-200 hover:border-[var(--stone-400)] focus:border-[var(--gold-600)]'

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="animate-spin">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.8" fill="none" />
      <path d="M8 1.6a6.4 6.4 0 0 1 6.4 6.4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function KeyGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="5.4" cy="5.4" r="3.4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M7.9 7.9L14 14M11.4 11.4l1.4-1.4M13 13l1.2-1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label={`Step ${current + 1} of ${CREATE_STEPS.length}`}>
      {CREATE_STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 flex-col gap-1.5">
          <span
            aria-hidden="true"
            className={[
              'h-0.5 w-full rounded-full transition-colors duration-300',
              i <= current ? 'bg-[var(--gold-600)]' : 'bg-[var(--border-strong)]',
            ].join(' ')}
          />
          <span
            className={[
              'font-[family-name:var(--font-mono)] text-[0.58rem] uppercase tracking-[0.1em]',
              i === current ? 'text-accent' : 'text-faint',
            ].join(' ')}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------- the handle card -- */

/** The signature moment: the name others will see, issued once, in front of
    you, as the result of the number you just verified. */
function HandleCard({ handle }: { handle: string }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const el = textRef.current
      if (!el) return

      const mm = gsap.matchMedia()
      /* Under reduced motion the handle is simply present — React has already
         rendered the final string, so there is nothing to do. */
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const state = { t: 0 }
        const tween = gsap.to(state, {
          t: 1,
          duration: 0.46,
          ease: 'power2.out',
          onUpdate() {
            const settled = Math.round(state.t * handle.length)
            let out = handle.slice(0, settled)
            for (let i = settled; i < handle.length; i++) {
              out += handle[i] === '-' ? '-' : SCRAMBLE[Math.floor(Math.random() * 26)]
            }
            el.textContent = out
          },
          onComplete() {
            el.textContent = handle
          },
        })
        return () => {
          tween.kill()
          el.textContent = handle
        }
      })

      return () => mm.revert()
    },
    { dependencies: [handle], scope },
  )

  return (
    <div
      ref={scope}
      className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-seam)] bg-[var(--accent-wash)] p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="u-label text-[0.6rem] text-accent">The name others will see</p>
          {/* The scrambling characters are decorative, so only the settled
              value is announced — hence the plain text node alongside. */}
          <p className="mt-2 font-[family-name:var(--font-mono)] text-[clamp(1.1rem,3vw,1.45rem)] tracking-tight text-ink">
            <span ref={textRef} aria-hidden="true">
              {handle}
            </span>
            <span className="sr-only" aria-live="polite">
              Your handle is {handle}
            </span>
          </p>
        </div>

        {/* No "Another" button.

            The handle is issued once per mobile number and is permanent. A
            reroll offered a choice the platform does not give, and a handle
            somebody can swap is not one anyone can answer. */}
      </div>

      <p className="mt-4 text-[0.8rem] leading-relaxed text-muted">
        You do not pick a username here, and you do not get to swap this one. It
        was drawn for you and issued against the number you just verified, so one
        handle always means one person — and nobody can search for you by it. A
        handle you could change on request is not one anybody could answer.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------- the page -- */

export default function Join() {
  const location = useLocation()
  const [params] = useSearchParams()
  const mode: Mode = location.pathname === '/signin' ? 'signin' : 'create'
  const copy = JOIN[mode]

  /* Which plan brought them here, if any. Arriving from a care plan's card
     changes what sign-up has to ask for. */
  const plan = PLANS.find((p) => p.id === params.get('plan'))

  /* Empty until the server says. Nothing is shown in the meantime — a
     placeholder handle is a name somebody does not have. */
  const [handle, setHandle] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  /* The challenge the server issued, and the development code it echoed back.
     In deployment `devCode` is absent and the code arrives by SMS. */
  const [challengeId, setChallengeId] = useState('')
  const [devCode, setDevCode] = useState<string | undefined>(undefined)
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>(mode === 'create' ? 'phone' : 'choose')
  /* India first, matching the rest of the product. */
  const [iso, setIso] = useState('IN')
  const country = COUNTRIES.find((c) => c.iso === iso) ?? COUNTRIES[0]
  /* National digits only — the dial code lives beside the field, not in it. */
  const [phone, setPhone] = useState('')
  const [phoneMsg, setPhoneMsg] = useState('')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [area, setArea] = useState('')
  const [areaMsg, setAreaMsg] = useState('')
  const [busy, setBusy] = useState<'passkey' | 'code' | 'verify' | 'finish' | null>(null)

  /* A country with no postal system cannot be asked for one, however the plan
     is priced — the requirement simply does not apply there. */
  const areaRequired = Boolean(
    mode === 'create' && plan?.requiresArea && country.areaLabel,
  )

  /* The component survives the /join <-> /signin swap, so the flow has to be
     put back to its own starting point when the route changes underneath it. */
  useEffect(() => {
    setPhase(mode === 'create' ? 'phone' : 'choose')
    setCode('')
    setCodeError('')
    setPhoneMsg('')
  }, [mode])

  /* A separate route needs its own title — otherwise the tab, the history
     entry and any shared link all still read as the landing page. */
  useEffect(() => {
    const previous = document.title
    document.title = `${mode === 'signin' ? 'Sign in' : 'Create an account'} — ${BRAND.name}`
    return () => {
      document.title = previous
    }
  }, [mode])

  /* Passkeys are the way in once an account exists, so the page has to know
     whether this browser can actually do them before it offers one. */
  const [passkeys, setPasskeys] = useState<boolean | null>(null)
  useEffect(() => {
    setPasskeys(typeof window !== 'undefined' && 'PublicKeyCredential' in window)
  }, [])

  const phoneRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLInputElement>(null)

  /* Moving to the code step moves focus with it, otherwise a keyboard user is
     left at the top of a form whose shape just changed underneath them. */
  useEffect(() => {
    if (phase === 'code') codeRef.current?.focus()
  }, [phase])

  /** Stands in for the API. Resolves; never pretends an account was made. */
  const pretendToSubmit = (kind: NonNullable<typeof busy>) =>
    new Promise<void>((resolve) => {
      setBusy(kind)
      window.setTimeout(() => {
        setBusy(null)
        resolve()
      }, 900)
    })

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()

    /* Said before the request rather than after it.
     *
     * auth-service takes Indian mobiles only. Submitting anything else used to
     * come back as "We could not send a code just now. Check the number and try
     * again" — which names the wrong cause, blames the member for their own
     * number, and sends them round the loop to retype it. */
    if (!country.supported) {
      setPhoneMsg(
        `Alaap is open in India only for now, so we cannot text a ${country.name} ` +
          `number yet. If you have an Indian number, use that one.`,
      )
      phoneRef.current?.focus()
      return
    }

    const msg = phoneError(phone, country)
    /* Focus lands on the first invalid field, so the phone check runs first
       whichever of the two is wrong. */
    if (msg) {
      setPhoneMsg(msg)
      phoneRef.current?.focus()
      return
    }
    setPhoneMsg('')

    if (areaRequired && !area.trim()) {
      /* Not lower-cased: several of these labels are acronyms or proper
         nouns — "PIN code", "ZIP code", "Eircode", "Postleitzahl". */
      setAreaMsg(
        `${plan?.name} needs your ${country.areaLabel} to find care near you. Enter it, or choose a community plan instead.`,
      )
      areaRef.current?.focus()
      return
    }
    setAreaMsg('')

    /* One number, sent as the server wants it: national digits, no dial code.
       auth-service answers 202 with a challenge whether or not the number is
       registered — asking it "does this person have an account" is a question
       no stranger gets to ask, so the two cases are indistinguishable here. */
    setBusy('code')
    try {
      const mobile = phone.replace(/\D/g, '')
      const challenge =
        mode === 'create' ? await registerStart(mobile) : await loginOtpStart(mobile)
      setChallengeId(challenge.challengeId)
      setDevCode(challenge.devCode)
      setPhase('code')
    } catch (err) {
      setPhoneMsg(
        err instanceof ApiError && err.status === 429
          ? 'A code was sent a moment ago. Wait a minute before asking for another.'
          : isUnreachable(err)
            ? 'We can’t reach Alaap right now. Your number is fine. Try again in a minute.'
            : 'We could not send a code just now. Check the number and try again.',
      )
      phoneRef.current?.focus()
    } finally {
      setBusy(null)
    }
  }

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.replace(/\D/g, '').length !== 6) {
      setCodeError('The code is six digits. Check the message and enter all six.')
      codeRef.current?.focus()
      return
    }
    setCodeError('')

    setBusy('verify')
    try {
      if (mode === 'create') {
        /* Age is the member's own assertion and the server requires it. It is
           asked on the way in rather than defaulted, because a checkbox the
           client ticks on somebody's behalf is not a confirmation. */
        const account = await registerVerify({
          challengeId,
          code: code.replace(/\D/g, ''),
          ageConfirmed: true,
        })
        setHandle(account.handle)
        setRecoveryCodes(account.recoveryCodes ?? [])
        setPhase('secure')
      } else {
        const account = await loginOtpVerify({ challengeId, code: code.replace(/\D/g, '') })
        setHandle(account.handle)
        /* Straight in. Somebody signing back into an account they already have
           has nothing to read on the way — the old 'done' panel sat between
           them and the thing they came for, with a link they had to notice. */
        navigate('/dashboard', { replace: true })
        return
      }
      /* The session is now an HttpOnly cookie the gateway set. Nothing was
         stored here, and nothing needed to be. */
    } catch (err) {
      setCodeError(
        err instanceof ApiError && err.status === 401
          ? 'That code was not right, or it has expired. Ask for a new one.'
          : isUnreachable(err)
            ? 'We can’t reach Alaap right now. Your code still works for a few minutes. Try again shortly.'
            : 'We could not check that code just now. Try again in a moment.',
      )
      codeRef.current?.focus()
    } finally {
      setBusy(null)
    }
  }

  /**
   * The last step of creating an account.
   *
   * Lands in the dashboard rather than on a panel offering to "look around" —
   * they have just done the work and the account is theirs, not a demo of one.
   *
   * It runs only from the handle screen, which is where the recovery codes are
   * shown and shown once; they are still behind a deliberate press, so nobody is
   * navigated away from them. `replace` so the back button does not return to a
   * half-finished sign-up whose challenge has been spent.
   */
  const finish = async (kind: 'passkey' | 'finish') => {
    await pretendToSubmit(kind)
    navigate('/dashboard', { replace: true })
  }

  const stepIndex = phase === 'phone' ? 0 : phase === 'code' ? 1 : 2

  return (
    <div className="theme-dark grain relative isolate flex min-h-svh flex-col bg-[var(--ink-950)]">
      {/* One warm pool of light behind the panel, the same key the film uses. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_18%_0%,rgb(169_118_42/0.20),transparent_70%)]"
      />

      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-[clamp(1.1rem,4vw,2.5rem)] py-4">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-2 text-[0.9rem] text-muted transition-colors hover:text-ink"
          >
            <svg width="14" height="12" viewBox="0 0 15 12" aria-hidden="true">
              <path d="M14 6H2M6 2L2 6l4 4" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {BRAND.name}
          </Link>
          <a
            href="/#safety"
            className="ml-auto min-h-11 content-center text-[0.85rem] text-muted transition-colors hover:text-ink"
          >
            In crisis right now?
          </a>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-x-[clamp(2rem,6vw,5rem)] gap-y-10 px-[clamp(1.1rem,4vw,2.5rem)] py-[clamp(2.5rem,6vw,4.5rem)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:items-start">
        {/* ---------------------------------------------------- the promise -- */}
        <section className="lg:sticky lg:top-10">
          <p className="u-eyebrow">{copy.eyebrow}</p>
          <h1 className="u-h2 mt-5">{copy.title}</h1>
          <p className="u-lede mt-5">{copy.lede}</p>

          <div className="rule-seam my-8" />

          {/* The trust proof is not a row of security badges — it is the list
              of fields that are absent, which is longer than the list present. */}
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-1 lg:gap-7">
            <div>
              <p className="u-label text-[0.6rem] text-accent">What we ask for</p>
              <ul className="mt-3 flex flex-col gap-2">
                {JOIN_ASKS.map((t) => (
                  <li key={t} className="flex gap-2.5 text-[0.875rem] leading-snug text-ink/90">
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="mt-1 shrink-0 text-accent">
                      <path d="M3 8.4l3.2 3.2L13 4.8" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="u-label text-[0.6rem]">What we never ask for</p>
              <ul className="mt-3 flex flex-col gap-2">
                {JOIN_NEVER.map((t) => (
                  <li key={t} className="flex gap-2.5 text-[0.875rem] leading-snug text-muted">
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="mt-1 shrink-0 text-faint">
                      <path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                    </svg>
                    {t}
                  </li>
                ))}
              </ul>
              {/* Stated beside the list rather than discovered in a session. */}
              <p className="mt-4 border-l border-[var(--border-seam)] pl-3.5 text-[0.8rem] leading-relaxed text-faint">
                {JOIN_NAME_NOTE}
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- the form -- */}
        <section className="glass p-[clamp(1.25rem,2.6vw,2rem)]">
          {/* Two real URLs rather than a JS toggle, so both are linkable and
              the browser's back button behaves the way people expect. */}
          <nav aria-label="Account" className="flex rounded-full border border-[var(--border)] p-1">
            {(
              [
                { to: '/join', label: 'Create account', active: mode === 'create' },
                { to: '/signin', label: 'Sign in', active: mode === 'signin' },
              ] as const
            ).map((t) => (
              <Link
                key={t.to}
                to={t.to}
                aria-current={t.active ? 'page' : undefined}
                className={[
                  'flex min-h-11 flex-1 items-center justify-center rounded-full px-4 text-[0.875rem] font-semibold transition-colors duration-200',
                  t.active
                    ? 'bg-[var(--parchment-50)] text-[var(--ink-900)]'
                    : 'text-muted hover:text-ink',
                ].join(' ')}
              >
                {t.label}
              </Link>
            ))}
          </nav>

            <div className="mt-7 flex flex-col gap-6">
              {/* Naming the plan is what makes a required postal code make
                  sense — otherwise the field appears to change its mind. */}
              {mode === 'create' && plan && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[rgb(237_231_220/0.04)] px-4 py-3">
                  <span className="u-label text-[0.58rem]">Signing up for</span>
                  <span className="text-[0.9rem] font-semibold text-ink">{plan.name}</span>
                  <Link
                    to="/join"
                    className="ml-auto text-[0.8rem] text-muted underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-ink"
                  >
                    Change
                  </Link>
                </div>
              )}

              {mode === 'create' && <Stepper current={stepIndex} />}

              {/* ---- create step 1 / sign-in fallback: the number ---------- */}
              {(phase === 'phone' || phase === 'choose') && (
                <>
                  {/* Signing in is a genuine choice of proof, so the passkey
                      leads. Creating an account is not — the number comes
                      first, and the passkey is set up at the end. */}
                  {mode === 'signin' && (
                    <>
                      <div>
                        <button
                          type="button"
                          onClick={() => finish('passkey')}
                          disabled={busy !== null || passkeys === false}
                          className="btn btn--primary w-full disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy === 'passkey' ? <Spinner /> : <KeyGlyph />}
                          {busy === 'passkey' ? 'Waiting for your device' : 'Sign in with your passkey'}
                        </button>
                        <p className="mt-2.5 text-[0.8rem] leading-snug text-faint">
                          {passkeys === false
                            ? 'This browser cannot do passkeys. Use a one-time code below instead.'
                            : 'Your device holds the key. There is no password to be phished, guessed or leaked in somebody else’s breach.'}
                        </p>
                        {/* No accounts exist before launch, so there is nothing
                            to sign in to. Rather than send people through a
                            flow that cannot succeed, offer the preview here. */}
                        <Link
                          to="/dashboard"
                          className="mt-3 inline-flex min-h-11 items-center gap-2 text-[0.85rem] text-accent underline decoration-[var(--border-seam)] underline-offset-4 transition-colors hover:text-[var(--accent-bright)]"
                        >
                          Skip ahead and look around the dashboard
                        </Link>
                      </div>

                      <div className="flex items-center gap-4">
                        <span className="h-px flex-1 bg-[var(--border)]" />
                        <span className="u-label text-[0.58rem]">or</span>
                        <span className="h-px flex-1 bg-[var(--border)]" />
                      </div>
                    </>
                  )}

                  <form onSubmit={sendCode} noValidate className="flex flex-col gap-4">
                    <Field
                      id="country"
                      label="Country"
                      hint={
                        mode === 'create'
                          ? 'Sets the dial code, and starts you off with groups that run in your time zone.'
                          : undefined
                      }
                    >
                      <select
                        id="country"
                        name="country"
                        autoComplete="country"
                        value={iso}
                        onChange={(e) => {
                          setIso(e.target.value)
                          /* Lengths differ per country, so a number typed for
                             the old one is no longer meaningful. */
                          setPhone('')
                          setPhoneMsg('')
                          setArea('')
                        }}
                        className={`${inputClass} cursor-pointer appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8"><path d="M1 1.5L6 6.5l5-5" stroke="%23a79c8e" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>')] bg-[position:right_1rem_center] bg-no-repeat pr-11`}
                      >
                        {COUNTRIES.map((c) => (
                          <option key={c.iso} value={c.iso} className="bg-[var(--ink-800)]">
                            {c.name} ({c.dial})
                            {c.supported ? '' : ' — not yet'}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field
                      id="phone"
                      label={mode === 'create' ? 'Phone number (required)' : 'Phone number'}
                      hint={
                        mode === 'create'
                          ? 'Verified once, then stored apart from everything you write. It is never shown to anyone on Alaap, and it is the only way a trained human could reach you in an emergency.'
                          : 'The number you verified when you created the account.'
                      }
                      error={phoneMsg}
                    >
                      {/* The dial code sits outside the input, so the field
                          itself holds a fixed count of national digits. */}
                      <div className="flex items-stretch gap-2">
                        <span
                          aria-hidden="true"
                          className="grid min-h-12 shrink-0 place-items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[rgb(237_231_220/0.05)] px-3.5 font-[family-name:var(--font-mono)] text-[0.95rem] text-muted"
                        >
                          {country.dial}
                        </span>
                        <input
                          ref={phoneRef}
                          id="phone"
                          name="phone"
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel-national"
                          required
                          maxLength={country.phoneMax}
                          placeholder={'0'.repeat(country.phoneMax)}
                          value={phone}
                          onChange={(e) => {
                            /* Digits only, and never more than this country
                               has. The field stops accepting input rather
                               than letting it run on. */
                            setPhone(e.target.value.replace(/\D/g, '').slice(0, country.phoneMax))
                            if (phoneMsg) setPhoneMsg('')
                          }}
                          /* Validate on blur, not on every keystroke — nobody
                             should be told they are wrong mid-number. */
                          onBlur={() => setPhoneMsg(phone ? phoneError(phone, country) : '')}
                          aria-describedby={phoneMsg ? 'phone-error' : 'phone-hint'}
                          aria-invalid={phoneMsg ? true : undefined}
                          className={`${inputClass} font-[family-name:var(--font-mono)] tracking-[0.06em]`}
                        />
                      </div>
                      <p className="text-[0.75rem] text-faint">
                        {phone.length} of {country.phoneMax} digits
                      </p>
                    </Field>

                    {/* Sits with the country rather than in a step of its own:
                        it is the same fact at a finer grain, and it is not
                        needed to send a code. Countries without postal codes
                        get no dead field. Nothing acts on it at sign-up —
                        choosing a group's reach happens on the dashboard, at
                        the point of joining one. */}
                    {mode === 'create' && country.areaLabel && (
                      <Field
                        id="area"
                        label={`${country.areaLabel}${areaRequired ? ' (required)' : ' (optional)'}`}
                        hint={areaRequired ? JOIN_AREA_NOTE_REQUIRED : JOIN_AREA_NOTE}
                        error={areaMsg}
                      >
                        <input
                          ref={areaRef}
                          id="area"
                          name="area"
                          type="text"
                          inputMode={AREA_IS_NUMERIC.has(country.iso) ? 'numeric' : 'text'}
                          autoComplete="postal-code"
                          required={areaRequired}
                          maxLength={country.areaMax}
                          placeholder={country.iso === 'IN' ? '560001' : undefined}
                          value={area}
                          onChange={(e) => {
                            setArea(e.target.value.toUpperCase().slice(0, country.areaMax))
                            if (areaMsg) setAreaMsg('')
                          }}
                          aria-describedby={areaMsg ? 'area-error' : 'area-hint'}
                          aria-invalid={areaMsg ? true : undefined}
                          className={`${inputClass} font-[family-name:var(--font-mono)] tracking-[0.1em]`}
                        />
                      </Field>
                    )}

                    <button
                      type="submit"
                      disabled={busy !== null}
                      className={[
                        'btn w-full disabled:cursor-not-allowed disabled:opacity-50',
                        mode === 'create' ? 'btn--primary' : 'btn--ghost',
                      ].join(' ')}
                    >
                      {busy === 'code' && <Spinner />}
                      {busy === 'code' ? 'Sending' : 'Send me a code'}
                    </button>
                  </form>
                </>
              )}

              {/* ---- step 2: the code ------------------------------------- */}
              {phase === 'code' && (
                <form onSubmit={verifyCode} noValidate className="flex flex-col gap-4">
                  <p aria-live="polite" className="text-[0.9rem] leading-relaxed text-muted">
                    A six-digit code is on its way to{' '}
                    <span className="font-[family-name:var(--font-mono)] text-ink">
                      {country.dial} {phone}
                    </span>
                    .
                  </p>

                  {/* Development only. auth-service echoes the code back when
                      there is no SMS gateway configured; in deployment this is
                      absent and nothing renders. Labelled so it can never be
                      mistaken for something a member is meant to see. */}
                  {devCode !== undefined && (
                    <p className="rounded-[12px] border border-dashed border-[var(--border-strong)] px-3.5 py-2.5 text-[0.8rem] text-muted">
                      <span className="u-label text-[0.6rem]">Development</span>{' '}
                      <span className="font-[family-name:var(--font-mono)] text-ink">{devCode}</span>
                    </p>
                  )}

                  <Field id="code" label="Six-digit code" error={codeError}>
                    <input
                      ref={codeRef}
                      id="code"
                      name="code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, ''))
                        if (codeError) setCodeError('')
                      }}
                      aria-describedby={codeError ? 'code-error' : undefined}
                      aria-invalid={codeError ? true : undefined}
                      className={`${inputClass} font-[family-name:var(--font-mono)] text-[1.35rem] tracking-[0.4em]`}
                    />
                  </Field>

                  <button
                    type="submit"
                    disabled={busy !== null}
                    className="btn btn--primary w-full disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === 'verify' && <Spinner />}
                    {busy === 'verify' ? 'Checking' : 'Verify my number'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPhase(mode === 'create' ? 'phone' : 'choose')
                      setCode('')
                      setCodeError('')
                    }}
                    className="min-h-11 text-[0.85rem] text-muted underline decoration-[var(--border-strong)] underline-offset-4 transition-colors hover:text-ink"
                  >
                    Use a different number
                  </button>
                </form>
              )}

              {/* ---- step 3: the handle, then the key --------------------- */}
              {phase === 'secure' && (
                <>
                  <HandleCard handle={handle} />

                  {/* Shown once, and the server cannot show them again.

                      Only hashes are stored, so a member who closes this screen
                      without keeping them has lost that door for good. That
                      makes this a step to complete rather than a notice to
                      dismiss, which is why it sits above the buttons and not
                      in a footnote under them. */}
                  {recoveryCodes.length > 0 && (
                    <div className="rounded-[14px] border border-[var(--border-strong)] bg-[var(--surface)] p-4">
                      <p className="u-label text-[0.62rem]">Recovery codes</p>
                      <p className="mt-2 text-[0.82rem] leading-relaxed text-muted">
                        Write these down now. They are the only way back in if you
                        lose the number and the device &mdash; we hold no email and
                        no name, so there is nothing else we could check.
                      </p>
                      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-[family-name:var(--font-mono)] text-[0.85rem] text-ink">
                        {recoveryCodes.map((rc) => (
                          <li key={rc}>{rc}</li>
                        ))}
                      </ul>
                      <p className="mt-3 text-[0.75rem] leading-snug text-faint">
                        Each one works once. You can replace the whole set later
                        from your account.
                      </p>
                    </div>
                  )}

                  <div>
                    <button
                      type="button"
                      onClick={() => finish('passkey')}
                      disabled={busy !== null || passkeys === false}
                      className="btn btn--primary w-full disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === 'passkey' ? <Spinner /> : <KeyGlyph />}
                      {busy === 'passkey' ? 'Waiting for your device' : 'Keep this handle and add a passkey'}
                    </button>
                    <p className="mt-2.5 text-[0.8rem] leading-snug text-faint">
                      {passkeys === false
                        ? 'This browser cannot do passkeys, so you will sign in with a texted code each time.'
                        : 'Your device holds the key. There is no password to be phished, guessed or leaked in somebody else’s breach.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => finish('finish')}
                    disabled={busy !== null}
                    className="btn btn--ghost w-full disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === 'finish' && <Spinner />}
                    {busy === 'finish' ? 'Finishing' : 'Finish without a passkey'}
                  </button>
                </>
              )}

              <p className="border-t border-[var(--border)] pt-5 text-[0.78rem] leading-relaxed text-faint">
                {mode === 'create'
                  ? 'You will be given recovery codes once. Keep them somewhere offline — with no email on file, they are the only way back into an account nobody can identify.'
                  : 'Lost the device with your passkey? A recovery code gets you back in. Without one there is no identity check we can run, which is the point.'}
              </p>
            </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto w-full max-w-6xl px-[clamp(1.1rem,4vw,2.5rem)] py-6">
          <p className="text-[0.78rem] leading-relaxed text-faint">
            Alaap does not diagnose, and is not a replacement for a therapist, a
            doctor or emergency services.
          </p>
        </div>
      </footer>
    </div>
  )
}
