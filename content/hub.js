// Tsugi · The floating button, the hub panel (lists and settings), toasts and tooltips.
'use strict';

/* ------------------------------------------------------------------ */
/* Dock (floating button)                                              */
/* ------------------------------------------------------------------ */

function mountDock() {
  if (K.dock && K.dock.isConnected) { renderDock(); return; }
  K.select = h('button', {
    type: 'button', class: 'apq-dock-btn', 'aria-label': 'Select titles', 'data-tip': 'Select titles (S)',
    onclick: enterSelect,
  }, icon('select'));
  K.pick = h('button', {
    type: 'button', class: 'apq-dock-btn', 'aria-label': 'Pick something for me',
    onclick: openPick,
  }, icon('dice'));
  K.sort = h('button', {
    type: 'button', class: 'apq-dock-btn apq-dock-sort', 'aria-pressed': 'false',
    onclick: () => setSortPage(!sortOn()),
  }, icon('sort'));
  K.main = h('button', {
    type: 'button', class: 'apq-dock-main', 'aria-label': 'Open the hub', 'data-tip': 'Open the hub (P)',
    onclick: toggleDrawer,
  }, glyph(3), spinner(), h('span', { class: 'apq-dock-dot', 'aria-hidden': 'true' }));
  K.dock = h('div', { class: 'apq-ui apq-dock' },
    h('div', { class: 'apq-launcher' }, h('div', { class: 'apq-dock-extra' }, K.select, K.pick, K.sort), K.main));
  document.body.append(K.dock);
  renderDock();
}

function unmountDock() {
  if (K.dock) K.dock.remove();
  K.dock = null;
}

function renderDock() {
  renderNavBtn();
  if (!K.dock) return;
  const d = S.data;
  const touch = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  const cls = K.dock.classList;
  // With the button in AniList's top bar, the floating one only shows where that bar isn't (a phone).
  const inBar = S.settings.dock === 'bar' && navBtnShown();
  cls.toggle('is-off', S.settings.dock === 'hide' || inBar || S.selecting);
  cls.toggle('is-near', S.settings.dock === 'near' && !touch);
  cls.toggle('is-left', S.settings.dockSide === 'left');
  cls.toggle('is-sorted', sortOn());
  cls.toggle('is-busy', S.filling || (!d && S.loading));
  cls.toggle('is-error', !d && !!S.error);
  K.select.hidden = !(d && d.canEdit);
  K.pick.hidden = !(d && d.canEdit && S.settings.pick);
  K.pick.dataset.tip = `Pick something to ${isAnime() ? 'watch' : 'read'} (R)`;
  const on = sortOn();
  const what = S.route && S.route.list ? S.route.list : 'this page';
  K.sort.setAttribute('aria-pressed', String(on));
  K.sort.setAttribute('aria-label', on ? `Turn off priority sort for ${what}` : `Sort ${what} by priority`);
  K.sort.dataset.tip = on ? `${what[0].toUpperCase()}${what.slice(1)} is sorted by priority. Click to turn off` : `Sort ${what} by priority`;
  K.main.dataset.tip = !d && S.error ? `Couldn't load list: ${S.error.message}` : 'Open the hub (P)';
}

function dockChanged() { placeNavBtn(); renderDock(); }

/* ------------------------------------------------------------------ */
/* Tsugi's button in AniList's top bar (0.7.1)                          */
/* ------------------------------------------------------------------ */
// AniList's top bar (read from its bundle on 2026-11-11): #nav > .wrap > a.logo, .links, .search (its search
// icon), .user (the avatar, with a menu on hover). Tsugi's button goes just before the search icon, in the same
// size and colors, and has a menu on hover like the avatar's (Overpass, AniList's menu font there). A click opens
// the hub; away from a list page it opens your anime list with the hub. Not shown to guests (no .user), nor when
// the dock setting asks for the floating button or none.

function placeNavBtn() {
  const want = S.settings.dock === 'bar';
  const search = want ? document.querySelector('#nav .wrap:not(.guest) > .search') : null;
  if (!search) {
    if (K.nav) { K.nav.remove(); K.nav = null; renderDock(); }
    return;
  }
  if (!K.nav) {
    K.navMain = h('button', {
      type: 'button', class: 'apq-nav-btn', 'aria-label': 'Tsugi: open the hub', 'aria-haspopup': 'menu',
      onclick: () => { K.nav.classList.add('is-shut'); navOpenHub(); },
    }, glyph(3));
    K.navMenu = h('div', { class: 'apq-nav-menu', role: 'menu', 'aria-label': 'Tsugi' });
    K.nav = h('div', { class: 'apq-ui apq-nav' }, K.navMain, K.navMenu);
    // After a click the menu stays shut until the pointer leaves (like AniList's own menus, which close on a click).
    K.nav.addEventListener('mouseleave', () => K.nav.classList.remove('is-shut'));
    // Whether the button shows (AniList hides its top bar on a phone): told by the browser when it changes, so
    // renderDock never has to measure the page (that cost a whole layout each time AniList drew rows: perf, 0.12.8).
    K.navShown = false;
    try {
      const nav = K.nav;
      new ResizeObserver(([en]) => {
        const shown = !!en && nav.isConnected && (en.contentRect.width > 0 || en.contentRect.height > 0);
        if (K.nav !== nav || K.navShown === shown) return;
        K.navShown = shown;
        renderDock();
      }).observe(nav);
    } catch { K.navShown = null; } // no ResizeObserver: measured as before
  }
  if (K.nav.nextElementSibling !== search) search.before(K.nav);
  renderDock(); // the floating button steps aside now that this one is there (it draws this one too)
}

const navBtnShown = () => !!K.nav && K.nav.isConnected && (K.navShown === null ? K.nav.getClientRects().length > 0 : K.navShown);

function navOpenHub() {
  if (S.route) { toggleDrawer(); return; }
  const link = document.querySelector('#nav .links a[href*="/animelist"]');
  const href = link ? link.getAttribute('href') : (palName() ? `/user/${encodeURIComponent(palName())}/animelist` : null);
  if (href) goThenOpen(href, 'hub');
}

