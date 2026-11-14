// Tsugi · Runs the moment a page starts loading, before AniList draws anything.
// On a list page, AniList draws its rows in its own order before the extension can sort, filter
// and group them, add the badges and the Filters button. So the lists start out of sight
// (hold.css), and page.js shows them once they're in place: they appear once, already arranged.
// If the extension never gets that far, they show anyway after a few seconds.
// (Shares one scope with content/*.js, so nothing here is left at the top level.)
(() => {
  'use strict';
  // A profile AniList can't show turns into /404 before the extension starts (0.12.7): the address it was is kept
  // for social.js, which says why (private, no such name, or they blocked you).
  if (/^\/user\//.test(location.pathname)) document.documentElement.setAttribute('data-apq-start', location.pathname);
  const m = /^\/user\/([^/]+)\/(animelist|mangalist)(?:\/[^/]+)?\/?$/.exec(location.pathname);
  if (!m) return;
  const html = document.documentElement;
  html.setAttribute('data-apq-hold', 'start');
  setTimeout(() => { if (html.getAttribute('data-apq-hold') === 'start') html.removeAttribute('data-apq-hold'); }, 8000);
  // The list's titles are asked for now, while AniList is still loading its own scripts (0.12.8): the background
  // starts the same request the page will make (listquery.js) and hands it the answer (background.js).
  let user = m[1];
  try { user = decodeURIComponent(user); } catch { /* as it is */ }
  try { chrome.runtime.sendMessage({ type: 'list:prefetch', user, kind: m[2] === 'mangalist' ? 'MANGA' : 'ANIME' }).catch(() => {}); } catch { /* the extension was reloaded */ }
})();
