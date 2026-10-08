// Split bills: one shop bill (Online Grocery 324) saved as a parent entry (300) plus parts carved off it
// (Milk 24, Eggs ...). A part made since v892 carries `splitOf` = the parent's id; an older part is recognised
// by being saved in the same moment (same createdAt and date) with the parent's category as its first tag.
// Pure - rows in, links out; nothing is stored.
const norm = (s) => String(s || '').trim().toLowerCase();

// Map of child id -> parent row, for the rows given.
export function splitParents(rows) {
  const byId = new Map();
  const byStamp = new Map();
  (rows || []).forEach((r) => {
    if (!r || r.id == null) return;
    byId.set(r.id, r);
    if (r.createdAt && r.splitOf == null) {
      const k = r.createdAt + '|' + r.date;
      if (!byStamp.has(k)) byStamp.set(k, []);
      byStamp.get(k).push(r);
    }
  });
  const out = new Map();
  (rows || []).forEach((r) => {
    if (!r || r.id == null) return;
    if (r.splitOf != null) { const p = byId.get(r.splitOf); if (p && p !== r) out.set(r.id, p); return; }
    const first = norm((r.tags || [])[0]);
    if (!first || !r.createdAt) return;
    const sib = byStamp.get(r.createdAt + '|' + r.date) || [];
    const p = sib.find((x) => x !== r && norm(x.category) === first && x.method === r.method && x.cardId == r.cardId);
    if (p) out.set(r.id, p);
  });
  return out;
}

// The rows reordered so each parent's parts follow it straight after; a part whose parent is not in the list
// stays where it was.
export function orderWithParts(rows, parents) {
  const kids = new Map();
  const ids = new Set(rows.map((r) => r.id));
  rows.forEach((r) => {
    const p = parents.get(r.id);
    if (p && ids.has(p.id)) { if (!kids.has(p.id)) kids.set(p.id, []); kids.get(p.id).push(r); }
  });
  const out = [];
  rows.forEach((r) => {
    const p = parents.get(r.id);
    if (p && ids.has(p.id)) return;
    out.push(r);
    (kids.get(r.id) || []).forEach((k) => out.push(k));
  });
  return out;
}

// A steady hue per parent, so a bill and its parts share one colour.
export const splitHue = (id) => (Math.abs(Number(id) || 0) * 137) % 360;

// A small picture for the everyday parts: milk, fruits, and eggs (by category, or an "eggs" tag).
export function spendIcon(r) {
  const c = String((r && r.category) || '').toLowerCase();
  if ((r && r.tags || []).some((t) => /^eggs?$/i.test(String(t)))) return '🥚 ';
  if (c === 'milk') return '🥛 ';
  if (c === 'fruits') return '🍎 ';
  return '';
}
