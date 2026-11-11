// Vérifie les niveaux livrés (ARCHITECTURE_V2 F2 V1-V15, F3, S4-S6, C1) et leurs preuves.
//
// Usage : node tools/verify-levels.mjs [--update] [--dry-run] [--root <dossier>] [--dir <dossier>] [--max-nodes N] [--max-solutions N]
//   (sans option)  vérifie levels/index.json, chaque niveau indexé et sa preuve levels/proofs/<id>.proof.json
//   --update       écrit `par` et `solutions` dans le fichier du niveau et la preuve S6 (jamais pour un niveau refusé)
//   --dry-run      avec --update : liste ce qui changerait sans rien écrire
//   --root         dossier contenant levels/ (défaut : la racine du dépôt) ; sert aux tests, qui travaillent sur des copies
//   --dir          vérifie tous les *.json d'un dossier (hors index.json) sans index ni courbe : levels/_pilots, candidats ;
//                  les preuves sont dans <dossier>/proofs/
//   --max-nodes / --max-solutions  plafonds d'exploration ; AU-DESSUS des plafonds de livraison (2 M nœuds, 256 solutions) le résultat
//                  est NON LIVRABLE : avertissement sur stderr, échec (code 1), rien n'est écrit. En dessous, ils ne font que durcir.
// Code de sortie : 0 si tout est bon, 1 sinon, 2 si l'usage est faux.
//
// Par niveau : V1-V15 (engine/level.js, mode livré), plateau <= 10x8 (P8), mobiles <= 8 et <= 6 dès qu'un type spécial est
// mobile (S5), solveur (statut proved-optimal, minimum >= 1, <= 2 M nœuds, <= 256 solutions minimales), V14 (preuve : hachage de
// canonicalLevelText, versions, rejeu du témoin et du garage par le moteur seul, contenu égal au recalcul) et, pour les
// identifiants m01..x10, les bandes de la courbe C1. Globaux : fichier non indexé, id sans fichier, id en double (F3).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateLevel, validateIndex, validateProof, canonicalLevelText } from '../src/engine/level.js';
import { solve, LimitError, DEFAULT_MAX_NODES, MAX_SOLUTIONS_AT_MIN, MAX_STORED, RULES_VERSION, SOLVER_VERSION } from '../src/engine/solver.js';
import { createState } from '../src/engine/state.js';
import { buildBoard } from '../src/engine/board.js';
import { trace } from '../src/engine/trace.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_COLS = 10; // P8
export const MAX_ROWS = 8;
export const MAX_MOBILE_SPECIAL = 6; // S5 : <= 6 mobiles dès qu'un type spécial (prisme, filtre, séparateur) est mobile
export const D2_RISE_MAX = 8; // C1 : hausse d'un niveau au suivant
export const D2_DROP_WARN = 2; // C1 : baisse (avertissement)
export const TUTORIAL_EXEMPT = Object.freeze(['p01', 's01', 'c03']); // C1 : minimum 1 quel que soit leur rang

/**
 * C1 : courbe par chapitre. Le chapitre se lit au premier caractère de l'id (m01..m10, c01..c10, p.., s.., x..) ; le rang du
 * niveau dans le chapitre (01 à 10) donne la bande (rang 1-2, 3-4, 5-6, 7-8, 9-10). `bands` = [min, max] du minimum par bande.
 */
export const CURVE = Object.freeze({
  m: { name: 'Miroirs', bands: [[1, 1], [1, 2], [2, 3], [3, 4], [4, 6]], maxMovable: 8, maxNodes: 300000, solutions: [1, 4] },
  c: { name: 'Couleurs', bands: [[1, 1], [2, 2], [3, 3], [3, 4], [4, 5]], maxMovable: 6, maxNodes: 100000, solutions: [1, 3] },
  p: { name: 'Prismes', bands: [[2, 2], [3, 3], [3, 4], [4, 4], [4, 5]], maxMovable: 6, maxNodes: 300000, solutions: [1, 3] },
  s: { name: 'Pièces spéciales', bands: [[2, 2], [3, 3], [3, 4], [4, 4], [4, 5]], maxMovable: 6, maxNodes: 500000, solutions: [1, 3] },
  x: { name: 'Maîtrise', bands: [[4, 4], [4, 5], [5, 5], [5, 5], [5, 6]], maxMovable: 6, maxNodes: 2000000, solutions: [1, 12], maxManySolutions: 10 }, // décision Diapason 2026-11-08 : jusqu'à 12 solutions minimales par niveau, 10 niveaux sur 10 peuvent en avoir plus de 2 (J7, voir JOURNAL)
});

