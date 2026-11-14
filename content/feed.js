// Tsugi · Activity feed filters on Home: hide activity by type, person or word.
'use strict';

/* ------------------------------------------------------------------ */
/* Feed filters                                                        */
/* ------------------------------------------------------------------ */
// Everything happens in the page: activity AniList already loaded is hidden or shown again,
// nothing is asked of AniList. The filters live in sync storage ("feed"), so every computer
// with the extension uses the same ones.

const FEED_KINDS = [
  ['text', 'Status posts'],
  ['message', 'Messages'],
  ['progress', 'Progress'],
  ['complete', 'Completed'],
  ['plan', 'Planning'],
  ['drop', 'Paused and dropped'],
  ['repeat', 'Rewatches'],
];
const FEED_MEDIA = [['anime', 'Anime'], ['manga', 'Manga']];
const FEED_KEYS = new Set([...FEED_KINDS, ...FEED_MEDIA].map(([k]) => k));
const FEED_RE = /^\/(?:home)?\/?$/;
const FD = {
  route: false,
  settings: normalizeFeed({}),
  btn: null, bar: null, panel: null,
  peek: false,      // showing hidden activity, faded
  hidden: 0, total: 0,
  names: new Set(), // people seen in the feed, offered when you type a name
  want: 0,          // open the panel as soon as the feed is drawn (until this time)
};

function normalizeFeed(raw) {
  const f = Object.assign({ hidden: [], users: [], userMode: 'hide', words: [], wordMode: 'hide' }, objectOr(raw));
  const list = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 100) : []);
  f.hidden = list(f.hidden).filter((k) => FEED_KEYS.has(k));
  f.users = list(f.users);
  f.words = list(f.words);
  if (!['hide', 'only'].includes(f.userMode)) f.userMode = 'hide';
  if (!['hide', 'only'].includes(f.wordMode)) f.wordMode = 'hide';
  return f;
}

let feedSaveTimer = 0;
function saveFeed() {
  clearTimeout(feedSaveTimer);
  feedSaveTimer = setTimeout(() => store.set('sync', 'feed', { ...FD.settings }), 250);
}

const feedActive = () => FD.route && !!S.settings.feedFilters;
const feedFiltering = (f = FD.settings) => f.hidden.length > 0 || f.users.length > 0 || f.words.length > 0;

function onFeedRoute(on) {
  FD.route = !!on;
  closeFeedPanel();
  if (!FD.route) { FD.peek = false; FD.names.clear(); }
  syncFeed();
}

// The feed itself: AniList's activity column on Home.
function feedEntries() {
  const scope = document.querySelector('.activity-feed') || document.querySelector('.activity-feed-wrap');
  if (!scope) return [];
  return [...scope.querySelectorAll('.activity-entry')].filter((el) => !el.closest('.apq-ui') && !el.parentElement.closest('.activity-entry'));
}

// Inside an activity, outside its replies.
function ownParts(el, sel) {
  return [...el.querySelectorAll(sel)].filter((x) => !x.closest('.activity-replies, .reply-wrap, .replies, .reply'));
}

