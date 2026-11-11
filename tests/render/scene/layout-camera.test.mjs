// Mise en page avec obstacles (V3-17, V3-38), caméra et borne de pose (V3-18), projection pointeur → case (V3-19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, FLAGS, GAP, ZOOM_MAX, victoryObstacle, gapBetween, overlaps } from '../../../src/render/scene/layout.js';
import { createCamera, CAMERA, clampPose, maxShift, makeView, worldToScreen, screenToWorld, cellAt, cellAtClient } from '../../../src/render/scene/camera.js';
import { xorshift } from './_helpers.mjs';

test('immersiveLayout : l\'indicateur existe et reste ÉTEINT jusqu\'à V5', () => {
  assert.equal(FLAGS.immersiveLayout, false);
});

// obstacles du document (V3-38) : dock 460×56 en bas, barres du haut ; en paysage compact (< 500 px de haut) dock latéral de 56 px à droite
const dock = (w, h) => (h < 500 ? { x: w - 72, y: h / 2 - 140, w: 56, h: 280 } : { x: w / 2 - 230, y: h - 72, w: 460, h: 56 });
const topBars = (w) => [{ x: 12, y: 12, w: 200, h: 44 }, { x: w - 232, y: 12, w: 220, h: 44 }];
const obstaclesOf = (w, h) => [dock(w, h), ...topBars(w)];
const SIZES = [[1280, 720], [1920, 1080], [1024, 768], [915, 412], [412, 915], [360, 640], [2560, 1440]];
const BOARDS = [[10, 8], [12, 10]];
const box = (L, zoom, dx = 0, dy = 0) => ({ l: L.x0 + L.boardW / 2 - (L.boardW * zoom) / 2 + dx, r: L.x0 + L.boardW / 2 + (L.boardW * zoom) / 2 + dx, t: L.y0 + L.boardH / 2 - (L.boardH * zoom) / 2 + dy, b: L.y0 + L.boardH / 2 + (L.boardH * zoom) / 2 + dy });

test('V3-38 : computeLayout avec obstacles : 5+ tailles × {10×8, 12×10} × {jeu, gagné} : plus aucun recouvrement au zoom maximal, écart ≥ 8 px si l\'obstacle a dû reculer', () => {
  for (const [w, h] of SIZES) for (const [cols, rows] of BOARDS) for (const state of ['jeu', 'gagne']) {
    const obstacles = state === 'jeu' ? obstaclesOf(w, h) : [...topBars(w), victoryObstacle(w, h, Math.round(h * 0.255))];
    const free = layout({ w, h, cols, rows });
    const L = layout({ w, h, cols, rows, obstacles });
    const name = `${w}x${h} ${cols}x${rows} ${state}`;
    const bMax = box(L, ZOOM_MAX);
    for (const o of obstacles) {
      assert.ok(!overlaps(bMax, o, 0), `${name} : recouvrement`);
      if (overlaps(box(free, ZOOM_MAX), o, 0)) assert.ok(gapBetween(bMax, o) >= GAP - 1e-6, `${name} : écart ${gapBetween(bMax, o).toFixed(2)} px < 8`);
    }
    assert.ok(L.cell <= free.cell + 1e-9 && L.cell > 0.5 * free.cell, `${name} : case ${L.cell.toFixed(1)} contre ${free.cell.toFixed(1)}`);
    assert.ok(L.x0 >= 0 && L.y0 >= 0 && L.x0 + L.boardW <= w && L.y0 + L.boardH <= h, `${name} : plateau dans la fenêtre`);
  }
});

test('V3-38 : chiffres du document (case avant → après) : 1280×720 10×8 77,3 → 69,6 ; 12×10 63,0 → 56,6 ; 1920×1080 −6 % ; 1024×768 −16 % ; 915×412 10×8 44,3 → 37,8, 12×10 inchangé ; 412×915 inchangé', () => {
  const f = (w, h, cols, rows) => { const o = obstaclesOf(w, h); return [layout({ w, h, cols, rows }).cell, layout({ w, h, cols, rows, obstacles: o }).cell]; };
  const near = (got, want, tol, name) => assert.ok(Math.abs(got - want) <= tol, `${name} : ${got.toFixed(2)} attendu ${want}`);
  let [a, b] = f(1280, 720, 10, 8); near(a, 77.3, 0.06, 'avant'); near(b, 69.6, 0.06, 'après');
  [a, b] = f(1280, 720, 12, 10); near(a, 63.0, 0.06, 'avant'); near(b, 56.6, 0.06, 'après');
  [a, b] = f(1920, 1080, 10, 8); near(b / a - 1, -0.06, 0.005, '1920');
  [a, b] = f(1024, 768, 10, 8); near(b / a - 1, -0.16, 0.005, '1024');
  [a, b] = f(915, 412, 10, 8); near(a, 44.3, 0.06, 'avant'); near(b, 37.8, 0.06, 'après');
  [a, b] = f(915, 412, 12, 10); assert.equal(b, a, '915×412 12×10 inchangé');
  [a, b] = f(412, 915, 10, 8); assert.equal(b, a, '412×915 inchangé'); [a, b] = f(412, 915, 12, 10); assert.equal(b, a);
});

