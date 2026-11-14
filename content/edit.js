// Tsugi · Saving changes: one title, or many at once.
'use strict';

/* Editing one title                                                   */
/* ------------------------------------------------------------------ */

function setPriority(mediaId, value, opts = {}) {
  const d = S.data;
  if (!d || !d.canEdit) return;
  const e = d.entries.get(mediaId);
  if (!e) return;
  value = clamp(Math.round(Number(value)) || 0, 0, MAX_PRIORITY);
  if (e.priority === value && !S.pending.has(mediaId)) {
    if (opts.notify) notifySet(e);
    return;
  }
  if (!S.confirmed.has(mediaId)) S.confirmed.set(mediaId, e.priority);
  e.priority = value;

  const prev = S.pending.get(mediaId);
  if (prev) clearTimeout(prev.timer);
  const p = { value, entryId: e.id, timer: 0 };
  p.timer = setTimeout(() => flushSave(mediaId), 450);
  S.pending.set(mediaId, p);

  S.flash.add(mediaId);
  setStates([mediaId], 'saving');
  if (opts.notify) notifySet(e);
  scheduleResort();
}

function bump(mediaId, delta) {
  const e = S.data && S.data.entries.get(mediaId);
  if (e && !isPinned(e)) setPriority(mediaId, (e.priority || 0) + delta);
}

function notifySet(e) {
  toast(isPinned(e) ? `${e.title} is pinned` : e.priority > 0 ? `${e.title}: priority ${e.priority}` : `${e.title}: priority removed`, 'ok', null, 0, e);
}

async function flushSave(mediaId, keepalive = false) {
  const p = S.pending.get(mediaId);
  if (!p) return;
  clearTimeout(p.timer);
  try {
    const res = await gqlSession(SAVE_MUTATION, { id: p.entryId, priority: p.value }, keepalive);
    if (S.pending.get(mediaId) !== p) return; // a newer edit is queued
    S.pending.delete(mediaId);
    S.confirmed.delete(mediaId);
    const saved = res && res.SaveMediaListEntry;
    const e = S.data && S.data.entries.get(mediaId);
    if (e && saved && typeof saved.priority === 'number') e.priority = saved.priority;
    setStates([mediaId], 'saved');
  } catch {
    if (S.pending.get(mediaId) !== p) return;
    S.pending.delete(mediaId);
    const e = S.data && S.data.entries.get(mediaId);
    const before = S.confirmed.get(mediaId);
    S.confirmed.delete(mediaId);
    if (e && before != null) e.priority = before;
    setStates([mediaId], 'error');
    toast(`Couldn't save ${e ? e.title : 'that change'}. Make sure you're logged in to AniList.`, 'error');
    scheduleResort();
  }
}

function setStates(ids, st) {
  for (const id of ids) {
    clearTimeout(S.stateTimers.get(id));
    if (st) S.rowState.set(id, st); else S.rowState.delete(id);
    if (st === 'saved' || st === 'error') {
      S.stateTimers.set(id, setTimeout(() => {
        if (S.rowState.get(id) === st) { S.rowState.delete(id); scheduleRefresh(); }
      }, st === 'saved' ? 1600 : 5000));
    }
  }
  scheduleRefresh();
}

let refreshFrame = 0;
function scheduleRefresh() {
  if (refreshFrame) return;
  refreshFrame = requestAnimationFrame(() => { refreshFrame = 0; refreshAllViews(); });
}

function refreshAllViews() {
  withPassMemo(() => {
    document.querySelectorAll('.apq-badge').forEach(updateBadge);
    document.querySelectorAll('.apq-pc').forEach(updatePoster);
  });
  if (D.drawer && S.drawerOpen && S.data && S.view === 'list') {
    for (const [id, row] of D.rows) {
      if (!row.isConnected) continue;
      const e = S.data.entries.get(id);
      if (e) updateRow(row, e);
    }
  }
  if (D.drawer && S.drawerOpen && S.data && S.view === 'check' && checkSig() !== HC.sig) renderCheckNow();
  if (S.popover) updatePopover();
  renderDock();
  renderBar();
}

