// Tsugi: other trackers (0.9, both ways since 0.10). Your lists on MyAnimeList and MangaBaka follow AniList, the
// home, and what you change there comes back to AniList.
// Loaded at the end of background.js (importScripts): everything here runs in the background worker, the only
// place that talks to the trackers.
//
// - Logging in: OAuth with PKCE. The tracker sends the login back to a page of its own site (its "redirect
//   URL"), where Tsugi reads it from the tab's address, so it works whatever this extension's ID is (like
//   AniList's pin page). The site's permission is asked only when you connect (optional_host_permissions).
// - One way to sync a title, whatever noticed it (trkSyncTitle): both sides are read as they are now and
//   compared, field by field, with both sides as they were at the last sync ("trk:base:<t>": AniList's values
//   and the tracker's). A field changed on one side travels to the other; changed on both, the newer side wins.
//   Each side is compared in its own scale, so a rounded score never travels back (AniList's 8.5 is a 9 on
//   MyAnimeList: that 9 never replaces the 8.5).
// - What notices a title: a list save on AniList in this browser (Tsugi's own, through the request queue;
//   AniList's own buttons and editor, reported by the page), and the checks (0.10): every 5 minutes while the
//   browser runs and when the popup opens, AniList's and MyAnimeList's most recently updated titles and
//   MangaBaka's changes feed; every hour, the whole lists (removals). All of it goes through one queue per
//   tracker ("trk:queue"), sent one title at a time.
// - Nothing is sent for a kind (anime, manga) before you've gone through Compare once and applied it.
// - Nothing is ever removed by itself, on either side: a title removed on one side waits for you ("trk:gone:<t>",
//   the popup's Sync log). Every change Tsugi makes is written in the sync log ("trk:log") with Undo.
// - Storage (local): "trk:<t>" the login, "trk:st:<t>" how it's going, "trk:base:<t>" the last synced state,
//   "trk:queue" titles waiting, "trk:links" titles linked by hand, "trk:hold:<t>" titles you left off,
//   "trk:only:<t>" titles that stay only on the tracker, "trk:gone:<t>" removals waiting for you, "trk:log" the
//   sync log, "trk:cur:al" / "trk:cur:<t>" where each check got to, "trk:checked" the last check, "trk:mbmap"
//   MangaBaka's numbers for AniList's, "trk:undo:<t>" the last Apply. Session: "trk:cmp:<t>" the Compare page,
//   "trk:auth" logins in progress.
'use strict';

/* The trackers ------------------------------------------------------------------------------------ */

// Tsugi's own apps on each site (made on 2026-11-12, like AniList's 56033: "Tsugi", type
// "other" on MyAnimeList and Other + Public application on MangaBaka, so there's no secret, only this public ID, as
// in every extension). Connecting is then one button and the site's Allow page. Your own app (its Client ID) or,
// for MangaBaka, a personal access token are still there, folded in Settings.
const MAL_CLIENT_ID = 'ab46ddc184d95bcbc2c7e484473fc094';
const MB_CLIENT_ID = 'vEhzhpMwKAwipLPNdpGKXWOjaQhrhiGU';

const TRACKERS = {
  mal: {
    name: 'MyAnimeList', kinds: ['ANIME', 'MANGA'], builtIn: MAL_CLIENT_ID,
    origins: ['https://myanimelist.net/*', 'https://api.myanimelist.net/*'],
    api: 'https://api.myanimelist.net/v2',
    authorize: 'https://myanimelist.net/v1/oauth2/authorize',
    tokenUrl: 'https://myanimelist.net/v1/oauth2/token',
    // The app's redirect URL on MyAnimeList's API page. Not sent with the login: MyAnimeList uses the one
    // registered, so any page on myanimelist.net works.
    redirect: 'https://myanimelist.net/',
    apps: 'https://myanimelist.net/apiconfig',
    gap: 500,            // its limits aren't published: two requests a second at most
  },
  mb: {
    name: 'MangaBaka', kinds: ['MANGA'], builtIn: MB_CLIENT_ID,
    origins: ['https://mangabaka.org/*', 'https://api.mangabaka.org/*'],
    api: 'https://api.mangabaka.org',
    authorize: 'https://mangabaka.org/auth/oauth2/authorize',
    tokenUrl: 'https://mangabaka.org/auth/oauth2/token',
    redirect: 'https://mangabaka.org/',
    scope: 'openid profile library.read library.write offline_access',
    apps: 'https://mangabaka.org/my/apps/new',
    tokens: 'https://mangabaka.org/my/settings/api-and-apps',
    gap: 400,            // 180 a minute per IP: 150 at most
  },
};
const TRK_IDS = Object.keys(TRACKERS);
const TRK_TIMEOUT_MS = 15000;
const TRK_TOUCH_MS = 2500;         // saves a moment apart are read back from AniList together
const TRK_BACKOFF = [60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3];
const TRK_MBMAP_NONE_MS = 7 * 864e5;   // "not on MangaBaka" is asked again after a week
const TRK_STALE_MS = 15 * 60e3;    // a Compare older than this is read again before Apply
// The checks (0.10). The alarm rings every 5 minutes; each source has its own pace in the background. MangaBaka
// asks apps to read its changes feed at most every 15 minutes in the background (its library sync guide), and on
// launch or a return to the foreground: here, when the popup opens.
const TRK_CHECK_MIN = 5;
const TRK_PACE = { al: 5 * 60e3, mal: 5 * 60e3, mb: 15 * 60e3 };
// MyAnimeList's whole list (it says nothing about removals): every 15 minutes, and when the popup opens if the last
// was over 2 minutes ago. AniList's whole list is small (each title's number and save time): read at every check.
const TRK_FULL_MS = 15 * 60e3;
const TRK_FULL_FG_MS = 2 * 60e3;
const TRK_BRAKE = 10;              // more removals than this found at once by a check: they wait for you
// A kind switched on but never compared starts syncing by itself this long after you connected (0.10.2): the
// Compare page the login opens is yours to look at first.
const TRK_AUTOSTART_MS = 10 * 60e3;
const TRK_FG_MS = 60e3;            // the popup opening twice in a minute checks once
const TRK_FRESH_MS = 2 * 60e3;     // a side read this recently isn't read again before its title is synced
const TRK_LOG_MAX = 400;           // the sync log keeps this many changes, 60 days at most
const TRK_LOG_DAYS = 60;
const TRK_PAGES = 6;               // a check reads at most this many pages of recent changes per list

const trkKey = (t) => `trk:${t}`;
const trkName = (t) => TRACKERS[t].name;
const trkFail = (message, status = 0, extra = {}) => Object.assign(new Error(message), { status }, extra);

/* What's compared: one record per title, in the tracker's own scale --------------------------------
   A record: s status (AniList's names: CURRENT, PLANNING, COMPLETED, DROPPED, PAUSED, REPEATING), p progress
   (episodes or chapters), v volumes (manga), sc score, r rewatches or rereads, sd / fd start and finish dates
   ("2024-07-03", "2024-07", "2024", or ""), pv private (MangaBaka only). A field that's undefined isn't compared
   (a partial date on MangaBaka, which takes whole dates only). */

const AL_TO = {
  mal: {
    ANIME: { CURRENT: 'watching', PLANNING: 'plan_to_watch', COMPLETED: 'completed', DROPPED: 'dropped', PAUSED: 'on_hold', REPEATING: 'completed' },
    MANGA: { CURRENT: 'reading', PLANNING: 'plan_to_read', COMPLETED: 'completed', DROPPED: 'dropped', PAUSED: 'on_hold', REPEATING: 'completed' },
  },
  mb: { MANGA: { CURRENT: 'reading', PLANNING: 'plan_to_read', COMPLETED: 'completed', DROPPED: 'dropped', PAUSED: 'paused', REPEATING: 'rereading' } },
};
const MAL_FROM = { watching: 'CURRENT', reading: 'CURRENT', plan_to_watch: 'PLANNING', plan_to_read: 'PLANNING', completed: 'COMPLETED', dropped: 'DROPPED', on_hold: 'PAUSED' };
const MB_FROM = { reading: 'CURRENT', plan_to_read: 'PLANNING', considering: 'PLANNING', completed: 'COMPLETED', dropped: 'DROPPED', paused: 'PAUSED', rereading: 'REPEATING' };

const pad2 = (n) => String(n).padStart(2, '0');
function fuzzyText(d) {
  if (!d || !d.year) return '';
  if (!d.month) return String(d.year);
  return `${d.year}-${pad2(d.month)}${d.day ? `-${pad2(d.day)}` : ''}`;
}
// A tracker's date as "2024-07-03" (or "2024-07", "2024"); MangaBaka sometimes adds a time.
function dateText(s) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(s || ''));
  if (!m || m[1] === '0000') return '';
  return m[3] && m[3] !== '00' ? `${m[1]}-${m[2]}-${m[3]}` : m[2] && m[2] !== '00' ? `${m[1]}-${m[2]}` : m[1];
}
const wholeDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);

// AniList's values for one title, as kept in the sync state (score out of 100, AniList's own dates).
function alRaw(e) {
  return { s: e.status, p: num(e.progress), v: num(e.progressVolumes), sc: Number(e.score) || 0, r: num(e.repeat), sd: e.startedAt || '', fd: e.completedAt || '', pv: !!e.private };
}

// MangaBaka keeps scores in the steps you chose there (1, 5, 10, 20 or 25 out of 100).
function stepRound(sc, step) {
  if (!(sc > 0)) return 0;
  const st = [1, 5, 10, 20, 25].includes(step) ? step : 1;
  return Math.max(st, Math.min(100, Math.round(sc / st) * st));
}

// AniList's values in the tracker's scale: MyAnimeList's scores are whole numbers out of 10 (AniList's 8.5 is a 9).
function recFrom(t, kind, raw, steps) {
  if (t === 'mal') {
    const r = { s: raw.s, p: raw.p, sc: raw.sc > 0 ? Math.max(1, Math.min(10, Math.round(raw.sc / 10))) : 0, r: raw.r, sd: raw.sd, fd: raw.fd };
    if (kind === 'MANGA') r.v = raw.v;
    return r;
  }
  return { s: raw.s, p: raw.p, v: raw.v, sc: stepRound(raw.sc, steps), r: raw.r, sd: wholeDate(raw.sd), fd: wholeDate(raw.fd), pv: raw.pv };
}

function malRec(kind, ls) {
  const l = ls || {};
  const re = kind === 'MANGA' ? l.is_rereading : l.is_rewatching;
  const r = {
    s: re ? 'REPEATING' : MAL_FROM[l.status] || 'PLANNING',
    p: num(kind === 'MANGA' ? l.num_chapters_read : (l.num_episodes_watched ?? l.num_watched_episodes)),
    sc: num(l.score),
    r: num(kind === 'MANGA' ? l.num_times_reread : l.num_times_rewatched),
    sd: dateText(l.start_date), fd: dateText(l.finish_date),
  };
  if (kind === 'MANGA') r.v = num(l.num_volumes_read);
  return r;
}

function mbRec(en) {
  const e = en || {};
  return {
    s: MB_FROM[e.state] || 'PLANNING', s0: e.state || null,
    p: num(e.progress_chapter), v: num(e.progress_volume), sc: num(e.rating), r: num(e.number_of_rereads),
    sd: dateText(e.start_date), fd: dateText(e.finish_date), pv: !!e.is_private,
  };
}

const REC_KEYS = { mal: { ANIME: ['s', 'p', 'sc', 'r', 'sd', 'fd'], MANGA: ['s', 'p', 'v', 'sc', 'r', 'sd', 'fd'] }, mb: { MANGA: ['s', 'p', 'v', 'sc', 'r', 'sd', 'fd', 'pv'] } };
const isEmpty = (k, v) => v === undefined || v === null || (k === 's' ? false : k === 'pv' ? v === false : !v);

// Compare: AniList's value differs and isn't empty. An empty one on AniList (no score, no date, 0 episodes)
// never clears what the tracker has: it may know more than AniList.
function compareDiffs(t, kind, a, tr, rules) {
  const out = [];
  for (const k of keysFor(t, kind, rules)) {
    if (isEmpty(k, a[k])) continue;
    if (a[k] !== tr[k]) out.push({ k, a: a[k], t: tr[k] ?? null });
  }
  return out;
}

// Everything a record has, for a title added on the other side (empty values left out, and what your rules keep
// apart: scores, dates, rewatches).
function fullFields(t, kind, rec, rules) {
  const out = {};
  for (const k of keysFor(t, kind, rules)) if (!isEmpty(k, rec[k])) out[k] = rec[k];
  out.s = rec.s;
  if (rec.s0) out.s0 = rec.s0;
  return out;
}

/* Your rules for each tracker (0.10.1, Settings, Trackers): kept on its login, "rules" -------------------------
   dir: 'both', 'out' (AniList to the tracker only) or 'in' (the tracker to AniList only). adds: a title added on
   one side is added on the other. removes: 'auto' (removed on the other side too, with Undo in the Sync log), 'ask'
   (waits for you) or 'off' (stays there, and stops syncing). sc, dates, r: scores, start and finish dates,
   rewatches travel (off: each side keeps its own). Status and progress always travel. */
const RULE_DEFAULTS = { dir: 'both', adds: true, removes: 'auto', sc: true, dates: true, r: true };
function rulesOf(a) {
  const r = { ...RULE_DEFAULTS, ...((a && a.rules) || {}) };
  if (!['both', 'out', 'in'].includes(r.dir)) r.dir = 'both';
  if (!['auto', 'ask', 'off'].includes(r.removes)) r.removes = 'auto';
  for (const k of ['adds', 'sc', 'dates', 'r']) r[k] = r[k] !== false;
  return r;
}
const goesOut = (r) => r.dir !== 'in';    // AniList -> the tracker
const comesIn = (r) => r.dir !== 'out';   // the tracker -> AniList
function keysFor(t, kind, rules) {
  const r = rules || RULE_DEFAULTS;
  return REC_KEYS[t][kind].filter((k) => !((k === 'sc' && !r.sc) || ((k === 'sd' || k === 'fd') && !r.dates) || (k === 'r' && !r.r)));
}

/* Both ways (0.10): one title, both sides now, against both sides at the last sync ---------------------
   raw: AniList's values now (alRaw: score out of 100). tr: the tracker's now ({ rec, at }: its record in its
   own scale, and when it was last saved there, ms). b: the last sync ({ ...AniList's values then, tr: the
   tracker's record then }) or null. alAt: when AniList's entry was last saved (ms).
   Returns { toTr, toAl, both }: the fields to write on the tracker (its scale) and on AniList (the tracker's
   scale, turned into AniList's by alFromTr), and the fields changed on both sides (the newer one won). */
// rules: your rules for the tracker (rulesOf): one way only, and the fields that don't travel.
function trkDecide(t, kind, raw, tr, b, steps, alAt, rules) {
  const r = rules || RULE_DEFAULTS;
  const keys = keysFor(t, kind, r);
  const a = recFrom(t, kind, raw, steps);
  const now = tr.rec;
  const out = { toTr: {}, toAl: {}, both: [] };
  // One way only: that side always leads, whatever was saved last.
  const alNewer = r.dir === 'out' ? true : r.dir === 'in' ? false : (alAt || 0) >= (tr.at || 0);
  const noEmptyDate = (k, v) => t === 'mal' && (k === 'sd' || k === 'fd') && !v;   // MyAnimeList's API can't empty a date
  if (!b) {
    // Never synced, but on both: the side saved last leads, and an empty value never empties the other's
    // (like Compare: the other side may know more).
    for (const k of keys) {
      if (a[k] === undefined || a[k] === now[k]) continue;
      if (alNewer) { if (!isEmpty(k, a[k])) out.toTr[k] = a[k]; }
      else if (!isEmpty(k, now[k])) out.toAl[k] = now[k];
    }
    return out;
  }
  // A title synced by 0.9 has no record of the tracker's side: its values there are taken as they are now,
  // so only AniList's changes travel this once.
  const was = b.tr || null;
  for (const k of keys) {
    if (a[k] === undefined) continue;     // MangaBaka: a partial AniList date isn't compared
    if (a[k] === now[k]) continue;        // the same in the tracker's scale (8.5 is a 9 there): nothing to do
    const aCh = raw[k] !== b[k];          // AniList's value moved since the last sync (in its own scale)
    const tCh = !!was && now[k] !== was[k];
    if (aCh && tCh) out.both.push(k);
    if (aCh && (!tCh || alNewer)) { if (goesOut(r) && !noEmptyDate(k, a[k])) out.toTr[k] = a[k]; }
    else if (tCh && comesIn(r)) out.toAl[k] = now[k];
    // Neither moved: a difference you left in Compare stays. One way only: the other side's changes stay there.
  }
  return out;
}

