// Tsugi · Pins, each list's remembered sort, and custom lists in one click.
'use strict';

/* ------------------------------------------------------------------ */
/* Pins                                                                */
/* ------------------------------------------------------------------ */
// A pin is stored in AniList's own priority field, above every ordinary priority
// (95 to 99, top pin 99), so pinned titles are on top in other apps too. Each list
// (Planning, Watching, ...) holds up to 5. Planning's pins are your Up Next.

function pinsIn(status) {
  if (!S.data) return [];
  const out = [];
  for (const e of S.data.entries.values()) if (e.status === status && isPinned(e)) out.push(e);
  return out.sort((a, b) => b.priority - a.priority || titleCompare(a.title, b.title));
}

const pinRank = (e) => pinsIn(e.status).indexOf(e) + 1;

// The priority a title goes back to when it's unpinned: the one it had before.
function unpinnedPriority(e) {
  const prev = Number(S.pinPrev[e.mediaId]);
  return Number.isFinite(prev) ? clamp(prev, 0, MAX_PRIORITY) : 0;
}

// A pin belongs to the status list it was pinned in (it's AniList's priority field, which goes
// with the title). A title moving to another status leaves the pins and gets back the priority it
// had before; without this, a title pinned in Reading showed up as "Pinned, #1 in Paused" once
// paused (0.6.9.1). Returns the priority to save with that change, or null.
function pinLeaving(e, nextStatus, patch = {}) {
  if (!e || !isPinned(e) || patch.priority != null || !nextStatus || nextStatus === e.status) return null;
  return unpinnedPriority(e);
}

let pinPrevTimer = 0;
function setPinPrev(mediaId, value) {
  const next = { ...S.pinPrev };
  if (value == null) delete next[mediaId]; else next[mediaId] = value;
  S.pinPrev = next;
  clearTimeout(pinPrevTimer);
  pinPrevTimer = setTimeout(() => store.set('sync', 'pinPrev', S.pinPrev), 250);
}

// Gives `order` the pin slots 99, 98, ... and returns the changes to save.
function pinSlots(order) {
  return order.map((x, i) => ({ id: x.mediaId, entryId: x.id, from: x.priority, to: PIN_TOP - i })).filter((c) => c.from !== c.to);
}

function undoPins(changes, after) {
  return {
    label: 'Undo',
    run: async () => {
      if (await commitChanges(changes.map((c) => ({ ...c, from: c.to, to: c.from })))) { if (after) after(); toast('Undone'); }
    },
  };
}

async function pinTitle(mediaId) {
  const e = entryOf(mediaId);
  if (!e || !canEdit() || isPinned(e) || !statusPrioOn(e.status) || S.busy.has(mediaId)) return;
  const pins = pinsIn(e.status);
  if (pins.length >= PIN_LIMIT) {
    toast(`You can pin up to ${PIN_LIMIT} titles in ${statusLabel(e.status)}. Unpin one first.`, 'error');
    return;
  }
  const prev = e.priority || 0;
  const changes = pinSlots([...pins, e]);
  setPinPrev(mediaId, prev);
  if (await commitChanges(changes)) {
    const where = e.status === 'PLANNING' ? 'Up Next' : `the top of ${statusLabel(e.status)}`;
    toast(`${e.title} pinned to ${where}`, 'ok', undoPins(changes, () => setPinPrev(mediaId, null)), 0, e);
  }
}

async function unpinTitle(mediaId) {
  const e = entryOf(mediaId);
  if (!e || !canEdit() || !isPinned(e) || S.busy.has(mediaId)) return;
  const prev = S.pinPrev[mediaId];
  const changes = [{ id: mediaId, entryId: e.id, from: e.priority, to: unpinnedPriority(e) }];
  if (await commitChanges(changes)) {
    setPinPrev(mediaId, null);
    toast(`${e.title} unpinned`, 'ok', undoPins(changes, () => setPinPrev(mediaId, prev != null ? prev : 0)), 0, e);
  }
}

// Moves a pin one place up (-1) or down (+1) by swapping slots.
async function movePin(mediaId, dir) {
  const e = entryOf(mediaId);
  if (!e || !canEdit() || !isPinned(e)) return;
  const pins = pinsIn(e.status);
  const i = pins.indexOf(e), j = i + dir;
  if (i < 0 || j < 0 || j >= pins.length) return;
  [pins[i], pins[j]] = [pins[j], pins[i]];
  const changes = pinSlots(pins);
  if (changes.length) await commitChanges(changes);
}

