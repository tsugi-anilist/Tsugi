// Tsugi · Mass edit: change many titles at once, with a preview first and Undo after.
// 0.12.2: a wide panel where each field is one compact box that says Keep until you pick (its menu opens under
// it), the picked fields as chips in the footer, the score as one number box in your format, and Visibility.
'use strict';

/* ------------------------------------------------------------------ */
/* What you pick                                                       */
/* ------------------------------------------------------------------ */

const M = { scrim: null, el: null, title: null, sub: null, covers: null, body: null, foot: null, step: 'form', form: null, ids: [], plans: [], done: 0, total: 0, menu: null, menuEl: null, focus: null };
const MASS_STATUSES = ['CURRENT', 'PLANNING', 'COMPLETED', 'REPEATING', 'PAUSED', 'DROPPED'];

function blankMassForm() {
  return {
    status: 'keep',
    score: { mode: 'keep', value: '' },
    progress: { mode: 'keep', value: '' },
    startedAt: { mode: 'keep', value: '' },
    completedAt: { mode: 'keep', value: '' },
    notes: { mode: 'keep', text: '' },
    lists: {},
    hidden: 'keep',
    private: 'keep',
    autoDates: !!S.settings.autoDates, // starting or finishing fills in empty dates with today
    del: false,
  };
}

const progressWord = () => (isAnime() ? 'Episodes' : 'Chapters');

// The score box, in your AniList score format: its range, its step, and what follows the number.
function massScoreSpec(format = scoreFormat()) {
  if (format === 'POINT_100') return { min: 1, max: 100, step: 1, of: '/ 100' };
  if (format === 'POINT_10_DECIMAL') return { min: 0.1, max: 10, step: 0.1, of: '/ 10' };
  if (format === 'POINT_5') return { min: 1, max: 5, step: 1, of: '/ 5', icon: 'star' };
  if (format === 'POINT_3') return { min: 1, max: 3, step: 1, of: '/ 3' };
  return { min: 1, max: 10, step: 1, of: '/ 10' };
}

// What's typed in the score box, as a score AniList takes (0 = nothing usable yet).
function massScoreValue(raw, format = scoreFormat()) {
  const n = parseFloat(String(raw).replace(',', '.'));
  if (Number.isNaN(n) || n <= 0) return 0;
  const sp = massScoreSpec(format);
  const v = sp.step < 1 ? Math.round(n * 10) / 10 : Math.round(n);
  return clamp(v, sp.min, sp.max);
}

const massProgressN = (f) => {
  const pv = String(f.progress.value).trim();
  return pv === '' || Number.isNaN(Number(pv)) ? null : Math.round(Number(pv));
};

// Every field that will change, with the words its chip shows. One place, so the footer's chips, the Preview
// button and the plans always agree.
function massChanges(f) {
  if (f.del) return [{ k: 'del', label: 'Delete', text: '' }];
  const out = [];
  const push = (k, label, text) => out.push({ k, label, text });
  if (f.status !== 'keep') push('status', 'Status', statusLabel(f.status));
  const sv = massScoreValue(f.score.value);
  if (f.score.mode === 'set' && sv > 0) push('score', 'Score', scoreText(sv));
  else if (f.score.mode === 'clear') push('score', 'Score', 'Removed');
  const pn = massProgressN(f);
  if (f.progress.mode === 'set' && pn !== null && pn >= 0) push('progress', progressWord(), `Set to ${pn}`);
  else if (f.progress.mode === 'add' && pn) push('progress', progressWord(), pn > 0 ? `+${pn}` : `−${-pn}`);
  else if (f.progress.mode === 'all') push('progress', progressWord(), 'All');
  if (f.private !== 'keep') push('private', 'Visibility', f.private === 'on' ? 'Private' : 'Public');
  for (const [k, name] of [['startedAt', 'Start date'], ['completedAt', 'Finish date']]) {
    const d = f[k];
    if (d.mode === 'today') push(k, name, 'Today');
    else if (d.mode === 'clear') push(k, name, 'Removed');
    else if (d.mode === 'pick' && parseDateInput(d.value)) push(k, name, fuzzyText(parseDateInput(d.value)));
  }
  const text = f.notes.text.trim();
  if (f.notes.mode === 'replace' && text) push('notes', 'Notes', 'Replaced');
  else if (f.notes.mode === 'append' && text) push('notes', 'Notes', 'Added to the end');
  else if (f.notes.mode === 'clear') push('notes', 'Notes', 'Removed');
  const lists = massListsText(f);
  if (lists) push('lists', 'Custom lists', lists);
  return out;
}

// The fields you've chosen to change, by name ("Status", "Score", ...).
const massPicks = (f) => massChanges(f).map((c) => c.label);

function massListsText(f) {
  const add = [], rem = [];
  for (const [name, act] of Object.entries(f.lists)) { if (act === 'add') add.push(name); else if (act === 'remove') rem.push(name); }
  const parts = [];
  if (add.length) parts.push(`+ ${add.join(', ')}`);
  if (rem.length) parts.push(`− ${rem.join(', ')}`);
  if (f.hidden === 'on') parts.push('Only in custom lists');
  else if (f.hidden === 'off') parts.push('In status lists');
  return parts.join(', ');
}

