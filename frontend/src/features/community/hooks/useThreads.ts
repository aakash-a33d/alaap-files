/* ============================================================================
   The feed, with each post's replies attached.

   The feed endpoint returns posts and a reply COUNT, not the replies
   themselves — deliberately, because a feed that eagerly loaded every thread
   would fetch conversations nobody opened. This hook fetches the replies for
   the posts on screen, which is a small fixed number.

   Failures are per-thread. A post whose replies cannot be loaded still renders
   with its own words; the alternative is one unreachable thread blanking the
   whole feed, which is a worse answer to a worse problem.
   ========================================================================= */

import { useAsync, type Async } from '../../../lib/api/useAsync'
import { feed, ownPosts, replies as fetchReplies } from '../api/posts'
import { toFeedThread, type FeedThread } from '../model/thread'

async function withReplies(
  posts: Awaited<ReturnType<typeof feed>>,
  signal: AbortSignal,
): Promise<FeedThread[]> {
  const settled = await Promise.all(
    posts.map(async (post) => {
      try {
        return toFeedThread(post, await fetchReplies(post.ref, signal))
      } catch (cause) {
        if ((cause as Error)?.name === 'AbortError') throw cause
        // The post still stands on its own. See the note above.
        return toFeedThread(post, [])
      }
    }),
  )
  return settled
}

export function useThreads(limit = 25): Async<FeedThread[]> {
  return useAsync(async (signal) => withReplies(await feed(limit, signal), signal), [limit])
}

/** The member's own posts, in the same shape, including expired ones. */
export function useOwnThreads(): Async<FeedThread[]> {
  return useAsync(async (signal) => withReplies(await ownPosts(signal), signal), [])
}