// A tracker's values in AniList's own: MyAnimeList's 8 is 80 out of 100, MangaBaka's ratings already are.
function alFromTr(t, f) {
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 's0') continue;
    out[k] = k === 'sc' ? (t === 'mal' ? Math.round((Number(v) || 0) * 10) : Math.round(Number(v) || 0)) : v;
  }
  return out;
}
const fuzzyIn = (s) => {
  const [y, m, d] = String(s || '').split('-').map(Number);
  return { year: y || null, month: (y && m) || null, day: (y && m && d) || null };
};
// AniList's values (alRaw's names and scale) as SaveMediaListEntry's arguments.
const AL_ARGS = {
  s: ['status', 'MediaListStatus', (v) => v], p: ['progress', 'Int', (v) => num(v)], v: ['progressVolumes', 'Int', (v) => num(v)],
  sc: ['scoreRaw', 'Int', (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)))], r: ['repeat', 'Int', (v) => num(v)],
  sd: ['startedAt', 'FuzzyDateInput', fuzzyIn], fd: ['completedAt', 'FuzzyDateInput', fuzzyIn], pv: ['private', 'Boolean', (v) => !!v],
};
// Only for putting back a title removed from AniList (its Undo): notes, priority, hidden, custom lists.
Object.assign(AL_ARGS, {
  nt: ['notes', 'String', (v) => String(v || '')], pr: ['priority', 'Int', (v) => num(v)],
  hd: ['hiddenFromStatusLists', 'Boolean', (v) => !!v], cl: ['customLists', '[String]', (v) => (Array.isArray(v) ? v.map(String) : [])],
});
const AL_KEYS = ['s', 'p', 'v', 'sc', 'r', 'sd', 'fd', 'pv'];
const sameRaw = (raw, b) => AL_KEYS.every((k) => raw[k] === b[k]);
// What the tracker has for a title it doesn't have yet (what a write starts from).
const EMPTY_REC = { s: 'PLANNING', p: 0, v: 0, sc: 0, r: 0, sd: '', fd: '', pv: false };
const emptyOf = (k) => EMPTY_REC[k];

/* Requests: one queue per tracker ----------------------------------------------------------------- */

const trkSvc = {};
for (const t of TRK_IDS) trkSvc[t] = { last: 0, chain: Promise.resolve(), pausedUntil: 0 };

async function trkAccount(t) {
  return (await chrome.storage.local.get(trkKey(t)))[trkKey(t)] || null;
}
async function trkSetAccount(t, patch) {
  const a = await trkAccount(t);
  if (!a) return null;
  const next = { ...a, ...patch };
  await chrome.storage.local.set({ [trkKey(t)]: next });
  return next;
}

// How it's going, for Settings: the last error, the last title sent, titles without a match.
async function trkStatus(t) {
  return (await chrome.storage.local.get(`trk:st:${t}`))[`trk:st:${t}`] || {};
}
async function trkSetStatus(t, patch) {
  const s = { ...(await trkStatus(t)), ...patch };
  await chrome.storage.local.set({ [`trk:st:${t}`]: s });
  return s;
}

async function trkHasPermission(t) {
  try { return await chrome.permissions.contains({ origins: TRACKERS[t].origins }); } catch { return false; }
}

// A form or JSON body, sent with the login (Bearer, or MangaBaka's personal token as x-api-key).
// Resolves with the JSON (null for an empty answer or a 404), throws with .status otherwise.
function trkCall(t, path, { method = 'GET', form = null, json = null, auth = true, url = null } = {}) {
  const T = TRACKERS[t];
  const sv = trkSvc[t];
  const run = async () => {
    for (let tries = 0; ; tries++) {
      if (sv.pausedUntil > Date.now()) await wait(sv.pausedUntil - Date.now());
      const gap = sv.last + T.gap - Date.now();
      if (gap > 0) await sleep(gap);
      sv.last = Date.now();
      const a = auth ? await trkLogin(t) : null;
      const headers = { Accept: 'application/json' };
      if (a) {
        if (a.pat) headers['x-api-key'] = a.token;
        else headers.Authorization = `Bearer ${a.token}`;
      }
      let body;
      if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
      if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TRK_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url || `${T.api}${path}`, { method, headers, body, signal: ctl.signal, credentials: 'omit' });
      } catch {
        throw trkFail(`${T.name} didn't answer.`, 0, { retry: true });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 && a && !a.pat && tries === 0) { await trkRefresh(t, a); continue; }
      if (res.status === 401 && a) {
        await trkNeedsLogin(t);
        throw trkFail(`${T.name} refused the saved login. Log in again in Settings, Trackers.`, 401, { login: true });
      }
      if (res.status === 429) {
        sv.pausedUntil = Date.now() + (Number(res.headers.get('Retry-After')) || 10) * 1000;
        if (tries < 2) continue;
        throw trkFail(`${T.name} asked Tsugi to slow down.`, 429, { retry: true });
      }
      // MyAnimeList answers 403 when it thinks it's getting too many requests: a minute's rest, then later.
      if (t === 'mal' && res.status === 403) {
        sv.pausedUntil = Date.now() + 60e3;
        throw trkFail('MyAnimeList refused for now (too many requests?).', 403, { retry: true });
      }
      if (res.status === 404) return null;
      let j = null;
      const text = await res.text().catch(() => '');
      if (text) { try { j = JSON.parse(text); } catch { /* not JSON */ } }
      if (!res.ok) {
        const msg = (j && (j.message || j.error_description || j.error)) || `HTTP ${res.status}`;
        throw trkFail(`${T.name}: ${msg}`, res.status, { retry: res.status >= 500 });
      }
      return j;
    }
  };
  const p = sv.chain.then(run, run);
  sv.chain = p.catch(() => {});
  return p;
}

/* Logging in -------------------------------------------------------------------------------------- */

function randomText(n) {
  // 64 characters that need no escaping anywhere (PKCE allows "." and "~" too, but some servers mangle them).
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
async function s256(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function trkClientId(t) {
  const own = (await chrome.storage.local.get(`trk:client:${t}`))[`trk:client:${t}`];
  return String(own || TRACKERS[t].builtIn || '').trim();
}

const authStarting = {};
// Opens the tracker's approval page. The browser's permission for its site was just given (or was there).
// builtIn: the Connect button, which always uses Tsugi's app (and forgets your own). Neither (Log in again):
// the app you used last.
async function trkStartAuth(t, client, builtIn = false) {
  const T = TRACKERS[t];
  if (!T) return { ok: false, error: 'Unknown tracker' };
  // The Connect button and the browser's "permission given" can both ask within a moment: one tab.
  if (authStarting[t] && Date.now() - authStarting[t] < 3000) return { ok: true };
  authStarting[t] = Date.now();
  const stop = (error) => { authStarting[t] = 0; return { ok: false, error }; };
  if (!(await trkHasPermission(t))) return stop(`Tsugi needs your browser's permission to reach ${T.name}.`);
  const own = String(client || '').trim();
  if (own) {
    if (!/^[A-Za-z0-9_.-]{6,128}$/.test(own)) return stop('That doesn\'t look like a Client ID: copy it again from the app\'s page.');
    await chrome.storage.local.set({ [`trk:client:${t}`]: own });
  } else if (builtIn && T.builtIn) {
    await chrome.storage.local.remove(`trk:client:${t}`);
  }
  const id = own || await trkClientId(t);
  if (!id) return stop(`${T.name} needs a Client ID first.`);
  const verifier = randomText(96);
  const st = randomText(32);
  const q = new URLSearchParams({ response_type: 'code', client_id: id, state: st });
  if (t === 'mal') {
    q.set('code_challenge', verifier);   // MyAnimeList only knows the "plain" method
    q.set('code_challenge_method', 'plain');
  } else {
    q.set('redirect_uri', T.redirect);
    q.set('scope', T.scope);
    q.set('code_challenge', await s256(verifier));
    q.set('code_challenge_method', 'S256');
  }
  const url = `${T.authorize}?${q}`;
  const tab = await chrome.tabs.create({ url });
  const pending = (await chrome.storage.session.get('trk:auth'))['trk:auth'] || {};
  pending[t] = { tab: tab.id, state: st, verifier, client: id, at: Date.now(), url };
  authTabs.set(tab.id, t);
  await chrome.storage.session.set({ 'trk:auth': pending });
  await chrome.storage.session.remove('trk:pending');
  return { ok: true };
}

// The approval tab, watched until the tracker sends it back with ?code= (its own site: the permission we
// were given lets the browser show us the address). Then the tab becomes Tsugi's Compare page.
const authTabs = new Map();   // tab id -> tracker (also in session "trk:auth", for a worker started again)
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url || !/[?&](code|error)=/.test(info.url)) return;
  trkAuthTab(tabId, info.url).catch((err) => console.warn('Tsugi: login', err));
});
chrome.tabs.onRemoved.addListener((tabId) => { authTabs.delete(tabId); });

async function trkAuthTab(tabId, url) {
  const pending = (await chrome.storage.session.get('trk:auth'))['trk:auth'] || {};
  const t = Object.keys(pending).find((k) => pending[k] && pending[k].tab === tabId);
  if (!t) return;
  const p = pending[t];
  let u;
  try { u = new URL(url); } catch { return; }
  if (u.searchParams.get('state') !== p.state) return;
  delete pending[t];
  authTabs.delete(tabId);
  await chrome.storage.session.set({ 'trk:auth': pending });
  const page = chrome.runtime.getURL(`popup.html?view=tab&sync=${t}`);
  const code = u.searchParams.get('code');
  if (!code) {
    const why = u.searchParams.get('error') === 'access_denied' ? `You didn't approve Tsugi on ${trkName(t)}.` : `${trkName(t)} didn't log you in (${u.searchParams.get('error') || 'no code'}).`;
    await chrome.storage.local.set({ 'trk:connectErr': { t, msg: why, at: Date.now() } });
    chrome.tabs.update(tabId, { url: page }).catch(() => {});
    return;
  }
  // The code is shown nowhere: the tab moves on to Tsugi's own page at once.
  chrome.tabs.update(tabId, { url: page }).catch(() => {});
  try {
    const tok = await trkExchange(t, { grant_type: 'authorization_code', code, code_verifier: p.verifier, client_id: p.client, ...(t === 'mb' ? { redirect_uri: TRACKERS.mb.redirect } : {}) });
    await trkSaveLogin(t, tok, p.client);
  } catch (err) {
    await chrome.storage.local.set({ 'trk:connectErr': { t, msg: err.message, at: Date.now() } });
  }
}

