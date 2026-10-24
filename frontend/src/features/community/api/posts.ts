/* ============================================================================
   Posts, the feed, and replies.

   Types mirror `Post` and `Reply` in
   backend/services/community-service/src/infrastructure/posts.ts. They are
   written out rather than imported: the frontend is not in the backend's
   TypeScript project, and a shared package for four interfaces would couple the
   browser bundle to a workspace it has no other reason to depend on.

   Two things here are load-bearing and easy to undo by accident:

   A POST IS NEVER MODERATED. Every moderation category needs a recipient, and a
   new post has none. `createPost` therefore runs no preflight check and offers
   no "your post was held" state, because there is none to render. Replies are
   moderated, because somebody else is on the receiving end.

   THE FEED IS NOT A TIMELINE. Posts expire — five days on the free tier — and
   the server filters on `expiresAt` independently of any sweep, so a post
   disappearing is the promise being kept rather than data being lost.
   ========================================================================= */

import { api } from '../../../lib/api/client'

export type Post = {
  ref: string
  categoryId: string
  body: string
  state: string
  /** The handle, never an account. "QuietRiver-4821". */
  authorHandle: string
  createdAt: string
  publishedAt: string | undefined
  /** When it stops being visible. The whole point of the free tier. */
  expiresAt: string | undefined
  /** 'pending' until B1 has written its one reply. */
  aiResponseState: string
  replyCount: number
}

export type Reply = {
  ref: string
  body: string
  state: string
  /** 'member' or 'ai' — the supportive response is labelled, never disguised. */
  source: string
  authorHandle: string
  createdAt: string
  publishedAt: string | undefined
}

export async function feed(limit = 50, signal?: AbortSignal): Promise<Post[]> {
  const { posts } = await api.get<{ posts: Post[] }>('/api/community/feed', {
    query: { limit },
    ...(signal ? { signal } : {}),
  })
  return posts
}

export async function ownPosts(signal?: AbortSignal): Promise<Post[]> {
  const { posts } = await api.get<{ posts: Post[] }>(
    '/api/community/posts/mine',
    signal ? { signal } : {},
  )
  return posts
}

/**
 * The member's plan, and what it permits.
 *
 * Fetched rather than assumed. Word ceilings, which kinds of writing are
 * offered, and how many peer replies are visible are all plan decisions, and a
 * client that guesses either shows a door that is locked or hides one that is
 * open.
 */
export type Entitlements = {
  planId: string
  name: string
  tier: number
  quotas: {
    postsPerMonth: number | null
    repliesWrittenPerMonth: number | null
    aiResponsesPerPost: number
    postVisibilityDays: number
    postVisibilityExtendableToDays: number | null
    /** 0 means the feature is not on this tier at all — not "no cap". */
    journalEntriesPerMonth: number | null
    shortStoriesPerMonth: number | null
  }
  entitlements: string[]
  /** What no plan may restrict. Shipped so the promise is checkable from here. */
  neverGated: string[]
}

/**
 * The categories a post may carry, in the server's words.
 *
 * Fetched, never hardcoded. These are SITUATIONS rather than conditions —
 * "Just today", "Money", "Loss", "Something good", not "Anxiety" or "Trauma
 * recovery" — because a list of conditions asks somebody to diagnose
 * themselves before they are allowed to speak. A client carrying its own copy
 * drifts from that decision, and the server refuses what it does not know.
 */
export type Category = { id: string; label: string; blurb: string }

export async function categories(signal?: AbortSignal): Promise<Category[]> {
  const { categories: list } = await api.get<{ categories: Category[] }>(
    '/api/community/categories',
    signal ? { signal } : {},
  )
  return list
}

export async function entitlements(signal?: AbortSignal): Promise<Entitlements> {
  const { plan } = await api.get<{ plan: Entitlements }>(
    '/api/community/entitlements',
    signal ? { signal } : {},
  )
  return plan
}

export async function readPost(ref: string, signal?: AbortSignal): Promise<Post> {
  const { post } = await api.get<{ post: Post }>(
    `/api/community/posts/${encodeURIComponent(ref)}`,
    signal ? { signal } : {},
  )
  return post
}

/**
 * Put something down.
 *
 * `visibilityDays` is a request, not an instruction: the server caps it at what
 * the member's plan allows and returns the real `expiresAt`. Render that value
 * rather than the one that was asked for.
 *
 * Throws ApiError with `isQuotaExceeded` when the month's allowance is gone.
 */
export async function createPost(
  input: { categoryId: string; body: string; visibilityDays?: number },
  signal?: AbortSignal,
): Promise<Post> {
  const { post } = await api.post<{ post: Post }>(
    '/api/community/posts',
    input,
    signal ? { signal } : {},
  )
  return post
}

/**
 * The replies on a post.
 *
 * Fetched from the post route, which answers `{ post, replies }` together. There is no
 * `/replies` sub-route and there never was — this function asked for one for three
 * weeks and got a 404 every time, which nothing noticed because `useThreads` degrades a
 * failed reply fetch to an empty list so one bad thread cannot blank the feed. The
 * degradation was right; asking the wrong URL was not. Every thread looked like a post
 * nobody had answered, including the ones the AI had.
 */
export async function replies(ref: string, signal?: AbortSignal): Promise<Reply[]> {
  const { replies: list } = await api.get<{ post: Post; replies: Reply[] }>(
    `/api/community/posts/${encodeURIComponent(ref)}`,
    signal ? { signal } : {},
  )
  return list
}

/**
 * Reply to someone.
 *
 * This is the moderated path. A1 runs server side before anything is published,
 * so the composer cannot talk its way past it, and three outcomes reach here:
 *
 *   201            published
 *   422 blocked    with a verdict id to appeal against
 *   503            the check could not run — NOT a refusal, and must not be
 *                  rendered as one. See ApiError.isModerationUnavailable.
 */
export async function createReply(
  ref: string,
  body: string,
  signal?: AbortSignal,
): Promise<Reply> {
  const { reply } = await api.post<{ reply: Reply }>(
    `/api/community/posts/${encodeURIComponent(ref)}/replies`,
    { body },
    signal ? { signal } : {},
  )
  return reply
}
