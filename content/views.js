// Tsugi · List views on AniList's list pages: each list's sort button, filters, saved filters, NSFW titles.
'use strict';

/* ------------------------------------------------------------------ */
/* List views                                                          */
/* ------------------------------------------------------------------ */
// Two things, both only in the page (nothing changes on AniList):
//  - A sort button on each list's title (Watching, Planning, ...): that list's sort and group,
//    kept for that list wherever it shows, on its own page and inside "All" (lists.js stores it).
//  - Filters in AniList's own sidebar, as more of its dropdowns: source, streaming service, episodes,
//    length, NSFW titles. Filters follow you to every list of the same type (anime, manga) and stay on
//    until you clear them (sync storage "lfilters"). Saved filters (sync "views") switch them in one click.
//  - Posters, as a fourth icon in AniList's layout switch (posters.js does the rest).
// Only what AniList can't do itself: it already filters by country and year.
// Filters: { src: sources, svc: streaming sites, ep: episode-count buckets, dur: length buckets,
//            adult: '' | 'show' | 'hide' | 'only' }

const SOURCES = {
  ORIGINAL: 'Original', MANGA: 'Manga', LIGHT_NOVEL: 'Light novel', WEB_NOVEL: 'Web novel', NOVEL: 'Novel',
  VISUAL_NOVEL: 'Visual novel', VIDEO_GAME: 'Video game', GAME: 'Game', DOUJINSHI: 'Doujinshi', COMIC: 'Comic',
  ANIME: 'Anime', LIVE_ACTION: 'Live action', MULTIMEDIA_PROJECT: 'Multimedia project', PICTURE_BOOK: 'Picture book', OTHER: 'Other',
};
// [key, chip label, heading label, from, to]
const EP_BUCKETS = {
  ANIME: [['1', '1', '1 episode', 1, 1], ['2-13', '2–13', '2 to 13 episodes', 2, 13], ['14-26', '14–26', '14 to 26 episodes', 14, 26],
    ['27-60', '27–60', '27 to 60 episodes', 27, 60], ['61+', '61+', 'More than 60 episodes', 61, Infinity]],
  MANGA: [['1-10', '1–10', 'Up to 10 chapters', 1, 10], ['11-50', '11–50', '11 to 50 chapters', 11, 50],
    ['51-150', '51–150', '51 to 150 chapters', 51, 150], ['151+', '151+', 'More than 150 chapters', 151, Infinity]],
};
const DUR_BUCKETS = [['short', 'Under 15 min', '', 0, 14], ['half', '15–35 min', '', 15, 35], ['long', 'Over 35 min', '', 36, Infinity]];
// The sorts a list can have (besides AniList's own order and priority). kind names the direction words.
const SORTS = {
  title: { label: 'Title', dir: 'asc', kind: 'title', tip: 'Ignores “The”, “A” and “An”. Season 2 comes before Season 10' },
  score: { label: 'Your score', dir: 'desc', kind: 'num' },
  progress: { label: 'Progress', dir: 'desc', kind: 'num' },
  updated: { label: 'Last updated', dir: 'desc', kind: 'date' },
  added: { label: 'Last added', dir: 'desc', kind: 'date' },
  release: { label: 'Release date', dir: 'desc', kind: 'date' },
  started: { label: 'Start date', dir: 'desc', kind: 'date' },
  completed: { label: 'Finish date', dir: 'desc', kind: 'date' },
  avg: { label: 'Average score', dir: 'desc', kind: 'num' },
  popularity: { label: 'Popularity', dir: 'desc', kind: 'num' },
  eps: { label: 'Episodes', dir: 'asc', kind: 'count' },
  length: { label: 'Length', dir: 'asc', kind: 'len', tip: 'Episodes × episode length', anime: true },
};
const DIR_WORDS = {
  title: { asc: 'A to Z', desc: 'Z to A' },
  num: { asc: 'Lowest first', desc: 'Highest first' },
  date: { asc: 'Oldest first', desc: 'Newest first' },
  count: { asc: 'Fewest first', desc: 'Most first' },
  len: { asc: 'Shortest first', desc: 'Longest first' },
};
const LV_GROUPS = ['format', 'source', 'decade', 'size'];
const GROUP_LABELS = { format: 'Format', source: 'Source', decade: 'Decade', size: 'Length' };
const LV_ADULT = ['show', 'hide', 'only'];
const LV_MAX_SAVED = 12;   // per type (anime, manga): sync storage holds 8 KB per item
const LV = {
  filters: {},   // 'ANIME' | 'MANGA' -> filters (sync "lfilters")
  saved: [],     // saved filters: [{ n: name, ty: 'ANIME' | 'MANGA', v: filters }]
  adultSeen: {}, // 'ANIME' | 'MANGA' -> the list had adult titles last time (local "lv:adult")
  side: null,    // the dropdowns, at the end of AniList's Filters group in the sidebar
  boxes: null,   // filter key -> its dropdown's box
  defs: null,    // the dropdowns drawn, from filterDefs
  saveAct: null, headVal: null, headClear: null, headN: null, // on AniList's Filters heading
  savedGroup: null, // the Saved filters group, under AniList's Filters group
  naming: false, nameEl: null, // naming the filters to save them
  bar: null,     // only on a page without AniList's sidebar: the same things above the first list
  drop: null,    // the open dropdown: { key, el, hover, opts }
  find: '', findEl: null, // what you typed to find a streaming site
  posters: null, // the Posters icon in AniList's layout switch
  menu: null,    // the sort menu: { key, name, chip, el }
};

const epBuckets = () => EP_BUCKETS[isAnime() ? 'ANIME' : 'MANGA'];
function bucketOf(n, buckets) {
  if (!n) return null;
  const b = buckets.find(([, , , lo, hi]) => n >= lo && n <= hi);
  return b ? b[0] : null;
}
const sortLabel = (by) => (by === 'eps' && !isAnime() ? 'Chapters' : (SORTS[by] || {}).label || '');

/* Filters ------------------------------------------------------------ */

function emptyFilters() { return { src: [], svc: [], ep: [], dur: [], adult: '' }; }

function normalizeFilters(raw) {
  const r = objectOr(raw);
  const f = emptyFilters();
  const list = (x, ok) => (Array.isArray(x)
    ? [...new Set(x.map((s) => String(s == null ? '' : s).trim().slice(0, 60)).filter((s) => s && (!ok || ok(s))))].slice(0, 40)
    : []);
  const epKeys = new Set([...EP_BUCKETS.ANIME, ...EP_BUCKETS.MANGA].map((b) => b[0]));
  f.src = list(r.src, (s) => s in SOURCES);
  f.svc = list(r.svc);
  f.ep = list(r.ep, (s) => epKeys.has(s));
  f.dur = list(r.dur, (s) => DUR_BUCKETS.some((b) => b[0] === s));
  f.adult = LV_ADULT.includes(r.adult) ? r.adult : '';
  return f;
}

// Only what's set, in a fixed order (so two can be compared as text).
function packFilters(f) {
  const o = {};
  for (const k of ['src', 'svc', 'ep', 'dur']) if (f[k].length) o[k] = f[k];
  if (f.adult) o.adult = f.adult;
  return o;
}
const filtersEmpty = (f) => !Object.keys(packFilters(f)).length;

function normalizeSaved(raw) {
  const out = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const n = x && String(x.n || '').trim().slice(0, 40);
    if (!n || !['ANIME', 'MANGA'].includes(x.ty)) continue;
    if (out.some((y) => y.ty === x.ty && norm(y.n) === norm(n))) continue;
    const v = packFilters(normalizeFilters(x.v));
    if (!Object.keys(v).length) continue; // nothing left of it (an older kind, with only a sort)
    out.push({ n, ty: x.ty, v });
  }
  return out;
}
const savedFor = (type = S.route && S.route.type) => LV.saved.filter((s) => s.ty === type);

