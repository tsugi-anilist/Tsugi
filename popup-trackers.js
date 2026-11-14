// Tsugi: the toolbar popup's trackers (0.9, both ways since 0.10). Loaded after popup.js, sharing its scope
// (state, h, icon, render, send...). Three parts:
// - Settings, Trackers: connect MyAnimeList and MangaBaka (each asks the browser for its site only then),
//   which kinds follow AniList (anime, manga), how it's going, titles without a match, removals waiting for
//   you, Disconnect.
// - The Compare page, over Settings: AniList against one tracker, the differences sorted in groups (one
//   unfolded at a time, like the hub's List check), ticks, Apply with Undo. The first sync of a kind
//   always goes through it. The background does the reading and the writing (trackers.js), so the popup
//   can close meanwhile: what it shows comes from session "trk:cmp:<t>".
// - The Sync log page (0.10), over Settings too: titles removed on one side (Remove there too, or Keep), then
//   every change Tsugi made, both ways, newest first, with Undo. Opening the popup checks for changes.
'use strict';

state.trk = {
  info: null,        // from the background: each tracker's name, kinds, whether Tsugi has its own app there, addresses
  acct: {},          // t -> the login (local "trk:<t>"), or null
  st: {},            // t -> how it's going (local "trk:st:<t>"): err, last, um (titles without a match)
  undo: {},          // t -> the last Apply, while it can be undone (local "trk:undo:<t>")
  queue: {},         // t -> { mediaId: { e, at } } titles waiting to be sent (local "trk:queue")
  cmp: {},           // t -> the Compare page (session "trk:cmp:<t>")
  perm: {},          // t -> the browser lets Tsugi reach the site
  connectErr: null,  // { t, msg }: the last login that didn't work
  page: null,        // the Compare page shown: { t, kind }
  open: null,        // its group unfolded: 'add', 'diff', 'unmatched', 'only', 'private'
  all: {},           // group -> every row shown
  picks: {},         // 't:id' -> ticked (only your changes to the defaults)
  find: null,        // { id, q, results, loading, error }: finding a title without a match
  busy: {},          // t -> waiting for the background
  msg: {},           // t -> { kind, text } under its block in Settings, or on its Compare page
  confirm: null,     // t: "Disconnect?" asked
  // 0.10, both ways
  gone: {},          // t -> { mediaId: removal waiting for you } (local "trk:gone:<t>")
  log: [],           // the sync log, newest first (local "trk:log")
  checked: null,     // the last check: { at, err: { al | mal | mb: message } } (local "trk:checked")
  logOpen: false,    // the Sync log page is shown
  logAll: false,     // ... with every change, not only the latest
  checking: false,   // Check now runs
  undoing: {},       // log id -> its Undo runs
  deciding: {},      // 't:mediaId' -> Remove or Keep runs
  logMsg: null,      // { kind, text } at the top of the Sync log
  rulesOpen: {},     // t -> its "How it syncs" rules unfolded (0.10.1)
};

const TRK_ROWS = 40;            // rows shown in a group before "Show all"
const TRK_STALE_MS = 15 * 60e3; // the background's own limit for Apply (trackers.js)
const TRK_STUCK_MS = 90e3;      // a read that hasn't moved for this long stopped (the worker restarted)
const TRK_KIND_WORDS = { ANIME: 'Anime', MANGA: 'Manga' };

/* Loading and following the background -------------------------------------------------------------- */

const trkIds = () => Object.keys(state.trk.info || {});
// The login without its keys: the popup only needs who and what.
function trkPublic(a) {
  if (!a) return null;
  const { token, refresh, ...rest } = a;
  return rest;
}

async function trkStart() {
  const res = await send({ type: 'trk:info' });
  state.trk.info = res.ok ? res.trackers : null;
  if (!state.trk.info) return;
  const ids = trkIds();
  const o = await chrome.storage.local.get(ids.flatMap((t) => [`trk:${t}`, `trk:st:${t}`, `trk:undo:${t}`, `trk:gone:${t}`]).concat(['trk:queue', 'trk:connectErr', 'trk:log', 'trk:checked']));
  for (const t of ids) {
    state.trk.acct[t] = trkPublic(o[`trk:${t}`]);
    state.trk.st[t] = o[`trk:st:${t}`] || {};
    state.trk.undo[t] = o[`trk:undo:${t}`] || null;
    state.trk.gone[t] = o[`trk:gone:${t}`] || {};
  }
  state.trk.queue = o['trk:queue'] || {};
  state.trk.connectErr = o['trk:connectErr'] || null;
  state.trk.log = Array.isArray(o['trk:log']) ? o['trk:log'] : [];
  state.trk.checked = o['trk:checked'] || null;
  // Opening the popup is when MangaBaka (and the others) are asked what changed (trackers.js, trkCheck).
  if (ids.some((t) => state.trk.acct[t])) send({ type: 'trk:check', why: 'popup' });
  try {
    const ss = await chrome.storage.session.get(ids.map((t) => `trk:cmp:${t}`));
    for (const t of ids) state.trk.cmp[t] = ss[`trk:cmp:${t}`] || null;
  } catch { /* ignore */ }
  await trkCheckPerms();
  // The login tab comes back here (popup.html?view=tab&sync=mal): its Compare page.
  const t = new URLSearchParams(location.search).get('sync');
  if (state.trk.info[t]) {
    state.view = 'settings';
    state.setOpen = 'trackers';
    openSync(t, { draw: false });
  }
}
// Coming back to Tsugi's own window, tab or side panel (0.12.6) counts as opening the popup: the trackers are
// asked what changed (the background keeps it to once a minute).
function trkCameBack() {
  if (state.trk.info && trkIds().some((t) => state.trk.acct[t])) send({ type: 'trk:check', why: 'popup' });
}

async function trkCheckPerms() {
  for (const t of trkIds()) {
    try { state.trk.perm[t] = await chrome.permissions.contains({ origins: state.trk.info[t].origins }); } catch { state.trk.perm[t] = false; }
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (!state.trk.info) return;
  let draw = false;
  for (const t of trkIds()) {
    if (area === 'local' && changes[`trk:${t}`]) {
      const was = state.trk.acct[t];
      state.trk.acct[t] = trkPublic(changes[`trk:${t}`].newValue);
      draw = true;
      // Connected: "approve on the tab that opened" has done its job.
      if (!was && state.trk.acct[t]) state.trk.msg[t] = null;
      // Just connected from the login tab: its Compare page reads both lists by itself.
      const p = state.trk.page;
      if (!was && state.trk.acct[t] && p && p.t === t) { trkCheckPerms(); compareNow(t, p.kind); }
      if (!state.trk.acct[t]) trkCheckPerms().then(render);
    }
    if (area === 'local' && changes[`trk:st:${t}`]) { state.trk.st[t] = changes[`trk:st:${t}`].newValue || {}; draw = true; }
    if (area === 'local' && changes[`trk:undo:${t}`]) { state.trk.undo[t] = changes[`trk:undo:${t}`].newValue || null; draw = true; }
    if (area === 'local' && changes[`trk:gone:${t}`]) { state.trk.gone[t] = changes[`trk:gone:${t}`].newValue || {}; draw = true; render(); }
    if (area === 'session' && changes[`trk:cmp:${t}`]) { state.trk.cmp[t] = changes[`trk:cmp:${t}`].newValue || null; draw = state.view === 'settings'; }
  }
  if (area === 'local' && changes['trk:queue']) { state.trk.queue = changes['trk:queue'].newValue || {}; draw = true; }
  if (area === 'local' && changes['trk:connectErr']) { state.trk.connectErr = changes['trk:connectErr'].newValue || null; draw = true; }
  // The log and the checks only redraw what shows them: the Trackers group or the Sync log.
  const shown = state.setOpen === 'trackers' || state.trk.logOpen;
  if (area === 'local' && changes['trk:checked']) { state.trk.checked = changes['trk:checked'].newValue || null; draw = draw || shown; }
  if (area === 'local' && changes['trk:log']) {
    const was = new Set(state.trk.log.map((x) => x.id));
    state.trk.log = Array.isArray(changes['trk:log'].newValue) ? changes['trk:log'].newValue : [];
    draw = draw || shown;
    // A change that came to AniList from a tracker: what the popup shows is read again, quietly.
    const came = state.trk.log.filter((x) => !was.has(x.id) && x.side === 'al');
    if (came.length && state.auth) trkFollowAniList(came);
  }
  if (draw && state.view === 'settings') render();
});

