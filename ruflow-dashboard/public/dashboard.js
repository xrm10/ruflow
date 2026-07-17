/* Ruflo Command — Memory Manager.
   Talks to /api/memory* (proxied to the ruflow-ui backend). Vanilla JS, no deps. */

'use strict';

const $ = (sel) => document.querySelector(sel);
const el = {
  total: $('#stat-total'), sources: $('#stat-sources'), tags: $('#stat-tags'), vector: $('#stat-vector'),
  search: $('#search'), sourceFilter: $('#source-filter'),
  addToggle: $('#add-toggle'), addForm: $('#add-form'), addCancel: $('#add-cancel'),
  fKey: $('#f-key'), fValue: $('#f-value'), fTags: $('#f-tags'),
  list: $('#mem-list'), empty: $('#empty'), emptyText: $('#empty-text'),
  refresh: $('#refresh-btn'), toast: $('#toast'),
  dot: $('#backend-dot'), backendLabel: $('#backend-label'),
  overlay: $('#confirm-overlay'), confirmKey: $('#confirm-key'),
  confirmCancel: $('#confirm-cancel'), confirmDelete: $('#confirm-delete'),
  cardTpl: $('#card-tpl'),
};

let allEntries = [];      // full list currently loaded
let pendingDelete = null; // id awaiting delete confirmation

// ---------- helpers ----------
async function api(path, opts) {
  const res = await fetch('/api' + path, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg, isErr) {
  el.toast.textContent = msg;
  el.toast.classList.toggle('err', !!isErr);
  el.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('show'), 2600);
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- rendering ----------
function render(entries) {
  el.list.innerHTML = '';
  if (!entries.length) {
    el.empty.hidden = false;
    el.emptyText.textContent = (el.search.value || el.sourceFilter.value)
      ? 'No memories match your filters.'
      : 'No memories yet. Add one to get started.';
    return;
  }
  el.empty.hidden = true;
  const frag = document.createDocumentFragment();
  for (const e of entries) {
    const node = el.cardTpl.content.cloneNode(true);
    node.querySelector('.card-key').textContent = e.key;
    const src = node.querySelector('.card-source');
    src.textContent = e.source || 'unknown';
    src.dataset.source = e.source || 'unknown';
    node.querySelector('.card-value').textContent = e.value || '';
    const tagWrap = node.querySelector('.card-tags');
    for (const t of e.tags || []) {
      const chip = document.createElement('span');
      chip.className = 'chip'; chip.textContent = '#' + t;
      tagWrap.appendChild(chip);
    }
    node.querySelector('.card-time').textContent = timeAgo(e.updatedAt);
    node.querySelector('.card-del').addEventListener('click', () => askDelete(e));
    frag.appendChild(node);
  }
  el.list.appendChild(frag);
}

function renderStats(stats) {
  el.total.textContent = stats.total ?? 0;
  el.sources.textContent = Object.keys(stats.sources || {}).length;
  el.tags.textContent = Object.keys(stats.tags || {}).length;
  el.vector.textContent = stats.vectorDb && stats.vectorDb.available ? 'Live' : 'Off';
  el.vector.style.color = stats.vectorDb && stats.vectorDb.available ? 'var(--accent)' : 'var(--text-faint)';

  // Rebuild source filter, preserving selection
  const cur = el.sourceFilter.value;
  el.sourceFilter.innerHTML = '<option value="">All sources</option>';
  for (const s of Object.keys(stats.sources || {}).sort()) {
    const o = document.createElement('option');
    o.value = s; o.textContent = `${s} (${stats.sources[s]})`;
    el.sourceFilter.appendChild(o);
  }
  el.sourceFilter.value = cur;
}

// ---------- data flow ----------
function currentFilters() {
  return { q: el.search.value.trim(), source: el.sourceFilter.value };
}

async function loadList() {
  const { q, source } = currentFilters();
  try {
    const data = q
      ? await api('/memory?q=' + encodeURIComponent(q) + '&limit=200')
      : await api('/memory?limit=200');
    allEntries = data.results || data.entries || [];
    const filtered = source ? allEntries.filter(e => (e.source || 'unknown') === source) : allEntries;
    render(filtered);
    setBackend(true);
  } catch (err) {
    setBackend(false);
    toast('Load failed: ' + err.message, true);
  }
}

async function loadStats() {
  try {
    renderStats(await api('/memory/stats'));
    setBackend(true);
  } catch (err) {
    setBackend(false);
  }
}

function setBackend(ok) {
  el.dot.className = 'dot ' + (ok ? 'ok' : 'bad');
  el.backendLabel.textContent = ok ? 'backend online' : 'backend offline';
}

async function refresh() { await Promise.all([loadStats(), loadList()]); }

// ---------- add ----------
async function submitAdd(ev) {
  ev.preventDefault();
  const key = el.fKey.value.trim();
  const value = el.fValue.value.trim();
  if (!key || !value) return;
  const tags = el.fTags.value.split(',').map(t => t.trim()).filter(Boolean);
  try {
    await api('/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value, tags }),
    });
    el.addForm.reset();
    el.addForm.hidden = true;
    toast('Memory saved');
    await refresh();
  } catch (err) {
    toast('Save failed: ' + err.message, true);
  }
}

