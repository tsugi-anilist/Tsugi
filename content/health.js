// Tsugi · List check: missing dates, planned sequels ahead of their prequels, titles left in Watching.
'use strict';

/* ------------------------------------------------------------------ */
/* List check (a section of the hub, for your own list)                */
/* ------------------------------------------------------------------ */
// Three things a list collects over the years, each folded into one line that says how many:
//  - Missing dates: titles you started or finished that have no start or finish date. The dates
//    are looked up in your AniList activity (the rewatch log's reader, history.js; one request a
//    title, 20 titles a click) and set in one go, with Undo.
//  - Watch order: planned titles whose earlier season isn't on your list, or sits lower in
//    Planning (a lower priority, or not pinned when the sequel is). One click adds, raises or pins
//    the earlier one, right before its sequel. Needs the watch-order warnings (their relations).
//  - Left in Watching: nothing changed for two months or more. Pause, drop, or leave it.
// "Leave it" (the ×) takes a title off the check: local storage "check:ok", 'kind:mediaId' -> when.
// Nothing is changed on AniList until you click.

const HC = {
  open: null,        // the group unfolded: 'dates' | 'order' | 'stale'
  look: new Map(),   // mediaId -> { st: 'loading' | 'found' | 'none', s, c }: dates found in your activity
  run: null,         // a lookup under way: { done, total, stop }
  ok: {},            // titles you said to leave as they are
  all: {},           // groups showing every row
  busy: false,       // a save under way
  sig: '',           // what the view last showed (checkSig)
};
const CHECK_OK_KEY = 'check:ok';
const STALE_DAYS = 60;
const CHECK_ROWS = 8;       // rows shown in a group before "Show all"
const CHECK_LOOKUPS = 20;   // titles looked up in your activity per click

/* What's wrong ------------------------------------------------------- */

// Which dates a title should have and doesn't: { s, c }.
function missingDates(e) {
  const finished = e.status === 'COMPLETED' || e.status === 'REPEATING';
  const started = finished || (['CURRENT', 'PAUSED', 'DROPPED'].includes(e.status) && e.progress > 0);
  const s = started && !hasDate(e.startedAt);
  const c = finished && !hasDate(e.completedAt);
  return s || c ? { s, c } : null;
}

// A planned title that would come up before the one it follows.
function orderIssue(e) {
  const blk = blockerOf(e);
  if (!blk) return null;
  const pre = entryOf(blk.id);
  if (!pre) return { e, pre: null, blk, kind: 'missing' };
  if (pre.status !== 'PLANNING') return null; // you're on it, or it's a choice (paused, dropped)
  if (isPinned(e)) return isPinned(pre) && pre.priority > e.priority ? null : { e, pre, blk, kind: 'pin' };
  return (pre.priority || 0) < (e.priority || 0) ? { e, pre, blk, kind: 'lower' } : null;
}

function staleDays(e) {
  if (!['CURRENT', 'REPEATING'].includes(e.status) || !e.updatedAt) return 0;
  const days = (Date.now() / 1000 - e.updatedAt) / 86400;
  if (days < STALE_DAYS || e.airing === 'NOT_YET_RELEASED') return 0;
  // Caught up with a show that's still airing: there's nothing to watch yet.
  if (isAnime() && e.airing === 'RELEASING' && e.nextEp && (e.progress || 0) >= e.nextEp - 1) return 0;
  return days;
}

function checkIssues() {
  const d = S.data;
  const out = { dates: [], order: [], stale: [], left: 0 };
  if (!d || !d.canEdit) return out;
  const now = Date.now();
  const left = (kind, id) => {
    const t = HC.ok[`${kind}:${id}`];
    if (!t || (kind === 's' && now - t > STALE_DAYS * 864e5)) return false;
    out.left++;
    return true;
  };
  for (const e of d.entries.values()) {
    const id = e.mediaId;
    if (S.gone.has(id)) continue;
    const m = d.full ? missingDates(e) : null;
    if (m && !left('d', id)) out.dates.push({ e, ...m });
    const days = staleDays(e);
    if (days && !left('s', id)) out.stale.push({ e, days });
    const o = e.status === 'PLANNING' ? orderIssue(e) : null;
    if (o && !left('o', id)) out.order.push(o);
  }
  // Dates that were found come first (they're one click from done), then A to Z.
  const found = (x) => (checkOffer(x) ? 0 : 1);
  out.dates.sort((a, b) => found(a) - found(b) || titleCompare(a.e.title, b.e.title));
  out.order.sort((a, b) => titleCompare(a.e.title, b.e.title));
  out.stale.sort((a, b) => b.days - a.days);
  return out;
}

