import { el } from './app.js';

// Free Plan vs Pro Plan, one table shared by the website and the in-app "Unlock all features" sheet.
// Every row states what is true in the app TODAY; anything not built yet carries "Planned", so this never
// promises something the code does not do. The Health Check number is FREE_PEOPLE_LIMIT in health.js
// (a unit test keeps the two in step). Tap a row to read what it means.
export const compareRows = (freeCount, total) => [
  ['Features you can use', 'Any ' + freeCount + ' of ' + total, 'All ' + total, null,
    'Free Plan: pick any ' + freeCount + ' of the ' + total + ' features. Pro Plan: all ' + total + ' at once, with nothing to choose.'],
  ['Switch features anytime, nothing lost', true, true, null,
    'Swap features whenever you like. The data of a feature you hide is kept, so switching never costs you anything.'],
  ['Everyday tracking, limits and analysis', true, true, null,
    'Adding entries, limits, reviews and insights work the same on both plans.'],
  ['Private, offline, no account', true, true, null,
    'Your data stays on your phone. No account, no ads, and it works without internet.'],
  ['Backups you control', true, true, null,
    'Save a backup file to a place you choose, and restore it when you need it.'],
  ['My Passwords vault', true, true, null,
    'Encrypted passwords stored only on your device. Every vault feature is free on both plans, with no limits and no Pro extras. On the Free Plan it counts as one of your 5 features.'],
  ['Family members in Health Check', '2', 'No limit', null,
    'The Free Plan keeps up to 2 family members in Health Check. The Pro Plan has no limit.'],
  ['Update stocks: current price, units, avg price', 'Manual entry', 'Screenshot (OCR)', null,
    'Free Plan: on each stock you type the current price, units and average price by hand. Pro Plan: upload one screenshot and the app reads all three from it (OCR). Works with Paytm Money and Groww (current price only) for Indian stocks and INDmoney for US stocks; other apps are coming soon.'],
  ['Mutual fund NAV', 'Manual entry', 'One tap', null,
    'Free Plan: tap a fund and type its latest NAV, whenever you like. Pro Plan: one tap fetches the latest NAV for all your funds.'],
  ['Gold, silver and dollar rates', 'Manual entry', 'Auto daily', null,
    'Free Plan: type the rates you want your holdings valued at, and they stay until you change them. Pro Plan: MyNotes fetches them for you each day, and you can tune the India price estimate to match the app you compare against.'],
  ['Guided yearly plan setup', false, true, null,
    'A step-by-step setup for your salary, loans, emergency fund, house, investments and savings, with a live balance. Pro Plan only.'],
  ['Restore a backup on another device', 'Today: yes', 'Yes', 'Planned to become Pro only - we will say so first',
    'Today a backup can be restored on any device. We plan to make this a Pro Plan feature later, and we will tell you before that changes.'],
  ['Advanced reports, receipt scan, exports', false, 'Planned', null,
    'Ideas we plan to add for the Pro Plan. None of these is available yet.'],
];

const cell = (v, pro) => {
  const cls = 'lp-cmp-c' + (pro ? ' is-pro' : '');
  if (v === true) return el('span', { class: cls + ' yes', text: '✓' });
  if (v === false) return el('span', { class: cls + ' no', text: '—' });
  return el('span', { class: cls, text: v });
};

// The column titles as their own row, so a sheet can keep them pinned while the rows below scroll.
export function buildCompareHeader() {
  return el('div', { class: 'lp-cmp-row lp-cmp-head' }, [
    el('span', {}),
    el('span', { class: 'lp-cmp-c', text: 'Free Plan' }),
    el('span', { class: 'lp-cmp-c is-pro' }, [el('img', { class: 'lp-cmp-star', src: 'icons/emoji/pro-star.png', alt: '' }), el('span', { text: 'Pro Plan' })]),
  ]);
}

// opts.noHeader: leave the column titles out (the caller shows buildCompareHeader() above the scroll area).
export function buildPlanCompare(freeCount, total, opts) {
  const rows = compareRows(freeCount, total).map(([label, free, pro, note, detail]) => {
    const row = el('button', { class: 'lp-cmp-row lp-cmp-item', type: 'button', 'aria-expanded': 'false' }, [
      el('span', { class: 'lp-cmp-l' }, [el('span', { text: label }), note ? el('small', { text: note }) : null].filter(Boolean)),
      cell(free, false),
      cell(pro, true),
      el('span', { class: 'lp-cmp-detail', text: detail }),
    ]);
    row.addEventListener('click', () => {
      const open = !row.classList.contains('open');
      row.classList.toggle('open', open);
      row.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    return row;
  });
  const split = !!(opts && opts.noHeader);
  return el('div', { class: 'lp-cmp' + (split ? ' is-split' : '') }, [
    ...(split ? [] : [buildCompareHeader()]),
    ...rows,
    el('p', { class: 'lp-cmp-tip', text: 'Tap a row to see what it means.' }),
  ]);
}
