// What MyNotes Pro is PLANNED to add, per feature. Shown by the 🏷️ button on each feature screen.
// Plain data so it can be edited without touching code. Nothing under `items` is built yet: the popup
// says so, and the wording must stay "planned" until an item ships (then move it to `now`, or drop it
// entirely if it turns out to be free for everyone rather than a Pro perk).
// An item ending in "(online)" needs a connection; everything else works offline.
//
// `purpose` is what the screen is FOR, and it is the only field written for somebody who has already
// paid. A member opening this popup is not deciding anything - they are looking at a screen and asking
// what it is meant to do - so their view leads on this and drops the comparison with Free entirely.
// It describes the feature, never the plan: no "Pro", no price, nothing that reads as a pitch.
export const PRO_INFO = {
  stocks: {
    name: 'Stocks',
    purpose: 'Every share you own, in one place — what you paid vs. what it is worth now.',
    now: [
      { icon: '\u{1F4F8}', title: 'Screenshot fills it in', text: 'Units, average and current price, read straight off your broker app.' },
      { icon: '\u{1F4B1}', title: 'US holdings in rupees too', text: 'Your US stock values shown in rupees, using a fetched USD rate.', tag: 'Needs internet' },
      { icon: '\u{1F4F0}', title: 'News on what you hold', text: 'The last 24 hours per stock, with a plain read on how it is doing.', tag: 'Online · opt-in' },
    ],
    // The broker list belongs here rather than inside a card: it is the small print of the first one,
    // and it was what made that card three lines of prose on a phone.
    worksWith: 'Paytm Money and Groww for Indian stocks (Groww fills price only), INDmoney for US. More apps coming.',
    free: ['You type units, average price and current price yourself'],
    // Sector/allocation analysis and the Overall portfolio-comparison view are already free for everyone
    // (renderPortfolioAnalyzer / renderTrends in app.js carry no plan check) - not a Pro perk, so dropped.
    items: [
    'Export holdings to PDF or Excel',
    'Automatic price refresh (online)',
  ] },
  mf: { name: 'Mutual Funds',
    purpose: 'Every fund you hold, valued at its latest NAV — one holding, not a drawer of folios.', now: [
      { icon: '\u{1F4CA}', title: 'Every NAV in one tap', text: 'All your funds revalued at once, instead of one at a time.', tag: 'Needs internet' },
      { icon: '\u{1F514}', title: 'SIP reminder on Home', text: 'Your SIP date shows in Home’s Coming Up strip, two days ahead.' },
    ],
    worksWith: 'Official AMFI NAVs, so every fund you hold is covered.',
    // Allocation by type is already free for everyone (no plan check in mf-ui.js) - only fund overlap
    // (shared underlying stocks across funds) is still unbuilt.
    free: ['You type each fund’s NAV yourself'], items: [
    'Automatic background NAV refresh (online)',
    'Fund overlap analysis',
    'Export to PDF or Excel',
  ] },
  fd: { name: 'Fixed Deposits',
    purpose: 'Every FD and RD you hold — what it matures to, and when.',
    // The Ladder planner is already free for everyone (no plan check in personal-ui.js) - not listed here.
    now: [
      { icon: '\u{1F514}', title: 'Maturity reminder on Home', text: 'Each FD’s maturity date shows in Home’s Coming Up strip.' },
    ], items: [
    'Interest and TDS estimate for the year',
    'Export to PDF or Excel',
  ] },
  metal: { name: 'Gold & Silver',
    purpose: 'Your gold and silver, valued at today’s rates — not what you paid for it.', now: [
      { icon: '\u{1FA99}', title: 'Rates fetched daily', text: 'Gold and silver, updated for you every day.', tag: 'Needs internet' },
      { icon: '\u{1F3AF}', title: 'Tune the India price', text: 'Nudge the estimate until it matches the app you compare against.' },
    ],
    free: ['You type the rates yourself'], items: [
    'Value that accounts for making charges and GST',
    'Price alerts (online)',
  ] },
  bond: { name: 'Bonds',
    purpose: 'Your bonds in one list, with coupons and maturity dates included.', now: [
      { icon: '\u{1F514}', title: 'Payout reminder on Home', text: 'The next coupon or redemption shows in Home’s Coming Up strip.' },
    ], items: [
    'Coupon and redemption calendar',
    'Yield comparison across your bonds',
    'Export to PDF or Excel',
  ] },
  div: { name: 'Dividends',
    purpose: 'What your holdings have actually paid you, kept as a running record.', now: [
      { icon: '\u{1F514}', title: 'Payout reminder on Home', text: 'Your next dividend shows in Home’s Coming Up strip.' },
    ],
    // The Calendar and yearly-total tabs are already free for everyone (no plan check in divs-ui.js).
    items: [
    'Dividend income report for tax time',
    'Export to PDF or Excel',
  ] },
  ef: { name: 'Emergency Fund',
    purpose: 'Money set aside for a bad month — and whether it is still enough.',
    // Ladder rules and targets are already free for everyone (no plan check in ef.js) - not listed here.
    items: [
    'Reminders for target progress',
    'Statement export',
  ] },
  banksav: { name: 'Bank Savings',
    purpose: 'What is really sitting in each account, kept accurate and current.', items: [
    'Balance trend charts',
    'Interest earned tracking per account',
    'Statement export',
  ] },
  inflation: { name: 'Inflation',
    purpose: 'What your own costs are doing over time — not the headline rate.', items: [
    'Your own basket of costs to track',
    'Purchasing-power projections over time',
  ] },
  cc: { name: 'Credit Cards',
    purpose: 'What each card owes, when it is due, and what it was spent on.',
    // Category Spend and Card Check are already free for everyone (no plan check in cc-ui.js) - not listed here.
    items: [
    'Statement reminders before the due date',
    'Export to PDF or Excel',
  ] },
  expense: { name: 'Household Expenses',
    purpose: 'Where the household money goes, logged as it is spent.', now: [
      { icon: '\u{1F5D3}️', title: 'Guided yearly setup', text: 'Salary, loans, emergency fund and the rest, in a sensible order.' },
    ],
    // Review (forecast, grade, unusual-spend detection) is already free for everyone (no plan check in
    // expense-ui.js) - not listed here. The single household budget already exists too; only per-category
    // budgets are still unbuilt.
    items: [
    'Category-level budgets with alerts',
    'Receipt scan to fill in expenses (online on first use)',
    'Export to PDF or Excel',
  ] },
  personal: { name: 'Personal Finance',
    purpose: 'Your own spending, kept apart from the household’s.',
    // UPI/card limit warnings and Review are already free for everyone (no plan check in personal-ui.js).
    items: [
    'Category budgets with alerts',
    'Export to PDF or Excel',
  ] },
  health: { name: 'Health Check',
    purpose: 'Each person’s readings kept over time, so you can compare against the last one.', free: ['Up to 2 family members'],
    now: [
      { icon: '\u{1F46A}', title: 'Everyone you look after', text: 'Add the whole family, with no limit on how many.' },
    ],
    // Trend charts and the doctor's-report share are already free for everyone (no plan check beyond the
    // family-member count in health.js) - not listed here.
    items: [
    'Reminders for checkups and refills',
    'Export full history to PDF or Excel',
  ] },
  // vault: no Pro tier - everything in My Passwords is free, so it has no popup and no button.
};

// Per screen: `now` = what Pro gives on this screen, `free` = the free-plan limit, `items` = upcoming ideas.
// Offered on every feature (kept for reference; the popup itself now shows only what is specific to the screen).
export const PRO_COMMON = [
  'Restore your backup on a different device',
  'Priority for new features and fixes',
];

// Screen modes that have their own feature. Hub screens (Home, Investment, Savings) show no button.
export const MODE_FEATURE = {
  stocks: 'stocks', mf: 'mf', fd: 'fd', metal: 'metal', bond: 'bond', div: 'div',
  ef: 'ef', banksav: 'banksav', expense: 'expense', cc: 'cc', personal: 'personal', health: 'health'
};