// The filters on this page (none when list views are turned off).
function currentFilters() {
  if (!filtersOn() || !S.route) return emptyFilters();
  return normalizeFilters(LV.filters[S.route.type]);
}

function setFilters(patch) {
  if (!S.route) return;
  const next = packFilters(normalizeFilters({ ...currentFilters(), ...patch }));
  const all = { ...LV.filters };
  if (Object.keys(next).length) all[S.route.type] = next; else delete all[S.route.type];
  LV.filters = all;
  store.set('sync', 'lfilters', LV.filters); // right away: you may open another list the next moment
  filtersChanged();
}

function filtersChanged() {
  if (!S.route) return;
  applyPageSort();
  scheduleFill();
  renderViewPanel();
}

// Filters or saved filters changed in another tab.
function onViewsStorage(what, value) {
  if (what === 'filters') {
    const next = objectOr(value);
    if (stableJSON(next) === stableJSON(LV.filters)) return;
    LV.filters = next;
  } else {
    const next = normalizeSaved(value);
    if (JSON.stringify(next) === JSON.stringify(LV.saved)) return;
    LV.saved = next;
  }
  if (S.route) filtersChanged();
}

/* Matching ---------------------------------------------------------- */

// The hub and Pick for me follow the "Hide NSFW titles" setting (its key is still hideAdult); the filters can say
// otherwise. What counts as NSFW is your choice since 0.12.3 (nsfwOf, content/privacy.js): before, only AniList's
// 18+ mark.
const adultHidden = (e) => !!(e && S.settings.hideAdult && nsfwOf(e));
const adultMode = (f) => f.adult || (S.settings.hideAdult ? 'hide' : 'show');
const totalOf = (e) => (isAnime() ? e.episodes : e.chapters) || null;

function matchesFilters(e, f) {
  const adult = adultMode(f);
  if (adult === 'hide' && nsfwOf(e)) return false;
  if (adult === 'only' && !nsfwOf(e)) return false;
  if (f.src.length && !f.src.includes(e.source)) return false;
  if (f.svc.length && !(e.streams || []).some((s) => f.svc.includes(s))) return false;
  if (f.ep.length && !f.ep.includes(bucketOf(totalOf(e), epBuckets()))) return false;
  if (isAnime() && f.dur.length && !f.dur.includes(bucketOf(e.duration, DUR_BUCKETS))) return false;
  return true;
}

// Filters you picked (the adult switch counts when it's "only").
const filterCount = (f) => f.src.length + f.svc.length + f.ep.length + (isAnime() ? f.dur.length : 0) + (f.adult === 'only' ? 1 : 0);
const filtersHide = (f) => filterCount(f) > 0 || !!(adultMode(f) === 'hide' && dataHasNsfw());
const filtersActive = () => !!S.data && filtersHide(currentFilters());

// The titles of the list(s) on this page, once each.
function viewBase() {
  const seen = new Set(), out = [];
  for (const l of shownLists()) {
    for (const id of l.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const e = S.data.entries.get(id);
      if (e) out.push(e);
    }
  }
  return out;
}

function viewStats(f) {
  let shown = 0, total = 0, adult = 0;
  const hideAdult = adultMode(f) === 'hide';
  for (const e of viewBase()) {
    total++;
    if (hideAdult && nsfwOf(e)) adult++;
    else if (matchesFilters(e, f)) shown++;
  }
  return { shown, total, adult };
}

/* Sorting and groups -------------------------------------------------- */
// Titles in natural order ("Season 2" before "Season 10"), ignoring a leading "The", "A" or "An".

const TITLE_COLL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const titleKeys = new Map();
function titleKey(t) {
  let k = titleKeys.get(t);
  if (k === undefined) {
    k = String(t || '').trim().replace(/^[^\p{L}\p{N}]+/u, '').replace(/^(?:the|an?)\s+/i, '').replace(/^[^\p{L}\p{N}]+/u, '');
    if (titleKeys.size > 5000) titleKeys.clear();
    titleKeys.set(t, k);
  }
  return k;
}
function titleCompare(a, b) {
  return TITLE_COLL.compare(titleKey(a), titleKey(b)) || TITLE_COLL.compare(String(a || ''), String(b || ''));
}

const dateNum = (d) => (d && d.year ? d.year * 10000 + (d.month || 0) * 100 + (d.day || 0) : null);
function sortValue(e, by) {
  switch (by) {
    case 'score': return e.score > 0 ? e.score : null;
    case 'progress': return e.progress || 0;
    case 'updated': return e.updatedAt;
    case 'added': return e.createdAt;
    case 'release': return dateNum(e.release) || (e.year ? e.year * 10000 : null);
    case 'started': return dateNum(e.startedAt);
    case 'completed': return dateNum(e.completedAt);
    case 'avg': return e.avgScore;
    case 'popularity': return e.popularity;
    case 'eps': return totalOf(e);
    case 'length': return e.episodes && e.duration ? e.episodes * e.duration : null; // total minutes
    default: return null;
  }
}
const sortDir = (a) => a.dir || (SORTS[a.by] ? SORTS[a.by].dir : 'asc');
const dirWords = (a) => DIR_WORDS[(SORTS[a.by] || { kind: 'num' }).kind][sortDir(a)];

// Titles with nothing to sort by (no score, no date) go last, whichever way.
function sortCompare(x, y, a) {
  const sign = sortDir(a) === 'desc' ? -1 : 1;
  if (a.by === 'title') return sign * titleCompare(x.title, y.title);
  const p = sortValue(x, a.by), q = sortValue(y, a.by);
  if (p == null || q == null) return p == null && q == null ? titleCompare(x.title, y.title) : p == null ? 1 : -1;
  return sign * (p - q) || titleCompare(x.title, y.title);
}

function groupOf(e, a) {
  const unknown = (label) => ({ key: '?', label, rank: 1e9 });
  const rankIn = (keys, k) => { const i = keys.indexOf(k); return i < 0 ? 500 : i; };
  switch (a.grp) {
    case 'format': return e.format ? { key: e.format, label: FORMATS[e.format] || e.format, rank: rankIn(Object.keys(FORMATS), e.format) } : unknown('Unknown format');
    case 'source': return e.source ? { key: e.source, label: SOURCES[e.source] || e.source, rank: rankIn(Object.keys(SOURCES), e.source) } : unknown('Unknown source');
    case 'decade': {
      if (!e.year) return unknown('Unknown year');
      const d = Math.floor(e.year / 10) * 10;
      return { key: `d${d}`, label: `${d}s`, rank: -d };
    }
    case 'size': {
      const list = epBuckets();
      const k = bucketOf(totalOf(e), list);
      const i = list.findIndex((b) => b[0] === k);
      return i < 0 ? unknown('Unknown length') : { key: k, label: list[i][2], rank: i };
    }
    default: return unknown('Other');
  }
}

