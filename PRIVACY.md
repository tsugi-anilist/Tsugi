# Tsugi's privacy policy

Last updated: November 14, 2026

Tsugi is a browser extension for AniList. It has no server of its own: everything it keeps stays in your browser, and it only talks to the sites listed below. There are no analytics, no ads and no tracking, and nothing is ever sold or shared with anyone.

## Your logins

- **AniList.** When you click Connect, AniList asks you to approve Tsugi and gives it a login token. Tsugi keeps that token in your browser's local storage and sends it only to AniList, to read and save your list. Without that login, Tsugi uses your normal AniList session on anilist.co, with the page's own security token. That token is never stored or sent anywhere else.
- **MyAnimeList and MangaBaka**, only if you connect them. Their login tokens are kept the same way and sent only to that site. While you connect, Tsugi watches for the address the site sends you back to, to finish the login.

Logins are never synced to your other devices. Disconnect in Tsugi's Settings, or remove Tsugi's access in each site's own account settings (on AniList: Settings, Apps).

## What Tsugi stores in your browser

- Your settings, and the things AniList itself can't keep: priorities and pins for custom lists, your own order inside a priority, saved filters, the titles you marked as NSFW or not. If your browser syncs extension data (Chrome with your Google account, Brave Sync...), these travel with it to your own other devices.
- Copies of what sites answered (title details, scores, characters, songs), so the same thing isn't asked twice. They expire after a few minutes to two weeks.
- If you connect MyAnimeList or MangaBaka: where the last sync left each title, and the Sync log of what Tsugi changed (the last 60 days).

Removing Tsugi from your browser deletes all of it.

## What goes where

- **AniList** (anilist.co, graphql.anilist.co): your list and everything you do with Tsugi, as on AniList's own site. Tsugi only changes your list when you ask it to, as a follow-up to something you just did (like filling in the start date when you start a title), or through features you turn on yourself (syncing with your other trackers, keeping new NSFW titles private).
- **MyAnimeList** (api.myanimelist.net) and **MangaBaka** (api.mangabaka.org), only once you connect them: your entries for the titles they sync (status, progress, score, dates, rewatches, as you choose in Settings).
- **Public information about a title**, asked by the title's number only, never with anything about you: Tenrai (api.tenrai.org: MyAnimeList's score, characters and songs), AnimeThemes (openings and endings), MangaBaka and Kitsu (their scores).
- **Pictures and videos**: covers and pictures from AniList's and MyAnimeList's image servers; an AnimeThemes video only when you press Play.
- **Links** (YouTube, Reddit, the sites behind a score) only open when you click them.

Like any request on the web, these sites see your IP address and your browser's name, as they do when you visit them.

## On MyAnimeList's pages

Only if you allow it in Settings: on MyAnimeList's title pages, Tsugi adds the AniList link and your AniList status. To do that it sends the title's MyAnimeList number to AniList. It collects nothing from MyAnimeList's pages, and doesn't run on any other site's pages.

## Permissions

- **storage**: your settings, logins and the copies above.
- **alarms**: checks for new notifications every few minutes (for the count on the toolbar button), and checks your trackers if you connected one.
- **contextMenus**: the right-click menu on Tsugi's toolbar button (open it in a window, a tab or the side panel).
- **sidePanel**: Tsugi in the browser's side panel, if you choose it.
- **scripting**: AniList's link on MyAnimeList's title pages, only after you allow it.
- **anilist.co, graphql.anilist.co**: Tsugi works on AniList's pages and with AniList's API.
- **api.tenrai.org, api.animethemes.moe**: MyAnimeList's score and characters, and the songs, on title pages.
- **myanimelist.net, api.myanimelist.net, mangabaka.org, api.mangabaka.org**: only asked for when you connect that site, and given back when you disconnect it.

## Changes and questions

If this policy changes, this page changes first, with a new date at the top. Questions: open an [issue](../../issues) on Tsugi's GitHub page.