test('V3-38 : un obstacle qui ne recouvre pas le plateau horizontalement ne compte pas ; marge de sécurité (encoche) respectée ; case entière en 2D', () => {
  const free = layout({ w: 1280, h: 720, cols: 10, rows: 8 });
  assert.equal(layout({ w: 1280, h: 720, cols: 10, rows: 8, obstacles: [{ x: 0, y: 600, w: 40, h: 100 }] }).cell, free.cell);
  const s = layout({ w: 1280, h: 720, cols: 10, rows: 8, safe: { top: 40, bottom: 30, left: 0, right: 0 } });
  assert.ok(s.y0 >= 40 && s.y0 + s.boardH <= 720 - 30);
  const i = layout({ w: 1280, h: 720, cols: 10, rows: 8, integerCell: true });
  assert.equal(i.cell, Math.floor(free.cell));
});

test('V3-18 : aucune case rognée : course maximale (zoom 1,03 + parallaxe 1,3 % + recentrage 3,5 % du vecteur), 7 tailles × 2 plateaux, SANS compter sur la borne', () => {
  for (const [w, h] of [...SIZES, [3440, 1440]]) for (const [cols, rows] of BOARDS) for (const wide of [false, true]) {
    const obstacles = wide ? obstaclesOf(w, h) : [];
    const L = layout({ w, h, cols, rows, obstacles });
    const vec = Math.hypot(L.boardW, L.boardH) / 2, s = maxShift(w, h, vec);
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const b = box(L, ZOOM_MAX, (sx * (CAMERA.PARALLAX * Math.min(w, h) + CAMERA.RECENTER * (L.boardW / 2))), sy * (CAMERA.PARALLAX * Math.min(w, h) + CAMERA.RECENTER * (L.boardH / 2)));
      assert.ok(b.l >= 0 && b.t >= 0 && b.r <= w && b.b <= h, `${w}x${h} ${cols}x${rows} : case rognée (${b.l.toFixed(1)}, ${b.t.toFixed(1)}, ${b.r.toFixed(1)}, ${b.b.toFixed(1)})`);
    }
    assert.ok(s > 0);
  }
});

test('V3-38 : clampPose : à toute pose aléatoire, le plateau reste dans la fenêtre et à l\'écart des obstacles', () => {
  const rnd = xorshift(7);
  let clamped = 0, n = 0;
  for (const [w, h] of SIZES) for (const [cols, rows] of BOARDS) {
    const obstacles = obstaclesOf(w, h);
    const L = layout({ w, h, cols, rows, obstacles });
    for (let k = 0; k < 400; k++) {
      const zoom = 0.97 + rnd() * (ZOOM_MAX - 0.97), sh = maxShift(w, h, Math.hypot(L.boardW, L.boardH) / 2);
      const r = clampPose(L, zoom, (rnd() * 2 - 1) * sh, (rnd() * 2 - 1) * sh, obstacles, { l: 0, t: 0, r: w, b: h });
      const b = box(L, zoom, r.dx, r.dy), base = box(L, zoom);
      n++; if (r.clamped) clamped++;
      assert.ok(b.l >= -1e-6 && b.t >= -1e-6 && b.r <= w + 1e-6 && b.b <= h + 1e-6, `${w}x${h} : plateau hors fenêtre`);
      for (const o of obstacles) {
        assert.ok(!overlaps(b, o, 0), `${w}x${h} ${cols}x${rows} : le plateau entre dans un obstacle`);
        assert.ok(gapBetween(b, o) >= Math.min(GAP, Math.max(0, gapBetween(base, o))) - 1e-6, `${w}x${h} : écart réduit à ${gapBetween(b, o).toFixed(2)}`);
      }
    }
  }
  assert.ok(clamped > 0 && clamped < n, `la borne agit ${clamped} fois sur ${n}`);
});

