// Shaders en chaînes JS (V3-31 : aucun fichier de plus, aucun chargement réseau). Les 8 programmes du pipeline WebGL2 (§2) :
// piece (verre en SDF, une instance par pièce), beam (cœur + halos), fan (dispersion du prisme), part (particules),
// floor (sol de verre noir poli), down / up (bloom), comp (composition : reflet, tonemap, vignette, grain).
// Inspiré de la maquette vivante (docs/maquette-c) : géométrie et réglages repris, code réécrit pour le vrai jeu (plateau de taille variable,
// pièces instanciées, pièces absentes de la maquette : V3-39). Espace « monde » = cases du plateau, y vers le bas.
const HEAD = '#version 300 es\nprecision highp float;\n';

/** Triangle plein écran sans tampon de sommets (gl_VertexID). */
export const VS_TRI = `${HEAD}out vec2 vUV;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); vUV = p; }`;

const WORLD_VS = `uniform vec4 uM; uniform vec2 uT, uRes;
vec4 toClip(vec2 w) { vec2 p = vec2(uM.x * w.x + uM.y * w.y, uM.z * w.x + uM.w * w.y) + uT; return vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0); }\n`;

// Bibliothèque de distances (SDF) : tout est net à tout zoom, sans atlas.
const SDF = `float sq(float x) { return x * x; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdHex(vec2 p, float R) { p = abs(p); return max(p.x, p.x * 0.5 + p.y * 0.8660254) - R * 0.8660254; }
float edgeD(vec2 p, vec2 a, vec2 b, vec2 g) { vec2 e = b - a; vec2 n = normalize(vec2(e.y, -e.x)); if (dot(n, (a + b) * 0.5 - g) < 0.0) n = -n; return dot(p - a, n); }
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) { vec2 g = (a + b + c) / 3.0; return max(max(edgeD(p, a, b, g), edgeD(p, b, c, g)), edgeD(p, c, a, g)); }
float sdPent(vec2 p) {
  vec2 v0 = vec2(-0.39, -0.24), v1 = vec2(-0.06, -0.35), v2 = vec2(0.16, 0.0), v3 = vec2(-0.06, 0.35), v4 = vec2(-0.39, 0.24), g = vec2(-0.15, 0.0);
  float d = edgeD(p, v0, v1, g); d = max(d, edgeD(p, v1, v2, g)); d = max(d, edgeD(p, v2, v3, g)); d = max(d, edgeD(p, v3, v4, g)); return max(d, edgeD(p, v4, v0, g));
}
float sdSym(vec2 p, float s, float k) { // 0 triangle, 1 disque, 2 carré, 3 croix, 4 losange, 5 étoile, 6 anneau (k = taille)
  p /= k; float d; vec2 q = abs(p);
  if (s < 0.5) d = sdTri(p, vec2(0.0, -1.0), vec2(0.95, 0.72), vec2(-0.95, 0.72)) * 0.9;
  else if (s < 1.5) d = length(p) - 0.88;
  else if (s < 2.5) d = sdBox(p, vec2(0.76), 0.08);
  else if (s < 3.5) d = min(max(q.x - 0.30, q.y - 0.95), max(q.x - 0.95, q.y - 0.30));
  else if (s < 4.5) d = (q.x + q.y - 1.08) * 0.7071;
  else if (s < 5.5) d = (pow(q.x, 0.62) + pow(q.y, 0.62) - 1.0) * 0.45;
  else d = abs(length(p) - 0.70) - 0.20;
  return d * k;
}\n`;

/** Attributs d'instance d'une pièce (24 flottants) : voir `gl/piece-data.js`. */
export const VS_PIECE = `${HEAD}layout(location=0) in vec2 aC;
layout(location=1) in vec4 aA; layout(location=2) in vec4 aB; layout(location=3) in vec4 aCol; layout(location=4) in vec4 aGot; layout(location=5) in vec4 aP; layout(location=6) in vec4 aE;
${WORLD_VS}out vec2 vL; flat out vec4 vB, vCol, vGot, vP, vE; flat out vec2 vPos; flat out float vT;
void main() { vec2 w = aA.xy + aC * aA.z; vL = aC * aA.z; vPos = aA.xy; vT = aA.w + 0.5; vB = aB; vCol = aCol; vGot = aGot; vP = aP; vE = aE; gl_Position = toClip(w); }`;

