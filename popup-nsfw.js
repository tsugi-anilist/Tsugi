// Tsugi: NSFW titles in the toolbar popup (0.12.3). Loaded after popup-trackers.js, sharing popup.js's scope (state, h,
// icon, render, send...). Two parts:
// - Settings, NSFW titles: what counts (nsfw.js; anime and manga apart), then making them private, keeping new ones
//   private, and making them public again. The counts are worked out here from the background's reading of your lists
//   (privacy.js, session "nsfw:job"), so they follow each switch at once.
// - The page over Settings (like Compare): the titles with why each counts, ticks, Apply with Undo. MyAnimeList has no
//   private titles: its copies stay public there unless you tick removing them.
// A title's own page here has "Counts as NSFW" in Edit details (always, never, or Tsugi decides).
'use strict';

state.nsfw = {
  set: nsfwNormalize({}),
  marks: {},          // mediaId -> 1 (always counts) | 0 (never)
  made: {},           // the titles Tsugi made private (local "nsfw:made")
  undo: null,         // the last Apply, while it can be undone (local "nsfw:undo")
  tab: 'ANIME',       // the kind shown in Settings (local "popup:nsfwTab")
  job: null,          // the background's reading of your lists, and what it's doing (session "nsfw:job")
  page: null,         // the page over Settings: { mode: 'private' | 'public', kind: 'ANIME' | 'MANGA' | 'BOTH', which: 'made' | 'all' }
  picks: {},          // 'mode:mediaId' -> ticked (only your changes to the defaults)
  mal: true,          // titles going private leave MyAnimeList too
  all: false,         // every row shown
  tags: null,         // AniList's genres and tags, to add your own (local "nsfw:tags", kept a week)
  adding: null,       // the box adding a genre or tag: { q, i (the suggestion under the keyboard), loading, error }
  msg: null,          // { kind, text } on the page
};

const NSFW_TAGS_QUERY = 'query TsugiNsfwTags { GenreCollection MediaTagCollection { id name isAdult } }';
const NSFW_TAGS_TTL = 7 * 864e5;
const NSFW_FRESH_MS = 10 * 60e3;   // a reading younger than this isn't asked again when the group opens
const NSFW_STALE_MS = 15 * 60e3;   // the background's own limit for Apply (privacy.js)
const NSFW_STUCK_MS = 90e3;        // a reading that hasn't moved for this long stopped (the worker restarted)
const NSFW_ROWS = 60;              // rows shown before "Show all"
const NSFW_WORD = { ANIME: 'anime', MANGA: 'manga' };

// The group sits after On AniList.
SET_GROUPS.splice(SET_GROUPS.findIndex((g) => g.key === 'anilist') + 1, 0, { key: 'nsfw', label: 'NSFW titles', body: nsfwBody, summary: nsfwSummary, open: nsfwOpened });

/* Loading and following -------------------------------------------------------------------------------------- */

async function nsfwStart() {
  const N = state.nsfw;
  let sy = {};
  try { sy = await chrome.storage.sync.get('nsfw'); } catch { /* ignore */ }
  N.set = nsfwNormalize(sy.nsfw);
  N.marks = await nsfwReadMarks();
  N.made = await nsfwReadMade();
  const lo = await chrome.storage.local.get(['popup:nsfwTab', 'nsfw:tags', 'nsfw:undo']);
  if (lo['popup:nsfwTab'] === 'MANGA') N.tab = 'MANGA';
  const tg = lo['nsfw:tags'];
  if (tg && tg.at && Date.now() - tg.at < NSFW_TAGS_TTL) N.tags = tg;
  N.undo = lo['nsfw:undo'] || null;
  try { N.job = (await chrome.storage.session.get('nsfw:job'))['nsfw:job'] || null; } catch { N.job = null; }
  if (state.view === 'settings' && state.setOpen === 'nsfw') nsfwOpened();
}

// Saved at once, its own echo ignored (a second click within a moment isn't undone by the first one's notice).
const nsfwOwn = [];
function nsfwSaveSet(next) {
  const N = state.nsfw;
  N.set = nsfwNormalize(next);
  const now = Date.now();
  while (nsfwOwn.length && now - nsfwOwn[0].t > 5000) nsfwOwn.shift();
  nsfwOwn.push({ json: stableJSON(N.set), t: now });
  try { chrome.storage.sync.set({ nsfw: N.set }).catch(() => {}); } catch { /* the extension was reloaded */ }
  render();
}
function nsfwPatch(kind, patch) {
  const s = state.nsfw.set;
  nsfwSaveSet({ ...s, [kind]: { ...s[kind], ...patch } });
}
async function nsfwMark(id, v) {
  const N = state.nsfw;
  const was = N.marks[id];
  const next = { ...N.marks };
  if (v === 0 || v === 1) next[id] = v; else delete next[id];
  N.marks = next;
  render();
  await nsfwWriteMarks(next);
  return was;
}

