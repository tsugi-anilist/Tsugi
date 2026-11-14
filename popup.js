// Tsugi: the toolbar popup, a small app for "what's next" (DESIGN.md, "The toolbar popup").
// A fixed 560 × 600 window (its width a preset since 0.12.6; or its own window, a tab, the side panel): a rail on the left (your account, Now, Up Next, Today, Search, Notifications),
// and one view at a time on the right. Each view is a function in VIEWS (Search, 0.6.9, is one
// too). Clicking a poster opens that title's page over the section (state.stack, 0.6.8; reworked in 0.6.8.1): the title first, your entry in two lines with its details folded, then one
// scroll of sections that each say something about you (watch order, characters, staff, more like
// this, where to watch, your history, details). The first time, it walks you through connecting
// your AniList account instead.
'use strict';

const app = document.getElementById('app');
// Where this page is (0.12.6): the toolbar popup (popup.html), its own window (?view=win), a browser tab
// (?view=tab: also the setup page and the trackers' Compare page) or the browser's side panel (?view=panel).
// Anything but the toolbar popup fills the space it's given.
const VIEW_PARAM = new URLSearchParams(location.search).get('view');
const MODE = { tab: 'tab', win: 'window', panel: 'panel' }[VIEW_PARAM] || 'popup';
const IS_TAB = MODE === 'tab';
const IS_POPUP = MODE === 'popup';
document.body.classList.add(IS_POPUP ? 'is-popup' : 'is-full');
if (IS_TAB) document.body.classList.add('is-tab');
// The toolbar popup's width (Settings, Popup, Size): kept in this page's own storage too, so the popup opens at
// its size at once (applyPopupSize confirms it once the settings arrive).
const SIZE_HINT = 'tsugi:size';
const POPUP_SIZES = { s: 480, m: 560, l: 680, xl: 800 };
(() => {
  let z = null;
  try { z = localStorage.getItem(SIZE_HINT); } catch { /* storage blocked */ }
  if (IS_POPUP && POPUP_SIZES[z] && z !== 'm') document.documentElement.dataset.size = z;
})();

// The theme (Settings, Look) before anything is drawn: the one used last time, kept in this page's own
// storage because the settings arrive a moment later (applyTheme then confirms it).
const THEME_HINT = 'tsugi:theme';
const systemDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
// AniList's three, or one of the palettes (0.12, palettes.js). data-tone says whether it's a dark one.
const LOOKS = ['light', 'dark', 'contrast'];
const isLook = (t) => LOOKS.includes(t) || !!paletteOf(t);
const toneOf = (t) => (paletteOf(t) ? paletteOf(t).tone : t === 'dark' ? 'dark' : 'light');
// Every palette's tokens as CSS, once, before the first drawing: <html data-theme="mocha"> then just works,
// and so do the tiny windows in Settings (.th-win[data-look="mocha"]).
(() => {
  const css = PALETTE_ORDER.map((id) => {
    const p = PALETTES[id];
    const t = paletteTokens(p);
    const dark = p.tone === 'dark';
    return `:root[data-theme="${id}"]{ --surface: ${t.surface}; --sunken: ${t.sunken}; --rail: ${t.rail}; --raised: ${t.raised};`
      + ` --ink: ${t.ink}; --on-ink: ${t.onInk}; --text: ${t.text}; --muted: ${t.muted}; --line: ${t.line};`
      + ` --good: ${t.good}; --bad: ${t.bad}; --on-bad: ${t.onBad}; --warn: ${t.warn}; --hover: rgba(var(--ink),${dark ? '.07' : '.06'});`
      + (dark ? ' --shadow: 0 20px 50px -14px rgba(0,0,0,.66), 0 3px 10px -3px rgba(0,0,0,.42);' : '')
      + ` color-scheme: ${p.tone}; }\n`
      + `.th-win[data-look="${id}"]{ --w-page: ${t.surface}; --w-rail: ${t.rail}; --w-ink: ${t.ink}; --w-line: ${t.line};`
      + (p.acc ? ['blue', 'orange', 'purple', 'green', 'pink', 'red'].map((k, i) => ` --w-p${i + 1}: ${paletteHex(p.acc[k])};`).join('') : '')
      + ' }';
  }).join('\n');
  const st = document.createElement('style');
  st.id = 'palettes';
  st.textContent = css;
  document.head.append(st);
  let t = null;
  try { t = localStorage.getItem(THEME_HINT); } catch { /* storage blocked */ }
  if (!isLook(t)) t = systemDark() ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.tone = toneOf(t);
})();

const VERSION = chrome.runtime.getManifest().version;
const PIN_URL = 'https://anilist.co/api/v2/oauth/pin';
const DEV_URL = 'https://anilist.co/settings/developer';
const APP_NAME = 'Tsugi';
const CLIENT_NAME = 'Tsugi for AniList';   // what to type on AniList's developer page
// Lists older than this reload when you open the popup or a section (the cached ones show meanwhile).
const STALE_MS = 20 * 1000;
const UPNEXT_MAX = 48;   // Planning titles shown in Up Next; the rest are on AniList

const PROFILE_COLORS = {
  blue: '61,180,242', purple: '192,99,255', pink: '252,157,214', orange: '239,136,26',
  red: '225,51,51', green: '76,202,81', gray: '103,123,148',
};

const COVER = 'coverImage { large medium color }';
const LIST_ENTRY = `id mediaId status progress score repeat priority updatedAt createdAt
        startedAt { year month day } completedAt { year month day }
        media {
          id siteUrl format status episodes chapters duration seasonYear
          startDate { year month day }
          nextAiringEpisode { episode airingAt }
          title { userPreferred romaji english native }
          ${COVER}
        }`;
const LIST_QUERY = `query ($userId: Int, $type: MediaType) {
  MediaListCollection(userId: $userId, type: $type, status_in: [CURRENT, REPEATING], sort: [UPDATED_TIME_DESC]) {
    user { mediaListOptions { scoreFormat } }
    lists {
      entries { ${LIST_ENTRY} }
    }
  }
}`;
// Every list of one kind (0.8.2: Now's list menu): all the statuses and your custom lists, in one request,
// asked for when you pick a list other than Watching (or Reading), and kept like the others.
const FULL_QUERY = `query ($userId: Int, $type: MediaType) {
  MediaListCollection(userId: $userId, type: $type, sort: [UPDATED_TIME_DESC]) {
    user { mediaListOptions { scoreFormat } }
    lists { name status isCustomList entries { ${LIST_ENTRY} } }
  }
}`;
// Every save asks for the whole entry back. The mutation names only the fields being changed.
const ENTRY_FIELDS = 'id mediaId status progress score repeat priority private notes hiddenFromStatusLists customLists startedAt { year month day } completedAt { year month day } updatedAt';
const VAR_TYPES = {
  id: 'Int', mediaId: 'Int', status: 'MediaListStatus', progress: 'Int', score: 'Float', repeat: 'Int', priority: 'Int',
  private: 'Boolean', notes: 'String', customLists: '[String]', hiddenFromStatusLists: 'Boolean', startedAt: 'FuzzyDateInput', completedAt: 'FuzzyDateInput',
};
const saveMutation = (keys) => `mutation (${keys.map((k) => `$${k}: ${VAR_TYPES[k]}`).join(', ')}) {
  SaveMediaListEntry(${keys.map((k) => `${k}: $${k}`).join(', ')}) { ${ENTRY_FIELDS} }
}`;
// The fields of an entry the popup can change (and put back with Undo).
const FIELD_KEYS = ['status', 'progress', 'score', 'repeat', 'priority', 'private', 'notes', 'customLists', 'hiddenFromStatusLists', 'startedAt', 'completedAt'];
// Priorities 95 to 99 are pins (see content/lists.js); the top pin is 99, 5 pins per list.
const PIN_MIN = 95;
const PIN_TOP = 99;
const PIN_LIMIT = 5;
const MAX_PRIORITY = 94;
const LABELS = {
  ANIME: { CURRENT: 'Watching', PLANNING: 'Planning', COMPLETED: 'Completed', REPEATING: 'Rewatching', PAUSED: 'Paused', DROPPED: 'Dropped' },
  MANGA: { CURRENT: 'Reading', PLANNING: 'Planning', COMPLETED: 'Completed', REPEATING: 'Rereading', PAUSED: 'Paused', DROPPED: 'Dropped' },
};
const STATUS_ORDER = ['CURRENT', 'PLANNING', 'COMPLETED', 'REPEATING', 'PAUSED', 'DROPPED'];
const statusWord = (type, s) => (LABELS[type] || LABELS.ANIME)[s] || s;

// A title page, in one request: the title, its relations, the first characters (with their Japanese
// voice actors), staff and recommendations, its streaming links, and your entry with every field.
const PERSON = 'id name { userPreferred } image { large medium } siteUrl';
const NODE = `id type format status episodes chapters seasonYear siteUrl
          startDate { year month day }
          title { userPreferred }
          coverImage { large medium color }
          mediaListEntry { id status progress }`;
const CHARACTERS = (n) => `characters(sort: [ROLE, RELEVANCE, ID], perPage: ${n}) {
      edges { id role node { ${PERSON} } voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) { ${PERSON} } }
    }`;
const titleQuery = (rich) => `query TsugiTitle($id: Int) {
  Media(id: $id) {
    id idMal type format status episodes chapters volumes duration season seasonYear source(version: 3) isAdult
    siteUrl isFavourite isFavouriteBlocked averageScore popularity favourites bannerImage
    startDate { year month day } endDate { year month day }
    title { userPreferred romaji english native }
    coverImage { large medium color }
    description(asHtml: false)
    genres
    tags { id name rank isMediaSpoiler isGeneralSpoiler }
    rankings { id rank type year season allTime context }
    studios { edges { isMain node { id name siteUrl } } }
    nextAiringEpisode { episode airingAt }
    relations { edges { relationType(version: 2) node { ${NODE} } } }${rich ? `
    externalLinks { id site url type language color icon isDisabled }
    ${CHARACTERS(8)}
    staff(sort: [RELEVANCE, ID], perPage: 25) { edges { id role node { ${PERSON} } } }
    recommendations(sort: [RATING_DESC, ID], perPage: 16) { nodes { id rating mediaRecommendation { ${NODE} } } }
    ${REVIEWS(1)}` : ''}
    mediaListEntry { ${ENTRY_FIELDS} }
  }${rich ? `
  friends: Page(perPage: 25) {
    mediaList(mediaId: $id, isFollowing: true, sort: [UPDATED_TIME_DESC]) { id status progress score(format: POINT_100) user { id name siteUrl avatar { medium } } }
  }` : ''}
  Viewer { id mediaListOptions { scoreFormat animeList { customLists } mangaList { customLists } } }
}`;
// Reviews (0.8): AniList's own, the most helpful first, REVIEWS_PER at a time ("Show more" asks for the
// next page). A review's text is asked for when you unfold it.
const REVIEWS_PER = 3;
const REVIEWS = (page) => `reviews(sort: RATING_DESC, page: ${page}, perPage: ${REVIEWS_PER}) {
      pageInfo { total hasNextPage }
      nodes { id summary score rating ratingAmount createdAt user { id name avatar { medium } } }
    }`;
const reviewsQuery = (page) => `query TsugiReviews($id: Int) { Media(id: $id) { id ${REVIEWS(page)} } }`;
const REVIEW_QUERY = 'query TsugiReview($id: Int) { Review(id: $id) { id body(asHtml: true) } }';
// "See all" on Characters: the rest of them (25), asked for when you unfold the section.
const CAST_QUERY = `query TsugiCast($id: Int) { Media(id: $id) { id ${CHARACTERS(25)} } }`;
// If AniList ever refuses one of the newer fields (a 400), title pages fall back to 0.6.8's request.
let richTitles = true;
// Your other titles a voice actor is in, and a staff member's other works on your list: one more
// request, low priority, once the page shows (only for the people the page shows; the ones "See all"
// adds come in another). A part is left out when it has nobody to ask about: AniList reads an empty
// id_in as "anyone".
const PEOPLE_NODE = 'node { id type siteUrl title { userPreferred } coverImage { medium color } mediaListEntry { id status score } }';
const peopleQuery = (va, st) => `query TsugiPeople(${[va ? '$va: [Int]' : '', st ? '$st: [Int]' : ''].filter(Boolean).join(', ')}) {${va ? `
  va: Page(perPage: ${va}) { staff(id_in: $va) { id characterMedia(onList: true, perPage: 8, sort: [POPULARITY_DESC]) { pageInfo { total } edges { ${PEOPLE_NODE} } } } }` : ''}${st ? `
  st: Page(perPage: ${st}) { staff(id_in: $st) { id staffMedia(onList: true, perPage: 8, sort: [POPULARITY_DESC]) { pageInfo { total } edges { ${PEOPLE_NODE} } } } }` : ''}
}`;
// Your activity for one title (the rewatch log; the same request and cache as content/history.js).
const ACTIVITY_QUERY = `query ($userId: Int, $mediaId: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    activities(userId: $userId, mediaId: $mediaId, type: MEDIA_LIST, sort: ID) {
      ... on ListActivity { id status progress createdAt }
    }
  }
}`;
// The pins of one status list (the highest priorities), for "Pin" and "#2 in Up Next".
const PINS_QUERY = `query TsugiPins($userId: Int, $type: MediaType, $status: MediaListStatus) {
  Page(perPage: 6) { mediaList(userId: $userId, type: $type, status: $status, sort: [PRIORITY_DESC]) { id mediaId priority } }
}`;
const DELETE_MUTATION = 'mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }';
const favMutation = (type) => (type === 'MANGA'
  ? 'mutation TsugiFavourite($id: Int) { ToggleFavourite(mangaId: $id) { manga { pageInfo { total } } } }'
  : 'mutation TsugiFavourite($id: Int) { ToggleFavourite(animeId: $id) { anime { pageInfo { total } } } }');
// Planning, anime and manga in one request, for Up Next.
const UPNEXT_QUERY = `query ($userId: Int) {
  anime: MediaListCollection(userId: $userId, type: ANIME, status: PLANNING) { lists { entries { ...E } } }
  manga: MediaListCollection(userId: $userId, type: MANGA, status: PLANNING) { lists { entries { ...E } } }
}
fragment E on MediaList {
  id mediaId status priority progress score repeat updatedAt
  startedAt { year month day } completedAt { year month day }
  media {
    id type siteUrl format status episodes chapters
    nextAiringEpisode { episode airingAt }
    title { userPreferred }
    ${COVER}
  }
}`;
const TODAY_QUERY = `query ($ids: [Int], $from: Int, $to: Int) {
  Page(perPage: 50) {
    airingSchedules(mediaId_in: $ids, airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      id episode airingAt mediaId
      media { id siteUrl episodes title { userPreferred } coverImage { medium color } }
    }
  }
}`;
const WHO = 'user { name avatar { medium } }';
const MEDIA = 'media { siteUrl title { userPreferred } coverImage { medium } }';
const NOTIF_QUERY = `query {
  Page(perPage: 30) {
    notifications(resetNotificationCount: true) {
      ... on AiringNotification { id type createdAt episode contexts ${MEDIA} }
      ... on FollowingNotification { id type createdAt context ${WHO} }
      ${['ActivityMessage', 'ActivityMention', 'ActivityReply', 'ActivityReplySubscribed', 'ActivityLike', 'ActivityReplyLike']
    .map((t) => `... on ${t}Notification { id type createdAt context activityId ${WHO} }`).join('\n      ')}
      ${['ThreadCommentMention', 'ThreadCommentReply', 'ThreadCommentSubscribed', 'ThreadCommentLike']
    .map((t) => `... on ${t}Notification { id type createdAt context commentId thread { id title } ${WHO} }`).join('\n      ')}
      ... on ThreadLikeNotification { id type createdAt context thread { id title } ${WHO} }
      ${['RelatedMediaAddition', 'MediaDataChange', 'MediaMerge']
    .map((t) => `... on ${t}Notification { id type createdAt context ${MEDIA} }`).join('\n      ')}
      ... on MediaDeletionNotification { id type createdAt context deletedMediaTitle }
    }
  }
}`;

const ICONS = {
  sort: '<path d="M4 7h11"/><path d="M4 12h8"/><path d="M4 17h5"/><path d="M18 6v12"/><path d="M15 15l3 3 3-3"/>',
  posters: '<rect x="3.5" y="3.5" width="7" height="10" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="10" rx="1.5"/><path d="M4 17.5h6"/><path d="M14 17.5h6"/><path d="M4 20.5h4"/><path d="M14 20.5h4"/>',
  small: '<rect x="3" y="3.5" width="4.5" height="7" rx="1"/><rect x="9.75" y="3.5" width="4.5" height="7" rx="1"/><rect x="16.5" y="3.5" width="4.5" height="7" rx="1"/><rect x="3" y="13.5" width="4.5" height="7" rx="1"/><rect x="9.75" y="13.5" width="4.5" height="7" rx="1"/><rect x="16.5" y="13.5" width="4.5" height="7" rx="1"/>',
  rows: '<rect x="3.5" y="4" width="4" height="5.5" rx="1"/><rect x="3.5" y="14.5" width="4" height="5.5" rx="1"/><path d="M10.5 5.5h10"/><path d="M10.5 8.5h6"/><path d="M10.5 16h10"/><path d="M10.5 19h6"/>',
  now: '<rect x="3" y="4.5" width="18" height="13.5" rx="2.5"/><path d="M8.5 21h7"/><path d="M10.2 8.6v5.3a.4.4 0 0 0 .6.35l4.4-2.65a.4.4 0 0 0 0-.7l-4.4-2.65a.4.4 0 0 0-.6.35z" fill="currentColor" stroke-width="1"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5v.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  play: '<path d="M8 5.6v12.8a.6.6 0 0 0 .9.5l10.2-6.4a.6.6 0 0 0 0-1L8.9 5.1a.6.6 0 0 0-.9.5z" fill="currentColor"/>',
  // A video's rounded screen with its play triangle: a song's search on YouTube (0.12.7).
  video: '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9.3v5.4l4.6-2.7z" fill="currentColor"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  frown: '<circle cx="12" cy="12" r="9"/><path d="M8.5 16.2c2-1.8 5-1.8 7 0"/><path d="M9 9.8v.01"/><path d="M15 9.8v.01"/>',
  meh: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15h7"/><path d="M9 9.8v.01"/><path d="M15 9.8v.01"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14c2 2 5 2 7 0"/><path d="M9 9.8v.01"/><path d="M15 9.8v.01"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M9 3v4"/><path d="M15 3v4"/>',
  inbox: '<path d="M4 13l2.5-7.5A2 2 0 0 1 8.4 4h7.2a2 2 0 0 1 1.9 1.5L20 13"/><path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5h-5l-1 2h-4l-1-2z"/>',
  pin: '<path d="M8.5 3.5h7"/><path d="M10 3.5v5.2l-3 3.3v1.5h10V12l-3-3.3V3.5"/><path d="M12 13.5V20.5"/>',
  list: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  // Open in a window (0.12.6): a window with an arrow leaving it.
  popout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/><path d="M14 4h6v6"/><path d="M20 4l-7.5 7.5"/>',
  sliders: '<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="9" cy="17" r="2"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  next: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
  heart: '<path d="M12 19.5s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.4c0 5.5-7.5 10.1-7.5 10.1z"/>',
  minus: '<path d="M6.5 12h11"/>',
  plus: '<path d="M12 6.5v11"/><path d="M6.5 12h11"/>',
  warn: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10.5v4"/><path d="M12 17.2v.01"/>',
  repeat: '<path d="M4.5 11.5V10a4 4 0 0 1 4-4h11"/><path d="M16.5 3l3 3-3 3"/><path d="M19.5 12.5V14a4 4 0 0 1-4 4h-11"/><path d="M7.5 21l-3-3 3-3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>',
  close: '<path d="M7 7l10 10"/><path d="M17 7L7 17"/>',
};

const state = {
  auth: null,
  clientId: '',
  view: 'now',        // the section shown: a key of VIEWS
  lists: {},          // ANIME, MANGA, UPNEXT -> { entries, at }; TODAY -> { items, at, day }
  scoreFormat: null,
  scoreOpen: null,    // entry id whose score picker is open
  unread: 0,
  notifs: null,       // { items, at, fresh, loading }
  loading: {},        // list key -> true
  error: null,
  slow: false,        // AniList's rate limit is making something you asked for wait
  busy: new Set(),    // entry ids being saved
  undo: new Map(),    // entry id -> { progress, status, timer, ... }
  menu: false,        // the account menu: false, 'opening' (for one drawing), true
  toast: null,        // { msg, media, undo, actions, fresh }: what just changed, at the bottom of the window
  message: null,      // { kind, text } shown on the setup screen
  justConnected: false,
  // Settings (0.6.10): the hub's and the popup's in one object (sync "settings"), see normalizeSettings.
  settings: null,
  setOpen: null,      // the group of Settings unfolded: 'look', 'popup', 'anilist', 'nsfw', 'trackers', 'account', 'about' or null; folded again on leaving Settings
  siteTheme: null,    // AniList's own theme setting, as Tsugi last saw it there: default, dark, contrast, system
  viewerColor: null,  // your AniList profile color, as the hub last saw it (fresher than the login's)
  rate: null,         // the request queue's count (session "rate"): { recent, pausedUntil, limit, left, at }
  autoDates: true,    // the "Fill in start and finish dates" setting (shared with the hub)
  history: true,      // the "Rewatch log" setting (shared with the hub)
  // Title pages (0.6.8), opened over the section in state.view; the last one is shown.
  stack: [],          // [{ mediaId, from: the data-f to focus on the way back, details: unfolded, all: { section: shown in full } }]
  titles: {},         // mediaId -> { mediaId, base, media, entry, at, loading, error, more, spoilers, allTags, people, hist }
  customLists: {},    // ANIME / MANGA -> your custom lists' names
  pins: {},           // 'ANIME/PLANNING' -> { list: [{ id, mediaId, priority }], at }
  statusMenu: false,  // the title page's status menu: false, 'opening', true
  confirmRemove: false,
  dateEdit: null,     // 'startedAt' / 'completedAt': a partial date (just a year) being changed
  sorts: {},          // each list's settings on AniList's pages (sync "sorts"): their Priorities switch
  order: {},          // 'ANIME/planning' -> { o: { priority: [mediaId] } }: your own order inside a priority
  prioFinished: false,
  hideAdult: false,   // Tsugi's "Hide NSFW titles" setting (its key is older; search leaves them out too)
  // Search (0.6.9): what you typed, the kind of title, and the answers kept for this popup's life.
  search: { q: '', kind: 'ALL', cache: new Map(), shown: null, loading: null, more: false, seq: 0, recent: [], adultOk: false },
  // Now and Up Next (0.8.2): one kind at a time, Now shows any of your lists, sorted and laid out your way.
  kind: 'ANIME',      // 'ANIME' or 'MANGA' (local "popup:kind")
  kindChosen: false,  // picked once: until then, Now opens on the kind you're actually watching or reading
  listOf: { ANIME: 'CURRENT', MANGA: 'CURRENT' },   // Now's list per kind (local "popup:list"): a status, 'ALL' or 'c:<custom list>'
  lsort: {},          // 'ANIME/COMPLETED' -> { by, rev } (local "popup:lsort")
  layout: 'posters',  // 'posters' or 'rows' (local "popup:layout")
  size: 4,            // posters a row, 2 to 7 (local "popup:size"; the slider in the layout menu)
  lmenu: null,        // the toolbar menu open: 'list', 'sort' or 'layout'
  lmenuFresh: false,
  find: null,         // "Find in this list": null (closed) or what's typed
  castFrom: 'mal',     // title pages' Characters: 'mal' (the default since 0.8.1: often fuller) or 'anilist' (local "castFrom", shared with AniList's title pages)
};

/* Helpers ----------------------------------------------------------------- */

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return t.content.firstElementChild;
}

// Three bars: priority (badges on AniList, Up Next here).
function glyph() {
  const t = document.createElement('template');
  t.innerHTML = '<svg class="glyph" viewBox="0 0 12 12" aria-hidden="true"><rect x="0.8" y="7.2" width="2.6" height="4" rx="0.9"/><rect x="4.7" y="4.4" width="2.6" height="6.8" rx="0.9"/><rect x="8.6" y="1.4" width="2.6" height="9.8" rx="0.9"/></svg>';
  return t.content.firstElementChild;
}

// Tsugi's mark (brand/tsugi-mark.svg): the triangle takes --accent, the kanji the text color.
function mark() {
  const t = document.createElement('template');
  t.innerHTML = '<svg class="tsugi-mark" viewBox="12 12 76 76" aria-hidden="true"><path d="M19 37 L35.5 51 L19 65 Z" fill="var(--accent, #EF4136)" stroke="var(--accent, #EF4136)" stroke-width="4" stroke-linejoin="round"/><path d="M55.5 18 L46.5 33" stroke="currentColor" stroke-width="9.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M50.5 30 H77.5 L71.5 40.5" stroke="currentColor" stroke-width="9.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M63.5 37 C62.5 56 54.5 70 40.5 81.5" stroke="currentColor" stroke-width="9.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M63.5 50 C67.5 62 72.5 72 80.5 79.5" stroke="currentColor" stroke-width="9.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return t.content.firstElementChild;
}

// The popup draws everything again on each change. Covers keep their <img>, moved into the new
// drawing, so they never flash while they load again.
const imgCache = new Map();   // url -> <img>
let imgUsed = new Set();      // the ones placed in the drawing being made
function cover(url, lazy = true) {
  if (!url) return null;
  let el = imgCache.get(url);
  if (!el || imgUsed.has(el)) {
    el = h('img', { src: url, alt: '', decoding: 'async', loading: lazy ? 'lazy' : null });
    if (!imgCache.has(url)) imgCache.set(url, el);
  }
  imgUsed.add(el);
  return el;
}
const posterUrl = (m) => (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || null;
const thumbUrl = (m) => (m.coverImage && (m.coverImage.medium || m.coverImage.large)) || null;

function hexToRGB(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function luminance(rgb) {
  const [r, g, b] = rgb.split(',').map((x) => {
    const v = Number(x) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The accent (0.6.10: the hub's Accent setting, which the popup used to ignore): your AniList profile
// color ("From AniList", the setting's "auto"), or one of AniList's seven you picked.
const profileColor = () => state.viewerColor || (state.auth && state.auth.viewer && state.auth.viewer.color) || null;
const colorRGB = (c) => PROFILE_COLORS[c] || hexToRGB(c) || null;
// AniList's color, before a palette has its say.
function baseAccentRGB() {
  const a = state.settings ? state.settings.accent : 'auto';
  return (a !== 'auto' && PROFILE_COLORS[a]) || colorRGB(profileColor()) || PROFILE_COLORS.blue;
}
// The accent's name among AniList's seven (null: a color of your own on AniList, which no palette changes).
function accentKey() {
  const a = state.settings ? state.settings.accent : 'auto';
  if (a !== 'auto') return PROFILE_COLORS[a] ? a : null;
  const c = profileColor() || 'blue';
  return PROFILE_COLORS[c] ? c : null;
}
// On a palette (0.12), the palette's own shade of that color: Catppuccin's blue for AniList's blue.
const accentRGB = () => paletteAccent(paletteOf(themeNow()), accentKey(), baseAccentRGB());
function applyAccent() {
  const rgb = accentRGB();
  document.documentElement.style.setProperty('--acc', rgb);
  document.documentElement.style.setProperty('--on-acc', luminance(rgb) > 0.45 ? '15,22,34' : '255,255,255');
}

// The theme: the one you picked, or AniList's own (its "site-theme": default, dark, contrast, or system,
// which follows the computer like AniList does). Before Tsugi has seen AniList, the computer's.
const SITE_LOOKS = { default: 'light', dark: 'dark', contrast: 'contrast' };
const siteLook = () => SITE_LOOKS[state.siteTheme] || (systemDark() ? 'dark' : 'light');
function themeNow() {
  const t = state.settings ? state.settings.theme : 'site';
  return isLook(t) ? t : siteLook();
}
// The toolbar popup's width (Settings, Popup, Size): live, and kept for the next opening's first drawing.
function applyPopupSize() {
  const z = state.settings.popupSize;
  try { localStorage.setItem(SIZE_HINT, z); } catch { /* storage blocked */ }
  if (!IS_POPUP) return;
  const root = document.documentElement;
  if ((root.dataset.size || 'm') === z) return;
  if (z === 'm') delete root.dataset.size; else root.dataset.size = z;
}

function applyTheme() {
  const t = themeNow();
  const root = document.documentElement;
  if (root.dataset.theme !== t) root.dataset.theme = t;
  if (root.dataset.tone !== toneOf(t)) root.dataset.tone = toneOf(t);
  try { localStorage.setItem(THEME_HINT, t); } catch { /* storage blocked */ }
}

/* Each title's own color, and the episode track (the same rules as content/core.js) --------- */

function mixRGB(a, b, share) {
  const y = b.split(',').map(Number);
  return a.split(',').map(Number).map((v, i) => Math.round(v * share + y[i] * (1 - share))).join(',');
}

const darkTheme = () => document.documentElement.dataset.tone === 'dark';
const onColor = (rgb) => (luminance(rgb) > 0.25 ? '15,22,34' : '255,255,255');

// The cover's main color, kept readable on this theme (--title), on the dark glass over covers
// whatever the theme (--title-d), and on light grounds (--title-l: the toast in dark theme), as an
// inline style for anything about that title.
function titleStyle(m) {
  const rgb = hexToRGB(m && m.coverImage && m.coverImage.color);
  if (!rgb) return null;
  const l = luminance(rgb);
  const onDark = l < 0.18 ? mixRGB(rgb, '255,255,255', 0.65) : rgb;
  let onLight = l > 0.6 ? mixRGB(rgb, '0,0,0', 0.65) : rgb;
  let theme = darkTheme() ? onDark : onLight;
  // On a palette (0.12): readable on its own panel color (palettes.js, paletteTitle). The toast
  // (an Ink-filled chip) takes --title-l in a dark palette: readable on its Ink.
  const pal = paletteOf(themeNow());
  if (pal) {
    const t = paletteTokens(pal);
    theme = paletteTitle(rgb, pal);
    if (pal.tone === 'dark') onLight = paletteReadable(rgb, t.ink, t.surface);
  }
  return `--title: ${theme}; --on-title: ${onColor(theme)}; --title-d: ${onDark}; --on-title-d: ${onColor(onDark)}; --title-l: ${onLight}`;
}

// The track is one thin continuous line (0.6.8.1): watched solid, out but not watched faint, not out
// yet empty. done: watched; out: how many are out so far (null: all); span: its length (null: no track).
function trackOf(e) {
  const m = e.media;
  const anime = isAnime(e.type);
  const total = (anime ? m.episodes : m.chapters) || null;
  const done = e.progress || 0;
  let out = null;
  if (m.status === 'NOT_YET_RELEASED') out = 0;
  else if (anime && m.status === 'RELEASING' && m.nextAiringEpisode) out = m.nextAiringEpisode.episode - 1;
  let span = total || (out != null && m.status === 'RELEASING' ? out + 1 : null);
  if (span) {
    span = Math.max(span, done);
    if (out != null) out = Math.max(out, done);
    if (out != null && out >= span) out = null;
  }
  return { done, out, span: span || null, total };
}

// The popup remembers what each track showed last: one more watched than last time grows the line
// from where it was; one less shrinks it back (Undo).
const drawn = new Map(); // entry id -> { done, from, at }: what its track showed, and since when
const calm = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const ANIM_MS = 350; // the longest of the track's moments (the finishing brighten)

// How a title's progress changed since the last drawing: { from, since } while its animation still
// runs (a redraw then carries it on from where it was), else { from: null }.
function progressMove(id, done) {
  const now = Date.now();
  const d = drawn.get(id);
  if (!d || d.done !== done) {
    drawn.set(id, { done, from: d ? d.done : null, at: now });
    return { from: d && !calm() ? d.done : null, since: 0 };
  }
  return d.from != null && now - d.at < ANIM_MS && !calm() ? { from: d.from, since: now - d.at } : { from: null, since: 0 };
}

function track(t, mv) {
  const prev = mv.from;
  const moved = prev != null && prev !== t.done;
  const delay = mv.since ? `animation-delay:-${mv.since}ms` : null;
  const pct = (n) => `${Math.min(100, (n / t.span) * 100)}%`;
  const el = h('div', { class: 'track', 'aria-hidden': 'true' },
    h('b', { class: 'track-out', style: `width:${pct(t.out == null ? t.span : t.out)}` }),
    h('b', { class: 'track-done' + (moved ? (t.done > prev ? ' is-grow' : ' is-shrink') : ''), style: `width:${pct(t.done)}${moved ? `;--from:${pct(prev)}${delay ? `;${delay}` : ''}` : ''}` }));
  if (moved && t.done > prev && t.done >= t.span) { el.classList.add('is-finished'); if (delay) el.style.animationDelay = `-${mv.since}ms`; }
  return el;
}

// A link opens in a browser tab. The toolbar popup then closes, as popups do; its own window, a tab and the side
// panel stay (0.12.6): from the window, the tab goes to the browser window you used last, which comes forward.
function open(url) {
  if (IS_POPUP) { chrome.tabs.create({ url }); window.close(); return; }
  if (MODE === 'tab') {
    chrome.tabs.getCurrent((t) => chrome.tabs.create(t ? { url, index: t.index + 1, windowId: t.windowId } : { url }));
    return;
  }
  if (MODE === 'window') {
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }).then((w) => {
      if (!w) return chrome.windows.create({ url, focused: true });
      return chrome.tabs.create({ url, windowId: w.id }).then(() => chrome.windows.update(w.id, { focused: true }));
    }).catch(() => chrome.tabs.create({ url }));
    return;
  }
  chrome.tabs.create({ url });
}
const opener = (url) => (ev) => { ev.preventDefault(); open(url); };

function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: 'The extension is restarting. Try again.' });
        else resolve(res || { ok: false, error: 'No answer' });
      });
    } catch {
      resolve({ ok: false, error: 'The extension is restarting. Try again.' });
    }
  });
}

// AniList limits how many requests apps can make each minute. When the shared queue makes
// something you asked for wait more than a few seconds, say so instead of spinning silently.
let waiting = 0;
let slowTimer = null;

async function gql(query, variables, priority = 'high') {
  const watched = priority !== 'low';
  if (watched && waiting++ === 0) slowTimer = setTimeout(() => { state.slow = true; render(); }, 4000);
  try {
    const res = await send({ type: 'gql', query, variables, priority });
    if (!res.ok) throw Object.assign(new Error(res.error || 'Request failed'), { status: res.status });
    return res.data;
  } finally {
    if (watched && --waiting === 0) {
      clearTimeout(slowTimer);
      if (state.slow) { state.slow = false; render(); }
    }
  }
}

// "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", "2 weeks ago", "3 months ago",
// "2 years ago" (0.6.8.3: before, everything past two days was counted in days).
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.floor(s / 86400);
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (days < 30) return plural(Math.round(days / 7), 'week');
  if (days < 365) return plural(Math.max(1, Math.round(days / 30.44)), 'month');
  return plural(Math.max(1, Math.round(days / 365.25)), 'year');
}
// The exact moment, for pointing at a relative one: "Tue 6 Oct 2026, 18:30".
function exactTime(t) {
  return new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const isAnime = (type) => type === 'ANIME';
// "in 40 min", "in 5 h", "in 3 d": until the next episode airs. Short enough for a label on a cover.
function soon(at) {
  const s = Math.max(0, at - Math.floor(Date.now() / 1000));
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86400)} d`;
}
// "12 h 26 min", "45 min": one piece, never split into bold and thin bits (0.6.8.2).
function durationText(min) {
  const hr = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return hr ? `${hr} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
const duration = (min) => h('b', {}, durationText(min));
// "18:30", or "6:30" with a quiet "PM" where the clock has 12 hours.
function clock(at) {
  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(at * 1000));
  const period = parts.find((p) => p.type === 'dayPeriod');
  const time = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  return period ? [time, h('span', { class: 'tl-ampm' }, period.value)] : [time];
}

const newCount = (e) => {
  if (state.settings && state.settings.newEps === false) return 0;   // New episode counts, off (shared with AniList)
  const m = e.media;
  if (m.status !== 'RELEASING' || !m.nextAiringEpisode) return 0;
  return Math.max(0, m.nextAiringEpisode.episode - 1 - (e.progress || 0));
};

/* Data -------------------------------------------------------------------- */

function entriesOf(collection, type) {
  const out = [];
  for (const l of (collection && collection.lists) || []) for (const e of l.entries || []) out.push({ ...e, type });
  return out;
}