async function trkExchange(t, form) {
  let res;
  try {
    res = await fetch(TRACKERS[t].tokenUrl, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw trkFail(`${trkName(t)} didn't answer. Try again in a moment.`, 0, { retry: true });
  }
  let j = null;
  try { j = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !j || !j.access_token) {
    const why = (j && (j.error_description || j.message || j.error)) || `HTTP ${res.status}`;
    throw trkFail(`${trkName(t)} refused the login: ${why}`, res.status || 400, { login: res.status === 400 || res.status === 401 });
  }
  return j;
}

// Saves the login and who it is (the account's name and picture, for Settings).
async function trkSaveLogin(t, tok, client, pat = false) {
  const was = await trkAccount(t);
  const a = {
    token: pat ? tok : tok.access_token,
    refresh: pat ? null : tok.refresh_token || null,
    exp: pat ? 0 : Date.now() + (Number(tok.expires_in) || 3600) * 1000,
    pat, client: client || null,
    user: was && was.user ? was.user : null,
    kinds: was && was.kinds ? was.kinds : Object.fromEntries(TRACKERS[t].kinds.map((k) => [k, true])),
    ready: was && was.ready ? was.ready : {},
    rules: was && was.rules ? was.rules : { ...RULE_DEFAULTS },
    at: Date.now(),
  };
  await chrome.storage.local.set({ [trkKey(t)]: a });
  try {
    a.user = await trkWho(t);
  } catch (err) {
    if (!was) { await chrome.storage.local.remove(trkKey(t)); throw err; }
  }
  await chrome.storage.local.set({ [trkKey(t)]: a });
  await chrome.storage.local.remove('trk:connectErr');
  await trkSetStatus(t, { err: null });
  // Titles that waited for this login go now.
  const q = await trkQueue();
  for (const it of Object.values(q[t] || {})) it.next = 0;
  await trkSaveQueue();
  trkSyncActive();
  trkPump(t);
  return a;
}

async function trkWho(t) {
  if (t === 'mal') {
    const j = await trkCall('mal', '/users/@me');
    if (!j || !j.name) throw trkFail('MyAnimeList didn\'t say who you are.', 0);
    return { id: j.id || null, name: String(j.name), pic: typeof j.picture === 'string' ? j.picture : null };
  }
  const j = await trkCall('mb', '/v1/my/profile');
  const d = j && j.data;
  if (!d) throw trkFail('MangaBaka didn\'t say who you are.', 0);
  const steps = Number(d.rating_steps);
  return { id: d.id || null, name: String(d.preferred_username || d.nickname || 'You'), pic: typeof d.picture === 'string' ? d.picture : null, steps: [1, 5, 10, 20, 25].includes(steps) ? steps : 1 };
}

// MangaBaka's personal access token ("mb-..."), an alternative to its login page.
async function trkUseToken(t, token) {
  const tok = String(token || '').trim();
  if (t !== 'mb') return { ok: false, error: 'Only MangaBaka has personal tokens.' };
  if (!/^mb-[A-Za-z0-9_-]{8,}$/.test(tok)) return { ok: false, error: 'A MangaBaka token starts with "mb-". Copy it again from MangaBaka.' };
  if (!(await trkHasPermission(t))) return { ok: false, error: 'Tsugi needs your browser\'s permission to reach MangaBaka.' };
  await chrome.storage.session.remove('trk:pending');
  try {
    await trkSaveLogin(t, tok, null, true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.status === 401 ? 'MangaBaka didn\'t accept that token. Make a new one and paste it here.' : err.message };
  }
}

// The login is valid, or renewed now (a few minutes before it ends).
async function trkLogin(t) {
  const a = await trkAccount(t);
  if (!a) throw trkFail(`Not connected to ${trkName(t)}.`, 401, { login: true });
  if (a.needsLogin) throw trkFail(`${trkName(t)} needs you to log in again (Settings, Trackers).`, 401, { login: true });
  if (!a.pat && a.exp && a.exp - Date.now() < 5 * 60e3) return trkRefresh(t, a);
  return a;
}

// One renewal at a time: MangaBaka retires a refresh token once used, and using it twice ends every login.
const refreshing = {};
function trkRefresh(t, a) {
  if (refreshing[t]) return refreshing[t];
  refreshing[t] = (async () => {
    if (!a.refresh) { await trkNeedsLogin(t); throw trkFail(`${trkName(t)} needs you to log in again (Settings, Trackers).`, 401, { login: true }); }
    let tok;
    try {
      tok = await trkExchange(t, { grant_type: 'refresh_token', refresh_token: a.refresh, client_id: a.client || await trkClientId(t) });
    } catch (err) {
      if (err.login) await trkNeedsLogin(t);
      throw err;
    }
    return trkSetAccount(t, { token: tok.access_token, refresh: tok.refresh_token || a.refresh, exp: Date.now() + (Number(tok.expires_in) || 3600) * 1000, needsLogin: false });
  })().finally(() => { delete refreshing[t]; });
  return refreshing[t];
}

async function trkNeedsLogin(t) {
  await trkSetAccount(t, { needsLogin: true });
  await trkSetStatus(t, { err: { msg: `${trkName(t)} needs you to log in again.`, at: Date.now(), login: true } });
}

async function trkDisconnect(t) {
  const keys = [`trk:base:${t}`, `trk:only:${t}`];
  for (const k of keys) trkForget(k);   // a write waiting would put them back
  await chrome.storage.local.remove([trkKey(t), `trk:st:${t}`, `trk:undo:${t}`, `trk:hold:${t}`, `trk:gone:${t}`, `trk:cur:${t}`, ...keys]);
  await chrome.storage.session.remove(`trk:cmp:${t}`);
  trkMem.base[t] = null;
  trkMem.hold[t] = null;
  trkMem.only[t] = null;
  trkMem.gone[t] = null;
  // Its changes leave the sync log too (they can't be undone without the login).
  const log = await trkLogGet();
  trkMem.log = log.filter((x) => x.t !== t);
  await trkSaveLog();
  const q = await trkQueue();
  delete q[t];
  await trkSaveQueue();
  trkSyncActive();
  // The browser's permission for the site goes back too.
  try { await chrome.permissions.remove({ origins: TRACKERS[t].origins }); } catch { /* still in use */ }
  return { ok: true };
}

// The browser's permission was just given: the Connect button that asked for it goes on (the popup may
// have closed when the browser asked).
chrome.permissions.onAdded.addListener(async (perms) => {
  const origins = (perms && perms.origins) || [];
  const p = (await chrome.storage.session.get('trk:pending'))['trk:pending'];
  if (!p || !TRACKERS[p.t] || Date.now() - p.at > 3 * 60e3) return;
  if (!TRACKERS[p.t].origins.some((o) => origins.includes(o))) return;
  if (p.token) { await chrome.storage.session.remove('trk:pending'); trkUseToken(p.t, p.token); return; }
  trkStartAuth(p.t, p.client, !!p.builtIn);
});

/* What's kept: the sync state, the queue, links ----------------------------------------------------
   Read once into memory and written back on each change: only this worker writes these keys. */

const trkMem = { base: {}, hold: {}, only: {}, gone: {}, queue: null, links: null, mbmap: null, log: null };
const trkLoads = {};
function trkLoad(name, key, fallback) {
  if (!trkLoads[key]) trkLoads[key] = chrome.storage.local.get(key).then((o) => o[key] || fallback()).finally(() => { delete trkLoads[key]; });
  return trkLoads[key];
}
// The last sync of each title: { mediaId: { s, p, v, sc, r, sd, fd, pv (AniList's values), tid (the tracker's
// number), eid (AniList's entry), u (AniList's updatedAt), ty (ANIME / MANGA), n / img (name and cover, for the
// Sync log), tr (the tracker's record then, in its scale; null: not there; missing: synced by 0.9) } }.
async function trkBase(t) {
  if (!trkMem.base[t]) trkMem.base[t] = await trkLoad('base', `trk:base:${t}`, () => ({}));
  return trkMem.base[t];
}
// Written a moment later, once for many titles (a big list is a few hundred KB). Nothing waits for it: the queue
// writes everything out when it stops (trkFlushWrites), Apply too. A write lost when the browser stops the worker
// is harmless: both sides then already agree, and the next sync only finds that out again.
const trkWrites = {};
function trkSoon(key, value) {
  const w = trkWrites[key] || (trkWrites[key] = {});
  w.value = value;
  if (!w.p) {
    w.p = new Promise((done) => { w.done = done; });
    w.timer = setTimeout(() => trkWriteNow(key), 300);
  }
  return Promise.resolve();
}
function trkWriteNow(key) {
  const w = trkWrites[key];
  if (!w || !w.p) return Promise.resolve();
  clearTimeout(w.timer);
  const { done, value } = w;
  w.p = null;
  return chrome.storage.local.set({ [key]: value() }).catch(() => {}).then(done);
}
const trkFlushWrites = () => Promise.all(Object.keys(trkWrites).map(trkWriteNow));
function trkForget(key) {
  const w = trkWrites[key];
  if (!w || !w.p) return;
  clearTimeout(w.timer);
  w.p = null;
  w.done();
}
const trkSaveBase = (t) => trkSoon(`trk:base:${t}`, () => trkMem.base[t] || {});
// Titles that stay only on the tracker: { ANIME: { tid: 1 }, MANGA: {...}, built: { kind: when } }. They were
// there before syncing started (Compare's "Only on"), or you kept them there after removing them from AniList;
// what changes on them doesn't come to AniList.
async function trkOnly(t) {
  if (!trkMem.only[t]) trkMem.only[t] = await trkLoad('only', `trk:only:${t}`, () => ({}));
  for (const k of ['ANIME', 'MANGA', 'built']) if (!trkMem.only[t][k]) trkMem.only[t][k] = {};
  return trkMem.only[t];
}
const trkSaveOnly = (t) => trkSoon(`trk:only:${t}`, () => trkMem.only[t] || {});
// Removed on one side, still on the other: waits for you. { mediaId: { side: 'al' (removed from AniList) | 'tr'
// (removed from the tracker), kind, tid, title, cover, color, at } }.
async function trkGone(t) {
  if (!trkMem.gone[t]) trkMem.gone[t] = await trkLoad('gone', `trk:gone:${t}`, () => ({}));
  return trkMem.gone[t];
}
const trkSaveGone = (t) => chrome.storage.local.set({ [`trk:gone:${t}`]: trkMem.gone[t] || {} });

// One title at a time per tracker: its last sync is read, both sides are written, then it's kept.
const trkLocks = {};
function trkLock(t, fn) {
  const p = (trkLocks[t] || Promise.resolve()).then(fn, fn);
  trkLocks[t] = p.catch(() => {});
  return p;
}
async function trkHold(t) {
  if (!trkMem.hold[t]) trkMem.hold[t] = await trkLoad('hold', `trk:hold:${t}`, () => ({}));
  return trkMem.hold[t];
}
const trkSaveHold = (t) => chrome.storage.local.set({ [`trk:hold:${t}`]: trkMem.hold[t] || {} });
async function trkQueue() {
  if (!trkMem.queue) trkMem.queue = await trkLoad('queue', 'trk:queue', () => ({}));
  return trkMem.queue;
}
const trkSaveQueue = () => chrome.storage.local.set({ 'trk:queue': trkMem.queue || {} });
async function trkLinks() {
  if (!trkMem.links) trkMem.links = await trkLoad('links', 'trk:links', () => ({}));
  for (const t of TRK_IDS) if (!trkMem.links[t]) trkMem.links[t] = {};
  return trkMem.links;
}
const trkSaveLinks = () => chrome.storage.local.set({ 'trk:links': trkMem.links || {} });
async function trkMbMap() {
  if (!trkMem.mbmap) trkMem.mbmap = await trkLoad('mbmap', 'trk:mbmap', () => ({}));
  return trkMem.mbmap;
}
const trkSaveMbMap = () => chrome.storage.local.set({ 'trk:mbmap': trkMem.mbmap || {} });

/* The sync log (0.10): every change Tsugi made on either side, newest first, with Undo -------------------------
   { id, at, t, kind, mid, tid, title, cover, color, side: 'al' (written on AniList, from tracker t) | 'tr' (written
   on tracker t), op: 'set' | 'add' | 'remove', ch: [{ k, a (before), b (after) }] in that side's own scale (AniList:
   score out of 100), both: the fields changed on both sides, s0: MangaBaka's state word before, eid: AniList's entry
   (an add), was: the values before a remove, undone: when }. Only your own titles, only on this computer. */
async function trkLogGet() {
  if (!trkMem.log) trkMem.log = await trkLoad('log', 'trk:log', () => []);
  return trkMem.log;
}
// Returns the new row's id.
async function trkLogAdd(en) {
  const log = await trkLogGet();
  const cut = Date.now() - TRK_LOG_DAYS * 864e5;
  const row = { id: randomText(12), at: Date.now(), undone: null, ...en };
  log.unshift(row);
  while (log.length > TRK_LOG_MAX || (log.length && log[log.length - 1].at < cut)) log.pop();
  trkSoon('trk:log', () => trkMem.log || []);
  return row.id;
}
const trkSaveLog = () => trkSoon('trk:log', () => trkMem.log || []);

// Is any tracker sending? Kept in memory so the request queue's hook costs nothing when none is.
let trkActive = null;
async function trkSyncActive() {
  const o = await chrome.storage.local.get(TRK_IDS.map(trkKey));
  trkActive = TRK_IDS.some((t) => { const a = o[trkKey(t)]; return a && a.kinds && Object.keys(a.ready || {}).some((k) => a.ready[k] && a.kinds[k]); });
  // A kind switched on that hasn't started yet starts at a check (trkStartKinds).
  const starting = TRK_IDS.some((t) => { const a = o[trkKey(t)]; return a && !a.needsLogin && TRACKERS[t].kinds.some((k) => a.kinds && a.kinds[k] && !(a.ready && a.ready[k])); });
  // The checks (0.10) run every few minutes while something follows AniList, and not at all otherwise.
  try {
    const cur = await chrome.alarms.get('trk:check');
    const on = trkActive || starting;
    if (on && (!cur || cur.periodInMinutes !== TRK_CHECK_MIN)) await chrome.alarms.create('trk:check', { periodInMinutes: TRK_CHECK_MIN });
    if (!on && cur) await chrome.alarms.clear('trk:check');
  } catch { /* ignore */ }
  return trkActive;
}
// From when a title saved on the tracker counts as added there (it comes to AniList): since you connected, or since
// that kind started syncing if that was earlier.
function newSince(a, kind) {
  const x = Math.min((a && a.at) || Infinity, (a && a.ready && a.ready[kind]) || Infinity);
  return Number.isFinite(x) ? x : Date.now();
}
const kindOn = (a, kind) => !!(a && a.kinds && a.kinds[kind] && a.ready && a.ready[kind]);

/* AniList's side ------------------------------------------------------------------------------------ */

const SYNC_ENTRY = `id mediaId status progress progressVolumes score(format: POINT_100) repeat private updatedAt
  startedAt { year month day } completedAt { year month day }
  media { id idMal type format episodes chapters volumes isAdult seasonYear startDate { year } title { userPreferred romaji } coverImage { medium color } }`;
const SYNC_LIST_QUERY = `query TsugiSyncList($userId: Int, $type: MediaType, $chunk: Int) {
  MediaListCollection(userId: $userId, type: $type, forceSingleCompletedList: true, chunk: $chunk, perChunk: 500) { hasNextChunk lists { entries { ${SYNC_ENTRY} } } }
}`;
const SYNC_ENTRIES_QUERY = `query TsugiSyncEntries($userId: Int, $ids: [Int], $page: Int) {
  Page(page: $page, perPage: 50) { pageInfo { hasNextPage } mediaList(userId: $userId, mediaId_in: $ids) { ${SYNC_ENTRY} } }
}`;

function alEntry(x) {
  const m = x.media || {};
  const tl = m.title || {};
  return {
    id: x.id, mediaId: x.mediaId, type: m.type === 'MANGA' ? 'MANGA' : 'ANIME',
    status: x.status, progress: x.progress || 0, progressVolumes: x.progressVolumes || 0, score: x.score || 0, repeat: x.repeat || 0,
    private: !!x.private, startedAt: fuzzyText(x.startedAt), completedAt: fuzzyText(x.completedAt), updatedAt: x.updatedAt || 0,
    idMal: m.idMal || null,
    // For Compare and Settings: what the title is called and looks like.
    title: tl.userPreferred || tl.romaji || `Title ${x.mediaId}`, romaji: tl.romaji || tl.userPreferred || '',
    cover: (m.coverImage && m.coverImage.medium) || null, color: (m.coverImage && m.coverImage.color) || null,
    format: m.format || null, year: m.seasonYear || (m.startDate && m.startDate.year) || null,
    total: m.type === 'MANGA' ? m.chapters || null : m.episodes || null,
  };
}

async function trkReadAniList(userId, kind) {
  const out = new Map();
  for (let chunk = 1; chunk < 40; chunk++) {
    const data = await request(SYNC_LIST_QUERY, { userId, type: kind, chunk }, 'high');
    const c = data && data.MediaListCollection;
    for (const l of (c && c.lists) || []) {
      // Custom lists repeat titles (and hold the ones hidden from status lists): each title once.
      for (const x of l.entries || []) if (x && x.mediaId && !out.has(x.mediaId)) out.set(x.mediaId, alEntry(x));
    }
    if (!c || !c.hasNextChunk) break;
  }
  return out;
}

async function trkReadEntries(userId, ids, priority = 'high') {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const data = await request(SYNC_ENTRIES_QUERY, { userId, ids: part, page: 1 }, priority);
    for (const x of (data && data.Page && data.Page.mediaList) || []) if (x && x.mediaId) out.set(x.mediaId, alEntry(x));
  }
  return out;
}

// Every title of a kind, without the rest: what was removed, and anything a check missed.
const SYNC_INDEX_QUERY = `query TsugiSyncIndex($userId: Int, $type: MediaType, $chunk: Int) {
  MediaListCollection(userId: $userId, type: $type, forceSingleCompletedList: true, chunk: $chunk, perChunk: 500) { hasNextChunk lists { entries { id mediaId updatedAt } } }
}`;
// MyAnimeList's numbers as AniList's (a title added on MyAnimeList): one request for 50, and a number AniList
// doesn't know is simply left out (an aliased Media(idMal) for each would fail them all).
const SYNC_MALMAP_QUERY = `query TsugiMalMap($ids: [Int], $type: MediaType) {
  Page(perPage: 50) { media(idMal_in: $ids, type: $type) { id idMal } }
}`;
// Names and covers of titles no longer on your list (a removal to confirm).
const SYNC_MEDIA_QUERY = `query TsugiSyncMedia($ids: [Int]) {
  Page(perPage: 50) { media(id_in: $ids) { id type title { userPreferred } coverImage { medium color } } }
}`;

async function alIndex(userId, kind) {
  const out = new Map();
  for (let chunk = 1; chunk < 40; chunk++) {
    const data = await request(SYNC_INDEX_QUERY, { userId, type: kind, chunk }, 'low');
    const c = data && data.MediaListCollection;
    for (const l of (c && c.lists) || []) for (const x of l.entries || []) if (x && x.mediaId && !out.has(x.mediaId)) out.set(x.mediaId, { eid: x.id, u: x.updatedAt || 0 });
    if (!c || !c.hasNextChunk) break;
  }
  return out;
}

async function alMalMap(kind, malIds) {
  const out = new Map();
  for (let i = 0; i < malIds.length; i += 50) {
    const data = await request(SYNC_MALMAP_QUERY, { ids: malIds.slice(i, i + 50), type: kind }, 'low');
    for (const m of (data && data.Page && data.Page.media) || []) if (m && m.id && m.idMal) out.set(m.idMal, m.id);
  }
  return out;
}

async function alMediaInfo(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await request(SYNC_MEDIA_QUERY, { ids: ids.slice(i, i + 50) }, 'low');
    for (const m of (data && data.Page && data.Page.media) || []) {
      if (m && m.id) out.set(m.id, { type: m.type === 'MANGA' ? 'MANGA' : 'ANIME', title: (m.title && m.title.userPreferred) || `Title ${m.id}`, cover: (m.coverImage && m.coverImage.medium) || null, color: (m.coverImage && m.coverImage.color) || null });
    }
  }
  return out;
}

// Everything Tsugi can put back of an AniList entry it's about to remove (checked on the real API on 2026-11-13:
// notes, priority, hiddenFromStatusLists, customLists(asArray: true) as [{ name, enabled }]).
const SYNC_SNAP_QUERY = `query TsugiSyncSnap($userId: Int, $ids: [Int]) {
  Page(perPage: 50) { mediaList(userId: $userId, mediaId_in: $ids) { ${SYNC_ENTRY} notes priority hiddenFromStatusLists customLists(asArray: true) } }
}`;
async function alSnapshot(userId, mid) {
  const data = await request(SYNC_SNAP_QUERY, { userId, ids: [mid] }, 'high');
  const x = ((data && data.Page && data.Page.mediaList) || []).find((m) => m && m.mediaId === mid);
  if (!x) return null;
  const e = alEntry(x);
  const lists = Array.isArray(x.customLists) ? x.customLists.filter((c) => c && c.enabled && c.name).map((c) => String(c.name)) : [];
  return { e, was: { ...alRaw(e), nt: x.notes || '', pr: num(x.priority), hd: !!x.hiddenFromStatusLists, cl: lists } };
}

// A change for AniList, in its own values (alRaw's names and scale). Goes through the request queue like any
// save, so the other trackers follow it (trkSaw). create: the title isn't on your list (it's added).
async function alSave(mediaId, raw) {
  const keys = Object.keys(raw).filter((k) => AL_ARGS[k]);
  const decl = keys.map((k) => `$${AL_ARGS[k][0]}: ${AL_ARGS[k][1]}`).join(', ');
  const args = keys.map((k) => `${AL_ARGS[k][0]}: $${AL_ARGS[k][0]}`).join(', ');
  const vars = { mediaId };
  for (const k of keys) vars[AL_ARGS[k][0]] = AL_ARGS[k][2](raw[k]);
  const data = await request(`mutation TsugiSyncSave($mediaId: Int${decl ? `, ${decl}` : ''}) { SaveMediaListEntry(mediaId: $mediaId${args ? `, ${args}` : ''}) { ${SYNC_ENTRY} } }`, vars, 'high');
  const x = data && data.SaveMediaListEntry;
  if (!x || !x.mediaId) throw trkFail('AniList didn\'t save it.', 0, { retry: true });
  return alEntry(x);
}
async function alDelete(entryId) {
  const data = await request('mutation TsugiSyncDelete($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }', { id: entryId }, 'high');
  return !!(data && data.DeleteMediaListEntry && data.DeleteMediaListEntry.deleted);
}

// AniList's own editor reports its entry's number; Tsugi's saves mostly the title's.
async function trkMediaOfEntries(entryIds) {
  if (!entryIds.length) return [];
  const parts = entryIds.slice(0, 50).map((id, i) => `e${i}: MediaList(id: ${Number(id)}) { mediaId }`);
  // No answer: the flush fails and the titles stay noticed (tried again in a minute).
  const data = await request(`query TsugiSyncIds { ${parts.join(' ')} }`, {}, 'high');
  return Object.values(data || {}).filter((x) => x && x.mediaId).map((x) => x.mediaId);
}

/* Noticing titles: saves in this browser ------------------------------------------------------------------ */

const trkTouched = { media: new Set(), entries: new Set() };
let trkTouchTimer = null;

