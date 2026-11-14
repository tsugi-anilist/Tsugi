// Tsugi · The AniList list page: badges, selecting titles, the bulk bar.
'use strict';

/* ------------------------------------------------------------------ */
/* The AniList list page: badges, selection, priority sort             */
/* ------------------------------------------------------------------ */

// Each pass over the page asks every row for its title, its badge and AniList's own links; a long list has hundreds
// of rows, and AniList adds 30 at a time as you scroll. So what was found in a row is kept on it, and used again as
// long as it's still in that row (AniList may redraw a row in place: then it's looked for again). (perf, 0.12.8)
const keptIn = (el, n) => !!n && n.parentNode !== null && el.contains(n);

function mediaIdOf(el) {
  const a0 = el._apqA;
  if (keptIn(el, a0)) {
    const m = (a0.getAttribute('href') || '').match(MEDIA_RE);
    if (m) return Number(m[2]);
  }
  for (const a of el.querySelectorAll('a[href]')) {
    const m = a.getAttribute('href').match(MEDIA_RE);
    if (m) { el._apqA = a; return Number(m[2]); }
  }
  return null;
}

function findEntries() {
  // AniList's rows are the children of each list's .list-entries (its markup, read 2026-11-11). Going through those
  // is much quicker than searching the whole page, which with posters is tens of thousands of elements, at every
  // pass (0.12.8). The searches stay for anything else.
  let els = [];
  for (const box of document.getElementsByClassName('list-entries')) {
    if (!box.closest('.medialist')) continue;
    for (const k of box.children) if (k.classList.contains('entry') || k.classList.contains('entry-card')) els.push(k);
  }
  if (!els.length) els = Array.from(document.querySelectorAll('.medialist .entry, .medialist .entry-card'));
  if (!els.length) els = Array.from(document.querySelectorAll('.list-entries > *'));
  return els.filter((el) => !el.closest('.apq-ui') && mediaIdOf(el));
}

function isCard(el) {
  if (el.hasAttribute('data-apq-pc')) return true; // poster mode: every row is a cover
  if (el.classList.contains('entry-card')) return true;
  if (el.classList.contains('entry')) return false;
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.height > r.width * 1.1;
}

function titleAnchor(el) {
  const t0 = el._apqT;
  if (keptIn(el, t0) && MEDIA_RE.test(t0.getAttribute('href') || '') && t0.textContent.trim()) return t0;
  const links = Array.from(el.querySelectorAll('a[href]')).filter((a) => MEDIA_RE.test(a.getAttribute('href')) && !a.closest('.apq-ui'));
  const a = links.find((x) => x.textContent.trim() && !x.querySelector('img')) || null;
  el._apqT = a;
  return a;
}

// A badge or selection ring sits at the row's corner, so the row must be positioned. AniList's own rows already are
// (its CSS: `.entry` and `.entry-card` are position: relative, read 2026-11-14), and so are posters (styles.js).
// Reading the computed style here costs a whole style and layout pass each time, because the loop that calls it
// has just changed the page: once per new row, it was most of the work while scrolling a list (perf, 0.12.8).
// So only other markup is read, and each row once.
function ensurePositioned(el) {
  if (el._apqPos) return;
  el._apqPos = true;
  if (el.hasAttribute('data-apq-pc') || el.classList.contains('entry') || el.classList.contains('entry-card')) return;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
}

// Every row gets one, so it's copied from one made once (0.12.8), its glyph and number kept at hand for updateBadge.
let badgeSkeleton = null;
const stopHere = (e) => e.stopPropagation();
function makeBadge() {
  if (!badgeSkeleton) {
    badgeSkeleton = h('button', { type: 'button', class: 'apq-ui apq-badge' });
    // (A list with priorities off shows a star: its score, custom lists and rewatch log. Not "···", which is AniList's
    // own editor on the same row or card; 0.7.1.)
    badgeSkeleton.append(glyph(3), icon('plus', 'apq-badge-plus'), icon('pin', 'apq-badge-pin'), icon('star', 'apq-badge-more'), h('span', { class: 'apq-badge-num' }));
  }
  const b = badgeSkeleton.cloneNode(true);
  b._glyph = b.firstElementChild;
  b._num = b.lastElementChild;
  b.addEventListener('click', onBadgeClick);
  for (const ev of ['pointerdown', 'mousedown', 'touchstart']) b.addEventListener(ev, stopHere, { passive: true });
  return b;
}