// ---------- delete ----------
function askDelete(entry) {
  pendingDelete = entry.id;
  el.confirmKey.textContent = entry.key;
  el.overlay.hidden = false;
}
function closeConfirm() { pendingDelete = null; el.overlay.hidden = true; }
async function doDelete() {
  if (!pendingDelete) return;
  const id = pendingDelete;
  closeConfirm();
  try {
    await api('/memory/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('Memory deleted');
    await refresh();
  } catch (err) {
    toast('Delete failed: ' + err.message, true);
  }
}

// ---------- wiring ----------
el.search.addEventListener('input', debounce(loadList, 250));
el.sourceFilter.addEventListener('change', loadList);
el.refresh.addEventListener('click', refresh);
el.addToggle.addEventListener('click', () => {
  el.addForm.hidden = !el.addForm.hidden;
  if (!el.addForm.hidden) el.fKey.focus();
});
el.addCancel.addEventListener('click', () => { el.addForm.reset(); el.addForm.hidden = true; });
el.addForm.addEventListener('submit', submitAdd);
el.confirmCancel.addEventListener('click', closeConfirm);
el.confirmDelete.addEventListener('click', doDelete);
el.overlay.addEventListener('click', (e) => { if (e.target === el.overlay) closeConfirm(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeConfirm(); });

refresh();
setInterval(loadStats, 15000); // keep tiles + backend status fresh

// ===================================================================
// View router
// ===================================================================
const views = {
  memory: document.getElementById('view-memory'),
  agents: document.getElementById('view-agents'),
  learning: document.getElementById('view-learning'),
  system: document.getElementById('view-system'),
};
const railItems = document.querySelectorAll('.rail-item[data-view]');
let agentsLoaded = false;
let learningLoaded = false;
let activeView = 'memory';

function showView(name) {
  if (!views[name]) return;
  activeView = name;
  for (const [k, v] of Object.entries(views)) v.hidden = (k !== name);
  railItems.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'agents' && !agentsLoaded) loadAgents();
  if (name === 'learning' && !learningLoaded) loadLearning();
  if (name === 'system') loadSystem();
}
railItems.forEach(b => b.addEventListener('click', () => { if (!b.disabled) showView(b.dataset.view); }));

// ===================================================================
// Agents catalog
// ===================================================================
const ag = {
  total: document.getElementById('ag-total'), cats: document.getElementById('ag-cats'),
  tools: document.getElementById('ag-tools'), shown: document.getElementById('ag-shown'),
  search: document.getElementById('agent-search'), catFilter: document.getElementById('category-filter'),
  list: document.getElementById('agent-list'), empty: document.getElementById('agents-empty'),
  refresh: document.getElementById('agents-refresh'), tpl: document.getElementById('agent-card-tpl'),
  overlay: document.getElementById('agent-overlay'), close: document.getElementById('agent-close'),
  mName: document.getElementById('agent-modal-name'), mCat: document.getElementById('agent-modal-cat'),
  mDesc: document.getElementById('agent-modal-desc'), mTools: document.getElementById('agent-modal-tools'),
  mBody: document.getElementById('agent-modal-body'), toolsLabel: document.getElementById('agent-tools-label'),
  task: document.getElementById('dispatch-task'), cmd: document.getElementById('dispatch-cmd'),
  copy: document.getElementById('copy-cmd'),
};
let allAgents = [];
let currentAgent = null;

async function loadAgents() {
  try {
    const data = await api('/agents');
    allAgents = data.agents || [];
    agentsLoaded = true;
    ag.total.textContent = data.total ?? 0;
    ag.cats.textContent = Object.keys(data.categories || {}).length;
    ag.tools.textContent = data.withTools ?? 0;
    const cur = ag.catFilter.value;
    ag.catFilter.innerHTML = '<option value="">All categories</option>';
    for (const c of Object.keys(data.categories || {}).sort()) {
      const o = document.createElement('option');
      o.value = c; o.textContent = `${c} (${data.categories[c]})`;
      ag.catFilter.appendChild(o);
    }
    ag.catFilter.value = cur;
    renderAgents();
  } catch (err) {
    toast('Agents load failed: ' + err.message, true);
  }
}

function filteredAgents() {
  const q = ag.search.value.trim().toLowerCase();
  const cat = ag.catFilter.value;
  return allAgents.filter(a =>
    (!cat || a.category === cat) &&
    (!q || a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q))
  );
}