// Types de pièce (attribut T = aA.w) : 0 mur, 1 miroir, 2 prisme, 3 filtre, 4 émetteur, 5 cible, 6 porte, 7 lien pointillé, 8 cadre (curseur),
// 9 jeton-symbole, 10 séparateur, 11 portail, 12 anneau de croisement, 13 surimpression de cible (glyphe, coche, croix), 14 pastilles, 15 anneau pointillé d'indice, 16 case refusée, 17 barre de miroir au-dessus du faisceau.
export const FS_PIECE = `${HEAD}in vec2 vL; out vec4 oC;
flat in vec4 vB, vCol, vGot, vP, vE; flat in vec2 vPos; flat in float vT;
uniform float uTime, uPx, uViewRot, uTone; uniform vec2 uLight;
${SDF}
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float cv(float d) { return clamp(0.5 - d / uPx, 0.0, 1.0); }
vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a, a) + dst * (1.0 - a); }
float gridTile(vec2 p) { return sdBox(p, vec2(0.40), 0.09); }
float fixedDots(vec2 p, float rr) { float m = 1e3; for (int i = 0; i < 4; i++) { vec2 v = vec2((i & 1) == 0 ? rr : -rr, (i & 2) == 0 ? rr : -rr); m = min(m, length(p - v) - 0.019); } return m; }
float bodyD(vec2 p, float t, float uRot, float uMv, float uA) {
  if (t < 1.0) return sdBox(p, vec2(0.44), 0.08);
  if (t < 2.0) return uMv > 0.5 ? gridTile(p) : length(p) - 0.31;
  if (t < 3.0) return uMv > 0.5 ? gridTile(p) : sdTri(rot(-uRot) * p, vec2(-0.40, 0.34), vec2(0.44, 0.0), vec2(-0.40, -0.34));
  if (t < 4.0) return sdBox(p, vec2(0.39), 0.08);
  if (t < 5.0) return sdPent(rot(-uRot) * p);
  if (t < 6.0) return sdHex(p, 0.40);
  if (t < 7.0) return sdBox(p, vec2(0.40), 0.08);
  if (t > 10.0 && t < 11.0) return gridTile(p);
  return 1.0;
}
vec2 nrm(vec2 p, float t, float uRot, float uMv, float uA) { vec2 e = vec2(0.004, 0.0); return normalize(vec2(bodyD(p + e.xy, t, uRot, uMv, uA) - bodyD(p - e.xy, t, uRot, uMv, uA), bodyD(p + e.yx, t, uRot, uMv, uA) - bodyD(p - e.yx, t, uRot, uMv, uA)) + 1e-6); }

vec3 tileShade(vec2 p, float d, float uB, float t, float uRot, float uMv, float uA) {
  float g = clamp(dot(p, vec2(0.7071)) * 1.2 + 0.5, 0.0, 1.0);
  vec3 c = mix(vec3(0.040, 0.048, 0.125), vec3(0.010, 0.012, 0.034), g);
  c += vec3(0.7, 0.75, 1.0) * smoothstep(0.07, 0.0, abs(p.x + p.y + 0.16)) * 0.055;
  float rim = smoothstep(-0.06, 0.0, d), l = dot(nrm(p, t, uRot, uMv, uA), uLight);
  c += vec3(0.55, 0.6, 1.0) * rim * (0.06 + 0.55 * max(l, 0.0)); c -= vec3(0.02) * rim * max(-l, 0.0);
  c += vec3(0.55, 0.6, 1.0) * (1.0 - smoothstep(0.0, uPx * 1.5, abs(d + 0.008))) * (0.16 + 0.5 * uB);
  c += vec3(0.4, 0.45, 1.0) * uB * 0.07;
  return c;
}

void main() {
  vec2 p = vL; float t = vT; float uRot = vB.x, uA = vB.y, uB = vB.z, uC = vB.w; vec3 uCol = vCol.rgb, uGot = vGot.rgb; float uSym = vCol.a, uGotA = vGot.a; float uMv = vE.y;
  vec2 gp = rot(uViewRot) * p; vec4 res = vec4(0.0); vec3 add = vec3(0.0);
  // ombre portée (sauf surimpressions)
  if (t < 5.0 || (t > 6.0 && t < 7.0) || (t > 10.0 && t < 11.0)) {
    float so = 1.0 + 3.0 * uC; float sh = (1.0 - smoothstep(-0.03, 0.10, bodyD(p - rot(-uViewRot) * vec2(0.03, 0.05) * so, t, uRot, uMv, uA))) * (0.55 - 0.15 * uC);
    if (t > 1.0 && t < 2.0 && uMv < 0.5) sh *= 0.4;
    res = vec4(0.0, 0.0, 0.0, sh);
  }
  if (t < 1.0) { // mur
    float d = sdBox(p, vec2(0.44), 0.08); vec2 q = gp;
    float top = step(abs(q.x), -q.y), left = step(abs(q.y), -q.x), bot = step(abs(q.x), q.y);
    vec3 c = vec3(0.012, 0.014, 0.034) + vec3(0.016, 0.019, 0.042) * top + vec3(0.010, 0.012, 0.028) * left - vec3(0.004, 0.004, 0.01) * bot;
    float dl = min(abs(q.x - q.y), abs(q.x + q.y)) * 0.7071; c += vec3(0.45, 0.5, 1.0) * 0.07 * (1.0 - smoothstep(0.0, uPx * 1.6, dl)) * step(max(abs(q.x), abs(q.y)), 0.34);
    float rim = smoothstep(-0.05, 0.0, d); c += vec3(0.5, 0.55, 1.0) * rim * (0.10 + 0.55 * max(dot(nrm(p, t, uRot, uMv, uA), uLight), 0.0));
    c += vec3(0.5, 0.55, 1.0) * (1.0 - smoothstep(0.0, uPx * 1.5, abs(d + 0.008))) * 0.12; res = over(res, c, cv(d));
  } else if (t < 2.0) { // miroir : tuile de verre (mobile) ou socle rond à quatre rivets (fixe), trait lumineux
    if (uMv > 0.5) { float d = gridTile(p); res = over(res, tileShade(p, d, uB, t, uRot, uMv, uA), cv(d) * 0.92); }
    else { float d = length(p) - 0.31; vec3 c = vec3(0.02, 0.025, 0.06); c += vec3(0.5, 0.55, 1.0) * (1.0 - smoothstep(0.0, uPx * 1.5, abs(d + 0.008))) * 0.3; res = over(res, c, cv(d) * 0.85);
      for (int i = 0; i < 4; i++) { vec2 rv = vec2((i & 1) == 0 ? 0.235 : -0.235, (i & 2) == 0 ? 0.235 : -0.235); res = over(res, vec3(0.7, 0.75, 1.0) * 0.8, cv(length(p - rv) - 0.017)); } }
    vec2 pb = rot(-uRot) * p; float db = sdBox(pb, vec2(0.35, 0.022), 0.022);
    add += vec3(0.55, 0.62, 1.0) * exp(-sq(pb.y / 0.06)) * smoothstep(0.45, 0.3, abs(pb.x)) * (0.30 + 0.9 * uA);
    res = over(res, vec3(1.5, 1.55, 1.75) * (1.0 + 0.5 * uA), cv(db));
  } else if (t < 3.0) { // prisme, sur tuile si mobile, sinon quatre points de pièce fixe
    if (uMv > 0.5) { float dt = gridTile(p); res = over(res, tileShade(p, dt, uB, t, uRot, uMv, uA), cv(dt) * 0.92); }
    else res = over(res, vec3(0.75, 0.8, 1.0), cv(fixedDots(p, 0.40)) * 0.8);
    vec2 q = rot(-uRot) * p / 0.9; float d = sdTri(q, vec2(-0.40, 0.34), vec2(0.44, 0.0), vec2(-0.40, -0.34)) * 0.9;
    float g = clamp((q.x + 0.4) / 0.84, 0.0, 1.0); vec3 c = mix(vec3(0.50, 0.54, 0.95), vec3(0.13, 0.14, 0.40), g) * 0.40;
    vec2 cen = vec2(-0.10, 0.0); float fl = min(min(sdSeg(q, cen, vec2(-0.40, 0.34)), sdSeg(q, cen, vec2(-0.40, -0.34))), sdSeg(q, cen, vec2(0.44, 0.0)));
    c += vec3(0.7, 0.75, 1.0) * (1.0 - smoothstep(0.0, uPx * 1.4, fl)) * 0.12;
    float sp = clamp((q.y + 0.28) / 0.56, 0.0, 1.0); vec3 spec = 0.5 + 0.5 * cos(6.2832 * (sp * 0.66 + vec3(0.0, 0.33, 0.67)));
    c += spec * uA * 0.55 * smoothstep(0.40, 0.0, length(q - vec2(0.05, 0.0)));
    float l = dot(nrm(p, 2.5, uRot, 0.0, uA), uLight); c += vec3(0.8, 0.85, 1.0) * smoothstep(-0.07, 0.0, d) * (0.12 + 0.5 * max(l, 0.0));
    c += vec3(0.9, 0.92, 1.0) * (1.0 - smoothstep(0.0, uPx * 1.6, abs(d + 0.012))) * 0.8;
    for (int i = 0; i < 3; i++) { vec2 v = i == 0 ? vec2(-0.40, 0.34) : i == 1 ? vec2(-0.40, -0.34) : vec2(0.44, 0.0); c += vec3(0.9, 0.92, 1.0) * (1.0 - smoothstep(0.0, uPx * 2.0, length(q - v * 0.93) - 0.016)) * 0.8; }
    add += vec3(0.8, 0.85, 1.0) * uA * 0.18 * exp(-length(q) * 4.0); res = over(res, c, cv(d) * 0.9);
  } else if (t < 4.0) { // filtre : vitrail (facettes, plombs, cadre lumineux, la lumière le traverse) ; le glyphe est un jeton posé après les faisceaux
    float d = sdBox(p, vec2(0.39), 0.08); float top = step(abs(p.x), -p.y), left = step(abs(p.y), -p.x), bot = step(abs(p.x), p.y);
    float fac = 0.62 + 0.30 * top + 0.15 * left - 0.12 * bot, grad = clamp(0.5 - dot(p, vec2(0.7071)) * 0.95, 0.0, 1.0);
    vec3 c = uCol * fac * mix(0.22, 0.46, grad) * (1.0 + 0.9 * uA) + vec3(0.012, 0.014, 0.03);
    float lead = 1.0 - smoothstep(0.0, uPx * 1.6, min(abs(p.x - p.y), abs(p.x + p.y)) * 0.7071 - 0.004); c *= 1.0 - lead * 0.55 * step(max(abs(p.x), abs(p.y)), 0.34);
    c = mix(c, uCol * 1.35, (1.0 - smoothstep(0.0, uPx * 1.6, abs(d + 0.012))) * 0.95);
    c += vec3(1.0) * smoothstep(uPx * 1.5, 0.0, sdSeg(p, vec2(-0.29, -0.31), vec2(-0.1, -0.31))) * 0.35; add += uCol * uA * exp(-length(p) * 4.5) * 0.35; res = over(res, c, cv(d) * 0.95);
    if (uMv < 0.5) res = over(res, vec3(0.75, 0.8, 1.0), cv(fixedDots(p, 0.40)) * 0.8);
  } else if (t < 5.0) { // émetteur
    vec2 q = rot(-uRot) * p; float d = sdPent(q); vec3 c = vec3(0.015, 0.018, 0.045);
    c += vec3(0.4, 0.45, 0.9) * smoothstep(-0.1, 0.0, d) * 0.05; c = mix(c, uCol * 1.5, cv(abs(d + 0.018) - 0.014));
    float dl = length(q - vec2(0.07, 0.0)) - 0.062; c = mix(c, vec3(1.9), cv(dl)); add += uCol * exp(-length(q - vec2(0.10, 0.0)) * 9.0) * 0.9;
    vec2 sg = rot(uViewRot) * (p - rot(uRot) * vec2(-0.20, 0.0)); c = mix(c, uCol * 1.3, cv(sdSym(sg, uSym, 0.085))); res = over(res, c, cv(d));
  } else if (t < 6.0) { // cible : corps (cadre pointillé ou plein, teinte reçue, disque allumé). Le glyphe, la coche et la croix sont en surimpression (type 13).
    float d = sdHex(gp, 0.40), ang = atan(gp.y, gp.x), lit = uA, pulse = uB, part = uGotA; vec3 col = uCol; float r = length(p);
    add += col * lit * (exp(-r * 5.5) * 0.7 + exp(-r * 2.6) * 0.22 * (1.0 + 0.25 * pulse)) * smoothstep(0.95, 0.5, r);
    float dashed = 1.0 - step(0.5, vE.x); // état 0 : cadre pointillé (seul cas), quel que soit le fondu
    float dash = mix(1.0, step(0.45, fract(ang * 2.8648 + uTime * 0.03)), dashed);
    vec3 c = vec3(0.012, 0.014, 0.035); c = mix(c, col * (0.40 + 0.32 * lit), lit * 0.85); c += uGot * part * 0.22 * (1.0 - lit);
    res = over(res, c, cv(d) * mix(0.55, 0.92, lit)); res = over(res, col * (1.0 + 0.35 * lit), cv(abs(d + 0.02) - 0.014) * dash * (0.80 + 0.2 * lit));
  } else if (t < 7.0) { // porte : panneau hachuré (silhouette du Canvas 2D), pointillé quand elle est ouverte
    float d = sdBox(p, vec2(0.40), 0.08); vec3 am = vec3(1.0, 0.4564, 0.0887); float o = uA;
    vec3 c = am * 0.20 * (1.0 - o) + vec3(0.02) * (1.0 - o); c += am * 0.22 * step(0.5, fract((p.x + p.y) * 7.7)) * (1.0 - o);
    float edge = cv(abs(d + 0.012) - 0.012); float ang = atan(p.y, p.x); float dash = mix(1.0, step(0.5, fract(ang * 6.0)), o);
    res = over(res, c, cv(d) * (0.92 * (1.0 - o) + 0.0)); res = over(res, am * 1.3, edge * dash * mix(1.0, 0.55, o));
    add += am * 0.10 * (1.0 - o) * exp(-length(p) * 3.2);
    float n = vE.w; for (int i = 0; i < 6; i++) { if (float(i) >= n) break; res = over(res, am * 1.5, cv(length(gp - vec2((float(i) - (n - 1.0) / 2.0) * 0.113, 0.1)) - 0.037)); }
  } else if (t < 8.0) { // lien pointillé porte -> cible (et fil d'indice)
    vec2 w = vPos + p; vec2 a = vP.xy, b = vP.zw, ba = b - a; float L = length(ba); vec2 dv = ba / L; float s = dot(w - a, dv);
    float dd = length((w - a) - dv * clamp(s, 0.0, L)); float cell = 0.15; float u = fract((s - uTime * uA * 0.6) / cell);
    float dr = length(vec2((u - 0.5) * cell, dd)) - 0.016; float a2 = cv(dr) * smoothstep(0.0, 0.1, s - 0.34) * smoothstep(0.0, 0.1, L - 0.34 - s);
    res = over(res, uCol * (0.7 + 1.2 * uA), a2 * (0.75 + 0.25 * uA));
  } else if (t < 9.0) { // cadre : curseur (a = 0 trait plein, 1 pointillé ; b = épaisseur +, c = fond léger)
    float d = sdBox(p, vec2(0.47), 0.11); float ang = atan(p.y, p.x); float dash = step(0.35, fract(ang * 3.1831 + uTime * 0.15));
    res = over(res, uCol * 1.4, cv(abs(d + 0.025) - 0.012 - uB * 0.01) * mix(1.0, dash, uA) * 0.95);
    if (uC > 0.0) res = over(res, uCol * 0.35, cv(d) * uC);
  } else if (t < 10.0) { // jeton-symbole, au-dessus du bloom (V3-32). V10 (test final : les « ◎ » se lisaient comme des mini-cibles) :
    if (uB > 0.0) { // glyphe d'un filtre : posé sur le verre teinté (ni disque sombre ni anneau), liseré sombre pour le contraste
      float k = max(uB, uPx * 9.0) * 0.86; float dg = sdSym(gp, uSym, k); res = over(res, vec3(0.01, 0.012, 0.03), cv(dg - max(0.014, uPx * 1.2)) * 0.9); res = over(res, uCol * 1.3, cv(dg));
    } else { // marqueur de faisceau : gélule plate teintée de la couleur du faisceau (sombre : elle masque le scintillement du faisceau, V3-20), couchée le long du faisceau (uRot), liseré et glyphe de la couleur, droit à l'écran
      vec2 q = rot(-uRot) * p; float th = max(0.095, uPx * 7.0); float d = sdSeg(q, vec2(-0.06, 0.0), vec2(0.06, 0.0)) - th;
      res = over(res, uCol * 0.20 + vec3(0.010, 0.012, 0.030), cv(d) * 0.94); res = over(res, uCol * 0.95, cv(abs(d + uPx * 0.6) - uPx * 0.55) * 0.8); res = over(res, uCol * 1.3, cv(sdSym(gp, uSym, th * 0.85)));
    }
  } else if (t < 11.0) { // séparateur : tuile, losange translucide, trait (la lumière traverse ET se réfléchit)
    if (uMv > 0.5) { float d = gridTile(p); res = over(res, tileShade(p, d, uB, t, uRot, uMv, uA), cv(d) * 0.92); }
    else res = over(res, vec3(0.75, 0.8, 1.0), cv(fixedDots(p, 0.40)) * 0.8);
    float dd = (abs(p.x) + abs(p.y) - 0.274) * 0.7071; res = over(res, vec3(0.32, 0.35, 0.75) * (0.34 + 0.36 * uA), cv(dd) * 0.42);
    res = over(res, vec3(1.0, 1.02, 1.3) * (0.9 + 0.5 * uA), cv(abs(dd) - 0.008) * 0.95);
    vec2 pb = rot(-uRot) * p; float db = sdBox(pb, vec2(0.35, 0.016), 0.016);
    add += vec3(0.55, 0.62, 1.0) * exp(-sq(pb.y / 0.05)) * smoothstep(0.45, 0.3, abs(pb.x)) * (0.24 + 0.7 * uA);
    res = over(res, vec3(1.4, 1.45, 1.7) * (1.0 + 0.45 * uA), cv(db));
  } else if (t < 12.0) { // portail : deux anneaux, centre sombre, n points de paire (1 à 4), lueur quand la lumière y entre
    float r = length(p), lit = uA, n = vE.w; float swirl = 0.5 + 0.5 * sin(atan(p.y, p.x) * 6.0 + r * 16.0 - uTime * 2.2);
    res = over(res, vec3(0.012, 0.012, 0.05), cv(r - 0.371) * 0.86); vec3 hue = uCol * (1.15 + 0.5 * lit);
    add += uCol * lit * (exp(-r * 4.0) * 0.32 * smoothstep(0.6, 0.42, r) + swirl * 0.20 * smoothstep(0.34, 0.08, r));
    res = over(res, hue, cv(abs(r - 0.371) - 0.019)); res = over(res, hue, cv(abs(r - 0.226) - 0.011) * 0.6);
    for (int i = 0; i < 4; i++) { if (float(i) >= n) break; res = over(res, hue * 1.15, cv(length(gp - vec2((float(i) - (n - 1.0) / 2.0) * 0.105, 0.0)) - 0.037)); }
  } else if (t < 13.0) { // anneau de croisement (V3-7) : verre discret, reflet en haut à gauche
    float r = length(p), R = 0.15, shn = 0.55 + 0.45 * clamp(dot(normalize(p + 1e-5), uLight), -1.0, 1.0);
    res = over(res, vec3(0.010, 0.013, 0.038), cv(r - R) * 0.62); res = over(res, mix(vec3(0.52, 0.58, 0.92), vec3(1.2, 1.24, 1.35), shn * shn), cv(abs(r - R) - max(0.007, uPx * 0.55)) * (0.42 + 0.34 * shn));
  } else if (t < 14.0) { // surimpression de cible (après les faisceaux, hors reflet) : état lisible sans la couleur (V3-32). vE.x = 0 éteinte, 1 partielle, 2 trop, 3 allumée
    float state = vE.x, lit = uA; vec3 col = uCol;
    float r = length(p); float glyph = sdSym(gp, uSym, 0.135);
    if (state > 2.5) { // allumée : disque plein, glyphe sombre, coche blanche
      res = over(res, mix(col, vec3(1.0), 0.55) * 1.25, cv(r - 0.19) * lit); res = over(res, vec3(0.02, 0.025, 0.06), cv(glyph));
      vec2 bq = gp - vec2(0.225, -0.225); res = over(res, vec3(1.25), cv(length(bq) - 0.097));
      float chk = min(sdSeg(bq, vec2(-0.048, 0.0), vec2(-0.010, 0.040)), sdSeg(bq, vec2(-0.010, 0.040), vec2(0.056, -0.048))); res = over(res, vec3(0.02, 0.025, 0.06), cv(chk - 0.015));
    } else { // éteinte, partielle ou trop : glyphe de la teinte voulue sur un petit disque sombre
      res = over(res, vec3(0.010, 0.012, 0.03), cv(r - 0.17) * 0.8); res = over(res, col * 1.1, cv(glyph));
      if (state > 1.5) { float x = min(sdSeg(p, vec2(-0.16), vec2(0.16)), sdSeg(p, vec2(0.16, -0.16), vec2(-0.16, 0.16))); res = over(res, vec3(1.3), cv(x - 0.019)); }
    }
  } else if (t < 15.0) { // pastilles (cible liée) : n points ambrés
    float n = vE.w; vec3 am = vec3(1.0, 0.4564, 0.0887) * 1.4;
    for (int i = 0; i < 6; i++) { if (float(i) >= n) break; res = over(res, am, cv(length(gp - vec2((float(i) - (n - 1.0) / 2.0) * 0.113, 0.0)) - 0.037)); }
  } else if (t < 16.0) { // anneau d'indice, pointillé
    float r = length(p); float dash = step(0.5, fract(atan(p.y, p.x) * 4.7746 + uTime * 0.25)); res = over(res, uCol * 1.4, cv(abs(r - 0.4) - 0.016) * dash);
  } else if (t < 17.0) { // case refusée : cadre et croix roses
    float d = sdBox(p, vec2(0.45), 0.05); res = over(res, vec3(1.0, 0.25, 0.36) * 1.4, cv(abs(d) - 0.018));
    float x = min(sdSeg(p, vec2(-0.2), vec2(0.2)), sdSeg(p, vec2(0.2, -0.2), vec2(-0.2, 0.2))); res = over(res, vec3(1.0, 0.25, 0.36) * 1.4, cv(x - 0.022));
  } else { // barre de miroir ou de séparateur : au-dessus du faisceau et du bloom (liseré sombre + trait clair), l'orientation se lit toujours
    vec2 pb = rot(-uRot) * p; float th = uC > 0.5 ? 0.018 : 0.022, db = sdBox(pb, vec2(0.35, th), th);
    res = over(res, vec3(0.012, 0.014, 0.04), cv(db - 0.028) * 0.92); res = over(res, vec3(1.35, 1.40, 1.65), cv(db));
  }
  oC = (res + vec4(add, 0.0)) * vE.z; // vE.z : opacité d'ensemble (fantômes, dissolution)
  if (uTone > 0.5 && oC.a > 0.0) { vec3 c = oC.rgb / max(oC.a, 1e-4); c = pow(aces(c * 1.05), vec3(1.0 / 2.2)); oC = vec4(c * oC.a, oC.a); } // passe après composition : même tonemap que l'image
}`;

