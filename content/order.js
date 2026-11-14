// Tsugi · Your own order inside one priority, set by dragging (the hub's rows, posters on the page).
'use strict';

/* ------------------------------------------------------------------ */
/* Fine order: titles of the same priority, in the order you put them  */
/* ------------------------------------------------------------------ */
// A priority says which titles come first; inside one priority the order was AniList's (on its
// pages) or A to Z (in the hub). Dragging a title among the others of its priority gives that
// priority your own order, kept by the extension for each list (AniList has nowhere to put it):
// sync storage "order:" + the list's key = { o: { priority: [mediaId, ...] }, t } (this computer's
// storage when it's over 8 KB, like "cprio:"). Titles that aren't in it yet come after, in the
// usual order. Pins are different: their order is their slot (99, 98, ...), so dragging a pin
// saves new slots (on AniList for status lists, in "cprio:" for custom lists).
// The same order is used on AniList's page (a list sorted by priority), in the hub and in the
// toolbar popup's Up Next.

const FO = { lists: {}, timers: {} };
const FO_PREFIX = 'order:';

function normalizeFineOrder(raw) {
  const r = objectOr(raw);
  const o = {};
  for (const [p, ids] of Object.entries(objectOr(r.o))) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > MAX_PRIORITY || !Array.isArray(ids)) continue;
    const list = [...new Set(ids.map(Number).filter((x) => Number.isInteger(x) && x > 0))];
    if (list.length) o[n] = list;
  }
  return { o, t: Number(r.t) || 0 };
}

async function loadFineOrder() {
  const all = {};
  for (const area of ['sync', 'local']) {
    let items = {};
    try { items = await chrome.storage[area].get(null); } catch { items = {}; }
    for (const [k, v] of Object.entries(items || {})) {
      if (!k.startsWith(FO_PREFIX)) continue;
      const st = normalizeFineOrder(v);
      const key = k.slice(FO_PREFIX.length);
      if (!all[key] || st.t > all[key].t) all[key] = st;
    }
  }
  FO.lists = all;
}

function saveFineOrder(key) {
  const st = FO.lists[key];
  if (!st) return;
  st.t = Date.now();
  const value = { o: st.o, t: st.t };
  store.set(JSON.stringify(value).length > 7800 ? 'local' : 'sync', FO_PREFIX + key, value);
}

// Changed on another computer, in another tab or in the toolbar popup.
function onFineOrderStorage(name, value) {
  const key = name.slice(FO_PREFIX.length);
  const st = normalizeFineOrder(value);
  if (FO.lists[key] && st.t && st.t < FO.lists[key].t) return;
  FO.lists[key] = st;
  if (!S.route || DR.on) return;
  applyPageSort();
  if (D.drawer && S.drawerOpen) renderDrawerList();
}

const fineBlock = (key, prio) => (FO.lists[key] && FO.lists[key].o[prio]) || [];

// For sorting: (priority, mediaId) -> its place in your order, or a large number when it has none.
function fineRanks(key) {
  const st = FO.lists[key];
  if (!st || !Object.keys(st.o).length) return () => 1e9;
  const maps = {};
  return (prio, id) => {
    if (!st.o[prio]) return 1e9;
    const m = maps[prio] || (maps[prio] = new Map(st.o[prio].map((x, i) => [x, i])));
    const i = m.get(id);
    return i === undefined ? 1e9 : i;
  };
}

function setFineBlock(key, prio, ids) {
  const st = FO.lists[key] || (FO.lists[key] = { o: {}, t: 0 });
  if (ids && ids.length) st.o[prio] = ids.slice(); else delete st.o[prio];
  saveFineOrder(key);
}

// The titles of a list ('ANIME/planning', a custom list) that have this priority there.
function fineMembers(key, prio) {
  const l = listMeta(key);
  if (!l || !S.data) return [];
  const out = [];
  for (const id of l.ids) {
    const e = S.data.entries.get(id);
    if (e && !S.gone.has(id) && prioIn(e, key) === prio && !out.includes(id)) out.push(id);
  }
  return out;
}