/* ------------------------------------------------------------------ */
/* What would change                                                   */
/* ------------------------------------------------------------------ */

function snapshotOf(e) {
  return {
    status: e.status, score: e.score || 0, progress: e.progress || 0, notes: e.notes || '',
    startedAt: fuzzy(e.startedAt), completedAt: fuzzy(e.completedAt),
    customLists: [...(e.customLists || [])], hidden: !!e.hidden,
    priority: e.priority || 0, repeat: e.repeat || 0, private: !!e.private, progressVolumes: e.progressVolumes || 0,
  };
}

const API_KEY = { hidden: 'hiddenFromStatusLists' };
const EDIT_KEYS = ['status', 'score', 'progress', 'private', 'startedAt', 'completedAt', 'notes', 'customLists', 'hidden', 'priority'];

function sameValue(key, a, b) {
  if (key === 'startedAt' || key === 'completedAt') return fuzzyKey(a) === fuzzyKey(b);
  if (key === 'customLists') return [...a].sort().join('\u0001') === [...b].sort().join('\u0001');
  return a === b;
}

function parseDateInput(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

function planFor(e, f) {
  const before = snapshotOf(e);
  if (f.del) return { e, before, del: true, keys: [], patch: null };
  const after = { ...before, customLists: [...before.customLists] };
  if (f.status !== 'keep') after.status = f.status;
  const sv = massScoreValue(f.score.value);
  if (f.score.mode === 'set' && sv > 0) after.score = sv;
  else if (f.score.mode === 'clear') after.score = 0;
  const total = isAnime() ? e.episodes : e.chapters;
  const cap = (n) => clamp(Math.round(n) || 0, 0, total || 100000);
  const pn = massProgressN(f);
  if (f.progress.mode === 'set' && pn !== null) after.progress = cap(pn);
  else if (f.progress.mode === 'add' && pn !== null) after.progress = cap(before.progress + pn);
  else if (f.progress.mode === 'all' && total) after.progress = total;
  // Completed means every episode, as on AniList, unless you set the progress yourself.
  else if (f.progress.mode === 'keep' && after.status === 'COMPLETED' && before.status !== 'COMPLETED' && total) after.progress = total;
  if (f.private === 'on') after.private = true;
  else if (f.private === 'off') after.private = false;
  for (const k of ['startedAt', 'completedAt']) {
    const d = f[k];
    if (d.mode === 'today') after[k] = todayFuzzy();
    else if (d.mode === 'clear') after[k] = fuzzy(null);
    else if (d.mode === 'pick' && parseDateInput(d.value)) after[k] = parseDateInput(d.value);
  }
  // Started or finished: empty dates become today, unless you set them yourself above.
  if (f.autoDates && f.status !== 'keep' && S.data && S.data.full) {
    const fill = datesToFill({ status: before.status, progress: before.progress }, { ...after, repeat: before.repeat }, true);
    for (const [k, v] of Object.entries(fill)) if (f[k].mode === 'keep') after[k] = v;
  }
  const text = f.notes.text.trim();
  if (f.notes.mode === 'replace' && text) after.notes = text;
  else if (f.notes.mode === 'append' && text) after.notes = before.notes.trim() ? `${before.notes.replace(/\s+$/, '')}\n${text}` : text;
  else if (f.notes.mode === 'clear') after.notes = '';
  const lists = new Set(after.customLists);
  for (const [name, act] of Object.entries(f.lists)) { if (act === 'add') lists.add(name); else if (act === 'remove') lists.delete(name); }
  after.customLists = customListNames().filter((n) => lists.has(n)).concat([...lists].filter((n) => !customListNames().includes(n)));
  if (f.hidden === 'on') after.hidden = true;
  else if (f.hidden === 'off') after.hidden = false;
  // A pinned title that moves to another list leaves the pins (pinLeaving in lists.js).
  const ends = (after.status === 'CURRENT' || after.status === 'REPEATING') && total && after.progress >= total ? 'COMPLETED' : after.status;
  const unpin = pinLeaving(e, ends);
  if (unpin != null) after.priority = unpin;
  const keys = EDIT_KEYS.filter((k) => !sameValue(k, before[k], after[k]));
  const patch = {};
  for (const k of keys) patch[API_KEY[k] || k] = after[k];
  return { e, before, after, keys, patch, del: false };
}

const clip = (t, n = 34) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function diffText(key, from, to) {
  switch (key) {
    case 'status': return [statusLabel(from), statusLabel(to)];
    case 'score': return [from ? scoreText(from) : 'No score', to ? scoreText(to) : 'No score'];
    case 'progress': return [String(from), String(to)];
    case 'private': return [from ? 'Private' : 'Public', to ? 'Private' : 'Public'];
    case 'startedAt': case 'completedAt': return [fuzzyText(from), fuzzyText(to)];
    case 'notes': return [from ? `“${clip(from.replace(/\s+/g, ' '))}”` : 'None', to ? `“${clip(to.replace(/\s+/g, ' '))}”` : 'None'];
    case 'hidden': return [from ? 'Only in custom lists' : 'In status lists', to ? 'Only in custom lists' : 'In status lists'];
    case 'priority': return [from, to].map((v) => (v >= PIN_MIN ? 'Pinned' : v ? `Priority ${v}` : 'No priority'));
    default: return [String(from), String(to)];
  }
}

const KEY_LABEL = { status: 'Status', score: 'Score', private: 'Visibility', startedAt: 'Started', completedAt: 'Finished', notes: 'Notes', customLists: 'Lists', hidden: 'Where', priority: 'Priority' };

function diffChip(p, key) {
  if (key === 'customLists') {
    const was = new Set(p.before.customLists), now = new Set(p.after.customLists);
    const added = [...now].filter((n) => !was.has(n)), removed = [...was].filter((n) => !now.has(n));
    return h('span', { class: 'apq-diff' }, h('span', { class: 'apq-diff-k' }, 'Lists'),
      added.length ? h('b', { class: 'is-add' }, `+ ${added.join(', ')}`) : null,
      removed.length ? h('b', { class: 'is-rem' }, `− ${removed.join(', ')}`) : null);
  }
  const [a, b] = diffText(key, p.before[key], p.after[key]);
  return h('span', { class: 'apq-diff' }, h('span', { class: 'apq-diff-k' }, KEY_LABEL[key] || progressWord()),
    h('s', {}, a), h('span', { class: 'apq-diff-arrow', 'aria-label': 'to' }, '→'), h('b', {}, b));
}

/* ------------------------------------------------------------------ */
/* The dialog                                                          */
/* ------------------------------------------------------------------ */

function buildMass() {
  if (M.el) return;
  M.scrim = h('div', { class: 'apq-ui apq-mass-scrim', onclick: () => { if (M.step !== 'saving') closeMass(); } });
  M.covers = h('div', { class: 'apq-mass-covers', 'aria-hidden': 'true' });
  M.title = h('div', { class: 'apq-mass-h' });
  M.sub = h('div', { class: 'apq-mass-sub' });
  // Scrolling the fields closes the menu (it would float off its box); not the scroll a redraw causes.
  M.body = h('div', { class: 'apq-mass-body', onscroll: () => { if (performance.now() - (M.drawnAt || 0) > 200) closeMassMenu(); } });
  M.foot = h('footer', { class: 'apq-mass-foot' });
  M.close = h('button', { type: 'button', class: 'apq-icon-btn', 'aria-label': 'Close', onclick: () => closeMass() }, icon('x'));
  M.el = h('div', { class: 'apq-ui apq-mass', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit titles', tabindex: '-1' },
    h('header', { class: 'apq-mass-head' }, M.covers, h('div', { class: 'apq-mass-hgroup' }, M.title, M.sub), M.close),
    M.body, M.foot);
  // A press outside the open menu closes it without redrawing, so the click that follows still lands
  // (on another field's box, a chip, Preview...).
  M.el.addEventListener('mousedown', (ev) => {
    if (!M.menu) return;
    const t = ev.target;
    if (M.menuEl && M.menuEl.contains(t)) return;
    const box = t.closest && t.closest('[data-k^="box:"]');
    if (box && box.dataset.k === `box:${M.menu}`) return; // its own box toggles it
    closeMassMenu();
  });
  window.addEventListener('resize', () => closeMassMenu());
  document.body.append(M.scrim, M.el);
}

function openMass() {
  if (!canEdit() || !S.selecting || S.massOpen || !S.data) return;
  const ids = [...S.selected].filter((id) => S.data.entries.has(id));
  if (!ids.length) return;
  closePopover(false);
  closePick();
  hideTip();
  buildMass();
  M.ids = ids;
  M.form = blankMassForm();
  M.step = 'form';
  M.menu = null;
  M.focus = null;
  S.massOpen = true;
  renderMass();
  requestAnimationFrame(() => {
    M.scrim.classList.add('is-open');
    M.el.classList.add('is-open');
    const first = M.el.querySelector('[data-k="box:status"]');
    (first || M.el).focus({ preventScroll: true });
  });
}

function closeMass() {
  if (!S.massOpen || M.step === 'saving') return;
  closeMassMenu();
  S.massOpen = false;
  M.scrim.classList.remove('is-open');
  M.el.classList.remove('is-open');
}

// The open menu first, then back from the preview, then close.
function massEscape() {
  if (M.step === 'saving') return;
  if (M.menu) { const k = M.menu; closeMassMenu(); focusMass(`box:${k}`); return; }
  if (M.step === 'preview') { massBack(); return; }
  closeMass();
}

function massBack() {
  M.step = 'form';
  M.form.del = false;
  renderMass();
}

function focusMass(key) {
  const el = Array.from(M.el.querySelectorAll('[data-k]')).find((x) => x.dataset.k === key);
  if (el && !el.disabled) el.focus({ preventScroll: true });
}

function renderMass() {
  if (!M.el) return;
  const n = M.ids.length;
  const active = document.activeElement;
  const focusKey = M.focus || (active && M.el.contains(active) ? active.dataset.k : null);
  M.focus = null;
  const scroll = M.body.scrollTop;
  M.close.disabled = M.step === 'saving';
  M.el.classList.toggle('is-preview', M.step !== 'form');
  M.covers.replaceChildren(...massCovers());
  if (M.step === 'form') {
    M.title.textContent = `Edit ${plural(n)}`;
    M.sub.textContent = 'Pick what to change. Everything on Keep stays as each title has it.';
    M.body.replaceChildren(massForm());
  } else {
    const ch = M.plans.filter((p) => p.del || p.keys.length).length;
    M.title.textContent = M.form.del ? `Delete ${plural(ch)}?` : 'Preview';
    M.sub.textContent = M.form.del ? 'Check the list, then confirm.' : ch ? `${plural(ch)} will change.` : 'Nothing would change.';
    M.body.replaceChildren(massPreview());
  }
  renderMassFoot();
  if (M.step === 'form') M.body.scrollTop = scroll; else if (M.stepChanged) M.body.scrollTop = 0;
  M.stepChanged = false;
  M.drawnAt = performance.now();
  placeMassMenu();
  if (focusKey) focusMass(focusKey);
}

// The selection's own covers, overlapping, beside the title: what you're about to change.
function massCovers() {
  const shown = M.ids.slice(0, 5).map((id) => S.data && S.data.entries.get(id)).filter(Boolean);
  const kids = shown.map((e) => {
    const c = h('span', { class: 'apq-mass-cv' });
    if (e.color) c.style.backgroundColor = e.color;
    if (e.cover) c.append(h('img', { src: e.cover, alt: '', loading: 'lazy', decoding: 'async' }));
    return c;
  });
  if (M.ids.length > shown.length) kids.push(h('span', { class: 'apq-mass-cv is-more' }, `+${M.ids.length - shown.length}`));
  return kids;
}

function renderMassFoot() {
  if (!M.el) return;
  const kids = [];
  if (M.step === 'form') {
    const changes = massChanges(M.form);
    kids.push(h('div', { class: 'apq-mass-picks', 'aria-live': 'polite' }, changes.length
      ? changes.map((c) => h('span', { class: 'apq-mpick', 'data-pick': c.k },
        h('span', { class: 'apq-mpick-k' }, c.label), h('span', { class: 'apq-mpick-v' }, c.text),
        h('button', {
          type: 'button', class: 'apq-mpick-x', 'data-k': `unpick:${c.k}`, 'aria-label': `Keep ${c.label.toLowerCase()} as it is`,
          onclick: () => { unpickMass(c.k); M.focus = changes.length > 1 ? null : 'box:status'; renderMass(); },
        }, icon('x'))))
      : h('span', { class: 'apq-mass-note' }, 'Nothing picked yet')));
    kids.push(h('div', { class: 'apq-mass-btns' },
      h('button', { type: 'button', class: 'apq-mbtn', 'data-k': 'cancel', onclick: () => closeMass() }, 'Cancel'),
      h('button', {
        type: 'button', class: 'apq-mbtn is-primary', 'data-k': 'preview', disabled: !changes.length,
        onclick: showMassPreview,
      }, 'Preview')));
  } else if (M.step === 'preview') {
    const ch = M.plans.filter((p) => p.del || p.keys.length).length;
    kids.push(h('button', { type: 'button', class: 'apq-mbtn', 'data-k': 'back', onclick: massBack }, icon('back'), 'Back'));
    kids.push(h('span', { class: 'apq-mass-grow' }));
    if (ch) {
      kids.push(h('button', {
        type: 'button', class: 'apq-mbtn is-primary' + (M.form.del ? ' is-danger' : ''), 'data-k': 'apply', onclick: applyMass,
      }, M.form.del ? icon('trash') : icon('check'), M.form.del ? `Delete ${plural(ch)}` : `Apply to ${plural(ch)}`));
    }
  } else {
    kids.push(h('div', { class: 'apq-mass-note is-saving' }, spinner(),
      M.total > 1 ? `Saving to AniList… ${Math.min(M.done + 1, M.total)} of ${M.total}` : 'Saving to AniList…'));
  }
  M.foot.replaceChildren(...kids);
  M.foot.classList.toggle('is-form', M.step === 'form');
}

// A chip's ×: that field goes back to Keep.
function unpickMass(k) {
  const f = M.form;
  if (k === 'status') f.status = 'keep';
  else if (k === 'private') f.private = 'keep';
  else if (k === 'lists') { f.lists = {}; f.hidden = 'keep'; }
  else if (f[k]) f[k].mode = 'keep';
}

function showMassPreview() {
  if (!massPicks(M.form).length) return;
  closeMassMenu();
  M.plans = M.ids.map((id) => S.data.entries.get(id)).filter(Boolean).map((e) => planFor(e, M.form));
  M.step = 'preview';
  M.stepChanged = true;
  renderMass();
  requestAnimationFrame(() => focusMass(M.el.querySelector('[data-k=apply]') ? 'apply' : 'back'));
}

function startMassDelete() {
  M.form.del = true;
  showMassPreview();
}

/* ---- Fields: one box each, its menu under it ---- */

// Each field: its menu's choices ([value, label, hint]), the current one, and how a pick is kept.
function massFields() {
  const f = M.form;
  const anime = isAnime();
  const full = !!(S.data && S.data.full);
  const sp = massScoreSpec();
  const out = [
    { k: 'status', label: 'Status', cur: f.status, set: (v) => { f.status = v; },
      opts: [['keep', 'Keep'], ...MASS_STATUSES.map((st) => [st, statusLabel(st)])] },
    { k: 'score', label: 'Score', cur: f.score.mode, set: (v) => { f.score.mode = v; },
      opts: [['keep', 'Keep'], ['set', 'Set to', `A number from ${sp.min} to ${sp.max}, your scoring`], ['clear', 'Remove', 'No score']] },
    { k: 'progress', label: progressWord(), cur: f.progress.mode, set: (v) => { f.progress.mode = v; },
      opts: [['keep', 'Keep'], ['set', 'Set to'], ['add', 'Add', 'A minus takes away'],
        ['all', anime ? 'All episodes' : 'All chapters', `Titles of unknown length keep their ${anime ? 'episodes' : 'chapters'}`]] },
  ];
  if (full) {
    out.push({ k: 'private', label: 'Visibility', cur: f.private, set: (v) => { f.private = v; },
      opts: [['keep', 'Keep'], ['on', 'Private', 'Only you see them'], ['off', 'Public', 'Shown on your profile and lists']] });
    for (const [k, label] of [['startedAt', 'Start date'], ['completedAt', 'Finish date']]) {
      out.push({ k, label, cur: f[k].mode, set: (v) => { f[k].mode = v; },
        opts: [['keep', 'Keep'], ['today', 'Today'], ['pick', 'Pick a date'], ['clear', 'Remove']] });
    }
    out.push({ k: 'notes', label: 'Notes', cur: f.notes.mode, set: (v) => { f.notes.mode = v; },
      opts: [['keep', 'Keep'], ['replace', 'Replace', 'The same notes for every title'], ['append', 'Add to the end', 'On a new line after their notes'], ['clear', 'Remove']] });
  }
  if (customListNames().length) out.push({ k: 'lists', label: 'Custom lists', cur: massListsText(f) ? 'some' : 'keep', lists: true });
  return out;
}

function massForm() {
  const f = M.form;
  const full = !!(S.data && S.data.full);
  const wrap = h('div', { class: 'apq-mass-form' });
  const grid = h('div', { class: 'apq-mass-fields' });
  for (const fd of massFields()) grid.append(massField(fd));
  wrap.append(grid);
  if (!full) {
    wrap.append(h('p', { class: 'apq-mass-same' }, 'Visibility, dates, notes and deleting are off for now: AniList didn\'t send them with your list. Reload the page to try again.'));
    return wrap;
  }
  wrap.append(h('button', {
    type: 'button', class: 'apq-mdel', 'data-k': 'delete', onclick: startMassDelete,
  }, icon('trash'), h('span', { class: 'apq-mdel-text' },
    h('span', { class: 'apq-mdel-title' }, `Delete ${M.ids.length === 1 ? 'it' : `these ${M.ids.length}`} from my list`),
    h('span', { class: 'apq-mdel-desc' }, 'You\'ll see them first, and Undo can add them back.'))));
  return wrap;
}

function massField(fd) {
  const f = M.form;
  const picked = fd.cur !== 'keep';
  const open = M.menu === fd.k;
  const choice = fd.lists ? null : fd.opts.find(([v]) => v === fd.cur);
  const shown = fd.lists ? (massListsText(f) || 'Keep') : choice ? choice[1] : 'Keep';
  const box = h('button', {
    type: 'button', class: 'apq-mbox' + (picked ? ' is-picked' : ''), 'data-k': `box:${fd.k}`,
    'aria-haspopup': 'true', 'aria-expanded': String(open), 'aria-label': `${fd.label}: ${shown}`,
    // Read M.menu now, not when drawn: Esc, Tab or a scroll close the menu without a redraw.
    onclick: () => { const was = M.menu === fd.k; M.menu = was ? null : fd.k; M.focus = was ? `box:${fd.k}` : null; renderMass(); },
    onkeydown: (ev) => {
      if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && M.menu !== fd.k) { ev.preventDefault(); M.menu = fd.k; renderMass(); }
    },
  }, h('span', { class: 'apq-mbox-v' }, shown), icon('chevron', 'apq-mbox-ch'));
  const ctl = h('div', { class: 'apq-mf-ctl' }, box);
  const under = [];

  if (fd.k === 'score' && f.score.mode === 'set') ctl.append(massScoreBox());
  if (fd.k === 'progress' && (f.progress.mode === 'set' || f.progress.mode === 'add')) {
    ctl.append(massInput('progress-n', {
      type: 'number', step: '1', min: f.progress.mode === 'set' ? '0' : null, inputmode: 'numeric', class: 'is-num',
      'aria-label': f.progress.mode === 'set' ? `${progressWord()} done` : `${progressWord()} to add`,
      placeholder: f.progress.mode === 'set' ? '0' : '1',
    }, f.progress.value, (v) => { f.progress.value = v; }));
  }
  if ((fd.k === 'startedAt' || fd.k === 'completedAt') && f[fd.k].mode === 'pick') {
    ctl.append(massInput(`${fd.k}-date`, { type: 'date', 'aria-label': fd.label, class: 'is-date' }, f[fd.k].value, (v) => { f[fd.k].value = v; }));
  }
  if (fd.k === 'notes' && (f.notes.mode === 'replace' || f.notes.mode === 'append')) {
    under.push(massInput('notes-text', {
      tag: 'textarea', rows: '3', 'aria-label': 'Notes', class: 'is-notes',
      placeholder: f.notes.mode === 'append' ? 'Added on a new line after any notes they have' : 'New notes for every selected title',
    }, f.notes.text, (v) => { f.notes.text = v; }));
  }
  if (fd.k === 'status' && S.data && S.data.full && (f.status === 'CURRENT' || f.status === 'COMPLETED')) {
    under.push(h('button', {
      type: 'button', class: 'apq-mcheck', 'aria-pressed': String(f.autoDates), 'data-k': 'autodates',
      title: f.status === 'CURRENT' ? 'Titles you haven\'t started get today as their start date' : 'Titles finished for the first time get today as their finish date',
      onclick: () => { f.autoDates = !f.autoDates; renderMass(); },
    }, h('span', { class: 'apq-mcheck-box' }, icon('check')), 'Fill empty dates with today'));
  }
  return h('div', { class: 'apq-mf' + (picked ? ' is-picked' : ''), 'data-field': fd.k },
    h('div', { class: 'apq-mf-label' }, fd.label), ctl, ...under);
}

// The score: one number box in your format, like Episodes.
function massScoreBox() {
  const f = M.form;
  const format = scoreFormat();
  const sp = massScoreSpec(format);
  const sv = massScoreValue(f.score.value, format);
  const input = massInput('score-n', {
    type: 'number', min: String(sp.min), max: String(sp.max), step: String(sp.step), inputmode: sp.step < 1 ? 'decimal' : 'numeric',
    class: 'is-num', 'aria-label': `Score out of ${sp.max}`, placeholder: format === 'POINT_100' ? '80' : format === 'POINT_5' ? '4' : format === 'POINT_3' ? '3' : '8',
  }, f.score.value, (v) => { f.score.value = v; paintFace(); });
  const of = h('span', { class: 'apq-mnum-of' });
  const paintFace = () => {
    const v = massScoreValue(f.score.value, format);
    if (format === 'POINT_3') of.replaceChildren(icon(['meh', 'frown', 'meh', 'smile'][v] || 'meh'), h('span', {}, sp.of));
  };
  if (format === 'POINT_3') paintFace();
  else of.append(...(sp.icon ? [icon(sp.icon)] : []), h('span', {}, sp.of));
  if (format === 'POINT_3' && !sv) of.classList.add('is-empty');
  return h('label', { class: 'apq-mnum' }, input, of);
}

function massInput(key, attrs, value, onValue) {
  const el = h(attrs.tag || 'input', { ...attrs, tag: null, class: `apq-minput ${attrs.class || ''}`, 'data-k': key });
  el.value = value;
  el.addEventListener('input', () => { onValue(el.value); renderMassFoot(); });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ev.stopPropagation(); showMassPreview(); return; }
    if (ev.key !== 'Escape') ev.stopPropagation();
  });
  return el;
}

