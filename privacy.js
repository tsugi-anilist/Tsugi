// Tsugi: keeping NSFW titles private (0.12.3), in the background so it goes on when the popup closes. Loaded by
// background.js after trackers.js (one scope: request, getAuth, the trackers' functions) and nsfw.js (what counts).
// The popup asks, and shows what this writes to session "nsfw:job":
//   nsfw:scan   reads your anime and manga lists (each title's 18+ mark, genres and tags, whether it's private). The
//               popup works out what counts with your current choices, so its counts follow each switch at once.
//   nsfw:apply  makes the ticked titles private (or public again): UpdateMediaListEntries, 50 a request. Titles going
//               private leave MyAnimeList when you ask (it has no private titles: they'd stay public there).
//   nsfw:undo   puts the last one back, MyAnimeList's copies too.
// Tsugi notes the titles it made private (local "nsfw:made", nsfw.js) for "Make them public again".
'use strict';

const NSFW_STALE_MS = 15 * 60e3;   // an older reading is read again before Apply
const NSFW_PER = 50;               // titles per UpdateMediaListEntries
const NSFW_LIST_QUERY = `query TsugiNsfwList($userId: Int, $type: MediaType, $chunk: Int) {
  MediaListCollection(userId: $userId, type: $type, forceSingleCompletedList: true, chunk: $chunk, perChunk: 500) {
    hasNextChunk
    lists { entries { id mediaId private createdAt media { id format seasonYear startDate { year } isAdult genres tags { id rank } title { userPreferred english romaji native } coverImage { medium color } } } }
  }
}`;
const NSFW_BULK = 'mutation TsugiNsfwPrivate($ids: [Int], $private: Boolean) { UpdateMediaListEntries(ids: $ids, private: $private) { id mediaId private } }';

// { phase: 'reading' | 'ready' | 'applying' | 'done' | 'undoing' | 'undone' | 'error', at (when the lists were read),
// beat, n, of, step ('al' | 'mal'), rows: [{ id (mediaId), e (entry), k (kind), t, c, col, f, y, pv (private), ca
// (added, seconds), a, g, tg (nsfw.js's facts), mal (synced with MyAnimeList) }], res, error }.
let nsfwJob = null;
let nsfwTimer = null;
function nsfwSave(now = false) {
  if (!nsfwJob) return Promise.resolve();
  nsfwJob.beat = Date.now();
  const write = () => { nsfwTimer = null; return chrome.storage.session.set({ 'nsfw:job': nsfwJob }).catch(() => {}); };
  if (now) { clearTimeout(nsfwTimer); return write(); }
  if (!nsfwTimer) nsfwTimer = setTimeout(write, 300);
  return Promise.resolve();
}
async function nsfwJobNow() {
  if (!nsfwJob) {
    try { nsfwJob = (await chrome.storage.session.get('nsfw:job'))['nsfw:job'] || null; } catch { nsfwJob = null; }
    // The worker stopped in the middle (the browser restarted it): that one is over.
    if (nsfwJob && ['reading', 'applying', 'undoing'].includes(nsfwJob.phase)) nsfwJob = { ...nsfwJob, phase: 'error', error: 'This stopped before the end. Read your lists again.' };
  }
  return nsfwJob;
}
const nsfwBusy = () => !!nsfwJob && ['reading', 'applying', 'undoing'].includes(nsfwJob.phase);

// Titles synced with MyAnimeList (it has a copy of them there).
async function nsfwOnMal() {
  const out = {};
  if (!(await trkAccount('mal'))) return out;
  for (const [mid, b] of Object.entries(await trkBase('mal'))) if (b && b.tid && b.tr !== null) out[mid] = 1;
  return out;
}

function nsfwRow(x, kind, mal) {
  const m = x.media || {};
  const f = nsfwFacts(m);
  return {
    id: x.mediaId, e: x.id, k: kind, t: (m.title && m.title.userPreferred) || `Title ${x.mediaId}`,
    // Its other names, for finding it by any of them (1.0.1: Settings' "Add a title").
    n: m.title ? [...new Set([m.title.english, m.title.romaji, m.title.native].filter((v) => v && v !== m.title.userPreferred))] : [],
    c: (m.coverImage && m.coverImage.medium) || null, col: (m.coverImage && m.coverImage.color) || null,
    f: m.format || null, y: m.seasonYear || (m.startDate && m.startDate.year) || null,
    pv: !!x.private, ca: x.createdAt || 0, a: f.a, g: f.g || [], tg: f.t || [], mal: !!mal[x.mediaId],
  };
}

