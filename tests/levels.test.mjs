// Niveaux livrés (levels/index.json) : index F3 valide, chaque niveau a son fichier et sa preuve à jour, aucun fichier ni preuve en trop.
// J3 : l'index est encore vide (les 50 niveaux viennent en J7) ; ces contrôles s'appliquent dès le premier niveau ajouté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { validateIndex, validateLevel, validateProof, canonicalLevelText } from '../src/engine/level.js';
import { verifyLevels, levelHashHex, formatReport } from '../tools/verify-levels.mjs';

const root = new URL('../levels/', import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, root), 'utf8'));
const idx = validateIndex(read('index.json'));

test('index : valide (F3), ids uniques au bon format', () => {
  assert.deepEqual(idx.errors, []);
  assert.equal(new Set(idx.ids).size, idx.ids.length);
});

test('chaque niveau indexé : fichier valide en mode livré (V1-V15), id = nom du fichier, preuve à jour (hachage, versions, rejeu)', () => {
  for (const id of idx.ids) {
    const level = read(`${id}.json`);
    const v = validateLevel(level, { mode: 'shipped', expectedId: id });
    assert.deepEqual(v.errors, [], id);
    const proof = read(`proofs/${id}.proof.json`);
    const p = validateProof(level, proof, levelHashHex(level));
    assert.deepEqual(p.errors, [], id);
    assert.ok(canonicalLevelText(level).length > 0);
  }
});

test('aucun fichier de niveau hors index, aucune preuve orpheline', () => {
  const known = new Set(idx.ids);
  const files = readdirSync(root).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => f.slice(0, -5));
  assert.deepEqual(files.filter((id) => !known.has(id)), []);
  if (existsSync(new URL('proofs/', root))) {
    const proofs = readdirSync(new URL('proofs/', root)).filter((f) => f.endsWith('.proof.json')).map((f) => f.slice(0, -'.proof.json'.length));
    assert.deepEqual(proofs.filter((id) => !known.has(id)), []);
  }
});

test('verifyLevels sur le dépôt : OK, aucun avertissement de courbe', () => {
  const rep = verifyLevels();
  assert.equal(rep.ok, true, formatReport(rep));
  assert.deepEqual(rep.levels.flatMap((l) => l.warnings.filter((w) => /^D2/.test(w))), []);
});
