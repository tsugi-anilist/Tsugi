// Tsugi · Ready-made palettes (0.12): the popup's themes beyond AniList's three, and Tsugi's own panels on
// AniList (the hub, the title popover, Pick for me, Ctrl+K, mass edit, the selection bar, toasts, menus).
// AniList's own pages and the parts Tsugi adds to AniList's controls (badges, sidebar filters, posters, the top
// bar) keep AniList's theme: theming those is the theme studio (ROADMAP.md, batch 19).
// Loaded by popup.html before popup.js, and by the manifest before content/core.js: one copy of the colors.
// Names start with "palette" or PALETTE: the content scripts share one scope (tests/test_shared_names.py).
'use strict';

// Each palette fills the same tokens as AniList's themes (DESIGN.md, "Color"): Panel (surface), Night (sunken:
// wells, tracks, inputs), the popup's rail, Raised (menus, hovered rows), Ink (titles and selected fills), text,
// Mist (muted), hairlines (line), and the status colors. `acc` is the palette's own shade of each of AniList's
// seven profile colors, so the accent you picked keeps its name and looks at home (true black keeps AniList's).
// Colors are the palettes' published ones; where a palette has no shade for a role (a darker well, a softer
// text, a pink), the nearest of its own colors or a mix of two of them stands in.
const PALETTES = {
  latte: {
    name: 'Catppuccin Latte', v: 'Latte', fam: 'Catppuccin', tone: 'light',
    c: { surface: '#eff1f5', sunken: '#e6e9ef', rail: '#e6e9ef', raised: '#f8f9fb', ink: '#4c4f69', text: '#5c5f77', muted: '#6c6f85', line: '#4c4f69', good: '#40a02b', bad: '#d20f39', warn: '#c8620c' },
    acc: { blue: '#1e66f5', purple: '#8839ef', pink: '#ea76cb', orange: '#fe640b', red: '#d20f39', green: '#40a02b', gray: '#8c8fa1' },
  },
  frappe: {
    name: 'Catppuccin Frappé', v: 'Frappé', fam: 'Catppuccin', tone: 'dark',
    c: { surface: '#303446', sunken: '#232634', rail: '#292c3c', raised: '#414559', ink: '#c6d0f5', text: '#a5adce', muted: '#949cbb', line: '#c6d0f5', good: '#a6d189', bad: '#e78284', warn: '#ef9f76' },
    acc: { blue: '#8caaee', purple: '#ca9ee6', pink: '#f4b8e4', orange: '#ef9f76', red: '#e78284', green: '#a6d189', gray: '#838ba7' },
  },
  macchiato: {
    name: 'Catppuccin Macchiato', v: 'Macchiato', fam: 'Catppuccin', tone: 'dark',
    c: { surface: '#24273a', sunken: '#181926', rail: '#1e2030', raised: '#363a4f', ink: '#cad3f5', text: '#a5adcb', muted: '#939ab7', line: '#cad3f5', good: '#a6da95', bad: '#ed8796', warn: '#f5a97f' },
    acc: { blue: '#8aadf4', purple: '#c6a0f6', pink: '#f5bde6', orange: '#f5a97f', red: '#ed8796', green: '#a6da95', gray: '#8087a2' },
  },
  mocha: {
    name: 'Catppuccin Mocha', v: 'Mocha', fam: 'Catppuccin', tone: 'dark',
    c: { surface: '#1e1e2e', sunken: '#11111b', rail: '#181825', raised: '#313244', ink: '#cdd6f4', text: '#a6adc8', muted: '#9399b2', line: '#cdd6f4', good: '#a6e3a1', bad: '#f38ba8', warn: '#fab387' },
    acc: { blue: '#89b4fa', purple: '#cba6f7', pink: '#f5c2e7', orange: '#fab387', red: '#f38ba8', green: '#a6e3a1', gray: '#7f849c' },
  },
  dawn: {
    name: 'Rosé Pine Dawn', v: 'Dawn', fam: 'Rosé Pine', tone: 'light',
    c: { surface: '#fffaf3', sunken: '#f2e9e1', rail: '#faf4ed', raised: '#fffdf9', ink: '#575279', text: '#6e6a8e', muted: '#797593', line: '#575279', good: '#286983', bad: '#b4637a', warn: '#b8721c' },
    acc: { blue: '#286983', purple: '#907aa9', pink: '#d7827e', orange: '#ea9d34', red: '#b4637a', green: '#56949f', gray: '#9893a5' },
  },
  rosepine: {
    name: 'Rosé Pine', v: 'Main', fam: 'Rosé Pine', tone: 'dark',
    c: { surface: '#1f1d2e', sunken: '#191724', rail: '#1b1928', raised: '#26233a', ink: '#e0def4', text: '#b9b6d2', muted: '#908caa', line: '#e0def4', good: '#9ccfd8', bad: '#eb6f92', warn: '#f6c177' },
    acc: { blue: '#9ccfd8', purple: '#c4a7e7', pink: '#ebbcba', orange: '#f6c177', red: '#eb6f92', green: '#3e8fb0', gray: '#6e6a86' },
  },
  gruvlight: {
    name: 'Gruvbox Light', v: 'Light', fam: 'Gruvbox', tone: 'light',
    c: { surface: '#fbf1c7', sunken: '#f2e5bc', rail: '#f2e5bc', raised: '#f9f5d7', ink: '#3c3836', text: '#665c54', muted: '#7c6f64', line: '#3c3836', good: '#79740e', bad: '#9d0006', warn: '#af3a03' },
    acc: { blue: '#076678', purple: '#8f3f71', pink: '#b16286', orange: '#d65d0e', red: '#cc241d', green: '#98971a', gray: '#928374' },
  },
  gruvdark: {
    name: 'Gruvbox Dark', v: 'Dark', fam: 'Gruvbox', tone: 'dark',
    c: { surface: '#282828', sunken: '#1d2021', rail: '#222425', raised: '#3c3836', ink: '#ebdbb2', text: '#bdae93', muted: '#a89984', line: '#ebdbb2', good: '#b8bb26', bad: '#fb4934', warn: '#fe8019' },
    acc: { blue: '#83a598', purple: '#b16286', pink: '#d3869b', orange: '#fe8019', red: '#fb4934', green: '#b8bb26', gray: '#928374' },
  },
  nord: {
    name: 'Nord', tone: 'dark',
    c: { surface: '#2e3440', sunken: '#242933', rail: '#292e39', raised: '#3b4252', ink: '#eceff4', text: '#c0c8d6', muted: '#9aa3b5', line: '#eceff4', good: '#a3be8c', bad: '#d57780', warn: '#ebcb8b' },
    acc: { blue: '#88c0d0', purple: '#b48ead', pink: '#c895b4', orange: '#d08770', red: '#bf616a', green: '#a3be8c', gray: '#7b88a1' },
  },
  dracula: {
    name: 'Dracula', tone: 'dark',
    c: { surface: '#282a36', sunken: '#191a21', rail: '#21222c', raised: '#343746', ink: '#f8f8f2', text: '#c6c9da', muted: '#9ea8d0', line: '#f8f8f2', good: '#50fa7b', bad: '#ff5555', warn: '#ffb86c' },
    acc: { blue: '#8be9fd', purple: '#bd93f9', pink: '#ff79c6', orange: '#ffb86c', red: '#ff5555', green: '#50fa7b', gray: '#6272a4' },
  },
  tokyo: {
    name: 'Tokyo Night', tone: 'dark',
    c: { surface: '#1a1b26', sunken: '#13141c', rail: '#16161e', raised: '#24283b', ink: '#c0caf5', text: '#a9b1d6', muted: '#8089b3', line: '#c0caf5', good: '#9ece6a', bad: '#f7768e', warn: '#ff9e64' },
    acc: { blue: '#7aa2f7', purple: '#bb9af7', pink: '#f4a6d7', orange: '#ff9e64', red: '#f7768e', green: '#9ece6a', gray: '#737aa2' },
  },
  black: {
    name: 'True black', tone: 'dark',
    c: { surface: '#000000', sunken: '#121212', rail: '#000000', raised: '#1a1a1a', ink: '#f0f0f0', text: '#b8b8b8', muted: '#929292', line: '#ffffff', good: '#5cc480', bad: '#f06880', warn: '#f0ac48' },
    acc: null,
  },
};
// name: the whole name (Settings' summary, the hub's tooltip); v and fam: the tile's two lines in Settings > Look
// (the variant, then its family), for families with several.
// Settings > Look shows them in this order, in rows of four: Catppuccin light to dark, then light and dark
// pairs, then the dark ones.
const PALETTE_ORDER = ['latte', 'frappe', 'macchiato', 'mocha', 'dawn', 'rosepine', 'gruvlight', 'gruvdark', 'nord', 'dracula', 'tokyo', 'black'];

