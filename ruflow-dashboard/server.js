// ---------------------------------------------------------------------------
// Ruflo Command — standalone dashboard app.
//
// Serves the dashboard UI and proxies /api/* to the ruflow-ui backend so the
// memory store stays the single source of truth (no data duplication, no CORS).
// ---------------------------------------------------------------------------

const express = require('express');
const path = require('path');

const PORT = process.env.DASHBOARD_PORT || 3002;
const BACKEND = process.env.RUFLOW_UI_URL || 'http://localhost:3001';
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

app.listen(PORT, () => {
  console.log(`[ruflo-command] dashboard on :${PORT} → backend ${BACKEND}`);
});