function renderAgents() {
  const items = filteredAgents();
  ag.shown.textContent = items.length;
  ag.list.innerHTML = '';
  ag.empty.hidden = items.length > 0;
  const frag = document.createDocumentFragment();
  for (const a of items) {
    const node = ag.tpl.content.cloneNode(true);
    node.querySelector('.card-key').textContent = a.name;
    node.querySelector('.agent-cat').textContent = a.category;
    node.querySelector('.agent-card-desc').textContent = a.description || 'No description.';
    node.querySelector('.agent-tool-count').textContent = a.toolCount ? `${a.toolCount} tools` : 'inherits tools';
    node.querySelector('.agent-card').addEventListener('click', () => openAgent(a.name));
    frag.appendChild(node);
  }
  ag.list.appendChild(frag);
}

async function openAgent(name) {
  try {
    const a = await api('/agents/' + encodeURIComponent(name));
    currentAgent = a;
    ag.mName.textContent = a.name;
    ag.mCat.textContent = a.category;
    ag.mDesc.textContent = a.description || 'No description.';
    ag.mTools.innerHTML = '';
    if (a.tools && a.tools.length) {
      for (const t of a.tools) {
        const s = document.createElement('span'); s.className = 'tool-chip'; s.textContent = t;
        ag.mTools.appendChild(s);
      }
      ag.toolsLabel.textContent = `Tools (${a.tools.length})`;
    } else {
      const s = document.createElement('span'); s.className = 'tool-chip none';
      s.textContent = 'Inherits all tools'; ag.mTools.appendChild(s);
      ag.toolsLabel.textContent = 'Tools';
    }
    ag.mBody.textContent = a.body || '(no body)';
    ag.task.value = '';
    updateDispatch();
    ag.overlay.hidden = false;
  } catch (err) {
    toast('Failed to open agent: ' + err.message, true);
  }
}

function updateDispatch() {
  if (!currentAgent) return;
  const task = ag.task.value.trim() || 'Describe the task here';
  const esc = task.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  ag.cmd.textContent = `Task("${currentAgent.name}", "${esc}", "${currentAgent.name}")`;
}

function closeAgent() { ag.overlay.hidden = true; currentAgent = null; }

ag.search.addEventListener('input', debounce(renderAgents, 200));
ag.catFilter.addEventListener('change', renderAgents);
ag.refresh.addEventListener('click', () => { agentsLoaded = false; loadAgents(); });
ag.task.addEventListener('input', updateDispatch);
ag.close.addEventListener('click', closeAgent);
ag.overlay.addEventListener('click', (e) => { if (e.target === ag.overlay) closeAgent(); });
ag.copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(ag.cmd.textContent); toast('Dispatch command copied'); }
  catch (_) { toast('Copy failed — select the text manually', true); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ag.overlay.hidden) closeAgent(); });

