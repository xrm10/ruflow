// ---------------------------------------------------------------------------
// Ruflo Command — standalone dashboard app.
//
// Serves the dashboard UI and proxies both HTTP (/api/*) and the WebSocket
// through to the ruflow-ui backend, so everything reaches the browser over a
// single origin. This is what lets the dashboard be hosted behind one public
// URL (a tunnel or reverse proxy) — the memory store stays the single source
// of truth (no data duplication, no CORS).
//
// Optional auth gate (the whole public surface): set DASHBOARD_PASSWORD and a
// signed httpOnly session cookie is required for the UI, the /api proxy, and
// the WebSocket. Unset ⇒ auth is off (local dev) with a loud warning.
// ---------------------------------------------------------------------------

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.DASHBOARD_PORT || 3002;
const BACKEND = process.env.RUFLOW_UI_URL || 'http://localhost:3001';
const BACKEND_WS = BACKEND.replace(/^http/, 'ws');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- Auth config -----------------------------------------------------------
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const AUTH_ENABLED = PASSWORD.length > 0;
// Random per-boot secret unless one is pinned (pin it to keep sessions across
// restarts). Sessions signed with a rotated secret simply require re-login.
const SECRET = process.env.DASHBOARD_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'ruflo_session';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000; // 7 days

function sign(val) { return crypto.createHmac('sha256', SECRET).update(val).digest('hex'); }
function makeToken() { const iat = Date.now().toString(); return iat + '.' + sign(iat); }

function validToken(tok) {
  if (!tok) return false;
  const i = tok.lastIndexOf('.');
  if (i < 0) return false;
  const iat = tok.slice(0, i);
  const sig = Buffer.from(tok.slice(i + 1));
  const expect = Buffer.from(sign(iat));
  if (sig.length !== expect.length || !crypto.timingSafeEqual(sig, expect)) return false;
  const ts = parseInt(iat, 10);
  return !!ts && (Date.now() - ts) <= MAX_AGE_MS;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  return validToken(parseCookies(req.headers.cookie)[COOKIE]);
}

function checkPassword(pw) {
  if (!AUTH_ENABLED || typeof pw !== 'string') return false;
  const a = Buffer.from(pw);
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const app = express();

// --- Public auth routes (reachable without a session) ----------------------
app.get('/auth/status', (req, res) => res.json({ authEnabled: AUTH_ENABLED, authed: isAuthed(req) }));

app.get('/login', (req, res) => {
  if (isAuthed(req)) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// Small delay on every attempt blunts brute-forcing a single password.
app.post('/auth/login', express.json(), express.urlencoded({ extended: false }), (req, res) => {
  setTimeout(() => {
    if (checkPassword(req.body && req.body.password)) {
      const secure = String(req.headers['x-forwarded-proto'] || '').includes('https');
      res.setHeader('Set-Cookie',
        `${COOKIE}=${makeToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_MS / 1000}${secure ? '; Secure' : ''}`);
      return res.json({ ok: true });
    }
    res.status(401).json({ error: 'invalid password' });
  }, 400);
});

app.post('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// --- Gate: everything below requires a session (when auth is enabled) -------
app.use((req, res, next) => {
  if (isAuthed(req)) return next();
  if (req.path.startsWith('/api')) return res.status(401).json({ error: 'unauthorized' });
  res.redirect('/login');
});

// Proxy every /api/* call through to the ruflow-ui backend. We buffer the body
// (payloads here are small JSON) and forward method, path, query, and headers.
app.use('/api', async (req, res) => {
  const target = BACKEND + req.originalUrl;
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers: { 'content-type': req.headers['content-type'] || 'application/json' },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      });
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
      res.send(text);
    } catch (err) {
      res.status(502).json({ error: 'backend unreachable', detail: err.message, backend: BACKEND });
    }
  });
  req.on('error', () => res.status(400).json({ error: 'bad request' }));
});

app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);

// Proxy the WebSocket (browser ⇄ dashboard ⇄ ruflow-ui). The session cookie
// rides the upgrade request, so verifyClient gates it the same as HTTP. Each
// browser socket gets its own upstream socket to the backend; frames piped.
const wss = new WebSocket.Server({
  server,
  verifyClient: (info, cb) => (isAuthed(info.req) ? cb(true) : cb(false, 401, 'Unauthorized')),
});
wss.on('connection', (client) => {
  const upstream = new WebSocket(BACKEND_WS);
  const queue = [];
  let open = false;
  upstream.on('open', () => { open = true; queue.forEach((m) => upstream.send(m)); queue.length = 0; });
  upstream.on('message', (data) => { if (client.readyState === WebSocket.OPEN) client.send(data.toString()); });
  upstream.on('close', () => { try { client.close(); } catch (_) {} });
  upstream.on('error', () => { try { client.close(); } catch (_) {} });
  client.on('message', (data) => { const m = data.toString(); if (open) upstream.send(m); else queue.push(m); });
  client.on('close', () => { try { upstream.close(); } catch (_) {} });
  client.on('error', () => { try { upstream.close(); } catch (_) {} });
});

server.listen(PORT, () => {
  console.log(`[ruflo-command] dashboard on :${PORT} → backend ${BACKEND} (HTTP + WebSocket proxied)`);
  console.log(AUTH_ENABLED
    ? '[ruflo-command] auth: ENABLED (password required)'
    : '[ruflo-command] auth: DISABLED — set DASHBOARD_PASSWORD before exposing this publicly');
});
