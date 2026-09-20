import { DB } from './db.js';
import { fmtPct, fmtCur, todayISO, num } from './core.js';
import { setAppMode, $, updateMetalNavActive, _metalTab, isSgb, el, _fetchLiveRates, _mfCell, openMetalPremiumSettings, openManualRatesEditor, isPaidPlan, metalPortfolio, _gramsShort, SGB_RULE_TEXT, field, toast, closeModal, setMetalTab, appConfirm, openModal } from './app.js';

// ---------- Metals surface ----------
// Lazy-loaded: metal.js only loads when the user opens Metals. No seed data.
export async function openMetal() {
  setAppMode('metal');
}

export async function renderMetal() {
  const host = $('#metalView');
  host.innerHTML = '';
  updateMetalNavActive();
  // The + (add transaction) button only makes sense on the Gold/Silver ledgers.
  $('#metalAddBtn').classList.toggle('hidden', _metalTab === 'sgb' || _metalTab === 'overview');
  if (_metalTab === 'sgb') return renderMetalSgb(host);
  if (_metalTab === 'overview') {
    const [txns, stocks] = await Promise.all([DB.all('metals').catch(() => []), DB.all('stocks').catch(() => [])]);
    if (!(txns || []).length && !(stocks || []).some(isSgb)) {
      host.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'e-icon', text: '🪙' }),
        el('p', { text: 'No gold or silver yet.' }),
        el('p', { class: 'hint', text: 'Add your first purchase and this page shows what you hold, what it is worth and how it is doing.' }),
        el('button', { class: 'btn primary empty-cta', type: 'button', text: 'Add gold or silver', onclick: () => openMetalTxn(null) }),
      ]));
      return;
    }
    return renderMetalOverview(host);
  }
  return renderMetalLedger(host, _metalTab);
}

// ---- Gold / Silver tab: summary + price control + transaction ledger ----
async function renderMetalLedger(host, metal) {
  const mod = await import('./metal.js');
  let [txns, liveMeta] = await Promise.all([
    DB.byIndex('metals', 'metal', metal).catch(() => []),
    DB.get('meta', 'homeLiveRates').catch(() => null),
  ]);
  // Same first-open fallback as metalPortfolio() - fetch once if Home hasn't
  // populated the cache yet, rather than valuing this metal at ₹0.
  let live = (liveMeta && liveMeta.value) || null;
  if (!live) live = await _fetchLiveRates().catch(() => null) || {};
  const price = Number(live[metal]) || 0;
  const spot = Number(live[metal + 'Spot']) || 0;
  const s = mod.summary(txns || [], metal, price);
  const gramsTxt = (Math.round(s.grams * 10000) / 10000) + ' g';

  host.appendChild(el('section', { class: 'summary' }, [
    el('div', { class: 'row-between' }, [
      el('span', { class: 'label', text: (metal === 'gold' ? 'Gold' : 'Silver') + ' holdings' }),
      s.plPct != null
        ? el('span', { class: 'badge ' + (s.pl >= 0 ? 'good' : 'bad'), text: fmtPct(s.plPct) })
        : el('span', { class: 'badge muted', text: 'fetching price' }),
    ]),
    el('div', { class: 'big', text: s.value > 0 ? fmtCur(s.value, 'INR') : '-' }),
    el('div', { class: 'grid' }, [
      _mfCell('Grams', gramsTxt),
      _mfCell('Invested', fmtCur(s.invested, 'INR')),
      _mfCell('Profit / Loss', (s.pl >= 0 ? '+' : '') + fmtCur(s.pl, 'INR'), s.pl >= 0 ? 'pos' : 'neg'),
      _mfCell('Rate', price > 0 ? fmtCur(price, 'INR') + '/g' : '—'),
    ]),
  ]));

  // Price is no longer typed in here - it's the same live India-estimate
  // figure the Home strip shows (spot + a fixed %), read straight from
  // meta.homeLiveRates so the two can never disagree. "Edit %" opens the one
  // settings sheet shared with Home's own % button.
  host.appendChild(el('div', { class: 'metal-price-row' }, [
    el('span', { class: 'hint', text: price > 0
      ? `${metal === 'gold' ? 'Gold' : 'Silver'} ${fmtCur(price, 'INR')}/g` + (spot > 0 ? ' · spot ' + fmtCur(spot, 'INR') : '')
      : (isPaidPlan() ? 'Fetching live price…' : 'No rate set - tap Edit rate to value your holdings') }),
    isPaidPlan()
      ? el('button', { class: 'btn ghost small', type: 'button', text: 'Edit %', onclick: () => openMetalPremiumSettings(() => renderMetal()) })
      : el('button', { class: 'btn ghost small', type: 'button', text: 'Edit rate', onclick: () => openManualRatesEditor(() => renderMetal()) }),
  ]));

  // By-source composition (Aura / Sify / Interest …) — only when there's a mix.
  if (s.realized) {
    host.appendChild(el('p', { class: 'hint', style: 'margin:0 2px 8px', text: `Realized from sells: ${(s.realized >= 0 ? '+' : '') + fmtCur(s.realized, 'INR')}` }));
  }
  const sources = mod.sourceBreakdown(txns || [], metal);
  if (sources.length > 1) {
    const scard = el('div', { class: 'chart-card' }, [el('h3', { text: 'By source' })]);
    sources.forEach((src) => {
      scard.appendChild(el('div', { class: 'div-year-row' }, [
        el('span', { class: 'div-year-k', text: src.source }),
        el('span', { class: 'div-year-v', text: (Math.round(src.grams * 10000) / 10000) + ' g' }),
        el('span', { class: 'div-year-sub', text: src.bought > 0 ? 'bought ' + fmtCur(src.bought, 'INR') : 'free' }),
      ]));
    });
    host.appendChild(scard);
  }

  if (!txns || !txns.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: metal === 'gold' ? '🥇' : '🥈' }),
      el('p', { text: 'No transactions yet.' }),
      el('p', { class: 'hint', text: 'Tap + to add a buy, sell, or interest credit.' }),
    ]));
    return;
  }
  const wrap = el('section', { class: 'stock-list' });
  txns.slice().sort((a, b2) => (b2.date || '').localeCompare(a.date || '')).forEach((t) => wrap.appendChild(_metalTxnCard(t)));
  host.appendChild(wrap);
}