// Called by the request queue (background.js run) with every answer AniList gave. Only list saves that can
// change what the trackers have (not a priority, a note or custom lists) count, and removals (0.10: a title
// removed from AniList then waits for you on the trackers that have it).
const TRK_ARGS = /\b(status|progress|progressVolumes|score|scoreRaw|repeat|private|startedAt|completedAt)\s*:/;
function trkSaw(query, data, variables) {
  if (trkActive === false) return;
  const q = String(query || '');
  if (!/^\s*mutation\b/.test(q)) return;
  if (/DeleteMediaListEntry/.test(q)) {
    const ids = [];
    for (const m of q.matchAll(/DeleteMediaListEntry\s*\(\s*id\s*:\s*(\$\w+|\d+)/g)) {
      const v = m[1][0] === '$' ? (variables || {})[m[1].slice(1)] : m[1];
      if (Number.isInteger(Number(v)) && Number(v) > 0) ids.push(Number(v));
    }
    if (ids.length) trkSawDelete(ids).catch(() => {});
  }
  if (!/SaveMediaListEntry|UpdateMediaListEntries/.test(q) || !TRK_ARGS.test(q)) return;
  const media = [];
  const entries = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (Number.isInteger(v.mediaId)) media.push(v.mediaId);
    else if (Number.isInteger(v.id)) entries.push(v.id);
  };
  for (const v of Object.values(data || {})) walk(v);
  trkTouch(media, entries);
}

// A removed entry is only known by its number: the titles synced under it are read back (gone: removed).
async function trkSawDelete(eids) {
  const want = new Set(eids);
  const media = [];
  for (const t of TRK_IDS) {
    const base = await trkBase(t);
    for (const [mid, b] of Object.entries(base)) if (b && want.has(b.eid)) media.push(Number(mid));
  }
  if (media.length) trkTouch(media, []);
}

// Titles saved but not read back yet are also kept on disk ("trk:touched"): the browser may stop this worker
// before the moment passes, or AniList may not answer; they're read at the next start or the next save.
function trkTouch(media, entries, delay = TRK_TOUCH_MS) {
  for (const id of media || []) if (Number.isInteger(Number(id)) && Number(id) > 0) trkTouched.media.add(Number(id));
  for (const id of entries || []) if (Number.isInteger(Number(id)) && Number(id) > 0) trkTouched.entries.add(Number(id));
  if (!trkTouched.media.size && !trkTouched.entries.size) return;
  if (trkActive !== false) chrome.storage.local.set({ 'trk:touched': { media: [...trkTouched.media], entries: [...trkTouched.entries] } }).catch(() => {});
  clearTimeout(trkTouchTimer);
  trkTouchTimer = setTimeout(() => {
    trkFlushTouch().catch((err) => {
      console.warn('Tsugi: trackers couldn\'t read the saved titles back from AniList. Trying again in a minute.', err);
      trkTouchTimer = null;
      trkAlarmAt(Date.now() + 60e3);
    });
  }, delay);
}

async function trkFlushTouch() {
  const media = [...trkTouched.media];
  const entries = [...trkTouched.entries];
  if (!(await trkSyncActive())) {
    trkTouched.media.clear();
    trkTouched.entries.clear();
    await chrome.storage.local.remove('trk:touched');
    return;
  }
  const auth = await getAuth();
  if (!auth || !auth.viewer) return;   // kept until you're connected to AniList again
  const ids = [...new Set(media.concat(await trkMediaOfEntries(entries)))];
  const found = ids.length ? await trkReadEntries(auth.viewer.id, ids) : new Map();
  // Read: these are done (newer saves made meanwhile stay in the sets).
  for (const id of media) trkTouched.media.delete(id);
  for (const id of entries) trkTouched.entries.delete(id);
  if (trkTouched.media.size || trkTouched.entries.size) chrome.storage.local.set({ 'trk:touched': { media: [...trkTouched.media], entries: [...trkTouched.entries] } }).catch(() => {});
  else chrome.storage.local.remove('trk:touched').catch(() => {});
  const now = Date.now();
  let added = 0;
  for (const t of TRK_IDS) {
    const a = await trkAccount(t);
    if (!a) continue;
    const base = await trkBase(t);
    const gone = await trkGone(t);
    for (const id of ids) {
      const e = found.get(id) || null;
      const b = base[id];
      if (e) {
        if (!TRACKERS[t].kinds.includes(e.type) || !kindOn(a, e.type)) continue;
        // Nothing the trackers have moved (Tsugi's own write from this tracker, read back): nothing to do.
        if (b && sameRaw(alRaw(e), b) && !gone[id]) continue;
        await trkEnqueue(t, id, { kind: e.type, e, eAt: now });
      } else {
        // Not on AniList any more (removed here, or by AniList's own editor): the tracker that has it asks you.
        if (!b || !b.ty || !kindOn(a, b.ty)) continue;
        await trkEnqueue(t, id, { kind: b.ty, e: null, eAt: now, tid: b.tid });
      }
      added++;
    }
  }
  if (!added) return;
  await trkSaveQueue();
  for (const t of TRK_IDS) trkPump(t);
}

/* The queue: one title at a time per tracker ------------------------------------------------------------------- */

// q[t][mediaId] = { at, tries, next, kind, e / eAt (AniList's entry and when it was read; null: not on AniList),
// it / itAt (the tracker's, the same), tid }. What's not known when it's sent is read then.
async function trkEnqueue(t, mid, patch) {
  const q = await trkQueue();
  if (!q[t]) q[t] = {};
  const cur = q[t][mid];
  // A tracker resting after an error: what's added waits with the rest.
  const rest = Math.max(0, ...Object.values(q[t]).map((x) => x.next || 0));
  q[t][mid] = { ...(cur || {}), ...patch, at: Date.now(), tries: cur ? cur.tries || 0 : 0, next: cur ? cur.next || 0 : rest > Date.now() ? rest : 0 };
}

// A tracker that doesn't answer is tried again later (1, 5, 15, 60 minutes); a change it refused is written in
// Settings and dropped (the title's next change tries again).
const trkPumping = {};
async function trkPump(t) {
  if (trkPumping[t]) return;
  trkPumping[t] = true;
  try {
    for (;;) {
      // Apply writes the sync state: the queue goes on once it's done (trkApply).
      if (trkCmpRunning[t] && trkCmp[t] && ['applying', 'undoing'].includes(trkCmp[t].phase)) break;
      const q = await trkQueue();
      const items = Object.entries(q[t] || {}).sort((x, y) => x[1].at - y[1].at);
      if (!items.length) break;
      const ready = items.find(([, it]) => !it.next || it.next <= Date.now());
      if (!ready) { trkAlarmAt(Math.min(...items.map(([, it]) => it.next))); break; }
      const [mid, item] = ready;
      try {
        await trkLock(t, () => trkSyncTitle(t, Number(mid), item));
        const st = await trkStatus(t);
        // An error about this title, or a tracker that didn't answer, is over.
        if (st.err && (st.err.retry || st.err.id === Number(mid))) await trkSetStatus(t, { err: null });
      } catch (err) {
        const again = !!(err.retry || err.login);
        const b = (await trkBase(t))[mid];
        const title = (item.e && item.e.title) || (item.it && item.it.title) || (b && b.n) || null;
        await trkSetStatus(t, { err: { msg: err.message, at: Date.now(), login: !!err.login, retry: again, title, id: Number(mid), al: !!err.al } });
        if (again) {
          // The tracker (or AniList) didn't answer, or wants a new login: every title waits, not one after the other.
          item.tries = (item.tries || 0) + 1;
          const next = Date.now() + (err.login ? 60 * 60e3 : TRK_BACKOFF[Math.min(item.tries - 1, TRK_BACKOFF.length - 1)]);
          for (const other of Object.values(q[t] || {})) if (!other.next || other.next < next) other.next = next;
          await trkSaveQueue();
          trkAlarmAt(next);
          break;
        }
        console.warn(`Tsugi: ${trkName(t)} refused a change`, err);
      }
      const cur = (q[t] || {})[mid];
      if (cur && cur.at === item.at) delete q[t][mid];
      await trkSaveQueue();
    }
  } finally {
    trkPumping[t] = false;
    trkFlushWrites();
  }
}

function trkAlarmAt(when) {
  chrome.alarms.create('trk', { when: Math.max(Date.now() + 30e3, when) }).catch(() => {});
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'trk') trkResume().catch(() => {}); });

// AniList's answers as the trackers' errors: a refusal (400, 404) is dropped and shown, anything else waits.
async function alCall(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.retry !== undefined) throw err;
    const st = (err && err.status) || 0;
    const refused = st >= 400 && st < 500 && st !== 401 && st !== 429;
    throw trkFail(`AniList: ${(err && err.message) || 'no answer'}`, st, { retry: !refused, al: true });
  }
}

// After a write: the tracker's record, with what was written as the tracker kept it (MyAnimeList answers with the
// title's list status; MangaBaka only says it's done). Fields not written stay as they were read.
function afterWrite(t, kind, before, f, res) {
  const out = { ...EMPTY_REC, ...(before || {}) };
  const got = t === 'mal' && res && typeof res === 'object' && typeof res.status === 'string' ? malRec(kind, res) : null;
  for (const k of REC_KEYS[t][kind]) if (f[k] !== undefined) out[k] = got ? got[k] : t === 'mb' ? mbRec(mbBody({ [k]: f[k] }))[k] : f[k];
  if (t === 'mb' && f.s) out.s0 = mbBody({ s: f.s, s0: f.s0 }).state;
  return out;
}

async function trkUnmatched(t, e) {
  const st = await trkStatus(t);
  const um = { ...(st.um || {}) };
  if (um[e.mediaId]) return;
  um[e.mediaId] = { kind: e.type, title: e.title };
  await trkSetStatus(t, { um });
}
async function trkMatched(t, mid) {
  const st = await trkStatus(t);
  if (!st.um || !st.um[mid]) return;
  const um = { ...st.um };
  delete um[mid];
  await trkSetStatus(t, { um });
}

/* One title, both ways (0.10) ---------------------------------------------------------------------------------- */

// item: what the queue knows (see trkEnqueue). Both sides are read now unless they were a moment ago, then
// trkDecide says what travels; both sides' new values become the last sync, and each write goes in the sync log.
// Returns what happened (for the tests): sent, back, both, same, added, waiting, gone, only, off, held, left,
// private, unmatched.
async function trkSyncTitle(t, mid, item) {
  const a = await trkAccount(t);
  const base = await trkBase(t);
  let b = base[mid] || null;
  const kind = item.kind || (item.e && item.e.type) || (b && b.ty) || (t === 'mb' ? 'MANGA' : null);
  if (!a || !kind || !TRACKERS[t].kinds.includes(kind) || !kindOn(a, kind)) return 'off';
  if ((await trkHold(t))[mid]) return 'held';
  const links = (await trkLinks())[t];
  if (links[mid] === 0) return 'left';
  const auth = await getAuth();
  if (!auth || !auth.viewer) throw trkFail('AniList: connect your account again, Tsugi can\'t read your list.', 401, { retry: true, al: true });
  const fresh = (at) => !!at && Date.now() - at < TRK_FRESH_MS;

  // AniList's side, as it is now.
  let e = item.e;
  if (e === undefined || !fresh(item.eAt || item.at)) e = (await alCall(() => trkReadEntries(auth.viewer.id, [mid]))).get(mid) || null;
  if (e && t === 'mal' && e.private) return 'private';
  // The tracker's number: yours if you linked it, else the one it was synced under, else found now.
  let tid = links[mid] || (b && b.tid) || null;
  if (!tid && e) tid = await trkMatch(t, e);
  if (!tid) tid = item.tid || null;
  if (!tid) { if (e) await trkUnmatched(t, e); return 'unmatched'; }
  if (e) await trkMatched(t, mid);
  if (b && b.tid && b.tid !== tid) b = null;     // linked again by hand: as new
  const known = b && b.tr !== null ? b : null;    // null: it was never on the tracker (left out when you compared)
  // The tracker's side, as it is now.
  let it = item.it;
  if (it === undefined || !fresh(item.itAt)) it = await trkReadOne(t, kind, tid);

  // A removal waiting for you: nothing travels until you decide. It ends by itself when the title is back.
  const gone = await trkGone(t);
  if (gone[mid]) {
    const g = gone[mid];
    if ((g.side === 'al' && e) || (g.side === 'tr' && it) || (!e && !it)) { delete gone[mid]; await trkSaveGone(t); }
    else return 'waiting';
  }
  const steps = a.user && a.user.steps;
  const rules = rulesOf(a);
  const look = e ? { title: e.title, cover: e.cover, color: e.color } : { title: (b && b.n) || (it && it.title) || null, cover: (b && b.img) || (it && it.cover) || null, color: null };
  const keep = (tr, raw, ent) => {
    base[mid] = { ...raw, tid, eid: ent ? ent.id : b && b.eid, u: ent ? ent.updatedAt : b && b.u, ty: kind, n: look.title || (b && b.n) || null, img: look.cover || (b && b.img) || null, tr };
    return trkSaveBase(t);
  };
  const sent = (title) => trkSetStatus(t, { last: { at: Date.now(), title, id: mid } });
  const only = await trkOnly(t);

  if (!e && !it) {
    if (base[mid]) { delete base[mid]; await trkSaveBase(t); }
    return 'gone';
  }
  if (!e || !it) {
    if (known) {
      // Synced before, now on one side only: removed on the other. What follows is your rule (Settings, Trackers).
      if (!look.title) {
        const info = await alCall(() => alMediaInfo([mid])).catch(() => new Map());
        const x = info.get(mid);
        if (x) { look.title = x.title; look.cover = x.cover; look.color = x.color; }
      }
      const side = e ? 'tr' : 'al';   // where it was removed
      const travels = side === 'tr' ? comesIn(rules) : goesOut(rules);
      if (!travels || rules.removes === 'off') {
        // It stays where it still is, and stops syncing: kept off the tracker, or only on it.
        if (side === 'tr') { (await trkHold(t))[mid] = 1; await trkSaveHold(t); }
        else { only[kind][tid] = 1; trkSaveOnly(t); }
        delete base[mid];
        await trkSaveBase(t);
        return 'kept';
      }
      // Changed on the other side since the last sync (a +1 on AniList after it was removed on MyAnimeList): both
      // sides moved, and a removal can't simply be the newer one. It waits, like a check that found too many.
      const changed = side === 'tr' ? !sameRaw(alRaw(e), known) : !!(known.tr && !sameRec(t, kind, it.rec, known.tr));
      if (rules.removes === 'ask' || item.ask || changed) {
        const why = item.ask ? { brake: true } : changed && rules.removes !== 'ask' ? { changed: true } : {};
        gone[mid] = { side, kind, tid, title: look.title || `Title ${mid}`, cover: look.cover, color: look.color, at: Date.now(), ...why };
        await trkSaveGone(t);
        return 'waiting';
      }
      // Removed on the other side too, with Undo in the Sync log. A removal from AniList reaches the other trackers
      // like any (trkSaw); this one's last sync goes first, so it isn't asked again.
      delete base[mid];
      await trkSaveBase(t);
      await trkRemoveOther(t, kind, mid, tid, side, { e, it, look, auth });
      await sent(look.title);
      return 'removed';
    }
    if (e) {
      // New on AniList (added anywhere: here, the phone app, MAL-Sync): added there with what it has.
      if (!goesOut(rules) || !rules.adds) return 'not-added';
      const raw = alRaw(e);
      const f = fullFields(t, kind, recFrom(t, kind, raw, steps), rules);
      const res = await trkWrite(t, kind, tid, f, { create: true, full: f });
      const tr = afterWrite(t, kind, EMPTY_REC, f, res);
      await trkLogAdd({ t, kind, mid, tid, ...look, side: 'tr', op: 'add', ch: REC_KEYS[t][kind].filter((k) => f[k] !== undefined).map((k) => ({ k, a: null, b: tr[k] })) });
      if (only[kind][tid]) { delete only[kind][tid]; trkSaveOnly(t); }
      await keep(tr, raw, e);
      await sent(e.title);
      return 'sent';
    }
    // New on the tracker: added to AniList, unless it was there before syncing started (Compare's "Only on")
    // or you kept it there.
    if (only[kind][tid] || !it.at || it.at <= newSince(a, kind)) return 'only';
    if (!comesIn(rules) || !rules.adds) return 'not-added';
    const f = fullFields(t, kind, it.rec, rules);
    const raw0 = alFromTr(t, f);
    // "Keep new ones private" (0.12.3, privacy.js): an NSFW title added there comes to AniList private.
    const hide = typeof nsfwKeepForTracker === 'function' ? await nsfwKeepForTracker(mid, kind) : null;
    if (hide) raw0.pv = true;
    const ent = await alCall(() => alSave(mid, raw0));
    if (hide && ent.private) await nsfwNoteMade([{ id: mid, k: kind }]);
    const raw = alRaw(ent);
    look.title = ent.title; look.cover = ent.cover; look.color = ent.color;
    await trkLogAdd({ t, kind, mid, tid, ...look, side: 'al', op: 'add', eid: ent.id, ch: Object.keys(raw0).filter((k) => AL_ARGS[k]).map((k) => ({ k, a: null, b: raw[k] })) });
    await keep({ ...it.rec }, raw, ent);
    await sent(ent.title);
    return 'added';
  }

  // On both sides. One MangaBaka series for several AniList titles (it merges editions): the one saved last
  // leads; the others send their changes but never take the series' (another edition's chapters).
  const raw = alRaw(e);
  const others = Object.entries(base).filter(([m, x]) => Number(m) !== mid && x && x.tid === tid && (x.ty || kind) === kind && x.tr !== null);
  const leads = !others.length || (e.updatedAt || 0) >= Math.max(...others.map(([, x]) => x.u || 0));
  const view = leads ? it : { ...it, at: 0 };
  const d = trkDecide(t, kind, raw, view, leads || !known ? known : { ...known, tr: it.rec }, steps, (e.updatedAt || 0) * 1000, rules);
  const toTr = Object.keys(d.toTr);
  const toAl = Object.keys(d.toAl);
  let tr = { ...it.rec };
  if (only[kind][tid]) { delete only[kind][tid]; trkSaveOnly(t); }
  if (toTr.length) {
    const f = { ...d.toTr };
    if (f.s && it.rec.s0) f.s0 = it.rec.s0;
    const res = await trkWrite(t, kind, tid, f, { full: fullFields(t, kind, recFrom(t, kind, raw, steps), rules) });
    const was = tr;
    tr = afterWrite(t, kind, was, f, res);
    await trkLogAdd({ t, kind, mid, tid, ...look, side: 'tr', op: 'set', ch: toTr.map((k) => ({ k, a: was[k] ?? null, b: tr[k] })), both: d.both.filter((k) => toTr.includes(k)), s0: it.rec.s0 || null });
    // Kept now: if AniList's write below fails, the tracker's changes are still seen as changes next time.
    const a0 = recFrom(t, kind, raw, steps);
    const pending = Object.fromEntries(toAl.map((k) => [k, known && known.tr ? known.tr[k] : a0[k]]));
    await keep({ ...tr, ...pending }, raw, e);
  }
  let ent = e;
  let alNow = raw;
  if (toAl.length) {
    const rawF = alFromTr(t, d.toAl);
    ent = await alCall(() => alSave(mid, rawF));
    const after = alRaw(ent);
    alNow = { ...raw };
    for (const k of Object.keys(rawF)) alNow[k] = after[k];
    await trkLogAdd({ t, kind, mid, tid, ...look, side: 'al', op: 'set', ch: Object.keys(rawF).map((k) => ({ k, a: raw[k], b: alNow[k] })), both: d.both.filter((k) => toAl.includes(k)) });
  }
  // AniList's entry number and save time as read (an AniList write moves the time: its own echo isn't news).
  await keep(tr, alNow, ent);
  if (toTr.length || toAl.length) await sent(e.title);
  return d.both.length ? 'both' : toTr.length && toAl.length ? 'both' : toTr.length ? 'sent' : toAl.length ? 'back' : 'same';
}