/** Faisceaux : cœur, halo moyen, halo large (le bloom fait le reste). Instance : aS = (x0,y0,x1,y1), aK = couleur linéaire + intensité, aF = (fa, fb, glow, 0). */
export const VS_BEAM = `${HEAD}layout(location=0) in vec2 aC; layout(location=1) in vec4 aS; layout(location=2) in vec4 aK; layout(location=3) in vec4 aF;
${WORLD_VS}out vec2 vW; flat out vec4 vS, vK, vF;
void main() { vec2 a = aS.xy, b = aS.zw; float len = length(b - a); vec2 t = len > 1e-4 ? (b - a) / len : vec2(1.0, 0.0); vec2 n = vec2(-t.y, t.x); float M = 0.58;
  vec2 w = (a + b) * 0.5 + t * aC.x * (len * 0.5 + M) + n * aC.y * M; vW = w; vS = aS; vK = aK; vF = aF; gl_Position = toClip(w); }`;

export const FS_BEAM = `${HEAD}in vec2 vW; flat in vec4 vS, vK, vF; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
uniform float uTime, uGain, uPulse;
void main() {
  vec2 a = vS.xy, b = vS.zw, ba = b - a; float L2 = max(dot(ba, ba), 1e-6); float h0 = dot(vW - a, ba) / L2; float h = clamp(h0, 0.0, 1.0); vec2 cp = a + ba * h; float d = length(vW - cp);
  float len = sqrt(L2), s = h0 * len;
  float glow = vF.z; float ends = 1.0; // extrémité sans « glow » : bord franc, pas de bulle au raccord (voies, coupures, tronçons bout à bout) ; fondu de coupure (fa, fb)
  if (s < 0.0 && mod(glow, 2.0) < 0.5) ends = 0.0;
  if (s > len && mod(floor(glow / 2.0), 2.0) < 0.5) ends = 0.0;
  if (vF.x > 0.0) ends *= smoothstep(0.0, vF.x, s);
  if (vF.y > 0.0) ends *= smoothstep(0.0, vF.y, len - s);
  float lane = mod(vF.w, 2.0), white = step(1.5, vF.w); // white : le blanc garde un cœur fin et un halo resserré (sa luminance sature sinon) ; tronçon sur une voie de contre-sens : halo resserré, les deux couleurs se lisent séparément (V3-8)
  float core = exp(-d * d / (2.0 * 0.0105 * 0.0105)), mid = exp(-d * d / (2.0 * 0.040 * 0.040)) * (1.0 - 0.72 * lane) * (1.0 - 0.62 * white), halo = exp(-d / 0.15) * (1.0 - 0.6 * lane) * (1.0 - 0.66 * white);
  float pul = 1.0 + uPulse * (0.10 * sin(s * 8.0 - uTime * 5.0) + 0.06 * sin(s * 21.0 - uTime * 9.0));
  float fade = smoothstep(0.58, 0.12, d); vec3 col = vK.rgb; float I = vK.a * uGain * pul * ends;
  vec3 c = col * (mid * 0.62 + halo * 0.14 * fade) + mix(col, vec3(1.0), 0.55 - 0.3 * lane) * core * (1.25 - 0.35 * white); c *= I; o0 = vec4(c, 1.0); o1 = vec4(c, 1.0);
}`;