function renderNavBtn() {
  if (!K.nav) return;
  const d = S.data;
  const onList = !!S.route;
  const can = onList && !!d && d.canEdit;
  const what = isAnime() ? 'watch' : 'read';
  const keys = !!S.settings.keys;
  K.nav.classList.toggle('is-error', onList && !d && !!S.error);
  K.navMain.title = onList && !d && S.error ? `Couldn't load the list: ${S.error.message}` : '';
  const sig = JSON.stringify([onList, can, what, keys, !!S.selecting, !!S.settings.palette, !!S.settings.pick]);
  if (K.navMenu.dataset.sig === sig) return;
  K.navMenu.dataset.sig = sig;
  const item = (ic, label, run, key) => h('button', {
    type: 'button', role: 'menuitem', class: 'apq-nav-item', onclick: () => { K.nav.classList.add('is-shut'); run(); },
  }, h('span', { class: 'apq-nav-ic' }, ic), h('span', { class: 'apq-nav-label' }, label), key && keys ? h('span', { class: 'apq-nav-key' }, key) : null);
  const mod = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K';
  const items = [
    item(glyph(3), 'Open the hub', navOpenHub, onList ? 'P' : ''),
    can ? item(icon('select'), S.selecting ? 'Stop selecting' : 'Select titles', toggleSelectMode, 'S') : null,
    can && S.settings.pick ? item(icon('dice'), `Pick something to ${what}`, openPick, 'R') : null,
    S.settings.palette ? item(icon('search'), 'Search everything', () => openPal(), mod) : null,
  ].filter(Boolean);
  K.navMenu.replaceChildren(h('div', { class: 'apq-nav-items' }, items),
    h('div', { class: 'apq-nav-foot' }, h('button', {
      type: 'button', role: 'menuitem', class: 'apq-nav-link',
      onclick: () => { K.nav.classList.add('is-shut'); if (S.route) { openDrawer(); setView('settings'); } else { const l = document.querySelector('#nav .links a[href*="/animelist"]'); if (l) goThenOpen(l.getAttribute('href'), 'settings'); } },
    }, icon('sliders'), 'Tsugi settings')));
}

let nearTimer = 0;
function onMouseMove(ev) {
  if (!K.dock || !K.dock.classList.contains('is-near')) return;
  const left = S.settings.dockSide === 'left';
  const dx = left ? ev.clientX : window.innerWidth - ev.clientX;
  const near = dx < 240 && window.innerHeight - ev.clientY < 170;
  if (near) {
    if (nearTimer) { clearTimeout(nearTimer); nearTimer = 0; }
    if (!K.dock.classList.contains('is-shown')) K.dock.classList.add('is-shown');
  } else if (K.dock.classList.contains('is-shown') && !nearTimer) {
    nearTimer = setTimeout(() => {
      nearTimer = 0;
      if (K.dock && !K.dock.matches(':focus-within')) K.dock.classList.remove('is-shown');
    }, 600);
  }
}

/* ------------------------------------------------------------------ */
/* Drawer (priority queue)                                             */
/* ------------------------------------------------------------------ */

function buildDrawer() {
  if (D.drawer) return;
  D.scrim = h('div', { class: 'apq-ui apq-scrim', onclick: () => closeDrawer() });
  D.sub = h('div', { class: 'apq-dh-sub' });
  D.selBtn = h('button', {
    type: 'button', class: 'apq-icon-btn apq-sel-btn', 'aria-label': 'Select titles', 'aria-pressed': 'false',
    'data-tip': 'Select titles (S)', 'data-tip-pos': 'below', onclick: toggleSelectMode,
  }, icon('select'));
  const railBtn = (view, name, ic) => h('button', {
    type: 'button', class: 'apq-rail-btn', 'aria-label': name, 'data-tip': name, 'data-tip-pos': 'right',
    onclick: () => setView(view),
  }, icon(ic));
  D.railLists = railBtn('list', 'Lists', 'lists');
  D.railCheck = railBtn('check', 'List check', 'pulse');
  D.railSettings = railBtn('settings', 'Settings', 'sliders');
  D.title = h('div', { class: 'apq-dh-title' }, 'Lists');
  D.palBtn = h('button', {
    type: 'button', class: 'apq-icon-btn', 'aria-label': 'Search and commands', 'data-tip': 'Search and commands (Ctrl+K)', 'data-tip-pos': 'below',
    onclick: () => openPal(),
  }, icon('search'));
  const close = h('button', {
    type: 'button', class: 'apq-icon-btn', 'aria-label': 'Close', 'data-tip': 'Close (Esc)', 'data-tip-pos': 'below',
    onclick: () => closeDrawer(),
  }, icon('x'));
  D.tabs = h('div', { class: 'apq-tabs', role: 'tablist', 'aria-label': 'List' });
  D.search = h('input', { type: 'text', placeholder: 'Filter titles', 'aria-label': 'Filter titles', spellcheck: 'false', autocomplete: 'off' });
  D.search.addEventListener('input', () => { S.query = D.search.value; renderDrawerList(); renderBar(); });
  D.search.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && D.search.value) { ev.stopPropagation(); D.search.value = ''; S.query = ''; renderDrawerList(); renderBar(); }
  });
  D.dir = h('button', {
    type: 'button', class: 'apq-dir', 'data-tip-pos': 'below',
    onclick: () => {
      S.settings.dir = S.settings.dir === 'asc' ? 'desc' : 'asc';
      saveSettings();
      renderDrawerChrome();
      renderDrawerList({ animate: true });
      applyPageSort();
    },
  });
  D.pickBtn = h('button', { type: 'button', class: 'apq-dir', 'data-tip-pos': 'below', onclick: openPick }, icon('dice'));
  D.list = h('div', { class: 'apq-list' });
  D.body = h('div', { class: 'apq-body' }, D.list);
  D.hint = h('div', { class: 'apq-hint' });
  D.switchBtn = h('button', {
    type: 'button', class: 'apq-switch-wrap', role: 'switch', 'aria-checked': 'false',
    onclick: () => setSortPage(!sortOn()),
  }, h('span', {}, 'Sort page'), h('span', { class: 'apq-switch', 'aria-hidden': 'true' }));
  D.tools = h('div', { class: 'apq-tools' }, h('label', { class: 'apq-search' }, icon('search'), D.search), D.dir, D.pickBtn);

  D.drawer = h('aside', { class: 'apq-ui apq-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tsugi', tabindex: '-1' },
    h('nav', { class: 'apq-rail', 'aria-label': 'Sections' },
      h('div', { class: 'apq-mark', 'data-tip': `Tsugi ${EXT_VERSION}`.trim(), 'data-tip-pos': 'right' }, mark()),
      h('div', { class: 'apq-rail-items' }, D.railLists, D.railCheck),
      h('div', { class: 'apq-rail-foot' }, D.railSettings)),
    h('div', { class: 'apq-main' },
      h('header', { class: 'apq-dh' },
        h('div', { class: 'apq-dh-row' },
          h('div', { class: 'apq-dh-text' }, D.title, D.sub),
          D.palBtn, D.selBtn, close),
        D.tabs,
        D.tools),
      D.body,
      D.foot = h('footer', { class: 'apq-df' }, D.hint, D.switchBtn)));

  document.body.append(D.scrim, D.drawer);
}