// Puts `sorted` (one of AniList's boxes of rows) under group headings; setOrd gives each
// heading and row its place.
function placeGroups(box, sorted, a, entryOfEl, setOrd) {
  // In a grid (AniList's cards), rows can be a fixed height, which a heading would take too.
  // The cards keep the height they had, rows fit what's in them, and the heading sits close
  // to its cards (the grid's own gap is taken back under it).
  const style = getComputedStyle(box);
  if (/grid/.test(style.display) && !box.classList.contains('apq-vgrid')) {
    const first = sorted.find((el) => el.getBoundingClientRect().height > 0);
    if (first) box.style.setProperty('--apq-card-h', `${Math.round(first.getBoundingClientRect().height)}px`);
    box.style.setProperty('--apq-row-gap', `${parseFloat(style.rowGap) || 0}px`);
    box.classList.add('apq-vgrid');
  }
  const buckets = new Map();
  const hidden = [];
  for (const el of sorted) {
    if (el.hasAttribute('data-apq-vhide')) { hidden.push(el); continue; }
    const e = entryOfEl(el);
    const g = e ? groupOf(e, a) : { key: '?', label: 'Other', rank: 1e9 };
    if (!buckets.has(g.key)) buckets.set(g.key, { ...g, els: [] });
    buckets.get(g.key).els.push(el);
  }
  const order = [...buckets.values()].sort((x, y) => x.rank - y.rank || x.label.localeCompare(y.label));
  const heads = box._apqHeads || (box._apqHeads = new Map());
  const used = new Set();
  let n = 0;
  for (const b of order) {
    const hk = `${a.grp}:${b.key}`;
    let head = heads.get(hk);
    if (!head) {
      head = h('div', { class: 'apq-ui apq-vgroup', role: 'heading', 'aria-level': '4' },
        h('span', { class: 'apq-vgroup-label' }), h('span', { class: 'apq-vgroup-n' }), h('span', { class: 'apq-vgroup-rule' }));
      heads.set(hk, head);
    }
    const [label, count] = head.children;
    if (label.textContent !== b.label) label.textContent = b.label;
    if (count.textContent !== String(b.els.length)) count.textContent = String(b.els.length);
    if (head.parentElement !== box) box.append(head);
    setOrd(head, ++n);
    used.add(hk);
    for (const el of b.els) setOrd(el, ++n);
  }
  for (const el of hidden) setOrd(el, ++n);
  for (const [k, head] of heads) if (!used.has(k)) { head.remove(); heads.delete(k); }
}

function removeGroupHeads(box) {
  box.classList.remove('apq-vgrid');
  box.style.removeProperty('--apq-card-h');
  box.style.removeProperty('--apq-row-gap');
  if (!box._apqHeads) return;
  for (const head of box._apqHeads.values()) head.remove();
  box._apqHeads.clear();
}

/* The page ------------------------------------------------------------ */

// A section's name, as AniList shows it above its rows ("Watching", "Planning", a custom list).
function sectionHead(w) {
  const k = w._apqHead;   // (kept while it's still this list's: every pass asks, 0.12.8)
  if (k && k.parentNode && k.closest('.list-wrap') === w) return k;
  for (const el of w.querySelectorAll('.section-name')) if (!el.closest('.apq-ui') && el.closest('.list-wrap') === w) { w._apqHead = el; return el; }
  return null;
}
function sectionName(w) {
  const head = sectionHead(w);
  if (!head) return '';
  return [...head.childNodes].filter((n) => !(n.nodeType === 1 && n.classList.contains('apq-ui'))).map((n) => n.textContent).join('').trim();
}

// Hides the rows the filters don't match, and sections left with nothing; puts the sort
// buttons on each list's title, and the filters and the Posters icon in AniList's own controls.
// Called by applyPageSort.
function markView(els, f) {
  const d = S.data;
  const hiding = !!d && filtersHide(f);
  for (const el of els) {
    const e = hiding ? d.entries.get(Number(el.dataset.apqId || mediaIdOf(el))) : null;
    const hide = !!(e && !matchesFilters(e, f));
    if (el.hasAttribute('data-apq-vhide') !== hide) el.toggleAttribute('data-apq-vhide', hide);
  }
  for (const w of document.querySelectorAll('.list-wrap')) {
    if (w.closest('.apq-ui')) continue;
    let empty = false;
    if (hiding) {
      const rows = w.querySelectorAll('[data-apq-id]');
      empty = rows.length > 0 && Array.from(rows).every((r) => r.hasAttribute('data-apq-vhide'));
    }
    if (w.hasAttribute('data-apq-vempty') !== empty) w.toggleAttribute('data-apq-vempty', empty);
    placeSortChip(w);
  }
  placeListChrome();
}

function clearViewMarks() {
  closeViewPanel();
  closeSortMenu();
  document.querySelectorAll('[data-apq-vhide]').forEach((n) => n.removeAttribute('data-apq-vhide'));
  document.querySelectorAll('[data-apq-vempty]').forEach((n) => n.removeAttribute('data-apq-vempty'));
  document.querySelectorAll('.apq-sort-chip').forEach((n) => n.remove());
  removeFilters();
  placeLayoutSwitch();
}

/* Each list's sort button ---------------------------------------------- */

// A list in AniList's own order (its sidebar's Sort) shows "Sort" only while you point at its title; a list
// with a sort of its own says which, in quiet text next to its title (0.7.1; it was a boxed button on every list).
function sortChipText(a) {
  if (a.by === 'al') {
    const al = aniListSortValue();
    return { main: 'Sort', set: false, tip: al ? `In AniList's order (its Sort: ${al}). Click to sort this list another way` : 'In AniList\'s order. Click to sort this list another way' };
  }
  const main = a.by === 'prio' ? 'Priority' : `${sortLabel(a.by)}`;
  return { main, set: true, tip: a.by === 'prio' ? (S.settings.dir === 'asc' ? 'Lowest priority first' : 'Highest priority first') : dirWords(a) };
}

function fillSortChip(chip, key) {
  const a = arrangementOf(key);
  const t = sortChipText(a);
  const desc = a.by === 'prio' ? S.settings.dir !== 'asc' : sortDir(a) === 'desc';
  const sig = `${a.by}|${a.dir}|${a.grp}|${t.main}|${desc}|${S.settings.dir}`;
  if (chip.dataset.sig === sig) return;
  chip.dataset.sig = sig;
  chip.classList.toggle('is-set', t.set || !!a.grp);
  chip.replaceChildren(...[h('span', { class: 'apq-sort-chip-main' }, t.main),
    t.set && a.by !== 'title' ? icon(desc ? 'arrowDown' : 'arrowUp', 'apq-sort-chip-dir') : null,
    a.grp ? h('span', { class: 'apq-sort-chip-grp' }, `grouped by ${GROUP_LABELS[a.grp].toLowerCase()}`) : null,
    icon('chevron', 'apq-sort-chip-chev')].filter(Boolean));
  chip.title = `${t.tip}${a.grp ? `, grouped by ${GROUP_LABELS[a.grp].toLowerCase()}` : ''}`;
  chip.setAttribute('aria-label', `Sort: ${t.main}${a.grp ? `, grouped by ${GROUP_LABELS[a.grp].toLowerCase()}` : ''}. Change`);
}

function makeSortChip() {
  const chip = h('button', { type: 'button', class: 'apq-ui apq-sort-chip', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
  chip.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (LV.menu && LV.menu.chip === chip) closeSortMenu();
    else openSortMenu(chip);
  });
  return chip;
}

// On a section's title, the button that shows and changes that list's sort. Returns true if placed.
function placeSortChip(w) {
  const head = sectionHead(w);
  const name = sectionName(w);
  if (!head || !name || !S.data || !sortsOn()) {
    const old = w.querySelector('.apq-sort-chip');
    if (old) old.remove();
    return false;
  }
  const key = S.route.list ? listKey() : keyFor(S.route.type, name);
  let chip = head.querySelector(':scope > .apq-sort-chip');
  if (!chip) { chip = makeSortChip(); head.append(chip); }
  chip.dataset.key = key;
  chip.dataset.name = S.route.list && !name ? S.route.list : name;
  fillSortChip(chip, key);
  return true;
}

