# Spec — Connectome deploy panel for aethera-admin

**Status:** spec / ready for a standalone build session.
**Goal:** button-driven deploy + lifecycle for Nin (and the connectome stack) inside the existing
`~/projects/aethera-server/admin` panel, so luxia can pull/build/restart from `admin.aetherawi.red`
instead of the manual `rsync + ssh + systemctl restart` dance.

This mirrors the panel's **existing** ChapterX deploy-slot machinery almost 1:1 — do NOT invent new
infrastructure; extend the proven patterns.

---

## 1. What exists to build on (aethera-admin, `root@aetherawi.red:/opt/aethera-server/admin` / local `~/projects/aethera-server/admin`)

- **Stack:** Node + Express 5, `better-sqlite3`, bcrypt session auth (middleware/), SSE for live status,
  vanilla HTML/CSS/JS frontend with a CRT theme. `node server.js` (systemd unit + Caddy `admin.aetherawi.red → :1717`).
- **Per-service modules:** `lib/services/*.js` (aethera, chapterx, membrane-api, usage, …). Each exposes
  status + lifecycle, shelling out via `lib/utils.js` (`exec`/`execFile` wrappers, 10MB buffer).
- **systemd wrapper — `lib/systemd.js`:** `getServiceStatus`, `startService`, `stopService`,
  `restartService`, `getServiceLogs(name, lines)`, `isSystemdAvailable`. **Reuse verbatim** for
  `nin.service` / `nin-session.service`.
- **ChapterX = the exact analog — `lib/services/chapterx.js` + `routes/slots.js` + `config.js`:**
  - `config.js` scans a base path for **git-repo deploy slots** (a valid slot = a dir containing `.git`),
    5s cache.
  - `chapterx.js`: `getAllSlotsStatus`, `getSlotGitStatus(slot)`, `gitFetch(slot)`, `gitPull(slot)`,
    `restartBot`, and npm dep re-resolution (`npm install <pkg>@<specifier> --save` for git deps).
  - `routes/slots.js`: `GET /api/slots`, `GET /api/slots/:slot/status`, `POST /api/slots/:slot/fetch`,
    `POST /api/slots/:slot/pull` (body `{autoRestart}`).
- **Frontend:** `public/js/live-data.js` (EventSource wrapper, auto-reconnect, per-domain `/api/stream/:domain`),
  `public/js/api.js` (fetch POST helpers), `public/index.html` + `public/css/pages/*.css` per page.

**Takeaway:** the connectome panel = a `connectome` twin of `chapterx`/`slots`, plus Nin-specific runtime
readouts (memory, MCP children, cost, laptop reachability).

---

## 2. Prerequisite (one-time provisioning) — make `/opt/connectome` git-deployable

Today `/opt/connectome/*` are **rsync copies, not git clones** (they have no `.git`), so `git pull` deploys
are impossible. Convert the four **source-run** repos to real clones of `anima-research`:

| Repo | Run mode | Build step | Services it affects |
|---|---|---|---|
| `connectome-host` | source (bun runs `src/index.ts`) | none (bun install only if deps change) | `nin.service` |
| `discord-mcpl` | source (`node dist/…`) | `npm run build` (tsc) | `nin.service` (MCP child) |
| `heartbeat-mcpl` | source (`node dist/…`) | `npm run build` (tsc) | `nin.service` (MCP child) |
| `terminal-sessions-mcp` | source (`node dist/…`) | `npm run build` (tsc; native `node-pty`) | `nin.service` (MCP child) + `nin-session.service` |

`membrane` / `chronicle` / `context-manager` / `agent-framework` stay **published-npm deps** of
connectome-host (updated via version bump + `bun install`, not git) — panel can surface their installed
versions but the primary deploy targets are the four above.

**Conversion (must preserve untracked runtime state):** for each repo, `git init` in place → add the
`anima-research` remote → `git fetch` → `git reset --mixed origin/main` (keeps working tree; re-tracks
files) — OR clone fresh alongside and move `.env`, `data/`, `node_modules/`, `dist/` over. **CRITICAL:**
`connectome-host/data/` holds Nin's live memory (`sessions/c995bf73/`) and `.env` holds secrets — both are
gitignored and MUST survive the conversion untouched.

