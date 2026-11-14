// Tsugi · Rewatch log (rebuilt from your activity), planning a rewatch, and dates
// filled in for changes made with AniList's own buttons.
'use strict';

/* ------------------------------------------------------------------ */
/* Rewatch log: read from your AniList activity                        */
/* ------------------------------------------------------------------ */
// AniList keeps one start and one finish date per title, plus a rewatch count. Your activity
// ("watched episode 3", "completed", "rewatched episode 1", "rewatched") has the rest, so the
// log is rebuilt from it. Activity is read for one title at a time, only for titles you've
// finished or are rewatching, and kept until that title changes (a week at most).

const ACTIVITY_QUERY = `query ($userId: Int, $mediaId: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    activities(userId: $userId, mediaId: $mediaId, type: MEDIA_LIST, sort: ID) {
      ... on ListActivity { id status progress createdAt }
    }
  }
}`;
const HIST_KEY = 'hist:v1';
const HIST_TTL = 7 * 24 * 3600 * 1000;
const HIST_MAX = 300;   // titles kept
const HIST_PAGES = 6;   // 300 activities for one title is plenty
const HI = { inflight: new Map() };

// Is there a rewatch history worth showing for this entry?
const hasHistory = (e) => !!e && (e.status === 'COMPLETED' || e.status === 'REPEATING' || e.repeat > 0);
// The log is read again whenever this changes.
const historySig = (e) => `${e.status}|${e.progress || 0}|${e.repeat || 0}`;

// Your activity for one title, oldest first, as [createdAt, status text]. Cached.
async function loadActivity(mediaId, entry, userId) {
  const sig = historySig(entry);
  const cache = objectOr(await store.get('local', HIST_KEY));
  const c = cache[mediaId];
  if (c && c.sig === sig && Date.now() - c.t < HIST_TTL && Array.isArray(c.acts)) return c.acts;
  const key = `${mediaId}|${sig}`;
  if (HI.inflight.has(key)) return HI.inflight.get(key);
  const p = (async () => {
    const acts = [];
    for (let page = 1; page <= HIST_PAGES; page++) {
      const d = await gqlRead(ACTIVITY_QUERY, { userId, mediaId, page });
      const pg = (d && d.Page) || {};
      for (const a of pg.activities || []) {
        if (a && a.status && a.createdAt) acts.push([a.createdAt, String(a.status)]);
      }
      if (!(pg.pageInfo && pg.pageInfo.hasNextPage)) break;
    }
    acts.sort((a, b) => a[0] - b[0]);
    // Read the cache again before saving: another tab may have added to it meanwhile.
    const now = objectOr(await store.get('local', HIST_KEY));
    now[mediaId] = { t: Date.now(), sig, acts };
    const keys = Object.keys(now);
    if (keys.length > HIST_MAX) keys.sort((a, b) => now[a].t - now[b].t).slice(0, keys.length - HIST_MAX).forEach((k) => delete now[k]);
    store.set('local', HIST_KEY, now);
    return acts;
  })();
  HI.inflight.set(key, p);
  try { return await p; } finally { HI.inflight.delete(key); }
}

// What an activity says happened, from AniList's wording (anime and manga).
function activityKind(text) {
  const s = String(text || '').toLowerCase().trim();
  if (/re-?watch|re-?read/.test(s)) return /episode|chapter/.test(s) ? 'reprogress' : 'recomplete';
  if (/complet/.test(s)) return 'complete';
  if (/drop/.test(s)) return 'drop';
  if (/paus/.test(s)) return 'pause';
  if (/plan/.test(s)) return 'plan';
  if (/watch|read/.test(s)) return 'progress';
  return null;
}