// Does this priority have an order of yours (among the titles that still have it)?
function hasFineOrder(key, prio) {
  const block = fineBlock(key, prio);
  if (!block.length) return false;
  const members = new Set(fineMembers(key, prio));
  return block.filter((id) => members.has(id)).length > 1;
}

// A priority's titles in order: yours first, then the rest A to Z (the hub's order).
function fineSorted(key, prio) {
  const rank = fineRanks(key);
  return fineMembers(key, prio).map(entryOf).filter(Boolean)
    .sort((a, b) => rank(prio, a.mediaId) - rank(prio, b.mediaId) || titleCompare(a.title, b.title)).map((e) => e.mediaId);
}

// Puts `id` just before `beforeId` (null: after the last title shown) inside its priority.
// shown: that priority's titles as they were displayed before the move, in order. Titles of your
// order that aren't displayed (filtered out, not loaded on the page yet) keep their places.
function moveInFine(key, prio, shown, id, beforeId) {
  const members = new Set(fineMembers(key, prio));
  members.add(id);
  const stored = fineBlock(key, prio).filter((x) => members.has(x));
  const known = new Set(stored);
  const full = stored.concat(shown.filter((x) => !known.has(x) && members.has(x)));
  const rest = full.filter((x) => x !== id);
  let at = beforeId != null ? rest.indexOf(beforeId) : -1;
  if (at < 0) {
    const last = shown.slice().reverse().find((x) => x !== id && rest.includes(x));
    at = last != null ? rest.indexOf(last) + 1 : rest.length;
  }
  rest.splice(at, 0, id);
  setFineBlock(key, prio, rest);
}

// Saves a new order for a list's pins: slots 99, 98, ... (AniList's field, or a custom list's own).
function reorderPins(key, ids) {
  const pins = ids.map(entryOf).filter(Boolean);
  const st = customStore(key);
  if (st) {
    pins.forEach((x, k) => { st.p[x.mediaId] = PIN_TOP - k; });
    saveCustomPrio(key);
    refreshPrio();
    return;
  }
  const changes = pinSlots(pins);
  if (changes.length) commitChanges(changes);
}

// After a drag (or Alt + arrow): `ids` is the group as it's shown now, `id` the title that moved.
function commitReorder(key, prio, before, ids, id) {
  if (prio >= PIN_MIN) reorderPins(key, ids);
  else {
    moveInFine(key, prio, before, id, ids[ids.indexOf(id) + 1] != null ? ids[ids.indexOf(id) + 1] : null);
    S.flash.add(id);
    setStates([id], 'saved');
  }
  applyPageSort();
  if (D.drawer && S.drawerOpen) renderDrawerList();
}

function resetFineOrder(key, prio, label) {
  const before = fineBlock(key, prio).slice();
  if (!before.length) return;
  setFineBlock(key, prio, []);
  applyPageSort();
  if (D.drawer && S.drawerOpen) renderDrawerList();
  toast(`${label}: your order was cleared`, 'ok', {
    label: 'Undo',
    run: () => { setFineBlock(key, prio, before); applyPageSort(); if (D.drawer && S.drawerOpen) renderDrawerList(); toast('Undone'); },
  });
}

/* ------------------------------------------------------------------ */
/* Dragging                                                            */
/* ------------------------------------------------------------------ */
// One drag at a time. The dragged element follows the pointer; the others of its group (its
// "peers") slide to make room; everything else dims. Dropping calls onDrop with the peers in their
// new order. Esc cancels. Positions are kept in the scroller's own coordinates, so the list can
// scroll under the pointer (it scrolls by itself near the top and bottom edges).

const DR = { on: false, pending: null, clicked: false };
const DRAG_START = 6; // px before a press becomes a drag