// What the view shows, as text: it's only drawn again when this changes (a redraw under the pointer
// would lose a click).
function checkSig(is = checkIssues()) {
  const row = (kind, x) => [kind, x.e.mediaId, x.kind || '', x.e.priority || 0, x.pre ? x.pre.priority || 0 : '', x.e.progress || 0,
    kind === 'd' ? (checkOffer(x) ? JSON.stringify(checkOffer(x)) : (HC.look.get(x.e.mediaId) || {}).st || '') : '', S.busy.has(x.e.mediaId) ? '~' : ''].join(':');
  return [HC.open, HC.busy, HC.run ? `${HC.run.done}/${HC.run.total}` : '', S.relLoading, S.settings.watchOrder, is.left, Object.keys(HC.all).join(),
    ...is.dates.map((x) => row('d', x)), ...is.order.map((x) => row('o', x)), ...is.stale.map((x) => row('s', x))].join('|');
}

const checkTotal = (is) => is.dates.length + is.order.length + is.stale.length;
function checkSummary() {
  const n = checkTotal(checkIssues());
  return n ? `${n} ${n === 1 ? 'thing' : 'things'} to look at in your ${typeWord()} list` : `Nothing to fix in your ${typeWord()} list`;
}

/* Dates from your activity -------------------------------------------- */

// The first watch in a title's activity: when it started and when it finished.
function activityDates(acts, e) {
  let s = null, c = null;
  for (const [t, text] of acts) {
    const k = activityKind(text);
    if (k === 'reprogress' || k === 'recomplete') break; // rewatches come after the first watch
    if (!s && k === 'progress') s = dayOf(t);
    if (k === 'complete') { c = dayOf(t); break; }
  }
  // A film or a one-shot: started the day it was finished.
  const total = isAnime() ? e.episodes : e.chapters;
  const end = hasDate(e.completedAt) ? e.completedAt : c;
  if (!s && total === 1 && end) s = { year: end.year, month: end.month, day: end.day };
  return s || c ? { st: 'found', s, c } : { st: 'none' };
}

// The dates that can be set on a title with missing dates: { startedAt, completedAt }, or null.
function checkOffer(x) {
  const f = HC.look.get(x.e.mediaId);
  if (!f || f.st !== 'found') return null;
  const e = x.e;
  const out = {};
  const end = hasDate(e.completedAt) ? e.completedAt : x.c ? f.c : null;
  if (x.s && f.s && (!end || dateNum(f.s) <= dateNum(end))) out.startedAt = f.s;
  if (x.c && f.c && (!hasDate(e.startedAt) || dateNum(f.c) >= dateNum(e.startedAt))) out.completedAt = f.c;
  return Object.keys(out).length ? out : null;
}

async function checkFindDates() {
  if (HC.run || !S.data || !S.data.viewer) return;
  const todo = checkIssues().dates.filter((x) => !HC.look.has(x.e.mediaId)).slice(0, CHECK_LOOKUPS);
  if (!todo.length) return;
  const data = S.data;
  const run = HC.run = { done: 0, total: todo.length, stop: false };
  renderCheckNow();
  for (const x of todo) {
    if (run.stop || HC.run !== run || S.data !== data) break;
    const id = x.e.mediaId;
    try {
      HC.look.set(id, activityDates(await loadActivity(id, x.e, data.viewer.id), x.e));
    } catch {
      toast("Couldn't read your activity. AniList may be busy: try again in a minute.", 'error');
      break;
    }
    run.done++;
    renderCheckNow();
    if (!loggedIn() && run.done < run.total) await sleep(350); // the site login has no queue: go gently
  }
  if (HC.run === run) HC.run = null;
  renderCheckNow();
}