function normalize(collection, type) {
  const seen = new Set();
  const out = entriesOf(collection, type).filter((e) => !seen.has(e.id) && seen.add(e.id));
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

async function saveCache() {
  try { await chrome.storage.session.set({ 'popup:lists': state.lists }); } catch { /* ignore */ }
}

async function loadList(type, { force = false, quiet = false } = {}) {
  const cached = state.lists[type];
  if (!force && cached && Date.now() - cached.at < STALE_MS) return;
  if (state.loading[type]) return;
  state.loading[type] = true;
  if (!quiet) { state.error = null; render(); }
  try {
    const data = await gql(LIST_QUERY, { userId: state.auth.viewer.id, type }, quiet ? 'low' : 'high');
    const col = data.MediaListCollection;
    const fmt = col && col.user && col.user.mediaListOptions && col.user.mediaListOptions.scoreFormat;
    if (fmt) state.scoreFormat = fmt;
    state.lists[type] = { entries: normalize(col, type), at: Date.now(), format: fmt || null };
    saveCache();
  } catch (err) {
    if (!quiet) state.error = err.message;
  } finally {
    state.loading[type] = false;
    render();
  }
}

// Highest priority first. Inside a priority: the order you gave it on AniList's pages (dragging, sync
// "order:<TYPE>/planning", content/order.js), then the most recently added or touched.
function fineRank(e) {
  const st = state.order[`${e.type}/planning`];
  const block = st && st.o && st.o[e.priority || 0];
  const i = Array.isArray(block) ? block.indexOf(e.mediaId) : -1;
  return i < 0 ? 1e9 : i;
}
function sortUpNext(entries) {
  entries.sort((a, b) => (b.priority || 0) - (a.priority || 0) || fineRank(a) - fineRank(b) || (b.updatedAt || 0) - (a.updatedAt || 0));
}
const ORDER_KEYS = ['order:ANIME/planning', 'order:MANGA/planning'];
// Sync storage, or this computer's for a very long list: the newer one counts.
async function loadOrder() {
  const out = {};
  for (const area of ['sync', 'local']) {
    let got = {};
    try { got = await chrome.storage[area].get(ORDER_KEYS); } catch { got = {}; }
    for (const k of ORDER_KEYS) {
      const v = got[k];
      if (v && typeof v === 'object' && v.o && (!out[k.slice(6)] || (v.t || 0) > (out[k.slice(6)].t || 0))) out[k.slice(6)] = v;
    }
  }
  state.order = out;
}

async function loadUpNext({ force = false, quiet = false } = {}) {
  const cached = state.lists.UPNEXT;
  if (!force && cached && Date.now() - cached.at < STALE_MS) return;
  if (state.loading.UPNEXT) return;
  state.loading.UPNEXT = true;
  if (!quiet) { state.error = null; render(); }
  try {
    const data = await gql(UPNEXT_QUERY, { userId: state.auth.viewer.id }, quiet ? 'low' : 'high');
    const seen = new Set();
    const entries = [...entriesOf(data.anime, 'ANIME'), ...entriesOf(data.manga, 'MANGA')].filter((e) => !seen.has(e.id) && seen.add(e.id));
    sortUpNext(entries);
    // Pins stay where they were drawn until the list reloads, even once started (and unpinned).
    for (const e of entries) e.pin = (e.priority || 0) >= PIN_MIN;
    state.lists.UPNEXT = { entries, at: Date.now() };
    saveCache();
  } catch (err) {
    if (!quiet) state.error = err.message;
  } finally {
    state.loading.UPNEXT = false;
    render();
  }
}

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const from = Math.floor(d.getTime() / 1000);
  return { from: from - 1, to: from + 86400, day: d.toDateString() };
}

async function loadToday({ force = false, quiet = false } = {}) {
  const win = today();
  const cached = state.lists.TODAY;
  if (!force && cached && cached.day === win.day && Date.now() - cached.at < 5 * STALE_MS) return;
  if (state.loading.TODAY) return;
  state.loading.TODAY = true;
  if (!quiet) { state.error = null; render(); }
  try {
    if (!state.lists.ANIME) await loadList('ANIME', { quiet: true });
    if (!state.lists.UPNEXT) await loadUpNext({ quiet: true });
    const ids = new Set();
    for (const e of (state.lists.ANIME && state.lists.ANIME.entries) || []) if (e.media.status === 'RELEASING') ids.add(e.mediaId);
    for (const e of (state.lists.UPNEXT && state.lists.UPNEXT.entries) || []) {
      if (e.type === 'ANIME' && ['RELEASING', 'NOT_YET_RELEASED'].includes(e.media.status)) ids.add(e.mediaId);
    }
    let items = [];
    if (ids.size) {
      const data = await gql(TODAY_QUERY, { ids: [...ids], from: win.from, to: win.to }, quiet ? 'low' : 'high');
      items = (data.Page && data.Page.airingSchedules) || [];
    }
    state.lists.TODAY = { items, at: Date.now(), day: win.day };
    saveCache();
  } catch (err) {
    if (!quiet) state.error = err.message;
  } finally {
    state.loading.TODAY = false;
    render();
  }
}

// Opening Notifications marks them read on AniList (and clears the count on the toolbar icon).
async function loadNotifs() {
  const fresh = state.unread;
  state.notifs = state.notifs ? { ...state.notifs, loading: true } : { items: null, loading: true, fresh };
  state.error = null;
  render();
  try {
    const data = await gql(NOTIF_QUERY, {});
    state.notifs = { items: (data.Page && data.Page.notifications) || [], at: Date.now(), fresh, loading: false };
    state.unread = 0;
    send({ type: 'notif:read' });
  } catch (err) {
    state.error = err.message;
    state.notifs.loading = false;
  }
  render();
}

/* Start and finish dates ------------------------------------------------- */
// The same rule as the hub (content/core.js, datesToFill): starting or finishing a title for
// the first time fills in its empty start or finish date with today. Rewatches leave them alone.

const hasDate = (d) => !!(d && d.year);
const NO_DATE = { year: null, month: null, day: null };
function todayDate() {
  const t = new Date();
  return { year: t.getFullYear(), month: t.getMonth() + 1, day: t.getDate() };
}

function datesFor(entry, patch) {
  // Lists saved by an older version don't have the dates: leave them alone.
  if (!state.autoDates || !('startedAt' in entry) || patch.startedAt !== undefined || patch.completedAt !== undefined) return {};
  const m = entry.media || {};
  const total = isAnime(entry.type) ? m.episodes : m.chapters;
  const was = entry.progress || 0;
  const progress = patch.progress != null ? patch.progress : was;
  let status = patch.status || entry.status;
  if ((status === 'CURRENT' || status === 'REPEATING') && total && progress >= total) status = 'COMPLETED';
  if (status === entry.status && progress === was) return {};
  const out = {};
  const fresh = entry.status === 'PLANNING' || !(was > 0);
  if (status === 'CURRENT' && !hasDate(entry.startedAt) && fresh) out.startedAt = todayDate();
  if (status === 'COMPLETED' && !hasDate(entry.completedAt) && !['COMPLETED', 'REPEATING'].includes(entry.status)) {
    out.completedAt = todayDate();
    if (!hasDate(entry.startedAt) && fresh) out.startedAt = todayDate();
  }
  return out;
}

const UNDO_MS = 6000;
let toastTimer = null;
// One toast at a time, at the bottom of the window: what just changed, with Undo (and maybe one
// more action) while it lasts. media: the title it's about (its color).
function toast(msg, media, { undo = null, actions = [], ms = 0 } = {}) {
  state.toast = { msg, media: media || null, undo, actions, fresh: true };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; render(); }, ms || (undo || actions.length ? UNDO_MS : 2600));
}
function clearToast() {
  state.toast = null;
  clearTimeout(toastTimer);
}

function scoreText(v) {
  const f = fmtNow();
  if (f === 'POINT_5') return `${v} star${v === 1 ? '' : 's'}`;
  if (f === 'POINT_3') return ['', 'Disliked', 'Liked okay', 'Liked'][Math.round(v)] || String(v);
  if (f === 'POINT_100') return `${v}/100`;
  return `${v}/10`;
}

// "2 May 2024", "May 2024" or "2024" (AniList's dates can be just a year).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateWords(d) {
  if (!hasDate(d)) return '';
  if (!d.month) return String(d.year);
  return `${d.day ? `${d.day} ` : ''}${MONTHS[d.month - 1]} ${d.year}`;
}
const nameOf = (entry) => entry.media.title.userPreferred;
const rewatchWord = (type) => (isAnime(type) ? 'rewatch' : 'reread');

// The same words as the hub's toasts (content/edit.js).
// auto: the dates filled in by themselves ({ startedAt: today }).
function describe(entry, patch, before, auto = {}) {
  const title = nameOf(entry);
  const s = 'startedAt' in auto;
  const c = 'completedAt' in auto;
  const dates = s && c ? ', dates set to today' : s ? ', start date set to today' : c ? ', finish date set to today' : '';
  const anime = isAnime(entry.type);
  if (entry.status === 'COMPLETED' && before.status !== 'COMPLETED' && (patch.progress != null || patch.status)) return `Finished ${title}${dates}`;
  if (patch.status) return `${title} moved to ${statusWord(entry.type, entry.status)}${dates}`;
  if (patch.score != null) return patch.score ? `${title}: ${scoreText(entry.score)}` : `Score removed from ${title}`;
  if (patch.progress != null) return (anime ? `${title}: episode ${entry.progress} watched` : `${title}: chapter ${entry.progress} read`) + dates;
  if (patch.priority != null) return patch.priority ? `${title}: priority ${patch.priority}` : `Priority removed from ${title}`;
  if (patch.repeat != null) {
    const n = patch.repeat;
    return n ? `${title}: ${anime ? 'rewatched' : 'reread'} ${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`}` : `${title}: no ${rewatchWord(entry.type)}s`;
  }
  if (patch.customLists) {
    const was = before.customLists || [];
    const added = patch.customLists.filter((n) => !was.includes(n));
    const gone = was.filter((n) => !patch.customLists.includes(n));
    if (added.length && !gone.length) return `${title} added to ${added.join(' and ')}`;
    if (gone.length && !added.length) return `${title} removed from ${gone.join(' and ')}`;
    return `${title}: custom lists saved`;
  }
  if (patch.notes != null) return patch.notes ? `Note saved for ${title}` : `Note removed from ${title}`;
  if (patch.private != null) return patch.private ? `${title} is private now` : `${title} is public again`;
  for (const [k, word] of [['startedAt', 'start'], ['completedAt', 'finish']]) {
    if (patch[k] !== undefined && !(k in auto)) return hasDate(patch[k]) ? `${title}: ${word} date ${dateWords(patch[k])}` : `${title}: ${word} date removed`;
  }
  return `${title} saved`;
}

// An entry's value for one field, in the shape a save sends back (for Undo and comparisons).
function snap(entry, k) {
  if (k === 'customLists') return [...(entry.customLists || [])];
  if (k === 'startedAt' || k === 'completedAt') return { ...NO_DATE, ...(entry[k] || {}) };
  if (k === 'notes') return entry.notes || '';
  if (k === 'private' || k === 'hiddenFromStatusLists') return !!entry[k];
  if (k === 'status') return entry.status;
  return entry[k] || 0;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// AniList sends an entry's custom lists as { "Name": true, ... } (or as [{ name, enabled }]).
function parseCustomLists(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return []; } }
  if (Array.isArray(raw)) return raw.filter((x) => x && (x.enabled || typeof x === 'string')).map((x) => (typeof x === 'string' ? x : x.name)).filter(Boolean);
  if (typeof raw === 'object') return Object.keys(raw).filter((k) => raw[k]);
  return [];
}

// What AniList saved, into the entry (and into the other copies of it the popup holds: the same
// title can be in Watching, Up Next and on its title page at once).
function applySaved(entry, saved, patch) {
  for (const k of FIELD_KEYS) {
    if (saved && saved[k] !== undefined && saved[k] !== null) entry[k] = k === 'customLists' ? parseCustomLists(saved[k]) : saved[k];
    else if (patch[k] !== undefined) entry[k] = patch[k];
  }
  entry.updatedAt = Math.floor(Date.now() / 1000);
  entry.savedAt = Date.now();
  syncCopies(entry);
}

function copiesOf(id) {
  const out = new Set();
  for (const k of ['ANIME', 'MANGA', 'UPNEXT', 'ALL:ANIME', 'ALL:MANGA']) for (const e of (state.lists[k] && state.lists[k].entries) || []) if (e.id === id) out.add(e);
  for (const T of Object.values(state.titles)) if (T.entry && T.entry.id === id) out.add(T.entry);
  return [...out];
}
function syncCopies(entry) {
  for (const c of copiesOf(entry.id)) {
    if (c === entry) continue;
    for (const k of [...FIELD_KEYS, 'updatedAt']) if (entry[k] !== undefined) c[k] = Array.isArray(entry[k]) ? [...entry[k]] : entry[k];
  }
  // A related or recommended title on a title page, or a search result, says your status too.
  for (const n of shownNodes()) {
    if (n.mediaListEntry && n.mediaListEntry.id === entry.id) Object.assign(n.mediaListEntry, { status: entry.status, progress: entry.progress, score: entry.score });
  }
}

// After a change of status (or a title added or removed), the sections reload when next opened.
function markStale() {
  for (const k of ['ANIME', 'MANGA', 'UPNEXT', 'TODAY', 'ALL:ANIME', 'ALL:MANGA']) if (state.lists[k]) state.lists[k].at = 0;
}

// Saves a change and keeps what it replaced, so Undo can put it back for a few seconds.
// A save waits for the one before it on the same title when opts.wait is set (edits on a title
// page); otherwise it's refused while one runs (the +1 button shows it's busy).
const inflight = new Map();   // entry id -> the save running for it
async function saveEntry(entry, patch, opts = {}) {
  while (inflight.has(entry.id)) {
    if (!opts.wait) return false;
    await inflight.get(entry.id).catch(() => {});
  }
  // An edit that ends where it started (typed back, or already saved by the one before) saves nothing.
  if (opts.wait) {
    patch = Object.fromEntries(Object.entries(patch).filter(([k, v]) => !same(v, snap(entry, k))));
    if (!Object.keys(patch).length) return true;
  }
  const run = doSave(entry, patch, opts);
  inflight.set(entry.id, run);
  try { return await run; } finally { if (inflight.get(entry.id) === run) inflight.delete(entry.id); }
}

// A pin belongs to the status list it was pinned in (AniList's priority field goes with the title):
// a save that moves a pinned title to another status takes it out of the pins too, with the
// priority it had before (0.6.9.1: a title pinned in Reading showed "Pinned, #1 in Paused").
function nextStatus(entry, patch) {
  const m = entry.media || {};
  const total = isAnime(entry.type) ? m.episodes : m.chapters;
  const progress = patch.progress != null ? patch.progress : entry.progress || 0;
  const status = patch.status || entry.status;
  return (status === 'CURRENT' || status === 'REPEATING') && total && progress >= total ? 'COMPLETED' : status;
}

async function doSave(entry, patch, opts) {
  if (patch.priority === undefined && (entry.priority || 0) >= PIN_MIN && nextStatus(entry, patch) !== entry.status) {
    patch = { ...patch, ...(await unpinPatch(entry)) };
  }
  const before = { progress: entry.progress || 0, status: entry.status };
  // Finishing a rewatch may raise its count on AniList: Undo puts the count back too.
  if (entry.status === 'REPEATING' && patch.progress != null) before.repeat = entry.repeat || 0;
  for (const k of Object.keys(patch)) if (!(k in before)) before[k] = snap(entry, k);
  const dates = datesFor(entry, patch);
  for (const k of Object.keys(dates)) before[k] = snap(entry, k);
  patch = { ...patch, ...dates };
  const statusWas = entry.status;
  state.busy.add(entry.id);
  render();
  try {
    const res = await gql(saveMutation(['id', ...Object.keys(patch)]), { id: entry.id, ...patch });
    applySaved(entry, res && res.SaveMediaListEntry, patch);
    if (entry.status !== statusWas) markStale();
    // Undo puts back what the toast names. The same change made again while its Undo still shows
    // (+1, +1, +1) is undone together, back to before the first one.
    const prev = state.undo.get(entry.id);
    if (prev) clearTimeout(prev.timer);
    const keys = Object.keys(patch).filter((k) => !(k in dates)).sort().join(',');
    const timer = setTimeout(() => { state.undo.delete(entry.id); settle(entry); render(); }, UNDO_MS);
    state.undo.set(entry.id, { vals: prev && prev.keys === keys ? { ...before, ...prev.vals } : before, keys, timer });
    toast(opts.msg || describe(entry, patch, before, dates), entry.media, { undo: () => undoEntry(entry) });
    saveCache();
    return true;
  } catch (err) {
    state.error = `Couldn't update ${nameOf(entry)}: ${err.message}`;
    return false;
  } finally {
    state.busy.delete(entry.id);
    render();
  }
}

const plusOne = (entry) => saveEntry(entry, { progress: (entry.progress || 0) + 1 });
// Starting a pinned title takes it out of the pins and gives it back the priority it had before.
async function unpinPatch(entry) {
  if ((entry.priority || 0) < PIN_MIN) return {};
  let prev = 0;
  try { prev = Number(((await chrome.storage.sync.get('pinPrev')).pinPrev || {})[entry.mediaId]) || 0; } catch { /* ignore */ }
  return { priority: Math.min(MAX_PRIORITY, Math.max(0, prev)) };
}
async function startEntry(entry) {
  return saveEntry(entry, { status: 'CURRENT', ...(await unpinPatch(entry)) });
}

// Once Undo has expired, a started title leaves Up Next and its Watching or Reading list reloads.
function settle(entry) {
  const up = state.lists.UPNEXT;
  if (!up || entry.status === 'PLANNING' || !up.entries.includes(entry)) return;
  up.entries = up.entries.filter((e) => e !== entry);
  if (state.lists[entry.type]) state.lists[entry.type].at = 0;
  saveCache();
}

async function undoEntry(entry) {
  const u = state.undo.get(entry.id);
  if (!u || inflight.has(entry.id)) return;
  clearToast();
  clearTimeout(u.timer);
  state.undo.delete(entry.id);
  const vals = u.vals;
  const statusWas = entry.status;
  const run = (async () => {
    state.busy.add(entry.id);
    render();
    try {
      const res = await gql(saveMutation(['id', ...Object.keys(vals)]), { id: entry.id, ...vals });
      applySaved(entry, res && res.SaveMediaListEntry, vals);
      if (entry.status !== statusWas) markStale();
      toast(`Undone for ${nameOf(entry)}`, entry.media);
      saveCache();
    } catch (err) {
      state.error = `Couldn't undo: ${err.message}`;
    } finally {
      state.busy.delete(entry.id);
      render();
    }
  })();
  inflight.set(entry.id, run);
  try { await run; } finally { if (inflight.get(entry.id) === run) inflight.delete(entry.id); }
}

/* Scores ------------------------------------------------------------------ */

const fmtNow = () => state.scoreFormat || (state.auth && state.auth.viewer.scoreFormat) || 'POINT_10';

function scoreSteps(format) {
  if (format === 'POINT_100') return [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  if (format === 'POINT_5') return [1, 2, 3, 4, 5];
  if (format === 'POINT_3') return [1, 2, 3];
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
}
const FACES = ['', 'frown', 'meh', 'smile'];

function scoreChip(e) {
  const f = fmtNow();
  const v = e.score || 0;
  const isOpen = state.scoreOpen === e.id;
  const kids = !v ? [icon('star')]
    : f === 'POINT_3' ? [icon(FACES[Math.round(v)] || 'meh')]
      : [icon('star'), String(v)];
  return h('button', {
    class: 'score-chip' + (v ? ' has-score' : ' is-empty') + (isOpen ? ' is-open' : ''), 'data-f': `s:${e.id}`,
    'aria-label': v ? `Score ${v}. Change it` : 'Add a score', 'aria-expanded': String(isOpen),
    onclick: (ev) => {
      state.scoreOpen = isOpen ? null : e.id;
      render();
      const pick = app.querySelector('.score-row');
      if (pick) pick.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
      // Opened from the keyboard: straight into the scores.
      if (pick && ev.detail === 0) (pick.querySelector('.score-btn.is-active') || pick.querySelector('.score-btn')).focus();
    },
  }, kids);
}

function scorePicker(e) {
  const f = fmtNow();
  const v = e.score || 0;
  const pick = (n) => { state.scoreOpen = null; saveEntry(e, { score: n }, { wait: true }); };
  const btns = scoreSteps(f).map((n) => {
    const on = !!v && (f === 'POINT_5' ? n <= v : f === 'POINT_3' ? n === Math.round(v)
      : n === (f === 'POINT_100' ? Math.floor(v / 10) * 10 : Math.floor(v)));
    return h('button', {
      class: 'score-btn' + (on ? ' is-active' : ''), 'data-v': n, 'data-f': `sv:${e.id}:${n}`, 'aria-label': `Score ${n}`, 'aria-pressed': String(on),
      onclick: () => pick(v === n ? 0 : n),
    }, f === 'POINT_5' ? icon('star') : f === 'POINT_3' ? icon(FACES[n]) : String(n));
  });
  const kids = [h('div', { class: 'score-btns' }, btns)];
  if (f === 'POINT_100' || f === 'POINT_10_DECIMAL') {
    const max = f === 'POINT_100' ? 100 : 10;
    const input = h('input', { class: 'score-input', type: 'number', min: '0', max: String(max), step: f === 'POINT_100' ? '1' : '0.1', value: v ? String(v) : '', placeholder: '–', 'data-f': `si:${e.id}`, 'aria-label': `Exact score out of ${max}` });
    input.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      let n = parseFloat(input.value);
      n = Number.isNaN(n) ? 0 : Math.min(max, Math.max(0, n));
      pick(f === 'POINT_100' ? Math.round(n) : Math.round(n * 10) / 10);
    });
    kids.push(input);
  }
  if (v) kids.push(h('button', { class: 'score-clear', 'data-f': `sc:${e.id}`, onclick: () => pick(0), 'aria-label': 'Remove score' }, 'Clear'));
  return h('div', { class: `score-pick is-${f.toLowerCase().replace(/_/g, '-')}`, role: 'group', 'aria-label': `Score for ${e.media.title.userPreferred}` }, kids);
}

/* Building blocks ---------------------------------------------------------- */

let hotId = null;   // the poster under the pointer, kept across redraws so its +1 never flickers

function section(title, facts, body, act) {
  return h('section', { class: 'sec', 'aria-label': title },
    h('header', { class: 'sec-head' },
      h('h2', { class: 'sec-title' }, title),
      facts && facts.length ? h('div', { class: 'sec-facts' }, facts) : null,
      act || null),
    body);
}

// A quiet fact next to a section's title: "32 episodes left".
const fact = (...kids) => h('span', { class: 'fact' }, kids);

function headLink(label, url) {
  return h('button', { class: 'sec-act', onclick: () => open(url) }, label, icon('external'));
}

// A grid of posters, with the score picker (if open) as a strip under the row of its poster.
// Posters a row: `n` is how many fit the standard popup (560 wide: the size slider's 2 to 7); a wider or
// narrower window takes the count that keeps them closest to that width (0.12.6), at least one.
const STD_W = 472;   // the posters' width in the standard popup: 560 - the rail - the scroll's sides
function contentWidth() {
  const m = app.querySelector('.main');
  const w = m ? m.clientWidth : (IS_POPUP ? (POPUP_SIZES[document.documentElement.dataset.size] || 560) : window.innerWidth) - 56;
  return Math.max(120, w - 32);
}
const fitCols = (n) => Math.max(1, Math.round((n * (contentWidth() + 12)) / (STD_W + 12)));
function grid(entries, n, card, cls = '') {
  const cols = fitCols(n);
  const kids = entries.map(card);
  const i = entries.findIndex((e) => e.id === state.scoreOpen);
  if (i !== -1) {
    const after = Math.min(entries.length - 1, Math.floor(i / cols) * cols + cols - 1);
    kids.splice(after + 1, 0, h('div', { class: 'score-row', role: 'listitem', 'data-navfrom': `c:${entries[i].id}`, style: `--c:${i % cols};--cols:${cols}` }, scorePicker(entries[i])));
  }
  return h('div', { class: `grid${cls ? ` ${cls}` : ''}`, role: 'list', style: `--cols:${cols}` }, kids);
}

function skeletonGrid(n = 8, std = 4) {
  const cols = fitCols(std);
  return h('div', { class: 'grid is-skel', style: `--cols:${cols}`, 'aria-busy': 'true', 'aria-label': 'Loading' },
    Array.from({ length: n }, (_, i) => h('div', { class: 'pc-skel' }, h('i'), h('b', { style: `width:${58 - (i % 3) * 12}%` }))));
}

function skeletonRows(n = 4) {
  return h('div', { class: 'rows-skel', 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: n }, (_, i) => h('div', { class: 'skel' },
    h('i', { class: 'c' }),
    h('div', { class: 'l' }, h('i', { style: `width:${72 - i * 9}%` }), h('i', { style: 'width:40%' })))));
}

function empty(ic, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ic' }, icon(ic)), h('div', { class: 'empty-title' }, title), h('div', { class: 'empty-text' }, text), action || null);
}

const spin = () => h('span', { class: 'spin', 'aria-hidden': 'true' });

// The parts every poster shares: the cover (a link), its glass label, the caption and action
// that show on hover or keyboard focus, and the episode track along its bottom edge.
// The poster card (0.8.3): the cover is the whole card. At rest: the art, the title on a soft shade at its
// foot with the episode line under it, a label at the top left when there's something to say. On hover or
// keyboard focus: where you are and +1 (or Start) slide in under the title, the score star at the top right.
// No text under the cover any more (the line already says the progress). Sizes follow the poster's
// own width (container queries in popup.css), from 2 a row to 7.
function poster({ e, cls, label, said, tag, action, band, meta }) {
  const m = e.media;
  const id = String(e.id);
  return h('div', {
    class: ['pc', cls, state.busy.has(e.id) ? 'is-busy' : '', hotId === id ? 'is-hot' : '', state.scoreOpen === e.id ? 'is-scoring' : ''].filter(Boolean).join(' '),
    'data-id': id, 'data-navfrom': `c:${id}`, role: 'listitem', style: titleStyle(m),
  },
  h('div', { class: 'pc-art' + (band ? ' has-band' : ''), style: m.coverImage && m.coverImage.color ? `background-color:${m.coverImage.color}` : null },
    h('a', { class: 'pc-cover', href: m.siteUrl, 'data-nav': '', 'data-f': `c:${id}`, 'aria-label': said, onclick: titleOpener(m.id || e.mediaId, m, `c:${id}`) }, cover(posterUrl(m))),
    tag || null,
    h('div', { class: 'pc-top' }, scoreChip(e)),
    h('div', { class: 'pc-cap' },
      h('span', { class: 'pc-name', 'aria-hidden': 'true' }, label),
      meta || action ? h('div', { class: 'pc-more' }, h('div', { class: 'pc-more-in' }, h('span', { class: 'pc-info', 'aria-hidden': 'true' }, meta), action || null)) : null,
      band ? h('div', { class: 'pc-band', 'aria-hidden': 'true' }, band) : null)));
}

function progText(anime, progress, total, tick = null) {
  return h('span', { class: 'pc-prog' },
    h('span', { class: 'v-long' }, anime ? 'Ep ' : 'Ch '),
    h('b', { class: tick ? tick.cls : null, style: tick ? tick.style : null }, String(progress)),
    total ? [h('span', { class: 'pc-of v-long' }, ` of ${total}`), h('span', { class: 'pc-of v-short' }, `/${total}`)] : null);
}
const glassTag = (text, cls = '') => h('span', { class: `pc-tag${cls ? ` ${cls}` : ''}`, 'aria-hidden': 'true' }, text);

/* Now: Watching and Reading as poster shelves -------------------------------- */

function posterNow(e) {
  const m = e.media;
  const anime = isAnime(e.type);
  const title = m.title.userPreferred;
  const total = (anime ? m.episodes : m.chapters) || null;
  const progress = e.progress || 0;
  const done = e.status === 'COMPLETED';
  const busy = state.busy.has(e.id);
  const fresh = anime ? newCount(e) : 0;
  const next = progress + 1;
  const airing = anime && m.status === 'RELEASING' && m.nextAiringEpisode;
  const waitingForEp = !!airing && next >= airing.episode;
  const canPlus = !done && !(total && next > total) && !waitingForEp;
  // The number under the cover ticks up after a +1, the track fills its next segment.
  const mv = progressMove(e.id, progress);
  const tick = mv.from != null && progress === mv.from + 1;
  const t = trackOf(e);
  let tag = null;
  let tagText = '';
  if (done) { tagText = 'Finished'; tag = glassTag(tagText, 'is-done'); }
  else if (fresh > 0) { tagText = `${fresh} new`; tag = glassTag(tagText, 'is-new'); }
  else if (waitingForEp && airing.airingAt) { tagText = `Episode ${airing.episode} ${soon(airing.airingAt)}`; tag = glassTag(soon(airing.airingAt)); }
  const Unit = anime ? 'Episode' : 'Chapter';
  const said = [title, total ? `${Unit} ${progress} of ${total}` : `${Unit} ${progress}`, tagText].filter(Boolean).join(', ');
  const doLabel = anime ? `Mark episode ${next} of ${title} watched` : `Mark chapter ${next} of ${title} read`;
  const action = canPlus || busy ? h('button', {
    class: 'pc-act js-plus', 'data-f': `p:${e.id}`, disabled: busy, 'aria-label': doLabel, title: anime ? `Mark episode ${next} watched` : `Mark chapter ${next} read`,
    onclick: () => plusOne(e),
  }, busy ? spin() : '+1') : null;
  // On hover, next to +1: "5/26" (4 or more a row: there's no room for words beside the button), "Ep 5 of 26" on
  // big posters (the .v-long / .v-short pieces, chosen by the poster's own width in popup.css).
  const prog = progText(anime, progress, total, tick ? { cls: 'is-tick', style: mv.since ? `animation-delay:-${mv.since}ms` : null } : null);
  return poster({
    e, cls: done ? 'is-done' : '', label: title, said, tag, action,
    band: t.span ? track(t, mv) : null,
    meta: prog,
  });
}

// "32 episodes left" and "12 h 26 min" (Watching), "140 chapters left" (Reading).
function shelfFacts(type) {
  const anime = isAnime(type);
  let left = 0;
  let mins = 0;
  for (const e of state.lists[type].entries) {
    if (e.status === 'COMPLETED') continue;
    const m = e.media;
    const total = anime ? m.episodes : m.chapters;
    const n = total ? Math.max(0, total - (e.progress || 0)) : anime ? newCount(e) : 0;
    left += n;
    if (anime && m.duration) mins += n * m.duration;
  }
  const out = [];
  if (left) out.push(fact(h('b', {}, String(left)), ` ${anime ? 'episode' : 'chapter'}${left === 1 ? '' : 's'} left`));
  if (mins) out.push(fact(duration(mins)));
  return out;
}

/* Now: any of your lists, one kind at a time (0.8.2) --------------------------------------------
   A toolbar on top: Anime | Manga, the list ("Watching ▾", every status and your custom lists, with their
   counts), and at the right three quiet buttons: find in this list, sort, layout. Watching (or Reading) comes
   from the quick request as before (with your rewatches); any other list from FULL_QUERY, asked for once. */

const LIST_STATUSES = ['CURRENT', 'REPEATING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNING'];
const LAYOUTS = [['posters', 'Posters', 'posters'], ['rows', 'Rows', 'rows']];
const SIZE_MIN = 2;   // posters a row: 2 (big, MAL-Sync's size) to 7 (small)
const SIZE_MAX = 7;
const LSORTS = [
  ['updated', 'Last updated'], ['new', 'New episodes'], ['title', 'Title'], ['score', 'Your score'], ['progress', 'Progress'],
  ['added', 'Recently added'], ['release', 'Release date'], ['finished', 'Finished date'], ['priority', 'Priority'],
];
const listKeyOf = (kind) => state.listOf[kind] || 'CURRENT';
const sortKeyOf = (kind, key) => `${kind}/${key}`;
const defaultSort = (key) => (key === 'PLANNING' ? 'priority' : key === 'COMPLETED' ? 'finished' : 'updated');
function sortOf(kind, key) {
  const s = state.lsort[sortKeyOf(kind, key)];
  const ok = s && LSORTS.some(([k]) => k === s.by) && (s.by !== 'new' || kind === 'ANIME');
  return ok ? s : { by: defaultSort(key), rev: false };
}
function listName(kind, key) {
  if (key === 'ALL') return 'All';
  if (key.startsWith('c:')) return key.slice(2);
  return statusWord(kind, key);
}
const keepPref = (k, v) => { try { chrome.storage.local.set({ [k]: v }); } catch { /* ignore */ } };

