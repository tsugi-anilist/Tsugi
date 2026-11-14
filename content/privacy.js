// Tsugi · NSFW titles on AniList's pages (0.12.3). What counts is your choice (nsfw.js, set in the toolbar popup's
// Settings, NSFW titles): the NSFW filter in AniList's sidebar, Hide NSFW titles, the hub and Pick for me follow it
// (nsfwOf). With "Keep new ones private", a title you add becomes private by itself: Tsugi's own adds are private
// from the start (titleSave in lists.js asks keepNewFor), AniList's own Add to List and editor are followed by a save
// (privacyAfterSite, from history.js onSiteSave), and titles added elsewhere (AniList's phone app, another computer)
// when your list loads (privacySweep, from ensureData).
'use strict';

const NS = { set: nsfwNormalize({}), marks: {}, ver: 1 };
// A title AniList's own buttons added, read back to see whether it's new and what it is.
const NSFW_NEW_QUERY = 'query TsugiNsfwNew($id: Int) { MediaList(id: $id) { id mediaId private createdAt media { id type isAdult genres tags { id rank } title { userPreferred } } } }';
const NSFW_NEW_MS = 10 * 60e3;   // AniList's own save counts as an add when the entry is younger than this

async function loadNsfw() {
  NS.set = nsfwNormalize(await store.get('sync', 'nsfw'));
  NS.marks = await nsfwReadMarks();
  NS.ver++;
}

// Your choices or marks changed (the popup's Settings, or another tab): the lists follow at once. A choice that now
// counts tags needs the titles' tags, so the list is read again with them.
function onNsfwStorage() {
  loadNsfw().then(() => {
    const type = S.route && S.route.type;
    if (!type) return;
    if (S.data && S.data.viewFields && !S.data.tagged && nsfwUsesTags(NS.set, type)) { ensureData(true); return; }
    filtersChanged();
    renderAll();
  }).catch(() => {});
}

// Whether a title of this page's list counts as NSFW (worked out once per change of your choices).
function nsfwOf(e, kind = (S.route && S.route.type) || 'ANIME') {
  if (!e) return false;
  if (e._nv !== NS.ver || e._nk !== kind) {
    e._nv = NS.ver;
    e._nk = kind;
    e._nw = nsfwWhy(e.nf || { a: !!e.adult, g: null, t: null }, NS.set, kind, NS.marks[e.mediaId]);
  }
  return !!e._nw;
}
function dataHasNsfw() {
  const d = S.data;
  if (!d) return false;
  if (d._nsv !== NS.ver) { d._nsv = NS.ver; d._ns = [...d.entries.values()].some((e) => nsfwOf(e)); }
  return d._ns;
}

const nsfwFetchMedia = (id) => gqlRead(NSFW_MEDIA_QUERY, { id }).then((d) => (d && d.Media) || null);

// Tsugi adding a title (Add to Planning in Ctrl+K, a custom list on a title's page, the List check's prequel): the
// kind when it should be private from the start, so nothing of it shows to others even for a moment.
function keepNewFor(args) {
  if (!args || !args.mediaId || args.id || args.private !== undefined || !nsfwKeeps(NS.set)) return Promise.resolve(null);
  return nsfwAddPrivate({ set: NS.set, marks: NS.marks, mediaId: args.mediaId, fetch: nsfwFetchMedia });
}
// The end of a toast about an add: what happened to its visibility.
const keptPrivate = (saved) => (saved && saved.private ? ', private' : '');