function openSortMenu(chip) {
  if (!chip || !S.data) return;
  closeSortMenu();
  closeViewPanel();
  hideTip();
  const el = h('div', { class: 'apq-ui apq-sort-menu', role: 'dialog', 'aria-label': `Sort ${chip.dataset.name}` });
  LV.menu = { key: chip.dataset.key, name: chip.dataset.name, chip, el };
  chip.setAttribute('aria-expanded', 'true');
  document.body.append(el);
  renderSortMenu();
  requestAnimationFrame(() => { if (LV.menu && LV.menu.el === el) el.classList.add('is-open'); });
  setTimeout(() => document.addEventListener('pointerdown', onSortMenuOutside, true), 0);
}

// Opens the sort menu of this page's list (or the first list on "All"), from the palette.
function openSortMenuHere() {
  applyPageSort();
  const chip = document.querySelector('.apq-sort-chip');
  if (chip) openSortMenu(chip);
}

function closeSortMenu() {
  if (!LV.menu) return;
  document.removeEventListener('pointerdown', onSortMenuOutside, true);
  LV.menu.el.remove();
  if (LV.menu.chip) LV.menu.chip.setAttribute('aria-expanded', 'false');
  LV.menu = null;
}

function onSortMenuOutside(ev) {
  const t = ev.target;
  if (LV.menu && !LV.menu.el.contains(t) && !LV.menu.chip.contains(t) && !(t.closest && t.closest('.apq-toast'))) closeSortMenu();
}

function positionSortMenu() {
  const m = LV.menu;
  if (!m) return;
  if (!m.chip.isConnected) {
    // AniList drew the title again: follow the new button for the same list.
    const again = [...document.querySelectorAll('.apq-sort-chip')].find((c) => c.dataset.key === m.key);
    if (!again) { closeSortMenu(); return; }
    m.chip = again;
    again.setAttribute('aria-expanded', 'true');
  }
  const r = m.chip.getBoundingClientRect();
  const w = Math.min(360, window.innerWidth - 16);
  m.el.style.width = `${w}px`;
  const top = clamp(r.bottom + 8, 8, Math.max(8, window.innerHeight - 240));
  m.el.style.top = `${top}px`;
  m.el.style.maxHeight = `${window.innerHeight - top - 8}px`;
  m.el.style.left = `${clamp(r.left, 8, window.innerWidth - w - 8)}px`;
}

function pickListSort(key, by) {
  const a = arrangementOf(key);
  if (a.by === by && by !== 'al') return;
  setArrangement(key, { by, dir: '' });
  arrangementChanged();
}

function renderSortMenu() {
  const m = LV.menu;
  for (const chip of document.querySelectorAll('.apq-sort-chip')) fillSortChip(chip, chip.dataset.key);
  if (!m) return;
  if (!S.data || !S.route || !sortsOn()) { closeSortMenu(); return; }
  const a = arrangementOf(m.key);
  const anime = isAnime();
  const al = aniListSortValue();
  const item = (by, label, tip) => h('button', {
    type: 'button', role: 'radio', class: 'apq-sort-item', 'aria-checked': String(a.by === by), 'data-k': `sort:${by}`,
    title: tip || null, onclick: () => pickListSort(m.key, by),
  }, h('span', {}, label), a.by === by ? icon('check') : null);
  const items = [item('al', 'AniList\'s order', al ? `AniList's Sort menu: ${al}` : 'As AniList shows it')];
  if (prioOn(m.key)) items.push(item('prio', 'Priority'));
  for (const [by, s] of Object.entries(SORTS)) if (!s.anime || anime) items.push(item(by, sortLabel(by), s.tip));
  let dirBtn = null;
  if (a.by === 'prio') {
    const desc = S.settings.dir !== 'asc';
    dirBtn = h('button', {
      type: 'button', class: 'apq-lv-dir', 'data-k': 'dir',
      onclick: () => { S.settings.dir = desc ? 'asc' : 'desc'; saveSettings(); arrangementChanged(); if (D.drawer) renderDrawerList({ animate: true }); },
    }, icon(desc ? 'desc' : 'asc'), desc ? 'Highest first' : 'Lowest first');
  } else if (a.by !== 'al') {
    const d = sortDir(a);
    dirBtn = h('button', {
      type: 'button', class: 'apq-lv-dir', 'data-k': 'dir',
      onclick: () => { setArrangement(m.key, { dir: d === 'asc' ? 'desc' : 'asc' }); arrangementChanged(); },
    }, icon(d === 'asc' ? 'asc' : 'desc'), dirWords(a));
  }
  const groups = [['', 'None'], ['format', 'Format']];
  if (S.data.viewFields) groups.push(['source', 'Source']);
  groups.push(['decade', 'Decade'], ['size', 'Length']);
  const seg = h('div', { class: 'apq-lv-seg', role: 'radiogroup', 'aria-label': 'Group by' }, groups.map(([g, label]) => h('button', {
    type: 'button', role: 'radio', class: 'apq-lv-seg-btn', 'aria-checked': String(a.grp === g), 'data-k': `grp:${g || 'none'}`,
    onclick: () => { setArrangement(m.key, { grp: g }); arrangementChanged(); },
  }, label)));
  // This list's priorities: on or off. Custom lists keep their own, apart from AniList's.
  const on = prioOn(m.key);
  const meta = listMeta(m.key);
  const custom = !!(meta && meta.custom);
  const prioSwitch = h('button', {
    type: 'button', role: 'switch', class: 'apq-set-row apq-sort-prio', 'aria-checked': String(on), 'data-k': 'prio-switch',
    onclick: () => {
      setPrioOn(m.key, !on);
      decoratePage();
      scheduleRefresh();
      if (D.drawer) renderDrawerChrome();
      renderSortMenu();
      toast(on ? `No priorities in ${m.name}` : `Priorities back in ${m.name}`);
    },
  }, h('span', { class: 'apq-set-text' },
    h('span', { class: 'apq-set-title' }, 'Priorities'),
    h('span', { class: 'apq-set-desc' }, custom
      ? 'Badges, number keys and pins, kept for this list only (not AniList\'s priority).'
      : on ? 'Badges, number keys, pins and the priority sort in this list.' : 'Off: a small button on each title still opens its score, lists and history.')),
  h('span', { class: 'apq-switch', 'aria-hidden': 'true' }));
  const scroll = m.el.querySelector('.apq-sort-scroll');
  const st = scroll ? scroll.scrollTop : 0;
  m.el.replaceChildren(
    h('header', { class: 'apq-lv-top' },
      h('span', { class: 'apq-lv-title' }, `Sort ${m.name}`),
      h('button', { type: 'button', class: 'apq-icon-btn', 'aria-label': 'Close', onclick: () => closeSortMenu() }, icon('x'))),
    h('div', { class: 'apq-sort-scroll' },
      h('section', { class: 'apq-lv-sec' },
        h('div', { class: 'apq-lv-head' }, h('span', { class: 'apq-lv-label' }, 'Sort by'), dirBtn),
        h('div', { class: 'apq-sort-items', role: 'radiogroup', 'aria-label': 'Sort by' }, items)),
      h('section', { class: 'apq-lv-sec' },
        h('div', { class: 'apq-lv-head' }, h('span', { class: 'apq-lv-label' }, 'Group by')),
        seg),
      S.data.canEdit ? h('section', { class: 'apq-lv-sec' }, prioSwitch) : null),
    h('footer', { class: 'apq-lv-foot' }, h('span', {}, a.by === 'prio' && S.data.canEdit
      ? (postersOn() ? 'Drag a poster to order it among the titles of its priority.' : 'Inside one priority, the order is yours: drag the titles in the hub, or the posters here.')
      : S.route.list ? `Kept for ${m.name}, here and in All.` : `Kept for ${m.name}, here and on its own page.`)));
  const sc = m.el.querySelector('.apq-sort-scroll');
  if (sc) sc.scrollTop = st;
  positionSortMenu();
}