function _metalTxnCard(t) {
  const grams = Number(t.grams) || 0;
  const amt = Number(t.amount) || 0;
  const typeLabel = t.type === 'sell' ? 'Sell' : t.type === 'interest' ? 'Interest' : 'Buy';
  const gTxt = (grams >= 0 ? '+' : '−') + (Math.round(Math.abs(grams) * 10000) / 10000) + ' g';
  return el('div', { class: 'card', onclick: () => openMetalTxn(t) }, [
    el('div', { class: 'top' }, [
      el('div', {}, [
        el('div', { class: 'name', text: gTxt }),
        el('div', { class: 'cat', text: `${t.date || ''} · ${typeLabel}${t.via ? ' · ' + t.via : ''}` }),
      ]),
      el('div', { class: 'card-right' }, [
        el('div', { class: 'kv-val', text: (amt < 0 ? '−' : '') + fmtCur(Math.abs(amt), 'INR') }),
        t.type === 'interest' ? el('div', { class: 'kv-label', text: 'free' }) : document.createTextNode(''),
      ]),
    ]),
    t.note ? el('div', { class: 'meta-line', text: t.note }) : document.createTextNode(''),
  ]);
}

// ---- Overview tab: gold vs silver split. Gold INCLUDES SGB (from Stocks),
// valued at the gold ₹/gram price — "end of the day it's gold". ----
async function renderMetalOverview(host) {
  const { gold: g, silver: s } = await metalPortfolio();
  const totInv = g.invested + s.invested;
  const totVal = g.value + s.value;
  const totPl = totVal - totInv;
  const totPlPct = totInv > 0 ? (totPl / totInv) * 100 : null;
  const realized = (g.realized || 0) + (s.realized || 0);

  host.appendChild(el('section', { class: 'summary' }, [
    el('div', { class: 'row-between' }, [
      el('span', { class: 'label', text: 'Gold + Silver' }),
      totPlPct != null
        ? el('span', { class: 'badge ' + (totPl >= 0 ? 'good' : 'bad'), text: fmtPct(totPlPct) })
        : el('span', { class: 'badge muted', text: 'fetching price' }),
    ]),
    el('div', { class: 'big', text: totVal > 0 ? fmtCur(totVal, 'INR') : '-' }),
    el('div', { class: 'grid' }, [
      _mfCell('Invested', fmtCur(totInv, 'INR')),
      _mfCell('Value', fmtCur(totVal, 'INR')),
      _mfCell('Profit / Loss', (totPl >= 0 ? '+' : '') + fmtCur(totPl, 'INR'), totPl >= 0 ? 'pos' : 'neg'),
      _mfCell('Realized', (realized >= 0 ? '+' : '') + fmtCur(realized, 'INR'), realized >= 0 ? 'pos' : 'neg'),
    ]),
  ]));

  // Allocation bars (by value, and by invested).
  const allocCard = (title, gv, sv) => {
    const tot = gv + sv;
    const card = el('div', { class: 'chart-card' }, [el('h3', { text: title })]);
    [['🥇 Gold', gv], ['🥈 Silver', sv]].forEach(([label, val]) => {
      const pct = tot > 0 ? (val / tot) * 100 : 0;
      card.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bl', text: label }),
        el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill', style: 'width:' + pct.toFixed(1) + '%' })]),
        el('span', { class: 'bn', text: pct.toFixed(1) + '%' }),
      ]));
    });
    return card;
  };
  host.appendChild(allocCard('Allocation by value', g.value, s.value));
  host.appendChild(allocCard('Allocation by invested', g.invested, s.invested));

  // Per-metal comparison table (Gold row includes SGB).
  const rowFor = (name, x) => el('div', { class: 'div-trow' }, [
    el('span', { class: 'div-tyear', text: name }),
    el('span', { text: _gramsShort(x.grams) + ' g' }),
    el('span', { text: fmtCur(x.value, 'INR') }),
    el('span', { class: 'div-yoy ' + (x.pl >= 0 ? 'pos' : 'neg'), text: x.plPct != null ? fmtPct(x.plPct) : '—' }),
  ]);
  const table = el('div', { class: 'chart-card' }, [
    el('h3', { text: 'Gold vs Silver' }),
    el('div', { class: 'div-table' }, [
      el('div', { class: 'div-trow div-thead' }, [el('span', { text: 'Metal' }), el('span', { text: 'Grams' }), el('span', { text: 'Value' }), el('span', { text: 'P/L' })]),
      rowFor('Gold', g),
      rowFor('Silver', s),
    ]),
  ]);
  if (g.sgbGrams > 0) {
    table.appendChild(el('p', { class: 'hint', text: `Gold includes ${_gramsShort(g.sgbGrams)} g SGB (valued at the gold price); digital gold is ${_gramsShort(g.digital.grams)} g. SGB is entered under Stocks.` }));
  }
  host.appendChild(table);
}

