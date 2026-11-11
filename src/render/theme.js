// Thème du style B « cristal coloré » (maquette docs/maquette-b/index.html, ARCHITECTURE_V2 D10).
// Les couleurs de lumière viennent du moteur (colors.js, E2). Toutes les tailles sont des fractions de la case (maquette : case de 62).
import { COLOR_HUES, COLOR_NAMES, COLOR_SYMBOLS } from '../engine/colors.js';

export const THEME = Object.freeze({
  bg: '#06061a',
  fg: '#eef0ff',
  white: '#ffffff',
  accent: '#8f7bff',
  accentRgb: '143,123,255',
  accentLight: '#c9bdff', // curseur clavier, sélection (11,64:1)
  ink: '#06061a', // glyphe foncé posé sur une teinte (cible allumée)
  // Texte secondaire : 62 % de #dee2ff (6,25:1). À 50 % on tombe à 4,38:1 : interdit (D10).
  textDim: 'rgba(222,226,255,0.62)',
  boardFill: '#0b0c2f', // rgba(14,15,46,.55) de la maquette posé sur le fond, rendu opaque
  editorBoardFill: '#0a0b22', // V8 : plateau de l'éditeur accordé au verre sombre de l'écran (V6 : le bleu nuit ressortait plus clair que le reste)
  boardBorder: 'rgba(154,166,255,0.28)',
  gridLine: 'rgba(154,166,255,0.08)',
  // Bordure de bouton : la maquette (22 %) donne 1,44:1 ; 60 % donne 3,73:1 (D10, écart assumé P9).
  buttonBorder: 'rgba(154,166,255,0.6)',
  glassContour: 'rgba(190,198,255,0.5)', // contour du verre mobile (3,63:1)
  fixedDot: 'rgba(200,206,255,0.6)', // quatre points d'une pièce fixe
  wallFill: '#191b45',
  wallStroke: 'rgba(154,166,255,0.4)',
  gate: '#ffb454', // porte et pastilles de la cible liée
  portalHues: Object.freeze(['#9aa6ff', '#ff9de0', '#9affc8', '#ffc89a']), // paire 0..3 (1 à 4 points)
  font: 'ui-sans-serif, system-ui, "Segoe UI", sans-serif',
  hues: COLOR_HUES,
  names: COLOR_NAMES,
  symbols: COLOR_SYMBOLS,
});

/** Géométrie relative à la case (valeurs de la maquette divisées par 62). */
export const GEOM = Object.freeze({
  tileInset: 6 / 62,
  tileRadius: 8 / 62,
  mirrorHalf: 19 / 62,
  mirrorWidth: 4 / 62,
  mirrorHalo: 8 / 62,
  hex: 19 / 62, // rayon du cadre de cible
  glyph: 8.5 / 62,
  beamWide: 0.92, // largeur des bandes de faisceau, en cases
  beamNarrow: 0.36,
  beamCore: 0.085,
  rotateMs: 90,
});

export const MAX_CELL = 88;
export const MIN_CELL = 8;
