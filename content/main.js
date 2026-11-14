// Tsugi · Routing, theme, observers, keyboard shortcuts, and start-up.
'use strict';

/* ------------------------------------------------------------------ */
/* Routing, theme, observers, keys                                     */
/* ------------------------------------------------------------------ */

function renderAll() {
  renderDock();
  if (D.drawer) renderDrawer();
  decoratePage();
}

function onRoute() {
  const m = location.pathname.match(LIST_RE);
  const route = m ? {
    user: decodeURIComponent(m[1]),
    type: m[2] === 'animelist' ? 'ANIME' : 'MANGA',
    list: m[3] ? decodeURIComponent(m[3]) : null,
  } : null;
  const prevKey = routeKey(S.route);
  const media = !route && location.pathname.match(MEDIA_RE);
  onTitleRoute(media ? { type: media[1].toUpperCase(), id: Number(media[2]) } : null);
  onOutsideRoute(TP.route);   // MyAnimeList's parts of a title's page (outside.js)
  onFeedRoute(FEED_RE.test(location.pathname));
  onSocialRoute(location.pathname, prevPath);   // a profile's follower counts, why a profile is missing (social.js)
  closePal();
  closeViewPanel();
  closeSortMenu();
  if (S.massOpen) { M.step = 'form'; closeMass(); }
  exitSelect();
  closePopover(false);
  closePick();
  hideTip();
  S.route = route;
  S.fillAttempted = null;
  if (route) holdList(); // the new list stays out of sight until it's in place (page.js)
  else releaseList();
  if (!route) {
    closeDrawer();
    unmountDock();
    leavePosterMode();
    clearPageSort();
    clearViewMarks();
    return;
  }
  if (routeKey(route) !== prevKey) {
    S.data = null;
    S.error = null;
    S.collapsed = {};
    S.tab = 'PLANNING';
    S.query = '';
    S.view = 'list';
    S.rel = new Map();
    S.pickRecent = [];
    S.gone.clear();
    if (D.search) D.search.value = '';
    D.rows.clear();
  }
  syncTheme();
  mountDock();
  renderAll();
  ensureData();
}

function parseRGB(s) {
  const m = s && s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (p.length >= 4 && p[3] === 0) return null;
  return p.slice(0, 3);
}

function syncTheme() {
  let dark;
  const cls = `${document.documentElement.className} ${document.body.className}`;
  if (/site-theme-dark/.test(cls)) dark = true;
  else {
    const rgb = parseRGB(getComputedStyle(document.body).backgroundColor) ||
      parseRGB(getComputedStyle(document.documentElement).backgroundColor);
    dark = rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) < 110 : false;
  }
  const v = dark ? 'dark' : 'light';
  if (document.documentElement.dataset.apqTheme !== v) document.documentElement.dataset.apqTheme = v;
  notePanelTone();
  noteSiteTheme();
}

// AniList's own theme setting, for the toolbar popup's "Same as AniList" (0.6.10). AniList keeps it in
// its localStorage, "site-theme": default, dark, contrast, or system (its default: it follows the computer).
// Without it, the class AniList put on <body> says enough. Saved only when it changes.
let siteThemeSaved = null;
function noteSiteTheme() {
  let v = null;
  try { v = localStorage.getItem('site-theme'); } catch { /* storage blocked */ }
  if (!['default', 'dark', 'contrast', 'system'].includes(v)) {
    const cls = document.body.className;
    v = /\bsite-theme-dark\b/.test(cls) ? 'dark' : /\bsite-theme-contrast\b/.test(cls) ? 'contrast' : 'system';
  }
  if (v === siteThemeSaved) return;
  siteThemeSaved = v;
  store.set('local', 'siteTheme', v);
}

let decorateTimer = 0;
function scheduleDecorate() {
  clearTimeout(decorateTimer);
  decorateTimer = setTimeout(() => { decoratePage(); decorateOutside(); decorateFeed(); decorateSocial(); }, isHeld() ? 30 : 120);
}

// AniList changes pages without loading them. The page observer checks the address first, so a
// list opened from inside AniList is caught as AniList draws it, before the browser shows it.
let lastPath = null;
let prevPath = null;   // the address before this one (AniList's 404 page replaces it: social.js)
function checkPath() {
  if (location.pathname === lastPath) return;
  prevPath = lastPath !== null ? lastPath : document.documentElement.getAttribute('data-apq-start');
  lastPath = location.pathname;
  onRoute();
}

