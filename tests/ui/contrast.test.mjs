// Contraste (WCAG 2.x), ARCHITECTURE_V2 D10 : texte >= 4,5:1, formes graphiques >= 3:1. Les rapports sont recalculés ici depuis theme.js,
// colors.js (teintes de la lumière) et le CSS de index.html ; les valeurs attendues sont celles de docs/proto-v2/out/contrast.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAPTER_COLORS } from '../../src/ui/menu.js';
import { THEME } from '../../src/render/theme.js';

/** '#rrggbb' ou 'rgba(r,g,b,a)' / 'rgb(r,g,b)' vers {r,g,b,a}. */
export function parseColor(text) {
  const t = text.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^#([0-9a-f]{3})$/i.exec(t);
  if (m) {
    const [r, g, b] = [...m[1]].map((h) => parseInt(h + h, 16));
    return { r, g, b, a: 1 };
  }
  m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(t);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error(`couleur illisible : ${text}`);
}

function channel(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** Rapport de contraste d'une couleur (avec son opacité) posée sur un fond opaque. */
export function contrast(fgText, bgText) {
  const bg = parseColor(bgText);
  const fg = parseColor(fgText);
  const mixed = { r: bg.r * (1 - fg.a) + fg.r * fg.a, g: bg.g * (1 - fg.a) + fg.g * fg.a, b: bg.b * (1 - fg.a) + fg.b * fg.a };
  const l1 = luminance(mixed);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/** Couleur `top` (avec opacité) posée sur `bottom` (opaque) : couleur opaque résultante. */
export function over(top, bottom) {
  const t = parseColor(top), b = parseColor(bottom);
  const c = (k) => b[k] * (1 - t.a) + t[k] * t.a;
  return `rgb(${c('r')},${c('g')},${c('b')})`;
}
/** CSS de index.html, variables de :root résolues. */
function readCss() {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const css0 = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const vars = Object.fromEntries([...css0.matchAll(/(--[a-z]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  return { vars, css: css0.replace(/var\((--[a-z]+)\)/g, (all, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : all)) };
}
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 0.02, `${msg} : ${actual.toFixed(2)} attendu ${expected}`);

test('contraste : le calcul reproduit les valeurs connues (blanc/noir 21:1, D10)', () => {
  assert.ok(Math.abs(contrast('#ffffff', '#000000') - 21) < 0.01);
  near(contrast(THEME.fg, THEME.bg), 17.68, 'texte principal');
  near(contrast(THEME.textDim, THEME.bg), 6.25, 'texte secondaire à 62 %');
  assert.ok(contrast('rgba(222,226,255,0.5)', THEME.bg) < 4.5, 'à 50 % : 4,38:1, refusé (D10)');
});

test('contraste : texte du canevas (theme.js) >= 4,5:1', () => {
  for (const [name, color] of [['fg', THEME.fg], ['textDim', THEME.textDim], ['accentLight', THEME.accentLight], ['accent', THEME.accent], ['white', THEME.white]]) {
    const ratio = contrast(color, THEME.bg);
    assert.ok(ratio >= 4.5, `${name} ${color} : ${ratio.toFixed(2)}:1`);
  }
  near(contrast(THEME.accentLight, THEME.bg), 11.64, 'accent clair');
  near(contrast(THEME.accent, THEME.bg), 6.15, 'accent');
});

test('contraste D10 : les 7 teintes de faisceau et de cible sur le fond >= 3:1 ; le glyphe foncé sur une cible allumée >= 4,5:1', () => {
  const expected = [null, 6.23, 15.38, 13.87, 6.26, 6.52, 12.69, 20.02]; // indices = masques 1..7
  for (let m = 1; m <= 7; m++) {
    const hue = THEME.hues[m];
    near(contrast(hue, THEME.bg), expected[m], `teinte ${THEME.names[m]} sur le fond`);
    assert.ok(contrast(hue, THEME.bg) >= 3);
    assert.ok(contrast(THEME.ink, hue) >= 4.5, `glyphe sur ${THEME.names[m]} : ${contrast(THEME.ink, hue).toFixed(2)}`);
    assert.ok(contrast(hue, '#0d0e2a') >= 3, `contour ${THEME.names[m]} sur le verre`);
  }
});

test('contraste D10 : formes graphiques (verre mobile, curseur, bordure de bouton, porte, portails) >= 3:1', () => {
  near(contrast(THEME.glassContour, THEME.bg), 3.63, 'contour du verre mobile');
  near(contrast(THEME.accentLight, THEME.bg), 11.64, 'curseur clavier');
  assert.ok(contrast(THEME.buttonBorder, THEME.bg) >= 3, `bordure de bouton : ${contrast(THEME.buttonBorder, THEME.bg).toFixed(2)}`);
  assert.ok(contrast(THEME.gate, THEME.bg) >= 3, 'porte');
  for (const h of THEME.portalHues) assert.ok(contrast(h, THEME.bg) >= 3, `portail ${h}`);
});

test('contraste : toutes les couleurs de texte et d\'icônes du CSS de index.html >= 4,5:1 ; focus >= 3:1', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const css0 = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  // variables CSS de :root remplacées par leur valeur : le test lit ce que le navigateur applique
  const vars = Object.fromEntries([...css0.matchAll(/(--[a-z]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const css = css0.replace(/var\((--[a-z]+)\)/g, (all, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : all));
  const found = [...css.matchAll(/(?<![-\w])color:\s*(rgba?\([^)]*\)|#[0-9a-fA-F]{3,6})/g)].map((m) => m[1]);
  assert.ok(found.length >= 5, `couleurs de texte trouvées : ${found.length}`);
  for (const color of found) {
    const ratio = contrast(color, THEME.bg);
    assert.ok(ratio >= 4.5, `${color} : ${ratio.toFixed(2)}:1`);
  }
  const outline = /outline:\s*\d+px solid (#[0-9a-fA-F]{6})/.exec(css);
  assert.ok(outline, 'anneau de focus déclaré');
  assert.ok(contrast(outline[1], THEME.bg) >= 3);
  const borders = [...css.matchAll(/border(?:-color)?:\s*(?:\d+(?:\.\d+)?px solid )?(rgba\([^)]*\)|#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
  assert.ok(borders.length >= 3, 'bordures déclarées');
  const buttonBorder = /\.btn \{[^}]*border:\s*1px solid (rgba\([^)]*\))/.exec(css);
  assert.ok(buttonBorder && contrast(buttonBorder[1], THEME.bg) >= 3, 'bordure des boutons (P9 : >= 3:1, la maquette était à 1,44)');
  // V11 : l'ancienne grille de tuiles (bordure >= 3:1) est remplacée par des lignes de texte ; le focus de l'accueil est un anneau blanc
  assert.match(css, /#screen-menu :focus-visible \{ outline: 2px solid #ffffff/, 'accueil : anneau de focus blanc de 2 px (21:1 sur le fond)');
});

test('V3-33 : texte et icônes sur les plaques de verre (couleurs réelles du CSS), aux deux opacités de V3-23', () => {
  const { css } = readCss();
  const m = /\.plate \{ background: rgba\((\d+), (\d+), (\d+), var\(--plate, \.3\)\)/.exec(css);
  assert.ok(m, 'plaque de verre déclarée');
  const plate = (a) => `rgba(${m[1]},${m[2]},${m[3]},${a})`;
  const text = THEME.fg;
  const icon = /\.ui-btn \{[^}]*?[^-]color: (rgba\([^)]*\))/.exec(css)[1];
  for (const [a, under] of [[0.3, THEME.bg], [0.7, THEME.bg], [0.7, '#ffffff']]) {
    const bg = over(plate(a), under);
    assert.ok(contrast(text, bg) >= 4.5, `texte sur plaque ${a} / ${under} : ${contrast(text, bg).toFixed(2)}:1`);
    assert.ok(contrast(icon, bg) >= 3, `icône sur plaque ${a} / ${under} : ${contrast(icon, bg).toFixed(2)}:1`);
  }
  near(contrast(text, over(plate(0.66), '#ffffff')), 5.92, 'V3-23 : plaque à 0,66 sur faisceau blanc');
  assert.ok(contrast(text, over(plate(0.55), '#ffffff')) < 4.5, 'V3-23 : 0,55 reste insuffisant sur faisceau blanc');
});

test('V11 : accueil et ses écrans : texte posé sur le fond nu (la scène est effacée sous le texte) >= 4,5:1', () => {
  const { vars, css } = readCss();
  const bg = /#screen-menu \{[^}]*background: (#[0-9a-f]{6})/.exec(css);
  assert.ok(bg, "fond de l'accueil déclaré");
  assert.equal(bg[1].toLowerCase(), THEME.bg.toLowerCase(), 'fond = celui du jeu');
  for (const [name, c] of [['texte', vars['--fg']], ['texte secondaire', vars['--dim']], ['étoile or', vars['--gold']], ['coche du défi', '#3dffb0'], ['étoile non gagnée', 'rgba(222, 226, 255, .62)']]) {
    assert.ok(contrast(c, bg[1]) >= 4.5, `${name} ${c} : ${contrast(c, bg[1]).toFixed(2)}:1`);
  }
  // le masque de la scène efface la lumière sous le bloc de texte (home-scene.js : destination-out puis le fond) : le pire cas est le fond lui-même
  assert.match(css, /#home-scene \{[^}]*pointer-events: none/, 'la scène ne prend aucun geste');
  for (const c of CHAPTER_COLORS) assert.ok(contrast(c, bg[1]) >= 3, `dessin de chapitre ${c} : ${contrast(c, bg[1]).toFixed(2)}:1`);
});

test('V3-33 : réglages (fond de fenêtre) : texte, segment choisi et interrupteur', () => {
  const { vars, css } = readCss();
  const panel = over(/dialog#dlg-settings, dialog\.dlg \{[^}]*background: (rgba\([^)]*\))/.exec(css)[1], '#ffffff'); // pire cas : fenêtre posée sur du blanc
  assert.ok(contrast(vars['--fg'], panel) >= 4.5, `texte : ${contrast(vars['--fg'], panel).toFixed(2)}:1`);
  assert.ok(contrast(vars['--dim'], panel) >= 4.5, `petit texte : ${contrast(vars['--dim'], panel).toFixed(2)}:1`);
  const segOn = over('rgba(130, 110, 255, .55)', panel);
  assert.ok(contrast('#ffffff', segOn) >= 4.5, `segment choisi : ${contrast('#ffffff', segOn).toFixed(2)}:1`);
  assert.ok(css.includes('.seg input:checked + span { background: rgba(130, 110, 255, .55); color: #ffffff; }'), 'le test lit la couleur réelle du segment choisi');
  assert.ok(contrast('#b8bce8', over('rgba(20, 22, 60, .8)', panel)) >= 3, 'interrupteur éteint : pastille >= 3:1');
});

test('contraste J5 : couleurs de chapitre (titres, étoiles, verrous) et étoiles de victoire >= 4,5:1 sur le fond', () => {
  for (const c of CHAPTER_COLORS) assert.ok(contrast(c, THEME.bg) >= 4.5, `${c} : ${contrast(c, THEME.bg).toFixed(2)}:1`);
  assert.ok(contrast('#ffd23f', THEME.bg) >= 4.5, 'étoile gagnée');
  assert.ok(contrast('rgba(222, 226, 255, .62)', THEME.bg) >= 4.5, 'étoile non gagnée et texte secondaire');
});