// What an activity is: { kind, media, names, text }, or null for a shape we don't know (left alone).
const feedInfoCache = new WeakMap();
function feedInfo(el) {
  const sig = `${el.className}|${el.textContent.length}`;
  const hit = feedInfoCache.get(el);
  if (hit && hit.sig === sig) return hit.info;
  const c = String(el.className || '');
  let kind = null, media = null;
  const titleLink = ownParts(el, 'a.title, .status a[href*="/anime/"], .status a[href*="/manga/"]')[0];
  if (/activity-message/.test(c)) kind = 'message';
  else if (/activity-text/.test(c)) kind = 'text';
  else {
    media = /manga_list/.test(c) ? 'manga' : /anime_list/.test(c) ? 'anime' : null;
    if (!media && titleLink) media = /\/manga\//.test(titleLink.getAttribute('href') || '') ? 'manga' : 'anime';
    const st = ownParts(el, '.status')[0];
    if (st) {
      // The wording without the title in it ("Watched episode 3 of" + a link), so a title like
      // "Dropkick on My Devil!" isn't taken for a drop.
      const words = [...st.childNodes].filter((n) => !(n.nodeType === 1 && n.matches('a'))).map((n) => n.textContent).join(' ');
      const k = activityKind(words);
      kind = k === 'reprogress' || k === 'recomplete' ? 'repeat' : k === 'pause' || k === 'drop' ? 'drop' : k;
    }
    if (!kind && !media) { feedInfoCache.set(el, { sig, info: null }); return null; }
  }
  const nameEls = ownParts(el, 'a.name');
  const names = (nameEls.length ? nameEls : ownParts(el, 'a[href^="/user/"]').slice(0, 1))
    .map((a) => a.textContent.trim() || decodeURIComponent((a.getAttribute('href') || '').split('/')[2] || '')).filter(Boolean);
  const bits = [...names];
  for (const x of ownParts(el, '.status, .activity-markdown, a.title')) bits.push(x.textContent);
  const text = norm(bits.join(' \n '));
  const info = { kind, media, names, text };
  feedInfoCache.set(el, { sig, info });
  return info;
}

// Why an activity is hidden ('type', 'user' or 'word'), or null to show it.
function feedHides(info, f = FD.settings) {
  if (!info) return null;
  if (info.kind && f.hidden.includes(info.kind)) return 'type';
  if (info.media && f.hidden.includes(info.media)) return 'type';
  if (f.users.length) {
    const want = f.users.map((u) => norm(u));
    const hit = info.names.some((n) => want.includes(norm(n)));
    if (f.userMode === 'hide' ? hit : !hit) return 'user';
  }
  if (f.words.length) {
    const hit = f.words.some((w) => info.text.includes(norm(w)));
    if (f.wordMode === 'hide' ? hit : !hit) return 'word';
  }
  return null;
}

function clearFeedMarks() {
  for (const el of document.querySelectorAll('[data-apq-hide]')) el.removeAttribute('data-apq-hide');
  document.documentElement.classList.remove('apq-feed-peek');
}

// Hide the global feed (0.12.7, the hideGlobal setting, off at first): on Home, AniList's Following / Global switch
// (`.activity-feed-wrap .feed-type-toggle`, read from its bundle on 2026-11-13) goes, and a feed showing Global
// switches to Following (a click on AniList's own Following). Logged out, AniList only has the global feed ("Site
// Activity"): the whole feed goes. Called from the page observer too, so it happens before the page is painted.
function hideGlobalFeed() {
  const on = FD.route && !!S.settings.hideGlobal;
  const wrap = on ? document.querySelector('.activity-feed-wrap') : null;
  const tg = wrap && wrap.querySelector('.section-header .feed-type-toggle');
  const head = wrap && wrap.querySelector('.section-header');
  const target = tg || (wrap && head && /^\s*site activity\s*$/i.test(head.textContent) ? wrap : null);
  for (const el of document.querySelectorAll('[data-apq-noglobal]')) if (el !== target) el.removeAttribute('data-apq-noglobal');
  if (!target) return;
  if (!target.hasAttribute('data-apq-noglobal')) target.setAttribute('data-apq-noglobal', '');
  if (!tg) return;
  const opts = Array.from(tg.children);
  const glob = opts.find((d) => /^\s*global\s*$/i.test(d.textContent));
  const fol = opts.find((d) => /^\s*following\s*$/i.test(d.textContent));
  if (glob && fol && glob.classList.contains('active') && !fol.classList.contains('active')) fol.click();
}

