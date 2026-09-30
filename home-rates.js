import { closeModal, el, field, isPaidPlan, openModal, refresh, toast } from './app.js';
import { DB } from './db.js';
import { num } from './core.js';
import { round2 } from './expense-ui.js';

//
// Three read-only boxes below the section cards - 24K gold and 999 silver per
// gram, and the USD→INR rate. Two free, no-key APIs: gold-api.com for XAU/XAG
// spot (USD per troy ounce), open.er-api.com for the forex rate.
//
// gold-api.com/gold-api.com's XAU/XAG figure is the INTERNATIONAL (LBMA-style)
// spot price, not a domestic Indian retail quote - a jeweller's or a
// digital-gold app's own rate runs noticeably higher once import duty, GST
// and a dealer/platform margin are added on top. A real India-domestic feed
// (IBJA) was tried and dropped: the one free mirror of it has no CORS
// headers, so a browser fetch to it is blocked outright (confirmed via a live
// console error, not a guess), and IBJA's own official API is paid-only.
//
// So the domestic figure shown as the MAIN number is spot marked up by a
// fixed percentage instead - GOLD_DOMESTIC_PREMIUM_PCT / SILVER_..., set by
// the user on 2026-09-15 against that day's actual India price vs this same
// spot feed. Unlike the USD→INR gap below, this premium is structural (duty +
// GST + dealer margin), not pure bid/ask noise, so a fixed percentage is a
// reasonable stand-in between real domestic-feed reads - but it IS a
// snapshot, not something the API recomputes, so if the user ever reports it
// drifting, ask what today's real domestic figure is and rederive the
// percentage rather than nudging it blind. The untouched spot figure is kept
// alongside it (goldSpot/silverSpot) and shown as the smaller secondary line
// in each box specifically so the raw number stays checkable.
//
// USD→INR is left as pure open.er-api.com mid-market, no markup. What
// Google/a bank/a card network shows at the same moment can differ by a few
// paise to half a rupee even when both sides are working correctly -
// different providers snapshot at different instants and from different
// panels of banks, and the gap moves day to day and can flip sign, unlike the
// gold/silver premium above. Confirmed with the user 2026-09-15: leave it be.
//
// The Metals tab's own ₹/gram price (metalPortfolio(), renderMetalLedger())
// reads this SAME cached value (2026-09-15 onward) rather than a separate
// manually-typed figure - the two used to be independent stores that could
// silently disagree; now there's one live number, shown two places.
//
// Cached in meta.homeLiveRates and refreshed at most once a day, silently in
// the background - open.er-api.com's own feed only updates daily, and
// hammering either API on every Home open buys nothing. The cached value
// paints instantly; a slow or failed fetch never blocks Home.
const TROY_OZ_GRAMS = 31.1034768;
const LIVE_RATES_STALE_MS = 24 * 60 * 60 * 1000;
// Defaults only - the user's own figures (meta.metalDomesticPremium) always
// win once set. See openMetalPremiumSettings.
const GOLD_DOMESTIC_PREMIUM_PCT = 13.8;
const SILVER_DOMESTIC_PREMIUM_PCT = 14.6;

async function _metalPremiumPct() {
  const row = await DB.get('meta', 'metalDomesticPremium').catch(() => null);
  const v = row && row.value;
  return {
    gold: v && v.gold != null ? Number(v.gold) : GOLD_DOMESTIC_PREMIUM_PCT,
    silver: v && v.silver != null ? Number(v.silver) : SILVER_DOMESTIC_PREMIUM_PCT,
  };
}

export async function _fetchLiveRates() {
  // Fetching live rates is a Pro Plan feature. On the Free Plan nothing is requested from anywhere and the
  // figures are whatever the person typed in themselves (source: 'manual'), so every caller stays offline.
  if (!isPaidPlan()) return null;
  const [xauR, xagR, fxR] = await Promise.all([
    fetch('https://api.gold-api.com/price/XAU').catch(() => null),
    fetch('https://api.gold-api.com/price/XAG').catch(() => null),
    fetch('https://open.er-api.com/v6/latest/USD').catch(() => null),
  ]);
  const [xau, xag, fx] = await Promise.all([
    xauR && xauR.ok ? xauR.json().catch(() => null) : null,
    xagR && xagR.ok ? xagR.json().catch(() => null) : null,
    fxR && fxR.ok ? fxR.json().catch(() => null) : null,
  ]);
  const usdInr = fx && fx.rates ? Number(fx.rates.INR) : null;
  const goldOz = xau ? Number(xau.price) : null;
  const silverOz = xag ? Number(xag.price) : null;
  if (!(usdInr > 0) || !(goldOz > 0) || !(silverOz > 0)) return null;
  const goldSpot = round2((goldOz / TROY_OZ_GRAMS) * usdInr);
  const silverSpot = round2((silverOz / TROY_OZ_GRAMS) * usdInr);
  const pct = await _metalPremiumPct();
  const value = {
    gold: round2(goldSpot * (1 + pct.gold / 100)),
    goldSpot,
    silver: round2(silverSpot * (1 + pct.silver / 100)),
    silverSpot,
    premiumPct: pct,
    usdInr: round2(usdInr),
    source: 'spot+premium',
    asOf: new Date().toISOString(),
  };
  await DB.put('meta', { key: 'homeLiveRates', value }).catch(() => {});
  return value;
}