function trkFollowAniList(came) {
  markStale();
  const p = topPage();
  if (p && came.some((x) => x.mid === p.mediaId)) loadTitle(p.mediaId, { force: true });
  else if (VIEWS[state.view] && state.view !== 'settings') VIEWS[state.view].load({ quiet: true });
}

// The Trackers group sits before Account.
SET_GROUPS.splice(Math.max(0, SET_GROUPS.findIndex((g) => g.key === 'account')), 0, { key: 'trackers', label: 'Trackers', body: trackersBody, summary: trackersSummary });

/* Connecting ---------------------------------------------------------------------------------------- */

// The browser's permission for the site has to be asked right in the click. If the browser's question
// closes the popup, the background goes on by itself once it's given (trackers.js, permissions.onAdded).
function trkConnect(t, { client = '', token = '', builtIn = false } = {}) {
  const T = state.trk.info[t];
  state.trk.msg[t] = null;
  state.trk.connectErr = null;
  const go = async () => {
    state.trk.busy[t] = true;
    render();
    const res = token ? await send({ type: 'trk:pat', t, token }) : await send({ type: 'trk:connect', t, client, builtIn });
    state.trk.busy[t] = false;
    if (!res.ok) state.trk.msg[t] = { kind: 'error', text: res.error };
    else if (!token) state.trk.msg[t] = { kind: 'ok', text: `Approve Tsugi on the ${T.name} tab that just opened. It comes back here when you're connected.` };
    render();
  };
  if (state.trk.perm[t]) { go(); return; }
  // For the background, in case the browser's question closes the popup (removed once used).
  try { chrome.storage.session.set({ 'trk:pending': { t, client, token, builtIn, at: Date.now() } }); } catch { /* ignore */ }
  let asked;
  try { asked = chrome.permissions.request({ origins: T.origins }); } catch (err) { asked = Promise.reject(err); }
  asked.then((ok) => {
    state.trk.perm[t] = ok;
    if (ok) { go(); return; }
    state.trk.msg[t] = { kind: 'error', text: `Tsugi can't reach ${T.name} without your browser's permission. Click Connect again and allow it.` };
    render();
  }, () => {
    state.trk.msg[t] = { kind: 'error', text: 'Your browser didn\'t ask for the permission. Reload the extension and try again.' };
    render();
  });
}

async function trkDisconnect(t) {
  state.trk.confirm = null;
  state.trk.busy[t] = true;
  render();
  await send({ type: 'trk:disconnect', t });
  state.trk.busy[t] = false;
  state.trk.cmp[t] = null;
  if (state.trk.page && state.trk.page.t === t) state.trk.page = null;
  await trkCheckPerms();
  render();
}

async function trkSetKind(t, kind, on) {
  const a = state.trk.acct[t];
  if (a) a.kinds = { ...(a.kinds || {}), [kind]: on };
  render();
  await send({ type: 'trk:kind', t, kind, on });
}

/* Settings: the Trackers group ------------------------------------------------------------------------ */

function trackersSummary() {
  const ids = trkIds();
  const on = ids.filter((t) => state.trk.acct[t]);
  if (!on.length) return [h('span', {}, 'None connected')];
  return on.map((t) => {
    const a = state.trk.acct[t];
    const warn = a.needsLogin || (state.trk.st[t] && state.trk.st[t].err) || goneOf(t).length;
    return h('span', { class: 'set-piece' + (warn ? ' is-warn' : '') }, state.trk.info[t].name, warn ? icon('warn') : null);
  });
}

function trackersBody() {
  if (!state.trk.info) return [h('p', { class: 'set-d' }, 'Reload the extension to see the trackers.')];
  return [
    h('p', { class: 'set-d trk-lead' }, 'Your lists on these sites and on AniList stay the same: what you change, add or remove on one reaches the others, with Undo in the Sync log. Each site has its own rules under How it syncs.'),
    trkIds().map((t) => (state.trk.acct[t] ? trackerOn(t) : trackerOff(t))),
    trkIds().some((t) => state.trk.acct[t]) ? logEntryRow() : null,
  ];
}

const kindsText = (t) => (t === 'mal' ? 'Anime and manga.' : 'Manga and light novels.');
const siteOf = (t) => (state.trk.info[t].origins[0] || '').replace(/^https:\/\/|\/\*$/g, '');

function trkMsg(t) {
  const m = state.trk.msg[t] || (state.trk.connectErr && state.trk.connectErr.t === t ? { kind: 'error', text: state.trk.connectErr.msg } : null);
  return m ? h('div', { class: `msg is-${m.kind}`, role: m.kind === 'error' ? 'alert' : 'status' }, m.text) : null;
}

function trkField(t, key, placeholder, label, button, run) {
  const input = h('input', { class: 'input', type: 'text', placeholder, 'aria-label': label, 'data-f': `trk:${t}:${key}`, spellcheck: 'false', autocomplete: 'off' });
  const btn = h('button', { class: 'btn', 'data-f': `trk:${t}:${key}:go`, disabled: !!state.trk.busy[t], onclick: () => run(input.value.trim()) }, button);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') btn.click(); });
  return h('div', { class: 'field' }, input, btn);
}

// A folded way in that stays open while the popup redraws (a sync or a check finishing redraws Settings).
const trkFolds = {};
function trkFold(t, key, label, body) {
  const id = `${t}:${key}`;
  return h('details', { class: 'alt', open: !!trkFolds[id], ontoggle: (ev) => { trkFolds[id] = ev.target.open; } }, h('summary', {}, label), body);
}

// Not connected: one button when Tsugi has its own app there; until then, the steps for an app of your
// own (MyAnimeList) or a personal token (MangaBaka).
function trackerOff(t) {
  const T = state.trk.info[t];
  const site = siteOf(t);
  const connect = (opts) => trkConnect(t, opts);
  // first: the only way in for now, so it says why in the same sentence.
  const ownApp = (first = false) => [
    h('p', { class: 'step-text' }, t === 'mal'
      ? `${first ? `${T.name} lets an app in only with an ID of its own. Until Tsugi has one, make yours once: on` : 'On'} ${T.name}'s API page, click Create ID, set these two fields, fill the others as you like, then paste the Client ID it shows.`
      : `On ${T.name}, make a new application: type Other, with Public application on and this redirect URL. Then paste its Client ID.`),
    t === 'mal' ? copyRow('App type', 'other') : null,
    copyRow(t === 'mal' ? 'App redirect URL' : 'Redirect URL', T.redirect),
    h('button', { class: 'btn trk-open', onclick: () => open(T.apps) }, icon('external'), `Open ${T.name}'s ${t === 'mal' ? 'API page' : 'new app page'}`),
    trkField(t, 'client', 'Client ID', 'Client ID', 'Connect', (v) => (v ? connect({ client: v }) : null)),
  ];
  const tokenSteps = () => [
    h('p', { class: 'step-text' }, 'On MangaBaka, open Settings, API and apps, and make a personal access token. Paste it here: it stays on this computer.'),
    h('button', { class: 'btn trk-open', onclick: () => open(T.tokens) }, icon('external'), 'Open MangaBaka\'s API settings'),
    trkField(t, 'token', 'mb-…', 'Personal access token', 'Connect', (v) => (v ? connect({ token: v }) : null)),
  ];
  const lead = h('div', { class: 'set-row trk-top' },
    h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, T.name),
      h('span', { class: 'set-d' }, `${kindsText(t)} Your browser asks once to let Tsugi reach ${site}.`)),
    T.builtIn ? h('button', { class: 'tp-btn', 'data-f': `trk:${t}:connect`, 'data-nav': '', disabled: !!state.trk.busy[t], onclick: () => connect({ builtIn: true }) },
      state.trk.busy[t] ? spin() : icon('external'), 'Connect') : null);
  let rest;
  if (T.builtIn) {
    rest = [
      t === 'mb' ? trkFold(t, 'token', 'Use a personal access token instead', tokenSteps()) : null,
      trkFold(t, 'app', `Use your own ${T.name} app`, ownApp()),
    ];
  } else if (t === 'mb') {
    rest = [h('div', { class: 'trk-steps' }, tokenSteps()), trkFold(t, 'app', 'Use your own MangaBaka app instead', ownApp())];
  } else {
    rest = [h('div', { class: 'trk-steps' }, ownApp(true))];
  }
  return h('div', { class: 'trk', 'data-t': t }, lead, rest, trkMsg(t));
}

const waitingCount = (t) => Object.keys(state.trk.queue[t] || {}).length;

