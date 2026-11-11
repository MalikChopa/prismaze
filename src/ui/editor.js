// Écran de l'éditeur (ARCHITECTURE_V2 F6, U4) : palette d'outils, plateau (moteur de rendu du jeu), plafonds de F2 en direct, annuler / refaire,
// Tester (témoin de l'auteur), Prouver (Worker annulable), Partager (lien F4), brouillons (20) et import. Clavier et toucher.
// Aucun texte venu d'un lien ou d'un brouillon n'entre dans le DOM autrement que par `textContent`.
import { createState } from '../engine/state.js';
import { buildBoard } from '../engine/board.js';
import { trace } from '../engine/trace.js';
import { encodeLevel, decodeShare, ShareError } from '../engine/share.js';
import { replayPlacements } from '../engine/level.js';
import { maskFromLetters, COLOR_SYMBOLS, COLOR_HUES, COLOR_NAMES } from '../engine/colors.js';
import { createRenderer } from '../render/renderer.js';
import { THEME } from '../render/theme.js';
import { createEditorModel, EDITOR_LIMITS, typeLabel } from './editor-model.js';
import { createModal, copyText, shareUrl, parseImportText } from './share-ui.js';
import { watchScroll } from './scroll-cue.js';
import { cellName, pieceDescription } from './a11y.js';

const COLORS7 = ['RGB', 'R', 'G', 'B', 'RG', 'RB', 'GB'];
const COLORS6 = ['R', 'G', 'B', 'RG', 'RB', 'GB'];
/** Outils dans l'ordre des touches 1 à 9 (puis 0 : effacer, L : cadenas). */
export const TOOLS = Object.freeze([
  { id: 'emitter', label: 'Émetteur', colors: COLORS7 }, { id: 'wall', label: 'Mur' }, { id: 'target', label: 'Cible', colors: COLORS7 },
  { id: 'mirror', label: 'Miroir' }, { id: 'splitter', label: 'Séparateur' }, { id: 'prism', label: 'Prisme' },
  { id: 'filter', label: 'Filtre', colors: COLORS6 }, { id: 'portal', label: 'Portail', pairs: true }, { id: 'gate', label: 'Porte' },
  { id: 'erase', label: 'Effacer' }, { id: 'lock', label: 'Cadenas' },
]);
/** Icônes de la palette (28 x 28, dessinées d'après la maquette B). Constantes du code : aucune donnée externe n'entre ici. */
const GLASS = 'fill="rgba(143,123,255,.16)" stroke="rgba(190,198,255,.75)"';
export const TOOL_ICONS = Object.freeze({
  emitter: '<polygon points="4,7 12,4 19,14 12,24 4,21" fill="#0d0e2a" stroke="#fff"/><circle cx="10" cy="14" r="2.6" fill="#fff" stroke="none"/>',
  wall: '<rect x="4" y="4" width="20" height="20" rx="4" fill="rgba(154,166,255,.2)" stroke="rgba(190,198,255,.8)"/><path d="M8 20 20 8M8 14l6-6M14 20l6-6" stroke="rgba(190,198,255,.45)" stroke-width="1"/>',
  target: '<polygon points="22.7,19 14,24 5.3,19 5.3,9 14,4 22.7,9" stroke="#ffe27a" stroke-dasharray="3 2" stroke-width="2"/><circle cx="14" cy="14" r="2" fill="#ffe27a" stroke="none"/>',
  mirror: `<rect x="4" y="4" width="20" height="20" rx="4" ${GLASS}/><path d="M7 21 21 7" stroke="#fff" stroke-width="2.8"/>`,
  splitter: '<polygon points="14,3 25,14 14,25 3,14" fill="rgba(200,206,255,.16)" stroke="#cfd4ff"/><path d="M8 20 20 8" stroke="#fff" stroke-width="2.2"/>',
  prism: '<polygon points="4,23 25,14 4,5" fill="rgba(200,206,255,.2)" stroke="#e8ebff"/>',
  filter: '<rect x="5" y="5" width="18" height="18" rx="4" fill="rgba(255,210,63,.28)" stroke="#ffd23f"/>',
  portal: '<circle cx="9" cy="14" r="7" stroke="#3de0ff" stroke-width="2"/><circle cx="19" cy="14" r="7" stroke="#c26bff" stroke-width="2"/>',
  gate: '<rect x="11" y="4" width="6" height="20" rx="2" fill="rgba(255,210,63,.22)" stroke="#ffd23f"/><path d="M2 14h7M19 14h7" stroke="#ffd23f" stroke-dasharray="2 3"/>',
  erase: '<path d="M10 6h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H10L3 14z"/><path d="m13 10 7 8m0-8-7 8"/>',
  lock: '<rect x="6" y="13" width="16" height="11" rx="2.5"/><path d="M9.5 13V10a4.5 4.5 0 0 1 9 0v3"/>',
});
const colorName = (letters) => COLOR_NAMES[maskFromLetters(letters)] || letters;