async function nsfwScan() {
  await nsfwJobNow();
  if (nsfwBusy()) return { ok: true, busy: true };
  const auth = await getAuth();
  if (!auth || !auth.viewer) return { ok: false, error: 'Connect your AniList account first.' };
  nsfwJob = { phase: 'reading', at: Date.now(), n: 0, of: 0, rows: [] };
  await nsfwSave(true);
  try {
    const mal = await nsfwOnMal();
    const rows = [];
    const seen = new Set();
    for (const kind of NSFW_KINDS) {
      for (let chunk = 1; chunk < 40; chunk++) {
        const data = await request(NSFW_LIST_QUERY, { userId: auth.viewer.id, type: kind, chunk }, 'high');
        const c = data && data.MediaListCollection;
        // Custom lists repeat titles: each once.
        for (const l of (c && c.lists) || []) for (const x of l.entries || []) if (x && x.mediaId && !seen.has(x.mediaId)) { seen.add(x.mediaId); rows.push(nsfwRow(x, kind, mal)); }
        nsfwJob.n = rows.length;
        nsfwSave();
        if (!c || !c.hasNextChunk) break;
      }
    }
    nsfwJob = { phase: 'ready', at: Date.now(), n: rows.length, of: 0, rows };
  } catch (err) {
    nsfwJob = { phase: 'error', at: Date.now(), error: `Couldn't read your lists: ${err.message}`, rows: [] };
  }
  await nsfwSave(true);
  return { ok: true };
}

// One request for many titles; a refusal of the whole request is tried title by title, to save the rest.
async function nsfwWrite(rows, pv) {
  const ok = [];
  for (let i = 0; i < rows.length; i += NSFW_PER) {
    const part = rows.slice(i, i + NSFW_PER);
    const send = async (list) => {
      const data = await request(NSFW_BULK, { ids: list.map((r) => r.e), private: pv }, 'high');
      const saved = new Set(((data && data.UpdateMediaListEntries) || []).filter((x) => x && x.private === pv).map((x) => x.id));
      for (const r of list) if (saved.has(r.e)) { r.pv = pv; ok.push(r); }
    };
    try { await send(part); }
    catch (err) {
      if (part.length === 1 || err.status === 401 || err.status === 429 || !err.status) throw err;
      for (const r of part) { try { await send([r]); } catch { /* left as it was */ } }
    }
    nsfwJob.n = Math.min(rows.length, i + part.length);
    nsfwSave();
  }
  return ok;
}

// ids: the titles (mediaIds) to change; pv: true makes them private, false public again; mal: titles going private
// leave MyAnimeList too.
async function nsfwApply(ids, pv, mal) {
  await nsfwJobNow();
  const job = nsfwJob;
  if (!job || !['ready', 'done', 'undone'].includes(job.phase)) return { ok: false, error: 'Read your lists first.' };
  if (Date.now() - job.at > NSFW_STALE_MS) return { ok: false, stale: true, error: 'Your lists were read a while ago: read again first.' };
  const want = new Set((ids || []).map(Number));
  const rows = job.rows.filter((r) => want.has(r.id) && r.pv !== !!pv);
  if (!rows.length) return { ok: false, error: 'Nothing ticked.' };
  const before = await nsfwReadMade();
  job.phase = 'applying'; job.step = 'al'; job.n = 0; job.of = rows.length; job.res = null;
  await nsfwSave(true);
  nsfwRunApply(job, rows, !!pv, !!mal, before);   // goes on without the popup
  return { ok: true };
}

