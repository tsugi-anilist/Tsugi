// Tsugi · Profiles (0.12.7): how many people a profile follows, follows it and both, on its Social tab; and when
// a profile doesn't open, why: private, no such name, or they blocked you.
'use strict';

/* ------------------------------------------------------------------ */
/* Follower counts on a profile's Social tab                           */
/* ------------------------------------------------------------------ */
// AniList's Social tab (`/user/<name>/social`) has a "Social" group in its left column: Following, Followers,
// Mutual Followers, then Forum Threads and Comments (read from its bundle on 2026-11-13: `.user-social .filters
// .filter-group > span`). Each of the first three gets its count, "Following (7)", from one request of three
// one-title pages (`Page(perPage: 1) { pageInfo { total } following(userId) }`, checked on the real API). Counts
// are kept 5 minutes per profile while the tab is open.

const SOCIAL_RE = /^\/user\/([^/]+)\/social\/?$/;
const USER_PATH_RE = /^\/user\/([^/]+)(?:\/|$)/;
const SOC_ID_QUERY = 'query TsugiUserId($name: String) { User(name: $name) { id name } }';
const SOC_COUNTS_QUERY = `query TsugiSocialCounts($id: Int!) {
  following: Page(perPage: 1) { pageInfo { total } following(userId: $id) { id } }
  followers: Page(perPage: 1) { pageInfo { total } followers(userId: $id) { id } }
  mutuals: Page(perPage: 1) { pageInfo { total } mutualFollowers(userId: $id) { id } }
}`;
const SOC_TTL = 5 * 60 * 1000;
// AniList's words for the three, and where each count comes from.
const SOC_PARTS = [['following', /^following$/i], ['followers', /^followers$/i], ['mutuals', /^mutual followers$/i]];

const SOC = {
  route: null,      // { social: name } on a Social tab, { missing: name } on a profile AniList couldn't show
  counts: new Map(), // lower-case name -> { at, n: { following, followers, mutuals } | null, p: Promise }
  checks: new Map(), // lower-case name -> { k, user } | Promise (the 404 check)
  box: null,
};

function onSocialRoute(path, before) {
  const soc = SOCIAL_RE.exec(path);
  let missing = null;
  // AniList replaces a profile it can't show with /404 (its router's NotFound); a profile's address can also show
  // its 404 page as it is.
  if (path === '/404' || path === '/404/') { const m = before && USER_PATH_RE.exec(before); if (m) missing = m[1]; }
  else { const m = USER_PATH_RE.exec(path); if (m) missing = m[1]; }
  const name = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  SOC.route = soc ? { social: name(soc[1]), missing: name(soc[1]) } : missing ? { missing: name(missing) } : null;
  if (SOC.box && (!SOC.route || SOC.box.dataset.apqFor !== (SOC.route.missing || '').toLowerCase())) { SOC.box.remove(); SOC.box = null; }
  if (!SOC.route) { clearSocialCounts(); return; }
  decorateSocial();
}

function decorateSocial() {
  if (!SOC.route) return;
  if (SOC.route.social) placeSocialCounts(SOC.route.social);
  if (SOC.route.missing) placeMissing(SOC.route.missing);
}

function clearSocialCounts() {
  for (const el of document.querySelectorAll('.apq-soc-n')) el.remove();
}

