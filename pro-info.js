// What MyNotes Pro is PLANNED to add, per feature. Shown by the 🏷️ button on each feature screen.
// Plain data so it can be edited without touching code. Nothing here is built yet: the popup says so,
// and the wording must stay "planned" until an item ships (then move it out of this file).
// An item ending in "(online)" needs a connection; everything else works offline.
export const PRO_INFO = {
  stocks: { name: 'Stocks', items: [
    'Sector and allocation analysis across your holdings',
    'Side-by-side comparison of your portfolios',
    'Export holdings to PDF or Excel',
    'Automatic price refresh (online)',
  ] },
  mf: { name: 'Mutual Funds', items: [
    'Automatic background NAV refresh (online)',
    'SIP tracker with reminders',
    'Fund overlap and asset-mix analysis',
    'Export to PDF or Excel',
  ] },
  fd: { name: 'Fixed Deposits', items: [
    'Maturity reminders before each FD ends',
    'FD ladder planner',
    'Interest and TDS estimate for the year',
  ] },
  metal: { name: 'Gold & Silver', now: ['Daily gold, silver and dollar rates, fetched for you', 'India price estimate you can tune to match your own app'], free: ['You type the rates yourself'], items: [
    'Live gold and silver rates, refreshed for you (online)',
    'Value that accounts for making charges and GST',
    'Price alerts (online)',
  ] },
  bond: { name: 'Bonds', items: [
    'Coupon and redemption calendar with reminders',
    'Yield comparison across your bonds',
    'Export to PDF or Excel',
  ] },
  div: { name: 'Dividends', items: [
    'Dividend calendar and yearly forecast',
    'Dividend income report for tax time',
    'Export to PDF or Excel',
  ] },
  ef: { name: 'Emergency Fund', items: [
    'Your own ladder rules and targets',
    'Goal-based targets with progress reminders',
    'Statement export',
  ] },
  banksav: { name: 'Bank Savings', items: [
    'Balance trend charts',
    'Interest earned tracking per account',
    'Statement export',
  ] },
  inflation: { name: 'Inflation', items: [
    'Your own basket of costs to track',
    'Purchasing-power projections over time',
  ] },
  cc: { name: 'Credit Cards', items: [
    'Statement reminders before the due date',
    'Advanced card and category reports',
    'Export to PDF or Excel',
  ] },
  expense: { name: 'Household Expenses', now: ['Guided yearly plan setup: salary, loans, emergency fund and more, in a suggested order'], items: [
    'Monthly budgets with alerts',
    'Advanced reports and trends',
    'Receipt scan to fill in expenses (online on first use)',
    'Export to PDF or Excel',
  ] },
  personal: { name: 'Personal Finance', items: [
    'Category budgets with alerts',
    'UPI and card limit warnings',
    'Advanced reports and trends',
    'Export to PDF or Excel',
  ] },
  health: { name: 'Health Check', free: ['Up to 2 family members'], now: ['More than 2 family members'], items: [
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
