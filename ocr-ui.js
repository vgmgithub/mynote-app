import { _normName, appAlert, b, closeModal, el, hideLoader, isPaidPlan, openModal, refresh, setLoader, showLoader, state, syncNifty, toast } from './app.js';
import { curOfAny } from './stocks-profiles.js';
import { DB } from './db.js';
import { fmtCur, fmtPct, labelToYm, monthKey, num, pctClass, summarize, thisYm, ymToLabel } from './core.js';


// OCR alias memory: when the user overrides the auto-match in the review modal
// (e.g. parsed "Adani Pwr" → mapped manually to stock "Adani Power Ltd"), we
// remember that mapping so next time the same parsed name auto-matches with
// full confidence - no re-tweaking. Keyed by portfolio so an alias in one
// portfolio can't leak into another. Lives in the existing `meta` store; small
// enough to load whole into memory on demand.
const _aliasKey = (portfolio, parsedName) => portfolio + '|' + _normName(parsedName);
async function _loadOcrAliases() {
  const rec = await DB.get('meta', 'ocr-aliases').catch(() => null);
  return (rec && rec.value) || {};
}
async function _saveOcrAlias(portfolio, parsedName, stockId) {
  const norm = _normName(parsedName);
  if (!norm) return;
  const aliases = await _loadOcrAliases();
  const key = _aliasKey(portfolio, parsedName);
  if (stockId) aliases[key] = stockId;
  else delete aliases[key];
  await DB.put('meta', { key: 'ocr-aliases', value: aliases });
}
function _findStockMatch(parsedName, stocks) {
  const t = _normName(parsedName);
  if (!t) return null;
  let best = null;
  for (const s of stocks) {
    if (s.status === 'sold') continue;
    const nn = _normName(s.name);
    if (!nn) continue;
    if (nn === t) return { stock: s, score: 1 };
    // substring (either way) - score by length ratio
    if (nn.includes(t) || t.includes(nn)) {
      const score = Math.min(nn.length, t.length) / Math.max(nn.length, t.length);
      if (!best || score > best.score) best = { stock: s, score };
      continue;
    }
    // looser fallback: count of shared leading letters / total
    let k = 0; const lim = Math.min(nn.length, t.length);
    while (k < lim && nn.charCodeAt(k) === t.charCodeAt(k)) k++;
    if (k >= 3) {
      const score = k / Math.max(nn.length, t.length);
      if (!best || score > best.score) best = { stock: s, score };
    }
  }
  // Always return the best - user can untick in the review if wrong.
  return best;
}


const OCR_LOCK_MSG = 'Updating holdings from a screenshot is a Pro Plan feature. On the Free Plan, edit each stock and enter its units, average price and current price.';
export async function openOcrFlow() {
  if (!isPaidPlan()) { toast(OCR_LOCK_MSG); return; }
  // multiple: lets the OS picker accept 1-N screenshots (typical 4-5 for a long
  // holdings list that doesn't fit one screen). Sequential OCR with a shared
  // Tesseract worker - see ocrImages() in ocr.js.
  const input = el('input', { type: 'file', accept: 'image/*', multiple: '' });
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    showLoader('Loading OCR engine…');
    try {
      const mod = await import('./ocr.js');
      const total = files.length;
      const texts = await mod.ocrImages(files, (m) => {
        if (!m || !m.status) return;
        const idx = (m.fileIndex || 0) + 1;
        const pct = (m.progress != null && !isNaN(m.progress)) ? Math.round(m.progress * 100) : null;
        const status = m.status.charAt(0).toUpperCase() + m.status.slice(1);
        const prefix = total > 1 ? 'Image ' + idx + '/' + total + ' · ' : '';
        setLoader(prefix + status + (pct != null ? ' · ' + pct + '%' : ''));
      });
      // Merge rows from all images. Dedup by normalised stock name (first wins)
      // so a scroll-overlap between screenshot N and N+1 doesn't produce dupes.
      const seen = new Set();
      const allRows = [];
      for (const text of texts) {
        const rows = mod.parseBrokerRows(text, state.portfolio);
        for (const r of rows) {
          const key = mod.normName(r.name);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          allRows.push(r);
        }
      }
      hideLoader();
      // Note: the image Files go only to Tesseract for recognition. We never
      // persist them - only the parsed numbers reach the review screen.
      const rawText = texts.join('\n\n----- next image -----\n\n');
      if (!allRows.length) { openOcrDebug(rawText); return; }
      const aliases = await _loadOcrAliases();
      openOcrReview(allRows, aliases, rawText);
    } catch (e) {
      hideLoader();
      appAlert('OCR failed: ' + e.message);
    }
  });
  input.click();
}