/* ------------------------------------------------------------------ */
/* Priorities, list by list                                            */
/* ------------------------------------------------------------------ */
// Status lists (Planning, Watching, Paused, ...) use AniList's own priority field, which holds one
// priority per title (so it shows in other apps too). Custom lists keep their own priorities and
// pins, saved by the extension in sync storage under "cprio:" + the list's key:
// { p: { mediaId: priority }, prev: { mediaId: the priority before it was pinned }, t }. So a pin
// in To Rewatch never touches Completed, and the other way round. A custom list starts from the
// AniList priorities its titles had (once, the first time it's used).
// Each list's menu has a Priorities switch ("pr" in its "sorts" entry): on by default, except for
// Completed and Dropped. Below, a list is given by its key; '' means AniList's field (the hub).

const CP = { lists: {}, timers: {} };
const CP_PREFIX = 'cprio:';

function normalizeCustomPrio(raw) {
  const r = objectOr(raw);
  const nums = (o) => {
    const out = {};
    for (const [k, v] of Object.entries(objectOr(o))) { const n = Number(v); if (Number.isFinite(n) && n > 0) out[k] = clamp(Math.round(n), 0, PIN_TOP); }
    return out;
  };
  return { p: nums(r.p), prev: nums(r.prev), t: Number(r.t) || 0 };
}

// Reads every custom list's priorities (sync storage, or local for a list too big for sync).
async function loadCustomPrio() {
  const all = {};
  for (const area of ['sync', 'local']) {
    let items = {};
    try { items = await chrome.storage[area].get(null); } catch { items = {}; }
    for (const [k, v] of Object.entries(items || {})) {
      if (!k.startsWith(CP_PREFIX)) continue;
      const st = normalizeCustomPrio(v);
      const key = k.slice(CP_PREFIX.length);
      if (!all[key] || st.t > all[key].t) all[key] = st;
    }
  }
  CP.lists = all;
}

function saveCustomPrio(key, now = false) {
  clearTimeout(CP.timers[key]);
  const run = () => {
    delete CP.timers[key];
    const st = CP.lists[key];
    if (!st) return;
    st.t = Date.now();
    const value = { p: st.p, prev: st.prev, t: st.t };
    // Sync storage holds 8 KB per item: a very long list goes to this computer's storage instead.
    store.set(JSON.stringify(value).length > 7800 ? 'local' : 'sync', CP_PREFIX + key, value);
  };
  if (now) run(); else CP.timers[key] = setTimeout(run, 300);
}
function flushCustomPrio() { for (const key of Object.keys(CP.timers)) saveCustomPrio(key, true); }

// Changed on another computer or in another tab.
function onCustomPrioStorage(name, value) {
  const key = name.slice(CP_PREFIX.length);
  const st = normalizeCustomPrio(value);
  if (CP.lists[key] && st.t && st.t < CP.lists[key].t) return;
  CP.lists[key] = st;
  if (S.route) { scheduleRefresh(); scheduleResort(); renderBar(); }
}

function listMeta(key) {
  if (!key || !S.data || !S.route) return null;
  return S.data.lists.find((l) => keyFor(S.route.type, l.name) === key) || null;
}
const listName = (key) => (listMeta(key) || {}).name || 'this list';

// Does this list use priorities? (Its menu's switch; by default, all but Completed and Dropped.)
function prioOn(key) {
  if (!key) return true;
  const m = objectOr(S.sorts[key]);
  if (typeof m.pr === 'boolean') return m.pr;
  if (S.settings.prioFinished) return true;
  const l = listMeta(key);
  if (l) return l.custom || !FINISHED.includes(l.status);
  return !/^[^/]*\/(completed|dropped)\b/.test(key);
}

function setPrioOn(key, on) {
  if (!key) return;
  S.sorts = { ...S.sorts, [key]: { ...objectOr(S.sorts[key]), pr: !!on } };
  store.set('sync', 'sorts', S.sorts);
}