/** Dispersion du prisme (décor : la logique reste 3 sorties orthogonales) : vrai spectre continu (rouge -> jaune -> vert -> cyan -> bleu) avec éventail de rayons fins et arcs de réfraction irisés. Chaque bit entrant allume sa part. */
export const FS_FAN = `${HEAD}in vec2 vL; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; flat in vec4 vB, vCol, vGot, vP, vE; flat in vec2 vPos; flat in float vT;
uniform float uTime, uGain, uPulse; uniform vec3 cR, cG, cB;
${SDF}
void main() {
  vec2 p = vL; float uBase = vB.x; vec3 uIn = vCol.rgb; float r = length(p); float rel = atan(p.y, p.x) - uBase; rel = mod(rel + 3.14159265, 6.2831853) - 3.14159265; float u = rel / 1.5708; float sg = 0.56;
  float wR = exp(-sq((u + 1.0) / sg)), wG = exp(-sq(u / sg)), wB = exp(-sq((u - 1.0) / sg));
  vec3 c = cR * wR * uIn.x + cG * wG * uIn.y + cB * wB * uIn.z;
  float fwd = smoothstep(-0.50, 0.08, cos(rel)); float rad = smoothstep(0.08, 0.20, r) * exp(-r * 1.25) * smoothstep(1.25, 0.82, r);
  float spokes = 0.26 + 0.78 * pow(0.5 + 0.5 * cos(rel * 26.0 + sin(r * 3.0 - uTime * uPulse * 0.6) * 0.06), 5.0) + 0.14 * pow(0.5 + 0.5 * cos(rel * 57.0), 8.0);
  float arc1 = exp(-sq((r - (0.62 + 0.06 * u)) / 0.040)), arc2 = exp(-sq((r - (0.82 + 0.05 * u)) / 0.030)); float arc = arc1 * 1.05 + arc2 * 0.55;
  float hot = exp(-sq(r / 0.18)) * 1.4 * smoothstep(0.04, 0.12, r);
  c *= (rad * spokes * 2.5 + arc * 1.25 + hot) * fwd * uGain * vE.z; o0 = vec4(c, 1.0); o1 = vec4(c, 1.0);
}`;