// A title removed on one side, removed on the other (your rule, or your Remove in the Sync log). side: where it was
// removed. What it had is kept in the log, for Undo: on AniList everything Tsugi can put back (notes, priority,
// custom lists; AniList keeps your activity history itself).
async function trkRemoveOther(t, kind, mid, tid, side, { e = null, it = null, look = {}, auth = null } = {}) {
  if (side === 'tr') {
    const au = auth || (await getAuth());
    const snap = au && au.viewer ? await alCall(() => alSnapshot(au.viewer.id, mid)) : null;
    if (!snap) return false;   // already gone from AniList
    await alCall(() => alDelete(snap.e.id));
    await trkLogAdd({ t, kind, mid, tid, title: snap.e.title, cover: snap.e.cover, color: snap.e.color, side: 'al', op: 'remove', ch: [], was: snap.was });
    return true;
  }
  const now = it === null ? await trkReadOne(t, kind, tid) : it;
  if (!now) return false;      // already gone from the tracker
  await trkDelete(t, kind, tid);
  await trkLogAdd({ t, kind, mid, tid, title: look.title || (e && e.title) || `Title ${mid}`, cover: look.cover || null, color: look.color || null, side: 'tr', op: 'remove', ch: [], was: now.rec });
  return true;
}

// 0.12.3: a title made private on AniList leaves MyAnimeList, which has no private titles (Settings, NSFW titles, when
// you tick it; privacy.js). Its last sync goes first, so the sync takes it as never there (made public again, it's
// added there like any new title). The Sync log keeps what it had (why: 'private'). Returns the log row's id, or
// null when it wasn't there.
async function trkPrivateRemove(mid, look = {}) {
  const t = 'mal';
  if (!(await trkAccount(t))) return null;
  return trkLock(t, async () => {
    const base = await trkBase(t);
    const b = base[mid];
    if (!b || !b.tid || b.tr === null) return null;
    const kind = b.ty === 'MANGA' ? 'MANGA' : 'ANIME';
    const it = await trkReadOne(t, kind, b.tid);
    if (it) await trkDelete(t, kind, b.tid);
    delete base[mid];
    await trkSaveBase(t);
    const q = await trkQueue();
    if (q[t] && q[t][mid]) { delete q[t][mid]; await trkSaveQueue(); }
    if (!it) return null;
    return trkLogAdd({ t, kind, mid, tid: b.tid, title: look.title || b.n || it.title || `Title ${mid}`, cover: look.cover || b.img || it.cover || null, color: look.color || null, side: 'tr', op: 'remove', ch: [], was: it.rec, why: 'private' });
  });
}

// Undo of trkPrivateRemove, once the title is public on AniList again: back on the tracker with AniList's values as
// they are now (you may have changed it while it was private), synced from there. Not under the lock: the callers
// hold it. False when it can't (still private, gone from AniList).
async function trkPutBackNow(t, mid, en) {
  const a = await trkAccount(t);
  const base = await trkBase(t);
  const done = () => { if (en && !en.undone) { en.undone = Date.now(); trkSaveLog(); } };
  if (!a) return false;
  if (base[mid] && base[mid].tr) { done(); return true; }   // the sync put it back already (a new title on AniList)
  const auth = await getAuth();
  if (!auth || !auth.viewer) return false;
  const e = (await alCall(() => trkReadEntries(auth.viewer.id, [mid]))).get(mid) || null;
  if (!e || e.private) return false;
  const kind = e.type;
  const tid = (en && en.tid) || (await trkMatch(t, e));
  if (!tid) return false;
  const raw = alRaw(e);
  const f = fullFields(t, kind, recFrom(t, kind, raw, a.user && a.user.steps), rulesOf(a));
  const res = await trkWrite(t, kind, tid, f, { create: true, full: f });
  base[mid] = { ...raw, tid, eid: e.id, u: e.updatedAt, ty: kind, n: e.title, img: e.cover, tr: afterWrite(t, kind, EMPTY_REC, f, res) };
  await trkSaveBase(t);
  const only = await trkOnly(t);
  if (only[kind][tid]) { delete only[kind][tid]; trkSaveOnly(t); }
  const hold = await trkHold(t);
  if (hold[mid]) { delete hold[mid]; await trkSaveHold(t); }
  done();
  return true;
}
async function trkPutBack(t, mid, logId) {
  return trkLock(t, async () => {
    const en = logId ? (await trkLogGet()).find((x) => x.id === logId) : null;
    try { return await trkPutBackNow(t, mid, en); } catch (err) { console.warn(`Tsugi: couldn't put ${mid} back on ${trkName(t)}`, err); return false; }
  });
}

/* Matching: AniList's title -> the tracker's ---------------------------------------------------------- */

// MyAnimeList: AniList's own idMal, unless you linked it by hand. 0 means "not on this tracker" (left off).
async function trkMatch(t, e) {
  const links = await trkLinks();
  const l = links[t][e.mediaId];
  if (l === 0) return null;
  if (l) return l;
  if (t === 'mal') return e.idMal || null;
  return trkMbLookup(e.mediaId);
}

// MangaBaka finds a series by AniList's number (answers cached on its side for a week, so they're cheap).
// A merged series points to the one it became.
async function trkMbLookup(mediaId, { cachedOnly = false } = {}) {
  const map = await trkMbMap();
  const c = map[mediaId];
  if (c && (c[0] || Date.now() - c[1] < TRK_MBMAP_NONE_MS)) return c[0] || null;
  if (cachedOnly) return undefined;
  const j = await trkCall('mb', `/v1/source/anilist/${mediaId}`, { auth: false });
  const list = (j && j.data && Array.isArray(j.data.series) ? j.data.series : []).filter(Boolean);
  const s = list.find((x) => x.state === 'active') || list.find((x) => x.state === 'merged' && x.merged_with) || null;
  const id = s ? Number(s.state === 'merged' ? s.merged_with : s.id) || 0 : 0;
  map[mediaId] = [id, Date.now()];
  await trkSaveMbMap();
  return id || null;
}

/* Writing to a tracker ------------------------------------------------------------------------------------ */

function malForm(kind, f) {
  const out = {};
  const manga = kind === 'MANGA';
  if (f.s) {
    out.status = AL_TO.mal[kind][f.s] || (manga ? 'plan_to_read' : 'plan_to_watch');
    out[manga ? 'is_rereading' : 'is_rewatching'] = f.s === 'REPEATING' ? 'true' : 'false';
  }
  if (f.p !== undefined) out[manga ? 'num_chapters_read' : 'num_watched_episodes'] = String(f.p || 0);
  if (manga && f.v !== undefined) out.num_volumes_read = String(f.v || 0);
  if (f.sc !== undefined) out.score = String(f.sc || 0);
  if (f.r !== undefined) out[manga ? 'num_times_reread' : 'num_times_rewatched'] = String(f.r || 0);
  if (f.sd) out.start_date = f.sd;
  if (f.fd) out.finish_date = f.fd;
  return out;
}

function mbBody(f) {
  const out = {};
  if (f.s) out.state = f.s0 && MB_FROM[f.s0] === f.s ? f.s0 : AL_TO.mb.MANGA[f.s] || 'plan_to_read';
  if (f.p !== undefined) out.progress_chapter = f.p || null;
  if (f.v !== undefined) out.progress_volume = f.v || null;
  if (f.sc !== undefined) out.rating = f.sc || null;
  if (f.r !== undefined) out.number_of_rereads = f.r || null;
  if (f.sd !== undefined) out.start_date = f.sd || null;
  if (f.fd !== undefined) out.finish_date = f.fd || null;
  if (f.pv !== undefined) out.is_private = !!f.pv;
  return out;
}

// fields: a record's fields to set. create: the title isn't there yet. full: everything AniList has, sent
// instead when MangaBaka says the title isn't in your library any more.
async function trkWrite(t, kind, tid, fields, { create = false, full = null } = {}) {
  if (t === 'mal') {
    const path = `/${kind === 'MANGA' ? 'manga' : 'anime'}/${tid}/my_list_status`;
    // MyAnimeList's call adds the title when it isn't on your list, so a new one gets everything at once.
    const res = await trkCall('mal', path, { method: 'PATCH', form: malForm(kind, create && full ? full : fields) });
    if (res === null) throw trkFail(`MyAnimeList has no title number ${tid}.`, 404);
    return res;
  }
  const path = `/v1/my/library/${tid}`;
  if (create) {
    try { return await trkCall('mb', path, { method: 'POST', json: mbBody(full || fields) }); }
    catch (err) { if (err.status !== 409) throw err; }
  }
  const res = await trkCall('mb', path, { method: 'PATCH', json: mbBody(fields) });
  if (res !== null) return res;
  return trkCall('mb', path, { method: 'POST', json: mbBody(full || fields) });
}

async function trkDelete(t, kind, tid) {
  const path = t === 'mal' ? `/${kind === 'MANGA' ? 'manga' : 'anime'}/${tid}/my_list_status` : `/v1/my/library/${tid}`;
  await trkCall(t, path, { method: 'DELETE' });   // already gone (404) counts as done
}

/* The tracker's list ------------------------------------------------------------------------------------- */

const MAL_LIST_FIELDS = {
  ANIME: 'list_status{status,score,num_episodes_watched,is_rewatching,num_times_rewatched,start_date,finish_date,updated_at},num_episodes,media_type,start_season,main_picture',
  MANGA: 'list_status{status,score,num_volumes_read,num_chapters_read,is_rereading,num_times_reread,start_date,finish_date,updated_at},num_chapters,num_volumes,media_type,start_date,main_picture',
};
const MAL_FORMATS = { tv: 'TV', movie: 'MOVIE', ova: 'OVA', ona: 'ONA', special: 'SPECIAL', music: 'MUSIC', tv_special: 'SPECIAL', manga: 'MANGA', novel: 'NOVEL', light_novel: 'NOVEL', one_shot: 'ONE_SHOT', manhwa: 'MANGA', manhua: 'MANGA', doujinshi: 'MANGA' };

// at: when it was last saved there (ms), for "the newer side wins".
function malItem(kind, node, ls) {
  const n = node || {};
  return {
    tid: n.id, rec: malRec(kind, ls), at: (ls && Date.parse(ls.updated_at)) || 0, title: String(n.title || `#${n.id}`),
    cover: (n.main_picture && (n.main_picture.medium || n.main_picture.large)) || null,
    format: MAL_FORMATS[n.media_type] || null,
    year: (n.start_season && n.start_season.year) || (n.start_date ? Number(String(n.start_date).slice(0, 4)) || null : null),
    total: (kind === 'MANGA' ? n.num_chapters : n.num_episodes) || null,
  };
}

function mbTitle(s) {
  if (!s) return '';
  if (Array.isArray(s.titles) && s.titles.length) {
    const t = s.titles.find((x) => x && x.is_primary && x.title) || s.titles.find((x) => x && x.language === 'en' && x.title) || s.titles.find((x) => x && x.title);
    if (t) return String(t.title);
  }
  return String(s.title || s.romanized_title || s.native_title || `#${s.id}`);
}
function mbCover(c) {
  if (!c) return null;
  const pick = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.x1 || v.url || null : null);
  return pick(c.x150) || pick(c.x250) || pick(c.raw) || null;
}
const MB_FORMATS = { manga: 'MANGA', novel: 'NOVEL', manhwa: 'MANGA', manhua: 'MANGA', oel: 'MANGA' };
// A library entry is kept under its own series number, even once MangaBaka merged that series into another (its
// sync guide: "key entries by series_id"); a series from a search goes by the one it became.
function mbItem(row) {
  const s = row.series || {};
  const tid = Number(row.entry && row.entry.series_id) || Number(s.state === 'merged' && s.merged_with ? s.merged_with : s.id) || 0;
  const al = s.source && s.source.anilist && Number(s.source.anilist.id);
  const year = s.published && s.published.start_date ? Number(String(s.published.start_date).slice(0, 4)) || null : Number(s.year) || null;
  return { tid, rec: mbRec(row.entry), at: (row.entry && Date.parse(row.entry.updated_at)) || 0, title: mbTitle(s), cover: mbCover(s.cover), format: MB_FORMATS[s.type] || null, year, total: Number(s.total_chapters) || null, al: al > 0 ? al : null };
}

async function trkReadList(t, kind, progress) {
  const out = new Map();
  if (t === 'mal') {
    const api = TRACKERS.mal.api;
    let url = `${api}/users/@me/${kind === 'MANGA' ? 'manga' : 'anime'}list?fields=${encodeURIComponent(MAL_LIST_FIELDS[kind])}&limit=1000&nsfw=true`;
    for (let i = 0; url && i < 50; i++) {
      const j = await trkCall('mal', null, { url });
      for (const d of (j && j.data) || []) if (d && d.node && d.node.id) out.set(d.node.id, malItem(kind, d.node, d.list_status));
      progress(out.size);
      const next = j && j.paging && j.paging.next;
      url = typeof next === 'string' && next.startsWith(`${api}/`) ? next : null;
    }
    return out;
  }
  for (let page = 1; page < 400; page++) {
    const j = await trkCall('mb', `/v2/my/library?limit=100&page=${page}`);
    for (const row of (j && j.data) || []) {
      const it = row && mbItem(row);
      if (it && it.tid) out.set(it.tid, it);
    }
    progress(out.size);
    if (!j || !j.pagination || !j.pagination.next) break;
  }
  return out;
}

// One title's place on the tracker now: { tid, rec, at, ... }, or null when it's not on your list there. Throws
// when the tracker doesn't answer (the queue tries again later).
const MAL_ONE_FIELDS = {
  ANIME: 'my_list_status{status,score,num_episodes_watched,is_rewatching,num_times_rewatched,start_date,finish_date,updated_at},num_episodes,media_type,start_season,main_picture',
  MANGA: 'my_list_status{status,score,num_volumes_read,num_chapters_read,is_rereading,num_times_reread,start_date,finish_date,updated_at},num_chapters,num_volumes,media_type,start_date,main_picture',
};
async function trkReadOne(t, kind, tid) {
  if (t === 'mal') {
    const j = await trkCall('mal', `/${kind === 'MANGA' ? 'manga' : 'anime'}/${tid}?fields=${encodeURIComponent(MAL_ONE_FIELDS[kind])}`);
    if (!j) throw trkFail(`MyAnimeList has no ${kind === 'MANGA' ? 'manga' : 'anime'} number ${tid}.`, 404);
    return j.my_list_status ? malItem(kind, j, j.my_list_status) : null;
  }
  const j = await trkCall('mb', `/v1/my/library/${tid}`);
  return j && j.data ? { tid, rec: mbRec(j.data), at: Date.parse(j.data.updated_at) || 0, title: null, cover: null } : null;
}