// The key of a status's own list (Planning, Completed, ...), for the hub and the popup.
function statusKey(status) {
  const type = S.route ? S.route.type : 'ANIME';
  const l = S.data && S.data.lists.find((x) => !x.custom && x.status === status);
  return keyFor(type, l ? l.name : (LABELS[type] || LABELS.ANIME)[status]);
}
const statusPrioOn = (status) => prioOn(statusKey(status));

// A custom list's own priorities, or null where AniList's field is used (status lists, and
// lists that aren't yours). Made the first time from the AniList priorities its titles had.
function customStore(key) {
  const l = listMeta(key);
  if (!l || !l.custom || !canEdit()) return null;
  let st = CP.lists[key];
  if (!st) {
    st = { p: {}, prev: {}, t: 0 };
    for (const id of l.ids) {
      const e = S.data.entries.get(id);
      if (e && e.priority > 0) st.p[id] = e.priority;
    }
    // At most 5 pins: any more go back to the priority they had before being pinned.
    const pins = Object.keys(st.p).filter((id) => st.p[id] >= PIN_MIN).sort((a, b) => st.p[b] - st.p[a]);
    pins.forEach((id, i) => {
      if (i < PIN_LIMIT) { if (S.pinPrev[id] != null) st.prev[id] = clamp(Number(S.pinPrev[id]) || 0, 0, MAX_PRIORITY); }
      else { const back = clamp(Number(S.pinPrev[id]) || 0, 0, MAX_PRIORITY); if (back) st.p[id] = back; else delete st.p[id]; }
    });
    CP.lists[key] = st;
    saveCustomPrio(key);
  }
  return st;
}

// A title's priority in a list.
function prioIn(e, key) {
  if (!e) return 0;
  const st = customStore(key);
  return st ? Number(st.p[e.mediaId]) || 0 : e.priority || 0;
}
const pinnedIn = (e, key) => prioIn(e, key) >= PIN_MIN;

// The pinned titles of a list (top pin first). For AniList's field: the title's status list.
function pinsInList(key, e) {
  const st = customStore(key);
  if (!st) return e ? pinsIn(e.status) : [];
  const out = [];
  for (const id of listMeta(key).ids) {
    const x = S.data.entries.get(id);
    if (x && (Number(st.p[id]) || 0) >= PIN_MIN && !out.includes(x)) out.push(x);
  }
  return out.sort((a, b) => st.p[b.mediaId] - st.p[a.mediaId] || titleCompare(a.title, b.title));
}
const pinRankIn = (e, key) => pinsInList(key, e).indexOf(e) + 1;

// The highest ordinary priority in a list (for the badge's three bars).
function maxPrioIn(key) {
  // During a pass over the page (decoratePage), once per list rather than once per badge: it reads the whole list.
  if (decorMemo) {
    const k = `max:${key}`;
    if (!decorMemo.has(k)) decorMemo.set(k, maxPrioUncached(key));
    return decorMemo.get(k);
  }
  return maxPrioUncached(key);
}
function maxPrioUncached(key) {
  const st = customStore(key);
  if (!st) return maxPriority();
  let m = 0;
  for (const id of listMeta(key).ids) { const v = Number(st.p[id]) || 0; if (v > m && v < PIN_MIN) m = v; }
  return m;
}

function refreshPrio() { scheduleRefresh(); scheduleResort(); renderBar(); }
const customSnapshot = (key) => ({ p: { ...CP.lists[key].p }, prev: { ...CP.lists[key].prev } });
function restoreCustom(key, snap) {
  CP.lists[key] = { p: { ...snap.p }, prev: { ...snap.prev }, t: Date.now() };
  saveCustomPrio(key);
  refreshPrio();
}
const undoCustom = (key, snap) => ({ label: 'Undo', run: () => { restoreCustom(key, snap); toast('Undone'); } });

// Sets a title's priority in a list (a custom list's own, or AniList's).
function setPrioIn(key, mediaId, value, opts = {}) {
  const st = customStore(key);
  if (!st) { setPriority(mediaId, value, opts); return; }
  const e = entryOf(mediaId);
  if (!e || !canEdit()) return;
  value = clamp(Math.round(Number(value)) || 0, 0, MAX_PRIORITY);
  if ((Number(st.p[mediaId]) || 0) !== value) {
    if (value) st.p[mediaId] = value; else delete st.p[mediaId];
    delete st.prev[mediaId];
    saveCustomPrio(key);
    S.flash.add(mediaId);
    setStates([mediaId], 'saved');
    scheduleResort();
  }
  if (opts.notify) toast(value > 0 ? `${e.title}: priority ${value} in ${listName(key)}` : `${e.title}: priority removed in ${listName(key)}`);
}