function openDrawer() {
  if (!S.route) return;
  buildDrawer();
  closePopover(false);
  closePick();
  hideTip();
  S.drawerOpen = true;
  renderDrawer();
  renderBar();
  requestAnimationFrame(() => {
    D.scrim.classList.add('is-open');
    D.drawer.classList.add('is-open');
    D.drawer.focus({ preventScroll: true });
  });
  if (S.data && Date.now() - S.data.fetchedAt > 30000 && !S.pending.size) ensureData(true);
}

function closeDrawer() {
  if (!D.drawer || !S.drawerOpen) return;
  S.drawerOpen = false;
  S.view = 'list';
  D.scrim.classList.remove('is-open');
  D.drawer.classList.remove('is-open');
  applyPageSort();
  renderBar();
}

function toggleDrawer() { if (S.drawerOpen) closeDrawer(); else openDrawer(); }

function setView(v) {
  S.view = v;
  if (v !== 'list' && S.selecting) exitSelect();
  renderDrawer();
  if (D.body) D.body.scrollTop = 0;
}

function renderDrawer() {
  if (!D.drawer) return;
  renderDrawerChrome();
  renderDrawerList();
}

function renderDrawerChrome() {
  const r = S.route, d = S.data;
  if (!r || !D.drawer) return;
  // The list check is for your own list.
  if (S.view === 'check' && d && (!d.canEdit || !S.settings.listCheck)) S.view = 'list';
  const check = S.view === 'check';
  const settings = S.view === 'settings';
  const other = settings || check;
  D.title.textContent = settings ? 'Settings' : check ? 'List check' : 'Lists';
  D.sub.textContent = settings ? `Tsugi ${EXT_VERSION}`.trim() : S.loading && d ? 'Updating from AniList…'
    : check ? checkSummary() : `${(d && d.userName) || r.user}'s ${typeWord()} list`;
  D.railCheck.hidden = !(d && d.canEdit && S.settings.listCheck);
  for (const [btn, on] of [[D.railLists, !other], [D.railCheck, check], [D.railSettings, settings]]) {
    btn.classList.toggle('is-active', on);
    if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  }
  D.tabs.hidden = !d || other;
  D.tools.hidden = !d || other;
  D.foot.hidden = other;
  D.drawer.classList.toggle('is-selecting', S.selecting);
  D.selBtn.hidden = !(d && d.canEdit) || other;
  D.palBtn.hidden = !S.settings.palette;
  D.selBtn.setAttribute('aria-pressed', String(S.selecting));
  D.selBtn.dataset.tip = S.selecting ? 'Stop selecting (Esc)' : 'Select titles (S)';
  D.pickBtn.hidden = !(d && d.canEdit && S.settings.pick);
  D.pickBtn.dataset.tip = `Pick something to ${isAnime() ? 'watch' : 'read'} (R)`;
  D.pickBtn.setAttribute('aria-label', `Pick something to ${isAnime() ? 'watch' : 'read'}`);

  // Tabs
  const counts = {};
  if (d) for (const e of d.entries.values()) if (!e.hidden && !adultHidden(e)) counts[e.status] = (counts[e.status] || 0) + 1;
  const avail = d ? TAB_STATUSES.filter((s) => counts[s] && statusPrioOn(s)) : ['PLANNING'];
  if (!avail.includes(S.tab)) S.tab = avail[0] || 'PLANNING';
  const sig = avail.map((s) => `${s}:${counts[s] || 0}`).join('|') + `#${S.tab}#${r.type}`;
  if (D.tabs.dataset.sig !== sig) {
    D.tabs.dataset.sig = sig;
    D.tabs.replaceChildren(...avail.map((s) => h('button', {
      type: 'button', role: 'tab', class: 'apq-tab' + (s === S.tab ? ' is-active' : ''),
      'aria-selected': String(s === S.tab),
      onclick: () => { S.tab = s; renderDrawer(); renderBar(); D.body.scrollTop = 0; },
    }, h('span', {}, statusLabel(s)), d ? h('span', { class: 'apq-tab-n' }, counts[s]) : null)));
  }

  // Direction
  const desc = S.settings.dir !== 'asc';
  D.dir.replaceChildren(icon(desc ? 'desc' : 'asc'));
  D.dir.dataset.tip = desc ? 'Highest first' : 'Lowest first';
  D.dir.setAttribute('aria-label', desc ? 'Showing highest priority first. Switch to lowest first' : 'Showing lowest priority first. Switch to highest first');

  // Footer
  const who = d ? (d.canEdit ? 'edit' : d.viewer ? 'other' : 'anon') : 'none';
  const sig2 = `${who}:${S.selecting}:${S.settings.keys}`;
  if (D.hint.dataset.sig !== sig2) {
    D.hint.dataset.sig = sig2;
    if (!d) D.hint.replaceChildren();
    else if (d.canEdit && S.selecting) D.hint.replaceChildren(h('span', { class: 'apq-kbd' }, 'Shift'), h('span', {}, 'Click to select a whole range'));
    else if (d.canEdit && S.settings.keys) D.hint.replaceChildren(h('span', { class: 'apq-kbd' }, '0–9'), h('span', {}, 'Hover a title and type a number'));
    else if (d.canEdit) D.hint.replaceChildren();
    else if (d.viewer) D.hint.replaceChildren(h('span', {}, 'View only. This isn\'t your list'));
    else D.hint.replaceChildren(h('span', {}, 'View only. Log in to AniList to edit'));
  }
  D.switchBtn.setAttribute('aria-checked', String(sortOn()));
  D.switchBtn.title = r.list ? `Sort ${r.list} by priority, on AniList's page` : 'Sort every list on this page by priority';
}