// The last change that didn't go: which title and why. A tracker that didn't answer is tried again by
// itself (Try now doesn't wait); a change it refused goes again with the title's next save (Dismiss).
function trkErrorRow(t) {
  const a = state.trk.acct[t];
  const e = state.trk.st[t] && state.trk.st[t].err;
  if (!e || a.needsLogin || e.login) return null;
  const T = state.trk.info[t];
  const why = String(e.msg || '').replace(new RegExp(`^${T.name}: `), '').replace(/\.$/, '');
  const text = e.retry
    ? `Couldn't sync ${e.title || 'a change'}: ${why}. Tsugi tries again by itself, a little later each time.`
    : `${T.name} refused the change to ${e.title || 'a title'}: ${why}. It goes again with that title's next change.`;
  return h('div', { class: 'set-row trk-um' }, h('span', { class: 'set-d is-warn' }, text),
    h('button', { class: 'tp-btn is-small', 'data-f': `trk:${t}:retry`, 'data-nav': '', onclick: () => send({ type: 'trk:retry', t }) }, e.retry ? 'Try now' : 'Dismiss'));
}
function unmatchedOf(t) {
  const a = state.trk.acct[t];
  return Object.entries((state.trk.st[t] && state.trk.st[t].um) || {}).filter(([, v]) => !a || !a.kinds || a.kinds[v.kind] !== false);
}

// One line under your name there: what needs you first, else how it's going.
function trkStatusLine(t) {
  const a = state.trk.acct[t];
  const T = state.trk.info[t];
  const st = state.trk.st[t] || {};
  const on = T.kinds.filter((k) => !a.kinds || a.kinds[k]);
  const notYet = on.filter((k) => !(a.ready && a.ready[k]));
  if (a.needsLogin) return { warn: true, text: `${T.name} logged Tsugi out. Log in again to go on.` };
  if (!on.length) return { text: 'Nothing follows AniList: switch anime or manga on below.' };
  // 0.10.2: a kind switched on starts syncing by itself (trackers.js, trkStartKinds); Compare shows it first.
  if (notYet.length === on.length) return { text: 'Starts syncing by itself in a few minutes. Compare now to see what changes first.' };
  if (notYet.length) {
    const going = on.filter((k) => !notYet.includes(k));
    return { text: `${going.map((k) => TRK_KIND_WORDS[k]).join(' and ')} ${going.length > 1 ? 'sync' : 'syncs'} with AniList. ${notYet.map((k) => TRK_KIND_WORDS[k]).join(' and ')} ${notYet.length > 1 ? 'start' : 'starts'} by itself in a few minutes.` };
  }
  const n = waitingCount(t);
  if (n) return { text: st.err && st.err.retry ? `${n === 1 ? '1 change waits' : `${n} changes wait`} for ${T.name}` : `Sending ${n === 1 ? '1 change' : `${n} changes`}` };
  if (st.last && st.last.at) return { text: `Up to date. Last change ${ago(st.last.at)}${st.last.title ? `: ${st.last.title}` : ''}` };
  return { text: 'Up to date' };
}

function trackerOn(t) {
  const T = state.trk.info[t];
  const a = state.trk.acct[t];
  const line = trkStatusLine(t);
  const needsCompare = T.kinds.some((k) => (!a.kinds || a.kinds[k]) && !(a.ready && a.ready[k]));
  const um = unmatchedOf(t);
  const user = a.user || { name: 'You' };
  const kindSwitch = (k) => {
    const on = !a.kinds || a.kinds[k] !== false;
    const what = k === 'ANIME' ? 'anime' : 'manga';
    const ready = a.ready && a.ready[k];
    return h('button', {
      class: 'set-sw', role: 'switch', 'aria-checked': String(on), 'data-f': `trk:${t}:k:${k}`, 'data-nav': '',
      onclick: () => trkSetKind(t, k, !on),
    }, h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, TRK_KIND_WORDS[k]),
      h('span', { class: 'set-d' }, !on ? `Your ${what} list on ${T.name} is left as it is.` : ready ? `Your ${what} list on ${T.name} syncs with AniList.` : `On: starts syncing by itself in a few minutes. Compare first to see what changes.`)),
    h('span', { class: 'tp-switch' + (on ? ' is-on' : ''), 'aria-hidden': 'true' }));
  };
  // A kind that's on but never compared doesn't sync at all: one clear row with its Compare.
  const notYet = T.kinds.filter((k) => (!a.kinds || a.kinds[k] !== false) && !(a.ready && a.ready[k]));
  return h('div', { class: 'trk is-on', 'data-t': t },
    h('div', { class: 'set-row trk-top' },
      h('span', { class: 'trk-av' }, user.pic ? h('img', { src: user.pic, alt: '' }) : initials(user.name)),
      h('span', { class: 'set-txt' },
        h('span', { class: 'set-t' }, user.name, h('span', { class: 'trk-on' }, ` on ${T.name}`)),
        h('span', { class: 'set-d' + (line.warn ? ' is-warn' : '') }, line.text)),
      a.needsLogin
        ? h('button', { class: 'tp-btn', 'data-f': `trk:${t}:login`, 'data-nav': '', onclick: () => trkConnect(t, {}) }, icon('external'), 'Log in again')
        // A kind switched on but never compared doesn't sync: the button opens that one and says which (0.10.1).
        : h('button', { class: 'tp-btn' + (needsCompare ? ' is-ink' : ''), 'data-f': `trk:${t}:compare`, 'data-nav': '', onclick: () => openSync(t, notYet.length ? { kind: notYet[0] } : {}) },
          notYet.length === 1 && T.kinds.length > 1 ? `Compare ${notYet[0] === 'ANIME' ? 'anime' : 'manga'}` : 'Compare')),
    T.kinds.length > 1 ? h('div', { class: 'trk-kinds' }, T.kinds.map(kindSwitch)) : null,
    rulesBlock(t),
    goneNotice(t),
    um.length ? h('div', { class: 'set-row trk-um' },
      h('span', { class: 'set-d' }, um.length === 1 ? `${um[0][1].title} has no match on ${T.name} yet.` : `${um.length} titles have no match on ${T.name} yet.`),
      h('button', { class: 'tp-btn is-small', 'data-f': `trk:${t}:um`, 'data-nav': '', onclick: () => openSync(t, { group: 'unmatched', kind: um[0][1].kind }) }, um.length === 1 ? 'Link it' : 'Link them')) : null,
    trkErrorRow(t),
    state.trk.confirm === t
      ? h('div', { class: 'set-row trk-confirm' },
        h('span', { class: 'set-d' }, `Tsugi stops sending to ${T.name} and forgets what it synced. Your list there stays as it is.`),
        h('span', { class: 'trk-btns' },
          h('button', { class: 'tp-btn is-small', 'data-f': `trk:${t}:keep`, onclick: () => { state.trk.confirm = null; render(); } }, 'Keep'),
          h('button', { class: 'tp-btn is-small is-danger', 'data-f': `trk:${t}:bye`, onclick: () => trkDisconnect(t) }, 'Disconnect')))
      : h('div', { class: 'trk-foot' }, h('button', { class: 'trk-quiet', 'data-f': `trk:${t}:disconnect`, onclick: () => { state.trk.confirm = t; render(); } }, `Disconnect ${T.name}`)),
    trkMsg(t));
}

/* How it syncs (0.10.1): your rules for one tracker, folded to one sentence -------------------------------------
   Direction (both ways, or one way only), removed titles (removed on the other side too, ask first, or kept), new
   titles, and what travels besides status and progress (scores, dates, rewatches). Saved on the login, used by
   the background for every title (trackers.js, rulesOf). */

const RULES_DEFAULT = { dir: 'both', adds: true, removes: 'auto', sc: true, dates: true, r: true };
const rulesFor = (t) => ({ ...RULES_DEFAULT, ...((state.trk.acct[t] && state.trk.acct[t].rules) || {}) });

function setRules(t, patch) {
  const a = state.trk.acct[t];
  if (!a) return;
  a.rules = { ...rulesFor(t), ...patch };
  render();
  send({ type: 'trk:rules', t, rules: patch }).then((res) => { if (!res.ok) { state.trk.msg[t] = { kind: 'error', text: res.error || 'That couldn\'t be saved.' }; render(); } });
}

const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
function rulesSentence(t) {
  const T = state.trk.info[t];
  const r = rulesFor(t);
  const dir = { both: 'Both ways', out: `Only from AniList to ${T.name}`, in: `Only from ${T.name} to AniList` }[r.dir];
  const with_ = [r.adds ? 'new' : null, r.removes === 'auto' ? 'removed' : null].filter(Boolean);
  const out = [`${dir}${with_.length ? `, with ${with_.join(' and ')} titles` : ''}.`];
  if (r.removes === 'ask') out.push('Removed titles wait for you.');
  if (r.removes === 'off') out.push('Removed titles stay on the other side.');
  if (!r.adds) out.push('New titles stay where you add them.');
  const apart = [!r.sc ? 'scores' : null, !r.dates ? 'dates' : null, !r.r ? (t === 'mb' ? 'rereads' : 'rewatches') : null].filter(Boolean);
  if (apart.length) { const w = listWords(apart); out.push(`${w[0].toUpperCase()}${w.slice(1)} stay apart.`); }
  return out.join(' ');
}