let resortTimer = 0;
function scheduleResort() {
  clearTimeout(resortTimer);
  resortTimer = setTimeout(() => {
    if (S.drawerOpen) renderDrawerList({ animate: true });
    applyPageSort();
  }, 900);
}

// Change a title's status or progress. Returns what it was before, for Undo.
// Starting or finishing a title also fills in its empty start or finish date (see datesToFill);
// `before` then has a startedAt or completedAt too, so Undo empties them again.
async function updateEntry(mediaId, patch) {
  const e = S.data && S.data.entries.get(mediaId);
  if (!e || !canEdit() || S.busy.has(mediaId)) return null;
  // Undo puts back exactly what this change touched (a finished +1 also changes the status).
  const unpin = pinLeaving(e, statusAfter(e, patch), patch);
  if (unpin != null) patch = { ...patch, priority: unpin };
  const before = { status: e.status, progress: e.progress || 0 };
  if (patch.score != null) before.score = e.score || 0;
  if (patch.priority != null) before.priority = e.priority || 0;
  // Dates are only known when AniList sent them with the list (S.data.full).
  const moves = statusAfter(e, patch) !== e.status || (patch.progress != null && patch.progress !== (e.progress || 0));
  if (S.data.full && moves && patch.startedAt === undefined && patch.completedAt === undefined) {
    const dates = datesToFill({ status: e.status, progress: e.progress || 0 },
      { status: statusAfter(e, patch), progress: patch.progress != null ? patch.progress : e.progress || 0, repeat: e.repeat, startedAt: e.startedAt, completedAt: e.completedAt });
    for (const k of Object.keys(dates)) before[k] = fuzzy(e[k]);
    patch = { ...patch, ...dates };
  }
  S.busy.add(mediaId);
  scheduleRefresh();
  if (S.pickOpen) updatePickActions();
  try {
    const res = await gqlSession(ENTRY_MUTATION, { id: e.id, ...patch });
    const saved = (res && res.SaveMediaListEntry) || {};
    e.status = saved.status || patch.status || e.status;
    if (typeof saved.progress === 'number') e.progress = saved.progress;
    else if (patch.progress != null) e.progress = patch.progress;
    if (typeof saved.score === 'number') e.score = saved.score;
    else if (patch.score != null) e.score = patch.score;
    if (typeof saved.priority === 'number') e.priority = saved.priority;
    else if (patch.priority != null) e.priority = patch.priority;
    if (typeof saved.repeat === 'number') e.repeat = saved.repeat;
    for (const k of ['startedAt', 'completedAt']) {
      if (saved[k] !== undefined) e[k] = fuzzy(saved[k]);
      else if (patch[k] !== undefined) e[k] = fuzzy(patch[k]);
    }
    return before;
  } catch {
    toast(`Couldn't update ${e.title}. Make sure you're logged in to AniList.`, 'error');
    return null;
  } finally {
    S.busy.delete(mediaId);
    entryChanged();
  }
}

function undoEntry(mediaId, before) {
  return {
    label: 'Undo',
    run: async () => {
      const e = S.data && S.data.entries.get(mediaId);
      if (e && await updateEntry(mediaId, before)) toast(`Undone for ${e.title}`, 'ok', null, 0, e);
    },
  };
}

// Start (or resume) a title. A pinned title leaves the pins and gets its old priority back.
async function startEntry(mediaId) {
  const e = S.data && S.data.entries.get(mediaId);
  if (!e) return false;
  const patch = { status: 'CURRENT' };
  if (isPinned(e) && e.status === 'PLANNING') patch.priority = unpinnedPriority(e);
  const before = await updateEntry(mediaId, patch);
  if (!before) return false;
  toast(`${e.title} moved to ${statusLabel(e.status)}${datesNote(before)}`, 'ok', undoEntry(mediaId, before), 0, e);
  return true;
}

// ", start date set to today", when updateEntry filled one in.
function datesNote(before) {
  const s = before && before.startedAt !== undefined, c = before && before.completedAt !== undefined;
  return s && c ? ', dates set to today' : s ? ', start date set to today' : c ? ', finish date set to today' : '';
}