/* ---- The open menu ---- */

function closeMassMenu() {
  if (!M.menu) return;
  const box = M.el && M.el.querySelector(`[data-k="box:${M.menu}"]`);
  if (box) box.setAttribute('aria-expanded', 'false');
  M.menu = null;
  if (M.menuEl) M.menuEl.remove();
  M.menuEl = null;
}

// What needs typing after a pick gets the focus (the score, a date...); else the field's box.
const MASS_NEXT = { score: { set: 'score-n' }, progress: { set: 'progress-n', add: 'progress-n' }, startedAt: { pick: 'startedAt-date' }, completedAt: { pick: 'completedAt-date' }, notes: { replace: 'notes-text', append: 'notes-text' } };

function placeMassMenu() {
  if (M.menuEl) { M.menuEl.remove(); M.menuEl = null; }
  if (!M.menu || M.step !== 'form') { M.menu = null; return; }
  const fd = massFields().find((x) => x.k === M.menu);
  const box = M.el.querySelector(`[data-k="box:${M.menu}"]`);
  if (!fd || !box) { M.menu = null; return; }
  const menu = fd.lists ? massListsMenu() : massMenu(fd);
  M.menuEl = menu;
  M.el.append(menu);
  const r = box.getBoundingClientRect();
  const vh = window.innerHeight, vw = window.innerWidth;
  menu.style.minWidth = `${Math.round(r.width)}px`;
  const mh = menu.offsetHeight, mw = menu.offsetWidth;
  const below = vh - r.bottom - 12, above = r.top - 12;
  const up = mh > below && above > below;
  menu.style.maxHeight = `${Math.max(120, Math.floor(up ? above : below))}px`;
  menu.style.left = `${Math.round(clamp(r.left, 8, vw - mw - 8))}px`;
  if (up) menu.style.bottom = `${Math.round(vh - r.top + 4)}px`;
  else menu.style.top = `${Math.round(r.bottom + 4)}px`;
  menu.classList.toggle('is-up', up);
  requestAnimationFrame(() => {
    if (M.menuEl !== menu) return;
    menu.classList.add('is-open');
    const on = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
    if (on && !menu.contains(document.activeElement)) on.focus({ preventScroll: true });
  });
}