function rulesBlock(t) {
  const a = state.trk.acct[t];
  if (!a || a.needsLogin) return null;
  const open = !!state.trk.rulesOpen[t];
  const head = h('div', { class: 'set-row trk-rules-head' },
    h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, 'How it syncs'), h('span', { class: 'set-d' }, rulesSentence(t))),
    h('button', { class: 'tp-btn is-small', 'data-f': `trk:${t}:rules`, 'data-nav': '', 'aria-expanded': String(open), 'aria-controls': open ? `trk-rules-${t}` : null,
      onclick: () => { state.trk.rulesOpen[t] = !open; render(); } }, open ? 'Done' : 'Change'));
  return h('div', { class: 'trk-rules' + (open ? ' is-open' : '') }, head, open ? rulesBody(t) : null);
}

function rulesBody(t) {
  const T = state.trk.info[t];
  const r = rulesFor(t);
  const choice = (key, label, options, note) => h('div', { class: 'set-f' },
    h('div', { class: 'set-t', id: `trk-l-${t}-${key}` }, label),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': `trk-l-${t}-${key}` },
      options.map(([v, text]) => h('button', {
        class: 'seg-btn', role: 'radio', 'aria-checked': String(r[key] === v), 'data-f': `trk:${t}:${key}:${v}`, 'data-nav': '',
        onclick: () => setRules(t, { [key]: v }),
      }, text))),
    h('div', { class: 'set-d' }, note));
  const sw = (key, label, on, off) => h('button', {
    class: 'set-sw', role: 'switch', 'aria-checked': String(!!r[key]), 'data-f': `trk:${t}:${key}`, 'data-nav': '',
    onclick: () => setRules(t, { [key]: !r[key] }),
  }, h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, label), h('span', { class: 'set-d' }, r[key] ? on : off)),
  h('span', { class: 'tp-switch' + (r[key] ? ' is-on' : ''), 'aria-hidden': 'true' }));
  const re = t === 'mb' ? 'Rereads' : 'Rewatches';
  return h('div', { class: 'trk-rules-body', id: `trk-rules-${t}` },
    choice('dir', 'Direction', [['both', 'Both ways'], ['out', `To ${T.name}`], ['in', 'To AniList']], {
      both: `What you change on AniList reaches ${T.name}, and what you change on ${T.name} reaches AniList.`,
      out: `AniList leads: what you change there reaches ${T.name}. What you change on ${T.name} stays there.`,
      in: `${T.name} leads: what you change there reaches AniList. What you change on AniList stays there.`,
    }[r.dir]),
    choice('removes', 'Removed titles', [['auto', 'Remove'], ['ask', 'Ask me'], ['off', 'Keep']], {
      auto: 'A title you remove on one side is removed on the other, with Undo in the Sync log. If a check finds more than 10 removed at once, they wait for you.',
      ask: 'A title removed on one side waits for you in the Sync log: remove it there too, or keep it.',
      off: 'A title removed on one side stays on the other, and stops syncing.',
    }[r.removes]),
    sw('adds', 'New titles', 'A title you add on one side is added on the other.', 'A title you add on one side stays there.'),
    h('div', { class: 'set-sub' }, 'What travels'),
    h('p', { class: 'set-d trk-rules-note' }, 'Status and progress always travel. Switched off, each side keeps its own.'),
    sw('sc', 'Scores', 'Your score travels, in each site\'s scale.', 'Each side keeps its own score.'),
    sw('dates', 'Start and finish dates', 'The dates you started and finished travel.', 'Each side keeps its own dates.'),
    sw('r', re, `How many times you ${t === 'mb' ? 'reread' : 'rewatched'} a title travels.`, `Each side keeps its own count of ${re.toLowerCase()}.`));
}

/* The Compare page ----------------------------------------------------------------------------------------- */

function enabledKinds(t) {
  const a = state.trk.acct[t];
  const all = state.trk.info[t].kinds;
  const on = all.filter((k) => !a || !a.kinds || a.kinds[k] !== false);
  return on.length ? on : all;
}

function openSync(t, { group = null, kind = null, draw = true } = {}) {
  const kinds = enabledKinds(t);
  const c = state.trk.cmp[t];
  const k = kind && kinds.includes(kind) ? kind : c && kinds.includes(c.kind) ? c.kind : kinds[0];
  state.trk.page = { t, kind: k };
  state.trk.open = group;
  state.trk.all = {};
  state.trk.find = null;
  state.trk.msg[t] = null;
  state.view = 'settings';
  closeTransient();
  scrollPos[`sync:${t}`] = 0;
  // Both lists are read again, unless a fresh reading of this kind waits to be applied (or one is running).
  const fresh = c && c.kind === k && !cmpStale(c) && (c.phase === 'ready' || cmpRunning(c));
  if (state.trk.acct[t] && !fresh) compareNow(t, k, draw);
  else if (draw) render();
}

function closeSync() {
  const t = state.trk.page && state.trk.page.t;
  state.trk.page = null;
  state.trk.find = null;
  state.setOpen = 'trackers';
  render();
  const b = t && app.querySelector(`[data-f="trk:${t}:compare"]`);
  if (b) b.focus({ preventScroll: true });
}

const cmpRunning = (c) => !!c && ['reading', 'applying', 'undoing'].includes(c.phase);
const cmpStuck = (c) => cmpRunning(c) && Date.now() - (c.beat || c.at) > TRK_STUCK_MS;
// Older than the background allows for Apply, or stopped.
const cmpStale = (c) => cmpStuck(c) || (!cmpRunning(c) && Date.now() - c.at > TRK_STALE_MS);

function compareNow(t, kind, draw = true) {
  for (const k of Object.keys(state.trk.picks)) if (k.startsWith(`${t}:`)) delete state.trk.picks[k];
  state.trk.find = null;
  state.trk.msg[t] = null;
  state.trk.cmp[t] = { kind, phase: 'reading', step: 'anilist', n: 0, of: 0, at: Date.now(), beat: Date.now(), rows: [], same: 0, left: 0 };
  if (draw) render();
  send({ type: 'trk:compare', t, kind }).then((res) => { if (!res.ok) { state.trk.msg[t] = { kind: 'error', text: res.error }; render(); } });
}

function setSyncKind(k) {
  const p = state.trk.page;
  if (!p || p.kind === k) return;
  state.trk.page = { ...p, kind: k };
  state.trk.open = null;
  const c = state.trk.cmp[p.t];
  if (!cmpRunning(c)) compareNow(p.t, k);
  else render();
}

const GROUPS = [
  ['add', (T) => `Missing on ${T.name}`],
  ['diff', () => 'Different'],
  ['unmatched', () => 'Not matched'],
  ['only', (T) => `Only on ${T.name}`],
  ['private', () => 'Private on AniList'],
];
const TICKABLE = new Set(['add', 'diff', 'only']);
const picked = (t, r) => { const v = state.trk.picks[`${t}:${r.id}`]; return v === undefined ? !!r.tick : v; };

function groupNote(t, g, kind) {
  const T = state.trk.info[t];
  const what = kind === 'MANGA' ? 'manga' : 'anime';
  return {
    add: `On AniList, not on ${T.name}. Ticked ones are added with their status, progress, score and dates. Unticked ones stay off ${T.name} until you add them here.`,
    diff: `On both, but ${T.name} says something else. Ticked ones take AniList's values. An empty score or date on AniList never empties ${T.name}'s.`,
    unmatched: t === 'mal'
      ? `AniList doesn't know these titles' ${T.name} number. Find each one there, or leave it off.`
      : `${T.name} didn't find these by their AniList number. Find each one there, or leave it off.`,
    only: `On ${T.name}, not on your AniList ${what} list. Tsugi never removes them by itself: tick the ones to remove from ${T.name}.`,
    private: `Private on AniList. ${T.name} has no private titles, so Tsugi keeps these off it.`,
  }[g];
}

