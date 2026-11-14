// Tsugi · MyAnimeList's parts on AniList's own title page (0.8): its score in the sidebar, a switch on
// Characters between AniList's list and MyAnimeList's (often fuller), and the openings and endings.
'use strict';

/* ------------------------------------------------------------------ */
/* Outside AniList, on AniList's title page                            */
/* ------------------------------------------------------------------ */
// The data comes through the background (background.js "outside": Tenrai for MyAnimeList, AnimeThemes for
// the songs), asked only by the title's MyAnimeList number, and kept there. When a service doesn't answer,
// its part simply isn't shown. Everything here is styled like AniList's own parts of that page (its sidebar
// lines, its character cards, its section headings), read from AniList's page and stylesheet on 2026-11-12:
// `.sidebar .data > .data-set` (`.type`, `.value`), `.overview > .characters` (`h2.link`, `.grid-wrap` of
// `.role-card`), `.overview > .staff`, `.relations`. The "malData" setting turns the characters and songs off;
// each score has its own switch (0.12.4, `scores`): MyAnimeList's, and MangaBaka's for manga (its public API,
// asked by AniList's number), as lines of AniList's sidebar. Kitsu's only shows in the popup.

const MALID_QUERY = 'query TsugiMalId($id: Int) { Media(id: $id) { id idMal type } }';
const XP_IDS_KEY = 'ext:ids';     // local: AniList number -> MyAnimeList number (0: none), for the title pages
const XP_IDS_MAX = 600;
const XP_CHARS_FOLD = 6;           // AniList shows six characters on a title's page
const XP_SONGS_FOLD = 4;
const XP = {
  route: null, mal: undefined, info: undefined, chars: undefined, themes: undefined, mb: undefined,
  from: 'mal', allChars: false, allSongs: false, playing: null,
  score: null, mbScore: null, sw: null, grid: null, sec: null, songs: null,
  links: null,   // the MyAnimeList and Reddit links (0.12.7): AniList's own links, or a box of Tsugi's when it has none
};

const xpMalOn = () => S.settings.malData !== false;
const xpScoreOn = (k) => !S.settings.scores || S.settings.scores[k] !== false;
const xpLinksOn = () => S.settings.sideLinks !== false;
const xpOn = () => xpMalOn() || xpScoreOn('mal') || xpScoreOn('mb') || xpLinksOn();
const xpKind = () => (XP.route && XP.route.type === 'MANGA' ? 'manga' : 'anime');

function xpRemove() {
  for (const k of ['score', 'mbScore', 'sw', 'grid', 'sec', 'songs', 'links']) { if (XP[k]) XP[k].remove(); XP[k] = null; }
  for (const el of document.querySelectorAll('[data-apq-xhide]')) el.removeAttribute('data-apq-xhide');
}

// Called by onRoute (main.js) with { type, id } on a title's page, null elsewhere; and when the setting changes.
// What's switched on: a change starts the title's parts over (each part is asked only while on).
const xpParts = () => [xpMalOn(), xpScoreOn('mal'), xpScoreOn('mb'), xpLinksOn()].join();
function onOutsideRoute(r) {
  if (r && XP.route && XP.route.id === r.id && XP.route.type === r.type && xpOn() && XP.parts === xpParts()) { decorateOutside(); return; }
  xpRemove();
  XP.parts = xpParts();
  Object.assign(XP, { route: r && xpOn() ? r : null, mal: undefined, info: undefined, chars: undefined, themes: undefined, mb: undefined, allChars: false, allSongs: false, playing: null });
  if (XP.route) xpLoad(XP.route);
}

async function xpMalId(r) {
  const ids = (await store.get('local', XP_IDS_KEY)) || {};
  if (r.id in ids) return ids[r.id] || null;
  let mal = null;
  try {
    const d = await gqlRead(MALID_QUERY, { id: r.id }, 'low');
    mal = (d && d.Media && d.Media.idMal) || 0;
  } catch { return null; }   // asked again next time
  const keys = Object.keys(ids);
  if (keys.length >= XP_IDS_MAX) for (const k of keys.slice(0, keys.length - XP_IDS_MAX + 1)) delete ids[k];
  ids[r.id] = mal;
  store.set('local', XP_IDS_KEY, ids);
  return mal || null;
}