/* Compare -------------------------------------------------------------------------------------------------
   Reads both lists and sorts the titles into groups: add (on AniList, not on the tracker), diff (on both,
   different), unmatched (no number for the tracker), only (on the tracker, not on AniList), private (AniList's
   private titles: MyAnimeList has none, so they stay off it). Kept in session "trk:cmp:<t>" for the popup,
   which can close and open again while this runs. */

const trkCmp = {};
let trkCmpTimer = {};
// beat: when the worker last wrote it. A read that stopped (the browser restarted the worker) stops beating,
// and the page offers to compare again.
function cmpSave(t, now = false) {
  const write = () => {
    trkCmpTimer[t] = null;
    if (trkCmp[t]) trkCmp[t].beat = Date.now();
    return chrome.storage.session.set({ [`trk:cmp:${t}`]: trkCmp[t] }).catch(() => {});
  };
  if (now) { clearTimeout(trkCmpTimer[t]); return write(); }
  if (!trkCmpTimer[t]) trkCmpTimer[t] = setTimeout(write, 300);
  return Promise.resolve();
}
async function cmpGet(t) {
  if (!trkCmp[t]) trkCmp[t] = (await chrome.storage.session.get(`trk:cmp:${t}`))[`trk:cmp:${t}`] || null;
  return trkCmp[t];
}

const display = (e) => ({ title: e.title, cover: e.cover, color: e.color, format: e.format, year: e.year, total: e.total });
// What the last sync keeps about a title besides its values: AniList's entry number and save time, its kind, name
// and cover (the Sync log shows them once the title is gone from one side).
const syncOf = (e, kind) => ({ eid: e.id, u: e.updatedAt, ty: kind, n: e.title, img: e.cover });

async function trkCompare(t, kind) {
  const T = TRACKERS[t];
  if (!T || !T.kinds.includes(kind)) return { ok: false, error: 'Unknown list' };
  const busy = await cmpGet(t);
  if (busy && (busy.phase === 'reading' || busy.phase === 'applying') && Date.now() - busy.at < 10 * 60e3 && trkCmpRunning[t]) return { ok: true, busy: true };
  const c = { kind, phase: 'reading', step: 'anilist', n: 0, of: 0, at: Date.now(), rows: [], same: 0, left: 0, al: {} };
  trkCmp[t] = c;
  await cmpSave(t, true);
  trkCmpRunning[t] = true;
  trkCmpJobs[t] = (async () => {
    try {
      const auth = await getAuth();
      if (!auth || !auth.viewer) throw trkFail('Connect your AniList account first.', 401);
      const acct = await trkAccount(t);
      if (!acct) throw trkFail(`Connect ${T.name} first.`, 401);
      // Your score steps may have changed on MangaBaka since you connected.
      if (t === 'mb') { try { const who = await trkWho('mb'); await trkSetAccount('mb', { user: who }); acct.user = who; } catch { /* the old steps */ } }
      const steps = acct.user && acct.user.steps;
      const rules = rulesOf(acct);
      const list = await trkReadAniList(auth.viewer.id, kind);
      c.step = 'tracker';
      await cmpSave(t, true);
      const items = await trkReadList(t, kind, (n) => { c.n = n; cmpSave(t); });
      const links = (await trkLinks())[t];
      const hold = await trkHold(t);
      // MangaBaka: its library says which AniList title each series is; the rest are looked up.
      const fromLib = new Map();
      if (t === 'mb') for (const it of items.values()) if (it.al && !fromLib.has(it.al)) fromLib.set(it.al, it.tid);
      const tidOf = new Map();
      const lookups = [];
      for (const e of list.values()) {
        const l = links[e.mediaId];
        if (l === 0) { tidOf.set(e.mediaId, 0); continue; }
        if (l) { tidOf.set(e.mediaId, l); continue; }
        if (t === 'mal') { tidOf.set(e.mediaId, e.idMal || null); continue; }
        if (fromLib.has(e.mediaId)) { tidOf.set(e.mediaId, fromLib.get(e.mediaId)); continue; }
        const cached = await trkMbLookup(e.mediaId, { cachedOnly: true });
        if (cached !== undefined) tidOf.set(e.mediaId, cached);
        else lookups.push(e.mediaId);
      }
      if (lookups.length) {
        c.step = 'match';
        c.n = 0;
        c.of = lookups.length;
        await cmpSave(t, true);
        for (const id of lookups) {
          let tid = null;
          try { tid = await trkMbLookup(id); } catch (err) { if (!err.retry) throw err; }
          tidOf.set(id, tid);
          c.n++;
          cmpSave(t);
        }
      }
      // Several AniList titles can be one series on MangaBaka (it merges editions): the one you updated last leads.
      const byTid = new Map();
      const used = new Set();
      for (const e of list.values()) {
        const tid = tidOf.get(e.mediaId);
        if (tid === 0) { c.left++; continue; }
        if (t === 'mal' && e.private) {
          if (tid) used.add(tid);
          c.rows.push({ g: 'private', id: e.mediaId, ...display(e) });
          continue;
        }
        if (!tid) {
          c.rows.push({ g: 'unmatched', id: e.mediaId, raw: alRaw(e), sync: syncOf(e, kind), romaji: e.romaji, ...display(e) });
          continue;
        }
        if (!byTid.has(tid)) byTid.set(tid, []);
        byTid.get(tid).push(e);
      }
      for (const [tid, es] of byTid) {
        es.sort((x, y) => y.updatedAt - x.updatedAt);
        const e = es[0];
        used.add(tid);
        const raw = alRaw(e);
        const a = recFrom(t, kind, raw, steps);
        const also = es.slice(1).map((x) => x.title);
        const it = items.get(tid);
        // The last sync starts from both sides as read here (0.10): Apply changes what it writes.
        c.al[e.mediaId] = { ...raw, ...syncOf(e, kind), tid, tr: it ? it.rec : null };
        if (!it) {
          c.rows.push({ g: 'add', id: e.mediaId, tid, tick: !hold[e.mediaId], fields: fullFields(t, kind, a, rules), also, ...display(e) });
          continue;
        }
        const diffs = compareDiffs(t, kind, a, it.rec, rules);
        if (diffs.length) c.rows.push({ g: 'diff', id: e.mediaId, tid, tick: true, diffs, s0: it.rec.s0 || null, also, ...display(e) });
        else c.same++;
      }
      for (const it of items.values()) {
        if (used.has(it.tid)) continue;
        // recent: added (or changed) there since you connected: it comes to AniList once syncing starts (0.10.2).
        const recent = !!(it.at && it.at > newSince(acct, kind));
        c.rows.push({ g: 'only', id: `x${it.tid}`, tid: it.tid, tick: false, recent, fields: fullFields(t, kind, it.rec), title: it.title, cover: it.cover, color: null, format: it.format, year: it.year, total: it.total });
      }
      // Settings counts the titles without a match (pushes add to it, linking takes away).
      const st = await trkStatus(t);
      const um = Object.fromEntries(Object.entries(st.um || {}).filter(([, v]) => v.kind !== kind));
      for (const r of c.rows) if (r.g === 'unmatched') um[r.id] = { kind, title: r.title };
      await trkSetStatus(t, { um });
      c.phase = 'ready';
      c.at = Date.now();
    } catch (err) {
      c.phase = 'error';
      c.error = err.message || String(err);
      c.login = !!err.login;
    } finally {
      trkCmpRunning[t] = false;
      await cmpSave(t, true);
    }
  })();
  return { ok: true };
}
const trkCmpRunning = {};
const trkCmpJobs = {};   // t -> the reading or the Apply running (an automatic start waits for it)

// Apply: the ticked titles change on the tracker, one at a time, with Undo for all of them. From then on,
// what changes on AniList travels: every title compared starts from what AniList has now.
// auto: the first sync of a kind that started by itself (trkStartKinds), nobody on the Compare page.
async function trkApply(t, kind, ids, { auto = false } = {}) {
  const c = await cmpGet(t);
  if (!c || c.phase !== 'ready' || c.kind !== kind) return { ok: false, error: 'Compare the lists again first.' };
  if (Date.now() - c.at > TRK_STALE_MS) return { ok: false, error: 'These lists were read a while ago. Compare again first.', stale: true };
  const want = new Set((ids || []).map(String));
  const picks = c.rows.filter((r) => ['add', 'diff', 'only'].includes(r.g) && want.has(String(r.id)));
  c.phase = 'applying';
  c.n = 0;
  c.of = picks.length;
  await cmpSave(t, true);
  trkCmpRunning[t] = true;
  trkCmpJobs[t] = (async () => {
    const undo = [];
    const writes = {};   // mediaId -> { f, res }: what was written, for the last sync
    let ok = 0;
    let failed = 0;
    try {
      for (const r of picks) {
        try {
          if (r.g === 'add') {
            writes[r.id] = { f: r.fields, res: await trkWrite(t, kind, r.tid, r.fields, { create: true, full: r.fields }) };
            undo.push({ op: 'delete', tid: r.tid, id: r.id, title: r.title });
          } else if (r.g === 'diff') {
            // Only what differs: an unchanged status isn't sent (MangaBaka's "considering" stays).
            const f = Object.fromEntries(r.diffs.map((d) => [d.k, d.a]));
            const back = Object.fromEntries(r.diffs.map((d) => [d.k, d.t ?? (d.k === 'pv' ? false : d.k === 'sd' || d.k === 'fd' ? '' : 0)]));
            if (back.s && r.s0) back.s0 = r.s0;
            writes[r.id] = { f, res: await trkWrite(t, kind, r.tid, f) };
            undo.push({ op: 'write', tid: r.tid, id: r.id, title: r.title, fields: back });
          } else if (r.g === 'only') {
            await trkDelete(t, kind, r.tid);
            undo.push({ op: 'create', tid: r.tid, id: r.id, title: r.title, fields: r.fields });
          }
          r.done = true;
          ok++;
        } catch (err) {
          r.err = err.message;
          failed++;
          if (err.login) break;
        }
        c.n++;
        cmpSave(t);
      }
      // The last sync of every title compared: AniList's values as read, the tracker's as read and then written.
      const base = await trkBase(t);
      const failedIds = new Set(picks.filter((r) => r.err).map((r) => String(r.id)));
      for (const [mid, x] of Object.entries(c.al)) {
        if (failedIds.has(String(mid)) || !x.tid) continue;
        const w = writes[mid];
        base[mid] = { ...x, tr: w ? afterWrite(t, kind, x.tr || EMPTY_REC, w.f, w.res) : x.tr || null };
      }
      await trkSaveBase(t);
      // What's only on the tracker now stays there: changes to those don't come to AniList (0.10).
      const only = await trkOnly(t);
      only[kind] = {};
      // ... except what was added there since you connected: that comes to AniList (the next check).
      for (const r of c.rows) if (r.g === 'only' && !r.done && !r.recent) only[kind][r.tid] = 1;
      only.built[kind] = Date.now();
      await trkSaveOnly(t);
      // Where the checks start: just before this reading (what changed since then is looked at again, harmlessly).
      // MangaBaka's changes feed starts from the whole library at the next check.
      const from = c.at - 10 * 60e3;
      const cur = await chrome.storage.local.get([`trk:cur:${t}`, 'trk:cur:al']);
      const ct = cur[`trk:cur:${t}`] || {};
      // MyAnimeList's whole list is read again at the first check, for titles added there since you connected.
      ct[kind] = t === 'mal' ? { cur: from, at: Date.now(), full: 0 } : {};
      const ca = cur['trk:cur:al'] || {};
      let others = false;
      for (const o of TRK_IDS) if (o !== t && kindOn(await trkAccount(o), kind)) others = true;
      if (!others || !ca[kind]) ca[kind] = { cur: Math.floor(from / 1000), at: Date.now(), full: Date.now() };
      await chrome.storage.local.set({ [`trk:cur:${t}`]: ct, 'trk:cur:al': ca });
      // Unticked titles missing there stay off the tracker until you add them here.
      const hold = await trkHold(t);
      for (const r of c.rows) {
        if (r.g !== 'add') continue;
        if (r.done) delete hold[r.id];
        else if (!want.has(String(r.id))) hold[r.id] = 1;
      }
      await trkSaveHold(t);
      const a = await trkAccount(t);
      if (a) await trkSetAccount(t, { ready: { ...(a.ready || {}), [kind]: Date.now() } });
      const undoAt = Date.now();
      await chrome.storage.local.set({ [`trk:undo:${t}`]: { at: undoAt, kind, ops: undo } });
      // One line in the Sync log (0.10.2), its Undo is Compare's.
      const n = (g) => picks.filter((r) => r.g === g && r.done).length;
      await trkLogAdd({ t, kind, mid: 0, tid: 0, title: null, cover: null, color: null, side: 'tr', op: 'apply', ch: [], auto, undoAt,
        counts: { add: n('add'), diff: n('diff'), only: n('only'), recent: c.rows.filter((r) => r.g === 'only' && r.recent && !r.done).length } });
      await trkSetStatus(t, ok ? { err: null, last: { at: Date.now(), n: ok } } : {});
      await trkSyncActive();
      c.applied = { ok, failed, at: Date.now() };
      c.phase = 'done';
      // A first check soon (MangaBaka's feed starts there), and what waited during Apply goes now.
      setTimeout(() => trkCheck({ why: 'apply' }), 3000);
    } catch (err) {
      c.phase = 'error';
      c.error = err.message || String(err);
    } finally {
      trkCmpRunning[t] = false;
      await trkFlushWrites();
      await cmpSave(t, true);
      trkPump(t);
    }
  })();
  return { ok: true };
}

// Undo the last Apply: what was added is removed, what was changed is put back, what was removed comes back.
async function trkUndoApply(t) {
  const u = (await chrome.storage.local.get(`trk:undo:${t}`))[`trk:undo:${t}`];
  if (!u || !u.ops || !u.ops.length) return { ok: false, error: 'Nothing to undo.' };
  const c = await cmpGet(t);
  if (c) { c.phase = 'undoing'; c.n = 0; c.of = u.ops.length; await cmpSave(t, true); }
  let failed = 0;
  const hold = await trkHold(t);
  const base = await trkBase(t);
  const only = await trkOnly(t);
  trkCmpRunning[t] = true;   // the queue waits (trkPump)
  // The last sync follows (0.10): the tracker's old values are what it has again, so they aren't taken for
  // changes made there (and brought to AniList).
  for (const op of [...u.ops].reverse()) {
    try {
      if (op.op === 'delete') {
        await trkDelete(t, u.kind, op.tid);
        hold[op.id] = 1;
        if (base[op.id]) base[op.id].tr = null;
      } else if (op.op === 'write') {
        await trkWrite(t, u.kind, op.tid, op.fields);
        const { s0, ...back } = op.fields;
        if (base[op.id] && base[op.id].tr) base[op.id].tr = { ...base[op.id].tr, ...back, ...(s0 ? { s0 } : {}) };
      } else if (op.op === 'create') {
        await trkWrite(t, u.kind, op.tid, op.fields, { create: true, full: op.fields });
        only[u.kind][op.tid] = 1;
      }
    } catch {
      failed++;
    }
    if (c) { c.n++; cmpSave(t); }
  }
  trkCmpRunning[t] = false;
  await trkSaveHold(t);
  await trkSaveBase(t);
  await trkSaveOnly(t);
  trkPump(t);
  await chrome.storage.local.remove(`trk:undo:${t}`);
  if (c) {
    c.phase = 'undone';
    c.undone = { n: u.ops.length - failed, failed, at: Date.now() };
    await cmpSave(t, true);
  }
  return failed ? { ok: false, error: `${failed} of ${u.ops.length} couldn't be put back on ${trkName(t)}.` } : { ok: true };
}

/* Linking a title by hand ------------------------------------------------------------------------------------ */

// "https://myanimelist.net/anime/52991/Sousou_no_Frieren", "52991", "https://mangabaka.org/1234/..."
function trkParseId(t, text) {
  const s = String(text || '').trim();
  if (/^\d{1,9}$/.test(s)) return Number(s);
  const m = t === 'mal' ? /myanimelist\.net\/(?:anime|manga)\/(\d{1,9})/.exec(s) : /mangabaka\.[a-z]+\/(?:series\/)?(\d{1,9})/.exec(s);
  return m ? Number(m[1]) : null;
}