/* Filters, in AniList's own sidebar ------------------------------------- */
// AniList's list pages have a sidebar (read from its bundle on 2026-11-11): .filters-wrap > .filters >
// .filter-group, each a .group-header and its controls: Lists, then Filters (Format, Status, Genres & Tags,
// Country: element-ui dropdowns), Year, Sort. Tsugi's filters join the Filters group as the same kind of
// dropdown, after Country, drawn with AniList's own sizes and colors (styles.js, "Filters in AniList's
// sidebar"). The Filters heading says how many titles they leave ("38 of 444", with a clear button, like
// AniList's Year heading shows its year), and a save button shows on it while you point at the group, like
// AniList's own button to reorder the Lists. Saved filters get a group of their own under Filters, like Lists.
// On phones AniList folds its sidebar behind its "···" button, and these go with it. They're put in the moment
// AniList draws the sidebar, before any data (the page observer calls placeListChrome), so nothing pops in.
// A page without that sidebar gets the same dropdowns above its first list (LV.bar).

// AniList's "Filters" group in the sidebar of a list page.
function filtersGroup() {
  const groups = [...document.querySelectorAll('.filters-wrap .filter-group')].filter((g) => !g.closest('.apq-ui'));
  const headText = (g) => {
    const hd = g.querySelector(':scope > .group-header');
    return hd ? [...hd.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() : '';
  };
  return groups.find((g) => headText(g) === 'Filters')
    || groups.find((g) => g.querySelectorAll(':scope > .el-select').length >= 2) || null;
}

// The list above which the dropdowns go when there's no sidebar.
function viewAnchor() {
  for (const w of document.querySelectorAll('.list-wrap')) if (!w.closest('.apq-ui')) return w;
  const first = findEntries()[0];
  return first ? first.closest('.list-entries') || first.parentElement : null;
}

// Whether this list has NSFW titles, remembered per type (local "lv:adult"), so the NSFW titles dropdown is
// there from the start instead of appearing once the list's data is in.
function adultSeen() {
  const type = S.route && S.route.type;
  const d = S.data;
  if (d && d.viewFields) {
    const has = dataHasNsfw();
    if (!!LV.adultSeen[type] !== has) {
      LV.adultSeen = { ...LV.adultSeen, [type]: has };
      store.set('local', 'lv:adult', LV.adultSeen);
    }
    return has;
  }
  return !!LV.adultSeen[type];
}

// The dropdowns, in order. Options are [value, label, count]; counts need the list's data.
function filterDefs(f) {
  const d = S.data;
  const anime = isAnime();
  const base = d ? viewBase() : [];
  const counts = (fn) => {
    const m = new Map();
    for (const e of base) for (const k of [].concat(fn(e) || [])) if (k) m.set(k, (m.get(k) || 0) + 1);
    return m;
  };
  const byCount = (m, extra) => [...new Set([...[...m.keys()].sort((a, b) => m.get(b) - m.get(a) || String(a).localeCompare(String(b))), ...extra])];
  const defs = [];
  const rich = !d || d.viewFields; // AniList sent the source, streaming sites and adult flag (the usual case)
  if (rich) {
    const src = counts((e) => e.source);
    defs.push({ key: 'src', label: 'Source', opts: byCount(src, f.src).map((k) => [k, SOURCES[k] || k, src.get(k) || 0]), empty: 'No sources in this list' });
    const svc = counts((e) => e.streams);
    const all = byCount(svc, f.svc);
    defs.push({
      key: 'svc', label: anime ? 'Streaming on' : 'Read on', find: all.length > 10, opts: all.map((k) => [k, k, svc.get(k) || 0]),
      empty: anime ? 'No streaming sites in this list' : 'No reading sites in this list',
    });
  }
  const eps = counts((e) => bucketOf(totalOf(e), epBuckets()));
  defs.push({ key: 'ep', label: anime ? 'Episodes' : 'Chapters', opts: epBuckets().map(([k, , long]) => [k, long, eps.get(k) || 0]) });
  if (anime) {
    const dur = counts((e) => bucketOf(e.duration, DUR_BUCKETS));
    defs.push({ key: 'dur', label: 'Episode length', opts: DUR_BUCKETS.map(([k, label]) => [k, label, dur.get(k) || 0]) });
  }
  if (rich && (adultSeen() || f.adult)) {
    defs.push({
      key: 'adult', label: 'NSFW titles', single: true,
      ph: S.settings.hideAdult ? 'NSFW titles hidden' : 'NSFW titles',
      opts: [['show', 'Show NSFW titles'], ['hide', 'Hide NSFW titles'], ['only', 'Only NSFW titles']],
    });
  }
  return defs;
}

const pickedIn = (def, f) => (def.single ? (f.adult ? [f.adult] : []) : f[def.key]);
const optLabel = (def, v) => { const o = def.opts.find((x) => x[0] === v); return o ? o[1] : (def.key === 'src' ? SOURCES[v] || v : v); };

// Everything Tsugi adds to a list page's chrome: the filters and the Posters button in AniList's layout switch.
// Cheap when nothing changed, so the page observer can call it on every change.
function placeListChrome() {
  placeFilters();
  placeLayoutSwitch();
}

function placeFilters() {
  if (!filtersOn() || !S.route) { removeFilters(); return; }
  if (!LV.side) buildFilters();
  const group = filtersGroup();
  if (group) {
    if (LV.bar) { LV.bar.remove(); LV.bar = null; }
    if (group.lastElementChild !== LV.side) group.append(LV.side);
    const head = group.querySelector(':scope > .group-header');
    if (head) {
      if (LV.saveAct.parentElement !== head) head.append(LV.saveAct);
      if (LV.headVal.parentElement !== head) head.append(LV.headVal);
    }
    if (group.nextElementSibling !== LV.savedGroup) group.after(LV.savedGroup);
  } else {
    const anchor = viewAnchor();
    if (!anchor) return;
    if (!LV.bar) {
      LV.bar = h('div', { class: 'apq-ui apq-lv-bar' },
        h('div', { class: 'apq-lv-barhead' }, h('span', {}, 'Filters'), LV.saveAct, LV.headVal), LV.side, LV.savedGroup);
    }
    if (LV.bar.nextElementSibling !== anchor) anchor.before(LV.bar);
  }
  renderFilters();
}

function removeFilters() {
  closeDrop();
  for (const k of ['side', 'saveAct', 'headVal', 'savedGroup', 'bar']) if (LV[k]) LV[k].remove();
  LV.bar = null;
  LV.naming = false;
}

function buildFilters() {
  LV.side = h('div', { class: 'apq-ui apq-lvf', role: 'group', 'aria-label': 'Tsugi\'s filters' });
  LV.saveAct = h('span', {
    class: 'apq-ui apq-lvf-act', role: 'button', tabindex: '0', 'aria-label': 'Save these filters', 'data-tip': 'Save these filters',
    onclick: (ev) => { ev.stopPropagation(); startNaming(); },
    onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); startNaming(); } },
  }, icon('bookmark'));
  LV.headClear = h('span', {
    class: 'apq-lvf-clear', role: 'button', tabindex: '0', 'aria-label': 'Clear Tsugi\'s filters', 'data-tip': 'Clear these filters',
    onclick: (ev) => { ev.stopPropagation(); resetFilters(); },
    onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); resetFilters(); } },
  }, icon('xCircle'));
  LV.headN = h('span', { class: 'apq-lvf-n', role: 'status' });
  LV.headVal = h('span', { class: 'apq-ui apq-lvf-val' }, LV.headClear, LV.headN);
  LV.savedGroup = h('div', { class: 'apq-ui apq-lvs', role: 'group', 'aria-label': 'Saved filters' });
  LV.boxes = new Map();
}