function accountSection(section) {
  const a = S.auth && S.auth.viewer;
  const send = (msg) => {
    try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); }
    catch { toast('The extension was updated. Reload this page.', 'error'); }
  };
  if (a) {
    return section('AniList account',
      h('div', { class: 'apq-acct' },
        a.avatar ? h('img', { class: 'apq-acct-av', src: a.avatar, alt: '' }) : h('span', { class: 'apq-acct-av' }),
        h('span', { class: 'apq-set-text' },
          h('span', { class: 'apq-set-title' }, `Connected as ${a.name}`),
          h('span', { class: 'apq-set-desc' }, 'The toolbar button and this panel use this login.')),
        h('button', { type: 'button', class: 'apq-set-action', 'data-k': 'disconnect', onclick: () => send({ type: 'auth:logout' }) }, 'Disconnect')));
  }
  return section('AniList account',
    h('p', { class: 'apq-set-note apq-set-lead' }, 'Connect your account to use the toolbar button. This panel already works with your AniList login on this site.'),
    h('button', { type: 'button', class: 'apq-set-action is-primary', 'data-k': 'connect', onclick: () => send({ type: 'auth:connect' }) }, icon('external'), 'Connect AniList'));
}

function renderSettings() {
  const s = S.settings;
  const active = document.activeElement;
  const focusKey = active && D.list.contains(active) ? active.dataset.k : null;
  const apply = () => { saveSettings(); renderSettings(); };
  const seg = (key, options, after) => h('div', { class: 'apq-seg', role: 'radiogroup' },
    options.map(([v, label, disabled]) => h('button', {
      type: 'button', role: 'radio', class: 'apq-seg-btn' + (s[key] === v ? ' is-active' : ''),
      'aria-checked': String(s[key] === v), 'data-k': `${key}:${v}`, disabled: !!disabled,
      onclick: () => { s[key] = v; apply(); if (after) after(); },
    }, label)));
  const toggle = (key, title, desc, after, disabled, sub) => h('button', {
    type: 'button', role: 'switch', class: 'apq-set-row' + (sub ? ' is-sub' : ''), 'aria-checked': String(!!s[key]), 'data-k': key, disabled: !!disabled,
    onclick: () => { s[key] = !s[key]; apply(); if (after) after(); },
  }, h('span', { class: 'apq-set-text' }, h('span', { class: 'apq-set-title' }, title), h('span', { class: 'apq-set-desc' }, desc)),
  h('span', { class: 'apq-switch', 'aria-hidden': 'true' }));
  const field = (label, control) => h('div', { class: 'apq-set-field' }, h('span', { class: 'apq-set-label' }, label), control);
  const section = (title, ...kids) => h('section', { class: 'apq-set-sec' }, h('h3', { class: 'apq-set-h' }, title), ...kids);

  const autoRGB = accentRGB('auto') || PROFILE_COLORS.blue;
  const autoName = S.viewerColor ? (PROFILE_COLORS[S.viewerColor] ? S.viewerColor : 'custom') : null;
  const swatches = h('div', { class: 'apq-swatches', role: 'radiogroup', 'aria-label': 'Accent color' },
    ACCENTS.map((a) => {
      const rgb = paletteAccent(hubPalette(), a === 'auto' ? accentKey('auto') : a, a === 'auto' ? autoRGB : PROFILE_COLORS[a]);
      const active = s.accent === a;
      // "From AniList", as in the toolbar popup's Settings (0.6.10; it was "Auto").
      const name = a === 'auto' ? 'From AniList' : a[0].toUpperCase() + a.slice(1);
      return h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(active), 'aria-label': name, 'data-k': `accent:${a}`,
        class: 'apq-swatch' + (a === 'auto' ? ' is-auto' : '') + (active ? ' is-active' : ''),
        style: `--apq-sw: ${rgb}`, 'data-tip': a === 'auto' ? 'Your AniList profile color' : name,
        onclick: () => { s.accent = a; applyAccent(); apply(); },
      }, a === 'auto' ? [h('i', {}), 'From AniList'] : null);
    }));
  const autoNote = autoName
    ? `From AniList is your profile color (${autoName}). The toolbar popup follows this too.`
    : 'From AniList is your profile color, once you\'re logged in. The toolbar popup follows this too.';

  // Palettes (0.12): the toolbar popup's, for this panel and Tsugi's others on AniList. "AniList's" leaves the
  // popup's choice alone and only turns its "On AniList too" off.
  const onPal = hubPalette() ? s.theme : '';
  const palettes = h('div', { class: 'apq-swatches is-pal', role: 'radiogroup', 'aria-label': 'Palette' },
    h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(!onPal), 'data-k': 'palette:',
      class: 'apq-swatch is-auto' + (!onPal ? ' is-active' : ''), 'data-tip': 'AniList\'s own theme',
      onclick: () => { s.paletteHub = false; applyAccent(); apply(); renderAll(); },
    }, 'AniList\'s'),
    PALETTE_ORDER.map((id) => {
      const p = PALETTES[id];
      const t = paletteTokens(p);
      return h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(onPal === id), 'aria-label': p.name, 'data-k': `palette:${id}`,
        class: 'apq-swatch apq-pswatch' + (onPal === id ? ' is-active' : ''), 'data-tip': p.name,
        style: `--apq-sw: ${t.surface}; --apq-sw-ink: ${t.ink}; --apq-sw-acc: ${paletteAccent(p, accentKey(), accentRGB() || PROFILE_COLORS.blue)}`,
        onclick: () => { s.theme = id; s.paletteHub = true; applyAccent(); apply(); renderAll(); },
      });
    }));
  const palNote = onPal
    ? `${PALETTES[onPal].name}, here and in the toolbar popup. AniList's own pages keep their theme.`
    : 'Tsugi\'s panels take AniList\'s theme. A palette dresses them and the toolbar popup; the popup\'s Settings shows each one larger.';

  const keys = (k, text) => [h('span', { class: 'apq-kbd' }, k), h('span', {}, text)];
  const updated = S.data ? new Date(S.data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  const wrap = h('div', { class: 'apq-settings' },
    accountSection(section),
    section('Tsugi\'s button',
      field('Where', seg('dock', [['bar', 'Top bar'], ['always', 'Floating'], ['near', 'Near corner'], ['hide', 'Hidden', !s.keys]], dockChanged)),
      s.dock === 'always' || s.dock === 'near' ? field('Corner', seg('dockSide', [['right', 'Right'], ['left', 'Left']], renderDock)) : null,
      h('p', { class: 'apq-set-note' }, !s.keys ? 'Turn on keyboard shortcuts to hide the button completely.'
        : s.dock === 'bar' ? 'Next to AniList\'s search, at the top of every page. P opens this panel too.'
        : 'Press P to open this panel any time.')),
    section('Palette', palettes, h('p', { class: 'apq-set-note' }, palNote)),
    section('Accent color', swatches, h('p', { class: 'apq-set-note' }, autoNote)),
    section('Features',
      toggle('badges', 'Badges on list pages', 'Show priorities next to titles on AniList.', decoratePage),
      toggle('watchOrder', 'Watch-order warnings', 'Flag planned titles whose earlier season you haven\'t finished.', () => { if (s.watchOrder) ensureRelations(); scheduleRefresh(); }),
      toggle('newEps', 'New episode counts', 'Show how many aired episodes you haven\'t watched yet.', scheduleRefresh),
      toggle('autoDates', 'Fill in start and finish dates', 'When you start or finish a title, here or with AniList\'s own + buttons, empty dates become today. Rewatches leave them alone.'),
      toggle('history', 'Rewatch log', 'How many times you\'ve watched a title, with dates, read from your AniList activity. In the popover and on the toolbar popup\'s title pages.', () => { if (S.popover) updatePopover(); }),
      toggle('malData', 'MyAnimeList\'s characters and songs', 'On title pages, here and in the toolbar popup. Asked by the title\'s number from Tenrai and AnimeThemes, two free services, and left out when they don\'t answer. Which sites\' scores show: Settings in Tsugi\'s toolbar popup.', () => onOutsideRoute(TP.route)),
      toggle('sideLinks', 'MyAnimeList and Reddit links', 'On title pages, in External & Streaming links: the title on MyAnimeList, and a search for its discussion threads on Reddit.', () => onOutsideRoute(TP.route)),
      toggle('socialCounts', 'Follower counts', 'On a profile\'s Social tab: Following (7), Followers and Mutual Followers with their counts.', decorateSocial),
      toggle('check404', 'Why a profile is missing', 'When a profile doesn\'t open: whether it\'s private, the person blocked you, or no one has that name.', decorateSocial),
      toggle('pick', 'Pick for me', 'A title to start next, picked at random from your list (R).', () => { if (!s.pick) closePick(); renderAll(); }),
      toggle('listCheck', 'List check', 'Missing dates, watch order and titles left in Watching, in this panel\'s rail.', renderAll),
      toggle('feedFilters', 'Activity feed filters', 'A Filters button above your feed on Home hides activity by type, person or word.', syncFeed),
      toggle('hideGlobal', 'Hide the global feed', 'On Home, only the people you follow: AniList\'s Global switch goes.', syncFeed),
      toggle('palette', 'Command palette', 'Press Ctrl+K on any AniList page to jump to a title, list, page or setting, or run an action.', renderDrawerChrome),
      toggle('listViews', 'List views', 'A sort for each list (kept per list), more filters in AniList\'s sidebar (source, streaming service, episodes, length, NSFW titles) and Posters in its layout buttons.', () => { partsChanged(); decoratePage(); }),
      s.listViews ? toggle('listSorts', 'Sorts and groups', 'On each list\'s title. Off: AniList\'s own order, or priority order from the button.', () => { partsChanged(); decoratePage(); }, false, true) : null,
      s.listViews ? toggle('listFilters', 'Filters in AniList\'s sidebar', 'With saved filters. Off: AniList\'s own filters only.', () => { partsChanged(); decoratePage(); }, false, true) : null,
      toggle('posters', 'Posters', 'Your lists as a wall of covers, the details on hover. The fourth of AniList\'s layout buttons switches it too.', postersChanged, !s.listViews),
      toggle('dragOrder', 'Drag to order', 'Drag titles of one priority into your own order, here and on posters. Off: the order you set stays.', renderAll),
      toggle('hideAdult', 'Hide NSFW titles', 'On your lists (unless the NSFW filter says otherwise), in this panel and in Pick for me. What counts: Settings in Tsugi\'s toolbar popup.', renderAll),
      toggle('keys', 'Keyboard shortcuts',
        s.dock === 'hide' ? 'Needed while Tsugi\'s button is hidden.' : 'P, S, E, R, V and the number keys.',
        renderDrawerChrome, s.dock === 'hide')),
    section('Keyboard',
      h('div', { class: 'apq-keys' },
        S.settings.palette ? keys('Ctrl K', 'Search titles, lists, settings and actions') : null,
        keys('P', 'Open or close this panel'),
        keys('S', 'Select several titles'),
        keys('E', 'Edit the selected titles'),
        S.settings.pick ? keys('R', `Pick something to ${isAnime() ? 'watch' : 'read'}`) : null,
        filtersOn() ? keys('V', 'Filter the list') : null,
        keys('0–9', 'Set priority of the hovered title'),
        S.settings.dragOrder ? keys('Alt Arrows', 'Move the focused title among the others of its priority') : null,
        keys('Esc', 'Close or stop selecting'))),
    section('Data',
      h('button', { type: 'button', class: 'apq-set-action', 'data-k': 'reload', disabled: S.loading, onclick: () => ensureData(true) },
        S.loading ? spinner() : icon('refresh'), S.loading ? 'Reloading…' : 'Reload from AniList'),
      updated ? h('p', { class: 'apq-set-note' }, `Last loaded at ${updated}. It also refreshes on its own when you come back to this tab.`) : null));
  D.list.replaceChildren(wrap);
  if (focusKey) {
    const el = wrap.querySelector(`[data-k="${focusKey}"]`);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }
}

