# Mission Control Dashboard

A full-stack Kanban project dashboard for tracking tasks across projects. Built with React, Express, and PostgreSQL.

## Features

- **Overview dashboard** — global metrics, project widgets, deadlines, activity feed (default landing page)
- **Kanban boards** with drag-and-drop task management
- **Multi-project support** with project switcher
- **Task details** — priority, assignee, due dates, descriptions
- **Fully containerized** — one command deploys Postgres + API + UI
- **Dark mode** Mission Control theme
- **Workspace tab** — Gmail inbox (read/reply) and Google Calendar (view/create/delete) in the dashboard

### Metrics definitions

| Metric | Definition |
|--------|------------|
| **Backlog** | Tasks in Backlog or To Do |
| **In Progress** | Tasks in In Progress |
| **Completed** | Tasks in Review or Done |
| **Overdue** | Past due date, not in Review/Done |
| **Done This Week** | Moved to Review/Done in the last 7 days |

---

## Quick Start (Docker — recommended)

Requires Docker only. No local Node.js needed.

```bash
cd kanban_dashboard
docker compose up -d --build
```

Open **http://localhost** — Overview dashboard loads by default.

```bash
docker compose logs -f    # view logs
docker compose down       # stop everything
```

### Windows (Docker Desktop)

Ubuntu production and Linux Docker use the base compose file (including the host-network `ollama-proxy`). On Windows, use Docker Desktop (WSL2 backend) and the Windows override — it skips that Linux-only proxy and talks to host Ollama on port **11434** when needed.

1. Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) with the **WSL2** backend (or `winget install --id Docker.DockerDesktop -e`).
2. Start Docker Desktop and wait until the engine is running.
3. From the repo root in PowerShell:

```powershell
.\scripts\setup-windows.ps1   # creates .env from .env.example if missing
.\scripts\start-windows.ps1   # docker compose up -d --build + host poller supervisor
```

Open **http://localhost**.

`start-windows.ps1` also starts the **network host poller** (BMC IPv6 probe + reboot agent on `:38765`) under a supervisor that auto-restarts on crash, and registers a per-user Scheduled Task (`MissionControlNetworkHostPoller`) so the poller comes back at logon / every 10 minutes when Docker Postgres is up. `stop-windows.ps1` stops both Docker and the poller.

The agent can reboot hardware and launch Atlas jobs, and it has to bind a LAN-visible interface because `host.docker.internal` does not reach loopback. It therefore **requires a shared secret** and refuses to start without one:

```bash
NETWORK_HOST_AGENT_TOKEN=<64-hex-chars>   # setup-windows.ps1 generates this
```

Every request except `GET /health` must carry `x-mission-control-agent-token`, and the API container needs the same value. Reboot and BMC-reset calls must also include `confirm_cluster_id` matching the target device. Set `NETWORK_HOST_AGENT_BIND=127.0.0.1` when the API runs directly on the host rather than in Docker.

```powershell
.\scripts\logs-windows.ps1                 # Docker logs (poller: logs\network-host-poller.log)
.\scripts\stop-windows.ps1                 # stop Docker + host poller
.\scripts\start-network-host-poller.ps1    # start/restart poller only
.\scripts\stop-network-host-poller.ps1     # stop poller only
```

Equivalent npm aliases: `npm run setup:windows`, `npm run docker:up:windows`, `npm run docker:down:windows`, `npm run docker:logs:windows`.

**Cursor MCP on Windows:** copy [`.cursor/mcp.windows.json`](.cursor/mcp.windows.json) over `.cursor/mcp.json` (or merge the `powershell` launchers), install MCP deps with `npm run mcp:install` (requires Node.js), then restart Cursor. Bash launchers remain the default for Linux.

Local Windows Docker and production (`http://10.10.50.6`) still use **separate databases**. Ansible/Ubuntu deploy remains the production path.

### Production vs local

| | Production | Local Docker |
|---|---|---|
| **URL** | http://10.10.50.6 | http://localhost |
| **Purpose** | Live dashboard, source of truth | Development only |
| **Database** | Server Postgres | Local Docker volume (not synced) |
| **MCP / Cursor** | `MISSION_CONTROL_API_URL=http://10.10.50.6/api` | Do not use for status |

Local and production have **separate databases**. Task changes on one do not appear on the other.
Use production for real status; use local only to test code changes.

---

## Local Development

Requires Node.js 18+ and Docker (for Postgres only).

```bash
cp .env.example .env
npm run db:up              # starts Postgres on port 5432
npm install
npm install --prefix backend
npm install --prefix frontend
npm run dev                # API :3001, UI :5173
```