async function checkSetDates(list) {
  if (HC.busy) return;
  const ops = [];
  for (const x of list) {
    const patch = checkOffer(x);
    if (patch) ops.push({ kind: 'save', entryId: x.e.id, mediaId: x.e.mediaId, patch });
  }
  if (!ops.length) return;
  HC.busy = true;
  renderCheckNow();
  const apply = async (jobs) => {
    const { results, failed } = await runOps(jobs);
    for (const [op, saved] of results) applySaved(entryOf(op.mediaId), saved);
    return { ok: jobs.filter((j) => results.has(j)), failed };
  };
  let res;
  try { res = await apply(ops); } finally { HC.busy = false; }
  entryChanged();
  if (res.failed.length) toast(`Couldn't set the dates on ${plural(res.failed.length)}. Make sure you're logged in to AniList.`, 'error');
  if (!res.ok.length) return;
  const first = entryOf(res.ok[0].mediaId);
  const msg = res.ok.length === 1 && first ? `${first.title}: ${Object.keys(res.ok[0].patch).length === 2 ? 'dates' : res.ok[0].patch.startedAt ? 'start date' : 'finish date'} set` : `Dates set on ${plural(res.ok.length)}`;
  toast(msg, 'ok', {
    label: 'Undo',
    run: async () => {
      const back = res.ok.map((j) => {
        const e = entryOf(j.mediaId);
        const patch = {};
        for (const k of Object.keys(j.patch)) patch[k] = fuzzy(null);
        return e ? { kind: 'save', entryId: e.id, mediaId: j.mediaId, patch } : null;
      }).filter(Boolean);
      const r = await apply(back);
      entryChanged();
      toast(r.failed.length ? `Couldn't undo for ${plural(r.failed.length)}` : `Undone for ${plural(r.ok.length)}`, r.failed.length ? 'error' : 'ok');
    },
  }, 0, res.ok.length === 1 ? first : null);
}

/* Fixes ---------------------------------------------------------------- */

const planningKey = () => statusKey('PLANNING');

// The earlier season isn't on your list: add it to Planning, right before its sequel.
async function checkAddFirst(o) {
  if (HC.busy) return;
  const seq = o.e;
  const prio = isPinned(seq) ? unpinnedPriority(seq) : seq.priority || 0;
  HC.busy = true;
  renderCheckNow();
  let saved = null;
  try { saved = await titleSave(prio ? { mediaId: o.blk.id, status: 'PLANNING', priority: prio } : { mediaId: o.blk.id, status: 'PLANNING' }); }
  catch { toast(`Couldn't add ${o.blk.title}. Make sure you're logged in to AniList.`, 'error'); }
  HC.busy = false;
  if (!saved) { renderCheckNow(); return; }
  await ensureData(true);
  const added = entryOf(o.blk.id);
  if (added && !isPinned(seq)) moveInFine(planningKey(), prio, fineSorted(planningKey(), prio), o.blk.id, seq.mediaId);
  applyPageSort();
  renderCheckNow();
  toast(`${o.blk.title} added to Planning${keptPrivate(saved)}, before ${seq.title}`, 'ok', {
    label: 'Undo',
    run: async () => {
      try { await titleDelete(saved.id); } catch { toast(`Couldn't remove ${o.blk.title}.`, 'error'); return; }
      await ensureData(true);
      toast('Undone');
    },
  }, 0, added);
}

// The earlier season sits lower in Planning: it takes its sequel's priority, and the place before it.
function checkRaise(o) {
  const to = o.e.priority || 0;
  const from = o.pre.priority || 0;
  setPriority(o.pre.mediaId, to);
  moveInFine(planningKey(), to, fineSorted(planningKey(), to), o.pre.mediaId, o.e.mediaId);
  applyPageSort();
  renderCheckNow();
  toast(`${o.pre.title}: priority ${to}, before ${o.e.title}`, 'ok', { label: 'Undo', run: () => { setPriority(o.pre.mediaId, from); toast('Undone'); } }, 0, o.pre);
}

// The sequel is pinned: the earlier season is pinned just above it.
async function checkPinAbove(o) {
  const pre = o.pre, seq = o.e;
  const pins = pinsIn('PLANNING').filter((x) => x !== pre);
  if (!isPinned(pre) && pins.length >= PIN_LIMIT) {
    toast(`You can pin up to ${PIN_LIMIT} titles in Planning. Unpin one first.`, 'error');
    return;
  }
  const was = S.pinPrev[pre.mediaId];
  pins.splice(Math.max(0, pins.indexOf(seq)), 0, pre);
  if (!isPinned(pre)) setPinPrev(pre.mediaId, pre.priority || 0);
  const changes = pinSlots(pins);
  if (changes.length && await commitChanges(changes)) {
    toast(`${pre.title} pinned above ${seq.title}`, 'ok', undoPins(changes, () => setPinPrev(pre.mediaId, was != null ? was : null)), 0, pre);
  }
  renderCheckNow();
}