// list: [{ entryId, mediaId, kind, title }]. Made private with one save (three or more: one request), with Undo.
async function makePrivate(list) {
  const ops = list.map((x) => ({ kind: 'save', entryId: x.entryId, mediaId: x.mediaId, patch: { private: true } }));
  let results;
  try { ({ results } = await runOps(ops)); } catch { return; }
  const ok = [];
  ops.forEach((o, i) => {
    const s = results.get(o);
    if (!s || !s.private) return;
    ok.push(list[i]);
    const e = S.data && S.data.entries.get(o.mediaId);
    if (e && e.id === o.entryId) applySaved(e, s);
  });
  if (!ok.length) return;
  await nsfwNoteMade(ok.map((x) => ({ id: x.mediaId, k: x.kind })));
  entryChanged();
  const msg = ok.length === 1 ? `${ok[0].title} is private now: it counts as NSFW` : `Made ${ok.length} NSFW titles private`;
  toast(msg, 'ok', {
    label: 'Undo',
    run: async () => {
      const back = ok.map((x) => ({ kind: 'save', entryId: x.entryId, mediaId: x.mediaId, patch: { private: false } }));
      try {
        const r = await runOps(back);
        back.forEach((o) => { const s = r.results.get(o); const e = S.data && S.data.entries.get(o.mediaId); if (s && e && e.id === o.entryId) applySaved(e, s); });
        // Noted as made public by you: Keep new ones private leaves them alone from now on.
        await nsfwNoteMade(ok.map((x) => ({ id: x.mediaId, k: x.kind })), { pub: true });
        entryChanged();
        toast(ok.length === 1 ? `${ok[0].title} is public again` : 'Undone');
      } catch { toast('Couldn\'t undo that. Make sure you\'re logged in to AniList.', 'error'); }
    },
  }, 0, ok.length === 1 && S.data ? S.data.entries.get(ok[0].mediaId) : undefined);
}

// AniList's own Add to List, its editor or its + buttons saved a title (bridge.js reports it): one that was just added
// and counts as NSFW becomes private, when you asked for that. The save itself is AniList's, so it was public for a
// moment; Tsugi's own adds never are.
async function privacyAfterSite(saved, vars) {
  if (!nsfwKeeps(NS.set) || !vars || !vars.mediaId || vars.id) return;
  for (const s of saved) {
    if (!s || !s.id || s.private === true) continue;
    let cur;
    try { cur = ((await gqlRead(NSFW_NEW_QUERY, { id: s.id })) || {}).MediaList; } catch { continue; }
    if (!cur || cur.private || !cur.media) continue;
    const kind = cur.media.type === 'MANGA' ? 'MANGA' : 'ANIME';
    const since = NS.set.keep[kind];
    if (!since || !cur.createdAt || cur.createdAt * 1000 < Math.max(since, Date.now() - NSFW_NEW_MS)) continue;
    if ((await nsfwReadMade())[cur.mediaId]) continue;
    if (!nsfwWhy(nsfwFacts(cur.media), NS.set, kind, NS.marks[cur.mediaId])) continue;
    await makePrivate([{ entryId: cur.id, mediaId: cur.mediaId, kind, title: (cur.media.title && cur.media.title.userPreferred) || 'This title' }]);
  }
}

// Titles added since you switched on Keep new ones private, anywhere (AniList's phone app, another computer): looked at
// once each, when your own list loads. local "nsfw:cur" = { kind: the newest added (AniList's seconds) already seen }.
// A title Tsugi made private once (or that you made public again) is left alone.
async function privacySweep() {
  const d = S.data;
  const r = S.route;
  if (!d || !r || !d.canEdit || !d.viewFields) return;
  const kind = r.type;
  const since = NS.set.keep[kind];
  if (!since || (nsfwUsesTags(NS.set, kind) && !d.tagged)) return;
  const curs = objectOr(await store.get('local', 'nsfw:cur'));
  const from = Math.max(Math.floor(since / 1000), Number(curs[kind]) || 0);
  let top = from;
  const made = await nsfwReadMade();
  const want = [];
  for (const e of d.entries.values()) {
    if (!e.createdAt || e.createdAt <= from) continue;
    top = Math.max(top, e.createdAt);
    if (!e.private && !made[e.mediaId] && nsfwOf(e, kind)) want.push(e);
  }
  if (top > from) await store.set('local', 'nsfw:cur', { ...curs, [kind]: top });
  if (want.length && S.data === d) await makePrivate(want.map((e) => ({ entryId: e.id, mediaId: e.mediaId, kind, title: e.title })));
}
