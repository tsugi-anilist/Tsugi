// Tsugi: the request for a list page's titles (0.12.8). Shared by AniList's pages (loaded at document_start with
// content/hold.js, so content/core.js finds it) and the background worker (importScripts), which starts this very
// request as a list page begins to load, before AniList's own scripts have run: the page then gets the answer that
// is already on its way (background.js, "A list page's titles, asked for early"). The content scripts share one
// scope, so these names must not be declared again anywhere else.
'use strict';

// %VIEW% and %VIEWE% are where the fields for list views and sorts go (source, adult, streaming links,
// average score, popularity; when the entry was added and updated).
// The list's owner by name, or by number when the address has one (/user/6053522/animelist): only
// one of $name and $uid is sent.
const LIST_TEMPLATE = `query ($name: String, $uid: Int, $type: MediaType) {
  MediaListCollection(userName: $name, userId: $uid, type: $type) {
    user { id name mediaListOptions { scoreFormat animeList { customLists } mangaList { customLists } } }
    lists {
      name status isCustomList
      entries {
        id mediaId status priority progress progressVolumes score repeat private notes%VIEWE%
        hiddenFromStatusLists customLists
        startedAt { year month day }
        completedAt { year month day }
        media {
          id siteUrl format status episodes chapters duration seasonYear%VIEW%
          startDate { year month day }
          nextAiringEpisode { episode }
          title { userPreferred }
          coverImage { medium large color }
        }
      }
    }
  }
}`;
const VIEW_FIELDS = ' source(version: 3) countryOfOrigin isAdult genres averageScore popularity externalLinks { site type }';
const LIST_QUERY = LIST_TEMPLATE.replace('%VIEW%', VIEW_FIELDS).replace('%VIEWE%', ' updatedAt createdAt');
// With each title's tags (0.12.3), only when your NSFW choices count tags for this kind (nsfw.js): they double the
// time AniList takes to answer (0.8 s to 1.8 s for 900 titles, measured on 2026-11-13).
const LIST_QUERY_TAGS = LIST_TEMPLATE.replace('%VIEW%', `${VIEW_FIELDS} tags { id rank }`).replace('%VIEWE%', ' updatedAt createdAt');
// The list as version 0.5 asked for it: used if AniList ever refuses the fields for list views.
const LIST_QUERY_NOVIEW = LIST_TEMPLATE.replace('%VIEW%', '').replace('%VIEWE%', '');
// The list as version 0.2 asked for it. Used if AniList refuses that one too.
const LIST_QUERY_BASIC = LIST_QUERY_NOVIEW
  .replace(' animeList { customLists } mangaList { customLists }', '')
  .replace(/progressVolumes |repeat private notes|hiddenFromStatusLists customLists|startedAt \{ year month day \}|completedAt \{ year month day \}/g, '');

// The variables for a list's owner as the address names them (decoded): a number, or a name. Built the same way by
// the page and the background, so the early request is recognised as the same one.
const listVars = (user, type) => (/^\d+$/.test(user) ? { uid: Number(user), type } : { name: user, type });
