// Tsugi: what counts as NSFW (0.12.3). One definition, shared by AniList's pages (loaded before content/core.js), the
// toolbar popup (popup.html, before popup.js) and the background worker (importScripts). Its names start with nsfw /
// NSFW because the content scripts share one scope.
//
// Your choice, anime and manga apart (sync "nsfw"): AniList's 18+ mark (only hentai has it), the Ecchi genre, AniList's
// 18+ tags from a rank you pick (so a passing mention doesn't count), genres and tags you add (at the same rank), and
// titles you mark yourself (sync "nsfw:marks", or local when it's too big for sync: 1 always counts, 0 never does).
// keep[kind] is when you switched on "Keep new ones private" (0: off). Tsugi remembers the titles it made private in
// local "nsfw:made" ({ mediaId: { k: kind, at, pub: when made public again } }), for "Make them public again".
'use strict';

const NSFW_KINDS = ['ANIME', 'MANGA'];
const NSFW_RANKS = [50, 60, 70, 80, 90];
const NSFW_MAX_OWN = 30;
// AniList's 18+ tags (MediaTagCollection with isAdult) on 2026-11-13: its 66 Sexual Content tags and Omegaverse.
// The ids are AniList's own and don't change; a newer list from AniList (the popup asks for it to pick tags) adds to
// these (local "nsfw:tags").
const NSFW_ADULT_TAGS = [
  [124, 'Netorare'], [125, 'Nakadashi'], [126, 'Boobjob'], [127, 'Public Sex'], [129, 'Defloration'],
  [130, 'Facial'], [131, 'Masturbation'], [132, 'Threesome'], [133, 'Sex Toys'], [134, 'Fellatio'],
  [135, 'Cunnilingus'], [136, 'Flat Chest'], [137, 'Large Breasts'], [155, 'Rape'], [180, 'Watersports'],
  [181, 'Human Pet'], [185, 'Anal Sex'], [187, 'MILF'], [188, 'Futanari'], [189, 'Tentacles'], [190, 'Prostitution'],
  [246, 'Bondage'], [279, 'Ahegao'], [280, 'Netorase'], [315, 'Ashikoki'], [316, 'Netori'], [317, 'Handjob'],
  [318, 'Voyeur'], [359, 'Irrumatio'], [360, 'Sumata'], [380, 'Virginity'], [387, 'Scat'], [533, 'Omegaverse'],
  [624, 'Vore'], [629, 'Armpits'], [630, 'Sweat'], [631, 'Feet'], [650, 'Lactation'], [651, 'Asphyxiation'],
  [652, 'Amputation'], [723, 'Sadism'], [830, 'Group Sex'], [845, 'Rimjob'], [901, 'Exhibitionism'],
  [999, 'Masochism'], [1038, 'DILF'], [1039, 'Scissoring'], [1146, 'Femdom'], [1234, 'Deepthroat'],
  [1235, 'Squirting'], [1273, 'Cumflation'], [1367, 'Hypersexuality'], [1446, 'Zoophilia'], [1450, 'Male Pregnancy'],
  [1511, 'Double Penetration'], [1515, 'Pet Play'], [1573, 'Cervix Penetration'], [1591, 'Hair Pulling'],
  [1653, 'Mating Press'], [1659, 'Fisting'], [1722, 'Erotic Piercings'], [1732, 'Shimaidon'], [1807, 'Fingering'],
  [1902, 'Swapping'], [1903, 'Oyakodon'], [1926, 'Strap-on'], [1982, 'Sixty-nine'],
];
const NSFW_ADULT = new Map(NSFW_ADULT_TAGS);
// A title, as much of it as the definition needs (one request; the tags only matter when you count them).
const NSFW_MEDIA_QUERY = 'query TsugiNsfwMedia($id: Int) { Media(id: $id) { id type isAdult genres tags { id rank } } }';

function nsfwKindDefault() {
  return { adult: true, ecchi: true, tags: false, rank: 80, genres: [], own: [] };
}

