import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { gsap, ScrollTrigger, useGSAP } from '../../../utils/gsap'
import { ILLUSTRATIVE_POSTS, ILLUSTRATIVE_THREADS, type LivePost } from '../../../content/site'
import { Reveal } from '../../../components/ui/Reveal'

/** Duplicated so the track can loop seamlessly at -50%. */
const TRACK = [...ILLUSTRATIVE_POSTS, ...ILLUSTRATIVE_POSTS]

function PostCard({ post, dup }: { post: LivePost; dup: boolean }) {
  /* Match the card to a thread by handle where one exists, otherwise open the
     full feed rather than a dead end. */
  const thread = ILLUSTRATIVE_THREADS.find((t) => t.handle === post.handle)
  const href = thread ? `/community/${thread.slug}` : '/community'

  return (
    <Link
      to={href}
      /* the duplicate half exists only to close the loop visually —
         assistive tech reads the first set once, and the copies are not
         focusable so tabbing does not cycle the same posts twice */
      aria-hidden={dup || undefined}
      tabIndex={dup ? -1 : undefined}
      className="post-card card group pointer-events-auto relative flex w-[19rem] shrink-0 flex-col gap-4 no-underline [backface-visibility:hidden] [transform-style:preserve-3d] transition-colors duration-200 hover:border-[var(--border-seam)] sm:w-[22rem]"
    >
      <header className="flex items-center justify-between gap-3">
        <span className="font-[family-name:var(--font-mono)] text-[0.8125rem] text-accent">
          {post.handle}
        </span>
        <span className="u-label text-[0.5625rem]">{post.ago}</span>
      </header>

      <p className="text-[0.9375rem] leading-relaxed text-ink/90">{post.body}</p>

      <footer className="mt-auto flex flex-wrap items-center gap-2 pt-2">
        <span className="chip">{post.category}</span>
        <span className="chip chip--safe">
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2 6.4l2.6 2.6L10 3.6"
              stroke="currentColor"
              strokeWidth="1.7"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {post.status === 'reworded' ? 'Reworded' : 'Checked'}
        </span>
        <span className="chip">{post.replies} replies</span>
        {post.held ? (
          <span className="chip chip--accent">{post.held} held</span>
        ) : null}
      </footer>


      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-4 top-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      >
        <svg width="14" height="14" viewBox="0 0 16 16">
          <path
            d="M5 11L11 5M11 5H6.5M11 5v4.5"
            stroke="var(--accent)"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </Link>
  )
}