Open **http://localhost:5173**

For a single-port local setup:

```bash
npm run build && npm start
# Open http://localhost:3001
```

---

## Project Structure

```
kanban_dashboard/
├── backend/              # Express API + Dockerfile
│   └── tests/            # Unit tests (npm test --prefix backend)
├── frontend/             # React/Vite UI + nginx Dockerfile
├── database/migrations/  # PostgreSQL schema (V1, V2, …)
├── secrets/kubeconfigs/  # <cluster_name>.kubeconfig files (gitignored)
├── docker-compose.yml    # Full stack: postgres + api + web
└── docker-compose.dev.yml # Dev override (expose Postgres port)
```

Kubeconfigs embed client certificates and keys, so they live in the gitignored `secrets/kubeconfigs/` directory (override with `NETWORK_KUBECONFIG_DIR`). Only that directory is mounted into the API container.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/overview` | Global metrics, project widgets, activity |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id/board` | Kanban board payload |
| POST | `/api/columns/:id/tasks` | Create task |
| PUT | `/api/tasks/:id` | Update task (`github_issue_url`, `label_ids`) |
| POST | `/api/tasks/:id/github-issue` | Create GitHub issue for task |
| PATCH | `/api/tasks/:id/move` | Move/reorder task |
| DELETE | `/api/tasks/:id` | Delete task |
| GET | `/api/projects/:id/labels` | List project labels |
| POST | `/api/projects/:id/labels` | Create label |
| DELETE | `/api/labels/:id` | Delete label |
| GET | `/api/projects/:id/export?format=csv\|json` | Export board data |
| GET | `/api/github/status` | GitHub integration config |
| POST | `/api/webhooks/github` | GitHub issue webhook (no auth) |

---

## Telegram notifications (Sprint 2)

Set in `.env` to enable push alerts:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...   # from @BotFather
TELEGRAM_CHAT_ID=123456789         # your chat or group id
TELEGRAM_NOTIFY_ON=completed,overdue,urgent
```

| Event | When it fires |
|-------|----------------|
| **completed** | Task moved to Review or Done |
| **urgent** | Task created or updated with urgent priority |
| **overdue** | Daily scan finds past-due tasks not yet notified |

Get your chat ID: message [@userinfobot](https://t.me/userinfobot) or add the bot to a group and use the Telegram API `getUpdates`.

---

## Email daily digest (Sprint 2)

The API sends a scheduled board summary (same content as the MCP status report). **Gmail API is preferred** when OAuth tokens are set; otherwise SMTP is used.

### Gmail API (recommended)

After authenticating with Google Workspace MCP, sync tokens into `.env`:

```bash
npm run sync:google-token --prefix backend
```

Then set recipients:

```bash
EMAIL_FROM=you@gmail.com          # sender (defaults from synced account)
EMAIL_TO=team@example.com         # comma-separated recipients
EMAIL_DIGEST_CRON=0 8 * * 1-5    # weekdays at 08:00 server local time
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...          # filled by sync:google-token
```

Send a test digest immediately:

```bash
npm run send:digest --prefix backend
```

### SMTP fallback

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASS=your-password
EMAIL_FROM=mission-control@example.com
EMAIL_TO=team@example.com
EMAIL_DIGEST_CRON=0 8 * * 1-5
```

| Setting | Default | Meaning |
|---------|---------|---------|
| `EMAIL_DIGEST_CRON` | `0 8 * * 1-5` | Weekdays at 08:00 (server local time) |
| `EMAIL_TO` | — | Comma-separated recipients |

The digest includes global metrics, per-project progress, upcoming deadlines, and recent activity. The API checks the cron schedule every minute when `EMAIL_TO` is set and either Gmail or SMTP is configured.

---

## GitHub integration (Sprint 3)

Link Kanban tasks to GitHub issues and optionally auto-create issues when tasks are added.

### Setup

```bash
GITHUB_TOKEN=ghp_...                    # fine-grained or classic PAT with repo issues scope
GITHUB_DEFAULT_REPO=your-org/your-repo  # owner/repo for auto-create
GITHUB_AUTO_CREATE=true                 # set false to disable auto-create on new tasks
MISSION_CONTROL_PUBLIC_URL=https://your-dashboard.example.com  # link back in issue body
```