const paletteOf = (id) => (Object.prototype.hasOwnProperty.call(PALETTES, id) ? PALETTES[id] : null);

// "#1e1e2e" -> "30,30,46" (the tokens are r,g,b triplets, used as rgb(var(--x)) and rgba(var(--x),.5)).
function paletteHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function paletteLum(rgb) {
  const [r, g, b] = rgb.split(',').map((x) => {
    const v = Number(x) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function paletteContrast(a, b) {
  const x = paletteLum(a), y = paletteLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function paletteMix(a, b, share) {
  const y = b.split(',').map(Number);
  return a.split(',').map(Number).map((v, i) => Math.round(v * share + y[i] * (1 - share))).join(',');
}
// Dark ink or white on a solid fill of this color, whichever reads better.
const paletteOn = (rgb) => (paletteLum(rgb) > 0.25 ? '15,22,34' : '255,255,255');

// A title's cover color on a palette (DESIGN.md, "Title color rules", for any ground): if it's too close to the
// ground to read as text or a thin line (under 3:1), it moves a tenth at a time until it reads: toward the palette's
// own text color on a dark palette (a black cover turns Mocha's lavender gray, not pure white), toward black on a
// light one (black keeps a cream or yellow cover's hue as it deepens; Latte's gray-blue text would wash it out).
// `ground` and `toward` are r,g,b.
function paletteReadable(rgb, ground, toward, min = 3) {
  let out = rgb;
  for (let share = 0.9; paletteContrast(out, ground) < min && share >= 0.1; share -= 0.1) out = paletteMix(rgb, toward, share);
  return out;
}
function paletteTitle(rgb, p) {
  const t = paletteTokens(p);
  return paletteReadable(rgb, t.surface, p.tone === 'dark' ? t.ink : '0,0,0');
}

// The tokens of one palette as r,g,b, with the derived ones (text on Ink, on the accent, on the error color).
function paletteTokens(p) {
  const t = {};
  for (const [k, v] of Object.entries(p.c)) t[k] = paletteHex(v);
  t.onInk = t.surface;
  t.onBad = paletteOn(t.bad);
  return t;
}

// The accent on a palette: the palette's own shade of a named AniList color, else the color itself.
function paletteAccent(p, name, rgb) {
  return (p && p.acc && name && p.acc[name] && paletteHex(p.acc[name])) || rgb;
}
