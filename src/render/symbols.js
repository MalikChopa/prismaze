// Symboles des sept couleurs (D6) en chemins vectoriels : pas de texte, donc aucune dépendance aux polices.
// ▲ rouge (1), ● vert (2), ✚ jaune (3), ■ bleu (4), ◆ violet (5), ✦ cyan (6), ○ blanc (7).

/** Ajoute au chemin courant le symbole du masque `mask` centré en (cx, cy), de rayon r. L'appelant fait fill(). */
export function symbolPath(ctx, mask, cx, cy, r) {
  switch (mask) {
    case 1: // ▲
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.95, cy + r * 0.75); ctx.lineTo(cx - r * 0.95, cy + r * 0.75); ctx.closePath();
      break;
    case 2: // ●
      ctx.moveTo(cx + r * 0.85, cy); ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
      break;
    case 3: { // ✚
      const a = r, t = r * 0.3;
      ctx.moveTo(cx - t, cy - a); ctx.lineTo(cx + t, cy - a); ctx.lineTo(cx + t, cy - t); ctx.lineTo(cx + a, cy - t); ctx.lineTo(cx + a, cy + t);
      ctx.lineTo(cx + t, cy + t); ctx.lineTo(cx + t, cy + a); ctx.lineTo(cx - t, cy + a); ctx.lineTo(cx - t, cy + t); ctx.lineTo(cx - a, cy + t);
      ctx.lineTo(cx - a, cy - t); ctx.lineTo(cx - t, cy - t); ctx.closePath();
      break;
    }
    case 4: // ■
      ctx.rect(cx - r * 0.75, cy - r * 0.75, r * 1.5, r * 1.5);
      break;
    case 5: // ◆
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.85, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.85, cy); ctx.closePath();
      break;
    case 6: // ✦
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 4, k = i % 2 === 0 ? r * 1.05 : r * 0.34;
        if (i === 0) ctx.moveTo(cx + Math.cos(a) * k, cy + Math.sin(a) * k); else ctx.lineTo(cx + Math.cos(a) * k, cy + Math.sin(a) * k);
      }
      ctx.closePath();
      break;
    default: // ○ (anneau : remplir avec la règle evenodd)
      ctx.moveTo(cx + r * 0.9, cy); ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
      ctx.moveTo(cx + r * 0.52, cy); ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2, true);
  }
}

/** Remplit le symbole du masque (couleur déjà réglée par l'appelant). */
export function fillSymbol(ctx, mask, cx, cy, r) {
  ctx.beginPath();
  symbolPath(ctx, mask, cx, cy, r);
  ctx.fill('evenodd');
}