chrome.storage.onChanged.addListener((changes, area) => {
  const N = state.nsfw;
  let draw = false;
  if (area === 'sync' && changes.nsfw) {
    const v = nsfwNormalize(changes.nsfw.newValue);
    const json = stableJSON(v);
    const i = nsfwOwn.findIndex((w) => w.json === json && Date.now() - w.t < 5000);
    if (i >= 0) nsfwOwn.splice(0, i + 1);
    else if (json !== stableJSON(N.set)) { N.set = v; draw = true; }
  }
  if ((area === 'sync' || area === 'local') && changes['nsfw:marks']) nsfwReadMarks().then((m) => { if (stableJSON(m) !== stableJSON(N.marks)) { N.marks = m; render(); } });
  if (area === 'local' && changes['nsfw:made']) { N.made = changes['nsfw:made'].newValue || {}; draw = true; }
  if (area === 'local' && changes['nsfw:undo']) { N.undo = changes['nsfw:undo'].newValue || null; draw = true; }
  if (area === 'session' && changes['nsfw:job']) {
    const was = N.job;
    N.job = changes['nsfw:job'].newValue || null;
    draw = state.view === 'settings';
    // Titles made private or public: the lists shown here are read again, quietly, and the page's ticks start over.
    if (N.job && was && ['applying', 'undoing'].includes(was.phase) && ['done', 'undone'].includes(N.job.phase)) { markStale(); N.picks = {}; }
  }
  if (draw && state.view === 'settings') render();
});

const nsfwRunning = (j) => !!j && ['reading', 'applying', 'undoing'].includes(j.phase);
const nsfwStuck = (j) => nsfwRunning(j) && Date.now() - (j.beat || j.at) > NSFW_STUCK_MS;
const nsfwHasRows = (j) => !!j && ['ready', 'done', 'undone', 'applying', 'undoing'].includes(j.phase) && Array.isArray(j.rows);

// Settings' group opened: your lists are read, unless a recent reading is there (or one runs).
function nsfwOpened() {
  const j = state.nsfw.job;
  if (nsfwRunning(j) && !nsfwStuck(j)) return;
  if (nsfwHasRows(j) && Date.now() - j.at < NSFW_FRESH_MS) return;
  nsfwScan();
}
function nsfwScan() {
  const N = state.nsfw;
  N.msg = null;
  N.job = { phase: 'reading', at: Date.now(), beat: Date.now(), n: 0, rows: [] };
  render();
  send({ type: 'nsfw:scan' }).then((res) => { if (!res.ok) { N.job = { phase: 'error', at: Date.now(), error: res.error, rows: [] }; render(); } });
}

/* Counting --------------------------------------------------------------------------------------------------- */

const nsfwWhyRow = (r) => nsfwWhy({ a: r.a, g: r.g, t: r.tg }, state.nsfw.set, r.k, state.nsfw.marks[r.id]);
const nsfwRowsOf = (kind) => { const j = state.nsfw.job; return nsfwHasRows(j) ? j.rows.filter((r) => kind === 'BOTH' || r.k === kind) : []; };
const nsfwMadeNow = (r) => { const m = state.nsfw.made[r.id]; return !!m && !m.pub; };
// What the page lists: NSFW titles still public (private mode), or private titles (public mode: the ones Tsugi made
// private, or every one).
function nsfwListed(p) {
  const rows = nsfwRowsOf(p.kind);
  if (p.mode === 'private') return rows.filter((r) => !r.pv).map((r) => ({ r, why: nsfwWhyRow(r) })).filter((x) => x.why);
  return rows.filter((r) => r.pv && (p.which === 'all' || nsfwMadeNow(r))).map((r) => ({ r, why: null }));
}
function nsfwCounts(kind) {
  const rows = nsfwRowsOf(kind);
  let nsfw = 0, pub = 0, priv = 0, made = 0;
  for (const r of rows) {
    if (r.pv) { priv++; if (nsfwMadeNow(r)) made++; }
    if (nsfwWhyRow(r)) { nsfw++; if (!r.pv) pub++; }
  }
  return { nsfw, pub, priv, made, total: rows.length };
}

/* Settings: the group ---------------------------------------------------------------------------------------- */

// "18+, Ecchi, 18+ tags, 2 of yours": what counts for a kind, in a few words.
function nsfwWords(d) {
  const out = [];
  if (d.adult) out.push('18+');
  if (d.ecchi) out.push('Ecchi');
  if (d.tags) out.push('18+ tags');
  const own = d.genres.length + d.own.length;
  if (own) out.push(own === 1 ? '1 of yours' : `${own} of yours`);
  return out.length ? out.join(', ') : 'Only titles you mark';
}
function nsfwSummary() {
  const s = state.nsfw.set;
  const a = nsfwWords(s.ANIME);
  const m = nsfwWords(s.MANGA);
  const out = a === m ? [h('span', {}, a)] : [h('span', {}, `Anime: ${a}`), h('span', {}, `Manga: ${m}`)];
  if (s.keep.ANIME || s.keep.MANGA) out.push(h('span', {}, s.keep.ANIME && s.keep.MANGA ? 'New ones private' : `New ${s.keep.ANIME ? 'anime' : 'manga'} private`));
  return out;
}

