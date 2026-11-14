// Tsugi: background worker.
// - One shared queue for every AniList API request the extension makes, kept under
//   AniList's rate limit (currently 30 requests a minute, normally 90).
// - AniList's official login: saving, checking and removing your access token.
// - Other trackers (0.9, trackers.js, loaded at the end): MyAnimeList and MangaBaka follow AniList, and since
//   0.10 what changes there comes back.
// - NSFW titles (0.12.3, nsfw.js and privacy.js, loaded at the end too): made private, or public again, many at once.
'use strict';

const API = 'https://graphql.anilist.co';
const PER_MINUTE = 25;   // stay a little under AniList's current limit of 30
const GAP_MS = 120;      // small pause between requests, for AniList's burst limit
const WINDOW_MS = 61000; // a minute, plus a second for network delays
const VIEWER_QUERY = `query { Viewer { id name siteUrl avatar { medium } options { profileColor } mediaListOptions { scoreFormat } } }`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failure = (message, status = 0) => Object.assign(new Error(message), { status });

let queue = [];
let recent = [];       // when each request of the last minute went out
let pausedUntil = 0;   // AniList asked us to wait until then
let counted = null;    // AniList's own count at its last answer: { limit, left, at } (the popup's Settings, About)
let pumping = false;
let authTab = null;    // the AniList approval tab we opened

// AniList pages may read session storage too: the command palette keeps your titles there
// (like the popup's lists), so it's gone when the browser closes.
try { chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {}); } catch { /* old browser */ }

// The browser stops this worker when it's idle for a while. The last minute's request times
// are kept in session storage, so a fresh start still knows how many went out recently.
const restored = chrome.storage.session.get('rate').then(({ rate }) => {
  if (!rate) return;
  const now = Date.now();
  recent = (rate.recent || []).filter((t) => now - t < WINDOW_MS).concat(recent);
  pausedUntil = Math.max(pausedUntil, rate.pausedUntil || 0);
  if (!counted && rate.at) counted = { limit: rate.limit || null, left: rate.left, at: rate.at };
}).catch(() => {});

function rememberRate() {
  chrome.storage.session.set({ rate: { recent, pausedUntil, ...(counted || {}) }, slowDownUntil: pausedUntil }).catch(() => {});
}

// AniList's headers: how many requests it allows a minute, and how many are left of them.
function noteCount(res) {
  const left = res.headers.get('X-RateLimit-Remaining');
  if (left === null && res.status !== 429) return;
  const limit = Number(res.headers.get('X-RateLimit-Limit')) || (counted && counted.limit) || null;
  counted = { limit, left: left === null ? 0 : Math.max(0, Number(left) || 0), at: Date.now() };
}

async function getAuth() {
  const { auth } = await chrome.storage.local.get('auth');
  if (!auth || !auth.token) return null;
  if (auth.expiresAt && auth.expiresAt < Date.now()) {
    await chrome.storage.local.remove('auth');
    return null;
  }
  return auth;
}

// Removes the saved login, unless it was replaced by a newer one in the meantime.
async function forget(token) {
  const { auth } = await chrome.storage.local.get('auth');
  if (auth && auth.token === token) await chrome.storage.local.remove('auth');
}

// `token` is only passed while checking a new login; everything else uses the saved one.
// priority: 'urgent' (the list of the page you're looking at, 0.12.8: before anything else waiting), 'high' (the
// usual), 'low' (things nobody waits for).
function request(query, variables, priority = 'high', token = null) {
  return new Promise((resolve, reject) => {
    const job = { query, variables, resolve, reject, tries: 0, low: priority === 'low', urgent: priority === 'urgent', token };
    if (job.low) queue.push(job);
    else {
      const i = queue.findIndex((j) => (job.urgent ? !j.urgent : j.low));
      queue.splice(i === -1 ? queue.length : i, 0, job);
    }
    pump();
  });
}

/* A list page's titles, asked for early (0.12.8) ---------------------------------------------- */
// A list page used to ask for your titles only once AniList's own scripts had run and Tsugi's had started, and the
// list stays out of sight until they're in (content/page.js, "Showing a list once it's in place"). Now content/hold.js
// tells this worker as soon as the page starts loading, and the same request (listquery.js) goes out at once; when
// the page asks for it, it gets the answer already on its way. Only for an identical request (same query, same
// variables), only while connected, used once, and forgotten after PREFETCH_MS.
const PREFETCH = new Map();   // query + variables -> the request's promise
const PREFETCH_MS = 20000;
const prefetchKey = (query, variables) => `${query}\u0001${JSON.stringify(variables || {})}`;

async function prefetchList(msg) {
  const auth = await getAuth();
  if (!auth || !auth.token || typeof msg.user !== 'string' || !msg.user) return;
  const type = msg.kind === 'MANGA' ? 'MANGA' : 'ANIME';
  let nsfw = null;
  try { ({ nsfw } = await chrome.storage.sync.get('nsfw')); } catch { /* the usual request then */ }
  const query = nsfwUsesTags(nsfwNormalize(nsfw), type) ? LIST_QUERY_TAGS : LIST_QUERY;
  const key = prefetchKey(query, listVars(msg.user, type));
  if (PREFETCH.has(key)) return;
  const p = request(query, listVars(msg.user, type), 'urgent');
  p.catch(() => {});   // a failure is handed over too, and the page tries its next request as usual
  PREFETCH.set(key, p);
  setTimeout(() => { if (PREFETCH.get(key) === p) PREFETCH.delete(key); }, PREFETCH_MS);
}

// The early answer for this request, if there is one (once).
function takePrefetch(query, variables) {
  if (!PREFETCH.size) return null;
  const key = prefetchKey(query, variables);
  const p = PREFETCH.get(key);
  if (p) PREFETCH.delete(key);
  return p || null;
}

// Waits without letting the browser put this worker to sleep mid-queue.
async function wait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(Math.min(20000, end - Date.now()));
    try { await chrome.runtime.getPlatformInfo(); } catch { /* ignore */ }
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    await restored;
    while (queue.length) {
      const now = Date.now();
      if (now < pausedUntil) { await wait(pausedUntil - now); continue; }
      recent = recent.filter((t) => now - t < WINDOW_MS);
      if (recent.length >= PER_MINUTE) { await wait(WINDOW_MS - (now - recent[0]) + 25); continue; }
      await run(queue.shift());
      await sleep(GAP_MS);
    }
  } finally {
    pumping = false;
  }
}