// The words for one value, in AniList's terms (both sides are shown the same way).
function trkValue(k, v, kind, t) {
  if (k === 's') return (LABELS[kind] || LABELS.ANIME)[v] || v;
  if (k === 'p') return v ? `${kind === 'MANGA' ? 'Ch' : 'Ep'} ${v}` : 'none';
  if (k === 'v') return v ? `Vol ${v}` : 'none';
  if (k === 'sc') return v ? (t === 'mb' ? String(Math.round(v) / 10) : String(v)) : 'none';
  if (k === 'r') return String(v || 0);
  if (k === 'sd' || k === 'fd') return v ? trkDate(v) : 'none';
  if (k === 'pv') return v ? 'Yes' : 'No';
  return String(v);
}
function trkDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  if (!m) return String(y);
  return d ? `${d} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`;
}
const KEY_WORDS = { s: 'Status', p: 'Progress', v: 'Volumes', sc: 'Score', r: 'Rewatches', sd: 'Started', fd: 'Finished', pv: 'Private' };
const keyWord = (k, kind) => (k === 'r' && kind === 'MANGA' ? 'Rereads' : KEY_WORDS[k]);

// "Progress 12 → 14": the tracker's value struck, AniList's in Ink (mass edit's preview on AniList).
function diffChip(d, kind, t) {
  const had = d.t !== null && d.t !== undefined && d.t !== '' && !(d.k !== 's' && d.k !== 'pv' && !d.t);
  return h('span', { class: 'cmp-diff' }, h('span', { class: 'cmp-k' }, keyWord(d.k, kind)),
    had ? [h('s', {}, trkValue(d.k, d.t, kind, t)), h('span', { class: 'cmp-arrow', 'aria-label': 'to' }, '→')] : null,
    h('b', {}, trkValue(d.k, d.a, kind, t)));
}

// What a title brings when it's added (or what a title only there has): its values as quiet pieces.
function fieldPieces(f, kind, t) {
  const out = [h('span', { class: 'cmp-piece is-ink' }, trkValue('s', f.s, kind, t))];
  for (const k of ['p', 'v', 'sc', 'sd', 'fd']) {
    if (f[k] === undefined || f[k] === null || f[k] === '' || f[k] === 0) continue;
    out.push(h('span', { class: 'cmp-piece' }, k === 'sc' ? `Score ${trkValue(k, f[k], kind, t)}` : k === 'sd' || k === 'fd' ? `${keyWord(k, kind)} ${trkValue(k, f[k], kind, t)}` : trkValue(k, f[k], kind, t)));
  }
  return out;
}

function tickBox(t, r) {
  const on = picked(t, r);
  return h('button', {
    class: 'cmp-tick', role: 'checkbox', 'aria-checked': String(on), 'data-f': `cmp:${r.id}`, 'data-nav': '',
    'aria-label': r.title, disabled: !!(state.trk.cmp[t] && state.trk.cmp[t].phase !== 'ready'),
    onclick: () => { state.trk.picks[`${t}:${r.id}`] = !on; render(); },
  }, on ? icon('check') : null);
}

function cmpRow(t, kind, r) {
  const T = state.trk.info[t];
  const c = state.trk.cmp[t];
  const ticks = TICKABLE.has(r.g) && c.phase === 'ready';
  let detail;
  if (r.g === 'diff') detail = r.diffs.map((d) => diffChip(d, kind, t));
  else if (r.g === 'add' || r.g === 'only') detail = fieldPieces(r.fields, kind, t);
  else if (r.g === 'unmatched') detail = [h('span', { class: 'cmp-piece' }, t === 'mal' ? `No ${T.name} number on AniList` : `Not found on ${T.name}`)];
  else detail = [h('span', { class: 'cmp-piece' }, 'Kept off')];
  const finding = state.trk.find && state.trk.find.id === r.id;
  return h('div', { class: 'cmp-row' + (r.done ? ' is-done' : '') + (r.err ? ' is-err' : '') + (finding ? ' is-finding' : ''), 'data-id': r.id, style: r.color ? `--c:${r.color}` : null },
    ticks ? tickBox(t, r) : r.done ? h('span', { class: 'cmp-done', 'aria-label': 'Done' }, icon('check')) : TICKABLE.has(r.g) ? h('span', { class: 'cmp-gap' }) : null,
    h('span', { class: 'cmp-cover' }, r.cover ? cover(r.cover) : null),
    h('div', { class: 'cmp-text' },
      h('div', { class: 'cmp-title' }, r.title),
      h('div', { class: 'cmp-diffs' }, detail),
      r.also && r.also.length ? h('div', { class: 'cmp-note' }, `One series on ${T.name} with ${r.also.join(', ')}: it follows the one you updated last.`) : null,
      r.g === 'only' && r.recent && !r.done ? h('div', { class: 'cmp-note' }, `Added on ${T.name} since you connected: it comes to AniList once syncing starts.`) : null,
      r.err ? h('div', { class: 'cmp-note is-bad' }, r.err) : null,
      finding ? findPanel(t, kind, r) : null),
    r.g === 'unmatched' && !finding ? h('span', { class: 'cmp-acts' },
      h('button', { class: 'tp-btn is-small', 'data-f': `cmp:find:${r.id}`, 'data-nav': '', onclick: () => startFind(t, kind, r) }, icon('search'), 'Find'),
      h('button', { class: 'cmp-x', 'data-f': `cmp:leave:${r.id}`, 'aria-label': `Leave ${r.title} off ${T.name}`, 'data-tip': `Leave it off ${T.name}`, onclick: () => linkTitle(t, r, 0) }, icon('close'))) : null);
}

/* Finding a title without a match: the tracker's own search, or its address pasted */

let findTimer = null;
function startFind(t, kind, r) {
  state.trk.find = { id: r.id, q: r.romaji || r.title, results: null, loading: true, error: null };
  render();
  const box = app.querySelector('.cmp-find-input');
  if (box) { box.focus(); box.select(); }
  runFind(t, kind);
}
async function runFind(t, kind) {
  const f = state.trk.find;
  if (!f) return;
  const q = f.q;
  f.loading = true;
  render();
  const res = await send({ type: 'trk:search', t, kind, q });
  if (state.trk.find !== f || f.q !== q) return;
  f.loading = false;
  f.results = res.ok ? res.results : [];
  f.error = res.ok ? null : res.error;
  render();
}
function findPanel(t, kind, r) {
  const T = state.trk.info[t];
  const f = state.trk.find;
  const input = h('input', {
    class: 'input cmp-find-input', type: 'text', value: f.q, 'data-f': `cmp:q:${r.id}`, spellcheck: 'false', autocomplete: 'off',
    placeholder: `A title, or its address on ${T.name}`, 'aria-label': `Find ${r.title} on ${T.name}`,
    oninput: (ev) => { f.q = ev.target.value; clearTimeout(findTimer); findTimer = setTimeout(() => runFind(t, kind), 400); },
    onkeydown: (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); state.trk.find = null; render(); } },
  });
  let list;
  if (f.loading && !f.results) list = h('div', { class: 'cmp-find-note' }, spin());
  else if (f.error) list = h('div', { class: 'cmp-find-note is-bad' }, f.error);
  else if (f.results && !f.results.length) list = h('div', { class: 'cmp-find-note' }, `Nothing found. Try another name, or paste its address on ${T.name}.`);
  else list = (f.results || []).map((x) => h('div', { class: 'cmp-hit' },
    h('span', { class: 'cmp-hit-cover' }, x.cover ? cover(x.cover) : null),
    h('span', { class: 'cmp-hit-text' }, h('span', { class: 'cmp-hit-title' }, x.title),
      h('span', { class: 'cmp-hit-meta' }, [x.format ? FORMATS[x.format] || x.format : null, x.year, x.total ? `${x.total} ${kind === 'MANGA' ? 'ch' : 'eps'}` : null].filter(Boolean).map((p) => h('span', {}, p)))),
    h('button', { class: 'tp-btn is-small', 'data-f': `cmp:link:${r.id}:${x.tid}`, 'data-nav': '', onclick: () => linkTitle(t, r, x.tid) }, 'Link')));
  return h('div', { class: 'cmp-find' }, h('div', { class: 'field' }, input,
    h('button', { class: 'btn', onclick: () => { state.trk.find = null; render(); } }, 'Cancel')), h('div', { class: 'cmp-hits' }, list));
}

async function linkTitle(t, r, tid) {
  const T = state.trk.info[t];
  state.trk.busy[t] = true;
  render();
  const res = await send({ type: 'trk:link', t, mediaId: r.id, tid });
  state.trk.busy[t] = false;
  state.trk.find = null;
  if (!res.ok) state.trk.msg[t] = { kind: 'error', text: res.error || `${T.name} didn't answer.` };
  else toast(tid ? `Linked ${r.title}` : `${r.title} stays off ${T.name}`, null, { undo: () => send({ type: 'trk:link', t, mediaId: r.id, tid: null }).then(() => compareNow(t, state.trk.page ? state.trk.page.kind : 'ANIME')) });
  render();
}

