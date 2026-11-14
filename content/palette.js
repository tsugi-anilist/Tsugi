// Tsugi · Command palette (Ctrl+K): jump to any title, list, page or setting, and run actions.
'use strict';

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */
// Works on every AniList page. Your titles come from your own lists (both anime and manga),
// read once and kept for 10 minutes in the browser's session storage (gone when the browser
// closes, like the toolbar popup's cache). Typing also searches AniList itself, after a short pause.

const PAL_QUERY = `query PaletteList ($name: String, $type: MediaType) {
  MediaListCollection(userName: $name, type: $type) {
    user { mediaListOptions { animeList { customLists } mangaList { customLists } } }
    lists {
      entries {
        id mediaId status priority progress repeat updatedAt
        startedAt { year month day }
        completedAt { year month day }
        media {
          id type format status episodes chapters siteUrl
          nextAiringEpisode { episode }
          title { userPreferred romaji english native }
          coverImage { medium }
        }
      }
    }
  }
}`;
const PAL_SEARCH = `query PaletteSearch ($q: String) {
  Page(perPage: 8) {
    media(search: $q, sort: [SEARCH_MATCH], isAdult: false) {
      id type format status episodes chapters seasonYear siteUrl
      nextAiringEpisode { episode }
      title { userPreferred romaji english native }
      coverImage { medium }
    }
  }
}`;
const PAL_KEY = 'pal:v1';
const PAL_RECENT_KEY = 'pal:recent';
const PAL_TTL = 10 * 60 * 1000;
const PAL_OPEN_KEY = 'apq:open'; // in the page's sessionStorage: something to open after the next page load
const PL = {
  open: false, query: '', items: [], active: 0, viewer: undefined,
  data: null,          // { user, t, items: [...], custom: { ANIME: [], MANGA: [] } }
  loading: false, error: null,
  search: new Map(),   // query -> [items] from AniList's search
  searching: '', seq: 0, timer: 0,
  recent: null,
  busy: new Set(),     // media ids with a save in flight
};