function nsfwNormalize(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { keep: {} };
  for (const k of NSFW_KINDS) {
    const x = r[k] && typeof r[k] === 'object' ? r[k] : {};
    const d = nsfwKindDefault();
    const genres = [];
    for (const g of Array.isArray(x.genres) ? x.genres : []) {
      const s = String(g == null ? '' : g).trim().slice(0, 40);
      if (s && !genres.includes(s)) genres.push(s);
    }
    const own = [];
    for (const t of Array.isArray(x.own) ? x.own : []) {
      const id = Number(Array.isArray(t) ? t[0] : t && t.id);
      const n = String((Array.isArray(t) ? t[1] : t && t.n) || '').trim().slice(0, 60);
      if (Number.isInteger(id) && id > 0 && !own.some((o) => o[0] === id)) own.push([id, n || `Tag ${id}`]);
    }
    out[k] = {
      adult: x.adult !== undefined ? !!x.adult : d.adult,
      ecchi: x.ecchi !== undefined ? !!x.ecchi : d.ecchi,
      tags: x.tags !== undefined ? !!x.tags : d.tags,
      rank: NSFW_RANKS.includes(Number(x.rank)) ? Number(x.rank) : d.rank,
      genres: genres.slice(0, NSFW_MAX_OWN),
      own: own.slice(0, NSFW_MAX_OWN),
    };
    const since = Number(r.keep && r.keep[k]);
    out.keep[k] = Number.isFinite(since) && since > 0 ? since : 0;
  }
  return out;
}

// The tags of a title are only asked for when they can count (they double the size of a list request).
const nsfwUsesTags = (set, kind) => !!(set && set[kind] && (set[kind].tags || set[kind].own.length));
const nsfwKeeps = (set) => !!(set && (set.keep.ANIME || set.keep.MANGA));

// What the definition needs to know about a title, from AniList's media (isAdult, genres, tags { id rank }):
// { a: its 18+ mark, g: genres, t: [[tag id, rank]] }. null where AniList wasn't asked.
function nsfwFacts(m) {
  if (!m) return null;
  return {
    a: typeof m.isAdult === 'boolean' ? m.isAdult : null,
    g: Array.isArray(m.genres) ? m.genres.filter(Boolean).map(String) : null,
    t: Array.isArray(m.tags) ? m.tags.filter((x) => x && x.id).map((x) => [Number(x.id), Number(x.rank) || 0]) : null,
  };
}
// Enough to decide: the mark and the genres, and the tags when they count.
const nsfwKnows = (f, set, kind) => !!f && f.a !== null && f.g !== null && (!nsfwUsesTags(set, kind) || f.t !== null);

// Why a title counts as NSFW for this kind, or null when it doesn't: a list of reasons, { k: 'mark' (you marked it) |
// 'adult' | 'ecchi' | 'genre' | 'tag', n: the genre's or tag's name, r: the tag's rank }. mark: 1 (you said it always
// counts), 0 (never), anything else (Tsugi decides).
function nsfwWhy(f, set, kind, mark) {
  if (mark === 0) return null;
  if (mark === 1) return [{ k: 'mark' }];
  const d = set && set[kind === 'MANGA' ? 'MANGA' : 'ANIME'];
  if (!d || !f) return null;
  const out = [];
  if (d.adult && f.a) out.push({ k: 'adult' });
  const genres = f.g || [];
  if (d.ecchi && genres.includes('Ecchi')) out.push({ k: 'ecchi' });
  for (const g of d.genres) if (genres.includes(g) && !(g === 'Ecchi' && d.ecchi)) out.push({ k: 'genre', n: g });
  if (f.t && (d.tags || d.own.length)) {
    const own = new Map(d.own);
    const tags = f.t.filter(([, r]) => r >= d.rank).sort((x, y) => y[1] - x[1]);
    for (const [id, r] of tags) {
      if (own.has(id)) out.push({ k: 'tag', n: own.get(id), r });
      else if (d.tags && NSFW_ADULT.has(id)) out.push({ k: 'tag', n: NSFW_ADULT.get(id), r });
    }
  }
  return out.length ? out : null;
}