| Feature | How it works |
|---------|----------------|
| **Auto-create** | New tasks get a GitHub issue when `GITHUB_TOKEN` + `GITHUB_DEFAULT_REPO` are set |
| **Manual link** | Paste an issue URL in the task modal, or set `github_issue_url` via API/MCP |
| **Create button** | Task modal → "Create GitHub issue" when not yet linked |
| **Webhook sync** | Closing/reopening an issue moves the linked task to Done / To Do |
| **Board → GitHub** | Moving a task to Review/Done closes the issue; moving out reopens it |

### Webhook

In your GitHub repo: **Settings → Webhooks → Add webhook**

- **Payload URL:** `https://your-dashboard.example.com/api/webhooks/github`
- **Content type:** `application/json`
- **Secret:** same value as `GITHUB_WEBHOOK_SECRET`
- **Events:** Issues

---

## Labels, filters, and export (Sprint 4)

| Feature | How to use |
|---------|------------|
| **Labels** | Task modal → toggle labels or create new ones (per project) |
| **Filters** | Board toolbar → search, priority, label, assignee |
| **Export** | Board header → **CSV** or **JSON** download |

Export includes column, title, description, priority, assignee, due date, labels, and GitHub issue URL.

---

Auth is **off by default** (no `JWT_SECRET`). CI and local dev work without credentials.

With `NODE_ENV=production` the API **refuses to start** unless `JWT_SECRET` is set, because an unset secret would otherwise serve every `/api` route unauthenticated. To deliberately run an open API in production, set `ALLOW_UNAUTHENTICATED=1`.

To enable, set in `.env`:

```bash
JWT_SECRET=change-me-to-a-long-random-string
AUTH_USERNAME=admin
AUTH_PASSWORD=your-secure-password
AUTH_API_TOKEN=token-for-mcp-and-scripts
```

- **Dashboard:** sign-in page appears when auth is enabled
- **MCP / scripts:** send `Authorization: Bearer $AUTH_API_TOKEN`
- **Public routes:** `/api/health`, `/api/auth/status`, `/api/auth/login`, `/api/webhooks/github`

### Users, access levels, and tab permissions

Accounts live in the database. `AUTH_USERNAME` / `AUTH_PASSWORD` seed the **first admin** on startup and only while the `users` table is empty — after that, changing them in `.env` has no effect and accounts are managed from the **Users** tab in the dashboard.

Each account gets one access level plus the list of tabs it can open:

| Access level | Can change data | Tabs |
|--------------|-----------------|------|
| **Administrator** | Yes | All tabs, plus user management |
| **Full access** | Yes | Only the tabs the admin ticks |
| **Read only** | No — every `POST`/`PUT`/`PATCH`/`DELETE` is refused | Only the tabs the admin ticks |

The API enforces the same rules the sidebar shows: a request to a tab the account cannot see returns `403`, so hidden tabs are not reachable by calling the API directly. Permissions are read from the database on every request, so revoking a tab or disabling an account takes effect immediately rather than when the token expires. Changing a password signs that user out of their other sessions.

`AUTH_API_TOKEN` is not a dashboard account — it keeps full access for MCP servers and scripts.

**Locked out of every admin account:**

```bash
npm run user:reset-password --prefix backend -- <username> <password>
```

That resets an existing user's password (and re-enables them), or creates the account as an admin if it does not exist.

### Production ops status

After deploy, Ansible verifies `GET /api/ops/status` (requires auth). Check manually:

```bash
curl -s -H "Authorization: Bearer $AUTH_API_TOKEN" http://10.10.50.6/api/ops/status | jq
```

Reports whether auth, Telegram, email digest, GitHub, and `MISSION_CONTROL_PUBLIC_URL` are configured, plus linked issue counts.

Optional LAN HTTPS: set `mc_enable_tls: true` in Ansible vars (self-signed cert on port 443).

### Workspace (email + calendar)

