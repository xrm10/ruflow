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