async function trkSearch(t, kind, q) {
  const text = String(q || '').trim().slice(0, 64);
  const id = trkParseId(t, text);
  if (text.length < 3 && !id) return { ok: true, results: [] };
  if (t === 'mal') {
    const fields = 'media_type,start_season,start_date,num_episodes,num_chapters,main_picture';
    const path = `/${kind === 'MANGA' ? 'manga' : 'anime'}`;
    if (id) {
      const j = await trkCall('mal', `${path}/${id}?fields=${fields}`);
      return { ok: true, results: j ? [malItem(kind, j, null)] : [] };
    }
    const j = await trkCall('mal', `${path}?q=${encodeURIComponent(text)}&limit=8&nsfw=true&fields=${fields}`);
    return { ok: true, results: ((j && j.data) || []).map((d) => malItem(kind, d.node, null)) };
  }
  if (id) {
    const j = await trkCall('mb', `/v1/series/${id}`, { auth: false });
    const s = j && j.data;
    return { ok: true, results: s ? [mbItem({ series: s })] : [] };
  }
  const j = await trkCall('mb', `/v2/series/search?q=${encodeURIComponent(text)}&limit=8`, { auth: false });
  return { ok: true, results: ((j && j.data) || []).map((s) => mbItem({ series: s })) };
}

// tid: the tracker's number, 0 for "not on this tracker", null to forget the link.
async function trkLink(t, mediaId, tid) {
  const links = await trkLinks();
  const mid = Number(mediaId);
  const c0 = await cmpGet(t);
  // A number that isn't a title there is refused before it's kept (MyAnimeList says so; MangaBaka is
  // picked from its own search).
  let it;
  if (tid && c0) it = await trkReadOne(t, c0.kind, Number(tid));
  if (tid === null) delete links[t][mid];
  else links[t][mid] = Number(tid) || 0;
  await trkSaveLinks();
  const st = await trkStatus(t);
  const um = { ...(st.um || {}) };
  if (tid !== null && um[mid]) { delete um[mid]; await trkSetStatus(t, { um }); }
  // The Compare page follows: the title moves to the group it now belongs to.
  const c = c0;
  const i = c ? c.rows.findIndex((r) => r.id === mid && (r.g === 'unmatched' || r.g === 'add' || r.g === 'diff')) : -1;
  if (c && i !== -1 && c.phase !== 'applying') {
    const row = c.rows[i];
    const raw = row.raw ? { ...row.raw, ...(row.sync || {}) } : c.al[mid] ? { ...c.al[mid] } : null;
    if (!tid) {
      c.rows.splice(i, 1);
      c.left++;
    } else if (raw) {
      const acct = await trkAccount(t);
      const steps = acct && acct.user && acct.user.steps;
      const a = recFrom(t, c.kind, raw, steps);
      const base = { id: mid, tid: Number(tid), title: row.title, cover: row.cover, color: row.color, format: row.format, year: row.year, total: row.total, also: [] };
      c.al[mid] = { ...raw, ...(row.sync || {}), tid: Number(tid), tr: it ? it.rec : null };
      c.rows = c.rows.filter((r) => !(r.g === 'only' && r.tid === Number(tid)));
      const j = c.rows.findIndex((r) => r.id === mid);
      if (!it) c.rows.splice(j, 1, { g: 'add', tick: true, fields: fullFields(t, c.kind, a, rulesOf(acct)), ...base });
      else {
        const diffs = compareDiffs(t, c.kind, a, it.rec, rulesOf(acct));
        if (diffs.length) c.rows.splice(j, 1, { g: 'diff', tick: true, diffs, s0: it.rec.s0 || null, ...base });
        else { c.rows.splice(j, 1); c.same++; }
      }
    }
    await cmpSave(t, true);
  }
  // A title linked after syncing started goes there with its next change; now if it's waiting.
  return { ok: true };
}

/* The checks (0.10): what changed elsewhere ------------------------------------------------------------------------
   Every 5 minutes while the browser runs (the alarm), when the popup opens, and from the Sync log's Check now.
   They only find titles: AniList's saved since the last check (its phone app, MAL-Sync, another computer), the
   trackers' changed since theirs, and every hour every title (removals). What they find goes to the queue, which
   reads both sides once more and syncs each title (trkSyncTitle). "trk:cur:al" and "trk:cur:<t>" keep where each
   check got to: { kind: { cur (AniList: seconds; MyAnimeList: ms; MangaBaka: its feed's cursor), at, full } }. */

let trkChecking = null;
function trkCheck(opts = {}) {
  if (trkChecking) return opts.why === 'manual' ? trkChecking.then(() => trkCheck(opts)) : trkChecking;
  trkChecking = trkCheckRun(opts)
    .catch((err) => { console.warn('Tsugi: trackers couldn\'t check for changes', err); return { ok: false, error: err.message }; })
    .finally(() => { trkChecking = null; });
  return trkChecking;
}
chrome.alarms.onAlarm.addListener((al) => { if (al.name === 'trk:check') trkCheck({ why: 'alarm' }); });

const sameRec = (t, kind, x, y) => REC_KEYS[t][kind].every((k) => x[k] === y[k]);
// The tracker's number -> your AniList title, for one kind (two titles on one MangaBaka series: the one saved last).
function trkRev(t, base, kind) {
  const rev = new Map();
  for (const [m, b] of Object.entries(base)) {
    if (!b || !b.tid || (b.ty || (t === 'mb' ? 'MANGA' : null)) !== kind) continue;
    const cur = rev.get(b.tid);
    if (!cur || (b.u || 0) > (base[cur].u || 0)) rev.set(b.tid, Number(m));
  }
  return rev;
}
// The first full reading of a tracker after syncing started: what's there and not synced stays only there.
async function trkOnlyBuild(t, kind, tids) {
  const only = await trkOnly(t);
  if (only.built[kind]) return;
  const rev = trkRev(t, await trkBase(t), kind);
  for (const tid of tids) if (!rev.has(tid)) only[kind][tid] = 1;
  only.built[kind] = Date.now();
  await trkSaveOnly(t);
}

async function trkCheckRun({ why = 'alarm', full = false } = {}) {
  await trkStartKinds();
  if (!(await trkSyncActive())) return { ok: true, idle: true };
  const auth = await getAuth();
  if (!auth || !auth.viewer) return { ok: false, error: 'Connect your AniList account first.' };
  const uid = auth.viewer.id;
  const now = Date.now();
  const fg = why !== 'alarm';   // the popup opened, Check now, a first check after Apply
  const st = await chrome.storage.local.get(['trk:checked', 'trk:cur:al', ...TRK_IDS.map((t) => `trk:cur:${t}`)]);
  if (why === 'popup' && now - ((st['trk:checked'] || {}).at || 0) < TRK_FG_MS) return { ok: true, recent: true };
  const live = {};
  for (const t of TRK_IDS) {
    const a = await trkAccount(t);
    if (!a || a.needsLogin || trkCmpRunning[t]) continue;
    const kinds = TRACKERS[t].kinds.filter((k) => kindOn(a, k));
    if (kinds.length) live[t] = { a, kinds };
  }
  const ts = Object.keys(live);
  if (!ts.length) return { ok: true, idle: true };
  const errors = {};
  const kinds = [...new Set(ts.flatMap((t) => live[t].kinds))];
  const due = (c, pace) => fg || now - (c.at || 0) >= pace - 30e3;
  const fullDue = (c) => full || now - (c.full || 0) >= (fg ? TRK_FULL_FG_MS : TRK_FULL_MS);
  const cands = {};   // t -> Map(mediaId -> what the queue gets)
  for (const t of ts) cands[t] = new Map();
  const cand = (t, mid, patch) => cands[t].set(mid, { ...(cands[t].get(mid) || {}), ...patch });

  // 1. AniList: titles saved since the last check, anywhere.
  const curAl = st['trk:cur:al'] || {};
  for (const k of kinds) {
    if (curAl[k] && curAl[k].cur) continue;
    const first = Math.min(...ts.filter((t) => live[t].kinds.includes(k)).map((t) => live[t].a.ready[k] || now));
    curAl[k] = { cur: Math.floor(first / 1000) - 600, at: 0, full: 0 };
  }
  const alSeen = new Map();     // mediaId -> AniList's entry, read now
  const alAbsent = new Set();   // mediaIds no longer on your AniList list
  const alDone = [];
  const alKinds = kinds.filter((k) => due(curAl[k], TRK_PACE.al));
  try {
    if (alKinds.length) {
      // Every title's number and save time (a few small requests): what was saved since, and what's gone.
      const indexed = [];
      for (const k of alKinds) indexed.push([k, await alIndex(uid, k)]);
      await trkAniListFull(uid, ts, live, indexed, curAl, alSeen, alAbsent);
      alDone.push(...alKinds);
    }
  } catch (err) {
    errors.al = err.message || String(err);
    alSeen.clear();
    alAbsent.clear();
  }

  // 2. Each tracker: what changed there since the last check.
  const trSeen = {};
  const trAbsent = {};
  const curT = {};
  const empty = () => ({ seen: { ANIME: new Map(), MANGA: new Map() }, absent: { ANIME: new Set(), MANGA: new Set() } });
  for (const t of ts) {
    let box = empty();
    const c = st[`trk:cur:${t}`] || {};
    curT[t] = c;
    try {
      for (const k of live[t].kinds) {
        const ck = c[k] || (c[k] = {});
        if (!due(ck, TRK_PACE[t])) continue;
        if (t === 'mal') await malCheck(k, ck, live[t].a, box.seen[k], box.absent[k], fullDue(ck));
        else await mbCheck(ck, box.seen[k], box.absent[k]);
        ck.atNext = now;
      }
    } catch (err) {
      // Its checks stay where they were: read again next time.
      errors[t] = err.message || String(err);
      curT[t] = null;
      box = empty();
    }
    trSeen[t] = box.seen;
    trAbsent[t] = box.absent;
  }

  // 3. Which of your AniList titles each of the trackers' changes is.
  for (const t of ts) {
    const base = await trkBase(t);
    const only = await trkOnly(t);
    const hold = await trkHold(t);
    let dirty = false;
    try {
      for (const k of live[t].kinds) {
        const rev = trkRev(t, base, k);
        const fresh = [];
        for (const [tid, it] of trSeen[t][k]) {
          const mid = rev.get(tid);
          if (mid) {
            const b = base[mid];
            // A title synced by 0.9: the tracker's values as they are now become its side of the last sync.
            if (b.tr === undefined) { b.tr = it.rec; dirty = true; continue; }
            if (b.tr && sameRec(t, k, it.rec, b.tr)) continue;
            cand(t, mid, { kind: k, it, itAt: now, tid });
          } else if (!only[k][tid] && it.at && it.at > newSince(live[t].a, k)) fresh.push(it);   // maybe added there
        }
        // Removed there: MangaBaka's feed says so; a title missing from MyAnimeList's whole list is read once more.
        for (const tid of trAbsent[t][k]) {
          const mid = rev.get(tid);
          if (mid && base[mid].tr !== null) cand(t, mid, t === 'mb' ? { kind: k, tid, it: null, itAt: now, gone: true } : { kind: k, tid, gone: true });
        }
        if (fresh.length) {
          const ids = t === 'mal' ? await alMalMap(k, fresh.map((x) => x.tid)) : await mbToAniList(fresh.map((x) => x.tid));
          for (const it of fresh) {
            const mid = ids.get(it.tid);
            if (mid && !hold[mid]) cand(t, mid, { kind: k, it, itAt: now, tid: it.tid });
          }
        }
      }
    } catch (err) {
      errors[t] = err.message || String(err);
      curT[t] = null;
    }
    if (dirty) trkSaveBase(t);
  }

  // 4. AniList's titles that moved, for each tracker that follows them; then AniList's side of the trackers' changes.
  for (const t of ts) {
    const base = await trkBase(t);
    const gone = await trkGone(t);
    const hold = await trkHold(t);
    const links = (await trkLinks())[t];
    for (const [mid, e] of alSeen) {
      if (!live[t].kinds.includes(e.type)) continue;
      const b = base[mid];
      if (b && sameRaw(alRaw(e), b) && !gone[mid]) continue;
      if (!b && (hold[mid] || links[mid] === 0 || (t === 'mal' && e.private))) continue;
      cand(t, mid, { kind: e.type, e, eAt: now });
    }
    for (const mid of alAbsent) {
      const b = base[mid];
      if (b && b.ty && live[t].kinds.includes(b.ty) && b.tr !== null) cand(t, mid, { kind: b.ty, e: null, eAt: now, tid: b.tid });
    }
  }
  // The brake: more titles found removed at once than anyone removes by hand usually means a list that didn't load
  // in full, or another account. Those wait for you, whatever your rule.
  for (const t of ts) {
    const removed = [...cands[t].values()].filter((p) => p.e === null || p.gone);
    if (removed.length > TRK_BRAKE) for (const p of removed) p.ask = true;
  }
  const need = new Set();
  for (const t of ts) for (const [mid, p] of cands[t]) if (p.e === undefined) need.add(mid);
  if (need.size) {
    try {
      const got = await trkReadEntries(uid, [...need], 'low');
      for (const t of ts) for (const [mid, p] of cands[t]) if (p.e === undefined) { p.e = got.get(mid) || null; p.eAt = now; }
    } catch { /* read when each is sent */ }
  }

  // 5. Queued (kept on disk), then each check moves on.
  let n = 0;
  for (const t of ts) for (const [mid, p] of cands[t]) { await trkEnqueue(t, mid, p); n++; }
  if (n) await trkSaveQueue();
  for (const k of alDone) {
    const c = curAl[k];
    if (c.next) { c.ids = c.next > c.cur ? c.nextIds : [...new Set([...(c.ids || []), ...c.nextIds])]; c.cur = Math.max(c.cur, c.next); }
    c.at = now;
    if (c.fullNext) c.full = c.fullNext;
  }
  for (const c of Object.values(curAl)) if (c) { delete c.next; delete c.nextIds; delete c.fullNext; }
  const out = { 'trk:cur:al': curAl, 'trk:checked': { at: now, err: errors, why } };
  for (const t of ts) {
    const c = curT[t];
    if (!c) continue;
    for (const ck of Object.values(c)) {
      if (!ck || typeof ck !== 'object') continue;
      if (ck.next !== undefined) ck.cur = typeof ck.next === 'number' ? Math.max(ck.cur || 0, ck.next) : ck.next;
      if (ck.atNext) ck.at = ck.atNext;
      if (ck.fullNext) ck.full = ck.fullNext;
      delete ck.next;
      delete ck.atNext;
      delete ck.fullNext;
    }
    out[`trk:cur:${t}`] = c;
  }
  await chrome.storage.local.set(out);
  await trkFlushWrites();
  for (const t of ts) trkPump(t);
  return { ok: !Object.keys(errors).length, queued: n, errors };
}

// A kind switched on but never compared starts syncing by itself (0.10.2: everything automatic): the
// lists are compared in the background and what Compare ticks by itself is applied (missing titles added there,
// AniList's values where they differ; nothing removed; titles only there stay there, except those added since you
// connected, which come to AniList). One line in the Sync log, with Compare's Undo. Not in the first minutes after
// you connect, and not while a reading of that tracker waits on its Compare page.
async function trkStartKinds() {
  for (const t of TRK_IDS) {
    const a = await trkAccount(t);
    if (!a || a.needsLogin || trkCmpRunning[t] || Date.now() - (a.at || 0) < TRK_AUTOSTART_MS) continue;
    const todo = TRACKERS[t].kinds.filter((k) => a.kinds && a.kinds[k] && !(a.ready && a.ready[k]));
    if (!todo.length) continue;
    const c = await cmpGet(t);
    if (c && ['ready', 'reading', 'applying', 'undoing'].includes(c.phase) && Date.now() - (c.beat || c.at) < TRK_STALE_MS) continue;
    for (const k of todo) {
      try { await trkAutoStart(t, k); } catch (err) { console.warn(`Tsugi: ${trkName(t)} couldn't start syncing by itself`, err); }
    }
  }
}
async function trkAutoStart(t, kind) {
  const r = await trkCompare(t, kind);
  if (!r.ok || r.busy) return false;
  await trkCmpJobs[t];
  const c = trkCmp[t];
  if (!c || c.phase !== 'ready' || c.kind !== kind) return false;
  const ids = c.rows.filter((x) => ['add', 'diff', 'only'].includes(x.g) && x.tick).map((x) => x.id);
  const ap = await trkApply(t, kind, ids, { auto: true });
  if (!ap.ok) return false;
  await trkCmpJobs[t];
  return true;
}

