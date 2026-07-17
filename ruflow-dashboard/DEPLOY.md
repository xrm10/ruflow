# Deploying Ruflo Command

The dashboard is two Node services:

| Service | Port | Role |
|---|---|---|
| `ruflow-ui` | 3001 | Backend API + WebSocket (memory, agents, learning, system, dispatch) |
| `ruflow-dashboard` | 3002 | The dashboard UI. Proxies **both HTTP and WebSocket** to `:3001`. |

Because the dashboard proxies everything, the browser only ever talks to **`:3002`** — so you expose a single port publicly.

## 1. Run locally (one command)

```bash
./scripts/start-dashboard.sh
# open http://localhost:3002
```

This installs deps on first run and starts both services. `Ctrl-C` stops both.

## 2. Open it on your phone (quick tunnel)

For a temporary public URL (testing), tunnel port **3002** only:

```bash
# with cloudflared (no account needed for a quick tunnel)
cloudflared tunnel --url http://localhost:3002

# or with ngrok
ngrok http 3002
```

Open the `https://…` URL it prints on your phone. The WebSocket rides the same
URL automatically (`wss://`), so live dispatch and realtime updates work.

> Only tunnel `:3002`. Do **not** expose `:3001` — it's reached internally by
> the dashboard proxy.

## 3. Host it on a VPS (persistent)

```bash
git clone <this repo> && cd ruflow
# keep both services running with pm2
npm i -g pm2
pm2 start "node server.js" --name ruflow-ui --cwd ./ruflow-ui --env "PORT=3001"
pm2 start "node server.js" --name ruflow-dashboard --cwd ./ruflow-dashboard \
  --env "DASHBOARD_PORT=3002" --env "RUFLOW_UI_URL=http://localhost:3001"
pm2 save
```

Put a reverse proxy in front of `:3002` for TLS + a domain. Nginx example
(note the WebSocket upgrade headers — required for live features):

```nginx
server {
  server_name dashboard.example.com;
  location / {
    proxy_pass http://localhost:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

Then run `certbot --nginx -d dashboard.example.com` for HTTPS.

## Authentication (set this before hosting)

The dashboard has a built-in password gate covering the **whole** public
surface — the UI, the `/api` proxy, and the WebSocket. Enable it by setting one
env var:

```bash
DASHBOARD_PASSWORD='a-long-random-passphrase' ./scripts/start-dashboard.sh
```

- With `DASHBOARD_PASSWORD` set, visitors get a login page; a signed httpOnly
  session cookie (7-day) is then required for everything. There's a **Sign out**
  button in the dashboard footer.
- **Unset ⇒ auth is OFF** (local-dev convenience). The server prints a loud
  warning; do not expose it publicly in this state.
- Optionally pin `DASHBOARD_SESSION_SECRET` to keep sessions valid across
  restarts (otherwise a fresh secret each boot means everyone re-logs-in).

Only `ruflow-dashboard` (`:3002`) enforces auth — keep `ruflow-ui` (`:3001`)
internal (localhost / private network), as it has no auth of its own.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | ruflow-ui backend port |
| `DASHBOARD_PORT` | `3002` | dashboard port (the one you expose) |
| `RUFLOW_UI_URL` | `http://localhost:3001` | where the dashboard finds the backend |
| `DASHBOARD_PASSWORD` | *(unset)* | login password; unset disables auth |
| `DASHBOARD_SESSION_SECRET` | *(random per boot)* | pin to persist sessions across restarts |

## Security note

Set `DASHBOARD_PASSWORD` before exposing the dashboard — the backend can spawn
agents and read/write the repo, so an open instance is remote code execution
for anyone with the URL. Even with auth, prefer HTTPS (a tunnel gives you this
automatically; on a VPS use the nginx + certbot setup above) so the password
and session cookie aren't sent in the clear. A quick-tunnel URL is unguessable
but still public — stop the tunnel when you're done.