// Draws the dropdowns, the Filters heading's count, the saved filters and the open dropdown's options.
function renderFilters() {
  if (!LV.side) return;
  const f = currentFilters();
  const defs = filterDefs(f);
  LV.defs = defs;
  // AniList didn't send the source, streaming sites and adult flag (a 400 to the richer request): those are off.
  const poor = !!S.data && !S.data.viewFields;
  const keys = defs.map((d) => d.key).join() + (poor ? '|poor' : '');
  if (LV.side.dataset.keys !== keys) {
    LV.side.dataset.keys = keys;
    LV.side.replaceChildren(...defs.map((d) => boxFor(d)),
      ...(poor ? [h('p', { class: 'apq-lvf-note' }, 'AniList didn\'t send the source, streaming sites and NSFW titles this time, so those filters are off. Reload the page to try again.')] : []));
  }
  for (const d of defs) fillBox(LV.boxes.get(d.key), d, f);
  renderFilterHead(f);
  renderSaved(f);
  renderDrop();
}
// Older names, still called from elsewhere.
function renderViewPanel() { renderFilters(); }
function renderViewBar() { renderFilters(); }

function renderFilterHead(f) {
  const nf = filterCount(f);
  const d = S.data;
  const st = d ? viewStats(f) : null;
  const active = !filtersEmpty(f);
  const txt = !st ? '' : nf ? `${st.shown} of ${st.total}` : st.adult ? `${st.adult} NSFW hidden` : '';
  if (LV.headN.textContent !== txt) LV.headN.textContent = txt;
  LV.headVal.hidden = !txt;
  LV.headClear.hidden = !active;
  LV.headVal.classList.toggle('is-empty', !!st && nf > 0 && st.shown === 0);
  LV.headVal.title = txt ? `Tsugi's filters show ${st.shown} of your ${plural(st.total)}. They stay on for all your ${typeWord()} lists until you clear them.` : '';
  LV.saveAct.hidden = !active;
}

function boxFor(def) {
  let box = LV.boxes.get(def.key);
  if (!box) {
    box = h('div', {
      class: 'apq-sel', 'data-key': def.key, role: 'combobox', tabindex: '0', 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
      'aria-controls': 'apq-sel-drop',
    });
    box.addEventListener('click', () => { if (LV.drop && LV.drop.key === def.key) closeDrop(); else openDrop(def.key); });
    box.addEventListener('keydown', (ev) => onSelKey(ev, def.key));
    LV.boxes.set(def.key, box);
  }
  return box;
}