function xpAsk(what, r) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'outside', what, kind: r.type, mal: XP.mal, al: r.id }, (res) => {
        resolve(!chrome.runtime.lastError && res && res.ok ? res.data : null);
      });
    } catch { resolve(null); }
  });
}

async function xpLoad(r) {
  const from = await store.get('local', 'castFrom');
  if (XP.route !== r) return;
  XP.from = from === 'anilist' ? 'anilist' : 'mal';   // MyAnimeList's characters first (0.8.1), until you pick AniList's
  // MangaBaka's score (manga) is asked by AniList's own number: no need to wait for MyAnimeList's.
  const manga = r.type === 'MANGA';
  if (manga && xpScoreOn('mb')) {
    xpAsk('mb', r).then((v) => { if (XP.route === r) { XP.mb = v; decorateOutside(); } });
  } else XP.mb = null;
  const parts = [xpScoreOn('mal') ? 'info' : null, ...(xpMalOn() ? ['chars', manga ? null : 'themes'] : [])].filter(Boolean);
  for (const k of ['info', 'chars', 'themes']) if (!parts.includes(k)) XP[k] = null;
  XP.mal = parts.length || xpLinksOn() ? await xpMalId(r) : null;
  if (XP.route !== r) return;
  for (const what of parts) {
    if (!XP.mal && what !== 'themes') { XP[what] = null; continue; }
    xpAsk(what, r).then((v) => {
      if (XP.route !== r) return;
      XP[what] = v;
      decorateOutside();
    });
  }
  decorateOutside();
}

// Puts each part in place (AniList redraws its page often: anything it removed comes back).
function decorateOutside() {
  if (!XP.route || !xpOn()) return;
  xpPlaceScore();
  xpPlaceChars();
  xpPlaceSongs();
  xpPlaceLinks();
}

const xpLink = (url, cls, kids) => h('a', { class: cls, href: url, target: '_blank', rel: 'noopener noreferrer' }, kids);
const xpPage = () => document.querySelector('.media-page-unscoped') || document;
const xpOverview = () => { const o = xpPage().querySelector('.content .overview, .overview'); return o && !o.closest('.apq-ui') ? o : null; };

/* The other sites' scores: lines of AniList's own sidebar, after its Mean Score ------------------- */
// MyAnimeList's ("MyAnimeList Score 9.30") and, for manga, MangaBaka's ("MangaBaka Score 89", out of 100 as
// MangaBaka writes it), each a link to the title there.

function xpPlaceScore() {
  const info = XP.info;
  const mb = XP.mb;
  const mal = info && info.score && xpScoreOn('mal') ? { label: 'MyAnimeList Score', value: info.score.toFixed(2), url: info.url,
    title: info.by ? `From ${info.by.toLocaleString('en-GB')} scores on MyAnimeList` : 'Open on MyAnimeList' } : null;
  const n = mb && mb.score ? String(Math.round(mb.score)) : null;
  const baka = n && xpScoreOn('mb') && XP.route && XP.route.type === 'MANGA'
    ? { label: 'MangaBaka Score', value: n, url: mb.url, title: `${n} out of 100 on MangaBaka` } : null;
  xpPlaceLine('score', mal, null);
  xpPlaceLine('mbScore', baka, XP.score && XP.score.isConnected ? XP.score : null);
}

