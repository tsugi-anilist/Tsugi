// Tsugi · Poster mode: AniList's lists as a wall of covers, the details on hover.
'use strict';

/* ------------------------------------------------------------------ */
/* Poster mode                                                         */
/* ------------------------------------------------------------------ */
// The Posters icon (the fourth of AniList's layout buttons) turns every list on AniList's list pages into a
// grid of covers, the popup's poster card (0.8.5, as the popup's since 0.8.3): the cover is the card, 8 px
// corners, the title on a soft shade at its foot with the episode line under it, the priority badge in its
// usual corner, "3 new" at the top right. On hover or keyboard focus: where you are and +1 / Start / Resume
// slide in under the title, the score star (Tsugi's popover) and "···" (AniList's own editor) at the top
// right. A size slider beside AniList's layout buttons sets how big the posters are (kept on this computer).
//
// AniList's rows stay AniList's: each row becomes one cell of the grid, its own parts are hidden
// (data-apq-posters on <html>, data-apq-pc on the row; styles.js) and a poster made here fills it.
// So AniList still draws and loads the rows, and the sort, filters, groups, badges and selection
// work as in its other layouts. It works the same from AniList's list, compact and cards layouts.
// Setting: `posters` (with `listViews`). Covers come from the extension's own data, so poster mode
// starts once that data is there (the lists are kept out of sight until then: page.js, checkHold).

const PM = { tries: 0, rows: -1, timer: 0 };

const postersWanted = () => !!(S.settings.posters && S.settings.listViews);
const postersOn = () => document.documentElement.hasAttribute('data-apq-posters');

// Turns the mode on or off for the page. Returns whether it's on.
function syncPosterMode() {
  const on = postersWanted() && !!S.route && !!S.data;
  const html = document.documentElement;
  if (html.hasAttribute('data-apq-posters') === on) return on;
  html.toggleAttribute('data-apq-posters', on);
  clearPageSort(); // the rows were arranged for the other layout
  if (!on) clearPosters();
  PM.tries = 0;
  PM.rows = -1;
  return on;
}

function clearPosters() {
  document.querySelectorAll('.apq-pc').forEach((n) => n.remove());
  document.querySelectorAll('[data-apq-pc]').forEach((n) => n.removeAttribute('data-apq-pc'));
}

function leavePosterMode() {
  clearTimeout(PM.timer);
  document.documentElement.removeAttribute('data-apq-posters');
  clearPosters();
}

// The Posters button, the palette and the settings.
function setPosters(on) {
  on = !!on;
  if (!!S.settings.posters === on) return;
  S.settings.posters = on;
  saveSettings();
  postersChanged();
}

function postersChanged() {
  closePopover(false);
  hideTip();
  if (S.route) decoratePage();
  if (D.drawer && S.drawerOpen && S.view === 'settings') renderSettings();
}

/* One poster ---------------------------------------------------------- */