async function nsfwRunApply(job, rows, pv, mal, before) {
  let done = [];
  let error = null;
  try { done = await nsfwWrite(rows, pv); }
  catch (err) { error = err.message; }
  const back = Object.fromEntries(done.map((r) => [r.id, before[r.id] || null]));
  await nsfwNoteMade(done.map((r) => ({ id: r.id, k: r.k })), { pub: !pv });
  // MyAnimeList has no private titles: its copies leave it when you asked, with a line each in the Sync log.
  const out = [];
  let malFailed = 0;
  const todo = pv && mal ? done.filter((r) => r.mal) : [];
  if (todo.length) {
    job.step = 'mal'; job.n = 0; job.of = todo.length;
    await nsfwSave(true);
    for (const r of todo) {
      try {
        const log = await trkPrivateRemove(r.id, { title: r.t, cover: r.c, color: r.col });
        if (log) out.push({ id: r.id, log });
        r.mal = false;
      } catch (err) { malFailed++; console.warn('Tsugi: couldn\'t remove a private title from MyAnimeList', err); }
      job.n++;
      nsfwSave();
    }
    await trkFlushWrites();
  }
  if (done.length) {
    await chrome.storage.local.set({ 'nsfw:undo': { at: Date.now(), pv, rows: done.map((r) => ({ id: r.id, e: r.e, k: r.k })), back, mal: out } });
  }
  job.phase = 'done';
  job.res = { pv, ok: done.length, failed: rows.length - done.length, mal: out.length, malFailed, error };
  job.undo = done.length > 0;
  await nsfwSave(true);
}

async function nsfwUndo() {
  await nsfwJobNow();
  if (nsfwBusy()) return { ok: false, error: 'Wait for the change running now.' };
  const u = (await chrome.storage.local.get('nsfw:undo'))['nsfw:undo'];
  if (!u || !u.rows || !u.rows.length) return { ok: false, error: 'Nothing to undo.' };
  const job = nsfwJob || { rows: [], at: Date.now() };
  nsfwJob = job;
  const byId = new Map(job.rows.map((r) => [r.id, r]));
  const rows = u.rows.map((x) => byId.get(x.id) || { id: x.id, e: x.e, k: x.k, pv: u.pv });
  job.phase = 'undoing'; job.step = 'al'; job.n = 0; job.of = rows.length;
  await nsfwSave(true);
  (async () => {
    let error = null;
    let ok = [];
    try { ok = await nsfwWrite(rows, !u.pv); } catch (err) { error = err.message; }
    // Made private, undone: noted as made public by you, so Keep new ones private leaves them alone. Made public,
    // undone: Tsugi's notes as they were.
    if (u.pv) await nsfwNoteMade(ok.map((r) => ({ id: r.id, k: r.k })), { pub: true });
    else await nsfwNoteMade(null, { back: Object.fromEntries(ok.map((r) => [r.id, (u.back || {})[r.id] || null])) });
    // Public again: MyAnimeList's copies come back, with AniList's values as they are now.
    let malBack = 0;
    if (u.pv && u.mal && u.mal.length) {
      job.step = 'mal'; job.n = 0; job.of = u.mal.length;
      await nsfwSave(true);
      const gone = new Set(ok.map((r) => r.id));
      for (const m of u.mal) {
        if (gone.has(m.id) && (await trkPutBack('mal', m.id, m.log))) { malBack++; const r = byId.get(m.id); if (r) r.mal = true; }
        job.n++;
        nsfwSave();
      }
      await trkFlushWrites();
    }
    await chrome.storage.local.remove('nsfw:undo');
    job.phase = 'undone';
    job.undo = false;
    job.res = { ...(job.res || {}), undone: ok.length, undoFailed: rows.length - ok.length, malBack, error };
    await nsfwSave(true);
  })();
  return { ok: true };
}

// "Keep new ones private", for a title a tracker adds to AniList (trackers.js): the kind when it should be private.
async function nsfwKeepForTracker(mediaId, kind) {
  let set;
  try { set = nsfwNormalize((await chrome.storage.sync.get('nsfw')).nsfw); } catch { return null; }
  if (!set.keep[kind]) return null;
  const marks = await nsfwReadMarks();
  return nsfwAddPrivate({
    set, marks, mediaId, kind,
    fetch: async (id) => { const d = await request(NSFW_MEDIA_QUERY, { id }, 'high'); return d && d.Media; },
  });
}

function nsfwMessage(msg) {
  switch (msg.type) {
    case 'nsfw:scan': return nsfwScan();
    case 'nsfw:apply': return nsfwApply(msg.ids, msg.pv !== false, !!msg.mal);
    case 'nsfw:undo': return nsfwUndo();
    default: return Promise.resolve({ ok: false, error: 'Unknown message' });
  }
}