async function loadFull(kind, { force = false, quiet = false } = {}) {
  const k = `ALL:${kind}`;
  const cached = state.lists[k];
  if (!force && cached && Date.now() - cached.at < 5 * 60 * 1000) return;
  if (state.loading[k]) return;
  state.loading[k] = true;
  if (!quiet) { state.error = null; render(); }
  try {
    const data = await gql(FULL_QUERY, { userId: state.auth.viewer.id, type: kind }, quiet ? 'low' : 'high');
    const col = data.MediaListCollection;
    const fmt = col && col.user && col.user.mediaListOptions && col.user.mediaListOptions.scoreFormat;
    if (fmt) state.scoreFormat = fmt;
    const byId = new Map();
    const lists = [];
    for (const l of (col && col.lists) || []) {
      // AniList splits Completed by format for some people ("Completed TV", "Completed Movie"): one list here.
      const key = l.isCustomList ? `c:${l.name}` : l.status;
      if (!key || key === 'c:') continue;
      let L = lists.find((x) => x.key === key);
      if (!L) lists.push(L = { key, ids: [] });
      for (const e of l.entries || []) {
        if (!byId.has(e.id)) byId.set(e.id, { ...e, type: kind });
        if (!L.ids.includes(e.id)) L.ids.push(e.id);
      }
    }
    const entries = [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    state.lists[k] = { entries, lists, at: Date.now() };
    saveCache();
  } catch (err) {
    if (!quiet) state.error = err.message;
  } finally {
    state.loading[k] = false;
    render();
  }
}

// The titles of one list, as they are now (Watching: the quick list, with rewatches).
function listEntries(kind, key) {
  if (key === 'CURRENT') { const L = state.lists[kind]; return L ? L.entries : null; }
  const F = state.lists[`ALL:${kind}`];
  if (!F) return null;
  if (key === 'ALL') return F.entries;
  const l = F.lists.find((x) => x.key === key);
  if (!l) return [];
  const byId = new Map(F.entries.map((e) => [e.id, e]));
  return l.ids.map((id) => byId.get(id)).filter(Boolean);
}
function listCount(kind, key) {
  if (key === 'CURRENT' && state.lists[kind]) return state.lists[kind].entries.length;
  const F = state.lists[`ALL:${kind}`];
  if (!F) return null;
  if (key === 'ALL') return F.entries.length;
  if (key === 'CURRENT') return new Set(F.lists.filter((x) => x.key === 'CURRENT' || x.key === 'REPEATING').flatMap((x) => x.ids)).size;
  const l = F.lists.find((x) => x.key === key);
  return l ? l.ids.length : 0;
}
// The lists in the menu: All, the statuses that have titles (Watching always), then your custom lists.
function listKeys(kind) {
  const F = state.lists[`ALL:${kind}`];
  const keys = ['CURRENT'];
  for (const st of LIST_STATUSES.slice(1)) if (!F || F.lists.some((l) => l.key === st && l.ids.length)) keys.push(st);
  if (F) for (const l of F.lists) if (l.key.startsWith('c:')) keys.push(l.key);
  return ['ALL', ...keys];
}

// "The Rising of..." files under R; numbers in their natural order ("Part 2" before "Part 10").
const titleKey = (e) => String((e.media && e.media.title && e.media.title.userPreferred) || '').replace(/^(the|a|an)\s+/i, '').replace(/^[^\p{L}\p{N}]+/u, '');
const dateNum = (d) => (d && d.year ? d.year * 10000 + (d.month || 0) * 100 + (d.day || 0) : 0);
function sortList(entries, kind, key) {
  const { by, rev } = sortOf(kind, key);
  const out = [...entries];
  const upd = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
  const known = (x, y, f) => (x && y ? f() : x ? -1 : y ? 1 : 0);   // unknowns last
  const cmp = {
    updated: upd,
    new: (a, b) => newCount(b) - newCount(a) || ((a.media.nextAiringEpisode || {}).airingAt || 9e9) - ((b.media.nextAiringEpisode || {}).airingAt || 9e9) || upd(a, b),
    title: (a, b) => titleKey(a).localeCompare(titleKey(b), undefined, { numeric: true, sensitivity: 'base' }),
    score: (a, b) => known(a.score, b.score, () => b.score - a.score) || upd(a, b),
    progress: (a, b) => (b.progress || 0) - (a.progress || 0) || upd(a, b),
    added: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    release: (a, b) => known(dateNum(a.media.startDate), dateNum(b.media.startDate), () => dateNum(b.media.startDate) - dateNum(a.media.startDate)) || upd(a, b),
    finished: (a, b) => known(dateNum(a.completedAt), dateNum(b.completedAt), () => dateNum(b.completedAt) - dateNum(a.completedAt)) || upd(a, b),
    priority: (a, b) => (b.priority || 0) - (a.priority || 0) || (key === 'PLANNING' ? fineRank(a) - fineRank(b) : 0) || upd(a, b),
  }[by] || upd;
  out.sort(cmp);
  if (rev) out.reverse();
  return out;
}
// The order stays as drawn while you work in a list (a +1 doesn't send a title to the front of "Last
// updated" under your pointer): it's worked out again when the list reloads or the sort changes.
let orderMemo = { sig: null, rank: new Map() };
function steadySort(entries, kind, key) {
  const s = sortOf(kind, key);
  const src = key === 'CURRENT' ? state.lists[kind] : state.lists[`ALL:${kind}`];
  const sig = `${kind}|${key}|${s.by}|${s.rev}|${src ? src.at : 0}`;
  if (orderMemo.sig !== sig) {
    orderMemo = { sig, rank: new Map(sortList(entries, kind, key).map((e, i) => [e.id, i])) };
  }
  const rank = orderMemo.rank;
  const known = entries.filter((e) => rank.has(e.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
  return [...known, ...sortList(entries.filter((e) => !rank.has(e.id)), kind, key)];
}
const findText = (e) => { const t = (e.media && e.media.title) || {}; return [t.userPreferred, t.romaji, t.english, t.native].filter(Boolean).join(' ').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''); };
const findMatch = (q) => { const w = String(q || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim(); return w ? (e) => findText(e).includes(w) : null; };

// The poster for a title in this list: +1 in Watching, Start in Planning, your score once finished.
function posterAny(e, key) {
  const st = key === 'ALL' || key.startsWith('c:') ? e.status : key === 'CURRENT' ? 'CURRENT' : key;
  if (st === 'CURRENT' || st === 'REPEATING') return posterNow(e);
  if (st === 'PLANNING') return posterUp(e);
  return posterRest(e);
}
// Completed, paused, dropped: the cover and where you stopped; no action (the title page has them).
function posterRest(e) {
  const m = e.media;
  const anime = isAnime(e.type);
  const title = m.title.userPreferred;
  const total = (anime ? m.episodes : m.chapters) || null;
  const done = e.status === 'COMPLETED';
  const t = trackOf(e);
  const said = [title, statusWord(e.type, e.status), !done && e.progress ? `${anime ? 'episode' : 'chapter'} ${e.progress}${total ? ` of ${total}` : ''}` : null, e.score ? `your score ${scoreText(e.score)}` : null].filter(Boolean).join(', ');
  const tag = e.repeat > 0 && done ? glassTag(`${anime ? 'Watched' : 'Read'} ${timesWord(e.repeat + 1)}`) : null;
  const meta = done
    ? h('span', { class: 'pc-meta' }, m.format ? h('span', {}, FORMATS[m.format] || m.format) : null, (m.startDate && m.startDate.year) || m.seasonYear ? h('span', {}, String((m.startDate && m.startDate.year) || m.seasonYear)) : null)
    : progText(anime, e.progress || 0, total);
  return poster({ e, cls: 'is-rest', label: title, said, tag, band: !done && t.span ? track(t, {}) : null, meta });
}

// Rows: the cover, the title, where you are and your score, and the one action at the right.
function listRow(e, key) {
  const m = e.media;
  const anime = isAnime(e.type);
  const title = m.title.userPreferred;
  const id = String(e.id);
  const st = key === 'ALL' || key.startsWith('c:') ? e.status : key === 'CURRENT' ? e.status : key;
  const busy = state.busy.has(e.id);
  const total = (anime ? m.episodes : m.chapters) || null;
  const progress = e.progress || 0;
  const watching = st === 'CURRENT' || st === 'REPEATING';
  const fresh = anime && watching ? newCount(e) : 0;
  const next = progress + 1;
  const airing = anime && m.status === 'RELEASING' && m.nextAiringEpisode;
  const canPlus = watching && e.status !== 'COMPLETED' && !(total && next > total) && !(airing && next >= airing.episode);
  const U = anime ? 'Ep' : 'Ch';
  const year = (m.startDate && m.startDate.year) || m.seasonYear;
  const pieces = [];
  if (key === 'ALL' || key.startsWith('c:')) pieces.push(h('span', { class: 'lr-st' }, statusWord(e.type, e.status)));
  if (st === 'PLANNING' || st === 'COMPLETED') {
    if (m.format) pieces.push(h('span', {}, FORMATS[m.format] || m.format));
    if (year) pieces.push(h('span', {}, String(year)));
    if (st === 'PLANNING' && total) pieces.push(h('span', {}, anime ? `${total} ep${total === 1 ? '' : 's'}` : `${total} ch`));
  } else {
    pieces.push(h('span', {}, h('b', {}, `${U} ${progress}`), total ? ` of ${total}` : ''));
    if (fresh) pieces.push(h('span', { class: 'lr-new' }, `${fresh} new`));
  }
  if (st === 'PLANNING' && (e.priority || 0) >= PIN_MIN) pieces.push(h('span', {}, 'Pinned'));
  else if (st === 'PLANNING' && e.priority > 0) pieces.push(h('span', {}, `Priority ${e.priority}`));
  if (e.score) pieces.push(h('span', {}, 'Score ', scoreValue(e.score)));
  let action = null;
  if (watching && (canPlus || busy)) {
    action = h('button', { class: 'lr-act js-plus', 'data-f': `p:${id}`, disabled: busy, 'aria-label': anime ? `Mark episode ${next} of ${title} watched` : `Mark chapter ${next} of ${title} read`, onclick: () => plusOne(e) }, busy ? spin() : '+1');
  } else if (st === 'PLANNING' && e.status === 'PLANNING') {
    action = h('button', { class: 'lr-act is-start js-start', 'data-f': `p:${id}`, disabled: busy, 'aria-label': anime ? `Start watching ${title}` : `Start reading ${title}`, onclick: () => startEntry(e) }, busy ? spin() : [icon('play'), 'Start']);
  }
  const t = watching ? trackOf(e) : null;
  return h('div', { class: 'lr' + (hotId === id ? ' is-hot' : '') + (busy ? ' is-busy' : ''), 'data-id': id, 'data-navfrom': `c:${id}`, role: 'listitem', style: titleStyle(m) },
    h('span', { class: 'lr-cover', style: m.coverImage && m.coverImage.color ? `background-color:${m.coverImage.color}` : null }, cover(thumbUrl(m))),
    h('div', { class: 'lr-text' },
      h('a', { class: 'lr-title', href: m.siteUrl, 'data-nav': '', 'data-f': `c:${id}`, onclick: titleOpener(m.id || e.mediaId, m, `c:${id}`) }, title),
      h('div', { class: 'lr-meta' }, pieces),
      t && t.span ? h('div', { class: 'lr-track' }, track(t, progressMove(e.id, progress))) : null),
    action);
}

// "32 episodes left", "12 h 26 min" (Watching), how many titles and your mean score elsewhere.
function listFacts(kind, key, entries) {
  if (key === 'CURRENT') {
    const f = shelfFacts(kind);
    return [fact(h('b', {}, String(entries.length)), entries.length === 1 ? ' title' : ' titles'), ...f];
  }
  const out = [fact(h('b', {}, String(entries.length)), entries.length === 1 ? ' title' : ' titles')];
  const scored = entries.filter((e) => e.score > 0);
  if (key === 'COMPLETED' && scored.length) {
    const mean = scored.reduce((n, e) => n + e.score, 0) / scored.length;
    out.push(fact('Mean score ', h('b', {}, fmtNow() === 'POINT_10_DECIMAL' || fmtNow() === 'POINT_10' ? mean.toFixed(1) : String(Math.round(mean)))));
  }
  return out;
}

/* The toolbar */
function setListKind(k) {
  if (state.kind === k) return;
  state.kind = k;
  state.kindChosen = true;
  state.lmenu = null;
  state.find = null;
  keepPref('popup:kind', k);
  scrollPos[state.view] = 0;
  render();
  VIEWS[state.view].load();
}
function setList(key) {
  state.listOf = { ...state.listOf, [state.kind]: key };
  state.lmenu = null;
  state.find = null;
  keepPref('popup:list', state.listOf);
  scrollPos.now = 0;
  render();
  if (key !== 'CURRENT') loadFull(state.kind);
  const b = app.querySelector('[data-f="lb:list"]');
  if (b) b.focus({ preventScroll: true });
}
function setSort(by) {
  const k = sortKeyOf(state.kind, listKeyOf(state.kind));
  const cur = sortOf(state.kind, listKeyOf(state.kind));
  state.lsort = { ...state.lsort, [k]: by === 'rev' ? { by: cur.by, rev: !cur.rev } : { by, rev: false } };
  keepPref('popup:lsort', state.lsort);
  if (by !== 'rev') state.lmenu = null;
  scrollPos.now = 0;
  render();
}
function setLayout(v) {
  state.layout = v;
  if (v === 'rows') state.lmenu = null;   // posters: the menu stays open on the size slider
  keepPref('popup:layout', v);
  render();
}
function toggleMenu(which, ev) {
  ev.stopPropagation();
  state.lmenu = state.lmenu === which ? null : which;
  state.lmenuFresh = true;
  if (state.lmenu === 'list') loadFull(state.kind, { quiet: true });
  render();
  if (state.lmenu && ev.detail === 0) { const it = app.querySelector('.lmenu-item.is-on') || app.querySelector('.lmenu-item'); if (it) it.focus(); }
}
function kindSeg() {
  return h('div', { class: 'seg is-small lb-kind', role: 'radiogroup', 'aria-label': 'Anime or manga' },
    [['ANIME', 'Anime'], ['MANGA', 'Manga']].map(([k, label]) => h('button', {
      class: 'seg-btn', role: 'radio', 'aria-checked': String(state.kind === k), 'data-f': `lb:kind:${k}`, onclick: () => setListKind(k),
    }, label)));
}
function lmenu(which, items) {
  return h('div', { class: 'lmenu is-' + which + (state.lmenuFresh ? ' is-opening' : ''), role: 'menu', onclick: (ev) => ev.stopPropagation() }, items);
}
const lmenuItem = (on, label, onclick, f, extra = null, ic = null) => h('button', {
  class: 'lmenu-item' + (on ? ' is-on' : ''), role: 'menuitemradio', 'aria-checked': String(!!on), 'data-f': f, onclick,
}, ic ? icon(ic) : null, h('span', { class: 'lmenu-label' }, label), extra, on ? icon('check') : null);

// Posters or rows, and for posters their size: a slider from small (7 a row) to big (2 a row). The grids follow it
// live while you drag (only their column count changes, no redraw under the pointer); it's kept on release.
const sizeWords = (n) => `${n} a row`;
function applySize(n) {
  for (const g of app.querySelectorAll('.js-size')) g.style.setProperty('--cols', String(fitCols(n)));
  for (const r of app.querySelectorAll('.score-row')) r.remove();
  const out = app.querySelector('.lmenu-size-n');
  if (out) out.textContent = sizeWords(fitCols(n));
}
function sizeSlider() {
  const range = h('input', {
    class: 'lmenu-range', type: 'range', min: String(SIZE_MIN), max: String(SIZE_MAX), step: '1', value: String(SIZE_MIN + SIZE_MAX - state.size),
    'data-f': 'lm:size', 'aria-label': 'Poster size', 'aria-valuetext': sizeWords(fitCols(state.size)),
  });
  const cols = () => SIZE_MIN + SIZE_MAX - Number(range.value);
  range.addEventListener('input', () => { state.scoreOpen = null; applySize(cols()); range.setAttribute('aria-valuetext', sizeWords(fitCols(cols()))); });
  range.addEventListener('change', () => { state.size = cols(); keepPref('popup:size', state.size); render(); });
  return h('div', { class: 'lmenu-size', role: 'group', 'aria-label': 'Poster size' },
    h('div', { class: 'lmenu-size-top' }, h('span', { class: 'lmenu-size-label' }, 'Size'), h('span', { class: 'lmenu-size-n' }, sizeWords(fitCols(state.size)))),
    h('div', { class: 'lmenu-size-row' }, icon('small'), range, icon('posters')));
}
function layoutButton() {
  const cur = LAYOUTS.find((l) => l[0] === state.layout) || LAYOUTS[0];
  return h('div', { class: 'lb-wrap' },
    h('button', { class: 'lb-icon', 'data-f': 'lb:layout', 'aria-haspopup': 'menu', 'aria-expanded': String(state.lmenu === 'layout'), 'aria-label': `Layout: ${cur[1]}`, title: 'Layout', onclick: (ev) => toggleMenu('layout', ev) }, icon(cur[2])),
    state.lmenu === 'layout' ? lmenu('layout', [...LAYOUTS.map(([k, label, ic]) => lmenuItem(state.layout === k, label, () => setLayout(k), `lm:layout:${k}`, null, ic)),
      state.layout === 'posters' ? [h('div', { class: 'lmenu-sep', role: 'separator' }), sizeSlider()] : null]) : null);
}

function listBar() {
  const kind = state.kind;
  const key = listKeyOf(kind);
  const name = listName(kind, key);
  const n = listCount(kind, key);
  const s = sortOf(kind, key);
  const loadingAll = !!state.loading[`ALL:${kind}`] && !state.lists[`ALL:${kind}`];
  const listMenu = state.lmenu === 'list' ? lmenu('list', [
    ...listKeys(kind).map((k, i) => [
      k.startsWith('c:') && !listKeys(kind)[i - 1].startsWith('c:') ? h('div', { class: 'lmenu-sep', role: 'separator' }) : null,
      lmenuItem(k === key, listName(kind, k), () => setList(k), `lm:list:${k}`, listCount(kind, k) != null ? h('span', { class: 'lmenu-n' }, String(listCount(kind, k))) : null)]),
    loadingAll ? h('div', { class: 'lmenu-wait' }, spin(), 'Your other lists') : null]) : null;
  const sortMenu = state.lmenu === 'sort' ? lmenu('sort', [
    ...LSORTS.filter(([k]) => k !== 'new' || kind === 'ANIME').map(([k, label]) => lmenuItem(s.by === k, label, () => setSort(k), `lm:sort:${k}`)),
    h('div', { class: 'lmenu-sep', role: 'separator' }),
    h('button', { class: 'lmenu-item is-switch', role: 'menuitemcheckbox', 'aria-checked': String(!!s.rev), 'data-f': 'lm:sort:rev', onclick: () => setSort('rev') },
      h('span', { class: 'lmenu-label' }, 'Reverse order'), h('span', { class: 'tp-switch' + (s.rev ? ' is-on' : ''), 'aria-hidden': 'true' }))]) : null;
  const finding = state.find != null;
  const findBox = finding ? h('div', { class: 'lb-find' }, icon('search'), (() => {
    const box = h('input', { class: 'lb-find-input', type: 'text', value: state.find, placeholder: `Find in ${name}`, 'aria-label': `Find a title in ${name}`, 'data-f': 'lb:find', autocomplete: 'off', spellcheck: 'false' });
    box.addEventListener('input', () => { state.find = box.value; scrollPos.now = 0; render(); });
    box.addEventListener('compositionstart', () => { composing = true; });
    box.addEventListener('compositionend', () => { composing = false; state.find = box.value; render(); });
    box.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeFind(); } });
    return box;
  })(), h('button', { class: 'lb-find-x', 'data-f': 'lb:find-x', 'aria-label': 'Stop finding', onclick: closeFind }, icon('close'))) : null;
  return h('div', { class: 'lbar' + (finding ? ' is-finding' : '') },
    kindSeg(),
    h('div', { class: 'lb-wrap' },
      h('button', { class: 'lb-list', 'data-f': 'lb:list', 'aria-haspopup': 'menu', 'aria-expanded': String(state.lmenu === 'list'), 'aria-label': `List: ${name}. Change it`, onclick: (ev) => toggleMenu('list', ev) },
        h('span', { class: 'lb-list-name' }, name), n != null ? h('span', { class: 'lb-list-n' }, String(n)) : null, icon('down')),
      listMenu),
    findBox || h('button', { class: 'lb-icon lb-findbtn', 'data-f': 'lb:findbtn', 'aria-label': `Find a title in ${name}`, title: 'Find in this list', onclick: openFind }, icon('search')),
    h('div', { class: 'lb-wrap' },
      h('button', { class: 'lb-icon' + (s.by !== defaultSort(key) || s.rev ? ' is-set' : ''), 'data-f': 'lb:sort', 'aria-haspopup': 'menu', 'aria-expanded': String(state.lmenu === 'sort'), 'aria-label': `Sort: ${(LSORTS.find((x) => x[0] === s.by) || [0, ''])[1]}${s.rev ? ', reversed' : ''}`, title: 'Sort', onclick: (ev) => toggleMenu('sort', ev) }, icon('sort')),
      sortMenu),
    layoutButton());
}
function openFind() {
  state.find = '';
  state.lmenu = null;
  render();
  const b = app.querySelector('.lb-find-input');
  if (b) b.focus();
}
function closeFind() {
  state.find = null;
  render();
  const b = app.querySelector('[data-f="lb:findbtn"]');
  if (b) b.focus({ preventScroll: true });
}

// Lists laid out your way: posters (2 to 7 a row, the size slider) or rows.
function laidOut(entries, card, key, cls = '') {
  if (state.layout === 'rows') return h('div', { class: `lrows${cls ? ` ${cls}` : ''}`, role: 'list' }, entries.map((e) => listRow(e, key)));
  return grid(entries, state.size, card, `js-size${cls ? ` ${cls}` : ''}`);
}

function nowView() {
  const kind = state.kind;
  const key = listKeyOf(kind);
  const name = listName(kind, key);
  const all = listEntries(kind, key);
  const out = [listBar()];
  if (!all) { out.push(h('div', { class: 'lbody' }, state.layout === 'rows' ? skeletonRows(6) : skeletonGrid(state.size * 2, state.size))); return out; }
  const match = findMatch(state.find);
  const ordered = steadySort(all, kind, key);
  const shown = match ? ordered.filter(match) : ordered;
  const facts = listFacts(kind, key, all);
  if (match) facts.unshift(fact(h('b', {}, String(shown.length)), ` of ${all.length} match`));
  out.push(h('div', { class: 'lfacts' }, match ? facts.slice(0, 1) : facts));
  if (!all.length) {
    const anime = isAnime(kind);
    out.push(key === 'CURRENT'
      ? empty('inbox', `Nothing in ${name}`, `Start a title from Up Next and it shows up here, with your progress on its cover.`, railOn('upnext') ? h('button', { class: 'btn', onclick: () => go('upnext') }, 'Go to Up Next') : null)
      : empty('inbox', `Nothing in ${name}`, `Your ${anime ? 'anime' : 'manga'} ${key.startsWith('c:') ? 'custom list' : 'list'} ${name} is empty.`));
    return out;
  }
  if (!shown.length) { out.push(empty('search', 'No match', `No title in ${name} matches “${state.find.trim()}”.`)); return out; }
  out.push(h('div', { class: 'lbody' }, laidOut(shown, (e) => posterAny(e, key), key)));
  return out;
}

/* Up Next: pins as larger posters, then Planning by priority ---------------- */

const FORMATS = { TV: 'TV', TV_SHORT: 'TV short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music', MANGA: 'Manga', NOVEL: 'Light novel', ONE_SHOT: 'One shot' };

function posterUp(e) {
  const m = e.media;
  const anime = e.type === 'ANIME';
  const title = m.title.userPreferred;
  const busy = state.busy.has(e.id);
  const started = e.status !== 'PLANNING';
  const total = anime ? m.episodes : m.chapters;
  const pinned = (e.priority || 0) >= PIN_MIN;
  let tag = null;
  // Started from here: it stays where it was until Up Next reloads, labelled (0.8.3: no text under covers).
  if (started) tag = glassTag(anime ? 'Watching' : 'Reading', 'is-started');
  else if (pinned) tag = h('span', { class: 'pc-tag is-pin', 'aria-hidden': 'true' }, icon('pin'));
  else if (e.priority > 0) tag = h('span', { class: 'pc-tag is-prio', 'aria-hidden': 'true' }, glyph(), String(e.priority));
  const fmt = m.format ? FORMATS[m.format] || m.format : null;
  const count = total ? (anime ? `${total} ep${total === 1 ? '' : 's'}` : `${total} ch`) : null;
  const notOut = m.status === 'NOT_YET_RELEASED';
  const said = [title, pinned ? 'pinned' : e.priority > 0 ? `priority ${e.priority}` : null, fmt, count, notOut ? 'not out yet' : null, started ? (anime ? 'watching' : 'reading') : null].filter(Boolean).join(', ');
  const label = anime ? `Start watching ${title}` : `Start reading ${title}`;
  const action = !started || busy ? h('button', {
    class: 'pc-act is-start js-start', 'data-f': `p:${e.id}`, disabled: busy, 'aria-label': label, title: anime ? 'Start watching' : 'Start reading',
    onclick: () => startEntry(e),
  }, busy ? spin() : [icon('play'), h('span', { class: 'v-long' }, 'Start')]) : null;
  const meta = started
    ? h('span', { class: 'pc-state' }, anime ? 'Watching' : 'Reading')
    : h('span', { class: 'pc-meta' }, fmt ? h('span', { class: 'v-long' }, fmt) : null, notOut ? h('span', {}, 'Not out yet') : count ? h('span', {}, count) : null);
  return poster({ e, cls: started ? 'is-started' : '', label: title, said, tag, action, meta });
}

// One kind at a time (0.8.2), like Now: the pins stay big posters, Planning follows the layout you picked.
function upNextView() {
  const l = state.lists.UPNEXT;
  const kind = state.kind;
  const bar = h('div', { class: 'lbar' }, kindSeg(), h('span', { class: 'lb-fill' }), layoutButton());
  if (!l) return [bar, section('Planning', null, skeletonGrid(8))];
  const entries = l.entries.filter((e) => (e.type || 'ANIME') === kind);
  const page = `${myUrl()}/${kind === 'MANGA' ? 'mangalist' : 'animelist'}/Planning`;
  if (!entries.length) {
    return [bar, section('Planning', null, empty('list', 'Planning is empty', `Add ${kind === 'MANGA' ? 'manga' : 'anime'} to Planning on AniList and they show up here, highest priority first, ready to start.`,
      h('button', { class: 'btn', onclick: () => open(page) }, icon('external'), 'Open Planning on AniList')))];
  }
  const isPin = (e) => (e.pin != null ? e.pin : (e.priority || 0) >= PIN_MIN);
  const pins = entries.filter(isPin);
  const rest = entries.filter((e) => !isPin(e));
  const shown = rest.slice(0, UPNEXT_MAX);
  const out = [bar];
  // The pins as the other posters, same size and layout (0.12.1: a size bigger made them huge on big posters).
  if (pins.length) out.push(section('Pinned', null, laidOut(pins, posterUp, 'PLANNING', 'is-pins')));
  if (rest.length) {
    out.push(section('Planning', [fact(h('b', {}, String(rest.length)), rest.length === 1 ? ' title' : ' titles'), fact('Highest priority first')],
      [laidOut(shown, posterUp, 'PLANNING'),
        rest.length > shown.length ? h('button', { class: 'more', onclick: () => open(page) }, `${rest.length - shown.length} more on AniList`, icon('external')) : null]));
  }
  return out;
}

/* Today: a timeline of today's episodes ----------------------------------- */

function todayRow(it) {
  const m = it.media;
  const watching = ((state.lists.ANIME && state.lists.ANIME.entries) || []).find((e) => e.mediaId === it.mediaId);
  const aired = it.airingAt * 1000 <= Date.now();
  const seen = !!watching && (watching.progress || 0) >= it.episode;
  const meta = [h('span', {}, `Ep ${it.episode}${m.episodes ? ` of ${m.episodes}` : ''}`)];
  if (seen) meta.push(h('span', { class: 'done' }, 'Watched'));
  else if (aired) meta.push(h('span', { class: 'new' }, 'Out now'));
  else meta.push(h('span', {}, soon(it.airingAt)));
  if (!watching) meta.push(h('span', { class: 'quiet' }, 'Planning'));
  const canPlus = !!watching && aired && !seen && watching.status !== 'COMPLETED';
  const busy = !!watching && state.busy.has(watching.id);
  const n = watching ? (watching.progress || 0) + 1 : it.episode;
  const title = m.title.userPreferred;
  return h('div', { class: 'tl-row ' + (seen ? 'is-seen' : aired ? 'is-out' : 'is-later'), 'data-id': it.id, 'data-navfrom': `t:${it.id}`, role: 'listitem', style: titleStyle(m) },
    h('time', { class: 'tl-time', datetime: new Date(it.airingAt * 1000).toISOString() }, clock(it.airingAt)),
    h('span', { class: 'tl-node', 'aria-hidden': 'true' }),
    h('a', { class: 'tl-cover', href: m.siteUrl, tabindex: '-1', 'aria-hidden': 'true', onclick: titleOpener(it.mediaId, { type: 'ANIME', ...m }, `t:${it.id}`), style: m.coverImage && m.coverImage.color ? `background-color:${m.coverImage.color}` : null }, cover(thumbUrl(m))),
    h('div', { class: 'tl-text' },
      h('a', { class: 'tl-title', href: m.siteUrl, 'data-nav': '', 'data-f': `t:${it.id}`, onclick: titleOpener(it.mediaId, { type: 'ANIME', ...m }, `t:${it.id}`) }, title),
      h('div', { class: 'tl-meta' }, meta)),
    canPlus || busy ? h('button', {
      class: 'tl-plus js-plus', 'data-f': `tp:${it.id}`, disabled: busy, 'aria-label': `Mark episode ${n} of ${title} watched`, title: `Mark episode ${n} watched`,
      onclick: () => plusOne(watching),
    }, busy ? spin() : '+1') : null);
}

function todayView() {
  const l = state.lists.TODAY;
  const day = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const link = headLink('Airing schedule', 'https://anilist.co/airing');
  if (!l) return [section('Today', [fact(day)], skeletonRows(), link)];
  if (!l.items.length) {
    return [section('Today', [fact(day)], empty('calendar', 'Nothing airing today', "Episodes of shows you're watching or planning show up here on the day they air."), link)];
  }
  const now = Date.now() / 1000;
  const rows = [];
  let placed = false;
  const nowLine = () => h('div', { class: 'tl-now', 'aria-hidden': 'true' }, h('span', { class: 'tl-now-label' }, 'Now'), h('span', { class: 'tl-now-node' }), h('span', { class: 'tl-now-line' }));
  for (const it of l.items) {
    if (!placed && it.airingAt > now) { rows.push(nowLine()); placed = true; }
    rows.push(todayRow(it));
  }
  if (!placed) rows.push(nowLine());
  const n = l.items.length;
  return [section('Today', [fact(day), fact(h('b', {}, String(n)), n === 1 ? ' episode' : ' episodes')], h('div', { class: 'tl', role: 'list' }, rows), link)];
}

/* Notifications ------------------------------------------------------------ */

function notifText(n) {
  const who = n.user ? n.user.name : '';
  const title = n.media && n.media.title ? n.media.title.userPreferred : '';
  if (n.type === 'AIRING' && n.contexts) {
    const c = n.contexts;
    return [c[0] || 'Episode ', h('b', {}, String(n.episode)), c[1] || ' of ', h('b', {}, title), c[2] || ' aired.'];
  }
  if (who) return [h('b', {}, who), n.context || '', n.thread ? h('b', {}, n.thread.title) : null];
  if (n.type === 'MEDIA_DELETION') return [h('b', {}, n.deletedMediaTitle || 'A title'), n.context || ' was deleted.'];
  if (title) return [h('b', {}, title), n.context || ''];
  return [n.context || 'New notification'];
}

function notifLink(n) {
  if (n.activityId) return `https://anilist.co/activity/${n.activityId}`;
  if (n.thread) return `https://anilist.co/forum/thread/${n.thread.id}${n.commentId ? `/comment/${n.commentId}` : ''}`;
  if (n.media && n.media.siteUrl) return n.media.siteUrl;
  if (n.user) return `https://anilist.co/user/${n.user.name}`;
  return 'https://anilist.co/notifications';
}

function notifsView() {
  const N = state.notifs || {};
  const facts = N.items && N.fresh ? [fact(h('b', {}, String(Math.min(N.fresh, N.items.length))), ' new')] : [];
  const link = headLink('Open on AniList', 'https://anilist.co/notifications');
  if (!N.items) return [section('Notifications', facts, skeletonRows(), link)];
  if (!N.items.length) return [section('Notifications', facts, empty('bell', 'No notifications', 'Replies, likes, follows and new episodes from AniList show up here.'), link)];
  const items = N.items.filter((n) => n && n.id).map((n, i) => {
    const img = n.user ? n.user.avatar && n.user.avatar.medium : n.media && n.media.coverImage && n.media.coverImage.medium;
    return h('a', {
      class: 'notif' + (i < (N.fresh || 0) ? ' is-new' : ''), href: notifLink(n), role: 'listitem', 'data-nav': '', 'data-f': `n:${n.id}`,
      onclick: opener(notifLink(n)),
    },
    h('span', { class: 'notif-img' + (n.user ? ' is-user' : '') }, img ? cover(img) : icon('bell')),
    h('span', { class: 'notif-text' }, ...notifText(n),
      h('time', { class: 'notif-time', datetime: new Date(n.createdAt * 1000).toISOString(), title: exactTime(n.createdAt * 1000) }, ago(n.createdAt * 1000))));
  });
  return [section('Notifications', facts, h('div', { class: 'nlist', role: 'list' }, items), link)];
}

/* Title pages (0.6.8) ----------------------------------------------------------------------- */
// Click a poster (or a row in Today, or a related title): everything about that title on a page
// of its own, over the section you came from. A header in the cover's color, your entry editable
// in place (each change has Undo in the toast), then Overview and Watch order. Back or Esc goes
// back to where you were, scrolled as you left it.

const topPage = () => (state.stack.length ? state.stack[state.stack.length - 1] : null);
const titleName = (T) => { const m = T && (T.media || T.base); return (m && m.title && m.title.userPreferred) || ''; };
const relEdges = (T) => ((T && T.media && T.media.relations && T.media.relations.edges) || []).filter((ed) => ed && ed.node);
const recNodes = (T) => ((T && T.media && T.media.recommendations && T.media.recommendations.nodes) || []).map((r) => r && r.mediaRecommendation).filter(Boolean);
// Every other title a page shows with your status on it: its relations and recommendations.
const pageNodes = (T) => [...relEdges(T).map((ed) => ed.node), ...recNodes(T)];
// Every title the popup shows with your status on it: those of the title pages, and search results.
const shownNodes = () => [...Object.values(state.titles).flatMap(pageNodes), ...searchNodes()];

// A click on a cover or a title: its page here. With Ctrl, Cmd or Shift: its AniList page in a tab.
const titleOpener = (mediaId, base, from) => (ev) => {
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey || ev.shiftKey) { if (base && base.siteUrl) open(base.siteUrl); return; }
  openTitle(mediaId, base, from);
};

// The entry the sections already hold for a title (so a change shows there at once).
function entryFor(mediaId) {
  for (const k of ['ANIME', 'MANGA', 'UPNEXT', 'ALL:ANIME', 'ALL:MANGA']) {
    const e = state.lists[k] && state.lists[k].entries.find((x) => x.mediaId === mediaId);
    if (e) return e;
  }
  return null;
}

function closeTransient() {
  state.menu = false;
  state.scoreOpen = null;
  state.statusMenu = false;
  state.confirmRemove = false;
  state.dateEdit = null;
  state.error = null;
}

function openTitle(mediaId, base, from) {
  if (!mediaId) return;
  let T = state.titles[mediaId];
  if (!T) T = state.titles[mediaId] = { mediaId, base: base || null, media: null, entry: undefined, at: 0 };
  else if (base && !T.base) T.base = base;
  const live = entryFor(mediaId);
  if (live) T.entry = live;
  const i = state.stack.findIndex((p) => p.mediaId === mediaId);
  if (i !== -1) state.stack = state.stack.slice(0, i + 1);
  else {
    state.stack.push({ mediaId, from: from || null, details: false, all: {} });
    delete scrollPos[`t:${mediaId}`];
  }
  closeTransient();
  state.focusTitle = true;
  render();
  loadTitle(mediaId);
}

function back() {
  const p = state.stack.pop();
  if (!p) return;
  closeTransient();
  render();
  const el = p.from && app.querySelector(`[data-f="${p.from}"]`);
  if (el) el.focus({ preventScroll: true });
  if (!state.stack.length) VIEWS[state.view].load();
}

async function loadTitle(mediaId, { force = false } = {}) {
  const T = state.titles[mediaId];
  if (!T || T.loading) return;
  if (!force && T.media && Date.now() - T.at < STALE_MS) return;
  T.loading = true;
  T.error = null;
  const started = Date.now();
  render();
  try {
    let d;
    try {
      d = await gql(titleQuery(richTitles), { id: mediaId });
    } catch (err) {
      if (!(richTitles && err.status === 400)) throw err;
      richTitles = false;
      d = await gql(titleQuery(false), { id: mediaId });
    }
    const m = d && d.Media;
    if (!m) throw new Error("AniList doesn't have this title any more");
    const o = d.Viewer && d.Viewer.mediaListOptions;
    if (o) {
      if (o.scoreFormat) state.scoreFormat = o.scoreFormat;
      if (o.animeList && Array.isArray(o.animeList.customLists)) state.customLists.ANIME = o.animeList.customLists.filter(Boolean);
      if (o.mangaList && Array.isArray(o.mangaList.customLists)) state.customLists.MANGA = o.mangaList.customLists.filter(Boolean);
    }
    T.media = m;
    T.at = Date.now();
    T.friends = d.friends && Array.isArray(d.friends.mediaList) ? d.friends.mediaList.filter((x) => x && x.user) : null;
    if (m.reviews) T.reviews = reviewsFrom(m.reviews, T.reviews);
    adoptEntry(T, m.mediaListEntry, started);
    if (T.entry && prioOnFor(T.entry.type, T.entry.status)) loadPins(T.entry.type, T.entry.status);
  } catch (err) {
    T.error = err.message;
  } finally {
    T.loading = false;
    render();
  }
  if (T.media && T.at >= started) { loadPeople(T); loadHistory(T); loadOutside(T); }
}

/* Characters and staff: the people a page shows, and what else of yours they're in ---------- */

// AniList's stand-in picture for people without one ("default.jpg"): their initials instead.
const realPhoto = (p) => { const u = p && p.image && (p.image.large || p.image.medium); return u && !/\/default\.(jpe?g|png|gif)$/i.test(u) ? u : null; };
const personName = (p) => (p && p.name && p.name.userPreferred) || '';
function initials(name) {
  const words = String(name || '').trim().split(/[\s　]+/).filter(Boolean);
  if (!words.length) return '?';
  const first = (w) => Array.from(w)[0] || '';
  return (words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : Array.from(words[0]).slice(0, 2).join('')).toUpperCase();
}

const PEOPLE_COLS = 4;
// The characters a page shows: main ones first (AniList's order), with their Japanese voice actor.
// Folded: one row; "See all": every one AniList sent (25 once the rest has come).
function charactersOf(T, all = false) {
  const edges = ((T.media && T.media.characters && T.media.characters.edges) || []).filter((ed) => ed && ed.node && personName(ed.node));
  return (all ? edges : edges.slice(0, PEOPLE_COLS)).map((ed) => ({ ...ed, va: (ed.voiceActors || []).find((v) => v && personName(v)) || null }));
}

// The main staff first (direction, the original work, script, music...), one card per person with
// every role they had. Episode-by-episode roles ("Key Animation (ep 3)") count for little.
const STAFF_ROLES = [/^director$/i, /^original (creator|story|work)/i, /^story( & art)?$/i, /^art$/i, /^series composition/i, /^(script|screenplay)/i,
  /^music$/i, /^character design/i, /^chief director/i, /^(assistant|co-)?director/i, /^original character design/i, /^animation director/i];