async function run(job) {
  const auth = job.token ? null : await getAuth();
  const token = job.token || (auth && auth.token);
  if (!token) { job.reject(failure('Not connected to AniList', 401)); return; }
  recent.push(Date.now());   // retries count too: they're requests like any other
  rememberRate();
  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: job.query, variables: job.variables || {} }),
    });
  } catch {
    job.reject(failure("Couldn't reach AniList. Check your connection."));
    return;
  }
  noteCount(res);
  if (res.status === 429) {
    const after = Number(res.headers.get('Retry-After')) || 60;
    pausedUntil = Date.now() + after * 1000;
    rememberRate();
    if (job.tries++ < 2) { queue.unshift(job); return; }
    job.reject(failure('AniList asked us to slow down. Try again in a minute.', 429));
    return;
  }
  // AniList says how many requests are left this minute, counting the website's own requests
  // in your other tabs. When it's about to run out, wait instead of hitting the limit.
  const left = res.headers.get('X-RateLimit-Remaining');
  if (left !== null && Number(left) <= 1) pausedUntil = Math.max(pausedUntil, Date.now() + 30000);
  if (left !== null) rememberRate();
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  const message = json && json.errors && json.errors[0] && json.errors[0].message;
  if (res.status === 401 || (message && /invalid token/i.test(message))) {
    if (job.token) { job.reject(failure(REJECTED, 401)); return; }
    await forget(token);
    job.reject(failure('Your AniList login expired. Connect again from the toolbar button.', 401));
    return;
  }
  if (!res.ok || !json || (json.errors && !json.data)) {
    job.reject(failure(message || `HTTP ${res.status}`, res.status));
    return;
  }
  job.resolve(json.data);
  // Other trackers (0.9, trackers.js): a list save made through this queue goes there too (and since 0.10 a
  // title removed from AniList waits for you on them: the variables say which entry).
  if (!job.token) { try { trkSaw(job.query, json.data, job.variables); } catch (err) { console.warn('Tsugi: trackers', err); } }
}

/* Login ------------------------------------------------------------------ */

const REJECTED = "AniList didn't accept that login. Try connecting again.";

// Tsugi's own app on AniList (made at anilist.co/settings/developer; its redirect URL is
// AniList's pin page, which pin.js reads, so it works whatever this extension's ID is). With this kind of login
// (implicit grant) the Client ID is public, there's no secret: connecting is one button for everyone.
const CLIENT_ID = '56033';

// clientId: the number of your own AniList app (setup page, "Use your own AniList app"), remembered for the
// next time. builtIn: the setup page's Connect button, which always uses Tsugi's app (and forgets your own).
// Neither (Settings' Connect again, the hub): your own app if you set one, else Tsugi's.
async function connect(clientId, builtIn = false) {
  const own = String(clientId || '').trim();
  if (own && !/^\d+$/.test(own)) return { ok: false, error: 'The Client ID is a number, like 12345.' };
  if (own) await chrome.storage.local.set({ clientId: own });
  else if (builtIn) await chrome.storage.local.remove('clientId');
  const id = own || (!builtIn && (await chrome.storage.local.get('clientId')).clientId) || CLIENT_ID;
  const tab = await chrome.tabs.create({ url: `https://anilist.co/api/v2/oauth/authorize?client_id=${id}&response_type=token` });
  authTab = tab.id;
  await chrome.storage.session.set({ authTab: tab.id });
  return { ok: true };
}

// Closes the approval tab once it has shown "connected". The tab can report back before
// connect() has saved its id, so the check happens after that short pause.
async function closeAuthTab(tabId) {
  await sleep(1200);
  const { authTab: saved } = await chrome.storage.session.get('authTab');
  if (tabId !== authTab && tabId !== saved) return;
  authTab = null;
  await chrome.storage.session.remove('authTab');
  chrome.tabs.remove(tabId).catch(() => {});
}

async function acceptToken(token, expiresIn, sender) {
  token = String(token || '').trim();
  if (!token) return { ok: false, error: 'No token found.' };
  let viewer = null;
  try {
    const data = await request(VIEWER_QUERY, {}, 'high', token);
    viewer = data && data.Viewer;
  } catch (err) {
    return { ok: false, error: err.message || REJECTED };
  }
  if (!viewer) return { ok: false, error: REJECTED };
  const auth = {
    token,
    expiresAt: Date.now() + (expiresIn || 365 * 86400) * 1000,
    viewer: {
      id: viewer.id,
      name: viewer.name,
      // By name, never AniList's numbered siteUrl: Tsugi's list pages need the name in the address.
      url: `https://anilist.co/user/${encodeURIComponent(viewer.name)}`,
      avatar: (viewer.avatar && viewer.avatar.medium) || '',
      color: (viewer.options && viewer.options.profileColor) || null,
      scoreFormat: (viewer.mediaListOptions && viewer.mediaListOptions.scoreFormat) || 'POINT_10',
    },
  };
  await chrome.storage.local.set(auth.viewer.color ? { auth, viewerColor: auth.viewer.color } : { auth });
  if (sender && sender.tab) closeAuthTab(sender.tab.id);
  return { ok: true, name: viewer.name };
}

/* Unread notifications on the toolbar icon --------------------------------- */

const UNREAD_QUERY = `query { Viewer { unreadNotificationCount } }`;
const BADGE_COLORS = {
  blue: '#3DB4F2', purple: '#C063FF', pink: '#FC9DD6', orange: '#EF881A', red: '#E13333', green: '#4CCA51', gray: '#677B94',
};

// The popup's Settings (sync "settings", shared with the hub): the count on the button or not, how
// often it checks (minutes), and the accent it takes (your AniList profile color, or one you picked).
const CHECK_TIMES = [1, 5, 15, 30, 60];
async function badgeSettings() {
  let s = {};
  try { s = (await chrome.storage.sync.get('settings')).settings || {}; } catch { /* ignore */ }
  return { on: s.badge !== false, every: CHECK_TIMES.includes(Number(s.checkEvery)) ? Number(s.checkEvery) : 5, accent: s.accent || 'auto' };
}

