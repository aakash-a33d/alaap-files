import { Link, useParams } from 'react-router-dom'
import { BRAND, ILLUSTRATIVE_THREADS, type Reply, type Thread } from '../../content/site'

/* ============================================================================
   /community — the full feed in a forum shape.

   Reached from the marquee on the landing page. Threaded like Reddit or Quora,
   but with the platform's own rules visible: an issued handle instead of a
   username, an AI first response, and a moderation verdict on any reply the
   safety filter rewrote.
   ========================================================================= */

function Arrow() {
  return (
    <svg width="14" height="12" viewBox="0 0 15 12" aria-hidden="true">
      <path
        d="M14 6H2M6 2L2 6l4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Score({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[0.72rem] text-faint">
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M6 2l4 5H2z"
          fill="currentColor"
        />
      </svg>
      {n}
    </span>
  )
}

function ReplyNode({ reply, depth = 0 }: { reply: Reply; depth?: number }) {
  return (
    <li className={depth > 0 ? 'ml-4 border-l border-[var(--border)] pl-5 sm:ml-6' : ''}>
      <article className="py-4">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-[family-name:var(--font-mono)] text-[0.78rem] text-accent">
            {reply.handle}
          </span>
          <span className="u-label text-[0.58rem]">{reply.ago}</span>
          <Score n={reply.score} />
          {reply.status === 'reworded' && (
            <span className="chip chip--accent text-[0.6rem]">
              Reworded by safety filter
            </span>
          )}
        </header>

        <p className="mt-2 text-[0.95rem] leading-relaxed text-ink/90">
          {reply.body}
        </p>
      </article>

      {reply.children && reply.children.length > 0 && (
        <ul>
          {reply.children.map((c) => (
            <ReplyNode key={c.handle + c.ago} reply={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function ThreadFull({ thread }: { thread: Thread }) {
  const replyCount = thread.replies.reduce(
    (n, r) => n + 1 + (r.children?.length ?? 0),
    0,
  )

  return (
    <article className="card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-[family-name:var(--font-mono)] text-[0.82rem] text-accent">
          {thread.handle}
        </span>
        <span className="chip">{thread.category}</span>
        <span className="u-label text-[0.58rem]">{thread.ago}</span>
        <span className="ml-auto flex items-center gap-3">
          <Score n={thread.score} />
        </span>
      </header>

      <h2 className="mt-4 text-[clamp(1.25rem,2vw,1.6rem)] leading-snug text-ink">
        {thread.title}
      </h2>

      <p className="mt-3 text-[1rem] leading-relaxed text-ink/90">{thread.body}</p>

      {/* The AI first response, so the screen is never empty */}
      <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--border-seam)] bg-[var(--accent-wash)] p-4">
        <p className="u-label mb-2 text-[0.58rem] text-accent">
          Alaap AI · first response
        </p>
        <p className="text-[0.92rem] leading-relaxed text-ink/90">
          {thread.aiFirst}
        </p>
        <p className="mt-2 text-[0.72rem] text-faint">
          Not a diagnosis, and not a substitute for a clinician.
        </p>
      </div>

      <div className="mt-6 border-t border-[var(--border)] pt-2">
        <p className="u-label py-3 text-[0.58rem]">
          {replyCount} replies · every one checked for harm before it appeared
        </p>
        <ul>
          {thread.replies.map((r) => (
            <ReplyNode key={r.handle + r.ago} reply={r} />
          ))}
        </ul>
      </div>
    </article>
  )
}

export default function Community() {
  const { slug } = useParams()
  const single = slug ? ILLUSTRATIVE_THREADS.find((t) => t.slug === slug) : undefined
  const shown = single ? [single] : ILLUSTRATIVE_THREADS

  return (
    <div className="theme-light min-h-svh bg-sunken">
      {/* Its own slim bar — the landing page nav is built for the film. */}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[rgb(252_251_248/0.9)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-[clamp(1.1rem,4vw,2rem)] py-3.5">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-2 text-[0.9rem] text-muted transition-colors hover:text-ink"
          >
            <Arrow />
            {BRAND.name}
          </Link>
          <span className="ml-auto flex items-center gap-2">
            {single && (
              <Link to="/community" className="btn btn--ghost max-sm:hidden">
                All posts
              </Link>
            )}
            <Link to="/join" className="btn btn--primary">
              {BRAND.cta}
            </Link>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-[clamp(1.1rem,4vw,2rem)] py-[clamp(2.5rem,5vw,4rem)]">
        <p className="u-eyebrow">Anonymous community</p>
        <h1 className="u-h2 mt-4">
          {single ? 'One post, in full' : 'What people are saying today'}
        </h1>
        <p className="u-lede mt-5">
          {single
            ? 'Replies are threaded. Every one passed the safety filter before it appeared here.'
            : 'Every post carries a handle, a category and an AI first response. Replies are threaded, and each one was checked for harm before it was shown.'}
        </p>

        {/* Said before the posts, not after them.

            This page is open to anyone, and what real members write is not
            available to it — the feed lives behind a session, and their words
            are not a shop window. So these are ours, and the page says so
            where somebody reads it rather than in a footnote. */}
        <p className="mt-6 flex items-start gap-2.5 rounded-[12px] border border-[var(--border)] bg-surface px-4 py-3 text-[0.875rem] leading-relaxed text-muted">
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 shrink-0">
            <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d="M8 7.2v4M8 4.9v.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>
            <strong className="font-medium text-ink">These are examples we wrote.</strong>{' '}
            They show how the community works &mdash; the handles, the AI first
            response, the safety verdict on a reply. Real posts are only ever
            visible to signed-in members, and never reproduced here.
          </span>
        </p>

        <div className="mt-9 flex flex-col gap-5">
          {shown.map((t) => (
            <ThreadFull key={t.slug} thread={t} />
          ))}
        </div>

        <p className="u-label mt-10 text-[0.6rem]">
          Examples written for this page.
        </p>
      </main>
    </div>
  )
}