// Rows (AniList's list and compact layouts): a priority sits before the title, and in a list where some title has
// one, so does the empty button of the others, so the titles line up. In a list where none has one, or with
// priorities off, the button goes just after the title instead (`tail`), shown while you point at the row, so the
// list keeps AniList's own left edge (0.7.1; it used to leave an empty column there).
function placeBadge(el, b, card, tail = false) {
  if (b.classList.contains('is-card') !== card) b.classList.toggle('is-card', card);
  if (card) {
    if (b.classList.contains('is-tail')) b.classList.remove('is-tail');
    // Always the same corner (top left); AniList's note and rewatch icons move to its right (styles.js).
    if (b.parentElement !== el) { ensurePositioned(el); el.append(b); }
    return;
  }
  const a = titleAnchor(el);
  tail = !!a && tail;
  if (b.classList.contains('is-tail') !== tail) b.classList.toggle('is-tail', tail);
  if (a) {
    if (tail) { if (b.previousElementSibling !== a) a.after(b); }
    else if (b.nextElementSibling !== a) a.before(b);
  } else if (b.parentElement !== el) {
    el.prepend(b);
  }
}

// Whether some title of this box of rows has a priority in its list (cached for one decoratePage).
function boxHasPrio(box, key, cache) {
  if (cache.has(box)) return cache.get(box);
  let any = false;
  if (S.data && prioOn(key)) {
    for (const k of box.children) {
      const id = Number(k.dataset.apqId || mediaIdOf(k));
      const e = id && S.data.entries.get(id);
      if (e && prioIn(e, key) > 0) { any = true; break; }
    }
  }
  cache.set(box, any);
  box._apqHasPrio = any;   // for decoratePage's next pass that only adds rows
  return any;
}

// A badge shows the title's priority in the list it's in (data-list): AniList's for status lists,
// the list's own for custom lists. A list with priorities off gets a quiet star button instead.
function updateBadge(b) {
  const d = S.data;
  const id = Number(b.dataset.for);
  const key = b.dataset.list || '';
  const e = d && d.entries.get(id);
  const p = e ? prioIn(e, key) : 0;
  const lite = !prioOn(key);
  const pinned = p >= PIN_MIN && !lite;
  const max = maxPrioIn(key);
  const tier = tierOf(p, max);
  const num = b._num || b.querySelector('.apq-badge-num');
  const txt = p > 0 && !pinned && !lite ? String(p) : '';
  if (num.textContent !== txt) num.textContent = txt;
  const g = b._glyph || b.querySelector('.apq-glyph');
  const gc = `apq-glyph t${tier || 3}`;
  if (g.getAttribute('class') !== gc) g.setAttribute('class', gc);
  const editable = !!(d && d.canEdit && e);
  const blk = blockerOf(e);
  b.classList.toggle('is-lite', lite);
  b.classList.toggle('is-empty', !lite && !(p > 0));
  b.classList.toggle('is-top', !lite && p > 0 && p === max && !pinned);
  b.classList.toggle('is-pin', pinned);
  b.classList.toggle('is-readonly', !editable);
  b.classList.toggle('is-saving', S.rowState.get(id) === 'saving');
  b.classList.toggle('is-error', S.rowState.get(id) === 'error');
  b.classList.toggle('is-blocked', !!blk);
  const tip = blk ? `${verb()} ${blk.title} first` : '';
  if ((b.dataset.tip || '') !== tip) { if (tip) b.dataset.tip = tip; else delete b.dataset.tip; }
  const where = customStore(key) ? ` in ${listName(key)}` : '';
  const label = (pinned ? 'Pinned to the top' : p > 0 ? `Priority ${p}` : 'No priority') + where;
  if (lite) b.setAttribute('aria-label', 'Score, custom lists and rewatch log');
  else b.setAttribute('aria-label', (editable ? `${label}. Change priority` : label) + (tip ? `. ${tip}` : ''));
  if (editable) b.removeAttribute('tabindex'); else b.setAttribute('tabindex', '-1');
}

function hasAnyPriority() {
  if (!S.data) return false;
  for (const e of S.data.entries.values()) if (e.priority > 0) return true;
  return false;
}