// Re-applies the (possibly just-edited) premium % to the LAST FETCHED spot
// price, with no network call - editing the % should feel instant, not
// trigger a round trip to two APIs for a number that hasn't itself changed.
// Falls back to a real fetch only if nothing has ever been cached yet.
async function _recomputeLiveRatesPremium() {
  const cached = await DB.get('meta', 'homeLiveRates').catch(() => null);
  const v = cached && cached.value;
  if (!v || v.goldSpot == null || v.silverSpot == null) return _fetchLiveRates();
  const pct = await _metalPremiumPct();
  const value = Object.assign({}, v, {
    gold: round2(v.goldSpot * (1 + pct.gold / 100)),
    silver: round2(v.silverSpot * (1 + pct.silver / 100)),
    premiumPct: pct,
  });
  await DB.put('meta', { key: 'homeLiveRates', value }).catch(() => {});
  return value;
}

// Free Plan: the same three figures, typed in by the person instead of fetched. Stored in the very same
// meta.homeLiveRates row the fetch would have written, so Metals, Home and the Expense sheet read one
// source either way. No spot price and no premium %, because nothing was fetched to apply one to.
export async function openManualRatesEditor(onSaved) {
  const cached = await DB.get('meta', 'homeLiveRates').catch(() => null);
  const v = (cached && cached.value) || {};
  const goldIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v.gold != null ? v.gold : '' });
  const silverIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v.silver != null ? v.silver : '' });
  const usdIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v.usdInr != null ? v.usdInr : '' });
  const save = async () => {
    const g = num(goldIn.value), s = num(silverIn.value), u = num(usdIn.value);
    const value = {
      gold: g > 0 ? round2(g) : null,
      silver: s > 0 ? round2(s) : null,
      usdInr: u > 0 ? round2(u) : null,
      source: 'manual',
      asOf: new Date().toISOString(),
    };
    await DB.put('meta', { key: 'homeLiveRates', value });
    closeModal();
    toast('Rates saved');
    if (typeof onSaved === 'function') onSaved(value);
  };
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Your rates' }),
    el('p', { class: 'hint', text: 'Type the rates you want your holdings valued at - from your jeweller, your gold app or the news. They stay on this device and change nothing else. The Pro Plan fetches these for you every day.' }),
    field('Gold 24K (\u20B9 per gram)', goldIn),
    field('Silver 999 (\u20B9 per gram)', silverIn),
    field('1 USD (\u20B9)', usdIn),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ]),
  ]));
}

// Shared by the Home strip's % button and the Metals tab's "Edit %" button -
// one settings surface, since both read the same meta.metalDomesticPremium.
// `onSaved(freshValue)` lets each caller repaint just its own UI rather than
// this function knowing about either screen.
export async function openMetalPremiumSettings(onSaved) {
  const pct = await _metalPremiumPct();
  const goldIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: pct.gold });
  const silverIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: pct.silver });

  const save = async () => {
    const g = num(goldIn.value), s = num(silverIn.value);
    await DB.put('meta', {
      key: 'metalDomesticPremium',
      value: {
        gold: g != null ? g : GOLD_DOMESTIC_PREMIUM_PCT,
        silver: s != null ? s : SILVER_DOMESTIC_PREMIUM_PCT,
        updatedAt: new Date().toISOString(),
      },
    });
    closeModal();
    const fresh = await _recomputeLiveRatesPremium().catch(() => null);
    toast('Saved');
    if (typeof onSaved === 'function') onSaved(fresh);
  };

  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'India price estimate' }),
    el('p', { class: 'hint', text: 'Gold/silver on Home and the Metals tab are international spot plus this fixed percentage, approximating a jeweller/digital-gold rate (import duty + GST + dealer margin). Adjust either % if what you actually see quoted has drifted from this estimate.' }),
    field('Gold premium (%)', goldIn),
    field('Silver premium (%)', silverIn),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ]),
  ]));
}

const _homeRateFmt = (v) => v != null ? '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

// "3h ago" / "2d ago" - short, since this sits under three number boxes.
function _liveRatesAsOfLabel(iso) {
  const then = iso ? new Date(iso).getTime() : NaN;
  if (!then) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}