async function badgeColor(accent) {
  let color = accent;
  if (!BADGE_COLORS[color]) {
    const { auth, viewerColor } = await chrome.storage.local.get(['auth', 'viewerColor']);
    color = viewerColor || (auth && auth.viewer && auth.viewer.color) || 'blue';
  }
  return BADGE_COLORS[color] || (/^#[0-9a-f]{6}$/i.test(color || '') ? color : BADGE_COLORS.blue);
}

// Draws the count on the toolbar button (nothing when it's switched off); the popup's rail shows it either way.
async function paintBadge(n) {
  const b = await badgeSettings();
  chrome.action.setBadgeText({ text: b.on && n > 0 ? (n > 99 ? '99+' : String(n)) : '' });
  chrome.action.setBadgeBackgroundColor({ color: await badgeColor(b.accent) });
  if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

async function setBadge(n) {
  await chrome.storage.local.set({ unread: n });
  await paintBadge(n);
}

async function refreshUnread() {
  const auth = await getAuth();
  if (!auth) { setBadge(0); return; }
  try {
    const data = await request(UNREAD_QUERY, {}, 'low');
    setBadge((data && data.Viewer && data.Viewer.unreadNotificationCount) || 0);
  } catch { /* try again on the next check */ }
}

// Checks every 5 minutes unless Settings says otherwise, and not at all while the count is off.
// Opening the popup checks right away.
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'unread') refreshUnread(); });
async function scheduleUnread() {
  const b = await badgeSettings();
  const cur = await chrome.alarms.get('unread');
  if (!b.on) { if (cur) await chrome.alarms.clear('unread'); return; }
  if (!cur || cur.periodInMinutes !== b.every) await chrome.alarms.create('unread', { periodInMinutes: b.every });
}
chrome.runtime.onStartup.addListener(async () => {
  await scheduleUnread();
  if ((await badgeSettings()).on) refreshUnread();
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.auth) refreshUnread();
  if (area === 'local' && changes.viewerColor) paintBadge((await chrome.storage.local.get('unread')).unread || 0);
  if (area === 'sync' && changes.settings) {
    const was = changes.settings.oldValue || {};
    const now = changes.settings.newValue || {};
    if (was.badge !== now.badge || was.checkEvery !== now.checkEvery) await scheduleUnread();
    // Switched back on: the count is fetched fresh; otherwise only drawn again (off, or a new accent).
    if (now.badge !== false && was.badge === false) refreshUnread();
    else if (was.badge !== now.badge || was.accent !== now.accent) paintBadge((await chrome.storage.local.get('unread')).unread || 0);
    if (was.openIn !== now.openIn) applyOpenIn();
    if (was.malLinks !== now.malLinks) syncMalScript();
  }
});

/* Where Tsugi opens (0.12.6) ----------------------------------------------------
   Settings, Popup, Opens in: the toolbar popup (popup.html), its own window (popup.html?view=win), a browser tab
   (popup.html?view=tab) or the browser's side panel (popup.html?view=panel; Brave shows it in its sidebar). For
   anything but the popup, the toolbar button opens that instead (no popup set, chrome.action.onClicked; the side
   panel opens by itself, setPanelBehavior), and an open one comes forward rather than a second one. The
   toolbar button's right-click menu opens any of them once. Brave closes itself when an extension opens the side
   panel for a tab of a popup-type window (brave-browser#59256, open on 2026-11-13): Tsugi only opens it from a
   normal window. */
const OPEN_INS = ['popup', 'window', 'tab', 'panel'];
const PANEL_OK = !!(chrome.sidePanel && chrome.sidePanel.setPanelBehavior && chrome.sidePanel.open);
const OPEN_URLS = { window: 'popup.html?view=win', tab: 'popup.html?view=tab', panel: 'popup.html?view=panel' };
const WIN_DEFAULT = { width: 760, height: 700 };

async function openInSetting() {
  let s = {};
  try { s = (await chrome.storage.sync.get('settings')).settings || {}; } catch { /* ignore */ }
  const v = OPEN_INS.includes(s.openIn) ? s.openIn : 'popup';
  return v === 'panel' && !PANEL_OK ? 'popup' : v;
}
async function applyOpenIn() {
  const v = await openInSetting();
  try { await chrome.action.setPopup({ popup: v === 'popup' ? 'popup.html' : '' }); } catch { /* ignore */ }
  if (!PANEL_OK) return;
  try {
    await chrome.sidePanel.setOptions({ path: OPEN_URLS.panel, enabled: true });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: v === 'panel' });
  } catch (err) { console.warn('Tsugi: side panel', err); }
}

// The open copy of a page of Tsugi's (a window's or a tab's), if there is one.
async function openCopy(where) {
  if (!chrome.runtime.getContexts) return null;
  try {
    const [c] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [chrome.runtime.getURL(OPEN_URLS[where])] });
    return c && c.tabId >= 0 ? c : null;
  } catch { return null; }
}

// Its own window: where you left it, at the size you left it (local "win:bounds"); a normal window you can
// resize, without the address bar (type "popup").
async function openWindow() {
  const c = await openCopy('window');
  if (c) { await chrome.windows.update(c.windowId, { focused: true }); return { ok: true, id: c.windowId }; }
  const { 'win:bounds': b } = await chrome.storage.local.get('win:bounds');
  const box = b && b.width >= 320 && b.height >= 320 ? b : WIN_DEFAULT;
  const opts = { url: OPEN_URLS.window, type: 'popup', focused: true, width: Math.round(box.width), height: Math.round(box.height) };
  if (b && Number.isFinite(b.left) && Number.isFinite(b.top)) { opts.left = Math.round(b.left); opts.top = Math.round(b.top); }
  let w;
  try { w = await chrome.windows.create(opts); } catch {
    // A place on a screen that isn't there any more: the default size, where the browser puts it.
    w = await chrome.windows.create({ url: OPEN_URLS.window, type: 'popup', focused: true, ...WIN_DEFAULT });
  }
  await chrome.storage.session.set({ 'win:id': w.id });
  return { ok: true, id: w.id };
}
async function noteBounds(w) {
  const { 'win:id': id } = await chrome.storage.session.get('win:id');
  if (!w || w.id !== id || w.state !== 'normal') return;
  await chrome.storage.local.set({ 'win:bounds': { left: w.left, top: w.top, width: w.width, height: w.height } });
}
if (chrome.windows && chrome.windows.onBoundsChanged) chrome.windows.onBoundsChanged.addListener((w) => { noteBounds(w); });

