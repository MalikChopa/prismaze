// E12 (d), (e) et propriétés de E5/E8 sur des plateaux aléatoires denses (générateur de tests/engine-crosscheck, graines fixes) :
//  (d) tracé = OU des trois tracés monocanaux, portes fixées ;  (e) steps <= 12·cases ;
//  E5 : l'ordre des pièces (donc de la pile) n'influe pas ; `order` liste chaque case éclairée une fois ;
//  E8 (lemme) : retirer une pièce mobile inutilisée ne change pas le champ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, traceBoard } from './engine.mjs';
import { makeGenerator } from '../engine-crosscheck/generate.mjs';

const N = 4000;
const boards = (seed, n = N) => { const { randomFull } = makeGenerator(seed); return Array.from({ length: n }, () => randomFull()); };
const traced = (st) => { const b = buildBoard(st); return { b, r: traceBoard(b) }; };

test('E12 (d) : tracé complet = OU des trois tracés monocanaux (émetteurs réduits à un bit mais gardés opaques, portes fixées dans leur état final)', () => {
  let withLight = 0, openGates = 0;
  for (const st of boards(31)) {
    const { b, r } = traced(st);
    const gateOpen = []; // état final des portes, dans l'ordre des pièces porte
    st.pieces.forEach((p, id) => { if (p.type === 'gate') gateOpen[id] = r.gates[gateOpen.filter((x) => x !== undefined).length].open; });
    const or = new Uint8Array(b.n * 4);
    for (const bit of [1, 2, 4]) {
      const pieces = [];
      st.pieces.forEach((p, id) => {
        if (p.type === 'emitter') pieces.push({ ...p, mask: p.mask & bit }); // l'émetteur reste (opaque) même sans ce canal
        else if (p.type === 'gate') { if (!gateOpen[id]) pieces.push({ type: 'wall', c: p.c, r: p.r }); } // fermée = mur, ouverte = case vide
        else pieces.push(p);
      });
      const { r: rc } = traced({ cols: st.cols, rows: st.rows, pieces });
      for (let i = 0; i < or.length; i++) {
        assert.ok((rc.in[i] & ~bit) === 0, 'un canal ne porte que son bit');
        or[i] |= rc.in[i];
      }
    }
    assert.deepEqual([...or], [...r.in], JSON.stringify(st));
    if (r.orderCount > 0) withLight++;
    openGates += r.gates.filter((g) => g.open).length;
  }
  assert.ok(withLight > N * 0.5 && openGates > 50, `couverture : ${withLight} plateaux éclairés, ${openGates} portes ouvertes`);
});

test('E12 (e) : steps <= 12·cases et jamais capped, sur tous les plateaux aléatoires', () => {
  let maxRatio = 0;
  for (const st of boards(32)) {
    const { b, r } = traced(st);
    assert.ok(r.steps <= 12 * b.n, `${r.steps} > 12·${b.n}`);
    assert.equal(r.capped, false);
    maxRatio = Math.max(maxRatio, r.steps / (12 * b.n));
  }
  assert.ok(maxRatio > 0.05, `le jeu de plateaux n'est pas trivial (ratio max ${maxRatio.toFixed(3)})`);
});

test('E5 : l\'ordre des pièces (donc l\'ordre de la pile) n\'influe pas sur le champ de lumière', () => {
  let seed = 7;
  const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  for (const st of boards(33, 1500)) {
    const r1 = traced(st).r;
    const ref = [...r1.in], refOpen = r1.gates.map((g) => g.cell + ':' + g.open).sort();
    const pieces = st.pieces.slice();
    for (let i = pieces.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [pieces[i], pieces[j]] = [pieces[j], pieces[i]]; }
    const r2 = traced({ cols: st.cols, rows: st.rows, pieces }).r;
    assert.deepEqual([...r2.in], ref);
    assert.deepEqual(r2.gates.map((g) => g.cell + ':' + g.open).sort(), refOpen);
  }
});

test('E10 : `order` liste chaque case éclairée exactement une fois, orderCount = nombre de cases éclairées', () => {
  for (const st of boards(34, 1500)) {
    const { b, r } = traced(st);
    const lit = [];
    for (let c = 0; c < b.n; c++) if ((r.in[c * 4] | r.in[c * 4 + 1] | r.in[c * 4 + 2] | r.in[c * 4 + 3]) !== 0) lit.push(c);
    assert.equal(r.orderCount, lit.length);
    assert.deepEqual([...r.order.slice(0, r.orderCount)].sort((a, b2) => a - b2), lit);
  }
});

test('E8 lemme : retirer une pièce mobile inutilisée ne change pas le champ de lumière', () => {
  let removed = 0;
  for (const st of boards(35, 3000)) {
    const { b, r } = traced(st);
    const ref = [...r.in], refOut = [...r.out];
    const unused = [];
    st.pieces.forEach((p, id) => { if (b.movable[id] === 1 && r.used[id] === 0) unused.push(id); });
    for (const id of unused) {
      const pieces = st.pieces.filter((_, i) => i !== id).map((p) => ({ ...p }));
      // les portes dont la cible est inchangée gardent leur lien (par coordonnées) : on retrace
      const r2 = traced({ cols: st.cols, rows: st.rows, pieces }).r;
      assert.deepEqual([...r2.in], ref, `pièce ${id} (${st.pieces[id].type}) retirée`);
      assert.deepEqual([...r2.out], refOut);
      removed++;
    }
  }
  assert.ok(removed > 2000, `pièces inutilisées retirées : ${removed}`);
});

test('E8 : usedMovable = nombre de pièces `used` mobiles, jamais plus que le nombre de pièces mobiles', () => {
  for (const st of boards(36, 1500)) {
    const { b, r } = traced(st);
    let n = 0, mov = 0;
    st.pieces.forEach((p, id) => { if (b.movable[id] === 1) { mov++; if (r.used[id] === 1) n++; } });
    assert.equal(r.usedMovable, n);
    assert.ok(n <= mov);
  }
});