function bumpIn(key, mediaId, delta) {
  const e = entryOf(mediaId);
  if (!e || pinnedIn(e, key)) return;
  setPrioIn(key, mediaId, prioIn(e, key) + delta);
}

function pinIn(key, mediaId) {
  const st = customStore(key);
  if (!st) { pinTitle(mediaId); return; }
  const e = entryOf(mediaId);
  if (!e || !canEdit() || !prioOn(key) || pinnedIn(e, key)) return;
  const pins = pinsInList(key, e);
  if (pins.length >= PIN_LIMIT) {
    toast(`You can pin up to ${PIN_LIMIT} titles in ${listName(key)}. Unpin one first.`, 'error');
    return;
  }
  const snap = customSnapshot(key);
  st.prev[mediaId] = clamp(Number(st.p[mediaId]) || 0, 0, MAX_PRIORITY);
  [...pins, e].forEach((x, i) => { st.p[x.mediaId] = PIN_TOP - i; });
  saveCustomPrio(key);
  S.flash.add(mediaId);
  setStates([mediaId], 'saved');
  refreshPrio();
  toast(`${e.title} pinned to the top of ${listName(key)}`, 'ok', undoCustom(key, snap), 0, e);
}

function unpinIn(key, mediaId) {
  const st = customStore(key);
  if (!st) { unpinTitle(mediaId); return; }
  const e = entryOf(mediaId);
  if (!e || !canEdit() || !pinnedIn(e, key)) return;
  const snap = customSnapshot(key);
  const back = clamp(Number(st.prev[mediaId]) || 0, 0, MAX_PRIORITY);
  if (back) st.p[mediaId] = back; else delete st.p[mediaId];
  delete st.prev[mediaId];
  saveCustomPrio(key);
  setStates([mediaId], 'saved');
  refreshPrio();
  toast(`${e.title} unpinned`, 'ok', undoCustom(key, snap), 0, e);
}

function movePinIn(key, mediaId, dir) {
  const st = customStore(key);
  if (!st) { movePin(mediaId, dir); return; }
  const e = entryOf(mediaId);
  const pins = pinsInList(key, e);
  const i = pins.indexOf(e), j = i + dir;
  if (i < 0 || j < 0 || j >= pins.length) return;
  [pins[i], pins[j]] = [pins[j], pins[i]];
  pins.forEach((x, k) => { st.p[x.mediaId] = PIN_TOP - k; });
  saveCustomPrio(key);
  refreshPrio();
}

// The selection bar's priority buttons, on a custom list's own page.
function bulkApplyCustom(key, fn, describe, relative) {
  const st = customStore(key);
  if (!st) return;
  const snap = customSnapshot(key);
  let n = 0, pinned = 0;
  for (const id of S.selected) {
    const e = S.data.entries.get(id);
    if (!e) continue;
    const v = Number(st.p[id]) || 0;
    if (relative && v >= PIN_MIN) { pinned++; continue; }
    const to = clamp(Math.round(fn({ ...e, priority: v })) || 0, 0, MAX_PRIORITY);
    if (to === v) continue;
    if (to) st.p[id] = to; else delete st.p[id];
    delete st.prev[id];
    S.flash.add(id);
    n++;
  }
  if (!n) { toast(pinned ? 'Pinned titles keep their place. Unpin them first.' : 'Those titles already have that priority'); return; }
  saveCustomPrio(key);
  setStates([...S.selected], 'saved');
  refreshPrio();
  toast(describe(n), 'ok', undoCustom(key, snap));
}

/* ------------------------------------------------------------------ */
/* Each list's sort, remembered                                        */
/* ------------------------------------------------------------------ */
// Each list (Watching, Planning, Completed, a custom list, ...) keeps its own sort and group,
// in sync storage "sorts", keyed like "ANIME/planning": { by, dir, grp }. It's used wherever
// the list shows: on its own page and as a section of "All", which has no sort of its own.
// by: 'al' (AniList's own order), 'prio', or one of SORTS (views.js). Not set: the old
// all-pages setting (sortPage) decides between 'prio' and 'al'.