/* Apply and Undo */

function ticked(t, c) {
  return c.rows.filter((r) => TICKABLE.has(r.g) && !r.done && picked(t, r));
}
async function applyNow(t) {
  const p = state.trk.page;
  const c = state.trk.cmp[t];
  if (!p || !c || c.phase !== 'ready') return;
  if (Date.now() - c.at > TRK_STALE_MS) { compareNow(t, p.kind); return; }
  const ids = ticked(t, c).map((r) => r.id);
  c.phase = 'applying';
  c.n = 0;
  c.of = ids.length;
  render();
  const res = await send({ type: 'trk:apply', t, kind: p.kind, ids });
  if (!res.ok) {
    c.phase = 'ready';
    state.trk.msg[t] = { kind: 'error', text: res.error };
    if (res.stale) compareNow(t, p.kind);
    else render();
  }
}
async function undoApply(t) {
  const res = await send({ type: 'trk:undo', t });
  if (!res.ok) { state.trk.msg[t] = { kind: 'error', text: res.error }; render(); }
}

function setGroupTicks(t, g, on) {
  const c = state.trk.cmp[t];
  for (const r of c.rows) if (r.g === g && !r.done) state.trk.picks[`${t}:${r.id}`] = on;
  render();
}

function cmpGroup(t, kind, g, label) {
  const T = state.trk.info[t];
  const c = state.trk.cmp[t];
  const rows = c.rows.filter((r) => r.g === g);
  if (!rows.length) return null;
  const open = state.trk.open === g;
  const n = rows.filter((r) => TICKABLE.has(r.g) && !r.done && picked(t, r)).length;
  const done = rows.filter((r) => r.done).length;
  const shown = open && !state.trk.all[g] ? rows.slice(0, TRK_ROWS) : rows;
  const pieces = [h('span', {}, rows.length === 1 ? '1 title' : `${rows.length} titles`)];
  if (TICKABLE.has(g) && c.phase === 'ready') pieces.push(h('span', { class: n ? 'is-ink' : null }, `${n} ticked`));
  if (done) pieces.push(h('span', { class: 'is-good' }, `${done} done`));
  return h('section', { class: 'cmp-g' + (open ? ' is-open' : ''), 'data-g': g },
    h('button', {
      class: 'set-head', 'aria-expanded': String(open), 'data-f': `cmp:g:${g}`, 'data-nav': '',
      onclick: () => { state.trk.open = open ? null : g; state.trk.find = null; render(); },
    }, h('span', { class: 'set-name' }, label(T)), h('span', { class: 'set-sum cmp-sum' }, pieces), icon('down')),
    open ? h('div', { class: 'cmp-body' },
      h('div', { class: 'cmp-note-row' }, h('p', { class: 'set-d' }, groupNote(t, g, kind)),
        TICKABLE.has(g) && c.phase === 'ready' ? h('span', { class: 'trk-btns' },
          h('button', { class: 'trk-quiet', 'data-f': `cmp:all:${g}`, onclick: () => setGroupTicks(t, g, true) }, 'Tick all'),
          h('button', { class: 'trk-quiet', 'data-f': `cmp:none:${g}`, onclick: () => setGroupTicks(t, g, false) }, 'Untick all')) : null),
      h('div', { class: 'cmp-rows' }, shown.map((r) => cmpRow(t, kind, r))),
      shown.length < rows.length ? h('button', { class: 'more', 'data-f': `cmp:more:${g}`, onclick: () => { state.trk.all[g] = true; render(); } }, `Show all ${rows.length}`) : null) : null);
}

function readingView(t, c) {
  const T = state.trk.info[t];
  const what = c.kind === 'MANGA' ? 'manga' : 'anime';
  const steps = [['anilist', `Reading your ${what} list on AniList`], ['tracker', `Reading your ${what} list on ${T.name}`]];
  if (t === 'mb') steps.push(['match', `Finding your manga on ${T.name}`]);
  const at = steps.findIndex(([k]) => k === c.step);
  return h('ol', { class: 'cmp-steps', 'aria-busy': 'true' }, steps.map(([k, text], i) => h('li', { class: i < at ? 'is-done' : i === at ? 'is-now' : null },
    h('span', { class: 'cmp-step-ic' }, i < at ? icon('check') : i === at ? spin() : null),
    h('span', {}, text,
      i === at && k === 'tracker' && c.n ? h('span', { class: 'cmp-step-n' }, `${c.n.toLocaleString()} so far`) : null,
      i === at && k === 'match' && c.of ? h('span', { class: 'cmp-step-n' }, `${c.n} of ${c.of}`) : null))));
}

