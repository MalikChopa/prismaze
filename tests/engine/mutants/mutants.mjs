// Liste des 7 mutants de E12 (g) : chacun remplace UN morceau de src/engine/trace.js par une version fausse.
// `from` doit apparaître exactement une fois dans trace.js (vérifié par tests/engine/mutants.test.mjs et par le harnais).
export const MUTANTS = [
  { id: 1, name: 'prisme inversé (rouge à droite, bleu à gauche)', file: 'trace.js',
    edits: [['send(b, cell, (d + 1) & 3, 1)', 'send(b, cell, (d + 3) & 3, 1)'], ['send(b, cell, (d + 3) & 3, 4)', 'send(b, cell, (d + 1) & 3, 4)']] },
  { id: 2, name: 'filtre qui n\'absorbe pas (laisse tout passer)', file: 'trace.js',
    edits: [['pass = nw & f;', 'pass = nw;']] },
  { id: 3, name: 'portail qui tourne (sort à gauche au lieu de conserver la direction)', file: 'trace.js',
    edits: [['send(b, q, d, nw)', 'send(b, q, (d + 1) & 3, nw)']] },
  { id: 4, name: 'séparateur sans passage (ne fait que dévier)', file: 'trace.js',
    edits: [['case SPLITTER: {\n        send(b, cell, d, nw);\n', 'case SPLITTER: {\n']] },
  { id: 5, name: 'cible opaque (la lumière s\'arrête sur la cible)', file: 'trace.js',
    edits: [['gotT[t] |= nw;\n        send(b, cell, d, nw);\n', 'gotT[t] |= nw;\n']] },
  { id: 6, name: 'porte à « == » (ouverte seulement si la cible est exactement allumée)', file: 'trace.js',
    edits: [['(gotT[t] & need[cell]) === need[cell]', 'gotT[t] === need[cell]']] },
  { id: 7, name: 'ré-envoi supprimé (la lumière arrêtée devant une porte n\'est pas renvoyée à l\'ouverture)', file: 'trace.js',
    edits: [['      stack[b.sp++] = ((g * 4 + dd) << 3) | pm;\n', '']] },
];

/** Applique les modifications d'un mutant à un texte ; lève si un motif n'apparaît pas exactement une fois. */
export function applyMutant(mutant, text) {
  let out = text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)); // fins de ligne Windows (CRLF) ramenées à LF
  for (const [from, to] of mutant.edits) {
    const n = out.split(from).length - 1;
    if (n !== 1) throw new Error(`mutant ${mutant.id} : le motif « ${from.slice(0, 40)} » apparaît ${n} fois (attendu : 1)`);
    out = out.replace(from, () => to);
  }
  return out;
}