test('V3-18 : caméra : repos 1,022 ± 0,008 (GL) / 1,0 (2D), parallaxe 1,3 %, tactile sans parallaxe, mouvement réduit = zoom 1 décalage 0 sans poussée', () => {
  const io = { w: 1000, h: 800, pointer: { nx: 1, ny: -1 }, dragging: false, target: null };
  const gl = createCamera({ gl: true });
  let zmin = 9, zmax = 0, p;
  for (let t = 0; t < 40000; t += 16) { p = gl.update(t, io); zmin = Math.min(zmin, p.zoom); zmax = Math.max(zmax, p.zoom); }
  assert.ok(zmin >= 1.022 - 0.008 - 1e-9 && zmax <= 1.022 + 0.008 + 1e-9 && zmax - zmin > 0.014, `${zmin} ${zmax}`);
  assert.ok(Math.abs(p.dx - 0.013 * 800) < 0.01 && Math.abs(p.dy + 0.013 * 800) < 0.01, 'parallaxe établie = 1,3 % du petit côté');
  assert.ok(Math.abs(p.floorDx - 0.55 * p.dx) < 1e-9, 'le sol suit à 55 %');
  const c2 = createCamera({ gl: false }); assert.equal(c2.update(0, io).zoom, 1);
  const touch = createCamera({ gl: true, touch: true }); for (let t = 0; t < 5000; t += 16) p = touch.update(t, io); assert.equal(p.dx, 0); assert.equal(p.dy, 0);
  const red = createCamera({ gl: true, reduced: true }); red.win(0); for (let t = 0; t < 3000; t += 16) { p = red.update(t, io); assert.deepEqual([p.zoom, p.dx, p.dy], [1, 0, 0]); }
  const off = createCamera({ gl: true, enabled: false }); p = off.update(500, io); assert.deepEqual([p.zoom, p.dx, p.dy], [1, 0, 0]);
});

test('V3-18 : recentrage = 3,5 % du vecteur ; poussée de victoire 0 → +0,14 en 140 ms puis exp(−2,6 t) ; glissement +0,02', () => {
  const cam = createCamera({ gl: false });
  const io = { w: 1000, h: 800, pointer: null, dragging: false, target: { x: 200, y: -100 } };
  let p; for (let t = 0; t < 30000; t += 16) p = cam.update(t, io);
  assert.ok(Math.abs(p.dx - 7) < 0.05 && Math.abs(p.dy + 3.5) < 0.05, `recentrage ${p.dx} ${p.dy}`);
  cam.win(30000);
  const at = (ms) => cam.update(30000 + ms, io).zoom - 1;
  assert.ok(Math.abs(at(140) - 0.14) < 1e-9, 'sommet à 140 ms');
  assert.ok(Math.abs(at(70) - 0.07) < 0.02, 'montée linéaire');
  assert.ok(Math.abs(at(1140) - 0.14 * Math.exp(-2.6)) < 0.01, 'retombée exp(−2,6 t)');
  const d = createCamera({ gl: false }); let q; for (let t = 0; t < 3000; t += 16) q = d.update(t, { ...io, dragging: true, target: null }); assert.ok(Math.abs(q.zoom - 1.02) < 1e-3);
});

test('V3-19 : le décalage est gelé dès l\'appui sur une pièce, pendant la prise, et 200 ms après le lâcher', () => {
  const cam = createCamera({ gl: true });
  const io = { w: 1000, h: 800, pointer: { nx: 1, ny: 0 }, dragging: false, target: null };
  for (let t = 0; t < 2000; t += 16) cam.update(t, io);
  cam.hold();
  const frozen = cam.update(2016, io).dx;
  for (let t = 2032; t < 4000; t += 16) assert.equal(cam.update(t, { ...io, pointer: { nx: -1, ny: 0 } }).dx, frozen);
  cam.release(4000);
  assert.equal(cam.update(4100, { ...io, pointer: { nx: -1, ny: 0 } }).dx, frozen, 'encore gelé à +100 ms');
  assert.notEqual(cam.update(4300, { ...io, pointer: { nx: -1, ny: 0 } }).dx, frozen, 'dégelé après 200 ms');
});

