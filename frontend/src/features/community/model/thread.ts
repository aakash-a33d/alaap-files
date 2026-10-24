/* ============================================================================
   What the feed renders, assembled from what the server actually has.

   The components on this tab were written against a fixture shape, and that
   shape carried three fields the backend has no source for. Each is worth
   naming, because "the adapter fills it in" is how invented data comes back:

   TITLE. A community post has no title column, for the same reason a journal
   entry has none — a title is content, and asking somebody to summarise their
   worst week in six words before they are allowed to write about it is a bad
   thing to ask. The feed leads with the words instead.

   SCORE. There is no voting. Nothing in the schema counts approval, and adding
   a number that ranks how well a person's distress was received is not a
   feature this platform is going to grow.

   NESTED REPLIES. Replies are flat. A thread that branches turns a conversation
   into an argument with sides, and the one shape the server stores is a list.

   What IS here is what the server returned, plus formatting. Nothing else.
   ========================================================================= */

import { relativeTime, timeRemaining } from '../../../lib/format'
import type { Post, Reply } from '../api/posts'

export type FeedReply = {
  ref: string
  handle: string
  body: string
  ago: string
  /**
   * The supportive response, labelled rather than disguised.
   *
   * B1 writes one reply per post and it is never presented as a person. A
   * member who cannot tell which voice answered them cannot consent to being
   * answered by a model.
   */
  fromAi: boolean
}

export type FeedThread = {
  /** The public reference. "P-560917". */
  ref: string
  handle: string
  categoryId: string
  body: string
  /** "2 hours ago" */
  ago: string
  /** "4d 18h left", or empty where the post does not expire. */
  expiresIn: string
  /** Whether B1 has answered yet. 'pending' is a real state and shows as one. */
  aiResponseState: string
  replyCount: number
  replies: FeedReply[]
}

export function toFeedReply(reply: Reply, now?: Date): FeedReply {
  return {
    ref: reply.ref,
    handle: reply.authorHandle,
    body: reply.body,
    ago: relativeTime(reply.publishedAt ?? reply.createdAt, now),
    fromAi: reply.source === 'ai',
  }
}

export function toFeedThread(post: Post, replies: Reply[] = [], now?: Date): FeedThread {
  return {
    ref: post.ref,
    handle: post.authorHandle,
    categoryId: post.categoryId,
    body: post.body,
    ago: relativeTime(post.publishedAt ?? post.createdAt, now),
    expiresIn: timeRemaining(post.expiresAt, now),
    aiResponseState: post.aiResponseState,
    replyCount: post.replyCount,
    replies: replies.map((r) => toFeedReply(r, now)),
  }
}

/** The AI's reply, if it has written one yet. */
export function aiReply(thread: FeedThread): FeedReply | undefined {
  return thread.replies.find((r) => r.fromAi)
}

/** Everyone else's. */
export function peerReplies(thread: FeedThread): FeedReply[] {
  return thread.replies.filter((r) => !r.fromAi)
}