// A whole-line switch, like Settings' own (setSwitch), for one kind's choice.
function nsfwSwitch(key, label, note, on, run) {
  return h('button', {
    class: 'set-sw', role: 'switch', 'aria-checked': String(on), 'data-f': `nsfw:k:${key}`, 'data-nav': '', onclick: run,
  }, h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, label), note ? h('span', { class: 'set-d' }, note) : null),
  h('span', { class: 'tp-switch' + (on ? ' is-on' : ''), 'aria-hidden': 'true' }));
}

function nsfwBody() {
  const N = state.nsfw;
  const k = N.tab;
  const d = N.set[k];
  const word = NSFW_WORD[k];
  const tab = h('div', { class: 'seg nsfw-tab', role: 'radiogroup', 'aria-label': 'Which list' },
    NSFW_KINDS.map((x) => h('button', {
      class: 'seg-btn', role: 'radio', 'aria-checked': String(x === k), 'data-f': `nsfw:tab:${x}`, 'data-nav': '',
      onclick: () => { N.tab = x; N.adding = null; try { chrome.storage.local.set({ 'popup:nsfwTab': x }); } catch { /* ignore */ } render(); },
    }, x === 'ANIME' ? 'Anime' : 'Manga')));
  return [
    h('div', { class: 'set-f nsfw-top' },
      h('p', { class: 'set-d' }, 'What counts as NSFW, for Hide NSFW titles, the NSFW filter on your lists and keeping titles private. Private titles show only to you on AniList.'),
      tab),
    subhead('What counts'),
    nsfwSwitch('adult', 'Marked 18+ on AniList', 'AniList\'s own mark. Only hentai has it.', d.adult, () => nsfwPatch(k, { adult: !d.adult })),
    nsfwSwitch('ecchi', 'Ecchi', 'AniList\'s Ecchi genre: fan service and suggestive scenes.', d.ecchi, () => nsfwPatch(k, { ecchi: !d.ecchi })),
    nsfwSwitch('tags', 'AniList\'s 18+ tags', `${NSFW_ADULT.size} tags, Feet and Bondage among them, once AniList's voters rank one at ${d.rank}% or more. A few serious stories have one too: Banana Fish has Rape at 84%.`, d.tags, () => nsfwPatch(k, { tags: !d.tags })),
    d.tags || d.own.length ? h('div', { class: 'set-f' },
      h('div', { class: 'set-t', id: 'nsfw-l-rank' }, 'A tag counts from'),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': 'nsfw-l-rank' }, NSFW_RANKS.map((r) => h('button', {
        class: 'seg-btn', role: 'radio', 'aria-checked': String(d.rank === r), 'data-f': `nsfw:rank:${r}`, 'data-nav': '', onclick: () => nsfwPatch(k, { rank: r }),
      }, `${r}%`))),
      h('div', { class: 'set-d' }, 'How strongly a tag applies to the title, as AniList\'s voters rank it. A passing mention ranks low.')) : null,
    nsfwOwnField(k, d),
    nsfwMarksNote(),
    subhead('Private'),
    nsfwPrivateRow(k, word),
    nsfwSwitch('keep', 'Keep new ones private', N.set.keep[k]
      ? `An NSFW ${word} you add becomes private by itself: here, on AniList (its own buttons too) and from your trackers.`
      : `Off: ${word === 'anime' ? 'anime' : 'manga'} you add stay public until you make them private.`, !!N.set.keep[k],
    () => nsfwSaveSet({ ...N.set, keep: { ...N.set.keep, [k]: N.set.keep[k] ? 0 : Date.now() } })),
    nsfwPublicRow(k, word),
  ];
}

// The reading of your lists, as the rows under Private say it.
function nsfwJobLine() {
  const j = state.nsfw.job;
  if (!j || (nsfwRunning(j) && !nsfwHasRows(j)) || (j.phase === 'reading')) {
    if (j && nsfwStuck(j)) return h('span', { class: 'set-d is-warn' }, 'Reading your lists stopped before the end.');
    return h('span', { class: 'set-d nsfw-reading' }, spin(), j && j.n ? `Reading your lists: ${j.n.toLocaleString()} titles so far` : 'Reading your lists');
  }
  if (j.phase === 'error') return h('span', { class: 'set-d is-warn' }, j.error || 'Couldn\'t read your lists.');
  return null;
}

function nsfwPrivateRow(k, word) {
  const busy = nsfwJobLine();
  const c = busy ? null : nsfwCounts(k);
  const j = state.nsfw.job;
  let text;
  if (busy) text = busy;
  else if (!c.nsfw) text = h('span', { class: 'set-d' }, `None of your ${word} counts as NSFW with these choices.`);
  else if (!c.pub) text = h('span', { class: 'set-d' }, `All ${c.nsfw === 1 ? `1 NSFW ${word}` : `${c.nsfw} NSFW ${word}`} on your list ${c.nsfw === 1 ? 'is' : 'are'} private.`);
  else if (c.pub === c.nsfw) text = h('span', { class: 'set-d' }, h('b', { class: 'nsfw-n' }, String(c.pub)), ` NSFW ${word} on your list ${c.pub === 1 ? 'is' : 'are'} public. Review them, then make them private.`);
  else text = h('span', { class: 'set-d' }, h('b', { class: 'nsfw-n' }, String(c.pub)), ` of your ${c.nsfw} NSFW ${word} ${c.pub === 1 ? 'is' : 'are'} public. Review them, then make them private.`);
  const again = j && (j.phase === 'error' || nsfwStuck(j));
  return h('div', { class: 'set-f set-row' },
    h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, 'Make them private'), text),
    again ? h('button', { class: 'tp-btn', 'data-f': 'nsfw:read', 'data-nav': '', onclick: nsfwScan }, 'Read again')
      : h('button', { class: 'tp-btn' + (c && c.pub ? ' is-ink' : ''), 'data-f': 'nsfw:review', 'data-nav': '', disabled: !c || !c.pub, onclick: () => nsfwOpenPage('private', k) }, 'Review'));
}

