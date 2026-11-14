// Tsugi · The popover on a title's badge, and Pick for me.
'use strict';

/* ------------------------------------------------------------------ */
/* Page badge popover                                                  */
/* ------------------------------------------------------------------ */

function onBadgeClick(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  const b = ev.currentTarget;
  const id = Number(b.dataset.for);
  if (!canEdit()) return;
  if (S.selecting) { toggleSelect(id, ev.shiftKey, 'page'); return; }
  if (S.popover && S.popover.anchor === b) { closePopover(); return; }
  openPopover(b, id);
}

// The popover works on the priority of the list its badge is in (anchor's data-list): AniList's
// for status lists, the list's own for custom lists.
function openPopover(anchor, id) {
  closePopover(false);
  hideTip();
  const e = S.data && S.data.entries.get(id);
  if (!e) return;
  const list = anchor.dataset.list || '';
  const val = h('div', { class: 'apq-pop-val', 'aria-live': 'polite' });
  const minus = h('button', { type: 'button', class: 'apq-pop-step', 'aria-label': 'Lower priority', onclick: () => bumpIn(list, id, -1) }, icon('minus'));
  const plus = h('button', { type: 'button', class: 'apq-pop-step', 'aria-label': 'Raise priority', onclick: () => bumpIn(list, id, 1) }, icon('plus'));
  const chips = h('div', { class: 'apq-chips' },
    [0, 1, 2, 3, 4, 5].map((n) => h('button', {
      type: 'button', class: 'apq-chip', 'data-v': n,
      'aria-label': n ? `Priority ${n}` : 'No priority',
      onclick: () => setPrioIn(list, id, n),
    }, n ? String(n) : 'None')));
  const warnText = h('span', {});
  const warn = h('div', { class: 'apq-pop-warn', hidden: true }, icon('order'), warnText);
  const actIcon = h('span', { class: 'apq-act-ic' });
  const actLabel = h('span', {});
  const action = h('button', { type: 'button', class: 'apq-pop-act', hidden: true }, actIcon, actLabel);
  const foot = h('div', { class: 'apq-pop-foot' });
  const scoreBox = h('div', { class: 'apq-pop-score', hidden: true });
  const listsBox = h('div', { class: 'apq-pop-lists', hidden: true });
  const histBox = h('div', { class: 'apq-pop-hist', hidden: true });
  const sub = h('div', { class: 'apq-pop-sub' });
  const pin = h('button', { type: 'button', class: 'apq-pop-pin', 'data-tip-pos': 'below' }, icon('pin'));
  const stepper = h('div', { class: 'apq-pop-stepper' }, minus, val, plus);
  const prioLabel = h('div', { class: 'apq-pop-label apq-pop-sec' }, 'Priority');
  // The header: cover, title and where it sits, on a tint of the title's own color.
  const cover = h('div', { class: 'apq-pop-cover' }, e.cover ? h('img', { src: e.cover, alt: '', decoding: 'async' }) : null);
  // The episode track, for titles you're watching (kept after the last +1, to show it's finished).
  const trackEp = h('div', { class: 'apq-track-label' });
  const track = h('div', { class: 'apq-track', 'aria-hidden': 'true' });
  const trackBox = h('div', { class: 'apq-pop-track', hidden: true }, trackEp, track);
  const pop = h('div', { class: 'apq-ui apq-pop', role: 'dialog', 'aria-label': e.title },
    h('div', { class: 'apq-pop-head' },
      cover,
      h('div', { class: 'apq-pop-htext' },
        h('div', { class: 'apq-pop-title' }, e.title),
        sub),
      pin),
    trackBox,
    prioLabel,
    stepper,
    chips,
    warn,
    action,
    scoreBox,
    listsBox,
    histBox,
    foot);
  document.body.append(pop);
  anchor.classList.add('is-open');
  paintTitle(pop, e);
  S.popover = { el: pop, id, list, anchor, stepper, val, minus, plus, chips, foot, warn, warnText, action, actIcon, actLabel, scoreBox, listsBox, histBox, sub, pin,
    prioLabel, trackBox, trackEp, track, watching: showsTrack(e) };
  updatePopover();
  positionPopover();
  requestAnimationFrame(() => pop.classList.add('is-open'));
  setTimeout(() => document.addEventListener('pointerdown', onDocPointerDown, true), 0);
}