function fillBox(box, def, f) {
  const open = !!LV.drop && LV.drop.key === def.key;
  const picked = pickedIn(def, f);
  const finding = !!def.find && open;
  const sig = JSON.stringify([def.label, def.ph, picked.map((v) => optLabel(def, v)), open, finding]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  const kids = [];
  if (def.single) {
    kids.push(picked.length ? h('span', { class: 'apq-sel-val' }, optLabel(def, picked[0])) : h('span', { class: 'apq-sel-ph' }, def.ph || def.label));
  } else {
    if (picked.length) {
      kids.push(h('span', { class: 'apq-sel-tags' }, picked.map((v) => h('span', { class: 'apq-sel-tag' },
        h('span', { class: 'apq-sel-tag-t' }, optLabel(def, v)),
        h('span', {
          class: 'apq-sel-tag-x', role: 'button', 'aria-label': `Remove ${optLabel(def, v)}`,
          onclick: (ev) => { ev.stopPropagation(); toggleIn(def.key, v); },
        }, icon('x'))))));
    }
    if (finding) kids.push(findInput(def, picked.length > 0));
    else if (!picked.length) kids.push(h('span', { class: 'apq-sel-ph' }, def.label));
  }
  kids.push(h('span', { class: 'apq-sel-caret', 'aria-hidden': 'true' }, icon('chevron')));
  if (picked.length) {
    kids.push(h('span', {
      class: 'apq-sel-clear', role: 'button', 'aria-label': `Clear ${def.label}`,
      onclick: (ev) => { ev.stopPropagation(); clearFilter(def.key); },
    }, icon('xCircle')));
  }
  box.replaceChildren(...kids);
  box.classList.toggle('is-open', open);
  box.classList.toggle('is-set', picked.length > 0);
  box.classList.toggle('is-finding', finding);
  box.setAttribute('aria-expanded', String(open));
  box.setAttribute('aria-label', def.label + (picked.length ? `: ${picked.map((v) => optLabel(def, v)).join(', ')}` : ''));
  if (finding) {
    const input = LV.findEl;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
  }
}

// The box you type in to find a streaming site (like AniList's Genres & Tags). Kept, so a redraw keeps its text.
function findInput(def, hasTags) {
  if (!LV.findEl) {
    LV.findEl = h('input', {
      type: 'text', class: 'apq-sel-input', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Find a site', 'data-k': 'svc-find',
    });
    LV.findEl.addEventListener('input', () => { LV.find = LV.findEl.value; if (LV.drop) LV.drop.hover = -1; renderDrop(); });
    LV.findEl.addEventListener('click', (ev) => ev.stopPropagation());
    LV.findEl.addEventListener('keydown', (ev) => { if (LV.drop) onSelKey(ev, LV.drop.key, true); });
  }
  LV.findEl.placeholder = hasTags ? '' : def.label;
  if (LV.findEl.value !== LV.find) LV.findEl.value = LV.find;
  return LV.findEl;
}

function clearFilter(key) {
  if (key === 'adult') setFilters({ adult: '' });
  else setFilters({ [key]: [] });
}

/* The open dropdown ---------------------------------------------------- */

function openDrop(key) {
  const box = LV.boxes && LV.boxes.get(key);
  if (!box || !box.isConnected) return;
  closeDrop();
  closeSortMenu();
  closePopover(false);
  hideTip();
  const el = h('div', { class: 'apq-ui apq-sel-drop', id: 'apq-sel-drop', role: 'listbox', 'data-key': key });
  el.addEventListener('mousedown', (ev) => { if (ev.target !== LV.findEl) ev.preventDefault(); }); // keeps the focus in the box
  LV.drop = { key, el, hover: -1, opts: [] };
  LV.find = '';
  document.body.append(el);
  renderFilters();
  if (document.activeElement !== LV.findEl) box.focus({ preventScroll: true });
  requestAnimationFrame(() => { if (LV.drop && LV.drop.el === el) el.classList.add('is-open'); });
  setTimeout(() => document.addEventListener('pointerdown', onDropOutside, true), 0);
}

function closeDrop() {
  const dr = LV.drop;
  if (!dr) return;
  document.removeEventListener('pointerdown', onDropOutside, true);
  dr.el.remove();
  LV.drop = null;
  LV.find = '';
  const box = LV.boxes && LV.boxes.get(dr.key);
  const focused = !!LV.findEl && document.activeElement === LV.findEl;
  const def = (LV.defs || []).find((d) => d.key === dr.key);
  if (box && def) fillBox(box, def, currentFilters());
  if (focused && box && box.isConnected) box.focus({ preventScroll: true });
}

function onDropOutside(ev) {
  const t = ev.target;
  if (!LV.drop) return;
  const box = LV.boxes.get(LV.drop.key);
  if (LV.drop.el.contains(t) || (box && box.contains(t)) || (t.closest && t.closest('.apq-toast'))) return;
  closeDrop();
}

function renderDrop() {
  const dr = LV.drop;
  if (!dr) return;
  const def = (LV.defs || []).find((d) => d.key === dr.key);
  const box = LV.boxes.get(dr.key);
  if (!def || !box || !box.isConnected) { closeDrop(); return; }
  const f = currentFilters();
  const picked = def.single ? [adultMode(f)] : f[def.key];
  const q = norm(LV.find.trim());
  const opts = def.opts.filter(([, label]) => !q || norm(label).includes(q));
  dr.opts = opts;
  if (dr.hover >= opts.length) dr.hover = opts.length - 1;
  const counts = !!S.data && !def.single;
  // Drawn again only when what it shows changed: the page arranges itself often, and a new list would
  // stop a scroll in progress.
  const sig = JSON.stringify([def.key, def.label, opts, picked, counts, q, def.empty]);
  if (dr.sig === sig && dr.el.firstChild) {
    dr.el.querySelectorAll('.apq-sel-item').forEach((el, k) => el.classList.toggle('is-hover', k === dr.hover));
    positionDrop();
    return;
  }
  dr.sig = sig;
  const old = dr.el.querySelector('.apq-sel-list');
  const top = old ? old.scrollTop : 0;
  const items = opts.map(([v, label, n], i) => {
    const on = picked.includes(v);
    return h('div', {
      class: 'apq-sel-item' + (on ? ' is-on' : '') + (i === dr.hover ? ' is-hover' : ''), role: 'option', id: `apq-sel-o${i}`,
      'aria-selected': String(on), 'data-v': v, onclick: () => pickOption(def, v),
      onmousemove: () => { if (dr.hover !== i) setDropHover(i, false); },
    }, h('span', { class: 'apq-sel-item-t' }, label), counts ? h('span', { class: 'apq-sel-n' }, String(n)) : null,
    on ? icon('check', 'apq-sel-tick') : null);
  });
  const list = h('div', { class: 'apq-sel-list', 'aria-multiselectable': def.single ? null : 'true' },
    items.length ? items : h('p', { class: 'apq-sel-empty' }, q ? 'No match' : def.empty || 'Nothing to pick in this list'));
  dr.el.setAttribute('aria-label', def.label);
  dr.el.replaceChildren(h('span', { class: 'apq-sel-arrow', 'aria-hidden': 'true' }), list);
  list.scrollTop = top;
  box.setAttribute('aria-activedescendant', dr.hover >= 0 ? `apq-sel-o${dr.hover}` : '');
  positionDrop();
}

function setDropHover(i, scroll = true) {
  const dr = LV.drop;
  if (!dr) return;
  dr.hover = i;
  const items = dr.el.querySelectorAll('.apq-sel-item');
  items.forEach((el, k) => el.classList.toggle('is-hover', k === i));
  const box = LV.boxes.get(dr.key);
  if (box) box.setAttribute('aria-activedescendant', i >= 0 ? `apq-sel-o${i}` : '');
  if (scroll && items[i]) items[i].scrollIntoView({ block: 'nearest' });
}

function pickOption(def, v) {
  if (def.single) {
    setFilters({ adult: v });
    closeDrop();
    return;
  }
  toggleIn(def.key, v);
  if (LV.findEl && LV.find) { LV.find = ''; LV.findEl.value = ''; renderDrop(); }
}

function onSelKey(ev, key, typing = false) {
  const open = !!LV.drop && LV.drop.key === key;
  const k = ev.key;
  const handled = () => { ev.preventDefault(); ev.stopPropagation(); };
  if (!open) {
    if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') { handled(); openDrop(key); }
    return;
  }
  const n = LV.drop.opts.length;
  if (k === 'ArrowDown') { handled(); setDropHover(n ? (LV.drop.hover + 1) % n : -1); }
  else if (k === 'ArrowUp') { handled(); setDropHover(n ? (LV.drop.hover <= 0 ? n - 1 : LV.drop.hover - 1) : -1); }
  else if (k === 'Enter' || (k === ' ' && !typing)) {
    handled();
    const o = LV.drop.opts[LV.drop.hover];
    const def = LV.defs.find((d) => d.key === key);
    if (o && def) pickOption(def, o[0]);
  } else if (k === 'Escape') { handled(); closeDrop(); }
  else if (k === 'Tab') closeDrop();
  else if (typing) ev.stopPropagation(); // letters typed to find a site aren't shortcuts
}

// Under its box like AniList's (12 px down, an arrow 35 px from the left), above it when there's no room
// below. Fixed, so it follows the box as the page scrolls (main.js calls this on scroll and resize).
function positionDrop() {
  const dr = LV.drop;
  if (!dr) return;
  const box = LV.boxes.get(dr.key);
  if (!box || !box.isConnected) { closeDrop(); return; }
  const r = box.getBoundingClientRect();
  const w = Math.max(r.width, 200);
  const left = clamp(r.left, 8, Math.max(8, window.innerWidth - w - 8));
  dr.el.style.minWidth = `${w}px`;
  dr.el.style.maxWidth = `${Math.max(w, 300)}px`;
  dr.el.style.left = `${left}px`;
  const below = window.innerHeight - r.bottom - 20;
  const above = r.top - 20;
  const up = below < 160 && above > below;
  const room = Math.max(80, Math.min(286, up ? above : below));
  dr.el.style.setProperty('--apq-sel-max', `${room - 12}px`);
  dr.el.classList.toggle('is-up', up);
  dr.el.style.top = up ? '' : `${r.bottom + 12}px`;
  dr.el.style.bottom = up ? `${window.innerHeight - r.top + 12}px` : '';
  const arrow = dr.el.querySelector('.apq-sel-arrow');
  if (arrow) arrow.style.left = `${clamp(r.left + 35 - left, 12, w - 24)}px`;
}
function positionViewPanel() { positionSortMenu(); positionDrop(); }

// The V key and the palette's "Filter your lists": opens the first dropdown (and AniList's folded sidebar on a phone).
function openViewPanel() {
  if (!filtersOn() || !S.route) return;
  closeDrawer();
  closePopover(false);
  closePick();
  closeSortMenu();
  placeFilters();
  const wrap = LV.side && LV.side.closest('.filters');
  if (wrap && wrap.classList.contains('mobile-nav-hidden')) {
    const toggle = document.querySelector('.filters-wrap .filter-toggle');
    if (toggle) toggle.click();
  }
  const first = LV.defs && LV.defs[0] && LV.boxes.get(LV.defs[0].key);
  if (!first || !first.isConnected) { toast('Wait for the list to show, then try again', 'error'); return; }
  first.scrollIntoView({ block: 'nearest' });
  openDrop(LV.defs[0].key);
}
function toggleViewPanel() { if (LV.drop) closeDrop(); else openViewPanel(); }
function closeViewPanel() { closeDrop(); }

/* Saved filters --------------------------------------------------------- */

const savedIsOn = (sv, f) => JSON.stringify(sv.v) === JSON.stringify(packFilters(f));

function startNaming() {
  if (filtersEmpty(currentFilters())) { toast('Pick a filter first', 'error'); return; }
  LV.naming = true;
  renderFilters();
  if (LV.nameEl) { LV.nameEl.focus(); LV.nameEl.select(); }
}

function stopNaming() {
  if (!LV.naming) return;
  LV.naming = false;
  if (LV.nameEl) LV.nameEl.value = '';
  renderFilters();
}

function nameInput() {
  if (!LV.nameEl) {
    LV.nameEl = h('input', {
      type: 'text', class: 'apq-lvs-input', placeholder: 'Name these filters', 'aria-label': 'Name these filters',
      maxlength: '40', spellcheck: 'false', autocomplete: 'off', 'data-k': 'save-name',
    });
    LV.nameEl.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); if (saveFilters(LV.nameEl.value)) stopNaming(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); stopNaming(); }
    });
    LV.nameEl.addEventListener('blur', () => { setTimeout(() => { if (LV.nameEl && document.activeElement !== LV.nameEl && !LV.nameEl.value.trim()) stopNaming(); }, 150); });
  }
  return LV.nameEl;
}