// opts: { el, peers: () => [elements in shown order, el among them], scroller: element or null (the page),
//         axis: 'y' | 'xy', root: element that gets data-apq-reorder, onDrop(orderedEls) }
function armReorder(ev, opts) {
  if (DR.on || DR.pending) return;
  if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
  if (ev.pointerType && ev.pointerType === 'touch') return; // a touch scrolls the page; Alt + arrows aren't there either
  DR.pending = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, opts };
  window.addEventListener('pointermove', onReorderMove, true);
  window.addEventListener('pointerup', onReorderUp, true);
  window.addEventListener('pointercancel', onReorderCancel, true);
}

function disarmReorder() {
  DR.pending = null;
  window.removeEventListener('pointermove', onReorderMove, true);
  window.removeEventListener('pointerup', onReorderUp, true);
  window.removeEventListener('pointercancel', onReorderCancel, true);
  window.removeEventListener('keydown', onReorderKey, true);
  window.removeEventListener('scroll', onReorderScroll, true);
  cancelAnimationFrame(DR.raf);
}

const scrollOf = (sc) => (sc ? { x: sc.scrollLeft, y: sc.scrollTop, r: sc.getBoundingClientRect() } : { x: window.scrollX, y: window.scrollY, r: { left: 0, top: 0 } });
// A point of the window, in the scroller's own coordinates.
function inScroller(sc, x, y) {
  const s = scrollOf(sc);
  return { x: x - s.r.left + s.x, y: y - s.r.top + s.y };
}

