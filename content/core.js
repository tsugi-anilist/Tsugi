// Tsugi · Constants, state, small helpers, the AniList API, accent color, watch order, episode counts.
'use strict';

window.__apqContent = true; // a second copy would fail on its first line, so it can't run twice
const EXT_VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch { return ''; } })();

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const LEGACY_SETTINGS_KEY = 'apq:settings:v1'; // the userscript's settings, brought over once
const LEGACY_COLOR_KEY = 'apq:viewerColor';
const LEGACY_REL_KEY = 'apq:rel:v1';
const REL_KEY = 'rel:v1';
const REL_TTL = 14 * 24 * 3600 * 1000;
const REL_V = 2;
// Priorities 1–94 are yours. 95–99 hold pins: a pinned title sits above every priority,
// on AniList itself too (and in other apps), and the top pin gets 99.
const MAX_PRIORITY = 94;
const PIN_MIN = 95;
const PIN_TOP = 99;
const PIN_LIMIT = 5;
const MEDIA_RE = /^(?:https?:\/\/anilist\.co)?\/(anime|manga)\/(\d+)/;
const LIST_RE = /^\/user\/([^/]+)\/(animelist|mangalist)(?:\/([^/]+))?\/?$/;
const TAB_STATUSES = ['PLANNING', 'CURRENT', 'PAUSED', 'REPEATING', 'DROPPED'];
const LABELS = {
  ANIME: { PLANNING: 'Planning', CURRENT: 'Watching', PAUSED: 'Paused', REPEATING: 'Rewatching', DROPPED: 'Dropped', COMPLETED: 'Completed' },
  MANGA: { PLANNING: 'Planning', CURRENT: 'Reading', PAUSED: 'Paused', REPEATING: 'Rereading', DROPPED: 'Dropped', COMPLETED: 'Completed' },
};
const FORMATS = {
  TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA',
  MUSIC: 'Music', MANGA: 'Manga', NOVEL: 'Light Novel', ONE_SHOT: 'One-shot',
};
// AniList's profile colors.
const PROFILE_COLORS = {
  blue: '61,180,242', purple: '192,99,255', pink: '252,157,214', orange: '239,136,26',
  red: '225,51,51', green: '76,202,81', gray: '103,123,148',
};
const ACCENTS = ['auto', 'blue', 'purple', 'pink', 'orange', 'red', 'green', 'gray'];

// The list's own request (LIST_QUERY and its fallbacks, listVars) is in listquery.js (0.12.8), loaded at document_start.
const VIEWER_QUERY = `query { Viewer { id name options { profileColor } } }`;
const RELATIONS_QUERY = `query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(id_in: $ids) {
      id type format startDate { year month day }
      relations { edges { relationType(version: 2) node { id type format startDate { year month day } title { userPreferred } } } }
    }
  }
}`;
const SAVE_MUTATION = `mutation ($id: Int, $priority: Int) {
  SaveMediaListEntry(id: $id, priority: $priority) { id mediaId priority }
}`;
const BULK_MUTATION = `mutation ($ids: [Int], $priority: Int) {
  UpdateMediaListEntries(ids: $ids, priority: $priority) { id priority }
}`;
// Variables left out of a request are left unchanged on AniList.
const ENTRY_MUTATION = `mutation ($id: Int, $status: MediaListStatus, $progress: Int, $score: Float, $priority: Int, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
  SaveMediaListEntry(id: $id, status: $status, progress: $progress, score: $score, priority: $priority, startedAt: $startedAt, completedAt: $completedAt) {
    id status progress score priority repeat startedAt { year month day } completedAt { year month day }
  }
}`;