// Called whenever the page changes, and after any change to the filters.
function decorateFeed() {
  hideGlobalFeed();
  if (!feedActive()) return;
  const entries = feedEntries();
  let hidden = 0;
  for (const el of entries) {
    const info = feedInfo(el);
    if (info) for (const n of info.names) FD.names.add(n);
    const why = feedFiltering() ? feedHides(info) : null;
    if (why) { hidden++; if (el.getAttribute('data-apq-hide') !== why) el.setAttribute('data-apq-hide', why); }
    else if (el.hasAttribute('data-apq-hide')) el.removeAttribute('data-apq-hide');
  }
  FD.hidden = hidden;
  FD.total = entries.length;
  document.documentElement.classList.toggle('apq-feed-peek', FD.peek && hidden > 0);
  placeFeedUI();
  if (FD.panel) renderFeedFoot();
  if (FD.want && FD.btn && FD.btn.isConnected) {
    const ok = Date.now() < FD.want;
    FD.want = 0;
    if (ok) openFeedPanel();
  }
}

// Turns the filters on or off for this page (the setting, or the route, changed).
function syncFeed() {
  hideGlobalFeed();
  if (!feedActive()) {
    clearFeedMarks();
    if (FD.btn) FD.btn.remove();
    if (FD.bar) FD.bar.remove();
    FD.btn = null; FD.bar = null;
    closeFeedPanel();
    return;
  }
  decorateFeed();
}

function wantFeedPanel() {
  FD.want = Date.now() + 15000;
  decorateFeed();
}

// The Filter button goes in the feed's header, next to AniList's Following / Global switch.
// A thin bar above the feed says how many activities are hidden, with a way to see them.
function placeFeedUI() {
  const feed = document.querySelector('.activity-feed');
  const wrap = document.querySelector('.activity-feed-wrap') || (feed && feed.parentElement);
  if (!feed && !wrap) return;
  const header = wrap && wrap.querySelector('.section-header');
  if (!FD.btn) {
    FD.btn = h('button', {
      type: 'button', class: 'apq-ui apq-feed-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
      onclick: (ev) => { ev.stopPropagation(); if (FD.panel) closeFeedPanel(); else openFeedPanel(); },
    }, icon('sliders'), h('span', { class: 'apq-feed-btn-label' }, 'Filters'), h('span', { class: 'apq-feed-btn-n' }));
  }
  if (!FD.bar) {
    FD.peekBtn = h('button', { type: 'button', class: 'apq-feed-peek-btn', onclick: () => { FD.peek = !FD.peek; decorateFeed(); } });
    FD.barText = h('span', { class: 'apq-feed-bar-text' });
    FD.bar = h('div', { class: 'apq-ui apq-feed-bar', role: 'status' }, FD.barText, FD.peekBtn);
  }
  if (header) {
    if (FD.btn.parentElement !== header) header.append(FD.btn);
  } else if (FD.btn.parentElement !== FD.bar) {
    FD.bar.prepend(FD.btn);
  }
  if (feed) { if (FD.bar.nextElementSibling !== feed) feed.before(FD.bar); }
  else if (FD.bar.parentElement !== wrap) wrap.append(FD.bar);
  const n = FD.hidden;
  const on = feedFiltering();
  FD.btn.classList.toggle('is-on', on);
  const count = FD.btn.querySelector('.apq-feed-btn-n');
  const ct = n ? String(n) : '';
  if (count.textContent !== ct) count.textContent = ct;
  FD.btn.setAttribute('aria-label', on ? `Feed filters (${n} hidden)` : 'Feed filters');
  FD.btn.title = on ? `${n} ${n === 1 ? 'activity' : 'activities'} hidden by your filters` : 'Filter the feed by type, person or word';
  FD.bar.hidden = !n && !!header;
  const txt = n ? `${n} of ${FD.total} ${FD.total === 1 ? 'activity' : 'activities'} hidden by your filters` : on ? 'Nothing hidden so far' : 'Feed filters';
  if (FD.barText.textContent !== txt) FD.barText.textContent = txt;
  FD.peekBtn.hidden = !n;
  const pt = FD.peek ? 'Hide them again' : 'Show them';
  if (FD.peekBtn.textContent !== pt) FD.peekBtn.textContent = pt;
}