// A browser tab: the open one comes forward, else a new one in the window you clicked from.
async function openTab(windowId) {
  const c = await openCopy('tab');
  if (c) {
    await chrome.tabs.update(c.tabId, { active: true });
    await chrome.windows.update(c.windowId, { focused: true });
    return { ok: true };
  }
  await chrome.tabs.create(windowId != null ? { url: OPEN_URLS.tab, windowId } : { url: OPEN_URLS.tab });
  return { ok: true };
}

// The side panel opens only for a normal window, and only in answer to a click (the toolbar button and its menu).
async function openPanel(windowId) {
  if (!PANEL_OK) return openWindow();
  let w = null;
  try { w = windowId != null ? await chrome.windows.get(windowId) : null; } catch { /* closed */ }
  if (!w || w.type !== 'normal') return { ok: false, error: 'The side panel opens from a browser window.' };
  await chrome.sidePanel.open({ windowId: w.id });
  return { ok: true };
}

function openTsugi(where, windowId) {
  if (where === 'window') return openWindow();
  if (where === 'tab') return openTab(windowId);
  if (where === 'panel') return openPanel(windowId);
  return Promise.resolve({ ok: false });
}

// Only called when the toolbar button has no popup (Opens in: Window or Tab).
chrome.action.onClicked.addListener(async (tab) => {
  const where = await openInSetting();
  // The side panel normally opens by itself (setPanelBehavior); this is the fallback.
  if (where === 'panel') { if (PANEL_OK && tab) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => openWindow()); return; }
  openTsugi(where === 'popup' ? 'window' : where, tab ? tab.windowId : null).catch((err) => console.warn('Tsugi: opening', err));
});

// The toolbar button's right-click menu: each place once, whatever Opens in says.
const OPEN_MENU = [['open:window', 'Open in a window'], ['open:tab', 'Open in a tab'], ['open:panel', 'Open in the side panel']];
function makeOpenMenu() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    for (const [id, title] of OPEN_MENU) {
      if (id === 'open:panel' && !PANEL_OK) continue;
      chrome.contextMenus.create({ id, title, contexts: ['action'] }, () => void chrome.runtime.lastError);
    }
  });
}
if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const where = String(info.menuItemId).replace(/^open:/, '');
    if (!OPEN_URLS[where]) return;
    // The side panel first, before anything is awaited: it must answer the click itself.
    if (where === 'panel') {
      if (tab && tab.windowId >= 0) chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => console.warn('Tsugi: side panel', err));
      return;
    }
    openTsugi(where, tab ? tab.windowId : null).catch((err) => console.warn('Tsugi: opening', err));
  });
}
// The worker starts often (it sleeps when idle): the toolbar button's behaviour is set each time.
applyOpenIn();

/* Outside AniList (0.8): MyAnimeList's score, characters and songs ------------
   Asked only by the title's number (AniList's idMal, or its own number for AnimeThemes), never with
   anything about you. Tenrai (api.tenrai.org, Jikan's successor: the public Jikan API was shut down on
   2026-10-01) reads MyAnimeList, in Jikan's own format; AnimeThemes (api.animethemes.moe) has the openings
   and endings, with Tenrai as the second source. Both are free services that are sometimes
   down for days, so: one request at a time per service, answers kept in local storage (one key per
   answer, "ext:<kind>:<number>:<what>", with "ext:index" for the clean-up), and a service that doesn't
   answer is left alone for 10 minutes. Nothing found is an answer too (kept a day). A part with no
   answer simply isn't shown. */

const TENRAI = 'https://api.tenrai.org/v1';
const ANIMETHEMES = 'https://api.animethemes.moe';
// 0.12.7.1: AnimeThemes' GraphQL API, asked first. Its REST API (above) answered 503 for days in November 2026 while
// this one worked (checked 2026-11-14: findAnimeByExternalSite, Access-Control-Allow-Origin for any site, so no
// permission is needed, 90 a minute). The REST API stays the second try, MyAnimeList's list (Tenrai) the third.
const ANIMETHEMES_GQL = 'https://graphql.animethemes.moe/';
// 0.12.4: the scores of MangaBaka (manga only) and Kitsu, from their public APIs. Both answer any site
// (Access-Control-Allow-Origin: *), so no permission is asked for them; MangaBaka's public reads are
// cached by its CDN (its guide: free). Asked by AniList's own number.
const MANGABAKA = 'https://api.mangabaka.org';
const KITSU = 'https://kitsu.app/api/edge';
const EXT_TTL = { info: 3 * 864e5, chars: 7 * 864e5, themes: 14 * 864e5, mb: 3 * 864e5, kitsu: 3 * 864e5 };
const EXT_NONE_TTL = 864e5;          // "nothing found" is asked again after a day
const EXT_MAX = 240;                 // answers kept; the oldest go first
const EXT_DOWN_MS = 10 * 60 * 1000;
const EXT_TIMEOUT_MS = 9000;
const EXT_CHARS_MAX = 60;
const services = {
  tenrai: { gap: 600, last: 0, chain: Promise.resolve() },       // Tenrai allows 4 a second and 120 a minute (public)
  animethemes: { gap: 800, last: 0, chain: Promise.resolve() },   // AnimeThemes allows 90 a minute
  atgql: { gap: 800, last: 0, chain: Promise.resolve() },         // its GraphQL API, rested apart from the REST one
  mangabaka: { gap: 400, last: 0, chain: Promise.resolve() },     // MangaBaka allows 180 a minute
  kitsu: { gap: 600, last: 0, chain: Promise.resolve() },         // Kitsu publishes no limit: kept gentle
};
const extInFlight = new Map();
let extDown = null;   // { tenrai: until, animethemes: until }, also in session storage across restarts

async function downUntil() {
  if (!extDown) {
    try { extDown = (await chrome.storage.session.get('extDown')).extDown || {}; } catch { extDown = {}; }
  }
  return extDown;
}
const SERVICE_NAMES = { tenrai: "Tenrai (MyAnimeList's score, characters and songs)", animethemes: 'AnimeThemes (openings and endings)', atgql: "AnimeThemes' GraphQL API (openings and endings)", mangabaka: "MangaBaka (its score)", kitsu: "Kitsu (its score)" };
async function markDown(name, why) {
  const d = await downUntil();
  d[name] = Date.now() + EXT_DOWN_MS;
  console.warn(`Tsugi: ${SERVICE_NAMES[name] || name} ${why}. Its parts are left out; it's asked again in 10 minutes.`);
  chrome.storage.session.set({ extDown: d }).catch(() => {});
}