function updatePopover() {
  const P = S.popover;
  if (!P) return;
  const e = S.data && S.data.entries.get(P.id);
  if (!e) return;
  const p = prioIn(e, P.list);
  // A list with priorities off (Completed and Dropped, by default): score, lists and history only.
  const lite = !prioOn(P.list);
  P.el.classList.toggle('is-lite', lite);
  P.stepper.hidden = lite;
  P.chips.hidden = lite;
  P.prioLabel.hidden = lite;
  updatePopoverTrack(P, e);
  P.pin.hidden = lite;
  const custom = !!customStore(P.list);
  const pinned = p >= PIN_MIN;
  if (pinned) { if (!P.val.querySelector('.apq-ic')) P.val.replaceChildren(icon('pin')); }
  else P.val.textContent = p > 0 ? String(p) : '';
  P.val.classList.toggle('has-value', p > 0);
  P.val.classList.toggle('is-none', !(p > 0));
  P.val.classList.toggle('is-pin', pinned);
  P.minus.disabled = p <= 0 || pinned;
  P.plus.disabled = p >= MAX_PRIORITY;
  P.chips.querySelectorAll('.apq-chip').forEach((c) => c.classList.toggle('is-active', Number(c.dataset.v) === p));
  const subText = lite ? statusLabel(e.status)
    : custom ? (pinned ? `Pinned, #${pinRankIn(e, P.list)} in ${listName(P.list)}` : `Priority in ${listName(P.list)}`)
    : pinned ? (e.status === 'PLANNING' ? `Pinned, #${pinRank(e)} in Up Next` : `Pinned to the top of ${statusLabel(e.status)}`) : statusLabel(e.status);
  if (P.sub.textContent !== subText) P.sub.textContent = subText;
  const pinTip = pinned ? 'Unpin' : 'Pin to the top';
  P.pin.setAttribute('aria-pressed', String(pinned));
  P.pin.setAttribute('aria-label', pinTip);
  P.pin.dataset.tip = pinTip;
  P.pin.disabled = S.busy.has(e.mediaId);
  P.pin.onclick = () => (pinnedIn(entryOf(P.id), P.list) ? unpinIn(P.list, P.id) : pinIn(P.list, P.id));

  const blk = blockerOf(e);
  P.warn.hidden = !blk;
  if (blk) P.warnText.textContent = `${verb()} ${blk.title} first`;

  const act = quickActionFor(e);
  P.action.hidden = !act;
  if (act) {
    const busy = S.busy.has(e.mediaId);
    P.action.disabled = busy;
    if (P.action.dataset.icon !== (busy ? 'busy' : act.icon)) {
      P.action.dataset.icon = busy ? 'busy' : act.icon;
      P.actIcon.replaceChildren(busy ? spinner() : icon(act.icon));
    }
    if (P.actLabel.textContent !== act.label) P.actLabel.textContent = act.label;
    P.action.onclick = () => act.run();
  }

  // Scores for titles you've started; Planning stays about priority.
  const showScore = canEdit() && e.status !== 'PLANNING';
  P.scoreBox.hidden = !showScore;
  if (showScore) {
    if (!P.score) {
      P.score = scoreControl(P.id);
      P.scoreBox.replaceChildren(h('div', { class: 'apq-pop-label' }, 'Score'), P.score);
    }
    P.score._update();
  }

  // One-click custom lists, when you have any.
  const showLists = canEdit() && customListNames().length > 0;
  P.listsBox.hidden = !showLists;
  if (showLists) {
    if (!P.lists) {
      P.lists = customListsControl(P.id);
      P.listsBox.replaceChildren(h('div', { class: 'apq-pop-label' }, 'Custom lists'), P.lists);
    }
    P.lists._update();
  }

  // How many times you've watched it, for titles you've finished.
  updatePopoverHistory(P, e);

  const st = S.rowState.get(P.id) || '';
  if (P.foot.dataset.st !== `${st}:${lite}` || (!lite && !P.foot.childNodes.length)) {
    P.foot.dataset.st = `${st}:${lite}`;
    P.foot.className = 'apq-pop-foot' + (st ? ` is-${st}` : '');
    if (st === 'saving') P.foot.replaceChildren(spinner(), 'Saving');
    else if (st === 'saved') P.foot.replaceChildren(icon('check'), 'Saved to AniList');
    else if (st === 'error') P.foot.replaceChildren(icon('alert'), "Couldn't save");
    else if (lite) P.foot.replaceChildren();
    else P.foot.replaceChildren(h('span', { class: 'apq-kbd' }, '0–9'), 'Type a number to set it');
  }
}

