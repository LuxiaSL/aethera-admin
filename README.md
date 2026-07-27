# æthera admin

personal admin panel for managing my server; not just æthera the site but any bots and other services i run as standalone on that server. i wouldn't recommend using this; design your own instead based on this pattern.

![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?style=flat-square&logo=express&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

## Features

### 🤖 ChapterX Bot Management
- **Service Control** — Start, stop, restart Discord bots via systemd
- **Multi-Slot Deployment** — Switch bots between `main` and `dev` code branches
- **Config Editing** — Live YAML configuration editing with backup
- **Log Streaming** — Real-time journalctl output per bot

### 🌐 æthera control
- **Docker Management** — Container status, restart, logs via Docker API
- **Blog Post Management** — Create, edit, and publish posts with Markdown preview
- **Direct Database Access** — Read/write to blog SQLite database

### 🎨 Dreams GPU Control
- **RunPod Integration** — Start/stop serverless GPU instances on demand
- **Cost Tracking** — Live session cost estimates with uptime monitoring
- **Status Aggregation** — Combined view of VPS (æthera) and RunPod state
- **Admin Override** — Force start/stop bypassing presence-based auto-scaling

### 📦 Deployment Slots
- **Git Operations** — Fetch, pull, checkout branches without SSH
- **Code Change Detection** — Automatic restart prompts when code updates
- **Branch Switching** — Deploy different ChapterX versions to test bots

### 🔐 Security
- **Cookie-based Sessions** — Secure httpOnly cookies with bcrypt password hashing
- **Rate Limiting** — Per-IP request throttling with stricter login limits
- **Single User** — Personal admin designed for one authenticated user

## Architecture

```
admin/
├── server.js           # Express app entry point
├── config.js           # Centralized configuration with env overrides
├── lib/
│   ├── auth/           # Session & user management
│   │   ├── sessions.js # In-memory + file-backed session store
│   │   └── users.js    # User CRUD with bcrypt
│   ├── content/
│   │   └── blog.js     # Direct SQLite blog operations
│   ├── security/
│   │   └── rate-limit.js
│   ├── services/
│   │   ├── aethera.js  # Docker container management
│   │   ├── chapterx.js # Bot lifecycle & slot management
│   │   └── dreams.js   # RunPod GPU control
│   ├── systemd.js      # Systemd service file generation
│   └── utils.js        # Shell command helpers
├── middleware/
│   └── require-auth.js # Authentication middleware
├── routes/
│   ├── auth.js         # Login, logout, password change
│   ├── bots.js         # Bot CRUD & lifecycle
│   ├── services.js     # Aethera docker control
│   ├── slots.js        # Git operations for ChapterX
│   ├── dreams.js       # RunPod GPU endpoints
│   └── blog.js         # Post management
├── public/             # Static SPA frontend
│   ├── index.html      # Single-page app shell
│   ├── css/            # Modular stylesheets
│   └── js/             # Vanilla JS client
└── data/               # Runtime state (gitignored)
    ├── user.json       # Hashed credentials
    └── sessions.json   # Active sessions
```

## Installation

### Prerequisites

- **Node.js** 18+ (uses native `fetch`, `--watch`)
- **systemd** — For ChapterX bot service management
- **Docker** — For æthera blog container management
- Access to sibling directories: `bots/`, `core/`, `chapterx/`

### Setup

```bash
# Clone into aethera-server structure
cd ~/projects/aethera-server  # or /opt/aethera-server on server
git clone git@github.com:LuxiaSL/aethera-admin.git admin
cd admin

# Install dependencies
npm install

# Create .env file
cp .env.example .env  # Then edit with your values

# Start development server (with auto-reload)
npm run dev

# Or production
npm start
```

On first run with no configured user, the server generates a random admin password and prints it to the console.

## Configuration

All configuration is centralized in `config.js` with environment variable overrides:

### Required

| Variable | Description | Default |
|----------|-------------|---------|
| `BASE_PATH` | Parent directory containing admin, bots, core, chapterx | `/opt/aethera-server` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server listen port | `1717` |
| `HOST` | Server bind address | `0.0.0.0` |
| `AETHERA_API_URL` | Blog API base URL | `http://localhost:8000` |
| `AETHERA_CONTAINER_NAME` | Docker container name | `aethera` |
| `RUNPOD_API_KEY` | RunPod API key for GPU control | — |
| `RUNPOD_ENDPOINT_ID` | RunPod serverless endpoint ID | — |
| `SESSION_MAX_AGE` | Session duration (ms) | 7 days |
| `SYSTEMD_USER` | Force user systemd services | auto-detected |

### Example `.env`

```bash
# Base paths (adjust for local dev vs server)
BASE_PATH=/home/luxia/projects/aethera-server

# Server
PORT=1717
HOST=0.0.0.0

# Aethera integration
AETHERA_API_URL=http://localhost:8000

# RunPod (optional - for Dreams GPU control)
RUNPOD_API_KEY=your_runpod_api_key
RUNPOD_ENDPOINT_ID=your_endpoint_id
```

## API Reference

All endpoints require authentication via session cookie (except `/api/auth/login`).

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Authenticate and receive session cookie |
| `POST` | `/api/auth/logout` | Invalidate session |
| `GET` | `/api/auth/me` | Get current user info |
| `POST` | `/api/auth/password` | Change password |

### Bots

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/bots` | List all bots with status |
| `GET` | `/api/bots/:name` | Get specific bot status |
| `POST` | `/api/bots/:name/start` | Start bot (body: `{ slot: "main"\|"dev" }`) |
| `POST` | `/api/bots/:name/stop` | Stop bot |
| `POST` | `/api/bots/:name/restart` | Restart bot |
| `GET` | `/api/bots/:name/logs` | Get journalctl logs |
| `GET` | `/api/bots/:name/config` | Get YAML config |
| `POST` | `/api/bots/:name/config` | Save YAML config |

### Services

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/services/aethera/status` | Get Docker container status |
| `POST` | `/api/services/aethera/restart` | Restart container |
| `POST` | `/api/services/aethera/start` | Start container |
| `POST` | `/api/services/aethera/stop` | Stop container |
| `GET` | `/api/services/aethera/logs` | Get Docker logs |

### Slots (ChapterX Git)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/slots` | Get all slots with git status |
| `GET` | `/api/slots/:slot` | Get specific slot status |
| `POST` | `/api/slots/:slot/fetch` | Git fetch |
| `POST` | `/api/slots/:slot/pull` | Git pull |
| `POST` | `/api/slots/:slot/checkout` | Git checkout (body: `{ branch }`) |
| `POST` | `/api/slots/:slot/restart-bots` | Restart bots on slot |

### Dreams (GPU)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dreams/status` | Get combined GPU status |
| `POST` | `/api/dreams/start` | Start GPU (admin override) |
| `POST` | `/api/dreams/stop` | Force stop GPU |
| `GET` | `/api/dreams/config` | Get RunPod config status |

### Blog

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/blog/posts` | List posts (query: `page`, `limit`, `status`) |
| `GET` | `/api/blog/posts/:id` | Get post by ID |
| `POST` | `/api/blog/posts` | Create post |
| `PUT` | `/api/blog/posts/:id` | Update post |
| `DELETE` | `/api/blog/posts/:id` | Delete post |
| `POST` | `/api/blog/posts/:id/publish` | Publish post |
| `POST` | `/api/blog/posts/:id/unpublish` | Unpublish post |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server health check (no auth required) |

## Development

```bash
# Development with auto-reload
npm run dev

# The server uses Node's native --watch flag (Node 18+)
# Changes to .js files trigger automatic restart
```

### Project Structure

**Backend** follows a simple service-oriented pattern:
- `lib/services/` — Business logic for each managed service
- `routes/` — Express routers that call services
- `middleware/` — Auth, rate limiting

**Frontend** is a vanilla JS single-page application:
- `public/index.html` — All pages as hidden divs, tab-based navigation
- `public/js/api.js` — Fetch wrappers with error handling
- `public/js/main.js` — Page controllers, DOM manipulation
- `public/css/` — Modular CSS with CSS variables

### Adding New Features

1. Add service logic in `lib/services/`
2. Create route file in `routes/`
3. Mount route in `server.js`
4. Add UI section in `public/index.html`
5. Add JS handlers in `public/js/main.js`

## Deployment

### Systemd Service

```bash
# Copy service file
sudo cp /opt/aethera-server/deploy/services/aethera-admin.service /etc/systemd/system/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable aethera-admin
sudo systemctl start aethera-admin

# View logs
journalctl -u aethera-admin -f
```

### Caddy Reverse Proxy

```caddyfile
admin.aetherawi.red {
    reverse_proxy localhost:1717
}
```

### Environment

Set production environment variables in `/opt/aethera-server/admin/.env`:

```bash
NODE_ENV=production
BASE_PATH=/opt/aethera-server
RUNPOD_API_KEY=...
RUNPOD_ENDPOINT_ID=...
```

## Shader Background

The panel's background is not a web effect that resembles the Ghostty terminal
setup — it **is** the Ghostty shader chain, running the same `.glsl` files
through the same ping-pong a terminal compositor uses.

`public/shaders/` holds byte-identical copies of the active chain from
`~/.config/ghostty/shaders`, plus `prologue.glsl` / `epilogue.glsl` (the uniform
contract every pass compiles against). `chain.json` records the order. They are
committed because the VPS has no `~/.config/ghostty` and deploys are a git push.

### Keeping it in sync

```bash
npm run sync-shaders     # pull the live chain out of ~/.config/ghostty
npm run check-shaders    # exit 1 if out of date, change nothing
npm run verify-shaders   # headless chrome: does it compile and render?
```

`sync-shaders` **parses the chain from the real `config`** — the uncommented
`custom-shader =` lines — rather than from a list stored here. A hand-maintained
list is a list that silently goes stale, which is the exact failure this file
used to have: it spent months rendering `moire-radial`, months after that pass
was removed from the live chain for being a measured no-op.

Shaders that leave the chain are deleted from `public/shaders/` on the next sync.

### Where a browser is not a terminal

Three adaptations, all in `public/js/shader-bg.js`, none of them edits to a
shader file:

| | Terminal | Panel |
|---|---|---|
| `iChannel0` | the terminal's own glyphs | the panel's text, redrawn as real glyphs in their computed colors onto `#0f0a1a` — so `ink` still parts the gas and a red error badge still warms the medium under it |
| cursor uniforms | the text cursor | the mouse pointer, quantized to a synthetic cell so a move reads as a discrete jump |
| `crt-finale` boot | 45s power-on, once per launch | the same animation on a warped clock: 1:1 through the dramatic phases, then eased onto `DURATION` by ~4.5s |

The boot warp exists because `crt-finale`'s phases sit at hardcoded absolute
times — the visible part (cathode glow, scan line, raster expansion) is over by
~1.35s and the rest is a slow settle out to t=42. Editing `DURATION` down would
cut from 1.29× brightness overdrive straight to steady state, which is a pop,
not a shorter boot. Warping the clock plays the whole animation, fast.

#### Why the proxy draws real glyphs

`medium.glsl`'s grain is applied purely multiplicatively — `color.rgb *= 1.0 +
depth * m`, with no additive term. It can only scale light already in the
buffer, so its visible strength is proportional to that buffer's luminance and
nothing else. (The sky's emission *is* additive, deliberately: *"a purely
multiplicative sky vanishes on an empty screen."* That is why the sky shows up
here regardless and the grain does not.)

A first version drew soft rectangles over text line-boxes at 0.45 coverage and
half resolution. Measured, that buffer peaked at **0.296** luma with nothing
above 0.35, against real terminal text at **0.84** — the grain was scaling a
field ~3× too dim, with no glyph-scale structure for the per-channel dispersion
to fringe, so the chromatic pools never appeared. Real glyphs restore both the
peak *and* lower the mean (0.097 → 0.065), which matters in the same direction:
a raised mean "quietly raises the floor the rest of the stack sits on top of."

`shaderBg.setInkGain()` is the dial for this, and effectively the grain-strength
knob.

### Runtime knobs

Resolution scale is auto-tuned on first load (bench a few frames, fit
`FRAME_BUDGET_MS`, persist per renderer + per chain hash). From the console:

```js
shaderBg.status()        // chain, passes, resolution, renderer, scale, inkGain
shaderBg.setQuality(0.8) // pin a scale (0.25–1.5)
shaderBg.setInkGain(1.3) // grain strength — how hard content drives the medium
shaderBg.retune()        // clear the saved scale and re-bench
shaderBg.toggle()        // off → static CSS background
```

The chain **refuses to run on a software rasterizer** (SwiftShader, llvmpipe):
one frame of `medium.glsl` on a CPU takes tens of seconds and would freeze the
tab, and no resolution scale rescues that. Those clients get the CSS fallback in
`base.css` (`html.no-shader-bg`). Append `?shaderbg=force&shadert=120` to
override — that is how `verify-shaders` exercises the chain headlessly.

## Related Projects

| Component | Repository | Description |
|-----------|------------|-------------|
| æthera Blog | [LuxiaSL/aethera](https://github.com/LuxiaSL/aethera) | Python/FastAPI blog with extras |
| Dream Gen | [LuxiaSL/dream_gen](https://github.com/LuxiaSL/dream_gen) | AI art generator for Dream Window |
| ChapterX | [antra-tess/chapterx](https://github.com/antra-tess/chapterx) | Discord bot framework (upstream) |

## License

MIT © luxia