const DOT = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="1.3" fill="currentColor" stroke="none"/>`;
const ICONS = {
  psmall: '<rect x="3" y="3.5" width="4.5" height="7" rx="1"/><rect x="9.75" y="3.5" width="4.5" height="7" rx="1"/><rect x="16.5" y="3.5" width="4.5" height="7" rx="1"/><rect x="3" y="13.5" width="4.5" height="7" rx="1"/><rect x="9.75" y="13.5" width="4.5" height="7" rx="1"/><rect x="16.5" y="13.5" width="4.5" height="7" rx="1"/>',
  pbig: '<rect x="3.5" y="3" width="7" height="12" rx="1.5"/><rect x="13.5" y="3" width="7" height="12" rx="1.5"/><path d="M4 18.5h6"/><path d="M14 18.5h6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  desc: '<path d="M3 16l4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>',
  asc: '<path d="M3 8l4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 16h7"/><path d="M11 20h10"/>',
  sort: '<path d="M7 4v16"/><path d="M3 8l4-4 4 4"/><path d="M17 20V4"/><path d="M13 16l4 4 4-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5v.01"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3"/><path d="M20 20v-4h-4"/>',
  inbox: '<path d="M4 13l2.5-7.5A2 2 0 0 1 8.4 4h7.2a2 2 0 0 1 1.9 1.5L20 13"/><path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5h-5l-1 2h-4l-1-2z"/>',
  select: '<path d="M3.5 6.2l1.6 1.6L8 4.9"/><path d="M11.5 6.5H20"/><path d="M3.5 12.2l1.6 1.6L8 10.9"/><path d="M11.5 12.5H20"/><path d="M3.5 18.2l1.6 1.6L8 16.9"/><path d="M11.5 18.5H20"/>',
  dice: `<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/>${DOT(8.6, 8.6)}${DOT(15.4, 8.6)}${DOT(12, 12)}${DOT(8.6, 15.4)}${DOT(15.4, 15.4)}`,
  lists: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  sliders: '<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="9" cy="17" r="2"/>',
  back: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
  play: '<path d="M8 5.6v12.8a.6.6 0 0 0 .9.5l10.2-6.4a.6.6 0 0 0 0-1L8.9 5.1a.6.6 0 0 0-.9.5z" fill="currentColor"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  frown: '<circle cx="12" cy="12" r="9"/><path d="M8.5 16.2c2-1.8 5-1.8 7 0"/><path d="M9 9.8v.01"/><path d="M15 9.8v.01"/>',
  meh: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15h7"/><path d="M9 9.8v.01"/><path d="M15 9.8v.01"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14c2 2 5 2 7 0"/><path d="M9 9.8v.01"/><path d="M15 9.8v.01"/>',
  order: '<path d="M4 6h10"/><path d="M4 12h6"/><path d="M16 9l3 3-3 3"/><path d="M10 12h9"/><path d="M4 18h10"/>',
  pin: '<path d="M8.5 3.5h7"/><path d="M10 3.5v5.2l-3 3.3v1.5h10V12l-3-3.3V3.5"/><path d="M12 13.5V20.5"/>',
  edit: '<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  listPlus: '<path d="M4 6h11"/><path d="M4 12h11"/><path d="M4 18h7"/><path d="M18 14v6"/><path d="M15 17h6"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11v-1a4 4 0 0 1 4-4h12"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v1a4 4 0 0 1-4 4H4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  more: `${DOT(6, 12)}${DOT(12, 12)}${DOT(18, 12)}`,
  arrowUp: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
  posters: '<rect x="3.5" y="4" width="7" height="10.5" rx="1.4"/><rect x="13.5" y="4" width="7" height="10.5" rx="1.4"/><path d="M4.5 18.5h5"/><path d="M14.5 18.5h5"/>',
  pulse: '<path d="M3 12.5h4l2.2-6 4.2 11.5 2.4-5.5H21"/>',
  grip: `${DOT(9, 6)}${DOT(15, 6)}${DOT(9, 12)}${DOT(15, 12)}${DOT(9, 18)}${DOT(15, 18)}`,
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16"/><path d="M8.5 3.5v4"/><path d="M15.5 3.5v4"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2l5.6 5.6"/><path d="M14.8 9.2l-5.6 5.6"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.8L7 20z"/>',
  // A video's rounded screen with its play triangle: a song's search on YouTube (0.12.7).
  video: '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9.3v5.4l4.6-2.7z" fill="currentColor"/>',
};

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const S = {
  route: null,          // { user, type, list }
  data: null,           // { key, entries: Map, lists: [], fetchedAt, canEdit, viewer }
  loading: false,
  error: null,
  inflight: null,
  settings: normalizeSettings({}),
  viewerColor: null,
  auth: null,           // { viewer } when AniList's official login is connected
  me: null,             // { id, name }: the AniList account seen last (local "me"), for ownPage()
  drawerOpen: false,
  view: 'list',         // 'list' | 'check' | 'settings'
  tab: 'PLANNING',
  query: '',
  collapsed: {},
  pending: new Map(),   // mediaId -> { value, entryId, timer }
  confirmed: new Map(), // mediaId -> last value AniList confirmed
  rowState: new Map(),  // mediaId -> 'saving' | 'saved' | 'error'
  stateTimers: new Map(),
  flash: new Set(),
  hoverId: null,
  hoverList: '',        // the list of the title under the mouse ('' = AniList's priority: the hub)
  popover: null,
  filling: false,
  fillAttempted: null,
  selecting: false,
  selected: new Set(),
  anchor: null,
  rel: new Map(),       // mediaId -> [[id, title], ...] titles to finish first
  relLoading: false,
  pickOpen: false,
  pickOpts: { length: 'any', ready: true, onlyPrio: false },
  pickRecent: [],
  busy: new Set(),      // mediaIds with a status/progress request in flight
  gone: new Set(),      // mediaIds deleted by a mass edit (hidden on the page until Undo or reload)
  massOpen: false,
  sorts: {},            // 'ANIME/planning' -> { prio: true, al: 'Title' }: each list's sort, remembered
  pinPrev: {},          // mediaId -> the priority a title had before it was pinned
};
const D = { rows: new Map() }; // drawer refs
const K = {};                  // dock refs
const B = {};                  // bulk bar refs
const PK = {};                 // pick dialog refs
const T = {};                  // toast refs
const TIP = { el: null, target: null, timer: 0 };

// dock: where the hub's button is. 'bar' (0.7.1, the default): in AniList's own top bar, next to its search;
// 'always' / 'near': the floating round button in a corner (always shown, or as the pointer comes near);
// 'hide': none (the P key). Settings saved before 0.7.1 (no dockBar) move once from the floating button to the
// top bar, unless the button was hidden. popup.js has a copy of this function: change both together.
function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = Object.assign({
    dir: 'desc', sortPage: false, dock: 'bar', dockSide: 'right', accent: 'auto',
    badges: true, watchOrder: true, newEps: true, keys: true, rememberSort: true,
    autoDates: true, history: true, palette: true, feedFilters: true, listViews: true, hideAdult: false, prioFinished: false,
    posters: false, malData: true, theme: 'site', paletteHub: true,
    // 0.12.5: a switch for everything (popup.js has the same defaults).
    listSorts: true, listFilters: true, dragOrder: true, pick: true, listCheck: true,
    // 0.12.7: MyAnimeList's and Reddit's links in a title's sidebar, a profile's follower counts, why a profile is
    // missing, AniList's link on MyAnimeList's pages (background.js registers that script), the global feed hidden.
    sideLinks: true, socialCounts: true, check404: true, malLinks: true, hideGlobal: false,
  }, r);
  if (!r.dockBar && s.dock !== 'hide') s.dock = 'bar';
  s.dockBar = true;
  if (!['bar', 'always', 'near', 'hide'].includes(s.dock)) s.dock = 'bar';
  if (!['right', 'left'].includes(s.dockSide)) s.dockSide = 'right';
  if (!ACCENTS.includes(s.accent)) s.accent = 'auto';
  if (s.dock === 'hide') s.keys = true; // keep a way to open the panel
  s.paletteHub = s.paletteHub !== false;
  for (const k of ['listSorts', 'listFilters', 'dragOrder', 'pick', 'listCheck', 'sideLinks', 'socialCounts', 'check404', 'malLinks']) s[k] = s[k] !== false;
  s.hideGlobal = s.hideGlobal === true;
  s.scores = normalizeScores(r.scores, r.malData);
  return s;
}
// List views' parts (0.12.5): each its own switch, all under List views.
const sortsOn = () => !!(S.settings.listViews && S.settings.listSorts);
const filtersOn = () => !!(S.settings.listViews && S.settings.listFilters);
// After List views, Sorts or Filters change: the menus close, the sidebar's filters come or go, lists re-sort.
function partsChanged() {
  closeViewPanel();
  if (!S.route) return;
  placeListChrome();
  if (S.data) { applyPageSort(); scheduleFill(); }
}
// The scores on title pages (0.12.4), one switch per site: AniList, MyAnimeList, MangaBaka, Kitsu. Before
// 0.12.4 one switch (malData) said whether Tsugi asked anything outside AniList: if it was off, the other
// sites' scores start off too. popup.js has a copy: change both together.
// (The defaults are inside: S's own settings are made before the rest of this file has run.)
function normalizeScores(raw, malData) {
  const defaults = { al: true, mal: true, mb: true, kitsu: false, mu: false, ap: false, ann: false, shiki: false };
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = r && typeof r[k] === 'boolean' ? r[k] : !r && malData === false && k !== 'al' ? false : defaults[k];
  return out;
}

// Extension storage: "sync" for settings, "local" for caches and the login.
// The browser tells every tab about each save, this one included, and that notice can arrive
// after a newer change made here. What this tab saved itself is remembered for a few seconds,
// so its own late echo can't undo that newer change.
// Chrome gives objects back with their keys sorted, so they're compared that way.
const ownWrites = new Map(); // key -> [{ json, t }]
function stableJSON(v) {
  if (Array.isArray(v)) return `[${v.map(stableJSON).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJSON(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
// Notices come in the order of the saves: once a save's own notice is seen, it and the older ones are
// forgotten, so the same value saved elsewhere a moment later (the popup switching a setting back) counts
// as a change, not as a late echo (0.7; it was ignored for 5 s).
function isOwnEcho(key, value) {
  const json = stableJSON(value === undefined ? null : value);
  const list = ownWrites.get(key) || [];
  const i = list.findIndex((w) => w.json === json && Date.now() - w.t < 5000);
  if (i < 0) return false;
  list.splice(0, i + 1);
  return true;
}
const store = {
  async get(area, key) {
    try { return (await chrome.storage[area].get(key))[key]; } catch { return undefined; }
  },
  async set(area, key, value) {
    const now = Date.now();
    ownWrites.set(key, (ownWrites.get(key) || []).filter((w) => now - w.t < 5000).concat({ json: stableJSON(value), t: now }));
    try { await chrome.storage[area].set({ [key]: value }); } catch { /* extension was reloaded */ }
  },
};

let settingsTimer = 0;
function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => store.set('sync', 'settings', { ...S.settings }), 250);
}

const objectOr = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function legacy(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

async function loadState() {
  let raw = await store.get('sync', 'settings');
  if (!raw) {
    // First run: bring over the userscript's settings, if there are any.
    try { raw = JSON.parse(legacy(LEGACY_SETTINGS_KEY) || 'null'); } catch { raw = null; }
    if (raw) await store.set('sync', 'settings', normalizeSettings(raw));
  }
  S.settings = normalizeSettings(raw);
  S.sorts = objectOr(await store.get('sync', 'sorts'));
  S.pinPrev = objectOr(await store.get('sync', 'pinPrev'));
  await loadCustomPrio();
  await loadFineOrder();
  HC.ok = objectOr(await store.get('local', CHECK_OK_KEY)); // titles the list check leaves alone (health.js)
  FD.settings = normalizeFeed(await store.get('sync', 'feed'));
  LV.filters = objectOr(await store.get('sync', 'lfilters'));
  LV.adultSeen = objectOr(await store.get('local', 'lv:adult'));
  LV.saved = normalizeSaved(await store.get('sync', 'views'));
  await loadNsfw();   // what counts as NSFW (0.12.3, content/privacy.js)
  S.viewerColor = (await store.get('local', 'viewerColor')) || legacy(LEGACY_COLOR_KEY) || null;
  siteThemeSaved = (await store.get('local', 'siteTheme')) || null; // main.js, noteSiteTheme
  const auth = await store.get('local', 'auth');
  S.auth = auth && auth.token && auth.viewer ? { viewer: auth.viewer } : null;
  S.me = objectOr(await store.get('local', 'me')); // the AniList account seen last, for ownPage() before a list loads
}

// Settings changed in another tab, or the login changed from the toolbar popup.
function onStorageChanged(changes, area) {
  if (area === 'sync' && changes.settings && !isOwnEcho('settings', changes.settings.newValue)) {
    const next = normalizeSettings(changes.settings.newValue);
    if (JSON.stringify(next) === JSON.stringify(S.settings)) return;
    const was = S.settings;
    S.settings = next;
    // What the hub's own switches do after a change (renderSettings), for a change made in the
    // toolbar popup's Settings (0.6.10) or in another tab.
    if (next.listViews !== was.listViews || next.listSorts !== was.listSorts || next.listFilters !== was.listFilters) partsChanged();
    if (next.dock !== was.dock) { placeNavBtn(); renderDock(); }
    if (!next.pick) closePick();
    if (!next.listCheck && S.view === 'check') S.view = 'list';
    applyAccent();
    if (S.route) renderAll();
    applyPageSort();
    syncFeed();
    if (!S.settings.palette) closePal();
    if (next.watchOrder && !was.watchOrder) ensureRelations();
    if (next.watchOrder !== was.watchOrder || next.newEps !== was.newEps) scheduleRefresh();
    if (next.history !== was.history && S.popover) updatePopover();
    if (next.malData !== was.malData || next.sideLinks !== was.sideLinks || stableJSON(next.scores) !== stableJSON(was.scores)) onOutsideRoute(TP.route);
    if (next.socialCounts !== was.socialCounts || next.check404 !== was.check404) decorateSocial();
  }
  if (area === 'sync' && changes.sorts && !isOwnEcho('sorts', changes.sorts.newValue)) {
    const next = objectOr(changes.sorts.newValue);
    if (stableJSON(next) !== stableJSON(S.sorts)) {
      S.sorts = next;
      applyPageSort();
      scheduleFill();
      renderSortMenu();
      renderDock();
      if (D.drawer) renderDrawerChrome();
    }
  }
  if (area === 'sync' && changes.pinPrev && !isOwnEcho('pinPrev', changes.pinPrev.newValue)) S.pinPrev = objectOr(changes.pinPrev.newValue);
  for (const [name, ch] of Object.entries(changes)) {
    if (name.startsWith(CP_PREFIX) && (area === 'sync' || area === 'local') && ch.newValue && !isOwnEcho(name, ch.newValue)) onCustomPrioStorage(name, ch.newValue);
    if (name.startsWith(FO_PREFIX) && (area === 'sync' || area === 'local') && !isOwnEcho(name, ch.newValue)) onFineOrderStorage(name, ch.newValue);
  }
  if (area === 'sync' && changes.feed && !isOwnEcho('feed', changes.feed.newValue)) onFeedStorage(changes.feed.newValue);
  if (area === 'sync' && changes.lfilters && !isOwnEcho('lfilters', changes.lfilters.newValue)) onViewsStorage('filters', changes.lfilters.newValue);
  if (area === 'sync' && changes.views && !isOwnEcho('views', changes.views.newValue)) onViewsStorage('saved', changes.views.newValue);
  if ((area === 'sync' && changes.nsfw) || ((area === 'sync' || area === 'local') && changes['nsfw:marks'])) onNsfwStorage();
  if (area === 'local' && changes.auth) {
    const a = changes.auth.newValue;
    const was = !!S.auth;
    S.auth = a && a.token && a.viewer ? { viewer: a.viewer } : null;
    if (was !== !!S.auth && S.route) ensureData(true);
    else if (D.drawer && S.view === 'settings') renderSettings();
  }
  if (area === 'local' && changes.viewerColor) {
    const c = changes.viewerColor.newValue || null;
    if (c !== S.viewerColor) {
      S.viewerColor = c;
      applyAccent();
      if (D.drawer && S.view === 'settings') renderSettings();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const plural = (n) => `${n} ${n === 1 ? 'title' : 'titles'}`;
const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Icons are read from their markup once, then copied: a long list makes a badge and a poster for every row, each
// with a few icons, and reading the markup each time was a good part of drawing them (perf, 0.12.8).
const SVG_KEPT = new Map();
function svgCopy(key, markup) {
  let n = SVG_KEPT.get(key);
  if (!n) {
    const t = document.createElement('template');
    t.innerHTML = markup();
    n = t.content.firstElementChild;
    SVG_KEPT.set(key, n);
  }
  return n.cloneNode(true);
}

function icon(name, cls = '') {
  return svgCopy(`i:${name}:${cls}`, () => `<svg class="apq-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`);
}

// The signature glyph: three bars, filled up to the title's tier.
function glyph(tier = 3, cls = '') {
  return svgCopy(`g:${tier}:${cls}`, () => `<svg class="apq-glyph t${tier} ${cls}" viewBox="0 0 12 12" aria-hidden="true">` +
    '<rect class="b1" x="0.8" y="7.2" width="2.6" height="4" rx="0.9"/>' +
    '<rect class="b2" x="4.7" y="4.4" width="2.6" height="6.8" rx="0.9"/>' +
    '<rect class="b3" x="8.6" y="1.4" width="2.6" height="9.8" rx="0.9"/></svg>');
}

// Tsugi's mark (brand/tsugi-mark.svg): the triangle takes --accent, the kanji the text color.
// Only for the extension itself (the hub's rail); the three bars above mean priority.
function mark(cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="apq-tsugi ${cls}" viewBox="12 12 76 76" aria-hidden="true"><path d="M19 37 L35.5 51 L19 65 Z" fill="var(--accent, #EF4136)" stroke="var(--accent, #EF4136)" stroke-width="4" stroke-linejoin="round"/><path d="M55.5 18 L46.5 33" stroke="currentColor" stroke-width="9.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M50.5 30 H77.5 L71.5 40.5" stroke="currentColor" stroke-width="9.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M63.5 37 C62.5 56 54.5 70 40.5 81.5" stroke="currentColor" stroke-width="9.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M63.5 50 C67.5 62 72.5 72 80.5 79.5" stroke="currentColor" stroke-width="9.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return t.content.firstElementChild;
}

const spinner = () => h('span', { class: 'apq-spin', 'aria-hidden': 'true' });

const isPinned = (e) => !!e && e.priority >= PIN_MIN;
// Completed and Dropped leave priorities out by default (each list's menu has a switch: prioOn in lists.js).
const FINISHED = ['COMPLETED', 'DROPPED'];
const entryOf = (id) => (S.data && S.data.entries.get(id)) || null;

// The highest ordinary priority (pins don't count).
function maxPriority() {
  let m = 0;
  if (!S.data) return 0;
  const on = {}; // each status list's Priorities switch, looked up once
  for (const e of S.data.entries.values()) {
    if (!(e.priority > m) || isPinned(e)) continue;
    if (!(e.status in on)) on[e.status] = statusPrioOn(e.status);
    if (on[e.status]) m = e.priority;
  }
  return m;
}

// Dates on AniList can be partial: just a year, or a year and a month.
function fuzzy(d) {
  const n = (v) => (Number.isInteger(v) && v > 0 ? v : null);
  return { year: n(d && d.year), month: n(d && d.month), day: n(d && d.day) };
}
const fuzzyKey = (d) => `${d.year || ''}-${d.month || ''}-${d.day || ''}`;
function fuzzyText(d) {
  if (!d || !d.year) return '–';
  const pad = (v) => String(v).padStart(2, '0');
  return d.month ? (d.day ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : `${d.year}-${pad(d.month)}`) : String(d.year);
}
function todayFuzzy() {
  const t = new Date();
  return { year: t.getFullYear(), month: t.getMonth() + 1, day: t.getDate() };
}
const hasDate = (d) => !!(d && d.year);
// "2 May 2024", "May 2024" or "2024". English, like the rest of the extension.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateWords(d) {
  if (!hasDate(d)) return '';
  if (!d.month) return String(d.year);
  return `${d.day ? `${d.day} ` : ''}${MONTHS[d.month - 1]} ${d.year}`;
}

// Start and finish dates, filled in automatically. Only empty dates are filled, and only when a
// title is started or finished for the first time: a rewatch leaves them alone (they belong to
// the first watch; the rewatch log keeps the others).
// prev: { status, progress } before the change, or null when that isn't known.
// next: { status, progress, repeat, startedAt, completedAt } after it.
// Returns the dates to save, like { startedAt: today }.
function datesToFill(prev, next, on = S.settings.autoDates) {
  const out = {};
  if (!on || !next) return out;
  const today = todayFuzzy();
  // Nothing watched before this change: starting now (or, for a movie, watching it in one go).
  const fresh = prev ? prev.status === 'PLANNING' || !(prev.progress > 0) : !(next.progress > 1);
  if (next.status === 'CURRENT' && !hasDate(next.startedAt) && fresh) out.startedAt = today;
  if (next.status === 'COMPLETED' && !hasDate(next.completedAt)) {
    const firstTime = prev ? !['COMPLETED', 'REPEATING'].includes(prev.status) : !(next.repeat > 0);
    if (firstTime) {
      out.completedAt = today;
      if (!hasDate(next.startedAt) && fresh) out.startedAt = today;
    }
  }
  return out;
}

// What a change of progress does on AniList: the last episode completes the title.
function statusAfter(e, patch) {
  const status = patch.status || e.status;
  const progress = patch.progress != null ? patch.progress : e.progress || 0;
  const total = isAnime() ? e.episodes : e.chapters;
  return (status === 'CURRENT' || status === 'REPEATING') && total && progress >= total ? 'COMPLETED' : status;
}

// AniList sends an entry's custom lists as { "Name": true, ... } (or as [{ name, enabled }]).
function parseCustomLists(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return []; } }
  if (Array.isArray(raw)) return raw.filter((x) => x && (x.enabled || typeof x === 'string')).map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean);
  if (typeof raw === 'object') return Object.keys(raw).filter((k) => raw[k]);
  return [];
}
const customListNames = () => (S.data && S.data.customListNames) || [];
function tierOf(p, max) {
  if (!(p > 0)) return 0;
  if (!max || max <= 1) return 3;
  const r = p / max;
  return r >= 0.67 ? 3 : r >= 0.34 ? 2 : 1;
}
const isAnime = () => !S.route || S.route.type === 'ANIME';
function typeWord() { return isAnime() ? 'anime' : 'manga'; }
function statusLabel(s) { return (LABELS[S.route ? S.route.type : 'ANIME'] || LABELS.ANIME)[s] || s; }
const canEdit = () => !!(S.data && S.data.canEdit);
const verb = () => (isAnime() ? 'Watch' : 'Read');

function hexToRGB(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function fmtMinutes(min) {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} h`;
  const d = Math.floor(hours / 24), rest = hours % 24;
  return rest ? `${d} d ${rest} h` : `${d} d`;
}

/* ------------------------------------------------------------------ */
/* AniList API                                                         */
/* ------------------------------------------------------------------ */
// Two ways in:
//  - With AniList's official login (connected from the toolbar button), every
//    request goes through the extension's background, which keeps one shared
//    queue under AniList's rate limit.
//  - Without it, the extension uses your normal AniList login on this site,
//    the way the userscript did.

function csrfToken() {
  let token = null;
  const take = (e) => { if (typeof e.detail === 'string' && e.detail) token = e.detail; };
  window.addEventListener('apq:token', take);
  try { window.dispatchEvent(new CustomEvent('apq:get-token')); } catch { /* ignore */ }
  window.removeEventListener('apq:token', take);
  if (token) return token;
  for (const s of document.querySelectorAll('script:not([src])')) {
    const m = s.textContent.match(/al_token\s*=\s*["']([^"']+)["']/);
    if (m) return m[1];
  }
  return null;
}

async function post(url, session, query, variables, keepalive = false) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (session) {
    const token = csrfToken();
    if (token) headers['x-csrf-token'] = token;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    credentials: session ? 'same-origin' : 'omit',
    body: JSON.stringify({ query, variables }),
    keepalive,
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  if (!res.ok || !json || (json.errors && !json.data)) {
    const msg = (json && json.errors && json.errors[0] && json.errors[0].message) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json.data;
}

const loggedIn = () => !!(S.auth && S.auth.viewer);

function viaBackground(query, variables, priority = 'high') {
  return new Promise((resolve, reject) => {
    const fail = (message, status = 0) => { const err = new Error(message); err.status = status; reject(err); };
    try {
      chrome.runtime.sendMessage({ type: 'gql', query, variables, priority }, (res) => {
        if (chrome.runtime.lastError || !res) { fail('The extension was updated. Reload this page'); return; }
        if (res.ok) resolve(res.data);
        else fail(res.error || 'Request failed', res.status || 0);
      });
    } catch { fail('The extension was updated. Reload this page'); }
  });
}

const SITE_API = 'https://anilist.co/graphql';
const gqlSession = (q, v, keepalive) => (loggedIn() ? viaBackground(q, v) : post(SITE_API, true, q, v, keepalive));
async function gqlRead(q, v, priority = 'high') {
  if (loggedIn()) {
    try { return await viaBackground(q, v, priority); }
    catch (err) {
      // Too big or rate-limited fails the same way everywhere; anything else, try your site login.
      if (err.status === 400 || err.status === 429) throw err;
    }
  }
  try { return await post(SITE_API, true, q, v); }
  catch (err) {
    // A request AniList refused as too big, or a rate-limit pause, would fail the same way there.
    if (err.status === 400 || err.status === 429) throw err;
    try { return await post('https://graphql.anilist.co', false, q, v); }
    catch { throw err; }
  }
}

function normalize(collection) {
  const entries = new Map();
  const lists = [];
  const type = S.route ? S.route.type : 'ANIME';
  for (const l of collection.lists || []) {
    const ids = [];
    for (const e of l.entries || []) {
      ids.push(e.mediaId);
      if (entries.has(e.mediaId)) continue;
      const m = e.media || {};
      const cover = m.coverImage || {};
      entries.set(e.mediaId, {
        id: e.id,
        mediaId: e.mediaId,
        status: e.status,
        priority: e.priority || 0,
        progress: e.progress || 0,
        score: e.score || 0,
        progressVolumes: e.progressVolumes || 0,
        repeat: e.repeat || 0,
        private: !!e.private,
        notes: e.notes || '',
        hidden: !!e.hiddenFromStatusLists,
        customLists: parseCustomLists(e.customLists),
        startedAt: fuzzy(e.startedAt),
        completedAt: fuzzy(e.completedAt),
        title: (m.title && m.title.userPreferred) || 'Untitled',
        cover: cover.medium || '',
        coverLarge: cover.large || cover.medium || '',
        color: cover.color || '',
        format: m.format || null,
        airing: m.status || null,
        episodes: m.episodes || null,
        chapters: m.chapters || null,
        duration: m.duration || null,
        nextEp: (m.nextAiringEpisode && m.nextAiringEpisode.episode) || null,
        year: m.seasonYear || (m.startDate && m.startDate.year) || null,
        source: m.source || null,
        country: m.countryOfOrigin || null,
        adult: !!m.isAdult,     // AniList's own 18+ mark; what counts as NSFW is nsfwOf(e) (content/privacy.js)
        nf: nsfwFacts(m),       // its 18+ mark, genres and tags, for nsfwOf
        streams: streamingSites(m.externalLinks),
        avgScore: m.averageScore || null,
        popularity: m.popularity || null,
        release: fuzzy(m.startDate),
        updatedAt: e.updatedAt || null,
        createdAt: e.createdAt || null,
        url: m.siteUrl || `/${type.toLowerCase()}/${e.mediaId}`,
      });
    }
    lists.push({ name: l.name || '', status: l.status, custom: !!l.isCustomList, ids });
  }
  // Which custom lists each title is in, also from the lists themselves (in case the field is missing).
  for (const l of lists) {
    if (!l.custom || !l.name) continue;
    for (const id of l.ids) {
      const e = entries.get(id);
      if (e && !e.customLists.includes(l.name)) e.customLists.push(l.name);
    }
  }
  return { entries, lists };
}

// The streaming (or reading) sites in a title's links, like ["Crunchyroll", "Netflix"].
function streamingSites(links) {
  const out = [];
  for (const l of Array.isArray(links) ? links : []) {
    const site = l && l.type === 'STREAMING' && String(l.site || '').trim();
    if (site && !out.includes(site)) out.push(site);
  }
  return out;
}

function routeKey(r) { return r ? `${r.user.toLowerCase()}:${r.type}` : null; }

// Is the list on this page yours? (1.0.1) Once it's read, AniList says (S.data.canEdit). Before that, your saved
// login or the account AniList's own session showed last (local "me") tells, so someone else's list never starts in
// your sorts and filters, not even for a moment. Nothing known yet: not yours.
function ownPage() {
  const r = S.route;
  if (!r) return false;
  if (S.data && S.data.key === routeKey(r)) return !!S.data.canEdit;
  const me = (S.auth && S.auth.viewer) || S.me;
  if (!me || !me.name) return false;
  const u = String(r.user).toLowerCase();
  return u === String(me.name).toLowerCase() || (me.id != null && u === String(me.id));
}
function noteMe(viewer) {
  if (!viewer || !viewer.name) return;
  const me = { id: viewer.id, name: viewer.name };
  if (S.me && S.me.id === me.id && S.me.name === me.name) return;
  S.me = me;
  store.set('local', 'me', me);
}

// Your AniList profile color, for the accent ("From AniList"): read again once per page load, after the list (0.12.8).
let viewerColorAsked = false;
function refreshViewerColor() {
  if (viewerColorAsked) return;
  viewerColorAsked = true;
  gqlRead(VIEWER_QUERY, {}, 'low').then((d) => {
    const v = d && d.Viewer;
    if (!v) return;
    const color = (v.options && v.options.profileColor) || null;
    if (color === S.viewerColor) return;
    S.viewerColor = color;
    store.set('local', 'viewerColor', color);
    applyAccent();
  }).catch(() => {});
}

function ensureData(force = false) {
  const r = S.route;
  if (!r) return Promise.resolve(null);
  const key = routeKey(r);
  if (!force && S.data && S.data.key === key) return Promise.resolve(S.data);
  if (S.inflight && S.inflight.key === key) return S.inflight.p;

  const p = (async () => {
    S.loading = true;
    S.error = null;
    renderAll();
    try {
      // If AniList ever refuses the fuller query (a renamed field, say), the list still loads:
      // first without the fields for list views, then as version 0.2 asked for it.
      let full = true, viewFields = true;
      let tagged = nsfwUsesTags(NS.set, r.type);
      const vars = listVars(r.user, r.type);
      // The list you're looking at goes before anything else waiting in the background's queue (0.12.8: the toolbar
      // popup open in a window or the side panel, the trackers' checks...). The same request was usually already
      // started as the page began to load (listquery.js): the background then hands over that answer.
      const read = (q) => gqlRead(q, vars, 'urgent');
      const readList = () => (tagged ? read(LIST_QUERY_TAGS).catch((err) => { if (err.status !== 400) throw err; tagged = false; return read(LIST_QUERY); }) : read(LIST_QUERY))
        .catch((err) => { if (err.status !== 400) throw err; viewFields = false; tagged = false; return read(LIST_QUERY_NOVIEW); })
        .catch((err) => { if (err.status !== 400) throw err; full = false; return read(LIST_QUERY_BASIC); });
      // Who you are, to know whether this list is yours: connected, your login already says (its number and name),
      // so the list doesn't wait for a second request in the queue; your profile color is asked again afterwards,
      // quietly (0.12.8). Not connected: AniList's own session is asked, alongside the list, as before.
      const known = loggedIn() ? { id: S.auth.viewer.id, name: S.auth.viewer.name, options: { profileColor: S.auth.viewer.color || null } } : null;
      const [coll, viewer] = await Promise.all([
        readList(),
        known ? Promise.resolve(known) : gqlSession(VIEWER_QUERY).then((d) => (d && d.Viewer) || null).catch(() => null),
      ]);
      if (known) refreshViewerColor();
      if (routeKey(S.route) !== key) return S.data; // you navigated away meanwhile
      const col = coll && coll.MediaListCollection;
      if (!col) throw new Error('List not found');
      const normalized = normalize(col);
      for (const [id, pend] of S.pending) {
        const e = normalized.entries.get(id);
        if (e) e.priority = pend.value;
      }
      const opts = (col.user && col.user.mediaListOptions) || {};
      const typeOpts = (r.type === 'MANGA' ? opts.mangaList : opts.animeList) || {};
      const fromLists = normalized.lists.filter((l) => l.custom).map((l) => l.name);
      // Titles deleted by a mass edit stay hidden on AniList's (older) page, unless they're back.
      for (const id of S.gone) if (normalized.entries.has(id)) S.gone.delete(id);
      S.data = {
        key,
        ...normalized,
        full, // false: notes, dates and "only in custom lists" are unknown, so mass edit leaves them alone
        viewFields, // false: source, country, streaming and adult are unknown (list views can't filter on them)
        tagged,     // the titles' tags came too (0.12.3: only when your NSFW choices count tags)
        customListNames: Array.isArray(typeOpts.customLists) ? typeOpts.customLists.filter(Boolean) : fromLists,
        scoreFormat: opts.scoreFormat || 'POINT_10',
        fetchedAt: Date.now(),
        viewer,
        userName: (col.user && col.user.name) || r.user,
        canEdit: !!viewer && (String(viewer.name).toLowerCase() === r.user.toLowerCase() || (!!col.user && col.user.id === viewer.id)),
      };
      noteMe(viewer);
      if (viewer && !known) {   // (connected, refreshViewerColor reads it: the login's copy may be older)
        const color = (viewer.options && viewer.options.profileColor) || null;
        if (color !== S.viewerColor) {
          S.viewerColor = color;
          store.set('local', 'viewerColor', color);
          applyAccent();
        }
      }
    } catch (err) {
      if (routeKey(S.route) === key) S.error = err;
    } finally {
      S.loading = false;
      S.inflight = null;
      renderAll();
    }
    ensureRelations();
    privacySweep();   // "Keep new ones private" (0.12.3): titles added elsewhere since
    return S.data;
  })();
  S.inflight = { key, p };
  return p;
}

/* ------------------------------------------------------------------ */
/* Accent color: your AniList profile color, or one you pick           */
/* ------------------------------------------------------------------ */

function accentRGB(choice = S.settings.accent) {
  if (choice && choice !== 'auto') return PROFILE_COLORS[choice] || null;
  const c = S.viewerColor;
  if (!c) return null;
  return PROFILE_COLORS[c] || hexToRGB(c);
}

function luminance(rgb) {
  const [r, g, b] = rgb.split(',').map((x) => {
    const v = Number(x) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The accent's name among AniList's seven (null: a color of your own, which no palette changes).
function accentKey(choice = S.settings.accent) {
  if (choice && choice !== 'auto') return PROFILE_COLORS[choice] ? choice : null;
  return PROFILE_COLORS[S.viewerColor || 'blue'] ? S.viewerColor || 'blue' : null;
}

/* ------------------------------------------------------------------ */
/* Palettes (0.12, palettes.js) on Tsugi's own panels                  */
/* ------------------------------------------------------------------ */
// The palette picked in the toolbar popup (Settings > Look) also dresses Tsugi's own panels here, unless its
// "On AniList too" is off: the hub, the title popover, Pick for me, Ctrl+K, mass edit, the selection bar, the
// sort menu, the feed filters, toasts, tooltips and the floating button. What Tsugi adds to AniList's own controls
// (badges on rows, filters in its sidebar, posters, the top bar's button and menu, the title page's parts) keeps
// AniList's theme, like the rest of the page (the theme studio, batch 19, is for those).
const PANEL_SEL = ['.apq-drawer', '.apq-pop', '.apq-pick', '.apq-pal', '.apq-mass', '.apq-toast', '.apq-tip', '.apq-bar',
  '.apq-feed-panel', '.apq-sort-menu', '.apq-dock'].join(', ');
const hubPalette = () => (S.settings.paletteHub !== false && paletteOf(S.settings.theme)) || null;

// Writes the accent, and the palette's tokens for the panels, into one style element; <html data-apq-pal> names
// the palette and data-apq-panel says whether the panels are dark (AniList's theme without a palette).
function applyAccent() {
  let st = document.getElementById('apq-accent');
  if (!st) {
    st = h('style', { id: 'apq-accent' });
    document.head.append(st);
  }
  const rgb = accentRGB();
  const onAcc = rgb && luminance(rgb) > 0.45 ? '15,22,34' : '255,255,255';
  let css = rgb ? `html .apq-ui{ --apq-acc: ${rgb}; --apq-on-acc: ${onAcc}; }` : '';
  const pal = hubPalette();
  const root = document.documentElement;
  if (pal) {
    const t = paletteTokens(pal);
    const acc = paletteAccent(pal, accentKey(), rgb || PROFILE_COLORS.blue);
    const dark = pal.tone === 'dark';
    // Doubled attribute: above AniList's dark rule (html[data-apq-theme="dark"] .apq-ui) and the accent's.
    css += `\nhtml[data-apq-pal][data-apq-pal] :is(${PANEL_SEL}), html[data-apq-pal][data-apq-pal] :is(${PANEL_SEL}) .apq-ui{`
      + ` --apq-acc: ${acc}; --apq-on-acc: ${luminance(acc) > 0.45 ? '15,22,34' : '255,255,255'};`
      + ` --apq-surface: ${t.surface}; --apq-sunken: ${t.sunken}; --apq-raised: ${t.raised}; --apq-ink: ${t.ink}; --apq-on-ink: ${t.onInk};`
      + ` --apq-text: ${t.text}; --apq-muted: ${t.muted}; --apq-line: ${t.line}; --apq-good: ${t.good}; --apq-bad: ${t.bad}; --apq-warn: ${t.warn};`
      + ` --apq-hover: rgba(var(--apq-ink),${dark ? '.07' : '.055'}); color-scheme: ${pal.tone};`
      + (dark ? ' --apq-shadow: 0 20px 50px -14px rgba(0,0,0,.66), 0 3px 10px -3px rgba(0,0,0,.42);' : ' --apq-shadow: 0 18px 44px -14px rgba(20,30,46,.30), 0 3px 10px -4px rgba(20,30,46,.14);')
      + ' }';
    const id = S.settings.theme;
    if (root.dataset.apqPal !== id) root.dataset.apqPal = id;
  } else if (root.dataset.apqPal) {
    delete root.dataset.apqPal;
  }
  if (st.textContent !== css) st.textContent = css;
  notePanelTone();
}

// data-apq-panel: dark or light, the palette's tone, else AniList's theme (data-apq-theme, main.js syncTheme).
function notePanelTone() {
  const pal = hubPalette();
  const root = document.documentElement;
  const v = pal ? pal.tone : root.dataset.apqTheme === 'dark' ? 'dark' : 'light';
  if (root.dataset.apqPanel !== v) root.dataset.apqPanel = v;
}

/* ------------------------------------------------------------------ */
/* Watch order: titles that need an earlier season finished first      */
/* ------------------------------------------------------------------ */

async function loadRelCache() {
  const saved = await store.get('local', REL_KEY);
  if (saved) return saved;
  let old = null;
  try { old = JSON.parse(legacy(LEGACY_REL_KEY) || 'null'); } catch { old = null; }
  try { localStorage.removeItem(LEGACY_REL_KEY); } catch { /* ignore */ }
  return old || {};
}

function saveRelCache(cache) {
  const now = Date.now();
  for (const k of Object.keys(cache)) if (now - cache[k].t > REL_TTL * 4) delete cache[k];
  store.set('local', REL_KEY, cache);
}

// Did a start before b? Only what both dates say is compared: a date AniList doesn't have yet (or the
// same year without the month) isn't "before". A title with no date at all hasn't started: anything
// dated came before it.
function relStartedBefore(a, b) {
  if (!a || !a.year) return false;
  if (!b || !b.year) return true;
  for (const k of ['year', 'month', 'day']) {
    if (!a[k] || !b[k]) return false;
    if (a[k] !== b[k]) return a[k] < b[k];
  }
  return false;
}

// What must be finished first (0.12.1): a prequel, or the main story of a movie, OVA or special
// when it started before it. A main story that came out after (a film released before its TV
// series) isn't a warning. The popup has the same rule (popup.js, orderBlockers).
function blockersFrom(m) {
  const out = [];
  const sideStory = !['TV', 'TV_SHORT'].includes(m.format);
  const edges = (m.relations && m.relations.edges) || [];
  for (const ed of edges) {
    const n = ed && ed.node;
    if (!n || n.type !== m.type || ['MUSIC', 'SPECIAL'].includes(n.format)) continue;
    if (ed.relationType === 'PREQUEL' || (ed.relationType === 'PARENT' && sideStory && relStartedBefore(n.startDate, m.startDate))) {
      out.push([n.id, (n.title && n.title.userPreferred) || 'an earlier entry']);
    }
  }
  return out;
}

// Only for your own list, a few requests at a time, cached for two weeks,
// so it stays well inside AniList's rate limit.
let relChunk = 50;
async function ensureRelations() {
  const d = S.data;
  if (!d || !d.canEdit || !S.settings.watchOrder || S.relLoading) return;
  const want = [];
  for (const e of d.entries.values()) if (e.status === 'PLANNING') want.push(e.mediaId);
  S.relLoading = true;
  let cache;
  try { cache = await loadRelCache(); } finally { S.relLoading = false; }
  const publish = () => {
    if (S.data !== d) return;
    S.rel = new Map(want.map((id) => [id, (cache[id] && cache[id].b) || []]));
    scheduleRefresh();
  };
  publish();
  const now = Date.now();
  // v: 2 since 0.12.1 (the start dates); older answers are asked again.
  const missing = want.filter((id) => !cache[id] || cache[id].v !== REL_V || now - cache[id].t > REL_TTL);
  if (!missing.length) return;
  S.relLoading = true;
  try {
    let i = 0;
    while (i < missing.length && S.data === d && S.settings.watchOrder) {
      const ids = missing.slice(i, i + relChunk);
      let res;
      try {
        res = await gqlRead(RELATIONS_QUERY, { ids }, 'low');
      } catch (err) {
        // AniList refused a request this big: ask for fewer titles at a time.
        if (err.status >= 400 && err.status < 500 && err.status !== 429 && relChunk > 10) {
          relChunk = Math.ceil(relChunk / 2);
          await sleep(800);
          continue;
        }
        throw err;
      }
      const got = new Set();
      for (const m of (res && res.Page && res.Page.media) || []) {
        cache[m.id] = { t: now, v: REL_V, b: blockersFrom(m) };
        got.add(m.id);
      }
      for (const id of ids) if (!got.has(id)) cache[id] = { t: now, v: REL_V, b: [] };
      saveRelCache(cache);
      publish();
      i += ids.length;
      if (i < missing.length) await sleep(1200);
    }
  } catch {
    // AniList is busy or offline. Keep what we have and try again next time.
  } finally {
    S.relLoading = false;
    if (S.data && S.data !== d) ensureRelations();
  }
}

function blockerOf(e) {
  if (!e || !S.settings.watchOrder || e.status !== 'PLANNING' || !S.data) return null;
  const list = S.rel.get(e.mediaId);
  if (!list || !list.length) return null;
  for (const [id, title] of list) {
    const other = S.data.entries.get(id);
    if (other && (other.status === 'COMPLETED' || other.status === 'REPEATING')) continue;
    return { id, title: other ? other.title : title, status: other ? other.status : null };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Episodes: what's new, what's left                                   */
/* ------------------------------------------------------------------ */

function newCount(e) {
  if (!S.settings.newEps || !['CURRENT', 'REPEATING'].includes(e.status)) return 0;
  if (e.airing !== 'RELEASING' || !e.nextEp) return 0;
  return Math.max(0, e.nextEp - 1 - (e.progress || 0));
}

function remainingMinutes(e) {
  if (!isAnime() || !e.duration) return null;
  const total = e.episodes || (e.airing === 'RELEASING' && e.nextEp ? e.nextEp - 1 : null);
  if (!total) return null;
  return Math.max(0, total - (e.progress || 0)) * e.duration;
}

function groupLeft(list) {
  let sum = 0, unknown = 0;
  for (const e of list) {
    if (isAnime()) {
      const m = remainingMinutes(e);
      if (m == null) unknown++; else sum += m;
    } else if (e.chapters) {
      sum += Math.max(0, e.chapters - (e.progress || 0));
    } else {
      unknown++;
    }
  }
  if (!sum) return null;
  const text = (isAnime() ? fmtMinutes(sum) : `${sum} ch`) + (unknown ? '+' : '');
  const tip = unknown
    ? `${isAnime() ? 'Watch time' : 'Chapters'} left, not counting ${plural(unknown)} without a known length`
    : `${isAnime() ? 'Watch time' : 'Chapters'} left in this group`;
  return { text, tip };
}

/* ------------------------------------------------------------------ */
/* Each title's own color, and the episode track (DESIGN.md)           */
/* ------------------------------------------------------------------ */

// Mixes two "r,g,b" colors like CSS color-mix in sRGB: `share` of a, the rest of b.
function mixRGB(a, b, share) {
  const y = b.split(',').map(Number);
  return a.split(',').map(Number).map((v, i) => Math.round(v * share + y[i] * (1 - share))).join(',');
}

// A title's own color: its cover's main color, as "r,g,b", kept readable on this theme (very dark
// colors are lightened in the dark theme, very light ones darkened in the light theme).
// `on` is the text color for a solid fill of it: dark ink or white, whichever contrasts more (the switch
// point is a luminance of about 0.2; 0.25 leans to white). No color: { rgb: null } (the accent stands in).
function titleColor(e) {
  let rgb = hexToRGB(e && e.color);
  if (!rgb) return { rgb: null, on: null };
  // On a palette (0.12): readable on its panel color (palettes.js, paletteTitle).
  const pal = hubPalette();
  if (pal) {
    rgb = paletteTitle(rgb, pal);
    return { rgb, on: luminance(rgb) > 0.25 ? '15,22,34' : '255,255,255' };
  }
  const dark = document.documentElement.dataset.apqTheme === 'dark';
  const l = luminance(rgb);
  if (dark && l < 0.18) rgb = mixRGB(rgb, '255,255,255', 0.65);
  else if (!dark && l > 0.6) rgb = mixRGB(rgb, '0,0,0', 0.65);
  return { rgb, on: luminance(rgb) > 0.25 ? '15,22,34' : '255,255,255' };
}

// Gives an element --apq-title (and the text color on it), for everything inside about that title.
function paintTitle(el, e) {
  const c = titleColor(e);
  if ((el.dataset.apqTc || '') === (c.rgb || '')) return;
  if (c.rgb) {
    el.dataset.apqTc = c.rgb;
    el.style.setProperty('--apq-title', c.rgb);
    el.style.setProperty('--apq-on-title', c.on);
  } else {
    delete el.dataset.apqTc;
    el.style.removeProperty('--apq-title');
    el.style.removeProperty('--apq-on-title');
  }
}

// What the episode track shows for a title you're watching or reading: one thin continuous line
// (0.6.8.1; the per-episode blocks are gone). done: watched; out: how many are out so far (null: all
// of them); span: its length in episodes (null: not known, so no track).
function trackOf(e, anime = isAnime()) {
  const total = (anime ? e.episodes : e.chapters) || null;
  const done = e.progress || 0;
  let out = null;
  if (e.airing === 'NOT_YET_RELEASED') out = 0;
  else if (anime && e.airing === 'RELEASING' && e.nextEp) out = e.nextEp - 1;
  let span = total || (out != null && e.airing === 'RELEASING' ? out + 1 : null);
  if (span) {
    span = Math.max(span, done);
    if (out != null) out = Math.max(out, done);
    if (out != null && out >= span) out = null;
  }
  return { done, out, span: span || null, total, unit: anime ? 'Ep' : 'Ch' };
}

const showsTrack = (e) => !!e && ['CURRENT', 'REPEATING'].includes(e.status);

// Draws or updates a track: watched solid, out but not watched faint, not out yet empty. A +1 grows
// the line (its width eases), Undo shrinks it back; reaching the last episode brightens it once.
function paintTrack(el, t) {
  const prev = el._done;
  el._done = t.done;
  const moved = prev != null && !reducedMotion();
  if (el.children.length !== 2 || !el.classList.contains('is-bar')) {
    el.classList.add('is-bar');
    el.replaceChildren(h('b', { class: 'apq-track-out' }), h('b', { class: 'apq-track-done' }));
  }
  const pct = (n) => `${Math.min(100, (n / t.span) * 100)}%`;
  el.firstChild.style.width = pct(t.out == null ? t.span : t.out);
  el.lastChild.style.width = pct(t.done);
  if (moved && t.done > prev && t.done >= t.span) {
    el.classList.remove('is-finished');
    void el.offsetWidth;
    el.classList.add('is-finished');
  }
}

// "Ep 13 of 24", with the number in heavy figures; it ticks up after a +1.
function trackLabel(t, prev) {
  const n = h('b', { class: prev != null && t.done === prev + 1 && !reducedMotion() ? 'is-tick' : null }, String(t.done));
  return h('span', { class: 'apq-track-ep' }, `${t.unit} `, n, t.total ? ` of ${t.total}` : '');
}

/* ------------------------------------------------------------------ */