// ---- SGB tab: read-only list pulled from the Stocks store (name matches /sgb/i) ----
async function renderMetalSgb(host) {
  const all = (await DB.all('stocks')) || [];
  const sgbs = all.filter(isSgb);
  host.appendChild(el('div', { class: 'sgb-rule' }, [
    el('span', { class: 'sgb-rule-ico', text: '📜' }),
    el('div', {}, [
      el('b', { text: 'How an SGB gets here' }),
      el('div', { text: SGB_RULE_TEXT }),
      el('div', { class: 'sgb-rule-eg', text: 'Example: name "SGB 2032 Series II", category "BONDS".' }),
    ]),
  ]));
  if (!sgbs.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🪙' }),
      el('p', { text: 'No SGBs yet.' }),
      el('p', { class: 'hint', text: 'Add one under Stocks using the name and category above, and it appears here.' }),
    ]));
    return;
  }
  host.appendChild(el('p', { class: 'hint', style: 'margin:2px 0 10px', text: 'Add or edit these under Stocks; they are shown here for reference.' }));

  // ---- Overview: every SGB summed into one figure, same shape as the Gold/
  // Silver ledger's own summary card above the per-bond list below it.
  let totGrams = 0, totInv = 0, totVal = 0;
  sgbs.forEach((s) => {
    const grams = Number(s.units) || 0;
    totGrams += grams;
    totInv += grams * (Number(s.buyPrice) || 0);
    totVal += grams * (Number(s.currentPrice) || 0);
  });
  const totPl = totVal - totInv;
  // Aggregate return (total P/L over total invested), not an average of each
  // bond's own % - a ₹50,000 SGB and a ₹5,000 SGB shouldn't count equally
  // toward the headline the way a plain average of percentages would.
  const totPlPct = totInv > 0 ? (totPl / totInv) * 100 : null;
  host.appendChild(el('section', { class: 'summary' }, [
    el('div', { class: 'row-between' }, [
      el('span', { class: 'label', text: 'SGB holdings' }),
      totPlPct != null
        ? el('span', { class: 'badge ' + (totPl >= 0 ? 'good' : 'bad'), text: fmtPct(totPlPct) })
        : el('span', { class: 'badge muted', text: 'no invested amount' }),
    ]),
    el('div', { class: 'big', text: totVal > 0 ? fmtCur(totVal, 'INR') : (totInv > 0 ? fmtCur(totInv, 'INR') : '-') }),
    el('div', { class: 'grid' }, [
      _mfCell('Grams', _gramsShort(totGrams) + ' g'),
      _mfCell('Invested', fmtCur(totInv, 'INR')),
      _mfCell('Profit / Loss', (totPl >= 0 ? '+' : '') + fmtCur(totPl, 'INR'), totPl >= 0 ? 'pos' : 'neg'),
      _mfCell('SGBs', String(sgbs.length)),
    ]),
  ]));

  const wrap = el('section', { class: 'stock-list' });
  sgbs.forEach((s) => {
    const grams = Number(s.units) || 0;
    const inv = grams * (Number(s.buyPrice) || 0);
    const val = grams * (Number(s.currentPrice) || 0);
    const pl = val - inv;
    wrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'top' }, [
        el('div', {}, [
          el('div', { class: 'name', text: s.name }),
          el('div', { class: 'cat', text: `${grams} g` + (s.buyPrice ? ' · buy ' + fmtCur(s.buyPrice, 'INR') + '/g' : '') }),
        ]),
        el('div', { class: 'card-right' }, [
          el('div', { class: 'kv-val', text: fmtCur(val > 0 ? val : inv, 'INR') }),
          val > 0 ? el('div', { class: 'meta-line ' + (pl >= 0 ? 'pos' : 'neg'), text: (pl >= 0 ? '+' : '') + fmtCur(pl, 'INR') }) : document.createTextNode(''),
        ]),
      ]),
    ]));
  });
  host.appendChild(wrap);
}

