// Big screens were split into several files (the code did not change, only where it lives). Tests that check a
// screen's source read it through here: read('expense-ui.js') returns the screen and every piece split out of it.
import { readFileSync } from 'node:fs';
const PARTS = {
  'personal-ui.js': ['personal-ui.js', 'personal-tags.js', 'personal-review.js', 'fd-ui.js', 'home-ui.js'],
  'expense-ui.js': ['expense-ui.js', 'expense-sheet.js', 'expense-tags.js', 'expense-heatmap.js', 'expense-tracker.js', 'expense-review.js', 'expense-review-logic.js', 'expense-alloc.js', 'spend-form.js'],
};
const one = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
export const read = (f) => (PARTS[f] || [f]).map(one).join('\n');