// One request at a time per service, spaced out. Resolves with the JSON, null for "not found" (404),
// or throws when the service is down, slow or refuses.
function fetchFrom(name, url, body = null) {
  const sv = services[name];
  const run = async () => {
    const d = await downUntil();
    if (d[name] && d[name] > Date.now()) throw failure(`${name} is resting`, 503);
    const wait = sv.last + sv.gap - Date.now();
    if (wait > 0) await sleep(wait);
    sv.last = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), EXT_TIMEOUT_MS);
    let res;
    try {
      const headers = { Accept: name === 'kitsu' ? 'application/vnd.api+json' : 'application/json' };
      if (body) headers['Content-Type'] = 'application/json';
      res = await fetch(url, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, credentials: 'omit' });
    } catch {
      await markDown(name, `didn't answer within ${EXT_TIMEOUT_MS / 1000} s`);
      throw failure(`${name} didn't answer`, 0);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return null;
    if (res.status === 429) { sv.last = Date.now() + 2000; throw failure(`${name} asked to slow down`, 429); }
    if (!res.ok) { if (res.status >= 500) await markDown(name, `answered HTTP ${res.status}`); else console.warn(`Tsugi: ${SERVICE_NAMES[name] || name} answered HTTP ${res.status} for ${url}`); throw failure(`${name}: HTTP ${res.status}`, res.status); }
    try { return await res.json(); } catch { await markDown(name, 'sent something that isn\'t JSON'); throw failure(`${name} sent something unreadable`, 0); }
  };
  const p = sv.chain.then(run, run);
  sv.chain = p.catch(() => {});
  return p;
}

// MyAnimeList writes names as "Spiegel, Spike"; AniList (and Tsugi) as "Spike Spiegel".
function malName(n) {
  const s = String(n || '').trim();
  const parts = s.split(', ');
  return parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : s;
}
// MyAnimeList's stand-in picture (a question mark) is no picture: the popup shows initials instead.
function malImage(images) {
  const u = images && ((images.webp && images.webp.image_url) || (images.jpg && images.jpg.image_url));
  return typeof u === 'string' && /^https:\/\//.test(u) && !/questionmark|\/na\.(gif|jpe?g|png)/i.test(u) ? u : null;
}
const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

// "1: \"Tank! (TV size)\" by The Seatbelts (eps 1-25)" -> { n, title, by, eps }
function parseMalSong(s, i) {
  let t = String(s || '').trim();
  const num = /^#?(\d+)\s*:\s*/.exec(t);
  if (num) t = t.slice(num[0].length);
  let eps = null;
  const ep = /\s*\((eps?\.?\s*[^()]*)\)\s*$/i.exec(t);
  if (ep) { eps = ep[1].replace(/^eps?\.?\s*/i, '').trim() || null; t = t.slice(0, ep.index); }
  let title = t;
  let by = null;
  const q = /^"(.+)"\s*(?:by\s+(.+))?$/s.exec(t);
  if (q) { title = q[1]; by = q[2] ? q[2].trim() : null; }
  else {
    const k = t.lastIndexOf(' by ');
    if (k > 0) { title = t.slice(0, k); by = t.slice(k + 4); }
  }
  title = title.replace(/^"|"$/g, '').trim();
  if (!title) return null;
  return { n: num ? Number(num[1]) : i + 1, title, by, eps, url: null };
}

async function extInfo(kind, mal) {
  const j = await fetchFrom('tenrai', `${TENRAI}/${kind}/${mal}`);
  const d = j && j.data;
  if (!d) return null;
  return {
    score: typeof d.score === 'number' && d.score > 0 ? d.score : null,
    by: Number(d.scored_by) || 0,
    rank: Number(d.rank) || null,
    url: httpsUrl(d.url) || `https://myanimelist.net/${kind}/${mal}`,
  };
}

async function extChars(kind, mal) {
  const j = await fetchFrom('tenrai', `${TENRAI}/${kind}/${mal}/characters`);
  const list = j && Array.isArray(j.data) ? j.data : null;
  if (!list) return null;
  const out = [];
  for (const c of list) {
    const ch = c && c.character;
    if (!ch || !ch.mal_id || !ch.name) continue;
    const v = (c.voice_actors || []).find((x) => x && x.language === 'Japanese' && x.person && x.person.name);
    out.push({
      id: ch.mal_id, name: malName(ch.name), url: httpsUrl(ch.url), img: malImage(ch.images),
      main: /^main$/i.test(c.role || ''), fav: Number(c.favorites) || 0,
      va: v ? { id: v.person.mal_id, name: malName(v.person.name), url: httpsUrl(v.person.url), img: malImage(v.person.images) } : null,
    });
  }
  out.sort((a, b) => (b.main - a.main) || (b.fav - a.fav));
  return out.slice(0, EXT_CHARS_MAX);
}

