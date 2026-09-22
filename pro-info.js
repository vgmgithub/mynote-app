// What MyNotes Pro is PLANNED to add, per feature. Shown by the 🏷️ button on each feature screen.
// Plain data so it can be edited without touching code. Nothing here is built yet: the popup says so,
// and the wording must stay "planned" until an item ships (then move it out of this file).
// An item ending in "(online)" needs a connection; everything else works offline.
//
// `purpose` is what the screen is FOR, and it is the only field written for somebody who has already
// paid. A member opening this popup is not deciding anything - they are looking at a screen and asking
// what it is meant to do - so their view leads on this and drops the comparison with Free entirely.
// It describes the feature, never the plan: no "Pro", no price, nothing that reads as a pitch.
export const PRO_INFO = {
  stocks: {
    name: 'Stocks',
    purpose: 'Every share you own in one place: what you paid, what it is worth now, and how far apart those two have drifted.',
    now: [
      { icon: '\u{1F4F8}', title: 'One screenshot fills in everything', text: 'Units, average price and current price for every holding, read from your broker screenshot. Works with Paytm Money and Groww (current price only) for Indian stocks, and INDmoney for US stocks. More apps coming.' },
      { icon: '\u{1F4F0}', title: 'News on the stocks you hold', text: 'The last 24 hours of news for each stock, with a simple read on how it is doing.', tag: 'Needs internet \u00b7 off until you turn it on' },
    ],
    free: ['You type units, average price and current price yourself'],
    items: [
    'Sector and allocation analysis across your holdings',
    'Side-by-side comparison of your portfolios',
    'Export holdings to PDF or Excel',
    'Automatic price refresh (online)',
  ] },
  mf: { name: 'Mutual Funds',
    purpose: 'Every mutual fund you hold, valued at its latest NAV, so you see one holding rather than a drawer of folios.', now: ['Update every fund\u2019s NAV in one tap'],
    worksWith: 'Official AMFI NAVs, so every fund you hold is covered.',
    free: ['You type each fund\u2019s NAV yourself'], items: [
    'Automatic background NAV refresh (online)',
    'SIP tracker with reminders',
    'Fund overlap and asset-mix analysis',
    'Export to PDF or Excel',
  ] },
  fd: { name: 'Fixed Deposits',
    purpose: 'Every fixed and recurring deposit, what it matures to and when, so nothing rolls over while you are not looking.', items: [
    'Maturity reminders before each FD ends',
    'FD ladder planner',
    'Interest and TDS estimate for the year',
  ] },
  metal: { name: 'Gold & Silver',
    purpose: 'The gold and silver you actually own, valued at today’s rates rather than what you paid for it.', now: ['Daily gold, silver and dollar rates, fetched for you', 'An India price estimate you can tune to match the app you compare against'],
    free: ['You type the rates yourself'], items: [
    'Live gold and silver rates, refreshed for you (online)',
    'Value that accounts for making charges and GST',
    'Price alerts (online)',
  ] },
  bond: { name: 'Bonds',
    purpose: 'Your bonds in one list, with the coupons they pay and the dates they come back to you.', items: [
    'Coupon and redemption calendar with reminders',
    'Yield comparison across your bonds',
    'Export to PDF or Excel',
  ] },
  div: { name: 'Dividends',
    purpose: 'What your holdings have actually paid you, kept as a record instead of being worked out again every year.', items: [
    'Dividend calendar and yearly forecast',
    'Dividend income report for tax time',
    'Export to PDF or Excel',
  ] },
  ef: { name: 'Emergency Fund',
    purpose: 'The money set aside for a bad month, and whether it is still enough for the life you have now.', items: [
    'Your own ladder rules and targets',
    'Goal-based targets with progress reminders',
    'Statement export',
  ] },
  banksav: { name: 'Bank Savings',
    purpose: 'What is really sitting in each account, so the balance you work from is the true one.', items: [
    'Balance trend charts',
    'Interest earned tracking per account',
    'Statement export',
  ] },
  inflation: { name: 'Inflation',
    purpose: 'What your own costs are doing over the years, which is rarely what the headline rate says.', items: [
    'Your own basket of costs to track',
    'Purchasing-power projections over time',
  ] },
  cc: { name: 'Credit Cards',
    purpose: 'What each card owes, when it falls due, and what the spending on it was actually for.', items: [
    'Statement reminders before the due date',
    'Advanced card and category reports',
    'Export to PDF or Excel',
  ] },
  expense: { name: 'Household Expenses',
    purpose: 'Where the household money goes, written down as it is spent rather than reconstructed later.', now: ['Guided yearly plan setup: salary, loans, emergency fund and more, in a suggested order'], items: [
    'Monthly budgets with alerts',
    'Advanced reports and trends',
    'Receipt scan to fill in expenses (online on first use)',
    'Export to PDF or Excel',
  ] },
  personal: { name: 'Personal Finance',
    purpose: 'Your own spending, kept apart from the household’s, so neither one hides inside the other.', items: [
    'Category budgets with alerts',
    'UPI and card limit warnings',
    'Advanced reports and trends',
    'Export to PDF or Excel',
  ] },
  health: { name: 'Health Check',
    purpose: 'Each person’s readings kept over time, so a number can be read against the last one instead of alone.', free: ['Up to 2 family members'], now: ['More than 2 family members'], items: [
    'Trend charts for each measurement',
    'Reminders for checkups and refills',
    'Export a report for your doctor',
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
