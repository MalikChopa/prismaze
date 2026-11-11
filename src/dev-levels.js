// Niveaux de développement du jalon J4 (PROVISOIRE, jetable) : copies des fixtures de tests/fixtures/ (un test vérifie qu'elles sont identiques).
// Le vrai chargement (levels/index.json, load.js) est celui du jeu complet (J5) ; ici, aucun réseau : des objets JavaScript.
// `galerie` montre toutes les pièces et les 7 couleurs (lumière blanche, rouge, vert, bleu, jaune, violet, cyan) ; il n'est pas résoluble
// (aucune preuve) : c'est un décor pour juger le rendu.

const p = (type, c, r, extra = {}) => ({ type, at: [c, r], ...extra });

export const DEV_LEVELS = {
  galerie: {
    format: 2, id: 'galerie', name: 'Galerie', size: [12, 10],
    pieces: [
      p('emitter', 0, 1, { dir: 'E', mask: 'RGB' }), p('emitter', 0, 4, { dir: 'E', mask: 'RB' }), p('emitter', 11, 8, { dir: 'W', mask: 'GB' }),
      p('splitter', 1, 1, { o: '\\', fixed: true }),
      p('target', 2, 1, { need: 'G' }), p('prism', 3, 1, { fixed: true }), p('target', 3, 0, { need: 'R' }),
      p('target', 5, 1, { need: 'G' }), p('target', 9, 1, { need: 'RGB' }),
      p('filter', 1, 3, { mask: 'RG', fixed: true }), p('target', 1, 5, { need: 'RG' }), p('mirror', 1, 6, { o: '\\' }),
      p('portal', 5, 6, { pair: 0 }), p('portal', 10, 6, { pair: 0 }),
      p('target', 3, 8, { need: 'B' }),
      p('target', 5, 4, { need: 'RB' }), p('gate', 6, 4, { link: [5, 4] }), p('splitter', 7, 4, { o: '\\' }), p('filter', 9, 4, { mask: 'G' }),
      p('target', 9, 8, { need: 'GB' }), p('filter', 6, 8, { mask: 'GB' }), p('gate', 4, 8, { link: [9, 1] }),
      p('mirror', 9, 2, { o: '/', fixed: true }), p('prism', 8, 2),
      p('portal', 10, 2, { pair: 1 }), p('portal', 1, 8, { pair: 1 }), p('portal', 11, 3, { pair: 2 }), p('portal', 0, 9, { pair: 2 }),
      p('portal', 11, 0, { pair: 3 }), p('portal', 11, 9, { pair: 3 }),
      p('wall', 6, 2), p('wall', 6, 3), p('wall', 9, 3), p('wall', 10, 3), p('wall', 5, 9), p('wall', 2, 8), p('wall', 8, 6), p('wall', 8, 7), p('wall', 11, 5),
    ],
  },
  'maquette-07': {
    format: 2, id: 'maquette-07', name: 'Deux lumières', size: [10, 6],
    pieces: [
      p('emitter', 0, 3, { dir: 'E', mask: 'RGB' }),
      p('wall', 6, 2), p('wall', 1, 1), p('wall', 9, 3), p('wall', 2, 4), p('wall', 8, 5), p('wall', 5, 3),
      p('target', 5, 1, { need: 'RGB' }), p('target', 4, 4, { need: 'RGB' }),
      p('mirror', 3, 3, { o: '/' }), p('mirror', 3, 1, { o: '/' }), p('mirror', 7, 1, { o: '/' }), p('mirror', 7, 4, { o: '/', fixed: true }),
    ],
  },
  'x00-exemple': {
    format: 2, id: 'x00-exemple', name: 'Exemple', size: [8, 6],
    pieces: [
      p('emitter', 0, 1, { dir: 'E', mask: 'RGB' }), p('prism', 2, 1, { fixed: true }),
      p('target', 6, 0, { need: 'R' }), p('target', 7, 1, { need: 'G' }),
      p('gate', 5, 1, { link: [6, 0] }), p('wall', 4, 3),
      p('portal', 0, 5, { pair: 0 }), p('portal', 7, 5, { pair: 0 }),
      p('mirror', 4, 4, { o: '/' }), p('mirror', 1, 3, { o: '\\' }),
    ],
  },
};