const isOurs = (n) => n.nodeType === 1 && (n.classList.contains('apq-ui') || n.classList.contains('apq-badge'));
const ROWS_SEL = '.entry, .entry-card, .list-entries, .list-wrap';
const addsRows = (m) => Array.from(m.addedNodes).some((n) => n.nodeType === 1 && !isOurs(n) && (n.matches(ROWS_SEL) || !!n.querySelector(ROWS_SEL)));
const pageObserver = new MutationObserver((muts) => {
  checkPath();
  if (!K.nav || !K.nav.isConnected) placeNavBtn(); // Tsugi's button in AniList's top bar (hub.js)
  // Home's global feed goes before it's painted (feed.js, the hideGlobal setting).
  if (FD.route && S.settings.hideGlobal) hideGlobalFeed();
  if (!S.route && !TP.route && !FD.route && !SOC.route) return;
  // AniList just drew a list page's sidebar or layout switch: Tsugi's filters and Posters icon go in before
  // it's painted, so they never pop in (views.js).
  if (S.route && S.settings.listViews) {
    const needSide = filtersOn() && (!LV.side || !LV.side.isConnected) && !!filtersGroup();
    const needSwitch = (!LV.posters || !LV.posters.isConnected) && !!layoutSwitch();
    if (needSide || needSwitch) placeListChrome();
  }
  let changed = false;
  for (const m of muts) {
    const t = m.target;
    if (t.nodeType === 1 && t.closest && t.closest('.apq-ui')) continue;
    const nodes = [...m.addedNodes, ...m.removedNodes];
    if (nodes.length && nodes.every(isOurs)) continue;
    changed = true;
    // Rows AniList just drew (scrolling, its own filters) are put in place before they're painted. Only the new rows
    // need their badge and poster (decoratePage's `added`: the rows already there are left as they are).
    if (S.route && S.data && !isHeld() && addsRows(m)) { clearTimeout(decorateTimer); decoratePage({ added: true }); return; }
  }
  if (changed) scheduleDecorate();
});

// Reads the physical number key, so it works on AZERTY without Shift.
function digitOf(ev) {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(ev.code || '');
  if (m) return Number(m[1]);
  return /^[0-9]$/.test(ev.key) ? Number(ev.key) : null;
}

function onKeyDown(ev) {
  // Ctrl+K (Cmd+K on a Mac) works on every AniList page, even while typing.
  if (isPaletteKey(ev) && !S.massOpen) { ev.preventDefault(); ev.stopPropagation(); togglePal(); return; }
  if (PL.open) return; // the palette handles its own keys
  if (ev.key === 'Escape' && FD.panel) { ev.preventDefault(); closeFeedPanel(); return; }
  if (ev.key === 'Escape' && LV.menu) { ev.preventDefault(); const c = LV.menu.chip; closeSortMenu(); if (c && c.isConnected) c.focus({ preventScroll: true }); return; }
  if (ev.key === 'Escape' && LV.drop) { ev.preventDefault(); const b = LV.boxes.get(LV.drop.key); closeDrop(); if (b && b.isConnected) b.focus({ preventScroll: true }); return; }
  if (ev.key === 'Escape' && LV.naming) { ev.preventDefault(); stopNaming(); return; }
  if (!S.route) return;
  const t = ev.target;
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (ev.key === 'Escape') {
    if (S.massOpen) { ev.preventDefault(); massEscape(); return; }
    if (S.pickOpen) { ev.preventDefault(); closePick(); return; }
    if (S.popover) { ev.preventDefault(); closePopover(); return; }
    if (S.selecting) { ev.preventDefault(); exitSelect(); return; }
    if (S.drawerOpen) { ev.preventDefault(); if (S.view === 'settings') setView('list'); else closeDrawer(); }
    return;
  }
  if (typing || S.massOpen) return;
  const k = (ev.key || '').toLowerCase();
  if (S.pickOpen) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if ((k === ' ' || k === 'enter') && t && t.closest && t.closest('button, a')) return; // let the focused button act
    if (k === 'r' || k === ' ' || k === 'enter') { ev.preventDefault(); roll(); }
    return;
  }
  if (S.selecting && (ev.ctrlKey || ev.metaKey) && !ev.altKey && k === 'a') {
    ev.preventDefault();
    selectAllVisible();
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey || !S.settings.keys) return;
  const editable = canEdit();
  const n = digitOf(ev);
  if (n !== null && editable) {
    if (S.selecting && S.selected.size) {
      ev.preventDefault();
      bulkApply(() => n, describeSet(n));
      return;
    }
    const id = S.popover ? S.popover.id : S.hoverId;
    const key = S.popover ? S.popover.list : S.hoverList;
    if (id && S.data.entries.has(id) && prioOn(key)) {
      ev.preventDefault();
      setPrioIn(key, id, n, { notify: !S.popover });
    }
    return;
  }
  if (S.popover && editable && prioOn(S.popover.list) && ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(ev.key)) {
    ev.preventDefault();
    bumpIn(S.popover.list, S.popover.id, ev.key === 'ArrowUp' || ev.key === 'ArrowRight' ? 1 : -1);
    return;
  }
  if (ev.shiftKey) return;
  if (k === 'e' && editable && S.selecting && S.selected.size) { ev.preventDefault(); openMass(); return; }
  if (k === 's' && editable) { ev.preventDefault(); toggleSelectMode(); return; }
  if (k === 'r' && editable && S.settings.pick) { ev.preventDefault(); openPick(); return; }
  if (k === 'v' && filtersOn()) { ev.preventDefault(); toggleViewPanel(); return; }
  if (k === 'p') { ev.preventDefault(); toggleDrawer(); }
}

