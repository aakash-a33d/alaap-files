/* ============================================================================
   The feed, the member's own posts, and what their plan permits.

   Each is a separate call because each fails separately: the feed can load
   while entitlements are still in flight, and a screen that waits for both
   shows nothing while either is slow.
   ========================================================================= */

import { useAsync, type Async } from '../../../lib/api/useAsync'
import {
  categories,
  entitlements,
  feed,
  ownPosts,
  replies,
  type Category,
  type Entitlements,
  type Post,
  type Reply,
} from '../api/posts'

/** The public feed. Posts that have not expired, newest first. */
export function useFeed(limit = 50): Async<Post[]> {
  return useAsync((signal) => feed(limit, signal), [limit])
}

/** What this member has written. Includes their own expired posts. */
export function useOwnPosts(): Async<Post[]> {
  return useAsync((signal) => ownPosts(signal), [])
}

export function useReplies(ref: string | undefined): Async<Reply[]> {
  return useAsync((signal) => (ref ? replies(ref, signal) : Promise.resolve([])), [ref])
}

/**
 * The plan.
 *
 * Fetched, never assumed. Until it arrives the UI should show neither the free
 * limits nor the paid ones — guessing in either direction tells somebody
 * something untrue about their own account.
 */
export function useEntitlements(): Async<Entitlements> {
  return useAsync((signal) => entitlements(signal), [])
}

/** The topics a post may be filed under, in the server's words. */
export function useCategories(): Async<Category[]> {
  return useAsync((signal) => categories(signal), [])
}