function paintEntry(el, id) {
  const on = S.selecting && S.selected.has(id);
  if (el.hasAttribute('data-apq-sel') !== on) el.toggleAttribute('data-apq-sel', on);
  if (!S.selecting && !el._apqRing) return; // never selected: nothing to take away
  el._apqRing = S.selecting;
  let ring = el.querySelector(':scope > .apq-ring');
  const check = el.querySelector(':scope > .apq-check');
  if (S.selecting) {
    const card = el.hasAttribute('data-apq-card');
    if (!ring) {
      ensurePositioned(el);
      ring = h('span', { class: 'apq-ui apq-ring', 'aria-hidden': 'true' });
      el.append(ring);
    }
    if (ring.classList.contains('is-row') === card) ring.classList.toggle('is-row', !card);
    if (card && !check) el.append(h('span', { class: 'apq-ui apq-check', 'aria-hidden': 'true' }, icon('check')));
    else if (!card && check) check.remove();
  } else {
    if (ring) ring.remove();
    if (check) check.remove();
  }
}

// What every row was last decorated for: when only AniList's own rows changed since (it draws 30 more as you scroll),
// the rows already done are left alone and only the new ones get their badge and poster. Changes to your titles reach
// the rows already there through refreshAllViews (edit.js) and paintSelection, as before. (perf, 0.12.8)
const DEC = { gen: 0, ctx: null };
// Lookups that read your whole list (the highest priority), kept for one pass: nothing changes during it. Without it,
// every badge read the whole list again (700 badges, 700 titles: half a million steps for each refresh).
let decorMemo = null;
function withPassMemo(fn) {
  const own = !decorMemo;
  if (own) decorMemo = new Map();
  try { return fn(); } finally { if (own) decorMemo = null; }
}

function decoratePage(opts) {
  if (!S.route) return;
  const d = S.data;
  const els = findEntries();
  const posters = syncPosterMode();
  const show = !!d && S.settings.badges && (d.canEdit || hasAnyPriority());
  const ctx = [d, posters, show, S.settings, S.sorts, S.selecting, S.gone.size, NS.ver, CP.lists];
  let quick = !!(opts && opts.added) && !!DEC.ctx && ctx.every((v, i) => v === DEC.ctx[i]);
  const keys = new Map(); // box -> its list's key
  const prioBoxes = new Map(); // box -> some title in it has a priority
  const keyOf = (box) => {
    if (box && !keys.has(box)) keys.set(box, boxListKey(box));
    return (box && keys.get(box)) || '';
  };
  // A list's empty buttons go before the titles when some title of that list has a priority (placeBadge): if a new
  // row changes that, every row of the list moves, so everything is done again.
  if (quick) {
    for (const el of els) {
      if (el._apqDone === DEC.gen && el.dataset.apqId === String(mediaIdOf(el))) continue;
      const box = el.parentElement;
      if (box && box._apqHasPrio !== undefined && box._apqHasPrio !== boxHasPrio(box, keyOf(box), prioBoxes)) { quick = false; break; }
    }
  }
  if (!quick) { DEC.gen++; DEC.ctx = ctx; }
  withPassMemo(() => {
    for (const el of els) {
      const id = mediaIdOf(el);
      if (quick && el._apqDone === DEC.gen && el.dataset.apqId === String(id)) continue;
      decorateRow(el, id, d, posters, show, keyOf, prioBoxes);
      el._apqDone = DEC.gen;
    }
    applyPageSort(els);
  });
  renderDock();
  renderBar();
  scheduleFill();
  schedulePosterFill();
  checkHold(els.length);
}

function decorateRow(el, id, d, posters, show, keyOf, prioBoxes) {
  if (el.dataset.apqId !== String(id)) el.dataset.apqId = String(id);
  const box = el.parentElement;
  const key = keyOf(box);
  decoratePoster(el, id, posters, key);
  const card = isCard(el);
  if (el.hasAttribute('data-apq-card') !== card) el.toggleAttribute('data-apq-card', card);
  const gone = S.gone.has(id);
  if (el.hasAttribute('data-apq-gone') !== gone) el.toggleAttribute('data-apq-gone', gone);
  let b = keptIn(el, el._apqBadge) ? el._apqBadge : el.querySelector('.apq-badge');
  if (!show || (!prioOn(key) && !d.canEdit)) {
    if (b) b.remove();
    b = null;
  } else {
    if (!b) b = makeBadge();
    if (b.dataset.for !== String(id)) b.dataset.for = String(id);
    if (b.dataset.list !== key) b.dataset.list = key;
    const e = d.entries.get(id);
    // (Worked out for every list of rows, so a later pass that only adds rows can tell when it changes.)
    const boxPrio = !card && !!box && prioOn(key) && boxHasPrio(box, key, prioBoxes);
    const tail = !card && (!prioOn(key) || (!(e && prioIn(e, key) > 0) && !boxPrio));
    placeBadge(el, b, card, tail);
    updateBadge(b);
  }
  el._apqBadge = b;
  // Cards with a badge make room for it: AniList's note and rewatch icons move right (styles.js).
  const room = !!b && card && !(b.classList.contains('is-readonly') && b.classList.contains('is-empty'));
  if (el.hasAttribute('data-apq-badge') !== room) el.toggleAttribute('data-apq-badge', room);
  paintEntry(el, id);
}