function initCollapse(tab) {
  const k = `${tab}:none`;
  if (S.collapsed[k] !== undefined || !S.data) return;
  let pri = 0, none = 0;
  for (const e of S.data.entries.values()) if (e.status === tab) { if (e.priority > 0) pri++; else none++; }
  S.collapsed[k] = pri > 0 && none > 8;
}

// One line of quiet facts, each its own piece: progress ("Ep 3 of 12"), new episodes, format, year.
function metaParts(e) {
  const parts = [];
  const anime = isAnime();
  const fresh = newCount(e);
  const total = anime ? e.episodes : e.chapters;
  if (['CURRENT', 'PAUSED', 'REPEATING', 'DROPPED'].includes(e.status)) {
    parts.push({ text: `${anime ? 'Ep' : 'Ch'} ${e.progress || 0}${total ? ` of ${total}` : ''}`, cls: 'apq-ep' });
  } else if (total) {
    parts.push({ text: anime ? `${total} ep${total === 1 ? '' : 's'}` : `${total} ch` });
  }
  if (fresh > 0) parts.push({ text: `${fresh} new`, cls: 'apq-new' });
  if (e.format) parts.push({ text: FORMATS[e.format] || e.format });
  // Watching rows carry the next-episode button, so they skip the year to keep the line short.
  if (e.year && !['CURRENT', 'REPEATING'].includes(e.status)) parts.push({ text: String(e.year) });
  return parts;
}