/** { chapter:'m', rank:1..10 } si l'id est de la forme m01..x10 (suivi de « - » et d'un nom, ou rien) ; sinon null. */
export function curveSlot(id) {
  const m = /^([mcpsx])(\d\d)(?:-|$)/.exec(id);
  if (m === null) return null;
  const rank = Number(m[2]);
  return rank >= 1 && rank <= 10 ? { chapter: m[1], rank } : null;
}

/** Contrôle d'un niveau contre la bande de C1 ; renvoie la liste des messages d'erreur (vide si tout va bien). */
export function curveErrors(id, info) {
  const slot = curveSlot(id);
  if (slot === null) return [];
  const spec = CURVE[slot.chapter];
  const errs = [];
  const [lo, hi] = spec.bands[Math.ceil(slot.rank / 2) - 1];
  const exempt = TUTORIAL_EXEMPT.includes(id.slice(0, 3));
  if (!(info.minimum <= hi && (exempt ? info.minimum >= 1 : info.minimum >= lo))) {
    errs.push(`C1 courbe : minimum ${info.minimum} hors de la bande ${exempt ? '1' : lo}-${hi} (chapitre ${spec.name}, rang ${slot.rank})`);
  }
  if (info.K > spec.maxMovable) errs.push(`C1 courbe : ${info.K} pièces mobiles pour un maximum de ${spec.maxMovable} (chapitre ${spec.name})`);
  if (info.nodes > spec.maxNodes) errs.push(`C1 courbe : ${info.nodes} nœuds pour un maximum de ${spec.maxNodes} (chapitre ${spec.name})`);
  if (info.solutionsAtMin < spec.solutions[0] || info.solutionsAtMin > spec.solutions[1]) {
    errs.push(`C1 courbe : ${info.solutionsAtMin} solutions minimales hors de ${spec.solutions[0]} à ${spec.solutions[1]} (chapitre ${spec.name})`);
  }
  return errs;
}

// ---------------------------------------------------------------------------------------------------------------
// Hachage, formats de fichier, métriques

/** sha256 hexadécimal du texte canonique du niveau (size + pièces), hors id, nom, par, solutions (F1, J2 décision 2). */
export function levelHashHex(level) {
  return createHash('sha256').update(canonicalLevelText(level)).digest('hex');
}