// "Ep 13 of 24" and "2 new" above the track. After the last +1 the title is Completed: the track
// stays (full, brightened once) until the popover closes.
function updatePopoverTrack(P, e) {
  const on = P.watching && (showsTrack(e) || e.status === 'COMPLETED');
  const t = on ? trackOf(e) : null;
  P.trackBox.hidden = !t;
  if (!t) return;
  const fresh = newCount(e);
  const sig = `${t.done}:${t.total}:${fresh}`;
  if (P.trackEp.dataset.sig !== sig) {
    P.trackEp.dataset.sig = sig;
    P.trackEp.replaceChildren(...[trackLabel(t, P.track._done), fresh > 0 ? h('span', { class: 'apq-pop-new' }, `${fresh} new`) : null].filter(Boolean));
  }
  P.track.hidden = !t.span;
  if (t.span) paintTrack(P.track, t);
}

function positionPopover() {
  const P = S.popover;
  if (!P) return;
  if (!P.anchor.isConnected) { closePopover(); return; }
  const r = P.anchor.getBoundingClientRect();
  const w = P.el.offsetWidth, ht = P.el.offsetHeight;
  let top = r.bottom + 8;
  let above = false;
  if (top + ht > window.innerHeight - 8) { top = r.top - ht - 8; above = true; }
  const left = clamp(r.left - 6, 8, window.innerWidth - w - 8);
  P.el.style.top = `${Math.max(8, top)}px`;
  P.el.style.left = `${left}px`;
  P.el.classList.toggle('is-above', above);
}

function onDocPointerDown(ev) {
  const P = S.popover;
  if (!P) return;
  if (P.el.contains(ev.target) || P.anchor.contains(ev.target)) return;
  closePopover();
}

function closePopover(resort = true) {
  const P = S.popover;
  if (!P) return;
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  P.anchor.classList.remove('is-open');
  P.el.classList.remove('is-open');
  setTimeout(() => P.el.remove(), 180);
  S.popover = null;
  if (resort) applyPageSort();
}

/* ------------------------------------------------------------------ */
/* Pick for me                                                         */
/* ------------------------------------------------------------------ */