// A long list as posters is hundreds of them, and AniList adds 30 rows to every list at a time as you scroll, so each
// poster is made light (0.12.8): copied from a skeleton made once, and with only what shows at rest (the cover, the
// title, "3 new", the episode line). What shows while you point at it or reach it with the keyboard (the score star,
// AniList's "···", the facts, +1 / Start, the watch-order warning) is added the first time you do (posterHoverParts,
// from onPosterNear), and stays. On a touch screen, where those show all the time, they come with the poster.
const PCK = { rest: null, top: null, more: null, touch: !!(window.matchMedia && window.matchMedia('(hover: none)').matches) };
function posterSkeletons() {
  if (PCK.rest) return;
  PCK.rest = h('div', { class: 'apq-ui apq-pc' },
    h('a', { class: 'apq-pc-cover', draggable: 'false' }, h('img', { alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' })),
    h('span', { class: 'apq-pc-tag', 'aria-hidden': 'true', hidden: true }),
    h('div', { class: 'apq-pc-cap' },
      h('span', { class: 'apq-pc-name', 'aria-hidden': 'true' }),
      h('div', { class: 'apq-pc-band', 'aria-hidden': 'true', hidden: true }, h('div', { class: 'apq-track' }))));
  PCK.top = h('div', { class: 'apq-pc-top' },
    h('button', { type: 'button', class: 'apq-pc-star', hidden: true }, icon('star'), h('span', { class: 'apq-pc-star-n' })),
    h('button', { type: 'button', class: 'apq-pc-edit', 'aria-label': 'Edit on AniList', 'data-tip': 'Edit on AniList', hidden: true }, icon('more')));
  PCK.more = h('div', { class: 'apq-pc-more' }, h('div', { class: 'apq-pc-more-in' },
    h('span', { class: 'apq-pc-warn', hidden: true }, icon('order'), h('span', {})),
    h('div', { class: 'apq-pc-row' }, h('span', { class: 'apq-pc-facts', 'aria-hidden': 'true' }), h('button', { type: 'button', class: 'apq-pc-act', hidden: true }))));
}

function makePoster() {
  posterSkeletons();
  const pc = PCK.rest.cloneNode(true);
  const [link, tag, cap] = pc.children;
  pc._link = link;
  pc._img = link.firstElementChild;
  pc._tag = tag;
  pc._name = cap.firstElementChild;
  pc._band = cap.lastElementChild;
  pc._track = pc._band.firstElementChild;
  link.addEventListener('click', onPosterLink);
  link.addEventListener('keydown', onPosterKey);
  pc.addEventListener('pointerdown', onPosterPointerDown);
  pc.addEventListener('dragstart', posterNoDrag);
  if (PCK.touch) posterHoverParts(pc);
  return pc;
}
const posterNoDrag = (ev) => ev.preventDefault();

// The parts a poster shows on hover or keyboard focus, added once. True if they were just added. In the order they
// always had (the cover, the star, "···", then the caption's action), so Tab goes through them as before.
function posterHoverParts(pc) {
  if (pc._star) return false;
  posterSkeletons();
  const top = PCK.top.cloneNode(true);
  const more = PCK.more.cloneNode(true);
  pc._star = top.firstElementChild;
  pc._edit = top.lastElementChild;
  const inner = more.firstElementChild;
  pc._warn = inner.firstElementChild;
  pc._facts = inner.lastElementChild.firstElementChild;
  pc._act = inner.lastElementChild.lastElementChild;
  pc._star.addEventListener('click', onPosterStar);
  pc._edit.addEventListener('click', onPosterEdit);
  pc._act.addEventListener('click', onPosterAct);
  pc.insertBefore(top, pc._tag.nextSibling);
  pc._name.after(more);
  return true;
}

// The pointer comes onto a poster (its badge included), or the keyboard reaches it: its hover parts, filled in.
function onPosterNear(ev) {
  const t = ev.target;
  const el = t && t.closest ? t.closest('[data-apq-pc]') : null;
  const pc = el && el._apqPc;
  if (pc && pc.parentElement === el && posterHoverParts(pc)) updatePoster(pc);
}
document.addEventListener('pointerover', onPosterNear, { passive: true });
document.addEventListener('focusin', onPosterNear);

const posterEntry = (pc) => pc.parentElement;
// AniList's own "···" button in this row (it opens AniList's editor).
// (Kept on the row while it's still in it, like page.js's lookups: every pass asks it of every poster.)
function siteEditButton(el) {
  if (keptIn(el, el._apqEdit)) return el._apqEdit;
  el._apqEdit = Array.from(el.querySelectorAll('.edit')).find((b) => !b.closest('.apq-ui')) || null;
  return el._apqEdit;
}

// A cover from AniList's own row, for a title the extension's data doesn't have (added a moment ago).
function rowCover(el) {
  for (const n of el.querySelectorAll('.cover .image, .cover a, .cover')) {
    if (n.closest('.apq-ui')) continue;
    const m = /url\(["']?([^"')]+)["']?\)/.exec(n.getAttribute('style') || '');
    if (m) return m[1];
  }
  return '';
}

// The status of the list a poster sits in (null for custom lists).
function posterListStatus(key) {
  const l = listMeta(key);
  return l && !l.custom ? l.status : null;
}

// The line that slides in under the title, as separate pieces ([text, strong?]): `long` for big posters ("Ep 9 of
// 24", "TV  12 eps  2010"), `short` beside the button on the others ("9/24", "12 eps"); `said` for screen readers,
// with the score (the star shows it on hover).
function posterFacts(e) {
  const anime = isAnime();
  const total = anime ? e.episodes : e.chapters;
  const long = [];
  const short = [];
  if (['CURRENT', 'REPEATING', 'PAUSED', 'DROPPED'].includes(e.status)) {
    long.push([`${anime ? 'Ep' : 'Ch'} ${e.progress || 0}${total ? ` of ${total}` : ''}`, true]);
    short.push([`${e.progress || 0}${total ? `/${total}` : ''}`, true]);
    const fresh = newCount(e);
    if (fresh > 0) long.push([`${fresh} new`, true]);
  } else {
    if (e.format) long.push([FORMATS[e.format] || e.format]);
    const count = total && e.format !== 'MOVIE' ? (anime ? `${total} ep${total === 1 ? '' : 's'}` : `${total} ch`) : '';
    if (count) long.push([count]);
    if (e.year) long.push([String(e.year)]);
    short.push([count || (e.year ? String(e.year) : '') || (e.format ? FORMATS[e.format] || e.format : '')]);
  }
  const said = long.map((f) => f[0]);
  if (e.score > 0) said.push(['POINT_5', 'POINT_3'].includes(scoreFormat()) ? scoreText(e.score) : `Score ${e.score}`);
  return { long, short: short.filter((f) => f[0]), said };
}

// The quick action a poster offers: +1 while watching, Start or Resume before.
function posterAction(e) {
  if (!['PLANNING', 'PAUSED', 'CURRENT', 'REPEATING'].includes(e.status)) return null;
  const act = quickActionFor(e);
  if (!act) return null;
  return { ...act, text: act.icon === 'plus' ? '+1' : e.status === 'PAUSED' ? 'Resume' : 'Start' };
}

function updatePoster(pc) {
  const el = posterEntry(pc);
  if (!el) return;
  const id = Number(pc.dataset.id);
  const key = pc.dataset.list || '';
  const e = entryOf(id);
  const a = titleAnchor(el);
  const title = e ? e.title : (a ? a.textContent.trim() : '');
  const src = e ? (e.coverLarge || e.cover) : rowCover(el);
  const href = (e && e.url) || (a && a.getAttribute('href')) || '';
  if (pc._img.getAttribute('src') !== src) { if (src) pc._img.setAttribute('src', src); else pc._img.removeAttribute('src'); }
  pc._img.hidden = !src;
  if (pc._link.getAttribute('href') !== href) pc._link.setAttribute('href', href);
  const bg = (e && e.color) || '';
  if ((pc.dataset.bg || '') !== bg) { pc.dataset.bg = bg; pc.style.backgroundColor = bg; }

  // The cover's color, readable on the dark band and the glass whatever the theme.
  const rgb = hexToRGB(e && e.color);
  const onDark = rgb ? (luminance(rgb) < 0.18 ? mixRGB(rgb, '255,255,255', 0.65) : rgb) : '';
  if ((pc.dataset.tc || '') !== onDark) {
    pc.dataset.tc = onDark;
    if (onDark) {
      pc.style.setProperty('--apq-title', onDark);
      pc.style.setProperty('--apq-on-title', luminance(onDark) > 0.25 ? '15,22,34' : '255,255,255');
    } else {
      pc.style.removeProperty('--apq-title');
      pc.style.removeProperty('--apq-on-title');
    }
  }

  const listStatus = posterListStatus(key);
  // Started or finished from here: AniList's page still has it in this list until you reload.
  const moved = !!(e && listStatus && e.status !== listStatus);
  const done = moved && e.status === 'COMPLETED';
  const facts = e ? posterFacts(e) : { long: [], short: [], said: [] };
  const fresh = e ? newCount(e) : 0;
  const blk = e ? blockerOf(e) : null;
  const act = e && !moved ? posterAction(e) : null;
  const busy = !!e && S.busy.has(id);
  const tag = moved ? (done ? 'Finished' : statusLabel(e.status)) : fresh > 0 ? `${fresh} new` : '';
  const warn = blk ? `${verb()} ${blk.title} first` : '';
  const edit = canEdit() && !!siteEditButton(el);
  const star = !!e && canEdit();
  const score = e && e.score > 0 ? e.score : 0;
  const sig = [title, facts.said.join('\u0001'), facts.short.map((f) => f[0]).join('\u0001'), tag, warn, act ? act.text : '', busy, edit, done, star, score, key, !!pc._star].join('\u0002');
  if (pc.dataset.sig !== sig) {
    pc.dataset.sig = sig;
    pc._name.textContent = title;
    pc._tag.textContent = tag;
    pc._tag.hidden = !tag;
    pc._tag.classList.toggle('is-new', !moved && fresh > 0);
    pc.classList.toggle('is-done', done);
    pc._link.setAttribute('aria-label', [title, ...facts.said, tag, warn].filter(Boolean).join(', '));
    if (pc._star) fillHoverParts(pc, { title, facts, star, key, score, warn, act, busy, edit });
  }

  // The episode line, for what you're watching. After the last +1 it stays, full, until the page reloads.
  if (e && showsTrack(e)) pc._watching = true;
  const t = e && pc._watching && (showsTrack(e) || e.status === 'COMPLETED') ? trackOf(e) : null;
  const band = !!(t && t.span);
  if (pc._band.hidden === band) pc._band.hidden = !band;
  pc.classList.toggle('has-band', band);
  if (band) paintTrack(pc._track, t);
}

// What the hover parts say (only once they're there: posterHoverParts).
function fillHoverParts(pc, { title, facts, star, key, score, warn, act, busy, edit }) {
  const piece = ([t, strong]) => h(strong ? 'b' : 'span', {}, t);
  pc._facts.replaceChildren(h('span', { class: 'v-long' }, facts.long.map(piece)), h('span', { class: 'v-short' }, facts.short.map(piece)));
  pc._facts.hidden = !facts.long.length;
  pc._star.hidden = !star;
  pc._star.dataset.list = key;
  pc._star.classList.toggle('has-score', !!score);
  pc._star.lastChild.textContent = score && scoreFormat() !== 'POINT_3' ? String(score) : '';
  pc._star.setAttribute('aria-label', score ? `${scoreText(score)}. Change your score` : 'Add a score');
  pc._star.title = score ? 'Your score' : 'Add a score';
  pc._warn.hidden = !warn;
  pc._warn.lastChild.textContent = warn;
  pc._act.hidden = !act;
  if (act) {
    pc._act.disabled = busy;
    pc._act.setAttribute('aria-label', `${act.label}: ${title}`);
    pc._act.title = act.label;
    // Start and Resume: their word on big posters, the play icon alone on the others (the name in the label).
    pc._act.replaceChildren(...(busy ? [spinner()] : act.icon === 'plus' ? ['+1'] : [icon('play'), h('span', { class: 'v-long' }, act.text)]));
    pc._act.classList.toggle('is-start', act.icon !== 'plus');
  }
  pc._edit.hidden = !edit;
}

// Gives a row its poster (or takes it away). Called for every row by decoratePage.
function decoratePoster(el, id, on, key) {
  let pc = el._apqPc && el._apqPc.parentElement === el ? el._apqPc : el.querySelector(':scope > .apq-pc');
  if (!on) {
    if (pc) pc.remove();
    el._apqPc = null;
    if (el.hasAttribute('data-apq-pc')) el.removeAttribute('data-apq-pc');
    return;
  }
  if (!pc) { pc = makePoster(); el.append(pc); }
  el._apqPc = pc;
  if (!el.hasAttribute('data-apq-pc')) el.setAttribute('data-apq-pc', '');
  if (pc.dataset.id !== String(id)) {
    pc.dataset.id = String(id);
    pc.dataset.sig = '';
    pc._watching = false;
    pc._track._done = undefined;
  }
  if (pc.dataset.list !== key) pc.dataset.list = key;
  updatePoster(pc);
}

/* What a poster does --------------------------------------------------- */

// A plain click opens the title the way AniList's own link does (no page load); Ctrl, Shift or a
// middle click keep the browser's own behaviour for links.
function onPosterLink(ev) {
  if (DR.clicked) { ev.preventDefault(); return; }
  if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
  const el = ev.currentTarget.closest('[data-apq-id]');
  const a = el && titleAnchor(el);
  if (!a) return;
  ev.preventDefault();
  a.click();
}

function onPosterAct(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  if (S.selecting) return;
  const pc = ev.currentTarget.closest('.apq-pc');
  const e = pc && entryOf(Number(pc.dataset.id));
  const act = e && posterAction(e);
  if (act) act.run();
}

// The star: Tsugi's popover for this title (its score, and the priority where the list has them), as the badge does.
function onPosterStar(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  if (S.selecting || !canEdit()) return;
  const b = ev.currentTarget;
  const pc = b.closest('.apq-pc');
  if (S.popover && S.popover.anchor === b) { closePopover(); return; }
  openPopover(b, Number(pc.dataset.id));
}

function onPosterEdit(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  const el = ev.currentTarget.closest('[data-apq-id]');
  const b = el && siteEditButton(el);
  if (b) { closePopover(false); hideTip(); b.click(); }
}

/* Enough rows to fill the window ---------------------------------------- */
// AniList draws 30 more rows of a long list when a scroll brings the list's end near the bottom of
// the window. As posters, a list is several times shorter: its end can be in sight with most of the
// list not drawn yet, and nothing to scroll. So while the end of an unfinished list is that near,
// AniList is told to look again (a scroll event; nothing moves).

function postersShort() {
  if (!postersOn() || !S.data || !S.route) return false;
  for (const w of document.querySelectorAll('.list-wrap')) {
    if (w.closest('.apq-ui') || w.hasAttribute('data-apq-vempty')) continue;
    const l = S.route.list ? shownLists()[0] : listMeta(keyFor(S.route.type, sectionName(w)));
    if (!l) continue;
    const want = l.ids.filter((id) => S.data.entries.has(id) && !S.gone.has(id)).length;
    if (w.querySelectorAll('[data-apq-id]').length >= want) continue;
    const r = w.getBoundingClientRect();
    if (r.height > 0 && r.bottom < window.innerHeight + 600) return true;
  }
  return false;
}

// Three tries without a new row, then it's left alone (AniList's own filters can hold rows back).
const posterFillPending = () => PM.tries < 3 && postersShort();

// After a pass over the page. postersShort measures the lists, which right after a pass means a whole layout of
// the page, each time AniList draws 30 more rows as you scroll: so, once the list shows, it waits for a quiet moment
// (by then the page is laid out anyway). While the list is still held, checkHold needs the answer at once. (0.12.8)
// While you scroll, AniList draws more rows by itself, so it waits until you stop.
let pageScrolledAt = 0;
window.addEventListener('scroll', (ev) => { if (ev.isTrusted) pageScrolledAt = performance.now(); }, { passive: true });
function schedulePosterFill() {
  if (isHeld()) { posterFill(); return; }
  if (!postersOn() && !PM.timer) return;
  clearTimeout(PM.timer);
  const later = () => {
    PM.timer = 0;
    if (!S.route) return;
    const wait = 250 - (performance.now() - pageScrolledAt);
    if (wait > 0) { PM.timer = setTimeout(later, wait + 20); return; }
    posterFill();
  };
  PM.timer = setTimeout(later, 150);
}

function posterFill() {
  clearTimeout(PM.timer);
  if (S.filling || !postersShort()) { PM.tries = 0; PM.rows = -1; return; }
  const rows = findEntries().length;
  if (rows !== PM.rows) { PM.rows = rows; PM.tries = 0; }
  if (PM.tries >= 3) return;
  PM.tries++;
  try { window.dispatchEvent(new Event('scroll')); } catch { /* ignore */ }
  PM.timer = setTimeout(() => { PM.timer = 0; if (S.route) { posterFill(); checkHold(findEntries().length); } }, 160);
}

/* How big the posters are: a slider beside AniList's layout buttons ----------------------------------- */
// Shown while posters are on (not on a phone: AniList's layout there is its own). It sets the posters' narrowest
// width (the grid fills each row), live as you drag; kept on this computer (local "lv:posterSize").

const PSIZE_KEY = 'lv:posterSize';
const PSIZE_MIN = 96;
const PSIZE_MAX = 240;
const PSIZE_DEFAULT = 124;
let posterSize = PSIZE_DEFAULT;
let psizeEl = null;

function applyPosterSize() {
  document.documentElement.style.setProperty('--apq-pw', `${posterSize}px`);
}
store.get('local', PSIZE_KEY).then((v) => {
  const n = Number(v);
  if (n >= PSIZE_MIN && n <= PSIZE_MAX) { posterSize = n; applyPosterSize(); }
});

// Called by placeLayoutSwitch (views.js) with AniList's layout switch, or null when it's gone.
function placePosterSize(sw) {
  const want = !!sw && postersWanted() && !!sw.parentElement;
  if (!want) { if (psizeEl) { psizeEl.remove(); psizeEl = null; } return; }
  if (!psizeEl) {
    const range = h('input', {
      type: 'range', class: 'apq-psize-range', min: String(PSIZE_MIN), max: String(PSIZE_MAX), step: '2', value: String(posterSize),
      'aria-label': 'Poster size',
    });
    range.addEventListener('input', () => { posterSize = Number(range.value); applyPosterSize(); });
    range.addEventListener('change', () => { posterSize = Number(range.value); applyPosterSize(); store.set('local', PSIZE_KEY, posterSize); posterFill(); });
    psizeEl = h('div', { class: 'apq-ui apq-psize', 'data-tip': 'Poster size' }, icon('psmall'), range, icon('pbig'));
    psizeEl._range = range;
  }
  if (psizeEl._range.value !== String(posterSize)) psizeEl._range.value = String(posterSize);
  const box = sw.parentElement;
  if (psizeEl.parentElement === box && psizeEl._sw === sw) return;   // the page observer calls this often: no layout reads then
  box.append(psizeEl);
  psizeEl._sw = sw;
  // Level with AniList's switch, just left of it.
  psizeEl.style.top = `${sw.offsetTop}px`;
  psizeEl.style.height = `${sw.offsetHeight || 36}px`;
}