// Mark the next episode or chapter done. The last one finishes the title: "Finished <title>", with Undo.
async function plusOne(mediaId) {
  const e = S.data && S.data.entries.get(mediaId);
  if (!e) return;
  const before = await updateEntry(mediaId, { progress: (e.progress || 0) + 1 });
  if (!before) return;
  const acts = [undoEntry(mediaId, before)];
  if (e.status === 'COMPLETED') {
    toast(`Finished ${e.title}${datesNote(before)}`, 'ok', acts, 0, e);
    return;
  }
  toast((isAnime() ? `${e.title}: episode ${e.progress} watched` : `${e.title}: chapter ${e.progress} read`) + datesNote(before), 'ok', acts, 0, e);
}

// Scores, in the list owner's AniList score format.
const scoreFormat = () => (S.data && S.data.scoreFormat) || 'POINT_10';

function scoreSteps(format = scoreFormat()) {
  if (format === 'POINT_100') return [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  if (format === 'POINT_5') return [1, 2, 3, 4, 5];
  if (format === 'POINT_3') return [1, 2, 3];
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
}

function scoreText(v, format = scoreFormat()) {
  if (!v) return 'No score';
  if (format === 'POINT_5') return `${v} star${v === 1 ? '' : 's'}`;
  if (format === 'POINT_3') return ['', 'Disliked', 'Liked okay', 'Liked'][Math.round(v)] || String(v);
  if (format === 'POINT_100') return `${v}/100`;
  return `${v}/10`;
}

async function scoreEntry(mediaId, value) {
  const e = S.data && S.data.entries.get(mediaId);
  if (!e) return;
  const pending = updateEntry(mediaId, { score: value });
  refreshScore();
  const before = await pending;
  refreshScore();
  if (!before) return;
  toast(value ? `${e.title}: ${scoreText(e.score)}` : `Score removed from ${e.title}`, 'ok', undoEntry(mediaId, before), 0, e);
}

const refreshScore = () => { if (S.popover && S.popover.score) S.popover.score._update(); };

// One-click score picker: a button per step, plus an exact-value box for formats with more steps.
function scoreControl(mediaId) {
  const format = scoreFormat();
  const wrap = h('div', { class: `apq-score is-${format.toLowerCase().replace(/_/g, '-')}`, role: 'group', 'aria-label': 'Score' });
  const btns = scoreSteps(format).map((v) => {
    const content = format === 'POINT_5' ? icon('star') : format === 'POINT_3' ? icon(['', 'frown', 'meh', 'smile'][v]) : String(v);
    return h('button', {
      type: 'button', class: 'apq-score-btn', 'data-v': v, 'aria-label': scoreText(v, format),
      onclick: () => {
        const e = S.data && S.data.entries.get(mediaId);
        if (e) scoreEntry(mediaId, e.score === v ? 0 : v);
      },
    }, content);
  });
  wrap.append(h('div', { class: 'apq-score-btns' }, btns));
  let input = null;
  if (format === 'POINT_100' || format === 'POINT_10_DECIMAL') {
    const max = format === 'POINT_100' ? 100 : 10;
    input = h('input', {
      class: 'apq-score-input', type: 'number', min: '0', max: String(max), step: format === 'POINT_100' ? '1' : '0.1',
      'aria-label': `Exact score out of ${max}`, placeholder: '–',
    });
    const commit = () => {
      const e = S.data && S.data.entries.get(mediaId);
      if (!e) return;
      let v = parseFloat(input.value);
      v = Number.isNaN(v) ? 0 : clamp(v, 0, max);
      v = format === 'POINT_100' ? Math.round(v) : Math.round(v * 10) / 10;
      if (v !== (e.score || 0)) scoreEntry(mediaId, v);
    };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); commit(); input.blur(); } });
    input.addEventListener('change', commit);
    wrap.append(input);
  }
  wrap._update = () => {
    const e = S.data && S.data.entries.get(mediaId);
    const v = (e && e.score) || 0;
    const busy = S.busy.has(mediaId);
    for (const b of btns) {
      const bv = Number(b.dataset.v);
      // Stars fill up to the score; other formats light the nearest step at or below it.
      const on = format === 'POINT_5' ? bv <= v : format === 'POINT_3' ? bv === Math.round(v)
        : bv === (format === 'POINT_100' ? Math.floor(v / 10) * 10 : Math.floor(v));
      b.classList.toggle('is-active', !!v && on);
      b.disabled = busy;
    }
    if (input && document.activeElement !== input) input.value = v ? String(v) : '';
  };
  wrap._update();
  return wrap;
}