function clearBox(box) {
  for (const k of box.children) {
    if (!k.hasAttribute('data-apq-ord')) continue;
    k.style.removeProperty('order');
    k.removeAttribute('data-apq-ord');
  }
  removeGroupHeads(box);
  box.classList.remove('apq-flexcol');
  box.removeAttribute('data-apq-sorted');
}

function clearPageSort() {
  document.querySelectorAll('[data-apq-ord]').forEach((n) => {
    n.style.removeProperty('order');
    n.removeAttribute('data-apq-ord');
  });
  document.querySelectorAll('.apq-vgroup').forEach((n) => n.remove());
  document.querySelectorAll('.apq-vgrid').forEach((n) => { n.classList.remove('apq-vgrid'); n.style.removeProperty('--apq-card-h'); });
  document.querySelectorAll('.apq-flexcol').forEach((n) => n.classList.remove('apq-flexcol'));
  document.querySelectorAll('[data-apq-sorted]').forEach((n) => n.removeAttribute('data-apq-sorted'));
}

// The layout AniList draws a box of rows in: `.medialist`'s classes say list, compact or cards.
function layoutOf(box) {
  const ml = box.closest('.medialist');
  return ml ? ml.className : '';
}

// Which list a box of rows belongs to: the page's own list, or (on "All") its section.
function boxListKey(box) {
  const r = S.route;
  if (r.list) return listKey();
  const w = box.closest('.list-wrap');
  const name = w ? sectionName(w) : '';
  return name ? keyFor(r.type, name) : listKey();
}

// Puts the rows of AniList's page in order. Rows the filters don't match are hidden first
// (views.js), then each list's rows follow that list's sort and group: by priority, by one of
// the list sorts, or AniList's own order.
function applyPageSort(els) {
  if (!S.route) return;
  els = els || findEntries();
  markView(els, currentFilters());
  if (!S.data) { clearPageSort(); return; }
  const boxes = new Map();
  for (const el of els) {
    const parent = el.parentElement;
    if (!parent) continue;
    if (!boxes.has(parent)) boxes.set(parent, []);
    boxes.get(parent).push(el);
  }
  // AniList's layout buttons (list, compact, cards) keep each list's box and draw new rows in it.
  // What was set up for the old layout goes first: the column that lets a list layout's rows be
  // reordered would stack cards one under the other, and the cards' height would stretch rows.
  for (const box of boxes.keys()) {
    const lay = layoutOf(box);
    if (box._apqLayout !== undefined && box._apqLayout !== lay) clearBox(box);
    box._apqLayout = lay;
  }
  if (S.popover || DR.on) return; // don't move things while you're editing or dragging one
  const desc = S.settings.dir !== 'asc';
  const entryOfEl = (el) => S.data.entries.get(Number(el.dataset.apqId || mediaIdOf(el))) || null;
  // Pins always come first, top pin first, whichever way priorities are sorted.
  const rank = (p) => (p >= PIN_MIN ? 1e6 + p : desc ? p : -p);
  const setOrd = (el, i) => {
    const o = String(i);
    if (el.style.order !== o) el.style.order = o;
    if (!el.hasAttribute('data-apq-ord')) el.setAttribute('data-apq-ord', '');
  };
  for (const [box, list] of boxes) {
    const key = boxListKey(box);
    const a = arrangementOf(key);
    const prioOf = (el) => prioIn(entryOfEl(el), key);
    const fine = fineRanks(key); // your own order inside one priority (order.js)
    const idOfEl = (el) => Number(el.dataset.apqId || mediaIdOf(el));
    if (a.by === 'al' && !a.grp) { if (box.hasAttribute('data-apq-sorted')) clearBox(box); continue; }
    const display = getComputedStyle(box).display;
    if (display === 'block' || display === 'flow-root') box.classList.add('apq-flexcol');
    if (!box.hasAttribute('data-apq-sorted')) box.setAttribute('data-apq-sorted', '');
    const kids = Array.from(box.children).filter((k) => !k.classList.contains('apq-vgroup'));
    const idx = new Map(kids.map((k, i) => [k, i]));
    const sorted = list.slice().sort((x, y) => {
      if (a.by === 'prio') {
        const px = prioOf(x), py = prioOf(y);
        if ((px > 0) !== (py > 0)) return px > 0 ? -1 : 1;
        if (px !== py) return rank(py) - rank(px);
        const fx = fine(px, idOfEl(x)), fy = fine(py, idOfEl(y));
        if (fx !== fy) return fx - fy;
      } else if (a.by !== 'al') {
        const ex = entryOfEl(x), ey = entryOfEl(y);
        if (ex && ey) { const c = sortCompare(ex, ey, a); if (c) return c; }
      }
      return idx.get(x) - idx.get(y);
    });
    if (a.grp) placeGroups(box, sorted, a, entryOfEl, setOrd);
    else {
      removeGroupHeads(box);
      sorted.forEach((el, i) => setOrd(el, i + 1));
    }
    const set = new Set(list);
    const first = idx.get(list[0]);
    for (const k of kids) {
      if (set.has(k)) continue;
      setOrd(k, idx.get(k) < first ? -1 : 100000);
    }
  }
}