Sidebar → **Workspace** opens Gmail and Google Calendar tabs when Google OAuth is configured:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...   # from MCP auth + npm run sync:google-token --prefix backend
```

API routes (auth required): `/api/workspace/email/*`, `/api/workspace/calendar/*`.

### Workspace email assistant (Ollama)

When Ollama is running locally, the assistant reviews inbox mail and suggests actions — **always with your approval** before send or delete:

```bash
OLLAMA_BASE_URL=http://host.docker.internal:11435   # Docker: socat proxy → host Ollama
OLLAMA_MODEL=qwen3.5:9b
```

Docker Compose includes an `ollama-proxy` service because Ollama listens on `127.0.0.1` only. The proxy forwards port **11435** on the host to Ollama on **11434**.

**Production (shared dev Ollama):** Point prod at the dev server's LAN proxy — do not install Ollama on `10.10.50.6`:

```bash
# GitHub production secrets
MC_OLLAMA_BASE_URL=http://10.10.1.55:11435
MC_OLLAMA_MODEL=qwen3.5:9b
```

Prod API container calls dev Ollama over LAN. Keep Ollama + `ollama-proxy` running on the dev machine. See Mission Control ticket #30.

| Action | Behavior |
|--------|----------|
| **Review** | Classify one open message (important, ad, newsletter, etc.) |
| **Scan inbox** | Review up to 5 inbox messages; queue those needing action |
| **Auto-cleanup junk** | Review up to 25 messages; trash ads, newsletters, and automated system notifications (no per-email approval) |
| **Reply** | Assistant drafts a reply → you edit → **Approve & send** |
| **Delete** | Ads flagged → **Approve delete** or **Keep email** |

Never auto-sends or auto-deletes without explicit approval in the UI.

---

## CI/CD

GitHub Actions runs on every push and pull request to `main`:

| Job | Checks |
|-----|--------|
| **test-and-build** | Unit tests, Postgres migrations, API smoke test, ops verify, frontend typecheck/build, MCP verify |
| **docker** | `docker compose build` for api + web images |
| **deploy** | After CI passes on `main`, deploys to production via Ansible (manual dispatch also available) |

Run the same checks locally (requires Postgres via `npm run db:up`):

```bash
npm run ci
```

### Production deploy (Ansible)

Server requirements: Ubuntu 22.04/24.04, SSH access, sudo.

```bash
# 1. Copy and fill secrets
cp ansible/group_vars/mission_control/vault.yml.example \
   ansible/group_vars/mission_control/vault.yml
ansible-vault encrypt ansible/group_vars/mission_control/vault.yml

# 2. Set server in inventory (or export DEPLOY_HOST / DEPLOY_USER)
#    Edit ansible/inventory/production.yml

# 3. Deploy
cd ansible
ansible-playbook playbooks/deploy.yml --ask-vault-pass
```

Deploy a specific git ref (for CD):

```bash
ansible-playbook playbooks/deploy.yml -e mc_deploy_ref=<sha-or-tag> --ask-vault-pass
```

GitHub Actions CD: create a **production** environment and add secrets:

| Secret | Required |
|--------|----------|
| `DEPLOY_HOST` | Server IP (manual Ansible only) |
| `DEPLOY_USER` | SSH user (manual Ansible only) |
| `DEPLOY_SSH_KEY` | SSH key (manual Ansible only) |
| `MC_POSTGRES_PASSWORD` | Database password |
| `MC_JWT_SECRET` | Auth signing key |
| `MC_AUTH_PASSWORD` | Password for the seeded first admin account |
| `MC_AUTH_API_TOKEN` | MCP / API bearer token |
| `MC_GITHUB_TOKEN` | GitHub PAT for issue sync (required when `mc_github_default_repo` is set) |
| `MC_GITHUB_WEBHOOK_SECRET` | GitHub webhook HMAC secret |

Optional: `MC_TELEGRAM_*`, `MC_EMAIL_*`, `MC_GOOGLE_*` for notifications and digest.

### Self-hosted runner (LAN servers)

GitHub cloud runners cannot reach private IPs like `10.10.x.x`. Install a runner **on the production server**:

```bash
# On your laptop — get a one-hour registration token
gh api repos/OWNER/REPO/actions/runners/registration-token --method POST -q .token

# On the server as deploy
RUNNER_TOKEN=<paste-token> ./scripts/setup-github-runner.sh
```

The Deploy workflow uses `runs-on: [self-hosted, mission-control]` and Ansible `inventory/local.yml` (no SSH hop).

Verify in GitHub: **Settings → Actions → Runners** — should show `mission-control` online.

---

## Public hostname via Cloudflare Tunnel

Puts the dashboard on a real domain without opening an inbound firewall port or
exposing your home IP. `cloudflared` dials out to Cloudflare and traffic returns
through that existing connection.

```
visitor → Cloudflare edge (TLS + Access) → tunnel → cloudflared → web:8080 → api:3001
```

nginx listens twice. Port **80** is published for LAN and localhost. Port
**8080** is reachable only from the Docker network, so cloudflared is the only
thing that can talk to it — which is what makes it safe for that listener to
trust Cloudflare's `CF-Connecting-IP` header and pass the real visitor address
to the API. Send the tunnel to port 80 instead and every remote visitor shares
one address, so one attacker would rate-limit everybody.

### Requirements

- A domain using Cloudflare nameservers (transfer of DNS only, not the registrar)
- Cloudflare Zero Trust enabled on the account (the free tier covers this)
- Outbound HTTPS from this machine — nothing inbound
- The machine stays on; when it sleeps, the site is down

### Steps

1. **Create the tunnel.** Zero Trust → Networks → Tunnels → Create → select
   Docker. Copy the token and put it in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
   The token alone is enough to run the tunnel, so treat it as a credential.
2. **Add the public hostname** on the tunnel: pick the hostname, set the service
   to `HTTP` and `web:8080`.
3. **Point the app at the new URL.** Set `MISSION_CONTROL_PUBLIC_URL` to the
   `https://` hostname, and add `{that URL}/api/workspace/oauth/callback` to the
   Google Cloud Console OAuth client, or Workspace re-authentication breaks.
4. **Put Access in front of it** (see below) before the hostname resolves.
5. **Start it:**

```bash
docker compose --profile cloudflare -f docker-compose.yml -f docker-compose.windows.yml up -d
```

### Access is not optional here

The dashboard authenticates against one static username and password. Failed
logins are rate limited, but that is not a substitute for real authentication on
a public host. In Zero Trust → Access → Applications, add a self-hosted
application covering the hostname with a policy allowing only your email
addresses. Unauthenticated traffic then never reaches this machine.

One caveat: an Access policy that covers the whole hostname will also block
non-browser callers. If you need GitHub webhooks or external MCP access, either
bypass `/api/webhooks` in the policy or issue a service token for those paths.

### Known limits

- Cloudflare's proxy times out around 100 seconds. Long Atlas operations already
  run in the background with polling, so this should not bite, but any new
  synchronous long request will surface as a 524.
- `TRUST_PROXY_HOPS` stays at `1`. nginx resolves the real visitor and forwards
  exactly one address, so the API still sees a single hop.
- Do not route Postgres through the tunnel. It is bound to localhost on purpose.

---

## Roadmap (confirmed)

| Sprint | Status | Scope |
|--------|--------|-------|
| **Sprint 1** | ✅ Done | Overview + metrics + Docker |
| **Sprint 1b** | ✅ Done | MCP server + Cursor skill for agent coordination |
| **Sprint 2** | ✅ Done | Telegram (Done/overdue/urgent), Email daily digest (Gmail API + SMTP) |
| **Sprint 3** | ✅ Done | GitHub link + auto-create issues |
| **Sprint 4** | ✅ Done | Labels, filters, export |

---

## MCP + Cursor Skill (Agent Coordination)

Agents can read and update project status via the **Mission Control MCP server**.

### Setup

```bash
# 1. Start the dashboard
docker compose up -d

# 2. Install MCP dependencies (once)
npm install --prefix mcp

# 3. Restart Cursor to load .cursor/mcp.json
```

MCP config: `.cursor/mcp.json` (Linux/macOS bash launchers)  
Windows MCP config: `.cursor/mcp.windows.json` (PowerShell launchers — copy over `mcp.json` on Windows)  
Skill: `.cursor/skills/mission-control/SKILL.md`

### MCP Tools

| Tool | Purpose |
|------|---------|
| `health_check` | Verify API is up |
| `get_status_report` | Markdown standup/coordination report |
| `get_overview` | Full metrics JSON |
| `list_projects` / `get_board` | Discover projects and tasks |
| `create_task` / `move_task` / `complete_task` | Update work items |
| `create_project` | Add new project |

### Example agent workflow

1. `health_check`
2. `get_status_report` → share standup with team
3. `create_task` → log new work in Backlog
4. `complete_task` → mark finished when done

---

## Environment Variables

See `.env.example` for all options. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Enable API auth when set (HS256 JWT) |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | Seed the first admin account; later users are managed in the Users tab |
| `AUTH_API_TOKEN` | Static bearer token for MCP and automation (full access) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram push notifications (Sprint 2) |
| `GOOGLE_*` / `EMAIL_*` | Gmail API or SMTP daily digest (Sprint 2) |
| `GITHUB_TOKEN` | GitHub API token (Sprint 3) |
| `GITHUB_DEFAULT_REPO` | Default `owner/repo` for auto-created issues |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature secret (Sprint 3) |
| `GITHUB_AUTO_CREATE` | Auto-create issues on new tasks (default `true`) |
| `MISSION_CONTROL_PUBLIC_URL` | Dashboard URL embedded in GitHub issue bodies |

---

## License

ISC