function massMenu(fd) {
  const items = [];
  fd.opts.forEach(([v, label, hint], i) => {
    const on = fd.cur === v;
    items.push(h('button', {
      type: 'button', role: 'menuitemradio', class: 'apq-mopt' + (v === 'keep' ? ' is-keep' : ''), 'aria-checked': String(on), 'data-k': `${fd.k}:${v}`,
      onclick: () => {
        fd.set(v);
        closeMassMenu();
        M.focus = (MASS_NEXT[fd.k] || {})[v] || `box:${fd.k}`;
        renderMass();
      },
    }, h('span', { class: 'apq-mopt-text' }, h('span', { class: 'apq-mopt-l' }, label), hint ? h('span', { class: 'apq-mopt-hint' }, hint) : null),
    h('span', { class: 'apq-mopt-tick' }, on ? icon('check') : null)));
    if (v === 'keep' && i < fd.opts.length - 1) items.push(h('div', { class: 'apq-mmenu-sep', role: 'separator' }));
  });
  const menu = h('div', { class: 'apq-ui apq-mmenu', role: 'menu', 'aria-label': fd.label, onkeydown: massMenuKeys }, items);
  return menu;
}

// Custom lists: each list Keep / Add / Remove, and "only in custom lists". Stays open while you set them.
function massListsMenu() {
  const f = M.form;
  const seg = (key, label, opts, cur, pick) => h('div', { class: 'apq-mseg', role: 'radiogroup', 'aria-label': label },
    opts.map(([v, text]) => h('button', {
      type: 'button', role: 'radio', class: 'apq-mseg-btn', 'aria-checked': String(cur === v), 'data-k': `${key}:${v}`,
      onclick: () => { pick(v); M.focus = `${key}:${v}`; renderMass(); },
    }, text)));
  const rows = customListNames().map((name) => h('div', { class: 'apq-mlrow' }, h('span', { class: 'apq-mlrow-name', title: name }, name),
    seg(`list:${name}`, name, [['keep', 'Keep'], ['add', 'Add'], ['remove', 'Remove']], f.lists[name] || 'keep', (v) => { f.lists[name] = v; })));
  if (S.data && S.data.full) {
    rows.push(h('div', { class: 'apq-mmenu-sep', role: 'separator' }));
    rows.push(h('div', { class: 'apq-mlrow' }, h('span', { class: 'apq-mlrow-name' }, 'Only in custom lists'),
      seg('hidden', 'Only in custom lists', [['keep', 'Keep'], ['on', 'Yes'], ['off', 'No']], f.hidden, (v) => { f.hidden = v; })));
  }
  return h('div', { class: 'apq-ui apq-mmenu is-lists', role: 'group', 'aria-label': 'Custom lists', onkeydown: massMenuKeys }, rows);
}