// `sub`, when given, is the raw spot figure - shown smaller, under the main
// (marked-up) value, so the untouched number stays checkable at a glance
// instead of only living in a tooltip or a separate screen.
function _liveRateBox(label, val, sub, kind) {
  return el('div', { class: 'home-rate-box' + (kind ? ' is-' + kind : '') }, [
    el('div', { class: 'home-rate-lbl', text: label }),
    el('div', { class: 'home-rate-val', text: _homeRateFmt(val) }),
    el('div', { class: 'home-rate-sub', text: sub != null ? 'Spot ' + _homeRateFmt(sub) : '' }),
  ]);
}

// Names the basis gold/silver are on - see the block comment above
// _fetchLiveRates for why the main figure is spot + a fixed India premium
// rather than a live domestic feed. Reads the ACTUAL % that produced this
// particular cached value (falls back to the defaults for a value cached
// before premiumPct existed), not the current setting - so an old cached
// figure never claims a % it wasn't computed with.
const _liveRatesSourceLabel = (rates) => {
  if (!rates || rates.source !== 'spot+premium') return '';
  const pct = rates.premiumPct || { gold: GOLD_DOMESTIC_PREMIUM_PCT, silver: SILVER_DOMESTIC_PREMIUM_PCT };
  return '+' + pct.gold + '%/+' + pct.silver + '% India est.';
};

export async function _homeLiveRatesStrip() {
  const cached = await DB.get('meta', 'homeLiveRates').catch(() => null);
  const rates = cached && cached.value ? cached.value : null;

  const goldBox = _liveRateBox('Gold 24K/g', rates ? rates.gold : null, rates ? rates.goldSpot : null, 'gold');
  const silverBox = _liveRateBox('Silver 999/g', rates ? rates.silver : null, rates ? rates.silverSpot : null, 'silver');
  const usdBox = _liveRateBox('1 USD', rates ? rates.usdInr : null, null, 'usd');
  const asOfEl = el('div', {
    class: 'home-rate-asof',
    text: rates ? _liveRatesSourceLabel(rates) + ' · ' + _liveRatesAsOfLabel(rates.asOf) : 'Fetching…',
  });
  const paid = isPaidPlan();
  const refreshBtn = el('button', { type: 'button', class: 'home-rate-refresh', title: 'Refresh', text: '↻' });
  const settingsBtn = el('button', { type: 'button', class: 'home-rate-settings', title: 'Edit India %', text: '%' });
  // Free Plan: one pencil, no refresh and no % - there is no spot price to apply a percentage to.
  const editBtn = el('button', { type: 'button', class: 'home-rate-edit', title: 'Edit your rates', text: '✎' });

  const paint = (v) => {
    // Falls back to the ORIGINAL cache read, not the attempted-and-failed
    // fetch, so a refresh tap that fails offline keeps showing the last known
    // good figures instead of blanking them to em-dashes.
    const shown = v || rates;
    goldBox.querySelector('.home-rate-val').textContent = _homeRateFmt(shown && shown.gold);
    goldBox.querySelector('.home-rate-sub').textContent = shown && shown.goldSpot != null ? 'Spot ' + _homeRateFmt(shown.goldSpot) : '';
    silverBox.querySelector('.home-rate-val').textContent = _homeRateFmt(shown && shown.silver);
    silverBox.querySelector('.home-rate-sub').textContent = shown && shown.silverSpot != null ? 'Spot ' + _homeRateFmt(shown.silverSpot) : '';
    usdBox.querySelector('.home-rate-val').textContent = _homeRateFmt(shown && shown.usdInr);
    asOfEl.textContent = shown
      ? (paid ? _liveRatesSourceLabel(shown) + ' · ' + _liveRatesAsOfLabel(shown.asOf) : 'Your rates · ' + _liveRatesAsOfLabel(shown.asOf))
      : (paid ? 'Unavailable offline' : 'Tap to set your rates');
  };

  settingsBtn.onclick = () => openMetalPremiumSettings((fresh) => paint(fresh));

  const refresh = async () => {
    refreshBtn.classList.add('spinning');
    const v = await _fetchLiveRates().catch(() => null);
    refreshBtn.classList.remove('spinning');
    paint(v);
  };
  refreshBtn.onclick = refresh;

  const edit = () => openManualRatesEditor((fresh) => paint(fresh));
  editBtn.onclick = edit;
  // A manual figure left over from the Free Plan is replaced the moment Pro is on, not a day later.
  if (paid && (!rates || rates.source === 'manual' || (Date.now() - new Date(rates.asOf).getTime()) > LIVE_RATES_STALE_MS)) refresh();
  if (!paid) paint(rates);

  const row = el('div', { class: 'home-rates-row' }, [goldBox, silverBox, usdBox]);
  // The whole row is the way in on the Free Plan: an empty strip that cannot be tapped says nothing.
  if (!paid) { row.classList.add('is-editable'); row.addEventListener('click', edit); }
  return el('div', { class: 'home-rates' + (paid ? '' : ' is-manual') }, [
    row,
    el('div', { class: 'home-rates-foot' }, paid ? [asOfEl, settingsBtn, refreshBtn] : [asOfEl, editBtn]),
  ]);
}