// AnimeThemes' episodes ("1-12, 14") as "1–12, 14"; a version that only changes a few episodes is
// left out of the count.
const epsText = (list) => {
  const parts = [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))];
  return parts.length ? parts.join(', ').replace(/-/g, '–') : null;
};
// The song's video file on AnimeThemes (0.12.7), played right on the page: "https://v.animethemes.moe/NHKNiYoukoso-OP2.webm".
// The first version's, and of its videos the plain one (no "NC", "BD1080"... in its name: credits and all, as aired)
// when there is one. Only AnimeThemes' own video address is kept.
const THEMES_V = 3;   // answers kept before 0.12.7.1 may have no videos: asked again
const VIDEO_RE = /^https:\/\/v\.animethemes\.moe\/[A-Za-z0-9._-]+\.webm$/;
function themeVideo(entries) {
  for (const e of entries) {
    // The REST API gives a list, the GraphQL one a connection ({ nodes }).
    const list = Array.isArray(e.videos) ? e.videos : e.videos && Array.isArray(e.videos.nodes) ? e.videos.nodes : [];
    const vids = list.map((v) => {
      const link = v && (typeof v.link === 'string' ? v.link : /^[A-Za-z0-9._-]+\.webm$/.test(v.basename || '') ? `https://v.animethemes.moe/${v.basename}` : '');
      return VIDEO_RE.test(link) ? { link, plain: !v.nc, res: Number(v.resolution) || 0 } : null;
    }).filter(Boolean);
    if (!vids.length) continue;
    vids.sort((a, b) => (b.plain - a.plain) || (Math.abs(a.res - 720) - Math.abs(b.res - 720)));
    return vids[0].link;
  }
  return null;
}
async function extThemesFromAnimeThemes(mal, al) {
  const site = mal ? 'MyAnimeList' : 'AniList';
  const id = mal || al;
  const q = `filter%5Bhas%5D=resources&filter%5Bsite%5D=${site}&filter%5Bexternal_id%5D=${id}&include=animethemes.song.artists%2Canimethemes.animethemeentries.videos`;
  const j = await fetchFrom('animethemes', `${ANIMETHEMES}/anime?${q}`);
  const a = j && Array.isArray(j.anime) ? j.anime[0] : null;
  if (!a) return null;
  const op = [];
  const ed = [];
  for (const t of a.animethemes || []) {
    if (!t || !t.song || !t.song.title || !/^(OP|ED)$/.test(t.type || '')) continue;
    const artists = (t.song.artists || []).map((x) => x && x.name).filter(Boolean);
    const entries = (t.animethemeentries || []).filter(Boolean);
    const slug = /^[A-Za-z0-9_-]+$/.test(a.slug || '') && /^[A-Za-z0-9_-]+$/.test(t.slug || '') ? `https://animethemes.moe/anime/${a.slug}/${t.slug}` : null;
    const row = { n: Number(t.sequence) || 1, title: String(t.song.title), by: artists.length ? artists.join(', ') : null, eps: epsText(entries.map((x) => x.episodes)), url: slug, video: themeVideo(entries) };
    // The same song twice (a second version of the opening) is one row.
    const list = t.type === 'OP' ? op : ed;
    if (!list.some((x) => x.n === row.n && x.title === row.title)) list.push(row);
  }
  op.sort((x, y) => x.n - y.n);
  ed.sort((x, y) => x.n - y.n);
  return op.length || ed.length ? { src: 'animethemes', op, ed, v: THEMES_V } : null;
}
// The same songs from AnimeThemes' GraphQL API, in the same rows as extThemesFromAnimeThemes.
const AT_GQL_QUERY = `query TsugiThemes($site: ResourceSite!, $id: [Int!]) {
  findAnimeByExternalSite(site: $site, id: $id) {
    slug
    animethemes {
      type sequence slug
      song { title { romaji } performances { alias artist { name { main } } } }
      animethemeentries { episodes version videos { nodes { basename link nc resolution } } }
    }
  }
}`;
async function extThemesFromGraphql(mal, al) {
  const j = await fetchFrom('atgql', ANIMETHEMES_GQL, { query: AT_GQL_QUERY, variables: { site: mal ? 'MAL' : 'ANILIST', id: [mal || al] } });
  if (j && Array.isArray(j.errors) && j.errors.length && !j.data) throw failure(`atgql: ${j.errors[0] && j.errors[0].message}`, 0);
  const list = j && j.data && Array.isArray(j.data.findAnimeByExternalSite) ? j.data.findAnimeByExternalSite : [];
  const a = list[0];
  if (!a) return null;
  const op = [];
  const ed = [];
  for (const t of a.animethemes || []) {
    const title = t && t.song && t.song.title && (t.song.title.romaji || t.song.title.native);
    if (!title || !/^(OP|ED)$/.test(t.type || '')) continue;
    const artists = ((t.song && t.song.performances) || []).map((x) => x && (x.alias || (x.artist && x.artist.name && x.artist.name.main))).filter(Boolean);
    const entries = (t.animethemeentries || []).filter(Boolean);
    const slug = /^[A-Za-z0-9_-]+$/.test(a.slug || '') && /^[A-Za-z0-9_-]+$/.test(t.slug || '') ? `https://animethemes.moe/anime/${a.slug}/${t.slug}` : null;
    const row = { n: Number(t.sequence) || 1, title: String(title), by: artists.length ? [...new Set(artists)].join(', ') : null, eps: epsText(entries.map((x) => x.episodes)), url: slug, video: themeVideo(entries) };
    const rows = t.type === 'OP' ? op : ed;
    if (!rows.some((x) => x.n === row.n && x.title === row.title)) rows.push(row);
  }
  op.sort((x, y) => x.n - y.n);
  ed.sort((x, y) => x.n - y.n);
  return op.length || ed.length ? { src: 'animethemes', op, ed, v: THEMES_V } : null;
}
async function extThemesFromMal(mal) {
  const j = await fetchFrom('tenrai', `${TENRAI}/anime/${mal}/themes`);
  const d = j && j.data;
  if (!d) return null;
  const read = (list) => (Array.isArray(list) ? list : []).map(parseMalSong).filter(Boolean).map((x) => ({ ...x, eps: x.eps ? x.eps.replace(/-/g, '–') : null }));
  const op = read(d.openings);
  const ed = read(d.endings);
  return op.length || ed.length ? { src: 'mal', op, ed, v: THEMES_V } : null;
}
async function extThemes(kind, mal, al) {
  if (kind !== 'anime') return null;
  // AnimeThemes' GraphQL API, then its REST API, then MyAnimeList's list. "Nothing there" from AnimeThemes is an
  // answer (no second AnimeThemes try); only a failure moves on to the REST API.
  let first = null;
  let failed = null;
  try { first = await extThemesFromGraphql(mal, al); } catch (err) {
    failed = err;
    try { first = await extThemesFromAnimeThemes(mal, al); failed = null; } catch (err2) { failed = err2; }
  }
  if (first) return first;
  if (!mal) { if (failed) throw failed; return null; }
  return extThemesFromMal(mal);
}