export function LivePosts() {
  const root = useRef<HTMLElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const trackEl = track.current
      const viewEl = viewport.current
      if (!trackEl || !viewEl) return

      const mm = gsap.matchMedia()

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const cards = gsap.utils.toArray<HTMLElement>('.post-card', trackEl)

        /* --- the marquee ------------------------------------------------ */
        const loop = gsap.to(trackEl, {
          xPercent: -50,
          ease: 'none',
          duration: 68,
          repeat: -1,
        })

        /* --- per-card 3D, driven by distance from viewport centre ------- */
        const setters = cards.map((card) => ({
          card,
          rotY: gsap.quickSetter(card, 'rotationY', 'deg'),
          z: gsap.quickSetter(card, 'z', 'px'),
          y: gsap.quickSetter(card, 'y', 'px'),
          o: gsap.quickSetter(card, 'opacity'),
        }))

        const render = () => {
          const rect = viewEl.getBoundingClientRect()
          const mid = rect.left + rect.width / 2
          const reach = rect.width / 2 + 200

          for (const s of setters) {
            const b = s.card.getBoundingClientRect()
            if (b.right < rect.left - 240 || b.left > rect.right + 240) continue
            const d = gsap.utils.clamp(-1, 1, (b.left + b.width / 2 - mid) / reach)
            const a = Math.abs(d)
            /* Cards turn to face the centre and fall away behind it. The
               perspective is 900px, so these values read as real depth
               rather than the barely-there tilt the old 1500px gave. */
            s.rotY(d * -38)
            s.z(-a * a * 420)
            s.y(a * 14)
            s.o(1 - a * 0.62)
          }
        }

        gsap.ticker.add(render)

        /* --- stop while a visitor is reading or aiming ------------------
           These cards are links now, so this has to come to a full stop.
           At the previous 12% the cards still crept, which makes clicking one
           a game of chasing a moving target. */
        const slow = () => gsap.to(loop, { timeScale: 0, duration: 0.45 })
        const resume = () => gsap.to(loop, { timeScale: 1, duration: 0.9 })

        viewEl.addEventListener('pointerenter', slow)
        viewEl.addEventListener('pointerleave', resume)
        viewEl.addEventListener('focusin', slow)
        viewEl.addEventListener('focusout', resume)

        /* --- pause entirely when the section is off-screen -------------- */
        const st = ScrollTrigger.create({
          trigger: root.current!,
          start: 'top bottom',
          end: 'bottom top',
          onToggle: (self) => (self.isActive ? loop.play() : loop.pause()),
        })

        return () => {
          gsap.ticker.remove(render)
          viewEl.removeEventListener('pointerenter', slow)
          viewEl.removeEventListener('pointerleave', resume)
          viewEl.removeEventListener('focusin', slow)
          viewEl.removeEventListener('focusout', resume)
          st.kill()
          loop.kill()
        }
      })

      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section
      ref={root}
      id="posts"
      aria-labelledby="posts-title"
      className="theme-dark relative overflow-hidden bg-surface py-[clamp(4rem,8vw,7rem)]"
    >
      <div className="px-[clamp(1.1rem,4vw,4rem)]">
        <Reveal className="flex flex-wrap items-end justify-between gap-8">
          <div className="max-w-2xl">
            <p className="u-eyebrow">Anonymous community · illustrated</p>
            <h2
              id="posts-title"
              className="mt-5 text-[clamp(2rem,4.2vw,3.4rem)] text-ink"
            >
              This is what it looks like when someone finally says it
            </h2>
            <p className="u-lede mt-6">
              Every post carries a handle, a category and a moderation
              verdict — and that is the entire public record of a person here.
              Open any one to read the whole thread.
            </p>

            {/* Before the cards, not after them.

                These are written by us. Real members' words are not marketing
                material and will never appear on this page, so the honest thing
                is to say what these are at the point somebody starts reading —
                a disclaimer underneath is read second, if at all. */}
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--border-seam)] px-3.5 py-1.5 text-[0.8125rem] text-ink/70">
              <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M8 7.2v4M8 4.9v.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              Written as examples. Nothing here is a real member&rsquo;s post.
            </p>
          </div>

          <Link to="/community" className="btn btn--primary">
            Read the community
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
        </Reveal>
      </div>

      {/* ----------------------------------------------------- 3D marquee -- */}
      <div
        ref={viewport}
        className="relative mt-14 cursor-default [perspective-origin:50%_40%] [perspective:900px]"
      >
        <div
          ref={track}
          className="pointer-events-none flex w-max gap-8 px-8 [transform-style:preserve-3d]"
        >
          {TRACK.map((post, i) => (
            <PostCard
              key={`${post.handle}-${i}`}
              post={post}
              dup={i >= ILLUSTRATIVE_POSTS.length}
            />
          ))}
        </div>

        {/* edge fades so cards enter and leave rather than getting clipped */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-[clamp(4rem,18vw,22rem)] bg-[linear-gradient(90deg,var(--surface)_18%,transparent)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-[clamp(4rem,18vw,22rem)] bg-[linear-gradient(270deg,var(--surface)_18%,transparent)]"
        />
      </div>

      <div className="mt-10 px-[clamp(1.1rem,4vw,4rem)]">
        <p className="u-label text-[0.625rem]">
          Any card opens the full thread.
        </p>
      </div>
    </section>
  )
}