function nsfwPublicRow(k, word) {
  const busy = nsfwJobLine();
  const c = busy ? null : nsfwCounts(k);
  let text = null;
  if (c) {
    text = !c.priv ? `None of your ${word} is private.`
      : c.made ? `${c.made === 1 ? '1 made private by Tsugi' : `${c.made} made private by Tsugi`}, ${c.priv} private in all.`
        : `${c.priv === 1 ? `1 ${word} is` : `${c.priv} ${word} are`} private. Tsugi made none of them private.`;
  }
  return h('div', { class: 'set-f set-row' },
    h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, 'Make them public again'), text ? h('span', { class: 'set-d' }, text) : null),
    h('button', { class: 'tp-btn', 'data-f': 'nsfw:public', 'data-nav': '', disabled: !c || !c.priv, onclick: () => nsfwOpenPage('public', k) }, 'Review'));
}

function nsfwMarksNote() {
  const v = Object.values(state.nsfw.marks);
  const yes = v.filter((x) => x === 1).length;
  const no = v.length - yes;
  if (!v.length) return h('p', { class: 'set-d nsfw-marks' }, 'A title\'s page here can say it always counts, or never does (Edit details).');
  const parts = [];
  if (yes) parts.push(yes === 1 ? '1 title you marked always counts' : `${yes} titles you marked always count`);
  if (no) parts.push(no === 1 ? `${yes ? '1' : '1 title you marked'} never does` : `${no}${yes ? '' : ' titles you marked'} never do`);
  return h('p', { class: 'set-d nsfw-marks' }, `${parts.join(', ')}. Change it on a title's page here, in Edit details.`);
}

/* Your own genres and tags ----------------------------------------------------------------------------------- */

async function nsfwLoadTags() {
  const N = state.nsfw;
  if (N.tags || (N.adding && N.adding.loading)) return;
  if (N.adding) { N.adding.loading = true; N.adding.error = null; }
  render();
  try {
    const d = await gql(NSFW_TAGS_QUERY, {});
    N.tags = {
      at: Date.now(),
      genres: (d.GenreCollection || []).filter(Boolean).map(String),
      tags: (d.MediaTagCollection || []).filter((t) => t && t.id && t.name).map((t) => [t.id, t.name, !!t.isAdult]),
    };
    try { chrome.storage.local.set({ 'nsfw:tags': N.tags }); } catch { /* ignore */ }
  } catch (err) {
    if (N.adding) N.adding.error = `Couldn't get AniList's genres and tags: ${err.message}`;
  }
  if (N.adding) N.adding.loading = false;
  render();
}

// Up to 8 genres and tags matching what's typed, the ones starting with it first; genres before tags.
function nsfwMatches(k) {
  const N = state.nsfw;
  const d = N.set[k];
  const q = (N.adding.q || '').trim().toLowerCase();
  if (!N.tags || !q) return [];
  const have = new Set([...d.genres.map((g) => `g:${g}`), ...d.own.map((t) => `t:${t[0]}`)]);
  const all = [...N.tags.genres.map((g) => ({ t: 'g', n: g })), ...N.tags.tags.map(([id, n, adult]) => ({ t: 't', id, n, adult }))];
  const hits = all.filter((x) => !have.has(x.t === 'g' ? `g:${x.n}` : `t:${x.id}`) && x.n.toLowerCase().includes(q));
  const rank = (x) => (x.n.toLowerCase().startsWith(q) ? 0 : 1) * 2 + (x.t === 'g' ? 0 : 1);
  return hits.sort((a, b) => rank(a) - rank(b) || a.n.localeCompare(b.n)).slice(0, 8);
}
function nsfwAddOwn(k, x) {
  const d = state.nsfw.set[k];
  if (x.t === 'g') nsfwPatch(k, { genres: [...d.genres, x.n] });
  else nsfwPatch(k, { own: [...d.own, [x.id, x.n]] });
  state.nsfw.adding = null;
  render();
  const b = app.querySelector('[data-f="nsfw:add"]');
  if (b) b.focus({ preventScroll: true });
}
function nsfwDropOwn(k, x) {
  const d = state.nsfw.set[k];
  if (x.t === 'g') nsfwPatch(k, { genres: d.genres.filter((g) => g !== x.n) });
  else nsfwPatch(k, { own: d.own.filter((t) => t[0] !== x.id) });
}