function socialSpans() {
  const group = document.querySelector('.user-social .filters .filter-group');
  if (!group) return [];
  const out = [];
  for (const span of group.querySelectorAll(':scope > span')) {
    const label = Array.from(span.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
    const part = SOC_PARTS.find(([, re]) => re.test(label));
    if (part) out.push([part[0], span]);
  }
  return out;
}

async function socialCounts(name) {
  const key = name.toLowerCase();
  const kept = SOC.counts.get(key);
  if (kept && (kept.p || Date.now() - kept.at < SOC_TTL)) return kept.p || kept.n;
  const p = (async () => {
    let n = null;
    try {
      const u = await gqlRead(SOC_ID_QUERY, { name }, 'low');
      const id = u && u.User && u.User.id;
      if (id) {
        const d = await gqlRead(SOC_COUNTS_QUERY, { id }, 'low');
        const total = (k) => { const x = d && d[k] && d[k].pageInfo && d[k].pageInfo.total; return Number.isFinite(x) ? x : null; };
        n = { following: total('following'), followers: total('followers'), mutuals: total('mutuals') };
      }
    } catch { /* no counts: AniList's labels stay as they are */ }
    SOC.counts.set(key, { at: Date.now(), n });
    return n;
  })();
  SOC.counts.set(key, { at: 0, n: null, p });
  return p;
}

function placeSocialCounts(name) {
  if (S.settings.socialCounts === false) { clearSocialCounts(); return; }
  const spans = socialSpans();
  if (!spans.length) return;
  const kept = SOC.counts.get(name.toLowerCase());
  const asking = !!(kept && kept.p);
  if (!asking && !(kept && Date.now() - kept.at < SOC_TTL)) {
    socialCounts(name).then(() => { if (SOC.route && SOC.route.social === name) placeSocialCounts(name); });
  }
  const n = kept && kept.n;
  if (!n) return;
  for (const [k, span] of spans) {
    const v = n[k];
    let el = span.querySelector(':scope > .apq-soc-n');
    if (v == null) { if (el) el.remove(); continue; }
    const text = `(${v.toLocaleString('en-GB')})`;
    if (!el) { el = h('span', { class: 'apq-ui apq-soc-n' }); span.append(el); }
    if (el.textContent !== text) el.textContent = text;
    if (el !== span.lastElementChild) span.append(el);
  }
}

/* ------------------------------------------------------------------ */
/* A profile that doesn't open: why                                    */
/* ------------------------------------------------------------------ */
// AniList shows the same 404 page for a name nobody has, a private profile (Settings > Account > Privacy:
// "Nobody except me can view my profile") and someone who blocked you. Asked once per name:
//  - the public API, logged out (`graphql.anilist.co`, no cookie): found = the profile exists for everyone, so
//    hidden from you while you're logged in = they blocked you (checked once more with your login);
//  - not found: AniList's user search, logged out: the exact name there = it exists but is hidden: private;
//  - neither: no one is called that (they may have changed their name, or deleted their account).
// A profile you blocked still opens for you (with Unblock in its menu), so it isn't one of these.
const NF_USER_QUERY = 'query TsugiUserCheck($name: String) { User(name: $name) { id name avatar { medium } } }';
const NF_SEARCH_QUERY = 'query TsugiUserSearch($name: String) { Page(perPage: 15) { users(search: $name) { id name avatar { medium } } } }';

const nfLoggedIn = () => loggedIn() || !!csrfToken();
const nfUser = (u) => (u ? { name: String(u.name || ''), avatar: (u.avatar && u.avatar.medium) || null } : null);

async function nfCheck(name) {
  let pub = null;
  let err = null;
  try { const d = await post('https://graphql.anilist.co', false, NF_USER_QUERY, { name }); pub = d && d.User; }
  catch (e) { err = e; }
  if (pub) {
    if (!nfLoggedIn()) return { k: 'there', user: nfUser(pub) };
    try {
      const d = await gqlSession(NF_USER_QUERY, { name });
      return { k: d && d.User ? 'there' : 'blocked', user: nfUser(pub) };
    } catch (e) {
      return e.status === 404 ? { k: 'blocked', user: nfUser(pub) } : null;
    }
  }
  if (err && err.status !== 404) return /private/i.test(err.message || '') ? { k: 'private', user: { name, avatar: null } } : null;
  let hit = null;
  try {
    const d = await post('https://graphql.anilist.co', false, NF_SEARCH_QUERY, { name });
    const list = (d && d.Page && d.Page.users) || [];
    hit = list.find((u) => u && String(u.name || '').toLowerCase() === name.toLowerCase()) || null;
  } catch { /* the search didn't answer: say what's sure */ }
  return hit ? { k: 'private', user: nfUser(hit) } : { k: 'none', user: { name, avatar: null } };
}

function nfResult(name) {
  const key = name.toLowerCase();
  const kept = SOC.checks.get(key);
  if (kept && !(kept instanceof Promise)) return kept;
  if (!kept) {
    const p = nfCheck(name).catch(() => null).then((r) => {
      SOC.checks.set(key, r || { k: 'unknown' });
      if (SOC.route && SOC.route.missing && SOC.route.missing.toLowerCase() === key) placeMissing(name);
      return r;
    });
    SOC.checks.set(key, p);
  }
  return null;
}

const NF_TEXT = {
  blocked: (n) => [`${n} has blocked you`, 'Their profile, lists and activity are hidden from you while you\'re logged in. Logged out, AniList still shows them.'],
  private: (n) => [`${n}'s profile is private`, 'Only they can see their profile, lists and activity.'],
  none: (n) => [`No one on AniList is called ${n}`, 'They may have changed their name or deleted their account.'],
  there: (n) => [`${n}'s profile is there`, 'AniList couldn\'t show it a moment ago.'],
};

function placeMissing(name) {
  const page = Array.from(document.querySelectorAll('.not-found')).find((el) => !el.closest('.apq-ui'));
  if (!page || S.settings.check404 === false) { if (SOC.box) { SOC.box.remove(); SOC.box = null; } return; }
  const r = nfResult(name);
  const key = name.toLowerCase();
  if (!r || r.k === 'unknown' || !NF_TEXT[r.k]) return;
  if (!SOC.box || SOC.box.dataset.apqFor !== key || SOC.box.dataset.apqK !== r.k) {
    const shown = (r.user && r.user.name) || name;
    const [title, text] = NF_TEXT[r.k](shown);
    const pic = r.user && r.user.avatar && /^https:\/\//.test(r.user.avatar)
      ? h('img', { class: 'apq-nf-av', src: r.user.avatar, alt: '', referrerpolicy: 'no-referrer' })
      : h('span', { class: 'apq-nf-av is-icon' }, icon(r.k === 'none' ? 'search' : r.k === 'there' ? 'refresh' : 'xCircle'));
    const box = h('div', { class: 'apq-ui apq-nf', role: 'status', 'data-k': r.k }, pic,
      h('div', { class: 'apq-nf-text' }, h('div', { class: 'apq-nf-title' }, title), h('div', { class: 'apq-nf-desc' }, text),
        r.k === 'there' ? h('a', { class: 'apq-nf-link', href: `/user/${encodeURIComponent(shown)}/` }, 'Open it again') : null));
    box.dataset.apqFor = key;
    box.dataset.apqK = r.k;
    if (SOC.box) SOC.box.remove();
    SOC.box = box;
  }
  if (SOC.box.parentElement !== page || page.firstElementChild !== SOC.box) page.prepend(SOC.box);
}