// AniList only puts part of a long list on the page until you scroll.
// A list sorted by priority needs its prioritized titles on the page (or they'd be missing
// from the top); a list with another sort or a group, or any filter, needs every title.

function shownLists() {
  const d = S.data, r = S.route;
  if (!d || !r) return [];
  if (!r.list) return d.lists;
  const name = r.list.toLowerCase();
  const exact = d.lists.filter((l) => l.name.toLowerCase() === name);
  return exact.length ? exact : d.lists.filter((l) => l.name.toLowerCase().startsWith(name));
}

// What a list needs loaded: 'all', 'prio' or ''.
const keyOfList = (l) => (S.route.list ? listKey() : keyFor(S.route.type, l.name));
function listNeeds(l) {
  if (filtersActive()) return 'all';
  const a = arrangementOf(keyOfList(l));
  if (a.grp || (a.by !== 'al' && a.by !== 'prio')) return 'all';
  return a.by === 'prio' ? 'prio' : '';
}

function missingForSort() {
  const d = S.data;
  if (!d || !S.route) return 0;
  const onPage = new Set(findEntries().map((el) => Number(el.dataset.apqId || mediaIdOf(el))));
  const missing = new Set();
  for (const l of shownLists()) {
    const need = listNeeds(l);
    if (!need) continue;
    const key = keyOfList(l);
    for (const id of l.ids) {
      const e = d.entries.get(id);
      if (e && (need === 'all' || prioIn(e, key) > 0) && !onPage.has(id)) missing.add(id);
    }
  }
  return missing.size;
}

// One try per page, and one more each time a list starts needing more of itself.
const wantsFill = () => !!S.data && !!S.route && shownLists().some((l) => listNeeds(l));
const fillKey = () => `${location.pathname}|${shownLists().map(listNeeds).join(',')}`;

let fillTimer = 0;
function scheduleFill() {
  if (!wantsFill() || S.filling || !S.data || S.fillAttempted === fillKey()) return;
  clearTimeout(fillTimer);
  fillTimer = setTimeout(fillForSort, isHeld() ? 60 : 350); // nobody sees the list yet: no need to wait
}

async function fillForSort() {
  if (!wantsFill() || S.filling || !S.data || S.fillAttempted === fillKey()) return;
  if (!findEntries().length || !missingForSort()) return;
  S.fillAttempted = fillKey();
  S.filling = true;
  renderDock();
  try {
    const worked = await quietFill();
    if (!worked && missingForSort()) await veiledFill();
  } finally {
    S.filling = false;
    decoratePage();
  }
}

// Ask AniList for more rows by briefly reporting a very tall window.
// Nothing on the page moves. The page-side helper (bridge.js) does the work.
function nudgeLazyLoader(times = 1) {
  try { window.dispatchEvent(new CustomEvent('apq:nudge', { detail: times })); } catch { /* ignore */ }
}

async function quietFill() {
  let grew = false, idle = 0;
  // Enough for the longest list at once: AniList draws 30 more rows of every unfinished list per scroll event
  // (bridge.js). If it ever draws fewer, the next rounds ask again, as before (0.12.8).
  const steps = Math.min(200, Math.ceil(Math.max(0, ...shownLists().map((l) => l.ids.length)) / 30) + 1);
  for (let i = 0; i < 80 && idle < 3 && missingForSort(); i++) {
    const before = findEntries().length;
    nudgeLazyLoader(steps);
    // Goes on as soon as AniList has drawn more (a moment later, so it has finished), or after
    // the same waits as before if it hasn't.
    const limit = i < 2 ? 320 : 160;
    let after = before;
    for (let t = 0; t < limit && after <= before; t += 40) {
      await sleep(40);
      after = findEntries().length;
    }
    if (after > before) {
      await sleep(40);
      after = findEntries().length;
    }
    if (after > before) { grew = true; idle = 0; } else idle++;
    if (!grew && i >= 1) return false;
  }
  return grew || !missingForSort();
}