/** Particules : points, étoiles à 4 branches, anneaux (kind) ; additif, dans la scène et la couche des faisceaux (reflet, bloom). */
export const VS_PART = `${HEAD}layout(location=0) in vec2 aC; layout(location=1) in vec4 aP; layout(location=2) in vec4 aK;
${WORLD_VS}out vec2 vQ; flat out vec4 vK; flat out float vKind;
void main() { vec2 w = aP.xy + aC * aP.z; vQ = aC; vK = aK; vKind = aP.w; gl_Position = toClip(w); }`;

export const FS_PART = `${HEAD}in vec2 vQ; flat in vec4 vK; flat in float vKind; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main() {
  vec2 q = vQ; float r2 = dot(q, q); float I;
  if (vKind < 0.5) { I = exp(-r2 * 7.0) * 0.9 + exp(-r2 * 45.0) * 1.6; }
  else if (vKind < 1.5) { vec2 a = abs(q); float rr = 1.0 - smoothstep(0.55, 1.0, sqrt(r2)); I = (exp(-a.x * a.y * 60.0) * 1.4 + (exp(-a.x * 22.0) * (1.0 - a.y) + exp(-a.y * 22.0) * (1.0 - a.x)) * 0.8) * rr; }
  else { float r = sqrt(r2); I = exp(-((r - 0.72) / 0.085) * ((r - 0.72) / 0.085)) * 1.3; }
  vec3 c = mix(vK.rgb, vec3(1.0), clamp(I - 1.1, 0.0, 0.6)) * I * vK.a; o0 = vec4(c, 1.0); o1 = vec4(c * step(0.5, abs(vKind - 1.0)), 1.0); // V10 : les étoiles n'entrent pas dans la couche du reflet (copie décalée = étoiles « striées »)
}`;