async function checkMove(id, status) {
  const e = entryOf(id);
  if (!e) return;
  const before = await updateEntry(id, { status });
  if (before) toast(`${e.title} moved to ${statusLabel(status)}`, 'ok', undoEntry(id, before), 0, e);
}

function saveCheckOk() {
  // Keeps the latest 600: more than anyone leaves by hand.
  const keys = Object.keys(HC.ok);
  if (keys.length > 600) keys.sort((a, b) => HC.ok[a] - HC.ok[b]).slice(0, keys.length - 600).forEach((k) => delete HC.ok[k]);
  store.set('local', CHECK_OK_KEY, { ...HC.ok });
}

function checkLeave(kind, e) {
  const k = `${kind}:${e.mediaId}`;
  HC.ok[k] = Date.now();
  saveCheckOk();
  renderCheckNow();
  toast(`${e.title} left as it is`, 'ok', { label: 'Undo', run: () => { delete HC.ok[k]; saveCheckOk(); renderCheckNow(); } }, 0, e);
}

// Selects the titles and hands them to the selection bar (Edit changes them all at once).
function checkSelect(ids) {
  if (!ids.length) return;
  enterSelect();
  for (const id of ids) S.selected.add(id);
  closeDrawer();
  paintSelection();
  toast(`${plural(ids.length)} selected. Edit changes them all at once`);
}

/* The view ------------------------------------------------------------- */

function renderCheckNow() {
  if (!D.drawer || !S.drawerOpen || S.view !== 'check') return;
  renderDrawerChrome();
  renderCheck();
}

function agoWords(days) {
  const months = Math.floor(days / 30);
  if (days >= 365) { const y = Math.floor(days / 365); return y === 1 ? 'over a year ago' : `${y} years ago`; }
  return `${months} months ago`;
}

function checkItem(e, sub, actions, leave) {
  const cover = h('a', { class: 'apq-cover', href: e.url, tabindex: '-1', 'aria-hidden': 'true' },
    e.cover ? h('img', { src: e.cover, alt: '', loading: 'lazy', decoding: 'async' }) : null);
  if (e.color) cover.style.backgroundColor = e.color;
  const row = h('div', { class: 'apq-hc-item', 'data-id': e.mediaId },
    cover,
    h('div', { class: 'apq-row-text' },
      h('a', { class: 'apq-hc-title', href: e.url }, e.title),
      h('div', { class: 'apq-hc-sub' }, sub)),
    h('div', { class: 'apq-hc-acts' }, actions,
      h('button', {
        type: 'button', class: 'apq-hc-x', 'aria-label': `${leave.tip}: ${e.title}`, 'data-tip': leave.tip, 'data-k': `x:${leave.kind}:${e.mediaId}`,
        onclick: () => checkLeave(leave.kind, e),
      }, icon('x'))));
  paintTitle(row, e);
  return row;
}

const checkBtn = (label, k, run, opts = {}) => h('button', {
  type: 'button', class: 'apq-hc-btn' + (opts.primary ? ' is-primary' : ''), 'data-k': k, disabled: !!opts.disabled, 'aria-label': opts.aria || null, onclick: run,
}, opts.icon || null, label);

// A group's rows, the first few, then "Show all".
function checkRows(key, items, make) {
  const all = !!HC.all[key] || items.length <= CHECK_ROWS + 2;
  const shown = all ? items : items.slice(0, CHECK_ROWS);
  return [
    h('div', { class: 'apq-hc-items' }, shown.map(make)),
    all ? null : h('button', { type: 'button', class: 'apq-hc-more', 'data-k': `all:${key}`, onclick: () => { HC.all[key] = true; renderCheckNow(); } }, `Show all ${items.length}`),
  ];
}