test('V3-19 : 1 000 000 de projections pointeur → case, 0 erreur (DPR 1 et 2, plateaux de 3×3 à 16×12, 320×240 à 4K, poses extrêmes, étirement CSS)', (t) => {
  const rnd = xorshift(20261109);
  const sizes = [[1920, 1080], [2560, 1440], [3840, 2160], [1280, 720], [412, 915], [915, 412], [360, 640], [320, 240], [3440, 1440], [800, 600]];
  let n = 0, bad = 0, skipped = 0, outsideBad = 0, edge = 0;
  for (let t = 0; t < 1000000; t++) {
    const [w, h] = sizes[(rnd() * sizes.length) | 0], dpr = rnd() < 0.5 ? 1 : 2;
    const cols = 3 + ((rnd() * 14) | 0), rows = 3 + ((rnd() * 10) | 0);
    const L = layout({ w, h, cols, rows });
    const zoom = 0.9 + rnd() * 0.15, sh = Math.min(w, h) * 0.05;
    const V = makeView(L, zoom, (rnd() * 2 - 1) * sh, (rnd() * 2 - 1) * sh, cols, rows);
    const c = (rnd() * cols) | 0, r = (rnd() * rows) | 0;
    // points : extrêmes de la case (à un demi-pixel d'écran du bord, le plus près que l'écran permet), centre, tirage libre
    const m = 0.5 / V.k, fx = t % 4 === 0 ? m : t % 4 === 1 ? 1 - m : rnd(), fy = t % 5 === 0 ? m : t % 5 === 1 ? 1 - m : rnd();
    if (t % 4 < 2 || t % 5 < 2) edge++;
    const p = worldToScreen(V, c + fx, r + fy);
    // fenêtre étirée (V3-19) : le canvas présenté faisait w×h, il est maintenant s fois plus large/haut, décalé de façon fractionnaire
    const sx = t % 7 === 0 ? 1 + rnd() * 0.3 : 1, sy = t % 7 === 0 ? 1 + rnd() * 0.3 : 1;
    const rect = { left: rnd() * 40 - 20, top: rnd() * 40 - 20, width: w * sx, height: h * sy };
    // pixel physique : le pointeur tombe sur le centre d'un pixel d'écran (1/dpr px CSS)
    const clientX = rect.left + (Math.floor(p[0] * sx * dpr) + 0.5) / dpr, clientY = rect.top + (Math.floor(p[1] * sy * dpr) + 0.5) / dpr;
    const back = [(clientX - rect.left) / sx, (clientY - rect.top) / sy]; // point effectivement visé, dans le repère de l'image
    const ex = (back[0] - V.tx) / V.k, ey = (back[1] - V.ty) / V.k; // vérité terrain indépendante : coordonnées monde du pixel visé
    if (Math.abs(ex - Math.round(ex)) < 1e-7 || Math.abs(ey - Math.round(ey)) < 1e-7) { skipped++; continue; } // pile sur une frontière : ambigu, écarté et compté
    const want = ex >= 0 && ey >= 0 && ex < cols && ey < rows ? { c: Math.floor(ex), r: Math.floor(ey) } : null;
    const got = cellAtClient(V, clientX, clientY, rect, { width: w, height: h });
    n++;
    if (want === null ? got !== null : got === null || got.c !== want.c || got.r !== want.r) bad++;
    // le centre d'une case est toujours dans la case, hors plateau toujours null
    if (t % 10 === 0) {
      const q = worldToScreen(V, c + 0.5, r + 0.5), g = cellAt(V, q[0], q[1]); if (!g || g.c !== c || g.r !== r) bad++;
      const o = worldToScreen(V, -0.05, rnd() * rows), z = cellAt(V, o[0], o[1]); if (z !== null) outsideBad++;
      const back2 = screenToWorld(V, q[0], q[1]); if (Math.abs(back2[0] - (c + 0.5)) > 1e-9) bad++;
    }
  }
  assert.equal(bad, 0); assert.equal(outsideBad, 0);
  t.diagnostic(`projections testées ${n}, écartées (pile sur frontière) ${skipped}, points extrêmes ${edge}`);
  assert.ok(n > 950000 && edge > 400000, `projections ${n} (écartées pile sur frontière : ${skipped}), points extrêmes ${edge}`);
});

test('V9b : dalle (pad 0,30 case) tenue à l\'écart des obstacles ; légende de coin en 915×412 : recul latéral, la case reste grande ; sans obstacle rien ne change', () => {
  const base = { w: 915, h: 412, cols: 6, rows: 4 };
  assert.deepEqual(layout({ ...base, pad: 0.3, cornerRetreat: true }), layout(base), 'sans obstacle : pad sans effet');
  const caption = { x: 10, y: 376, w: 180, h: 26 }, dockR = { x: 853, y: 83, w: 54, h: 246 }, tl = { x: 12, y: 12, w: 160, h: 46 };
  const obstacles = [tl, dockR, caption];
  const old = layout({ ...base, obstacles });
  const L = layout({ ...base, obstacles, pad: 0.3, cornerRetreat: true });
  const slabBox = { l: L.x0 - 0.3 * L.cell, r: L.x0 + L.boardW + 0.3 * L.cell, t: L.y0 - 0.3 * L.cell, b: L.y0 + L.boardH + 0.3 * L.cell };
  for (const o of obstacles) assert.ok(gapBetween(slabBox, o) > 0, `dalle contre obstacle ${JSON.stringify(o)} : écart ${gapBetween(slabBox, o).toFixed(1)}`);
  assert.ok(L.cell >= old.cell * 0.95, `case ${L.cell.toFixed(1)} contre ${old.cell.toFixed(1)} sans dalle`);
});