function nsfwOwnField(k, d) {
  const N = state.nsfw;
  const items = [...d.genres.map((n) => ({ t: 'g', n })), ...d.own.map(([id, n]) => ({ t: 't', id, n }))];
  const chips = items.map((x) => h('span', { class: 'nsfw-chip' }, h('span', {}, x.n),
    h('button', { class: 'nsfw-chip-x', 'data-f': `nsfw:drop:${x.t}:${x.t === 'g' ? x.n : x.id}`, 'aria-label': `Take out ${x.n}`, title: 'Take out', onclick: () => nsfwDropOwn(k, x) }, icon('close'))));
  let adder;
  if (!N.adding) {
    adder = h('button', { class: 'nsfw-add', 'data-f': 'nsfw:add', 'data-nav': '', onclick: () => { N.adding = { q: '', i: 0 }; render(); const b = app.querySelector('.nsfw-add-input'); if (b) b.focus(); nsfwLoadTags(); } },
      icon('plus'), items.length ? 'Add' : 'Add a genre or tag');
  } else {
    const hits = nsfwMatches(k);
    const input = h('input', {
      class: 'input nsfw-add-input', type: 'text', value: N.adding.q, 'data-f': 'nsfw:add:q', spellcheck: 'false', autocomplete: 'off',
      placeholder: 'A genre or tag, like Nudity', 'aria-label': 'Add a genre or tag', role: 'combobox', 'aria-expanded': String(hits.length > 0), 'aria-controls': 'nsfw-hits',
      oninput: (ev) => { N.adding.q = ev.target.value; N.adding.i = 0; render(); },
      onkeydown: (ev) => {
        const n = nsfwMatches(k).length;
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); if (n) { N.adding.i = (N.adding.i + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n; render(); } }
        else if (ev.key === 'Enter') { ev.preventDefault(); const x = nsfwMatches(k)[N.adding.i]; if (x) nsfwAddOwn(k, x); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); N.adding = null; render(); const b = app.querySelector('[data-f="nsfw:add"]'); if (b) b.focus(); }
      },
    });
    let list = null;
    if (N.adding.loading && !N.tags) list = h('div', { class: 'nsfw-hit-note' }, spin(), 'Getting AniList\'s genres and tags');
    else if (N.adding.error) list = h('div', { class: 'nsfw-hit-note is-bad' }, N.adding.error);
    else if (N.adding.q.trim() && !hits.length) list = h('div', { class: 'nsfw-hit-note' }, 'No genre or tag by that name on AniList.');
    else if (hits.length) {
      list = h('div', { class: 'nsfw-hits', id: 'nsfw-hits', role: 'listbox' }, hits.map((x, i) => h('button', {
        class: 'nsfw-hit' + (i === N.adding.i ? ' is-on' : ''), role: 'option', 'aria-selected': String(i === N.adding.i), tabindex: '-1',
        onclick: () => nsfwAddOwn(k, x), onpointerenter: () => { if (N.adding && N.adding.i !== i) { N.adding.i = i; render(); } },
      }, h('span', { class: 'nsfw-hit-n' }, x.n), h('span', { class: 'nsfw-hit-k' }, x.t === 'g' ? 'Genre' : x.adult ? '18+ tag' : 'Tag'))));
    }
    adder = h('div', { class: 'nsfw-adding' }, h('div', { class: 'field' }, input,
      h('button', { class: 'btn', 'data-f': 'nsfw:add:cancel', onclick: () => { N.adding = null; render(); } }, 'Cancel')), list);
  }
  return h('div', { class: 'set-f' },
    h('div', { class: 'set-t' }, 'Your own genres and tags'),
    h('div', { class: 'set-d' }, d.own.length || d.genres.length
      ? `A genre counts whenever a title has it; a tag from ${d.rank}%, like AniList's 18+ tags.`
      : 'Anything else you\'d rather keep to yourself: Harem, Nudity, Yaoi...'),
    chips.length || !N.adding ? h('div', { class: 'nsfw-chips' }, chips, N.adding ? null : adder) : null,
    N.adding ? adder : null);
}

/* The page over Settings: review, then Apply ----------------------------------------------------------------- */

function nsfwOpenPage(mode, kind) {
  const N = state.nsfw;
  N.page = { mode, kind, which: mode === 'public' && nsfwCounts(kind).made ? 'made' : 'all' };
  N.picks = {};
  N.all = false;
  N.msg = null;
  state.view = 'settings';
  closeTransient();
  scrollPos['nsfw:page'] = 0;
  const j = N.job;
  if (!nsfwRunning(j) && (!nsfwHasRows(j) || Date.now() - j.at > NSFW_FRESH_MS)) nsfwScan();
  else render();
}
function nsfwClosePage() {
  const N = state.nsfw;
  const mode = N.page && N.page.mode;
  N.page = null;
  state.setOpen = 'nsfw';
  render();
  const b = app.querySelector(`[data-f="nsfw:${mode === 'public' ? 'public' : 'review'}"]`) || app.querySelector('[data-f="set:nsfw"]');
  if (b) b.focus({ preventScroll: true });
}
function nsfwSetPage(patch) {
  const N = state.nsfw;
  N.page = { ...N.page, ...patch };
  N.all = false;
  render();
}

