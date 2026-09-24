// Shared screen state (tabs, filters, render tokens) for the Personal Finance and Expense screens,
// which read and change the same values from different files. One object, so any file can set it.
export const ui = {
  _fdSort: 'maturity', // 'maturity' | 'principal' | 'rate' | 'bank'
  _fdFilter: 'active', // 'active' | 'matured' | 'all'
  _fdTab: 'holdings', // 'holdings' | 'overview' | 'ladder' (bottom nav)
  _ccTab: 'cc', // 'cc' | 'heat' | 'cat' | 'chk' (Credit Cards bottom nav)
  _ccYm: null, _ccCardId: null, _ccTimelineClicked: false,
  _expTab: 'tracker', // 'spend' (Balance) | 'tracker' | 'cat' | 'tags' | 'alloc' (bottom nav) - opens on the everyday one
  _calcTab: 'fd', // 'fd' | 'compound' | 'inflation' | 'decide' (Financial Calculators)
  _anTab: null, // 'house' | 'personal' | 'both' | 'prompt' (Analysis); null = the first one available
  _expSheetYm: null, // month shown on the Expense tab; null = this month
  _trkView: 'category', // 'category' | 'entries'
  _trkFilter: 'all',
  _trkYm: null, // month shown on the Tracker tab; null = this month
  _trkHeatmap: true,
  _trkHeatScroll: null, // where the grid was left; null means "the newest"
  _trkTimelineClicked: false,
  _expRenderToken: 0,
  _tagRange: 0, // months back from this one; 0 means everything
  _tagSource: 'all',
  _tagPicked: new Set(),
  _tagSort: 'total',
  _tagSearch: '', // narrows the cloud, not the results
  _tagMatchAll: false, // false = any of them, true = all of them at once
  _pfTab: 'spends', // 'spends' | 'limits' | 'cat' | 'cards' (Card Check) | 'tags'
  _pfYm: null,
  _pfTimelineClicked: false,
  _pfView: 'category', // 'category' | 'entries'
  _pfFilter: 'all',
  _pfRenderToken: 0,
  _allocYear: new Date().getFullYear(),
};