const isPaletteKey = (ev) => !!S.settings.palette && (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey &&
  ((ev.key || '').toLowerCase() === 'k' || ev.code === 'KeyK');

/* Data ------------------------------------------------------------- */

async function palViewer() {
  if (S.auth && S.auth.viewer && S.auth.viewer.name) return S.auth.viewer.name;
  if (S.data && S.data.viewer && S.data.viewer.name) return S.data.viewer.name;
  if (PL.viewer !== undefined) return PL.viewer;
  try {
    const d = await gqlSession(VIEWER_QUERY);
    PL.viewer = (d && d.Viewer && d.Viewer.name) || null;
  } catch { PL.viewer = null; }
  return PL.viewer;
}
const palName = () => (S.auth && S.auth.viewer && S.auth.viewer.name) || (S.data && S.data.viewer && S.data.viewer.name) || PL.viewer || null;

function palItemFrom(e, m, type) {
  m = m || {};
  const t = m.title || {};
  const title = t.userPreferred || t.romaji || t.english || 'Untitled';
  const alt = [t.romaji, t.english, t.native].filter((x) => x && x !== title);
  const mtype = m.type || type || 'ANIME';
  const id = m.id || (e && e.mediaId);
  return {
    id, type: mtype, title, alt: [...new Set(alt)],
    entryId: e ? e.id : null, status: e ? e.status : null, priority: e ? e.priority || 0 : 0,
    progress: e ? e.progress || 0 : 0, repeat: e ? e.repeat || 0 : 0, updatedAt: e ? e.updatedAt || 0 : 0,
    startedAt: fuzzy(e && e.startedAt), completedAt: fuzzy(e && e.completedAt),
    format: m.format || null, airing: m.status || null, episodes: m.episodes || null, chapters: m.chapters || null,
    nextEp: (m.nextAiringEpisode && m.nextAiringEpisode.episode) || null, year: m.seasonYear || null,
    cover: (m.coverImage && m.coverImage.medium) || '',
    url: m.siteUrl || `/${mtype.toLowerCase()}/${id}`,
  };
}

async function palLoad(force = false) {
  const name = await palViewer();
  if (!name) { PL.data = null; renderPal(); return; }
  if (!PL.data || PL.data.user !== name) {
    const c = await store.get('session', PAL_KEY);
    PL.data = c && c.user === name && Array.isArray(c.items) ? c : null;
    if (PL.data) renderPal();
  }
  if (!force && PL.data && Date.now() - PL.data.t < PAL_TTL) return;
  if (PL.loading) return;
  PL.loading = true;
  PL.error = null;
  renderPal();
  try {
    const got = await Promise.allSettled(['ANIME', 'MANGA'].map((type) => gqlRead(PAL_QUERY, { name, type })));
    if (got.every((g) => g.status === 'rejected')) throw got[0].reason;
    const items = [], seen = new Set();
    const custom = { ANIME: [], MANGA: [] };
    got.forEach((g, i) => {
      const type = i ? 'MANGA' : 'ANIME';
      const col = g.status === 'fulfilled' && g.value && g.value.MediaListCollection;
      if (!col) return;
      const o = col.user && col.user.mediaListOptions;
      const names = o && (type === 'MANGA' ? o.mangaList : o.animeList);
      if (names && Array.isArray(names.customLists)) custom[type] = names.customLists.filter(Boolean);
      for (const l of col.lists || []) {
        for (const e of l.entries || []) {
          const key = `${type}:${e.mediaId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(palItemFrom(e, e.media, type));
        }
      }
    });
    // Keep what a save here changed meanwhile.
    PL.data = { user: name, t: Date.now(), items, custom };
    store.set('session', PAL_KEY, PL.data);
  } catch (err) {
    PL.error = err;
  } finally {
    PL.loading = false;
    renderPal();
  }
}

let palSaveTimer = 0;
function palSaveCache() {
  clearTimeout(palSaveTimer);
  palSaveTimer = setTimeout(() => { if (PL.data) store.set('session', PAL_KEY, PL.data); }, 300);
}

// AniList's own page saved an entry (its + button or editor): keep the palette's copy in step.
function palSiteSaved(saved) {
  if (!PL.data || !saved || !saved.id) return;
  const it = PL.data.items.find((x) => x.entryId === saved.id);
  if (!it) return;
  palApplySaved(it, saved);
}

function palApplySaved(it, s) {
  if (!it || !s) return;
  if (typeof s.id === 'number') it.entryId = s.id;
  if (s.status) it.status = s.status;
  for (const k of ['progress', 'repeat', 'priority']) if (typeof s[k] === 'number') it[k] = s[k];
  if ('startedAt' in s) it.startedAt = fuzzy(s.startedAt);
  if ('completedAt' in s) it.completedAt = fuzzy(s.completedAt);
  it.updatedAt = Math.floor(Date.now() / 1000);
  palSaveCache();
}

// The hub's copy of this title, when the list on this page is yours and of the same type.
function palOwnEntry(it) {
  if (!it || !S.data || !S.data.canEdit || !S.route || S.route.type !== it.type) return null;
  return S.data.entries.get(it.id) || null;
}

// The palette's copy, with anything newer from the hub on top.
function palFresh(it) {
  const e = palOwnEntry(it);
  if (e) {
    it.entryId = e.id; it.status = e.status; it.progress = e.progress || 0; it.priority = e.priority || 0;
    it.repeat = e.repeat || 0; it.startedAt = e.startedAt; it.completedAt = e.completedAt;
  }
  return it;
}

/* Recent ------------------------------------------------------------ */

async function palRecentList() {
  if (PL.recent) return PL.recent;
  const r = await store.get('local', PAL_RECENT_KEY);
  PL.recent = Array.isArray(r) ? r : [];
  return PL.recent;
}

function palRemember(item) {
  if (!item || !item.href) return;
  const keep = { key: item.key, label: item.label, sub: item.sub || '', href: item.href, icon: item.icon || null, cover: item.cover || '', title: item.title || null };
  const list = (PL.recent || []).filter((x) => x.key !== item.key);
  list.unshift(keep);
  PL.recent = list.slice(0, 6);
  store.set('local', PAL_RECENT_KEY, PL.recent);
}

/* Commands ---------------------------------------------------------- */

const PAL_SETTINGS = [
  ['badges', 'Badges on list pages', 'priority'],
  ['watchOrder', 'Watch-order warnings', 'sequel prequel'],
  ['newEps', 'New episode counts', 'aired'],
  ['autoDates', 'Fill in start and finish dates', 'auto dates'],
  ['history', 'Rewatch log', 'history reread'],
  ['listViews', 'List views', 'filter sort group view bar'],
  ['listSorts', 'Sorts and groups', 'sort group order title list views'],
  ['listFilters', 'Filters in AniList\'s sidebar', 'filter source streaming episodes length saved list views'],
  ['dragOrder', 'Drag to order', 'drag reorder grip move order inside priority'],
  ['sideLinks', 'MyAnimeList and Reddit links', 'myanimelist mal reddit discussions external links sidebar title page'],
  ['socialCounts', 'Follower counts', 'followers following mutual social profile count'],
  ['check404', 'Why a profile is missing', '404 not found private blocked profile user'],
  ['hideGlobal', 'Hide the global feed', 'global feed home following activity'],
  ['pick', 'Pick for me', 'random roll dice pick'],
  ['listCheck', 'List check', 'health missing dates stale watch order check'],
  ['posters', 'Posters', 'poster mode covers grid wall letterboxd'],
  ['hideAdult', 'Hide NSFW titles', 'adult 18+ nsfw hentai ecchi'],
  ['feedFilters', 'Activity feed filters', 'feed home hide'],
  ['keys', 'Keyboard shortcuts', 'keys hotkeys'],
];
const DOCK_LABELS = { bar: 'In AniList\'s top bar', always: 'Floating', near: 'Floating, near its corner', hide: 'Hidden' };

function goTo(href, newTab = false) {
  if (newTab) { window.open(href, '_blank', 'noopener'); return; }
  const url = new URL(href, location.origin);
  if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
  location.assign(url.href);
}

// Opens something after the next page load (the hub, its settings, the feed filters).
function goThenOpen(href, what) {
  try { sessionStorage.setItem(PAL_OPEN_KEY, JSON.stringify({ what, t: Date.now() })); } catch { /* storage blocked */ }
  goTo(href);
}

function takeOpenFlag() {
  // The toolbar popup's "Tsugi settings" opens your list with #tsugi-settings in the address.
  if (location.hash === '#tsugi-settings') {
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* ignore */ }
    return 'settings';
  }
  let v = null;
  try {
    v = JSON.parse(sessionStorage.getItem(PAL_OPEN_KEY) || 'null');
    if (v) sessionStorage.removeItem(PAL_OPEN_KEY);
  } catch { v = null; }
  return v && Date.now() - v.t < 30000 ? v.what : null;
}

// Called after each route change: opens what the palette asked for before the page load.
function runOpenFlag() {
  const what = takeOpenFlag();
  if (!what) return;
  if ((what === 'hub' || what === 'settings') && S.route) { openDrawer(); if (what === 'settings') setView('settings'); }
  else if (what === 'feed') wantFeedPanel();
}

function settingChanged(key) {
  saveSettings();
  if (key === 'keys' || key === 'dock') { placeNavBtn(); renderDock(); }
  if (key === 'listViews' || key === 'listSorts' || key === 'listFilters') partsChanged();
  if (key === 'pick' && !S.settings.pick) closePick();
  if (key === 'listCheck' && !S.settings.listCheck && S.view === 'check') setView('list');
  if (S.route) {
    renderAll();
    scheduleRefresh();
    applyPageSort();
    if (key === 'watchOrder' && S.settings.watchOrder) ensureRelations();
  }
  if (S.popover) updatePopover();
  if (key === 'sideLinks') onOutsideRoute(TP.route);
  if (key === 'socialCounts' || key === 'check404') decorateSocial();
  syncFeed();
}

function palCommands(name) {
  const out = [];
  const u = name ? `/user/${encodeURIComponent(name)}` : null;
  const link = (key, label, href, ic, keywords = '', opts = {}) => out.push({ kind: 'link', group: opts.group || 'Go to', key, label, href, icon: ic, keywords, sub: opts.sub || '', short: !!opts.short });
  const cmd = (key, label, run, ic, keywords = '', opts = {}) => out.push({ kind: 'cmd', group: opts.group || 'Actions', key, label, run, icon: ic, keywords, sub: opts.sub || '', hint: opts.hint || '', quiet: !!opts.quiet, stay: !!opts.stay });

  // Actions for this page.
  const d = S.data;
  if (S.route) {
    cmd('hub', 'Open the hub', () => openDrawer(), 'lists', 'panel queue priority', { hint: S.settings.keys ? 'P' : '' });
    if (d && d.canEdit) {
      if (S.selecting && S.selected.size) cmd('mass', `Edit the ${plural(S.selected.size)} you selected`, () => openMass(), 'edit', 'mass edit bulk', { hint: 'E' });
      cmd('select', S.selecting ? 'Stop selecting' : 'Select titles', () => toggleSelectMode(), 'select', 'bulk mass edit', { hint: S.settings.keys ? 'S' : '' });
      if (S.settings.pick) cmd('pick', `Pick something to ${isAnime() ? 'watch' : 'read'}`, () => openPick(), 'dice', 'random roll pick for me', { hint: S.settings.keys ? 'R' : '' });
    }
    const what = S.route.list ? S.route.list : 'this page';
    cmd('sort', sortOn() ? `Stop sorting ${what} by priority` : `Sort ${what} by priority`, () => setSortPage(!sortOn()), 'sort', 'order priority page');
    if (d && d.canEdit && S.settings.listCheck) cmd('check', 'Check this list', () => { openDrawer(); setView('check'); }, 'pulse', 'health missing dates stale watch order prequel sequel fix clean');
    if (S.settings.listViews && d) {
      cmd('posters', S.settings.posters ? 'Back to AniList\'s layout' : 'Show lists as posters', () => setPosters(!S.settings.posters), 'posters', 'poster mode covers grid wall');
      if (filtersOn()) cmd('lview', 'Filter your lists', () => openViewPanel(), 'sliders', 'filter source streaming episodes length adult', { hint: S.settings.keys ? 'V' : '' });
      if (sortsOn()) cmd('lsort', S.route.list ? `Sort ${S.route.list}` : 'Sort a list', () => openSortMenuHere(), 'sort', 'sort group order title score updated');
      if (filtersOn()) for (const sv of savedFor()) cmd(`lview:${sv.n}`, `Filters: ${sv.n}`, () => applySavedFilters(sv), 'sliders', 'saved filters view', { sub: 'Saved filters' });
    }
    cmd('reload', 'Reload this list from AniList', () => ensureData(true), 'refresh', 'refresh update', { quiet: true });
  } else if (u) {
    cmd('hub', 'Open the hub', () => goThenOpen(`${u}/animelist`, 'hub'), 'lists', 'panel queue priority', { sub: 'Opens your anime list' });
  }
  if (S.settings.feedFilters && name) {
    if (FD.route) cmd('feed', 'Feed filters', () => openFeedPanel(), 'sliders', 'activity feed hide filter home');
    else cmd('feed', 'Feed filters', () => goThenOpen('/home', 'feed'), 'sliders', 'activity feed hide filter home', { sub: 'On Home', quiet: true });
  }
  if (!S.auth) cmd('connect', 'Connect your AniList account', () => { try { chrome.runtime.sendMessage({ type: 'auth:connect' }, () => void chrome.runtime.lastError); } catch { toast('The extension was updated. Reload this page.', 'error'); } }, 'external', 'login log in toolbar popup', { quiet: !!name });
  cmd('refresh', 'Refresh your titles', () => palLoad(true), 'refresh', 'reload update', { quiet: true, stay: true });

  // Pages.
  link('home', 'Home', '/home', 'inbox', 'activity feed', { short: true });
  if (u) {
    link('alist', 'Your anime list', `${u}/animelist`, 'lists', 'animelist', { short: true });
    link('mlist', 'Your manga list', `${u}/mangalist`, 'lists', 'mangalist', { short: true });
    link('profile', 'Your profile', `${u}/`, 'star', 'overview user me', { short: true });
    link('notifs', 'Notifications', '/notifications', 'alert', 'inbox replies likes', { short: true });
    link('stats', 'Your stats', `${u}/stats/anime/overview`, 'sort', 'statistics');
    link('favs', 'Your favourites', `${u}/favorites`, 'star', 'favorites');
    link('social', 'Following and followers', `${u}/social`, 'star', 'friends social');
  }
  link('browse-a', 'Browse anime', '/search/anime', 'search', 'search discover');
  link('season', 'This season\'s anime', '/search/anime/this-season', 'clock', 'seasonal airing current');
  link('browse-m', 'Browse manga', '/search/manga', 'search', 'search discover');
  link('forum', 'Forum', '/forum/overview', 'inbox', 'threads discussion');
  if (name) {
    link('al-settings', 'AniList settings', '/settings', 'sliders', 'account profile options');
    link('al-lists', 'AniList list settings', '/settings/lists', 'sliders', 'custom lists scoring format');
  }

  // Your lists, one by one.
  if (u) {
    for (const type of ['ANIME', 'MANGA']) {
      const base = `${u}/${type === 'ANIME' ? 'animelist' : 'mangalist'}`;
      const word = type === 'ANIME' ? 'Anime' : 'Manga';
      const counts = {};
      if (PL.data) for (const it of PL.data.items) if (it.type === type) counts[it.status] = (counts[it.status] || 0) + 1;
      for (const st of ['CURRENT', 'PLANNING', 'COMPLETED', 'REPEATING', 'PAUSED', 'DROPPED']) {
        const label = LABELS[type][st];
        const n = counts[st] || 0;
        if (PL.data && !n && st !== 'CURRENT' && st !== 'PLANNING') continue;
        link(`list:${type}:${st}`, label, `${base}/${label}`, 'lists', `${word} list ${st.toLowerCase()}`, { group: 'Lists', sub: PL.data ? [`${word} list`, plural(n)] : `${word} list` });
      }
      for (const c of (PL.data && PL.data.custom[type]) || []) {
        link(`list:${type}:c:${c}`, c, `${base}/${encodeURIComponent(c)}`, 'listPlus', `${word} custom list`, { group: 'Lists', sub: `${word} custom list` });
      }
    }
  }

  // Settings: switch them right here.
  for (const [k, label, words] of PAL_SETTINGS) {
    const locked = k === 'keys' && S.settings.dock === 'hide';
    out.push({
      kind: 'setting', group: 'Settings', key: `set:${k}`, label, icon: 'sliders', keywords: `setting ${words}`,
      value: S.settings[k] ? 'On' : 'Off', on: !!S.settings[k], locked,
      sub: locked ? 'Needed while Tsugi\'s button is hidden' : '',
      run: () => { if (locked) return; S.settings[k] = !S.settings[k]; settingChanged(k); toast(`${label}: ${S.settings[k] ? 'on' : 'off'}`); },
    });
  }
  out.push({
    kind: 'setting', group: 'Settings', key: 'set:dock', label: 'Tsugi\'s button', icon: 'sliders', keywords: 'setting dock corner hide button floating top bar nav',
    value: DOCK_LABELS[S.settings.dock], sub: 'Press Enter to switch',
    run: () => {
      const order = S.settings.keys ? ['bar', 'always', 'near', 'hide'] : ['bar', 'always', 'near'];
      S.settings.dock = order[(order.indexOf(S.settings.dock) + 1) % order.length];
      settingChanged('dock');
      toast(`Tsugi's button: ${DOCK_LABELS[S.settings.dock][0].toLowerCase()}${DOCK_LABELS[S.settings.dock].slice(1)}`);
    },
  });
  if (S.route) cmd('settings', 'All settings', () => { openDrawer(); setView('settings'); }, 'sliders', 'settings options preferences hub', { group: 'Settings' });
  else if (u) cmd('settings', 'All settings', () => goThenOpen(`${u}/animelist`, 'settings'), 'sliders', 'settings options preferences hub', { group: 'Settings', sub: 'In the hub, on your anime list' });
  for (const c of out) c._hay = [norm(c.label), norm(`${c.keywords} ${[].concat(c.sub).join(" ")}`)];
  return out;
}

/* Titles ------------------------------------------------------------ */

function titleSub(it) {
  const anime = it.type === 'ANIME';
  const parts = [anime ? 'Anime' : 'Manga'];
  if (it.status) {
    const total = anime ? it.episodes : it.chapters;
    let s = LABELS[it.type][it.status] || it.status;
    parts.push(s);
    if (['CURRENT', 'REPEATING', 'PAUSED', 'DROPPED'].includes(it.status)) parts.push(`${anime ? 'Ep' : 'Ch'} ${it.progress}${total ? ` of ${total}` : ''}`);
  } else {
    if (it.format) parts.push(FORMATS[it.format] || it.format);
    if (it.year) parts.push(String(it.year));
    parts.push('Not on your list');
  }
  return parts; // shown as separate pieces (palSub)
}

// A row's second line: one string, or separate facts side by side.
const palSub = (sub) => h('span', { class: 'apq-pal-sub' }, ...(Array.isArray(sub) ? sub.map((x) => h('span', {}, x)) : [sub]));

// Each title's names, ready for matching (kept out of the saved copy).
const palHay = new WeakMap();
function hayOf(it) {
  let v = palHay.get(it);
  if (!v) { v = [norm(it.title), ...it.alt.map(norm)]; palHay.set(it, v); }
  return v;
}

function titleItem(it, group) {
  palFresh(it);
  return { kind: 'title', group, key: `t:${it.type}:${it.id}`, label: it.title, sub: titleSub(it), href: it.url, cover: it.cover, title: it, _hay: hayOf(it) };
}

// The one-click action for a title: +1, start, resume or add to Planning.
function palQuick(it) {
  if (!it || !palName()) return null;
  const anime = it.type === 'ANIME';
  const own = palOwnEntry(it);
  if (!it.status) return PL.data ? { icon: 'plus', short: 'Add', label: 'Add to Planning', run: () => palAdd(it) } : null; // unknown until your lists load
  if (it.status === 'PLANNING' || it.status === 'PAUSED') {
    const word = it.status === 'PAUSED' ? 'Resume' : 'Start';
    return {
      icon: 'play', short: word, label: `${word} ${anime ? 'watching' : 'reading'}`,
      run: () => (own ? startEntry(it.id) : palSaveEntry(it, it.status === 'PLANNING' && it.priority >= PIN_MIN
        ? { status: 'CURRENT', priority: Number.isFinite(Number(S.pinPrev[it.id])) ? clamp(Number(S.pinPrev[it.id]), 0, MAX_PRIORITY) : 0 }
        : { status: 'CURRENT' })),
    };
  }
  if (it.status === 'COMPLETED') {
    return { icon: 'repeat', short: anime ? 'Rewatch' : 'Reread', label: anime ? 'Rewatch: back to episode 0' : 'Reread: back to chapter 0',
      run: () => (own ? startRewatch(it.id) : palSaveEntry(it, { status: 'REPEATING', progress: 0 })) };
  }
  if (it.status === 'CURRENT' || it.status === 'REPEATING') {
    const total = anime ? it.episodes : it.chapters;
    const n = (it.progress || 0) + 1;
    if (total && n > total) return null;
    if (anime && it.airing === 'RELEASING' && it.nextEp && n >= it.nextEp) return null; // not aired yet
    return { icon: 'plus', short: `${anime ? 'Ep' : 'Ch'} ${n}`, label: anime ? `Mark episode ${n} watched` : `Mark chapter ${n} read`, run: () => (own ? plusOne(it.id) : palSaveEntry(it, { progress: n })) };
  }
  return null;
}

async function palRunQuick(it) {
  const qa = palQuick(it);
  if (!qa || PL.busy.has(it.id) || S.busy.has(it.id)) return;
  PL.busy.add(it.id);
  renderPal();
  try { await qa.run(); }
  finally {
    PL.busy.delete(it.id);
    palFresh(it);
    palSaveCache();
    if (TP.route && TP.route.id === it.id) refreshTitle();
    renderPal();
  }
}

// Saves a change for a title that isn't on this page. Fills empty dates like everywhere else.
async function palSaveEntry(it, patch) {
  const anime = it.type === 'ANIME';
  const total = anime ? it.episodes : it.chapters;
  const progress = patch.progress != null ? patch.progress : it.progress || 0;
  let status = patch.status || it.status;
  if ((status === 'CURRENT' || status === 'REPEATING') && total && progress >= total) status = 'COMPLETED';
  const dates = datesToFill({ status: it.status, progress: it.progress || 0 },
    { status, progress, repeat: it.repeat, startedAt: it.startedAt, completedAt: it.completedAt });
  // A pinned title that moves to another list leaves the pins (pinLeaving in lists.js).
  if (patch.priority == null && it.priority >= PIN_MIN && it.status && status !== it.status) {
    const prev = Number(S.pinPrev[it.id]);
    patch = { ...patch, priority: Number.isFinite(prev) ? clamp(prev, 0, MAX_PRIORITY) : 0 };
  }
  const before = { status: it.status, progress: it.progress || 0 };
  if (patch.priority != null) before.priority = it.priority || 0;
  for (const k of Object.keys(dates)) before[k] = fuzzy(it[k]);
  try {
    palApplySaved(it, await titleSave({ id: it.entryId, ...patch, ...dates }));
  } catch {
    toast(`Couldn't update ${it.title}. Make sure you're logged in to AniList.`, 'error');
    return;
  }
  const msg = patch.progress == null || patch.status ? `${it.title} moved to ${LABELS[it.type][it.status] || it.status}`
    : it.status === 'COMPLETED' ? `${it.title} completed`
      : anime ? `${it.title}: episode ${it.progress} watched` : `${it.title}: chapter ${it.progress} read`;
  toast(msg + datesNote(before), 'ok', {
    label: 'Undo',
    run: async () => {
      try { palApplySaved(it, await titleSave({ id: it.entryId, ...before })); toast(`Undone for ${it.title}`); }
      catch { toast(`Couldn't undo that for ${it.title}.`, 'error'); }
      renderPal();
    },
  });
}

async function palAdd(it) {
  let saved;
  try { saved = await titleSave({ mediaId: it.id, status: 'PLANNING' }); }
  catch { toast(`Couldn't add ${it.title}. Make sure you're logged in to AniList.`, 'error'); return; }
  palApplySaved(it, saved);
  if (PL.data && !PL.data.items.some((x) => x.id === it.id && x.type === it.type)) PL.data.items.push(it);
  palSaveCache();
  toast(`${it.title} added to Planning${keptPrivate(saved)}`, 'ok', {
    label: 'Undo',
    run: async () => {
      try {
        await titleDelete(saved.id);
        it.status = null; it.entryId = null; it.progress = 0;
        if (PL.data) PL.data.items = PL.data.items.filter((x) => x !== it);
        palSaveCache();
        toast(`${it.title} removed again`);
      } catch { toast(`Couldn't undo that for ${it.title}.`, 'error'); }
      renderPal();
    },
  });
}

/* Searching --------------------------------------------------------- */

// 0 when the words don't all appear; higher for matches at the start of the name or of a word.
function palScore(q, hay) {
  const toks = q.split(/\s+/).filter(Boolean);
  if (!toks.length) return 0;
  let best = 0;
  hay.forEach((s, i) => {
    if (!s) return;
    let sc = 0;
    for (const t of toks) {
      const at = s.indexOf(t);
      if (at < 0) return;
      sc += at === 0 ? 3 : /[\s\-:;!?.,'"(/]/.test(s[at - 1]) ? 2 : 1;
    }
    if (s === q) sc += 4;
    else if (s.startsWith(q)) sc += 2;
    if (i) sc -= 0.5;
    if (sc > best) best = sc;
  });
  return best;
}

function scheduleSearch(q) {
  clearTimeout(PL.timer);
  if (q.length < 2 || PL.search.has(q)) return;
  PL.timer = setTimeout(async () => {
    const seq = ++PL.seq;
    PL.searching = q;
    renderPal();
    let found = [];
    try {
      const d = await gqlRead(PAL_SEARCH, { q });
      found = ((d && d.Page && d.Page.media) || []).map((m) => palItemFrom(null, m));
    } catch { found = null; }
    if (found) PL.search.set(q, found);
    if (seq === PL.seq) PL.searching = '';
    if (PL.open) renderPal();
  }, 320);
}

/* Building the list -------------------------------------------------- */

function palSections() {
  const q = norm(PL.query.trim()).replace(/\s+/g, ' ');
  const name = palName();
  const cmds = palCommands(name);
  const mine = PL.data ? PL.data.items : [];
  const sections = [];
  const add = (title, items, extra = {}) => { if (items.length) sections.push({ title, items, ...extra }); };

  if (!q) {
    add('Actions', cmds.filter((c) => c.group === 'Actions' && !c.quiet));
    if (TP.route) {
      const it = mine.find((x) => x.id === TP.route.id && x.type === TP.route.type)
        || (TP.data ? palItemFrom(TP.data.entry ? { id: TP.data.entry.id, mediaId: TP.route.id, status: TP.data.entry.status, progress: TP.data.entry.progress, repeat: TP.data.entry.repeat, startedAt: TP.data.entry.startedAt, completedAt: TP.data.entry.completedAt } : null,
          { id: TP.route.id, type: TP.data.type, episodes: TP.data.episodes, chapters: TP.data.chapters, title: { userPreferred: TP.data.title }, siteUrl: location.pathname }) : null);
      if (it) add('This title', [titleItem(it, 'This title')]);
    }
    const here = TP.route ? `t:${TP.route.type}:${TP.route.id}` : '';
    const cont = mine.filter((x) => (x.status === 'CURRENT' || x.status === 'REPEATING') && `t:${x.type}:${x.id}` !== here)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
    add('Continue', cont.map((it) => titleItem(it, 'Continue')));
    const shown = new Set([here, ...cont.map((x) => `t:${x.type}:${x.id}`)]);
    const recent = (PL.recent || []).filter((r) => !shown.has(r.key)).slice(0, 4).map((r) => {
      const t = r.title && mine.find((x) => x.id === r.title.id && x.type === r.title.type);
      return t ? titleItem(t, 'Recent') : { kind: r.title ? 'title' : 'link', group: 'Recent', key: r.key, label: r.label, sub: r.sub, href: r.href, icon: r.icon, cover: r.cover, title: r.title ? palItemFrom(null, { id: r.title.id, type: r.title.type, title: { userPreferred: r.label }, siteUrl: r.href, coverImage: { medium: r.cover } }) : null };
    });
    add('Recent', recent);
    add('Go to', cmds.filter((c) => c.kind === 'link' && c.short));
    return sections;
  }

  const scored = (list, cap) => list.map((x) => ({ x, s: palScore(q, x._hay) })).filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.x.label.length - b.x.label.length).slice(0, cap);
  const rank = { CURRENT: 0, REPEATING: 0, PLANNING: 1, PAUSED: 2, COMPLETED: 3, DROPPED: 4 };
  const titles = mine.map((it) => ({ it, s: palScore(q, hayOf(it)) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || (rank[a.it.status] ?? 5) - (rank[b.it.status] ?? 5) || a.it.title.length - b.it.title.length)
    .slice(0, 8);
  const groups = [
    { title: 'Actions', rows: scored(cmds.filter((c) => c.group === 'Actions'), 5) },
    { title: 'Your titles', rows: titles.map((r) => ({ x: titleItem(r.it, 'Your titles'), s: r.s })) },
    { title: 'Go to', rows: scored(cmds.filter((c) => c.group === 'Go to'), 5) },
    { title: 'Lists', rows: scored(cmds.filter((c) => c.group === 'Lists'), 6) },
    { title: 'Settings', rows: scored(cmds.filter((c) => c.group === 'Settings'), 6) },
  ].filter((g) => g.rows.length);
  // The group with the best match comes first; ties keep the order above.
  groups.forEach((g, i) => { g.top = g.rows[0].s; g.i = i; });
  groups.sort((a, b) => b.top - a.top || a.i - b.i);
  for (const g of groups) add(g.title, g.rows.map((r) => r.x));

  // AniList's own search, for titles that aren't on your lists.
  const raw = PL.query.trim();
  const mineKeys = new Set(titles.map((r) => `${r.it.type}:${r.it.id}`));
  const found = PL.search.get(q);
  if (found) {
    const rows = found.filter((m) => !mineKeys.has(`${m.type}:${m.id}`)).slice(0, 6).map((m) => {
      const own = mine.find((x) => x.id === m.id && x.type === m.type);
      return titleItem(own || m, 'On AniList');
    });
    add('On AniList', rows);
  } else if (q.length >= 2) {
    add('On AniList', [{ kind: 'wait', group: 'On AniList', key: 'wait', label: 'Searching AniList…', sub: '', icon: null, disabled: true }]);
  }
  const more = [{ kind: 'link', group: 'More', key: 'search-al', label: `Search AniList for “${raw}”`, href: `/search/anime?search=${encodeURIComponent(raw)}`, icon: 'search', sub: 'Anime search page' }];
  if (/^[A-Za-z0-9_-]{2,20}$/.test(raw)) more.push({ kind: 'link', group: 'More', key: `user:${raw.toLowerCase()}`, label: `Open ${raw}'s profile`, href: `/user/${encodeURIComponent(raw)}/`, icon: 'star', sub: 'If that user exists' });
  add('More', more);
  return sections;
}

/* Rendering ---------------------------------------------------------- */

function buildPal() {
  if (PL.el) return;
  PL.scrim = h('div', { class: 'apq-ui apq-pal-scrim', onclick: () => closePal() });
  PL.input = h('input', {
    type: 'text', class: 'apq-pal-input', placeholder: 'Search titles, lists, pages, settings…', spellcheck: 'false', autocomplete: 'off',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'apq-pal-list', 'aria-autocomplete': 'list', 'aria-label': 'Search titles, lists, pages, settings and actions',
  });
  PL.input.addEventListener('input', () => { PL.query = PL.input.value; PL.active = 0; PL.moved = false; scheduleSearch(norm(PL.query.trim()).replace(/\s+/g, ' ')); renderPal(); });
  PL.input.addEventListener('keydown', onPalKey);
  PL.status = h('span', { class: 'apq-pal-status', 'aria-hidden': 'true' });
  PL.list = h('div', { class: 'apq-pal-list', id: 'apq-pal-list', role: 'listbox', 'aria-label': 'Results' });
  PL.foot = h('div', { class: 'apq-pal-foot' });
  PL.el = h('div', { class: 'apq-ui apq-pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search and commands' },
    h('label', { class: 'apq-pal-bar' }, icon('search'), PL.input, PL.status, h('span', { class: 'apq-kbd apq-pal-esc' }, 'Esc')),
    PL.list, PL.foot);
  document.body.append(PL.scrim, PL.el);
}

function openPal() {
  if (!S.settings.palette || S.massOpen) return;
  buildPal();
  closePopover(false);
  closePick();
  closeFeedPanel();
  hideTip();
  PL.open = true;
  PL.query = '';
  PL.pointer = null;
  PL.input.value = '';
  PL.active = 0;
  PL.moved = false;
  renderPal();
  requestAnimationFrame(() => {
    PL.scrim.classList.add('is-open');
    PL.el.classList.add('is-open');
    PL.input.focus({ preventScroll: true });
  });
  palRecentList().then(() => { if (PL.open) renderPal(); });
  palLoad();
}

function closePal() {
  if (!PL.open) return;
  PL.open = false;
  clearTimeout(PL.timer);
  PL.el.classList.remove('is-open');
  PL.scrim.classList.remove('is-open');
  if (document.activeElement === PL.input) PL.input.blur();
}

function togglePal() { if (PL.open) closePal(); else openPal(); }

function palRow(item, idx) {
  const active = idx === PL.active;
  const lead = item.cover
    ? h('span', { class: 'apq-pal-cover' }, h('img', { src: item.cover, alt: '', loading: 'lazy', decoding: 'async' }))
    : h('span', { class: 'apq-pal-ic' }, item.kind === 'wait' ? spinner() : icon(item.icon || (item.kind === 'title' ? 'play' : 'external')));
  const row = h('div', {
    class: 'apq-pal-row' + (active ? ' is-active' : '') + (item.disabled ? ' is-disabled' : ''),
    id: `apq-pal-o${idx}`, role: 'option', 'aria-selected': String(active), 'aria-disabled': item.disabled ? 'true' : null,
    'data-key': item.key,
  }, lead, h('span', { class: 'apq-pal-text' }, h('span', { class: 'apq-pal-label' }, item.label), item.sub && item.sub.length ? palSub(item.sub) : null));
  if (item.kind === 'title') {
    const qa = palQuick(item.title);
    if (qa) {
      const busy = PL.busy.has(item.title.id) || S.busy.has(item.title.id);
      row.append(h('button', {
        type: 'button', class: 'apq-pal-quick', tabindex: '-1', disabled: busy, 'aria-label': qa.label, title: `${qa.label} (Shift+Enter)`,
        onclick: (ev) => { ev.stopPropagation(); palRunQuick(item.title); PL.input.focus({ preventScroll: true }); },
      }, busy ? spinner() : icon(qa.icon), h('span', {}, qa.short)));
    }
  } else if (item.kind === 'setting') {
    row.append(h('span', { class: 'apq-pal-val' + (item.on ? ' is-on' : '') }, item.value));
  } else if (item.hint) {
    row.append(h('span', { class: 'apq-kbd apq-pal-hint' }, item.hint));
  }
  // Only a real move of the mouse: Chrome also sends one when the list redraws under a still pointer.
  row.addEventListener('pointermove', (ev) => {
    const at = `${ev.screenX},${ev.screenY}`;
    if (PL.pointer === at) return;
    PL.pointer = at;
    if (PL.active !== idx) { PL.active = idx; PL.moved = true; paintActive(); }
  });
  row.addEventListener('click', (ev) => runPalItem(item, { newTab: ev.ctrlKey || ev.metaKey, quick: ev.shiftKey }));
  row.addEventListener('auxclick', (ev) => { if (ev.button === 1 && item.href) { ev.preventDefault(); runPalItem(item, { newTab: true }); } });
  return row;
}

function paintActive() {
  PL.list.querySelectorAll('.apq-pal-row').forEach((r, i) => {
    const on = i === PL.active;
    r.classList.toggle('is-active', on);
    r.setAttribute('aria-selected', String(on));
  });
  PL.input.setAttribute('aria-activedescendant', `apq-pal-o${PL.active}`);
  renderPalFoot();
}

function renderPal() {
  if (!PL.open || !PL.el) return;
  const keepKey = PL.items[PL.active] && PL.items[PL.active].key;
  const sections = palSections();
  const items = [];
  const nodes = [];
  for (const sec of sections) {
    nodes.push(h('div', { class: 'apq-pal-head', role: 'presentation' }, sec.title));
    for (const it of sec.items) { nodes.push(palRow(it, items.length)); items.push(it); }
  }
  // Keep the row you moved to highlighted when the list redraws (a save, AniList's search coming back).
  if (keepKey && PL.query === PL.lastQuery) {
    const keep = PL.moved || PL.busy.size > 0; // otherwise the best match stays on top
    const i = keep ? items.findIndex((x) => x.key === keepKey) : -1;
    PL.active = i >= 0 ? i : 0;
  }
  PL.lastQuery = PL.query;
  if (PL.active >= items.length) PL.active = Math.max(0, items.length - 1);
  while (items[PL.active] && items[PL.active].disabled && PL.active < items.length - 1) PL.active++;
  PL.items = items;
  if (!palName() && PL.viewer === null && !PL.query) {
    nodes.push(h('p', { class: 'apq-pal-note' }, 'Log in to AniList to search your own lists here.'));
  } else if (PL.error && !PL.data) {
    nodes.push(h('p', { class: 'apq-pal-note' }, `Couldn't load your lists: ${PL.error.message}.`));
  }
  if (!items.length && !nodes.length) nodes.push(h('p', { class: 'apq-pal-note' }, 'Nothing here yet.'));
  PL.list.replaceChildren(...nodes);
  PL.status.replaceChildren(PL.loading || PL.searching ? spinner() : '');
  PL.status.title = PL.loading ? 'Loading your lists…' : PL.searching ? 'Searching AniList…' : '';
  paintActive();
  const act = PL.list.querySelector('.apq-pal-row.is-active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}

function renderPalFoot() {
  const it = PL.items[PL.active];
  const k = (key, text) => h('span', { class: 'apq-pal-k' }, h('span', { class: 'apq-kbd' }, key), text);
  const kids = [k('↑↓', 'Move')];
  if (it && !it.disabled) {
    if (it.kind === 'title') {
      kids.push(k('↵', 'Open'));
      const qa = palQuick(it.title);
      if (qa) kids.push(k('⇧↵', qa.label));
      kids.push(k('Ctrl ↵', 'New tab'));
    } else if (it.kind === 'link') {
      kids.push(k('↵', 'Go'), k('Ctrl ↵', 'New tab'));
    } else if (it.kind === 'setting') {
      kids.push(k('↵', it.locked ? 'Can\'t switch off' : 'Switch'));
    } else {
      kids.push(k('↵', 'Run'));
    }
  }
  PL.foot.replaceChildren(...kids);
}

function movePal(delta) {
  const n = PL.items.length;
  if (!n) return;
  let i = PL.active;
  for (let step = 0; step < n; step++) {
    i = (i + delta + n) % n;
    if (!PL.items[i].disabled) break;
  }
  PL.active = i;
  PL.moved = true;
  paintActive();
  const act = PL.list.querySelector('.apq-pal-row.is-active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}

function onPalKey(ev) {
  if (isPaletteKey(ev)) return; // the page's handler closes the palette
  const k = ev.key;
  if (k === 'ArrowDown' || (k === 'Tab' && !ev.shiftKey)) { ev.preventDefault(); ev.stopPropagation(); movePal(1); return; }
  if (k === 'ArrowUp' || (k === 'Tab' && ev.shiftKey)) { ev.preventDefault(); ev.stopPropagation(); movePal(-1); return; }
  if (k === 'PageDown' || k === 'PageUp') { ev.preventDefault(); ev.stopPropagation(); movePal(k === 'PageDown' ? 5 : -5); return; }
  if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePal(); return; }
  if (k === 'Enter') {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.isComposing) return;
    const it = PL.items[PL.active];
    if (it) runPalItem(it, { newTab: ev.ctrlKey || ev.metaKey, quick: ev.shiftKey });
    return;
  }
  ev.stopPropagation(); // typing here never reaches the page's shortcuts
}

function runPalItem(item, { newTab = false, quick = false } = {}) {
  if (!item || item.disabled) return;
  if (item.kind === 'title') {
    if (quick) { palRunQuick(item.title); return; }
    palRemember({ ...item, title: { id: item.title.id, type: item.title.type } });
    closePal();
    goTo(item.href, newTab);
    return;
  }
  if (item.kind === 'link') {
    palRemember(item);
    closePal();
    goTo(item.href, newTab);
    return;
  }
  if (item.kind === 'setting') { item.run(); renderPal(); return; }
  if (item.kind === 'cmd') {
    if (!item.stay) closePal();
    item.run();
    if (item.stay) renderPal();
  }
}