// Arrows move through the menu's choices; Tab leaves it (and closes it); Esc is main.js's (massEscape).
function massMenuKeys(ev) {
  const menu = ev.currentTarget;
  const btns = Array.from(menu.querySelectorAll('button'));
  const i = btns.indexOf(document.activeElement);
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Home' || ev.key === 'End') {
    ev.preventDefault();
    ev.stopPropagation();
    if (menu.classList.contains('is-lists') && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      // Rows move up and down, keeping the column.
      const rows = Array.from(menu.querySelectorAll('.apq-mseg'));
      const seg = document.activeElement && document.activeElement.closest('.apq-mseg');
      const r = rows.indexOf(seg), col = seg ? Array.from(seg.children).indexOf(document.activeElement) : 0;
      const next = rows[(r + (ev.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
      if (next) (next.children[col] || next.children[0]).focus();
      return;
    }
    const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? btns.length - 1 : (i + (ev.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
    if (btns[n]) btns[n].focus();
    return;
  }
  if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && menu.classList.contains('is-lists')) {
    ev.preventDefault();
    ev.stopPropagation();
    const seg = document.activeElement && document.activeElement.closest('.apq-mseg');
    if (!seg) return;
    const kids = Array.from(seg.children);
    const c = kids.indexOf(document.activeElement);
    const next = kids[clamp(c + (ev.key === 'ArrowRight' ? 1 : -1), 0, kids.length - 1)];
    if (next) next.focus();
    return;
  }
  if (ev.key === 'Tab') {
    const k = M.menu;
    ev.preventDefault();
    closeMassMenu();
    focusMass(`box:${k}`);
  }
}

function massPreview() {
  const changed = M.plans.filter((p) => p.del || p.keys.length);
  const same = M.plans.filter((p) => !p.del && !p.keys.length);
  const wrap = h('div', { class: 'apq-mass-preview' });
  if (M.form.del) {
    wrap.append(h('div', { class: 'apq-mass-warn' }, icon('alert'),
      h('span', {}, 'Undo can add them back with their status, score, progress, dates, notes and lists, but not their activity history.')));
  }
  if (!changed.length) {
    wrap.append(stateView('check', 'Nothing to change', 'These titles already match what you picked.'));
    return wrap;
  }
  const list = h('div', { class: 'apq-plist' });
  for (const p of changed) {
    const e = p.e;
    const cover = h('div', { class: 'apq-plist-cover' });
    if (e.color) cover.style.backgroundColor = e.color;
    if (e.cover) cover.append(h('img', { src: e.cover, alt: '', loading: 'lazy', decoding: 'async' }));
    const diffs = p.del ? [h('span', { class: 'apq-diff is-del' }, icon('trash'), 'Deleted from your list')] : p.keys.map((k) => diffChip(p, k));
    list.append(h('div', { class: 'apq-plist-row' + (p.del ? ' is-del' : ''), 'data-id': e.mediaId }, cover,
      h('div', { class: 'apq-plist-text' }, h('div', { class: 'apq-plist-title' }, e.title), h('div', { class: 'apq-plist-diffs' }, diffs))));
  }
  wrap.append(list);
  if (same.length) {
    const names = same.slice(0, 4).map((p) => p.e.title).join(', ') + (same.length > 4 ? ` and ${same.length - 4} more` : '');
    wrap.append(h('p', { class: 'apq-mass-same' }, `No change for ${plural(same.length)}: ${names}.`));
  }
  if (!M.form.del) wrap.append(h('p', { class: 'apq-mass-same' }, 'AniList\'s own page shows the new values after a reload. The hub shows them right away.'));
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Saving, and Undo                                                    */
/* ------------------------------------------------------------------ */

function removeEntry(e) {
  if (!S.data) return;
  S.data.entries.delete(e.mediaId);
  S.gone.add(e.mediaId);
  S.selected.delete(e.mediaId);
  D.rows.delete(e.mediaId);
}

function restoreEntry(e, saved) {
  if (!S.data) return;
  applySaved(e, saved);
  S.data.entries.set(e.mediaId, e);
  S.gone.delete(e.mediaId);
}

// Everything AniList needs to add a deleted title back as it was.
function recreatePatch(b) {
  return {
    status: b.status, score: b.score, progress: b.progress, progressVolumes: b.progressVolumes, repeat: b.repeat,
    priority: b.priority, private: b.private, notes: b.notes, hiddenFromStatusLists: b.hidden,
    customLists: b.customLists, startedAt: b.startedAt, completedAt: b.completedAt,
  };
}

function reversePatch(before, now) {
  const patch = {};
  for (const k of EDIT_KEYS) if (!sameValue(k, before[k], now[k])) patch[API_KEY[k] || k] = before[k];
  return patch;
}

// Runs ops, copies the results into our list, and says how it went. Returns the ops that worked.
async function runAndApply(ops) {
  for (const op of ops) S.busy.add(op.mediaId);
  scheduleRefresh();
  let out;
  try {
    out = await runOps(ops, (done, total) => { M.done = done; M.total = total; if (M.step === 'saving') renderMassFoot(); });
  } finally {
    for (const op of ops) S.busy.delete(op.mediaId);
  }
  const ok = [];
  for (const [op, saved] of out.results) {
    if (op.kind === 'delete') removeEntry(op.e);
    else if (op.kind === 'create') restoreEntry(op.e, saved);
    else applySaved(op.e, saved);
    ok.push(op);
  }
  entryChanged();
  decoratePage();
  paintSelection();
  scheduleResort();
  return { ok, failed: out.failed };
}

function undoFor(ok) {
  const back = [];
  for (const op of ok) {
    if (op.kind === 'delete') back.push({ kind: 'create', e: op.e, mediaId: op.mediaId, patch: recreatePatch(op.before) });
    else {
      const patch = reversePatch(op.before, snapshotOf(op.e));
      if (Object.keys(patch).length) back.push({ kind: 'save', e: op.e, entryId: op.e.id, mediaId: op.mediaId, patch, before: snapshotOf(op.e) });
    }
  }
  return back;
}

async function runUndo(back) {
  if (!back.length) return;
  const { ok, failed } = await runAndApply(back);
  if (failed.length) toast(`Couldn't undo ${plural(failed.length)}. Make sure you're logged in to AniList.`, 'error');
  else toast(`Undone for ${plural(ok.length)}`);
}

async function applyMass() {
  if (M.step !== 'preview') return;
  const plans = M.plans.filter((p) => p.del || p.keys.length);
  if (!plans.length) return;
  const ops = plans.map((p) => (p.del
    ? { kind: 'delete', e: p.e, entryId: p.e.id, mediaId: p.e.mediaId, before: p.before }
    : { kind: 'save', e: p.e, entryId: p.e.id, mediaId: p.e.mediaId, patch: p.patch, before: p.before }));
  M.step = 'saving';
  M.done = 0;
  M.total = 0;
  renderMass();
  M.body.setAttribute('inert', '');
  let res;
  try { res = await runAndApply(ops); }
  finally {
    M.body.removeAttribute('inert');
    M.step = 'form';
  }
  closeMass();
  const { ok, failed } = res;
  const deleting = ops[0].kind === 'delete';
  const back = undoFor(ok);
  const undo = back.length ? { label: 'Undo', run: () => runUndo(back) } : null;
  const did = deleting ? `Deleted ${plural(ok.length)}` : `Updated ${plural(ok.length)}`;
  if (failed.length) {
    toast(`${ok.length ? `${did}. ` : ''}Couldn't save ${plural(failed.length)}. Make sure you're logged in to AniList.`, 'error', undo, 12000);
  } else {
    toast(did, 'ok', undo, 15000);
  }
}