/** JSON canonique : clés triées à tous les niveaux, aucun espace (comparaison de preuves). */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Texte d'un fichier de niveau livré : une pièce par ligne, `par` et `solutions` à la fin, saut de ligne final, toujours « \n ». */
export function formatLevel(level) {
  const lines = ['{'];
  lines.push(`  "format": ${level.format},`);
  lines.push(`  "id": ${JSON.stringify(level.id)},`);
  if (level.name !== undefined) lines.push(`  "name": ${JSON.stringify(level.name)},`);
  lines.push(`  "size": ${JSON.stringify(level.size)},`);
  const tail = level.par !== undefined ? ',' : '';
  lines.push('  "pieces": [');
  level.pieces.forEach((p, i) => lines.push(`    ${JSON.stringify(p)}${i < level.pieces.length - 1 ? ',' : ''}`));
  lines.push(`  ]${tail}`);
  if (level.par !== undefined) {
    lines.push(`  "par": ${level.par},`);
    lines.push('  "solutions": [');
    level.solutions.forEach((s, i) => lines.push(`    ${JSON.stringify(s)}${i < level.solutions.length - 1 ? ',' : ''}`));
    lines.push('  ]');
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** Texte du fichier de preuve : une ligne par clé, saut de ligne final, toujours « \n », sans horodatage. */
export function formatProof(proof) {
  const keys = Object.keys(proof);
  const lines = keys.map((k, i) => `${JSON.stringify(k)}:${JSON.stringify(proof[k])}${i < keys.length - 1 ? ',' : ''}`);
  return `{\n${lines.join('\n')}\n}\n`;
}

const SPECIAL = ['splitter', 'prism', 'filter'];

/** Pièces d'un niveau avec un jeu de placements posé à la place des pièces mobiles (même forme que replayPlacements). */
export function levelWithPlacements(level, placements) {
  const fixed = level.pieces.filter((p) => !(['mirror', 'splitter', 'prism', 'filter'].includes(p.type) && p.fixed !== true));
  return { size: level.size, pieces: fixed.concat(placements) };
}

/**
 * Métriques d'une solution (C1) lues sur le tracé du moteur, témoin + garage posés.
 * pathLength = états (case, direction) éclairés ; crossings = cases traversées sur les deux axes ; specialTypes = types
 * spéciaux distincts parmi les pièces du témoin ; D2 = 3·minimum + 2·specialTypes + longueur/5 + 2·croisements + 3·log10(nœuds).
 */
export function describeSolution(level, res) {
  const lv = levelWithPlacements(level, res.witness.concat(res.parking));
  const board = buildBoard(createState(lv));
  const t = trace(board);
  let pathLength = 0;
  let crossings = 0;
  const [cols, rows] = level.size;
  for (let cell = 0; cell < cols * rows; cell++) {
    const h = board.inM[cell * 4] !== 0 || board.inM[cell * 4 + 2] !== 0;
    const v = board.inM[cell * 4 + 1] !== 0 || board.inM[cell * 4 + 3] !== 0;
    for (let d = 0; d < 4; d++) if (board.inM[cell * 4 + d] !== 0) pathLength++;
    if (h && v) crossings++;
  }
  const specialTypes = new Set(res.witness.filter((p) => SPECIAL.includes(p.type)).map((p) => p.type)).size;
  const D2 = 3 * res.minimum + 2 * specialTypes + pathLength / 5 + 2 * crossings + 3 * Math.log10(Math.max(1, res.nodes));
  return { allLit: t.allLit, usedMovable: t.usedMovable, pathLength, crossings, specialTypes, D2: Math.round(D2 * 10) / 10 };
}

/** Fausse piste (C1) = 1 - solutions relaxées / feuilles à k = minimum ; cible >= 0,9 sur les niveaux 6 à 10 de chaque chapitre. */
export function falseTrail(res) {
  return res.leaves > 0 ? Math.round((1 - res.solutionsRelaxed / res.leaves) * 1000) / 1000 : 0;
}

/** Contenu de la preuve S6 pour un niveau et le résultat de `solve(level, {countAll:true})`. */
export function buildProof(level, res) {
  const d = describeSolution(level, res);
  const kinds = new Set(level.pieces.filter((p) => ['mirror', 'splitter', 'prism', 'filter'].includes(p.type) && p.fixed !== true).map((p) => p.type));
  return {
    format: 2,
    levelId: level.id,
    levelHash: `sha256:${levelHashHex(level)}`,
    rulesVersion: RULES_VERSION,
    solverVersion: SOLVER_VERSION,
    status: res.status,
    minimum: res.minimum,
    solutionsAtMin: res.solutionsAtMin,
    witness: res.witness,
    parking: res.parking,
    metrics: {
      movable: res.K, kinds: [...kinds].sort(), targets: level.pieces.filter((p) => p.type === 'target').length,
      nodes: res.nodes, nodesTotal: res.nodesTotal, leaves: res.leaves, solutionsRelaxed: res.solutionsRelaxed,
      falseTrail: falseTrail(res), pathLength: d.pathLength, crossings: d.crossings, specialTypes: d.specialTypes, D2: d.D2,
    },
  };
}

/** Écriture atomique : fichier temporaire voisin puis renommage (un arrêt en cours d'écriture ne laisse pas un JSON tronqué). */
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const lists = (v) => v.errors.map((e) => `${e.code} ${e.path} : ${e.message}`);

/**
 * Vérifie un dossier de niveaux.
 * @param {{root?:string, dir?:string, update?:boolean, dryRun?:boolean, maxNodes?:number}} [options]
 * @returns {{ok:boolean, levels:Array<object>, errors:string[], warnings:string[], changes:string[]}}
 */
export function verifyLevels(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const update = options.update === true;
  const dryRun = options.dryRun === true;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const countLimit = options.maxSolutions ?? MAX_SOLUTIONS_AT_MIN;
  const dirMode = options.dir !== undefined;
  // Plafonds de livraison (S4/S5) : une valeur au-dessus rend le résultat NON LIVRABLE (rien n'est écrit, échec, avertissement net).
  const aboveCeilings = maxNodes > DEFAULT_MAX_NODES || countLimit > MAX_SOLUTIONS_AT_MIN;
  const levelsDir = dirMode ? path.resolve(root, options.dir) : path.join(root, 'levels');
  const proofsDir = path.join(levelsDir, 'proofs');
  const globalErrors = [];
  const globalWarnings = [];
  const changes = [];
  const report = [];
  if (aboveCeilings) {
    globalErrors.push(`NON LIVRABLE : plafonds au-dessus des plafonds de livraison (nœuds ${maxNodes} > ${DEFAULT_MAX_NODES} ou solutions ${countLimit} > ${MAX_SOLUTIONS_AT_MIN}) ; ce contrôle sert à l'exploration, aucune preuve ne peut être écrite ni acceptée`);
  }

  // ---- Index (F3) ou dossier libre
  let ids = [];
  if (dirMode) {
    if (!existsSync(levelsDir)) globalErrors.push(`dossier introuvable : ${levelsDir}`);
    else ids = readdirSync(levelsDir).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => f.slice(0, -5)).sort();
  } else {
    const indexFile = path.join(levelsDir, 'index.json');
    if (!existsSync(indexFile)) {
      globalErrors.push('levels/index.json introuvable');
    } else {
      try {
        const idx = validateIndex(readJson(indexFile));
        for (const e of idx.errors) globalErrors.push(`index ${e.code} ${e.path} : ${e.message}`);
        ids = idx.ids;
      } catch (e) {
        globalErrors.push(`index illisible : ${e.message}`);
      }
    }
    if (existsSync(levelsDir)) {
      const known = new Set(ids);
      for (const f of readdirSync(levelsDir)) {
        if (!f.endsWith('.json') || f === 'index.json') continue;
        if (!known.has(f.slice(0, -5))) globalErrors.push(`fichier non indexé : levels/${f} (l'ajouter à levels/index.json ou le retirer)`);
      }
    }
  }
  if (existsSync(proofsDir)) {
    const known = new Set(ids);
    for (const f of readdirSync(proofsDir)) {
      if (f.endsWith('.proof.json') && !known.has(f.slice(0, -'.proof.json'.length))) globalWarnings.push(`preuve orpheline : ${path.relative(root, path.join(proofsDir, f))} (aucun niveau de cet id)`);
    }
  }

  // ---- Niveaux
  const taken = [];
  const infos = []; // par chapitre : { id, rank, D2, solutionsAtMin }
  for (const id of ids) {
    const row = { id, errors: [], warnings: [], minimum: null, K: null, solutionsAtMin: null, nodes: null, D2: null, updated: false, pending: false };
    report.push(row);
    const err = (msg) => row.errors.push(msg);
    const file = path.join(levelsDir, `${id}.json`);
    if (!existsSync(file)) { err(`id de l'index sans fichier levels/${id}.json`); continue; }
    let raw;
    let rawText;
    try { rawText = readFileSync(file, 'utf8'); raw = JSON.parse(rawText); } catch (e) { err(`JSON illisible : ${e.message}`); continue; }

    // En mise à jour, `par` et `solutions` sont recalculés : on valide le niveau d'atelier (sans eux) puis le niveau livré complet.
    const probe = update && raw !== null && typeof raw === 'object' ? (() => { const c = { ...raw }; delete c.par; delete c.solutions; return c; })() : raw;
    const v = validateLevel(probe, { mode: update ? undefined : 'shipped', expectedId: id, takenIds: taken });
    taken.push(id);
    const shipErr = lists(v);
    const soft = v.errors.filter((e) => e.code === 'V10_ALREADY_WON' || e.code === 'V9_NO_FREE_CELL');
    const structural = v.errors.filter((e) => !soft.includes(e) && e.code !== 'V13_SOLUTIONS');
    for (const e of shipErr) err(e);
    if (structural.length > 0 || typeof raw !== 'object' || raw === null) continue;
    const level = raw;
    if (level.size[0] > MAX_COLS || level.size[1] > MAX_ROWS) err(`plateau ${level.size[0]}x${level.size[1]} au-delà du plafond ${MAX_COLS}x${MAX_ROWS} (P8)`);

    // plafonds de pièces mobiles (S5), avant le solveur : un niveau hors plafond n'est pas résolu
    const movables = level.pieces.filter((p) => ['mirror', 'splitter', 'prism', 'filter'].includes(p.type) && p.fixed !== true);
    const special = movables.some((p) => p.type !== 'mirror');
    row.K = movables.length;
    if (movables.length > 8 || (special && movables.length > MAX_MOBILE_SPECIAL)) {
      err(`${movables.length} pièces mobiles : au plus ${special ? MAX_MOBILE_SPECIAL : 8}${special ? ' avec un type spécial mobile' : ''} (S5)`);
      continue;
    }

    let res;
    try {
      res = solve(probe, { maxNodes, countAll: true, countLimit });
    } catch (e) {
      if (e instanceof LimitError) err(`le solveur dépasse ${maxNodes} nœuds`);
      else err(`erreur interne du solveur : ${e.message}`);
      continue;
    }
    row.K = res.K;
    row.nodes = res.nodes;
    if (res.status === 'unknown') { err(`statut unknown : plus de ${maxNodes} nœuds sans témoin (le minimum n'est pas prouvé)`); continue; }
    if (res.status === 'unsolvable-proved') { err(`insoluble avec les ${res.K} pièces mobiles (unsolvable-proved)`); continue; }
    row.minimum = res.minimum;
    row.solutionsAtMin = res.solutionsAtMin;
    if (res.minimum < 1) err(`minimum ${res.minimum} : un niveau livré demande au moins 1 pièce utilisée (V14)`);
    if (!res.counted && !res.overflow) err(`comptage des solutions tronqué au-delà de ${maxNodes} nœuds : niveau trop coûteux`);
    if (res.overflow) err(`plus de ${countLimit} solutions minimales (l'indice et la preuve ne les garderaient pas)`);
    // niveau livrable seulement sous les plafonds de livraison, quelles que soient les options (point 8 de l'audit)
    if (res.nodes > DEFAULT_MAX_NODES) err(`NON LIVRABLE : ${res.nodes} nœuds de preuve, au-delà du plafond de livraison ${DEFAULT_MAX_NODES}`);
    if (res.solutionsAtMin !== null && res.solutionsAtMin > MAX_SOLUTIONS_AT_MIN) err(`NON LIVRABLE : ${res.solutionsAtMin} solutions minimales, au-delà du plafond de livraison ${MAX_SOLUTIONS_AT_MIN}`);
    // courbe C1 AVANT toute écriture : un niveau que la courbe refuse n'est ni écrit ni accompagné d'une preuve (audit point 4)
    if (row.errors.length === 0 && !dirMode) for (const e of curveErrors(id, { minimum: res.minimum, K: res.K, nodes: res.nodes, solutionsAtMin: res.solutionsAtMin })) err(e);

    // niveau livré complet (par + solutions) et preuve fraîche
    const solutions = res.solutions.slice(0, MAX_STORED).map((s) => s.witness);
    const shipped = { ...probe, par: res.minimum, solutions };
    const fresh = row.errors.length === 0 ? buildProof(shipped, res) : null;
    row.D2 = fresh === null ? null : fresh.metrics.D2;
    const levelText = formatLevel(shipped);
    const proofFile = path.join(proofsDir, `${id}.proof.json`);
    if (update && fresh !== null && !aboveCeilings) {
      const proofText = formatProof(fresh);
      const levelNew = !existsSync(file) || readFileSync(file, 'utf8') !== levelText;
      const proofNew = !existsSync(proofFile) || readFileSync(proofFile, 'utf8') !== proofText;
      if (levelNew) changes.push(`${path.relative(root, file)} : par=${res.minimum}, ${solutions.length} solution(s)`);
      if (proofNew) changes.push(`${path.relative(root, proofFile)} : preuve ${res.status}, minimum ${res.minimum}`);
      if (!dryRun) {
        if (levelNew) writeAtomic(file, levelText);
        if (proofNew) { mkdirSync(proofsDir, { recursive: true }); writeAtomic(proofFile, proofText); }
      }
      row.updated = !dryRun && (levelNew || proofNew); // jamais « écrit » en simulation
      row.pending = dryRun && (levelNew || proofNew);
    }
    // Niveau tel qu'il est (ou sera) sur le disque
    const onDisk = update && !dryRun ? shipped : raw;
    if (!update && row.errors.length === 0) {
      if (raw.par !== res.minimum) err(`V13 par (${raw.par}) différent du minimum prouvé (${res.minimum}) ; lancer --update`);
    }
    if (dryRun && update) { /* aucun contrôle de preuve : rien n'est écrit */ } else if (update && row.errors.length > 0) { /* niveau refusé : rien n'a été écrit, pas de contrôle de preuve */ } else if (!existsSync(proofFile)) {
      err(`V14_PROOF fichier : preuve absente : ${path.relative(root, proofFile)} (lancer avec --update)`);
    } else {
      let proof = null;
      try { proof = readJson(proofFile); } catch (e) { err(`V14_PROOF fichier : preuve illisible : ${e.message}`); }
      if (proof !== null && row.errors.length === 0) {
        const pv = validateProof(onDisk, proof, levelHashHex(onDisk));
        for (const e of pv.errors) err(`${e.code} ${e.path} : ${e.message}`);
        const freshOn = buildProof(onDisk, res);
        if (pv.ok && canonicalJson(proof) !== canonicalJson(freshOn)) {
          const diff = Object.keys(freshOn).filter((k) => canonicalJson(proof[k]) !== canonicalJson(freshOn[k]));
          err(`V14_PROOF recalcul : preuve différente du recalcul (champs : ${diff.join(', ') || 'clés en trop'}) ; altérée ou périmée`);
        }
      }
    }
    if (res.nodes > 500000) row.warnings.push(`${res.nodes} nœuds (> 500 000) : calcul d'un indice de secours lent (mesure de référence : 1 000 à 1 650 nœuds/ms ici)`);
    const slot = curveSlot(id);
    if (slot !== null && row.D2 !== null) infos.push({ id, chapter: slot.chapter, rank: slot.rank, D2: row.D2, solutionsAtMin: res.solutionsAtMin, row });
  }

  // ---- Courbe C1 par chapitre : D2 (avertissements), niveaux à plus de 2 solutions au chapitre 5 (erreur)
  if (!dirMode) {
    const cw = curveWarnings(infos);
    for (const w of cw.warnings) infos.find((x) => x.id === w.id).row.warnings.push(w.message);
    for (const e of cw.errors) globalErrors.push(e);
  }

  const levelErrors = report.reduce((n, r) => n + r.errors.length, 0);
  return { ok: globalErrors.length === 0 && levelErrors === 0, levels: report, errors: globalErrors, warnings: globalWarnings, changes };
}


/**
 * C1 par chapitre sur les niveaux déjà mesurés (infos = [{id, chapter, rank, D2, solutionsAtMin}]) : avertissements D2 (hausse de plus de
 * 8 ou baisse de plus de 2 d'un niveau au suivant) et erreurs de chapitre (`maxManySolutions` : nombre de niveaux à plus de 2 solutions ; chapitre 5 : 10 sur 10, donc sans effet depuis J7).
 * @returns {{warnings:Array<{id:string, message:string}>, errors:string[]}}
 */
export function curveWarnings(infos) {
  const warnings = [];
  const errors = [];
  for (const ch of Object.keys(CURVE)) {
    const list = infos.filter((x) => x.chapter === ch).sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < list.length; i++) {
      const delta = list[i].D2 - list[i - 1].D2;
      if (delta > D2_RISE_MAX) warnings.push({ id: list[i].id, message: `D2 monte de ${delta.toFixed(1)} (${list[i - 1].D2} -> ${list[i].D2}) : plus de ${D2_RISE_MAX}` });
      if (-delta > D2_DROP_WARN) warnings.push({ id: list[i].id, message: `D2 baisse de ${(-delta).toFixed(1)} (${list[i - 1].D2} -> ${list[i].D2}) : plus de ${D2_DROP_WARN}` });
    }
    const spec = CURVE[ch];
    if (spec.maxManySolutions !== undefined) {
      const many = list.filter((x) => x.solutionsAtMin > 2);
      if (many.length > spec.maxManySolutions) errors.push(`C1 courbe : chapitre ${spec.name} : ${many.length} niveaux à plus de 2 solutions minimales (${many.map((x) => x.id).join(', ')}) ; au plus ${spec.maxManySolutions} sur 10`);
    }
  }
  return { warnings, errors };
}