/** Sol : verre noir poli, grille gravée, reflets, lumière diffusée par les faisceaux (image précédente). uHalf = demi-taille du plateau en cases ; uPad = débord de la dalle en cases (0,30 ; V10 : réduit en portrait tourné pour que la dalle tienne dans l'écran) ; uFloorT = translation du sol (parallaxe). */
export const FS_FLOOR = `${HEAD}in vec2 vUV; out vec4 oC;
uniform vec2 uRes, uFloorT, uLight, uSpot, uPar, uHalf, uPad; uniform vec4 uMi; uniform float uPx, uSpotA; uniform sampler2D uBeam;
${SDF}
float slab(vec2 c) { return sdBox(c, uHalf + uPad, min(0.30, min(uPad.x, uPad.y))); }
void main() {
  vec2 fc = gl_FragCoord.xy; vec2 px = vec2(fc.x, uRes.y - fc.y); vec2 suv = fc / uRes; vec2 q = px - uFloorT; vec2 w = vec2(uMi.x * q.x + uMi.y * q.y, uMi.z * q.x + uMi.w * q.y); vec2 cc = w - uHalf; float sd = slab(cc);
  vec3 lit = textureLod(uBeam, suv, 3.0).rgb, litW = textureLod(uBeam, suv, 5.5).rgb;
  vec2 c0 = (suv - 0.5) * vec2(uRes.x / uRes.y, 1.0); vec3 col = vec3(0.0030, 0.0038, 0.0095) + vec3(0.0085, 0.0105, 0.024) * smoothstep(1.0, 0.0, length(c0));
  col *= 0.72 + 0.28 * smoothstep(0.0, 1.6, sd); col += vec3(0.010, 0.013, 0.034) * exp(-max(sd, 0.0) * 1.1) * step(0.0, sd); col += litW * 0.45; col += vec3(0.5, 0.6, 1.0) * exp(-sq((c0.x * 0.8 + c0.y * 0.6 + uPar.x * 0.15 + 0.12) / 0.2)) * 0.006;
  if (sd < 0.5) {
    float aa = uPx; float inS = 1.0 - clamp(sd / aa + 0.5, 0.0, 1.0); vec3 s = vec3(0.0034, 0.0044, 0.0120);
    s += vec3(0.0065, 0.0085, 0.022) * smoothstep(7.0, -3.0, dot(cc, vec2(0.8, 0.6)));
    float bp = dot(w, vec2(0.83, 0.56)) - (dot(uHalf, vec2(0.83, 0.56)) + uPar.x * 5.5 + uPar.y * 3.0); s += vec3(0.55, 0.62, 1.0) * (exp(-sq(bp / 1.3)) * 0.030 + exp(-sq((bp - 2.7) / 0.32)) * 0.011);
    s += vec3(0.6, 0.7, 1.0) * exp(-sq(length(w - uSpot) / 1.5)) * 0.05 * uSpotA;
    vec2 f = fract(w); vec2 dl = min(f, 1.0 - f); float lw = 0.0065; float gx = 1.0 - smoothstep(lw, lw + uPx * 1.6, dl.x), gy = 1.0 - smoothstep(lw, lw + uPx * 1.6, dl.y);
    float inB = step(-0.02, w.x) * step(w.x, uHalf.x * 2.0 + 0.02) * step(-0.02, w.y) * step(w.y, uHalf.y * 2.0 + 0.02); float g = max(gx, gy) * inB; float gd = (1.0 - smoothstep(0.028, 0.028 + uPx * 1.6, length(dl))) * inB;
    s += vec3(0.20, 0.24, 0.55) * (g * 0.040 + gd * 0.09); s += vec3(0.5, 0.55, 1.0) * lit * g * 1.3 + lit * 0.07;
    vec2 e2 = vec2(0.01, 0.0); vec2 n = normalize(vec2(slab(cc + e2.xy) - slab(cc - e2.xy), slab(cc + e2.yx) - slab(cc - e2.yx)) + 1e-5); float l = dot(n, uLight);
    s += vec3(0.5, 0.56, 1.0) * smoothstep(-0.14, 0.0, sd) * (0.02 + 0.16 * max(l, 0.0)); s += vec3(0.75, 0.8, 1.0) * exp(-sq(sd / (uPx * 1.3))) * (0.07 + 0.42 * max(l, 0.0));
    col = mix(col, s, inS); col += vec3(0.6, 0.65, 1.0) * exp(-sq((sd - 0.03) / (uPx * 1.6))) * 0.05 * 0.5 * (1.0 - inS);
  }
  oC = vec4(col, 1.0);
}`;