// ---- Add / edit a metal transaction ----
export async function openMetalTxn(existing) {
  const isEdit = !!(existing && existing.id != null);
  const t = Object.assign({ metal: (_metalTab === 'silver' ? 'silver' : 'gold'), type: 'buy', via: 'Aura', date: todayISO() }, existing || {});

  const date = el('input', { type: 'date', value: t.date || todayISO() });
  const metal = el('select', {}, [['gold', 'Gold'], ['silver', 'Silver']].map(([v, l]) => { const o = el('option', { value: v, text: l }); if (v === t.metal) o.selected = true; return o; }));
  const type = el('select', {}, [['buy', 'Buy'], ['sell', 'Sell'], ['interest', 'Interest / bonus']].map(([v, l]) => { const o = el('option', { value: v, text: l }); if (v === t.type) o.selected = true; return o; }));
  const numInput = (val, ph) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: val != null && val !== '' ? val : '', placeholder: ph });
  const grams = numInput(t.grams != null && t.grams !== '' ? Math.abs(Number(t.grams)) : '', 'Grams');
  const amount = numInput(t.amount != null && t.amount !== '' ? Math.abs(Number(t.amount)) : '', '₹ amount');
  const via = el('input', { type: 'text', value: t.via || '', placeholder: 'Aura / Physical / Employer' });
  const note = el('input', { type: 'text', value: t.note || '', placeholder: 'Note (optional)' });

  const hint = el('p', { class: 'hint' });
  const amountField = field('₹ amount', amount);
  const updHint = () => {
    hint.textContent = type.value === 'sell' ? 'Sell: grams leave your holding (cost basis removed automatically); ₹ is the sale proceeds.'
      : type.value === 'interest' ? 'Interest / bonus: free grams added; ₹ is the value of those grams — not counted as invested.'
      : 'Buy: grams added; ₹ is what you invested.';
  };
  type.addEventListener('change', updHint); updHint();

  const save = async () => {
    const g = num(grams.value), a = num(amount.value);
    if (!(g > 0)) { toast('Enter grams'); return; }
    const isSell = type.value === 'sell';
    // amount always stored positive; meaning comes from `type` (rollup handles it).
    const rec = {
      metal: metal.value,
      date: date.value || todayISO(),
      grams: isSell ? -Math.abs(g) : Math.abs(g),
      amount: Math.abs(a || 0),
      via: via.value.trim(),
      type: type.value,
      note: note.value.trim(),
      createdAt: t.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (isEdit) rec.id = t.id;
    await DB.put('metals', rec);
    closeModal(); toast(isEdit ? 'Saved' : 'Added');
    setMetalTab(metal.value === 'silver' ? 'silver' : 'gold');
    renderMetal();
  };
  const del = async () => {
    if (!(await appConfirm('Delete this transaction?'))) return;
    await DB.del('metals', t.id); closeModal(); toast('Deleted'); renderMetal();
  };

  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (isEdit) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: isEdit ? 'Edit transaction' : 'Add metal transaction' }),
      el('div', { class: 'field-row' }, [field('Date', date), field('Metal', metal)]),
      field('Type', type),
      el('div', { class: 'field-row' }, [field('Grams', grams), amountField]),
      field('Via', via),
      field('Note', note),
      hint,
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}