// ===================================================================
// Learning
// ===================================================================
const lr = {
  learnings: document.getElementById('lr-learnings'), skills: document.getElementById('lr-skills'),
  errors: document.getElementById('lr-errors'), sessions: document.getElementById('lr-sessions'),
  notice: document.getElementById('lr-notice'),
  learningsList: document.getElementById('lr-learnings-list'),
  errorsList: document.getElementById('lr-errors-list'),
  skillsList: document.getElementById('lr-skills-list'),
  substrate: document.getElementById('lr-substrate'),
  refresh: document.getElementById('learning-refresh'),
};

function parseTags(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (_) { return String(raw).split(',').map(s => s.trim()).filter(Boolean); }
}
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function emptyNote(msg) { return `<div class="empty" style="padding:28px 8px"><p style="margin:0;color:var(--text-faint)">${esc(msg)}</p></div>`; }

async function loadLearning() {
  try {
    const d = await api('/learning');
    learningLoaded = true;
    const s = d.stats || {};
    lr.learnings.textContent = s.learnings ?? 0;
    lr.skills.textContent = s.skillsUsed ?? 0;
    lr.errors.textContent = s.errors ?? 0;
    lr.sessions.textContent = s.sessions ?? 0;

    if (!d.available) {
      lr.notice.hidden = false;
      lr.notice.textContent = '⚠ ' + (d.reason || 'AgentDB not available') + ' — showing memory-store signals only.';
    } else {
      lr.notice.hidden = true;
    }

    // Lessons
    lr.learningsList.innerHTML = (d.learnings && d.learnings.length)
      ? d.learnings.map(l => {
          const tags = parseTags(l.tags).map(t => `<span class="chip">#${esc(t)}</span>`).join('');
          const imp = (l.importance || 'normal').toLowerCase();
          return `<div class="lr-item">
            <div class="lr-item-head">
              <span class="lr-badge">${esc(l.category || 'general')}</span>
              <span class="lr-badge imp-${imp === 'high' ? 'high' : 'normal'}">${esc(l.importance || 'normal')}</span>
              <span class="lr-time">${esc(timeAgo(l.created_at))}</span>
            </div>
            <div class="lr-content">${esc(l.content)}</div>
            ${tags ? `<div class="lr-tags">${tags}</div>` : ''}
          </div>`;
        }).join('')
      : emptyNote('No lessons recorded yet. They accumulate as the assistant works across sessions.');

    // Mistakes → fixes
    lr.errorsList.innerHTML = (d.errors && d.errors.length)
      ? d.errors.map(e => `<div class="lr-item">
          <div class="lr-item-head">
            <span class="lr-badge err">${esc(e.error_type || 'error')}</span>
            <span class="lr-time">${esc(timeAgo(e.created_at))}</span>
          </div>
          <div class="lr-content">${esc(e.error_message)}</div>
          ${e.fix_applied ? `<div class="lr-fix"><b>Fix:</b> ${esc(e.fix_applied)}</div>` : ''}
          ${e.file_path ? `<div class="lr-file">${esc(e.file_path)}</div>` : ''}
        </div>`).join('')
      : emptyNote('No mistakes logged yet.');

    // Skills
    const maxUses = Math.max(1, ...(d.skills || []).map(s2 => s2.uses || 0));
    lr.skillsList.innerHTML = (d.skills && d.skills.length)
      ? d.skills.map(s2 => {
          const pct = Math.round(((s2.uses || 0) / maxUses) * 100);
          const rate = s2.uses ? Math.round(((s2.successes || 0) / s2.uses) * 100) : 0;
          return `<div class="lr-skill">
            <span class="lr-skill-name">${esc(s2.skill_name)}</span>
            <span class="lr-skill-bar"><span class="lr-skill-fill" style="width:${pct}%"></span></span>
            <span class="lr-skill-meta">${s2.uses}× · ${rate}% ok</span>
          </div>`;
        }).join('')
      : emptyNote('No skills applied yet.');

    // Substrate footer
    const r = d.ranked || {};
    const ms = d.memoryStore || {};
    lr.substrate.innerHTML = [
      `<span><b>AgentDB:</b> ${d.available ? (d.dbSizeKb || 0) + ' KB' : 'unavailable'}</span>`,
      `<span><b>Knowledge facts:</b> ${(d.stats && d.stats.knowledge) ?? 0}</span>`,
      `<span><b>Ranked context:</b> ${r.entries ?? 0} entries${r.computedAt ? ' · ' + timeAgo(new Date(r.computedAt).toISOString()) : ''}</span>`,
      `<span><b>Long-term memory:</b> ${ms.total ?? 0} entries (${ms.autoCaptured ?? 0} auto-captured)</span>`,
    ].join('');
  } catch (err) {
    toast('Learning load failed: ' + err.message, true);
  }
}