function makeRow(e) {
  const id = e.mediaId;
  const row = h('div', { class: 'apq-row', 'data-id': id });
  const cover = h('div', { class: 'apq-cover' });
  if (e.color) cover.style.backgroundColor = e.color;
  if (e.cover) cover.append(h('img', { src: e.cover, alt: '', loading: 'lazy', decoding: 'async' }));
  row._title = h('div', { class: 'apq-row-title' }, e.title);
  row._meta = h('div', { class: 'apq-row-meta' });
  row._warn = h('div', { class: 'apq-row-warn', hidden: true }, icon('order'), h('span', {}));
  row._rank = h('span', { class: 'apq-rank', hidden: true });
  row._track = h('div', { class: 'apq-track', 'aria-hidden': 'true', hidden: true });
  cover.append(row._rank);
  const link = h('a', { class: 'apq-row-link', href: e.url }, cover, h('div', { class: 'apq-row-text' }, row._title, row._meta, row._track, row._warn));
  row.append(link);
  // Watching: mark the next episode right from the row, with a +1 in the title's color.
  row._next = h('button', { type: 'button', class: 'apq-plus1 apq-next', hidden: true, onclick: (ev) => { ev.stopPropagation(); plusOne(id); } }, h('span', {}, '+1'));
  row.append(row._next);
  // Your own order inside a priority: drag the grip (order.js), or Alt + up / down on the row.
  if (S.data && S.data.canEdit) {
    row._grip = h('span', { class: 'apq-row-grip', 'aria-hidden': 'true', 'data-tip': 'Drag to order it inside its priority', 'data-tip-pos': 'right' }, icon('grip'));
    row._grip.addEventListener('pointerdown', (ev) => onGripDown(ev, row));
    row.prepend(row._grip);
    row.addEventListener('keydown', (ev) => onRowOrderKey(ev, row));
  }

  if (S.data && S.data.canEdit) {
    // Pinned rows trade the priority stepper for move up, move down and unpin.
    row._pinBtn = h('button', { type: 'button', class: 'apq-row-pin', 'aria-label': 'Pin to the top', 'data-tip': 'Pin to the top', onclick: (ev) => { ev.stopPropagation(); pinTitle(id); } }, icon('pin'));
    row._pinUp = h('button', { type: 'button', class: 'apq-step', 'aria-label': 'Move up', 'data-tip': 'Move up', onclick: () => movePin(id, -1) }, icon('up'));
    row._pinDown = h('button', { type: 'button', class: 'apq-step', 'aria-label': 'Move down', 'data-tip': 'Move down', onclick: () => movePin(id, 1) }, icon('down'));
    row._unpin = h('button', { type: 'button', class: 'apq-step is-unpin', 'aria-label': 'Unpin', 'data-tip': 'Unpin', onclick: () => unpinTitle(id) }, icon('x'));
    row._pins = h('div', { class: 'apq-stepper apq-pinctl', role: 'group', 'aria-label': 'Pin' }, row._pinUp, row._pinDown, row._unpin);
    row.append(row._pinBtn, row._pins);
    row._minus = h('button', { type: 'button', class: 'apq-step', 'aria-label': 'Lower priority', onclick: () => bump(id, -1) }, icon('minus'));
    row._plus = h('button', { type: 'button', class: 'apq-step', 'aria-label': 'Raise priority', onclick: () => bump(id, 1) }, icon('plus'));
    row._val = h('button', { type: 'button', class: 'apq-step-val', 'aria-label': 'Type a priority', onclick: () => startInlineEdit(row, id) });
    row._stepper = h('div', { class: 'apq-stepper', role: 'group', 'aria-label': 'Priority' }, row._minus, row._val, row._plus);
    row.append(row._stepper);
  } else {
    row._pill = h('div', { class: 'apq-ro' });
    row.append(row._pill);
  }
  row._rs = h('span', { class: 'apq-rs', 'aria-hidden': 'true' });
  row._check = h('span', { class: 'apq-row-check', 'aria-hidden': 'true' }, icon('check'));
  row.append(row._rs, row._check);
  row.addEventListener('click', (ev) => {
    if (!S.selecting) return;
    ev.preventDefault();
    ev.stopPropagation();
    toggleSelect(id, ev.shiftKey, 'panel');
  });
  row.addEventListener('animationend', () => row.classList.remove('is-flash'));
  return row;
}

