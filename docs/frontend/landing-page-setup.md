# Running Alaap on another machine

## What you need

- **Node.js `^20.19.0` or `>=22.12.0`** — Vite 8 requires it. Check with `node -v`.
  Download from [nodejs.org](https://nodejs.org). npm ships with it.
- Nothing else. No database, no API keys, no backend — this is the landing page only.

## Copy these

Copy the whole `alaap-platform/frontend` folder **except two directories**:

| Copy | Skip |
| --- | --- |
| `src/`, `public/`, `index.html` | `node_modules/` — 113 MB, rebuilt by npm |
| `package.json`, `package-lock.json` | `dist/` — rebuilt by the build |
| `vite.config.ts`, `tsconfig*.json` | |
| `README.md`, `SETUP.md` | |

That is about **9.5 MB**, most of it the hero film in `public/media/`.

> `public/media/` must travel with the project. It holds the scroll-scrubbed
> video and the four scene stills, and the hero has nothing to show without it.
> It is deliberately **not** in `.gitignore`.

## Run it

```bash
cd alaap-platform/frontend
npm ci
npm run dev
```

Then open **http://localhost:5177**.

Use `npm ci` rather than `npm install` — it installs the exact versions in
`package-lock.json`, so the other machine gets what was tested here.

## Other commands

```bash
npm run build
```

Typechecks and writes a production bundle to `dist/`. Preview it with
`npm run preview`.

```bash
npm run lint
```

## If you would rather use git

The folder is not a repository yet. To make one:

```bash
git init && git add -A && git commit -m "Alaap landing page"
```

The existing `.gitignore` already excludes `node_modules` and `dist`, and keeps
`public/media`. Note the repo will be ~9.5 MB because of the video — fine for
GitHub, which warns above 50 MB per file.

## Deploying

`npm run build` produces a fully static `dist/` — no server-side code. Drag it
into Netlify, Vercel, Cloudflare Pages, or any static host. Two things to set:

- Serve `.mp4` with byte-range requests enabled, or the hero cannot seek while
  scrubbing. Every major host does this by default.
- Long cache headers on `/media/*` — those files never change.

## Troubleshooting

**`Unsupported engine` / crypto or `structuredClone` errors on `npm ci`** — Node
is too old. Check `node -v` against the requirement above.

**Hero shows a still image and never scrubs** — the browser could not seek the
video. Confirm `public/media/kintsugi-1600.mp4` copied across and that the host
supports range requests.

**Hero does not animate at all, sections just stack** — the OS has *Reduce
motion* enabled. That is intended behaviour, not a fault.

**Port 5177 already in use** — `npm run dev -- --port 3000`.