function syncView() {
  const { t, kind } = state.trk.page;
  const T = state.trk.info[t];
  const a = state.trk.acct[t];
  const kinds = enabledKinds(t);
  const c0 = state.trk.cmp[t];
  const c = c0 && c0.kind === kind ? c0 : null;
  const seg = kinds.length > 1 ? h('div', { class: 'seg is-small', role: 'radiogroup', 'aria-label': 'Which list' },
    kinds.map((k) => h('button', { class: 'seg-btn', role: 'radio', 'aria-checked': String(k === kind), 'data-f': `cmp:kind:${k}`, 'data-nav': '', disabled: cmpRunning(c0) && c0.phase !== 'reading', onclick: () => setSyncKind(k) }, TRK_KIND_WORDS[k]))) : null;
  const head = [
    h('button', { class: 'cmp-back', 'data-f': 'cmp:back', 'data-nav': '', onclick: closeSync }, icon('back'), 'Settings'),
    h('header', { class: 'sec-head cmp-head' }, h('h2', { class: 'sec-title' }, `AniList and ${T.name}`), seg),
    h('p', { class: 'cmp-lead' }, `Ticked titles change on ${T.name} to match AniList. Nothing is removed unless you tick it.`),
  ];
  const msg = trkMsg(t);
  if (!a) {
    const err = state.trk.connectErr && state.trk.connectErr.t === t;
    return h('div', { class: 'cmp' }, head, err ? msg
      : h('div', { class: 'cmp-wait' }, spin(), h('span', {}, `Finishing the login on ${T.name}`)));
  }
  if (!c || c.phase === 'reading') {
    return h('div', { class: 'cmp' }, head, msg, c ? readingView(t, c) : null,
      c && cmpStuck(c) ? h('div', { class: 'banner is-wait' }, icon('clock'), h('span', {}, 'This stopped before the end.'), h('button', { onclick: () => compareNow(t, kind) }, 'Compare again')) : null);
  }
  if (c.phase === 'error') {
    return h('div', { class: 'cmp' }, head, msg,
      h('div', { class: 'banner is-error', role: 'alert' }, icon('alert'), h('span', {}, c.error),
        c.login ? null : h('button', { 'data-f': 'cmp:again', onclick: () => compareNow(t, kind) }, 'Compare again')));
  }
  const first = !(a.ready && a.ready[kind]);
  const nTicked = c.phase === 'ready' ? ticked(t, c).length : 0;
  const undo = state.trk.undo[t];
  let foot;
  if (c.phase === 'ready') {
    foot = h('div', { class: 'cmp-foot' },
      h('button', { class: 'btn is-primary', 'data-f': 'cmp:apply', disabled: !nTicked && !first, onclick: () => applyNow(t) },
        nTicked ? (nTicked === 1 ? 'Apply 1 change' : `Apply ${nTicked} changes`) : first ? 'Start syncing' : 'Nothing ticked'),
      h('span', { class: 'cmp-foot-note' }, first ? `From then on, what you change on AniList goes to ${T.name} within seconds.` : `Read ${ago(c.at)}`),
      h('button', { class: 'trk-quiet', 'data-f': 'cmp:again', onclick: () => compareNow(t, kind) }, 'Compare again'));
  } else if (c.phase === 'applying' || c.phase === 'undoing') {
    foot = h('div', { class: 'cmp-foot' }, h('span', { class: 'cmp-wait' }, cmpStuck(c) ? icon('clock') : spin(),
      h('span', {}, cmpStuck(c) ? 'This stopped before the end.' : `${c.phase === 'applying' ? `Changing ${T.name}` : `Putting ${T.name} back`}: ${c.n} of ${c.of}`)),
      cmpStuck(c) ? h('button', { class: 'trk-quiet', onclick: () => compareNow(t, kind) }, 'Compare again') : null);
  } else {
    const ap = c.applied || { ok: 0, failed: 0 };
    const un = c.undone;
    foot = h('div', { class: 'cmp-done-box' },
      c.phase === 'undone'
        ? h('div', { class: 'banner is-ok', role: 'status' }, icon('check'), h('span', {}, `${T.name} is back as it was${un && un.failed ? `, except ${un.failed}` : ''}.`))
        : h('div', { class: 'banner ' + (ap.failed ? 'is-error' : 'is-ok'), role: 'status' }, icon(ap.failed ? 'alert' : 'check'),
          h('span', {}, `${ap.ok ? `${ap.ok === 1 ? '1 title' : `${ap.ok} titles`} changed on ${T.name}.` : 'Syncing started.'}${ap.failed ? ` ${ap.failed} couldn't be changed: see below.` : ''} What you change on AniList goes there within seconds now.`),
          undo && undo.ops && undo.ops.length && c.phase === 'done' ? h('button', { 'data-f': 'cmp:undo', onclick: () => undoApply(t) }, 'Undo') : null),
      h('button', { class: 'trk-quiet', 'data-f': 'cmp:again', onclick: () => compareNow(t, kind) }, 'Compare again'));
  }
  const groups = GROUPS.map(([g, label]) => cmpGroup(t, kind, g, label)).filter(Boolean);
  const facts = [];
  if (c.same) facts.push(c.same === 1 ? '1 title is the same on both.' : `${c.same.toLocaleString()} titles are the same on both.`);
  if (c.left) facts.push(`${c.left === 1 ? '1 title' : `${c.left} titles`} left off ${T.name}.`);
  return h('div', { class: 'cmp' }, head, msg,
    groups.length ? h('div', { class: 'cmp-groups' }, groups) : h('div', { class: 'cmp-same' }, icon('check'), h('span', {}, `Your ${kind === 'MANGA' ? 'manga' : 'anime'} lists already match.`)),
    facts.length ? h('p', { class: 'cmp-facts' }, facts.join(' ')) : null,
    foot);
}

/* Both ways (0.10): removals waiting for you, and the Sync log ---------------------------------------------------- */

const LOG_ROWS = 60;   // changes shown before "Show all"

// Removals waiting for you on one tracker, newest first: [mediaId, { side, kind, tid, title, cover, color, at }].
function goneOf(t) {
  if (!state.trk.acct[t]) return [];
  return Object.entries(state.trk.gone[t] || {}).sort((x, y) => (y[1].at || 0) - (x[1].at || 0));
}
// For the rail: Settings counts them, like Notifications counts what's unread.
function trkWaiting() {
  if (!state.trk || !state.trk.info) return 0;
  return trkIds().reduce((n, t) => n + goneOf(t).length, 0);
}

// Under a tracker in Settings: one line in the warning color, and Review opens the Sync log on them.
function goneNotice(t) {
  const g = goneOf(t);
  if (!g.length) return null;
  const T = state.trk.info[t];
  const text = g.length === 1
    ? `${g[0][1].title} was removed from ${g[0][1].side === 'tr' ? `${T.name} and is still on AniList` : `AniList and is still on ${T.name}`}. Tsugi waits for you.`
    : `${g.length} titles were removed on one side and are still on the other. Tsugi waits for you.`;
  return h('div', { class: 'set-row trk-um' }, h('span', { class: 'set-d is-warn' }, text),
    h('button', { class: 'tp-btn is-small', 'data-f': `trk:${t}:gone`, 'data-nav': '', onclick: () => openLog() }, 'Review'));
}

// At the end of the Trackers group: the way into the Sync log, with when it last looked.
function logEntryRow() {
  const today = state.trk.log.filter((x) => isToday(x.at)).length;
  const bits = [];
  if (today) bits.push(today === 1 ? '1 change today.' : `${today} changes today.`);
  const c = state.trk.checked;
  bits.push(c && c.at ? `Checked ${ago(c.at)}.` : 'Changes made there come back within minutes.');
  return h('div', { class: 'set-row trk-logrow' },
    h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, 'Sync log'),
      h('span', { class: 'set-d' }, `What travelled between AniList and your trackers, with Undo. ${bits.join(' ')}`)),
    h('button', { class: 'tp-btn', 'data-f': 'trk:log', 'data-nav': '', onclick: () => openLog() }, 'Open'));
}

function openLog() {
  state.trk.logOpen = true;
  state.trk.page = null;
  state.trk.logAll = false;
  state.trk.logMsg = null;
  state.view = 'settings';
  closeTransient();
  scrollPos.synclog = 0;
  render();
}
function closeLog() {
  state.trk.logOpen = false;
  state.setOpen = 'trackers';
  render();
  const b = app.querySelector('[data-f="trk:log"]');
  if (b) b.focus({ preventScroll: true });
}
// Settings shows one of the trackers' pages over its groups, or none.
function trkPageView() {
  if (!state.trk || !state.trk.info) return null;
  if (state.trk.page) return syncView();
  if (state.trk.logOpen) return logView();
  return null;
}

async function trkCheckNow() {
  if (state.trk.checking) return;
  state.trk.checking = true;
  state.trk.logMsg = null;
  render();
  const res = await send({ type: 'trk:check', why: 'manual', wait: true });
  state.trk.checking = false;
  if (!res.ok && res.error && !res.errors) state.trk.logMsg = { kind: 'error', text: res.error };
  render();
}

async function decideGone(t, mid, g, act) {
  const T = state.trk.info[t];
  const key = `${t}:${mid}`;
  if (state.trk.deciding[key]) return;
  state.trk.deciding[key] = act;
  state.trk.logMsg = null;
  render();
  const res = await send({ type: 'trk:gone', t, mediaId: Number(mid), act });
  delete state.trk.deciding[key];
  if (!res.ok) state.trk.logMsg = { kind: 'error', text: res.error || `${T.name} didn't answer. Try again in a moment.` };
  else {
    const side = g.side === 'tr' ? 'AniList' : T.name;
    toast(act === 'keep' ? `${g.title} stays on ${side}` : `Removed ${g.title} from ${side}`, { coverImage: { color: g.color } });
  }
  render();
}

async function undoLog(en) {
  if (state.trk.undoing[en.id]) return;
  state.trk.undoing[en.id] = true;
  state.trk.logMsg = null;
  render();
  const res = await send({ type: 'trk:logUndo', id: en.id });
  delete state.trk.undoing[en.id];
  if (!res.ok) state.trk.logMsg = { kind: 'error', text: res.error || 'That couldn\'t be undone.' };
  render();
}

/* The words */

const isToday = (at) => new Date(at).toDateString() === new Date().toDateString();
function dayWord(at) {
  const d = new Date(at);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (isToday(at)) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const o = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString('en-GB', o);
}
const timeWord = (at) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// AniList's own values (score out of 100) in your words: the score in your score format.
function alScoreIn(raw) {
  const f = fmtNow();
  if (f === 'POINT_100') return Math.round(raw);
  if (f === 'POINT_10_DECIMAL') return Math.round(raw) / 10;
  if (f === 'POINT_5') return Math.max(1, Math.round(raw / 20));
  if (f === 'POINT_3') return raw > 60 ? 3 : raw > 35 ? 2 : 1;
  return Math.max(1, Math.round(raw / 10));
}
function alValue(k, v, kind) {
  if (k === 'sc') return v ? scoreText(alScoreIn(v)) : 'none';
  return trkValue(k, v, kind, 'al');
}
const logValue = (en, k, v) => (en.side === 'al' ? alValue(k, v, en.kind) : trkValue(k, v, en.kind, en.t));

// Where it was written, and from where: "Changed on AniList, from MyAnimeList", "Added to MyAnimeList".
function logWhere(en) {
  const name = state.trk.info[en.t] ? state.trk.info[en.t].name : en.t;
  if (en.op === 'apply') return en.auto ? `Started syncing with AniList by itself` : 'Compare applied';
  const on = en.side === 'al' ? 'AniList' : name;
  // 0.12.3: made private on AniList, it left MyAnimeList (which has no private titles), from Settings, NSFW titles.
  if (en.op === 'remove' && en.why === 'private') return `Removed from ${on}: it's private on AniList now`;
  if (en.op === 'remove') return `Removed from ${on}, as you did on ${en.side === 'al' ? name : 'AniList'}`;
  const verb = en.op === 'add' ? `Added to ${on}` : `Changed on ${on}`;
  return en.side === 'al' ? `${verb}, from ${name}` : verb;
}

function logChip(en, c) {
  const had = c.a !== null && c.a !== undefined && c.a !== '' && !(c.k !== 's' && c.k !== 'pv' && !c.a);
  return h('span', { class: 'cmp-diff' }, h('span', { class: 'cmp-k' }, keyWord(c.k, en.kind)),
    had && en.op === 'set' ? [h('s', {}, logValue(en, c.k, c.a)), h('span', { class: 'cmp-arrow', 'aria-label': 'to' }, '→')] : null,
    h('b', {}, logValue(en, c.k, c.b)));
}