function updateRow(row, e) {
  const p = e.priority || 0;
  if (row._title.textContent !== e.title) row._title.textContent = e.title;
  paintTitle(row, e);
  const meta = metaParts(e);
  const metaSig = meta.map((m) => `${m.cls || ''}:${m.text}`).join('\u0001');
  const watching = showsTrack(e);
  const t = watching ? trackOf(e) : null;
  if (row._meta.dataset.sig !== metaSig) {
    row._meta.dataset.sig = metaSig;
    const prevN = row._track._done;
    row._meta.replaceChildren(...meta.map((m) => (m.cls === 'apq-ep' && t ? trackLabel(t, prevN) : h('span', { class: m.cls || null }, m.text))));
  }
  row._track.hidden = !(t && t.span);
  if (t && t.span) paintTrack(row._track, t);
  const blk = blockerOf(e);
  const warn = blk ? `${verb()} ${blk.title} first` : '';
  if ((row._warn.dataset.t || '') !== warn) {
    row._warn.dataset.t = warn;
    row._warn.hidden = !blk;
    row._warn.lastChild.textContent = warn;
    if (warn) row._warn.title = warn; else row._warn.removeAttribute('title');
  }
  const act = !S.selecting && (e.status === 'CURRENT' || e.status === 'REPEATING') ? quickActionFor(e) : null;
  row._next.hidden = !act;
  if (act) {
    row._next.title = act.label;
    row._next.setAttribute('aria-label', act.label);
    row._next.disabled = S.busy.has(e.mediaId);
  }
  const pinned = isPinned(e);
  row.classList.toggle('is-pinned', pinned);
  const rank = pinned && e.status === 'PLANNING' ? String(pinRank(e)) : '';
  if (row._rank.textContent !== rank) row._rank.textContent = rank;
  row._rank.hidden = !rank;
  if (row._pins) {
    row._pins.hidden = !pinned;
    row._stepper.hidden = pinned;
    row._pinBtn.hidden = pinned;
    if (pinned) {
      const pins = pinsIn(e.status);
      const i = pins.indexOf(e);
      row._pinUp.disabled = i <= 0;
      row._pinDown.disabled = i < 0 || i >= pins.length - 1;
    }
    const busy = S.busy.has(e.mediaId);
    row._pinBtn.disabled = busy;
    row._unpin.disabled = busy;
  }
  if (row._val) {
    const t = p > 0 ? String(p) : '';
    if (row._val.textContent !== t) row._val.textContent = t;
    row._val.classList.toggle('has-value', p > 0);
    row._val.classList.toggle('is-none', !(p > 0));
    row._minus.disabled = p <= 0;
    row._plus.disabled = p >= MAX_PRIORITY;
  }
  if (row._pill) {
    const t = p > 0 ? String(p) : '';
    if (row._pill.textContent !== t) row._pill.textContent = t;
    row._pill.classList.toggle('has-value', p > 0);
    row._pill.classList.toggle('is-none', !(p > 0));
  }
  row.classList.toggle('is-selected', S.selecting && S.selected.has(e.mediaId));
  const st = S.rowState.get(e.mediaId) || '';
  if (row._rs.dataset.st !== st) {
    row._rs.dataset.st = st;
    row._rs.className = 'apq-rs' + (st ? ` is-${st}` : '');
    row._rs.replaceChildren(st === 'saving' ? spinner() : st === 'saved' ? icon('check') : st === 'error' ? icon('alert') : '');
  }
}

function startInlineEdit(row, id) {
  const e = S.data && S.data.entries.get(id);
  if (!e || !row._val.isConnected || S.selecting) return;
  const btn = row._val;
  const input = h('input', { class: 'apq-step-input', type: 'text', inputmode: 'numeric', maxlength: '2', value: e.priority > 0 ? e.priority : '', 'aria-label': 'Priority' });
  btn.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    input.replaceWith(btn);
    if (commit) {
      const v = parseInt(input.value, 10);
      setPriority(id, Number.isNaN(v) ? 0 : v);
    }
    updateRow(row, S.data.entries.get(id));
  };
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 2); });
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function groupHead(key, prio, list, collapsed, max) {
  const ids = list.map((e) => e.mediaId);
  const pinGroup = prio === 'pin';
  const label = pinGroup ? (S.tab === 'PLANNING' ? 'Up Next' : 'Pinned') : prio > 0 ? `Priority ${prio}` : 'No priority';
  const toggle = h('button', {
    type: 'button', class: 'apq-group-toggle', 'aria-expanded': String(!collapsed),
    onclick: () => { S.collapsed[key] = !S.collapsed[key]; renderDrawerList(); },
  },
  icon('chevron', 'apq-group-chev'),
  pinGroup ? icon('pin', 'apq-group-pin') : prio > 0 ? glyph(tierOf(prio, max), 'apq-group-glyph') : null,
  h('span', { class: 'apq-group-label' }, label),
  h('span', { class: 'apq-group-n', 'data-tip': pinGroup ? `You can pin up to ${PIN_LIMIT}` : null }, pinGroup ? `${ids.length}/${PIN_LIMIT}` : ids.length));
  const head = h('div', { class: 'apq-group' + (collapsed ? ' is-collapsed' : '') + (pinGroup ? ' is-pins' : prio > 0 ? '' : ' is-none') },
    toggle, h('span', { class: 'apq-group-rule' }));
  const left = groupLeft(list);
  if (left) head.append(h('span', { class: 'apq-group-time', 'data-tip': left.tip }, left.text));
  // A priority you've put in your own order says so, and can go back to A to Z.
  const okey = statusKey(S.tab);
  if (!pinGroup && !S.selecting && canEdit() && hasFineOrder(okey, prio || 0)) {
    head.append(h('button', {
      type: 'button', class: 'apq-group-sel apq-group-ord', 'data-tip': 'Back to A to Z in this priority',
      'aria-label': `${label} is in your own order. Clear it`, onclick: () => resetFineOrder(okey, prio || 0, label),
    }, 'Your order', icon('x')));
  }
  if (S.selecting) {
    const all = ids.every((id) => S.selected.has(id));
    head.append(h('button', {
      type: 'button', class: 'apq-group-sel',
      onclick: () => {
        for (const id of ids) { if (all) S.selected.delete(id); else S.selected.add(id); }
        paintSelection();
      },
    }, all ? 'Deselect all' : 'Select all'));
  }
  return head;
}

function skeleton() {
  const wrap = h('div', { class: 'apq-skel-wrap', 'aria-label': 'Loading', role: 'status' });
  for (let i = 0; i < 7; i++) {
    wrap.append(h('div', { class: 'apq-skel' },
      h('i', { class: 'apq-skel-cover' }),
      h('div', { class: 'apq-skel-lines' }, h('i', { style: `width:${70 - (i % 3) * 14}%` }), h('i', { style: 'width:38%' })),
      h('i', { class: 'apq-skel-step' })));
  }
  return wrap;
}

function stateView(ic, title, text, action) {
  return h('div', { class: 'apq-empty' },
    h('div', { class: 'apq-empty-ic' }, icon(ic)),
    h('div', { class: 'apq-empty-title' }, title),
    text ? h('div', { class: 'apq-empty-text' }, text) : null,
    action || null);
}