function checkDatesBody(list) {
  const anime = isAnime();
  const offers = list.filter((x) => checkOffer(x));
  const unread = list.filter((x) => !HC.look.has(x.e.mediaId)).length;
  const run = HC.run;
  const word = (x) => (x.s && x.c ? 'No start or finish date' : x.s ? 'No start date' : 'No finish date');
  const acts = [];
  if (run) {
    acts.push(h('span', { class: 'apq-hc-prog', role: 'status' }, spinner(), `Reading your activity, ${Math.min(run.done + 1, run.total)} of ${run.total}`),
      checkBtn('Stop', 'stop', () => { run.stop = true; }));
  } else {
    if (offers.length) acts.push(checkBtn(offers.length === 1 ? 'Set the date found' : `Set the dates found for ${plural(offers.length)}`, 'set-all', () => checkSetDates(offers), { primary: true, disabled: HC.busy }));
    if (unread) acts.push(checkBtn(offers.length ? `Look for ${Math.min(unread, CHECK_LOOKUPS)} more` : unread > CHECK_LOOKUPS ? `Look for the first ${CHECK_LOOKUPS}` : 'Look for them', 'find', checkFindDates, { primary: !offers.length, icon: icon('search') }));
    acts.push(checkBtn('Select them', 'sel:dates', () => checkSelect(list.map((x) => x.e.mediaId))));
  }
  const make = (x) => {
    const f = HC.look.get(x.e.mediaId);
    const offer = checkOffer(x);
    let sub = [h('span', {}, word(x))];
    if (offer) {
      sub = [];
      if (offer.startedAt) sub.push(h('span', {}, 'Started ', h('b', {}, dateWords(offer.startedAt))));
      if (offer.completedAt) sub.push(h('span', {}, 'Finished ', h('b', {}, dateWords(offer.completedAt))));
      if (x.s && !offer.startedAt) sub.push(h('span', {}, 'start date not found'));
    } else if (f && f.st !== 'loading') sub.push(h('span', {}, 'not in your activity'));
    return checkItem(x.e, sub,
      offer ? checkBtn('Set', `set:${x.e.mediaId}`, () => checkSetDates([x]), { disabled: HC.busy, aria: `Set the dates of ${x.e.title}` }) : null,
      { kind: 'd', tip: 'Leave it without' });
  };
  return [
    h('p', { class: 'apq-hc-lead' }, `Titles you started or finished that have no date for it. Tsugi can look for the day in your AniList activity, where you ${anime ? 'watched the first episode and the last' : 'read the first chapter and the last'}.`),
    h('div', { class: 'apq-hc-bar' }, acts),
    ...checkRows('dates', list, make),
  ];
}

function checkOrderBody(list) {
  const anime = isAnime();
  if (!S.settings.watchOrder) {
    return [h('p', { class: 'apq-hc-lead' }, 'This uses the watch-order warnings, which are off.'),
      h('div', { class: 'apq-hc-bar' }, checkBtn('Turn them on', 'order-on', () => { S.settings.watchOrder = true; settingChanged('watchOrder'); renderCheckNow(); }, { primary: true }))];
  }
  const make = (o) => {
    const name = h('b', {}, o.pre ? o.pre.title : o.blk.title);
    let sub, act;
    if (o.kind === 'missing') {
      sub = [name, ' comes first, and isn\'t on your list'];
      act = checkBtn('Add it', `add:${o.e.mediaId}`, () => checkAddFirst(o), { disabled: HC.busy, aria: `Add ${o.blk.title} to Planning, before ${o.e.title}` });
    } else if (o.kind === 'pin') {
      sub = [name, isPinned(o.pre) ? ' comes first, but is pinned below it' : ' comes first, and isn\'t pinned'];
      act = checkBtn('Pin it above', `pin:${o.e.mediaId}`, () => checkPinAbove(o), { aria: `Pin ${o.pre.title} above ${o.e.title}` });
    } else {
      const p = o.pre.priority || 0;
      sub = [name, ` comes first, ${p ? `at priority ${p}` : 'with no priority'}`];
      act = checkBtn(`Raise it to ${o.e.priority}`, `raise:${o.e.mediaId}`, () => checkRaise(o), { aria: `Raise ${o.pre.title} to priority ${o.e.priority}, before ${o.e.title}` });
    }
    return checkItem(o.e, h('span', {}, sub), act, { kind: 'o', tip: 'Leave it' });
  };
  return [
    h('p', { class: 'apq-hc-lead' }, `Planned titles that would come up before the ${anime ? 'season' : 'volume'} they follow: it isn't on your list, or it sits lower in Planning.`),
    S.relLoading && !list.length ? h('div', { class: 'apq-hc-prog', role: 'status' }, spinner(), 'Reading how your planned titles are related') : null,
    ...(list.length ? checkRows('order', list, make) : []),
  ];
}