const keyFor = (type, name) => `${type}/${String(name || '').trim().toLowerCase()}`;
const listKey = (r = S.route) => (r ? keyFor(r.type, r.list) : null);

// A list's sort and group. Older versions stored { prio: true/false }.
function arrangementOf(key) {
  const m = objectOr(S.sorts[key]);
  let by = typeof m.by === 'string' && (m.by === 'al' || m.by === 'prio' || m.by in SORTS) ? m.by : '';
  if (!by && typeof m.prio === 'boolean') by = m.prio ? 'prio' : 'al';
  if (!by) by = S.settings.sortPage ? 'prio' : 'al';
  if (by === 'length' && !key.startsWith('ANIME/')) by = 'al';
  if (by === 'prio' && !prioOn(key)) by = 'al';
  // Sorts switched off (0.12.5): AniList's own order, or the priority sort the hub's button sets.
  if (S.settings.listSorts === false) return { by: by === 'prio' ? 'prio' : 'al', dir: '', grp: '' };
  return {
    by,
    dir: ['asc', 'desc'].includes(m.dir) ? m.dir : '',
    grp: LV_GROUPS.includes(m.grp) ? m.grp : '',
  };
}

function setArrangement(key, patch) {
  if (!key) return;
  const next = { ...arrangementOf(key), ...patch };
  const out = { by: next.by };
  if (next.dir) out.dir = next.dir;
  if (next.grp) out.grp = next.grp;
  const pr = objectOr(S.sorts[key]).pr;
  if (typeof pr === 'boolean') out.pr = pr;
  S.sorts = { ...S.sorts, [key]: out };
  store.set('sync', 'sorts', S.sorts); // right away: you may open another list the next moment
}