/** Bloom : descente 13 points puis remontée en tente, additive. */
export const FS_DOWN = `${HEAD}in vec2 vUV; out vec4 oC; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThr;
vec3 S(vec2 o) { return texture(uTex, vUV + o * uTexel).rgb; }
void main() {
  vec3 a = S(vec2(-2, 2)), b = S(vec2(0, 2)), c = S(vec2(2, 2)), d = S(vec2(-2, 0)), e = S(vec2(0, 0)), f = S(vec2(2, 0)), g = S(vec2(-2, -2)), h = S(vec2(0, -2)), i = S(vec2(2, -2)), j = S(vec2(-1, 1)), k = S(vec2(1, 1)), l = S(vec2(-1, -1)), m = S(vec2(1, -1));
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uThr > 0.0) { float lu = max(max(o.r, o.g), o.b); o *= max(lu - uThr, 0.0) / max(lu, 1e-4); }
  oC = vec4(o, 1.0);
}`;

export const FS_UP = `${HEAD}in vec2 vUV; out vec4 oC; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uW;
vec3 S(vec2 o) { return texture(uTex, vUV + o * uTexel).rgb; }
void main() { vec3 o = (S(vec2(-1, 1)) + S(vec2(1, 1)) + S(vec2(-1, -1)) + S(vec2(1, -1)) + (S(vec2(0, 1)) + S(vec2(-1, 0)) + S(vec2(1, 0)) + S(vec2(0, -1))) * 2.0 + S(vec2(0, 0)) * 4.0) / 16.0; oC = vec4(o * uW, 1.0); }`;

