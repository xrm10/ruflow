// ---------------------------------------------------------------------------
// Ruflo Command — standalone dashboard app.
//
// Serves the dashboard UI and proxies both HTTP (/api/*) and the WebSocket
// through to the ruflow-ui backend, so everything reaches the browser over a
// single origin. This is what lets the dashboard be hosted behind one public
// URL (a tunnel or reverse proxy) — the memory store stays the single source
// of truth (no data duplication, no CORS).
// ---------------------------------------------------------------------------

const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.DASHBOARD_PORT || 3002;
const BACKEND = process.env.RUFLOW_UI_URL || 'http://localhost:3001';
const BACKEND_WS = BACKEND.replace(/^http/, 'ws');
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();

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

// Proxy the WebSocket (browser ⇄ dashboard ⇄ ruflow-ui). Each browser socket
// gets its own upstream socket to the backend; frames are piped both ways.
const wss = new WebSocket.Server({ server });
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
});