// Fallback: scroll for real, under a cover so you don't see the page jump.
async function veiledFill() {
  const veil = h('div', { class: 'apq-ui apq-veil', role: 'status' },
    h('div', { class: 'apq-veil-card' }, spinner(), h('span', {}, 'Loading the whole list')));
  document.body.append(veil);
  void veil.offsetWidth;
  veil.classList.add('is-on');
  await sleep(140);
  const y = window.scrollY;
  let last = -1, idle = 0;
  try {
    for (let i = 0; i < 100 && idle < 3 && missingForSort(); i++) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      await sleep(160);
      const c = findEntries().length;
      if (c === last) idle++; else { idle = 0; last = c; }
    }
  } finally {
    window.scrollTo({ top: y, behavior: 'instant' });
    veil.classList.remove('is-on');
    setTimeout(() => veil.remove(), 300);
  }
}

/* Showing a list once it's in place --------------------------------- */
// AniList draws a list's rows in its own order. Until they're in place (the extension's data is
// there, rows sorted, filtered and grouped, badges on, the rest of a long list loaded), the lists
// stay out of sight: data-apq-hold on <html> (hold.css). hold.js sets it as a list page starts
// loading, onRoute when you open another list inside AniList. decoratePage shows them when ready.
const HOLD_MAX = 3500;   // ms: once the list or its data is there, never kept out of sight longer
const HOLD_NOTE = 700;   // ms: past this, a small note says the list is loading
const HOLD = { timer: 0, noteTimer: 0, note: null };

const isHeld = () => document.documentElement.hasAttribute('data-apq-hold');

function holdList() {
  const html = document.documentElement;
  if (html.getAttribute('data-apq-hold') !== 'route') html.setAttribute('data-apq-hold', 'route');
  clearTimeout(HOLD.timer);
  clearTimeout(HOLD.noteTimer);
  HOLD.timer = HOLD.noteTimer = 0; // they start again once the new list or its data is there
}

function releaseList() {
  clearTimeout(HOLD.timer);
  clearTimeout(HOLD.noteTimer);
  HOLD.timer = HOLD.noteTimer = 0;
  if (HOLD.note) { HOLD.note.remove(); HOLD.note = null; }
  document.documentElement.removeAttribute('data-apq-hold');
}

// After each pass over the page: shows the lists once nothing in them is going to move.
function checkHold(rows) {
  if (!isHeld()) return;
  if (!S.route || S.error) { releaseList(); return; }
  if (!HOLD.timer && (S.data || rows || document.querySelector('.list-wrap'))) {
    HOLD.timer = setTimeout(releaseList, HOLD_MAX);
    HOLD.noteTimer = setTimeout(showHoldNote, HOLD_NOTE);
  }
  if (!S.data || S.filling) return;
  if (!rows) {
    if (shownLists().some((l) => l.ids.length)) return; // AniList hasn't drawn them yet
  } else if (wantsFill() && S.fillAttempted !== fillKey() && missingForSort()) {
    return; // the rest of the list is on its way (scheduleFill)
  } else if (posterFillPending()) {
    return; // posters: AniList is drawing enough rows to fill the window (posters.js)
  }
  releaseList();
}

// Where the list will be: "Loading the list", so a slow list doesn't look like an empty one.
function showHoldNote() {
  HOLD.noteTimer = 0;
  if (!isHeld() || HOLD.note) return;
  const w = viewAnchor();
  const r = w && w.getBoundingClientRect();
  if (!r || !r.width) return;
  HOLD.note = h('div', { class: 'apq-ui apq-hold-note', role: 'status' }, spinner(), h('span', {}, 'Loading the list'));
  HOLD.note.style.top = `${Math.round(r.top + window.scrollY + 8)}px`;
  HOLD.note.style.left = `${Math.round(r.left + window.scrollX + r.width / 2)}px`;
  document.body.append(HOLD.note);
}