function roleRank(role) {
  const r = String(role || '').trim();
  const i = STAFF_ROLES.findIndex((re) => re.test(r));
  return (i === -1 ? STAFF_ROLES.length : i) + (/\(ep|\(eps|\bep\.? ?\d/i.test(r) ? 20 : 0);
}
function staffOf(T, all = false) {
  const people = new Map();
  for (const ed of (T.media && T.media.staff && T.media.staff.edges) || []) {
    if (!ed || !ed.node || !personName(ed.node)) continue;
    const p = people.get(ed.node.id) || { node: ed.node, roles: [], rank: 99 };
    const role = String(ed.role || '').trim();
    if (role && !p.roles.includes(role)) p.roles.push(role);
    p.rank = Math.min(p.rank, roleRank(role));
    people.set(ed.node.id, p);
  }
  const list = [...people.values()];
  for (const p of list) p.roles.sort((a, b) => roleRank(a) - roleRank(b));
  list.sort((a, b) => a.rank - b.rank);
  return all ? list : list.slice(0, PEOPLE_COLS);
}

// Their other titles on your list: not this one or the ones next to it in its relations, your best
// scores first, Planning last. total: how many there are in all (AniList may have sent only some).
function othersOf(T, conn) {
  const skip = new Set([T.mediaId, ...relEdges(T).map((ed) => ed.node.id)]);
  const seen = new Set();
  const out = [];
  let skipped = 0;
  for (const ed of (conn && conn.edges) || []) {
    const n = ed && ed.node;
    if (!n || !n.mediaListEntry || seen.has(n.id)) continue;
    seen.add(n.id);
    if (skip.has(n.id)) { skipped++; continue; }
    out.push(n);
  }
  const rank = (n) => (n.mediaListEntry.status === 'PLANNING' ? 1 : 0);
  const list = out.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || (b.n.mediaListEntry.score || 0) - (a.n.mediaListEntry.score || 0) || a.i - b.i).map((x) => x.n);
  const total = Math.max(list.length, ((conn && conn.pageInfo && conn.pageInfo.total) || 0) - skipped);
  return { list, total };
}

// Asks, low priority, about the people shown that haven't been asked about yet.
async function loadPeople(T) {
  if (!richTitles || !T.media) return;
  if (!T.people) T.people = { va: {}, st: {}, asked: new Set() };
  const P = T.people;
  const p = state.stack.find((x) => x.mediaId === T.mediaId) || { all: {} };
  const va = [...new Set(charactersOf(T, !!p.all.chars).map((c) => c.va && c.va.id).filter((id) => id && !P.asked.has(`va:${id}`)))].slice(0, 25);
  const st = [...new Set(staffOf(T, !!p.all.staff).map((x) => x.node.id).filter((id) => !P.asked.has(`st:${id}`)))].slice(0, 25);
  if (!va.length && !st.length) return;
  for (const id of va) P.asked.add(`va:${id}`);
  for (const id of st) P.asked.add(`st:${id}`);
  try {
    const vars = {};
    if (va.length) vars.va = va;
    if (st.length) vars.st = st;
    const d = await gql(peopleQuery(va.length, st.length), vars, 'low');
    const pick = (page, key, out) => {
      for (const s of (page && page.staff) || []) if (s && s.id) out[s.id] = othersOf(T, s[key]);
    };
    pick(d && d.va, 'characterMedia', P.va);
    pick(d && d.st, 'staffMedia', P.st);
  } catch { /* the page is complete without them */ }
  render();
}

// "See all" on Characters: the rest of them, then what else of yours their voice actors are in.
async function loadCast(T) {
  if (T.cast) return;
  T.cast = 'loading';
  render();
  try {
    const d = await gql(CAST_QUERY, { id: T.mediaId });
    const c = d && d.Media && d.Media.characters;
    if (c && Array.isArray(c.edges)) T.media.characters = c;
    T.cast = 'done';
  } catch (err) {
    T.cast = null;
    state.error = `Couldn't load the characters: ${err.message}`;
  }
  render();
  loadPeople(T);
}

/* Outside AniList (0.8): MyAnimeList's score and characters, the openings and endings ------------
   Asked through the background (background.js "outside"), only by the title's MyAnimeList number, and
   kept there. When a service doesn't answer, its part simply isn't shown. The "malData" setting (On
   AniList, Titles) turns the characters and songs off, here and on AniList's pages; since 0.12.4 each
   site's score (MyAnimeList's, MangaBaka's, Kitsu's) has its own switch, `scores`. */

const EXT_PARTS = ['info', 'chars', 'themes', 'mb', 'kitsu'];
// MyAnimeList's characters and songs (the "malData" switch); each site's score has its own (0.12.4).
const outsideOn = () => !state.settings || state.settings.malData !== false;
const scoreOn = (k) => !state.settings || !state.settings.scores || state.settings.scores[k] !== false;
// MangaBaka's answer also brings four other sites' scores (MB_FED): it's asked when any of them is on.
const EXT_ON = { info: () => scoreOn('mal'), chars: outsideOn, themes: outsideOn, mb: () => MB_FED.some(scoreOn), kitsu: () => scoreOn('kitsu') };
const malUrl = (T) => {
  const m = T.media;
  const info = T.ext && T.ext.info;
  return (info && info.url) || (m && m.idMal ? `https://myanimelist.net/${m.type === 'MANGA' ? 'manga' : 'anime'}/${m.idMal}` : null);
};
function loadOutside(T) {
  const m = T.media;
  if (!m) return;
  if (!T.ext) T.ext = {};
  for (const what of EXT_PARTS) {
    if (what in T.ext || !EXT_ON[what]()) continue;   // a part switched off is asked for once it's switched on
    // MangaBaka is manga only; Kitsu is found by AniList's own number; the rest by MyAnimeList's.
    const none = what === 'themes' ? m.type === 'MANGA' : what === 'mb' ? m.type !== 'MANGA' : what === 'kitsu' ? false : !m.idMal;
    if (none) { T.ext[what] = null; continue; }
    if (SCORE_PARTS.includes(what)) holdScores(T);
    T.ext[what] = undefined;   // asked
    send({ type: 'outside', what, kind: m.type, mal: m.idMal || null, al: m.id }).then((r) => {
      T.ext[what] = r && r.ok ? r.data : null;
      if (state.stack.some((p) => p.mediaId === T.mediaId)) render();
    }, () => { T.ext[what] = null; });
  }
}

/* Reviews (0.8): AniList's own, the most helpful first; one unfolds in place --------------------- */

function reviewsFrom(conn, was) {
  const list = (conn.nodes || []).filter((r) => r && r.id && r.summary);
  const info = conn.pageInfo || {};
  const keep = was && was.list.length > list.length ? was : null;   // "Show more" already brought more
  if (keep) return keep;
  return { list, total: info.total || list.length, page: 1, more: !!info.hasNextPage, loading: false, open: (was && was.open) || null, bodies: (was && was.bodies) || {}, spoil: (was && was.spoil) || {} };
}
async function moreReviews(T) {
  const R = T.reviews;
  if (!R || R.loading || !R.more) return;
  R.loading = true;
  render();
  try {
    const d = await gql(reviewsQuery(R.page + 1), { id: T.mediaId });
    const c = d && d.Media && d.Media.reviews;
    if (c) {
      const have = new Set(R.list.map((r) => r.id));
      R.list = R.list.concat((c.nodes || []).filter((r) => r && r.id && r.summary && !have.has(r.id)));
      R.page += 1;
      R.more = !!(c.pageInfo && c.pageInfo.hasNextPage);
      if (c.pageInfo && c.pageInfo.total) R.total = c.pageInfo.total;
    }
  } catch (err) {
    state.error = `Couldn't load more reviews: ${err.message}`;
  }
  R.loading = false;
  render();
}
async function toggleReview(T, id) {
  const R = T.reviews;
  if (!R) return;
  R.open = R.open === id ? null : id;
  render();
  if (R.open !== id || R.bodies[id]) return;
  R.bodies[id] = 'loading';
  render();
  try {
    const d = await gql(REVIEW_QUERY, { id });
    R.bodies[id] = (d && d.Review && d.Review.body) || '';
  } catch (err) {
    R.bodies[id] = { error: err.message };
  }
  render();
}

/* Your history: the rewatch log, rebuilt from your activity (the rules of content/history.js) ---- */
// Activity is read for one title at a time, only for titles you've finished or are rewatching, and
// kept (local "hist:v1", shared with AniList's pages) until that title changes, a week at most.

const HIST_KEY = 'hist:v1';
const HIST_TTL = 7 * 24 * 3600 * 1000;
const HIST_MAX = 300;
const HIST_PAGES = 6;
const hasHistory = (e) => !!e && (e.status === 'COMPLETED' || e.status === 'REPEATING' || e.repeat > 0);
const historySig = (e) => `${e.status}|${e.progress || 0}|${e.repeat || 0}`;

async function loadHistory(T, force = false) {
  const e = T.entry;
  if (!state.history || !hasHistory(e)) return;
  const sig = historySig(e);
  if (!force && T.hist && T.hist.sig === sig && T.hist.state !== 'error') return;
  const h0 = { sig, state: 'loading', log: null };
  T.hist = h0;
  try {
    let acts = null;
    const cache = (await chrome.storage.local.get(HIST_KEY))[HIST_KEY] || {};
    const c = cache[T.mediaId];
    if (c && c.sig === sig && Date.now() - c.t < HIST_TTL && Array.isArray(c.acts)) acts = c.acts;
    if (!acts) {
      acts = [];
      for (let page = 1; page <= HIST_PAGES; page++) {
        const d = await gql(ACTIVITY_QUERY, { userId: state.auth.viewer.id, mediaId: T.mediaId, page }, 'low');
        const pg = (d && d.Page) || {};
        for (const a of pg.activities || []) if (a && a.status && a.createdAt) acts.push([a.createdAt, String(a.status)]);
        if (!(pg.pageInfo && pg.pageInfo.hasNextPage)) break;
      }
      acts.sort((a, b) => a[0] - b[0]);
      // Read the cache again before saving: an AniList tab may have added to it meanwhile.
      const now = (await chrome.storage.local.get(HIST_KEY))[HIST_KEY] || {};
      now[T.mediaId] = { t: Date.now(), sig, acts };
      const keys = Object.keys(now);
      if (keys.length > HIST_MAX) keys.sort((a, b) => now[a].t - now[b].t).slice(0, keys.length - HIST_MAX).forEach((k) => delete now[k]);
      chrome.storage.local.set({ [HIST_KEY]: now });
    }
    if (T.hist !== h0) return;
    h0.log = buildLog(acts, e);
    h0.state = 'ok';
  } catch {
    if (T.hist === h0) h0.state = 'error';
  }
  render();
}

// What an activity says happened, from AniList's wording (anime and manga).
function activityKind(text) {
  const s = String(text || '').toLowerCase().trim();
  if (/re-?watch|re-?read/.test(s)) return /episode|chapter/.test(s) ? 'reprogress' : 'recomplete';
  if (/complet/.test(s)) return 'complete';
  if (/drop/.test(s)) return 'drop';
  if (/paus/.test(s)) return 'pause';
  if (/plan/.test(s)) return 'plan';
  if (/watch|read/.test(s)) return 'progress';
  return null;
}
function dayOf(t) {
  const d = new Date(t * 1000);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}
const fuzzyDate = (d) => {
  const n = (v) => (Number.isInteger(v) && v > 0 ? v : null);
  return { year: n(d && d.year), month: n(d && d.month), day: n(d && d.day) };
};

// Activity into watches, oldest first: [{ kind: 'first' | 'rewatch' | 'try', n, start, end, state }]
// ('try': a first watch you dropped, then started over); state: 'done', 'now', 'dropped', 'paused'
// or 'stopped'. A copy of content/history.js, buildLog: change both together.
function buildLog(acts, entry) {
  const runs = [];
  let cur = null;
  const finished = () => runs.some((r) => r.state === 'done');
  const begin = (kind, d) => {
    if (kind === 'first') for (const r of runs) if (r.kind === 'first') r.kind = 'try';
    cur = { kind, start: d, end: null, state: 'now' };
    runs.push(cur);
  };
  for (const [t, text] of acts) {
    const k = activityKind(text);
    const d = dayOf(t);
    if (k === 'reprogress') {
      if (!cur || cur.kind !== 'rewatch') {
        if (cur) cur.state = 'stopped';
        begin('rewatch', d);
      }
    } else if (k === 'progress') {
      if (!cur) begin(finished() ? 'rewatch' : 'first', d);
    } else if (k === 'complete' || k === 'recomplete') {
      if (cur) { cur.end = d; cur.state = 'done'; cur = null; }
      else if (k === 'recomplete' || !finished()) runs.push({ kind: k === 'recomplete' || finished() ? 'rewatch' : 'first', start: null, end: d, state: 'done' });
    } else if (k === 'drop') {
      if (cur) { cur.end = d; cur.state = 'dropped'; cur = null; }
    }
  }
  if (cur) {
    const st = entry.status;
    cur.state = st === 'CURRENT' || (st === 'REPEATING' && cur.kind === 'rewatch') ? 'now' : st === 'COMPLETED' || st === 'REPEATING' ? 'done' : st === 'PAUSED' ? 'paused' : st === 'DROPPED' ? 'dropped' : 'stopped';
  }
  let first = runs.find((r) => r.kind === 'first');
  const seenOnce = entry.status === 'COMPLETED' || entry.status === 'REPEATING' || entry.repeat > 0 || runs.some((r) => r.kind === 'rewatch');
  if (!first && (seenOnce || hasDate(entry.startedAt) || hasDate(entry.completedAt))) {
    first = { kind: 'first', start: null, end: null, state: seenOnce ? 'done' : 'now', before: true };
    runs.unshift(first);
  }
  if (first) {
    if (hasDate(entry.startedAt)) first.start = fuzzyDate(entry.startedAt);
    if (hasDate(entry.completedAt) && first.state === 'done') first.end = fuzzyDate(entry.completedAt);
  }
  if (entry.status === 'REPEATING' && !runs.some((r) => r.kind === 'rewatch' && r.state === 'now')) runs.push({ kind: 'rewatch', start: null, end: null, state: 'now' });
  const found = runs.filter((r) => r.kind === 'rewatch' && r.state === 'done').length;
  const missing = Math.max(0, (entry.repeat || 0) - found);
  let n = missing;
  for (const r of runs) if (r.kind === 'rewatch') r.n = ++n;
  const times = (first && first.state === 'done' ? 1 : 0) + found + missing;
  return { runs, times, missing, now: runs.find((r) => r.state === 'now') || null };
}
const timesWord = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

// Your entry from the title's page, into the copy the sections hold (when there is one).
function adoptEntry(T, raw, started) {
  if (!raw) {
    if (T.entry) { dropEntry(T.entry.id); markStale(); }
    T.entry = null;
    return;
  }
  const fields = { ...raw, customLists: parseCustomLists(raw.customLists) };
  const live = [entryFor(T.mediaId), T.entry].find((x) => x && x.id === raw.id);
  if (!live) {
    T.entry = { ...fields, mediaId: T.mediaId, type: T.media.type, media: T.media };
    return;
  }
  // Saved while this page loaded: what the save sent back is newer.
  const fresh = !state.busy.has(live.id) && !((live.savedAt || 0) > started);
  for (const k of [...FIELD_KEYS, 'updatedAt']) {
    if (fields[k] === undefined || fields[k] === null) continue;
    if (fresh || live[k] === undefined) live[k] = fields[k];
  }
  syncCopies(live);
  T.entry = live;
}

// Takes a removed entry out of the sections and the title pages.
function dropEntry(id) {
  for (const k of ['ANIME', 'MANGA', 'UPNEXT']) {
    const l = state.lists[k];
    if (l) l.entries = l.entries.filter((x) => x.id !== id);
  }
  for (const T of Object.values(state.titles)) if (T.entry && T.entry.id === id) T.entry = null;
  for (const n of shownNodes()) if (n.mediaListEntry && n.mediaListEntry.id === id) n.mediaListEntry = null;
  const u = state.undo.get(id);
  if (u) { clearTimeout(u.timer); state.undo.delete(id); }
}

// Runs fn with this key marked busy, after whatever is already running for it.
async function locked(key, fn) {
  while (inflight.has(key)) await inflight.get(key).catch(() => {});
  const run = (async () => {
    state.busy.add(key);
    render();
    try { return await fn(); } finally { state.busy.delete(key); render(); }
  })();
  inflight.set(key, run);
  try { return await run; } finally { if (inflight.get(key) === run) inflight.delete(key); }
}

/* Edits in place: what you set shows at once (a draft), and saves a moment later. */
const drafts = new Map();        // 'entryId:field' -> the value being saved
const draftTimers = new Map();
function draftOf(e, k) {
  const key = `${e.id}:${k}`;
  return drafts.has(key) ? drafts.get(key) : snap(e, k);
}
function editField(e, k, value, delay = 0) {
  const key = `${e.id}:${k}`;
  drafts.set(key, value);
  clearTimeout(draftTimers.get(key));
  render();
  const run = async () => {
    draftTimers.delete(key);
    const v = drafts.get(key);
    await saveEntry(e, { [k]: v }, { wait: true });
    if (same(drafts.get(key), v)) drafts.delete(key);
    render();
  };
  if (delay) draftTimers.set(key, setTimeout(run, delay));
  else run();
}

/* Status --------------------------------------------------------------------- */

async function setStatus(e, s) {
  state.statusMenu = false;
  render();
  const b = app.querySelector('[data-f="tp:status"]');
  if (b) b.focus({ preventScroll: true });
  if (s === e.status) return;
  if (s === 'REPEATING' && e.status === 'COMPLETED') { startRewatch(e); return; }
  const patch = { status: s, ...(await unpinPatch(e)) };
  const total = isAnime(e.type) ? e.media.episodes : e.media.chapters;
  if (s === 'COMPLETED' && total && (e.progress || 0) < total) patch.progress = total;
  saveEntry(e, patch, { wait: true });
}

/* Rewatch / Reread, like on AniList's pages (content/history.js) ------------------------------- */

// Rewatching (Rereading), back at episode or chapter 0; a pin in Completed leaves. 0.12.1: "Plan a
// rewatch" (a custom list, made when there was none) is gone; the lists it made are left alone.
async function startRewatch(e) {
  return saveEntry(e, { status: 'REPEATING', progress: 0, ...(await unpinPatch(e)) }, { wait: true });
}

/* Priority and pins (AniList's priority field: 1 to 94, pins 95 to 99, as in content/lists.js) ----- */

// Each list's Priorities switch on AniList's pages: on, except Completed and Dropped.
function prioOnFor(type, status) {
  const m = state.sorts[`${type}/${statusWord(type, status).toLowerCase()}`];
  if (m && typeof m.pr === 'boolean') return m.pr;
  if (state.prioFinished) return true;
  return !['COMPLETED', 'DROPPED'].includes(status);
}

const pinLoads = {};
async function loadPins(type, status, force = false, priority = 'low') {
  const key = `${type}/${status}`;
  const c = state.pins[key];
  if (!force && c && Date.now() - c.at < STALE_MS) return c.list;
  if (pinLoads[key]) return pinLoads[key];
  pinLoads[key] = (async () => {
    try {
      const d = await gql(PINS_QUERY, { userId: state.auth.viewer.id, type, status }, priority);
      const list = ((d && d.Page && d.Page.mediaList) || []).filter((x) => (x.priority || 0) >= PIN_MIN);
      state.pins[key] = { list, at: Date.now() };
      return list;
    } catch {
      return null;
    } finally {
      delete pinLoads[key];
      render();
    }
  })();
  return pinLoads[key];
}

function pinRank(e) {
  const c = state.pins[`${e.type}/${e.status}`];
  if (!c) return 0;
  return 1 + c.list.filter((x) => x.id !== e.id && x.priority > (e.priority || 0)).length;
}

async function pinPrevMap() {
  try { return { ...((await chrome.storage.sync.get('pinPrev')).pinPrev || {}) }; } catch { return {}; }
}
async function setPinPrev(mediaId, value) {
  const next = await pinPrevMap();
  if (value == null) delete next[mediaId];
  else next[mediaId] = value;
  try { await chrome.storage.sync.set({ pinPrev: next }); } catch { /* ignore */ }
}

// Several priorities in one request (a pin can move the others down a slot).
async function savePriorities(changes) {
  if (!changes.length) return;
  const vars = {};
  const decl = [];
  const parts = changes.map((c, i) => {
    vars[`id${i}`] = c.id;
    vars[`p${i}`] = c.to;
    decl.push(`$id${i}: Int, $p${i}: Int`);
    return `e${i}: SaveMediaListEntry(id: $id${i}, priority: $p${i}) { id priority }`;
  });
  await gql(`mutation (${decl.join(', ')}) { ${parts.join(' ')} }`, vars);
  for (const c of changes) {
    for (const x of copiesOf(c.id)) { x.priority = c.to; x.savedAt = Date.now(); }
    for (const p of Object.values(state.pins)) for (const x of p.list) if (x.id === c.id) x.priority = c.to;
  }
  markStale();
  saveCache();
}

const pinPlace = (e) => (e.status === 'PLANNING' ? 'Up Next' : `the top of ${statusWord(e.type, e.status)}`);

function pinTitle(e) {
  const name = nameOf(e);
  const key = `${e.type}/${e.status}`;
  return locked(e.id, async () => {
    try {
      const list = await loadPins(e.type, e.status, true, 'high');
      if (!list) throw new Error("AniList didn't answer");
      const pins = list.filter((x) => x.id !== e.id).sort((a, b) => b.priority - a.priority);
      if (pins.length >= PIN_LIMIT) {
        toast(`You can pin up to ${PIN_LIMIT} titles in ${statusWord(e.type, e.status)}. Unpin one first.`, e.media);
        return;
      }
      const prev = Math.min(MAX_PRIORITY, Math.max(0, e.priority || 0));
      const order = [...pins, { id: e.id, mediaId: e.mediaId, priority: e.priority || 0 }];
      const changes = order.map((x, i) => ({ id: x.id, from: x.priority || 0, to: PIN_TOP - i })).filter((c) => c.from !== c.to);
      await setPinPrev(e.mediaId, prev);
      await savePriorities(changes);
      state.pins[key] = { list: order.map((x, i) => ({ ...x, priority: PIN_TOP - i })), at: Date.now() };
      toast(`${name} pinned to ${pinPlace(e)}`, e.media, {
        undo: () => locked(e.id, async () => {
          try {
            await savePriorities(changes.map((c) => ({ id: c.id, to: c.from })));
            await setPinPrev(e.mediaId, null);
            state.pins[key] = { list: pins, at: Date.now() };
            toast(`Undone for ${name}`, e.media);
          } catch (err) { state.error = `Couldn't undo: ${err.message}`; }
        }),
      });
    } catch (err) {
      state.error = `Couldn't pin ${name}: ${err.message}`;
    }
  });
}

function unpinTitle(e) {
  const name = nameOf(e);
  const key = `${e.type}/${e.status}`;
  return locked(e.id, async () => {
    try {
      const prevMap = await pinPrevMap();
      const stored = prevMap[e.mediaId];
      const to = Math.min(MAX_PRIORITY, Math.max(0, Number(stored) || 0));
      const from = e.priority || 0;
      await savePriorities([{ id: e.id, to }]);
      await setPinPrev(e.mediaId, null);
      const c = state.pins[key];
      if (c) c.list = c.list.filter((x) => x.id !== e.id);
      toast(`${name} unpinned`, e.media, {
        undo: () => locked(e.id, async () => {
          try {
            await savePriorities([{ id: e.id, to: from }]);
            await setPinPrev(e.mediaId, stored == null ? null : stored);
            const c2 = state.pins[key];
            if (c2 && !c2.list.some((x) => x.id === e.id)) c2.list.push({ id: e.id, mediaId: e.mediaId, priority: from });
            toast(`Undone for ${name}`, e.media);
          } catch (err) { state.error = `Couldn't undo: ${err.message}`; }
        }),
      });
    } catch (err) {
      state.error = `Couldn't unpin ${name}: ${err.message}`;
    }
  });
}

/* Favourite, add, remove ------------------------------------------------------- */

function toggleFavourite(T, undoing = false) {
  const m = T.media;
  if (!m) return null;
  const name = m.title.userPreferred;
  return locked(`fav:${m.id}`, async () => {
    const was = !!m.isFavourite;
    try {
      await gql(favMutation(m.type), { id: m.id });
      m.isFavourite = !was;
      if (undoing) toast(`Undone for ${name}`, m);
      else toast(was ? `${name} removed from your favourites` : `${name} added to your favourites`, m, { undo: () => toggleFavourite(T, true) });
    } catch (err) {
      state.error = `Couldn't change your favourites: ${err.message}`;
    }
  });
}

// A new entry for a title that isn't on your list (or one being put back by Undo: fresh false). A new NSFW title is
// private from the start when "Keep new ones private" says so (0.12.3, popup-nsfw.js), so nothing of it shows to
// others even for a moment.
async function createEntry(mediaId, fields, { media = null, type = null, fresh = true } = {}) {
  const key = `m:${mediaId}`;
  if (state.busy.has(key)) return null;
  const T = state.titles[mediaId];
  const m = (T && (T.media || T.base)) || media;
  const vars = { mediaId, ...fields };
  return locked(key, async () => {
    try {
      const hide = fresh && fields.private === undefined ? await nsfwAddPrivate({
        set: state.nsfw.set, marks: state.nsfw.marks, mediaId, kind: (m && m.type) || type, media: m,
        fetch: (id) => gql(NSFW_MEDIA_QUERY, { id }).then((d) => d && d.Media),
      }) : null;
      if (hide) vars.private = true;
      const d = await gql(saveMutation(Object.keys(vars)), vars);
      const saved = d && d.SaveMediaListEntry;
      if (!saved || !saved.id) throw new Error("AniList didn't save it");
      if (hide && saved.private) nsfwNoteMade([{ id: mediaId, k: hide }]);
      const entry = {
        ...saved, customLists: parseCustomLists(saved.customLists), mediaId,
        type: (m && m.type) || type || 'ANIME', media: (T && T.media) || media || m, savedAt: Date.now(),
      };
      if (T) T.entry = entry;
      for (const n of shownNodes()) if (n.id === mediaId) n.mediaListEntry = { id: entry.id, status: entry.status, progress: entry.progress || 0, score: entry.score || 0 };
      markStale();
      return entry;
    } catch (err) {
      state.error = `Couldn't add ${(m && m.title && m.title.userPreferred) || 'this title'}: ${err.message}`;
      return null;
    }
  });
}

async function addTitle(mediaId, status, media) {
  const fields = { status };
  if (status === 'CURRENT' && state.autoDates) fields.startedAt = todayDate();
  const entry = await createEntry(mediaId, fields, { media, type: media && media.type });
  if (!entry) return;
  const name = nameOf(entry);
  toast(`${name} added to ${statusWord(entry.type, status)}${entry.private ? ', private' : ''}${fields.startedAt ? ', start date set to today' : ''}`, entry.media, { undo: () => takeBack(entry) });
  render();
}

// Undo of an add: the entry goes again.
function takeBack(entry) {
  return locked(entry.id, async () => {
    try {
      await gql(DELETE_MUTATION, { id: entry.id });
      dropEntry(entry.id);
      markStale();
      toast(`Undone for ${nameOf(entry)}`, entry.media);
    } catch (err) {
      state.error = `Couldn't undo: ${err.message}`;
    }
  });
}

function removeEntry(T) {
  const e = T.entry;
  if (!e) return null;
  const name = nameOf(e);
  const keep = {};
  for (const k of FIELD_KEYS) if (e[k] !== undefined) keep[k] = snap(e, k);
  return locked(e.id, async () => {
    try {
      await gql(DELETE_MUTATION, { id: e.id });
      state.confirmRemove = false;
      dropEntry(e.id);
      markStale();
      saveCache();
      toast(`${name} removed from your list`, e.media, { undo: () => restoreEntry(T.mediaId, keep, e) });
    } catch (err) {
      state.error = `Couldn't remove ${name}: ${err.message}`;
    }
  });
}

// Undo of a remove: the same entry again (AniList gives it a new id; its activity stays as it was).
async function restoreEntry(mediaId, keep, old) {
  const fields = { ...keep };
  if (!fields.notes) delete fields.notes;
  if (fields.customLists && !fields.customLists.length) delete fields.customLists;
  if (!fields.private) delete fields.private;
  if (!fields.hiddenFromStatusLists) delete fields.hiddenFromStatusLists;
  for (const k of ['startedAt', 'completedAt']) if (fields[k] && !hasDate(fields[k])) delete fields[k];
  const entry = await createEntry(mediaId, fields, { media: old.media, type: old.type, fresh: false });
  if (entry) { toast(`Undone for ${nameOf(entry)}`, entry.media); render(); }
}

/* Words ------------------------------------------------------------------------------ */

const STATUS_TEXT = { FINISHED: 'Finished', RELEASING: 'Airing', NOT_YET_RELEASED: 'Not out yet', CANCELLED: 'Cancelled', HIATUS: 'On hiatus' };
const SEASONS = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };
const SOURCES = {
  ORIGINAL: 'Original', MANGA: 'Manga', LIGHT_NOVEL: 'Light novel', VISUAL_NOVEL: 'Visual novel', VIDEO_GAME: 'Video game',
  OTHER: 'Other', NOVEL: 'Novel', DOUJINSHI: 'Doujinshi', ANIME: 'Anime', WEB_NOVEL: 'Web novel', LIVE_ACTION: 'Live action',
  GAME: 'Game', COMIC: 'Comic', MULTIMEDIA_PROJECT: 'Multimedia project', PICTURE_BOOK: 'Picture book',
};
const REL_WORDS = {
  PREQUEL: 'Prequel', SEQUEL: 'Sequel', PARENT: 'Main story', SIDE_STORY: 'Side story', SPIN_OFF: 'Spin-off',
  ALTERNATIVE: 'Alternative', ADAPTATION: 'Adaptation', SOURCE: 'Source', SUMMARY: 'Summary', COMPILATION: 'Compilation',
  CONTAINS: 'Contains', CHARACTER: 'Same characters', OTHER: 'Related',
};
const REL_RANK = ['PREQUEL', 'PARENT', 'SIDE_STORY', 'SUMMARY', 'COMPILATION', 'CONTAINS', 'SEQUEL'];
const MAIN_REL = new Set(REL_RANK);
const sentence = (s) => { const t = String(s || '').replace(/_/g, ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

// TV, 28 episodes, Fall 2023, Finished: separate quiet pieces.
function metaOf(m, type) {
  const anime = isAnime(type);
  const out = [];
  if (m.format) out.push(FORMATS[m.format] || sentence(m.format));
  const n = anime ? m.episodes : m.chapters;
  if (n && !(m.format === 'MOVIE' && n === 1)) out.push(anime ? `${n} episode${n === 1 ? '' : 's'}` : `${n} chapter${n === 1 ? '' : 's'}`);
  const year = m.seasonYear || (m.startDate && m.startDate.year);
  if (anime && m.season && year) out.push(`${SEASONS[m.season] || sentence(m.season)} ${year}`);
  else if (year) out.push(String(year));
  if (m.status) out.push(m.status === 'RELEASING' && !anime ? 'Publishing' : STATUS_TEXT[m.status] || sentence(m.status));
  return out.map((t) => h('span', {}, t));
}

// "#12 highest rated of 2006", "#3 most popular of all time".
function rankWords(r) {
  const what = String(r.context || (r.type === 'RATED' ? 'highest rated' : 'most popular')).replace(/\s*all\s*time\s*$/i, '').trim().toLowerCase();
  if (r.allTime) return `${what} of all time`;
  if (r.season && r.year) return `${what} of ${SEASONS[r.season] || sentence(r.season)} ${r.year}`;
  if (r.year) return `${what} of ${r.year}`;
  return what;
}
function rankingsOf(m) {
  const order = (r) => (r.type === 'RATED' ? 0 : 10) + (r.allTime ? 0 : r.season ? 2 : 1);
  return (m.rankings || []).filter((r) => r && r.rank).sort((a, b) => order(a) - order(b)).slice(0, 4);
}

function airedText(m) {
  const a = dateWords(m.startDate);
  const b = dateWords(m.endDate);
  if (!a) return '';
  if (m.status === 'NOT_YET_RELEASED') return `Starts ${a}`;
  if (m.status === 'RELEASING' || !b) return m.status === 'RELEASING' ? `Since ${a}` : a;
  return a === b ? a : `${a} to ${b}`;
}

// AniList's descriptions carry a little HTML (<br>, <i>, <b>, links). They're read as text: line
// breaks, italics and bold are kept, every other tag is dropped, and nothing from AniList is ever
// handed to the browser as HTML.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function decodeEntities(t) {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, c) => {
    if (c[0] === '#') {
      const n = c[1] === 'x' || c[1] === 'X' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    const v = ENTITIES[c.toLowerCase()];
    return v === undefined ? all : v;
  });
}
function richText(html, opts = {}) {
  if (!html) return [];
  const bits = [];   // { t, i, b, s } pieces of text, and '\n' for line breaks
  let it = 0;
  let bold = 0;
  let spoil = 0;     // inside AniList's spoiler (reviews: <span class='markdown_spoiler'>)
  const spans = [];
  let skip = false;
  let afterBr = false;   // AniList writes a line break as <br> and a newline: one break, not two
  for (const part of String(html).split(/(<[^<>]*>)/)) {
    if (!part) continue;
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)[^>]*>$/i.exec(part);
    if (tag) {
      const close = !!tag[1];
      const name = tag[2].toLowerCase();
      if (name === 'br') { bits.push('\n'); afterBr = true; continue; }
      else if (name === 'p' || name === 'div' || name === 'hr' || name === 'blockquote' || name === 'ul' || name === 'ol') bits.push('\n', '\n');
      else if (/^h[1-6]$/.test(name)) { bits.push('\n', '\n'); bold = Math.max(0, bold + (close ? -1 : 1)); }
      else if (name === 'li') { if (!close) bits.push('\n', { t: '• ', i: false, b: false, s: spoil > 0 }); }
      else if (name === 'span' && opts.spoilers) {
        if (close) { if (spans.pop()) spoil = Math.max(0, spoil - 1); }
        else { const sp = /markdown_spoiler/.test(part); spans.push(sp); if (sp) spoil++; }
      }
      else if (name === 'i' || name === 'em') it = Math.max(0, it + (close ? -1 : 1));
      else if (name === 'b' || name === 'strong') bold = Math.max(0, bold + (close ? -1 : 1));
      else if (name === 'script' || name === 'style') skip = !close;
      continue;
    }
    if (skip) continue;
    decodeEntities(part).split('\n').forEach((t, k) => {
      if (k) { if (afterBr) afterBr = false; else bits.push('\n'); }
      if (t.trim()) afterBr = false;
      if (t) bits.push({ t, i: it > 0, b: bold > 0, s: spoil > 0 });
    });
  }
  // One line break: a new line. Two or more: a new paragraph.
  const paras = [[]];
  for (let k = 0; k < bits.length; k++) {
    if (bits[k] !== '\n') { paras[paras.length - 1].push(bits[k]); continue; }
    let run = 0;
    while (bits[k] === '\n') { run++; k++; }
    k--;
    if (run > 1) paras.push([]);
    else paras[paras.length - 1].push('\n');
  }
  const blank = (x) => x === '\n' || !x.t.trim();
  return paras
    .map((p) => { while (p.length && blank(p[0])) p.shift(); while (p.length && blank(p[p.length - 1])) p.pop(); return p; })
    .filter((p) => p.length)
    .map((p) => h('p', {}, p.map((x) => {
      if (x === '\n') return h('br');
      const el = x.i && x.b ? h('i', {}, h('b', {}, x.t)) : x.i ? h('i', {}, x.t) : x.b ? h('b', {}, x.t) : x.t;
      return x.s ? h('span', { class: 'rv-spoil', title: 'Spoiler: click to show' }, el) : el;
    })));
}

/* Drawing a title page ------------------------------------------------------------------------- */
// The title first (0.6.8.1): the header, your entry in two lines with its details folded, then one
// scroll of sections (description, watch order, characters, staff, more like this, where to watch,
// your history, details), each a quiet heading and one row, with "See all".

function titleView(p) {
  const T = state.titles[p.mediaId];
  const m = T.media || T.base || {};
  const e = T.entry;
  const type = m.type || (e && e.type) || 'ANIME';
  const name = titleName(T);
  const banner = bannerOf(T);
  const out = [titleBar(T, m, name), banner ? h('div', { class: 'tp-banner', 'aria-hidden': 'true' }, cover(banner, false)) : null, titleHead(T, m, type, name)];
  if (T.error && !T.media) {
    out.push(empty('alert', "Couldn't load this title", T.error, h('button', { class: 'btn', 'data-f': 'tp:retry', onclick: () => loadTitle(p.mediaId, { force: true }) }, 'Try again')));
    return out;
  }
  out.push(entrySection(T, p, m, e, type));
  if (!T.media) { out.push(h('div', { class: 'tp-body' }, skelLines(4))); return out; }
  // Each section can be switched off (Settings, Popup, 0.12.5); Your history follows the Rewatch log switch.
  const on = state.settings.tpSecs;
  const parts = [on.desc && descBlock(T), on.order && orderSection(T, p), on.friends && friendsSection(T, p), on.chars && charactersSection(T, p),
    on.staff && staffSection(T, p), on.songs && songsSection(T, p), on.recs && recsSection(T, p),
    on.reviews && reviewsSection(T), on.watch && watchSection(T), historySection(T), on.details && detailsSection(T)].filter(Boolean);
  out.push(h('div', { class: 'tp-body' }, parts.length ? parts : h('p', { class: 'tp-quiet' }, 'AniList has nothing more about this title yet.')));
  return out;
}

// The title's banner (AniList's wide picture), like on AniList's own page: across the top, the cover
// over it, fading into the title's color. Only an https address made of plain characters is used.
function bannerOf(T) {
  const u = T && T.media && T.media.bannerImage;
  return u && /^https:\/\/[^\s"'()\\<>]+$/.test(u) ? u : null;
}

function titleBar(T, m, name) {
  const prev = state.stack.length > 1 ? state.titles[state.stack[state.stack.length - 2].mediaId] : null;
  const to = prev ? titleName(prev) : VIEWS[state.view].label;
  return h('div', { class: 'tp-bar' },
    h('button', { class: 'tp-back', 'data-f': 'tp:back', 'aria-label': `Back to ${to}`, 'aria-keyshortcuts': 'Escape', onclick: back }, icon('back'), h('span', { class: 'tp-back-to' }, to)),
    h('span', { class: 'tp-bar-title', 'aria-hidden': 'true' }, name),
    m.siteUrl ? h('button', { class: 'tp-open', 'data-f': 'tp:open', onclick: () => open(m.siteUrl) }, 'Open on AniList', icon('external')) : null);
}

function titleHead(T, m, type, name) {
  const favBusy = !!m.id && state.busy.has(`fav:${m.id}`);
  const fav = T.media && !m.isFavouriteBlocked ? h('button', {
    class: 'tp-fav' + (m.isFavourite ? ' is-on' : ''), 'data-f': 'tp:fav', 'aria-pressed': String(!!m.isFavourite), 'aria-busy': favBusy ? 'true' : null,
    title: m.isFavourite ? 'Remove from your favourites' : 'Add to your favourites', onclick: () => { if (!favBusy) toggleFavourite(T); },
  }, icon('heart'), 'Favourite') : null;
  // The scores (0.12.4, MangaBaka's way: each site's icon and its number) on a line of their own, then AniList's
  // best ranking ("#12 highest rated of 2023") on the next, so scores arriving never push it; the other rankings
  // are in Details.
  const scores = T.media ? scoresLine(T, m) : null;
  const best = T.media ? rankingsOf(m)[0] : null;
  return h('header', { class: 'tp-head' },
    h('div', { class: 'tp-cover', style: m.coverImage && m.coverImage.color ? `background-color:${m.coverImage.color}` : null }, cover(posterUrl(m), false)),
    h('div', { class: 'tp-id' },
      h('h1', { class: 'tp-title', tabindex: '-1', 'data-f': 'tp:title' }, name),
      h('div', { class: 'tp-meta' }, metaOf(m, type)),
      scores,
      best ? h('div', { class: 'tp-stats' }, h('span', { class: 'tp-rank' }, h('b', {}, `#${best.rank}`), ` ${rankWords(best)}`)) : null,
      fav ? h('div', { class: 'tp-head-acts' }, fav) : null));
}

/* Scores from each site (0.12.4) --------------------------------------------------------------------
   Each site's own icon (bundled unchanged in logos/, see logos/README.md for whose and their rules) and
   its number written the way that site writes it: AniList "91%", MyAnimeList "9.30", MangaBaka "89" (out
   of 100), Kitsu "89%"; for manga, what MangaBaka's answer says of four more sites, each in its own scale
   (MangaUpdates "8.89", Anime-Planet "4.6" out of 5, Anime News Network "8.49", Shikimori "9.22"; off at
   first). Each is a link to the title on that site, except AniList's (the page's own Open on AniList). One
   switch per site in Settings (On AniList, Titles); a site that doesn't answer isn't shown. */

const SCORE_SITES = ['al', 'mal', 'mb', 'kitsu', 'mu', 'ap', 'ann', 'shiki'];
const SCORE_INFO = {
  al: { name: 'AniList', logo: 'logos/anilist.png' },
  mal: { name: 'MyAnimeList', logo: 'logos/myanimelist.svg' },
  mb: { name: 'MangaBaka', logo: 'logos/mangabaka.png', note: 'Manga only' },
  kitsu: { name: 'Kitsu', logo: 'logos/kitsu.png' },
  // Read from MangaBaka's answer (manga only): `more` in background.js extMb.
  mu: { name: 'MangaUpdates', logo: 'logos/mangaupdates.svg', max: 10, digits: 2, viaMb: true },
  ap: { name: 'Anime-Planet', logo: 'logos/anime-planet.png', max: 5, digits: 1, viaMb: true },
  ann: { name: 'Anime News Network', logo: 'logos/animenewsnetwork.png', max: 10, digits: 2, viaMb: true },
  shiki: { name: 'Shikimori', logo: 'logos/shikimori.png', max: 10, digits: 2, viaMb: true },
};
const MB_FED = SCORE_SITES.filter((k) => k === 'mb' || SCORE_INFO[k].viaMb);
const siteLogo = (k) => h('img', { class: 'sc-logo', src: SCORE_INFO[k].logo, alt: '', width: '16', height: '16', draggable: 'false' });
const fromScores = (n, site) => (n ? `, from ${n.toLocaleString('en-GB')} scores on ${site}` : ` on ${site}`);

// What each site says about this title, in the order of SCORE_SITES: { k, text, said, url }.
function scoresOf(T, m) {
  const ext = T.ext || {};
  const out = [];
  if (scoreOn('al') && m.averageScore) out.push({ k: 'al', text: `${m.averageScore}%`, said: `${m.averageScore}% average score on AniList` });
  const info = ext.info;
  if (scoreOn('mal') && info && info.score) out.push({ k: 'mal', text: info.score.toFixed(2), said: `${info.score.toFixed(2)}${fromScores(info.by, 'MyAnimeList')}`, url: info.url });
  const mb = ext.mb;
  if (scoreOn('mb') && m.type === 'MANGA' && mb && mb.score) {
    const n = String(Math.round(mb.score));
    out.push({ k: 'mb', text: n, said: `${n} out of 100 on MangaBaka`, url: mb.url });
  }
  const ki = ext.kitsu;
  if (scoreOn('kitsu') && ki && ki.score) {
    const n = `${Math.round(ki.score)}%`;
    out.push({ k: 'kitsu', text: n, said: `${n} average${fromScores(ki.by, 'Kitsu')}`, url: ki.url });
  }
  const more = m.type === 'MANGA' && mb && mb.more ? mb.more : {};
  for (const k of SCORE_SITES.filter((x) => SCORE_INFO[x].viaMb)) {
    const x = more[k];
    const d = SCORE_INFO[k];
    if (!scoreOn(k) || !x || !x.score || !x.url) continue;
    const n = x.score.toFixed(d.digits);
    out.push({ k, text: n, said: `${n} out of ${d.max} on ${d.name}, as MangaBaka last read it`, url: x.url });
  }
  return out;
}
// The scores show up once (arriving one by one, each pushed the line along): the line keeps its height
// from the start and stays empty until every site switched on has answered, or SCORE_WAIT has passed (most
// answers are kept, so it's usually at once); a site slower than that joins at the end of the line.
const SCORE_PARTS = ['info', 'mb', 'kitsu'];
const SCORE_WAIT = 1500;
function holdScores(T) {
  if (T.scoreHold && T.scoreHold > Date.now()) return;
  T.scoreHold = Date.now() + SCORE_WAIT;
  setTimeout(() => { if (state.stack.some((p) => p.mediaId === T.mediaId)) render(); }, SCORE_WAIT + 20);
}
// (The title's first drawing comes just before the other sites are asked: that one waits too.)
const scoresWaiting = (T) => (!T.ext ? SCORE_SITES.some((k) => k !== 'al' && scoreOn(k))
  : !!T.scoreHold && Date.now() < T.scoreHold && SCORE_PARTS.some((k) => k in T.ext && T.ext[k] === undefined));
function scoresLine(T, m) {
  if (scoresWaiting(T)) return h('div', { class: 'tp-stats tp-scores is-waiting', 'aria-busy': 'true' });
  const chips = scoreChips(T, m);
  return chips.length ? h('div', { class: 'tp-stats tp-scores' }, chips) : null;
}
function scoreChips(T, m) {
  return scoresOf(T, m).map((x) => {
    const kids = [siteLogo(x.k), h('b', {}, x.text)];
    const label = `${x.said}${x.url ? `. Open on ${SCORE_INFO[x.k].name}` : ''}`;
    return x.url
      ? h('a', { class: 'tp-sc is-link', href: x.url, 'data-f': `tp:sc:${x.k}`, 'data-sc': x.k, title: x.said, 'aria-label': label, onclick: opener(x.url) }, kids)
      : h('span', { class: 'tp-sc', 'data-sc': x.k, title: x.said, role: 'img', 'aria-label': label }, kids);
  });
}

const skelLines = (n = 3) => h('div', { class: 'tp-skel', 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: n }, (_, i) => h('i', { style: `width:${[62, 88, 74, 54][i % 4]}%` })));

