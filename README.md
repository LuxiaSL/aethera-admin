# Aethera Admin Panel

A personal server management dashboard for coordinating the Aethera ecosystem—including Discord bots (ChapterX), the Aethera blog platform, and the AI Dream Window GPU pipeline.

![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?style=flat-square&logo=express&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

## Features

### 🤖 ChapterX Bot Management
- **Service Control** — Start, stop, restart Discord bots via systemd
- **Multi-Slot Deployment** — Switch bots between `main` and `dev` code branches
- **Config Editing** — Live YAML configuration editing with backup
- **Log Streaming** — Real-time journalctl output per bot

### 🌐 Aethera Blog Control
- **Docker Management** — Container status, restart, logs via Docker API
- **Blog Post Management** — Create, edit, and publish posts with Markdown preview
- **Direct Database Access** — Read/write to blog SQLite database

### 🎨 Dream Window GPU Control
- **RunPod Integration** — Start/stop serverless GPU instances on demand
- **Cost Tracking** — Live session cost estimates with uptime monitoring
- **Status Aggregation** — Combined view of VPS (Aethera) and RunPod state
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
- **Docker** — For Aethera blog container management
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

## Related Projects

| Component | Repository | Description |
|-----------|------------|-------------|
| Aethera Blog | [LuxiaSL/aethera](https://github.com/LuxiaSL/aethera) | Python/FastAPI blog with Dreams viewer |
| Dream Gen | [LuxiaSL/dream_gen](https://github.com/LuxiaSL/dream_gen) | AI art generator for Dream Window |
| ChapterX | [antra-tess/chapterx](https://github.com/antra-tess/chapterx) | Discord bot framework (upstream) |

## License

MIT © luxia