// The priority sort switch (floating button, hub, palette): for this list, or on "All" for
// every list on the page. Turning it off gives back AniList's order. quiet: no toast.
function setSortPage(on, quiet = false) {
  for (const k of pageListKeys()) {
    if (!prioOn(k)) continue;
    const a = arrangementOf(k);
    if (on && a.by !== 'prio') setArrangement(k, { by: 'prio', dir: '' });
    else if (!on && a.by === 'prio') setArrangement(k, { by: 'al', dir: '' });
  }
  arrangementChanged();
  const name = S.route && S.route.list ? S.route.list : 'This page';
  if (!quiet) toast(on ? `${name} is now sorted by priority` : `${name} is back to AniList's order`);
}

// After a list's sort or group changed.
function arrangementChanged() {
  applyPageSort();
  renderDock();
  if (D.drawer) renderDrawerChrome();
  renderSortMenu();
  scheduleFill();
}

/* ------------------------------------------------------------------ */
/* Selecting several titles                                            */
/* ------------------------------------------------------------------ */

function enterSelect() {
  if (!canEdit() || S.selecting) return;
  closePopover(false);
  closePick();
  hideTip();
  if (S.view !== 'list') setView('list');
  S.selecting = true;
  S.selected.clear();
  S.anchor = null;
  document.documentElement.classList.add('apq-selecting');
  mountBar();
  paintSelection();
  renderDock();
  if (D.drawer) renderDrawerChrome();
}

function exitSelect() {
  if (!S.selecting) return;
  S.selecting = false;
  S.selected.clear();
  S.anchor = null;
  document.documentElement.classList.remove('apq-selecting');
  unmountBar();
  paintSelection();
  renderDock();
  if (D.drawer) renderDrawerChrome();
}

function toggleSelectMode() { if (S.selecting) exitSelect(); else enterSelect(); }

function pageOrder() {
  return findEntries()
    .map((el) => ({ id: Number(el.dataset.apqId || mediaIdOf(el)), r: el.getBoundingClientRect() }))
    .filter((x) => x.r.width > 0)
    .sort((a, b) => (Math.abs(a.r.top - b.r.top) > 4 ? a.r.top - b.r.top : a.r.left - b.r.left))
    .map((x) => x.id);
}

function panelOrder() {
  return D.list ? Array.from(D.list.querySelectorAll('.apq-row')).map((r) => Number(r.dataset.id)) : [];
}

function toggleSelect(id, shift, where) {
  if (!S.selecting || !S.data || !S.data.entries.has(id)) return;
  if (shift && S.anchor != null && S.anchor !== id) {
    const order = where === 'panel' ? panelOrder() : pageOrder();
    const a = order.indexOf(S.anchor), b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.selected.add(order[i]);
    } else {
      S.selected.add(id);
    }
  } else {
    if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
    S.anchor = id;
  }
  paintSelection();
}

function tabItems() {
  const d = S.data;
  if (!d) return [];
  const q = norm(S.query.trim());
  const out = [];
  for (const e of d.entries.values()) {
    // Titles kept "only in custom lists" stay out of the status tabs, as on AniList.
    // NSFW titles stay out too while "Hide NSFW titles" is on.
    if (e.status === S.tab && !e.hidden && !adultHidden(e) && (!q || norm(e.title).includes(q))) out.push(e);
  }
  return out;
}

function visibleIds() {
  if (S.drawerOpen) return tabItems().map((e) => e.mediaId);
  return findEntries().filter((el) => !el.hasAttribute('data-apq-vhide'))
    .map((el) => Number(el.dataset.apqId || mediaIdOf(el))).filter((id) => S.data && S.data.entries.has(id));
}

function selectAllVisible() {
  if (!S.selecting) return;
  const ids = visibleIds();
  const all = ids.length > 0 && ids.every((id) => S.selected.has(id));
  for (const id of ids) { if (all) S.selected.delete(id); else S.selected.add(id); }
  paintSelection();
}

function paintSelection() {
  for (const el of document.querySelectorAll('[data-apq-id]')) paintEntry(el, Number(el.dataset.apqId));
  if (D.drawer && S.drawerOpen) renderDrawerList();
  renderBar();
}

function onCaptureClick(ev) {
  if (!S.selecting || ev.button !== 0) return;
  const t = ev.target;
  if (!t || !t.closest) return;
  const ui = t.closest('.apq-ui');
  if (ui && !ui.classList.contains('apq-pc')) return; // a poster is the title itself
  const el = t.closest('[data-apq-id]');
  if (!el) return;
  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation();
  toggleSelect(Number(el.dataset.apqId), ev.shiftKey, 'page');
}

