# M8 — the frontend against live services

**Delivers:** auth flow, composer, feed and dashboard talking to the real backend.
**Done when:** the browser talks to the gateway, and no component renders fixture data.

The frontend already exists and is, by volume, the largest thing in the repository. What
it does not have is an API layer: `src/features/*/api/` and `src/features/*/hooks/` are
empty directories, and every screen renders from `src/content/*.ts`. M8 is not a UI
milestone. It is the milestone where the UI stops being a drawing of the product.

---

## 1. Three rules that decide everything else

### 1.1 The browser calls the gateway, and nothing else

Today `src/features/moderation/api/client.ts` calls `VITE_AI_URL`, defaulting to
`http://localhost:8000` — the AI tier, directly. Its own header says this is a
development affordance, and it is now the thing standing between us and the milestone.

Architecture §8.1 is that the browser never reaches the AI tier. Everything goes to the
Privacy Gateway, which is where authentication, purpose limitation, consent checks, rate
limiting, minimisation and the audit trail live. A browser that can reach port 8000
directly bypasses all six — and the audit vault, which is supposed to be able to answer
"who asked what, when", would have no row for it.

So: one base URL, the gateway. Every AI call becomes a gateway call. The direct client
is deleted, not wrapped.

### 1.2 The session token never enters JavaScript

`backend/gateway/src/middleware/authenticate.ts` already accepts an HttpOnly cookie
named `alaap_session` alongside the `Authorization: Bearer` header. **Nothing in the
codebase sets that cookie.** The gateway reads a credential no one issues, and the dev
scripts all use bearer tokens because that is what exists.

For a browser client that gap has to close the cookie way, not the bearer way. A bearer
token in a browser has to be stored somewhere JavaScript can read — and an opaque
session token is not a claim about who you are, it *is* the session. Any XSS on any page
exfiltrates a live session, and on this platform a live session is somebody's journal.
`localStorage` is not an option and neither is a variable in a module.

M8 therefore adds `Set-Cookie` on the three endpoints that mint a session, and clears it
on sign-out:

| endpoint | when |
|---|---|
| `POST /api/auth/register/verify` | a new account, verified |
| `POST /api/auth/login/verify` | OTP sign-in |
| `POST /api/auth/passkey/verify` | passkey sign-in |
| `POST /api/auth/logout` | cleared, and the session revoked server side |

`HttpOnly; SameSite=Lax; Path=/`, and `Secure` whenever the request arrived over TLS —
not unconditionally, or local development over http silently stops working and somebody
"fixes" it by turning the flag off everywhere.

The body keeps returning the token. The dev scripts depend on it, and a native client
later will too. What changes is that the browser stops reading it.

### 1.3 A refusal is not an error

The backend is careful to distinguish refusals that look alike from a distance, and the
UI must not flatten them back together:

| status | code | what it means | what the member is told |
|---|---|---|---|
| 402 | `not_entitled` | the feature is on another plan | what it is part of — never "upgrade to continue" over a paywall shape |
| 429 | `quota_exceeded` | out of allowance this month | how many, and when it resets |
| 451 | `consent_withdrawn` | they asked us to stop | that it stopped, and that nothing was deleted |
| 503 | `moderation_unavailable` | A1 unreachable | that the check could not run — never that the reply was rejected |

The one that matters most is 451. A member who withdrew consent and is then shown "you
have run out of journal entries" has been told that asserting control costs them a
feature. clinical-vault-service checks consent *before* quota specifically so this
screen can exist; throwing that away in the client would undo it.

---

## 2. What gets built

```
src/lib/api/
  client.ts        one fetch wrapper: base URL, credentials, error shaping
  errors.ts        ApiError with code + status, the 402/429/451/503 vocabulary
  session.ts       who am I, sign out — reads the server, holds no token
src/features/<domain>/api/     one module per backend route group
src/features/<domain>/hooks/   the React surface over it
```

The client is thin on purpose. No data-fetching library is being added in M8: the app
has four screens and React Router 7 already loads them. A cache layer before there is
anything to cache is a dependency taken on faith.

**Routes wired, by screen:**

- **Join** — `/api/auth/register/start`, `register/verify`, `login/start`, `login/verify`,
  recovery-code sign-in, and the passkey ceremony. Age confirmation is part of register,
  not a separate screen.
- **Community** — `/api/community/posts` (feed, create), `/api/community/posts/:ref/replies`,
  the moderation preflight through the gateway, category list from metadata.
- **Dashboard** — `/api/journal/entries`, `/api/mood/checkins`, `/api/consent/records`,
  `/api/consent/grant/:purpose`, `/api/consent/withdraw/:purpose`.

**Deleted:** every fixture export in `src/content/`, and the direct AI client.

---

## 3. Copy is not mock data

`src/content/*.ts` holds both, and the distinction is the whole of the cleanup:

```ts
// COPY — stays. This is the product's voice, and it belongs in the repository.
placeholder: 'Start anywhere. The middle of the sentence is fine.'

// FIXTURE — goes. This is a lie about the state of the world.
export const MEMBER = { handle: 'QuietRiver-4821', plan: 'Anonymous Community' }
export const SEAM_DAYS: boolean[] = [true, true, false, ...]
```

A placeholder is written by us and is the same for every member. A handle belongs to
somebody. `SEAM_DAYS` is fourteen days of mood history that nobody lived.

Copy stays in `src/content/`. Fixtures are removed, and `scripts/dev/check-no-fixtures.mjs`
fails the build if a component imports one again.

---

## 4. Acceptance

`scripts/dev/frontend-flows.mjs` drives the real stack the way the other milestone
suites do, plus the gate:

1. Register through the gateway; assert `Set-Cookie: alaap_session` is `HttpOnly` and
   that the response body's token is *not* required to make the next call.
2. Post, and see it in the feed.
3. Write a cruel reply; assert it is blocked, with a verdict to appeal.
4. Write a journal entry without consent; assert 451 with the consent code, not 429.
5. Grant consent, write, read back, withdraw; assert the entry is still readable.
6. Sign out; assert the cookie is cleared and the session is dead server side.
7. `check-no-fixtures.mjs` passes.

The milestone is done when a person can do all of that in a browser, and nothing on the
screen came from `src/content/`.