/* The panel ---------------------------------------------------------- */

function openFeedPanel() {
  if (!feedActive()) return;
  placeFeedUI();
  if (!FD.btn || !FD.btn.isConnected) { wantFeedPanel(); return; }
  closeFeedPanel();
  hideTip();
  FD.panel = h('div', { class: 'apq-ui apq-feed-panel', role: 'dialog', 'aria-label': 'Feed filters' });
  document.body.append(FD.panel);
  FD.btn.setAttribute('aria-expanded', 'true');
  renderFeedPanel();
  positionFeedPanel();
  requestAnimationFrame(() => { if (FD.panel) FD.panel.classList.add('is-open'); });
  setTimeout(() => document.addEventListener('pointerdown', onFeedOutside, true), 0);
}

function closeFeedPanel() {
  if (!FD.panel) return;
  document.removeEventListener('pointerdown', onFeedOutside, true);
  FD.panel.remove();
  FD.panel = null;
  if (FD.btn) FD.btn.setAttribute('aria-expanded', 'false');
}

function onFeedOutside(ev) {
  if (FD.panel && !FD.panel.contains(ev.target) && !(FD.btn && FD.btn.contains(ev.target))) closeFeedPanel();
}

function positionFeedPanel() {
  if (!FD.panel || !FD.btn) return;
  if (!FD.btn.isConnected) { closeFeedPanel(); return; }
  const r = FD.btn.getBoundingClientRect();
  const w = Math.min(360, window.innerWidth - 16);
  FD.panel.style.width = `${w}px`;
  const ht = FD.panel.offsetHeight;
  let top = r.bottom + 8;
  if (top + ht > window.innerHeight - 8 && r.top - ht - 8 > 8) top = r.top - ht - 8;
  FD.panel.style.top = `${Math.max(8, top)}px`;
  FD.panel.style.left = `${clamp(r.left, 8, window.innerWidth - w - 8)}px`;
}

function setFeed(patch) {
  FD.settings = normalizeFeed({ ...FD.settings, ...patch });
  saveFeed();
  decorateFeed();
  renderFeedPanel();
}

function feedListEditor(key, modeKey, title, placeholder, suggest) {
  const f = FD.settings;
  const listId = `apq-feed-${key}-names`;
  const input = h('input', { type: 'text', class: 'apq-feed-input', placeholder, 'aria-label': placeholder, spellcheck: 'false', autocomplete: 'off', 'data-k': `${key}-input`, list: suggest ? listId : null });
  const addValue = () => {
    const vals = input.value.split(',').map((x) => x.trim()).filter(Boolean);
    input.value = '';
    if (!vals.length) return;
    const have = new Set(f[key].map((x) => norm(x)));
    setFeed({ [key]: [...f[key], ...vals.filter((v) => !have.has(norm(v)))] });
    const again = FD.panel && FD.panel.querySelector(`[data-k="${key}-input"]`);
    if (again) again.focus({ preventScroll: true });
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); addValue(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); closeFeedPanel(); if (FD.btn) FD.btn.focus({ preventScroll: true }); }
  });
  input.addEventListener('change', () => { if (suggest && FD.names.has(input.value.trim())) addValue(); });
  const seg = h('div', { class: 'apq-seg apq-feed-seg', role: 'radiogroup', 'aria-label': `${title}: hide or only show` },
    [['hide', 'Hide'], ['only', 'Only show']].map(([v, label]) => h('button', {
      type: 'button', role: 'radio', class: 'apq-seg-btn' + (f[modeKey] === v ? ' is-active' : ''), 'aria-checked': String(f[modeKey] === v),
      'data-k': `${modeKey}:${v}`, onclick: () => setFeed({ [modeKey]: v }),
    }, label)));
  const chips = h('div', { class: 'apq-feed-chips' }, f[key].map((v) => h('span', { class: 'apq-feed-chip' },
    h('span', {}, v),
    h('button', { type: 'button', class: 'apq-feed-chip-x', 'aria-label': `Remove ${v}`, onclick: () => setFeed({ [key]: f[key].filter((x) => x !== v) }) }, icon('x')))));
  const kids = [
    h('div', { class: 'apq-feed-sec-head' }, h('span', { class: 'apq-feed-h' }, title), seg),
    h('div', { class: 'apq-feed-add' }, input, h('button', { type: 'button', class: 'apq-feed-add-btn', 'aria-label': 'Add', 'data-k': `${key}-add`, onclick: addValue }, icon('plus'))),
  ];
  if (suggest) {
    const have = new Set(f.users.map((x) => norm(x)));
    kids.push(h('datalist', { id: listId }, [...FD.names].filter((n) => !have.has(norm(n))).sort((a, b) => a.localeCompare(b)).map((n) => h('option', { value: n }))));
  }
  if (f[key].length) kids.push(chips);
  return h('section', { class: 'apq-feed-sec' }, kids);
}