// `title`/`note` are overridden when this is opened from the review screen's
// "Raw text" button — there the parser DID find rows, the user just wants to
// see what was actually read so a mis-parse can be diagnosed.
function openOcrDebug(text, title, note) {
  const ta = el('textarea', { readonly: 'true', style: 'width:100%;min-height:240px;font-family:monospace;font-size:0.72rem;' });
  ta.value = text || '(empty)';
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: title || 'No holding rows detected' }),
    el('p', { class: 'note', text: note || 'OCR ran but the parser couldn\'t pick out any "units × avg / LTP:" pattern. The raw text below is what was read - share it so the parser can be tuned. Try cropping to just the holdings rows, or use a higher-resolution screenshot.' }),
    ta,
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Copy text', onclick: () => { ta.select(); document.execCommand && document.execCommand('copy'); toast('Copied'); } }),
      el('button', { class: 'btn primary', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}

function openOcrReview(rows, aliases, rawText) {
  const ym = thisYm();
  const monthLabel = ymToLabel(ym);
  // Groww/wife-in: the "Market Price" view shows units (e.g. "27 shares") and
  // current price, but not the average buy price. So we update units + price
  // and leave the saved avg untouched. The Avg column is hidden in the review
  // and the apply step gates avg writes - defense in depth.
  const noAvg = state.portfolio === 'wife-in';
  aliases = aliases || {};
  // Resolve each row's auto-match: saved alias (manual override from a prior
  // run) wins, otherwise fall back to the fuzzy matcher. An alias that points
  // to a now-sold or deleted stock is ignored.
  const matched = rows.map((r) => {
    const aliasId = aliases[_aliasKey(state.portfolio, r.name)];
    if (aliasId) {
      const stock = state.stocks.find((s) => s.id === aliasId && s.status !== 'sold');
      if (stock) return { ...r, match: { stock, score: 1, fromAlias: true } };
    }
    return { ...r, match: _findStockMatch(r.name, state.stocks) };
  });
  const matchedCount = matched.filter((m) => m.match).length;
  // Stocks shown in the per-row override dropdown - only active holdings, sorted
  // by name. Mirrors what _findStockMatch considers, so manual selection and
  // auto-match can never disagree on which pool is valid.
  const activeStocks = state.stocks.filter((s) => s.status !== 'sold')
    .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  // Big-jump heuristic: a stock's parsed price differing > 30% from its saved
  // currentPrice is almost always a wrong match or an OCR misread (not a real
  // 30%/day move). Flag for verification - separate from the ₹→3 suspect heuristic.
  const BIG_JUMP_THRESHOLD = 0.30;
  const isBigJump = (savedLtp, newLtp) =>
    savedLtp != null && newLtp != null && savedLtp > 0 &&
    Math.abs((newLtp - savedLtp) / savedLtp) > BIG_JUMP_THRESHOLD;

  const head = el('div', { class: 'ocr-head' + (noAvg ? ' no-avg' : '') },
    noAvg
      ? [el('span', { text: '' }), el('span', { text: 'Stock' }), el('span', { text: 'Units' }), el('span', { text: 'Price' })]
      : [el('span', { text: '' }), el('span', { text: 'Stock' }), el('span', { text: 'Units' }), el('span', { text: 'Avg' }), el('span', { text: 'LTP' })]
  );
  // Tesseract often misreads ₹ as the digit "3", inflating a price like ₹84.89
  // to "384.89". Flag any integer-part starting with "3" that has 3+ digits
  // ("3xx" up). Over-flagging is fine - the user just glances at highlights.
  const suspectLtp = (v) => v != null && /^3\d{2,}/.test(String(Math.trunc(v)));
  const refs = matched.map((m) => {
    const enabled = !!m.match;
    const cb = el('input', { type: 'checkbox' }); cb.checked = enabled; cb.disabled = !enabled;
    const unitsI = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: m.units != null ? m.units : '' });
    const avgI = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: m.avg != null ? m.avg : '' });
    const ltpI = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: m.ltp != null ? m.ltp : '' });
    if (suspectLtp(m.ltp)) {
      ltpI.classList.add('ocr-suspect');
      ltpI.title = 'OCR may have misread the ₹ symbol as "3". Verify against the screenshot.';
    }
    // Big-jump check uses the *currently-matched* stock; recomputed on dropdown
    // change too (different stock → different saved price → maybe no longer a jump).
    const flagBigJump = () => {
      const saved = ref.match && ref.match.stock ? ref.match.stock.currentPrice : null;
      const parsed = num(ltpI.value);
      if (isBigJump(saved, parsed)) {
        ltpI.classList.add('ocr-suspect');
        ltpI.title = 'Big change vs saved (₹' + saved + ' → ₹' + parsed + '). Confirm before applying.';
      } else if (!suspectLtp(num(ltpI.value))) {
        ltpI.classList.remove('ocr-suspect');
        ltpI.removeAttribute('title');
      }
    };
    // Dropdown to override the auto-matched stock. Pre-selects the best match;
    // user can pick a different stock, "+ Add as new stock" to create one from
    // this row, or "- Skip -" to drop the row. Selecting a stock auto-checks
    // the row; selecting Skip disables it.
    const sel = el('select', { class: 'ocr-match-sel' });
    sel.appendChild(el('option', { value: '', text: '- Skip (no match) -' }));
    sel.appendChild(el('option', { value: '__new__', text: '+ Add as new stock' }));
    for (const s of activeStocks) {
      const opt = el('option', { value: s.id, text: s.name });
      if (m.match && !m.match.fromAlias && m.match.stock.id === s.id) opt.selected = true;
      if (m.match && m.match.fromAlias && m.match.stock.id === s.id) {
        opt.selected = true; opt.textContent = '★ ' + s.name + ' (saved match)';
      }
      sel.appendChild(opt);
    }
    if (!m.match) sel.value = '';
    const nameCell = el('div', { class: 'ocr-name' }, [
      el('div', { class: 'ocr-parsed', text: m.name }),
      sel,
    ]);
    const row = el('div', { class: 'ocr-row' + (noAvg ? ' no-avg' : '') + (enabled ? '' : ' no-match') },
      noAvg ? [cb, nameCell, unitsI, ltpI] : [cb, nameCell, unitsI, avgI, ltpI]
    );
    // ref.allowAvg controls whether the apply step writes buyPrice from this
    // row. For me-in/me-us it's always true (avg column visible). For wife-in
    // (noAvg) it flips to true only when parsed units differ from the matched
    // stock's saved units - a unit change means a buy/sell happened and the
    // average buy price has definitely shifted, so we surface the Avg input
    // as an inline banner for that row only.
    const ref = { row, cb, unitsI, avgI, ltpI, match: m.match, allowAvg: !noAvg };
    flagBigJump();

    const checkAvgVisibility = () => {
      if (!noAvg) { ref.allowAvg = true; return; }
      // "+ Add as new" path keeps current behaviour: avg stays null (the user
      // can edit the new stock's avg from its detail card right after Apply).
      if (ref.match && ref.match.addNew) {
        ref.allowAvg = false;
        if (ref.avgBanner) ref.avgBanner.style.display = 'none';
        return;
      }
      const stock = ref.match && ref.match.stock;
      const savedUnits = stock ? num(stock.units) : null;
      const parsedUnits = num(unitsI.value);
      const changed = savedUnits != null && parsedUnits != null && Math.abs(parsedUnits - savedUnits) > 0.0001;
      ref.allowAvg = changed;
      if (changed) {
        if (!ref.avgBanner) {
          ref.avgMsg = el('div', { class: 'ocr-avg-msg' });
          ref.avgBanner = el('div', { class: 'ocr-avg-banner' }, [ref.avgMsg, avgI]);
          row.appendChild(ref.avgBanner);
        }
        ref.avgMsg.textContent =
          'Units changed (' + savedUnits + ' → ' + parsedUnits + ') - set new average buy price:';
        ref.avgBanner.style.display = '';
      } else if (ref.avgBanner) {
        ref.avgBanner.style.display = 'none';
      }
    };
    checkAvgVisibility();

    sel.addEventListener('change', async () => {
      if (!sel.value) {
        ref.match = null;
        cb.checked = false; cb.disabled = true;
        row.classList.add('no-match');
        // Remember "Skip" too - next time, the parser won't keep auto-mapping
        // a parsed name the user has explicitly rejected.
        await _saveOcrAlias(state.portfolio, m.name, null).catch(() => {});
      } else if (sel.value === '__new__') {
        // Sentinel: create a brand-new stock at Apply time. No alias saved
        // (the future stock has no id yet); next OCR will fuzzy-match the
        // newly-created stock by name and offer it in the dropdown normally.
        ref.match = { addNew: true, name: m.name };
        cb.disabled = false; cb.checked = true;
        row.classList.remove('no-match');
      } else {
        const stock = state.stocks.find((x) => x.id === sel.value);
        if (!stock) return;
        ref.match = { stock, score: 1 };
        cb.disabled = false; cb.checked = true;
        row.classList.remove('no-match');
        await _saveOcrAlias(state.portfolio, m.name, stock.id).catch(() => {});
      }
      flagBigJump();
      checkAvgVisibility();
    });
    ltpI.addEventListener('input', flagBigJump);
    unitsI.addEventListener('input', checkAvgVisibility);
    return ref;
  });

  const apply = async () => {
    let updated = 0, added = 0;
    for (const r of refs) {
      if (!r.cb.checked || !r.match) continue;
      const nU = num(r.unitsI.value), nA = num(r.avgI.value), nL = num(r.ltpI.value);

      // "+ Add as new" path - create the stock from the parsed row. Category
      // is left blank; the user can edit it from the stock card afterwards.
      // For wife-in (no Avg in Groww view), buyPrice is left null too.
      if (r.match.addNew) {
        const now = new Date().toISOString();
        const fresh = {
          portfolio: state.portfolio,
          name: r.match.name,
          category: '',
          conviction: '',
          status: 'holding',
          units: nU,
          buyPrice: r.allowAvg && nA != null ? nA : null,
          currentPrice: nL,
          soldPrice: null, soldUnits: null, soldDate: null,
          notes: '',
          history: [],
          createdAt: now, updatedAt: now,
        };
        if (fresh.buyPrice && fresh.currentPrice) {
          const pct = Math.round(((fresh.currentPrice - fresh.buyPrice) / fresh.buyPrice) * 10000) / 100;
          fresh.history.push({ month: monthLabel, pct });
        }
        await DB.put('stocks', fresh);
        added++;
        continue;
      }

      const fresh = await DB.get('stocks', r.match.stock.id);
      if (!fresh) continue;
      // Only overwrite a field if the screenshot provided a value (so brokers
      // that don't show Avg in the holdings view don't wipe what's already saved).
      // r.allowAvg gates the buyPrice write: always true for me-in/me-us; for
      // wife-in (Groww) it's true only when parsed units differ from the saved
      // units (a buy/sell happened) - the inline avg banner in the review
      // exposes the avg input only in that case.
      if (nU != null) fresh.units = nU;
      if (r.allowAvg && nA != null) fresh.buyPrice = nA;
      if (nL != null) fresh.currentPrice = nL;
      if (fresh.buyPrice && fresh.currentPrice) {
        const pct = Math.round(((fresh.currentPrice - fresh.buyPrice) / fresh.buyPrice) * 10000) / 100;
        const hist = (fresh.history || []).filter((h) => h.month !== monthLabel);
        hist.push({ month: monthLabel, pct });
        hist.sort((a, c) => (labelToYm(a.month) || '').localeCompare(labelToYm(c.month) || ''));
        fresh.history = hist;
      }
      fresh.updatedAt = new Date().toISOString();
      await DB.put('stocks', fresh);
      updated++;
    }
    closeModal();
    if (!updated && !added) { toast('Nothing applied'); return; }
    await refresh(); // reloads state.stocks
    // capture the current month's portfolio totals from the freshly updated holdings
    const s = summarize(state.stocks);
    const existing = state.months.find((x) => x.ym === ym);
    const rec = {
      key: monthKey(state.portfolio, ym),
      portfolio: state.portfolio, ym,
      invested: s.hasVal ? s.invested : null,
      value: s.hasVal ? s.value : null,
      profitLoss: s.hasVal ? s.pl : null,
      returnPct: s.hasVal ? Math.round(s.plPct * 100) / 100 : null,
      countProfit: s.up, countLoss: s.down,
      nifty: existing ? existing.nifty : null,
      source: 'ocr',
      updatedAt: new Date().toISOString(),
    };
    await syncNifty(rec);
    await DB.put('monthly', rec);
    const parts = [];
    if (updated) parts.push('Updated ' + updated);
    if (added) parts.push('Added ' + added);
    toast(parts.join(' · ') + ' · ' + monthLabel + ' captured');
    refresh();
  };

  // ---- Live "what the portfolio will look like after Apply" preview ----
  // Replaces the old wall of instructions. The point is a single number the
  // user can eyeball against the total their broker app shows: if the overall
  // return % lines up, every parsed row is almost certainly right.
  //
  // It spans the WHOLE portfolio, not just the uploaded rows - the rows being
  // updated contribute their NEW values and every stock left out of this
  // upload contributes its saved values, which is what makes the total
  // comparable to the broker's. Mirrors apply()'s field-by-field rules exactly
  // (blank input keeps the saved value; buyPrice only when allowAvg) so the
  // preview can't promise something Apply won't do.
  const previewHost = el('div', { class: 'summary ocr-preview' });
  const cur = curOfAny(state.portfolio);
  const projectStocks = () => {
    const replaced = new Map();
    const added = [];
    for (const r of refs) {
      if (!r.cb.checked || !r.match) continue;
      const nU = num(r.unitsI.value), nA = num(r.avgI.value), nL = num(r.ltpI.value);
      if (r.match.addNew) {
        added.push({
          status: 'holding', units: nU,
          buyPrice: r.allowAvg && nA != null ? nA : null,
          currentPrice: nL, history: [],
        });
        continue;
      }
      const proj = Object.assign({}, r.match.stock);
      if (nU != null) proj.units = nU;
      if (r.allowAvg && nA != null) proj.buyPrice = nA;
      if (nL != null) proj.currentPrice = nL;
      replaced.set(r.match.stock.id, proj);
    }
    const list = state.stocks.map((s) => replaced.get(s.id) || s).concat(added);
    return { list, touched: replaced.size + added.length };
  };

  const renderPreview = () => {
    const { list, touched } = projectStocks();
    const after = summarize(list);
    const before = summarize(state.stocks);
    const untouched = Math.max(0, after.holdings - touched);
    previewHost.innerHTML = '';
    previewHost.appendChild(el('div', { class: 'row-between' }, [
      el('span', { class: 'label', text: 'After apply · whole portfolio' }),
      after.hasVal
        ? el('span', { class: 'badge ' + (after.pl >= 0 ? 'good' : 'bad'), text: fmtPct(after.plPct) })
        : el('span', { class: 'badge muted', text: 'no prices yet' }),
    ]));
    previewHost.appendChild(el('div', { class: 'big', text: after.hasVal ? fmtCur(after.value, cur) : '-' }));
    const grid = el('div', { class: 'grid' });
    const deltaPct = after.hasVal && before.hasVal ? after.plPct - before.plPct : null;
    [
      ['Invested', after.hasVal ? fmtCur(after.invested, cur) : '-', ''],
      ['Profit / Loss', after.hasVal ? (after.pl >= 0 ? '+' : '') + fmtCur(after.pl, cur) : '-', after.hasVal ? pctClass(after.pl) : ''],
      ['From this upload', touched + ' of ' + rows.length, ''],
      ['Not in upload', String(untouched), ''],
      ['Was', before.hasVal ? fmtPct(before.plPct) : '-', ''],
      ['Change', deltaPct != null ? fmtPct(deltaPct) : '-', deltaPct != null ? pctClass(deltaPct) : ''],
    ].forEach(([k, v, cls]) => grid.appendChild(el('div', { class: 'cell' }, [
      el('div', { class: 'k', text: k }), el('div', { class: 'v ' + (cls || ''), text: v }),
    ])));
    previewHost.appendChild(grid);
  };

  // Recompute on every edit. These listeners are registered after the per-row
  // ones above, so ref.match / ref.allowAvg are already updated when they fire.
  // The dropdown's own handler finishes asynchronously (it awaits the alias
  // save before re-running checkAvgVisibility), so that one also re-renders on
  // a short delay to pick up the settled allowAvg.
  refs.forEach((r) => {
    [r.unitsI, r.avgI, r.ltpI].forEach((inp) => inp && inp.addEventListener('input', renderPreview));
    r.cb.addEventListener('change', renderPreview);
    const sel = r.row.querySelector('.ocr-match-sel');
    if (sel) sel.addEventListener('change', () => { renderPreview(); setTimeout(renderPreview, 80); });
  });
  renderPreview();

  openModal(el('div', { class: 'sheet ocr-sheet' }, [
    el('h2', { text: 'Update from screenshot' }),
    previewHost,
    head,
    el('div', { class: 'ocr-list' }, refs.map((r) => r.row)),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
      // Escape hatch for a mis-parse: the broker app's layout changes now and
      // then, and seeing what Tesseract actually read is the only way to retune
      // the parser. Available even when rows WERE found, since a wrong name or
      // a missing price is exactly the case worth reporting.
      el('button', {
        class: 'btn ghost', text: 'Raw text',
        onclick: () => openOcrDebug(rawText, 'Raw OCR text',
          'This is exactly what Tesseract read from your screenshot(s). If the rows above came out wrong, copy this and share it so the parser can be fixed.'),
      }),
      el('button', { class: 'btn primary', text: 'Apply', onclick: apply }),
    ]),
  ]));
}