function renderDrawerList({ animate = false } = {}) {
  if (!D.drawer || !S.route) return;
  if (S.view === 'settings') { renderSettings(); return; }
  if (DR.on && DR.opts.root === D.drawer) return; // a row is being dragged: it's drawn again when dropped
  const d = S.data;
  if (S.view === 'check' && d) { renderCheck(); return; }
  if (!d) {
    if (S.error) {
      D.list.replaceChildren(stateView('alert', "Couldn't load this list",
        `${S.error.message}. If the list is private, log in to AniList and reload.`,
        h('button', { type: 'button', class: 'apq-btn', onclick: () => ensureData(true) }, 'Try again')));
    } else {
      D.list.replaceChildren(skeleton());
    }
    return;
  }

  const items = tabItems();
  const q = S.query.trim();
  if (!items.length) {
    D.list.replaceChildren(q
      ? stateView('search', `No titles match “${q}”`, 'Try another word, or check another tab.')
      : stateView('inbox', `${statusLabel(S.tab)} is empty`, `Titles you add to ${statusLabel(S.tab)} on AniList show up here.`));
    return;
  }

  initCollapse(S.tab);
  const groups = new Map();
  const pinned = items.filter(isPinned).sort((a, b) => b.priority - a.priority || titleCompare(a.title, b.title));
  for (const e of items) {
    if (isPinned(e)) continue;
    const k = e.priority > 0 ? e.priority : 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const desc = S.settings.dir !== 'asc';
  const keys = Array.from(groups.keys()).sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : desc ? b - a : a - b));
  const max = maxPriority();

  const nodes = [];
  // A group's rows; with two or more, they can be put in your own order (the grip shows on hover).
  const pushRows = (list, ck) => {
    for (const e of list) {
      let row = D.rows.get(e.mediaId);
      if (!row) { row = makeRow(e); D.rows.set(e.mediaId, row); }
      updateRow(row, e);
      if (row.dataset.grp !== ck) row.dataset.grp = ck;
      row.classList.toggle('can-order', list.length > 1 && d.canEdit && !S.selecting && S.settings.dragOrder);
      nodes.push(row);
    }
  };
  if (pinned.length) {
    const ck = `${S.tab}:pin`;
    const collapsed = !!S.collapsed[ck];
    nodes.push(groupHead(ck, 'pin', pinned, collapsed, max));
    if (!collapsed) pushRows(pinned, ck);
  }
  const fine = fineRanks(statusKey(S.tab)); // your own order inside a priority, then A to Z
  for (const k of keys) {
    const ck = `${S.tab}:${k === 0 ? 'none' : k}`;
    const collapsed = !!S.collapsed[ck];
    const list = groups.get(k).sort((a, b) => fine(k, a.mediaId) - fine(k, b.mediaId) || titleCompare(a.title, b.title));
    nodes.push(groupHead(ck, k, list, collapsed, max));
    if (!collapsed) pushRows(list, ck);
  }

  const before = new Map();
  if (animate) for (const [id, row] of D.rows) if (row.isConnected) before.set(id, row.getBoundingClientRect().top);

  D.list.replaceChildren(...nodes);

  if (animate) {
    const moved = [];
    for (const [id, top] of before) {
      const row = D.rows.get(id);
      if (!row || !row.isConnected) continue;
      const dy = top - row.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      row.style.transition = 'none';
      row.style.transform = `translateY(${dy}px)`;
      row.classList.add('is-moving');
      moved.push(row);
    }
    if (moved.length) {
      D.list.getBoundingClientRect(); // commit the inverted positions
      requestAnimationFrame(() => {
        for (const row of moved) {
          row.style.transition = '';
          row.style.transform = '';
          setTimeout(() => row.classList.remove('is-moving'), 380);
        }
      });
    }
  }
  for (const id of S.flash) {
    const row = D.rows.get(id);
    if (row && row.isConnected) { row.classList.remove('is-flash'); void row.offsetWidth; row.classList.add('is-flash'); }
  }
  S.flash.clear();
}

/* ------------------------------------------------------------------ */
/* Toast and tooltips                                                  */
/* ------------------------------------------------------------------ */

// action: { label, run }, or a list of them. about: the title it's about (a dot in its color).
function toast(msg, kind = 'ok', action = null, ms = 0, about = null) {
  if (!T.el || !T.el.isConnected) {
    T.el = h('div', { class: 'apq-ui apq-toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(T.el);
  }
  const hide = () => { clearTimeout(T.timer); T.el.classList.remove('is-open'); };
  const acts = (Array.isArray(action) ? action : [action]).filter(Boolean);
  let lead = icon(kind === 'error' ? 'alert' : 'check');
  if (about && kind !== 'error') { lead = h('span', { class: 'apq-toast-dot', 'aria-hidden': 'true' }); paintTitle(lead, about); }
  const kids = [lead, h('span', { class: 'apq-toast-msg' }, msg)];
  for (const a of acts) kids.push(h('button', { type: 'button', class: 'apq-toast-btn', onclick: () => { hide(); a.run(); } }, a.label));
  T.el.replaceChildren(...kids);
  T.el.classList.toggle('is-error', kind === 'error');
  T.el.classList.toggle('has-action', acts.length > 0);
  requestAnimationFrame(() => T.el.classList.add('is-open'));
  clearTimeout(T.timer);
  T.timer = setTimeout(hide, ms || (acts.length ? 6500 : kind === 'error' ? 4500 : 2200));
}

function showTip(target) {
  if (!target.isConnected || TIP.target !== target || !target.dataset.tip) return;
  if (!TIP.el || !TIP.el.isConnected) {
    TIP.el = h('div', { class: 'apq-ui apq-tip', role: 'tooltip' });
    document.body.append(TIP.el);
  }
  TIP.el.textContent = target.dataset.tip;
  const r = target.getBoundingClientRect();
  const w = TIP.el.offsetWidth, ht = TIP.el.offsetHeight;
  if (target.dataset.tipPos === 'right') {
    TIP.el.style.top = `${clamp(r.top + r.height / 2 - ht / 2, 8, window.innerHeight - ht - 8)}px`;
    TIP.el.style.left = `${Math.min(r.right + 10, window.innerWidth - w - 8)}px`;
    TIP.el.classList.add('is-on');
    return;
  }
  let top = target.dataset.tipPos === 'below' ? r.bottom + 8 : r.top - ht - 8;
  if (top < 8) top = r.bottom + 8;
  if (top + ht > window.innerHeight - 8) top = r.top - ht - 8;
  TIP.el.style.top = `${top}px`;
  TIP.el.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8)}px`;
  TIP.el.classList.add('is-on');
}

function hideTip() {
  clearTimeout(TIP.timer);
  TIP.target = null;
  if (TIP.el) TIP.el.classList.remove('is-on');
}