/** Composition : bloom, reflet sur le verre (faisceaux décalés et flous), onde de victoire, vignette, grain, ACES. */
export const FS_COMP = `${HEAD}in vec2 vUV; out vec4 oC; uniform sampler2D uScene, uBloom, uBeam; uniform vec2 uRes, uRefl; uniform vec4 uWave;
uniform float uTime, uBloomG, uReflG, uVig, uGrain, uExpo, uMenu, uFlash, uAber, uGlow;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sq1(float x) { return x * x; }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes; float asp = uRes.x / uRes.y; vec2 dd = (uv - uWave.xy) * vec2(asp, 1.0); float r = length(dd);
  float ring = exp(-((r - uWave.z) / 0.075) * ((r - uWave.z) / 0.075)) * uWave.w; vec2 dir = dd / (r + 1e-4) / vec2(asp, 1.0); vec2 uvr = uv - dir * ring * 0.014; // V10 : réfraction de l'onde réduite (murs moins tordus)
  float front = exp(-sq1((r - uWave.z) / 0.022)) * uWave.w; vec2 rc = uv - 0.5; vec2 ad = normalize(rc + 1e-5) * (uAber * dot(rc, rc) * 2.0) + dir * 0.0030 * front; // V10 : aberration de l'onde limitée à son front (≈ 2 px), plus de doubles RVB sur les murs
  vec3 sc = vec3(texture(uScene, uvr + ad).r, texture(uScene, uvr).g, texture(uScene, uvr - ad).b);
  vec3 bl = vec3(texture(uBloom, uvr + ad * 0.5).r, texture(uBloom, uvr).g, texture(uBloom, uvr - ad * 0.5).b);
  vec3 col = sc + bl * uBloomG * (1.0 + uGlow);
  if (uReflG > 0.0) { vec3 rf = textureLod(uBeam, uv + uRefl, 1.1).rgb * 0.5 + textureLod(uBeam, uv + uRefl * 1.25, 3.0).rgb * 0.5; col += rf * uReflG; }
  vec3 rl = vec3(exp(-sq1((r - uWave.z) / 0.011)), exp(-sq1((r - uWave.z - 0.011) / 0.011)), exp(-sq1((r - uWave.z - 0.022) / 0.011))) * uWave.w; col += rl * vec3(1.15, 0.95, 1.3) + vec3(0.7, 0.75, 1.0) * exp(-sq1((r - uWave.z - 0.03) / 0.30)) * uWave.w * 0.07;
  col += vec3(0.9, 0.92, 1.0) * uFlash * 0.30 * exp(-r * r * 5.0);
  col *= mix(1.0, 0.24, uMenu); float lm = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = mix(vec3(lm), col, mix(1.0, 0.7, uMenu));
  vec2 vc = (uv - 0.5) * vec2(asp * 0.78, 1.0); float vig = smoothstep(1.05, 0.30, length(vc) * 1.25); col *= mix(1.0, 0.30 + 0.70 * vig, uVig);
  col = aces(col * uExpo); col = pow(col, vec3(1.0 / 2.2));
  float n = hash(gl_FragCoord.xy + vec2(uTime * 37.0, uTime * 11.0)); col += (n - 0.5) * (uGrain * 0.030 + 0.0039); oC = vec4(col, 1.0);
}`;

/** Les 8 programmes (V3-10), compilés en parallèle au démarrage. L'ordre ne compte pas. */
const strip = (t) => t.replace(/\/\/.*$/gm, ''); // les commentaires restent dans ce fichier, jamais dans les sources envoyées au pilote

function program(vs, fs) { return Object.freeze({ vs: strip(vs), fs: strip(fs) }); }

export const PROGRAM_SOURCES = Object.freeze({
  piece: program(VS_PIECE, FS_PIECE),
  beam: program(VS_BEAM, FS_BEAM),
  fan: program(VS_PIECE, FS_FAN),
  part: program(VS_PART, FS_PART),
  floor: program(VS_TRI, FS_FLOOR),
  down: program(VS_TRI, FS_DOWN),
  up: program(VS_TRI, FS_UP),
  comp: program(VS_TRI, FS_COMP),
});
export const PROGRAM_NAMES = Object.freeze(Object.keys(PROGRAM_SOURCES));