const nsfwPicked = (mode, r) => { const v = state.nsfw.picks[`${mode}:${r.id}`]; return v === undefined ? true : v; };
const nsfwTicked = (p) => nsfwListed(p).filter((x) => nsfwPicked(p.mode, x.r)).map((x) => x.r);

async function nsfwApplyNow() {
  const N = state.nsfw;
  const p = N.page;
  const j = N.job;
  if (!p || !j || nsfwRunning(j)) return;
  if (Date.now() - j.at > NSFW_STALE_MS) { nsfwScan(); return; }
  const rows = nsfwTicked(p);
  if (!rows.length) return;
  const toPrivate = p.mode === 'private';
  const mal = toPrivate && N.mal && nsfwMalShown() && rows.some((r) => r.mal);
  N.msg = null;
  N.job = { ...j, phase: 'applying', step: 'al', n: 0, of: rows.length };
  render();
  const res = await send({ type: 'nsfw:apply', ids: rows.map((r) => r.id), pv: toPrivate, mal });
  if (!res.ok) {
    N.job = { ...j };
    N.msg = { kind: 'error', text: res.error || 'That didn\'t work. Try again in a moment.' };
    if (res.stale) nsfwScan(); else render();
  }
}
async function nsfwUndoNow() {
  const N = state.nsfw;
  const res = await send({ type: 'nsfw:undo' });
  if (!res.ok) { N.msg = { kind: 'error', text: res.error || 'That couldn\'t be undone.' }; render(); }
}

// MyAnimeList is connected: its copies of titles going private are worth a word.
const nsfwMalShown = () => !!(state.trk && state.trk.acct && state.trk.acct.mal);
const nsfwMbShown = () => !!(state.trk && state.trk.acct && state.trk.acct.mb);

function nsfwRow(p, x, ready) {
  const N = state.nsfw;
  const r = x.r;
  const on = nsfwPicked(p.mode, r);
  const key = `${p.mode}:${r.id}`;
  let detail;
  if (p.mode === 'private') detail = x.why.map((w) => h('span', { class: 'cmp-diff nsfw-why' }, nsfwWord(w)));
  else {
    const m = N.made[r.id];
    detail = [h('span', { class: 'cmp-piece' }, m && !m.pub ? `Made private by Tsugi ${ago(m.at)}` : 'Private')];
  }
  const meta = [r.f ? FORMATS[r.f] || r.f : null, r.y].filter(Boolean);
  return h('div', { class: 'cmp-row nsfw-row', 'data-id': r.id, style: r.col ? `--c:${r.col}` : null },
    ready ? h('button', {
      class: 'cmp-tick', role: 'checkbox', 'aria-checked': String(on), 'data-f': `nsfw:t:${r.id}`, 'data-nav': '', 'aria-label': r.t,
      onclick: () => { N.picks[key] = !on; render(); },
    }, on ? icon('check') : null) : h('span', { class: 'cmp-gap' }),
    h('span', { class: 'cmp-cover nsfw-veil' }, r.c ? cover(r.c) : null),
    h('div', { class: 'cmp-text' },
      h('div', { class: 'cmp-title' }, r.t),
      meta.length || (p.kind === 'BOTH') ? h('div', { class: 'nsfw-meta' }, p.kind === 'BOTH' ? h('span', {}, r.k === 'MANGA' ? 'Manga' : 'Anime') : null, meta.map((t) => h('span', {}, String(t)))) : null,
      h('div', { class: 'cmp-diffs' }, detail),
      p.mode === 'private' && r.mal && nsfwMalShown() ? h('div', { class: 'cmp-note' }, 'Also on MyAnimeList') : null),
    p.mode === 'private' && ready ? h('button', {
      class: 'trk-quiet nsfw-not', 'data-f': `nsfw:not:${r.id}`, 'data-nav': '', 'aria-label': `${r.t} isn't NSFW`,
      onclick: async () => {
        const was = await nsfwMark(r.id, 0);
        toast(`${r.t} never counts as NSFW now`, { coverImage: { color: r.col } }, { undo: () => nsfwMark(r.id, was) });
      },
    }, 'Not NSFW') : null);
}

function nsfwFoot(p, listed) {
  const N = state.nsfw;
  const j = N.job;
  const toPrivate = p.mode === 'private';
  if (nsfwRunning(j) && j.phase !== 'reading') {
    const what = j.phase === 'undoing'
      ? (j.step === 'mal' ? 'Putting them back on MyAnimeList' : 'Putting them back')
      : j.step === 'mal' ? 'Removing them from MyAnimeList' : toPrivate ? 'Making them private' : 'Making them public';
    return h('div', { class: 'cmp-foot' }, h('span', { class: 'cmp-wait' }, nsfwStuck(j) ? icon('clock') : spin(),
      h('span', {}, nsfwStuck(j) ? 'This stopped before the end.' : `${what}: ${j.n} of ${j.of}`)),
    nsfwStuck(j) ? h('button', { class: 'trk-quiet', onclick: nsfwScan }, 'Read again') : null);
  }
  const n = listed.filter((x) => nsfwPicked(p.mode, x.r)).length;
  const label = !n ? 'Nothing ticked' : toPrivate ? `Make ${n === 1 ? '1 title' : `${n} titles`} private` : `Make ${n === 1 ? '1 title' : `${n} titles`} public`;
  return h('div', { class: 'cmp-foot' },
    h('button', { class: 'btn is-primary', 'data-f': 'nsfw:apply', disabled: !n, onclick: nsfwApplyNow }, label),
    h('span', { class: 'cmp-foot-note' }, `Read ${ago(j.at)}`),
    h('button', { class: 'trk-quiet', 'data-f': 'nsfw:again', onclick: nsfwScan }, 'Read again'));
}