function onPointerOver(ev) {
  const t = ev.target;
  const host = t && t.closest ? t.closest('.apq-row, [data-apq-id]') : null;
  S.hoverId = host ? Number(host.dataset.id || host.dataset.apqId) || null : null;
  // Which list's priority the number keys change: the page title's list ('' for the hub's rows).
  const hb = host && host.dataset.apqId ? host.querySelector('.apq-badge') : null;
  S.hoverList = hb ? hb.dataset.list || '' : '';
  const tipEl = t && t.closest ? t.closest('[data-tip]') : null;
  const target = tipEl && tipEl.closest('.apq-ui') ? tipEl : null;
  if (target === TIP.target) return;
  hideTip();
  if (target) {
    TIP.target = target;
    TIP.timer = setTimeout(() => showTip(target), 380);
  }
}

let rafPos = 0;
function onScrollOrResize() {
  hideTip();
  if (rafPos) return;
  rafPos = requestAnimationFrame(() => { rafPos = 0; positionPopover(); positionBar(); positionFeedPanel(); positionViewPanel(); });
}

function injectStyles() {
  if (document.getElementById('apq-styles')) return;
  const st = document.createElement('style');
  st.id = 'apq-styles';
  st.textContent = CSS;
  document.head.append(st);
}

function init() {
  injectStyles();
  applyAccent();
  syncTheme();
  const themeObs = new MutationObserver(syncTheme);
  themeObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme); } catch { /* old browser */ }
  pageObserver.observe(document.body, { childList: true, subtree: true });
  placeNavBtn();

  window.addEventListener('apq:site-save', onSiteSave);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onCaptureClick, true);
  document.addEventListener('pointerover', onPointerOver, { passive: true });
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
  window.addEventListener('resize', onScrollOrResize, { passive: true });
  // AniList's top bar can go away as the window narrows (a phone's layout): the floating button then takes over.
  window.addEventListener('resize', () => { if (S.settings.dock === 'bar') renderDock(); }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.route && S.data && !S.pending.size && Date.now() - S.data.fetchedAt > 30000) ensureData(true);
  });
  window.addEventListener('pagehide', () => {
    flushCustomPrio();
    for (const id of Array.from(S.pending.keys())) flushSave(id, true);
  });

  setInterval(checkPath, 400);
  window.addEventListener('popstate', checkPath);
  checkPath();
  runOpenFlag(); // something the command palette asked to open after this page load
}


async function start() {
  await loadState();
  try { chrome.storage.onChanged.addListener(onStorageChanged); } catch { /* ignore */ }
  init();
}

if (document.body) start();
else document.addEventListener('DOMContentLoaded', start, { once: true });