function startReorder(ev) {
  const { opts } = DR.pending;
  const peers = opts.peers().filter((p) => p.isConnected);
  const from = peers.indexOf(opts.el);
  if (from < 0 || peers.length < 2) { disarmReorder(); return false; }
  closePopover(false);
  hideTip();
  const sc = opts.scroller || null;
  const slots = peers.map((p) => {
    const r = p.getBoundingClientRect();
    const c = inScroller(sc, r.left, r.top);
    return { x: c.x, y: c.y, w: r.width, h: r.height };
  });
  Object.assign(DR, {
    on: true, opts, peers, slots, from, to: from, sc,
    start: inScroller(sc, DR.pending.x, DR.pending.y), last: { x: ev.clientX, y: ev.clientY }, raf: 0,
  });
  DR.pending = null;
  for (const p of peers) p.setAttribute('data-apq-peer', '');
  opts.el.setAttribute('data-apq-drag', '');
  (opts.root || document.documentElement).setAttribute('data-apq-reorder', 'on');
  document.documentElement.classList.add('apq-dragging');
  try { opts.el.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
  window.addEventListener('keydown', onReorderKey, true);
  window.addEventListener('scroll', onReorderScroll, true);
  DR.raf = requestAnimationFrame(reorderEdgeScroll);
  return true;
}

function onReorderMove(ev) {
  if (DR.pending) {
    if (ev.pointerId !== DR.pending.id) return;
    if (Math.hypot(ev.clientX - DR.pending.x, ev.clientY - DR.pending.y) < DRAG_START) return;
    if (!startReorder(ev)) return;
  }
  if (!DR.on) return;
  ev.preventDefault();
  DR.last = { x: ev.clientX, y: ev.clientY };
  paintReorder();
}

function onReorderScroll() { if (DR.on) paintReorder(); }

function paintReorder() {
  const { peers, slots, from, sc, opts } = DR;
  const p = inScroller(sc, DR.last.x, DR.last.y);
  const dx = opts.axis === 'y' ? 0 : p.x - DR.start.x;
  const dy = p.y - DR.start.y;
  // Where the dragged one's centre is now: the nearest place among its peers.
  const cx = slots[from].x + slots[from].w / 2 + dx, cy = slots[from].y + slots[from].h / 2 + dy;
  let to = from, best = Infinity;
  slots.forEach((s, i) => {
    const d = Math.hypot(opts.axis === 'y' ? 0 : s.x + s.w / 2 - cx, s.y + s.h / 2 - cy);
    if (d < best) { best = d; to = i; }
  });
  DR.to = to;
  peers.forEach((el, i) => {
    let j = i;
    if (i === from) { el.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`; return; }
    if (from < to && i > from && i <= to) j = i - 1;
    else if (to < from && i >= to && i < from) j = i + 1;
    const t = j === i ? '' : `translate(${Math.round(slots[j].x - slots[i].x)}px, ${Math.round(slots[j].y - slots[i].y)}px)`;
    if (el.style.transform !== t) el.style.transform = t;
  });
}

// Near the top or bottom edge of what scrolls, the list moves under the pointer.
function reorderEdgeScroll() {
  if (!DR.on) return;
  const sc = DR.sc;
  const r = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const y = DR.last.y;
  const edge = 56;
  const v = y < r.top + edge ? -Math.ceil((r.top + edge - y) / 5) : y > r.bottom - edge ? Math.ceil((y - (r.bottom - edge)) / 5) : 0;
  if (v) {
    if (sc) sc.scrollTop += clamp(v, -18, 18); else window.scrollBy(0, clamp(v, -18, 18));
    paintReorder();
  }
  DR.raf = requestAnimationFrame(reorderEdgeScroll);
}

function onReorderKey(ev) {
  if (ev.key !== 'Escape' || !DR.on) return;
  ev.preventDefault();
  ev.stopPropagation();
  endReorder(false);
}

function onReorderCancel() { if (DR.on) endReorder(false); else disarmReorder(); }

function onReorderUp(ev) {
  if (!DR.on) { disarmReorder(); return; }
  ev.preventDefault();
  // The click that follows this release isn't a click on the title.
  DR.clicked = true;
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };
  window.addEventListener('click', swallow, true);
  setTimeout(() => { DR.clicked = false; window.removeEventListener('click', swallow, true); }, 0);
  endReorder(true);
}

function endReorder(drop) {
  const { peers, from, to, opts } = DR;
  const el = opts.el;
  const was = el.getBoundingClientRect();
  const root = opts.root || document.documentElement;
  disarmReorder();
  DR.on = false;
  // Everything goes to its real place in one step (no slide back from the shifted places).
  root.setAttribute('data-apq-reorder', 'settle');
  for (const p of peers) { p.style.transform = ''; p.removeAttribute('data-apq-peer'); }
  if (drop && to !== from) {
    const order = peers.slice();
    order.splice(to, 0, order.splice(from, 1)[0]);
    opts.onDrop(order);
  }
  // The dragged one lands: from where it was let go to its place (styles.js: no transition while
  // data-apq-drag is empty, a short one once it says "land").
  const now = el.getBoundingClientRect();
  const dx = was.left - now.left, dy = was.top - now.top;
  const done = () => {
    el.removeAttribute('data-apq-drag');
    el.style.transform = '';
    root.removeAttribute('data-apq-reorder');
    document.documentElement.classList.remove('apq-dragging');
  };
  if (reducedMotion() || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) { done(); return; }
  el.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
  void el.offsetWidth;
  el.setAttribute('data-apq-drag', 'land');
  el.style.transform = '';
  setTimeout(done, 200);
}

/* On AniList's page: posters of a list sorted by priority ---------------- */

// The posters that share a priority with this one in its list (and its group, when the list is
// grouped), in the order they show. Pins form one group.
function posterPeers(el) {
  const pc = el.querySelector(':scope > .apq-pc');
  const box = el.parentElement;
  const e = entryOf(Number(el.dataset.apqId));
  if (!pc || !box || !e) return null;
  const key = pc.dataset.list || '';
  const a = arrangementOf(key);
  if (a.by !== 'prio' || !prioOn(key)) return null;
  const prio = prioIn(e, key);
  const pinned = prio >= PIN_MIN;
  const bucket = (x) => (a.grp ? groupOf(x, a).key : '');
  const mine = bucket(e);
  const els = Array.from(box.children).filter((k) => {
    if (!k.hasAttribute('data-apq-pc') || k.hasAttribute('data-apq-vhide') || k.hasAttribute('data-apq-gone')) return false;
    const x = entryOf(Number(k.dataset.apqId));
    if (!x || bucket(x) !== mine) return false;
    const p = prioIn(x, key);
    return pinned ? p >= PIN_MIN : p === prio;
  });
  const pos = new Map(Array.from(box.children).map((k, i) => [k, i]));
  els.sort((x, y) => (Number(x.style.order) || 0) - (Number(y.style.order) || 0) || pos.get(x) - pos.get(y));
  return { key, prio, els };
}

const idsOfRows = (els) => els.map((k) => Number(k.dataset.apqId || k.dataset.id));

function onPosterPointerDown(ev) {
  if (!S.settings.dragOrder || !canEdit() || S.selecting || (ev.target.closest && ev.target.closest('button'))) return;
  const el = ev.currentTarget.closest('[data-apq-id]');
  const g = el && posterPeers(el);
  if (!g || g.els.length < 2) return;
  const before = idsOfRows(g.els);
  armReorder(ev, {
    el, axis: 'xy', scroller: null,
    peers: () => g.els,
    onDrop: (order) => commitReorder(g.key, g.prio, before, idsOfRows(order), Number(el.dataset.apqId)),
  });
}

// Alt + arrow on a focused poster moves it one place among the others of its priority.
function onPosterKey(ev) {
  if (!ev.altKey || ev.ctrlKey || ev.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
  const el = ev.currentTarget.closest('[data-apq-id]');
  const g = el && S.settings.dragOrder && canEdit() && !S.selecting ? posterPeers(el) : null;
  if (!g || g.els.length < 2) return;
  ev.preventDefault();
  ev.stopPropagation();
  const i = g.els.indexOf(el);
  const j = i + (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 1);
  if (j < 0 || j >= g.els.length) return;
  const before = idsOfRows(g.els);
  const order = g.els.slice();
  order.splice(j, 0, order.splice(i, 1)[0]);
  commitReorder(g.key, g.prio, before, idsOfRows(order), Number(el.dataset.apqId));
  ev.currentTarget.focus({ preventScroll: true });
}

/* In the hub: the rows of one priority group ----------------------------- */

function hubPeers(row) {
  return D.list ? Array.from(D.list.querySelectorAll('.apq-row')).filter((r) => r.dataset.grp === row.dataset.grp) : [];
}

// A hub row's group: which list and priority it orders.
function hubGroupOf(row) {
  const e = entryOf(Number(row.dataset.id));
  return e ? { key: statusKey(S.tab), prio: isPinned(e) ? e.priority : e.priority || 0 } : null;
}

function onGripDown(ev, row) {
  if (!S.settings.dragOrder || !canEdit() || S.selecting) return;
  const g = hubGroupOf(row);
  const peers = hubPeers(row);
  if (!g || peers.length < 2) return;
  ev.preventDefault(); // no text selection, and the row's link doesn't take the press
  const before = idsOfRows(peers);
  armReorder(ev, {
    el: row, axis: 'y', scroller: D.body, root: D.drawer,
    peers: () => peers,
    onDrop: (order) => commitReorder(g.key, g.prio, before, idsOfRows(order), Number(row.dataset.id)),
  });
}

function onRowOrderKey(ev, row) {
  if (!ev.altKey || ev.ctrlKey || ev.metaKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
  if (!S.settings.dragOrder || !canEdit() || S.selecting) return;
  const g = hubGroupOf(row);
  const peers = hubPeers(row);
  const i = peers.indexOf(row);
  const j = i + (ev.key === 'ArrowUp' ? -1 : 1);
  if (!g || i < 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (j < 0 || j >= peers.length) return;
  const before = idsOfRows(peers);
  const order = peers.slice();
  order.splice(j, 0, order.splice(i, 1)[0]);
  const focused = document.activeElement;
  commitReorder(g.key, g.prio, before, idsOfRows(order), Number(row.dataset.id));
  if (focused && focused.isConnected) focused.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest' });
}
