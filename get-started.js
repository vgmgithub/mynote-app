// Pure logic for the Home "Get started" card: which steps exist, in what order, and which are still to do.
// No DOM, no storage, so it can be unit tested. The screen adds what each step does when tapped.
//
// The order is the money order: an emergency fund first, then clear existing loans, then the fixed monthly
// bills of the house, then invest, then family health, then the cards (before any daily spend, so a spend can
// be put on a card), then the daily house spends, then personal spends, then a monthly look at the bank balances,
// then the optional password vault, and a backup last.
//
//   need      any ONE of these features must be switched on for the step to appear
//   freeOnly  the Free Plan only (the Pro Plan has the guided yearly plan setup instead)
//   skippable an optional step the person may skip

export const STEPS = [
  { id: 'plan', icon: '\u{1F5D3}️', title: 'Yearly plan', hint: 'Set your monthly salary and budget for the year.', need: ['expense'], freeOnly: true },
  { id: 'ef', mod: 'ef', title: 'Emergency fund', hint: 'Log your contribution and set the target.', need: ['ef'] },
  { id: 'loans', icon: '\u{1F3DB}️', title: 'Existing loans', hint: 'Log this month’s repayment with last month’s savings.', need: ['expense'], skippable: true },
  { id: 'fixed', icon: '\u{1F3E0}', title: 'Fixed house bills', hint: 'Note your fixed monthly bills, like rent and electricity.', need: ['expense'] },
  { id: 'invest', icon: '\u{1F4BC}', title: 'Investments', hint: 'Log what you invested this month, in stocks, funds, FDs, gold or bonds.', need: ['stocks', 'mf', 'fd', 'metal', 'bond'], skippable: true },
  { id: 'health', mod: 'health', title: 'Health Check', hint: 'Add your family and their medical records, and track their health.', need: ['health'], skippable: true },
  { id: 'cc', mod: 'cc', title: 'Credit cards', hint: 'Add your cards, so a spend can be put on the right one.', need: ['cc'] },
  { id: 'daily', icon: '\u{1F6D2}', title: 'Daily house spends', hint: 'Track every day’s house spend and stay within your budget.', need: ['expense'] },
  { id: 'personal', mod: 'personal', title: 'Personal spending', hint: 'Set your monthly limits and log every personal spend. From month 3 you’ll see where your money goes.', need: ['personal'] },
  { id: 'banksav', mod: 'banksav', title: 'Savings', hint: 'Update each bank balance once a month to keep track.', need: ['banksav'] },
  { id: 'vault', mod: 'vault', title: 'My Passwords (optional)', hint: 'Set a master password to keep your logins safe. It cannot be recovered if forgotten.', need: ['vault'], skippable: true },
];

export const BACKUP_STEP = { id: 'backup', icon: '\u{1F4BE}', title: 'Back up your data', hint: 'Your data lives only on this phone. Keep a copy so nothing is ever lost.', need: [] };

// Steps still to do, in order.
//   on(id)    is this feature switched on?
//   paid      Pro Plan?
//   done      Set of step ids already completed
//   skipped   Set of step ids the person chose to skip
//   backedUp  a backup has been taken (the last step stays until then, and can never be skipped)
export function pickSteps({ on, paid, done, skipped, backedUp }) {
  const todo = applicableSteps({ on, paid }).filter((s) => {
    if (done.has(s.id)) return false;
    if (s.skippable && skipped.has(s.id)) return false;
    return true;
  });
  if (!backedUp) todo.push(BACKUP_STEP);
  return todo;
}

// Every step this person's setup has, done or not: the plan and the features they have switched on decide it.
function applicableSteps({ on, paid }) {
  return STEPS.filter((s) => !(s.freeOnly && paid) && !(s.need.length && !s.need.some((m) => on(m))));
}

// How far along they are, for the "3 of 5 completed" line. The backup is always one of the steps. A skipped
// optional step counts as completed: it has been dealt with, and it is gone from the cards.
//   ids        every step that applies, in order (what the celebration remembers once it is closed)
//   todo       exactly pickSteps
//   place(id)  a step's number in the full list, so "Step 4 of 5" on a card agrees with the line above
export function stepProgress(opts) {
  const ids = applicableSteps(opts).map((s) => s.id).concat(BACKUP_STEP.id);
  const todo = pickSteps(opts);
  return { ids, todo, total: ids.length, completed: ids.length - todo.length, place: (id) => ids.indexOf(id) + 1 };
}

// The fixed monthly bills are the Fixed group of the household categories.
export const isFixedCategory = (fixedItems, category) => (fixedItems || []).includes(category);