function renderSaved(f) {
  const g = LV.savedGroup;
  if (!g) return;
  const mine = savedFor();
  const show = mine.length > 0 || LV.naming;
  g.hidden = !show;
  if (!show) { g.dataset.sig = ''; return; }
  const sig = JSON.stringify([mine.map((sv) => [sv.n, savedIsOn(sv, f)]), LV.naming]);
  if (g.dataset.sig === sig) return;
  g.dataset.sig = sig;
  const items = mine.map((sv) => {
    const on = savedIsOn(sv, f);
    const run = () => (on ? resetFilters(true) : applySavedFilters(sv));
    return h('span', {
      class: 'apq-lvs-item' + (on ? ' is-on' : ''), role: 'button', tabindex: '0', 'aria-pressed': String(on), 'data-k': `saved:${sv.n}`,
      title: on ? 'Turn these filters off' : `Filter: “${sv.n}”`, onclick: run,
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); run(); } },
    }, h('span', { class: 'apq-lvs-name' }, sv.n),
    h('span', {
      class: 'apq-lvs-x', role: 'button', 'aria-label': `Delete ${sv.n}`, title: 'Delete', 'data-k': `del:${sv.n}`,
      onclick: (ev) => { ev.stopPropagation(); deleteSaved(sv); },
    }, icon('x')));
  });
  g.replaceChildren(...[h('div', { class: 'apq-lvs-head' }, 'Saved filters'), ...items, LV.naming ? nameInput() : null].filter(Boolean));
}

function resetFilters(fromSaved = false) {
  const before = packFilters(currentFilters());
  setFilters(emptyFilters());
  if (!fromSaved) toast(`Filters off: all your ${typeWord()} again`, 'ok', { label: 'Undo', run: () => setFilters(normalizeFilters(before)) });
}

function applySavedFilters(sv) {
  if (!S.route) return;
  setFilters(normalizeFilters(sv.v));
}

function saveFilters(name) {
  name = String(name || '').trim().slice(0, 40);
  if (!name || !S.route) return false;
  const f = currentFilters();
  if (filtersEmpty(f)) { toast('Pick a filter first', 'error'); return false; }
  const type = S.route.type;
  const i = LV.saved.findIndex((s) => s.ty === type && norm(s.n) === norm(name));
  if (i < 0 && savedFor(type).length >= LV_MAX_SAVED) { toast(`You can save up to ${LV_MAX_SAVED} ${typeWord()} filters. Delete one first.`, 'error'); return false; }
  const item = { n: name, ty: type, v: packFilters(f) };
  const next = LV.saved.slice();
  if (i >= 0) next[i] = item; else next.push(item);
  setSaved(next);
  toast(i >= 0 ? `Updated “${name}”` : `Saved “${name}”, under Filters`);
  return true;
}

function deleteSaved(sv) {
  const before = LV.saved.slice();
  setSaved(LV.saved.filter((x) => x !== sv));
  toast(`Deleted “${sv.n}”`, 'ok', { label: 'Undo', run: () => setSaved(before) });
}

function setSaved(list) {
  LV.saved = normalizeSaved(list);
  store.set('sync', 'views', LV.saved);
  renderFilters();
}

// Toggles one value of a filter (source, streaming, ...).
function toggleIn(key, val) {
  const picked = currentFilters()[key];
  setFilters({ [key]: picked.includes(val) ? picked.filter((x) => x !== val) : [...picked, val] });
}

/* Posters, in AniList's layout switch ------------------------------------ */
// AniList's layout switch (top right of the lists: .lists > .actions > .layout-switch, three spans with a
// Font Awesome icon each: list, compact, cards) gets a fourth, Posters (posters.js). It's a copy of AniList's
// own third span, so it has the same size, spacing and colors, with Tsugi's icon in the same solid style (two
// covers with their titles under them). The
// switch grows by one icon's width. While posters are on, it's the one lit, and a click on any of AniList's
// three turns them off (AniList's own layout stays underneath, whichever it is).
const POSTERS_FA = '<path fill="currentColor" d="M52 24h144a36 36 0 0 1 36 36v268a36 36 0 0 1 -36 36h-144a36 36 0 0 1 -36 -36v-268a36 36 0 0 1 36 -36zM316 24h144a36 36 0 0 1 36 36v268a36 36 0 0 1 -36 36h-144a36 36 0 0 1 -36 -36v-268a36 36 0 0 1 36 -36zM44 404h112a28 28 0 0 1 28 28v0a28 28 0 0 1 -28 28h-112a28 28 0 0 1 -28 -28v-0a28 28 0 0 1 28 -28zM308 404h112a28 28 0 0 1 28 28v0a28 28 0 0 1 -28 28h-112a28 28 0 0 1 -28 -28v-0a28 28 0 0 1 28 -28z"/>';

function layoutSwitch() {
  const sw = document.querySelector('.lists > .actions > .layout-switch, .layout-switch');
  return sw && !sw.closest('.apq-ui') ? sw : null;
}

function placeLayoutSwitch() {
  const sw = layoutSwitch();
  const want = !!S.settings.listViews && !!S.route;
  if (LV.posters && (!want || !sw || LV.posters.parentElement !== sw)) {
    const old = LV.posters.parentElement;
    LV.posters.remove();
    if (old && old._apqWidth != null) { old.style.width = old._apqWidth; old._apqWidth = null; }
    if (old) old.removeAttribute('data-apq-on');
    if (!want || !sw) LV.posters = null;
  }
  if (!want || !sw) { placePosterSize(null); return; }
  const own = [...sw.children].filter((c) => c !== LV.posters);
  if (!own.length) return;
  if (!LV.posters) {
    const model = own[own.length - 1];
    const span = model.cloneNode(true);
    span.classList.remove('active');
    span.classList.add('apq-ui', 'apq-lsw');
    span.removeAttribute('data-l');
    const svg = span.querySelector('svg');
    if (svg) {
      svg.setAttribute('viewBox', '0 0 512 512');
      svg.setAttribute('data-icon', 'tsugi-posters');
      svg.classList.remove('fa-th-large');
      svg.innerHTML = POSTERS_FA;
    } else {
      span.textContent = '';
      span.insertAdjacentHTML('beforeend', `<svg class="apq-lsw-ic" viewBox="0 0 512 512" aria-hidden="true">${POSTERS_FA}</svg>`);
    }
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    span.addEventListener('click', (ev) => { ev.stopPropagation(); setPosters(true); });
    span.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setPosters(true); } });
    LV.posters = span;
  }
  if (LV.posters.parentElement !== sw) {
    // One more icon: the switch grows by an icon and the space between two of them.
    const a = own[0].getBoundingClientRect(), b = own[1] ? own[1].getBoundingClientRect() : null;
    const w = sw.getBoundingClientRect().width;
    if (w && b) {
      sw._apqWidth = sw.style.width;
      sw.style.width = `${Math.round(w + (b.left - a.left))}px`;
    }
    sw.append(LV.posters);
  }
  if (!sw._apqWired) {
    sw._apqWired = true;
    // AniList's own icons: back to its layout (its own click handler then switches as usual).
    sw.addEventListener('click', (ev) => {
      const t = ev.target.closest && ev.target.closest('.layout-switch > *');
      if (t && t !== LV.posters && !t.classList.contains('apq-lsw') && S.settings.posters) setPosters(false);
    }, true);
  }
  const on = !!S.settings.posters;
  if (sw.hasAttribute('data-apq-on') !== on) sw.toggleAttribute('data-apq-on', on);
  placePosterSize(sw);   // the size slider beside the switch, while posters are on (posters.js)
  LV.posters.classList.toggle('active', on);
  LV.posters.setAttribute('aria-pressed', String(on));
  LV.posters.setAttribute('aria-label', 'Posters');
  LV.posters.dataset.tip = on ? 'Posters (click AniList\'s icons to go back)' : 'Posters: your lists as covers';
}
