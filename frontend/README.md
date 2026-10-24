# frontend

React + TypeScript + Vite application. Public website, anonymous community, member
dashboard, and the therapist, moderator, admin and partner portals.

**Stack:** React Router, TanStack Query, Zustand, React Hook Form + Zod, Tailwind,
WebAuthn, Web Crypto API, Socket.IO client, WebRTC client, Service Worker.

## Layout

| Path | Holds |
| --- | --- |
| `src/app/` | Router, providers, app shell, route guards |
| `src/pages/` | Route-level screens, one folder per portal |
| `src/features/` | Vertical slices — each has `api/ components/ hooks/ model/ schemas/` |
| `src/components/` | Cross-feature presentational components |
| `src/services/` | `api-client`, `websocket-client`, `webrtc-client`, `crypto-client`, `upload-client` |
| `src/stores/` | Global client state |
| `src/schemas/` | Zod schemas generated from `metadata/api/openapi` |
| `src/i18n/` | en, hi, hi-Latn (Hinglish) locale bundles |
| `src/workers/` | Service worker and the on-device safety classifier worker |

## Rules

- Never talks to a database, a key store, or an AI service directly. Everything goes
  through the Privacy Gateway.
- No sensitive data in `localStorage`. IndexedDB only for encrypted local cache.
- Journals, reflections, therapy messages, sensitive attachments, safety plans and
  optional transcripts are encrypted in the browser before upload.
- Strip metadata before uploading files. Warn before a post contains personal data.
- Every screen keeps a quick-exit path. Session timeout is automatic.
- No streaks, no follower counts, no pressure notifications.
