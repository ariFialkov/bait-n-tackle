// The HUD's icons: one family of stroke glyphs, drawn in the style of the
// auto reel button (a 26-unit box, round-capped 1.8 strokes, no fill), so
// every button and chip reads the same. `icon(name)` returns the SVG as a
// string for innerHTML; `putIcons(root)` fills every `[data-icon]` element.

const P = (paths) => paths;
const ICONS = {
  // --- the HUD's buttons and chips ---
  sail: P(`<path d="M13 3 v19"/><path d="M13 4 L21 15 H13"/><path d="M13 7 L7 15 H13"/><path d="M4 19 h18 l-2.5 3.5 H6.5 Z"/>`),
  book: P(`<path d="M13 6.5 C10 4.5 6.5 4.5 3.5 5.5 V20 C6.5 19 10 19 13 21 Z"/><path d="M13 6.5 C16 4.5 19.5 4.5 22.5 5.5 V20 C19.5 19 16 19 13 21 Z"/><path d="M13 6.5 V21"/>`),
  close: P(`<path d="M7 7 L19 19"/><path d="M19 7 L7 19"/>`),
  round: P(`<path d="M6.5 13 a6.5 6.5 0 1 0 2.2 -4.9"/><path d="M6 4.5 V9 H10.5"/>`),
  menu: P(`<path d="M5 8 H21"/><path d="M5 13 H21"/><path d="M5 18 H21"/>`),
  anchor: P(`<circle cx="13" cy="5" r="2.2"/><path d="M13 7.2 V22"/><path d="M8 11 H18"/><path d="M4.5 15 a8.5 8.5 0 0 0 17 0"/><path d="M4.5 15 l2.5 -1.5"/><path d="M21.5 15 l-2.5 -1.5"/>`),
  arrow: P(`<path d="M4 13 H21"/><path d="M15 7 L21 13 L15 19"/>`),
  sonar: P(`<path d="M4.5 13 a8.5 8.5 0 0 1 17 0"/><path d="M8 13 a5 5 0 0 1 10 0"/><circle cx="13" cy="13" r="1.6"/><path d="M13 14.5 V22"/><path d="M8.5 22 h9"/>`),
  rod: P(`<path d="M4 22 L18 5"/><path d="M18 5 C21 3.5 22.5 6 21 8"/><path d="M21 8 V15 a2.8 2.8 0 0 1 -5.6 0"/><circle cx="7.5" cy="18.5" r="1.9"/>`),
  net: P(`<path d="M4 6 H22"/><path d="M4 6 C4 16 7 21 13 22 C19 21 22 16 22 6"/><path d="M8.5 6 C8.5 14 10.5 19 13 21"/><path d="M17.5 6 C17.5 14 15.5 19 13 21"/><path d="M4.8 11.5 H21.2"/><path d="M6.5 16.5 H19.5"/>`),
  pot: P(`<rect x="4" y="9" width="18" height="12" rx="2"/><path d="M4 13 H22"/><path d="M4 17 H22"/><path d="M9 9 V21"/><path d="M13 9 V21"/><path d="M17 9 V21"/><path d="M9 9 C9 5.5 17 5.5 17 9"/><path d="M13 3.5 V6"/>`),
  gear: P(`<circle cx="13" cy="13" r="3.2"/><path d="M13 3.5 V6.5 M13 19.5 V22.5 M3.5 13 H6.5 M19.5 13 H22.5 M6.3 6.3 L8.4 8.4 M17.6 17.6 L19.7 19.7 M6.3 19.7 L8.4 17.6 M17.6 8.4 L19.7 6.3"/><circle cx="13" cy="13" r="7"/>`),
  tender: P(`<path d="M3.5 14 H22.5 L19.5 20 H6.5 Z"/><path d="M8 14 V10 H16 L18.5 14"/><path d="M11 10 V7"/><path d="M3 22 c2 -1.2 4 -1.2 6 0 c2 -1.2 4 -1.2 6 0 c2 -1.2 4 -1.2 6 0"/>`),
  spinner: P(`<path d="M13 4.5 a8.5 8.5 0 1 1 -8.5 8.5"/>`),
  // --- landmarks, on their pins ---
  peak: P(`<path d="M3 20 L10 8 L14 14 L17 10 L23 20 Z"/>`),
  hill: P(`<path d="M3 19 C7 11 12 9 16 12 C19 14 21 16 23 19 Z"/>`),
  beach: P(`<path d="M3 10 c2.5 -2 5 -2 7.5 0 c2.5 2 5 2 7.5 0 c1.5 -1.2 3 -1.6 5 -0.8"/><path d="M3 17 c2.5 -2 5 -2 7.5 0 c2.5 2 5 2 7.5 0 c1.5 -1.2 3 -1.6 5 -0.8"/>`),
  rock: P(`<path d="M5 19 L7 11 L12 7 L18 9 L21 15 L19 19 Z"/>`),
  dam: P(`<path d="M3 13 H23"/><path d="M5 9 H21"/><path d="M5 17 H21"/><path d="M8 9 V17 M13 9 V17 M18 9 V17"/>`),
  falls: P(`<path d="M8 4 V13 c0 4 -1.5 6 -4 8"/><path d="M13 4 V14 c0 4 -1 6 -3 8"/><path d="M18 4 V13 c0 4 1 6 4 8"/>`),
  point: P(`<path d="M13 3 L23 13 L13 23 L3 13 Z"/>`),
  // --- nets ---
  'net-skiff': P(`<path d="M4 6 H22"/><path d="M4 6 C4 16 7 21 13 22 C19 21 22 16 22 6"/><path d="M8.5 6 C8.5 14 10.5 19 13 21"/><path d="M17.5 6 C17.5 14 15.5 19 13 21"/><path d="M4.8 11.5 H21.2"/><path d="M6.5 16.5 H19.5"/>`),
  'net-gill': P(`<path d="M3 7 H23"/><circle cx="6" cy="7" r="1.6"/><circle cx="13" cy="7" r="1.6"/><circle cx="20" cy="7" r="1.6"/><path d="M4 9 V21 M9 9 V21 M13 9 V21 M17 9 V21 M22 9 V21"/><path d="M4 13 H22 M4 17 H22 M4 21 H22"/>`),
  'net-seine': P(`<path d="M3 6 C8 6 8 20 13 20 C18 20 18 6 23 6"/><path d="M3 6 V11 M23 6 V11"/><path d="M6.5 10 C9 12 10 16 13 16 C16 16 17 12 19.5 10"/><path d="M10 6.5 V19 M16 6.5 V19"/><circle cx="13" cy="21" r="1.2"/>`),
  'net-deep': P(`<path d="M4 5 L22 5 L18 12 H8 Z"/><path d="M8 12 L6 21 H20 L18 12"/><path d="M11 12 V21 M15 12 V21"/><path d="M6 16.5 H20"/>`),
  // --- pots ---
  'pot-crab': P(`<rect x="4" y="9" width="18" height="12" rx="2"/><path d="M4 13 H22"/><path d="M4 17 H22"/><path d="M9 9 V21"/><path d="M13 9 V21"/><path d="M17 9 V21"/><path d="M9 9 C9 5.5 17 5.5 17 9"/><path d="M13 3.5 V6"/>`),
  'pot-lobster': P(`<path d="M4 20 V11 C4 8 8 7 13 7 C18 7 22 8 22 11 V20 Z"/><path d="M4 20 H22"/><path d="M4 11 C6 14 9 15 13 15 C17 15 20 14 22 11"/><path d="M8 7.5 V20 M13 7 V20 M18 7.5 V20"/><path d="M13 3.5 V7"/>`),
  'pot-deep': P(`<rect x="5" y="6" width="16" height="16" rx="2"/><path d="M5 10 H21 M5 14 H21 M5 18 H21"/><path d="M9 6 V22 M13 6 V22 M17 6 V22"/><path d="M13 2.5 V6"/><circle cx="13" cy="14" r="2.2" fill="currentColor" stroke="none"/>`),
  // --- lures ---
  'lure-worm': P(`<path d="M4 16 C6 10 9 10 11 14 C13 18 16 18 18 13 C19.5 10 21 10 22.5 12"/><circle cx="4.5" cy="17" r="1.1" fill="currentColor" stroke="none"/>`),
  'lure-spinner': P(`<path d="M6 3.5 V9"/><path d="M6 9 L10 13"/><path d="M10 13 C7 16 7 21 10 22 C14 22 15 16 12.5 12.5 C11.5 11.5 10.5 12 10 13 Z"/><path d="M13 12 L20 5"/><path d="M20 5 a2.5 2.5 0 1 1 0 0.01"/><path d="M12 22 C14.5 22.5 16 21 16 19.5"/>`),
  'lure-spoon': P(`<path d="M9 3.5 V8"/><path d="M13 8 C6 8 5 20 13 22 C21 20 20 8 13 8 Z"/><path d="M11 12 C10 14 10 17 12 19"/>`),
  'lure-jig': P(`<circle cx="9" cy="6" r="2.6"/><path d="M11.5 6 L14 9 V16 a3 3 0 0 1 -6 0"/><path d="M12 9 L7 20 M13 10 L10 21 M14 11 L13 22 M15 11 L17 21"/>`),
  'lure-crank': P(`<path d="M5 12 C8 6 18 6 22 12 C18 18 8 18 5 12 Z"/><path d="M5 12 L3 9 M5 12 L3 15"/><circle cx="18" cy="11" r="1" fill="currentColor" stroke="none"/><path d="M12 18 V21 a2 2 0 0 0 4 0"/>`),
  'lure-shad': P(`<path d="M4 13 C8 7 17 7 21 13 C17 19 8 19 4 13 Z"/><path d="M21 13 L24 9 M21 13 L24 17"/><circle cx="7.5" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M12 8.5 C13 11 13 15 12 17.5"/>`),
  'lure-swimbait': P(`<path d="M3 13 C7 5 18 5 21 13 C18 21 7 21 3 13 Z"/><path d="M21 13 L25 7 M21 13 L25 19"/><circle cx="7" cy="12" r="1.1" fill="currentColor" stroke="none"/><path d="M11 7 C12.5 10.5 12.5 15.5 11 19"/><path d="M15 8 L14 4"/>`),
  'lure-trophy': P(`<path d="M8 4 H18 V10 a5 5 0 0 1 -10 0 Z"/><path d="M8 6 H4.5 a3.5 3.5 0 0 0 3.5 4"/><path d="M18 6 H21.5 a3.5 3.5 0 0 1 -3.5 4"/><path d="M13 15 V19"/><path d="M8.5 22 H17.5 V19 H8.5 Z"/>`),
};

/** An icon as inline SVG. `cls` is added to the svg's class list. */
export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS.rock;
  return `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Fill every element with a data-icon attribute under `root`, keeping its text. */
export function putIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.querySelector('svg.ico')) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, el.dataset.iconClass || ''));
  });
}

export const ICON_NAMES = Object.keys(ICONS);
