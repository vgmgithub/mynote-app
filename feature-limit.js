// Keeps the Free Plan at its feature limit. Pure logic, no browser, so the rules are tested on their own.

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