function dayOf(t) {
  const d = new Date(t * 1000);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

// Turns activity into watches: [{ kind: 'first' | 'rewatch' | 'try', n, start, end, state }], oldest first.
// ('try': a first watch you dropped, then started over.)
// state: 'done', 'now' (in progress), 'dropped', 'paused' or 'stopped'.
// entry: { status, repeat, startedAt, completedAt }. Its own dates win for the first watch.
function buildLog(acts, entry) {
  const runs = [];
  let cur = null;
  const finished = () => runs.some((r) => r.state === 'done');
  const open = (kind, d) => {
    // Starting over after dropping a first watch: the dropped one was a try.
    if (kind === 'first') for (const r of runs) if (r.kind === 'first') r.kind = 'try';
    cur = { kind, start: d, end: null, state: 'now' };
    runs.push(cur);
  };
  for (const [t, text] of acts) {
    const k = activityKind(text);
    const d = dayOf(t);
    if (k === 'reprogress') {
      if (!cur || cur.kind !== 'rewatch') {
        if (cur) cur.state = 'stopped';
        open('rewatch', d);
      }
    } else if (k === 'progress') {
      // Watching again after finishing (some people rewatch from Watching) counts as a rewatch.
      if (!cur) open(finished() ? 'rewatch' : 'first', d);
    } else if (k === 'complete' || k === 'recomplete') {
      if (cur) { cur.end = d; cur.state = 'done'; cur = null; }
      // "Completed" again with nothing watched in between is the same watch marked twice.
      else if (k === 'recomplete' || !finished()) runs.push({ kind: k === 'recomplete' || finished() ? 'rewatch' : 'first', start: null, end: d, state: 'done' });
    } else if (k === 'drop') {
      if (cur) { cur.end = d; cur.state = 'dropped'; cur = null; }
    }
    // Pausing doesn't end a watch, and planning doesn't start one.
  }
  // The last watch, as the list says it is now.
  if (cur) {
    const st = entry.status;
    cur.state = st === 'CURRENT' || (st === 'REPEATING' && cur.kind === 'rewatch') ? 'now' : st === 'COMPLETED' || st === 'REPEATING' ? 'done' : st === 'PAUSED' ? 'paused' : st === 'DROPPED' ? 'dropped' : 'stopped';
  }
  // The first watch: your own start and finish dates, when you've set them.
  let first = runs.find((r) => r.kind === 'first');
  const seenOnce = entry.status === 'COMPLETED' || entry.status === 'REPEATING' || entry.repeat > 0 || runs.some((r) => r.kind === 'rewatch');
  if (!first && (seenOnce || hasDate(entry.startedAt) || hasDate(entry.completedAt))) {
    first = { kind: 'first', start: null, end: null, state: seenOnce ? 'done' : 'now', before: true };
    runs.unshift(first);
  }
  if (first) {
    if (hasDate(entry.startedAt)) first.start = fuzzy(entry.startedAt);
    if (hasDate(entry.completedAt) && first.state === 'done') first.end = fuzzy(entry.completedAt);
  }
  // Rewatching now, with nothing watched yet.
  if (entry.status === 'REPEATING' && !runs.some((r) => r.kind === 'rewatch' && r.state === 'now')) runs.push({ kind: 'rewatch', start: null, end: null, state: 'now' });
  // Rewatches AniList counted that aren't in your activity (from before it, or with activity off).
  const found = runs.filter((r) => r.kind === 'rewatch' && r.state === 'done').length;
  const missing = Math.max(0, (entry.repeat || 0) - found);
  let n = missing;
  for (const r of runs) if (r.kind === 'rewatch') r.n = ++n;
  const times = (first && first.state === 'done' ? 1 : 0) + found + missing;
  return { runs, times, missing, now: runs.find((r) => r.state === 'now') || null };
}

const timesWord = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

function runDates(r) {
  const a = dateWords(r.start), b = dateWords(r.end);
  const tail = r.state === 'now' ? 'now' : r.state === 'dropped' ? 'dropped' : r.state === 'paused' ? 'paused' : r.state === 'stopped' ? 'stopped' : '';
  if (a && b) return a === b ? b : `${a} → ${b}`;
  if (b) return r.state === 'dropped' ? `Dropped ${b}` : `Finished ${b}`;
  if (a) return tail ? `${a} → ${tail}` : `Started ${a}`;
  if (r.before) return 'Before your activity history';
  return r.state === 'now' ? 'In progress' : tail ? tail[0].toUpperCase() + tail.slice(1) : 'No dates';
}

// The log, as shown in the popover.
function historyView(log, anime, opts = {}) {
  const W = anime ? 'Watched' : 'Read';
  const sum = log.now && log.now.kind === 'rewatch'
    ? `${anime ? 'Rewatching' : 'Rereading'} now${log.times ? `, ${W.toLowerCase()} ${timesWord(log.times)} before` : ''}`
    : log.times ? `${W} ${timesWord(log.times)}` : log.now ? `${anime ? 'Watching' : 'Reading'} for the first time` : 'Nothing finished yet';
  const label = (r) => (r.kind === 'first' ? (anime ? 'First watch' : 'First read') : r.kind === 'try' ? 'First try' : `${anime ? 'Rewatch' : 'Reread'} ${r.n}`);
  const runs = opts.limit && log.runs.length > opts.limit ? log.runs.slice(-opts.limit) : log.runs;
  const hidden = log.runs.length - runs.length;
  return h('div', { class: 'apq-hist' },
    h('div', { class: 'apq-hist-sum' }, sum),
    runs.length ? h('ol', { class: 'apq-hist-runs' }, runs.map((r) => h('li', { class: `apq-hist-run is-${r.state}` },
      h('span', { class: 'apq-hist-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'apq-hist-k' }, label(r)),
      h('span', { class: 'apq-hist-d' }, runDates(r))))) : null,
    hidden ? h('p', { class: 'apq-hist-note' }, `${hidden} earlier ${hidden === 1 ? 'one' : 'ones'} on the title's page.`) : null,
    log.missing ? h('p', { class: 'apq-hist-note' },
      `${log.missing} earlier ${anime ? 'rewatch' : 'reread'}${log.missing === 1 ? ' isn\'t' : 'es aren\'t'} in your activity, so ${log.missing === 1 ? 'it has' : 'they have'} no dates.`) : null);
}

function historyLoading() {
  return h('div', { class: 'apq-hist is-loading', role: 'status' }, spinner(), h('span', {}, 'Reading your activity…'));
}

/* In the popover (list pages) ---------------------------------------- */

// Called from updatePopover. Loads the log once per popover, then draws it.
function updatePopoverHistory(P, e) {
  const show = canEdit() && S.settings.history && hasHistory(e) && !!(S.data.viewer && S.data.viewer.id);
  P.histBox.hidden = !show;
  if (!show) return;
  const sig = historySig(e);
  if (!P.hist || P.hist.sig !== sig) {
    const st = { sig, state: 'loading', log: null };
    P.hist = st;
    loadActivity(e.mediaId, e, S.data.viewer.id)
      .then((acts) => { st.state = 'ok'; st.log = buildLog(acts, e); })
      .catch(() => { st.state = 'error'; })
      .finally(() => { if (S.popover === P) { updatePopover(); positionPopover(); } });
  }
  const drawn = `${P.hist.sig}:${P.hist.state}`;
  if (P.histBox.dataset.drawn === drawn) return;
  P.histBox.dataset.drawn = drawn;
  const body = P.hist.state === 'loading' ? historyLoading()
    : P.hist.state === 'error' ? h('div', { class: 'apq-hist is-error' }, h('span', {}, "Couldn't read your activity."),
      h('button', { type: 'button', class: 'apq-hist-retry', onclick: () => { P.hist = null; updatePopover(); } }, 'Try again'))
      : historyView(P.hist.log, isAnime(), { limit: 3 });
  P.histBox.replaceChildren(h('div', { class: 'apq-pop-label' }, 'History'), body);
}

/* ------------------------------------------------------------------ */
/* Rewatch / Reread                                                    */
/* ------------------------------------------------------------------ */
// A finished title goes to Rewatching (Rereading), back at episode or chapter 0, with Undo. Dates stay
// as they are (datesToFill: a rewatch never touches them); a pin in Completed leaves (updateEntry).
// 0.12.1: "Plan a rewatch" is gone (it put the title in a custom list, made one when there was none,
// and most people have none); the lists it made are left alone.

async function startRewatch(mediaId) {
  const e = entryOf(mediaId);
  if (!e || !canEdit() || S.busy.has(mediaId)) return;
  const before = await updateEntry(mediaId, { status: 'REPEATING', progress: 0 });
  if (before) toast(`${e.title} moved to ${statusLabel('REPEATING')}`, 'ok', [undoEntry(mediaId, before)], 0, e);
}

/* ------------------------------------------------------------------ */
/* Dates for changes made with AniList's own buttons                   */
/* ------------------------------------------------------------------ */
// bridge.js tells us about each list change AniList's own page saves: its + buttons on list
// pages, the Add to List menu on a title's page. Starting or finishing a title that way fills
// in its empty dates too, just as the hub does. AniList's list editor shows the dates, so a
// change saved from there (one that sends dates) is left exactly as you made it.

const MEDIALIST_QUERY = `query ($id: Int) {
  MediaList(id: $id) { id mediaId status progress repeat startedAt { year month day } completedAt { year month day } media { title { userPreferred } } }
}`;
const siteSaves = new Map(); // entry id -> { timer, prev }

function savedEntriesIn(data) {
  const out = [];
  for (const v of Object.values(objectOr(data))) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'number' && ('status' in v || 'progress' in v)) out.push(v);
  }
  return out;
}

function onSiteSave(ev) {
  let msg;
  try { msg = JSON.parse(ev.detail); } catch { return; }
  if (!msg || !msg.data) return;
  const q = String(msg.query || '');
  const vars = objectOr(msg.variables);
  // A removal (AniList's editor's Delete): the other trackers that have the title follow your rules (0.10.1).
  if (/DeleteMediaListEntry/.test(q)) {
    const ids = [];
    for (const m of q.matchAll(/DeleteMediaListEntry\s*\(\s*id\s*:\s*(\$\w+|\d+)/g)) {
      const v = m[1][0] === '$' ? vars[m[1].slice(1)] : m[1];
      if (Number(v) > 0) ids.push(Number(v));
    }
    if (ids.length) {
      try { chrome.runtime.sendMessage({ type: 'trk:deleted', entries: ids }, () => void chrome.runtime.lastError); } catch { /* the extension was reloaded */ }
    }
  }
  const sentDates = 'startedAt' in vars || 'completedAt' in vars || /\b(startedAt|completedAt)\s*:\s*[$\{]/.test(q);
  // Only a change of status or progress (as an argument: "progress: $progress") starts or finishes anything.
  const moved = 'status' in vars || 'progress' in vars || /\b(status|progress)\s*:\s*[$A-Z0-9]/.test(q);
  // On a title's page, the palette's copy of your entry follows the change.
  if (TP.route) { clearTimeout(onSiteSave.timer); onSiteSave.timer = setTimeout(refreshTitle, 400); }
  // A title just added this way may have to be private first (Keep new ones private, 0.12.3): the other trackers
  // hear of it once that's settled, so MyAnimeList never gets a title that's private on AniList.
  const all = savedEntriesIn(msg.data);
  if (nsfwKeeps(NS.set) && vars.mediaId && !vars.id) privacyAfterSite(all, vars).catch(() => {}).finally(() => trackersSaw(all));
  else trackersSaw(all);
  for (const saved of all) {
    palSiteSaved(saved);
    // Keep the hub in step with what AniList saved.
    const local = S.data ? [...S.data.entries.values()].find((x) => x.id === saved.id) : null;
    const prev = local ? { status: local.status, progress: local.progress || 0 } : null;
    const pinned = !!local && isPinned(local);
    if (local) {
      applySaved(local, { ...saved, id: undefined });
      entryChanged();
      // Moved to another list with AniList's own buttons or editor: it leaves the pins of the list
      // it was pinned in, as everywhere in Tsugi (pinLeaving in lists.js).
      if (pinned && isPinned(local) && moved && statusAfter(local, {}) !== prev.status) unpinAfterSite(local, prev.status);
    }
    if (sentDates || !moved || !S.settings.autoDates) continue;
    const pending = siteSaves.get(saved.id);
    if (pending) clearTimeout(pending.timer);
    const first = pending ? pending.prev : prev;
    // A few quick clicks on + count as one change.
    siteSaves.set(saved.id, { prev: first, timer: setTimeout(() => { siteSaves.delete(saved.id); fixSiteDates(saved.id, first); }, 1200) });
  }
}

// Other trackers (0.9): a change made with AniList's own buttons or editor goes to MyAnimeList and MangaBaka
// too. The background reads the title back from AniList and sends what changed (trackers.js); Tsugi's own saves
// go through its request queue, which notices them by itself.
function trackersSaw(saved) {
  const media = [];
  const entries = [];
  for (const s of saved) {
    const local = !s.mediaId && S.data ? [...S.data.entries.values()].find((x) => x.id === s.id) : null;
    const mid = s.mediaId || (local && local.mediaId);
    if (mid) media.push(mid);
    else entries.push(s.id);
  }
  if (!media.length && !entries.length) return;
  try { chrome.runtime.sendMessage({ type: 'trk:touch', media, entries }, () => void chrome.runtime.lastError); } catch { /* the extension was reloaded */ }
}

async function unpinAfterSite(e, was) {
  const pin = e.priority;
  const save = async (priority) => {
    const { results } = await runOps([{ kind: 'save', entryId: e.id, mediaId: e.mediaId, patch: { priority } }]);
    const saved = results.values().next().value;
    if (!saved) throw new Error('not saved');
    applySaved(e, saved);
    entryChanged();
    scheduleResort();
  };
  try { await save(unpinnedPriority(e)); } catch { return; }
  toast(`${e.title} left ${statusLabel(was)}, so it's no longer pinned`, 'ok', {
    label: 'Undo',
    run: async () => {
      try { await save(pin); toast(`Undone for ${e.title}`); }
      catch { toast(`Couldn't undo for ${e.title}. Make sure you're logged in to AniList.`, 'error'); }
    },
  }, 0, e);
}

async function fixSiteDates(id, prev) {
  if (!S.settings.autoDates) return;
  const local = S.data && S.data.full ? [...S.data.entries.values()].find((x) => x.id === id) : null;
  // Nothing to fill: no need to ask AniList. (Its answer to the page may leave out the status
  // a last episode changes, so that's worked out here too.)
  if (local && !Object.keys(datesToFill(prev, { ...local, status: statusAfter(local, {}) })).length) return;
  let cur;
  try {
    const d = await gqlRead(MEDIALIST_QUERY, { id });
    cur = d && d.MediaList;
  } catch { return; }
  if (!cur) return;
  const now = { status: cur.status, progress: cur.progress || 0, repeat: cur.repeat || 0, startedAt: fuzzy(cur.startedAt), completedAt: fuzzy(cur.completedAt) };
  const fill = datesToFill(prev, now);
  const keys = Object.keys(fill);
  if (!keys.length) return;
  const title = (local && local.title) || (cur.media && cur.media.title && cur.media.title.userPreferred) || 'This title';
  const save = async (patch) => {
    const { results } = await runOps([{ kind: 'save', entryId: id, mediaId: cur.mediaId, patch }]);
    const saved = results.values().next().value;
    if (!saved) throw new Error('not saved');
    const e = S.data ? [...S.data.entries.values()].find((x) => x.id === id) : null;
    if (e) { applySaved(e, saved); entryChanged(); }
    if (TP.route && TP.route.id === cur.mediaId) refreshTitle();
  };
  try { await save(fill); } catch { return; }
  const what = keys.length === 2 ? 'start and finish dates' : keys[0] === 'startedAt' ? 'start date' : 'finish date';
  const empty = {};
  for (const k of keys) empty[k] = fuzzy(null);
  toast(`${title}: ${what} set to today`, 'ok', {
    label: 'Undo',
    run: async () => {
      try { await save(empty); toast(`Undone for ${title}`); }
      catch { toast(`Couldn't undo for ${title}. Make sure you're logged in to AniList.`, 'error'); }
    },
  });
}