lr.refresh.addEventListener('click', () => { learningLoaded = false; loadLearning(); });

// ===================================================================
// System
// ===================================================================
const sy = {
  uptime: document.getElementById('sy-uptime'), rss: document.getElementById('sy-rss'),
  sessions: document.getElementById('sy-sessions'), node: document.getElementById('sy-node'),
  agents: document.getElementById('sy-agents'), skills: document.getElementById('sy-skills'),
  memories: document.getElementById('sy-memories'), db: document.getElementById('sy-db'),
  heapFill: document.getElementById('sy-heap-fill'), heapTxt: document.getElementById('sy-heap-txt'),
  memRss: document.getElementById('sy-mem-rss'), memExt: document.getElementById('sy-mem-ext'),
  pid: document.getElementById('sy-pid'), started: document.getElementById('sy-started'),
  services: document.getElementById('sy-services'), refresh: document.getElementById('system-refresh'),
};

function mb(bytes) { return (bytes / 1048576).toFixed(1) + ' MB'; }
function fmtUptime(s) {
  s = Math.floor(s);
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function renderServices(ok) {
  sy.services.innerHTML = [
    { name: 'ruflow-ui backend', meta: ':3001 · memory + agents + learning API', up: ok },
    { name: 'Ruflo Command (this app)', meta: ':3002 · dashboard + API proxy', up: true },
  ].map(s => `<div class="sy-service">
      <span class="dot ${s.up ? 'ok' : 'bad'}"></span>
      <span class="sy-service-name">${s.name}</span>
      <span class="sy-service-meta">${s.meta}</span>
      <span class="sy-service-status ${s.up ? 'up' : 'down'}">${s.up ? 'online' : 'offline'}</span>
    </div>`).join('');
}

async function loadSystem() {
  try {
    const d = await api('/system');
    setBackend(true);
    sy.uptime.textContent = fmtUptime(d.uptime || 0);
    sy.rss.textContent = mb(d.memory.rss);
    sy.sessions.textContent = d.counts.sessions ?? 0;
    sy.node.textContent = d.node || '—';
    sy.agents.textContent = d.counts.agents ?? 0;
    sy.skills.textContent = (d.counts.skills ?? 0).toLocaleString();
    sy.memories.textContent = d.counts.memories ?? 0;
    sy.db.textContent = d.agentDb && d.agentDb.available ? d.agentDb.sizeKb + ' KB' : 'off';
    const pct = d.memory.heapTotal ? Math.round((d.memory.heapUsed / d.memory.heapTotal) * 100) : 0;
    sy.heapFill.style.width = pct + '%';
    sy.heapTxt.textContent = `${mb(d.memory.heapUsed)} / ${mb(d.memory.heapTotal)} (${pct}%)`;
    sy.memRss.textContent = mb(d.memory.rss);
    sy.memExt.textContent = mb(d.memory.external);
    sy.pid.textContent = d.pid ?? '—';
    sy.started.textContent = d.startedAt ? new Date(d.startedAt).toLocaleString() : '—';
    renderServices(true);
  } catch (err) {
    setBackend(false);
    renderServices(false);
    toast('System load failed: ' + err.message, true);
  }
}

sy.refresh.addEventListener('click', loadSystem);
// Live-tick while the System view is open
setInterval(() => { if (activeView === 'system') loadSystem(); }, 5000);