// A title's main action: in the title's color (+1 has its own pill).
const goBtn = (label, ic, run, f, busy = false) => h('button', { class: 'tp-go', 'data-f': f, disabled: busy, onclick: run }, busy ? spin() : [ic ? icon(ic) : null, label]);

// Your entry, two lines: what you're at and the one thing to do next; then your score, priority and
// a date, with "Edit details" unfolding every field in place. The watch-order warning under it.
function entrySection(T, p, m, e, type) {
  const anime = isAnime(type);
  if (e === undefined) return h('section', { class: 'tp-entry' }, skelLines(2));
  const warn = orderWarning(T, e, type);
  if (e === null) {
    const busy = state.busy.has(`m:${T.mediaId}`);
    return h('section', { class: 'tp-entry', 'aria-label': 'Your list' },
      h('div', { class: 'tp-line is-first' },
        h('div', { class: 'tp-none' }, 'Not on your list'),
        h('div', { class: 'tp-acts' },
          h('button', { class: 'tp-btn', 'data-f': 'tp:start', disabled: busy, onclick: () => addTitle(T.mediaId, 'CURRENT', m) }, anime ? 'Start watching' : 'Start reading'),
          goBtn('Add to Planning', null, () => addTitle(T.mediaId, 'PLANNING', m), 'tp:add', busy))),
      warn);
  }
  return h('section', { class: 'tp-entry' + (p.details ? ' is-open' : ''), 'aria-label': 'Your entry' },
    firstLine(T, m, e, type),
    secondLine(T, p, e, type),
    !p.details && state.scoreOpen === e.id ? h('div', { class: 'tp-score-strip' }, scorePicker(e)) : null,
    p.details ? h('div', { class: 'tp-fold', id: 'tp-fold' }, T.media ? fieldsBlock(T, m, e, type) : skelLines(4)) : null,
    warn);
}

// Line 1: the status, "Ep 14 of 24" (typed in), what's left, and − / +1 (or Start, Rewatch...).
function firstLine(T, m, e, type) {
  const anime = isAnime(type);
  const em = e.media || m;
  const total = (anime ? em.episodes : em.chapters) || null;
  const progress = e.progress || 0;
  const busy = state.busy.has(e.id);
  const s = e.status;
  const statusBtn = h('button', {
    class: 'tp-status', 'data-f': 'tp:status', 'aria-haspopup': 'menu', 'aria-expanded': String(!!state.statusMenu), 'aria-label': `Status: ${statusWord(type, s)}. Change it`,
    onclick: (ev) => {
      ev.stopPropagation();
      state.statusMenu = state.statusMenu ? false : 'opening';
      render();
      if (state.statusMenu && ev.detail === 0) { const it = app.querySelector('.tp-menu-item.is-on') || app.querySelector('.tp-menu-item'); if (it) it.focus(); }
    },
  }, h('span', {}, statusWord(type, s)), icon('down'));
  const menu = state.statusMenu ? h('div', { class: 'tp-menu' + (state.statusMenu === 'opening' ? ' is-opening' : ''), role: 'menu', 'aria-label': 'Status', onclick: (ev) => ev.stopPropagation() },
    STATUS_ORDER.map((x) => h('button', {
      class: 'tp-menu-item' + (x === s ? ' is-on' : ''), role: 'menuitemradio', 'aria-checked': String(x === s), 'data-f': `tp:st:${x}`,
      onclick: () => setStatus(e, x),
    }, h('span', {}, statusWord(type, x)), x === s ? icon('check') : null))) : null;

  const acts = [];
  let note = null;
  const airing = anime && em.status === 'RELEASING' && em.nextAiringEpisode;
  const waiting = !!airing && progress + 1 >= airing.episode;
  if (s === 'PLANNING') {
    acts.push(goBtn(anime ? 'Start watching' : 'Start reading', 'play', async () => saveEntry(e, { status: 'CURRENT', ...(await unpinPatch(e)) }, { wait: true }), 'tp:startit', busy));
    if (em.status === 'NOT_YET_RELEASED') note = h('span', { class: 'tp-tag' }, 'Not out yet');
  } else if (s === 'COMPLETED') {
    acts.push(goBtn(anime ? 'Rewatch' : 'Reread', 'repeat', () => startRewatch(e), 'tp:rewatch', busy));
  } else {
    if (progress > 0) {
      acts.push(h('button', { class: 'tp-minus', 'data-f': 'tp:minus', 'aria-label': anime ? `Mark episode ${progress} not watched` : `Mark chapter ${progress} not read`, disabled: busy, onclick: () => saveEntry(e, { progress: progress - 1 }) }, icon('minus')));
    }
    if (!(total && progress >= total) && !waiting) {
      acts.push(h('button', {
        class: 'tp-plus js-plus', 'data-f': 'tp:plus', disabled: busy, 'aria-keyshortcuts': '+',
        'aria-label': anime ? `Mark episode ${progress + 1} watched` : `Mark chapter ${progress + 1} read`,
        onclick: () => plusOne(e),
      }, busy ? spin() : '+1'));
    }
    const fresh = anime ? newCount(e) : 0;
    if (fresh > 0) note = h('span', { class: 'tp-tag is-new' }, `${fresh} new`);
    else if (waiting && airing.airingAt) note = h('span', { class: 'tp-tag' }, `Episode ${airing.episode} ${soon(airing.airingAt)}`);
  }

  let prog = null;
  if (s !== 'PLANNING' || progress > 0) {
    // The number ticks up after a +1 (or down after −), like the posters' (no track on this page).
    const mv = progressMove(e.id, progress);
    const tick = mv.from != null && mv.from !== progress;
    const width = (v) => `width:${Math.max(1, String(v).length) + 0.6}ch`;
    const input = h('input', {
      class: 'tp-num' + (tick ? ' is-tick' : ''), 'data-f': 'tp:prog', inputmode: 'numeric', autocomplete: 'off', value: String(progress),
      style: width(progress) + (tick && mv.since ? `;animation-delay:-${mv.since}ms` : ''),
      'aria-label': anime ? `Episodes watched${total ? ` out of ${total}` : ''}` : `Chapters read${total ? ` out of ${total}` : ''}`,
    });
    const commit = () => {
      const n = parseInt(input.value, 10);
      if (Number.isNaN(n) || n === progress) { input.value = String(progress); input.style.cssText = width(progress); return; }
      saveEntry(e, { progress: total ? Math.min(total, n) : n }, { wait: true });
    };
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 5); input.style.cssText = width(input.value); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { input.value = String(progress); input.style.cssText = width(progress); }
    });
    input.addEventListener('blur', () => { if (!rendering) commit(); });
    prog = h('div', { class: 'tp-prog' }, h('span', { class: 'tp-unit' }, anime ? 'Ep' : 'Ch'), input, total ? h('span', { class: 'tp-of' }, `of ${total}`) : null);
  }
  // What's left: "18 left" and "7 h 12 min", while you're on it.
  const facts = [];
  const left = total ? Math.max(0, total - progress) : 0;
  if (left && ['CURRENT', 'REPEATING', 'PAUSED'].includes(s)) {
    facts.push(fact(`${left} left`));
    const dur = (T.media && T.media.duration) || em.duration;
    if (anime && dur) facts.push(fact(durationText(left * dur)));
  }
  return h('div', { class: 'tp-line is-first' + (busy ? ' is-busy' : '') },
    h('div', { class: 'tp-status-wrap' }, statusBtn, menu),
    prog, facts, note,
    acts.length ? h('div', { class: 'tp-acts' }, acts) : null);
}

// "8 Nov" this year, "Nov 2023" before (the exact day is in the details), "2019" when that's all.
function shortDate(d) {
  if (!hasDate(d)) return '';
  if (!d.month) return String(d.year);
  if (d.year === new Date().getFullYear() && d.day) return `${d.day} ${MONTHS[d.month - 1]}`;
  return `${MONTHS[d.month - 1]} ${d.year}`;
}

// A score in your format: "8", "85", "4 ★", or the face.
function scoreValue(v) {
  const f = fmtNow();
  if (f === 'POINT_3') return h('span', { class: 'sv' }, icon(FACES[Math.round(v)] || 'meh'));
  if (f === 'POINT_5') return h('span', { class: 'sv' }, h('b', {}, String(v)), icon('star'));
  return h('span', { class: 'sv' }, h('b', {}, String(v)));
}

// Unfolds the details and puts the keyboard on one of them.
function openDetails(p, f) {
  p.details = true;
  state.scoreOpen = null;
  render();
  const el = f && app.querySelector(`[data-f="${f}"]`);
  if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' }); }
}

// Line 2: your score (its strip opens here, as on the posters), the priority or pin, a date, and
// "Edit details". Each piece opens its own control.
function secondLine(T, p, e, type) {
  const pieces = [];
  const score = e.score || 0;
  if (e.status !== 'PLANNING' || score) {
    const isOpen = !p.details && state.scoreOpen === e.id;
    pieces.push(h('button', {
      class: 'tp-sum' + (isOpen ? ' is-open' : '') + (score ? '' : ' is-empty'), 'data-f': 'tp:sum:score', 'aria-expanded': p.details ? null : String(isOpen),
      'aria-label': score ? `Score ${scoreText(score)}. Change it` : 'Add a score',
      onclick: (ev) => {
        if (p.details) {
          const a = app.querySelector('.tp-fold .score-btn.is-active') || app.querySelector('.tp-fold .score-btn');
          if (a) { a.focus({ preventScroll: true }); a.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' }); }
          return;
        }
        state.scoreOpen = isOpen ? null : e.id;
        render();
        const pick = app.querySelector('.tp-score-strip');
        if (pick && ev.detail === 0) (pick.querySelector('.score-btn.is-active') || pick.querySelector('.score-btn')).focus();
      },
    }, score ? [h('span', { class: 'tp-sum-k' }, 'Score'), scoreValue(score)] : [icon('star'), h('span', { class: 'tp-sum-k' }, 'Add a score')]));
  }
  if (prioOnFor(type, e.status)) {
    const v = Number(draftOf(e, 'priority')) || 0;
    if (v >= PIN_MIN) {
      const rank = pinRank(e);
      const where = e.status === 'PLANNING' ? 'Up Next' : statusWord(type, e.status);
      pieces.push(h('button', { class: 'tp-sum', 'data-f': 'tp:sum:prio', onclick: () => openDetails(p, 'tp:unpin') },
        icon('pin'), h('span', {}, rank ? ['Pinned, ', h('b', {}, `#${rank}`), ` in ${where}`] : `Pinned in ${where}`)));
    } else if (v || e.status === 'PLANNING') {
      pieces.push(h('button', { class: 'tp-sum' + (v ? '' : ' is-empty'), 'data-f': 'tp:sum:prio', onclick: () => openDetails(p, 'tp:priority') },
        v ? [h('span', { class: 'tp-sum-k' }, 'Priority'), h('b', {}, String(v))] : h('span', { class: 'tp-sum-k' }, 'No priority')));
    }
  }
  const done = draftOf(e, 'completedAt');
  const began = draftOf(e, 'startedAt');
  const [k, word, d] = e.status === 'COMPLETED' && hasDate(done) ? ['completedAt', 'Finished', done] : ['startedAt', 'Started', began];
  if (hasDate(d)) {
    pieces.push(h('button', { class: 'tp-sum', 'data-f': 'tp:sum:date', 'aria-label': `${word} ${dateWords(d)}. Change it`, onclick: () => openDetails(p, `tp:${k}`) },
      h('span', { class: 'tp-sum-k' }, word), h('span', { class: 'tp-sum-v' }, shortDate(d))));
  }
  return h('div', { class: 'tp-line is-second' },
    pieces,
    h('button', {
      class: 'tp-details', 'data-f': 'tp:details', 'aria-expanded': String(!!p.details), 'aria-controls': p.details ? 'tp-fold' : null,
      onclick: () => { p.details = !p.details; state.scoreOpen = null; render(); },
    }, p.details ? 'Hide details' : 'Edit details', icon('next')));
}

// Did a start before b? A copy of content/core.js relStartedBefore: only what both dates say counts.
function startedBefore(a, b) {
  if (!a || !a.year) return false;
  if (!b || !b.year) return true;
  for (const k of ['year', 'month', 'day']) {
    if (!a[k] || !b[k]) return false;
    if (a[k] !== b[k]) return a[k] < b[k];
  }
  return false;
}

// "Comes after Vinland Saga, which you haven't finished": the same rule as the watch-order
// warnings on AniList's lists (content/core.js, blockersFrom): a prequel, or the main story of a
// movie, OVA or special when it started before it.
function orderBlockers(T) {
  const m = T.media;
  if (!m) return [];
  const sideStory = !['TV', 'TV_SHORT'].includes(m.format);
  return relEdges(T).filter((ed) => {
    const n = ed.node;
    if (n.type !== m.type || ['MUSIC', 'SPECIAL'].includes(n.format)) return false;
    if (!(ed.relationType === 'PREQUEL' || (ed.relationType === 'PARENT' && sideStory && startedBefore(n.startDate, m.startDate)))) return false;
    return !(n.mediaListEntry && ['COMPLETED', 'REPEATING'].includes(n.mediaListEntry.status));
  });
}

function orderWarning(T, e, type) {
  if (state.settings && state.settings.watchOrder === false) return null;   // Watch-order warnings, off (shared with AniList)
  if (e && !(e.status === 'PLANNING' || (e.status === 'CURRENT' && !(e.progress > 0)))) return null;
  const b = orderBlockers(T).map((ed) => ed.node.title.userPreferred);
  if (!b.length) return null;
  const list = b.length === 1 ? b[0] : `${b.slice(0, -1).join(', ')} and ${b[b.length - 1]}`;
  return h('button', {
    class: 'tp-warn', 'data-f': 'tp:warn', 'aria-label': `Comes after ${list}, which you haven't finished. Show the ${isAnime(type) ? 'watch' : 'reading'} order`,
    // Shows the whole watch order, with the keyboard on the first title to finish.
    onclick: () => {
      const p = topPage();
      if (!p) return;
      p.all.order = true;
      render();
      const sec = app.querySelector('[data-sec="order"]');
      if (sec) sec.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
      const first = orderBlockers(T)[0];
      const c = first && app.querySelector(`[data-f="tc:order:${first.node.id}"]`);
      if (c) c.focus({ preventScroll: true });
    },
  }, icon('warn'), h('span', {}, `Comes after ${list}, which you haven't finished.`));
}

function fieldRow(label, body, cls = '') {
  return h('div', { class: `tp-field${cls ? ` ${cls}` : ''}` }, h('dt', {}, label), h('dd', {}, body));
}

// − 3 +, the number typed in too. Saves a moment after the last change.
function stepper(e, k, label, max) {
  const v = Number(draftOf(e, k)) || 0;
  const set = (n) => editField(e, k, Math.max(0, Math.min(max, n)), 600);
  const input = h('input', { class: 'tp-step-n', 'data-f': `tp:${k}`, inputmode: 'numeric', autocomplete: 'off', value: String(v), 'aria-label': label });
  const commit = () => {
    const n = parseInt(input.value, 10);
    if (Number.isNaN(n) || n === v) { input.value = String(v); return; }
    editField(e, k, Math.max(0, Math.min(max, n)), 0);
  };
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 3); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') input.value = String(v);
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); set(v + (ev.key === 'ArrowUp' ? 1 : -1)); }
  });
  input.addEventListener('blur', () => { if (!rendering) commit(); });
  const btn = (d, ic, f, words, off) => h('button', {
    class: 'tp-step-btn', 'data-f': f, 'aria-label': `${label}: ${words}`, 'aria-disabled': off ? 'true' : null,
    onclick: () => { if (!off) set(v + d); },
  }, icon(ic));
  return h('div', { class: 'tp-step' }, btn(-1, 'minus', `tp:${k}-`, 'one less', v <= 0), input, btn(1, 'plus', `tp:${k}+`, 'one more', v >= max));
}

function priorityControl(e, type) {
  const v = Number(draftOf(e, 'priority')) || 0;
  const place = pinPlace(e);
  const busy = state.busy.has(e.id);
  if (v >= PIN_MIN) {
    const rank = pinRank(e);
    const where = e.status === 'PLANNING' ? 'Up Next' : statusWord(type, e.status);
    return h('div', { class: 'tp-prio' },
      h('span', { class: 'tp-pinned' }, icon('pin'), rank ? ['Pinned, ', h('b', {}, `#${rank}`), ` in ${where}`] : `Pinned in ${where}`),
      h('button', { class: 'tp-btn is-small', 'data-f': 'tp:unpin', disabled: busy, onclick: () => unpinTitle(e) }, 'Unpin'));
  }
  return h('div', { class: 'tp-prio' },
    stepper(e, 'priority', 'Priority', MAX_PRIORITY),
    h('button', { class: 'tp-btn is-small', 'data-f': 'tp:pin', disabled: busy, onclick: () => pinTitle(e) }, icon('pin'), `Pin to ${place}`));
}

const pad2 = (n) => String(n).padStart(2, '0');

function dateControl(e, k, label, quick) {
  const d = draftOf(e, k) || NO_DATE;
  const full = hasDate(d) && d.month && d.day;
  // AniList keeps dates like "2019" or "May 2019": shown as they are until you change them.
  if (hasDate(d) && !full && state.dateEdit !== k) {
    return h('button', {
      class: 'tp-date is-text', 'data-f': `tp:${k}`, 'aria-label': `${label}: ${dateWords(d)}. Change it`,
      onclick: () => { state.dateEdit = k; render(); const i = app.querySelector(`[data-f="tp:${k}"]`); if (i) i.focus(); },
    }, dateWords(d));
  }
  const input = h('input', {
    class: 'tp-date', type: 'date', 'data-f': `tp:${k}`, min: '1900-01-01', max: '2100-12-31', 'aria-label': label,
    value: full ? `${d.year}-${pad2(d.month)}-${pad2(d.day)}` : '',
  });
  let timer = 0;
  const commit = () => {
    clearTimeout(timer);
    let next = { ...NO_DATE };
    if (input.value) {
      const [y, mo, da] = input.value.split('-').map(Number);
      if (!(y >= 1900)) return;
      next = { year: y, month: mo, day: da };
    }
    if (same(next, draftOf(e, k))) return;
    editField(e, k, next, 0);
  };
  // Typing a year goes through 0002, 0020, 0202: wait for the last one.
  input.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(commit, 700); });
  input.addEventListener('blur', () => {
    if (rendering) return;
    if (state.dateEdit === k) state.dateEdit = null;
    commit();
  });
  return h('div', { class: 'tp-dates' }, input,
    quick && !hasDate(d) ? h('button', { class: 'tp-link', 'data-f': `tp:${k}:today`, onclick: () => editField(e, k, todayDate(), 0) }, 'Today') : null);
}

function listChips(e, names) {
  const cur = draftOf(e, 'customLists') || [];
  return h('div', { class: 'tp-chips', role: 'group', 'aria-label': 'Custom lists' }, names.map((n) => {
    const on = cur.includes(n);
    return h('button', {
      class: 'tp-chip' + (on ? ' is-on' : ''), 'aria-pressed': String(on), 'data-f': `tp:cl:${n}`,
      onclick: () => editField(e, 'customLists', names.filter((x) => (x === n ? !on : cur.includes(x))), 0),
    }, on ? icon('check') : null, h('span', {}, n));
  }));
}

function notesBox(e) {
  const ta = h('textarea', { class: 'tp-notes', 'data-f': 'tp:notes', rows: '1', placeholder: 'Add a note', 'aria-label': 'Notes', maxlength: '2000', spellcheck: 'true' });
  ta.value = draftOf(e, 'notes') || '';
  ta.addEventListener('input', () => fitNotes(ta));
  ta.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ta.blur(); } });
  ta.addEventListener('blur', () => {
    if (rendering) return;
    if (ta.value !== (draftOf(e, 'notes') || '')) editField(e, 'notes', ta.value, 0);
  });
  return ta;
}
function fitNotes(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(150, ta.scrollHeight + 2)}px`;
}

function privateSwitch(e) {
  const on = !!draftOf(e, 'private');
  return h('button', {
    class: 'tp-switch-row', role: 'switch', 'aria-checked': String(on), 'aria-label': 'Private', 'data-f': 'tp:private',
    onclick: () => editField(e, 'private', !on, 0),
  }, h('span', { class: 'tp-switch' + (on ? ' is-on' : ''), 'aria-hidden': 'true' }), h('span', {}, on ? 'Only you can see it' : 'Everyone can see it'));
}

function fieldsBlock(T, m, e, type) {
  const anime = isAnime(type);
  const planning = e.status === 'PLANNING';
  const rows = [fieldRow('Score', scorePicker(e), 'is-score')];
  if (prioOnFor(type, e.status)) rows.push(fieldRow('Priority', priorityControl(e, type)));
  for (const [k, label] of [['startedAt', 'Started'], ['completedAt', 'Finished']]) {
    if (planning && !hasDate(e[k]) && !drafts.has(`${e.id}:${k}`)) continue;
    // "Today" next to an empty date that should have one: the start while watching, the finish once completed.
    const quick = k === 'startedAt' ? ['CURRENT', 'REPEATING'].includes(e.status) : e.status === 'COMPLETED';
    rows.push(fieldRow(label, dateControl(e, k, label === 'Started' ? 'Start date' : 'Finish date', quick)));
  }
  if (!planning || e.repeat) rows.push(fieldRow(anime ? 'Rewatches' : 'Rereads', stepper(e, 'repeat', anime ? 'Rewatches' : 'Rereads', 999)));
  const names = state.customLists[type] || [];
  if (names.length) rows.push(fieldRow('Custom lists', listChips(e, names), 'is-top'));
  rows.push(fieldRow('Notes', notesBox(e), 'is-top'));
  rows.push(fieldRow('Private', privateSwitch(e)));
  if (m) rows.push(fieldRow('NSFW', nsfwField(m), 'is-top'));
  const name = nameOf(e);
  const remove = state.confirmRemove
    ? h('div', { class: 'tp-remove is-confirm', role: 'group', 'aria-label': 'Remove from your list' },
      h('span', { class: 'tp-remove-q' }, `Remove ${name} from your list? Its progress, score and notes go with it.`),
      h('div', { class: 'tp-remove-acts' },
        h('button', { class: 'tp-btn is-danger', 'data-f': 'tp:remove-yes', disabled: state.busy.has(e.id), onclick: () => removeEntry(T) }, 'Remove'),
        h('button', { class: 'tp-btn', 'data-f': 'tp:remove-no', onclick: () => { state.confirmRemove = false; render(); const b = app.querySelector('[data-f="tp:remove"]'); if (b) b.focus(); } }, 'Keep it')))
    : h('div', { class: 'tp-remove' }, h('button', {
      class: 'tp-link is-quiet', 'data-f': 'tp:remove',
      onclick: () => { state.confirmRemove = true; render(); const b = app.querySelector('[data-f="tp:remove-no"]'); if (b) b.focus(); },
    }, 'Remove from my list'));
  return [h('dl', { class: 'tp-fields' }, rows), remove];
}

/* The sections of a title page ---------------------------------------------------------------- */
// Each: a quiet heading with a hairline and one row, with "See all" (AniList's own tab, or the rest
// unfolded here). A section with nothing in it isn't shown.

const COVER_COLS = 5;

function tpSection(key, title, body, more) {
  return h('section', { class: 'tp-sec', 'data-sec': key, 'aria-label': title },
    h('header', { class: 'tp-sec-head' }, h('h2', { class: 'tp-sec-title' }, title), more || null),
    body);
}
// "See all" on AniList: the title page's own tab (/characters, /staff). Any word works as the slug.
function tabUrl(m, tab) {
  const slug = String((m.title && m.title.userPreferred) || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'title';
  return `${m.siteUrl}/${slug}/${tab}`;
}
const seeOnAniList = (url, f) => h('button', { class: 'tp-see', 'data-f': f, onclick: () => open(url) }, 'See all', icon('external'));
const seeHere = (p, key) => h('button', {
  class: 'tp-see', 'data-f': `tp:see:${key}`, 'aria-expanded': String(!!p.all[key]),
  onclick: () => { p.all[key] = !p.all[key]; render(); },
}, p.all[key] ? 'Show less' : 'See all');

// The description, folded to 4 lines.
function descBlock(T) {
  const m = T.media;
  const paras = richText(m.description);
  if (!paras.length) return null;
  const long = (m.description || '').length > 240;
  return h('div', { class: 'tp-desc-wrap' },
    h('div', { class: 'tp-desc' + (long && !T.more ? ' is-folded' : ''), id: 'tp-desc' }, paras),
    long ? h('button', { class: 'tp-link', 'data-f': 'tp:more', 'aria-expanded': String(!!T.more), 'aria-controls': 'tp-desc', onclick: () => { T.more = !T.more; render(); } }, T.more ? 'Show less' : 'Show more') : null);
}

/* Covers: watch order and more like this, with your status on each ------------------------------ */

// A cover with your status as a glass label (or "+ Planning" on hover), the title and its meta under it.
function titleCard(n, T, { rel = null, sec }) {
  const title = (n.title && n.title.userPreferred) || '';
  const le = n.mediaListEntry;
  const year = (n.startDate && n.startDate.year) || n.seasonYear;
  const fmt = n.format ? FORMATS[n.format] || sentence(n.format) : null;
  const when = year ? String(year) : n.status === 'NOT_YET_RELEASED' ? 'Not out yet' : null;
  const id = `m${n.id}`;
  const f = `tc:${sec}:${n.id}`;
  const busy = state.busy.has(`m:${n.id}`);
  const status = le ? statusWord(n.type, le.status) : null;
  const said = [title, rel, fmt, when, status ? `on your list: ${status}` : 'not on your list'].filter(Boolean).join(', ');
  const tag = le ? h('span', { class: `pc-tag tc-st is-${String(le.status).toLowerCase()}`, 'aria-hidden': 'true' }, le.status === 'COMPLETED' ? icon('check') : null, status) : null;
  const add = !le ? h('button', {
    class: 'pc-act tc-add', 'data-f': `${f}:add`, disabled: busy, 'aria-label': `Add ${title} to Planning`, title: 'Add to Planning',
    onclick: (ev) => { ev.stopPropagation(); addTitle(n.id, 'PLANNING', n); },
  }, busy ? spin() : [icon('plus'), 'Planning']) : null;
  const art = h('a', { class: 'tc-cover', href: n.siteUrl, 'data-nav': '', 'data-f': f, 'aria-label': said, onclick: titleOpener(n.id, n, f) }, cover(posterUrl(n)));
  return h('div', {
    class: 'tc' + (hotId === id ? ' is-hot' : '') + (busy ? ' is-busy' : ''), 'data-id': id, role: 'listitem', 'data-navfrom': f, style: titleStyle(n),
  },
  h('div', { class: 'tc-art', style: n.coverImage && n.coverImage.color ? `background-color:${n.coverImage.color}` : null }, art, tag, add ? h('div', { class: 'tc-over' }, add) : null),
  h('div', { class: 'tc-name', 'aria-hidden': 'true' }, title),
  h('div', { class: 'tc-meta', 'aria-hidden': 'true' }, rel ? h('span', { class: 'tc-rel' }, rel) : null,
    fmt ? h('span', {}, fmt) : null, when ? h('span', {}, when) : null));
}
const coverRow = (cards, cls = '') => h('div', { class: `tc-row${cls ? ` ${cls}` : ''}`, role: 'list', style: `--cols:${COVER_COLS}` }, cards);

const dateKey = (n) => { const d = n.startDate || {}; return [d.year || n.seasonYear || 9999, d.month || 13, d.day || 32]; };
function byDate(a, b) {
  const x = dateKey(a.node);
  const y = dateKey(b.node);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return REL_RANK.indexOf(a.relationType) - REL_RANK.indexOf(b.relationType);
}

// Relations: the main line in release order (prequels, side stories, sequels), then sources and
// adaptations, then the rest. Folded: one row, around where this title comes (0.12.1: the title itself
// isn't shown, it read as a duplicate).
function orderSection(T, p) {
  const m = T.media;
  const anime = isAnime(m.type);
  const main = [];
  const adapt = [];
  const other = [];
  for (const ed of relEdges(T)) {
    const n = ed.node;
    if (ed.relationType === 'SOURCE' || ed.relationType === 'ADAPTATION' || n.type !== m.type) adapt.push(ed);
    else if (MAIN_REL.has(ed.relationType) && n.format !== 'MUSIC') main.push(ed);
    else other.push(ed);
  }
  if (!main.length && !adapt.length && !other.length) return null;
  const line = main.slice().sort(byDate);
  // Where this title would sit in the line: the folded row starts just before it.
  const here = dateKey(m);
  const at = line.filter((ed) => {
    const k = dateKey(ed.node);
    for (let i = 0; i < 3; i++) if (k[i] !== here[i]) return k[i] < here[i];
    return ed.relationType === 'PREQUEL' || ed.relationType === 'PARENT';
  }).length;
  adapt.sort(byDate);
  other.sort(byDate);
  const card = (ed) => titleCard(ed.node, T, { sec: 'order', rel: REL_WORDS[ed.relationType] || sentence(ed.relationType) });
  const all = [...line, ...adapt, ...other];
  const many = all.length > COVER_COLS;
  let body;
  if (many && p.all.order) {
    const groups = [['In order', line], [anime ? 'Source and adaptations' : 'Adaptations', adapt], ['Also related', other]].filter((g) => g[1].length);
    body = groups.map(([label, list]) => h('div', { class: 'tc-group' }, groups.length > 1 ? h('h3', { class: 'tc-h' }, label) : null, coverRow(list.map(card), 'is-wrap')));
  } else {
    const start = Math.max(0, Math.min(at - 1, all.length - COVER_COLS));
    body = coverRow(all.slice(start, start + COVER_COLS).map(card));
  }
  return tpSection('order', 'Relations', body, many ? seeHere(p, 'order') : null);
}

// AniList's recommendations by rating, with your status on each; the ones you've completed or
// dropped aren't news, so they're left out.
function recsSection(T, p) {
  const seen = new Set([T.mediaId]);
  const list = recNodes(T).filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return !(n.mediaListEntry && ['COMPLETED', 'DROPPED'].includes(n.mediaListEntry.status));
  });
  if (!list.length) return null;
  const many = list.length > COVER_COLS;
  const shown = many && p.all.recs ? list : list.slice(0, COVER_COLS);
  return tpSection('recs', 'More like this', coverRow(shown.map((n) => titleCard(n, T, { sec: 'rec' })), many && p.all.recs ? 'is-wrap' : ''), many ? seeHere(p, 'recs') : null);
}

/* People: characters with their Japanese voice actor, and the main staff ------------------------ */

// A face, or the person's initials on a quiet tile (never a "No image" box).
function face(person, cls = '') {
  const url = realPhoto(person);
  return h('span', { class: `face${cls ? ` ${cls}` : ''}${url ? '' : ' is-initials'}`, 'aria-hidden': 'true' }, url ? cover(url) : initials(personName(person)));
}
// What else of yours a person is in: up to 3 tiny covers (2 and "+n" when there are more). Pointing
// at one says its title and your score; a click opens its page here.
function minis(T, ppl, key, f, label) {
  const o = ppl && ppl[key];
  if (!o || !o.list.length) return null;
  const more = o.total > 3 ? o.total - 2 : 0;
  const shown = o.list.slice(0, more ? 2 : 3);
  const said = (n) => { const sc = n.mediaListEntry && n.mediaListEntry.score; return `${n.title.userPreferred}${sc ? `, your score ${scoreText(sc)}` : ''}`; };
  return h('div', { class: 'pp-mine' },
    h('span', { class: 'pp-mine-k' }, label),
    h('div', { class: 'pp-minis' },
      shown.map((n) => h('a', {
        class: 'pp-mini', href: n.siteUrl, 'data-f': `${f}:${n.id}`, title: said(n), 'aria-label': `${label}: ${said(n)}`, style: [titleStyle(n), n.coverImage && n.coverImage.color ? `background-color:${n.coverImage.color}` : ''].filter(Boolean).join(';'),
        onclick: titleOpener(n.id, n, `${f}:${n.id}`),
      }, cover(thumbUrl(n)))),
      more ? h('span', { class: 'pp-mini is-more', title: `${more} more of yours`, 'aria-label': `and ${more} more of yours` }, `+${more}`) : null));
}

// "See all" for people: the rest unfolds here (Characters asks AniList for them first), with
// AniList's own tab at the end for the very long lists.
function seePeople(T, p, key) {
  const loading = key === 'chars' && T.cast === 'loading';
  return h('button', {
    class: 'tp-see', 'data-f': `tp:see:${key}`, 'aria-expanded': String(!!p.all[key]), disabled: loading,
    onclick: () => {
      p.all[key] = !p.all[key];
      render();
      if (p.all[key] && key === 'chars' && T.cast !== 'done') loadCast(T);
      else if (p.all[key]) loadPeople(T);
    },
  }, loading ? spin() : p.all[key] ? 'Show less' : 'See all');
}
const onAniList = (T, tab, f) => h('button', { class: 'tp-link is-quiet tp-people-more', 'data-f': f, onclick: () => open(tabUrl(T.media, tab)) }, 'Open on AniList', icon('external'));

// MyAnimeList's characters (0.8): often a fuller list than AniList's, so they come first (0.8.1). A switch in the
// section's heading picks where they come from (remembered); it shows only when MyAnimeList answered with some.
// Until MyAnimeList answers (or when it doesn't), AniList's show.
const malChars = (T) => { const c = outsideOn() && T.ext && T.ext.chars; return Array.isArray(c) && c.length ? c : null; };
function setCastFrom(k) {
  state.castFrom = k;
  try { chrome.storage.local.set({ 'castFrom': k }); } catch { /* ignore */ }
  render();
}
function castSwitch(from) {
  return h('div', { class: 'seg is-small', role: 'radiogroup', 'aria-label': 'Characters from' },
    [['mal', 'MyAnimeList'], ['anilist', 'AniList']].map(([k, label]) => h('button', {
      class: 'seg-btn', role: 'radio', 'aria-checked': String(from === k), 'data-f': `tp:cast:${k}`, onclick: () => { if (from !== k) setCastFrom(k); },
    }, label)));
}
const malPerson = (x) => ({ name: { userPreferred: x.name }, image: { large: x.img } });
function malCharactersSection(T, p, both) {
  const every = malChars(T);
  const all = !!p.all.chars;
  const list = all ? every : every.slice(0, PEOPLE_COLS);
  const link = (url, cls, f, label, kids) => (url ? h('a', { class: cls, href: url, 'data-f': f, 'aria-label': label, onclick: opener(url) }, kids) : h('span', { class: cls }, kids));
  const cards = list.map((c) => h('div', { class: 'pp', role: 'listitem' },
    link(c.url, 'pp-face', `pp:mc:${c.id}`, `${c.name}${c.va ? `, voiced by ${c.va.name}` : ''}. Open on MyAnimeList`, face(malPerson(c))),
    h('div', { class: 'pp-name' }, c.name),
    c.va ? link(c.va.url, 'pp-va', `pp:mv:${c.id}`, `${c.va.name}, voice actor. Open on MyAnimeList`, [face(malPerson(c.va), 'is-mini'), h('span', {}, c.va.name)]) : null));
  const info = T.ext && T.ext.info;
  const more = all && info && info.url ? h('button', { class: 'tp-link is-quiet tp-people-more', 'data-f': 'tp:mal:chars', onclick: () => open(`${info.url}/characters`) }, 'Open on MyAnimeList', icon('external')) : null;
  const head = [both ? castSwitch('mal') : h('span', { class: 'tp-from' }, 'From MyAnimeList'), every.length > PEOPLE_COLS ? seeHere(p, 'chars') : null];
  return tpSection('chars', 'Characters', [h('div', { class: 'pp-row', role: 'list', style: `--cols:${PEOPLE_COLS}` }, cards), more], head);
}

function charactersSection(T, p) {
  const all = !!p.all.chars && T.cast === 'done';
  const list = charactersOf(T, all);
  const mal = malChars(T);
  if (mal && (state.castFrom === 'mal' || !list.length)) return malCharactersSection(T, p, list.length > 0);
  if (!list.length) return null;
  const many = (T.media.characters.edges || []).length > PEOPLE_COLS || T.cast === 'done';
  const cards = list.map((c) => {
    const ch = c.node;
    const va = c.va;
    return h('div', { class: 'pp', role: 'listitem' },
      h('a', { class: 'pp-face', href: ch.siteUrl, 'data-f': `pp:c:${ch.id}`, 'aria-label': `${personName(ch)}${va ? `, voiced by ${personName(va)}` : ''}. Open on AniList`, onclick: opener(ch.siteUrl) }, face(ch)),
      h('div', { class: 'pp-name' }, personName(ch)),
      va ? h('a', { class: 'pp-va', href: va.siteUrl, 'data-f': `pp:v:${ch.id}`, 'aria-label': `${personName(va)}, voice actor. Open on AniList`, onclick: opener(va.siteUrl) },
        face(va, 'is-mini'), h('span', {}, personName(va))) : null,
      va ? minis(T, T.people && T.people.va, va.id, `pp:a:${ch.id}`, 'Also in') : null);
  });
  return tpSection('chars', 'Characters', [h('div', { class: 'pp-row', role: 'list', style: `--cols:${PEOPLE_COLS}` }, cards),
    all ? onAniList(T, 'characters', 'tp:al:chars') : null], [mal ? castSwitch('anilist') : null, many ? seePeople(T, p, 'chars') : null]);
}

function staffSection(T, p) {
  const every = staffOf(T, true);
  if (!every.length) return null;
  const all = !!p.all.staff;
  const list = all ? every : every.slice(0, PEOPLE_COLS);
  const cards = list.map((x) => {
    const person = x.node;
    const roles = x.roles.slice(0, 2).join(', ');
    return h('div', { class: 'pp', role: 'listitem' },
      h('a', { class: 'pp-face', href: person.siteUrl, 'data-f': `pp:s:${person.id}`, 'aria-label': `${personName(person)}${roles ? `, ${roles}` : ''}. Open on AniList`, onclick: opener(person.siteUrl) }, face(person)),
      h('div', { class: 'pp-name' }, personName(person)),
      roles ? h('div', { class: 'pp-role' }, roles) : null,
      minis(T, T.people && T.people.st, person.id, `pp:o:${person.id}`, 'On your list'));
  });
  return tpSection('staff', 'Staff', [h('div', { class: 'pp-row', role: 'list', style: `--cols:${PEOPLE_COLS}` }, cards),
    all ? onAniList(T, 'staff', 'tp:al:staff') : null], every.length > PEOPLE_COLS ? seePeople(T, p, 'staff') : null);
}

/* People you follow: their status and score (in your format) ------------------------------------ */

// AniList's 100-point scores, in your own format.
function from100(v) {
  if (!v) return 0;
  const f = fmtNow();
  if (f === 'POINT_100') return Math.round(v);
  if (f === 'POINT_10_DECIMAL') return Math.round(v) / 10;
  if (f === 'POINT_5') return Math.max(1, Math.round(v / 20));
  if (f === 'POINT_3') return v >= 61 ? 3 : v >= 36 ? 2 : 1;
  return Math.max(1, Math.round(v / 10));
}

const FRIEND_ROWS = 4;
function friendsSection(T, p) {
  const list = T.friends || [];
  if (!list.length) return null;
  const type = T.media.type;
  const anime = isAnime(type);
  const shown = p.all.friends ? list : list.slice(0, FRIEND_ROWS);
  const rows = shown.map((x) => {
    const u = x.user;
    const sc = from100(x.score);
    const showProg = ['CURRENT', 'REPEATING', 'PAUSED', 'DROPPED'].includes(x.status) && x.progress > 0;
    const said = [u.name, statusWord(type, x.status), showProg ? `${anime ? 'episode' : 'chapter'} ${x.progress}` : null, sc ? `score ${scoreText(sc)}` : null].filter(Boolean).join(', ');
    return h('a', { class: 'fr', href: userUrl(u.name), 'data-f': `fr:${u.id}`, 'aria-label': `${said}. Open their profile`, onclick: opener(userUrl(u.name)) },
      face({ name: { userPreferred: u.name }, image: { large: u.avatar && u.avatar.medium } }, 'is-avatar'),
      h('span', { class: 'fr-text' },
        h('span', { class: 'fr-name' }, u.name),
        h('span', { class: 'fr-st' }, h('span', {}, statusWord(type, x.status)), showProg ? h('span', {}, `${anime ? 'Ep' : 'Ch'} ${x.progress}`) : null)),
      sc ? h('span', { class: 'fr-score' }, scoreValue(sc)) : null);
  });
  return tpSection('friends', 'People you follow', h('div', { class: 'fr-list' }, rows), list.length > FRIEND_ROWS ? seeHere(p, 'friends') : null);
}

/* Openings and endings (0.8): AnimeThemes, else MyAnimeList's list through Tenrai ------------------- */

const SONGS_FOLD = 3;
// Each song (0.12.7): its title (a link to its page on AnimeThemes), the artist and its episodes as one line
// ("MAXIMUM THE HORMONE (Eps 1–13)"), then play it here (AnimeThemes' own video, under the row, one at a time:
// `p.playing`) and look for it on YouTube. The playing <video> is kept across redraws (`songVideo`), like covers.
const SONG_VIDEO_RE = /^https:\/\/v\.animethemes\.moe\/[A-Za-z0-9._-]+\.webm$/;
const songEps = (eps) => `(${/[–,-]/.test(eps) ? 'Eps' : 'Ep'} ${eps})`;
const songYouTube = (x) => `https://www.youtube.com/results?search_query=${encodeURIComponent([x.title, x.by].filter(Boolean).join(' '))}`;
let songVideo = null;   // { key, el }
function songPlayer(key, src, label) {
  if (!songVideo || songVideo.key !== key) {
    songVideo = { key, el: h('video', { class: 'sg-video', src, controls: '', autoplay: '', playsinline: '', preload: 'auto', 'aria-label': label }) };
  }
  return songVideo.el;
}
function songRow(x, k, i, p) {
  const url = x.url && /^https:\/\/animethemes\.moe\/[^\s"'<>]+$/.test(x.url) ? x.url : null;
  const video = x.video && SONG_VIDEO_RE.test(x.video) ? x.video : null;
  const id = `${k}:${x.n}:${x.title}`;
  const playing = !!video && p.playing === id;
  const what = `${k === 'op' ? 'Opening' : 'Ending'} ${x.n}, ${x.title}`;
  const said = [what, x.by ? `by ${x.by}` : null, x.eps ? `episodes ${x.eps}` : null].filter(Boolean).join(', ');
  const yt = songYouTube(x);
  const title = url
    ? h('a', { class: 'sg-title is-link', href: url, 'data-f': `sg:${k}:${i}`, title: 'Its page on AnimeThemes', 'aria-label': `${said}. Its page on AnimeThemes`, onclick: opener(url) }, x.title)
    : h('span', { class: 'sg-title', 'aria-label': said }, x.title);
  const row = h('div', { class: 'sg-row' + (playing ? ' is-playing' : '') },
    h('span', { class: 'sg-n', 'aria-hidden': 'true' }, String(x.n)),
    h('span', { class: 'sg-text' }, title,
      x.by || x.eps ? h('span', { class: 'sg-by', 'aria-hidden': 'true' }, x.by ? h('span', { class: 'sg-artist' }, x.by) : null, x.by && x.eps ? ' ' : null,
        x.eps ? h('span', { class: 'sg-eps' }, songEps(x.eps)) : null) : null),
    h('span', { class: 'sg-acts' },
      video ? h('button', {
        class: 'sg-act' + (playing ? ' is-on' : ''), 'data-f': `sgp:${k}:${i}`, 'aria-pressed': String(playing),
        'aria-label': playing ? `Stop ${what}` : `Play ${what}`, title: playing ? 'Stop' : 'Play it here',
        onclick: () => { p.playing = playing ? null : id; if (!p.playing) songVideo = null; render(); },
      }, icon(playing ? 'close' : 'play')) : null,
      h('a', { class: 'sg-act', href: yt, 'data-f': `sgy:${k}:${i}`, 'aria-label': `Find ${what} on YouTube`, title: 'Find it on YouTube', onclick: opener(yt) }, icon('video'))));
  return h('li', {}, row, playing ? songPlayer(`${p.mediaId}:${id}`, video, `${what}, from AnimeThemes`) : null);
}
function songsSection(T, p) {
  const th = outsideOn() && T.ext && T.ext.themes;
  if (!th || (!th.op.length && !th.ed.length)) return null;
  const all = !!p.all.songs;
  const col = (label, list, k) => (list.length ? h('div', { class: 'sg-col' }, h('h3', { class: 'tc-h' }, label),
    h('ol', { class: 'sg-list' }, (all ? list : list.slice(0, SONGS_FOLD)).map((x, i) => songRow(x, k, i, p)))) : null);
  const many = th.op.length > SONGS_FOLD || th.ed.length > SONGS_FOLD;
  return tpSection('songs', 'Openings and endings', h('div', { class: 'sg' }, col(th.op.length === 1 ? 'Opening' : 'Openings', th.op, 'op'), col(th.ed.length === 1 ? 'Ending' : 'Endings', th.ed, 'ed')),
    many ? seeHere(p, 'songs') : null);
}

/* Reviews and discussions (0.8) ------------------------------------------------------------------- */

// Reddit's discussion threads: r/anime's episode threads, r/manga's [DISC] threads, by the romaji title.
// Under the reviews; in Details when AniList has none.
function redditUrl(T) {
  const m = T.media;
  const t = m.title || {};
  const name = (t.romaji || t.userPreferred || t.english || '').trim();
  if (!name) return null;
  const anime = isAnime(m.type);
  const q = anime ? `"${name}" flair:Episode` : `"${name}" DISC`;
  return `https://www.reddit.com/r/${anime ? 'anime' : 'manga'}/search/?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new`;
}
function redditLink(T) {
  const url = redditUrl(T);
  if (!url) return null;
  return h('a', { class: 'rv-reddit', href: url, 'data-f': 'tp:reddit', onclick: opener(url), style: '--site:255,69,0;--on-site:255,255,255' },
    h('span', { class: 'tp-wl-ic is-letter', 'aria-hidden': 'true' }, 'r'),
    h('span', { class: 'tp-wl-site' }, isAnime(T.media.type) ? 'Episode discussions on r/anime' : 'Chapter discussions on r/manga'),
    icon('external'));
}
const reviewUrl = (r) => `https://anilist.co/review/${r.id}`;
function reviewRow(T, r) {
  const R = T.reviews;
  const openNow = R.open === r.id;
  const u = r.user || {};
  const sc = from100(r.score);
  const num = (n) => Number(n || 0).toLocaleString('en-GB');
  const when = r.createdAt ? new Date(r.createdAt * 1000) : null;
  const date = when ? `${MONTHS[when.getMonth()]} ${when.getFullYear()}` : null;
  const body = R.bodies[r.id];
  let text = null;
  if (openNow) {
    if (body === 'loading' || body === undefined) text = skelLines(4);
    else if (body && body.error) {
      text = h('p', { class: 'tp-quiet' }, "Couldn't load this review. ",
        h('button', { class: 'tp-link', 'data-f': `rv:retry:${r.id}`, onclick: () => { delete R.bodies[r.id]; R.open = null; toggleReview(T, r.id); } }, 'Try again'));
    } else {
      const paras = richText(body, { spoilers: true });
      const shown = !!R.spoil[r.id];
      text = h('div', {
        class: 'rv-body' + (shown ? ' is-shown' : ''), id: `rv-${r.id}`,
        onclick: (ev) => { if (!shown && ev.target.closest('.rv-spoil')) { R.spoil[r.id] = true; render(); } },
      }, paras.length ? paras : h('p', {}, r.summary));
    }
  }
  return h('article', { class: 'rv' + (openNow ? ' is-open' : ''), 'aria-label': `Review by ${u.name || 'someone'}` },
    h('button', { class: 'rv-head', 'data-f': `rv:${r.id}`, 'aria-expanded': String(openNow), 'aria-controls': `rv-${r.id}`, onclick: () => toggleReview(T, r.id) },
      face({ name: { userPreferred: u.name || '?' }, image: { large: u.avatar && u.avatar.medium && !/\/default\.(png|jpe?g)$/i.test(u.avatar.medium) ? u.avatar.medium : null } }, 'is-avatar'),
      h('span', { class: 'rv-text' },
        h('span', { class: 'rv-sum' }, r.summary),
        h('span', { class: 'rv-meta' },
          u.name ? h('span', { class: 'rv-who' }, u.name) : null,
          sc ? h('span', {}, 'Score ', scoreValue(sc)) : null,
          r.ratingAmount ? h('span', {}, `${num(r.rating)} of ${num(r.ratingAmount)} found it helpful`) : null,
          date ? h('span', {}, date) : null)),
      icon('down')),
    text,
    openNow && body && typeof body === 'string' ? h('div', { class: 'rv-acts' },
      h('button', { class: 'tp-link', 'data-f': `rv:fold:${r.id}`, onclick: () => { toggleReview(T, r.id); requestAnimationFrame(() => { const el = app.querySelector(`[data-f="rv:${r.id}"]`); if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); } }); } }, 'Show less'),
      h('button', { class: 'tp-link is-plain', 'data-f': `rv:al:${r.id}`, onclick: () => open(reviewUrl(r)) }, 'Open on AniList', icon('external'))) : null);
}
function reviewsSection(T) {
  const R = T.reviews;
  const list = R ? R.list : [];
  if (!list.length) return null;
  const reddit = redditLink(T);
  const foot = [];
  if (R && R.more) {
    foot.push(h('button', { class: 'tp-link', 'data-f': 'rv:more', disabled: R.loading, onclick: () => moreReviews(T) },
      R.loading ? spin() : 'Show more'));
  }
  if (reddit) foot.push(reddit);
  const facts = R.total > list.length ? h('span', { class: 'tp-sec-facts' }, `${R.total.toLocaleString('en-GB')} on AniList`) : null;
  return tpSection('reviews', 'Reviews', [h('div', { class: 'rv-list' }, list.map((r) => reviewRow(T, r))),
    foot.length ? h('div', { class: 'rv-foot' + (R.more ? '' : ' is-end') }, foot) : null], facts);
}