/* ------------------------------------------------------------------ */
/* Bulk bar                                                            */
/* ------------------------------------------------------------------ */

function mountBar() {
  if (B.el) return;
  B.count = h('span', { class: 'apq-bar-count' });
  B.all = h('button', { type: 'button', class: 'apq-bar-link', onclick: selectAllVisible }, 'Select all');
  B.clear = h('button', {
    type: 'button', class: 'apq-bar-x', 'aria-label': 'Clear selection', 'data-tip': 'Clear selection',
    onclick: () => { S.selected.clear(); S.anchor = null; paintSelection(); },
  }, icon('x'));
  B.chips = [0, 1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button', class: 'apq-chip', 'data-v': n, 'aria-label': n ? `Set priority ${n}` : 'Remove priority',
    onclick: () => bulkApply(() => n, describeSet(n)),
  }, n ? String(n) : 'None'));
  B.down = h('button', {
    type: 'button', class: 'apq-bar-step', 'aria-label': 'Lower priority by 1', 'data-tip': 'Lower by 1',
    onclick: () => bulkApply((e) => e.priority - 1, (k) => `Lowered ${plural(k)} by 1`, true),
  }, icon('minus'));
  B.up = h('button', {
    type: 'button', class: 'apq-bar-step', 'aria-label': 'Raise priority by 1', 'data-tip': 'Raise by 1',
    onclick: () => bulkApply((e) => e.priority + 1, (k) => `Raised ${plural(k)} by 1`, true),
  }, icon('plus'));
  B.edit = h('button', {
    type: 'button', class: 'apq-bar-edit', 'data-tip': 'Status, score, progress, dates, notes, lists or delete (E)',
    onclick: openMass,
  }, icon('edit'), h('span', {}, 'Edit'));
  B.done = h('button', { type: 'button', class: 'apq-bar-done', onclick: exitSelect }, 'Done');
  B.sepSet = h('span', { class: 'apq-bar-sep' });
  B.set = h('div', { class: 'apq-bar-set' },
    h('span', { class: 'apq-bar-label' }, 'Priority'),
    h('div', { class: 'apq-bar-chips' }, B.chips),
    B.down, B.up);
  B.el = h('div', { class: 'apq-ui apq-bar', role: 'toolbar', 'aria-label': 'Edit the selected titles' },
    h('div', { class: 'apq-bar-sel' }, B.count, B.all, B.clear),
    B.sepSet,
    B.set,
    h('span', { class: 'apq-bar-sep' }),
    B.edit,
    B.done);
  document.body.append(B.el);
  renderBar();
  requestAnimationFrame(() => { if (B.el) B.el.classList.add('is-on'); });
}

function unmountBar() {
  if (!B.el) return;
  const el = B.el;
  B.el = null;
  el.classList.remove('is-on');
  setTimeout(() => el.remove(), 260);
}

// Whose priorities the bar changes: a custom list's own on its page, else AniList's.
const barKey = () => (S.route && S.route.list && customStore(listKey()) ? listKey() : '');

function renderBar() {
  if (!B.el) return;
  const n = S.selected.size;
  const txt = n ? `${n} selected` : 'Click titles to select them';
  if (B.count.textContent !== txt) B.count.textContent = txt;
  B.count.classList.toggle('is-empty', !n);
  B.clear.hidden = !n;
  const ids = visibleIds();
  B.all.hidden = !ids.length || ids.every((id) => S.selected.has(id));
  // On a list with priorities off (Completed, by default), the bar has no priority buttons.
  const prio = !(S.route && S.route.list) || prioOn(listKey());
  B.set.hidden = !prio;
  B.sepSet.hidden = !prio;
  const key = barKey();
  let shared = null;
  if (n && S.data) {
    for (const id of S.selected) {
      const e = S.data.entries.get(id);
      const p = e ? prioIn(e, key) : 0;
      if (shared === null) shared = p;
      else if (shared !== p) { shared = -1; break; }
    }
  }
  for (const c of B.chips) {
    c.disabled = !n;
    c.classList.toggle('is-active', n > 0 && Number(c.dataset.v) === shared);
  }
  B.down.disabled = !n;
  B.up.disabled = !n;
  B.edit.disabled = !n;
  positionBar();
}

function positionBar() {
  if (!B.el) return;
  const beside = S.drawerOpen && window.innerWidth > 1000;
  const left = beside ? `${(window.innerWidth - 452) / 2}px` : '50%';
  if (B.el.style.left !== left) B.el.style.left = left;
}