// The lists shown on this page, as keys (one on a list's own page, several on "All").
function pageListKeys() {
  const r = S.route;
  if (!r) return [];
  if (r.list || !S.data) return [listKey()];
  const keys = [];
  for (const l of S.data.lists) {
    if (!l.ids.length) continue;
    const k = keyFor(r.type, l.name);
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

// Is this page sorted by priority? (On "All": every list on it that uses priorities.)
function sortOn() {
  const keys = pageListKeys().filter(prioOn);
  return keys.length > 0 && keys.every((k) => arrangementOf(k).by === 'prio');
}

// AniList's Sort menu (an Element UI select in the filters column): only read, to name "AniList's order".
const AL_SORT_NAMES = ['Score', 'Title', 'Last Updated', 'Last Added', 'Start Date', 'Completed Date', 'Release Date',
  'Average Score', 'Popularity', 'Progress', 'Priority'];

function aniListSortSelect() {
  const scope = document.querySelector('.filters-wrap') || document.querySelector('.filters') || document.body;
  for (const sel of scope.querySelectorAll('.el-select')) {
    if (sel.closest('.apq-ui')) continue;
    const input = sel.querySelector('input');
    if (!input) continue;
    const value = (input.value || '').trim();
    const ph = (input.getAttribute('placeholder') || '').trim();
    const head = sel.previousElementSibling;
    const headText = head && head.children.length === 0 ? head.textContent.trim() : '';
    if (/^sort/i.test(ph) || /^sort$/i.test(headText) || AL_SORT_NAMES.includes(value)) return { sel, input };
  }
  return null;
}
const aniListSortValue = () => { const s = aniListSortSelect(); return s ? (s.input.value || '').trim() : ''; };

/* ------------------------------------------------------------------ */
/* Custom lists: in the popover                                        */
/* ------------------------------------------------------------------ */

function customListsControl(mediaId) {
  const wrap = h('div', { class: 'apq-clists', role: 'group', 'aria-label': 'Custom lists' });
  wrap._update = () => {
    const e = entryOf(mediaId);
    const on = new Set(e ? e.customLists : []);
    const busy = S.busy.has(mediaId);
    const sig = customListNames().map((n) => `${n}:${on.has(n)}`).join('|') + busy;
    if (wrap.dataset.sig === sig) return;
    wrap.dataset.sig = sig;
    wrap.replaceChildren(...customListNames().map((n) => h('button', {
      type: 'button', class: 'apq-clist' + (on.has(n) ? ' is-on' : ''), 'aria-pressed': String(on.has(n)), disabled: busy,
      title: on.has(n) ? `Remove from ${n}` : `Add to ${n}`,
      onclick: () => toggleCustomList(mediaId, n),
    }, icon(on.has(n) ? 'check' : 'plus'), h('span', {}, n))));
  };
  wrap._update();
  return wrap;
}

async function toggleCustomList(mediaId, name) {
  const e = entryOf(mediaId);
  if (!e || !canEdit() || S.busy.has(mediaId)) return;
  const before = [...e.customLists];
  const had = before.includes(name);
  const want = new Set(before);
  if (had) want.delete(name); else want.add(name);
  const next = customListNames().filter((n) => want.has(n));
  if (await saveFields(e, { customLists: next })) {
    toast(had ? `${e.title} removed from ${name}` : `${e.title} added to ${name}`, 'ok', {
      label: 'Undo',
      run: async () => { if (await saveFields(e, { customLists: before })) toast(`Undone for ${e.title}`, 'ok', null, 0, e); },
    }, 0, e);
  }
}

/* ------------------------------------------------------------------ */
/* On a title's page: this title and your entry, for the palette       */
/* ------------------------------------------------------------------ */
// Tsugi adds nothing of its own under AniList's "Add to List" any more (0.12.7: the Custom lists button
// and the Your history card went). The title and your entry are still read: the palette (Ctrl+K) offers this
// title's quick action with them.
const TITLE_QUERY = `query ($id: Int) {
  Viewer { id name }
  Media(id: $id) {
    id type episodes chapters title { userPreferred }
    mediaListEntry { id status progress repeat priority customLists hiddenFromStatusLists startedAt { year month day } completedAt { year month day } }
  }
}`;
const TP = { route: null, data: null };

function onTitleRoute(r) {
  if (!r) { TP.route = null; TP.data = null; return; }
  if (TP.route && TP.route.id === r.id) return;
  TP.route = r;
  TP.data = null;
  loadTitle(r);
}

// This title's entry, or null when you're not logged in to AniList.
async function fetchTitle(r) {
  const d = await gqlSession(TITLE_QUERY, { id: r.id });
  const v = d && d.Viewer;
  const m = d && d.Media;
  if (!v || !m) return null;
  const le = m.mediaListEntry;
  return {
    type: m.type, title: (m.title && m.title.userPreferred) || 'This title', viewerId: v.id,
    episodes: m.episodes || null, chapters: m.chapters || null,
    entry: le ? titleEntryFrom(le) : null,
  };
}

async function loadTitle(r) {
  let data = null;
  try { data = await fetchTitle(r); } catch { /* not logged in, or AniList is busy */ }
  if (TP.route === r) TP.data = data;
}

// After a change made with AniList's own editor or the palette.
async function refreshTitle() {
  const r = TP.route;
  if (!r) return;
  try {
    const data = await fetchTitle(r);
    if (TP.route === r && data) TP.data = data;
  } catch { /* keep what we have */ }
}

// A title added here (by its mediaId) is private from the start when "Keep new ones private" says so (0.12.3,
// content/privacy.js keepNewFor); Tsugi notes it made it private.
async function titleSave(args) {
  const hide = await keepNewFor(args);
  if (hide) args = { ...args, private: true };
  const { query, variables } = saveRequest([args]);
  const res = await gqlSession(query, variables);
  const saved = res && res.e0;
  if (!saved) throw new Error('not saved');
  if (hide && saved.private) await nsfwNoteMade([{ id: saved.mediaId || args.mediaId, k: hide }]);
  return saved;
}

async function titleDelete(entryId) {
  const { query, variables } = deleteRequest([entryId]);
  await gqlSession(query, variables);
}

function titleEntryFrom(saved) {
  return {
    id: saved.id, status: saved.status, progress: saved.progress || 0, repeat: saved.repeat || 0, priority: saved.priority || 0,
    customLists: parseCustomLists(saved.customLists), hidden: !!saved.hiddenFromStatusLists,
    startedAt: fuzzy(saved.startedAt), completedAt: fuzzy(saved.completedAt),
  };
}