**VPS read access:** the VPS needs pull access to the private `anima-research` repos — add a **read-only
deploy key** (per-repo GitHub deploy key, or one machine user with read). The laptop keeps push; the VPS
only pulls.

---

## 3. Backend

### `config.js` additions
- `CONNECTOME_PATH` (default `/opt/connectome`).
- A declarative repo manifest (so the panel knows build + restart implications):
  ```js
  CONNECTOME_REPOS = [
    { name: 'connectome-host',        build: null,              restarts: ['nin'] },
    { name: 'discord-mcpl',           build: 'npm run build',   restarts: ['nin'] },
    { name: 'heartbeat-mcpl',         build: 'npm run build',   restarts: ['nin'] },
    { name: 'terminal-sessions-mcp',  build: 'npm run build',   restarts: ['nin','nin-session'] },
  ]
  ```
- `NIN_SESSION_DIR = /opt/connectome/connectome-host/data/sessions` (for memory readout),
  `NIN_STORE_ID` discovered from `data/sessions.json` `activeSessionId`.

### `lib/services/connectome.js` (mirror `chapterx.js`)
- `getStatus()` → `{ repos: [...], nin: {...}, runtime: {...} }`:
  - **per repo:** `branch`, `head` (short sha + subject), `behind`/`ahead` vs `origin/main` (after a cached
    `git fetch`), `dirty` (uncommitted changes — should be false; flag if not), `buildStale` (dist older
    than newest tracked src — optional).
  - **nin:** `getServiceStatus('nin')` + `getServiceStatus('nin-session')` (active, uptime, restartCount,
    MainPID, RSS).
  - **runtime:** MCP children count (`pgrep -P <MainPID>` → expect discord/heartbeat/exa + 2×terminal-sessions),
    Discord connected (tail `data/discord-mcpl-debug.log` for recent `sweep:done`/`registerDiscordChannels`),
    memory (`data/sessions/<id>/records.log` size + `activeSessionId`), laptop reach
    (`curl -m5 http://kataletheia:3101/health`), next heartbeat (from `data/heartbeat-littleguy.json`).
- `gitFetch(repo)`, `gitPull(repo)` → reuse chapterx's git helpers (same shape).
- `build(repo)` → run the manifest `build` cmd in the repo dir via `lib/utils` exec; stream/capture output.
- `deploy(repo, { autoRestart })` → **pull → (build) → restart affected services**, sequential, returns a
  step-by-step log. Honor a **global deploy lock** (see §5).
- `deployAll({ onlyBehind })` → deploy each repo that's behind `origin/main`.
- `restartNin()` (host only), `restartNinFull()` (nin + nin-session), `restartSession()` — via
  `systemd.restartService`.
- `getLogs(lines)` → `systemd.getServiceLogs('nin', lines)`.
- `runCostReport()` → exec `node scripts/nin-cost.mjs` in connectome-host, return parsed total + per-model.

### `routes/connectome.js` (mirror `slots.js`, mount at `/api/connectome`)
- `GET /api/connectome` → `getStatus()`.
- `POST /api/connectome/repos/:repo/fetch` → `gitFetch`.
- `POST /api/connectome/repos/:repo/deploy` (body `{autoRestart=true}`) → `deploy`.
- `POST /api/connectome/deploy-all` (body `{onlyBehind=true}`) → `deployAll`.
- `POST /api/connectome/nin/restart` · `/nin/restart-full` · `/session/restart`.
- `GET /api/connectome/logs?lines=200` → `getLogs`.
- `POST /api/connectome/cost` → `runCostReport`.
- `GET /api/stream/connectome` → SSE: push `getStatus()` every ~3–5s (reuse the existing `routes/stream.js`
  domain pattern), plus live deploy-step events while a deploy runs.
- **All routes behind the existing auth middleware** (same as slots/bots).

---

## 4. Frontend (`public/`)