/** Texte lisible du rapport. */
export function formatReport(rep) {
  const lines = [];
  for (const e of rep.errors) lines.push(`ERREUR ${e}`);
  for (const w of rep.warnings) lines.push(`avertissement ${w}`);
  for (const c of rep.changes) lines.push(`modification : ${c}`);
  for (const r of rep.levels) {
    const head = `${r.id.padEnd(26)} min=${r.minimum ?? '-'} K=${r.K ?? '-'} solutions=${r.solutionsAtMin ?? '-'} noeuds=${r.nodes ?? '-'} D2=${r.D2 === null ? '-' : r.D2.toFixed(1)}`;
    lines.push(`${head}  ${r.errors.length === 0 ? (r.updated ? 'OK (écrit)' : r.pending ? 'OK (à écrire, simulation)' : 'OK') : 'REFUSÉ'}`);
    for (const e of r.errors) lines.push(`    ERREUR ${e}`);
    for (const w of r.warnings) lines.push(`    avertissement ${w}`);
  }
  const nErr = rep.errors.length + rep.levels.reduce((n, r) => n + r.errors.length, 0);
  lines.push(`${rep.levels.length} niveau(x), ${nErr} erreur(s), ${rep.warnings.length + rep.levels.reduce((n, r) => n + r.warnings.length, 0)} avertissement(s) : ${rep.ok ? 'OK' : 'ÉCHEC'}`);
  return lines.join('\n');
}