// One line of AniList's sidebar (`key` is where XP keeps it), placed after `after`, else after Mean Score.
function xpPlaceLine(key, line, after) {
  if (!line) { if (XP[key]) { XP[key].remove(); XP[key] = null; } return; }
  const data = xpPage().querySelector('.sidebar .data');
  if (!data) return;
  const sets = Array.from(data.querySelectorAll(':scope > .data-set')).filter((el) => !el.classList.contains('apq-ui'));
  const typeOf = (el) => { const t = el.querySelector('.type'); return t ? t.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const anchor = after || sets.find((el) => /^mean score/i.test(typeOf(el))) || sets.find((el) => /average score/i.test(typeOf(el)))
    || sets.find((el) => /^popularity/i.test(typeOf(el)));
  const sig = `${line.label}|${line.value}`;
  let el = XP[key];
  if (el && el.isConnected && el.dataset.apqV === sig && (anchor ? el.previousElementSibling === anchor : el.parentElement === data)) return;
  if (!el || el.dataset.apqV !== sig) {
    // A copy of AniList's own line (so its own styles apply), with the score as a link.
    const model = sets.find((x) => /^mean score/i.test(typeOf(x))) || anchor || sets[0];
    if (model) {
      el = model.cloneNode(false);
      const ty = model.querySelector('.type');
      const va = model.querySelector('.value');
      const t = ty ? ty.cloneNode(false) : h('div', { class: 'type' });
      t.textContent = line.label;
      const v = h('a', {}, line.value);
      if (va) for (const a of va.attributes) if (a.name.startsWith('data-v-')) v.setAttribute(a.name, '');
      v.className = 'value';
      v.href = line.url;
      v.target = '_blank';
      v.rel = 'noopener noreferrer';
      v.title = line.title;
      el.append(t, v);
    } else {
      el = h('div', { class: 'data-set' }, h('div', { class: 'type' }, line.label), xpLink(line.url, 'value', line.value));
    }
    el.classList.add('apq-ui', key === 'score' ? 'apq-xscore' : 'apq-xscore-mb');
    el.dataset.apqV = sig;
    if (XP[key]) XP[key].remove();
    XP[key] = el;
  }
  if (anchor) anchor.after(el);
  else data.prepend(el);
}

/* Characters: AniList's or MyAnimeList's, a switch on the section's heading ------------------------- */

function xpSetFrom(k) {
  XP.from = k;
  XP.allChars = false;
  store.set('local', 'castFrom', k);
  if (XP.grid) { XP.grid.remove(); XP.grid = null; }
  decorateOutside();
}

function xpSwitch() {
  const el = h('span', { class: 'apq-ui apq-xsw', role: 'radiogroup', 'aria-label': 'Characters from' });
  // Clicks stay here: AniList's heading opens the Characters tab when clicked.
  el.addEventListener('click', (ev) => ev.stopPropagation());
  return el;
}
function xpDrawSwitch() {
  const sig = XP.from;
  if (XP.sw.dataset.sig === sig) return;
  XP.sw.dataset.sig = sig;
  XP.sw.replaceChildren(...[['mal', 'MyAnimeList'], ['anilist', 'AniList']].map(([k, label]) => h('button', {
    type: 'button', class: 'apq-xsw-btn', role: 'radio', 'aria-checked': String(XP.from === k),
    onclick: () => { if (XP.from !== k) xpSetFrom(k); },
  }, label)));
}

// One of AniList's character cards: the character on the left, the Japanese voice actor on the right.
function xpPerson(p, right, role) {
  const pic = p.img ? h('img', { src: p.img, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : h('span', { class: 'apq-xrc-ini' }, initialsOf(p.name));
  const kids = [p.url ? xpLink(p.url, 'apq-xrc-img', pic) : h('span', { class: 'apq-xrc-img' }, pic),
    (p.url ? (k) => xpLink(p.url, 'apq-xrc-c', k) : (k) => h('span', { class: 'apq-xrc-c' }, k))([h('div', { class: 'apq-xrc-name' }, p.name), h('div', { class: 'apq-xrc-role' }, role)])];
  return h('div', { class: 'apq-xrc-p' + (right ? ' is-right' : '') }, kids);
}
function initialsOf(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  const first = (x) => Array.from(x)[0] || '';
  return (w.length > 1 ? first(w[0]) + first(w[w.length - 1]) : Array.from(w[0]).slice(0, 2).join('')).toUpperCase();
}
function xpDrawGrid() {
  const list = XP.chars;
  const shown = XP.allChars ? list : list.slice(0, XP_CHARS_FOLD);
  const sig = `${XP.allChars}|${list.length}`;
  if (XP.grid.dataset.sig === sig) return;
  XP.grid.dataset.sig = sig;
  const cards = shown.map((c) => h('div', { class: 'apq-xrc' + (c.va ? '' : ' is-single') },
    xpPerson(c, false, c.main ? 'Main' : 'Supporting'),
    c.va ? xpPerson(c.va, true, 'Japanese') : null));
  const more = list.length > XP_CHARS_FOLD ? h('button', {
    type: 'button', class: 'apq-xmore', onclick: () => { XP.allChars = !XP.allChars; xpDrawGrid(); },
  }, XP.allChars ? 'Show fewer' : `Show all ${list.length}`) : null;
  XP.grid.replaceChildren(h('div', { class: 'grid-wrap apq-xgrid' }, cards), h('div', { class: 'apq-xfoot' }, more, h('span', { class: 'apq-xsrc' }, 'From MyAnimeList')));
}

function xpPlaceChars() {
  const mal = Array.isArray(XP.chars) && XP.chars.length ? XP.chars : null;
  const ov = xpOverview();
  const sec = ov && Array.from(ov.querySelectorAll(':scope > .characters')).find((el) => !el.classList.contains('apq-ui'));
  const alGrid = sec && sec.querySelector(':scope > .grid-wrap');
  const head = sec && sec.querySelector(':scope > h2');
  if (!mal || !ov) {
    if (XP.sw) { XP.sw.remove(); XP.sw = null; }
    if (XP.grid) { XP.grid.remove(); XP.grid = null; }
    if (XP.sec) { XP.sec.remove(); XP.sec = null; }
    if (alGrid) alGrid.removeAttribute('data-apq-xhide');
    return;
  }
  if (sec && alGrid) {
    // AniList has characters: the switch on its heading, MyAnimeList's cards in place of its own when picked.
    if (XP.sec) { XP.sec.remove(); XP.sec = null; }
    if (!XP.sw) XP.sw = xpSwitch();
    xpDrawSwitch();
    if (head && XP.sw.parentElement !== head) head.prepend(XP.sw);
    if (XP.from === 'mal') {
      if (!XP.grid) XP.grid = h('div', { class: 'apq-ui apq-xchars' });
      xpDrawGrid();
      if (XP.grid.previousElementSibling !== alGrid) alGrid.after(XP.grid);
      if (!alGrid.hasAttribute('data-apq-xhide')) alGrid.setAttribute('data-apq-xhide', '');
    } else {
      if (XP.grid) { XP.grid.remove(); XP.grid = null; }
      if (alGrid.hasAttribute('data-apq-xhide')) alGrid.removeAttribute('data-apq-xhide');
    }
    return;
  }
  // AniList has none: MyAnimeList's, as a section of its own, where AniList's would be.
  if (XP.sw) { XP.sw.remove(); XP.sw = null; }
  if (!XP.sec) {
    XP.grid = h('div', { class: 'apq-xchars' });
    XP.sec = h('div', { class: 'apq-ui apq-xsec apq-xcharsec' }, h('h2', {}, 'Characters'), XP.grid);
  }
  xpDrawGrid();
  const after = ov.querySelector(':scope > .relations') || ov.querySelector(':scope > .description-wrap');
  const before = ov.querySelector(':scope > .staff');
  if (after) { if (XP.sec.previousElementSibling !== after) after.after(XP.sec); }
  else if (before) { if (XP.sec.nextElementSibling !== before) before.before(XP.sec); }
  else if (XP.sec.parentElement !== ov) ov.prepend(XP.sec);
}

/* Openings and endings: a section like AniList's own, after Staff ----------------------------------- */
// Each song: its number, its title (a link to its page on AnimeThemes), the artist and the episodes it plays in
// ("MAXIMUM THE HORMONE (Eps 1–13)"), then two buttons (0.12.7): play it right here (AnimeThemes' own video,
// under the row, one at a time) and look for it on YouTube.

// "(Ep 7)" for one episode, "(Eps 1–13)" for several.
const xpEpsLabel = (eps) => `(${/[–,-]/.test(eps) ? 'Eps' : 'Ep'} ${eps})`;
const xpYouTube = (x) => `https://www.youtube.com/results?search_query=${encodeURIComponent([x.title, x.by].filter(Boolean).join(' '))}`;
const XP_VIDEO_RE = /^https:\/\/v\.animethemes\.moe\/[A-Za-z0-9._-]+\.webm$/;

function xpSongList(list, label, k) {
  const shown = XP.allSongs ? list : list.slice(0, XP_SONGS_FOLD);
  return h('div', { class: 'apq-xsongs-col' },
    h('h2', {}, label),
    h('ol', { class: 'apq-xsongs-list' }, shown.map((x) => {
      const url = x.url && /^https:\/\/animethemes\.moe\/[^\s"'<>]+$/.test(x.url) ? x.url : null;
      const video = x.video && XP_VIDEO_RE.test(x.video) ? x.video : null;
      const id = `${k}:${x.n}:${x.title}`;
      const playing = !!video && XP.playing === id;
      const what = `${k === 'op' ? 'opening' : 'ending'} ${x.n}, ${x.title}`;
      const title = url ? xpLink(url, 'apq-xsongs-title', x.title) : h('span', { class: 'apq-xsongs-title' }, x.title);
      if (url) title.title = 'Its page on AnimeThemes';
      // The artist and the episodes as one line of text, so they never run together ("… HORMONE (Eps 1–13)").
      const by = x.by || x.eps ? h('span', { class: 'apq-xsongs-by' },
        x.by ? h('span', { class: 'apq-xsongs-artist' }, x.by) : null, x.by && x.eps ? ' ' : null,
        x.eps ? h('span', { class: 'apq-xsongs-eps' }, xpEpsLabel(x.eps)) : null) : null;
      const acts = h('span', { class: 'apq-xsongs-acts' },
        video ? h('button', {
          type: 'button', class: 'apq-xsongs-act' + (playing ? ' is-on' : ''), 'aria-pressed': String(playing),
          'aria-label': playing ? `Stop ${what}` : `Play ${what}`, title: playing ? 'Stop' : 'Play it here',
          onclick: () => { XP.playing = playing ? null : id; xpPlaceSongs(); },
        }, icon(playing ? 'x' : 'play')) : null,
        h('a', { class: 'apq-xsongs-act', href: xpYouTube(x), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Find ${what} on YouTube`, title: 'Find it on YouTube' }, icon('video')));
      const row = h('div', { class: 'apq-xsongs-row' + (playing ? ' is-playing' : '') },
        h('span', { class: 'apq-xsongs-n' }, String(x.n)),
        h('span', { class: 'apq-xsongs-t' }, title, by), acts);
      const player = playing ? h('video', {
        class: 'apq-xsongs-video', src: video, controls: '', autoplay: '', playsinline: '', preload: 'auto',
        'aria-label': `${capitalFirst(what)}, from AnimeThemes`,
      }) : null;
      return h('li', {}, row, player);
    })));
}
const capitalFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function xpPlaceSongs() {
  const th = XP.themes;
  const ov = xpOverview();
  if (!th || !ov || (!th.op.length && !th.ed.length)) { if (XP.songs) { XP.songs.remove(); XP.songs = null; } return; }
  const sig = `${XP.allSongs}|${th.op.length}|${th.ed.length}|${XP.playing || ''}`;
  if (!XP.songs) XP.songs = h('div', { class: 'apq-ui apq-xsec apq-xsongs' });
  if (XP.songs.dataset.sig !== sig) {
    XP.songs.dataset.sig = sig;
    const many = th.op.length > XP_SONGS_FOLD || th.ed.length > XP_SONGS_FOLD;
    XP.songs.replaceChildren(...[
      h('div', { class: 'apq-xsongs-grid' + (th.op.length && th.ed.length ? '' : ' is-one') },
        th.op.length ? xpSongList(th.op, th.op.length === 1 ? 'Opening' : 'Openings', 'op') : null,
        th.ed.length ? xpSongList(th.ed, th.ed.length === 1 ? 'Ending' : 'Endings', 'ed') : null),
      many ? h('div', { class: 'apq-xfoot' },
        h('button', { type: 'button', class: 'apq-xmore', onclick: () => { XP.allSongs = !XP.allSongs; xpPlaceSongs(); } }, XP.allSongs ? 'Show fewer' : 'Show all')) : null,
    ].filter(Boolean));
  }
  const after = ov.querySelector(':scope > .staff') || (XP.sec && XP.sec.isConnected ? XP.sec : null)
    || ov.querySelector(':scope > .characters') || ov.querySelector(':scope > .relations') || ov.querySelector(':scope > .description-wrap');
  if (after) { if (XP.songs.previousElementSibling !== after) after.after(XP.songs); }
  else if (XP.songs.parentElement !== ov) ov.prepend(XP.songs);
}

/* MyAnimeList and Reddit in "External & Streaming links" (0.12.7) ------------------------------------ */
// Two more of AniList's own link buttons at the end of its sidebar's list: the title on MyAnimeList (by its number,
// AniList's idMal), and a search for its discussion threads on Reddit (r/anime's episode threads, r/manga's [DISC]
// threads, by the title AniList shows: not always exact). Each a copy of one of AniList's own buttons (its
// `data-v-*` attributes kept, so its scoped CSS applies: Overpass, the colored square, the hover in the site's
// color), with the site's own icon (logos/). A title without links on AniList gets a box of the same look.

const XL_SITES = {
  mal: { name: 'MyAnimeList', color: '#2E51A2', icon: 'logos/myanimelist.svg' },
  reddit: { name: 'Reddit Discussions', color: '#FF4500', icon: 'logos/reddit.png' },
};
function xpRedditUrl(name, manga) {
  const q = manga ? `"${name}" DISC` : `"${name}" flair:Episode`;
  return `https://www.reddit.com/r/${manga ? 'manga' : 'anime'}/search/?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new`;
}
function xpPageTitle() {
  const el = xpPage().querySelector('.header .content h1, .header h1');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
}
function xpLinkList() {
  if (!xpLinksOn() || !XP.route) return [];
  const manga = XP.route.type === 'MANGA';
  const out = [];
  if (XP.mal) out.push(['mal', `https://myanimelist.net/${manga ? 'manga' : 'anime'}/${XP.mal}`]);
  const name = xpPageTitle();
  if (name) out.push(['reddit', xpRedditUrl(name, manga)]);
  return out;
}
// AniList's own data-v-* attributes of `model` onto `el`.
function xpCopyScope(model, el) {
  if (model) for (const a of model.attributes) if (a.name.startsWith('data-v-')) el.setAttribute(a.name, '');
  return el;
}
function xpLinkButton(k, url, model) {
  const site = XL_SITES[k];
  const a = model ? xpCopyScope(model, document.createElement('a')) : document.createElement('a');
  a.className = 'external-link apq-ui apq-xlink';
  a.dataset.apqSite = k;
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.setProperty('--link-color', `${site.color}e0`);
  if (k === 'reddit') a.title = 'Search r/' + (XP.route.type === 'MANGA' ? 'manga' : 'anime') + ' for discussion threads';
  const mIcon = model && model.querySelector('.icon-wrap');
  const mImg = model && model.querySelector('.icon-wrap .icon');
  const mName = model && model.querySelector('.name');
  const wrap = xpCopyScope(mIcon, h('div', { class: 'icon-wrap', style: `background:${site.color};` }));
  let src = '';
  try { src = chrome.runtime.getURL(site.icon); } catch { /* the extension was updated */ }
  wrap.append(xpCopyScope(mImg, h('img', { class: 'icon', src, alt: '' })));
  a.append(wrap, xpCopyScope(mName, h('span', { class: 'name' }, site.name)));
  return a;
}
function xpPlaceLinks() {
  const list = xpLinkList();
  const side = xpPage().querySelector('.sidebar');
  const removeOurs = () => { for (const el of document.querySelectorAll('.apq-xlink')) if (!el.closest('.apq-xlinks')) el.remove(); };
  if (!list.length || !side) {
    removeOurs();
    if (XP.links) { XP.links.remove(); XP.links = null; }
    return;
  }
  const sig = list.map(([k, u]) => `${k}=${u}`).join('|');
  const own = Array.from(side.querySelectorAll('.external-links')).find((el) => !el.classList.contains('apq-ui'));
  const wrap = own && own.querySelector('.external-links-wrap');
  if (wrap) {
    // AniList has links: ours go at the end of its list.
    if (XP.links) { XP.links.remove(); XP.links = null; }
    const mine = Array.from(wrap.querySelectorAll(':scope > .apq-xlink'));
    const last = wrap.lastElementChild;
    if (mine.length === list.length && wrap.dataset.apqXl === sig && mine.every((el, i) => el.dataset.apqSite === list[i][0])
      && last === mine[mine.length - 1]) return;
    removeOurs();
    const model = Array.from(wrap.querySelectorAll(':scope > .external-link')).find((el) => !el.classList.contains('apq-ui'));
    wrap.dataset.apqXl = sig;
    wrap.append(...list.map(([k, u]) => xpLinkButton(k, u, model)));
    return;
  }
  // None on AniList: a box of the same look, at the end of the sidebar.
  removeOurs();
  if (!XP.links || XP.links.dataset.apqXl !== sig) {
    const box = h('div', { class: 'apq-ui apq-xlinks external-links' }, h('h2', {}, 'External & Streaming links'),
      h('div', { class: 'external-links-wrap' }, list.map(([k, u]) => xpLinkButton(k, u, null))));
    box.dataset.apqXl = sig;
    if (XP.links) XP.links.remove();
    XP.links = box;
  }
  if (XP.links.parentElement !== side || side.lastElementChild !== XP.links) side.append(XP.links);
}