// MangaBaka's score (0.12.4): its own rating out of 100 (what its site shows, "89"), for the series AniList's
// number leads to. Several series can answer (editions it keeps apart): the first active one leads.
// The same answer carries what four other sites say (`source`), each in its own scale, with its number there:
// MangaUpdates (out of 10), Anime-Planet (out of 5), Anime News Network (out of 10), Shikimori (out of 10).
const MB_MORE = {
  mu: { from: 'manga_updates', max: 10, url: (id) => (/^[A-Za-z0-9]+$/.test(String(id)) ? `https://www.mangaupdates.com/series/${id}` : null) },
  ap: { from: 'anime_planet', max: 5, url: (id) => (/^[a-z0-9-]+$/.test(String(id)) ? `https://www.anime-planet.com/manga/${id}` : null) },
  ann: { from: 'anime_news_network', max: 10, url: (id) => (/^\d+$/.test(String(id)) ? `https://www.animenewsnetwork.com/encyclopedia/manga.php?id=${id}` : null) },
  shiki: { from: 'shikimori', max: 10, url: (id) => (/^\d+$/.test(String(id)) ? `https://shikimori.io/mangas/${id}` : null) },
};
function mbMore(source) {
  const out = {};
  for (const [k, d] of Object.entries(MB_MORE)) {
    const x = source && source[d.from];
    const r = x ? Number(x.rating) : NaN;
    const url = x && x.id != null ? d.url(x.id) : null;
    if (Number.isFinite(r) && r > 0 && r <= d.max && url) out[k] = { score: r, url };
  }
  return out;
}
async function extMb(al) {
  const j = await fetchFrom('mangabaka', `${MANGABAKA}/v1/source/anilist/${al}`);
  const list = j && j.data && Array.isArray(j.data.series) ? j.data.series.filter((x) => x && x.id) : [];
  const s = list.find((x) => x.state === 'active' && !x.merged_with) || list[0];
  if (!s) return null;
  const r = Number(s.rating);
  const url = httpsUrl(s.canonical_url);
  return {
    score: Number.isFinite(r) && r > 0 ? Math.min(100, r) : null,
    url: url && /^https:\/\/mangabaka\.org\//.test(url) ? url : `https://mangabaka.org/${Math.floor(Number(s.id))}`,
    more: mbMore(s.source),
  };
}

// Kitsu's score (0.12.4): its average rating out of 100 ("88.86"), found through Kitsu's own table of other
// sites' numbers: AniList's first, MyAnimeList's when Kitsu doesn't know AniList's.
async function extKitsu(kind, al, mal) {
  const ask = async (site, id) => {
    const q = `filter%5BexternalSite%5D=${site}%2F${kind}&filter%5BexternalId%5D=${id}&include=item&fields%5B${kind}%5D=averageRating%2CratingFrequencies%2Cslug`;
    const j = await fetchFrom('kitsu', `${KITSU}/mappings?${q}`);
    const inc = j && Array.isArray(j.included) ? j.included : [];
    return inc.find((x) => x && x.type === kind && x.attributes) || null;
  };
  let item = al ? await ask('anilist', al) : null;
  if (!item && mal) item = await ask('myanimelist', mal);
  if (!item) return null;
  const a = item.attributes;
  const r = Number(a.averageRating);
  const freq = a.ratingFrequencies && typeof a.ratingFrequencies === 'object' ? a.ratingFrequencies : {};
  const by = Object.values(freq).reduce((n, v) => n + (Number(v) || 0), 0);
  const slug = /^[A-Za-z0-9_-]+$/.test(a.slug || '') ? a.slug : /^\d+$/.test(String(item.id)) ? String(item.id) : null;
  return {
    score: Number.isFinite(r) && r > 0 ? Math.min(100, r) : null,
    by,
    url: slug ? `https://kitsu.app/${kind}/${slug}` : null,
  };
}

async function extIndex() {
  return (await chrome.storage.local.get('ext:index'))['ext:index'] || {};
}
async function extKeep(key, v) {
  const index = await extIndex();
  index[key] = Date.now();
  const keys = Object.keys(index).sort((a, b) => index[a] - index[b]);
  const drop = keys.slice(0, Math.max(0, keys.length - EXT_MAX));
  for (const k of drop) delete index[k];
  await chrome.storage.local.set({ [key]: { t: Date.now(), v }, 'ext:index': index });
  if (drop.length) await chrome.storage.local.remove(drop);
}

// { what: 'info' | 'chars' | 'themes' | 'mb' | 'kitsu', kind: 'ANIME' | 'MANGA', mal: MyAnimeList's number, al: AniList's }
// MangaBaka's and Kitsu's scores are kept by AniList's number (the one they're asked by).
const BY_AL = { mb: true, kitsu: true };
async function outside(msg) {
  const what = msg.what;
  const kind = msg.kind === 'MANGA' ? 'manga' : 'anime';
  const mal = Number(msg.mal) > 0 ? Math.floor(Number(msg.mal)) : null;
  const al = Number(msg.al) > 0 ? Math.floor(Number(msg.al)) : null;
  if (!EXT_TTL[what]) return { ok: true, data: null };
  if (BY_AL[what] ? !al || (what === 'mb' && kind !== 'manga') : !mal && !(what === 'themes' && al)) return { ok: true, data: null };
  const key = `ext:${kind}:${mal && !BY_AL[what] ? `m${mal}` : `a${al}`}:${what}`;
  const kept = (await chrome.storage.local.get(key))[key];
  // (MangaBaka's answers kept before the other sites' scores were read from them are asked again.)
  // (Songs kept before 0.12.7 have no videos: asked again too.)
  const whole = !kept || kept.v === null || (what === 'mb' ? !!kept.v.more : what === 'themes' ? kept.v.v === THEMES_V : true);
  // Songs only MyAnimeList had (AnimeThemes down, or without the title) are kept a day: AnimeThemes is asked again.
  const ttl = kept && (kept.v === null || (what === 'themes' && kept.v.src === 'mal')) ? EXT_NONE_TTL : EXT_TTL[what];
  if (kept && whole && Date.now() - kept.t < ttl) return { ok: true, data: kept.v, kept: true };
  if (extInFlight.has(key)) return extInFlight.get(key);
  const job = (async () => {
    try {
      const v = what === 'info' ? await extInfo(kind, mal) : what === 'chars' ? await extChars(kind, mal)
        : what === 'mb' ? await extMb(al) : what === 'kitsu' ? await extKitsu(kind, al, mal) : await extThemes(kind, mal, al);
      await extKeep(key, v);
      return { ok: true, data: v };
    } catch (err) {
      // Down or slow: an older answer is better than none.
      if (kept) return { ok: true, data: kept.v, kept: true, stale: true };
      return { ok: false, error: err.message, status: err.status || 0 };
    } finally {
      extInFlight.delete(key);
    }
  })();
  extInFlight.set(key, job);
  return job;
}