// What the last Apply did, with Undo while it's the last one.
function nsfwDone(p) {
  const N = state.nsfw;
  const j = N.job;
  if (!j || !['done', 'undone'].includes(j.phase) || !j.res) return null;
  const r = j.res;
  if (j.phase === 'undone') {
    return h('div', { class: 'banner is-ok', role: 'status' }, icon('check'),
      h('span', {}, `Back as it was${r.undoFailed ? `, except ${r.undoFailed === 1 ? '1 title' : `${r.undoFailed} titles`}` : ''}.${r.malBack ? ` ${r.malBack === 1 ? '1 title is' : `${r.malBack} titles are`} back on MyAnimeList.` : ''}`));
  }
  const n = (x) => (x === 1 ? '1 title' : `${x} titles`);
  let text = r.pv ? `${n(r.ok)} ${r.ok === 1 ? 'is' : 'are'} private now: on AniList, only you see ${r.ok === 1 ? 'it' : 'them'}.` : `${n(r.ok)} ${r.ok === 1 ? 'is' : 'are'} public again.`;
  if (r.mal) text += ` ${r.mal === 1 ? '1 left' : `${r.mal} left`} MyAnimeList (the Sync log has ${r.mal === 1 ? 'it' : 'them'}).`;
  if (r.failed) text += ` ${n(r.failed)} couldn't be changed${r.error ? `: ${r.error}` : ''}.`;
  if (r.malFailed) text += ` ${n(r.malFailed)} couldn't be removed from MyAnimeList.`;
  const can = j.undo && N.undo;
  return h('div', { class: 'banner ' + (r.failed || !r.ok ? 'is-error' : 'is-ok'), role: 'status' }, icon(r.failed || !r.ok ? 'alert' : 'check'),
    h('span', {}, text), can ? h('button', { 'data-f': 'nsfw:undo', onclick: nsfwUndoNow }, 'Undo') : null);
}