function buildPick() {
  if (PK.el) return;
  PK.scrim = h('div', { class: 'apq-ui apq-pick-scrim', onclick: () => closePick() });
  PK.sub = h('div', { class: 'apq-pick-sub' });
  PK.lengths = h('div', { class: 'apq-seg apq-pick-seg', role: 'radiogroup', 'aria-label': 'Length' });
  PK.ready = h('button', { type: 'button', class: 'apq-tchip', 'aria-pressed': 'true', onclick: () => togglePickOpt('ready') }, icon('check'), 'Ready to start');
  PK.onlyPrio = h('button', { type: 'button', class: 'apq-tchip', 'aria-pressed': 'false', onclick: () => togglePickOpt('onlyPrio') }, icon('check'), 'Only with a priority');
  PK.img = h('img', { alt: '', decoding: 'async' });
  PK.cover = h('div', { class: 'apq-pick-cover' }, PK.img);
  PK.name = h('div', { class: 'apq-pick-name' });
  PK.meta = h('div', { class: 'apq-pick-meta' });
  PK.tags = h('div', { class: 'apq-pick-tags' });
  PK.stage = h('div', { class: 'apq-pick-stage', 'aria-live': 'polite' }, PK.cover, h('div', { class: 'apq-pick-namebox' }, PK.name), PK.meta, PK.tags);
  PK.empty = h('div', { class: 'apq-empty apq-pick-empty', hidden: true },
    h('div', { class: 'apq-empty-ic' }, icon('inbox')),
    h('div', { class: 'apq-empty-title' }, 'Nothing matches'),
    h('div', { class: 'apq-empty-text' }, 'Try Any length, or turn off a filter.'));
  PK.go = h('button', { type: 'button', class: 'apq-pick-go', onclick: async () => {
    const e = PK.current;
    if (e && await startEntry(e.mediaId)) closePick();
  } }, icon('play'), h('span', {}));
  PK.again = h('button', { type: 'button', class: 'apq-pick-again', onclick: () => roll() }, icon('dice'), 'Pick again');
  PK.open = h('a', { class: 'apq-pick-open', href: '#', 'aria-label': 'Open on AniList', 'data-tip': 'Open on AniList' }, icon('external'));
  PK.el = h('div', { class: 'apq-ui apq-pick', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pick for me' },
    h('div', { class: 'apq-pick-head' },
      h('div', { class: 'apq-pick-hgroup' }, h('div', { class: 'apq-pick-h' }, 'Pick for me'), PK.sub),
      h('button', { type: 'button', class: 'apq-icon-btn', 'aria-label': 'Close', onclick: () => closePick() }, icon('x'))),
    h('div', { class: 'apq-pick-filters' }, PK.lengths, h('div', { class: 'apq-pick-toggles' }, PK.ready, PK.onlyPrio)),
    PK.stage,
    PK.empty,
    h('div', { class: 'apq-pick-actions' }, PK.go, PK.again, PK.open));
  document.body.append(PK.scrim, PK.el);
}

function openPick() {
  if (!S.route || !canEdit() || !S.settings.pick) return;
  closePopover(false);
  hideTip();
  if (S.selecting) exitSelect();
  buildPick();
  S.pickOpen = true;
  renderPickFilters();
  requestAnimationFrame(() => {
    PK.scrim.classList.add('is-open');
    PK.el.classList.add('is-open');
    PK.again.focus({ preventScroll: true });
  });
  roll();
}

function closePick() {
  if (!S.pickOpen || !PK.el) return;
  S.pickOpen = false;
  clearTimeout(PK.timer);
  PK.el.classList.remove('is-open', 'is-rolling', 'is-landed');
  PK.scrim.classList.remove('is-open');
}

function togglePickOpt(key) {
  S.pickOpts[key] = !S.pickOpts[key];
  renderPickFilters();
  roll();
}

function renderPickFilters() {
  if (!PK.el) return;
  const anime = isAnime();
  PK.sub.textContent = `From your ${statusLabel('PLANNING')} list`;
  const opts = [['any', 'Any length'], ['short', 'Short'], ['long', 'Long'], ['movie', anime ? 'Movies' : 'One-shots']];
  const sig = opts.map((o) => o[0]).join() + S.pickOpts.length;
  if (PK.lengths.dataset.sig !== sig) {
    PK.lengths.dataset.sig = sig;
    PK.lengths.replaceChildren(...opts.map(([v, label]) => h('button', {
      type: 'button', role: 'radio', class: 'apq-seg-btn' + (S.pickOpts.length === v ? ' is-active' : ''),
      'aria-checked': String(S.pickOpts.length === v),
      'data-tip': v === 'short' ? (anime ? '13 episodes or fewer' : '50 chapters or fewer') : v === 'long' ? (anime ? 'More than 13 episodes' : 'More than 50 chapters') : null,
      onclick: () => { S.pickOpts.length = v; renderPickFilters(); roll(); },
    }, label)));
  }
  PK.ready.hidden = !S.settings.watchOrder;
  PK.ready.setAttribute('aria-pressed', String(!!S.pickOpts.ready));
  PK.ready.dataset.tip = `Skip titles that need an earlier ${anime ? 'season' : 'volume'} first`;
  PK.onlyPrio.setAttribute('aria-pressed', String(!!S.pickOpts.onlyPrio));
}

function pickPool() {
  const d = S.data;
  if (!d) return [];
  const anime = isAnime();
  const o = S.pickOpts;
  const limit = anime ? 13 : 50;
  const out = [];
  for (const e of d.entries.values()) {
    if (e.status !== 'PLANNING' || e.hidden || adultHidden(e)) continue;
    if (o.onlyPrio && !(e.priority > 0)) continue;
    if (o.ready && S.settings.watchOrder && blockerOf(e)) continue;
    const n = anime ? e.episodes : e.chapters;
    if (o.length === 'short' && !(n && n <= limit && e.format !== 'MOVIE')) continue;
    if (o.length === 'long' && !(n && n > limit)) continue;
    if (o.length === 'movie' && e.format !== (anime ? 'MOVIE' : 'ONE_SHOT')) continue;
    out.push(e);
  }
  return out;
}

function chooseFrom(pool) {
  const max = Math.max(1, maxPriority());
  const weight = (e) => (isPinned(e) ? 14 : e.priority > 0 ? 2 + 8 * (e.priority / max) : 1);
  let cands = pool.filter((e) => !S.pickRecent.includes(e.mediaId));
  if (!cands.length) cands = pool;
  const total = cands.reduce((s, e) => s + weight(e), 0);
  let r = Math.random() * total;
  for (const e of cands) { r -= weight(e); if (r <= 0) return e; }
  return cands[cands.length - 1];
}

function roll() {
  if (!S.pickOpen) return;
  clearTimeout(PK.timer);
  const pool = pickPool();
  PK.empty.hidden = pool.length > 0;
  PK.stage.hidden = !pool.length;
  PK.el.classList.toggle('is-empty', !pool.length);
  if (!pool.length) { PK.current = null; updatePickActions(); return; }
  const final = chooseFrom(pool);
  S.pickRecent = [final.mediaId, ...S.pickRecent.filter((id) => id !== final.mediaId)].slice(0, Math.min(5, pool.length - 1));
  if (final.coverLarge) { const pre = new Image(); pre.src = final.coverLarge; }
  const steps = reducedMotion() || pool.length < 2 ? [] : [40, 45, 50, 55, 62, 72, 86, 104, 128, 160, 200];
  PK.el.classList.remove('is-landed');
  PK.el.classList.toggle('is-rolling', steps.length > 0);
  let i = 0;
  let prev = null;
  const tick = () => {
    if (!S.pickOpen) return;
    if (i < steps.length) {
      let e = pool[Math.floor(Math.random() * pool.length)];
      if (e === prev && pool.length > 1) e = pool[(pool.indexOf(e) + 1) % pool.length];
      prev = e;
      showPick(e, true);
      PK.timer = setTimeout(tick, steps[i++]);
      return;
    }
    showPick(final, false);
    PK.el.classList.remove('is-rolling');
    void PK.cover.offsetWidth;
    PK.el.classList.add('is-landed');
  };
  tick();
}

function showPick(e, rolling) {
  PK.current = rolling ? null : e;
  if (!rolling) paintTitle(PK.el, e);
  PK.cover.style.backgroundColor = e.color || '';
  const src = rolling ? (e.cover || e.coverLarge) : (e.coverLarge || e.cover);
  if (src && PK.img.getAttribute('src') !== src) PK.img.setAttribute('src', src);
  if (!src) PK.img.removeAttribute('src');
  PK.name.textContent = e.title;
  if (!rolling) {
    const parts = [];
    if (e.format) parts.push(FORMATS[e.format] || e.format);
    const n = isAnime() ? e.episodes : e.chapters;
    if (n) parts.push(isAnime() ? `${n} ep${n === 1 ? '' : 's'}` : `${n} ch`);
    const left = remainingMinutes(e);
    if (left) parts.push(fmtMinutes(left));
    if (e.year) parts.push(String(e.year));
    PK.meta.replaceChildren(...parts.map((t) => h('span', {}, t)));
    const tags = [];
    tags.push(isPinned(e)
      ? h('span', { class: 'apq-pill is-prio' }, icon('pin'), `#${pinRank(e)} in Up Next`)
      : e.priority > 0
        ? h('span', { class: 'apq-pill is-prio' }, glyph(tierOf(e.priority, maxPriority())), `Priority ${e.priority}`)
        : h('span', { class: 'apq-pill is-none' }, 'No priority'));
    const blk = blockerOf(e);
    if (blk) tags.push(h('span', { class: 'apq-pill is-warn' }, icon('order'), `${verb()} ${blk.title} first`));
    PK.tags.replaceChildren(...tags);
    PK.open.setAttribute('href', e.url);
  }
  updatePickActions();
}

function updatePickActions() {
  if (!PK.el) return;
  const e = PK.current;
  const show = !!e && canEdit() && e.status === 'PLANNING';
  PK.go.hidden = !show;
  if (show) {
    const busy = S.busy.has(e.mediaId);
    PK.go.disabled = busy;
    PK.go.lastChild.textContent = busy ? 'Starting…' : (isAnime() ? 'Start watching' : 'Start reading');
  }
  PK.open.hidden = !e;
}