/* AniList on MyAnimeList's pages (0.12.7) ------------------------------------
   malpage.js runs on MyAnimeList's title pages only while the setting is on (settings.malLinks, on at first) and
   the browser lets Tsugi read myanimelist.net (asked by Settings' "Allow", or given when MyAnimeList's tracker was
   connected): it's registered here (chrome.scripting, no warning of its own) rather than in the manifest, so
   installing Tsugi never asks for MyAnimeList. Checked at every worker start, when the permission comes or goes,
   and when the setting changes. */

const MAL_SCRIPT = 'tsugi-mal';
const MAL_ORIGIN = 'https://myanimelist.net/*';
async function syncMalScript() {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
  try {
    const settings = (await chrome.storage.sync.get('settings')).settings || {};
    const want = settings.malLinks !== false && await chrome.permissions.contains({ origins: [MAL_ORIGIN] });
    const have = (await chrome.scripting.getRegisteredContentScripts({ ids: [MAL_SCRIPT] })).length > 0;
    if (want && !have) {
      await chrome.scripting.registerContentScripts([{
        id: MAL_SCRIPT, js: ['malpage.js'], runAt: 'document_idle', persistAcrossSessions: true,
        matches: ['https://myanimelist.net/anime/*', 'https://myanimelist.net/manga/*'],
      }]);
    } else if (!want && have) {
      await chrome.scripting.unregisterContentScripts({ ids: [MAL_SCRIPT] });
    }
  } catch (err) { console.warn('Tsugi: AniList on MyAnimeList', err); }
}
syncMalScript();
chrome.permissions.onAdded.addListener(() => syncMalScript());
chrome.permissions.onRemoved.addListener(() => syncMalScript());

// The AniList title for a MyAnimeList number, with your entry when you're connected (through the queue), else
// from AniList's public API. { ok, media: { id, siteUrl, episodes, chapters, mediaListEntry }, viewer: { scoreFormat } | null }
const MAL_AL_PAGE = 'Page(perPage: 3) { media(idMal_in: $mal, type: $type) { id siteUrl episodes chapters mediaListEntry { status progress score repeat } } }';
const MAL_AL_QUERY = `query TsugiFromMal($mal: [Int], $type: MediaType) { ${MAL_AL_PAGE} }`;
const MAL_AL_QUERY_ME = `query TsugiFromMal($mal: [Int], $type: MediaType) { ${MAL_AL_PAGE} Viewer { mediaListOptions { scoreFormat } } }`;
async function alForMal(msg) {
  const mal = Math.floor(Number(msg.mal));
  const type = msg.kind === 'MANGA' ? 'MANGA' : 'ANIME';
  if (!(mal > 0)) return { ok: true, media: null };
  const auth = await getAuth();
  let data;
  if (auth && auth.token) {
    data = await request(MAL_AL_QUERY_ME, { mal: [mal], type }, 'low');
  } else {
    const res = await fetch(API, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: MAL_AL_QUERY, variables: { mal: [mal], type } }) });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.data) throw failure(`AniList answered HTTP ${res.status}`, res.status);
    data = json.data;
  }
  const media = data && data.Page && Array.isArray(data.Page.media) ? data.Page.media[0] : null;
  if (!media) return { ok: true, media: null };
  const o = data.Viewer && data.Viewer.mediaListOptions;
  return {
    ok: true,
    media: { id: media.id, siteUrl: media.siteUrl || `https://anilist.co/${type.toLowerCase()}/${media.id}`, episodes: media.episodes || null, chapters: media.chapters || null,
      mediaListEntry: media.mediaListEntry || null },
    viewer: auth && auth.token ? { scoreFormat: (o && o.scoreFormat) || null } : null,
  };
}

/* Messages from the popup and from AniList pages --------------------------- */

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  const reply = (p) => {
    p.then((v) => send(v), (e) => send({ ok: false, error: e.message, status: e.status || 0 }));
    return true;
  };
  switch (msg && msg.type) {
    case 'gql':
      return reply((takePrefetch(msg.query, msg.variables) || request(msg.query, msg.variables, msg.priority)).then((data) => ({ ok: true, data })));
    case 'list:prefetch':
      prefetchList(msg).catch(() => {});
      return false;
    case 'auth:connect':
      return reply(connect(msg.clientId, !!msg.builtIn));
    case 'auth:token':
      return reply(acceptToken(msg.token, msg.expiresIn, sender));
    case 'auth:logout':
      return reply(chrome.storage.local.remove('auth').then(() => ({ ok: true })));
    case 'outside':
      return reply(outside(msg));
    case 'mal:al':
      return reply(alForMal(msg));
    case 'notif:refresh':
      return reply(refreshUnread().then(() => ({ ok: true })));
    case 'notif:read':
      return reply(setBadge(0).then(() => ({ ok: true })));
    case 'open:in':
      return reply(openTsugi(msg.where, msg.windowId));
    case 'open-setup':
      return reply(chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=tab') }).then(() => ({ ok: true })));
    default:
      // MyAnimeList and MangaBaka (trackers.js): connecting, Compare, Apply, links, AniList's own saves.
      if (msg && typeof msg.type === 'string' && msg.type.startsWith('trk:')) return reply(trkMessage(msg, sender));
      // NSFW titles kept private (0.12.3, privacy.js): reading your lists, Apply, Undo.
      if (msg && typeof msg.type === 'string' && msg.type.startsWith('nsfw:')) return reply(nsfwMessage(msg));
      return false;
  }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  scheduleUnread();
  refreshUnread();
  makeOpenMenu();
  applyOpenIn();
  if (reason !== 'install') return;
  const auth = await getAuth();
  if (!auth) chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=tab') });
});

// Other trackers (0.9): MyAnimeList and MangaBaka follow AniList. Loaded last, so it can use the queue above.
// Then what counts as NSFW (0.12.3, shared with the popup and AniList's pages) and keeping those titles private.
importScripts('trackers.js', 'nsfw.js', 'privacy.js', 'listquery.js');