const USAGE = 'usage : node tools/verify-levels.mjs [--update] [--dry-run] [--root <dossier>] [--dir <dossier>] [--max-nodes N] [--max-solutions N]';

function main(argv) {
  const opt = { root: REPO_ROOT, update: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--update') opt.update = true;
    else if (argv[i] === '--dry-run') opt.dryRun = true;
    else if (argv[i] === '--root') opt.root = path.resolve(argv[++i] ?? '');
    else if (argv[i] === '--dir') opt.dir = argv[++i] ?? '';
    else if (argv[i] === '--max-nodes') opt.maxNodes = Number(argv[++i]);
    else if (argv[i] === '--max-solutions') opt.maxSolutions = Number(argv[++i]);
    else { console.error(`option inconnue : ${argv[i]}\n${USAGE}`); return 2; }
  }
  if (opt.dryRun && !opt.update) { console.error(`--dry-run demande --update\n${USAGE}`); return 2; }
  if ((opt.maxNodes !== undefined && !(opt.maxNodes > 0)) || (opt.maxSolutions !== undefined && !(opt.maxSolutions > 0))) { console.error(USAGE); return 2; }
  if ((opt.maxNodes !== undefined && opt.maxNodes > DEFAULT_MAX_NODES) || (opt.maxSolutions !== undefined && opt.maxSolutions > MAX_SOLUTIONS_AT_MIN)) {
    console.error(`!!! ATTENTION : --max-nodes / --max-solutions au-dessus des plafonds de livraison (${DEFAULT_MAX_NODES} nœuds, ${MAX_SOLUTIONS_AT_MIN} solutions) : résultat NON LIVRABLE, rien ne sera écrit, code de sortie 1 !!!`);
  }
  const rep = verifyLevels(opt);
  console.log(formatReport(rep));
  return rep.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