- `index.html`: add a **Connectome** nav entry + page section (match existing markup).
- `public/css/pages/connectome.css`: CRT theme, reuse `components.css` cards/buttons/variables.
- Page JS module (follow `bots`/`dreams` page pattern): open `LiveData('/api/stream/connectome')`, render:
  - **Nin card:** status dot (active/failed), uptime, RSS, restart count, memory size + session id, Discord
    ✓/✗, MCP children N/5, laptop-reach ✓/✗, next heartbeat, current $ (from last cost run). Buttons:
    **Restart Nin**, **Restart Nin + daemons**, **View logs** (opens a streamed log pane), **Cost report**.
  - **Repo rows** (one per source repo): branch · `head` · **“up to date” / “N behind”** badge · build-stale
    flag. Buttons per row: **Check** (fetch), **Deploy** (pull+build+restart, disabled/greyed when up-to-date).
  - **Deploy All** button (deploys everything behind).
  - **Deploy output pane:** stream the step log (git pull → build → restart) live via SSE; show ✓/✗ per step.
- Confirmation modal on any restart/deploy (Nin blips off Discord ~15s) — reuse existing confirm pattern.

---

## 5. Safety & constraints (non-negotiable)

- **Never touch `data/` or `.env`.** Deploys are `git` ops on tracked files + build + service restart only.
  Nin's memory (`data/sessions/…`) and secrets must be untouched. A deploy that would modify `data/` is a bug.
- **Global deploy lock:** one deploy at a time (a module-level mutex / a lock row); reject concurrent deploys
  with a clear message. (ChapterX already guards restart loops — follow suit.)
- **Auth:** every route behind the existing session auth; no new auth surface. Panel already sits behind
  Caddy `admin.aetherawi.red` (app-level auth, no basic-auth at Caddy).
- **Dirty-tree guard:** if a repo has uncommitted changes on the VPS (shouldn't happen), refuse to pull and
  surface it, rather than `git reset --hard` blindly.
- **Restart = brief downtime:** Nin drops off Discord ~15s and resumes session `c995bf73`; confirm memory is
  intact after (the panel already reads records.log size — show before/after).
- **Bun/npm path:** systemd/exec run with a minimal PATH — use absolute bins (`/root/.bun/bin/bun`,
  `/usr/bin/node`, `/usr/bin/git`) or set PATH in the exec env.

---

## 6. Nice-to-haves (later, not v1)
- Show published-dep versions (membrane/chronicle/context-manager/agent-framework) + “update available” by
  querying npm; a button to bump + `bun install` + restart.
- One-click **rotate Discord token** / edit `.env` values (guarded).
- History of deploys (who/when/what sha) in the existing SQLite.
- Laptop-daemon health surfaced from the VPS (already curl-able); maybe a “wake laptop” note.

---

## 7. Open questions (for the build session)
1. Deploy-key vs machine-user for VPS read access to `anima-research` — luxia's preference.
2. `git reset --mixed` in-place vs clone-fresh-and-move for the one-time conversion — pick the least risky
   given the live `data/`.
3. Should `deploy` always `bun install` for connectome-host, or only when `package.json`/lockfile changed
   (diff the pulled range)? (Cheaper to gate on lockfile change.)
4. Log streaming: dedicated SSE channel vs polling `getLogs`.

---

## 8. Agent prompt (for the standalone build session)
> You are building a **Connectome deploy panel** inside `~/projects/aethera-server/admin` (Node/Express 5
> admin app). Read `docs/CONNECTOME-ADMIN-PANEL-spec.md` (this file) fully, then study the existing
> **ChapterX** deploy machinery you're cloning: `lib/services/chapterx.js`, `routes/slots.js`, `config.js`
> (slot scanning), `lib/systemd.js` (service wrapper), and the frontend `public/js/live-data.js` +
> `public/js/api.js` + a page like `public/js` bots/dreams. Build a `connectome` twin: a `lib/services/
> connectome.js` module + `routes/connectome.js` + a frontend page, following those patterns exactly (SSE
> live status, POST actions, session auth, CRT theme). Step 0 is the one-time provisioning in §2 (convert
> `/opt/connectome`'s four source repos to git clones with a read-only deploy key, **preserving `data/`,
> `.env`, `node_modules/`, `dist/`**). Honor every constraint in §5 — especially: never touch `data/` or
> `.env`, one deploy at a time, absolute bin paths. Deliver: the four source repos deployable via buttons
> (Check → Deploy = pull+build+restart), Nin lifecycle controls (restart / restart+daemons / logs / cost),
> and a live status readout (memory, MCP children, Discord, laptop reach). Test against the running Nin on
> `aetherawi.red` (session `c995bf73`) — a deploy must leave its memory intact.