// One reason in words: "Marked 18+", "Ecchi", "Feet 82%", "You marked it".
function nsfwWord(w) {
  if (w.k === 'mark') return 'You marked it';
  if (w.k === 'adult') return 'Marked 18+';
  if (w.k === 'ecchi') return 'Ecchi';
  if (w.k === 'genre') return w.n;
  return `${w.n} ${w.r}%`;
}

/* What's stored ------------------------------------------------------------------------------------------- */

function nsfwMarksClean(m) {
  const out = {};
  for (const [k, v] of Object.entries(m && typeof m === 'object' ? m : {})) {
    const id = Number(k);
    if (Number.isInteger(id) && id > 0 && (v === 0 || v === 1)) out[id] = v;
  }
  return out;
}
// The newer of sync and local (a long list of marks goes to this computer's storage, like "cprio:").
async function nsfwReadMarks() {
  let best = null;
  for (const area of ['sync', 'local']) {
    try {
      const v = (await chrome.storage[area].get('nsfw:marks'))['nsfw:marks'];
      if (v && v.m && (!best || (Number(v.t) || 0) > (Number(best.t) || 0))) best = v;
    } catch { /* the extension was reloaded */ }
  }
  return nsfwMarksClean(best && best.m);
}
async function nsfwWriteMarks(marks) {
  const v = { m: nsfwMarksClean(marks), t: Date.now() };
  try { await chrome.storage[JSON.stringify(v).length > 7800 ? 'local' : 'sync'].set({ 'nsfw:marks': v }); } catch { /* ignore */ }
}

async function nsfwReadMade() {
  try { return (await chrome.storage.local.get('nsfw:made'))['nsfw:made'] || {}; } catch { return {}; }
}
// list: [{ id, k }]. pub: made public again (only the ones Tsugi made private are noted as such). back: { id: what
// the record was before, or null } (Undo puts them back exactly).
async function nsfwNoteMade(list, { pub = false, back = null } = {}) {
  const made = await nsfwReadMade();
  const now = Date.now();
  if (back) {
    for (const [id, rec] of Object.entries(back)) { if (rec) made[id] = rec; else delete made[id]; }
  } else {
    for (const x of list || []) {
      if (pub) { if (made[x.id]) made[x.id] = { ...made[x.id], pub: now }; }
      else made[x.id] = { k: x.k === 'MANGA' ? 'MANGA' : 'ANIME', at: now };
    }
  }
  try { await chrome.storage.local.set({ 'nsfw:made': made }); } catch { /* ignore */ }
  return made;
}

// "Keep new ones private": the kind ('ANIME' / 'MANGA') when the title you're adding should be private, else null.
// media: what's known of it (AniList's media, with type); fetch(mediaId): AniList's media with NSFW_MEDIA_QUERY's
// fields, asked only when what's known isn't enough (or the kind isn't known).
async function nsfwAddPrivate({ set, marks, mediaId, kind = null, media = null, fetch }) {
  if (!nsfwKeeps(set)) return null;
  let k = kind || (media && media.type) || null;
  if (k && !set.keep[k]) return null;
  const mark = (marks || {})[mediaId];
  if (mark === 0) return null;
  let f = media ? nsfwFacts(media) : null;
  if (!k || (mark !== 1 && !nsfwKnows(f, set, k))) {
    let m = null;
    try { m = await fetch(mediaId); } catch { m = null; }
    if (!m) return null;
    k = m.type === 'MANGA' ? 'MANGA' : 'ANIME';
    f = nsfwFacts(m);
    if (!set.keep[k]) return null;
  }
  return nsfwWhy(f, set, k, mark) ? k : null;
}