/* Where to watch: AniList's streaming links ------------------------------------------------------ */

// AniList keeps many links as http:// (Crunchyroll, Hulu...): both are fine, nothing else is.
const webUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : null);
function watchSection(T) {
  const m = T.media;
  const links = (m.externalLinks || []).filter((l) => l && l.type === 'STREAMING' && !l.isDisabled && webUrl(l.url) && l.site);
  if (!links.length) return null;
  const twice = {};
  for (const l of links) twice[l.site] = (twice[l.site] || 0) + 1;
  return tpSection('watch', isAnime(m.type) ? 'Where to watch' : 'Where to read', h('div', { class: 'tp-watch' }, links.map((l) => {
    const rgb = hexToRGB(l.color);
    const ic = l.icon && /^https:\/\//i.test(l.icon) ? webUrl(l.icon) : null;
    return h('a', { class: 'tp-wl', href: l.url, 'data-f': `tp:wl:${l.id || l.site}`, onclick: opener(l.url), style: rgb ? `--site:${rgb};--on-site:${onColor(rgb)}` : null },
      h('span', { class: 'tp-wl-ic' + (ic ? '' : ' is-letter'), 'aria-hidden': 'true' }, ic ? h('img', { src: ic, alt: '', decoding: 'async' }) : Array.from(l.site)[0]),
      h('span', { class: 'tp-wl-site' }, l.site),
      twice[l.site] > 1 && l.language ? h('span', { class: 'tp-wl-lang' }, l.language) : null,
      icon('external'));
  })));
}

/* Your history: each time you watched it ------------------------------------------------------ */

function runDates(r) {
  const a = dateWords(r.start);
  const b = dateWords(r.end);
  const st = r.state;
  if (a && b) return `${a === b ? b : `${a} to ${b}`}${st === 'dropped' ? ', dropped' : ''}`;
  if (b) return st === 'dropped' ? `Dropped ${b}` : `Finished ${b}`;
  if (a) return st === 'now' ? `Since ${a}` : st === 'paused' ? `Since ${a}, paused` : st === 'dropped' ? `Started ${a}, dropped` : st === 'stopped' ? `Started ${a}, stopped` : `Started ${a}`;
  if (r.before) return 'Before your activity history';
  return st === 'now' ? 'In progress' : st === 'done' ? 'No dates' : sentence(st);
}

function historySection(T) {
  const e = T.entry;
  if (!state.history || !hasHistory(e)) return null;
  const anime = isAnime(e.type);
  const sig = historySig(e);
  if (!T.hist || T.hist.sig !== sig) setTimeout(() => loadHistory(T), 0);
  const H = T.hist && T.hist.sig === sig ? T.hist : { state: 'loading' };
  let body;
  if (H.state === 'loading') body = skelLines(2);
  else if (H.state === 'error') {
    body = h('p', { class: 'tp-quiet hist-error' }, "Couldn't read your activity. ",
      h('button', { class: 'tp-link', 'data-f': 'tp:hist-retry', onclick: () => loadHistory(T, true) }, 'Try again'));
  } else {
    const log = H.log;
    const W = anime ? 'Watched' : 'Read';
    const sum = log.now && log.now.kind === 'rewatch'
      ? `${anime ? 'Rewatching' : 'Rereading'} now${log.times ? `, ${W.toLowerCase()} ${timesWord(log.times)} before` : ''}`
      : log.times ? `${W} ${timesWord(log.times)}` : log.now ? `${anime ? 'Watching' : 'Reading'} for the first time` : 'Nothing finished yet';
    const label = (r) => (r.kind === 'first' ? (anime ? 'First watch' : 'First read') : r.kind === 'try' ? 'First try' : `${anime ? 'Rewatch' : 'Reread'} ${r.n}`);
    const missing = log.missing;
    body = h('div', { class: 'hist' },
      h('div', { class: 'hist-sum' }, sum),
      log.runs.length ? h('ol', { class: 'hist-runs' }, log.runs.map((r) => h('li', { class: `hist-run is-${r.state}` },
        h('span', { class: 'hist-dot', 'aria-hidden': 'true' }), h('span', { class: 'hist-k' }, label(r)), h('span', { class: 'hist-d' }, runDates(r))))) : null,
      missing ? h('p', { class: 'hist-note' }, `${missing} earlier ${rewatchWord(e.type)}${missing === 1 ? " isn't" : "es aren't"} in your activity, so ${missing === 1 ? 'it has' : 'they have'} no dates.`) : null);
  }
  return tpSection('hist', 'Your history', body);
}

/* Details: the facts, last ------------------------------------------------------------------------ */

function detailsSection(T) {
  const m = T.media;
  const anime = isAnime(m.type);
  const facts = [];
  if (m.nextAiringEpisode) {
    const n = m.nextAiringEpisode;
    const day = new Date(n.airingAt * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    facts.push(fieldRow('Next episode', h('div', { class: 'tp-pieces' },
      h('b', {}, `Episode ${n.episode}`), h('span', {}, soon(n.airingAt)), h('span', { class: 'tp-quiet' }, `${day}, `, clock(n.airingAt)))));
  }
  // The other titles it goes by (romaji, English, Japanese), when they differ from the one shown.
  const t = m.title || {};
  const aka = [...new Set([t.romaji, t.english, t.native].filter((x) => x && x !== t.userPreferred))];
  if (aka.length) facts.push(fieldRow('Also known as', h('div', { class: 'tp-aka' }, aka.map((x) => h('span', {}, x))), 'is-top'));
  // The studio that made it, then the producers (AniList's other studios for it).
  const edges = (m.studios && m.studios.edges) || ((m.studios && m.studios.nodes) || []).map((node) => ({ isMain: true, node }));
  const studio = (list, f) => h('div', { class: 'tp-pieces' }, list.map((x) => h('button', { class: 'tp-plain', 'data-f': `tp:${f}:${x.node.id}`, onclick: () => open(x.node.siteUrl) }, x.node.name)));
  const named = edges.filter((x) => x && x.node && x.node.name);
  const main = named.filter((x) => x.isMain);
  const producers = named.filter((x) => !x.isMain).slice(0, 6);
  if (main.length) facts.push(fieldRow(main.length > 1 ? 'Studios' : 'Studio', studio(main, 'studio')));
  if (producers.length) facts.push(fieldRow(producers.length > 1 ? 'Producers' : 'Producer', studio(producers, 'producer'), producers.length > 2 ? 'is-top' : ''));
  if (m.source) facts.push(fieldRow('Source', SOURCES[m.source] || sentence(m.source)));
  const aired = airedText(m);
  if (aired) facts.push(fieldRow(anime ? 'Aired' : 'Published', aired));
  if (anime && m.duration) facts.push(fieldRow('Length', m.format === 'MOVIE' ? duration(m.duration) : [h('b', {}, String(m.duration)), ' min per episode']));
  const genres = (m.genres || []).filter(Boolean);
  if (genres.length) facts.push(fieldRow('Genres', h('div', { class: 'tp-pieces is-genres' }, genres.map((g) => h('span', {}, g))), 'is-top'));
  const tags = tagsBlock(T);
  if (tags) facts.push(fieldRow('Tags', tags, 'is-top'));
  // The best ranking is in the header; the others here.
  const ranks = rankingsOf(m).slice(1);
  if (ranks.length) facts.push(fieldRow('Rankings', h('ul', { class: 'tp-ranks' }, ranks.map((r) => h('li', {}, h('b', {}, `#${r.rank}`), ` ${rankWords(r)}`))), 'is-top'));
  const num = (n) => Number(n).toLocaleString('en-GB');
  if (m.popularity) facts.push(fieldRow('Popularity', `On ${num(m.popularity)} lists`));
  if (m.favourites) facts.push(fieldRow('Favourites', num(m.favourites)));
  // The official site (AniList sometimes lists the same one twice: once is enough).
  const seen = new Set();
  const sites = (m.externalLinks || []).filter((l) => l && l.type === 'INFO' && /official/i.test(l.site || '') && webUrl(l.url) && !seen.has(l.url.replace(/^https?:\/\/(www\.)?|\/$/g, '')) && seen.add(l.url.replace(/^https?:\/\/(www\.)?|\/$/g, '')));
  if (sites.length) {
    facts.push(fieldRow(sites.length > 1 ? 'Official sites' : 'Official site', h('div', { class: 'tp-pieces' }, sites.slice(0, 3).map((l) => h('button', { class: 'tp-plain tp-site', 'data-f': `tp:site:${l.id || l.url}`, onclick: () => open(l.url) },
      l.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''), sites.length > 1 && l.language ? h('span', { class: 'tp-quiet' }, ` ${l.language}`) : null, icon('external'))))));
  }
  // Reddit's discussions, when there are no reviews for them to sit under (0.8).
  const reddit = !(T.reviews && T.reviews.list.length) && redditUrl(T);
  if (reddit) {
    facts.push(fieldRow('Discussions', h('div', { class: 'tp-pieces' }, h('button', { class: 'tp-plain tp-site', 'data-f': 'tp:reddit', onclick: () => open(reddit) },
      anime ? 'Episode threads on r/anime' : 'Chapter threads on r/manga', icon('external')))));
  }
  if (!facts.length) return null;
  return tpSection('details', 'Details', h('dl', { class: 'tp-fields is-facts' }, facts));
}

// Tags with how well they fit; spoiler tags stay hidden until you ask.
function tagsBlock(T) {
  const tags = (T.media.tags || []).filter((t) => t && t.name).sort((a, b) => (b.rank || 0) - (a.rank || 0));
  if (!tags.length) return null;
  const spoils = (t) => t.isMediaSpoiler || t.isGeneralSpoiler;
  const plain = tags.filter((t) => !spoils(t));
  const spoilers = tags.filter(spoils);
  const LIMIT = 8;
  const shown = T.allTags ? plain : plain.slice(0, LIMIT);
  const tag = (t, sp) => h('span', { class: 'tp-tagname' + (sp ? ' is-spoiler' : '') }, t.name, t.rank ? h('span', { class: 'tp-pct' }, `${t.rank}%`) : null);
  const items = [...shown.map((t) => tag(t, false)), ...(T.spoilers ? spoilers.map((t) => tag(t, true)) : [])];
  const more = [];
  if (!T.allTags && plain.length > LIMIT) more.push(h('button', { class: 'tp-link', 'data-f': 'tp:alltags', onclick: () => { T.allTags = true; render(); } }, `Show ${plain.length - LIMIT} more`));
  if (spoilers.length) {
    const n = spoilers.length;
    more.push(h('button', { class: 'tp-link', 'data-f': 'tp:spoilers', 'aria-expanded': String(!!T.spoilers), onclick: () => { T.spoilers = !T.spoilers; render(); } },
      T.spoilers ? `Hide spoiler tag${n === 1 ? '' : 's'}` : `Show ${n} spoiler tag${n === 1 ? '' : 's'}`));
  }
  return h('div', {}, items.length ? h('div', { class: 'tp-pieces is-tags' }, items) : null, more.length ? h('div', { class: 'tp-more' }, more) : null);
}

// The sticky bar: the title shows in it once the big one has scrolled away. The header's color
// also fills the scrollbar's strip beside it (the scroll's own background, moved by --sy).
function stickBar(sc) {
  sc.style.setProperty('--sy', `${sc.scrollTop}px`);
  const bar = sc.querySelector('.tp-bar');
  // Over a banner the bar is clear (glass buttons on the picture) until the picture has gone under it.
  const banner = sc.querySelector('.tp-banner');
  if (banner && bar) sc.classList.toggle('bar-solid', sc.scrollTop >= banner.offsetHeight - bar.offsetHeight - 1);
  const t = sc.querySelector('.tp-title');
  if (!bar || !t) return;
  const top = sc.getBoundingClientRect().top;
  bar.classList.toggle('is-stuck', t.getBoundingClientRect().bottom - top < bar.offsetHeight);
}
function layoutTitle(sc) {
  const head = sc.querySelector('.tp-head');
  const bar = sc.querySelector('.tp-bar');
  if (!head) return;
  const top = sc.getBoundingClientRect().top;
  sc.style.setProperty('--head-h', `${head.getBoundingClientRect().bottom - top + sc.scrollTop}px`);
  if (bar) sc.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
  const banner = sc.querySelector('.tp-banner');
  if (banner) sc.style.setProperty('--banner-h', `${banner.offsetHeight}px`);
  for (const ta of sc.querySelectorAll('.tp-notes')) fitNotes(ta);
  // "Show more" only when the description doesn't fit in its 4 lines.
  const desc = sc.querySelector('.tp-desc.is-folded');
  const more = sc.querySelector('[data-f="tp:more"]');
  if (desc && more) more.hidden = desc.scrollHeight <= desc.clientHeight + 2;
  stickBar(sc);
}

/* Search (0.6.9): anime, manga and light novels on AniList ---------------------------------------
   The box at the top (focused on arrival, / from anywhere), All / Anime / Manga / Light novels, then
   rows: the cover, the title (and the title you typed when AniList prefers another), quiet meta, and
   your status when it's on your list, else "+ Planning" on hover. A row opens its title page here.
   Before you type: the titles you opened from a search lately. */

const SEARCH_KINDS = {
  ALL: { label: 'All' },
  ANIME: { label: 'Anime', type: 'ANIME' },
  MANGA: { label: 'Manga', type: 'MANGA', formats: ['MANGA', 'ONE_SHOT'] },
  NOVEL: { label: 'Light novels', type: 'MANGA', formats: ['NOVEL'] },
};
const SEARCH_PER_PAGE = 20;
const SEARCH_WAIT = 320;     // ms after the last key before asking AniList (the palette's pause)
const RECENT_KEY = 'popup:recent';
const RECENT_MAX = 6;
// Adult titles only when your AniList account shows them in search (its "18+ content" settings) and
// Tsugi's "Hide adult titles" is off. Your account's settings come back with each search.
const searchQuery = (k, adult) => `query TsugiSearch($q: String, $page: Int) {
  Page(page: $page, perPage: ${SEARCH_PER_PAGE}) {
    pageInfo { hasNextPage }
    media(search: $q${k.type ? `, type: ${k.type}` : ''}${k.formats ? `, format_in: [${k.formats.join(', ')}]` : ''}${adult ? '' : ', isAdult: false'}, sort: [SEARCH_MATCH]) {
      id type format status episodes chapters season seasonYear siteUrl isAdult genres tags { id rank }
      startDate { year month day }
      title { userPreferred romaji english native }
      coverImage { large medium color }
      mediaListEntry { id status progress score }
    }
  }
  Viewer { id options { displayAdultContent includeAdultContentInSearch } }
}`;

const adultShown = () => !!state.search.adultOk && !state.hideAdult;
// With "Hide NSFW titles" on, what counts as NSFW (0.12.3, your choices in Settings) stays out of the results too,
// not only what AniList marks 18+.
const searchShows = (n) => !state.hideAdult || !nsfwWhy(nsfwFacts(n), state.nsfw.set, n.type === 'MANGA' ? 'MANGA' : 'ANIME', state.nsfw.marks[n.id]);
// Two letters are enough to search; one Japanese or Chinese character already says a lot.
const searchable = (q) => q.length >= 2 || /[^\u0000-ɏ]/.test(q);
const searchKey = (q, kind) => `${kind}|${adultShown() ? 1 : 0}|${q.toLowerCase()}`;
const currentKey = () => { const S = state.search; const q = S.q.trim(); return searchable(q) ? searchKey(q, S.kind) : null; };
function searchNodes() {
  const out = [];
  for (const r of state.search.cache.values()) out.push(...r.items);
  return out;
}

let searchTimer = null;
// Asks AniList for what's in the box (unless it already answered that). Answers that arrive after
// you've typed something else are kept for later but not shown.
async function runSearch(force = false) {
  clearTimeout(searchTimer);
  const S = state.search;
  const q = S.q.trim();
  const key = currentKey();
  if (!key) { render(); return; }
  if (!force && S.cache.has(key)) { S.shown = key; render(); return; }
  if (!force && S.loading === key) return;
  const seq = ++S.seq;
  const adult = adultShown();
  S.loading = key;
  state.error = null;
  render();
  try {
    const d = await gql(searchQuery(SEARCH_KINDS[S.kind], adult), { q, page: 1 });
    const pg = (d && d.Page) || {};
    S.cache.set(key, { items: dedupe(pg.media), page: 1, next: !!(pg.pageInfo && pg.pageInfo.hasNextPage), q });
    if (seq === S.seq) S.shown = key;
    if (learnAdult(d) && seq === S.seq) { S.loading = null; runSearch(); return; }
  } catch (err) {
    if (seq === S.seq) state.error = `Couldn't search AniList: ${err.message}`;
  } finally {
    if (seq === S.seq && S.loading === key) S.loading = null;
  }
  render();
}

// Your account's 18+ setting, from an answer. True when it changed what search should ask for.
function learnAdult(d) {
  const o = d && d.Viewer && d.Viewer.options;
  if (!o || typeof o.displayAdultContent !== 'boolean') return false;
  const before = adultShown();
  const ok = o.displayAdultContent && o.includeAdultContentInSearch !== false;
  state.search.adultOk = ok;
  try { chrome.storage.local.set({ 'popup:adult': ok }); } catch { /* ignore */ }
  return adultShown() !== before;
}

function dedupe(list, have = []) {
  const seen = new Set(have.map((n) => n.id));
  return (list || []).filter((n) => n && n.id && n.title && !seen.has(n.id) && seen.add(n.id));
}

// "More results": AniList's next page, under the ones shown.
async function moreResults() {
  const S = state.search;
  const key = S.shown;
  const r = key && S.cache.get(key);
  if (!r || !r.next || S.more) return;
  S.more = true;
  render();
  try {
    const kind = key.split('|')[0];
    const d = await gql(searchQuery(SEARCH_KINDS[kind], key.split('|')[1] === '1'), { q: r.q, page: r.page + 1 });
    const pg = (d && d.Page) || {};
    r.items = [...r.items, ...dedupe(pg.media, r.items)];
    r.page += 1;
    r.next = !!(pg.pageInfo && pg.pageInfo.hasNextPage);
  } catch (err) {
    state.error = `Couldn't load more results: ${err.message}`;
  } finally {
    S.more = false;
  }
  render();
}

function searchLoad(o) {
  if (o && o.force) return runSearch(true);
  const key = currentKey();
  if (key && !state.search.cache.has(key)) return runSearch();
  return Promise.resolve();
}

// The box, or Search itself, from anywhere: "/" (Shift + : on a French keyboard).
function openSearch() {
  if (state.view === 'search' && !state.stack.length) {
    const box = app.querySelector('.sr-input');
    if (box) { box.focus(); box.select(); }
    return;
  }
  go('search');
}

function setKind(kind) {
  const S = state.search;
  if (S.kind === kind) return;
  S.kind = kind;
  try { chrome.storage.local.set({ 'popup:searchKind': kind }); } catch { /* ignore */ }
  scrollPos.search = 0;
  runSearch();
}

// Typing doesn't redraw the window (letters being composed, Japanese for one, would be cut short);
// the results do, when they come.
let composing = false;
function onSearchInput(ev) {
  const S = state.search;
  const was = !!S.q.trim();
  S.q = ev.target.value;
  clearTimeout(searchTimer);
  const key = currentKey();
  if (key && S.cache.has(key)) { S.shown = key; render(); return; }
  if (!key) S.shown = null;
  if (key) searchTimer = setTimeout(() => runSearch(), SEARCH_WAIT);
  // The clear button and Recently opened come and go with the first letter.
  if (was !== !!S.q.trim() || !key) render();
}

function searchKeys(ev) {
  if (ev.isComposing) return;
  const S = state.search;
  if (ev.key === 'Enter') {
    ev.preventDefault();
    const key = currentKey();
    const r = key && S.shown === key && S.cache.get(key);
    // The results of what's typed are shown: Enter opens the first. Otherwise: search now.
    if (r && r.items.length) {
      const first = app.querySelector('.sr-list:not(.is-stale) .sr-title');
      if (first) first.click();
    } else runSearch();
    return;
  }
  if (ev.key === 'ArrowDown') {
    const first = app.querySelector('.sr-list .sr-title');
    if (first) { ev.preventDefault(); first.focus(); }
  }
}

function clearSearch() {
  const S = state.search;
  S.q = '';
  S.shown = null;
  clearTimeout(searchTimer);
  state.focusSearch = true;
  scrollPos.search = 0;
  render();
}

// The titles you opened from a search, newest first (local "popup:recent"; only what a row shows,
// never your status, which could be out of date by the next time).
function rememberRecent(n) {
  const keep = {
    id: n.id, type: n.type, format: n.format, status: n.status, episodes: n.episodes, chapters: n.chapters,
    seasonYear: n.seasonYear, startDate: n.startDate ? { year: n.startDate.year } : null, siteUrl: n.siteUrl,
    title: { userPreferred: n.title.userPreferred }, coverImage: n.coverImage,
  };
  const S = state.search;
  S.recent = [keep, ...S.recent.filter((x) => x.id !== n.id)].slice(0, RECENT_MAX);
  try { chrome.storage.local.set({ [RECENT_KEY]: S.recent }); } catch { /* ignore */ }
}
function forgetRecent() {
  state.search.recent = [];
  try { chrome.storage.local.remove(RECENT_KEY); } catch { /* ignore */ }
  render();
  const box = app.querySelector('.sr-input');
  if (box) box.focus();
}

// The title as you typed it, when AniList prefers another one ("Attack on Titan" for "Shingeki no Kyojin").
const fold = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
function typedTitle(n, q) {
  const want = fold(q);
  if (!want || fold(n.title.userPreferred).includes(want)) return null;
  for (const k of ['english', 'romaji', 'native']) {
    const t = n.title[k];
    if (t && t !== n.title.userPreferred && fold(t).includes(want)) return t;
  }
  return null;
}

// TV, 2023, 24 episodes, Airing: separate quiet pieces ("Finished" goes without saying).
function searchMeta(n) {
  const anime = isAnime(n.type);
  const out = [];
  if (n.format) out.push(FORMATS[n.format] || sentence(n.format));
  const year = n.seasonYear || (n.startDate && n.startDate.year);
  if (year) out.push(String(year));
  const c = anime ? n.episodes : n.chapters;
  if (c && !(n.format === 'MOVIE' && c === 1)) out.push(anime ? `${c} episode${c === 1 ? '' : 's'}` : `${c} chapter${c === 1 ? '' : 's'}`);
  if (n.status && n.status !== 'FINISHED') out.push(n.status === 'RELEASING' && !anime ? 'Publishing' : STATUS_TEXT[n.status] || sentence(n.status));
  return out;
}

// Your status on the right: "Watching" and "Ep 4 of 12", "Completed" and your score.
function searchStatus(n, le) {
  const anime = isAnime(n.type);
  const total = anime ? n.episodes : n.chapters;
  let more = null;
  if (le.status === 'COMPLETED' && le.score) more = ['Score ', scoreValue(le.score)];
  else if (le.status !== 'PLANNING' && le.progress) more = `${anime ? 'Ep' : 'Ch'} ${le.progress}${total ? ` of ${total}` : ''}`;
  return h('div', { class: 'sr-st', 'aria-hidden': 'true' },
    h('span', { class: 'sr-st-w' }, statusWord(n.type, le.status)),
    more ? h('span', { class: 'sr-st-d' }, more) : null);
}