function renderFeedPanel() {
  if (!FD.panel) return;
  const f = FD.settings;
  const active = document.activeElement;
  const focusKey = active && FD.panel.contains(active) ? active.dataset.k : null;
  const chip = ([k, label]) => {
    const shown = !f.hidden.includes(k);
    return h('button', {
      type: 'button', class: 'apq-tchip', 'aria-pressed': String(shown), 'data-k': `kind:${k}`,
      title: shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`,
      onclick: () => setFeed({ hidden: shown ? [...f.hidden, k] : f.hidden.filter((x) => x !== k) }),
    }, icon('check'), label);
  };
  FD.foot = h('footer', { class: 'apq-feed-foot' });
  FD.panel.replaceChildren(
    h('header', { class: 'apq-feed-head' },
      h('span', { class: 'apq-feed-title' }, 'Feed filters'),
      h('button', { type: 'button', class: 'apq-icon-btn', 'aria-label': 'Close', onclick: () => closeFeedPanel() }, icon('x'))),
    h('section', { class: 'apq-feed-sec' },
      h('div', { class: 'apq-feed-sec-head' }, h('span', { class: 'apq-feed-h' }, 'Show')),
      h('div', { class: 'apq-feed-kinds' }, FEED_KINDS.map(chip)),
      h('div', { class: 'apq-feed-kinds' }, FEED_MEDIA.map(chip))),
    feedListEditor('users', 'userMode', 'People', 'Add a name', true),
    feedListEditor('words', 'wordMode', 'Words', 'Add a word or phrase', false),
    FD.foot);
  renderFeedFoot();
  if (focusKey) {
    const el = FD.panel.querySelector(`[data-k="${focusKey}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  positionFeedPanel();
}

function renderFeedFoot() {
  if (!FD.foot) return;
  const n = FD.hidden;
  FD.foot.replaceChildren(...[
    h('span', { class: 'apq-feed-sum' }, feedFiltering()
      ? `${n} of ${FD.total} loaded ${FD.total === 1 ? 'activity' : 'activities'} hidden`
      : 'Showing everything'),
    feedFiltering() ? h('button', {
      type: 'button', class: 'apq-feed-reset', 'data-k': 'reset',
      onclick: () => {
        const before = { ...FD.settings };
        setFeed({ hidden: [], users: [], words: [] });
        toast('Feed filters cleared', 'ok', { label: 'Undo', run: () => setFeed(before) });
      },
    }, 'Clear all') : null].filter(Boolean));
}

// Filters changed in another tab.
function onFeedStorage(value) {
  const next = normalizeFeed(value);
  if (JSON.stringify(next) === JSON.stringify(FD.settings)) return;
  FD.settings = next;
  decorateFeed();
  renderFeedPanel();
}
