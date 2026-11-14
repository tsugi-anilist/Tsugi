// Tsugi · All the styles for what the extension adds to AniList.
'use strict';

/* ------------------------------------------------------------------ */
/* Styles (the design direction is in DESIGN.md)                       */
/* ------------------------------------------------------------------ */
// Tokens follow AniList's own theme variables, so its light, dark and contrast themes all work.
// Night (sunken) = AniList's background, Panel (surface) = its foreground, Raised = menus and
// hovered rows, Ink = text and the fill of everything selected, Mist (muted) = secondary text.
// --apq-title is the color of the one title in focus (titleColor in core.js); the accent (the
// AniList profile color) is only for switches, focus rings and the extension's mark.

// Text in AniList's own body font: Roboto, which AniList loads in 300, 400, 500 and 700 (checked in its stylesheet
// on 2026-11-11). Overpass is only AniList's top bar, buttons and search boxes; its lists, sidebar and headings are
// Roboto. So Tsugi uses Roboto at AniList's weights: 400 for text, 500 for titles, labels and anything selected
// (DESIGN.md, "Type"; 0.7.1, it was Overpass at 600 to 800 with Manrope digits).
const UI_FONT = 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif';
const CSS = `
.apq-ui{
--apq-acc: var(--color-blue, 61,180,242);
--apq-on-acc: 255,255,255;
--apq-surface: var(--color-foreground, 250,250,250);
--apq-sunken: var(--color-background, 237,241,245);
--apq-raised: 255,255,255;
--apq-ink: 31,42,55;
--apq-on-ink: var(--color-foreground, 250,250,250);
--apq-strong: var(--apq-ink);
--apq-text: var(--color-text, 92,114,138);
--apq-muted: 107,124,144;
--apq-line: 20,30,46;
--apq-good: 46,160,90;
--apq-bad: 214,64,94;
--apq-warn: 196,112,8;
--apq-title: var(--apq-acc);
--apq-on-title: var(--apq-on-acc);
--apq-hover: rgba(var(--apq-ink),.055);
--apq-shadow: 0 18px 44px -14px rgba(20,30,46,.30), 0 3px 10px -4px rgba(20,30,46,.14);
--apq-ease: cubic-bezier(.2,.8,.2,1);
font-family: ${UI_FONT};
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
}
html[data-apq-theme="dark"] .apq-ui{
--apq-surface: var(--color-foreground, 21,31,46);
--apq-sunken: var(--color-background, 11,22,34);
--apq-raised: 30,42,59;
--apq-ink: 232,238,245;
--apq-on-ink: var(--color-foreground, 21,31,46);
--apq-text: var(--color-text, 159,173,189);
--apq-muted: 138,155,176;
--apq-line: 214,226,240;
--apq-good: 92,196,128;
--apq-bad: 240,104,128;
--apq-warn: 245,170,66;
--apq-hover: rgba(var(--apq-ink),.06);
--apq-shadow: 0 20px 50px -14px rgba(0,0,0,.66), 0 3px 10px -3px rgba(0,0,0,.42);
}
button:where(.apq-ui), :where(.apq-ui) button, :where(.apq-ui) input, :where(.apq-ui) textarea{
all: unset; box-sizing: border-box; font-family: inherit;
}
:where(.apq-ui), :where(.apq-ui) *{ box-sizing: border-box; }
.apq-ui[hidden], .apq-ui [hidden]{ display: none !important; }
.apq-ui :focus-visible, button.apq-ui:focus-visible{ outline: 2px solid rgb(var(--apq-acc)); outline-offset: 1px; }
.apq-ic{ width: 16px; height: 16px; flex: none; display: block; }
.apq-num{ font-weight: 500; }

/* The three-bar glyph (the extension's mark, and a priority's tier) */
.apq-glyph{ width: 12px; height: 12px; flex: none; display: block; fill: currentColor; }
.apq-glyph rect{ transition: opacity .2s var(--apq-ease); }
.apq-glyph.t1 .b2, .apq-glyph.t1 .b3, .apq-glyph.t2 .b3{ opacity: .3; }

/* Spinner */
.apq-spin{ display: inline-block; width: 13px; height: 13px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: apq-rot .7s linear infinite; flex: none; }

/* Tooltip */
.apq-tip{
position: fixed; top: 0; left: 0; z-index: 10000; max-width: 300px; padding: 5px 8px; border-radius: 6px;
background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); font-size: 12px; font-weight: 500; line-height: 1.35;
box-shadow: 0 6px 16px -6px rgba(0,0,0,.45); pointer-events: none; opacity: 0; transform: translateY(2px);
transition: opacity .14s ease, transform .14s var(--apq-ease);
}
.apq-tip.is-on{ opacity: 1; transform: none; }

/* ---------------- Badges on AniList's lists ---------------- */
.apq-badge{
display: inline-flex; align-items: center; justify-content: center; gap: 4px;
height: 20px; min-width: 32px; padding: 0 6px; margin: 0 9px 0 0; border-radius: 4px;
font-size: 11.5px; font-weight: 500; line-height: 1; letter-spacing: 0; vertical-align: middle;
color: rgb(var(--apq-ink));
background: rgba(var(--apq-ink),.07);
cursor: pointer; position: relative; flex: none; user-select: none;
transition: background-color .15s, color .15s, opacity .15s, box-shadow .15s, transform .15s var(--apq-ease);
}
.apq-badge .apq-glyph{ width: 10px; height: 10px; opacity: .72; }
.apq-badge .apq-badge-plus{ display: none; width: 12px; height: 12px; stroke-width: 2.6; }
.apq-badge:hover{ background: rgba(var(--apq-ink),.13); }
.apq-badge.is-top .apq-glyph{ opacity: 1; }
.apq-badge .apq-badge-pin{ display: none; width: 12px; height: 12px; stroke-width: 2.4; }
.apq-badge.is-pin{ color: rgb(var(--apq-on-ink)); background: rgb(var(--apq-ink)); min-width: 26px; padding: 0 6px; animation: apq-pop-in .15s var(--apq-ease); }
.apq-badge.is-pin:hover{ background: rgba(var(--apq-ink),.86); }
.apq-badge.is-pin .apq-glyph{ display: none; }
.apq-badge.is-pin .apq-badge-pin{ display: block; }
[data-apq-gone]{ display: none !important; }
.apq-badge.is-empty{ color: rgb(var(--apq-muted)); background: transparent; box-shadow: inset 0 0 0 1px rgba(var(--apq-muted),.5); opacity: 0; }
.apq-badge.is-empty .apq-glyph{ display: none; }
.apq-badge.is-empty .apq-badge-plus{ display: block; }
[data-apq-id]:hover .apq-badge.is-empty, .apq-badge.is-empty.is-open, .apq-badge.is-empty:focus-visible{ opacity: 1; }
html.apq-selecting [data-apq-id]:hover .apq-badge.is-empty{ opacity: 0; }
.apq-badge.is-empty:hover{ color: rgb(var(--apq-ink)); box-shadow: inset 0 0 0 1px rgba(var(--apq-ink),.55); background: rgba(var(--apq-ink),.05); }
.apq-badge.is-readonly{ cursor: default; }
.apq-badge.is-readonly.is-empty{ visibility: hidden; }
.apq-badge.is-open{ box-shadow: 0 0 0 2px rgba(var(--apq-ink),.5); }
.apq-badge.is-saving .apq-badge-num, .apq-badge.is-saving .apq-glyph{ opacity: .5; }
.apq-badge.is-blocked::before{
content: ""; position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%;
background: rgb(var(--apq-warn)); box-shadow: 0 0 0 2px rgb(var(--apq-surface));
}
.apq-badge.is-blocked.is-empty{ opacity: 1; }
.apq-badge.is-error{ color: rgb(var(--apq-bad)); background: rgba(var(--apq-bad),.1); box-shadow: inset 0 0 0 1px rgba(var(--apq-bad),.45); opacity: 1; }
/* On cards: a dark glass chip, legible over any cover art, whatever the theme. Tinted, not blurred (0.12.8): a blur
 behind every card's chip made each one its own layer for the graphics card to redraw on every frame of a scroll
 (183 of them on a list of 220 cards, against AniList's own 5), so a little more tint stands in for it. */
.apq-badge.is-card{
position: absolute; top: 9px; left: 8px; z-index: 999; margin: 0; height: 21px; width: 36px; min-width: 0; padding: 0; font-size: 11px;
background: rgba(11,16,26,.8); color: #fff; box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 4px 12px -4px rgba(0,0,0,.5);
}
.apq-badge.is-card .apq-glyph{ opacity: .85; }
.apq-badge.is-card:hover{ background: rgba(11,16,26,.88); }
.apq-badge.is-card.is-pin{ background: #fff; color: rgb(21,31,46); box-shadow: 0 4px 12px -4px rgba(0,0,0,.5); }
.apq-badge.is-card.is-empty{ color: #fff; box-shadow: 0 0 0 1px rgba(255,255,255,.28), 0 4px 12px -4px rgba(0,0,0,.5); }
.apq-badge.is-card.is-blocked::before{ box-shadow: 0 0 0 2px rgba(11,16,26,.8); }
/* Lists with priorities off: a quiet star (score, custom lists, rewatch log), only while you point at the title */
.apq-badge .apq-badge-more{ display: none; width: 14px; height: 14px; }
.apq-badge.is-lite{ min-width: 26px; padding: 0 5px; opacity: 0; color: rgb(var(--apq-muted)); background: transparent; box-shadow: inset 0 0 0 1px rgba(var(--apq-muted),.45); }
.apq-badge.is-lite .apq-glyph, .apq-badge.is-lite .apq-badge-num{ display: none; }
.apq-badge.is-lite .apq-badge-more{ display: block; }
[data-apq-id]:hover .apq-badge.is-lite, .apq-badge.is-lite.is-open, .apq-badge.is-lite:focus-visible{ opacity: 1; }
html.apq-selecting .apq-badge.is-lite{ opacity: 0 !important; }
.apq-badge.is-lite:hover{ color: rgb(var(--apq-ink)); background: var(--apq-hover); }
.apq-badge.is-card.is-lite{ color: #fff; background: rgba(11,16,26,.8); box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 4px 12px -4px rgba(0,0,0,.5); }
.apq-pop.is-lite .apq-pop-foot:empty{ display: none; }
/* Just after the title (a list with no priorities, or with priorities off; page.js placeBadge): AniList's title link
   pushes its own icons to the right with an auto margin, which the button takes over so it stays by the title. The
   empty one shows the priority bars, not "+", which AniList uses for progress on the same row. */
.apq-badge.is-tail{ margin: 0 auto 0 8px; }
.title > a:has(+ .apq-badge.is-tail){ margin-right: 0 !important; }
.apq-badge.is-empty.is-tail .apq-badge-plus{ display: none; }
.apq-badge.is-empty.is-tail .apq-glyph{ display: block; opacity: .6; }
/* It takes the row's own text color, so it reads on AniList's blue hovered row as well as on the plain one. */
.apq-badge.is-tail.is-empty, .apq-badge.is-tail.is-lite{
color: inherit; background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 45%, transparent);
}
.apq-badge.is-tail.is-empty:hover, .apq-badge.is-tail.is-lite:hover, .apq-badge.is-tail.is-open{
color: inherit; background: color-mix(in srgb, currentColor 14%, transparent); box-shadow: inset 0 0 0 1px currentColor;
}
/* Cards with a badge: AniList's note and rewatch icons (left: 2px and 28px on AniList) move to its right. */
.entry-card[data-apq-badge] > .notes{ left: 48px !important; }
.entry-card[data-apq-badge] > .repeat{ left: 74px !important; }
.apq-sort-prio{ padding: 2px 0; }
.apq-flexcol{ display: flex !important; flex-direction: column !important; }
/* Titles AniList adds while you scroll go to the end right away, instead of
 flashing at the top until they're sorted. */
[data-apq-sorted] > :not([data-apq-ord]){ order: 99999; }

/* ---------------- Selecting on the page ---------------- */
html.apq-selecting [data-apq-id]{ cursor: pointer; user-select: none; -webkit-user-select: none; }
html.apq-selecting [data-apq-id] .edit{ visibility: hidden; }
.apq-ring{
position: absolute; inset: 0; z-index: 5; border-radius: inherit; pointer-events: none; opacity: 0;
box-shadow: inset 0 0 0 2px rgba(var(--apq-ink),.35); transition: opacity .15s, box-shadow .15s;
}
.apq-ring.is-row{ box-shadow: inset 0 0 0 999px rgba(var(--apq-ink),.035); }
[data-apq-id]:hover > .apq-ring{ opacity: 1; }
[data-apq-sel] > .apq-ring{ opacity: 1; box-shadow: inset 0 0 0 3px rgb(var(--apq-ink)), inset 0 0 0 999px rgba(var(--apq-ink),.12); }
[data-apq-sel] > .apq-ring.is-row{ box-shadow: inset 3px 0 0 rgb(var(--apq-ink)), inset 0 0 0 999px rgba(var(--apq-ink),.08); }
.apq-check{
position: absolute; top: 8px; right: 8px; z-index: 6; width: 24px; height: 24px; border-radius: 50%;
display: grid; place-items: center; color: transparent; background: rgba(11,16,26,.34);
box-shadow: inset 0 0 0 2px rgba(255,255,255,.92), 0 2px 6px rgba(0,0,0,.3);
opacity: 0; pointer-events: none; transition: opacity .15s, background-color .15s, color .15s;
}
.apq-check .apq-ic{ width: 14px; height: 14px; stroke-width: 3.2; }
[data-apq-id]:hover > .apq-check, [data-apq-sel] > .apq-check{ opacity: 1; }
[data-apq-sel] > .apq-check{ background: #fff; color: rgb(21,31,46); box-shadow: 0 0 0 2px rgba(11,16,26,.5), 0 3px 10px rgba(0,0,0,.35); }

/* ---------------- Floating button ---------------- */
.apq-dock{
position: fixed; right: 20px; bottom: 20px; z-index: 900;
transition: opacity .22s var(--apq-ease), transform .22s var(--apq-ease);
}
.apq-dock.is-left{ right: auto; left: 20px; }
.apq-dock.is-off{ display: none; }
.apq-dock.is-near:not(.is-shown):not(:focus-within){ opacity: 0; transform: translateY(10px) scale(.95); pointer-events: none; }
.apq-launcher{
display: flex; align-items: center; padding: 3px; border-radius: 999px;
background: rgb(var(--apq-raised)); box-shadow: var(--apq-shadow), inset 0 0 0 1px rgba(var(--apq-line),.08);
}
.apq-dock.is-left .apq-launcher{ flex-direction: row-reverse; }
.apq-dock-extra{
display: flex; align-items: center; gap: 2px; max-width: 0; opacity: 0; overflow: hidden;
transition: max-width .26s var(--apq-ease), opacity .18s ease, padding .26s var(--apq-ease);
}
.apq-dock.is-left .apq-dock-extra{ flex-direction: row-reverse; }
.apq-launcher:hover .apq-dock-extra, .apq-launcher:focus-within .apq-dock-extra{ max-width: 160px; opacity: 1; padding-right: 3px; }
.apq-dock.is-left .apq-launcher:hover .apq-dock-extra, .apq-dock.is-left .apq-launcher:focus-within .apq-dock-extra{ padding-right: 0; padding-left: 3px; }
.apq-dock-btn{
width: 36px; height: 36px; flex: none; border-radius: 999px; display: grid; place-items: center; cursor: pointer;
color: rgb(var(--apq-muted)); transition: background-color .15s, color .15s;
}
.apq-dock-btn:hover{ background: var(--apq-hover); color: rgb(var(--apq-ink)); }
.apq-dock-btn .apq-ic{ width: 17px; height: 17px; }
.apq-dock-sort[aria-pressed="true"]{ color: rgb(var(--apq-on-ink)); background: rgb(var(--apq-ink)); }
.apq-dock-main{
position: relative; width: 38px; height: 38px; flex: none; border-radius: 999px; display: grid; place-items: center; cursor: pointer;
color: rgb(var(--apq-acc)); transition: background-color .15s, color .15s;
}
.apq-dock-main:hover{ background: var(--apq-hover); }
.apq-dock-main .apq-glyph{ width: 15px; height: 15px; }
.apq-dock-main .apq-spin{ display: none; width: 15px; height: 15px; }
.apq-dock.is-busy .apq-dock-main .apq-spin{ display: block; }
.apq-dock.is-busy .apq-dock-main .apq-glyph{ display: none; }
.apq-dock.is-error .apq-dock-main{ color: rgb(var(--apq-bad)); }
.apq-dock-dot{
position: absolute; top: 6px; right: 6px; width: 7px; height: 7px; border-radius: 50%;
background: rgb(var(--apq-ink)); box-shadow: 0 0 0 2px rgb(var(--apq-raised));
transform: scale(0); transition: transform .2s var(--apq-ease);
}
.apq-dock.is-sorted .apq-dock-dot{ transform: scale(1); }

/* Covered loading fallback */
.apq-veil{
position: fixed; inset: 0; z-index: 9993; display: grid; place-items: center;
background: rgb(var(--apq-sunken)); opacity: 0; transition: opacity .25s ease;
}
.apq-veil.is-on{ opacity: 1; transition-duration: .12s; }
.apq-veil-card{
display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 10px;
background: rgb(var(--apq-surface)); box-shadow: var(--apq-shadow);
font-size: 13.5px; font-weight: 500; color: rgb(var(--apq-ink));
}
.apq-veil-card .apq-spin{ color: rgb(var(--apq-muted)); }
/* While a slow list page is kept out of sight until it's in place (page.js, hold.css) */
.apq-hold-note{
position: absolute; z-index: 20; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
padding: 10px 14px; border-radius: 10px; background: rgb(var(--apq-surface)); box-shadow: var(--apq-shadow);
font-size: 13px; font-weight: 500; color: rgb(var(--apq-ink)); pointer-events: none;
}
.apq-hold-note .apq-spin{ color: rgb(var(--apq-muted)); }

/* ---------------- Tsugi's button in AniList's top bar (hub.js) ----------------
   Like AniList's search icon beside it (#777a9e, #d3d5f3 on hover; paler over a banner), and a menu on hover
   like AniList's avatar menu (copied from its stylesheet, 2026-11-11: Overpass, its font in that bar). */
.apq-nav{ position: relative; display: inline-flex; align-items: center; margin-right: 16px; }
.apq-nav-btn{ width: 30px; height: 30px; display: grid; place-items: center; border-radius: 6px; cursor: pointer; color: #777a9e; transition: color .3s ease; }
.apq-nav-btn .apq-glyph{ width: 17px; height: 17px; }
.apq-nav-btn:hover, .apq-nav:focus-within .apq-nav-btn{ color: #d3d5f3; }
#nav.transparent .apq-nav-btn:not(:hover){ color: rgba(191,193,212,.65); }
.apq-nav.is-error .apq-nav-btn{ color: rgb(var(--color-peach, 250,122,122)); }
.apq-nav:hover::after{ content: ""; position: absolute; top: 100%; left: -40px; right: -40px; height: 22px; }
.apq-nav-menu{
position: absolute; top: calc(100% + 16px); left: 50%; width: 280px; margin-left: -140px; z-index: 2; border-radius: 6px; text-align: left;
background: rgb(var(--color-background-100, 251,251,251));
box-shadow: 0 14px 30px rgba(var(--color-shadow-blue, 103,132,187),.25), 0 4px 4px rgba(var(--color-shadow-blue, 103,132,187),.15);
font-family: Overpass, -apple-system, BlinkMacSystemFont, "Segoe UI", Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
opacity: 0; pointer-events: none; user-select: none; transition: opacity .2s ease;
}
.apq-nav-menu::before{
content: ""; position: absolute; bottom: 100%; left: calc(50% - 4px); width: 0; height: 0;
border-bottom: 6px solid rgb(var(--color-gray-100, 251,251,251)); border-left: 4px solid transparent; border-right: 4px solid transparent;
}
.apq-nav:hover .apq-nav-menu, .apq-nav:focus-within .apq-nav-menu{ opacity: 1; pointer-events: auto; }
.apq-nav.is-shut .apq-nav-menu{ opacity: 0 !important; pointer-events: none !important; }
.apq-nav-items{ padding: 21px 27px 3px; }
.apq-nav-item{
display: grid; grid-template-columns: 20px 1fr auto; align-items: center; column-gap: 10px; width: 100%; margin-bottom: 18px; cursor: pointer;
font-size: 14px; font-weight: 600; letter-spacing: .03rem; color: rgb(var(--color-gray-700, 116,136,153)); transition: color .2s ease;
}
.apq-nav-item:hover, .apq-nav-item:focus-visible{ color: rgb(var(--color-gray-800, 100,115,128)); }
.apq-nav-ic{ display: grid; place-items: center; color: rgb(var(--color-gray-600, 139,160,178)); transition: color .2s ease; }
.apq-nav-item:hover .apq-nav-ic{ color: rgb(var(--color-gray-800, 100,115,128)); }
.apq-nav-ic .apq-ic{ width: 15px; height: 15px; }
.apq-nav-ic .apq-glyph{ width: 13px; height: 13px; }
.apq-nav-label{ white-space: nowrap; }
.apq-nav-key{ font-size: 11px; font-weight: 600; letter-spacing: 0; color: rgb(var(--color-gray-600, 139,160,178)); }
.apq-nav-foot{ padding: 14px 27px; border-radius: 0 0 6px 6px; background: rgb(var(--color-background-200, 237,241,245)); }
.apq-nav-link{
display: inline-grid; grid-template-columns: 12px auto; column-gap: 7px; align-items: center; cursor: pointer;
font-size: 11px; font-weight: 600; color: rgb(var(--color-gray-700, 116,136,153)); transition: color .2s ease;
}
.apq-nav-link:hover, .apq-nav-link:focus-visible{ color: rgb(var(--color-gray-900, 81,97,112)); }
.apq-nav-link .apq-ic{ width: 12px; height: 12px; }

/* ---------------- Shared controls ---------------- */
/* Segmented control: a Night well, the selected segment filled with Ink */
.apq-seg{ display: flex; gap: 2px; padding: 3px; border-radius: 6px; background: rgb(var(--apq-sunken)); }
.apq-seg-btn{
flex: 1; height: 28px; padding: 0 10px; border-radius: 4px; display: grid; place-items: center; cursor: pointer; white-space: nowrap;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); transition: color .15s, background-color .15s;
}
.apq-seg-btn:hover{ color: rgb(var(--apq-ink)); background: var(--apq-hover); }
.apq-seg-btn.is-active, .apq-seg-btn.is-active:hover{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
.apq-seg-btn:disabled{ opacity: .4; cursor: default; pointer-events: none; }
/* Chips (priority 0–5, bulk bar) */
.apq-chip{
height: 30px; border-radius: 4px; display: grid; place-items: center; cursor: pointer;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-text)); background: rgba(var(--apq-ink),.06);
transition: background-color .12s, color .12s;
}
.apq-chip:hover{ background: rgba(var(--apq-ink),.11); color: rgb(var(--apq-ink)); }
.apq-chip.is-active, .apq-chip.is-active:hover{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
/* Toggle chips (Pick for me, feed filters, mass edit's dates) */
.apq-tchip{
height: 30px; padding: 0 11px 0 9px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-text)); background: rgba(var(--apq-ink),.06); transition: color .15s, background-color .15s;
}
.apq-tchip .apq-ic{ width: 13px; height: 13px; stroke-width: 3; opacity: .3; }
.apq-tchip:hover{ color: rgb(var(--apq-ink)); background: rgba(var(--apq-ink),.11); }
.apq-tchip[aria-pressed="true"], .apq-tchip[aria-pressed="true"]:hover{ color: rgb(var(--apq-on-ink)); background: rgb(var(--apq-ink)); }
.apq-tchip[aria-pressed="true"] .apq-ic{ opacity: 1; }
/* Switches: the one place the accent fills something */
.apq-switch-wrap{ flex: none; display: flex; align-items: center; gap: 10px; font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink)); cursor: pointer; border-radius: 6px; }
.apq-switch{
position: relative; flex: none; width: 34px; height: 20px; border-radius: 999px;
background: transparent; box-shadow: inset 0 0 0 1.5px rgba(var(--apq-ink),.4); transition: background-color .2s, box-shadow .2s;
}
.apq-switch::after{
content: ""; position: absolute; top: 4px; left: 4px; width: 12px; height: 12px; border-radius: 50%;
background: rgba(var(--apq-ink),.55); transition: transform .2s var(--apq-ease), background-color .2s;
}
/* On: filled with the accent (off is only an outline, so a gray accent still reads) */
[aria-checked="true"] > .apq-switch{ background: rgb(var(--apq-acc)); box-shadow: none; }
[aria-checked="true"] > .apq-switch::after{ transform: translateX(14px); background: rgb(var(--apq-on-acc)); box-shadow: 0 1px 3px rgba(0,0,0,.3); }
/* Buttons: primary = Ink */
.apq-btn{
margin-top: 14px; height: 34px; padding: 0 14px; border-radius: 6px; display: inline-flex; align-items: center; cursor: pointer;
background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); font-size: 13px; font-weight: 500;
}
.apq-btn:hover{ background: rgba(var(--apq-ink),.86); }
.apq-icon-btn{
width: 32px; height: 32px; border-radius: 6px; flex: none; display: grid; place-items: center;
color: rgb(var(--apq-muted)); cursor: pointer; transition: background-color .15s, color .15s;
}
.apq-icon-btn:hover, .apq-icon-btn[aria-pressed="true"]{ background: var(--apq-hover); color: rgb(var(--apq-ink)); }
.apq-icon-btn .apq-ic{ width: 18px; height: 18px; }
.apq-sel-btn[aria-pressed="true"], .apq-sel-btn[aria-pressed="true"]:hover{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
.apq-kbd{
flex: none; display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border-radius: 4px;
background: rgb(var(--apq-sunken)); box-shadow: inset 0 -1px 0 rgba(var(--apq-line),.16);
font-size: 11px; font-weight: 500; color: rgb(var(--apq-ink)); white-space: nowrap;
}
/* Empty and error states */
.apq-empty{ display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 56px 28px; }
.apq-empty-ic{ width: 44px; height: 44px; margin-bottom: 8px; border-radius: 10px; display: grid; place-items: center; background: rgb(var(--apq-sunken)); color: rgb(var(--apq-muted)); }
.apq-empty-ic .apq-ic{ width: 20px; height: 20px; }
.apq-empty-title{ font-size: 15px; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-empty-text{ max-width: 280px; font-size: 12.5px; line-height: 1.55; color: rgb(var(--apq-muted)); }

/* ---------------- The episode track ---------------- */
/* One thin continuous line in the title's color (0.6.8.1): watched solid, out but not watched at 35%,
 not out yet empty. A +1 grows it, Undo shrinks it, finishing brightens it once. */
.apq-track{ position: relative; display: block; height: 4px; min-width: 0; border-radius: 999px; overflow: hidden; background: rgba(var(--apq-muted),.16); }
.apq-track > b{ position: absolute; top: 0; bottom: 0; left: 0; border-radius: 999px; transition: width .18s ease-out; }
.apq-track > .apq-track-out{ background: rgba(var(--apq-title),.35); }
.apq-track > .apq-track-done{ background: rgb(var(--apq-title)); }
.apq-track.is-finished{ animation: apq-brighten .35s ease-out; }
.apq-track-label{ display: flex; align-items: baseline; gap: 8px; min-width: 0; white-space: nowrap; }
.apq-track-ep{ font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-track-ep b{ display: inline-block; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-track-ep b.is-tick{ animation: apq-tick .18s ease-out; }
/* +1: a pill in the title's own color */
.apq-plus1{
flex: none; height: 28px; min-width: 40px; padding: 0 11px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; gap: 1px; cursor: pointer;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-on-title)); background: rgb(var(--apq-title));
transition: filter .15s, transform .1s, opacity .15s;
}
.apq-plus1:hover:not(:disabled){ filter: brightness(1.08); }
.apq-plus1:active:not(:disabled){ transform: scale(.95); }
.apq-plus1:disabled{ opacity: .5; cursor: default; }
.apq-plus1 .apq-spin{ width: 12px; height: 12px; }

/* ---------------- Bulk bar ---------------- */
.apq-bar{
position: fixed; left: 50%; bottom: 20px; z-index: 9996; display: flex; align-items: center; gap: 12px;
height: 54px; max-width: calc(100vw - 16px); padding: 0 8px 0 16px; border-radius: 10px;
background: rgb(var(--apq-raised)); color: rgb(var(--apq-text));
box-shadow: var(--apq-shadow), 0 0 0 1px rgba(var(--apq-line),.08);
opacity: 0; transform: translate(-50%, 14px); transition: opacity .2s var(--apq-ease), transform .22s var(--apq-ease), left .26s var(--apq-ease);
}
.apq-bar.is-on{ opacity: 1; transform: translate(-50%, 0); }
.apq-bar-sel{ display: flex; align-items: center; gap: 8px; min-width: 120px; }
.apq-bar-count{ font-size: 13.5px; font-weight: 500; color: rgb(var(--apq-ink)); white-space: nowrap; }
.apq-bar-count.is-empty{ font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-bar-link{ padding: 5px 7px; border-radius: 6px; font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink)); cursor: pointer; white-space: nowrap; text-decoration: underline; text-decoration-color: rgba(var(--apq-ink),.3); text-underline-offset: 3px; }
.apq-bar-link:hover{ background: var(--apq-hover); text-decoration-color: currentColor; }
.apq-bar-x{ width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; color: rgb(var(--apq-muted)); cursor: pointer; }
.apq-bar-x:hover{ background: var(--apq-hover); color: rgb(var(--apq-ink)); }
.apq-bar-x .apq-ic{ width: 14px; height: 14px; stroke-width: 2.5; }
.apq-bar-sep{ width: 1px; height: 24px; background: rgba(var(--apq-line),.12); flex: none; }
.apq-bar-set{ display: flex; align-items: center; gap: 6px; }
.apq-bar-label{ font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); margin-right: 4px; }
.apq-bar-chips{ display: flex; gap: 3px; padding: 3px; border-radius: 6px; background: rgb(var(--apq-sunken)); }
.apq-bar .apq-chip{ min-width: 30px; height: 30px; padding: 0 9px; background: transparent; }
.apq-bar .apq-chip:hover{ background: var(--apq-hover); }
.apq-bar .apq-chip.is-active{ background: rgb(var(--apq-ink)); }
.apq-bar-step{
width: 32px; height: 32px; border-radius: 6px; display: grid; place-items: center; cursor: pointer;
background: rgba(var(--apq-ink),.06); color: rgb(var(--apq-ink)); transition: background-color .12s;
}
.apq-bar-step:hover{ background: rgba(var(--apq-ink),.11); }
.apq-bar-step .apq-ic{ width: 15px; height: 15px; stroke-width: 2.5; }
.apq-bar-edit{
height: 36px; padding: 0 14px 0 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; flex: none;
background: rgba(var(--apq-ink),.07); color: rgb(var(--apq-ink)); font-size: 13px; font-weight: 500; transition: background-color .15s;
}
.apq-bar-edit:hover{ background: rgba(var(--apq-ink),.12); }
.apq-bar-edit .apq-ic{ width: 15px; height: 15px; stroke-width: 2.3; }
.apq-bar-done{
height: 36px; padding: 0 16px; border-radius: 6px; display: grid; place-items: center; cursor: pointer;
background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); font-size: 13px; font-weight: 500; transition: background-color .15s;
}
.apq-bar-done:hover{ background: rgba(var(--apq-ink),.86); }
.apq-bar button:disabled{ opacity: .35; cursor: default; pointer-events: none; }

/* ---------------- The hub panel ---------------- */
.apq-scrim{
position: fixed; inset: 0; z-index: 9994; background: rgba(12,18,28,.28); opacity: 0; pointer-events: none;
transition: opacity .22s var(--apq-ease);
}
html[data-apq-theme="dark"] .apq-scrim{ background: rgba(0,0,0,.5); }
.apq-scrim.is-open{ opacity: 1; pointer-events: auto; }
.apq-drawer{
position: fixed; top: 12px; right: 12px; bottom: 12px; z-index: 9995; width: min(500px, calc(100vw - 24px));
display: flex; flex-direction: row; overflow: hidden; outline: none;
background: rgb(var(--apq-surface)); color: rgb(var(--apq-text)); border-radius: 14px;
box-shadow: var(--apq-shadow), 0 0 0 1px rgba(var(--apq-line),.08);
opacity: 0; visibility: hidden; transform: translateX(16px); pointer-events: none;
transition: opacity .18s var(--apq-ease), transform .22s var(--apq-ease), visibility 0s linear .22s;
}
.apq-drawer.is-open{
opacity: 1; visibility: visible; transform: none; pointer-events: auto;
transition: opacity .18s var(--apq-ease), transform .22s var(--apq-ease), visibility 0s;
}
.apq-rail{
width: 56px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 0;
background: rgb(var(--apq-sunken)); border-right: 1px solid rgba(var(--apq-line),.06);
}
html[data-apq-panel="dark"] .apq-rail{ background: rgba(var(--apq-sunken),.6); }
.apq-rail-items{ flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 12px; }
.apq-rail-foot{ display: flex; flex-direction: column; align-items: center; gap: 6px; }
.apq-rail-btn{
position: relative; width: 38px; height: 38px; border-radius: 6px; display: grid; place-items: center; cursor: pointer;
color: rgb(var(--apq-muted)); transition: background-color .15s, color .15s;
}
.apq-rail-btn .apq-ic{ width: 18px; height: 18px; }
.apq-rail-btn:hover{ background: var(--apq-hover); color: rgb(var(--apq-ink)); }
.apq-rail-btn.is-active, .apq-rail-btn.is-active:hover{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
.apq-main{ flex: 1; min-width: 0; display: flex; flex-direction: column; }
.apq-dh{ display: flex; flex-direction: column; gap: 12px; padding: 16px 16px 12px; border-bottom: 1px solid rgba(var(--apq-line),.07); }
.apq-dh-row{ display: flex; align-items: center; gap: 6px; }
.apq-mark{
width: 34px; height: 34px; flex: none; display: grid; place-items: center;
--accent: rgb(var(--apq-acc)); color: rgb(var(--apq-ink));
}
.apq-mark .apq-tsugi{ width: 30px; height: 30px; display: block; overflow: visible; }
.apq-dh-text{ flex: 1; min-width: 0; padding-left: 2px; }
.apq-dh-title{ font-size: 15px; font-weight: 500; line-height: 1.2; color: rgb(var(--apq-ink)); }
.apq-dh-sub{ margin-top: 2px; font-size: 12.5px; font-weight: 400; color: rgb(var(--apq-muted)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.apq-tabs{ display: flex; gap: 2px; padding: 3px; border-radius: 6px; background: rgb(var(--apq-sunken)); overflow-x: auto; scrollbar-width: none; }
.apq-tabs::-webkit-scrollbar{ display: none; }
.apq-tab{
flex: 1 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 11px;
border-radius: 4px; font-size: 12.5px; font-weight: 500; white-space: nowrap; color: rgb(var(--apq-muted)); cursor: pointer;
transition: color .15s, background-color .15s;
}
.apq-tab:hover{ color: rgb(var(--apq-ink)); background: var(--apq-hover); }
.apq-tab.is-active, .apq-tab.is-active:hover{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
.apq-tab-n{ font-size: 11px; font-weight: 500; opacity: .7; }

.apq-tools{ display: flex; gap: 6px; }
.apq-search{
flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border-radius: 6px;
background: rgb(var(--apq-sunken)); color: rgb(var(--apq-muted)); cursor: text; transition: box-shadow .15s;
}
.apq-search .apq-ic{ width: 15px; height: 15px; }
.apq-search:focus-within{ box-shadow: 0 0 0 2px rgb(var(--apq-acc)); }
.apq-search input{ flex: 1; min-width: 0; height: 100%; font-size: 13px; font-weight: 400; color: rgb(var(--apq-ink)); cursor: text; }
.apq-search input::placeholder{ color: rgb(var(--apq-muted)); opacity: 1; }
.apq-search input:focus-visible{ outline: none; }
.apq-dir{
width: 34px; height: 34px; border-radius: 6px; flex: none; display: grid; place-items: center;
background: rgb(var(--apq-sunken)); color: rgb(var(--apq-ink)); cursor: pointer; transition: background-color .15s;
}
.apq-dir:hover{ background: rgba(var(--apq-ink),.1); }
.apq-dir .apq-ic{ width: 17px; height: 17px; }

.apq-body{ flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 0 8px 14px; }
.apq-body::-webkit-scrollbar, .apq-mass-body::-webkit-scrollbar, .apq-pal-list::-webkit-scrollbar, .apq-lv-scroll::-webkit-scrollbar, .apq-sort-scroll::-webkit-scrollbar{ width: 10px; }
.apq-body::-webkit-scrollbar-track{ background: transparent; }
.apq-body::-webkit-scrollbar-button{ display: none; height: 0; }
.apq-body::-webkit-scrollbar-thumb, .apq-mass-body::-webkit-scrollbar-thumb, .apq-pal-list::-webkit-scrollbar-thumb, .apq-lv-scroll::-webkit-scrollbar-thumb, .apq-sort-scroll::-webkit-scrollbar-thumb{ background: rgba(var(--apq-line),.18); background-clip: padding-box; border-radius: 10px; border: 3px solid transparent; }
.apq-body::-webkit-scrollbar-thumb:hover{ background-color: rgba(var(--apq-line),.3); }
@supports not selector(::-webkit-scrollbar){ .apq-body{ scrollbar-width: thin; scrollbar-color: rgba(var(--apq-line),.2) transparent; } }

/* Group headings: a quiet label, its count, a hairline */
.apq-group{
position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 8px;
padding: 14px 8px 6px; background: rgb(var(--apq-surface));
}
.apq-group-toggle{
display: flex; align-items: center; gap: 7px; cursor: pointer; border-radius: 4px;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink));
}
.apq-group.is-none .apq-group-toggle{ color: rgb(var(--apq-muted)); }
.apq-group-chev{ width: 14px; height: 14px; color: rgb(var(--apq-muted)); transition: transform .18s var(--apq-ease); }
.apq-group.is-collapsed .apq-group-chev{ transform: rotate(-90deg); }
.apq-group-toggle:hover .apq-group-chev{ color: rgb(var(--apq-ink)); }
.apq-group-glyph{ width: 11px; height: 11px; color: rgb(var(--apq-ink)); }
.apq-group-n{ min-width: 20px; padding: 2px 5px 1px; border-radius: 4px; text-align: center; background: rgba(var(--apq-ink),.07); font-size: 11.5px; font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-group-rule{ flex: 1; height: 1px; background: rgba(var(--apq-line),.09); }
.apq-group-time{ font-size: 12px; font-weight: 500; color: rgb(var(--apq-muted)); font-variant-numeric: tabular-nums; white-space: nowrap; cursor: default; }
.apq-group-sel{ padding: 3px 7px; border-radius: 4px; font-size: 12px; font-weight: 500; color: rgb(var(--apq-ink)); cursor: pointer; white-space: nowrap; }
.apq-group-sel:hover{ background: var(--apq-hover); }
.apq-group-pin{ width: 13px; height: 13px; color: rgb(var(--apq-ink)); stroke-width: 2.4; }

/* Rows: cover, title, one line of meta, and on Watching rows the episode track */
.apq-row{
position: relative; display: flex; align-items: center; gap: 10px; padding: 6px 6px; border-radius: 6px;
transition: transform .32s var(--apq-ease), background-color .15s;
}
.apq-row:hover{ background: rgb(var(--apq-raised)); }
html:not([data-apq-panel="dark"]) .apq-row:hover{ background: rgba(var(--apq-ink),.04); }
.apq-row.is-moving{ z-index: 2; }
.apq-row.is-flash{ animation: apq-flash 1.2s ease-out; }
.apq-row-link{ flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; color: inherit; text-decoration: none; border-radius: 4px; }
.apq-cover{
position: relative; width: 38px; height: 54px; flex: none; overflow: hidden; border-radius: 4px; background: rgb(var(--apq-sunken));
}
.apq-cover img{ width: 100%; height: 100%; object-fit: cover; display: block; }
.apq-row-text{ flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.apq-row-title{
font-size: 13.5px; font-weight: 500; line-height: 1.3; color: rgb(var(--apq-ink));
display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.apq-row-link:hover .apq-row-title{ text-decoration: underline; text-decoration-color: rgba(var(--apq-ink),.35); text-underline-offset: 3px; }
.apq-row-meta{ display: flex; gap: 10px; font-size: 12.5px; font-weight: 400; color: rgb(var(--apq-muted)); white-space: nowrap; overflow: hidden; }
.apq-row-meta span{ flex: none; }
.apq-row-meta .apq-new{ color: rgb(var(--apq-ink)); font-weight: 500; }
.apq-row-meta .apq-ep b{ font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-row-text .apq-track{ margin: 2px 0 1px; max-width: 220px; }
.apq-row-warn{ display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 12px; font-weight: 500; color: rgb(var(--apq-warn)); }
.apq-row-warn .apq-ic{ width: 13px; height: 13px; flex: none; stroke-width: 2.4; }
.apq-row-warn span{ min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-row-check{ display: none; }
.apq-drawer.is-selecting .apq-row{ cursor: pointer; user-select: none; }
.apq-drawer.is-selecting .apq-row.is-selected{ background: rgba(var(--apq-ink),.08); }
.apq-drawer.is-selecting .apq-row-link:hover .apq-row-title{ text-decoration: none; }
.apq-drawer.is-selecting .apq-stepper, .apq-drawer.is-selecting .apq-ro, .apq-drawer.is-selecting .apq-rs{ display: none; }
.apq-drawer.is-selecting .apq-row-check{
display: grid; place-items: center; width: 22px; height: 22px; margin-right: 4px; flex: none; border-radius: 50%;
color: transparent; box-shadow: inset 0 0 0 2px rgba(var(--apq-muted),.55); transition: background-color .15s, box-shadow .15s, color .15s;
}
.apq-drawer.is-selecting .apq-row-check .apq-ic{ width: 13px; height: 13px; stroke-width: 3.2; }
.apq-drawer.is-selecting .apq-row:hover .apq-row-check{ box-shadow: inset 0 0 0 2px rgb(var(--apq-ink)); }
.apq-drawer.is-selecting .apq-row.is-selected .apq-row-check{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); box-shadow: none; }
.apq-row .apq-next{ margin-right: 2px; }
.apq-row-pin{
width: 28px; height: 28px; flex: none; border-radius: 6px; display: grid; place-items: center; cursor: pointer; margin-right: -6px;
color: rgb(var(--apq-muted)); opacity: 0; transition: opacity .15s, background-color .12s, color .12s;
}
.apq-row:hover .apq-row-pin, .apq-row-pin:focus-visible{ opacity: 1; }
.apq-row-pin:hover{ background: var(--apq-hover); color: rgb(var(--apq-ink)); }
.apq-row-pin .apq-ic{ width: 15px; height: 15px; }
.apq-drawer.is-selecting .apq-row-pin, .apq-drawer.is-selecting .apq-pinctl, .apq-drawer.is-selecting .apq-next{ display: none; }
@media (hover: none){ .apq-row-pin{ opacity: .55; } }
.apq-pinctl .apq-step.is-unpin:hover:not(:disabled){ color: rgb(var(--apq-bad)); }
.apq-rank{
position: absolute; left: 3px; top: 3px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px; display: grid; place-items: center;
background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); font-size: 10.5px; font-weight: 500;
}
/* Priority stepper in a Night well */
.apq-stepper{ flex: none; display: inline-flex; align-items: center; height: 30px; padding: 2px; border-radius: 6px; background: rgb(var(--apq-sunken)); }
.apq-step{
width: 26px; height: 26px; border-radius: 4px; display: grid; place-items: center; color: rgb(var(--apq-muted)); cursor: pointer;
transition: background-color .12s, color .12s;
}
.apq-step .apq-ic{ width: 14px; height: 14px; stroke-width: 2.5; }
.apq-step:hover:not(:disabled){ background: rgba(var(--apq-ink),.1); color: rgb(var(--apq-ink)); }
.apq-step:active:not(:disabled){ transform: scale(.92); }
.apq-step:disabled{ opacity: .3; cursor: default; }
.apq-step-val, .apq-step-input{
min-width: 28px; height: 26px; padding: 0 3px; border-radius: 4px; display: grid; place-items: center; text-align: center;
font-size: 13.5px; font-weight: 500; color: rgb(var(--apq-muted)); cursor: text;
}
.apq-step-val.has-value{ color: rgb(var(--apq-ink)); }
.apq-step-val.is-none::before, .apq-ro.is-none::before{ content: ""; width: 4px; height: 4px; border-radius: 50%; background: rgba(var(--apq-muted),.7); }
.apq-step-input{ width: 30px; background: rgb(var(--apq-surface)); color: rgb(var(--apq-ink)); box-shadow: inset 0 0 0 1.5px rgb(var(--apq-acc)); }
.apq-step-input:focus-visible{ outline: none; }
.apq-ro{
flex: none; min-width: 32px; height: 24px; padding: 0 8px; border-radius: 4px; display: grid; place-items: center;
font-size: 13px; font-weight: 500; color: rgb(var(--apq-muted)); background: rgb(var(--apq-sunken));
}
.apq-ro.has-value{ color: rgb(var(--apq-ink)); }
.apq-rs{ width: 16px; height: 16px; flex: none; display: grid; place-items: center; margin-left: -4px; color: rgb(var(--apq-muted)); }
.apq-rs .apq-ic{ width: 15px; height: 15px; stroke-width: 2.6; }
.apq-rs .apq-spin{ width: 12px; height: 12px; }
.apq-rs.is-saved{ color: rgb(var(--apq-good)); }
.apq-rs.is-error{ color: rgb(var(--apq-bad)); }
.apq-rs > *{ animation: apq-pop-in .18s var(--apq-ease); }

.apq-skel-wrap{ padding-top: 14px; }
.apq-skel{ display: flex; align-items: center; gap: 12px; padding: 6px; }
.apq-skel i{ display: block; border-radius: 4px; background: rgba(var(--apq-ink),.07); }
.apq-skel-cover{ width: 38px; height: 54px; flex: none; }
.apq-skel-lines{ flex: 1; display: flex; flex-direction: column; gap: 8px; }
.apq-skel-lines i{ height: 10px; }
.apq-skel-step{ width: 88px; height: 30px; flex: none; border-radius: 6px !important; }

.apq-df{
display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px;
border-top: 1px solid rgba(var(--apq-line),.07); font-size: 12px; color: rgb(var(--apq-muted));
}
.apq-hint{ display: flex; align-items: center; gap: 8px; min-width: 0; white-space: nowrap; overflow: hidden; }
.apq-hint span:last-child{ overflow: hidden; text-overflow: ellipsis; }

/* Settings */
.apq-settings{ padding: 2px 8px 16px; }
.apq-back{
display: inline-flex; align-items: center; gap: 6px; margin: 12px 0 2px; padding: 6px 8px; border-radius: 6px; cursor: pointer;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink));
}
.apq-back:hover{ background: var(--apq-hover); }
.apq-back .apq-ic{ width: 15px; height: 15px; }
.apq-set-sec{ padding: 16px 0 14px; border-bottom: 1px solid rgba(var(--apq-line),.07); }
.apq-set-sec:last-child{ border-bottom: 0; }
.apq-set-h{ margin: 0 0 10px; font-size: 13.5px; font-weight: 500; color: rgb(var(--apq-ink)); letter-spacing: 0; }
.apq-set-field{ display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 8px; }
.apq-set-label{ font-size: 13px; font-weight: 500; color: rgb(var(--apq-text)); }
.apq-set-field .apq-seg{ flex: 0 1 260px; }
.apq-set-note{ margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: rgb(var(--apq-muted)); }
.apq-set-row{ display: flex; align-items: center; gap: 14px; width: 100%; padding: 9px 0; cursor: pointer; text-align: left; border-radius: 6px; }
.apq-set-text{ flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.apq-set-title{ font-size: 13.5px; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-set-desc{ font-size: 12px; line-height: 1.45; color: rgb(var(--apq-muted)); }
.apq-set-action{
display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; border-radius: 6px; cursor: pointer;
background: rgba(var(--apq-ink),.07); font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink));
}
.apq-set-action:hover{ background: rgba(var(--apq-ink),.12); }
.apq-set-action .apq-ic{ width: 15px; height: 15px; color: rgb(var(--apq-muted)); }
.apq-set-action:disabled{ cursor: default; opacity: .7; }
.apq-set-action .apq-spin{ width: 13px; height: 13px; color: rgb(var(--apq-muted)); }
.apq-set-row.is-sub{ width: calc(100% - 22px); margin-left: 22px; padding-top: 5px; }
.apq-set-row:disabled{ cursor: default; }
.apq-set-row:disabled .apq-switch{ opacity: .45; }
.apq-set-action.is-primary{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
.apq-set-action.is-primary:hover{ background: rgba(var(--apq-ink),.86); }
.apq-set-action.is-primary .apq-ic{ color: inherit; }
.apq-set-lead{ margin: 0 0 12px; }
.apq-acct{ display: flex; align-items: center; gap: 12px; }
.apq-acct-av{ width: 38px; height: 38px; flex: none; border-radius: 6px; object-fit: cover; background: rgb(var(--apq-sunken)); }
.apq-swatches{ display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.apq-swatch{
position: relative; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; flex: none;
background: rgb(var(--apq-sw)); box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); transition: transform .15s var(--apq-ease);
}
.apq-swatch:hover{ transform: scale(1.08); }
.apq-swatch.is-active{ box-shadow: 0 0 0 2px rgb(var(--apq-surface)), 0 0 0 4px rgb(var(--apq-ink)); }
.apq-swatch.is-auto{
width: auto; height: 28px; padding: 0 11px 0 5px; border-radius: 6px; display: inline-flex; align-items: center; gap: 7px;
background: rgba(var(--apq-ink),.07); font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink));
}
.apq-swatch.is-auto:hover{ transform: none; background: rgba(var(--apq-ink),.12); }
.apq-swatch.is-auto i{ width: 18px; height: 18px; border-radius: 50%; background: rgb(var(--apq-sw)); }
.apq-swatch.is-auto.is-active{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); box-shadow: none; }
/* Palettes (0.12): each a tiny disc in its own panel color, with its text color and your accent as two dots */
/* AniList's, then two rows of six */
.apq-swatches.is-pal{ display: grid; grid-template-columns: auto repeat(6, 24px); justify-content: start; }
.apq-swatches.is-pal .apq-pswatch:nth-child(8){ grid-column: 2; }
.apq-pswatch{ background: rgb(var(--apq-sw)); box-shadow: inset 0 0 0 1px rgba(var(--apq-line),.22); display: flex; align-items: center; justify-content: center; gap: 2px; }
.apq-pswatch::before, .apq-pswatch::after{ content: ""; width: 5px; height: 5px; border-radius: 50%; background: rgb(var(--apq-sw-ink)); }
.apq-pswatch::after{ background: rgb(var(--apq-sw-acc)); }
.apq-keys{ display: grid; grid-template-columns: auto 1fr; gap: 9px 12px; align-items: center; font-size: 12.5px; line-height: 1.35; color: rgb(var(--apq-text)); }
.apq-keys .apq-kbd{ justify-self: start; }

/* Your own order inside a priority: a grip on hover (drag it), and "Your order" on the group (order.js) */
.apq-row-grip{
position: absolute; left: -8px; top: 50%; width: 14px; height: 34px; margin-top: -17px; border-radius: 4px; display: none; place-items: center;
color: rgb(var(--apq-muted)); cursor: grab; opacity: 0; transition: opacity .15s, color .15s; touch-action: none;
}
.apq-row.can-order .apq-row-grip{ display: grid; }
.apq-row-grip .apq-ic{ width: 14px; height: 14px; }
.apq-row.can-order:hover .apq-row-grip{ opacity: .75; }
.apq-row.can-order .apq-row-grip:hover{ opacity: 1; color: rgb(var(--apq-ink)); }
.apq-group-ord{ display: inline-flex; align-items: center; gap: 4px; color: rgb(var(--apq-muted)); font-weight: 500; }
.apq-group-ord:hover{ color: rgb(var(--apq-ink)); }
.apq-group-ord .apq-ic{ width: 12px; height: 12px; stroke-width: 2.6; }
.apq-drawer[data-apq-reorder] .apq-row{ transition: transform .18s var(--apq-ease), opacity .15s; }
.apq-drawer[data-apq-reorder="on"] .apq-row:not([data-apq-peer]), .apq-drawer[data-apq-reorder="on"] .apq-group{ opacity: .4; }
.apq-drawer[data-apq-reorder="on"] .apq-row-grip{ opacity: 0 !important; }
.apq-drawer .apq-row[data-apq-drag]{ z-index: 5; transition: none; background: rgb(var(--apq-raised)); box-shadow: var(--apq-shadow), 0 0 0 1px rgba(var(--apq-line),.08); }
.apq-drawer .apq-row[data-apq-drag="land"]{ transition: transform .18s var(--apq-ease); }
.apq-drawer[data-apq-reorder="settle"] .apq-row:not([data-apq-drag]){ transition: none; }

/* List check (health.js): three lines, each says how many; one unfolds at a time */
.apq-hc{ padding: 0 8px 16px; }
.apq-hc-intro{ margin: 14px 0 4px; font-size: 12.5px; line-height: 1.5; color: rgb(var(--apq-muted)); }
.apq-hc-group{ border-bottom: 1px solid rgba(var(--apq-line),.07); }
.apq-hc-line{ display: flex; align-items: center; gap: 10px; width: 100%; height: 50px; border-radius: 6px; cursor: pointer; text-align: left; }
.apq-hc-line:disabled{ cursor: default; }
.apq-hc-label{ flex: 1; min-width: 0; font-size: 13.5px; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-hc-val{ display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 400; color: rgb(var(--apq-muted)); white-space: nowrap; }
.apq-hc-val.is-set{ font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-hc-val .apq-ic{ width: 13px; height: 13px; stroke-width: 2.8; color: rgb(var(--apq-good)); }
.apq-hc-chev{ width: 14px; height: 14px; color: rgb(var(--apq-muted)); transform: rotate(-90deg); transition: transform .18s var(--apq-ease); }
.apq-hc-group.is-open .apq-hc-chev{ transform: none; }
.apq-hc-line:hover:not(:disabled) .apq-hc-chev{ color: rgb(var(--apq-ink)); }
.apq-hc-body{ padding: 0 0 14px; }
.apq-hc-lead{ margin: 0 0 12px; max-width: 52ch; font-size: 12.5px; line-height: 1.5; color: rgb(var(--apq-muted)); }
.apq-hc-bar{ display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.apq-hc-prog{ display: inline-flex; align-items: center; gap: 8px; min-height: 28px; font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-text)); }
.apq-hc-prog .apq-spin{ color: rgb(var(--apq-muted)); }
.apq-hc-btn{
flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 6px; cursor: pointer; white-space: nowrap;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink)); background: rgba(var(--apq-ink),.07); transition: background-color .12s;
}
.apq-hc-btn:hover:not(:disabled){ background: rgba(var(--apq-ink),.12); }
.apq-hc-btn.is-primary{ color: rgb(var(--apq-on-ink)); background: rgb(var(--apq-ink)); }
.apq-hc-btn.is-primary:hover:not(:disabled){ background: rgba(var(--apq-ink),.86); }
.apq-hc-btn:disabled{ opacity: .5; cursor: default; }
.apq-hc-btn .apq-ic{ width: 14px; height: 14px; }
.apq-hc-items{ display: flex; flex-direction: column; gap: 2px; margin: 0 -6px; }
.apq-hc-item{ display: flex; align-items: center; gap: 12px; padding: 6px; border-radius: 6px; transition: background-color .15s; }
.apq-hc-item:hover{ background: rgb(var(--apq-raised)); }
html:not([data-apq-panel="dark"]) .apq-hc-item:hover{ background: rgba(var(--apq-ink),.04); }
.apq-hc-title{ font-size: 13.5px; font-weight: 500; line-height: 1.3; color: rgb(var(--apq-ink)); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-hc-title:hover{ text-decoration: underline; text-decoration-color: rgba(var(--apq-ink),.35); text-underline-offset: 3px; }
.apq-hc-sub{ display: flex; flex-wrap: wrap; gap: 0 10px; font-size: 12.5px; line-height: 1.4; color: rgb(var(--apq-muted)); }
.apq-hc-sub b{ font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-hc-acts{ flex: none; display: flex; align-items: center; gap: 6px; }
.apq-hc-x{ width: 26px; height: 26px; margin-left: -2px; border-radius: 6px; display: grid; place-items: center; color: rgb(var(--apq-muted)); cursor: pointer; opacity: .55; transition: opacity .15s, background-color .12s, color .12s; }
.apq-hc-item:hover .apq-hc-x, .apq-hc-x:focus-visible{ opacity: 1; }
.apq-hc-x:hover{ background: var(--apq-hover); color: rgb(var(--apq-ink)); }
.apq-hc-x .apq-ic{ width: 14px; height: 14px; }
.apq-hc-more{ margin-top: 6px; height: 30px; padding: 0 8px; border-radius: 6px; font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); cursor: pointer; }
.apq-hc-more:hover{ color: rgb(var(--apq-ink)); background: var(--apq-hover); }
.apq-hc-foot{ margin: 14px 0 0; font-size: 12px; line-height: 1.5; color: rgb(var(--apq-muted)); }
.apq-hc-link{ font-weight: 500; color: rgb(var(--apq-ink)); cursor: pointer; border-radius: 4px; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(var(--apq-ink),.35); }
.apq-hc-link:hover{ text-decoration-color: currentColor; }

/* ---------------- The title popover ---------------- */
.apq-pop{
position: fixed; z-index: 9998; width: 288px; padding: 0 14px 12px; border-radius: 10px; overflow: hidden;
background: rgb(var(--apq-surface)); color: rgb(var(--apq-text));
box-shadow: var(--apq-shadow), 0 0 0 1px rgba(var(--apq-line),.09);
opacity: 0; transform: translateY(-4px); transform-origin: top left;
transition: opacity .15s var(--apq-ease), transform .18s var(--apq-ease);
}
.apq-pop.is-above{ transform-origin: bottom left; transform: translateY(4px); }
.apq-pop.is-open{ opacity: 1; transform: none; }
.apq-pop-head{
display: flex; align-items: center; gap: 11px; margin: 0 -14px; padding: 12px 10px 12px 12px;
background: color-mix(in srgb, rgb(var(--apq-title)) 14%, rgb(var(--apq-surface)));
}
.apq-pop-cover{ width: 34px; height: 48px; flex: none; overflow: hidden; border-radius: 4px; background: rgb(var(--apq-title)); }
.apq-pop-cover img{ width: 100%; height: 100%; object-fit: cover; display: block; }
.apq-pop-htext{ flex: 1; min-width: 0; }
.apq-pop-title{
font-size: 13.5px; font-weight: 500; line-height: 1.3; color: rgb(var(--apq-ink));
display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.apq-pop-sub{ margin-top: 2px; font-size: 12px; font-weight: 500; color: rgb(var(--apq-muted)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-pop-pin{
width: 30px; height: 30px; flex: none; align-self: flex-start; border-radius: 6px; display: grid; place-items: center; cursor: pointer;
color: rgb(var(--apq-muted)); transition: background-color .15s, color .15s;
}
.apq-pop-pin:hover{ background: rgba(var(--apq-ink),.08); color: rgb(var(--apq-ink)); }
.apq-pop-pin[aria-pressed="true"], .apq-pop-pin[aria-pressed="true"]:hover{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
.apq-pop-pin .apq-ic{ width: 16px; height: 16px; }
.apq-pop-pin:disabled{ opacity: .5; cursor: default; }
.apq-pop-sec{ margin-top: 12px; }
.apq-pop-track{ margin-top: 12px; display: flex; flex-direction: column; gap: 7px; }
.apq-pop-track .apq-track-label{ justify-content: space-between; }
.apq-pop-track .apq-track-ep{ font-size: 13.5px; }
.apq-pop-track .apq-track-ep b{ font-size: 15px; }
.apq-pop-track .apq-track{ height: 5px; }
.apq-pop-new{ font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-pop-stepper{ display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding: 3px; border-radius: 6px; background: rgb(var(--apq-sunken)); }
.apq-pop-step{
width: 38px; height: 36px; border-radius: 4px; display: grid; place-items: center; color: rgb(var(--apq-ink)); cursor: pointer;
transition: background-color .12s;
}
.apq-pop-step .apq-ic{ width: 17px; height: 17px; stroke-width: 2.4; }
.apq-pop-step:hover:not(:disabled){ background: rgba(var(--apq-ink),.09); }
.apq-pop-step:active:not(:disabled){ transform: scale(.94); }
.apq-pop-step:disabled{ opacity: .3; cursor: default; }
.apq-pop-val{ font-size: 20px; font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-pop-val.has-value{ color: rgb(var(--apq-ink)); }
.apq-pop-val.is-none{ display: grid; place-items: center; min-height: 28px; }
.apq-pop-val.is-none::before{ content: ""; width: 6px; height: 6px; border-radius: 50%; background: rgba(var(--apq-muted),.7); }
.apq-pop-val.is-pin{ display: grid; place-items: center; min-height: 28px; color: rgb(var(--apq-ink)); }
.apq-pop-val.is-pin .apq-ic{ width: 20px; height: 20px; animation: apq-pop-in .15s var(--apq-ease); }
.apq-chips{ display: grid; grid-template-columns: 1.6fr repeat(5, 1fr); gap: 3px; margin-top: 6px; }
.apq-pop-warn{
display: flex; align-items: flex-start; gap: 7px; margin-top: 10px; padding: 8px 10px; border-radius: 6px;
background: rgba(var(--apq-warn),.12); color: rgb(var(--apq-warn)); font-size: 12.5px; font-weight: 500; line-height: 1.35;
}
.apq-pop-warn .apq-ic{ width: 14px; height: 14px; margin-top: 1px; stroke-width: 2.4; }
.apq-pop-act{
display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; height: 36px; margin-top: 12px;
border-radius: 6px; cursor: pointer; background: rgb(var(--apq-title)); color: rgb(var(--apq-on-title));
font-size: 13px; font-weight: 500; transition: filter .15s, transform .1s;
}
.apq-pop-act:hover:not(:disabled){ filter: brightness(1.08); }
.apq-pop-act:active:not(:disabled){ transform: scale(.985); }
.apq-pop-act:disabled{ opacity: .6; cursor: default; }
.apq-act-ic{ display: grid; place-items: center; }
.apq-act-ic .apq-ic{ width: 14px; height: 14px; stroke-width: 2.6; }
.apq-act-ic .apq-spin{ width: 12px; height: 12px; }
.apq-pop-foot{
display: flex; align-items: center; gap: 7px; min-height: 28px; margin-top: 12px; padding-top: 10px;
border-top: 1px solid rgba(var(--apq-line),.08); font-size: 12px; color: rgb(var(--apq-muted));
}
.apq-pop-foot .apq-ic{ width: 14px; height: 14px; stroke-width: 2.6; }
.apq-pop-foot .apq-spin{ width: 11px; height: 11px; }
.apq-pop-foot.is-saved{ color: rgb(var(--apq-good)); }
.apq-pop-foot.is-error{ color: rgb(var(--apq-bad)); }
.apq-pop-score, .apq-pop-lists, .apq-pop-hist{ margin-top: 14px; }
.apq-pop-score[hidden], .apq-pop-lists[hidden], .apq-pop-hist[hidden]{ display: none; }
.apq-pop-label{ margin-bottom: 6px; font-size: 12px; font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-clists{ display: flex; flex-wrap: wrap; gap: 4px; }
.apq-clist{
display: inline-flex; align-items: center; gap: 5px; max-width: 100%; height: 28px; padding: 0 10px 0 8px; border-radius: 6px; cursor: pointer;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-text)); background: rgba(var(--apq-ink),.06); transition: background-color .12s, color .12s;
}
.apq-clist span{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-clist .apq-ic{ width: 12px; height: 12px; stroke-width: 2.8; opacity: .6; }
.apq-clist:hover:not(:disabled){ background: rgba(var(--apq-ink),.11); color: rgb(var(--apq-ink)); }
.apq-clist.is-on, .apq-clist.is-on:hover:not(:disabled){ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
.apq-clist.is-on .apq-ic{ opacity: 1; }
.apq-clist:disabled{ opacity: .6; cursor: default; }

/* Scores */
.apq-score{ display: flex; gap: 6px; align-items: center; }
.apq-score-btns{ flex: 1; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; padding: 2px; border-radius: 6px; background: rgb(var(--apq-sunken)); }
.apq-score-btn{
height: 26px; min-width: 0; border-radius: 4px; display: grid; place-items: center; cursor: pointer;
font-size: 12px; font-weight: 500; color: rgb(var(--apq-text));
transition: background-color .12s, color .12s;
}
.apq-score-btn:hover:not(:disabled){ background: rgba(var(--apq-ink),.1); color: rgb(var(--apq-ink)); }
.apq-score-btn.is-active, .apq-score-btn.is-active:hover:not(:disabled){ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
.apq-score-btn:disabled{ cursor: default; opacity: .6; }
.apq-score-btn .apq-ic{ width: 15px; height: 15px; }
.apq-score.is-point-5 .apq-score-btns{ background: none; padding: 0; }
.apq-score.is-point-5 .apq-score-btn{ background: none; color: rgba(var(--apq-muted),.7); }
.apq-score.is-point-5 .apq-score-btn.is-active, .apq-score.is-point-5 .apq-score-btn.is-active:hover:not(:disabled){ background: none; color: rgb(var(--apq-ink)); }
.apq-score.is-point-5 .apq-score-btn.is-active .apq-ic{ fill: currentColor; }
.apq-score.is-point-5 .apq-score-btn:hover:not(:disabled){ background: var(--apq-hover); color: rgb(var(--apq-ink)); }
.apq-score.is-point-3 .apq-score-btn{ height: 30px; }
.apq-score.is-point-3 .apq-score-btn .apq-ic{ width: 18px; height: 18px; }
.apq-score.is-point-100 .apq-score-btn{ font-size: 10.5px; }
.apq-score-input{
width: 48px; height: 30px; flex: none; padding: 0 6px; border-radius: 6px; border: 0; outline: none; text-align: center;
font: inherit; font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink)); background: rgb(var(--apq-sunken)); -moz-appearance: textfield;
}
.apq-score-input::-webkit-inner-spin-button, .apq-score-input::-webkit-outer-spin-button{ -webkit-appearance: none; margin: 0; }
.apq-score-input:focus{ box-shadow: 0 0 0 2px rgb(var(--apq-acc)); }
.apq-score-input:focus-visible{ outline: none; }
/* The hub's +1 on Watching rows */
.apq-next[hidden]{ display: none; }

/* ---------------- Pick for me ---------------- */
.apq-pick-scrim{
position: fixed; inset: 0; z-index: 9997; background: rgba(8,12,20,.42); opacity: 0; pointer-events: none;
transition: opacity .22s var(--apq-ease);
}
html[data-apq-theme="dark"] .apq-pick-scrim{ background: rgba(0,0,0,.6); }
.apq-pick-scrim.is-open{ opacity: 1; pointer-events: auto; }
.apq-pick{
position: fixed; inset: 0; margin: auto; z-index: 9998; width: min(400px, calc(100vw - 24px)); height: fit-content; max-height: calc(100vh - 24px);
overflow: hidden; border-radius: 14px; color: rgb(var(--apq-text));
background: color-mix(in srgb, rgb(var(--apq-title)) 14%, rgb(var(--apq-surface)));
box-shadow: var(--apq-shadow), 0 0 0 1px rgba(var(--apq-line),.08);
opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(12px) scale(.98);
transition: opacity .2s var(--apq-ease), transform .22s var(--apq-ease), visibility 0s linear .22s, background-color .35s ease;
}
.apq-pick.is-open{
opacity: 1; visibility: visible; pointer-events: auto; transform: none;
transition: opacity .2s var(--apq-ease), transform .22s var(--apq-ease), visibility 0s, background-color .35s ease;
}
.apq-pick.is-rolling{ background: rgb(var(--apq-surface)); }
.apq-pick-head{ display: flex; align-items: center; gap: 10px; padding: 16px 12px 4px 20px; }
.apq-pick-hgroup{ flex: 1; min-width: 0; }
.apq-pick-h{ font-size: 15px; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-pick-sub{ margin-top: 2px; font-size: 12.5px; color: rgb(var(--apq-muted)); }
.apq-pick-filters{ display: flex; flex-direction: column; gap: 8px; padding: 10px 20px 0; }
.apq-pick-seg{ background: rgba(var(--apq-sunken),.8); }
.apq-pick-toggles{ display: flex; gap: 6px; flex-wrap: wrap; }
.apq-pick-stage{ display: flex; flex-direction: column; align-items: center; text-align: center; padding: 22px 24px 4px; }
.apq-pick-cover{
width: 150px; aspect-ratio: 230 / 325; border-radius: 6px; overflow: hidden; background: rgb(var(--apq-sunken));
box-shadow: 0 16px 36px -16px rgba(0,0,0,.55);
}
.apq-pick-cover img{ width: 100%; height: 100%; object-fit: cover; display: block; }
.apq-pick.is-rolling .apq-pick-cover img{ filter: saturate(.85); }
.apq-pick.is-landed .apq-pick-cover{ animation: apq-land .5s var(--apq-ease); }
.apq-pick-namebox{ display: flex; align-items: center; justify-content: center; width: 100%; min-height: 72px; margin-top: 16px; }
.apq-pick-name{
font-size: 28px; font-weight: 500; line-height: 1.12; letter-spacing: -.015em; color: rgb(var(--apq-ink)); text-wrap: balance;
display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.apq-pick.is-rolling .apq-pick-name{ opacity: .45; }
.apq-pick-meta{ display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 8px; min-height: 18px; font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-pick-meta span:first-child{ color: rgb(var(--apq-ink)); }
.apq-pick.is-rolling .apq-pick-meta, .apq-pick.is-rolling .apq-pick-tags{ visibility: hidden; }
.apq-pick-tags{ display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 12px; min-height: 26px; }
.apq-pill{ display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 6px; font-size: 12.5px; font-weight: 500; max-width: 100%; }
.apq-pill .apq-glyph{ width: 11px; height: 11px; }
.apq-pill .apq-ic{ width: 13px; height: 13px; stroke-width: 2.4; }
.apq-pill.is-prio{ color: rgb(var(--apq-ink)); background: rgba(var(--apq-ink),.08); }
.apq-pill.is-none{ color: rgb(var(--apq-muted)); background: rgba(var(--apq-ink),.06); font-weight: 500; }
.apq-pill.is-warn{ color: rgb(var(--apq-warn)); background: rgba(var(--apq-warn),.14); }
.apq-pick-empty{ padding: 40px 28px 20px; }
.apq-pick-actions{ display: flex; gap: 8px; padding: 20px 16px 16px; }
.apq-pick.is-empty .apq-pick-actions .apq-pick-again{ flex: 1; }
.apq-pick-go, .apq-pick-again{
flex: 1; height: 42px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
font-size: 13.5px; font-weight: 500; white-space: nowrap; transition: background-color .15s, filter .15s, transform .1s;
}
.apq-pick-go{ background: rgb(var(--apq-title)); color: rgb(var(--apq-on-title)); }
.apq-pick-go:hover{ filter: brightness(1.08); }
.apq-pick-go .apq-ic{ width: 15px; height: 15px; }
.apq-pick-again{ background: rgba(var(--apq-ink),.08); color: rgb(var(--apq-ink)); }
.apq-pick-again:hover{ background: rgba(var(--apq-ink),.13); }
.apq-pick-again .apq-ic{ width: 17px; height: 17px; }
.apq-pick-go:active, .apq-pick-again:active{ transform: scale(.98); }
.apq-pick-open{
width: 42px; height: 42px; flex: none; border-radius: 6px; display: grid; place-items: center; cursor: pointer;
background: rgba(var(--apq-ink),.08); color: rgb(var(--apq-ink)); text-decoration: none;
}
.apq-pick-open:hover{ background: rgba(var(--apq-ink),.13); }
.apq-pick-open .apq-ic{ width: 17px; height: 17px; }
.apq-pick.is-rolling .apq-pick-actions{ pointer-events: none; }
.apq-pick.is-rolling .apq-pick-go, .apq-pick.is-rolling .apq-pick-open{ opacity: .55; }
.apq-pick-go:disabled{ opacity: .6; cursor: default; }

/* ---------------- Mass edit ---------------- */
.apq-mass-scrim{
position: fixed; inset: 0; z-index: 9997; background: rgba(8,12,20,.42); opacity: 0; pointer-events: none;
transition: opacity .2s var(--apq-ease);
}
html[data-apq-theme="dark"] .apq-mass-scrim{ background: rgba(0,0,0,.6); }
.apq-mass-scrim.is-open{ opacity: 1; pointer-events: auto; }
.apq-mass{
position: fixed; inset: 0; margin: auto; z-index: 9998; width: min(760px, calc(100vw - 24px)); height: fit-content; max-height: calc(100vh - 32px);
display: flex; flex-direction: column; overflow: hidden; outline: none; border-radius: 14px;
background: rgb(var(--apq-surface)); color: rgb(var(--apq-text)); box-shadow: var(--apq-shadow), 0 0 0 1px rgba(var(--apq-line),.08);
opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(12px) scale(.985);
transition: opacity .2s var(--apq-ease), transform .22s var(--apq-ease), visibility 0s linear .22s;
}
html[data-apq-panel="dark"] .apq-mass{ color-scheme: dark; }
.apq-mass.is-open{ opacity: 1; visibility: visible; pointer-events: auto; transform: none; transition: opacity .2s var(--apq-ease), transform .22s var(--apq-ease), visibility 0s; }
.apq-mass.is-preview{ width: min(620px, calc(100vw - 24px)); }
.apq-mass-head{ display: flex; align-items: center; gap: 14px; padding: 16px 12px 14px 20px; border-bottom: 1px solid rgba(var(--apq-line),.07); }
.apq-mass-head .apq-icon-btn{ align-self: flex-start; }
/* The selection's own covers, overlapping, each ringed in the panel's color */
.apq-mass-covers{ flex: none; display: flex; padding-left: 9px; }
.apq-mass-covers:empty{ display: none; }
.apq-mass-cv{ width: 28px; height: 40px; margin-left: -9px; flex: none; overflow: hidden; border-radius: 4px; background: rgb(var(--apq-sunken)); box-shadow: 0 0 0 2px rgb(var(--apq-surface)); }
.apq-mass-cv img{ width: 100%; height: 100%; object-fit: cover; display: block; }
.apq-mass-cv.is-more{ display: grid; place-items: center; font-size: 11.5px; font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-mass-hgroup{ flex: 1; min-width: 0; }
.apq-mass-h{ font-size: 15px; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-mass-sub{ margin-top: 2px; font-size: 12.5px; color: rgb(var(--apq-muted)); }
.apq-mass-body{ flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 20px 16px; }
.apq-mass-foot{ display: flex; align-items: center; gap: 8px; padding: 12px 14px 14px 20px; border-top: 1px solid rgba(var(--apq-line),.07); }
.apq-mass-note{ flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-mass-note.is-saving{ color: rgb(var(--apq-ink)); }
.apq-mass-note .apq-spin{ color: rgb(var(--apq-muted)); }
.apq-mass-grow{ flex: 1; }
.apq-mbtn{
height: 36px; padding: 0 14px; border-radius: 6px; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; flex: none; white-space: nowrap;
background: rgba(var(--apq-ink),.07); color: rgb(var(--apq-ink)); font-size: 13px; font-weight: 500; transition: background-color .15s;
}
.apq-mbtn:hover{ background: rgba(var(--apq-ink),.12); }
.apq-mbtn .apq-ic{ width: 15px; height: 15px; stroke-width: 2.4; }
.apq-mbtn.is-primary{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
.apq-mbtn.is-primary:hover{ background: rgba(var(--apq-ink),.86); }
.apq-mbtn.is-danger{ background: rgb(var(--apq-bad)); color: #fff; }
.apq-mbtn.is-danger:hover{ background: rgba(var(--apq-bad),.88); }
.apq-mbtn:disabled{ opacity: .4; cursor: default; pointer-events: none; }

/* 0.12.2: each field is one box that says Keep until you pick; its menu opens under it. */
.apq-mass-body{ container-type: inline-size; }
.apq-mass-fields{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 20px; align-items: start; padding: 4px 0 20px; }
@container (max-width: 480px){ .apq-mass-fields{ grid-template-columns: minmax(0, 1fr); gap: 14px; } }
.apq-mf{ min-width: 0; }
.apq-mf-label{ margin-bottom: 6px; font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); transition: color .15s; }
.apq-mf.is-picked .apq-mf-label{ color: rgb(var(--apq-ink)); }
.apq-mf-ctl{ display: flex; align-items: center; gap: 8px; min-width: 0; }
.apq-mbox{
flex: 1; min-width: 0; height: 36px; padding: 0 10px 0 12px; border-radius: 6px; display: flex; align-items: center; gap: 8px; cursor: pointer;
font-size: 13.5px; font-weight: 400; color: rgb(var(--apq-muted)); background: rgb(var(--apq-sunken)); transition: box-shadow .15s, color .15s;
}
.apq-mbox:hover{ color: rgb(var(--apq-text)); box-shadow: inset 0 0 0 1px rgba(var(--apq-ink),.16); }
.apq-mbox-v{ flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-mbox-ch{ width: 14px; height: 14px; stroke-width: 2.4; opacity: .7; transition: transform .18s var(--apq-ease); }
.apq-mbox[aria-expanded="true"] .apq-mbox-ch{ transform: rotate(180deg); }
.apq-mbox[aria-expanded="true"]{ box-shadow: inset 0 0 0 1px rgba(var(--apq-ink),.3); }
/* A picked field: its value in Ink, ringed in Ink (Keep is the plain well) */
.apq-mbox.is-picked, .apq-mbox.is-picked:hover{ color: rgb(var(--apq-ink)); font-weight: 500; box-shadow: inset 0 0 0 1.5px rgb(var(--apq-ink)); }
.apq-minput{
height: 36px; width: 100%; padding: 0 10px; border-radius: 6px; font: inherit; font-size: 13.5px; font-weight: 500;
color: rgb(var(--apq-ink)); background: rgb(var(--apq-sunken)); transition: box-shadow .15s;
}
.apq-minput:focus{ box-shadow: 0 0 0 2px rgb(var(--apq-acc)); }
.apq-minput:focus-visible{ outline: none; }
.apq-minput.is-num{ flex: none; width: 76px; text-align: right; font-variant-numeric: tabular-nums; -moz-appearance: textfield; }
.apq-minput.is-num::-webkit-inner-spin-button, .apq-minput.is-num::-webkit-outer-spin-button{ -webkit-appearance: none; margin: 0; }
.apq-minput.is-date{ flex: none; width: 150px; }
.apq-minput.is-notes{ display: block; height: auto; min-height: 76px; margin-top: 8px; padding: 9px 12px; line-height: 1.45; white-space: pre-wrap; resize: vertical; font-weight: 400; }
.apq-minput::placeholder{ color: rgb(var(--apq-muted)); opacity: 1; font-weight: 400; }
/* The score: the number, then your format's "/ 10" in the same well */
.apq-mnum{ flex: none; display: flex; align-items: center; height: 36px; padding-right: 11px; border-radius: 6px; background: rgb(var(--apq-sunken)); cursor: text; transition: box-shadow .15s; }
.apq-mnum:focus-within{ box-shadow: 0 0 0 2px rgb(var(--apq-acc)); }
.apq-mnum .apq-minput.is-num{ width: 52px; padding: 0 4px 0 10px; background: transparent; box-shadow: none; }
.apq-mnum-of{ display: flex; align-items: center; gap: 4px; font-size: 13px; color: rgb(var(--apq-muted)); white-space: nowrap; }
.apq-mnum-of .apq-ic{ width: 14px; height: 14px; }
.apq-mnum-of.is-empty .apq-ic{ opacity: .45; }
/* "Fill empty dates with today", under Status */
.apq-mcheck{ margin-top: 9px; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; border-radius: 4px; font-size: 12.5px; color: rgb(var(--apq-text)); }
.apq-mcheck-box{ width: 16px; height: 16px; flex: none; display: grid; place-items: center; border-radius: 4px; box-shadow: inset 0 0 0 1.5px rgba(var(--apq-ink),.45); color: rgb(var(--apq-on-ink)); transition: background-color .12s, box-shadow .12s; }
.apq-mcheck-box .apq-ic{ width: 11px; height: 11px; stroke-width: 3.2; opacity: 0; }
.apq-mcheck[aria-pressed="true"] .apq-mcheck-box{ background: rgb(var(--apq-ink)); box-shadow: none; }
.apq-mcheck[aria-pressed="true"] .apq-mcheck-box .apq-ic{ opacity: 1; }
.apq-mcheck:hover{ color: rgb(var(--apq-ink)); }
/* Delete: quiet, under the fields, straight to its review */
.apq-mdel{
width: 100%; padding: 14px 0 2px; display: flex; align-items: center; gap: 12px; cursor: pointer; text-align: left;
border-top: 1px solid rgba(var(--apq-line),.07);
}
.apq-mdel > .apq-ic{ width: 32px; height: 32px; padding: 8px; flex: none; border-radius: 6px; color: rgb(var(--apq-bad)); background: rgba(var(--apq-bad),.09); stroke-width: 2.2; transition: background-color .15s; }
.apq-mdel:hover > .apq-ic{ background: rgba(var(--apq-bad),.16); }
.apq-mdel-text{ display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.apq-mdel-title{ font-size: 13px; font-weight: 500; color: rgb(var(--apq-bad)); }
.apq-mdel-desc{ font-size: 12px; color: rgb(var(--apq-muted)); }
/* The menu under a box: raised, Ink-filled on the chosen one with its tick */
.apq-mmenu{
position: fixed; z-index: 2; min-width: 180px; max-width: min(340px, calc(100vw - 16px)); padding: 4px; border-radius: 10px; overflow-y: auto; overscroll-behavior: contain;
background: rgb(var(--apq-raised)); color: rgb(var(--apq-text)); box-shadow: var(--apq-shadow), 0 0 0 1px rgba(var(--apq-line),.1);
opacity: 0; transform: translateY(-4px); transition: opacity .15s var(--apq-ease), transform .15s var(--apq-ease);
}
.apq-mmenu.is-up{ transform: translateY(4px); }
.apq-mmenu.is-open{ opacity: 1; transform: none; }
.apq-mmenu-sep{ height: 1px; margin: 4px 8px; background: rgba(var(--apq-line),.09); }
.apq-mopt{
width: 100%; display: flex; align-items: center; gap: 12px; padding: 7px 8px 7px 10px; border-radius: 6px; cursor: pointer; text-align: left;
font-size: 13.5px; color: rgb(var(--apq-text)); transition: background-color .1s;
}
.apq-mopt:hover, .apq-mopt:focus-visible{ background: var(--apq-hover); color: rgb(var(--apq-ink)); }
.apq-mmenu .apq-mopt:focus-visible{ outline-offset: -2px; }
.apq-mopt-text{ flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.apq-mopt-hint{ font-size: 12px; color: rgb(var(--apq-muted)); }
.apq-mopt-tick{ width: 14px; height: 14px; flex: none; }
.apq-mopt-tick .apq-ic{ width: 14px; height: 14px; stroke-width: 3; }
.apq-mopt[aria-checked="true"], .apq-mopt[aria-checked="true"]:hover{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); font-weight: 500; }
.apq-mopt[aria-checked="true"] .apq-mopt-hint{ color: rgba(var(--apq-on-ink),.7); font-weight: 400; }
.apq-mmenu.is-lists{ min-width: 300px; padding: 6px; }
.apq-mlrow{ display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 4px 2px 4px 8px; }
.apq-mlrow-name{ min-width: 0; font-size: 13.5px; color: rgb(var(--apq-text)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-mseg{ flex: none; display: flex; gap: 2px; padding: 2px; border-radius: 6px; background: rgb(var(--apq-sunken)); }
.apq-mseg-btn{ height: 26px; padding: 0 9px; border-radius: 4px; display: grid; place-items: center; cursor: pointer; font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-text)); transition: background-color .1s, color .1s; }
.apq-mseg-btn:hover{ background: rgba(var(--apq-ink),.08); color: rgb(var(--apq-ink)); }
.apq-mseg-btn[aria-checked="true"], .apq-mseg-btn[aria-checked="true"]:hover{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); }
/* The footer: what you picked as chips (× puts a field back on Keep), then Cancel and Preview */
.apq-mass-picks{ flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.apq-mass-picks .apq-mass-note{ flex: none; }
.apq-mass-btns{ flex: none; display: flex; gap: 8px; margin-left: auto; }
.apq-mpick{
max-width: 100%; height: 28px; padding: 0 3px 0 10px; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px;
font-size: 12.5px; font-weight: 500; background: rgba(var(--apq-ink),.06); white-space: nowrap;
}
.apq-mpick-k{ color: rgb(var(--apq-muted)); }
.apq-mpick-v{ min-width: 0; overflow: hidden; text-overflow: ellipsis; color: rgb(var(--apq-ink)); }
.apq-mpick-x{ width: 22px; height: 22px; flex: none; display: grid; place-items: center; border-radius: 4px; cursor: pointer; color: rgb(var(--apq-muted)); transition: background-color .12s, color .12s; }
.apq-mpick-x .apq-ic{ width: 12px; height: 12px; stroke-width: 2.6; }
.apq-mpick-x:hover{ background: rgba(var(--apq-ink),.1); color: rgb(var(--apq-ink)); }
@media (max-width: 560px){ .apq-mass-foot.is-form{ flex-wrap: wrap; } .apq-mass-foot.is-form .apq-mass-picks{ flex-basis: 100%; } }

.apq-mass-warn{
display: flex; align-items: flex-start; gap: 9px; margin: 12px 0 4px; padding: 10px 12px; border-radius: 6px;
background: rgba(var(--apq-bad),.1); color: rgb(var(--apq-bad)); font-size: 12.5px; font-weight: 500; line-height: 1.45;
}
.apq-mass-warn .apq-ic{ width: 16px; height: 16px; margin-top: 1px; stroke-width: 2.4; }
.apq-plist{ display: flex; flex-direction: column; padding-top: 6px; }
.apq-plist-row{ display: flex; align-items: flex-start; gap: 12px; padding: 9px 0; border-bottom: 1px solid rgba(var(--apq-line),.06); }
.apq-plist-row:last-child{ border-bottom: 0; }
.apq-plist-cover{ width: 32px; height: 46px; flex: none; overflow: hidden; border-radius: 4px; background: rgb(var(--apq-sunken)); }
.apq-plist-cover img{ width: 100%; height: 100%; object-fit: cover; display: block; }
.apq-plist-text{ flex: 1; min-width: 0; }
.apq-plist-title{ font-size: 13.5px; font-weight: 500; line-height: 1.3; color: rgb(var(--apq-ink)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-plist-row.is-del .apq-plist-title{ text-decoration: line-through; text-decoration-color: rgba(var(--apq-bad),.6); }
.apq-plist-diffs{ display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 5px; }
.apq-diff{
display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-height: 22px; padding: 2px 8px; border-radius: 4px;
background: rgba(var(--apq-ink),.055); font-size: 12px; font-weight: 500; color: rgb(var(--apq-text)); white-space: nowrap; overflow: hidden;
}
.apq-diff-k{ font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-diff s{ color: rgb(var(--apq-muted)); text-decoration-color: rgba(var(--apq-muted),.7); overflow: hidden; text-overflow: ellipsis; }
.apq-diff b{ font-weight: 500; color: rgb(var(--apq-ink)); overflow: hidden; text-overflow: ellipsis; }
.apq-diff b.is-rem{ color: rgb(var(--apq-bad)); }
.apq-diff-arrow{ color: rgb(var(--apq-muted)); }
.apq-diff.is-del{ background: rgba(var(--apq-bad),.1); color: rgb(var(--apq-bad)); font-weight: 500; }
.apq-diff.is-del .apq-ic{ width: 12px; height: 12px; stroke-width: 2.6; }
.apq-mass-same{ margin: 12px 0 0; font-size: 12px; line-height: 1.5; color: rgb(var(--apq-muted)); }
.apq-mass-preview .apq-empty{ padding: 40px 20px 24px; }


/* Rewatch log (popover and title pages) */
.apq-hist{ font-size: 12.5px; color: rgb(var(--apq-text)); }
.apq-hist.is-loading, .apq-hist.is-error{ display: flex; align-items: center; gap: 8px; min-height: 28px; color: rgb(var(--apq-muted)); }
.apq-hist.is-loading .apq-spin{ width: 11px; height: 11px; }
.apq-hist-retry{ font-weight: 500; color: rgb(var(--apq-ink)); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.apq-hist-sum{ font-size: 13.5px; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-hist-runs{ list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; }
.apq-hist-run{
position: relative; display: grid; grid-template-columns: 14px auto 1fr; align-items: baseline; column-gap: 8px;
padding: 3px 0 5px; line-height: 1.35;
}
.apq-hist-run:not(:last-child)::after{
content: ""; position: absolute; left: 4px; top: 13px; bottom: -3px; width: 2px; border-radius: 1px; background: rgba(var(--apq-line),.12);
}
.apq-hist-dot{ width: 10px; height: 10px; border-radius: 50%; align-self: center; background: rgb(var(--apq-surface)); box-shadow: inset 0 0 0 2px rgb(var(--apq-title)); }
.apq-hist-run.is-done .apq-hist-dot{ background: rgb(var(--apq-title)); }
.apq-hist-run.is-dropped .apq-hist-dot, .apq-hist-run.is-stopped .apq-hist-dot, .apq-hist-run.is-paused .apq-hist-dot{ background: none; box-shadow: inset 0 0 0 2px rgba(var(--apq-muted),.7); }
.apq-hist-k{ font-weight: 500; color: rgb(var(--apq-ink)); white-space: nowrap; }
.apq-hist-d{ min-width: 0; color: rgb(var(--apq-muted)); font-variant-numeric: tabular-nums; text-align: right; }
.apq-hist-note{ margin: 6px 0 0; font-size: 12px; line-height: 1.45; color: rgb(var(--apq-muted)); }
/* 0.8: MyAnimeList's parts of AniList's title page (outside.js), in AniList's own styles, copied from its stylesheet
   on 2026-11-12: its character cards (.role-card: the foreground, 3 px corners, 80 px tall, the picture 60 px wide,
   12 px names, 11 px roles in its lighter text), its headings (h2, 14 px 500), its panels (.content-wrap: 4 px
   corners, 20 px inside). The score line is a copy of AniList's own sidebar line, so it needs nothing here. */
[data-apq-xhide]{ display: none !important; }
.apq-xscore > a.value{ display: block; text-decoration: none; }
.apq-xscore > a.value:hover{ color: rgb(var(--color-blue, var(--apq-acc))); }
.apq-xsw{
float: right; display: inline-flex; gap: 1px; margin: -4px 0 -4px 12px; padding: 2px; border-radius: 4px;
background: rgb(var(--color-foreground, var(--apq-surface))); font-size: 12px; font-weight: 500; line-height: 1;
}
.apq-xsw-btn{
height: 22px; padding: 0 8px; display: inline-flex; align-items: center; border-radius: 3px; cursor: pointer;
color: rgb(var(--color-text-lighter, var(--apq-muted))); transition: background-color .15s, color .15s;
}
.apq-xsw-btn:hover{ color: rgb(var(--color-text, var(--apq-ink))); }
.apq-xsw-btn[aria-checked="true"], .apq-xsw-btn[aria-checked="true"]:hover{ background: rgb(var(--color-text, var(--apq-ink))); color: rgb(var(--color-foreground, var(--apq-surface))); cursor: default; }
.apq-xsec{ margin-bottom: 30px; }
.apq-xgrid{ margin: 0; }
.apq-xrc{
display: grid; grid-template-columns: 50% 50%; height: 80px; overflow: hidden; border-radius: 3px;
background: rgb(var(--color-foreground, var(--apq-surface)));
}
.apq-xrc.is-single{ grid-template-columns: 100%; }
.apq-xrc-p{ min-width: 0; display: grid; grid-template-columns: 60px minmax(0, 1fr); }
.apq-xrc-p.is-right{ grid-template-columns: minmax(0, 1fr) 60px; }
.apq-xrc-p.is-right .apq-xrc-img{ order: 2; }
.apq-xrc-p.is-right .apq-xrc-c{ text-align: right; }
.apq-xrc-img{ display: block; height: 80px; overflow: hidden; background: rgba(var(--color-text, var(--apq-text)),.08); }
.apq-xrc-img img{ width: 100%; height: 100%; object-fit: cover; object-position: 50% 20%; display: block; }
.apq-xrc-ini{ display: grid; place-items: center; height: 100%; font-size: 14px; font-weight: 500; color: rgb(var(--color-text-lighter, var(--apq-muted))); }
.apq-xrc-c{ display: block; min-width: 0; overflow: hidden; padding: 10px; font-size: 12px; color: rgb(var(--color-text, var(--apq-text))); text-decoration: none; }
a.apq-xrc-c:hover .apq-xrc-name{ color: rgb(var(--color-blue, var(--apq-acc))); }
.apq-xrc-name{ height: 48px; line-height: 1.3; overflow: hidden; transition: color .15s; }
.apq-xrc-role{ font-size: 11px; color: rgb(var(--color-text-lighter, var(--apq-muted))); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.apq-xfoot{ display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
.apq-xsrc:first-child{ margin-left: auto; }
.apq-xmore{ font-size: 12px; font-weight: 500; cursor: pointer; color: rgb(var(--color-text, var(--apq-text))); border-radius: 3px; }
.apq-xmore:hover{ color: rgb(var(--color-blue, var(--apq-acc))); }
.apq-xsrc{ font-size: 11px; color: rgb(var(--color-text-lighter, var(--apq-muted))); }
.apq-xsongs-grid{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 30px; }
.apq-xsongs-grid.is-one{ grid-template-columns: minmax(0, 1fr); }
.apq-xsongs-col{ min-width: 0; }
.apq-xsongs-col > h2{ margin: 0 0 10px; font-size: 14px; font-weight: 500; color: rgb(var(--color-text, var(--apq-text))); }
.apq-xsongs-list{ list-style: none; margin: 0; padding: 8px 0; border-radius: 4px; background: rgb(var(--color-foreground, var(--apq-surface))); }
.apq-xsongs-row{
display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; column-gap: 10px; align-items: baseline; padding: 8px 12px 8px 20px;
font-size: 13px; color: rgb(var(--color-text, var(--apq-text)));
}
.apq-xsongs-n{ font-size: 12px; text-align: right; color: rgb(var(--color-text-lighter, var(--apq-muted))); font-variant-numeric: tabular-nums; }
.apq-xsongs-t{ min-width: 0; }
.apq-xsongs-title{ display: block; font-weight: 500; line-height: 1.35; overflow-wrap: anywhere; color: inherit; text-decoration: none; transition: color .15s; }
a.apq-xsongs-title:hover{ color: rgb(var(--color-blue, var(--apq-acc))); }
/* The artist and the episodes: one line of text that wraps, "MAXIMUM THE HORMONE (Eps 1–13)" */
.apq-xsongs-by{ display: block; margin-top: 2px; font-size: 12px; line-height: 1.4; color: rgb(var(--color-text-lighter, var(--apq-muted))); overflow-wrap: anywhere; }
.apq-xsongs-eps{ white-space: nowrap; }
/* Play here and YouTube: two quiet icons, brighter on the row's hover, AniList's blue when pointed at */
.apq-xsongs-acts{ display: inline-flex; gap: 2px; align-self: center; }
.apq-xsongs-act{
display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 4px; cursor: pointer;
color: rgb(var(--color-text-lighter, var(--apq-muted))); opacity: .55; transition: opacity .15s, color .15s, background-color .15s;
}
.apq-xsongs-act .apq-ic{ width: 15px; height: 15px; }
.apq-xsongs-row:hover .apq-xsongs-act, .apq-xsongs-act:focus-visible, .apq-xsongs-act.is-on{ opacity: 1; }
.apq-xsongs-act:hover, .apq-xsongs-act.is-on{ color: rgb(var(--color-blue, var(--apq-acc))); background: rgba(var(--color-blue, var(--apq-acc)),.1); }
.apq-xsongs-act:focus-visible{ outline: 2px solid rgb(var(--color-blue, var(--apq-acc))); outline-offset: -2px; }
.apq-xsongs-video{ display: block; width: calc(100% - 32px); margin: 2px 16px 10px; aspect-ratio: 16 / 9; border-radius: 4px; background: #000; }
@media (hover: none){ .apq-xsongs-act{ opacity: 1; } }

/* MyAnimeList and Reddit in AniList's "External & Streaming links" (0.12.7). Next to AniList's own buttons they are
   copies of them (its scoped CSS applies). A title without links gets Tsugi's own box: AniList's rules, copied from
   its main.css on 2026-11-13 (.external-link: 30 px, 5 px corners, Overpass 700 at 1.3rem, a 24 px colored square). */
.apq-xlink .icon-wrap > img.icon{ display: block; width: 100%; height: 100%; object-fit: contain; }
.apq-xlinks{ margin-top: 20px; }
.apq-xlinks .external-links-wrap{ display: block; }
.apq-xlinks .external-link{
display: grid; grid-template-columns: 24px auto; gap: 12px; align-items: center; height: 30px; margin-bottom: 10px; border-radius: 5px;
font-family: Overpass, -apple-system, BlinkMacSystemFont, "Segoe UI", Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
font-size: 1.3rem; font-weight: 700; line-height: 1.3rem; text-decoration: none;
color: rgb(var(--color-text, var(--apq-text))); background: rgb(var(--color-foreground, var(--apq-surface)));
}
.apq-xlinks .external-link:hover{ color: rgb(var(--color-white, 255,255,255)); background: var(--link-color); }
.apq-xlinks .icon-wrap{ display: flex; align-items: center; justify-content: center; width: 100%; height: 24px; margin-left: 3px; padding: 4px; border-radius: 3px; box-sizing: border-box; }
.apq-xlinks .name{ margin-top: 2px; text-align: left; }
@media (max-width: 760px){ .apq-xlinks .external-links-wrap{ display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; } }
@media (max-width: 1040px){ .apq-xsongs-grid{ grid-template-columns: minmax(0, 1fr); gap: 20px; } }


/* ---------------- Command palette (Ctrl+K) ---------------- */
.apq-pal-scrim{
position: fixed; inset: 0; z-index: 9997; background: rgba(8,12,20,.36); opacity: 0; pointer-events: none;
transition: opacity .16s var(--apq-ease);
}
html[data-apq-theme="dark"] .apq-pal-scrim{ background: rgba(0,0,0,.55); }
.apq-pal-scrim.is-open{ opacity: 1; pointer-events: auto; }
.apq-pal{
position: fixed; left: 50%; top: max(12px, 11vh); z-index: 9998; width: min(620px, calc(100vw - 24px));
max-height: min(560px, calc(100vh - max(12px, 11vh) - 12px)); display: flex; flex-direction: column; overflow: hidden; border-radius: 10px;
background: rgb(var(--apq-raised)); color: rgb(var(--apq-text)); box-shadow: var(--apq-shadow), 0 0 0 1px rgba(var(--apq-line),.09);
opacity: 0; visibility: hidden; pointer-events: none; transform: translate(-50%, -6px);
transition: opacity .15s var(--apq-ease), transform .18s var(--apq-ease), visibility 0s linear .18s;
}
.apq-pal.is-open{
opacity: 1; visibility: visible; pointer-events: auto; transform: translate(-50%, 0);
transition: opacity .15s var(--apq-ease), transform .18s var(--apq-ease), visibility 0s;
}
.apq-pal-bar{ display: flex; align-items: center; gap: 12px; flex: none; height: 54px; padding: 0 16px; border-bottom: 1px solid rgba(var(--apq-line),.08); cursor: text; }
.apq-pal-bar > .apq-ic{ width: 18px; height: 18px; color: rgb(var(--apq-muted)); }
.apq-pal-input{ flex: 1; min-width: 0; height: 100%; font-size: 15px; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-pal-input::placeholder{ color: rgb(var(--apq-muted)); font-weight: 400; opacity: 1; }
.apq-pal-input:focus-visible{ outline: none; }
.apq-pal-status{ display: flex; color: rgb(var(--apq-muted)); }
.apq-pal-list{ flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px 6px 6px; }
.apq-pal-head{ padding: 12px 10px 5px; font-size: 12px; font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-pal-row{ display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 5px 8px 5px 10px; border-radius: 6px; cursor: pointer; scroll-margin: 30px 0 8px; }
.apq-pal-row.is-active{ background: rgb(var(--apq-ink)); }
.apq-pal-row.is-active .apq-pal-label{ color: rgb(var(--apq-on-ink)); }
.apq-pal-row.is-active .apq-pal-sub{ color: rgba(var(--apq-on-ink),.72); }
.apq-pal-row.is-disabled{ cursor: default; }
.apq-pal-row.is-disabled.is-active{ background: var(--apq-hover); }
.apq-pal-row.is-disabled.is-active .apq-pal-label{ color: rgb(var(--apq-muted)); }
.apq-pal-row.is-disabled.is-active .apq-pal-sub{ color: rgb(var(--apq-muted)); }
.apq-pal-ic{ width: 30px; height: 30px; flex: none; border-radius: 6px; display: grid; place-items: center; color: rgb(var(--apq-text)); background: rgba(var(--apq-ink),.06); transition: color .12s, background-color .12s; }
.apq-pal-row.is-active .apq-pal-ic{ color: rgb(var(--apq-on-ink)); background: rgba(var(--apq-on-ink),.14); }
.apq-pal-ic .apq-ic{ width: 15px; height: 15px; }
.apq-pal-ic .apq-spin{ width: 12px; height: 12px; }
.apq-pal-cover{ width: 30px; height: 42px; flex: none; border-radius: 4px; overflow: hidden; background: rgba(var(--apq-ink),.08); }
.apq-pal-cover img{ width: 100%; height: 100%; object-fit: cover; display: block; }
.apq-pal-text{ flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.apq-pal-label{ font-size: 13.5px; font-weight: 500; color: rgb(var(--apq-ink)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-pal-sub{ display: flex; gap: 10px; font-size: 12px; color: rgb(var(--apq-muted)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-pal-sub > span{ flex: none; }
.apq-pal-sub > span:last-child{ flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.apq-pal-row.is-disabled .apq-pal-label{ color: rgb(var(--apq-muted)); font-weight: 500; }
.apq-pal-quick{
flex: none; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px 0 8px; border-radius: 6px; cursor: pointer;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink)); background: rgba(var(--apq-ink),.08); transition: background-color .12s;
}
.apq-pal-quick:hover:not(:disabled){ background: rgba(var(--apq-ink),.14); }
.apq-pal-quick:disabled{ opacity: .6; cursor: default; }
.apq-pal-quick .apq-ic{ width: 13px; height: 13px; stroke-width: 2.8; }
.apq-pal-quick .apq-spin{ width: 11px; height: 11px; }
.apq-pal-row.is-active .apq-pal-quick{ color: rgb(var(--apq-on-ink)); background: rgba(var(--apq-on-ink),.16); }
.apq-pal-row.is-active .apq-pal-quick:hover:not(:disabled){ background: rgba(var(--apq-on-ink),.26); }
.apq-pal-val{ flex: none; padding: 3px 9px; border-radius: 4px; font-size: 12px; font-weight: 500; color: rgb(var(--apq-muted)); background: rgba(var(--apq-ink),.07); }
.apq-pal-val.is-on{ color: rgb(var(--apq-ink)); background: rgba(var(--apq-ink),.12); }
.apq-pal-row.is-active .apq-pal-val{ color: rgb(var(--apq-on-ink)); background: rgba(var(--apq-on-ink),.16); }
.apq-pal-note{ margin: 12px 12px 6px; font-size: 12.5px; line-height: 1.45; color: rgb(var(--apq-muted)); }
.apq-pal-foot{
display: flex; flex-wrap: wrap; gap: 6px 16px; flex: none; padding: 8px 16px; border-top: 1px solid rgba(var(--apq-line),.08);
font-size: 12px; font-weight: 500; color: rgb(var(--apq-muted));
}
.apq-pal-k{ display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
@media (max-width: 640px){
.apq-pal{ top: 8px; max-height: calc(100vh - 16px); width: calc(100vw - 16px); }
.apq-pal-esc, .apq-pal-foot{ display: none; }
}

/* ---------------- Feed filters (Home) ---------------- */
html:not(.apq-feed-peek) [data-apq-hide]{ display: none !important; }
html.apq-feed-peek [data-apq-hide]{ opacity: .4; }
/* Hide the global feed (0.12.7): AniList's Following / Global switch on Home, or its logged-out "Site Activity" */
[data-apq-noglobal]{ display: none !important; }

/* ---------------- Profiles (0.12.7) ---------------- */
/* Follower counts after AniList's own Following, Followers and Mutual Followers: "Following (7)", the count a
   step quieter, in the label's own color when the label is lit (hover, the selected one) */
.apq-soc-n{ margin-left: 0; font-family: inherit; font-weight: 400; opacity: .7; font-variant-numeric: tabular-nums; }
/* Why a profile is missing: one of AniList's panels at the top of its 404 page (its foreground, 4 px corners) */
.apq-nf{
display: flex; align-items: center; gap: 16px; max-width: 560px; margin: 0 auto 30px; padding: 18px 22px; border-radius: 4px; box-sizing: border-box;
text-align: left; background: rgb(var(--color-foreground, var(--apq-surface))); color: rgb(var(--color-text, var(--apq-text)));
}
.apq-nf .apq-nf-av{ flex: none; width: 48px; height: 48px; margin: 0; box-shadow: none; border-radius: 4px; object-fit: cover; background: rgba(var(--apq-ink),.06); }
.apq-nf .apq-nf-av.is-icon{ display: inline-flex; align-items: center; justify-content: center; color: rgb(var(--color-text-lighter, var(--apq-muted))); }
.apq-nf .apq-nf-av.is-icon .apq-ic{ width: 22px; height: 22px; }
.apq-nf-text{ min-width: 0; }
.apq-nf-title{ font-size: 15px; font-weight: 500; line-height: 1.35; color: rgb(var(--apq-ink)); overflow-wrap: anywhere; }
.apq-nf-desc{ margin-top: 4px; font-size: 13px; line-height: 1.5; }
.apq-nf a.apq-nf-link{ position: static; width: auto; height: auto; display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 500; color: rgb(var(--color-blue, var(--apq-acc))); text-decoration: none; }
.apq-nf a.apq-nf-link:hover{ text-decoration: underline; text-underline-offset: 3px; }
.apq-feed-btn{
display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; margin-left: 12px; border-radius: 4px; cursor: pointer; vertical-align: middle;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-text)); background: rgb(var(--apq-surface)); transition: color .15s, background-color .15s;
}
.apq-feed-btn:hover, .apq-feed-btn[aria-expanded="true"], .apq-feed-btn.is-on{ color: rgb(var(--apq-ink)); }
.apq-feed-btn[aria-expanded="true"]{ box-shadow: inset 0 0 0 1.5px rgba(var(--apq-ink),.3); }
.apq-feed-btn .apq-ic{ width: 14px; height: 14px; }
.apq-feed-btn-n{
min-width: 18px; height: 18px; padding: 0 5px; border-radius: 4px; display: inline-grid; place-items: center;
font-size: 11px; font-weight: 500; color: rgb(var(--apq-on-ink)); background: rgb(var(--apq-ink));
}
.apq-feed-btn-n:empty{ display: none; }
.apq-feed-bar{
display: flex; align-items: center; gap: 10px; margin: 0 0 14px; padding: 8px 12px; border-radius: 4px;
background: rgb(var(--apq-surface)); font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-text));
}
.apq-feed-bar .apq-feed-btn{ margin-left: 0; }
.apq-feed-bar-text{ flex: 1; min-width: 0; }
.apq-feed-peek-btn{ flex: none; font-weight: 500; color: rgb(var(--apq-ink)); cursor: pointer; border-radius: 4px; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(var(--apq-ink),.35); }
.apq-feed-panel{
position: fixed; z-index: 9998; max-height: calc(100vh - 16px); overflow-y: auto; border-radius: 10px;
background: rgb(var(--apq-raised)); color: rgb(var(--apq-text)); box-shadow: var(--apq-shadow), 0 0 0 1px rgba(var(--apq-line),.09);
opacity: 0; transform: translateY(-4px); transition: opacity .15s var(--apq-ease), transform .18s var(--apq-ease);
}
.apq-feed-panel.is-open{ opacity: 1; transform: none; }
.apq-feed-head{ display: flex; align-items: center; justify-content: space-between; padding: 10px 8px 2px 16px; }
.apq-feed-title{ font-size: 15px; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-feed-sec{ padding: 8px 16px 12px; }
.apq-feed-sec + .apq-feed-sec{ border-top: 1px solid rgba(var(--apq-line),.07); }
.apq-feed-sec-head{ display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 30px; margin-bottom: 8px; }
.apq-feed-h{ font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-feed-seg{ flex: none; }
.apq-feed-seg .apq-seg-btn{ height: 24px; }
/* The kinds to show: a checklist (everything starts on), each box filled with Ink when shown */
.apq-feed-kinds{ display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; margin: 0 -6px; }
.apq-feed-kinds + .apq-feed-kinds{ margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(var(--apq-line),.07); }
.apq-feed-kinds .apq-tchip{ width: 100%; padding: 0 6px; gap: 9px; background: transparent; color: rgb(var(--apq-muted)); font-weight: 500; }
.apq-feed-kinds .apq-tchip:hover, .apq-feed-kinds .apq-tchip[aria-pressed="true"]:hover{ background: var(--apq-hover); color: rgb(var(--apq-ink)); }
.apq-feed-kinds .apq-tchip .apq-ic{
width: 16px; height: 16px; padding: 2px; border-radius: 4px; opacity: 1; stroke-width: 3.4;
color: transparent; box-shadow: inset 0 0 0 1.5px rgba(var(--apq-muted),.65);
}
.apq-feed-kinds .apq-tchip[aria-pressed="true"]{ background: transparent; color: rgb(var(--apq-ink)); }
.apq-feed-kinds .apq-tchip[aria-pressed="true"] .apq-ic{ background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); box-shadow: none; }
.apq-feed-add{ display: flex; gap: 6px; }
.apq-feed-input{
flex: 1; min-width: 0; height: 32px; padding: 0 10px; border-radius: 6px; background: rgb(var(--apq-sunken));
font-size: 13px; font-weight: 500; color: rgb(var(--apq-ink));
}
.apq-feed-input:focus{ box-shadow: 0 0 0 2px rgb(var(--apq-acc)); }
.apq-feed-input:focus-visible{ outline: none; }
.apq-feed-input::placeholder{ color: rgb(var(--apq-muted)); font-weight: 400; opacity: 1; }
.apq-feed-add-btn{ flex: none; width: 32px; height: 32px; border-radius: 6px; display: grid; place-items: center; cursor: pointer; color: rgb(var(--apq-ink)); background: rgba(var(--apq-ink),.08); }
.apq-feed-add-btn:hover{ background: rgba(var(--apq-ink),.13); }
.apq-feed-add-btn .apq-ic{ width: 15px; height: 15px; stroke-width: 2.6; }
.apq-feed-chips{ display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.apq-feed-chip{
display: inline-flex; align-items: center; gap: 4px; max-width: 100%; height: 28px; padding: 0 4px 0 10px; border-radius: 6px;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-on-ink)); background: rgb(var(--apq-ink));
}
.apq-feed-chip > span{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.apq-feed-chip-x{ flex: none; width: 20px; height: 20px; border-radius: 4px; display: grid; place-items: center; cursor: pointer; color: inherit; opacity: .7; }
.apq-feed-chip-x:hover{ opacity: 1; background: rgba(var(--apq-on-ink),.16); }
.apq-feed-chip-x .apq-ic{ width: 12px; height: 12px; stroke-width: 2.6; }
.apq-feed-foot{
display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px 14px;
border-top: 1px solid rgba(var(--apq-line),.07); font-size: 12.5px; color: rgb(var(--apq-muted));
}
.apq-feed-reset{ font-weight: 500; color: rgb(var(--apq-ink)); cursor: pointer; border-radius: 4px; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(var(--apq-ink),.35); }

/* ---------------- List views (AniList's list pages) ---------------- */
[data-apq-vhide], [data-apq-vempty]{ display: none !important; }
/* Filters in AniList's sidebar (views.js): AniList's own dropdowns, copied from its stylesheet (2026-11-11):
   element-ui's small select (32 px, 13 px text, 4 px corners, its foreground color, a 15 px inset, the arrow
   in #c0c4cc), its dropdown (white, or background-100 in the dark theme; 34 px rows of 14 px text; the
   picked ones on background-200 with a tick and element's blue), and the groups of its sidebar. AniList's
   color variables, with Tsugi's tokens where a page doesn't have them. */
.apq-lvf{ display: block; }
.apq-lvf-note{ margin: 8px 2px 0; font-size: 12px; line-height: 1.4; color: rgb(var(--color-text-lighter, var(--apq-muted))); }
.apq-sel{
position: relative; display: flex; align-items: center; flex-wrap: wrap; width: 100%; min-height: 32px; margin-top: 10px; padding: 0 30px 0 0;
border-radius: 4px; cursor: pointer; font-size: 13px; line-height: 1.3; text-align: left; text-transform: none;
color: rgb(var(--color-text, var(--apq-text))); background: rgb(var(--color-foreground, var(--apq-surface)));
--apq-ph: 192,196,204; transition: box-shadow .2s;
}
body.site-theme-contrast .apq-sel{ --apq-ph: 83,92,111; }
.apq-sel:focus{ outline: none; }
.apq-sel.is-open, .apq-sel:focus-visible{ box-shadow: 0 1px 10px 0 rgba(49,54,68,.15); }
.apq-sel:focus-visible{ outline: 2px solid rgb(var(--apq-acc)); outline-offset: 1px; }
.apq-sel-ph, .apq-sel-val{ flex: 1; min-width: 0; padding-left: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 32px; }
.apq-sel-ph{ color: rgb(var(--apq-ph)); }
.apq-sel-caret, .apq-sel-clear{ position: absolute; top: 0; right: 5px; width: 25px; height: 32px; display: grid; place-items: center; color: rgb(var(--apq-ph)); }
.apq-sel-caret .apq-ic{ width: 14px; height: 14px; stroke-width: 1.8; transition: transform .3s; }
.apq-sel.is-open .apq-sel-caret .apq-ic{ transform: rotate(180deg); }
.apq-sel-clear{ display: none; cursor: pointer; transition: color .2s; }
.apq-sel-clear .apq-ic{ width: 14px; height: 14px; stroke-width: 1.8; }
.apq-sel-clear:hover{ color: #909399; }
.apq-sel.is-set:hover .apq-sel-clear{ display: grid; }
.apq-sel.is-set:hover .apq-sel-caret{ display: none; }
.apq-sel-tags{ display: flex; flex-wrap: wrap; align-items: center; min-width: 0; max-width: 100%; padding: 2px 0; }
.apq-sel-tag{
display: inline-flex; align-items: center; gap: 2px; max-width: calc(100% - 6px); height: 24px; margin: 2px 0 2px 6px; padding: 0 5px 0 8px;
border-radius: 4px; font-size: 12px; line-height: 22px; color: #909399; background: rgb(var(--color-background, var(--apq-sunken)));
}
.apq-sel-tag-t{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.apq-sel-tag-x{
flex: none; width: 13px; height: 13px; margin-left: 2px; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
color: #fff; background: #c0c4cc; transition: background-color .2s;
}
.apq-sel-tag-x:hover{ background: #909399; }
html[data-apq-theme="dark"] .apq-sel-tag-x{ background: rgb(var(--color-foreground-grey, 15,22,31)); }
html[data-apq-theme="dark"] .apq-sel-tag-x:hover{ background: rgba(var(--color-red, 232,93,117),.8); }
.apq-sel-tag-x .apq-ic{ width: 9px; height: 9px; stroke-width: 3; }
.apq-sel-input{
flex: 1 1 60px; min-width: 60px; height: 28px; margin-left: 15px; font: inherit; font-size: 13px; color: inherit; background: none; border: 0; cursor: text;
}
.apq-sel-input::placeholder{ color: rgb(var(--apq-ph)); opacity: 1; }
.apq-sel-input:focus-visible{ outline: none; }
.apq-sel.is-finding.is-set .apq-sel-input{ margin-left: 6px; }
.apq-sel-drop{
position: fixed; z-index: 10001; border-radius: 4px; font-size: 14px; color: rgb(var(--color-gray-700, var(--apq-text)));
background: #fff; box-shadow: 0 1px 10px 0 rgba(49,54,68,.15);
opacity: 0; transform: scaleY(.8); transform-origin: center top; transition: opacity .3s cubic-bezier(.23,1,.32,1), transform .3s cubic-bezier(.23,1,.32,1);
}
.apq-sel-drop.is-up{ transform-origin: center bottom; }
.apq-sel-drop.is-open{ opacity: 1; transform: none; }
html[data-apq-theme="dark"] .apq-sel-drop{ background: rgb(var(--color-background-100, 21,31,46)); box-shadow: 0 1px 3px #000; }
.apq-sel-arrow{
position: absolute; top: -6px; width: 0; height: 0; border: 6px solid transparent; border-top-width: 0; border-bottom-color: #fff;
filter: drop-shadow(0 -1px 1px rgba(49,54,68,.06));
}
html[data-apq-theme="dark"] .apq-sel-arrow{ border-bottom-color: rgb(var(--color-background-100, 21,31,46)); }
.apq-sel-drop.is-up .apq-sel-arrow{ top: auto; bottom: -6px; transform: rotate(180deg); }
.apq-sel-list{ max-height: var(--apq-sel-max, 274px); overflow-y: auto; overscroll-behavior: contain; padding: 6px 0; border-radius: inherit; }
.apq-sel-item{
position: relative; display: flex; align-items: center; gap: 12px; height: 34px; padding: 0 42px 0 20px; cursor: pointer; white-space: nowrap;
color: rgb(var(--color-text, var(--apq-text)));
}
.apq-sel-item-t{ flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.apq-sel-n{ flex: none; font-size: 12px; color: rgb(var(--color-text-lighter, var(--apq-muted))); }
.apq-sel-item.is-hover{ background: rgba(var(--color-background-200, var(--apq-sunken)),.6); }
.apq-sel-item.is-on{ color: #409eff; background: rgb(var(--color-background-200, var(--apq-sunken))); }
.apq-sel-item.is-on .apq-sel-n{ color: inherit; opacity: .75; }
.apq-sel-tick{ position: absolute; right: 18px; width: 14px !important; height: 14px !important; stroke-width: 3; }
.apq-sel-empty{ margin: 0; padding: 10px 20px; text-align: center; font-size: 14px; color: #999; white-space: nowrap; }
/* On AniList's Filters heading: "38 of 444" with a clear button (like its Year), and Save on hover (like its
   button to reorder Lists) */
.apq-lvf-val{ float: right; display: inline-flex; align-items: center; gap: 4px; color: inherit; font-size: inherit; }
.apq-lvf-val.is-empty{ color: rgb(var(--apq-warn)); }
.apq-lvf-clear{ display: inline-grid; place-items: center; cursor: pointer; border-radius: 50%; transition: color .2s; }
.apq-lvf-clear:hover{ color: rgb(var(--color-text, var(--apq-ink))); }
.apq-lvf-clear .apq-ic{ width: 13px; height: 13px; }
.apq-lvf-act{ display: inline-grid; place-items: center; margin-left: 5px; vertical-align: -1px; cursor: pointer; opacity: 0; transition: opacity .2s, color .2s; }
.filter-group:hover .apq-lvf-act, .apq-lv-bar:hover .apq-lvf-act, .apq-lvf-act:focus-visible{ opacity: 1; }
.apq-lvf-act:hover{ color: rgb(var(--color-blue, var(--apq-acc))); }
.apq-lvf-act .apq-ic{ width: 12px; height: 12px; stroke-width: 2.4; }
@media (hover: none){ .apq-lvf-act{ opacity: 1; } }
/* Saved filters: a group of AniList's sidebar, its items like its Lists */
.apq-lvs{ margin-top: 20px; font-size: 13px; color: rgb(var(--color-text-lighter, var(--apq-muted))); }
.apq-lvs-head{ margin-bottom: 10px; }
.apq-lvs-item{
display: flex; align-items: center; gap: 6px; margin-bottom: 8px; padding: 5px 10px; border-radius: 3px; cursor: pointer;
font-size: 14px; color: rgb(var(--color-text-lighter, var(--apq-muted)));
}
.apq-lvs-item:hover{ color: rgb(var(--color-text, var(--apq-text))); }
.apq-lvs-item.is-on{ color: rgb(var(--color-text, var(--apq-ink))); background: rgba(var(--color-foreground, var(--apq-surface)),.8); font-weight: 500; }
.apq-lvs-item:focus-visible{ outline: 2px solid rgb(var(--apq-acc)); outline-offset: 1px; }
.apq-lvs-name{ flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.apq-lvs-x{ flex: none; width: 16px; height: 16px; display: grid; place-items: center; border-radius: 50%; opacity: 0; transition: opacity .2s, color .2s; }
.apq-lvs-item:hover .apq-lvs-x{ opacity: .8; }
.apq-lvs-x:hover{ opacity: 1 !important; color: rgb(var(--color-red, var(--apq-bad))); }
.apq-lvs-x .apq-ic{ width: 11px; height: 11px; stroke-width: 2.6; }
@media (hover: none){ .apq-lvs-x{ opacity: .8; } }
.apq-lvs-input{
display: block; width: 100%; height: 32px; padding: 0 15px; border-radius: 4px; font-size: 13px;
color: rgb(var(--color-text, var(--apq-text))); background: rgb(var(--color-foreground, var(--apq-surface)));
}
.apq-lvs-input:focus{ box-shadow: 0 1px 10px 0 rgba(49,54,68,.15); }
.apq-lvs-input:focus-visible{ outline: 2px solid rgb(var(--apq-acc)); outline-offset: 1px; }
.apq-lvs-input::placeholder{ color: rgb(192,196,204); opacity: 1; }
/* Only on a page without AniList's sidebar: the same dropdowns above the first list */
.apq-lv-bar{
display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; max-width: calc(100% - 170px); margin: 0 0 24px;
font-size: 13px; color: rgb(var(--color-text-lighter, var(--apq-muted)));
}
.apq-lv-barhead{ grid-column: 1 / -1; }
.apq-lv-bar .apq-lvf{ display: contents; }
.apq-lv-bar .apq-sel{ margin-top: 0; }
.apq-lv-bar .apq-lvs{ grid-column: 1 / -1; margin-top: 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
.apq-lv-bar .apq-lvs-head{ margin: 0 4px 0 0; }
.apq-lv-bar .apq-lvs-item{ margin: 0; }
.apq-lv-bar .apq-lvs-input{ width: 220px; }

/* Posters, the fourth icon of AniList's layout switch: a copy of AniList's own icon, so its rules apply; these
   are for a page without them. While posters are on, AniList's own lit icon goes back to its plain color. */
.layout-switch > .apq-lsw{ cursor: pointer; }
.layout-switch > .apq-lsw.active{ color: rgb(var(--color-blue, var(--apq-acc))); }
.layout-switch > .apq-lsw:focus-visible{ outline: 2px solid rgb(var(--apq-acc)); outline-offset: 3px; border-radius: 2px; }
.apq-lsw-ic{ width: 1em; height: 1em; display: inline-block; vertical-align: -.125em; }
.layout-switch[data-apq-on] > .active:not(.apq-lsw){ color: inherit !important; }

/* Each list's sort, next to its title: quiet text in AniList's own colors. A list in AniList's order (its
   sidebar's Sort) shows "Sort" only while you point at its title. */
.apq-sort-chip{
display: inline-flex; align-items: center; gap: 4px; margin-left: 10px; padding: 3px 6px; border-radius: 4px; cursor: pointer;
vertical-align: middle; font-size: 13px; font-weight: 400; line-height: 1.2; letter-spacing: 0; text-transform: none;
color: rgb(var(--color-text-lighter, var(--apq-muted))); background: transparent; transition: color .15s, background-color .15s, opacity .15s;
}
.apq-sort-chip:hover, .apq-sort-chip[aria-expanded="true"]{ color: rgb(var(--color-text, var(--apq-text))); background: var(--apq-hover); }
.apq-sort-chip:not(.is-set){ opacity: 0; }
.section-name:hover > .apq-sort-chip, .apq-sort-chip:focus-visible, .apq-sort-chip[aria-expanded="true"]{ opacity: 1; }
@media (hover: none){ .apq-sort-chip:not(.is-set){ opacity: 1; } }
.apq-sort-chip-dir{ width: 12px !important; height: 12px !important; stroke-width: 2.4; margin-left: -1px; }
.apq-sort-chip-grp{ margin-left: 2px; }
.apq-sort-chip-chev{ width: 12px !important; height: 12px !important; opacity: .7; }
.apq-sort-menu{
position: fixed; z-index: 9998; display: flex; flex-direction: column; border-radius: 10px; overflow: hidden;
background: rgb(var(--apq-raised)); color: rgb(var(--apq-text)); box-shadow: var(--apq-shadow), 0 0 0 1px rgba(var(--apq-line),.1);
opacity: 0; transform: translateY(-4px); transition: opacity .15s var(--apq-ease), transform .18s var(--apq-ease);
}
.apq-sort-menu.is-open{ opacity: 1; transform: none; }
.apq-sort-scroll{ flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.apq-sort-items{ display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
.apq-sort-item{
display: flex; align-items: center; justify-content: space-between; gap: 6px; height: 32px; padding: 0 10px; border-radius: 4px; cursor: pointer;
font-size: 13px; font-weight: 500; color: rgb(var(--apq-ink)); white-space: nowrap;
}
.apq-sort-item:hover{ background: var(--apq-hover); }
.apq-sort-item[aria-checked="true"], .apq-sort-item[aria-checked="true"]:hover{ color: rgb(var(--apq-on-ink)); background: rgb(var(--apq-ink)); font-weight: 500; }
.apq-sort-item .apq-ic{ width: 14px; height: 14px; stroke-width: 3; }
/* The sort menu's parts */
.apq-lv-top{ flex: none; display: flex; align-items: center; justify-content: space-between; padding: 10px 8px 4px 16px; }
.apq-lv-title{ font-size: 15px; font-weight: 500; color: rgb(var(--apq-ink)); }
.apq-lv-sec{ padding: 6px 16px 14px; }
.apq-lv-sec + .apq-lv-sec{ border-top: 1px solid rgba(var(--apq-line),.08); padding-top: 12px; }
.apq-lv-head{ display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 26px; margin: 2px 0 6px; }
.apq-lv-head:not(:first-child){ margin-top: 12px; }
.apq-lv-label{ font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-lv-seg{ display: flex; gap: 2px; padding: 3px; border-radius: 6px; background: rgb(var(--apq-sunken)); }
.apq-lv-seg-btn{
flex: 1 1 0; min-width: 0; height: 28px; padding: 0 6px; border-radius: 4px; display: grid; place-items: center; cursor: pointer;
overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); transition: color .15s, background-color .15s;
}
.apq-lv-seg-btn:hover{ color: rgb(var(--apq-ink)); background: var(--apq-hover); }
.apq-lv-seg-btn[aria-checked="true"], .apq-lv-seg-btn[aria-checked="true"]:hover{ color: rgb(var(--apq-on-ink)); background: rgb(var(--apq-ink)); }
.apq-lv-dir{
height: 26px; padding: 0 10px 0 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-ink)); background: rgba(var(--apq-ink),.07);
}
.apq-lv-dir:hover{ background: rgba(var(--apq-ink),.12); }
.apq-lv-dir .apq-ic{ width: 14px; height: 14px; }
.apq-lv-foot{
flex: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px;
border-top: 1px solid rgba(var(--apq-line),.08); font-size: 12.5px; color: rgb(var(--apq-muted));
}
.apq-lv-hint{ font-size: 12px; color: rgb(var(--apq-muted)); text-align: right; }

/* Group headings inside AniList's lists */
.apq-vgroup{
grid-column: 1 / -1; align-self: end; display: flex; align-items: center; gap: 8px; width: 100%; padding: 18px 2px 4px;
font-size: 13.5px; font-weight: 500; color: rgb(var(--apq-ink));
}
.medialist.table .apq-vgroup, .apq-flexcol > .apq-vgroup{ padding: 16px 20px 8px; }
.apq-vgrid{ grid-auto-rows: auto !important; grid-template-rows: none !important; }
.apq-vgrid > [data-apq-id]{ height: var(--apq-card-h) !important; }
.apq-vgrid > .apq-vgroup{ margin-bottom: calc(8px - var(--apq-row-gap, 0px)); }
.apq-vgroup-n{ font-size: 12.5px; font-weight: 500; color: rgb(var(--apq-muted)); }
.apq-vgroup-rule{ flex: 1; height: 1px; background: rgba(var(--apq-line),.1); }

/* ---------------- Poster mode (AniList's list pages; posters.js) ---------------- */
/* AniList's rows become the cells of a grid of covers: their own parts are hidden, a poster fills each.
 The same from AniList's list, compact and cards layouts. */
html[data-apq-posters] .medialist .list-entries{
display: grid !important; grid-template-columns: repeat(auto-fill, minmax(var(--apq-pw, 124px), 1fr)) !important; grid-template-rows: none !important; grid-auto-rows: auto !important;
gap: 14px !important; justify-content: normal !important; align-items: start !important; background: transparent !important; box-shadow: none !important;
}
html[data-apq-posters] .medialist .list-section{ background: transparent !important; box-shadow: none !important; }
html[data-apq-posters] .medialist .list-head{ display: none !important; }
html[data-apq-posters] .medialist [data-apq-pc]{
display: block !important; position: relative !important; width: auto !important; height: auto !important; min-width: 0 !important; aspect-ratio: 2 / 3;
margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 8px !important; background: transparent !important; box-shadow: none !important;
transition: transform .18s cubic-bezier(.2,.8,.2,1), opacity .15s !important;
}
html[data-apq-posters] .medialist [data-apq-pc][data-apq-vhide], html[data-apq-posters] .medialist [data-apq-pc][data-apq-gone]{ display: none !important; }
html[data-apq-posters] .medialist [data-apq-pc] > :not(.apq-ui){ display: none !important; }
/* AniList styles every part of a row (padding, centred text, flex): the poster takes none of it. */
html[data-apq-posters] .medialist [data-apq-pc] > .apq-pc{ display: block !important; padding: 0 !important; text-align: left !important; }
/* (on phones AniList puts a "Label:" before every part of a row) */
html[data-apq-posters] .medialist [data-apq-pc] > .apq-pc::before{ content: none !important; }
html[data-apq-posters] .medialist .section-name{ padding-left: 0 !important; }
html[data-apq-posters] .medialist .apq-vgrid > [data-apq-pc]{ height: auto !important; }
html[data-apq-posters] .medialist .list-entries > .apq-vgroup{ padding: 10px 2px 0; }
[data-apq-pc] > .apq-badge.is-card{ top: 6px; left: 6px; }
/* Lists with priorities off: the poster's own star opens the same popover (no look-alike second star) */
[data-apq-pc] > .apq-badge.is-lite{ display: none !important; }
@media (max-width: 760px){
html[data-apq-posters] .medialist .list-entries{ grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)) !important; gap: 12px 10px !important; }
}

/* The poster: the popup's poster card (0.8.5). The cover is the card: 8 px corners, the title on a soft shade at
 its foot with the episode line under it, "3 new" at the top right; on hover or keyboard focus, where you are and the
 one action slide in under the title, the score star and AniList's "···" at the top right. The poster is a container,
 so every size from the slider looks made for it. */
.apq-pc{
position: absolute; inset: 0; display: block; border-radius: 8px; overflow: hidden; background: rgb(var(--apq-sunken)); color: #fff;
container-type: inline-size; container-name: apqpc;
}
.apq-pc::after{ content: ""; position: absolute; inset: 0; z-index: 3; border-radius: inherit; box-shadow: inset 0 0 0 1px rgba(var(--apq-line),.08); pointer-events: none; }
.apq-pc-cover{ position: absolute; inset: 0; display: block; border-radius: inherit; cursor: pointer; }
.apq-pc-cover img{ width: 100%; height: 100%; object-fit: cover; display: block; transition: filter .2s; -webkit-user-drag: none; }
.apq-pc .apq-pc-cover:focus-visible{ outline: none; }
.apq-pc:has(.apq-pc-cover:focus-visible){ outline: 2px solid rgb(var(--apq-acc)); outline-offset: 2px; }
.apq-pc.is-done .apq-pc-cover img{ filter: saturate(.55) brightness(.8); }
.apq-pc-tag, .apq-pc-act, .apq-pc-edit, .apq-pc-star{
color: #fff; background: rgba(11,16,26,.62); box-shadow: 0 0 0 1px rgba(255,255,255,.12);
}
/* Glass: blurred only while it shows on the poster you point at; "3 new", there at rest, is tinted a little more
 instead (a blur on every poster's label is a layer each to redraw while scrolling: 0.12.8, as the card badge). */
.apq-pc-tag{ background: rgba(11,16,26,.8); }
[data-apq-pc]:hover :is(.apq-pc-act, .apq-pc-edit, .apq-pc-star), .apq-pc:has(:focus-visible) :is(.apq-pc-act, .apq-pc-edit, .apq-pc-star){
-webkit-backdrop-filter: blur(8px) saturate(1.3); backdrop-filter: blur(8px) saturate(1.3);
}
.apq-pc-tag{
position: absolute; top: 6px; right: 6px; z-index: 2; height: 20px; padding: 1px 6px 0; border-radius: 5px;
display: inline-flex; align-items: center; gap: 5px; pointer-events: none; transition: opacity .15s;
font-size: 11px; font-weight: 500; line-height: 1; white-space: nowrap;
}
.apq-pc-tag.is-new::before{ content: ""; width: 6px; height: 6px; margin-top: -1px; border-radius: 50%; background: rgb(var(--apq-title)); box-shadow: 0 0 0 1px rgba(255,255,255,.35); }
.apq-pc-top{ position: absolute; top: 6px; right: 6px; z-index: 2; display: flex; gap: 4px; }
.apq-pc-star{
height: 22px; padding: 1px 6px 0; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
font-size: 11.5px; font-weight: 500; line-height: 1;
}
.apq-pc-star .apq-ic{ width: 12px; height: 12px; margin-top: -1px; }
.apq-pc-star.has-score .apq-ic{ fill: currentColor; }
.apq-pc-star-n:empty{ display: none; }
.apq-pc-star:hover, .apq-pc-edit:hover{ background: rgba(11,16,26,.86); }
.apq-pc-edit{ width: 28px; height: 22px; border-radius: 5px; display: grid; place-items: center; cursor: pointer; }
.apq-pc-edit .apq-ic{ width: 15px; height: 15px; }
/* The foot: the title on a shade, then (on hover) the warning, where you are and the action, then the line */
.apq-pc-cap{
position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; display: flex; flex-direction: column;
padding: 34% 8px 8px; pointer-events: none;
background: linear-gradient(to top, rgba(11,16,26,.9) 0%, rgba(11,16,26,.7) 38%, rgba(11,16,26,0) 100%);
}
.apq-pc-name{
font-size: clamp(12px, 7.2cqw, 16px); font-weight: 500; line-height: 1.25; overflow-wrap: anywhere; text-shadow: 0 1px 2px rgba(0,0,0,.35);
display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.apq-pc-more{ display: grid; grid-template-rows: 0fr; transition: grid-template-rows .18s cubic-bezier(.2,.8,.2,1); }
.apq-pc-more-in{ min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.apq-pc-more-in > *{ opacity: 0; transition: opacity .15s; }
.apq-pc-warn{ display: flex; align-items: flex-start; gap: 4px; padding-top: 6px; font-size: 11px; font-weight: 500; line-height: 1.3; color: rgb(245,170,66); }
.apq-pc-warn[hidden]{ display: none; }
.apq-pc-warn .apq-ic{ width: 12px; height: 12px; margin-top: 1px; stroke-width: 2.4; flex: none; }
.apq-pc-row{ display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.apq-pc-facts{ flex: 1; min-width: 0; padding-top: 7px; font-size: 12px; font-weight: 400; color: rgba(255,255,255,.82); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-pc-facts b{ font-weight: 500; color: #fff; }
.apq-pc-facts .v-long > * + *{ margin-left: 8px; }
.apq-pc-act{
pointer-events: auto; flex: none; margin: 7px 0 0 auto; height: 26px; min-width: 36px; padding: 1px 9px 0; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; cursor: pointer;
font-size: 12.5px; font-weight: 500; box-shadow: 0 0 0 1px rgba(255,255,255,.18); transition: background-color .12s, color .12s, transform .1s;
}
.apq-pc-act.is-start{ min-width: 28px; padding: 1px 7px 0; }
.apq-pc-act:hover:not(:disabled){ background: rgb(var(--apq-title)); color: rgb(var(--apq-on-title)); box-shadow: none; }
.apq-pc-act:active:not(:disabled){ transform: scale(.95); }
.apq-pc-act:disabled{ cursor: default; }
.apq-pc-act .apq-ic, .apq-pc-act .apq-spin{ width: 12px; height: 12px; }
.apq-pc-band{ margin-top: 7px; }
.apq-pc-band[hidden]{ display: none; }
.apq-pc-band .apq-track{ height: 3px; background: rgba(255,255,255,.22); }
.apq-pc-band .apq-track > .apq-track-out{ background: rgba(var(--apq-title),.45); }
/* Words only where there's room beside the button: "Ep 9 of 24" and "Start" on big posters, "9/24" and the
 play icon on the others */
.apq-pc .v-long{ display: none; }
@container apqpc (min-width: 150px){
.apq-pc .v-long{ display: inline; }
.apq-pc .v-short{ display: none; }
.apq-pc-act.is-start{ padding: 1px 9px 0; }
}
@container apqpc (max-width: 90px){
.apq-pc-cap{ padding: 0 5px 5px; background: none; }
.apq-pc-name, .apq-pc-facts, .apq-pc-warn{ display: none !important; }
.apq-pc-band{ margin: 0 -5px -5px; padding: 3px 5px; background: rgba(11,16,26,.74); }
.apq-pc-act{ margin-bottom: 5px; height: 24px; min-width: 30px; padding: 1px 6px 0; font-size: 12px; }
}
@container apqpc (min-width: 190px){
.apq-pc-tag{ top: 9px; right: 9px; height: 24px; padding: 1px 8px 0; font-size: 12.5px; }
.apq-pc-top{ top: 9px; right: 9px; gap: 6px; }
.apq-pc-star{ height: 26px; padding: 1px 8px 0; font-size: 13px; }
.apq-pc-edit{ width: 32px; height: 26px; }
.apq-pc-cap{ padding: 30% 12px 12px; }
.apq-pc-facts{ font-size: 13px; padding-top: 8px; }
.apq-pc-act{ margin-top: 8px; height: 30px; min-width: 44px; padding: 1px 12px 0; font-size: 13.5px; }
.apq-pc-band{ margin-top: 10px; }
.apq-pc-band .apq-track{ height: 4px; }
}
/* Out of the way until you point at the cover (the hover pieces aren't drawn at rest: no blur to pay for) */
.apq-pc-top > *{ opacity: 0; visibility: hidden; transition: opacity .15s, visibility 0s linear .15s, background-color .12s; }
[data-apq-pc]:hover .apq-pc-top > *, .apq-pc:has(:focus-visible) .apq-pc-top > *{ opacity: 1; visibility: visible; transition-delay: 0s; }
[data-apq-pc]:hover .apq-pc-more, .apq-pc:has(:focus-visible) .apq-pc-more, .apq-pc:has(.apq-pc-act:disabled) .apq-pc-more{ grid-template-rows: 1fr; }
[data-apq-pc]:hover .apq-pc-more-in > *, .apq-pc:has(:focus-visible) .apq-pc-more-in > *, .apq-pc:has(.apq-pc-act:disabled) .apq-pc-more-in > *{ opacity: 1; }
[data-apq-pc]:hover .apq-pc-tag, .apq-pc:has(:focus-visible) .apq-pc-tag{ opacity: 0; }
/* Those parts are added the first time you point at a poster (posters.js, 0.12.8): they start from how they look at
 rest, so they slide and fade in that first time too. */
@starting-style{
[data-apq-pc]:hover .apq-pc-more, .apq-pc:has(:focus-visible) .apq-pc-more{ grid-template-rows: 0fr; }
[data-apq-pc]:hover .apq-pc-more-in > *, .apq-pc:has(:focus-visible) .apq-pc-more-in > *, [data-apq-pc]:hover .apq-pc-top > *, .apq-pc:has(:focus-visible) .apq-pc-top > *{ opacity: 0; }
}
@media (hover: none){
.apq-pc-more{ grid-template-rows: 1fr; }
.apq-pc-more-in > *{ opacity: 1; }
}
html.apq-selecting .apq-pc-more, html.apq-selecting .apq-pc-top{ display: none; }
/* The size slider, just left of AniList's layout buttons, in the same panel color */
.apq-psize{
position: absolute; right: calc(100% + 10px); top: 0; height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-radius: 4px;
background: rgb(var(--color-foreground, var(--apq-surface))); color: rgb(var(--color-text-lighter, var(--apq-muted)));
}
.apq-psize .apq-ic{ width: 15px; height: 15px; flex: none; }
.apq-psize-range{ width: 96px; height: 16px; margin: 0; cursor: pointer; accent-color: rgb(var(--color-blue, var(--apq-acc))); }
.apq-psize .apq-psize-range:focus{ outline: none; }
.apq-psize .apq-psize-range:focus-visible{ outline: 2px solid rgb(var(--apq-acc)); outline-offset: 3px; border-radius: 4px; }
@media (max-width: 760px){ .apq-psize{ display: none; } }

/* Dragging a poster among the others of its priority (order.js) */
html.apq-dragging, html.apq-dragging *{ cursor: grabbing !important; user-select: none !important; -webkit-user-select: none !important; }
html.apq-dragging .apq-pc-more, html.apq-dragging .apq-pc-top{ display: none; }
html[data-apq-reorder="on"] .medialist [data-apq-pc]:not([data-apq-peer]){ opacity: .32; }
html[data-apq-posters] .medialist [data-apq-pc][data-apq-drag]{ z-index: 1200; transition: none !important; }
html[data-apq-posters] .medialist [data-apq-pc][data-apq-drag="land"]{ transition: transform .18s cubic-bezier(.2,.8,.2,1) !important; }
html[data-apq-reorder="settle"] .medialist [data-apq-pc]:not([data-apq-drag]){ transition: none !important; }
[data-apq-drag] > .apq-pc{ transform: scale(1.04); box-shadow: 0 0 0 2px rgba(255,255,255,.92), 0 22px 44px -14px rgba(0,0,0,.7); }
@media (prefers-reduced-motion: reduce){
html[data-apq-posters] .medialist [data-apq-pc]{ transition: none !important; }
}

/* ---------------- Toasts ---------------- */
.apq-toast{
position: fixed; left: 50%; bottom: 24px; z-index: 9999; display: flex; align-items: center; gap: 9px;
max-width: min(520px, calc(100vw - 32px)); min-height: 40px; padding: 7px 14px 7px 12px; border-radius: 10px;
background: rgb(var(--apq-ink)); color: rgb(var(--apq-on-ink)); font-size: 13px; font-weight: 500;
box-shadow: 0 14px 34px -12px rgba(0,0,0,.5);
opacity: 0; transform: translate(-50%, 8px); pointer-events: none;
transition: opacity .18s var(--apq-ease), transform .2s var(--apq-ease), bottom .22s var(--apq-ease);
}
html.apq-selecting .apq-toast{ bottom: 90px; }
.apq-toast.is-open{ opacity: 1; transform: translate(-50%, 0); }
.apq-toast.has-action.is-open{ pointer-events: auto; }
.apq-toast.has-action{ padding-right: 5px; }
.apq-toast .apq-ic{ width: 15px; height: 15px; stroke-width: 2.6; color: rgb(var(--apq-good)); }
html:not([data-apq-panel="dark"]) .apq-toast .apq-ic{ color: rgb(110,214,150); }
html[data-apq-panel="dark"] .apq-toast .apq-ic{ color: rgb(30,140,76); }
.apq-toast.is-error .apq-ic{ color: rgb(255,128,150) !important; }
html[data-apq-panel="dark"] .apq-toast.is-error .apq-ic{ color: rgb(196,40,72) !important; }
.apq-toast-dot{ width: 9px; height: 9px; flex: none; border-radius: 50%; background: rgb(var(--apq-title)); box-shadow: 0 0 0 1.5px rgba(var(--apq-on-ink),.5); }
.apq-toast-msg{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apq-toast.is-error .apq-toast-msg{ white-space: normal; line-height: 1.4; }
.apq-toast-btn{
flex: none; height: 28px; padding: 0 10px; border-radius: 6px; display: grid; place-items: center; cursor: pointer; white-space: nowrap;
font-size: 12.5px; font-weight: 500; color: inherit; background: rgba(var(--apq-on-ink),.12);
}
.apq-toast-msg + .apq-toast-btn{ margin-left: 6px; }
.apq-toast-btn:hover{ background: rgba(var(--apq-on-ink),.2); }

/* ---------------- Motion: only in answer to something you did ---------------- */
@keyframes apq-rot{ to{ transform: rotate(360deg); } }
@keyframes apq-pop-in{ from{ opacity: 0; transform: scale(.7); } to{ opacity: 1; transform: none; } }
@keyframes apq-flash{ 0%{ background-color: rgba(var(--apq-ink),.1); } 100%{ background-color: transparent; } }
@keyframes apq-land{ 0%{ transform: translateY(8px) scale(.95); } 60%{ transform: translateY(-2px) scale(1.01); } 100%{ transform: none; } }
@keyframes apq-brighten{ 0%{ filter: none; } 40%{ filter: brightness(1.45) saturate(1.15); } 100%{ filter: none; } }
@keyframes apq-tick{ from{ transform: translateY(45%); opacity: 0; } to{ transform: none; opacity: 1; } }

@media (max-height: 700px){
.apq-pick-cover{ width: 112px; }
.apq-pick-stage{ padding-top: 14px; }
.apq-pick-namebox{ margin-top: 10px; min-height: 0; }
.apq-pick-name{ font-size: 22px; }
.apq-pick-actions{ padding-top: 14px; }
}
@media (max-height: 560px){
.apq-pick-cover{ width: 80px; }
}
@media (max-width: 760px){
.apq-bar{ gap: 8px; padding-left: 12px; }
.apq-bar-label, .apq-bar-link{ display: none; }
.apq-bar-sel{ min-width: 0; }
.apq-bar .apq-chip{ min-width: 28px; padding: 0 6px; }
}
@media (max-width: 560px){
.apq-mrow{ grid-template-columns: 1fr; gap: 8px; }
.apq-mrow-label{ padding-top: 0; }
.apq-mass{ max-height: calc(100vh - 16px); width: calc(100vw - 16px); }
.apq-mass-body{ padding: 4px 16px 14px; }
.apq-mass-foot{ padding: 10px 12px 12px 16px; }
.apq-mass-head{ padding: 14px 10px 12px 16px; }
.apq-bar-edit span{ display: none; }
.apq-bar-edit{ padding: 0 12px; }
.apq-drawer{ top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; height: min(84vh, 700px); transform: translateY(16px); }
.apq-rail{ width: 48px; padding: 10px 0; }
.apq-rail-btn{ width: 36px; height: 36px; }
.apq-mark{ width: 32px; height: 32px; }
.apq-mark .apq-tsugi{ width: 28px; height: 28px; }
.apq-dh{ padding: 14px 12px 10px; }
.apq-body{ padding: 0 6px 12px; }
.apq-row{ gap: 8px; }
.apq-row-link{ gap: 10px; }
/* Narrow: the priority stepper keeps just its number (tap it to type one), so titles keep their room */
.apq-stepper:not(.apq-pinctl){ padding: 2px; }
.apq-stepper:not(.apq-pinctl) .apq-step{ display: none; }
.apq-stepper:not(.apq-pinctl) .apq-step-val{ min-width: 30px; }
.apq-dock{ right: 14px; bottom: 14px; }
.apq-dock.is-left{ left: 14px; }
.apq-hint{ display: none; }
.apq-df{ justify-content: flex-end; padding: 10px 12px; }
.apq-set-field{ flex-direction: column; align-items: stretch; gap: 6px; }
.apq-set-field .apq-seg{ flex: none; }
.apq-bar{
  left: 8px !important; right: 8px; bottom: 8px; height: auto; max-width: none; flex-wrap: wrap; justify-content: space-between;
  gap: 10px; padding: 10px; transform: translateY(14px);
}
.apq-bar.is-on{ transform: none; }
.apq-bar-sep{ display: none; }
.apq-bar-sel{ padding-left: 6px; }
.apq-bar-set{ order: 3; width: 100%; }
.apq-bar-chips{ flex: 1; }
.apq-bar .apq-chip{ flex: 1; min-width: 0; padding: 0; }
html.apq-selecting .apq-toast{ bottom: 128px; }
}
@media (prefers-reduced-motion: reduce){
.apq-ui, .apq-ui *, .apq-ui *::before, .apq-ui *::after{ animation-duration: .01ms !important; animation-delay: 0s !important; transition-duration: .01ms !important; }
}
`;