// A Compare applied, or a kind that started syncing by itself (0.10.2): what it did, in a few pieces.
function applyPieces(en) {
  const name = state.trk.info[en.t] ? state.trk.info[en.t].name : en.t;
  const c = en.counts || {};
  const n = (x, one, many) => (x === 1 ? one : many.replace('#', x));
  const out = [];
  if (c.add) out.push(n(c.add, `1 added to ${name}`, `# added to ${name}`));
  if (c.diff) out.push(n(c.diff, `1 changed there`, `# changed there`));
  if (c.only) out.push(n(c.only, `1 removed there`, `# removed there`));
  if (c.recent) out.push(n(c.recent, '1 coming to AniList', '# coming to AniList'));
  if (!out.length) out.push('Both lists already matched');
  return out.map((x) => h('span', { class: 'cmp-piece' }, x));
}

function logRow(en) {
  const name = state.trk.info[en.t] ? state.trk.info[en.t].name : en.t;
  const busy = state.trk.undoing[en.id];
  const undoNow = state.trk.undo[en.t];
  const canUndo = !en.undone && state.trk.acct[en.t] && (en.op !== 'apply' || (undoNow && undoNow.at === en.undoAt && undoNow.ops && undoNow.ops.length));
  if (en.op === 'apply') en = { ...en, title: `Your ${en.kind === 'MANGA' ? 'manga' : 'anime'} on ${name}` };
  const chips = en.op === 'apply' ? applyPieces(en) : en.op === 'remove' ? [] : (en.ch || []).filter((c) => en.op === 'set' || !(c.b === 0 || c.b === '' || c.b === false || c.b === null)).map((c) => logChip(en, c));
  const both = en.both && en.both.length ? `Changed on both sides: ${en.side === 'al' ? name : 'AniList'} had the newer change.` : null;
  return h('div', { class: 'cmp-row log-row' + (en.undone ? ' is-undone' : ''), 'data-id': en.id, style: en.color ? `--c:${en.color}` : null },
    h('span', { class: 'cmp-cover' + (en.op === 'apply' ? ' log-mark' : '') }, en.cover ? cover(en.cover) : en.op === 'apply' ? icon('repeat') : null),
    h('div', { class: 'cmp-text' },
      h('div', { class: 'cmp-title' }, en.title || `Title ${en.mid}`),
      h('div', { class: 'log-where' }, logWhere(en)),
      chips.length ? h('div', { class: 'cmp-diffs' }, chips) : null,
      both ? h('div', { class: 'cmp-note' }, both) : null),
    h('span', { class: 'log-side' },
      h('time', { class: 'log-time', datetime: new Date(en.at).toISOString(), title: exactTime(en.at) }, timeWord(en.at)),
      en.undone ? h('span', { class: 'log-undone' }, 'Undone')
        : canUndo ? h('button', { class: 'trk-quiet log-undo', 'data-f': `log:undo:${en.id}`, 'data-nav': '', disabled: !!busy, 'aria-label': `Undo: ${logWhere(en)}, ${en.title}`, onclick: () => undoLog(en) }, busy ? spin() : 'Undo') : null));
}

function goneRow(t, mid, g) {
  const T = state.trk.info[t];
  const busy = state.trk.deciding[`${t}:${mid}`];
  const there = g.side === 'tr' ? 'AniList' : T.name;
  let text = g.side === 'tr' ? `Removed from ${T.name}. Still on your AniList list.` : `Removed from your AniList list. Still on ${T.name}.`;
  if (g.changed) text = g.side === 'tr' ? `Removed from ${T.name}, but changed on AniList since.` : `Removed from your AniList list, but changed on ${T.name} since.`;
  return h('div', { class: 'cmp-row log-row is-gone', 'data-id': `${t}:${mid}`, style: g.color ? `--c:${g.color}` : null },
    h('span', { class: 'cmp-cover' }, g.cover ? cover(g.cover) : null),
    h('div', { class: 'cmp-text' },
      h('div', { class: 'cmp-title' }, g.title),
      h('div', { class: 'log-where' }, text),
      h('div', { class: 'log-acts' },
        h('button', { class: 'tp-btn is-small', 'data-f': `gone:keep:${t}:${mid}`, 'data-nav': '', disabled: !!busy, onclick: () => decideGone(t, mid, g, 'keep') }, busy === 'keep' ? spin() : null, `Keep on ${there}`),
        h('button', { class: 'trk-quiet is-bad', 'data-f': `gone:remove:${t}:${mid}`, 'data-nav': '', disabled: !!busy, onclick: () => decideGone(t, mid, g, 'remove') }, busy === 'remove' ? spin() : null, `Remove from ${there}`))));
}

function checkedLine() {
  const c = state.trk.checked;
  const out = [];
  if (state.trk.checking) out.push(h('span', { class: 'log-checking' }, spin(), 'Checking for changes'));
  else out.push(h('span', {}, c && c.at ? `Checked ${ago(c.at)}` : 'Not checked yet'));
  const errs = (c && c.err) || {};
  for (const [k, msg] of Object.entries(errs)) {
    const name = k === 'al' ? 'AniList' : state.trk.info[k] ? state.trk.info[k].name : k;
    const why = String(msg || '').replace(new RegExp(`^${name}: `), '').replace(/\.$/, '');
    out.push(h('span', { class: 'is-warn' }, `${name} didn't answer (${why}). Tsugi asks again in a few minutes.`));
  }
  return h('p', { class: 'log-checked' }, out);
}

function logView() {
  const on = trkIds().filter((t) => state.trk.acct[t]);
  const names = on.map((t) => state.trk.info[t].name);
  const head = [
    h('button', { class: 'cmp-back', 'data-f': 'log:back', 'data-nav': '', onclick: closeLog }, icon('back'), 'Settings'),
    h('header', { class: 'sec-head cmp-head' }, h('h2', { class: 'sec-title' }, 'Sync log'),
      h('button', { class: 'trk-quiet log-check', 'data-f': 'log:check', 'data-nav': '', disabled: state.trk.checking || !on.length, onclick: trkCheckNow }, 'Check now')),
    h('p', { class: 'cmp-lead' }, names.length
      ? `What you change on ${names.join(' or ')} comes to AniList, and what you change on AniList goes there, wherever you make the change. Each change Tsugi made is here, newest first.`
      : 'Connect a tracker in Settings to sync it with AniList.'),
    checkedLine(),
    state.trk.logMsg ? h('div', { class: `msg is-${state.trk.logMsg.kind}`, role: 'alert' }, state.trk.logMsg.text) : null,
  ];
  const waiting = on.flatMap((t) => goneOf(t).map(([mid, g]) => goneRow(t, mid, g)));
  const parts = [];
  if (waiting.length) {
    parts.push(h('section', { class: 'log-wait' },
      h('h3', { class: 'log-h' }, 'Waiting for you', h('span', { class: 'log-n' }, String(waiting.length))),
      h('p', { class: 'set-d log-wait-d' }, 'Removed on one side, still on the other. Remove takes it off the other side too; Keep leaves both lists as they are, and that title stops syncing there.'),
      on.some((t) => goneOf(t).some(([, g]) => g.brake)) ? h('p', { class: 'set-d log-wait-d is-warn' }, 'A check found more than 10 titles removed at once, so they wait for you: a list that didn\'t load in full, or another account, can look like that.') : null,
      h('div', { class: 'cmp-rows' }, waiting)));
  }
  const log = state.trk.log.filter((x) => state.trk.info[x.t]);
  const shown = state.trk.logAll ? log : log.slice(0, LOG_ROWS);
  if (!log.length) {
    parts.push(h('p', { class: 'log-empty' }, on.length ? 'Nothing has travelled yet. Each change shows up here once Tsugi has synced it.' : 'Nothing has travelled yet.'));
  } else {
    let day = null;
    let rows = [];
    const flush = () => { if (rows.length) parts.push(h('section', { class: 'log-day' }, h('h3', { class: 'log-h' }, day), h('div', { class: 'cmp-rows' }, rows))); rows = []; };
    for (const en of shown) {
      const d = dayWord(en.at);
      if (d !== day) { flush(); day = d; }
      rows.push(logRow(en));
    }
    flush();
    if (shown.length < log.length) parts.push(h('button', { class: 'more', 'data-f': 'log:more', onclick: () => { state.trk.logAll = true; render(); } }, `Show all ${log.length}`));
  }
  return h('div', { class: 'cmp log' }, head, parts);
}