/**
 * @param {Document} doc
 * @param {{store:object, client:object, win:Window, onBack:()=>void, onTest:(info:{level:object,key:string})=>void, onOpenShared:(code:string)=>void,
 *   say:(text:string)=>void, now?:()=>number}} deps
 */
export function createEditor(doc, deps) {
  const { store, client, win, onBack, onTest, onOpenShared } = deps;
  const $ = (id) => doc.getElementById(id);
  const el = {
    screen: $('screen-edit'), canvas: $('edit-canvas'), back: $('edit-back'), name: $('edit-name'), size: $('edit-size'), undo: $('edit-undo'), redo: $('edit-redo'),
    tools: $('edit-tools'), options: $('edit-options'), status: $('edit-status'), msg: $('edit-msg'), test: $('edit-test'), prove: $('edit-prove'), share: $('edit-share'),
    drafts: $('edit-drafts'), proveOut: $('edit-prove-out'), cancel: $('edit-prove-cancel'), colsMinus: $('edit-cols-minus'), colsPlus: $('edit-cols-plus'),
    rowsMinus: $('edit-rows-minus'), rowsPlus: $('edit-rows-plus'), witnessNote: $('edit-witness'), toolName: $('edit-tool-name'),
  };
  const say = deps.say;
  const model = createEditorModel();
  const shareModal = createModal(doc, $('dlg-share'));
  const draftsModal = createModal(doc, $('dlg-drafts'));
  const cues = [watchScroll($('edit-scroll')), watchScroll($('edit-panel')), watchScroll($('edit-side'))]; // V12 : indice de défilement (panneau, palette)
  let renderer = null;
  let state = null;
  let result = null;
  let tool = { id: 'mirror', color: 'RGB', pair: 0 };
  let cursor = { c: 0, r: 0 };
  let showCursor = false;
  let pendingGate = null; // {c, r} : porte posée à lier
  let scheduled = false;
  let visible = false;
  let witness = null; // {key, used}
  let proving = null; // {cancel}
  let proveText = '';
  let draftId = null; // brouillon ouvert (Enregistrer le met à jour)
  let ro = null;
  const toolButtons = new Map();
  let optionButtons = [];

  const levelKey = () => { try { return encodeLevel({ ...model.level(), name: '' }); } catch { return ''; } };
  const witnessOk = () => witness !== null && witness.key === levelKey() && model.valid;

  function note(text, speak = true) { el.msg.textContent = text; if (speak) say(text); }

  // ---- palette ----
  function buildTools() {
    el.tools.replaceChildren();
    TOOLS.forEach((t, i) => {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'etool'; b.dataset.tool = t.id;
      b.innerHTML = `<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">${TOOL_ICONS[t.id]}</svg>`; // dessin constant du code ; le nom accessible est l'étiquette
      const keys = i < 9 ? ` (${i + 1})` : t.id === 'erase' ? ' (0, Suppr)' : ' (L)';
      b.title = `${t.label}${keys}`;
      b.setAttribute('aria-label', `${t.label}${keys}`);
      b.setAttribute('aria-pressed', 'false');
      b.tabIndex = -1;
      b.addEventListener('click', () => selectTool(t.id));
      el.tools.append(b);
      toolButtons.set(t.id, b);
    });
  }
  // barre d'outils : un seul arrêt de tabulation (l'outil choisi), flèches / Début / Fin pour parcourir les autres
  el.tools.addEventListener('keydown', (e) => {
    const list = [...toolButtons.values()];
    const i = list.indexOf(doc.activeElement);
    if (i < 0) return;
    const cols = Math.max(1, list.filter((b) => b.offsetTop === list[0].offsetTop).length); // outils par rangée (2 en palette verticale, 6 sur deux rangées)
    const to = { ArrowRight: i + 1, ArrowDown: i + cols, ArrowLeft: i - 1, ArrowUp: i - cols, Home: 0, End: list.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const n = list[Math.max(0, Math.min(list.length - 1, to))];
    for (const b of list) b.tabIndex = -1;
    n.tabIndex = 0; n.focus();
  });
  function buildOptions() {
    el.options.replaceChildren();
    optionButtons = [];
    const t = TOOLS.find((x) => x.id === tool.id);
    const add = (label, aria, pressed, onClick, style = null, cls = '') => {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = `eopt ${cls}`; b.textContent = label; b.setAttribute('aria-label', aria); b.setAttribute('aria-pressed', pressed ? 'true' : 'false'); b.title = aria;
      if (style) { b.style.background = style.bg; b.style.color = style.fg; }
      b.addEventListener('click', onClick);
      el.options.append(b);
      optionButtons.push(b);
    };
    if (t && t.colors) {
      for (const letters of t.colors) {
        const m = maskFromLetters(letters);
        add(COLOR_SYMBOLS[m], `${colorName(letters)}`, tool.color === letters, () => { tool = { ...tool, color: letters }; buildOptions(); say(colorName(letters)); }, { bg: COLOR_HUES[m], fg: '#06061a' });
      }
    } else if (t && t.pairs) {
      for (let k = 0; k < 4; k++) add('●'.repeat(k + 1), `paire ${k + 1}`, tool.pair === k, () => { tool = { ...tool, pair: k }; buildOptions(); say(`paire ${k + 1}`); });
    } else {
      const hints = { wall: 'Touche une case libre pour poser ou retirer un mur.', mirror: 'Touche une case libre : miroir. Touche-le encore pour le tourner.', splitter: 'Touche une case libre : séparateur. Touche-le encore pour le tourner.', prism: 'Touche une case libre : prisme (touche-le encore pour le retirer).', gate: 'Touche une case libre, puis la cible que la porte doit libérer.', erase: 'Touche une pièce pour l\'effacer (le clic droit ou Suppr marchent aussi).', lock: 'Touche un miroir, séparateur, prisme ou filtre : fixe ou mobile.' };
      const p = doc.createElement('span'); p.className = 'ehint'; p.textContent = hints[tool.id] || '';
      el.options.append(p);
    }
  }
  function selectTool(id) {
    if (pendingGate !== null && id !== 'gate') { pendingGate = null; }
    const spec = TOOLS.find((x) => x.id === id);
    tool = { ...tool, id, color: spec && spec.colors && !spec.colors.includes(tool.color) ? spec.colors[0] : tool.color }; // une couleur valable pour CET outil (le filtre n'a pas de blanc)
    for (const [k, b] of toolButtons) { b.setAttribute('aria-pressed', k === id ? 'true' : 'false'); b.tabIndex = k === id ? 0 : -1; }
    el.toolName.textContent = `${spec ? spec.label.toUpperCase() : ''} SÉLECTIONNÉ`;
    buildOptions();
    if (id === 'gate') pendingGate = null;
    say(`Outil : ${TOOLS.find((t) => t.id === id).label}`);
    requestDraw();
  }

  // ---- affichage ----
  function refresh() {
    const lv = model.level();
    state = createState(lv);
    result = trace(buildBoard(state));
    const c = model.counts();
    el.size.textContent = `${model.cols}×${model.rows}`;
    el.size.setAttribute('aria-label', `Plateau de ${model.cols} colonnes sur ${model.rows} lignes`);
    el.undo.disabled = !model.canUndo;
    el.redo.disabled = !model.canRedo;
    el.colsMinus.disabled = model.cols <= EDITOR_LIMITS.minCols; el.colsPlus.disabled = model.cols >= EDITOR_LIMITS.maxCols;
    el.rowsMinus.disabled = model.rows <= EDITOR_LIMITS.minRows; el.rowsPlus.disabled = model.rows >= EDITOR_LIMITS.maxRows;
    const probs = model.problems();
    const counts = `émetteurs ${c.emitters}/${EDITOR_LIMITS.emitters} · cibles ${c.targets}/${EDITOR_LIMITS.targets} · portes ${c.gates}/${EDITOR_LIMITS.gates} · paires de portails ${c.pairs}/${EDITOR_LIMITS.pairs} · mobiles ${c.mobiles}/${EDITOR_LIMITS.mobiles} · pièces ${c.pieces}/${EDITOR_LIMITS.pieces}`;
    el.status.textContent = '';
    const l1 = doc.createElement('span'); l1.textContent = counts;
    const l2 = doc.createElement('span'); l2.className = probs.length === 0 ? 'ok' : 'bad';
    // V13 : « (+2) » était obscur : « (et 2 autres) », la liste complète en infobulle
    l2.textContent = probs.length === 0 ? 'Niveau valide : tu peux le tester.' : `${probs[0].message}${probs.length > 1 ? ` (et ${probs.length - 1} autre${probs.length > 2 ? 's' : ''})` : ''}`;
    if (probs.length > 1) l2.title = probs.map((q) => q.message).join(' · '); else l2.removeAttribute('title');
    el.status.append(l1, doc.createTextNode(' '), l2);
    el.test.disabled = probs.length > 0;
    el.prove.disabled = probs.length > 0 || proving !== null;
    const ok = witnessOk();
    el.share.disabled = !ok;
    el.share.title = ok ? 'Copier le lien de ce niveau' : 'Gagne ton niveau avec « Tester » pour pouvoir le partager';
    el.witnessNote.textContent = ok ? `Témoin : résolu en ${witness.used} pièce${witness.used > 1 ? 's' : ''}. Tu peux partager.` : 'Pour partager : gagne ton niveau avec « Tester ».';
    if (el.name.value !== model.name && doc.activeElement !== el.name) el.name.value = model.name;
    fitNamePlaceholder();
  }
  function requestDraw() {
    if (!visible || scheduled) return;
    scheduled = true;
    requestAnimationFrame(frame);
  }
  function frame(ts) {
    scheduled = false;
    if (!visible || renderer === null || state === null) return;
    renderer.render(state, result, { now: ts, symbols: true, cursor: showCursor && doc.activeElement === el.canvas ? { c: cursor.c, r: cursor.r, holding: false } : null, lift: pendingGate ? { c: pendingGate.c, r: pendingGate.r } : null });
    if (renderer.animating) requestDraw();
  }
  function changed(message = null) {
    if (message) note(message);
    refresh();
    requestDraw();
  }
  const refuse = (r) => { note(`Impossible : ${r.message}`); requestDraw(); };

  // ---- actions sur une case ----
  function applyTool(c, r) {
    cursor = { c, r };
    const here = model.pieceAt(c, r);
    const at = cellName(c, r);
    switch (tool.id) {
      case 'erase': {
        const res = model.erase(c, r);
        return res.ok ? changed(`Effacé, ${at}`) : refuse(res);
      }
      case 'lock': {
        const res = model.toggleFixed(c, r);
        if (!res.ok) return refuse(res);
        return changed(`${typeLabel(model.pieceAt(c, r).type)} ${model.pieceAt(c, r).fixed ? 'fixe (cadenas fermé)' : 'mobile (cadenas ouvert)'}, ${at}`);
      }
      case 'gate': {
        if (pendingGate !== null) {
          if (here !== null && here.type === 'target') {
            const res = model.place(pendingGate.c, pendingGate.r, { type: 'gate', link: [c, r] });
            pendingGate = null;
            return res.ok ? changed(`Porte posée, liée à la cible ${at}`) : refuse(res);
          }
          if (pendingGate.c === c && pendingGate.r === r) { pendingGate = null; return changed('Porte annulée'); }
          return refuse({ message: 'clique sur une cible pour lier la porte (ou sur la même case pour annuler)' });
        }
        if (model.counts().targets === 0) return refuse({ message: 'pose d\'abord une cible : une porte est liée à une cible' });
        if (here !== null && here.type === 'gate') { const res = model.erase(c, r); return res.ok ? changed(`Porte retirée, ${at}`) : refuse(res); }
        if (here !== null) return refuse({ message: 'cette case est occupée' });
        pendingGate = { c, r };
        note(`Porte en ${at} : clique maintenant sur la cible qu'elle doit libérer`);
        return requestDraw();
      }
      default: break;
    }
    // outils de pièce
    const spec = { type: tool.id };
    if (tool.id === 'emitter') { spec.dir = 'E'; spec.mask = tool.color; }
    if (tool.id === 'target') spec.need = tool.color;
    if (tool.id === 'mirror' || tool.id === 'splitter') spec.o = '/';
    if (tool.id === 'filter') spec.mask = tool.color;
    if (tool.id === 'portal') spec.pair = tool.pair;
    if (here !== null && here.type === tool.id) {
      const sameColor = (tool.id !== 'emitter' && tool.id !== 'target' && tool.id !== 'filter') || (here.mask ?? here.need) === tool.color;
      if (sameColor && tool.id === 'portal' && here.pair !== tool.pair) { /* autre paire : remplace */ } else if (sameColor) {
        if (tool.id === 'mirror' || tool.id === 'splitter' || tool.id === 'emitter') {
          const res = model.rotate(c, r, 1);
          return res.ok ? changed(`Tourné : ${describe(c, r)}, ${at}`) : refuse(res);
        }
        const res = model.erase(c, r); // mur, prisme, portail, cible, filtre de même réglage : toucher encore le retire
        return res.ok ? changed(`Retiré, ${at}`) : refuse(res);
      }
    }
    if (here !== null && (here.fixed === true) && (tool.id === 'mirror' || tool.id === 'splitter' || tool.id === 'prism' || tool.id === 'filter') && here.type === tool.id) spec.fixed = true;
    const res = model.place(c, r, spec);
    if (!res.ok) return refuse(res);
    if (pendingGate !== null) pendingGate = null;
    return changed(`Posé : ${describe(c, r)}, ${at}`);
  }
  function describe(c, r) {
    const p = model.pieceAt(c, r);
    if (p === null) return 'case vide';
    try {
      const st = createState({ size: [model.cols, model.rows], pieces: [p] });
      return pieceDescription(st.pieces[0]);
    } catch { return typeLabel(p.type); }
  }

  // ---- entrées ----
  function cellFromEvent(e) { return renderer && state ? renderer.cellAt(e.clientX, e.clientY, state) : null; }
  el.canvas.addEventListener('pointerdown', (e) => { showCursor = false; if (e.button === 0) el.canvas.focus({ preventScroll: true }); });
  el.canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    const cell = cellFromEvent(e);
    if (cell !== null) applyTool(cell.c, cell.r);
  });
  el.canvas.addEventListener('contextmenu', (e) => { // clic droit : gomme sur la case visée
    e.preventDefault();
    const cell = cellFromEvent(e);
    if (cell === null) return;
    const res = model.erase(cell.c, cell.r);
    if (res.ok) changed(`Effacé, ${cellName(cell.c, cell.r)}`); else refuse(res);
  });
  el.canvas.addEventListener('focus', requestDraw);
  el.canvas.addEventListener('blur', requestDraw);

  /** V13 : champ du nom étroit (paysage bas) : l'indication courte « nom » plutôt que « nom (facultatif) » coupé. */
  function fitNamePlaceholder() {
    const w = el.name.clientWidth;
    if (w > 0) el.name.placeholder = w < 130 ? 'nom' : 'nom (facultatif)';
  }

  function onKey(e) {
    if (!visible || e.isComposing) return;
    const t = e.target;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    // V13 : Échap = le bouton retour, APRÈS ses usages existants (fenêtre ouverte, porte en attente, preuve en cours, champ de saisie) : un appui, une action
    if ((e.key === 'Escape' || e.key === 'Esc') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.defaultPrevented || shareModal.isOpen || draftsModal.isOpen || (t && typeof t.closest === 'function' && t.closest('dialog')) || doc.querySelector('dialog[open]')) return;
      e.preventDefault();
      if (e.repeat) return;
      if (pendingGate !== null) { pendingGate = null; changed('Porte annulée'); return; }
      if (proving !== null) { proving.cancel(); return; }
      if (inField) { el.canvas.focus({ preventScroll: true }); return; } // quitte le champ (le nom est gardé)
      onBack();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) {
      if (inField || shareModal.isOpen || draftsModal.isOpen) return;
      e.preventDefault();
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) doUndo(); else doRedo();
      return;
    }
    if (inField || e.ctrlKey || e.metaKey || e.altKey || shareModal.isOpen || draftsModal.isOpen) return;
    if (doc.activeElement !== el.canvas) {
      if (/^[0-9]$/.test(e.key) && doc.activeElement && doc.activeElement.closest && doc.activeElement.closest('#edit-panel, #edit-side')) { /* chiffres : outils, même depuis la palette */ } else return;
    }
    const key = e.key;
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
    if (move) {
      showCursor = true;
      cursor = { c: Math.max(0, Math.min(model.cols - 1, cursor.c + move[0])), r: Math.max(0, Math.min(model.rows - 1, cursor.r + move[1])) };
      const p = model.pieceAt(cursor.c, cursor.r);
      say(`${cellName(cursor.c, cursor.r)}${p ? `, ${describe(cursor.c, cursor.r)}` : ', vide'}`);
      e.preventDefault(); requestDraw(); return;
    }
    if (key === 'Enter' || key === ' ') { showCursor = true; applyTool(cursor.c, cursor.r); e.preventDefault(); return; }
    if (key === 'r' || key === 'R') { const res = model.rotate(cursor.c, cursor.r, e.shiftKey ? -1 : 1); if (res.ok) changed(`Tourné : ${describe(cursor.c, cursor.r)}`); else refuse(res); e.preventDefault(); return; }
    if (key === 'Delete' || key === 'Backspace') { const res = model.erase(cursor.c, cursor.r); if (res.ok) changed(`Effacé, ${cellName(cursor.c, cursor.r)}`); else refuse(res); e.preventDefault(); return; }
    if (/^[1-9]$/.test(key)) { selectTool(TOOLS[Number(key) - 1].id); e.preventDefault(); return; }
    if (key === '0') { selectTool('erase'); e.preventDefault(); return; }
    if (key === 'l' || key === 'L') { selectTool('lock'); e.preventDefault(); return; }
    if (key === 't' || key === 'T') { doTest(); e.preventDefault(); }
  }
  doc.addEventListener('keydown', onKey);

  function doUndo() { const r = model.undo(); if (r.ok) changed('Annulé'); else note(r.message); }
  function doRedo() { const r = model.redo(); if (r.ok) changed('Refait'); else note(r.message); }
  el.undo.addEventListener('click', doUndo);
  el.redo.addEventListener('click', doRedo);
  el.back.addEventListener('click', () => onBack());
  const resizeBy = (dc, dr) => { const r = model.resize(model.cols + dc, model.rows + dr); if (r.ok) changed(`Plateau ${model.cols} sur ${model.rows}`); else refuse(r); };
  el.colsMinus.addEventListener('click', () => resizeBy(-1, 0)); el.colsPlus.addEventListener('click', () => resizeBy(1, 0));
  el.rowsMinus.addEventListener('click', () => resizeBy(0, -1)); el.rowsPlus.addEventListener('click', () => resizeBy(0, 1));

  // nom : NFC puis minuscules, signes hors de T refusés avec un message (P13)
  el.name.addEventListener('input', () => {
    const s = model.setName(el.name.value);
    if (el.name.value !== s.value) {
      el.name.value = s.value;
      if (s.rejected.length > 0) note(`Signes refusés dans le nom : ${s.rejected.join(' ')} (minuscules, lettres, chiffres et ponctuation simple seulement)`);
      else if (s.truncated) note(`Nom limité à ${EDITOR_LIMITS.name} signes`);
    }
    refresh();
  });

  // ---- tester, prouver, partager ----
  function currentLevelChecked() {
    if (!model.valid) { note(`Impossible : ${model.problems()[0].message}`); return null; }
    return model.level();
  }
  function doTest() {
    const level = currentLevelChecked();
    if (level === null) return;
    onTest({ level, key: levelKey() });
  }
  el.test.addEventListener('click', doTest);

  function showProve(text) { proveText = text; el.proveOut.textContent = text; }
  function doProve() {
    const level = currentLevelChecked();
    if (level === null || proving !== null) return;
    showProve('Preuve en cours… (jusqu\'à 1 million de nœuds)');
    el.cancel.hidden = false; el.prove.hidden = true;
    const task = client.solve(level);
    proving = task;
    refresh();
    task.promise.then((r) => {
      if (proving !== task) return;
      proving = null; el.cancel.hidden = true; el.prove.hidden = false;
      if (r.cancelled) { showProve('Preuve annulée.'); refresh(); return; }
      const cap = `${r.maxNodes.toLocaleString('fr-FR')} nœuds${r.sync ? ' (Worker indisponible : calcul limité sur la page)' : ''}`;
      if (r.status === 'proved-optimal') {
        // le témoin du solveur est rejoué par le moteur seul : il débloque « Partager » au même titre que la victoire de l'auteur
        const rp = replayPlacements(level, r.witness.concat(r.parking));
        if (rp.ok) witness = { key: levelKey(), used: rp.usedMovable };
        showProve(`Minimum prouvé : ${r.minimum} pièce${r.minimum > 1 ? 's' : ''} (${r.nodes.toLocaleString('fr-FR')} nœuds).`);
      } else if (r.status === 'unsolvable-proved') showProve('Insoluble prouvé : aucune disposition des pièces mobiles ne gagne.');
      else if (witnessOk()) showProve(`Minimum non prouvé (plafond de ${cap}). Ton témoin : ${witness.used} pièce${witness.used > 1 ? 's' : ''}, ce n'est pas forcément le minimum.`);
      else showProve(`Inconnu : plafond de ${cap} atteint sans trouver de solution. Gagne ton niveau avec « Tester » pour pouvoir le partager.`);
      say(proveText); refresh();
    }).catch((e) => { if (proving !== task) return; proving = null; el.cancel.hidden = true; el.prove.hidden = false; showProve(`Preuve impossible : ${e && e.message ? e.message : 'erreur'}`); say(proveText); refresh(); });
  }
  el.prove.addEventListener('click', doProve);
  el.cancel.addEventListener('click', () => { if (proving) { const t = proving; t.cancel(); } });

  async function doShare() {
    if (!witnessOk()) { note('Gagne ton niveau avec « Tester » pour pouvoir le partager'); return; }
    const url = shareUrl(win.location, model.level());
    const input = $('share-url');
    input.value = url;
    const state2 = $('share-note');
    state2.textContent = `Lien de ${url.length} caractères. Le niveau voyage dans le lien : rien n'est envoyé à un serveur.`;
    shareModal.open(el.share, input);
    input.select();
    const achLine = $('share-ach');
    if (achLine) achLine.textContent = '';
    const earned = typeof deps.onShared === 'function' ? deps.onShared() : null; // V11 : succès « Architecte » (le lien est donné au joueur, copié ou sélectionné)
    if (achLine && Array.isArray(earned) && earned.length > 0) achLine.textContent = `Succès obtenu : ${earned.join(' · ')}`; // V13
    const copied = await copyText(url, win.navigator);
    state2.textContent = copied ? `Lien copié. (${url.length} caractères ; rien n'est envoyé à un serveur.)` : 'Copie automatique impossible ici : le lien est sélectionné, copie-le avec Ctrl+C (ou appui long sur mobile).';
    say(copied ? 'Lien copié' : 'Lien sélectionné, à copier à la main');
    if (!copied) input.select();
  }
  el.share.addEventListener('click', doShare);
  $('share-copy').addEventListener('click', async () => {
    const input = $('share-url');
    const copied = await copyText(input.value, win.navigator);
    $('share-note').textContent = copied ? 'Lien copié.' : 'Copie automatique impossible : le lien est sélectionné, copie-le avec Ctrl+C.';
    if (!copied) { input.focus(); input.select(); }
    say(copied ? 'Lien copié' : 'Copie impossible : sélectionné');
  });
  $('share-close').addEventListener('click', () => shareModal.close());

  // ---- brouillons et import ----
  function renderDrafts() {
    const list = $('drafts-list');
    list.replaceChildren();
    const drafts = store.drafts;
    $('drafts-count').textContent = `${drafts.length} / 20`;
    if (drafts.length === 0) { const li = doc.createElement('li'); li.className = 'empty'; li.textContent = 'Aucun brouillon.'; list.append(li); }
    for (const d of drafts) {
      const li = doc.createElement('li');
      const label = doc.createElement('span'); label.textContent = d.name === '' ? '(sans nom)' : d.name; // textContent : jamais de HTML
      const open = doc.createElement('button'); open.type = 'button'; open.className = 'btn'; open.textContent = 'OUVRIR'; open.setAttribute('aria-label', `Ouvrir le brouillon ${d.name || 'sans nom'}`);
      const del = doc.createElement('button'); del.type = 'button'; del.className = 'btn quiet'; del.textContent = 'SUPPRIMER'; del.setAttribute('aria-label', `Supprimer le brouillon ${d.name || 'sans nom'}`);
      open.addEventListener('click', () => openDraft(d));
      del.addEventListener('click', () => { store.deleteDraft(d.id); if (draftId === d.id) draftId = null; draftsMsg('Brouillon supprimé.'); renderDrafts(); });
      li.append(label, open, del);
      list.append(li);
    }
    $('drafts-save').textContent = draftId !== null ? 'METTRE À JOUR LE BROUILLON' : 'ENREGISTRER COMME BROUILLON';
  }
  const draftsMsg = (t) => { $('drafts-msg').textContent = t; say(t); };
  // niveau en cours non enregistré (au moins une pièce, différent du dernier brouillon ouvert / enregistré) : l'ouvrir ailleurs demande confirmation
  const fullKey = () => { try { return encodeLevel(model.level()); } catch { return ''; } };
  let savedKey = fullKey();
  const isDirty = () => { if (model.pieces.length === 0) return false; const k = fullKey(); return k === '' || k !== savedKey; };
  let pendingReplace = null;
  const confirmBox = $('drafts-confirm');
  function hideConfirm() { pendingReplace = null; confirmBox.hidden = true; }
  /** Exécute `fn` (qui remplace le niveau en cours) tout de suite, ou après accord si le niveau en cours n'est pas enregistré. */
  function guardReplace(fn) {
    if (!isDirty()) { fn(); return; }
    pendingReplace = fn;
    confirmBox.hidden = false;
    $('drafts-confirm-no').focus();
    say($('drafts-confirm-text').textContent);
  }
  $('drafts-confirm-yes').addEventListener('click', () => { const fn = pendingReplace; hideConfirm(); if (fn) fn(); });
  $('drafts-confirm-no').addEventListener('click', () => { hideConfirm(); draftsMsg('Ton niveau est gardé.'); });
  function openDraft(d) { guardReplace(() => doOpenDraft(d)); }
  function doOpenDraft(d) {
    try {
      const lv = decodeShare(d.code); // brouillon : peut être incomplet, on ne valide pas les règles ici (l'éditeur les montre)
      model.load(lv);
      savedKey = fullKey();
      draftId = d.id; pendingGate = null; witness = null; proveText = ''; el.proveOut.textContent = '';
      draftsModal.close();
      changed(`Brouillon ouvert : ${d.name || 'sans nom'}`);
    } catch (e) {
      draftsMsg(e instanceof ShareError ? 'Brouillon illisible.' : 'Brouillon impossible à ouvrir.');
    }
  }
  $('drafts-save').addEventListener('click', () => {
    let code;
    try { code = encodeLevel(model.level()); } catch { draftsMsg('Ce niveau ne peut pas être enregistré.'); return; }
    const r = draftId !== null ? store.updateDraft(draftId, model.name, code, 0) : store.addDraft(model.name, code, 0);
    if (!r.ok) { draftsMsg(r.reason === 'full' ? '20 brouillons au maximum : supprime-en un.' : r.reason === 'missing' ? 'Ce brouillon n\'existe plus.' : 'Brouillon refusé.'); if (r.reason === 'missing') draftId = null; return; }
    draftId = r.id;
    savedKey = fullKey();
    draftsMsg(store.persistent ? 'Brouillon enregistré sur cet appareil.' : 'Brouillon gardé le temps de cette visite (stockage indisponible).');
    renderDrafts();
  });
  $('drafts-import').addEventListener('click', () => {
    const r = parseImportText($('drafts-import-text').value);
    if (!r.ok) { draftsMsg(r.message); return; }
    if (r.via === 'code') { // un lien s'ouvre comme un niveau partagé (validation F4 / F5 déjà faite)
      draftsModal.close();
      onOpenShared(encodeLevel(r.level));
      return;
    }
    guardReplace(() => {
      model.load(r.level); savedKey = fullKey(); draftId = null; witness = null; pendingGate = null;
      $('drafts-import-text').value = '';
      draftsModal.close();
      changed('Brouillon JSON ouvert dans l\'éditeur');
    });
  });
  $('drafts-close').addEventListener('click', () => draftsModal.close());
  el.drafts.addEventListener('click', () => { hideConfirm(); renderDrafts(); $('drafts-msg').textContent = ''; draftsModal.open(el.drafts); });

  // ---- cycle de vie ----
  buildTools();
  buildOptions();
  selectTool('mirror');

  /** Plan du plateau en coordonnées de la FENÊTRE (le canvas de l'éditeur n'est plus au coin de l'écran) : les essais cliquent à ces points. */
  function viewInWindow(L) {
    const rc = el.canvas.getBoundingClientRect();
    return { x0: rc.left + L.x0, y0: rc.top + L.y0, cell: L.cell, w: L.w, h: L.h };
  }

  return {
    get model() { return model; },
    get isModalOpen() { return shareModal.isOpen || draftsModal.isOpen; },
    show() {
      el.screen.hidden = false;
      visible = true;
      if (renderer === null) renderer = createRenderer(el.canvas, { fit: 'tight', boardFill: THEME.editorBoardFill });
      renderer.resize();
      if (typeof ResizeObserver === 'function' && ro === null) { ro = new ResizeObserver(() => { fitNamePlaceholder(); if (renderer) { renderer.resize(); requestDraw(); } }); ro.observe(el.canvas); }
      refresh();
      requestDraw();
      for (const c of cues) c.update();
      el.canvas.focus({ preventScroll: true });
    },
    hide() { visible = false; el.screen.hidden = true; if (shareModal.isOpen) shareModal.close(); if (draftsModal.isOpen) draftsModal.close(); },
    /** Reprend un niveau (copie d'un niveau partagé, import) : l'éditeur repart de lui ; le témoin est à refaire. */
    loadLevel(level) { model.load(level); savedKey = fullKey(); draftId = null; witness = null; pendingGate = null; proveText = ''; el.proveOut.textContent = ''; if (visible) { refresh(); requestDraw(); } },
    /** La victoire de l'auteur en « Tester » (rejouée par le moteur par l'appelant) : témoin pour ce niveau précis. */
    setWitness(key, used) { witness = { key, used }; refresh(); },
    setReducedMotion(on) { if (renderer) renderer.setReducedMotion(on); },
    snapshot() {
      return { screen: 'edit', cols: model.cols, rows: model.rows, name: model.name, pieces: model.pieces, tool: { ...tool }, cursor: { ...cursor }, valid: model.valid, problems: model.problems().map((p) => p.code),
        counts: (({ emitters, targets, gates, portals, pairs, mobiles, pieces: n }) => ({ emitters, targets, gates, portals, pairs, mobiles, pieces: n }))(model.counts()),
        canUndo: model.canUndo, canRedo: model.canRedo, witness: witness === null ? null : { used: witness.used, current: witnessOk() }, proving: proving !== null, proveText, pendingGate, draftId,
        view: renderer && renderer.layout ? viewInWindow(renderer.layout) : null, shareDisabled: el.share.disabled };
    },
  };
}
