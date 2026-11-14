// Tsugi · On MyAnimeList's title pages (0.12.7): the same title on AniList, in MyAnimeList's own Resources links,
// and (connected) your status there under the cover. Registered by background.js ("AniList on MyAnimeList") only
// while the setting is on and Tsugi may read myanimelist.net (the permission Settings or MyAnimeList's tracker
// asked for). The title is found by its MyAnimeList number (AniList's idMal), through the background's queue.
// MyAnimeList's page is server-rendered: `.leftside` (the left column: the cover first), `h2` "Resources" followed by
// `.external_links` of `a.link` (`img.link_icon` + `.caption`), read on 2026-11-13.
(() => {
  'use strict';
  const m = /^\/(anime|manga)\/(\d+)(?:\/|$)/.exec(location.pathname);
  if (!m || document.documentElement.hasAttribute('data-tsugi-mal')) return;
  document.documentElement.setAttribute('data-tsugi-mal', '');
  const kind = m[1] === 'manga' ? 'MANGA' : 'ANIME';
  const mal = Number(m[2]);

  const el = (tag, attrs, ...kids) => {
    const x = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) x.setAttribute(k, v);
    for (const c of kids.flat()) if (c != null && c !== '') x.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return x;
  };
  let logo = '';
  try { logo = chrome.runtime.getURL('logos/anilist.png'); } catch { return; }

  const STATUS = {
    ANIME: { CURRENT: 'Watching', PLANNING: 'Planning', COMPLETED: 'Completed', DROPPED: 'Dropped', PAUSED: 'Paused', REPEATING: 'Rewatching' },
    MANGA: { CURRENT: 'Reading', PLANNING: 'Planning', COMPLETED: 'Completed', DROPPED: 'Dropped', PAUSED: 'Paused', REPEATING: 'Rereading' },
  };
  const SCORE_MAX = { POINT_100: 100, POINT_10_DECIMAL: 10, POINT_10: 10, POINT_5: 5 };

  function resourcesLink(url) {
    if (document.querySelector('.tsugi-al-link')) return;
    const a = el('a', { href: url, target: '_blank', rel: 'noopener', class: 'link tsugi-al-link', title: 'This title on AniList' },
      el('img', { src: logo, class: 'link_icon', alt: 'icon' }), el('div', { class: 'caption' }, 'AniList'));
    const heads = Array.from(document.querySelectorAll('.leftside h2'));
    const res = heads.find((x) => /^\s*resources\s*$/i.test(x.textContent));
    let box = res && res.nextElementSibling && res.nextElementSibling.classList.contains('external_links') ? res.nextElementSibling : null;
    if (box) { box.prepend(a); return; }
    // No Resources on this page: a group of its own, like MyAnimeList's, at the end of the left column.
    const side = document.querySelector('.leftside');
    if (!side) return;
    box = el('div', { class: 'external_links' }, a);
    side.append(el('br'), el('h2', {}, 'Resources'), box);
  }

  function statusLine(media, viewer) {
    if (!viewer) return;   // not connected: only the link
    const side = document.querySelector('.leftside');
    if (!side || document.querySelector('.tsugi-al-status')) return;
    const e = media.mediaListEntry;
    const parts = [];
    if (e) {
      parts.push((STATUS[kind] || STATUS.ANIME)[e.status] || 'On your list');
      const total = kind === 'MANGA' ? media.chapters : media.episodes;
      if (e.progress > 0 || e.status === 'CURRENT') parts.push(`${kind === 'MANGA' ? 'Ch' : 'Ep'} ${e.progress || 0}${total ? ` of ${total}` : ''}`);
      const max = SCORE_MAX[viewer.scoreFormat];
      if (e.score > 0 && max) parts.push(`${e.score}/${max}`);
    }
    const line = el('a', { href: media.siteUrl, target: '_blank', rel: 'noopener', class: 'tsugi-al-status' + (e ? '' : ' is-off') },
      el('img', { src: logo, alt: '' }),
      el('span', { class: 'tsugi-al-said' }, el('span', { class: 'tsugi-al-on' }, 'On AniList'), el('span', {}, e ? parts.join(', ') : 'Not on your list')));
    const first = side.firstElementChild;
    if (first) first.after(line); else side.prepend(line);
  }

  function style() {
    const css = `
.tsugi-al-status{ display: flex; align-items: center; gap: 8px; margin: 8px 0 4px; padding: 6px 8px; border: 1px solid rgba(128,128,128,.28);
  border-radius: 3px; text-decoration: none !important; font-size: 11px; line-height: 1.4; color: inherit !important; }
.tsugi-al-status:hover{ border-color: rgba(2,169,255,.7); }
.tsugi-al-status img{ width: 18px; height: 18px; border-radius: 3px; flex: none; }
.tsugi-al-said{ display: flex; flex-direction: column; min-width: 0; }
.tsugi-al-on{ font-weight: bold; color: #02A9FF; }
.tsugi-al-status.is-off .tsugi-al-said > span:last-child{ opacity: .7; }
.tsugi-al-link img.link_icon{ width: 16px; height: 16px; border-radius: 3px; object-fit: contain; }`;
    document.head.append(el('style', { id: 'tsugi-mal-style' }, css));
  }

  try {
    chrome.runtime.sendMessage({ type: 'mal:al', kind, mal }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok || !res.media) return;
      const media = res.media;
      if (!/^https:\/\/anilist\.co\/(anime|manga)\/\d+/.test(media.siteUrl || '')) return;
      style();
      resourcesLink(media.siteUrl);
      statusLine(media, res.viewer);
    });
  } catch { /* the extension was updated: nothing here until the page is reloaded */ }
})();