function searchRow(n, f, recent = false) {
  const title = n.title.userPreferred;
  const le = recent ? null : n.mediaListEntry;
  const busy = state.busy.has(`m:${n.id}`);
  const alt = recent ? null : typedTitle(n, state.search.q.trim());
  const meta = searchMeta(n);
  const status = le ? statusWord(n.type, le.status) : null;
  const said = [title, alt, ...meta, status ? `on your list: ${status}` : recent ? null : 'not on your list'].filter(Boolean).join(', ');
  const openIt = titleOpener(n.id, n, f);
  const id = `s${n.id}`;
  return h('div', {
    class: 'sr-row' + (hotId === id ? ' is-hot' : '') + (busy ? ' is-busy' : ''), 'data-id': id, 'data-navfrom': f, role: 'listitem', style: titleStyle(n),
  },
  h('span', { class: 'sr-cover', 'aria-hidden': 'true', style: n.coverImage && n.coverImage.color ? `background-color:${n.coverImage.color}` : null }, cover(thumbUrl(n))),
  h('div', { class: 'sr-text' },
    h('a', {
      class: 'sr-title', href: n.siteUrl, 'data-nav': '', 'data-f': f, 'aria-label': said,
      onclick: (ev) => { if (!(ev.ctrlKey || ev.metaKey || ev.shiftKey)) rememberRecent(n); openIt(ev); },
    }, title),
    alt ? h('div', { class: 'sr-alt', 'aria-hidden': 'true' }, alt) : null,
    meta.length ? h('div', { class: 'sr-meta', 'aria-hidden': 'true' }, meta.map((t) => h('span', {}, t))) : null),
  le ? searchStatus(n, le)
    : recent ? null
      : h('button', {
        class: 'sr-add', 'data-f': `${f}:add`, disabled: busy, 'aria-label': `Add ${title} to Planning`, title: 'Add to Planning',
        onclick: () => addTitle(n.id, 'PLANNING', n),
      }, busy ? spin() : [icon('plus'), 'Planning']));
}

function searchHead() {
  const S = state.search;
  const box = h('input', {
    class: 'sr-input', type: 'text', value: S.q, placeholder: 'Search anime, manga and light novels', 'aria-label': 'Search AniList',
    autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', 'data-f': 'sr:q', 'data-nav': '', 'aria-keyshortcuts': '/',
  });
  box.addEventListener('input', onSearchInput);
  box.addEventListener('keydown', searchKeys);
  box.addEventListener('compositionstart', () => { composing = true; });
  box.addEventListener('compositionend', (ev) => {
    composing = false;
    onSearchInput(ev);
    if (renderLater && !pressing) { renderLater = false; setTimeout(render, 0); }
  });
  const loading = !!S.loading && S.loading === currentKey();
  return h('div', { class: 'sr-head' },
    h('div', { class: 'sr-box' + (loading ? ' is-loading' : '') }, icon('search'), box,
      loading ? spin()
        : S.q ? h('button', { class: 'sr-clear', 'data-f': 'sr:clear', 'aria-label': 'Clear the search', title: 'Clear', onclick: clearSearch }, icon('close')) : null),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'What to search' },
      Object.entries(SEARCH_KINDS).map(([k, v]) => h('button', {
        class: 'seg-btn', role: 'radio', 'aria-checked': String(S.kind === k), 'data-f': `sr:k:${k}`, onclick: () => setKind(k),
      }, v.label))));
}

function searchView() {
  const S = state.search;
  const q = S.q.trim();
  const key = currentKey();
  const out = [searchHead()];
  if (!key) {
    if (S.recent.length) {
      out.push(tpSection('recent', 'Recently opened',
        h('div', { class: 'sr-list', role: 'list' }, S.recent.map((n) => searchRow(n, `sr:r:${n.id}`, true))),
        h('button', { class: 'tp-see', 'data-f': 'sr:forget', onclick: forgetRecent }, 'Clear')));
    } else if (!q) {
      out.push(empty('search', 'Search AniList', 'Anime, manga and light novels, by their English, romaji or Japanese title. Press / to search from anywhere in Tsugi.'));
    }
    return out;
  }
  // Until AniList answers what's typed now, the last results stay, dimmed.
  const r0 = S.cache.get(S.shown);
  const r = r0 && { ...r0, items: r0.items.filter(searchShows) };
  const stale = S.shown !== key;
  if (!r || (stale && !r.items.length)) { out.push(skeletonRows(5)); return out; }
  if (!r.items.length && !r.next) {
    const path = S.kind === 'ALL' || S.kind === 'ANIME' ? 'anime' : 'manga';
    out.push(empty('search', `Nothing found for “${q}”`, 'Check the spelling, or try its English or Japanese title.',
      h('button', { class: 'btn', onclick: () => open(`https://anilist.co/search/${path}?search=${encodeURIComponent(q)}`) }, icon('external'), 'Search on AniList')));
    return out;
  }
  out.push(h('div', { class: 'sr-list' + (stale ? ' is-stale' : ''), role: 'list', 'aria-label': 'Results', 'aria-busy': stale ? 'true' : null },
    r.items.map((n) => searchRow(n, `sr:${n.id}`))));
  if (r.next && !stale) {
    out.push(h('button', { class: 'more', 'data-f': 'sr:more', disabled: S.more, onclick: moreResults }, S.more ? spin() : 'More results'));
  }
  return out;
}

/* Settings (0.6.10): one set with the hub's on AniList (sync "settings") ------------------------------
   Five groups, each folded to one line that says what's set, one unfolded at a time (like the list
   Filters on AniList). The popup's own settings (theme, where it opens, the count on the toolbar button)
   sit in the same object: the hub keeps every key it doesn't know when it saves. */

// The hub's defaults (content/core.js, normalizeSettings), then the popup's own: change both together.
const SETTING_DEFAULTS = {
  dir: 'desc', sortPage: false, dock: 'bar', dockSide: 'right', accent: 'auto',
  badges: true, watchOrder: true, newEps: true, keys: true, rememberSort: true,
  autoDates: true, history: true, palette: true, feedFilters: true, listViews: true, hideAdult: false, prioFinished: false,
  posters: false, malData: true, scores: { al: true, mal: true, mb: true, kitsu: false, mu: false, ap: false, ann: false, shiki: false },
  theme: 'site', paletteHub: true, popupStart: 'last', badge: true, checkEvery: 5,
  // 0.12.6: where the toolbar button opens Tsugi (background.js applyOpenIn), and the toolbar popup's width.
  openIn: 'popup', popupSize: 'm',
  // 0.12.5: a switch for everything. On AniList: sorts and filters apart, dragging, the title page's parts,
  // Pick for me, List check (content/core.js has these too). Here: the rail's sections and the title pages'.
  listSorts: true, listFilters: true, dragOrder: true, pick: true, listCheck: true,
  // 0.12.7: MyAnimeList's and Reddit's links in a title's sidebar, a profile's follower counts, why a profile is
  // missing, AniList's link on MyAnimeList's pages (background.js registers that script), the global feed hidden.
  sideLinks: true, socialCounts: true, check404: true, malLinks: true, hideGlobal: false,
  rail: { upnext: true, today: true, search: true, notifs: true },
  tpSecs: { desc: true, order: true, friends: true, chars: true, staff: true, songs: true, recs: true, reviews: true, watch: true, details: true },
};
// A map of switches, every one a boolean, the missing ones on (rail, tpSecs).
function switchMap(raw, defaults) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = r[k] !== false;
  return out;
}
const ACCENTS = ['blue', 'purple', 'pink', 'orange', 'red', 'green', 'gray'];
const THEME_NAMES = { site: 'Same as AniList', light: 'Light', dark: 'Dark', contrast: 'High contrast' };
const themeName = (v) => THEME_NAMES[v] || (paletteOf(v) ? paletteOf(v).name : v);
const START_NAMES = { last: 'Where you left it', now: 'Now', upnext: 'Up Next', today: 'Today' };
// Where the toolbar button opens Tsugi (0.12.6). The side panel only where the browser has one for extensions
// (Chrome, and Brave since 1.58, in its sidebar).
const PANEL_OK = !!(chrome.sidePanel && chrome.sidePanel.open);
const OPEN_INS = { popup: 'Popup', window: 'Window', tab: 'Tab', panel: 'Side panel' };
const SIZE_NAMES = { s: 'Compact', m: 'Standard', l: 'Wide', xl: 'Widest' };
const CHECK_TIMES = [1, 5, 15, 30, 60];
const minutesWord = (n) => (n === 60 ? '1 h' : `${n} min`);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const s = { ...SETTING_DEFAULTS, ...r };
  // 0.7.1: the hub's button moved into AniList's top bar; older settings move there once (not a hidden one).
  if (!r.dockBar && s.dock !== 'hide') s.dock = 'bar';
  s.dockBar = true;
  if (!['bar', 'always', 'near', 'hide'].includes(s.dock)) s.dock = 'bar';
  if (!['right', 'left'].includes(s.dockSide)) s.dockSide = 'right';
  if (s.accent !== 'auto' && !ACCENTS.includes(s.accent)) s.accent = 'auto';
  if (s.dock === 'hide') s.keys = true;   // the hub's rule: keep a way to open it
  if (!THEME_NAMES[s.theme] && !paletteOf(s.theme)) s.theme = 'site';
  s.paletteHub = s.paletteHub !== false;
  if (!START_NAMES[s.popupStart]) s.popupStart = 'last';
  if (!OPEN_INS[s.openIn] || (s.openIn === 'panel' && !PANEL_OK)) s.openIn = 'popup';
  if (!POPUP_SIZES[s.popupSize]) s.popupSize = 'm';
  s.checkEvery = CHECK_TIMES.includes(Number(s.checkEvery)) ? Number(s.checkEvery) : 5;
  s.badge = s.badge !== false;
  for (const k of ['listSorts', 'listFilters', 'dragOrder', 'pick', 'listCheck', 'sideLinks', 'socialCounts', 'check404', 'malLinks']) s[k] = s[k] !== false;
  s.hideGlobal = s.hideGlobal === true;
  s.rail = switchMap(r.rail, SETTING_DEFAULTS.rail);
  s.tpSecs = switchMap(r.tpSecs, SETTING_DEFAULTS.tpSecs);
  // The section it opens on can't be one taken out of the rail.
  if (s.popupStart !== 'last' && s.rail[s.popupStart] === false) s.popupStart = 'last';
  s.scores = normalizeScores(r.scores, r.malData);
  return s;
}
// The scores on title pages (0.12.4), one switch per site. Before 0.12.4 one switch (malData) said whether
// Tsugi asked anything outside AniList: if it was off, the other sites' scores start off too.
// content/core.js has a copy: change both together.
function normalizeScores(raw, malData) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const out = {};
  for (const k of SCORE_SITES) out[k] = r && typeof r[k] === 'boolean' ? r[k] : !r && malData === false && k !== 'al' ? false : SETTING_DEFAULTS.scores[k];
  return out;
}

// Settings arriving from storage: the hub's switches the popup follows, the theme and the accent.
function readSettings(raw) {
  const s = normalizeSettings(raw);
  state.settings = s;
  state.autoDates = s.autoDates !== false;
  state.prioFinished = !!s.prioFinished;
  state.history = s.history !== false;
  // Switched in the hub: answers kept for the other setting don't count any more.
  if (!!s.hideAdult !== state.hideAdult) { state.hideAdult = !!s.hideAdult; state.search.cache.clear(); state.search.shown = null; }
  applyTheme();
  applyAccent();
  applyPopupSize();
  // A section taken out of the rail while it's shown: back to Now.
  if (state.view && !railOn(state.view)) { state.view = 'now'; state.stack = []; }
  // A score switched on: the title pages open now ask for it (switched off, it simply isn't drawn).
  for (const p of state.stack || []) { const T = state.titles[p.mediaId]; if (T && T.media) loadOutside(T); }
}

// Chrome tells every page about each save, this one included, and that notice can come after a newer
// change made here: what the popup saved itself is remembered for a few seconds, so its late echo
// can't undo the newer change (the hub does the same, content/core.js isOwnEcho). Chrome hands objects
// back with their keys sorted, hence stableJSON.
const ownSaves = [];
function stableJSON(v) {
  if (Array.isArray(v)) return `[${v.map(stableJSON).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJSON(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
// Notices come in the order of the saves: once a save's own notice is seen, it and the older ones are
// forgotten. So the same settings saved elsewhere a moment later (the hub switching back what the popup
// just switched) count as a change, not as a late echo (0.7; they were ignored for 5 s).
function isOwnEcho(value) {
  const json = stableJSON(value);
  const now = Date.now();
  const i = ownSaves.findIndex((w) => w.json === json && now - w.t < 5000);
  if (i < 0) return false;
  ownSaves.splice(0, i + 1);
  return true;
}

// Saved at once, not after a pause: the popup can close the next moment.
function saveSettings(patch) {
  const next = normalizeSettings({ ...state.settings, ...patch });
  readSettings(next);
  render();
  const now = Date.now();
  while (ownSaves.length && now - ownSaves[0].t > 5000) ownSaves.shift();
  ownSaves.push({ json: stableJSON(next), t: now });
  try { chrome.storage.sync.set({ settings: next }).catch(() => {}); } catch { /* the extension was reloaded */ }
}

function toggleGroup(key) {
  state.setOpen = state.setOpen === key ? null : key;
  if (state.setOpen === 'about') loadRate();
  // A group that reads something when it opens (NSFW titles: your lists, for its counts).
  const opened = SET_GROUPS.find((g) => g.key === state.setOpen);
  if (opened && opened.open) opened.open();
  render();
  // The group just unfolded stays in sight: its line goes under the title if the rest would be cut off.
  const g = state.setOpen && app.querySelector(`.set-g[data-g="${key}"]`);
  const sc = app.querySelector('.scroll');
  if (g && sc && g.getBoundingClientRect().bottom > sc.getBoundingClientRect().bottom) {
    g.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
  }
}

// AniList's own count of requests left this minute, as the request queue last heard it (background.js).
let rateTimer = null;
async function loadRate() {
  try { state.rate = (await chrome.storage.session.get('rate')).rate || null; } catch { state.rate = null; }
  render();
}
function rateNow() {
  const r = state.rate || {};
  const now = Date.now();
  const fresh = !!r.at && now - r.at < 60000 && r.left != null;
  const limit = Number(r.limit) || null;
  return {
    limit, fresh, left: fresh ? Math.max(0, Number(r.left)) : limit,
    mine: (r.recent || []).filter((t) => now - t < 60000).length,
    paused: r.pausedUntil > now ? r.pausedUntil : 0,
    // When what's shown changes on its own: the count's minute ends, a pause ends.
    next: Math.min(...[fresh ? r.at + 60000 : Infinity, ...(r.recent || []).map((t) => t + 60000).filter((t) => t > now), r.pausedUntil > now ? r.pausedUntil : Infinity]),
  };
}
function rateTick(rt) {
  clearTimeout(rateTimer);
  if (!Number.isFinite(rt.next)) return;
  rateTimer = setTimeout(() => { if (state.view === 'settings' && state.setOpen === 'about') render(); }, Math.max(500, rt.next - Date.now() + 50));
}

/* The pieces of a group: a switch with one sentence, a choice of a few (Ink-filled once chosen). */

function setSwitch(key, label, note, { disabled = false, sub = false } = {}) {
  const on = !!state.settings[key];
  return h('button', {
    class: 'set-sw' + (sub ? ' is-sub' : ''), role: 'switch', 'aria-checked': String(on), 'data-f': `set:k:${key}`, 'data-nav': '', disabled,
    onclick: () => saveSettings({ [key]: !on }),
  }, h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, label), note ? h('span', { class: 'set-d' }, note) : null),
  h('span', { class: 'tp-switch' + (on ? ' is-on' : ''), 'aria-hidden': 'true' }));
}

function setChoice(key, label, options, note) {
  const cur = state.settings[key];
  return h('div', { class: 'set-f' },
    h('div', { class: 'set-t', id: `set-l-${key}` }, label),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': `set-l-${key}` },
      options.map(([v, text, disabled]) => h('button', {
        class: 'seg-btn', role: 'radio', 'aria-checked': String(cur === v), 'data-f': `set:${key}:${v}`, 'data-nav': '', disabled: !!disabled,
        onclick: () => saveSettings({ [key]: v }),
      }, text))),
    note ? h('div', { class: 'set-d' }, note) : null);
}

const subhead = (text) => h('h3', { class: 'set-sub' }, text);

// Scores on title pages (0.12.4): one toggle per site, its icon and name, Ink-filled when shown.
const MB_LICENSE = 'https://mangabaka.org/about/data-license';
function scoresField() {
  const sc = state.settings.scores;
  const tog = (k) => {
    const on = !!sc[k];
    return h('button', {
      class: 'sc-tog', 'aria-pressed': String(on), 'data-f': `set:score:${k}`, 'data-nav': '',
      title: SCORE_INFO[k].note || null, onclick: () => saveSettings({ scores: { ...sc, [k]: !on } }),
    }, siteLogo(k), SCORE_INFO[k].name, on ? icon('check') : null);
  };
  const own = SCORE_SITES.filter((k) => !SCORE_INFO[k].viaMb);
  const viaMb = SCORE_SITES.filter((k) => SCORE_INFO[k].viaMb);
  return h('div', { class: 'set-f' },
    h('div', { class: 'set-t', id: 'set-l-scores' }, 'Scores on title pages'),
    h('div', { class: 'sc-row', role: 'group', 'aria-labelledby': 'set-l-scores' }, own.map(tog)),
    h('div', { class: 'sc-sub', id: 'set-l-scores-mb' }, 'Manga only, as MangaBaka last read them'),
    h('div', { class: 'sc-row', role: 'group', 'aria-labelledby': 'set-l-scores-mb' }, viaMb.map(tog)),
    h('div', { class: 'set-d' }, !SCORE_SITES.some((k) => sc[k]) ? 'None: title pages show AniList\'s ranking only.' : [
      'On title pages here, each with its site\'s icon. AniList\'s own title page adds MyAnimeList\'s and MangaBaka\'s to its sidebar. MangaBaka is manga only; its data is shared under ',
      h('a', { class: 'set-link', href: MB_LICENSE, onclick: opener(MB_LICENSE) }, 'CC BY-NC-SA 4.0'), '.']));
}

/* Look: the theme, as four tiny windows in their own colors, and the accent */

// One tiny window per theme, in that theme's own colors whatever this popup's theme is; the rail's triangle is
// your accent as that theme shows it. A palette's name is two lines when it's one of a family (Mocha, Catppuccin).
function themeTile(v) {
  const on = state.settings.theme === v;
  const pal = paletteOf(v);
  const look = v === 'site' ? siteLook() : v;
  const acc = pal ? paletteAccent(pal, accentKey(), baseAccentRGB()) : baseAccentRGB();
  return h('button', {
    class: 'th' + (on ? ' is-on' : ''), role: 'radio', 'aria-checked': String(on), 'data-f': `set:theme:${v}`, 'data-nav': '',
    'aria-label': themeName(v), onclick: () => saveSettings({ theme: v }),
  },
  h('span', { class: 'th-win', 'data-look': look, style: `--w-acc:${acc}`, 'aria-hidden': 'true' },
    h('i', { class: 'th-rail' }, h('s'), h('b'), h('b'), h('b'), h('u')),
    h('i', { class: 'th-page' }, h('b', { class: 'th-line' }), h('i', { class: 'th-posters' }, Array.from({ length: 6 }, () => h('b')))),
    on ? h('span', { class: 'th-tick' }, icon('check')) : null),
  pal && pal.fam
    ? h('span', { class: 'th-name', 'aria-hidden': 'true' }, pal.v, h('span', { class: 'th-fam' }, pal.fam))
    : h('span', { class: 'th-name', 'aria-hidden': 'true' }, themeName(v)));
}

function themeNote() {
  const words = { default: 'light', dark: 'dark', contrast: 'high contrast' };
  const site = words[state.siteTheme];
  const now = site ? `${site} now` : `which follows your computer, ${systemDark() ? 'dark' : 'light'} now`;
  return `AniList's three. Tsugi's panels on AniList's pages always take AniList's own theme (${now}).`;
}

// The palettes (0.12): for this popup, and unless you say otherwise, Tsugi's own panels on AniList.
const PANELS_SAID = 'the panel, the title popover, Ctrl+K, mass edit and toasts';
function paletteNote() {
  return `Editor palettes, for this popup and Tsugi's own panels on AniList (${PANELS_SAID}). AniList's pages keep their own theme.`;
}

function accentPicker() {
  const a = state.settings.accent;
  const prof = profileColor();
  const tick = icon('check');
  const pal = paletteOf(themeNow());   // on a palette, its own shades (0.12)
  return h('div', { class: 'sw-row', role: 'radiogroup', 'aria-labelledby': 'set-l-accent' },
    h('button', {
      class: 'sw-auto', role: 'radio', 'aria-checked': String(a === 'auto'), 'data-f': 'set:accent:auto', 'data-nav': '',
      style: `--sw:${paletteAccent(pal, PROFILE_COLORS[prof || 'blue'] ? prof || 'blue' : null, colorRGB(prof) || PROFILE_COLORS.blue)}`, onclick: () => saveSettings({ accent: 'auto' }),
    }, h('i', { 'aria-hidden': 'true' }), 'From AniList', a === 'auto' ? tick : null),
    ACCENTS.map((c) => {
      const rgb = paletteAccent(pal, c, PROFILE_COLORS[c]);
      const on = a === c;
      return h('button', {
        class: 'sw', role: 'radio', 'aria-checked': String(on), 'aria-label': capital(c), title: capital(c), 'data-f': `set:accent:${c}`, 'data-nav': '',
        style: `--sw:${rgb};--on-sw:${onColor(rgb)}`, onclick: () => saveSettings({ accent: c }),
      }, on ? icon('check') : null);
    }));
}

function accentNote() {
  const prof = profileColor();
  const name = !prof ? null : PROFILE_COLORS[prof] ? prof : 'your own color';
  const pal = paletteOf(themeNow());
  const what = 'Switches, keyboard focus and Tsugi\'s mark, here and on AniList.'
    + (pal && pal.acc ? ` ${pal.fam || pal.name} has its own shade of each.` : '');
  if (state.settings.accent !== 'auto') return what;
  return name ? `Your AniList profile color is ${name}. ${what}` : `Your AniList profile color, once Tsugi has seen it. ${what}`;
}

function lookBody() {
  return [
    h('div', { class: 'set-f' },
      h('div', { class: 'set-t', id: 'set-l-theme' }, 'Theme'),
      h('div', { class: 'th-row', role: 'radiogroup', 'aria-labelledby': 'set-l-theme' }, Object.keys(THEME_NAMES).map(themeTile)),
      h('div', { class: 'set-d' }, themeNote())),
    h('div', { class: 'set-f' },
      h('div', { class: 'set-t', id: 'set-l-palette' }, 'Palettes'),
      h('div', { class: 'th-row is-pal', role: 'radiogroup', 'aria-labelledby': 'set-l-palette' }, PALETTE_ORDER.map(themeTile)),
      h('div', { class: 'set-d' }, paletteNote())),
    paletteOf(state.settings.theme)
      ? setSwitch('paletteHub', 'On AniList too', state.settings.paletteHub
        ? `${themeName(state.settings.theme)} for ${PANELS_SAID}.`
        : `Off: they take AniList's own theme there.`)
      : null,
    h('div', { class: 'set-f' },
      h('div', { class: 'set-t', id: 'set-l-accent' }, 'Accent'),
      accentPicker(),
      h('div', { class: 'set-d' }, accentNote())),
  ];
}

const dot = (rgb) => h('i', { class: 'set-dot', style: `--sw:${rgb}`, 'aria-hidden': 'true' });
// The color you see, by its name ("Gray"), whether it's your profile's or one you picked.
function accentName() {
  const a = state.settings.accent;
  const c = a !== 'auto' ? a : profileColor();
  return c && PROFILE_COLORS[c] ? capital(c) : a === 'auto' ? 'From AniList' : capital(a);
}
function lookSummary() {
  return [
    h('span', {}, themeName(state.settings.theme)),
    h('span', { class: 'set-piece' }, dot(accentRGB()), accentName()),
  ];
}

/* Popup: where it opens, its sections, the title pages' sections, the count on the toolbar button */

// A row of toggles (0.12.5), like the scores' (Ink-filled when on): one map of switches in the settings.
function togRow(key, label, names, note, iconOf) {
  const map = state.settings[key];
  return h('div', { class: 'set-f' },
    h('div', { class: 'set-t', id: `set-l-${key}` }, label),
    h('div', { class: 'sc-row', role: 'group', 'aria-labelledby': `set-l-${key}` }, Object.keys(names).map((k) => {
      const on = map[k] !== false;
      return h('button', {
        class: 'sc-tog' + (iconOf ? '' : ' is-plain'), 'aria-pressed': String(on), 'data-f': `set:${key}:${k}`, 'data-nav': '',
        onclick: () => saveSettings({ [key]: { ...map, [k]: !on } }),
      }, iconOf ? iconOf(k) : null, names[k], on ? icon('check') : null);
    })),
    note ? h('div', { class: 'set-d' }, note) : null);
}

const RAIL_NAMES = { upnext: 'Up Next', today: 'Today', search: 'Search', notifs: 'Notifications' };
const TP_SECS = {
  desc: 'Description', order: 'Relations', friends: 'People you follow', chars: 'Characters', staff: 'Staff',
  songs: 'Openings and endings', recs: 'More like this', reviews: 'Reviews', watch: 'Where to watch', details: 'Details',
};
const offCount = (map) => Object.values(map).filter((v) => v === false).length;

function popupBody() {
  const s = state.settings;
  const railOff = offCount(s.rail);
  const secsOff = offCount(s.tpSecs);
  return [
    setChoice('openIn', 'Opens in', Object.entries(OPEN_INS).filter(([v]) => v !== 'panel' || PANEL_OK), OPEN_IN_NOTES[s.openIn]),
    s.openIn === 'popup' ? setChoice('popupSize', 'Size', Object.entries(SIZE_NAMES).map(([v, text]) => [v, `${text}`]),
      `${POPUP_SIZES[s.popupSize]} × 600. A wider popup fits more posters a row. Browsers keep popups at 600 tall at most.`) : null,
    setChoice('popupStart', 'Opens on', Object.entries(START_NAMES).map(([v, text]) => [v, text, v !== 'last' && !railOn(v)]), s.popupStart === 'last'
      ? 'The last of Now, Up Next and Today you had open. Search and Notifications never open first.' : null),
    togRow('rail', 'Sections', RAIL_NAMES, railOff
      ? `Now and Settings always stay.${!railOn('search') ? ' Without Search, / does nothing.' : ''}`
      : 'In the rail on the left. Now and Settings always stay.', (k) => h('span', { class: 'sc-vic', 'aria-hidden': 'true' }, VIEWS[k].icon())),
    togRow('tpSecs', 'On title pages', TP_SECS, secsOff === Object.keys(TP_SECS).length
      ? 'Only the header and your entry. Your history follows the Rewatch log, in Titles.'
      : 'Under your entry, in this order. Your history follows the Rewatch log, in Titles.'),
    setSwitch('badge', 'Unread count on the toolbar button', 'How many AniList notifications you haven\'t read, on Tsugi\'s button in the browser\'s toolbar.'),
    s.badge ? setChoice('checkEvery', 'Check every', CHECK_TIMES.map((n) => [n, minutesWord(n)]),
      'Each check is one small request to AniList. Opening this popup checks at once.') : null,
  ];
}
// What each place means, under Opens in.
const OPEN_IN_NOTES = {
  popup: 'The toolbar button opens this popup. Right-click the button to open Tsugi in a window, a tab or the side panel once.',
  window: 'The toolbar button opens Tsugi in a window of its own, which keeps its size and place. Clicked again, it brings it forward.',
  tab: 'The toolbar button opens Tsugi in a browser tab, or goes back to the one already open.',
  panel: 'The toolbar button opens Tsugi beside the page you\'re on. In Brave, it shows in the sidebar.',
};
function popupSummary() {
  const s = state.settings;
  const railOff = offCount(s.rail);
  const secsOff = offCount(s.tpSecs);
  return [
    h('span', {}, s.openIn === 'popup' ? (s.popupSize === 'm' ? 'Popup' : `${SIZE_NAMES[s.popupSize]} popup`) : { window: 'In a window', tab: 'In a tab', panel: 'In the side panel' }[s.openIn]),
    h('span', {}, s.popupStart === 'last' ? 'Opens where you left it' : `Opens on ${START_NAMES[s.popupStart]}`),
    railOff ? h('span', {}, railOff === 1 ? `${RAIL_NAMES[Object.keys(s.rail).find((k) => !s.rail[k])]} hidden` : `${railOff} sections hidden`) : null,
    secsOff ? h('span', {}, `${Object.keys(TP_SECS).length - secsOff} of ${Object.keys(TP_SECS).length} title sections`) : null,
    h('span', {}, s.badge ? `Count every ${minutesWord(s.checkEvery)}` : 'No count on the button'),
  ];
}

/* Titles (0.12.5): what Tsugi adds to a title, here and on AniList's pages alike */

const TITLE_FEATURES = ['watchOrder', 'newEps', 'autoDates', 'history', 'malData'];
function titlesBody() {
  return [
    setSwitch('watchOrder', 'Watch-order warnings', 'Flag planned titles whose earlier season you haven\'t finished: "Comes after ..." on title pages here, and on AniList\'s lists.'),
    setSwitch('newEps', 'New episode counts', '"3 new": aired episodes you haven\'t watched yet, on posters here and on AniList.'),
    setSwitch('autoDates', 'Fill in start and finish dates', 'Starting or finishing a title fills its empty dates with today, here and on AniList. Rewatches leave them alone.'),
    setSwitch('history', 'Rewatch log', 'How many times you\'ve watched a title, with dates, from your AniList activity. On title pages here and on AniList.'),
    scoresField(),
    setSwitch('malData', 'MyAnimeList\'s characters and songs', 'On title pages here and on AniList. Asked by the title\'s number from Tenrai and AnimeThemes, two free services, and left out when they don\'t answer.'),
  ];
}
function titlesSummary() {
  const s = state.settings;
  const on = TITLE_FEATURES.filter((k) => s[k]).length;
  const scores = SCORE_SITES.filter((k) => s.scores[k]).length;
  return [
    h('span', {}, on === TITLE_FEATURES.length ? 'Everything on' : `${on} of ${TITLE_FEATURES.length} on`),
    h('span', {}, !scores ? 'No scores' : scores === 1 ? '1 score' : `${scores} scores`),
  ];
}

/* On AniList: every switch of the hub that's about AniList's own pages, in the hub's words */

// Posters isn't counted: it's a way to show your lists, off at first, not a feature to keep on.
// Nor is Hide the global feed (0.12.7): a preference, off at first.
const FEATURES = ['badges', 'listViews', 'listSorts', 'listFilters', 'dragOrder', 'sideLinks', 'socialCounts', 'check404', 'palette', 'feedFilters', 'pick', 'listCheck', 'keys', 'malLinks'];

// AniList on MyAnimeList (0.12.7): its script runs only where the browser lets Tsugi read myanimelist.net
// (background.js syncMalScript). The permission is asked by the Allow button itself (it must be in the click).
const MAL_ORIGINS = ['https://myanimelist.net/*'];
async function checkMalPerm() {
  let ok = false;
  try { ok = await chrome.permissions.contains({ origins: MAL_ORIGINS }); } catch { /* ignore */ }
  if (state.malPerm !== ok) { state.malPerm = ok; render(); }
}
function allowMal() {
  let asked;
  try { asked = chrome.permissions.request({ origins: MAL_ORIGINS }); } catch (err) { asked = Promise.reject(err); }
  asked.then((ok) => { state.malPerm = ok; render(); }, () => {});
}
try {
  chrome.permissions.onAdded.addListener(() => checkMalPerm());
  chrome.permissions.onRemoved.addListener(() => checkMalPerm());
} catch { /* ignore */ }
function malLinksRow() {
  const s = state.settings;
  if (state.malPerm === undefined) { state.malPerm = null; checkMalPerm(); }
  const need = s.malLinks && state.malPerm === false;
  return [
    setSwitch('malLinks', 'AniList on MyAnimeList', 'On MyAnimeList\'s title pages: the same title on AniList, in its Resources links, and your status there.'),
    need ? h('div', { class: 'set-perm' },
      h('span', { class: 'set-d' }, 'Your browser hasn\'t let Tsugi read myanimelist.net yet.'),
      h('button', { class: 'tp-btn', 'data-f': 'set:mal:allow', 'data-nav': '', onclick: allowMal }, 'Allow')) : null,
  ];
}
// Sorts and Filters only count while List views is on (they're part of it).
const featureOn = (s, k) => (['listSorts', 'listFilters'].includes(k) ? s.listViews && s[k] : s[k]);
function anilistBody() {
  const s = state.settings;
  const mod = /Mac|iPhone|iPad/.test(navigator.platform || '') ? 'Cmd' : 'Ctrl';
  const sub = (key, label, note) => setSwitch(key, label, note, { sub: true });
  return [
    subhead('Tsugi\'s button'),
    h('div', { class: 'set-pair' },
      setChoice('dock', 'Where', [['bar', 'Top bar'], ['always', 'Floating'], ['near', 'Near the corner'], ['hide', 'Hidden', !s.keys]]),
      s.dock === 'always' || s.dock === 'near' ? setChoice('dockSide', 'Corner', [['right', 'Right'], ['left', 'Left']]) : null),
    h('div', { class: 'set-d set-pair-note' }, !s.keys ? 'Turn on keyboard shortcuts to hide it completely.'
      : s.dock === 'bar' ? 'In AniList\'s top bar, next to its search. It opens the hub; P does too, on any list page.'
      : 'It opens the hub. P opens it too, on any list page.'),
    subhead('Lists'),
    setSwitch('badges', 'Badges on list pages', 'Your priorities next to titles on AniList\'s lists.'),
    setSwitch('listViews', 'List views', 'Tsugi\'s additions to AniList\'s lists: sorts, filters and Posters.'),
    s.listViews ? [
      sub('listSorts', 'Sorts and groups', 'On each list\'s title: title, episodes, length and more, grouped by format, source, decade or length. Off: AniList\'s own order, or priority order from the hub\'s button.'),
      sub('listFilters', 'Filters', 'In AniList\'s sidebar: source, streaming service, episodes, length and NSFW titles, with saved filters.'),
      sub('posters', 'Posters', 'Your lists as a wall of covers, like the shelves here, with the details on hover. Also the fourth of AniList\'s layout buttons.'),
    ] : null,
    setSwitch('dragOrder', 'Drag to order', 'Drag titles of the same priority into your own order, in the hub and on posters (Alt and the arrows too). Off: the order you set stays.'),
    setSwitch('hideAdult', 'Hide NSFW titles', 'On your lists (unless the NSFW filter says otherwise), in the hub, Pick for me and Search here. What counts: NSFW titles, below.'),
    subhead('Title pages'),
    setSwitch('sideLinks', 'MyAnimeList and Reddit links', 'In External & Streaming links: the title on MyAnimeList, and a search for its discussion threads on Reddit.'),
    subhead('Profiles'),
    setSwitch('socialCounts', 'Follower counts', 'On a profile\'s Social tab: Following (7), Followers and Mutual Followers with their counts.'),
    setSwitch('check404', 'Why a profile is missing', 'When a profile doesn\'t open: whether it\'s private, the person blocked you, or no one has that name.'),
    subhead('Tools'),
    setSwitch('palette', 'Command palette', `${mod}+K on any AniList page: jump to a title, list, page or setting, or run an action.`),
    setSwitch('feedFilters', 'Activity feed filters', 'A Filters button above your feed on Home hides activity by type, person or word.'),
    setSwitch('hideGlobal', 'Hide the global feed', 'On Home, only the people you follow: AniList\'s Global switch goes.'),
    setSwitch('pick', 'Pick for me', 'In the hub (and R): a title to start next, picked at random from your list.'),
    setSwitch('listCheck', 'List check', 'In the hub\'s rail: missing dates, planned sequels ahead of their prequels, titles left in Watching.'),
    setSwitch('keys', 'Keyboard shortcuts', s.dock === 'hide' ? 'Needed while Tsugi\'s button is hidden.' : 'P, S, E, R, V and the number keys on AniList\'s pages.', { disabled: s.dock === 'hide' }),
    subhead('On MyAnimeList'),
    malLinksRow(),
  ];
}
function anilistSummary() {
  const s = state.settings;
  const on = FEATURES.filter((k) => featureOn(s, k)).length;
  return [
    h('span', {}, on === FEATURES.length ? 'Everything on' : `${on} of ${FEATURES.length} on`),
    s.hideAdult ? h('span', {}, 'NSFW titles hidden') : null,
    s.hideGlobal ? h('span', {}, 'Global feed hidden') : null,
    s.posters && s.listViews ? h('span', {}, 'Lists as posters') : null,
    s.dock === 'hide' ? h('span', {}, 'Button hidden') : null,
  ];
}

/* Account: who's connected and until when; Disconnect; taking back Tsugi's access on AniList */

const APPS_URL = 'https://anilist.co/settings/apps';
const longDate = (t) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const daysLeft = (a) => (a && a.expiresAt ? Math.max(0, Math.ceil((a.expiresAt - Date.now()) / 86400000)) : null);
// "in 5 days", "tomorrow", "today": when a login ends.
const endsIn = (n) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
function accountBody() {
  const a = state.auth;
  const v = a.viewer;
  const left = daysLeft(a);
  const ending = left != null && left <= 30;
  return [
    h('div', { class: 'acct' },
      h('span', { class: 'acct-av' }, v.avatar ? h('img', { src: v.avatar, alt: '' }) : icon('user')),
      h('span', { class: 'set-txt' },
        h('span', { class: 'acct-name' }, v.name),
        h('span', { class: 'set-d' + (ending ? ' is-warn' : '') }, !a.expiresAt ? 'Connected'
          : ending ? `Your login ends ${endsIn(left)}, on ${longDate(a.expiresAt)}` : `Connected until ${longDate(a.expiresAt)}`)),
      h('button', { class: 'tp-btn', 'data-f': 'set:disconnect', 'data-nav': '', onclick: () => send({ type: 'auth:logout' }) }, icon('logout'), 'Disconnect')),
    ending ? h('div', { class: 'set-f set-row' },
      h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, 'Connect again'),
        h('span', { class: 'set-d' }, 'AniList asks you to approve once more, and the new login lasts a year.')),
      h('button', { class: 'tp-btn', 'data-f': 'set:renew', 'data-nav': '', onclick: () => send({ type: 'auth:connect' }) }, icon('external'), 'Approve on AniList')) : null,
    h('div', { class: 'set-f set-row' },
      h('span', { class: 'set-txt' }, h('span', { class: 'set-t' }, 'Take back Tsugi\'s access'),
        h('span', { class: 'set-d' }, 'Disconnect only forgets the login on this computer. AniList\'s Apps page lists every app you approved, with Revoke.')),
      h('button', { class: 'tp-btn', 'data-f': 'set:apps', 'data-nav': '', onclick: () => open(APPS_URL) }, icon('external'), 'Apps on AniList')),
  ];
}
function accountSummary() {
  const a = state.auth;
  const left = daysLeft(a);
  return [
    h('span', { class: 'set-piece' }, a.viewer.avatar ? h('img', { class: 'set-av', src: a.viewer.avatar, alt: '' }) : null, a.viewer.name),
    a.expiresAt ? h('span', { class: left <= 30 ? 'is-warn' : null }, left <= 30 ? `Ends ${endsIn(left)}` : `Until ${MONTHS[new Date(a.expiresAt).getMonth()]} ${new Date(a.expiresAt).getFullYear()}`) : null,
  ];
}

