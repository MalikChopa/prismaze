// Tests du certificateur independant (tools/certify-levels.mjs). Rapides (quelques secondes) : petits niveaux faits a la main, croisement
// avec la force brute sur des niveaux aleatoires, rejeu des niveaux livres les plus petits. Le certificat complet des 50 niveaux
// (`node tools/certify-levels.mjs --all`) est trop long pour `npm test` ; son resultat est dans docs/CERTIF_NIVEAUX.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as mod from '../../tools/certify-levels.mjs';
import { runHandmade, HANDMADE } from './levels.mjs';
import { crossCheck } from './crosscheck.mjs';
import { bruteForce } from './helpers.mjs';

const readJson = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));

test('niveaux faits a la main (un par type de piece) : minimum, victoires a par, par trop haut refute, par trop bas refuse, temoin non minimal refuse', () => {
  assert.deepEqual(runHandmade(mod), []);
  assert.ok(HANDMADE.length >= 10);
});

test('par trop haut : REFUTE avec la configuration gagnante imprimable ; le statut est celui qui fait echouer la commande', () => {
  const h = HANDMADE.find((x) => x.name.startsWith('miroir'));
  const lv = { ...h.level, par: 2, solutions: [h.witness] }; // le vrai minimum est 1
  const r = mod.certifyLevel(lv);
  assert.equal(r.status, 'réfuté');
  assert.equal(r.refutation.used, 1);
  assert.equal(r.refutation.placements.length, 1);
  assert.equal(r.refutation.placements[0].type, 'mirror');
  assert.ok(JSON.stringify(r.refutation).length > 10);
});

test('par juste : CONFIRME (enumeration terminee + temoin rejoue) ; sans temoin : jamais confirme', () => {
  const h = HANDMADE.find((x) => x.name.startsWith('deux emetteurs'));
  const ok = mod.certifyLevel({ ...h.level, par: 2, solutions: [h.witness] });
  assert.equal(ok.status, 'confirmé');
  assert.equal(ok.witnessOk, 1);
  const none = mod.certifyLevel({ ...h.level, par: 2, solutions: [] });
  assert.equal(none.status, 'témoin KO');
});

test('budget : un plafond de noeuds trop bas donne « non confirmé », jamais « confirmé »', () => {
  const h = HANDMADE.find((x) => x.name.startsWith('chaine de trois'));
  // le compteur de budget est teste tous les 1024 noeuds : ce petit niveau peut finir avant ; dans les deux cas, jamais un faux verdict
  const r = mod.certifyLevel({ ...h.level, par: 3, solutions: [h.witness] }, null, { maxSeconds: 1e-9 });
  assert.ok(r.status === 'confirmé' || r.status === 'non confirmé', r.status);
  const big = readJson('../../levels/m10-grand-final.json');
  const rb = mod.certifyLevel(big, null, { maxSeconds: 0.00001 });
  assert.equal(rb.status, 'non confirmé');
  assert.ok(rb.fraction < 1 && rb.fraction >= 0);
});

test('croisement avec la force brute : 150 niveaux aleatoires (tous types, portes, portails, 1-2 emetteurs), minimum identique', () => {
  const r = crossCheck(mod, 101, 150);
  assert.deepEqual(r.disagreements.map((d) => d.why), []);
  assert.ok(r.solvable >= 30, `trop peu de niveaux solubles : ${r.solvable}`);
});

test('croisement avec la force brute : niveaux serres (garage difficile) et deux emetteurs', () => {
  const a = crossCheck(mod, 103, 100, { tight: true });
  const b = crossCheck(mod, 104, 100, { twoEmitters: true });
  assert.deepEqual(a.disagreements.map((d) => d.why), []);
  assert.deepEqual(b.disagreements.map((d) => d.why), []);
});

test('croisement avec la force brute : 6 niveaux a 4 miroirs', () => {
  const r = crossCheck(mod, 105, 6, { mirrorsOnly: true, K: 4 });
  assert.deepEqual(r.disagreements.map((d) => d.why), []);
});

test('la force brute elle-meme : minimum d un niveau fait a la main', () => {
  const h = HANDMADE.find((x) => x.name.startsWith('prisme'));
  assert.equal(bruteForce(h.level).minimum, 1);
});

test('niveaux livres : les plus petits sont CONFIRMES (m01, c02, s03, p03) et un par trop haut est REFUTE', () => {
  for (const id of ['m01-tourner', 'c02-melange', 's03-portail', 'p03-trois-couleurs']) {
    const level = readJson(`../../levels/${id}.json`), proof = readJson(`../../levels/proofs/${id}.proof.json`);
    const r = mod.certifyLevel(level, proof, { maxSeconds: 20 });
    assert.equal(r.status, 'confirmé', `${id} : ${r.reason}`);
    assert.equal(r.minimumFound, level.par);
    if (level.par < r.K) assert.equal(mod.certifyLevel({ ...level, par: level.par + 1 }, proof, { maxSeconds: 20 }).status, 'réfuté', id);
  }
});

test('independance : le certificateur n importe ni le solveur, ni l indice, ni la validation de niveau', () => {
  const src = readFileSync(new URL('../../tools/certify-levels.mjs', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  for (const i of imports) assert.ok(!/solver|hint|level\.js|share|daily/.test(i), `import interdit : ${i}`);
  assert.ok(imports.some((i) => i.endsWith('engine/trace.js')) && imports.some((i) => i.endsWith('engine/board.js')));
});

test('ligne de commande : code 0 pour un par juste, code 1 + « RÉFUTÉ » pour un par trop haut, code 2 pour un usage faux (copie temporaire)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'certify-'));
  try {
    const h = HANDMADE.find((x) => x.name.startsWith('deux emetteurs'));
    mkdirSync(join(dir, 'proofs'));
    writeFileSync(join(dir, 'hm-ok.json'), JSON.stringify({ ...h.level, id: 'hm-ok', par: 2, solutions: [h.witness] }));
    const tool = new URL('../../tools/certify-levels.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const run = (...a) => spawnSync(process.execPath, [tool, '--levels-dir', dir, ...a], { encoding: 'utf8' });
    const ok = run('--level', 'hm-ok');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /confirmé/);
    // un troisieme miroir est ajoute (K = 3) ; le minimum reste 2, on annonce par = 3 : refute
    writeFileSync(join(dir, 'hm-high.json'), JSON.stringify({ ...h.level, id: 'hm-high', par: 3, solutions: [h.witness], pieces: [...h.level.pieces, { type: 'mirror', at: [3, 2], o: '-' }] }));
    const bad = run('--level', 'hm-high');
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /RÉFUTÉ hm-high/);
    assert.equal(run('--bogus').status, 2);
    assert.equal(run().status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