function entryChanged() {
  if (D.drawer && S.drawerOpen) renderDrawer();
  scheduleRefresh();
  if (S.pickOpen) updatePickActions();
}

function quickActionFor(e) {
  if (!e || !canEdit()) return null;
  const anime = isAnime();
  if (e.status === 'PLANNING') {
    return { icon: 'play', label: anime ? 'Start watching' : 'Start reading', run: () => startEntry(e.mediaId) };
  }
  if (e.status === 'PAUSED') {
    return { icon: 'play', label: anime ? 'Resume watching' : 'Resume reading', run: () => startEntry(e.mediaId) };
  }
  if (e.status === 'COMPLETED') {
    // Rewatching, back at episode 0 (history.js; 0.12.1, no more "Plan a rewatch").
    return { icon: 'repeat', label: anime ? 'Rewatch' : 'Reread', run: () => startRewatch(e.mediaId) };
  }
  if (e.status === 'CURRENT' || e.status === 'REPEATING') {
    const total = anime ? e.episodes : e.chapters;
    const n = (e.progress || 0) + 1;
    if (total && n > total) return null;
    if (anime && e.airing === 'RELEASING' && e.nextEp && n >= e.nextEp) return null; // not aired yet
    return { icon: 'plus', label: anime ? `Mark episode ${n} watched` : `Mark chapter ${n} read`, run: () => plusOne(e.mediaId) };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Editing many titles                                                 */
/* ------------------------------------------------------------------ */

const describeSet = (n) => (k) => (n ? `${plural(k)} set to priority ${n}` : `Priority removed from ${plural(k)}`);

// `relative` changes (raise or lower by 1) leave pinned titles alone.
async function bulkApply(fn, describe, relative = false) {
  const d = S.data;
  if (!d || !d.canEdit || !S.selected.size) return;
  if (barKey()) { bulkApplyCustom(barKey(), fn, describe, relative); return; }
  const changes = [];
  let pinned = 0;
  for (const id of S.selected) {
    const e = d.entries.get(id);
    if (!e) continue;
    if (relative && isPinned(e)) { pinned++; continue; }
    const to = clamp(Math.round(fn(e)) || 0, 0, MAX_PRIORITY);
    if (to !== e.priority) changes.push({ id, entryId: e.id, from: e.priority, to });
  }
  if (!changes.length) { toast(pinned ? 'Pinned titles keep their place. Unpin them first.' : 'Those titles already have that priority'); return; }
  if (await commitChanges(changes)) {
    toast(describe(changes.length), 'ok', {
      label: 'Undo',
      run: async () => {
        const back = changes.map((c) => ({ ...c, from: c.to, to: c.from }));
        if (await commitChanges(back)) toast(`Undone for ${plural(back.length)}`);
      },
    });
  }
}

async function commitChanges(changes) {
  const d = S.data;
  if (!d) return false;
  for (const c of changes) {
    const p = S.pending.get(c.id);
    if (p) { clearTimeout(p.timer); S.pending.delete(c.id); }
    S.confirmed.delete(c.id);
    const e = d.entries.get(c.id);
    if (e) e.priority = c.to;
    S.flash.add(c.id);
  }
  setStates(changes.map((c) => c.id), 'saving');
  scheduleResort();

  const groups = new Map();
  for (const c of changes) {
    if (!groups.has(c.to)) groups.set(c.to, []);
    groups.get(c.to).push(c);
  }
  const failed = [];
  for (const [to, list] of groups) {
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      try {
        await gqlSession(BULK_MUTATION, { ids: chunk.map((c) => c.entryId), priority: to });
        setStates(chunk.map((c) => c.id), 'saved');
      } catch {
        failed.push(...chunk);
      }
    }
  }
  if (failed.length) {
    for (const c of failed) {
      const e = d.entries.get(c.id);
      if (e) e.priority = c.from;
    }
    setStates(failed.map((c) => c.id), 'error');
    toast(`Couldn't save ${plural(failed.length)}. Make sure you're logged in to AniList.`, 'error');
    scheduleResort();
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Saving any fields, for many titles at once                          */
/* ------------------------------------------------------------------ */
// Mass edit, pins and custom lists all go through runOps. To stay well inside AniList's
// rate limit it packs the work into as few requests as it can:
//  - titles getting exactly the same change share one UpdateMediaListEntries (50 at a time);
//  - other changes, deletes and re-creates go 10 to a request, as named parts of one mutation.

const LIST_ENTRY_FIELDS = 'id mediaId status score progress progressVolumes repeat priority private notes hiddenFromStatusLists customLists startedAt { year month day } completedAt { year month day }';
const VAR_TYPES = {
  id: 'Int', mediaId: 'Int', status: 'MediaListStatus', score: 'Float', progress: 'Int', progressVolumes: 'Int',
  repeat: 'Int', priority: 'Int', private: 'Boolean', notes: 'String', hiddenFromStatusLists: 'Boolean',
  customLists: '[String]', startedAt: 'FuzzyDateInput', completedAt: 'FuzzyDateInput',
};
// Fields UpdateMediaListEntries can set (custom lists need one SaveMediaListEntry per title).
const BULK_KEYS = new Set(['status', 'score', 'progress', 'progressVolumes', 'repeat', 'priority', 'private', 'notes', 'hiddenFromStatusLists', 'startedAt', 'completedAt']);

const stableKey = (patch) => JSON.stringify(Object.keys(patch).sort().map((k) => [k, patch[k]]));

function bulkRequest(ids, patch) {
  const keys = Object.keys(patch);
  const defs = ['$ids: [Int]', ...keys.map((k) => `$${k}: ${VAR_TYPES[k]}`)].join(', ');
  const args = ['ids: $ids', ...keys.map((k) => `${k}: $${k}`)].join(', ');
  return { query: `mutation (${defs}) { UpdateMediaListEntries(${args}) { ${LIST_ENTRY_FIELDS} } }`, variables: { ids, ...patch } };
}

// argsList: one { id | mediaId, ...fields } per title. The answers come back as e0, e1, ...
function saveRequest(argsList) {
  const defs = [], parts = [], variables = {};
  argsList.forEach((args, i) => {
    const list = [];
    for (const [k, v] of Object.entries(args)) {
      if (!VAR_TYPES[k]) continue;
      defs.push(`$${k}${i}: ${VAR_TYPES[k]}`);
      list.push(`${k}: $${k}${i}`);
      variables[`${k}${i}`] = v;
    }
    parts.push(`e${i}: SaveMediaListEntry(${list.join(', ')}) { ${LIST_ENTRY_FIELDS} }`);
  });
  return { query: `mutation (${defs.join(', ')}) { ${parts.join(' ')} }`, variables };
}

function deleteRequest(entryIds) {
  const defs = entryIds.map((_, i) => `$id${i}: Int`).join(', ');
  const parts = entryIds.map((_, i) => `d${i}: DeleteMediaListEntry(id: $id${i}) { deleted }`).join(' ');
  const variables = {};
  entryIds.forEach((id, i) => { variables[`id${i}`] = id; });
  return { query: `mutation (${defs}) { ${parts} }`, variables };
}

// ops: { kind: 'save' | 'create' | 'delete', entryId, mediaId, patch }.
// Returns { results: Map(op -> what AniList saved, or { deleted: true }), failed: [ops] }.
async function runOps(ops, onProgress) {
  const results = new Map();
  const failed = [];
  const jobs = [];
  const groups = new Map();
  const singles = [];
  const dels = [];
  for (const op of ops) {
    if (op.kind === 'delete') dels.push(op);
    else if (op.kind === 'save' && Object.keys(op.patch).every((k) => BULK_KEYS.has(k))) {
      const k = stableKey(op.patch);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(op);
    } else singles.push(op);
  }
  for (const list of groups.values()) {
    if (list.length < 3) singles.push(...list);
    else for (let i = 0; i < list.length; i += 50) jobs.push({ type: 'bulk', ops: list.slice(i, i + 50) });
  }
  for (let i = 0; i < singles.length; i += 10) jobs.push({ type: 'save', ops: singles.slice(i, i + 10) });
  for (let i = 0; i < dels.length; i += 10) jobs.push({ type: 'delete', ops: dels.slice(i, i + 10) });

  let done = 0;
  let total = jobs.length;
  const runJob = async (job) => {
    try {
      if (job.type === 'bulk') {
        const { query, variables } = bulkRequest(job.ops.map((o) => o.entryId), job.ops[0].patch);
        const res = await gqlSession(query, variables);
        const byId = new Map(((res && res.UpdateMediaListEntries) || []).filter(Boolean).map((x) => [x.id, x]));
        for (const o of job.ops) { const saved = byId.get(o.entryId); if (saved) results.set(o, saved); else failed.push(o); }
      } else if (job.type === 'save') {
        const { query, variables } = saveRequest(job.ops.map((o) => (o.kind === 'create' ? { mediaId: o.mediaId, ...o.patch } : { id: o.entryId, ...o.patch })));
        const res = (await gqlSession(query, variables)) || {};
        job.ops.forEach((o, i) => { const saved = res[`e${i}`]; if (saved) results.set(o, saved); else failed.push(o); });
      } else {
        const { query, variables } = deleteRequest(job.ops.map((o) => o.entryId));
        const res = (await gqlSession(query, variables)) || {};
        job.ops.forEach((o, i) => { if (res[`d${i}`] && res[`d${i}`].deleted !== false) results.set(o, { deleted: true }); else failed.push(o); });
      }
    } catch (err) {
      const st = err.status || 0;
      if (job.ops.length > 1 && st >= 400 && st !== 401 && st !== 429) {
        // One bad title fails the whole request: try the halves, to save the rest.
        const half = Math.ceil(job.ops.length / 2);
        total += 1;
        await runJob({ type: job.type === 'bulk' ? 'save' : job.type, ops: job.ops.slice(0, half) });
        await runJob({ type: job.type === 'bulk' ? 'save' : job.type, ops: job.ops.slice(half) });
        return;
      }
      // A title that's already gone counts as deleted.
      if (job.type === 'delete' && st === 404) { for (const o of job.ops) results.set(o, { deleted: true }); return; }
      failed.push(...job.ops);
    }
    done++;
    if (onProgress) onProgress(done, total);
  };
  if (onProgress) onProgress(0, total);
  for (const job of jobs) await runJob(job); // one at a time, gentle on AniList
  return { results, failed };
}

// Copies what AniList saved into our copy of the entry.
function applySaved(e, s) {
  if (!e || !s) return;
  if (typeof s.id === 'number') e.id = s.id;
  if (s.status) e.status = s.status;
  for (const k of ['score', 'progress', 'progressVolumes', 'repeat', 'priority']) if (typeof s[k] === 'number') e[k] = s[k];
  if (typeof s.private === 'boolean') e.private = s.private;
  if ('notes' in s) e.notes = s.notes || '';
  if ('hiddenFromStatusLists' in s && s.hiddenFromStatusLists != null) e.hidden = !!s.hiddenFromStatusLists;
  if ('customLists' in s && s.customLists != null) e.customLists = parseCustomLists(s.customLists);
  if ('startedAt' in s) e.startedAt = fuzzy(s.startedAt);
  if ('completedAt' in s) e.completedAt = fuzzy(s.completedAt);
}

// Saves a few fields on one title. True if AniList took them.
async function saveFields(e, patch) {
  if (!e || S.busy.has(e.mediaId)) return false;
  S.busy.add(e.mediaId);
  scheduleRefresh();
  try {
    const { results } = await runOps([{ kind: 'save', entryId: e.id, mediaId: e.mediaId, patch }]);
    const saved = results.values().next().value;
    if (!saved) throw new Error('not saved');
    applySaved(e, saved);
    return true;
  } catch {
    toast(`Couldn't update ${e.title}. Make sure you're logged in to AniList.`, 'error');
    return false;
  } finally {
    S.busy.delete(e.mediaId);
    entryChanged();
  }
}