/* About: the version, AniList's requests left this minute, and the keyboard */

function keysList(rows) {
  return h('dl', { class: 'keys' }, rows.filter(Boolean).map(([k, text]) => h('div', { class: 'keys-row' },
    h('dt', {}, k.split(' ').map((x) => h('kbd', { class: 'kbd' }, x))), h('dd', {}, text))));
}

function aboutBody() {
  const s = state.settings;
  const rt = rateNow();
  rateTick(rt);
  const mod = /Mac|iPhone|iPad/.test(navigator.platform || '') ? 'Cmd' : 'Ctrl';
  // AniList's own count when it's from this minute; the full allowance when Tsugi asked nothing since;
  // Tsugi's own count (it keeps to 25 a minute) before AniList has ever said.
  const sent = rt.mine === 0 ? 'nothing' : rt.mine === 1 ? 'one request' : `${rt.mine} requests`;
  const left = rt.left != null ? rt.left : Math.max(0, 25 - rt.mine);
  const of = rt.left != null ? rt.limit || rt.left : 25;
  const count = [h('b', {}, String(left)), ` of ${of} left this minute`];
  const note = rt.paused
    ? `AniList asked Tsugi to wait: requests start again in ${Math.max(1, Math.ceil((rt.paused - Date.now()) / 1000))} s.`
    : rt.fresh ? `As AniList counted at Tsugi's last request. Tsugi sent ${sent} in the last minute, keeps to 25 and waits when AniList runs low.`
      : rt.left != null ? `Tsugi sent nothing in the last minute. It keeps to 25 a minute and waits when AniList runs low.`
        : `Tsugi's own count: it keeps to 25 a minute, under AniList's limit, and waits when AniList runs low.`;
  return [
    h('div', { class: 'set-f set-row' }, h('span', { class: 'set-t' }, 'Version'), h('span', { class: 'set-v' }, `Tsugi ${VERSION}`)),
    h('div', { class: 'set-f' },
      h('div', { class: 'set-row' }, h('span', { class: 'set-t' }, 'AniList requests'), h('span', { class: 'set-v' + (rt.paused ? ' is-warn' : ''), 'data-rate': '' }, count)),
      h('div', { class: 'set-d' }, note)),
    subhead('Keyboard shortcuts'),
    h('div', { class: 'keys-cols' },
      h('div', {}, h('h4', { class: 'keys-h' }, 'In this popup'), keysList([
        railOn('search') ? ['/', 'Search'] : null,
        ['Arrows', 'Move between titles'],
        ['Enter', 'Open a title'],
        ['+', 'Mark the next episode'],
        [`${mod} Z`, 'Undo the last change'],
        ['Esc', 'Back'],
      ])),
      h('div', {}, h('h4', { class: 'keys-h' }, 'On AniList'), keysList([
        s.palette ? [`${mod} K`, 'Command palette'] : null,
        ...(s.keys ? [
          ['P', 'Open or close the hub'],
          ['S', 'Select several titles'],
          ['E', 'Edit the selected titles'],
          s.pick ? ['R', 'Pick something for me'] : null,
          s.listViews && s.listFilters ? ['V', 'Filter a list'] : null,
          ['0–9', 'Priority of the title you point at'],
        ] : []),
        s.dragOrder ? ['Alt Arrows', 'Move a title among the others of its priority'] : null,
        ['Esc', 'Close'],
      ]), s.keys ? null : h('div', { class: 'set-d' }, 'Keyboard shortcuts are off in On AniList.'))),
  ];
}
function aboutSummary() {
  return [h('span', {}, `Version ${VERSION}`)];
}

const SET_GROUPS = [
  { key: 'look', label: 'Look', body: lookBody, summary: lookSummary },
  { key: 'popup', label: 'Popup', body: popupBody, summary: popupSummary },
  { key: 'titles', label: 'Titles', body: titlesBody, summary: titlesSummary },
  { key: 'anilist', label: 'On AniList', body: anilistBody, summary: anilistSummary },
  { key: 'account', label: 'Account', body: accountBody, summary: accountSummary },
  { key: 'about', label: 'About', body: aboutBody, summary: aboutSummary },
];

function setGroup(g) {
  const open = state.setOpen === g.key;
  return h('section', { class: 'set-g' + (open ? ' is-open' : ''), 'data-g': g.key },
    h('button', {
      class: 'set-head', 'aria-expanded': String(open), 'aria-controls': open ? `set-${g.key}` : null, 'data-f': `set:${g.key}`, 'data-nav': '',
      onclick: () => toggleGroup(g.key),
    }, h('span', { class: 'set-name' }, g.label), h('span', { class: 'set-sum' }, g.summary()), icon('down')),
    open ? h('div', { class: 'set-body', id: `set-${g.key}`, role: 'group', 'aria-label': g.label }, g.body()) : null);
}

function settingsView() {
  // Settings, Trackers: Compare (0.9) and the Sync log (0.10), popup-trackers.js: a page of their own over the groups.
  // NSFW titles (0.12.3, popup-nsfw.js): its review page, the same way.
  const over = (typeof nsfwPageView === 'function' ? nsfwPageView() : null) || (typeof trkPageView === 'function' ? trkPageView() : null);
  if (over) return [over];
  return [section('Settings', [fact('Shared with the hub on AniList')], h('div', { class: 'set' }, SET_GROUPS.map(setGroup)))];
}

/* The window: rail and sections --------------------------------------------- */

const VIEWS = {
  now: { label: 'Now', icon: () => icon('now'), render: nowView, load: (o) => loadNow(o) },
  upnext: { label: 'Up Next', icon: () => glyph(), render: upNextView, load: (o) => loadUpNext(o) },
  today: { label: 'Today', icon: () => icon('calendar'), render: todayView, load: (o) => loadToday(o) },
  search: { label: 'Search', icon: () => icon('search'), render: searchView, load: (o) => searchLoad(o), keys: '/' },
  notifs: { label: 'Notifications', icon: () => icon('bell'), render: notifsView, load: () => loadNotifs() },
  // At the bottom of the rail, like the hub's (foot); never where the popup opens.
  settings: { label: 'Settings', icon: () => icon('sliders'), render: settingsView, load: () => loadRate(), foot: true },
};
// Now: both quick lists (Watching and Reading), and the other lists of this kind when one of them is shown.
// Until you've picked a kind, Now opens on the one you're actually watching or reading.
async function loadNow(o) {
  if (listKeyOf(state.kind) !== 'CURRENT') loadFull(state.kind, o);
  await Promise.all([loadList('ANIME', o), loadList('MANGA', o)]);
  const A = state.lists.ANIME;
  const M = state.lists.MANGA;
  if (!state.kindChosen && state.kind === 'ANIME' && A && !A.entries.length && M && M.entries.length) { state.kind = 'MANGA'; render(); }
}
// The sections the popup can open on (Settings, Opens on), and the one it remembers.
const START_VIEWS = ['now', 'upnext', 'today'];
const scrollPos = {};   // view (or 't:' + a title's id) -> where you had scrolled to
// The sections you can take out of the rail (Settings, Popup, 0.12.5); Now and Settings always stay.
const RAIL_OPTIONAL = ['upnext', 'today', 'search', 'notifs'];
const railOn = (key) => !RAIL_OPTIONAL.includes(key) || !state.settings || !state.settings.rail || state.settings.rail[key] !== false;

function go(key) {
  if (!VIEWS[key]) return;
  // From a title page, the section's button goes back to the section, as you left it.
  const same = state.view === key && !state.stack.length;
  // Settings always comes back folded (0.12.4: a group left open was still open on the way back).
  if (state.view !== key && (key === 'settings' || state.view === 'settings')) state.setOpen = null;
  state.stack = [];
  state.view = key;
  if (key === 'settings' && state.trk) { state.trk.page = null; state.trk.logOpen = false; }
  if (key === 'settings' && state.nsfw) state.nsfw.page = null;
  closeTransient();
  // Search, Notifications and Settings aren't where the popup opens next time.
  if (START_VIEWS.includes(key)) { try { chrome.storage.local.set({ 'popup:view': key }); } catch { /* ignore */ } }
  // Search puts the keyboard in its box (and the button of the section you're on, back on top).
  if (key === 'search') state.focusSearch = true;
  render();
  // The current section's button scrolls back to the top.
  const sc = same && app.querySelector('.scroll');
  if (sc) { scrollPos[key] = 0; sc.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' }); }
  VIEWS[key].load();
}

// Your pages on AniList, by your name: AniList's own address for an account uses its number
// (/user/6053522), and Tsugi on AniList's list pages needs the name in the address to know the list
// is yours (0.6.8.4).
const userUrl = (name) => `https://anilist.co/user/${encodeURIComponent(name)}`;
const myUrl = () => userUrl(state.auth.viewer.name);

function accountMenu(a) {
  const item = (label, ic, run, cls = '') => h('button', { class: `menu-item${cls ? ` ${cls}` : ''}`, role: 'menuitem', onclick: run }, icon(ic), label);
  return h('div', { class: 'menu' + (state.menu === 'opening' ? ' is-opening' : ''), role: 'menu', 'aria-label': 'Your account', onclick: (ev) => ev.stopPropagation() },
    h('div', { class: 'menu-who' }, a.name),
    item('Your AniList profile', 'user', () => open(myUrl())),
    item('Your anime list', 'list', () => open(`${myUrl()}/animelist`)),
    item('Your manga list', 'list', () => open(`${myUrl()}/mangalist`)),
    item('Tsugi settings', 'sliders', () => { state.menu = false; go('settings'); }),
    h('div', { class: 'menu-sep' }),
    item('Disconnect', 'logout', async () => { state.menu = false; await send({ type: 'auth:logout' }); }, 'is-danger'));
}

function rail() {
  const a = state.auth.viewer;
  const btn = (key) => {
    const v = VIEWS[key];
    const on = state.view === key;
    // Notifications: what's unread. Settings (0.10): titles removed on one side, waiting for you (Sync log).
    const n = key === 'notifs' ? state.unread : key === 'settings' && typeof trkWaiting === 'function' ? trkWaiting() : 0;
    return h('button', {
      class: 'rail-btn' + (on ? ' is-active' : ''), 'data-rail': '', 'data-f': `r:${key}`, 'data-tip': v.label,
      'aria-label': n ? `${v.label}, ${n} ${key === 'notifs' ? 'unread' : 'waiting for you'}` : v.label, 'aria-current': on ? 'page' : null, 'aria-keyshortcuts': v.keys || null,
      onclick: () => go(key),
    }, v.icon(), n ? h('span', { class: 'rail-n', 'aria-hidden': 'true' }, n > 99 ? '99+' : String(n)) : null);
  };
  // You at the top, then the sections; Tsugi's mark sits quietly at the bottom (0.6.8.2).
  return h('nav', { class: 'rail', 'aria-label': 'Sections' },
    h('button', {
      class: 'rail-avatar', 'data-rail': '', 'data-f': 'r:me', 'data-tip': a.name, 'aria-label': `Your account (${a.name})`, 'aria-haspopup': 'menu', 'aria-expanded': String(!!state.menu),
      onclick: (ev) => {
        ev.stopPropagation();
        state.menu = state.menu ? false : 'opening';
        render();
        if (state.menu && ev.detail === 0) { const first = app.querySelector('.menu-item'); if (first) first.focus(); }
      },
    }, a.avatar ? h('img', { src: a.avatar, alt: '' }) : icon('user')),
    state.menu ? accountMenu(a) : null,
    h('div', { class: 'rail-items' }, Object.keys(VIEWS).filter((k) => !VIEWS[k].foot && railOn(k)).map(btn)),
    IS_POPUP ? h('button', {
      class: 'rail-btn', 'data-rail': '', 'data-f': 'r:popout', 'data-tip': 'Open in a window', 'aria-label': 'Open Tsugi in a window',
      onclick: popOut,
    }, icon('popout')) : null,
    Object.keys(VIEWS).filter((k) => VIEWS[k].foot).map(btn),
    h('div', { class: 'mark', title: APP_NAME }, mark()));
}

// The toolbar popup's way out (0.12.6): the same section, or the same title page, in a window of its own. The
// window opens on the section you were on (popup:view is kept for it), then the popup closes.
async function popOut() {
  const p = topPage();
  try { await chrome.storage.session.set({ 'popup:carry': { view: state.view, mediaId: p ? p.mediaId : null, at: Date.now() } }); } catch { /* ignore */ }
  await send({ type: 'open:in', where: 'window' });
  window.close();
}

function toastView() {
  const t = state.toast;
  if (!t) return null;
  return h('div', { class: 'toast' + (t.fresh ? ' is-new' : ''), role: 'status', 'aria-live': 'polite', style: titleStyle(t.media) },
    h('span', { class: 'toast-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'toast-msg' }, t.msg),
    t.undo ? h('button', { class: 'toast-btn', 'data-f': 'toast:undo', 'aria-keyshortcuts': 'Control+Z', onclick: runUndo }, 'Undo') : null,
    (t.actions || []).map((a, i) => h('button', { class: 'toast-btn', 'data-f': `toast:a${i}`, onclick: () => { clearToast(); render(); a.run(); } }, a.label)));
}

function runUndo() {
  const t = state.toast;
  if (!t || !t.undo) return;
  const fn = t.undo;
  clearToast();
  render();
  fn();
}

function retry() {
  state.error = null;
  const p = topPage();
  if (p) loadTitle(p.mediaId, { force: true });
  else VIEWS[state.view].load({ force: true });
}

// A title page's scroll. With a banner, the scroll's own background paints it once more beside the
// page, in the scrollbar's strip (moved by --sy), so the picture reaches the window's edge.
function titleScroll(p, T) {
  const banner = bannerOf(T);
  const style = [titleStyle(T.media || T.base), banner ? `--banner-img:url("${banner}")` : null].filter(Boolean).join(';');
  return h('div', { class: 'scroll is-title' + (banner ? ' has-banner' : ''), 'data-view': `t:${p.mediaId}`, style: style || null }, titleView(p));
}

// Where a view's scroll is remembered: Settings' pages (Compare, the Sync log, NSFW titles) each have their own.
function scrollKey() {
  if (state.view !== 'settings') return state.view;
  if (state.nsfw && state.nsfw.page) return 'nsfw:page';
  if (state.trk && state.trk.page) return `sync:${state.trk.page.t}`;
  if (state.trk && state.trk.logOpen) return 'synclog';
  return state.view;
}

function shell() {
  const a = state.auth.viewer;
  const banners = [];
  if (state.justConnected) banners.push(h('div', { class: 'banner is-ok', role: 'status' }, icon('check'), `Connected as ${a.name}.`));
  if (state.slow) {
    banners.push(h('div', { class: 'banner is-wait', role: 'status' }, icon('clock'),
      h('span', {}, 'Waiting for AniList. It limits how many requests apps can make each minute, so this can take up to a minute.')));
  }
  if (state.error) banners.push(h('div', { class: 'banner is-error', role: 'alert' }, icon('alert'), h('span', {}, state.error), h('button', { onclick: retry }, 'Retry')));
  const p = topPage();
  const T = p && state.titles[p.mediaId];
  return [h('div', { class: 'shell' },
    rail(),
    h('main', { class: 'main', 'aria-label': p ? titleName(T) || 'Title' : VIEWS[state.view].label },
      banners.length ? h('div', { class: 'banners' }, banners) : null,
      p ? titleScroll(p, T)
        : h('div', { class: 'scroll', 'data-view': scrollKey() }, VIEWS[state.view].render()),
      toastView()))];
}

/* Setup ------------------------------------------------------------------- */

function copyRow(label, value) {
  const btn = h('button', {
    class: 'copy-btn',
    onclick: async () => {
      try { await navigator.clipboard.writeText(value); btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
      catch { btn.textContent = 'Select it'; }
    },
  }, 'Copy');
  return h('div', { class: 'copy-row' }, h('span', { class: 'copy-label' }, label), h('span', { class: 'copy-value', title: value }, value), btn);
}

// Connecting (0.8.1): one button. Tsugi has its own app on AniList (background.js CLIENT_ID), so AniList just
// asks you to approve it. Making your own app (the only way before) is still there, folded.
async function startConnect(btn, msg) {
  btn.disabled = true;
  const res = await send({ type: 'auth:connect', ...msg });
  btn.disabled = false;
  if (!res.ok) { state.message = { kind: 'error', text: res.error }; render(); }
  else if (IS_TAB) { state.message = { kind: 'ok', text: 'Approve on the AniList tab that just opened. This page updates when you\'re connected.' }; render(); }
}
function setupView() {
  const main = h('button', { class: 'btn is-primary is-connect', 'data-f': 'setup:connect', onclick: () => startConnect(main, { builtIn: true }) }, 'Connect with AniList');
  const input = h('input', { class: 'input', type: 'text', inputmode: 'numeric', placeholder: 'Client ID, like 12345', value: state.clientId, 'aria-label': 'Client ID' });
  const connectBtn = h('button', { class: 'btn', onclick: () => startConnect(connectBtn, { clientId: input.value }) }, 'Connect');
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') connectBtn.click(); });

  const code = h('textarea', { class: 'input', placeholder: 'Paste the long code AniList showed you', 'aria-label': 'Access code', spellcheck: 'false' });
  const saveCode = h('button', {
    class: 'btn',
    onclick: async () => {
      saveCode.disabled = true;
      const res = await send({ type: 'auth:token', token: code.value });
      saveCode.disabled = false;
      if (!res.ok) { state.message = { kind: 'error', text: res.error }; render(); }
    },
  }, 'Save code');

  return [
    h('header', { class: 'hd' },
      h('div', { class: 'mark' }, mark()),
      h('div', { class: 'hd-text' }, h('div', { class: 'hd-title' }, APP_NAME), h('div', { class: 'hd-sub' }, `Version ${VERSION}`))),
    h('div', { class: 'setup' },
      h('p', { class: 'setup-lead' }, h('b', {}, 'Connect your AniList account'), ' to see your lists here and update progress without opening AniList. You only do this once.'),
      main,
      h('p', { class: 'setup-note' }, 'AniList asks you to approve Tsugi. Click Authorize, and the tab closes by itself.'),
      state.message ? h('div', { class: `msg is-${state.message.kind}`, role: 'status' }, state.message.text) : null,
      h('details', { class: 'alt' },
        h('summary', {}, 'AniList showed you a long code instead?'),
        code, saveCode),
      h('details', { class: 'alt' },
        h('summary', {}, 'Use your own AniList app'),
        h('p', { class: 'step-text' }, 'For people who prefer an app of their own. On AniList\'s developer page, click Create New Client and fill in these two fields, then paste the Client ID it shows.'),
        copyRow('Name', CLIENT_NAME),
        copyRow('Redirect URL', PIN_URL),
        h('button', { class: 'btn', style: 'margin:0 0 12px', onclick: () => open(DEV_URL) }, icon('external'), 'Open the developer page'),
        h('div', { class: 'field' }, input, connectBtn))),
  ];
}

/* Drawing ------------------------------------------------------------------ */

// While a mouse button is down, a redraw waits for it to come up: replacing the page between the
// press and the release would lose the click (a note saved as you click the next control).
let rendering = false;   // inputs replaced by a redraw don't save on that blur
let pressing = false;
let renderLater = false;
document.addEventListener('pointerdown', () => { pressing = true; }, true);
const release = () => {
  pressing = false;
  if (renderLater) { renderLater = false; setTimeout(render, 0); }
};
document.addEventListener('pointerup', release, true);
document.addEventListener('pointercancel', release, true);
window.addEventListener('blur', release);

function render() {
  // Nor while letters are being composed in a box (Japanese input, accents on some keyboards).
  if (pressing || composing) { renderLater = true; return; }
  const sc = app.querySelector('.scroll');
  if (sc && sc.dataset.view) scrollPos[sc.dataset.view] = sc.scrollTop;
  const ae = document.activeElement;
  const fk = ae && ae !== document.body && app.contains(ae) && ae.dataset ? ae.dataset.f : null;
  // What you were typing stays, with the caret where it was.
  let typed = null;
  if (fk && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
    typed = { tag: ae.tagName, value: ae.value, a: null, b: null };
    try { typed.a = ae.selectionStart; typed.b = ae.selectionEnd; } catch { /* dates and numbers have none */ }
  }
  imgUsed = new Set();
  const connected = !!state.auth;
  app.className = `app ${connected ? 'is-app' : 'is-setup'}`;
  rendering = true;
  try {
    app.replaceChildren(...(connected ? shell() : setupView()));
  } finally {
    rendering = false;
  }
  const ns = app.querySelector('.scroll');
  if (ns) ns.scrollTop = scrollPos[ns.dataset.view] || 0;
  if (ns && ns.classList.contains('is-title')) layoutTitle(ns);
  // Keep the keyboard where it was: the same control, else the cover of the same title.
  if (fk) {
    const id = fk.split(':')[1];
    const el = app.querySelector(`[data-f="${CSS.escape(fk)}"]`) || (id && app.querySelector(`[data-f="c:${id}"]`));
    if (el) {
      el.focus({ preventScroll: true });
      if (typed && el.tagName === typed.tag && el.value !== typed.value) {
        el.value = typed.value;
        if (el.tagName === 'TEXTAREA') fitNotes(el);
      }
      if (typed && el.tagName === typed.tag && typed.a != null) { try { el.setSelectionRange(typed.a, typed.b); } catch { /* ignore */ } }
    }
  }
  // A title page just opened: the keyboard starts on its title.
  if (state.focusTitle) {
    state.focusTitle = false;
    const t = app.querySelector('.tp-title');
    if (t) t.focus({ preventScroll: true });
  }
  // Search just opened: the keyboard in its box, what was typed selected (typing replaces it).
  if (state.focusSearch) {
    state.focusSearch = false;
    const box = app.querySelector('.sr-input');
    if (box) { box.focus({ preventScroll: true }); box.select(); }
  }
  if (state.menu === 'opening') state.menu = true;
  if (state.statusMenu === 'opening') state.statusMenu = true;
  state.lmenuFresh = false;
  if (state.toast) state.toast.fresh = false;
}

/* Keyboard ------------------------------------------------------------------ */
// Arrows move between posters (and rows), Enter opens, + marks the next episode, Esc goes back.

function navFrom(el) {
  if (!el || !el.closest) return null;
  if (el.matches('[data-nav]')) return el;
  const c = el.closest('[data-navfrom]');
  return c ? app.querySelector(`[data-f="${c.dataset.navfrom}"]`) : null;
}

function navigate(dir) {
  const cur = document.activeElement;
  const rails = [...app.querySelectorAll('[data-rail]')];
  const items = [...app.querySelectorAll('.scroll [data-nav]:not(:disabled)')];
  const activeRail = () => app.querySelector('.rail-btn.is-active') || rails[0];
  if (cur && cur.hasAttribute && cur.hasAttribute('data-rail')) {
    const i = rails.indexOf(cur);
    if (dir === 'up' && i > 0) rails[i - 1].focus();
    else if (dir === 'down' && i < rails.length - 1) rails[i + 1].focus();
    else if (dir === 'right' && items[0]) items[0].focus();
    return;
  }
  const from = navFrom(cur);
  if (!from || !items.includes(from)) { if (items[0]) items[0].focus(); return; }
  const r = from.getBoundingClientRect();
  const sameRow = (q) => Math.abs(q.top - r.top) < r.height / 2;
  if (dir === 'left' || dir === 'right') {
    const i = items.indexOf(from);
    const n = items[i + (dir === 'right' ? 1 : -1)];
    if (n && sameRow(n.getBoundingClientRect())) n.focus();
    else if (dir === 'left' && activeRail()) activeRail().focus();
    return;
  }
  // Up and down: the nearest row above or below, then the item closest in x (the pins' row of 3
  // and Planning's rows of 4 line up by position, not by index).
  const cx = r.left + r.width / 2;
  let best = null;
  let bestDy = Infinity;
  let bestDx = Infinity;
  for (const it of items) {
    if (it === from) continue;
    const q = it.getBoundingClientRect();
    if (dir === 'down' ? q.top <= r.top + 4 : q.top >= r.top - 4) continue;
    const dy = Math.abs(q.top - r.top);
    const dx = Math.abs(q.left + q.width / 2 - cx);
    if (dy < bestDy - 4 || (Math.abs(dy - bestDy) <= 4 && dx < bestDx)) { best = it; bestDy = dy; bestDx = dx; }
  }
  if (best) best.focus();
}

function onKey(ev) {
  if (!state.auth) return;
  const t = ev.target;
  const typing = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'));
  const onTitle = state.stack.length > 0;
  if (ev.key === 'Escape') {
    const stop = () => ev.preventDefault();
    // In a box: Esc leaves it (a note is kept; a number typed is put back).
    if (typing) { stop(); t.blur(); return; }
    if (state.menu) { stop(); state.menu = false; render(); const b = app.querySelector('.rail-avatar'); if (b) b.focus(); return; }
    if (state.statusMenu) { stop(); state.statusMenu = false; render(); const b = app.querySelector('[data-f="tp:status"]'); if (b) b.focus(); return; }
    if (state.lmenu) { stop(); const w = state.lmenu; state.lmenu = null; render(); const b = app.querySelector(`[data-f="lb:${w}"]`); if (b) b.focus(); return; }
    if (state.find != null && !onTitle && state.view === 'now') { stop(); closeFind(); return; }
    if (state.confirmRemove) { stop(); state.confirmRemove = false; render(); const b = app.querySelector('[data-f="tp:remove"]'); if (b) b.focus(); return; }
    if (state.scoreOpen) { stop(); const id = state.scoreOpen; state.scoreOpen = null; render(); const c = app.querySelector(`[data-f="s:${id}"]`) || app.querySelector('[data-f="tp:sum:score"]'); if (c) c.focus(); return; }
    if (onTitle) { stop(); back(); return; }
    if (state.view === 'settings' && state.nsfw && state.nsfw.page) { stop(); nsfwClosePage(); return; }
    if (state.view === 'settings' && state.trk && state.trk.page) { stop(); closeSync(); return; }
    if (state.view === 'settings' && state.trk && state.trk.logOpen) { stop(); closeLog(); return; }
    if (state.view === 'settings' && state.setOpen) {
      stop();
      const g = state.setOpen;
      toggleGroup(g);
      const b = app.querySelector(`[data-f="set:${g}"]`);
      if (b) b.focus();
      return;
    }
    if (state.view !== 'now') { stop(); go('now'); }
    return;   // on Now, Esc closes the popup as usual
  }
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z' && !typing && state.toast && state.toast.undo) {
    ev.preventDefault();
    runUndo();
    return;
  }
  if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === '/' && railOn('search')) { ev.preventDefault(); openSearch(); return; }
  const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[ev.key];
  for (const [open, sel] of [[state.menu, '.menu-item'], [state.statusMenu, '.tp-menu-item'], [state.lmenu, '.lmenu-item']]) {
    if (!dir || !open) continue;
    const items = [...app.querySelectorAll(sel)];
    const i = items.indexOf(document.activeElement);
    if (dir === 'up' || dir === 'down') { ev.preventDefault(); const n = items[(i + (dir === 'down' ? 1 : -1) + items.length) % items.length]; if (n) n.focus(); }
    return;
  }
  if (onTitle && (ev.key === '+' || ev.key === '=')) {
    const b = app.querySelector('.tp-entry .js-plus:not(:disabled)');
    if (b) { ev.preventDefault(); b.click(); }
    return;
  }
  if (dir && t && t.closest && t.closest('.score-pick') && (dir === 'left' || dir === 'right')) {
    const btns = [...t.closest('.score-pick').querySelectorAll('button')];
    const n = btns[btns.indexOf(t) + (dir === 'right' ? 1 : -1)];
    ev.preventDefault();
    if (n) n.focus();
    return;
  }
  // On a title page, arrows move between the covers (watch order, more like this) once the keyboard
  // is on one, and otherwise scroll as usual.
  if (dir && onTitle && !(t && t.closest && t.closest('.tc'))) return;
  if (dir) { ev.preventDefault(); navigate(dir); return; }
  if (ev.key === '+' || ev.key === '=') {
    const holder = t && t.closest ? t.closest('[data-navfrom]') : null;
    const b = holder && holder.querySelector('.js-plus:not(:disabled)');
    if (b) { ev.preventDefault(); b.click(); }
  }
}

/* Start ------------------------------------------------------------------- */

document.addEventListener('keydown', onKey);
document.addEventListener('click', () => {
  if (state.menu || state.statusMenu || state.lmenu) { state.menu = false; state.statusMenu = false; state.lmenu = null; render(); }
});
// The mouse's back button goes back from a title page.
document.addEventListener('mouseup', (ev) => { if (ev.button === 3 && state.stack.length) { ev.preventDefault(); back(); } });
// 'scroll' doesn't bubble: caught on the way down.
document.addEventListener('scroll', (ev) => {
  const sc = ev.target;
  if (sc && sc.classList && sc.classList.contains('is-title')) stickBar(sc);
}, true);
// The font (Roboto) arrives a moment after the first drawing and can change the title's height.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { const sc = app.querySelector('.scroll.is-title'); if (sc) layoutTitle(sc); });

// Which poster the pointer is on, so a redraw (after +1, a score, a save) keeps its controls shown.
function setHot(id) {
  if (id === hotId) return;
  hotId = id;
  for (const el of app.querySelectorAll('.pc.is-hot, .tc.is-hot, .sr-row.is-hot, .lr.is-hot')) el.classList.remove('is-hot');
  if (id) for (const el of app.querySelectorAll(`.pc[data-id="${id}"], .tc[data-id="${id}"], .sr-row[data-id="${id}"], .lr[data-id="${id}"]`)) el.classList.add('is-hot');
}
document.addEventListener('pointerover', (ev) => {
  const c = ev.target && ev.target.closest ? ev.target.closest('.pc, .tc, .sr-row, .lr') : null;
  setHot(c ? c.dataset.id : null);
});
document.addEventListener('pointerout', (ev) => { if (!ev.relatedTarget) setHot(null); });

// Settings changed in the hub (or in another popup): shown at once, the theme and accent too.
const aboutShown = () => state.view === 'settings' && state.setOpen === 'about' && !state.stack.length;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings && !isOwnEcho(changes.settings.newValue)) {
    const before = stableJSON(state.settings);
    readSettings(changes.settings.newValue);
    if (stableJSON(state.settings) !== before) render();
  }
  if (area === 'sync' && changes.sorts) { state.sorts = changes.sorts.newValue || {}; if (state.stack.length) render(); }
  if ((area === 'sync' || area === 'local') && ORDER_KEYS.some((k) => changes[k])) {
    loadOrder().then(() => { if (state.lists.UPNEXT) { sortUpNext(state.lists.UPNEXT.entries); render(); } });
  }
  if (area === 'session' && changes.rate) { state.rate = changes.rate.newValue || null; if (aboutShown()) render(); }
  if (area === 'local' && changes.unread) { state.unread = changes.unread.newValue || 0; render(); }
  // AniList's theme (content/main.js) and your profile color, as the hub sees them on AniList.
  if (area === 'local' && changes.siteTheme) { state.siteTheme = changes.siteTheme.newValue || null; applyTheme(); render(); }
  if (area === 'local' && changes.viewerColor) { state.viewerColor = changes.viewerColor.newValue || null; applyAccent(); render(); }
  if (area !== 'local' || !changes.auth) return;
  const a = changes.auth.newValue;
  const was = !!state.auth;
  state.auth = a && a.token ? a : null;
  if (state.auth) {
    applyAccent();
    if (!was) { state.justConnected = true; state.lists = {}; state.view = 'now'; VIEWS.now.load({ force: true }); }
  } else {
    state.lists = {};
    state.stack = [];
    state.titles = {};
    try { chrome.storage.session.remove('popup:lists'); } catch { /* ignore */ }
  }
  render();
});

// AniList's theme set to follow the computer (or not seen yet): the popup follows it too.
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!state.settings || state.settings.theme !== 'site' || SITE_LOOKS[state.siteTheme]) return;
    applyTheme();
    render();
  });
} catch { /* old browser */ }

// Starts once every script of the page has run (popup-trackers.js adds its group to Settings).
async function start() {
  const stored = await chrome.storage.local.get(['auth', 'clientId', 'popup:view', 'popup:type', 'viewerColor', 'unread', 'popup:searchKind', 'popup:adult', 'castFrom', 'siteTheme',
    'popup:kind', 'popup:list', 'popup:lsort', 'popup:layout', 'popup:size', RECENT_KEY]);
  state.auth = stored.auth && stored.auth.token ? stored.auth : null;
  state.clientId = stored.clientId || '';
  state.viewerColor = stored.viewerColor || null;
  state.siteTheme = stored.siteTheme || null;
  state.unread = stored.unread || 0;
  // Settings opens folded: the group last unfolded isn't kept any more (0.12.4); the old record goes.
  chrome.storage.local.remove('popup:setOpen').catch(() => {});
  if (SEARCH_KINDS[stored['popup:searchKind']]) state.search.kind = stored['popup:searchKind'];
  state.search.adultOk = stored['popup:adult'] === true;
  if (stored['castFrom'] === 'anilist') state.castFrom = 'anilist';
  if (stored['popup:kind'] === 'ANIME' || stored['popup:kind'] === 'MANGA') { state.kind = stored['popup:kind']; state.kindChosen = true; }
  const lo = stored['popup:list'];
  if (lo && typeof lo === 'object') for (const k of ['ANIME', 'MANGA']) if (typeof lo[k] === 'string' && lo[k]) state.listOf[k] = lo[k];
  if (stored['popup:lsort'] && typeof stored['popup:lsort'] === 'object') state.lsort = stored['popup:lsort'];
  if (LAYOUTS.some((l) => l[0] === stored['popup:layout'])) state.layout = stored['popup:layout'];
  const sz = Number(stored['popup:size']);
  if (sz >= SIZE_MIN && sz <= SIZE_MAX) state.size = sz;
  else if (stored['popup:layout'] === 'small') state.size = 6;   // 0.8.2's "Small posters"

  if (Array.isArray(stored[RECENT_KEY])) state.search.recent = stored[RECENT_KEY].filter((n) => n && n.id && n.title).slice(0, RECENT_MAX);
  let sy = {};
  try { sy = await chrome.storage.sync.get(['settings', 'sorts']); } catch { /* ignore */ }
  readSettings(sy.settings);
  state.sorts = sy.sorts && typeof sy.sorts === 'object' ? sy.sorts : {};
  await loadOrder();
  // Where it opens (Settings, Popup): the section you left it on, or the one you picked.
  // 0.6.5 remembered a tab (ANIME, MANGA, UPNEXT, TODAY); Watching and Reading are both on Now.
  const old = { UPNEXT: 'upnext', TODAY: 'today' }[stored['popup:type']];
  const last = START_VIEWS.includes(stored['popup:view']) ? stored['popup:view'] : old || 'now';
  state.view = state.settings.popupStart === 'last' ? last : state.settings.popupStart;
  // Opened from the popup's "Open in a window" (0.12.6): the section, or the title page, it was showing.
  let carry = null;
  if (!IS_POPUP) {
    try {
      carry = (await chrome.storage.session.get('popup:carry'))['popup:carry'] || null;
      if (carry) chrome.storage.session.remove('popup:carry');
    } catch { /* ignore */ }
    if (carry && Date.now() - carry.at < 15000 && VIEWS[carry.view]) state.view = carry.view;
    else carry = null;
  }
  if (!railOn(state.view)) state.view = 'now';
  if (state.auth) {
    try {
      const cache = (await chrome.storage.session.get('popup:lists'))['popup:lists'];
      if (cache) state.lists = cache;
    } catch { /* ignore */ }
  }
  // MyAnimeList and MangaBaka (0.9): their logins, and the Compare page the login tab comes back to.
  try { await trkStart(); } catch (err) { console.warn('Tsugi: trackers', err); }
  // NSFW titles (0.12.3): your choices, and what the background last read of your lists.
  try { await nsfwStart(); } catch (err) { console.warn('Tsugi: NSFW titles', err); }
  render();
  if (state.auth && carry && carry.mediaId) openTitle(carry.mediaId);
  if (state.auth) {
    await VIEWS[state.view].load();
    if (state.view !== 'now') VIEWS.now.load({ quiet: true });
    if (state.view !== 'upnext') loadUpNext({ quiet: true });
    send({ type: 'notif:refresh' });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();

// A window, a tab or the side panel (0.12.6) can stay open for hours: when it's resized, the poster grids take
// as many a row as now fit; when you come back to it, what's shown is read again if it's older than STALE_MS,
// as when the popup opens.
// (The toolbar popup resizes too, when its Size changes in Settings.)
{
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.auth) return;
      const g = app.querySelector('.grid');
      if (g && g.style.getPropertyValue('--cols') !== String(fitCols(state.size))) { render(); return; }
      const ns = app.querySelector('.scroll.is-title');
      if (ns) layoutTitle(ns);
    }, 60);
  });
}
if (!IS_POPUP) {
  let backAt = 0;
  const cameBack = () => {
    if (document.visibilityState !== 'visible' || !state.auth || Date.now() - backAt < 5000) return;
    backAt = Date.now();
    const p = topPage();
    if (p) loadTitle(p.mediaId);
    else VIEWS[state.view].load({ quiet: true });
    if (state.view !== 'now') VIEWS.now.load({ quiet: true });
    send({ type: 'notif:refresh' });
    if (typeof trkCameBack === 'function') trkCameBack();
  };
  document.addEventListener('visibilitychange', cameBack);
  window.addEventListener('focus', cameBack);
}
