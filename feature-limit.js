// Keeps the Free Plan at its feature limit. Pure logic, no browser, so the rules are tested on their own.

// Feature ids that no longer exist, and what they became. A saved choice (meta enabledModules) travels in every
// backup, so an id retired years ago can still come back on a restore; it is read as its successor, never dropped
// silently and never counted as a slot of its own. Only add to this map - removing an entry would strand old backups.
export const LEGACY_MODULE_IDS = { inflation: 'calc' };

// A saved list of feature ids, cleaned the one way everything reads it: old ids mapped to their successors, ids that
// no longer exist dropped, duplicates removed, order kept. `modules` is APP_MODULES (or anything with `id`).
export function normaliseModuleIds(list, modules) {
  if (!Array.isArray(list)) return [];
  const known = Array.isArray(modules) ? new Set(modules.map((m) => m.id)) : null;
  const out = [];
  for (const raw of list) {
    const id = LEGACY_MODULE_IDS[raw] || raw;
    if (typeof id !== 'string' || (known && !known.has(id)) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

// What a feature needs before it can be switched on. `requires` is either one id (Dividends need Stocks) or a list,
// which means ANY ONE of them (Analysis works from Expenses, from Personal Spending, or from both).
export const reqsOf = (m) => (!m || !m.requires ? [] : Array.isArray(m.requires) ? m.requires : [m.requires]);
// Whether `chosen` (a Set or an array of ids) satisfies those needs.
export function reqsMet(chosen, reqs) {
  const list = Array.isArray(reqs) ? reqs : reqs ? [reqs] : [];
  if (!list.length) return true;
  const has = chosen instanceof Set ? (id) => chosen.has(id) : (id) => (chosen || []).includes(id);
  return list.some(has);
}

// Review moved out of Expenses and Personal Finance into the Analysis feature. So nobody who used Review loses it on
// update, a Free choice that has Expenses or Personal Spending gets Analysis added ONCE - but only into a free slot,
// never past the limit (the lesson of the old Credit Cards migration). Returns the list to keep, whether Analysis was
// added, and whether it could not be because the choice was already full (the app then says where Review went).
export function addAnalysisOnce(enabled, limit, paid) {
  const list = Array.isArray(enabled) ? [...enabled] : [];
  const none = { enabled: list, added: false, full: false };
  if (paid || list.includes('analysis') || !reqsMet(list, ['expense', 'personal'])) return none;
  if (list.length >= limit) return { ...none, full: true };
  return { enabled: [...list, 'analysis'], added: true, full: false };
}

// Credit Cards used to be part of Expenses. When it became its own feature, an old migration switched it on for anyone
// who had Expenses, so no card screen vanished. That migration ran for EVERY install, including brand-new ones, so
// somebody who picked five features (Expenses among them) quietly got Credit Cards as a sixth. It no longer adds
// anything: what a person picks is what they have. Installs that predate the split have long since been migrated.
//
// An install already pushed over the limit that way is put back: the one thing that can have put a Free install over
// five is that added Credit Cards, so it (and only it) is taken off again. Their data is untouched; a hidden feature
// keeps every record, and it can be switched back on in Settings in exchange for another.
//
// Returns the list to keep and whether it changed. Pro members are never trimmed: they have every feature.
export function trimAutoAddedCc(enabled, limit, paid) {
  const list = Array.isArray(enabled) ? [...enabled] : [];
  if (paid || list.length <= limit) return { enabled: list, changed: false };
  if (list.includes('cc') && list.includes('expense')) {
    return { enabled: list.filter((id) => id !== 'cc'), changed: true };
  }
  return { enabled: list, changed: false };   // over the limit for another reason: left to the picker
}

// The features picked on the website before installing (meta landingPicks), cleaned the way the picker itself would:
// only features that exist, in the app's own order, a dependent one (Dividends) only with what it needs (Stocks), and
// never more than the Free Plan allows. [] when nothing usable is there. The app applies it only when it is a full
// choice (exactly `limit`), so a half-finished pick on the website still opens the picker, already ticked.
export function websitePicks(raw, modules, limit = 5) {
  if (!Array.isArray(raw) || !Array.isArray(modules)) return [];
  const ids = new Set(normaliseModuleIds(raw, modules));
  return modules
    .filter((m) => ids.has(m.id) && reqsMet(ids, reqsOf(m)))
    .map((m) => m.id)
    .slice(0, limit);
}