// AniList's whole lists (at every check since 0.10.1): titles saved since the last check, titles removed from AniList,
// and 0.9's titles' entry numbers and kinds.
async function trkAniListFull(uid, ts, live, indexed, curAl, alSeen, alAbsent) {
  const read = new Set(indexed.map(([k]) => k));
  const where = new Map();
  for (const [k, index] of indexed) for (const [mid, x] of index) where.set(mid, [k, x]);
  const suspects = new Set();
  const unknown = new Set();
  for (const t of ts) {
    const base = await trkBase(t);
    let dirty = false;
    for (const [m, b] of Object.entries(base)) {
      if (!b) continue;
      const mid = Number(m);
      const w = where.get(mid);
      if (w) {
        if (!b.ty || b.eid !== w[1].eid || !b.u) { b.ty = b.ty || w[0]; b.eid = w[1].eid; b.u = b.u || w[1].u; dirty = true; }
        continue;
      }
      if (b.tr === null) continue;   // never on the tracker: nothing to ask about
      if (!b.ty) unknown.add(mid);
      else if (read.has(b.ty) && live[t].kinds.includes(b.ty)) suspects.add(mid);
    }
    if (dirty) trkSaveBase(t);
  }
  // 0.9's titles no longer on AniList: their kind from AniList's catalog.
  if (unknown.size) {
    const info = await alMediaInfo([...unknown]);
    for (const t of ts) {
      const base = await trkBase(t);
      for (const mid of unknown) {
        const b = base[mid];
        const x = info.get(mid);
        if (!b || !x) continue;
        b.ty = x.type;
        b.n = b.n || x.title;
        b.img = b.img || x.cover;
        if (read.has(x.type) && live[t].kinds.includes(x.type)) suspects.add(mid);
      }
      trkSaveBase(t);
    }
  }
  // Saved since the last check. Several titles can share a second: the ones already read at the last check's
  // second are remembered ("ids"), so the newest title isn't read again each time.
  for (const [k, index] of indexed) {
    const c = curAl[k];
    const seenAt = new Set(c.ids || []);
    let top = c.cur;
    for (const [mid, x] of index) {
      if (x.u > c.cur || (x.u === c.cur && !seenAt.has(mid))) suspects.add(mid);
      if (x.u > top) top = x.u;
    }
    c.next = top;
    c.nextIds = [...index].filter(([, x]) => x.u === top).map(([mid]) => mid);
  }
  const ids = [...suspects].filter((mid) => !alSeen.has(mid));
  if (ids.length) {
    // Made sure of one by one (50 a request): a title missing from the index but there is just synced.
    const got = await trkReadEntries(uid, ids, 'low');
    for (const mid of ids) { if (got.has(mid)) alSeen.set(mid, got.get(mid)); else alAbsent.add(mid); }
  }
  for (const [k] of indexed) curAl[k].fullNext = Date.now();
}

// MyAnimeList: its titles updated most recently (newest first), or every hour the whole list (removals there).
async function malCheck(kind, ck, a, seen, absent, full) {
  if (!ck.cur) ck.cur = (a.ready[kind] || Date.now()) - 10 * 60e3;
  const api = TRACKERS.mal.api;
  let top = ck.cur;
  if (full) {
    const items = await trkReadList('mal', kind, () => {});
    for (const it of items.values()) { seen.set(it.tid, it); top = Math.max(top, it.at || 0); }
    const base = await trkBase('mal');
    for (const b of Object.values(base)) if (b && b.ty === kind && b.tid && b.tr !== null && !items.has(b.tid)) absent.add(b.tid);
    await trkOnlyBuild('mal', kind, items.keys());
    ck.fullNext = Date.now();
  } else {
    let url = `${api}/users/@me/${kind === 'MANGA' ? 'manga' : 'anime'}list?sort=list_updated_at&fields=${encodeURIComponent(MAL_LIST_FIELDS[kind])}&limit=100&nsfw=true`;
    for (let i = 0; url && i < TRK_PAGES; i++) {
      const j = await trkCall('mal', null, { url });
      let older = false;
      for (const d of (j && j.data) || []) {
        if (!d || !d.node || !d.node.id) continue;
        const it = malItem(kind, d.node, d.list_status);
        if (it.at && it.at < ck.cur) { older = true; break; }
        seen.set(it.tid, it);
        top = Math.max(top, it.at || 0);
      }
      const next = j && j.paging && j.paging.next;
      url = !older && typeof next === 'string' && next.startsWith(`${api}/`) ? next : null;
    }
  }
  ck.next = top;
}

// MangaBaka's changes feed: everything changed in your library since the cursor, removals included (its library
// sync guide: keep the cursor once applied; no cursor reads the whole library; a 400 means read it all again).
async function mbFeed(cursor) {
  const entries = new Map();   // series -> the entry now, or null: removed
  let cur = cursor || null;
  let boot = !cur;
  for (let i = 0; i < 60; i++) {
    let j;
    try {
      j = await trkCall('mb', `/v2/my/library/changes?limit=1000${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`);
    } catch (err) {
      if (err.status === 400 && cur && !boot) { entries.clear(); cur = null; boot = true; continue; }
      throw err;
    }
    if (!j) throw trkFail('MangaBaka didn\'t send its changes.', 0, { retry: true });
    for (const x of Array.isArray(j.data) ? j.data : []) {
      if (!x || x.type !== 'entry' || !x.current) continue;
      const sid = Number(x.current.series_id);
      if (!(sid > 0)) continue;
      if (x.action === 'upsert') entries.set(sid, x.current);
      else if (x.action === 'delete') entries.set(sid, null);
    }
    const pg = j.pagination || {};
    if (pg.cursor) cur = pg.cursor;
    if (!pg.more) break;
  }
  return { entries, cursor: cur, boot };
}
async function mbCheck(ck, seen, absent) {
  const r = await mbFeed(ck.cur || null);
  for (const [sid, cur] of r.entries) {
    if (cur) seen.set(sid, { tid: sid, rec: mbRec(cur), at: Date.parse(cur.updated_at) || 0, title: null, cover: null });
    else absent.add(sid);
  }
  if (r.boot) {
    // The whole library: a series synced before and not in it was removed there.
    const base = await trkBase('mb');
    for (const b of Object.values(base)) if (b && b.tid && b.tr && !r.entries.has(b.tid)) absent.add(b.tid);
    await trkOnlyBuild('mb', 'MANGA', [...r.entries.keys()].filter((sid) => r.entries.get(sid)));
  }
  ck.next = r.cursor;
}
// A series added on MangaBaka: which AniList title it is (Tsugi's lookups, else the series' own page, cached).
async function mbToAniList(sids) {
  const out = new Map();
  const map = await trkMbMap();
  const rev = new Map();
  for (const [al, v] of Object.entries(map)) if (v && v[0]) rev.set(v[0], Number(al));
  for (const sid of sids) {
    if (rev.has(sid)) { out.set(sid, rev.get(sid)); continue; }
    const j = await trkCall('mb', `/v1/series/${sid}`, { auth: false });
    const s = j && j.data;
    const al = s && s.source && s.source.anilist && Number(s.source.anilist.id);
    if (al > 0) { out.set(sid, al); map[al] = [sid, Date.now()]; }
  }
  await trkSaveMbMap();
  return out;
}

/* Removals waiting for you, and Undo from the sync log (0.10) ---------------------------------------------------------- */

// AniList's values for a title added again: what it had, empty ones left out.
const rawToAdd = (was) => Object.fromEntries(Object.entries(was || {}).filter(([k, v]) => AL_ARGS[k] && (k === 's' || !isEmpty(k, v))));

// act: 'remove' (from the side that still has it) or 'keep' (it stays there, and stops syncing).
async function trkGoneDecide(t, mediaId, act) {
  const mid = Number(mediaId);
  if (!TRACKERS[t]) return { ok: false, error: 'Unknown tracker' };
  return trkLock(t, async () => {
    const gone = await trkGone(t);
    const g = gone[mid];
    if (!g) return { ok: true };
    const base = await trkBase(t);
    try {
      if (act === 'keep') {
        // Still on AniList, not on the tracker: left off it. Still on the tracker, not on AniList: only there.
        if (g.side === 'tr') { (await trkHold(t))[mid] = 1; await trkSaveHold(t); }
        else { (await trkOnly(t))[g.kind][g.tid] = 1; await trkSaveOnly(t); }
      } else {
        // Removed there too: this tracker's last sync goes first, so the removal isn't asked about again.
        delete base[mid];
        await trkSaveBase(t);
        await trkRemoveOther(t, g.kind, mid, g.tid, g.side, { look: g });
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
    delete gone[mid];
    delete base[mid];
    await trkSaveGone(t);
    await trkSaveBase(t);
    await trkFlushWrites();
    return { ok: true };
  });
}

// Undo puts back what Tsugi wrote, on that side only, and only where it's still what Tsugi wrote (a value you
// changed since is left alone). The other side keeps what you did there: the last sync is set so it isn't sent
// across again. An undone change on AniList still reaches the other trackers, like any AniList change.
async function trkLogUndo(id) {
  const log = await trkLogGet();
  const en = log.find((x) => x.id === id);
  if (!en) return { ok: false, error: 'That change isn\'t in the log any more.' };
  if (en.undone) return { ok: true };
  const t = en.t;
  if (!TRACKERS[t] || !(await trkAccount(t))) return { ok: false, error: `Connect ${TRACKERS[t] ? trkName(t) : 'the tracker'} again to undo this.` };
  const auth = await getAuth();
  if (!auth || !auth.viewer) return { ok: false, error: 'Connect your AniList account first.' };
  const name = trkName(t);
  if (en.op === 'apply') {
    // Compare's own Undo, while it's still the last Apply.
    const u = (await chrome.storage.local.get(`trk:undo:${t}`))[`trk:undo:${t}`];
    if (!u || u.at !== en.undoAt) return { ok: false, error: `${name} was compared again since: undo from its Compare page.` };
    const r = await trkUndoApply(t);
    if (r.ok) { en.undone = Date.now(); await trkSaveLog(); await trkFlushWrites(); }
    return r;
  }
  const res = await trkLock(t, async () => {
    const base = await trkBase(t);
    const mid = en.mid;
    const b = base[mid];
    try {
      if (en.side === 'tr') {
        if (en.op === 'set') {
          const it = await trkReadOne(t, en.kind, en.tid);
          if (!it) return { ok: false, error: `${en.title} isn't on ${name} any more.` };
          const back = {};
          for (const c of en.ch) if (it.rec[c.k] === c.b) back[c.k] = c.a ?? emptyOf(c.k);
          if (!Object.keys(back).length) return { ok: false, error: `${en.title} changed on ${name} since: nothing to put back.` };
          if (back.s && en.s0) back.s0 = en.s0;
          const r = await trkWrite(t, en.kind, en.tid, back);
          if (b && b.tid === en.tid) { b.tr = afterWrite(t, en.kind, b.tr || it.rec, back, r); await trkSaveBase(t); }
        } else if (en.op === 'add') {
          await trkDelete(t, en.kind, en.tid);
          (await trkHold(t))[mid] = 1;
          await trkSaveHold(t);
          if (b) { delete base[mid]; await trkSaveBase(t); }
        } else if (en.op === 'remove') {
          // Removed because it went private (0.12.3): public again on AniList, it comes back synced, with AniList's
          // values as they are now; still private, it comes back as it was, public there and not synced.
          if (en.why === 'private' && (await trkPutBackNow(t, mid, en))) return { ok: true };
          const f = fullFields(t, en.kind, { ...EMPTY_REC, ...(en.was || {}) });
          await trkWrite(t, en.kind, en.tid, f, { create: true, full: f });
          (await trkOnly(t))[en.kind][en.tid] = 1;
          await trkSaveOnly(t);
        }
      } else {
        const e = (await alCall(() => trkReadEntries(auth.viewer.id, [mid]))).get(mid) || null;
        if (en.op === 'set') {
          if (!e) return { ok: false, error: `${en.title} isn't on your AniList list any more.` };
          const raw = alRaw(e);
          const back = {};
          for (const c of en.ch) if (raw[c.k] === c.b) back[c.k] = c.a ?? emptyOf(c.k);
          if (!Object.keys(back).length) return { ok: false, error: `${en.title} changed on AniList since: nothing to put back.` };
          if (b) { Object.assign(b, back); await trkSaveBase(t); await trkFlushWrites(); }
          await alCall(() => alSave(mid, back));
        } else if (en.op === 'add') {
          if (b) { delete base[mid]; await trkSaveBase(t); }
          (await trkOnly(t))[en.kind][en.tid] = 1;
          await trkSaveOnly(t);
          await trkFlushWrites();
          if (e) await alCall(() => alDelete(e.id));
        } else if (en.op === 'remove') {
          if (e) return { ok: false, error: `${en.title} is on your AniList list again.` };
          (await trkHold(t))[mid] = 1;
          await trkSaveHold(t);
          await alCall(() => alSave(mid, rawToAdd(en.was)));
        }
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
    return { ok: true };
  });
  if (res.ok) { en.undone = Date.now(); await trkSaveLog(); await trkFlushWrites(); }
  return res;
}

/* Settings: what the popup needs to know, and its switches -------------------------------------------------------- */

function trkInfo() {
  const out = {};
  for (const t of TRK_IDS) {
    const T = TRACKERS[t];
    out[t] = { name: T.name, kinds: T.kinds, builtIn: !!T.builtIn, origins: T.origins, redirect: T.redirect, apps: T.apps, tokens: T.tokens || null };
  }
  return { ok: true, trackers: out };
}

// Your rules for a tracker (Settings, Trackers): direction, new titles, removed titles, what travels.
async function trkSetRules(t, patch) {
  const a = await trkAccount(t);
  if (!a) return { ok: false, error: 'Not connected' };
  const rules = rulesOf({ rules: { ...(a.rules || {}), ...(patch || {}) } });
  await trkSetAccount(t, { rules });
  return { ok: true, rules };
}

async function trkSetKind(t, kind, on) {
  const a = await trkAccount(t);
  if (!a || !TRACKERS[t].kinds.includes(kind)) return { ok: false, error: 'Not connected' };
  const kinds = { ...(a.kinds || {}), [kind]: !!on };
  await trkSetAccount(t, { kinds });
  if (!on) {
    // Switched off: what was waiting for that kind isn't sent.
    const q = await trkQueue();
    for (const [mid, it] of Object.entries(q[t] || {})) if ((it.kind || (it.e && it.e.type)) === kind) delete q[t][mid];
    await trkSaveQueue();
  }
  trkSyncActive();
  return { ok: true };
}

/* Messages ---------------------------------------------------------------------------------------------------------- */

function trkMessage(msg) {
  const t = msg.t;
  const known = TRACKERS[t];
  switch (msg.type) {
    case 'trk:info': return Promise.resolve(trkInfo());
    case 'trk:connect': return known ? trkStartAuth(t, msg.client, !!msg.builtIn) : Promise.resolve({ ok: false, error: 'Unknown tracker' });
    case 'trk:pat': return trkUseToken(t, msg.token);
    case 'trk:disconnect': return known ? trkDisconnect(t) : Promise.resolve({ ok: false });
    case 'trk:kind': return trkSetKind(t, msg.kind, msg.on);
    case 'trk:compare': return known ? trkCompare(t, msg.kind) : Promise.resolve({ ok: false });
    case 'trk:apply': return trkApply(t, msg.kind, msg.ids);
    case 'trk:undo': return trkUndoApply(t);
    case 'trk:search': return trkSearch(t, msg.kind, msg.q);
    case 'trk:link': return trkLink(t, msg.mediaId, msg.tid === undefined ? null : msg.tid);
    case 'trk:touch': trkTouch(msg.media, msg.entries); return Promise.resolve({ ok: true });
    // 0.10: the popup opened (or Check now), a removal decided, a change undone from the sync log.
    case 'trk:check': {
      const run = trkCheck({ why: msg.why === 'manual' ? 'manual' : 'popup', full: msg.why === 'manual' });
      return msg.wait ? run : Promise.resolve({ ok: true });
    }
    case 'trk:gone': return known ? trkGoneDecide(t, msg.mediaId, msg.act === 'keep' ? 'keep' : 'remove') : Promise.resolve({ ok: false });
    case 'trk:logUndo': return trkLogUndo(String(msg.id || ''));
    case 'trk:rules': return known ? trkSetRules(t, msg.rules) : Promise.resolve({ ok: false });
    // AniList's own page removed an entry (its editor's Delete): the titles synced under it are read back now.
    case 'trk:deleted': trkSawDelete((msg.entries || []).map(Number).filter((n) => n > 0)).catch(() => {}); return Promise.resolve({ ok: true });
    case 'trk:retry': {
      return trkQueue().then(async (q) => {
        for (const it of Object.values(q[t] || {})) it.next = 0;
        await trkSaveQueue();
        // The warning goes; if it happens again, it comes back.
        await trkSetStatus(t, { err: null });
        trkPump(t);
        return { ok: true };
      });
    }
    default: return Promise.resolve({ ok: false, error: 'Unknown message' });
  }
}

// A fresh start of the worker (and the alarm): anything still waiting goes on.
async function trkResume() {
  if (!(await trkSyncActive())) return;
  const left = (await chrome.storage.local.get('trk:touched'))['trk:touched'];
  if (left && ((left.media || []).length || (left.entries || []).length)) trkTouch(left.media, left.entries, 500);
  const q = await trkQueue();
  for (const t of TRK_IDS) if (q[t] && Object.keys(q[t]).length) trkPump(t);
}
trkResume().catch(() => {});