function checkStaleBody(list) {
  const anime = isAnime();
  const make = (x) => {
    const e = x.e;
    const total = anime ? e.episodes : e.chapters;
    const sub = [
      h('span', {}, `${anime ? 'Ep' : 'Ch'} `, h('b', {}, String(e.progress || 0)), total ? ` of ${total}` : ''),
      h('span', {}, `last change ${agoWords(x.days)}`),
    ];
    const busy = S.busy.has(e.mediaId);
    return checkItem(e, sub, [
      checkBtn('Pause', `pause:${e.mediaId}`, () => checkMove(e.mediaId, 'PAUSED'), { disabled: busy, aria: `Move ${e.title} to Paused` }),
      checkBtn('Drop', `drop:${e.mediaId}`, () => checkMove(e.mediaId, 'DROPPED'), { disabled: busy, aria: `Move ${e.title} to Dropped` }),
    ], { kind: 's', tip: anime ? 'Still watching it' : 'Still reading it' });
  };
  return [
    h('p', { class: 'apq-hc-lead' }, `In ${statusLabel('CURRENT')} with no change for two months or more. Pause or drop what you've set aside, and ${statusLabel('CURRENT')} is what you're really ${anime ? 'watching' : 'reading'}.`),
    ...checkRows('stale', list, make),
  ];
}

function renderCheck() {
  const d = S.data;
  if (!d || !D.list) return;
  const is = checkIssues();
  HC.sig = checkSig(is);
  const active = document.activeElement;
  const focusKey = active && D.list.contains(active) ? active.dataset.k : null;
  const anime = isAnime();
  const groups = [
    { key: 'dates', label: 'Missing dates', n: is.dates.length, off: d.full ? '' : 'Not this time', body: () => (d.full ? checkDatesBody(is.dates) : [h('p', { class: 'apq-hc-lead' }, 'AniList didn\'t send your dates this time. Reload the page to try again.')]) },
    { key: 'order', label: 'Watch order', n: is.order.length, off: S.settings.watchOrder ? '' : 'Off', body: () => checkOrderBody(is.order) },
    { key: 'stale', label: `Left in ${statusLabel('CURRENT')}`, n: is.stale.length, off: d.viewFields ? '' : 'Not this time', body: () => (d.viewFields ? checkStaleBody(is.stale) : [h('p', { class: 'apq-hc-lead' }, 'AniList didn\'t say when your titles last changed this time. Reload the page to try again.')]) },
  ];
  if (HC.open && !groups.some((g) => g.key === HC.open)) HC.open = null;
  const lines = groups.map((g) => {
    const open = HC.open === g.key;
    const can = g.n > 0 || !!g.off;
    const val = g.off ? h('span', { class: 'apq-hc-val' }, g.off)
      : g.n ? h('span', { class: 'apq-hc-val is-set' }, plural(g.n))
        : h('span', { class: 'apq-hc-val is-ok' }, icon('check'), 'Nothing');
    return h('section', { class: 'apq-hc-group' + (open ? ' is-open' : '') },
      h('button', {
        type: 'button', class: 'apq-hc-line', 'aria-expanded': String(open), 'data-k': `open:${g.key}`, disabled: !can && !open,
        onclick: () => { HC.open = open ? null : g.key; renderCheckNow(); },
      }, h('span', { class: 'apq-hc-label' }, g.label), val, can || open ? icon('chevron', 'apq-hc-chev') : null),
      open ? h('div', { class: 'apq-hc-body' }, g.body()) : null);
  });
  const foot = is.left ? h('p', { class: 'apq-hc-foot' },
    `${is.left} left as ${is.left === 1 ? 'it is' : 'they are'}. `,
    h('button', { type: 'button', class: 'apq-hc-link', 'data-k': 'unleave', onclick: () => { HC.ok = {}; saveCheckOk(); renderCheckNow(); } }, is.left === 1 ? 'Check it again' : 'Check them again')) : null;
  D.list.replaceChildren(h('div', { class: 'apq-hc' },
    h('p', { class: 'apq-hc-intro' }, `Small things your ${anime ? 'anime' : 'manga'} list has picked up over time. Nothing changes until you click.`),
    ...lines, foot));
  if (focusKey) {
    const el = D.list.querySelector(`[data-k="${focusKey.replace(/["\\]/g, '\\$&')}"]`);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }
}
