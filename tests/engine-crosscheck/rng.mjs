// Générateur pseudo-aléatoire et hachage entiers pour les tests croisés : identiques sur toute machine (Math.imul et >>>0 seulement).
// Même algorithme que le prototype docs/proto-v2/rng.mjs (ARCHITECTURE_V2 F7 Q2), copié ici pour que les tests n'en dépendent pas.
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function splitmix32(a) {
  return function () {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0);
  };
}
export function sfc32(seed32) { // retourne next() -> entier 32 bits non signé
  const sm = splitmix32(seed32 | 0);
  let a = sm(), b = sm(), c = sm(), d = sm();
  const next = function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) next(); // échauffement
  return next;
}
export function makeRng(seed32) {
  const next = sfc32(seed32);
  return {
    u32: next,
    int(n) { return Math.floor(next() * n / 4294967296); }, // 0..n-1 ; produit exact en flottant (n < 2^21)
    pick(arr) { return arr[this.int(arr.length)]; },
    chance(p1000) { return this.int(1000) < p1000; },
  };
}