function nsfwPageView() {
  const N = state.nsfw;
  const p = N.page;
  if (!p) return null;
  const j = N.job;
  const toPrivate = p.mode === 'private';
  const seg = h('div', { class: 'seg is-small', role: 'radiogroup', 'aria-label': 'Which list' },
    [['ANIME', 'Anime'], ['MANGA', 'Manga'], ['BOTH', 'Both']].map(([k, label]) => h('button', {
      class: 'seg-btn', role: 'radio', 'aria-checked': String(p.kind === k), 'data-f': `nsfw:kind:${k}`, 'data-nav': '',
      disabled: nsfwRunning(j) && j.phase !== 'reading', onclick: () => nsfwSetPage({ kind: k }),
    }, label)));
  const head = [
    h('button', { class: 'cmp-back', 'data-f': 'nsfw:back', 'data-nav': '', onclick: nsfwClosePage }, icon('back'), 'Settings'),
    h('header', { class: 'sec-head cmp-head' }, h('h2', { class: 'sec-title' }, toPrivate ? 'Make NSFW titles private' : 'Make private titles public'), seg),
    h('p', { class: 'cmp-lead' }, toPrivate
      ? 'Ticked titles become private: on AniList, only you see them on your profile and lists. Nothing else about them changes.'
      : 'Ticked titles become public again: shown on your profile and lists like the rest.'),
    N.msg ? h('div', { class: `msg is-${N.msg.kind}`, role: 'alert' }, N.msg.text) : null,
  ];
  if (!nsfwHasRows(j) || j.phase === 'reading') {
    return h('div', { class: 'cmp nsfw-page' }, head,
      j && j.phase === 'error' ? h('div', { class: 'banner is-error', role: 'alert' }, icon('alert'), h('span', {}, j.error), h('button', { 'data-f': 'nsfw:again', onclick: nsfwScan }, 'Read again'))
        : nsfwStuck(j) ? h('div', { class: 'banner is-wait' }, icon('clock'), h('span', {}, 'This stopped before the end.'), h('button', { onclick: nsfwScan }, 'Read again'))
          : h('div', { class: 'cmp-wait' }, spin(), h('span', {}, j && j.n ? `Reading your lists: ${j.n.toLocaleString()} titles so far` : 'Reading your anime and manga lists')));
  }
  const ready = !nsfwRunning(j);
  const listed = nsfwListed(p).sort((a, b) => a.r.t.localeCompare(b.r.t));
  const parts = [];
  if (!toPrivate) {
    const c = nsfwCounts(p.kind);
    parts.push(h('div', { class: 'seg nsfw-which', role: 'radiogroup', 'aria-label': 'Which titles' },
      [['made', `Made private by Tsugi (${c.made})`], ['all', `Every private title (${c.priv})`]].map(([w, label]) => h('button', {
        class: 'seg-btn', role: 'radio', 'aria-checked': String(p.which === w), 'data-f': `nsfw:which:${w}`, 'data-nav': '', disabled: !ready, onclick: () => nsfwSetPage({ which: w }),
      }, label))));
  }
  const ticked = listed.filter((x) => nsfwPicked(p.mode, x.r)).map((x) => x.r);
  // MyAnimeList has no private titles: its copies would stay public there, and stop syncing.
  const onMal = ticked.filter((r) => r.mal).length;
  if (toPrivate && ready && onMal && nsfwMalShown()) {
    parts.push(h('div', { class: 'nsfw-well' },
      h('p', { class: 'set-d' }, `MyAnimeList has no private titles. ${onMal === 1 ? '1 of these is' : `${onMal} of these are`} there: once private here, ${onMal === 1 ? 'it stops' : 'they stop'} syncing with MyAnimeList and stay${onMal === 1 ? 's' : ''} public on it.`),
      h('button', { class: 'nsfw-check', role: 'checkbox', 'aria-checked': String(N.mal), 'data-f': 'nsfw:mal', 'data-nav': '', onclick: () => { N.mal = !N.mal; render(); } },
        h('span', { class: 'cmp-tick', 'aria-hidden': 'true' }, N.mal ? icon('check') : null),
        h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, 'Also remove them from MyAnimeList'),
          h('span', { class: 'set-d' }, 'Each one gets a line in the Sync log. Undo puts them back, with what they have on AniList then.')))));
  }
  if (toPrivate && ready && nsfwMbShown() && ticked.some((r) => r.k === 'MANGA')) {
    parts.push(h('p', { class: 'set-d nsfw-mb' }, 'On MangaBaka, which has private titles, they become private too.'));
  }
  const done = nsfwDone(p);
  if (done) parts.push(done);
  if (!listed.length) {
    const what = p.kind === 'BOTH' ? 'titles' : NSFW_WORD[p.kind];
    parts.push(h('div', { class: 'cmp-same' }, icon('check'), h('span', {}, toPrivate
      ? `Every NSFW ${p.kind === 'BOTH' ? 'title' : what} on your list is private.`
      : p.which === 'made' ? 'None of the titles Tsugi made private is private now.' : `None of your ${what} is private.`)));
    return h('div', { class: 'cmp nsfw-page' }, head, parts);
  }
  const shown = N.all ? listed : listed.slice(0, NSFW_ROWS);
  parts.push(h('div', { class: 'cmp-note-row nsfw-ticks' },
    h('p', { class: 'set-d' }, toPrivate
      ? `${listed.length === 1 ? '1 title counts' : `${listed.length} titles count`} as NSFW and ${listed.length === 1 ? 'is' : 'are'} public. "Not NSFW" leaves one out for good.`
      : `${listed.length === 1 ? '1 title' : `${listed.length} titles`}.`),
    ready ? h('span', { class: 'trk-btns' },
      h('button', { class: 'trk-quiet', 'data-f': 'nsfw:all', onclick: () => { for (const x of listed) N.picks[`${p.mode}:${x.r.id}`] = true; render(); } }, 'Tick all'),
      h('button', { class: 'trk-quiet', 'data-f': 'nsfw:none', onclick: () => { for (const x of listed) N.picks[`${p.mode}:${x.r.id}`] = false; render(); } }, 'Untick all')) : null));
  parts.push(h('div', { class: 'cmp-rows' }, shown.map((x) => nsfwRow(p, x, ready))));
  if (shown.length < listed.length) parts.push(h('button', { class: 'more', 'data-f': 'nsfw:more', onclick: () => { N.all = true; render(); } }, `Show all ${listed.length}`));
  return h('div', { class: 'cmp nsfw-page' }, head, parts, nsfwFoot(p, listed));
}

/* A title's page: does it count? ----------------------------------------------------------------------------- */

function nsfwField(m) {
  const N = state.nsfw;
  const id = m.id;
  const kind = m.type === 'MANGA' ? 'MANGA' : 'ANIME';
  const mark = N.marks[id];
  const cur = mark === 1 ? 'yes' : mark === 0 ? 'no' : 'auto';
  const auto = nsfwWhy(nsfwFacts(m), N.set, kind, undefined);
  const note = cur === 'yes' ? 'Always counts, whatever your choices in Settings.' : cur === 'no' ? 'Never counts, whatever your choices in Settings.'
    : auto ? `Counts: ${auto.map(nsfwWord).join(', ')}.` : 'Doesn\'t count with your choices in Settings.';
  return h('div', { class: 'tp-nsfw' },
    h('div', { class: 'seg is-small', role: 'radiogroup', 'aria-label': 'Counts as NSFW' }, [['auto', 'Tsugi decides'], ['yes', 'Always'], ['no', 'Never']].map(([v, label]) => h('button', {
      class: 'seg-btn', role: 'radio', 'aria-checked': String(cur === v), 'data-f': `tp:nsfw:${v}`,
      onclick: () => { if (cur !== v) nsfwMark(id, v === 'yes' ? 1 : v === 'no' ? 0 : null); },
    }, label))),
    h('span', { class: 'tp-nsfw-d' }, note));
}
