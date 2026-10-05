import { thisYm } from './core.js';
import { fmtIntCur } from './personal-ui.js';
import { DB } from './db.js';
import { el, b, state, $, closeModal, openModal, expRenderStale, perDayLabel } from './app.js';
import { _reviewKittyFit, DAY_DETAIL_FROM_YM, dayDetailOk, _reviewSmallTickets, _reviewCreeping, _reviewMethods, _kittyFor, _reviewIgnores, REVIEW_MIN_HISTORY, _median, REVIEW_FORECAST_MIN, _reviewForecast, _reviewCycle, _reviewCurve, _catMonthHistory, _smallTicketUsual, rvwKeepList, _reviewSavings, _reviewAnalysis } from './expense-review-logic.js';
import { round2, fmtSheetCur, isRefund, _spendGroupClass, _spendMonthLabel } from './expense-ui.js';

// ---------- Review tab: presentation helpers ----------
//
// The tab reports nine things about a month, which read as a wall when they are
// all open at once. So each is a section that remembers whether it is open, and
// a CLOSED one still carries its headline figure in the header - the point being
// that a collapsed section should answer its own question in one glance and only
// be opened for the working behind it.
//
// Open state is per section id and survives a re-render (switching month, or
// logging a spend), so the tab stays arranged the way it was left.
const _rvwOpen = Object.create(null);
// Every section starts closed (the owner's call): each one's heading already carries its one-line answer, and
// the Household / Personal tabs read as a short list of headings until one is tapped open.
const RVW_DEFAULT_OPEN = {};

// ---------- Explanations, behind an i ----------
//
// A note that says HOW something is worked out is read once and then costs
// space on every visit afterwards. A note that carries a FIGURE is the content
// and stays where it is. So the first kind moves behind an i: one short line
// instead of a paragraph, and the prose is still a tap away for the visit where
// it is actually wanted.
export function openInfoSheet(title, text) {
  const paras = (Array.isArray(text) ? text : [text]).filter(Boolean);
  openModal(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet-scroll' }, [el('h2', { text: title })]
      .concat(paras.map((t) => el('p', { class: 'info-para', text: t })))
      .concat([el('button', { class: 'btn ghost info-close', text: 'Close', onclick: closeModal })])),
  ]));
}

// The one-line affordance that replaces a paragraph.
export function explainRow(title, text, label) {
  return el('button', {
    class: 'explain-row', type: 'button', 'aria-label': title,
    onclick: (e) => { e.stopPropagation(); openInfoSheet(title, text); },
  }, [
    el('span', { class: 'explain-i', text: 'i' }),
    el('span', { text: label || 'How this is worked out' }),
  ]);
}

export function rvwSection(host, id, icon, title, summary, build) {
  const open = _rvwOpen[id] == null ? !!RVW_DEFAULT_OPEN[id] : !!_rvwOpen[id];
  const body = el('div', { class: 'rvw-sec-body' + (open ? '' : ' hidden') });
  const head = el('button', { class: 'rvw-sec-head' + (open ? ' is-open' : ''), type: 'button' }, [
    el('span', { class: 'rvw-sec-ico', text: icon }),
    el('span', { class: 'rvw-sec-title', text: title }),
    summary == null ? document.createTextNode('')
      : (typeof summary === 'string' ? el('span', { class: 'rvw-sec-sum', text: summary }) : summary),
    el('span', { class: 'rvw-sec-chev' }),
  ]);
  head.addEventListener('click', () => {
    const closed = body.classList.toggle('hidden');
    _rvwOpen[id] = !closed;
    head.classList.toggle('is-open', !closed);
  });
  host.appendChild(el('section', { class: 'rvw-sec' }, [head, body]));
  build(body);
}

// Cumulative spend for the month: a usual month, this month so far, and the
// forecast carrying on from where this month has got to. Three lines that
// answer "am I ahead or behind, and where does this end" without arithmetic.
//
// No stretched text: the viewBox scales uniformly and the labels ride inside
// it, so a wide screen enlarges the chart rather than distorting the type.
export function _rvwCurveChart(curve, o) {
  const ns = 'http://www.w3.org/2000/svg';
  const w = 320, h = 132, padL = 4, padR = 4, padT = 12, padB = 18;
  const mk = (t, attrs) => {
    const n = document.createElementNS(ns, t);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const dim = curve.length;
  const peak = Math.max(
    o.kitty || 0, o.forecast || 0,
    curve.reduce((m, pt) => Math.max(m, pt.usual || 0, pt.now || 0), 0), 1);
  const maxY = peak * 1.08;
  const X = (d) => padL + ((d - 1) / Math.max(1, dim - 1)) * (w - padL - padR);
  const Y = (v) => h - padB - (Math.max(0, v) / maxY) * (h - padT - padB);
  const svg = mk('svg', { viewBox: '0 0 ' + w + ' ' + h, style: 'width:100%;height:auto;display:block' });

  // Baseline and day ticks. Four labels only - the shape is the message, and a
  // tick every day would be noise at this size.
  svg.appendChild(mk('line', { x1: padL, y1: Y(0), x2: w - padR, y2: Y(0), stroke: '#334155', 'stroke-width': '1' }));
  [1, Math.round(dim / 3), Math.round((dim / 3) * 2), dim].forEach((d) => {
    const t = mk('text', { x: X(d), y: h - 5, fill: '#7c8db5', 'font-size': '9', 'text-anchor': d === 1 ? 'start' : d === dim ? 'end' : 'middle' });
    t.textContent = String(d);
    svg.appendChild(t);
  });

  // The kitty, as the line the month is trying to stay under.
  if (o.kitty > 0 && o.kitty <= maxY) {
    svg.appendChild(mk('line', { x1: padL, y1: Y(o.kitty), x2: w - padR, y2: Y(o.kitty), stroke: '#34d399', 'stroke-width': '1.2', 'stroke-dasharray': '5 4', opacity: '0.85' }));
    const t = mk('text', { x: w - padR, y: Y(o.kitty) - 4, fill: '#34d399', 'font-size': '9', 'text-anchor': 'end' });
    t.textContent = o.limitLabel || 'household budget';
    svg.appendChild(t);
  }

  // A usual month.
  svg.appendChild(mk('polyline', {
    points: curve.map((pt) => X(pt.day).toFixed(1) + ',' + Y(pt.usual).toFixed(1)).join(' '),
    fill: 'none', stroke: '#7c8db5', 'stroke-width': '1.8', 'stroke-linejoin': 'round',
  }));

  // This month, up to today.
  const done = curve.filter((pt) => pt.now != null);
  if (done.length) {
    svg.appendChild(mk('polyline', {
      points: done.map((pt) => X(pt.day).toFixed(1) + ',' + Y(pt.now).toFixed(1)).join(' '),
      fill: 'none', stroke: '#38bdf8', 'stroke-width': '2.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
    const last = done[done.length - 1];
    // The projection, dashed because it is the only estimated part of the
    // picture and should not be mistaken for what has happened.
    if (o.forecast != null && last.day < dim) {
      svg.appendChild(mk('line', {
        x1: X(last.day), y1: Y(last.now), x2: X(dim), y2: Y(o.forecast),
        stroke: '#38bdf8', 'stroke-width': '2', 'stroke-dasharray': '4 4', opacity: '0.85',
      }));
      svg.appendChild(mk('circle', { cx: X(dim), cy: Y(o.forecast), r: '3', fill: '#0b1220', stroke: '#38bdf8', 'stroke-width': '1.8' }));
    }
    svg.appendChild(mk('circle', { cx: X(last.day), cy: Y(last.now), r: '3.4', fill: '#38bdf8' }));
  }
  return svg;
}

// A category's recent months as bars, with its median marked. Revealed when a
// row is tapped: the claim is "usually X a month", and this is the evidence for
// it in a form that can be checked at a glance.
export function _rvwMonthBars(rows, usual) {
  const peak = Math.max(usual || 0, rows.reduce((m, r) => Math.max(m, r.amount), 0), 1);
  const wrap = el('div', { class: 'rvw-bars' });
  rows.forEach((r) => {
    wrap.appendChild(el('div', { class: 'rvw-bar-cell' + (r.current ? ' is-now' : '') }, [
      el('span', { class: 'rvw-bar-amt', text: r.amount > 0 ? fmtIntCur(r.amount) : '\u2014' }),
      el('span', { class: 'rvw-bar-track' }, [
        el('span', { class: 'rvw-bar-fill', style: 'height:' + Math.max(2, (r.amount / peak) * 100).toFixed(1) + '%' }),
      ]),
      el('span', { class: 'rvw-bar-mon', text: _spendMonthLabel(r.ym).split(' ')[0] }),
    ]));
  });
  const out = el('div', { class: 'rvw-bars-wrap' }, [wrap]);
  if (usual > 0) {
    out.appendChild(el('div', { class: 'rvw-bars-foot', text: 'median ' + fmtIntCur(usual) + ' a month' }));
  }
  return out;
}

export async function renderReview(host, token) {
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  const [allocs, allSpends, efLoans] = await Promise.all([
    DB.all('allocations').catch(() => []),
    DB.all('spends').catch(() => []),
    DB.byIndex('emergency', 'kind', 'loan').catch(() => []),
  ]);
  if (expRenderStale(token)) return;

  const byYm = new Map();
  (allSpends || []).forEach((r) => {
    const k = String(r.ym || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) return;
    // Analysis reads SPENDING only: a refund is left out of every figure here (the owner's call), so the
    // month, its forecast and its categories are never a mix of money out and money back.
    if (isRefund(r)) return;
    if (!byYm.has(k)) byYm.set(k, []);
    byYm.get(k).push(r);
  });

  // THIS MONTH, always. There is no month strip here on purpose.
  //
  // Everything this tab does is about a month that can still be changed:
  // forecasting where it lands, naming what has already gone wrong in it,
  // pointing at what to stop doing for the rest of it. Run against a closed
  // month all of that becomes a post-mortem - a forecast of a month that has
  // already happened, advice for days that are gone - and the useful reading
  // gets buried under months nobody can act on.
  //
  // History has not gone anywhere: it is what every comparison here is made
  // AGAINST. It is just no longer something to browse.
  const ym = thisYm;

  // House Exp is per YEAR, so a window spanning a year boundary has more than
  // one kitty in it. Looked up by month rather than assumed constant.
  const kittyOf = (k) => _kittyFor(k, allocs, efLoans);
  const kitty = kittyOf(ym);
  const a = _reviewAnalysis(ym, byYm, thisYm, kitty, now);

  _rvwScopeLine(host, mod, ym, a, byYm);

  if (!a.spent) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🔍' }),
      el('p', { text: 'Nothing logged this month yet.' }),
      el('p', { class: 'hint', text: 'This tab reads the Tracker and only ever looks at the month you are in — '
        + 'log some spends and it will forecast where the month lands and tell you which of them are unusual for you.' }),
    ]));
    return;
  }

  // ---- Headline ----
  const overKitty = a.overKitty;
  const headBits = [
    el('div', { class: 'rvw-head-fig' + (overKitty > 0 ? ' is-over' : '') },
      [fmtSheetCur(a.spent) + (a.kitty > 0 ? ' of ' + fmtSheetCur(a.kitty) : '')]),
  ];
  // Over or left, as a badge: red gradient when over the budget, green when some is still left.
  // No straight-line pace figure here any more. Dividing by days elapsed and
  // multiplying by days in the month ignores that rent lands on the 5th, which
  // makes it wildly high early in a month and low late in one. The forecast
  // card below replaces it with an estimate built only from the remainder.
  const daysNote = a.isCurrent ? perDayLabel(a.daysLeft + 1) : null;
  if (a.kitty > 0 || daysNote) headBits.push(rvwBudgetRow(a.kitty > 0 ? rvwBudgetBadge(overKitty, 'household kitty') : null, daysNote));
  host.appendChild(el('div', { class: 'rvw-head' }, headBits));

  // ---- Not enough history to judge anything ----
  if (a.historyMonths < REVIEW_MIN_HISTORY) {
    host.appendChild(el('div', { class: 'rvw-thin' }, [
      el('div', { class: 'rvw-thin-head', text: 'Not enough history yet' }),
      el('div', { class: 'rvw-thin-sub', text: 'There ' + (a.historyMonths === 1 ? 'is 1 earlier month' : 'are ' + a.historyMonths + ' earlier months')
        + ' on record. Comparing a category against its own normal needs at least ' + REVIEW_MIN_HISTORY
        + ', so this tab holds off rather than calling something unusual on one data point.' }),
    ]));
    return;
  }

  // Everything computed first, so a section header can carry its own headline
  // figure while closed - the summary has to exist before the section is built.
  const due = a.isCurrent ? _recurringDue(ym, byYm) : [];
  const dueTotal = round2(due.reduce((sum, r) => sum + r.amount, 0));
  const small = _reviewSmallTickets(ym, byYm);
  const cycle = _reviewCycle(ym, byYm, now, a.isCurrent);
  const forecast = a.isCurrent ? _reviewForecast(ym, byYm, now, dueTotal, kitty) : null;
  const savings = _reviewSavings(a, cycle, small, _smallTicketUsual(ym, byYm));
  const creeping = _reviewCreeping(ym, byYm);
  const prevD = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
  const prevYm = prevD.getFullYear() + '-' + String(prevD.getMonth() + 1).padStart(2, '0');
  const methods = _reviewMethods(ym, byYm, prevYm);
  const fit = _reviewKittyFit(ym, byYm, kittyOf, thisYm);

  // ---- Where this month lands ----
  if (forecast) {
    const f = forecast;
    const grade = el('span', { class: 'rvw-grade is-' + f.grade,
      text: f.errPct != null ? f.grade + ' · ' + '\u00b1' + f.errPct + '%' : f.grade });
    rvwSection(host, 'forecast', '\ud83d\udd2e', 'Where this month lands', grade, (body) => {
      const curve = _reviewCurve(ym, byYm, f.day);
      body.appendChild(el('div', { class: 'rvw-fc' }, [
        el('div', { class: 'rvw-fc-top' }, [
          el('div', {}, [
            el('div', { class: 'rvw-fc-big' + (f.overKitty > 0 ? ' is-over' : ''), text: fmtSheetCur(f.forecast) }),
            el('div', { class: 'rvw-fc-lbl', text: 'forecast for ' + mod.monthLabel(ym) }),
          ]),
          el('div', { class: 'rvw-fc-range' }, [
            el('div', { class: 'rvw-fc-range-lbl', text: 'likely between' }),
            el('div', { class: 'rvw-fc-range-val', text: fmtSheetCur(f.lo) + ' – ' + fmtSheetCur(f.hi) }),
          ]),
        ]),
        // The month as a picture: where it has got to, where a usual month
        // would be by now, and where this one is heading.
        curve ? el('div', { class: 'rvw-chart' }, [_rvwCurveChart(curve, { kitty, forecast: f.forecast })]) : document.createTextNode(''),
        el('div', { class: 'rvw-fc-split' }, [
          el('span', {}, [el('i', { class: 'rvw-dot is-spent' }), fmtSheetCur(f.spent) + ' spent']),
          el('span', {}, [el('i', { class: 'rvw-dot is-proj' }), fmtSheetCur(f.rest) + ' to come']),
          el('span', {}, [el('i', { class: 'rvw-dot is-usual' }), 'a usual month']),
        ]),
      ]));

      // The lines that actually decide today, in the order they get acted on:
      // what the rest of the month usually costs, what is affordable if the
      // kitty is to hold, and where this month sits against a usual one.
      const lines = [];
      if (f.restPerDay != null) {
        lines.push(['-', 'The rest of your month usually costs ' + fmtIntCur(f.restPerDay)
          + ' a day · the ' + f.daysLeft + (f.daysLeft === 1 ? ' day' : ' days') + ' after today']);
      }
      if (f.fitPerDay != null) {
        lines.push(f.fitPerDay > 0
          ? ['OK', fmtIntCur(f.fitPerDay) + ' a day for the ' + perDayLabel(f.fitDays)
              + ', to stay inside the ' + fmtSheetCur(kitty) + ' household budget']
          : ['NO', 'The household budget is already spent · anything from here is over it']);
      }
      if (f.overKitty != null && f.overKitty > 0) {
        lines.push(['NO', 'On this estimate the month ends ' + fmtSheetCur(f.overKitty) + ' over the household budget']);
      } else if (f.overKitty != null) {
        lines.push(['OK', 'On this estimate the month ends ' + fmtSheetCur(-f.overKitty) + ' inside the household budget']);
      }
      if (f.usualByNow > 0) {
        lines.push([f.vsUsualByNow > 0 ? 'UP' : 'DOWN', 'By the ' + f.day + _ordinalSuffix(f.day)
          + ' a usual month is at ' + fmtIntCur(f.usualByNow) + ' · you are '
          + fmtIntCur(Math.abs(f.vsUsualByNow)) + (f.vsUsualByNow > 0 ? ' above that' : ' below that')]);
      }
      if (f.restIsDueFloor && f.due > 0) {
        lines.push(['-', 'Held up to ' + fmtSheetCur(f.due) + ' by items still expected below, which is more than a usual remainder']);
      }
      body.appendChild(el('div', { class: 'rvw-lines' }, lines.map(([kind, text]) => el('div', {
        class: 'rvw-line is-' + kind.toLowerCase(),
      }, [
        el('span', { class: 'rvw-line-mark', text: kind === 'OK' ? '\u2713' : kind === 'NO' ? '!' : kind === 'UP' ? '\u2191' : kind === 'DOWN' ? '\u2193' : '\u2022' }),
        el('span', { text }),
      ]))));

      body.appendChild(explainRow('How the forecast works', f.errPct != null
        ? 'Only the REMAINDER is estimated · what is already spent is counted, and the days still to come are priced from what the same days cost in your last '
          + f.months + ' months. Run against those months at the same point in the month, this came out a median '
          + f.errPct + '% away from what they actually cost.'
        : 'Only the REMAINDER is estimated · what is already spent is counted, and the days still to come are priced from what the same days cost in your last '
          + f.months + ' months. Too few months to have tested it against yet, so treat it as a rough shape.', 'About this estimate'));
    });
  }

  // ---- Where you could keep money ----
  if (savings.rows.length) {
    const top = savings.rows[0];
    rvwSection(host, 'savings', '\ud83d\udca1', 'Where you could keep money',
      savings.rows.length + (savings.rows.length === 1 ? ' place' : ' places'), (body) => {
        body.appendChild(rvwKeepList(savings.rows, { scope: 'house', rowsFor: () => byYm.get(ym) || [], groupClass: (g) => _spendGroupClass(g) }));
        body.appendChild(explainRow('Why these overlap', 'These overlap on purpose and are not added up — the same '
          + 'spend can be a small one, a weekend one and an over-median one at once. Three ways of seeing one leak is useful; '
          + 'counting it three times is not. The one figure that IS a total is under Worth a look, where the evidence for it sits.', 'Why these are not added up'));
      });
    void top;
  }

  // ---- Worth a look ----
  // Rows open on tap to show the category's own recent months, so "usually
  // 4,480 a month" can be checked rather than taken on trust.
  rvwSection(host, 'look', '\u26a0\ufe0f', 'Worth a look',
    a.actionable.length ? fmtSheetCur(a.recoverable) : 'nothing unusual', (body) => {
      if (!a.actionable.length) {
        body.appendChild(el('div', { class: 'rvw-clear' }, [
          el('span', { text: '\u2705' }),
          el('div', {}, [
            el('div', { class: 'rvw-clear-head', text: 'Nothing unusual this month' }),
            el('div', { class: 'rvw-clear-sub', text: 'Every category you can act on is at or below its own normal.' }),
          ]),
        ]));
        return;
      }
      const wrap = el('div', { class: 'rvw-list' });
      a.actionable.forEach((r) => {
        const bits = [r.count + '\u00d7 this month'];
        if (r.usualCount) bits.push('usually ' + r.usualCount + '\u00d7');
        if (r.driver) bits.push(r.driver);
        const detail = el('div', { class: 'rvw-item-detail hidden' });
        let built = false;
        const item = el('div', { class: 'rvw-item is-tappable ' + _spendGroupClass(r.group) }, [
          el('div', { class: 'rvw-item-top' }, [
            el('span', { class: 'rvw-item-name' }, [el('span', { class: 'rvw-item-dot' }), el('span', { text: r.name })]),
            el('span', { class: 'rvw-item-amt', text: fmtSheetCur(r.now) }),
          ]),
          el('div', { class: 'rvw-item-mid', text: 'Usually ' + fmtSheetCur(r.usual) + ' a month · ' + bits.join(' · ') }),
          el('div', { class: 'rvw-item-save' }, [
            el('span', { class: 'rvw-save-amt', text: fmtSheetCur(r.over) }),
            el('span', { class: 'rvw-save-txt', text: 'above a normal month — that much back if it returns to usual' }),
          ]),
          detail,
        ]);
        item.addEventListener('click', () => {
          // Built on first open only: six months of bars per category adds up
          // on a month with a dozen findings.
          if (!built) { detail.appendChild(_rvwMonthBars(_catMonthHistory(r.name, ym, byYm, 6), r.usual)); built = true; }
          const closed = detail.classList.toggle('hidden');
          item.classList.toggle('is-open', !closed);
        });
        wrap.appendChild(item);
      });
      body.appendChild(wrap);
      body.appendChild(el('div', { class: 'rvw-total' }, [
        el('span', { class: 'rvw-total-label', text: 'Recoverable this month' }),
        el('span', { class: 'rvw-total-val', text: fmtSheetCur(a.recoverable) }),
      ]));
      body.appendChild(el('p', { class: 'hint rvw-note', text: 'Tap a row for that category\u2019s last six months.' }));
    });

  _rvwCreepingSection(host, creeping, _spendGroupClass);

  // ---- Small spends ----
  if (small) {
    rvwSection(host, 'small', '\ud83e\ude99', 'Small spends add up', fmtSheetCur(small.total), (body) => {
      body.appendChild(el('div', { class: 'rvw-panel' }, [
        el('div', { class: 'rvw-panel-top' }, [
          el('span', { class: 'rvw-panel-fig', text: fmtSheetCur(small.total) }),
          el('span', { class: 'rvw-panel-sub', text: small.count + ' entries under ' + fmtSheetCur(small.threshold) }),
        ]),
        el('div', { class: 'rvw-item-mid', text: small.entryShare + '% of this month\u2019s entries · '
          + small.valueShare + '% of what was spent' }),
        el('div', { class: 'rvw-mini' }, small.top.map((t) => el('div', { class: 'rvw-mini-row' }, [
          el('span', { text: t.name }),
          el('span', { class: 'rvw-mini-meta', text: t.count + '\u00d7 · ' + fmtSheetCur(t.total) }),
        ]))),
      ]));
    });
  }

  // ---- Your spending cycle ----
  if (cycle) {
    rvwSection(host, 'cycle', '\ud83d\udd01', 'Your spending cycle',
      cycle.halfBy ? 'half gone by the ' + cycle.halfBy + _ordinalSuffix(cycle.halfBy) : null, (body) => {
        const THIRDS = [['Early', '1–10'], ['Middle', '11–20'], ['Late', '21–' + cycle.dim]];
        // Tap a third to see what makes it heavy. The shape of a month is only
        // actionable once you know which bills are sitting in that hump.
        const breakdown = el('div', { class: 'rvw-cyc-detail hidden' });
        let openThird = -1;
        const segs = cycle.thirds.map((pct, i) => {
          const seg = el('button', {
            type: 'button', class: 'rvw-cyc-seg is-t' + i, style: 'width:' + pct + '%',
            text: pct >= 12 ? pct + '%' : '',
            title: THIRDS[i][0] + ' ' + THIRDS[i][1],
          });
          seg.addEventListener('click', () => {
            if (openThird === i) { breakdown.classList.add('hidden'); openThird = -1; return; }
            openThird = i;
            breakdown.innerHTML = '';
            breakdown.classList.remove('hidden');
            breakdown.appendChild(el('div', { class: 'rvw-cyc-detail-head',
              text: THIRDS[i][0] + ' · day ' + THIRDS[i][1] + ' · ' + pct + '% of a usual month' }));
            const tops = (cycle.thirdTops[i] || []);
            if (!tops.length) {
              breakdown.appendChild(el('div', { class: 'rvw-mini-row' }, [el('span', { text: 'Nothing regular in these days.' })]));
              return;
            }
            tops.forEach((t) => breakdown.appendChild(el('div', { class: 'rvw-mini-row' }, [
              el('span', { text: t.name }),
              el('span', { class: 'rvw-mini-meta', text: fmtIntCur(t.amount) + ' a month' }),
            ])));
          });
          return seg;
        });
        body.appendChild(el('div', { class: 'rvw-cyc' }, [
          el('div', { class: 'rvw-cyc-bar' }, segs),
          el('div', { class: 'rvw-cyc-legend' }, THIRDS.map(([name, range], i) => el('span', { class: 'rvw-cyc-key' }, [
            el('i', { class: 'rvw-dot is-t' + i }),
            el('span', { class: 'rvw-cyc-key-name', text: name }),
            el('span', { class: 'rvw-cyc-key-range', text: range }),
          ]))),
          breakdown,
          el('div', { class: 'rvw-cyc-tap', text: 'Tap a band to see what sits in it' }),
        ]));

        // The week, as seven bars. A table of averages says the same thing but
        // needs reading; the tall bar is the answer.
        if (cycle.perDow && cycle.perDow.some((d) => d.perDay > 0)) {
          const peak = cycle.perDow.reduce((m, d) => Math.max(m, d.perDay), 1);
          body.appendChild(el('div', { class: 'rvw-dow' }, cycle.perDow.map((d) => el('div', {
            class: 'rvw-dow-cell' + (d.i === 0 || d.i === 6 ? ' is-weekend' : ''),
          }, [
            el('span', { class: 'rvw-dow-amt', text: d.perDay > 0 ? fmtIntCur(d.perDay) : '\u2014' }),
            el('span', { class: 'rvw-dow-track' }, [
              el('span', { class: 'rvw-dow-fill', style: 'height:' + Math.max(2, (d.perDay / peak) * 100).toFixed(1) + '%' }),
            ]),
            el('span', { class: 'rvw-dow-lbl', text: d.name.slice(0, 3) }),
          ]))));
        }

        const cycRows = [];
        if (cycle.halfBy) cycRows.push(['Half a month is gone by', 'the ' + cycle.halfBy + _ordinalSuffix(cycle.halfBy)]);
        if (cycle.weekendPerDay > 0) cycRows.push(['Weekend vs weekday, per day',
          fmtIntCur(cycle.weekendPerDay) + ' vs ' + fmtIntCur(cycle.weekdayPerDay)]);
        if (cycle.weekendShare != null) cycRows.push(['Lands on a Saturday or Sunday', cycle.weekendShare + '% of a month']);
        cycRows.push(['Days with nothing spent', a.isCurrent
          ? cycle.noSpendSoFar + ' of the first ' + cycle.daysSoFar + ' · usually ' + cycle.noSpendTypical + ' in a month'
          : 'usually ' + cycle.noSpendTypical + ' in a month']);
        body.appendChild(el('div', { class: 'rvw-flat' }, cycRows.map(([k, v]) =>
          el('div', { class: 'rvw-flat-row' }, [el('span', { text: k }), el('span', { class: 'rvw-flat-meta', text: v })]))));
        body.appendChild(explainRow('Your spending cycle', 'From your last ' + cycle.months
          + ' months. This is the WHEN behind the total — the half of a spending habit that a monthly figure hides, '
          + 'and the reason a forecast on the 6th and one on the 26th cannot use the same arithmetic.', 'How this is measured'));
      });
  }

  // ---- Still expected this month ----
  if (a.isCurrent && due.length) {
    rvwSection(host, 'due', '\ud83d\udcc5', 'Still expected this month', '~' + fmtIntCur(dueTotal), (body) => {
      body.appendChild(el('div', { class: 'rvw-due' }, due.map((r) => el('div', { class: 'rvw-due-row' }, [
        el('div', { class: 'rvw-due-when' }, [
          el('span', { class: 'rvw-due-day', text: r.day ? String(r.day) : '?' }),
          el('span', { class: 'rvw-due-daylbl', text: r.day ? _ordinalSuffix(r.day) : 'any' }),
        ]),
        el('div', { class: 'rvw-due-body' }, [
          el('div', { class: 'rvw-due-name', text: r.name }),
          el('div', { class: 'rvw-due-meta', text: r.months + ' of the last ' + r.window + ' months'
            + (r.day ? '' : ' · no settled date') + (r.fixed ? ' · fixed' : '') }),
        ]),
        el('span', { class: 'rvw-due-amt', text: '~' + fmtIntCur(r.amount) }),
      ]))));
      // No running total here. It would only ever count items that RECUR, so it
      // sat below the forecast by everything ordinary a month also costs, and
      // two forward totals that disagree are worse than one.
      body.appendChild(explainRow('What is still to land', 'Items that have landed in most recent months and have not yet this one. '
        + 'A description of what keeps happening, not a promise about this month.', 'How these are picked'));
    });
  }

  _rvwMethodsSection(host, methods, ' It is also what feeds this month\u2019s card reimbursement.');
  _rvwFitSection(host, fit, {
    word: 'household budget',
    // The kitty is House Exp DOUBLED, so a suggested figure is only actionable
    // once it is halved back into the line actually typed on Allocation.
    each: (f) => ' — that is ' + fmtSheetCur(round2(f.suggested / 2)) + ' each on House Exp',
  });

  // ---- Context: what wasn't judged, and what can't be ----
  if (a.unjudged.length) {
    rvwSection(host, 'new', '\ud83d\udd53', 'Too new to judge', String(a.unjudged.length), (body) => {
      body.appendChild(el('div', { class: 'rvw-flat' }, a.unjudged.map((r) =>
        el('div', { class: 'rvw-flat-row' }, [
          el('span', { text: r.name }),
          el('span', { class: 'rvw-flat-meta', text: fmtSheetCur(r.now) + ' · ' + (r.months ? r.months + ' earlier month' + (r.months === 1 ? '' : 's') : 'first time') }),
        ]))));
      body.appendChild(explainRow('Too new to judge', 'A category needs ' + REVIEW_MIN_HISTORY
        + ' earlier months before it has a normal to be compared with.', 'Why these are held back'));
    });
  }
  if (a.fixedRows.length) {
    const fixedTotal = round2(a.fixedRows.reduce((sum, r) => sum + r.now, 0));
    rvwSection(host, 'fixed', '\ud83d\udd12', 'Nothing to decide', fmtSheetCur(fixedTotal), (body) => {
      body.appendChild(el('div', { class: 'rvw-flat' }, a.fixedRows.map((r) =>
        el('div', { class: 'rvw-flat-row' }, [
          el('span', { text: r.name }),
          el('span', { class: 'rvw-flat-meta', text: fmtSheetCur(r.now) }),
        ]))));
      body.appendChild(explainRow('Nothing to decide', 'Rent, bills and medicine — real money, but not this month\u2019s decisions, '
        + 'so they are kept out of the comparisons above rather than flagged every month for being large.', 'Why these are set aside'));
    });
  }

  host.appendChild(explainRow('How this tab reads your months', 'Each category is compared with its own median month from your own entries — not a target, and not an average, which one unusual month would skew. Only categories already past a normal month appear.', 'About these figures'));
}

// Which month this is, how far into it, and what history is behind the figures.
//
// Both windows are named because they differ, and a tab that showed a category
// compared against ten months next to a cycle built on one - without saying so -
// would look broken rather than careful. See DAY_DETAIL_FROM_YM for why.
// The head card's over / left figure as a badge: `over` > 0 is an overspend (red gradient), otherwise what
// is left (green gradient). `what` names the budget ("household budget", "allowance").
export function rvwBudgetBadge(over, what) {
  const isOver = over > 0;
  return el('span', { class: 'rvw-budget-badge ' + (isOver ? 'is-over' : 'is-left'), title: isOver ? 'Over the ' + what : 'Still left in the ' + what,
    text: isOver ? fmtSheetCur(over) + ' ' + what + ' overspent' : fmtSheetCur(-over) + ' ' + what + ' left' });
}
// The badge with the "N days left" line beside it, on one line.
export function rvwBudgetRow(badge, note) {
  return el('div', { class: 'rvw-head-row' }, [badge || null, note ? el('span', { class: 'rvw-head-note', text: note }) : null].filter(Boolean));
}

export function _rvwScopeLine(host, mod, ym, a, byYm) {
  const catMonths = a.historyMonths;
  const dayMonths = [...byYm.keys()].filter((k) => k < ym && dayDetailOk(k)
    && (byYm.get(k) || []).length > 0).length;
  const bits = ['day ' + a.daysElapsed + ' of ' + a.daysInMonth];
  if (catMonths > 0) bits.push(catMonths + (catMonths === 1 ? ' earlier month' : ' earlier months'));
  // The explanation of which months feed which figure sits behind an ⓘ beside the month, not as a paragraph
  // above everything - it is reference, and read once.
  const why = catMonths > dayMonths
    ? 'Category figures use all ' + catMonths + ' earlier months. Anything about WHEN inside a month — the forecast, your '
      + 'spending cycle, when things land — uses only the '
      + (dayMonths === 0 ? 'months from ' + mod.monthLabel(DAY_DETAIL_FROM_YM) + ' on'
        : dayMonths + (dayMonths === 1 ? ' month' : ' months') + ' from ' + mod.monthLabel(DAY_DETAIL_FROM_YM) + ' on')
      + ', because earlier months were filled in from totals and their dates were never actually observed.'
    : null;
  host.appendChild(el('div', { class: 'rvw-scope' }, [
    el('span', { class: 'rvw-scope-ym' }, [
      document.createTextNode(mod.monthLabel(ym)),
      why ? el('button', { class: 'rvw-scope-info', type: 'button', title: 'Which months these figures use',
        'aria-label': 'Which months these figures use', text: 'i',
        onclick: () => openInfoSheet('Which months are used', why) }) : null,
    ].filter(Boolean)),
    el('span', { class: 'rvw-scope-note', text: bits.join(' · ') }),
  ]));
}

// ---------- Sections both Review tabs draw ----------
//
// Written once rather than copied, because the two tabs are asking the same
// question of different money - what is drifting, how it was paid, whether the
// limit is the right size - and a wording or a rule that drifted apart between
// them would be a bug nobody would ever notice.
export function _rvwCreepingSection(host, creeping, groupClass) {
  if (!creeping.length) return;
  rvwSection(host, 'creep', '\ud83d\udcc8', 'Creeping up',
    '+' + fmtSheetCur(creeping[0].rise) + ' ' + creeping[0].name, (body) => {
      body.appendChild(el('div', { class: 'rvw-list' }, creeping.map((r) =>
        el('div', { class: 'rvw-item ' + groupClass(r.group) }, [
          el('div', { class: 'rvw-item-top' }, [
            el('span', { class: 'rvw-item-name' }, [el('span', { class: 'rvw-item-dot' }), el('span', { text: r.name })]),
            el('span', { class: 'rvw-item-amt', text: '+' + fmtSheetCur(r.rise) + (r.risePct != null ? ' (' + r.risePct + '%)' : '') }),
          ]),
          el('div', { class: 'rvw-seq' }, r.seq.map((st) => el('span', { class: 'rvw-seq-step' }, [
            el('span', { class: 'rvw-seq-mon', text: _spendMonthLabel(st.ym).split(' ')[0] }),
            el('span', { class: 'rvw-seq-amt', text: fmtSheetCur(st.amount) }),
          ]))),
          el('div', { class: 'rvw-item-mid', text: 'Up every month for ' + r.months + ' months'
            + (r.fixed ? ' · fixed cost, but worth checking the rate' : '') }),
        ]))));
    });
}

export function _rvwMethodsSection(host, methods, cardNote) {
  if (!methods) return;
  const lead = methods.rows.slice().sort((x, y) => y.share - x.share)[0];
  rvwSection(host, 'method', '\ud83d\udcb3', 'How you paid',
    lead ? lead.method + ' ' + lead.share + '%' : null, (body) => {
      body.appendChild(el('div', { class: 'rvw-meth' }, methods.rows.map((r) => el('div', { class: 'rvw-meth-row' }, [
        el('span', { class: 'rvw-meth-name', text: r.method }),
        el('span', { class: 'rvw-meth-track' }, [
          el('span', { class: 'rvw-meth-fill is-' + r.method.toLowerCase(), style: 'width:' + Math.max(2, r.share) + '%' }),
        ]),
        el('span', { class: 'rvw-meth-amt', text: fmtSheetCur(r.amount) }),
        el('span', { class: 'rvw-meth-pct', text: r.share + '%' }),
      ]))));
      if (methods.cardAmount > 0) {
        const moved = methods.prevCardShare != null && Math.abs(methods.cardShare - methods.prevCardShare) >= 5
          ? ' Card was ' + methods.prevCardShare + '% last month.'
          : '';
        body.appendChild(el('p', { class: 'hint rvw-note', text: fmtSheetCur(methods.cardAmount)
          + ' of this month went on a card, so it lands on a statement later rather than being gone already.'
          + cardNote + moved }));
      }
    });
}

// `o.word` is what this money is called, `o.each` an extra clause for the
// suggestion where the limit is shared or doubled on its way in.
export function _rvwFitSection(host, fit, o) {
  if (!fit) return;
  const word = o.word;
  rvwSection(host, 'household budget', '\ud83e\uddee', 'Is the ' + word + ' right?',
    fit.overCount + ' of ' + fit.months + ' over', (body) => {
      const rows = [
        ['Over the ' + word, fit.overCount + ' of the last ' + fit.months + ' months'],
        ['Average overshoot', fit.avgOvershoot > 0 ? fmtSheetCur(fit.avgOvershoot) : '—'],
        ['Leanest month', _spendMonthLabel(fit.leanest.ym) + ' · ' + fmtSheetCur(fit.leanest.total)],
        ['Heaviest month', _spendMonthLabel(fit.heaviest.ym) + ' · ' + fmtSheetCur(fit.heaviest.total)],
      ];
      body.appendChild(el('div', { class: 'rvw-flat' }, rows.map(([k, v]) =>
        el('div', { class: 'rvw-flat-row' }, [el('span', { text: k }), el('span', { class: 'rvw-flat-meta', text: v })]))));
      // Only worth saying when a bigger limit would genuinely have covered more
      // months than the one that's set. Otherwise the limit is fine and the
      // spending is the story, which the sections above already tell.
      if (fit.suggested > fit.currentKitty && fit.covered > fit.coveredNow) {
        body.appendChild(el('p', { class: 'hint rvw-note', text: 'A ' + word + ' of ' + fmtSheetCur(fit.suggested)
          + ' would have covered ' + fit.covered + ' of those ' + fit.months + ' months, against '
          + fit.coveredNow + ' on the ' + fmtSheetCur(fit.currentKitty) + ' set now'
          + (o.each ? o.each(fit) : '') + '. Sized to cover all but the single '
          + 'heaviest month, so one unusual month does not set the budget.' }));
      } else if (fit.overCount === 0) {
        body.appendChild(el('p', { class: 'hint rvw-note', text: 'The ' + word
          + ' has covered every one of those months, so it looks about right.' }));
      }
    });
}

// Categories that keep turning up, and roughly when. This is pattern
// description, not prediction: "Rent appeared in 6 of the last 6 months, median
// day 5, median ₹14,000" is a statement about what already happened. It's the
// one forward-looking thing on this tab that doesn't require inventing a model
// — unlike projecting a spend LEVEL, which a couple of months can't support.
//
// Only reported for a category ABSENT from the selected month so far, since the
// useful question is what hasn't landed yet. "₹800 left in the kitty" means
// something very different when rent is still to go out.
const RECUR_LOOKBACK = 6;   // months of history considered
const RECUR_MIN_MONTHS = 3; // ...and the minimum needed before claiming a pattern

// 1st, 2nd, 3rd, 4th ... 21st, 22nd, 23rd, 31st. The teens are all 'th',
// which is why 11-13 are special-cased ahead of the last-digit rule.
export const _ordinalSuffix = (n) => {
  const d = Number(n) || 0;
  if (d % 100 >= 11 && d % 100 <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' })[d % 10] || 'th';
};

export function _recurringDue(ym, byYm) {
  const hist = [...byYm.keys()].filter((k) => k < ym).sort().slice(-RECUR_LOOKBACK);
  if (hist.length < RECUR_MIN_MONTHS) return [];

  const already = new Set((byYm.get(ym) || []).map((r) => r.category || 'Prev Bill Bal / Misc'));
  const seen = new Map(); // name -> { months:Set, totals:[], days:[] }
  hist.forEach((k) => {
    const perCat = new Map();
    (byYm.get(k) || []).forEach((r) => {
      const n = r.category || 'Prev Bill Bal / Misc';
      const d = Number(String(r.date || '').slice(8, 10)) || 0;
      const e = perCat.get(n) || { total: 0, days: [] };
      e.total = round2(e.total + (Number(r.amount) || 0));
      if (d) e.days.push(d);
      perCat.set(n, e);
    });
    perCat.forEach((v, n) => {
      if (!seen.has(n)) seen.set(n, { months: new Set(), totals: [], days: [], dayMonths: new Set() });
      const e = seen.get(n);
      e.months.add(k);
      e.totals.push(v.total);
      // Split deliberately: whether a category turns up every month, and what
      // it usually costs, are month-level facts and read from all of history.
      // WHICH DAY it lands on is not, so days come only from months that were
      // logged as they happened. A long history still says "rent has not gone
      // out yet"; it just will not name the 5th until it has seen the 5th.
      if (dayDetailOk(k) && v.days.length) { v.days.forEach((d) => e.days.push(d)); e.dayMonths.add(k); }
    });
  });

  // Present in most of the window, not merely twice in six months.
  const threshold = Math.max(RECUR_MIN_MONTHS, Math.ceil(hist.length * 0.6));
  const out = [];
  seen.forEach((e, name) => {
    if (already.has(name)) return;          // already logged this month
    if (e.months.size < threshold) return;  // not regular enough to call
    // A date needs more than one month behind it. One observed month gives a
    // median of exactly that month and a spread of zero, which would announce
    // "usually the 5th" off a single sighting - the same false precision the
    // day floor exists to avoid, arrived at from the other direction.
    const enoughDays = e.dayMonths.size >= REVIEW_FORECAST_MIN;
    const day = enoughDays ? (Math.round(_median(e.days)) || null) : null;
    // How tightly the day clusters. A category that lands anywhere in the month
    // is still worth expecting, but naming a date for it would be false
    // precision, so the date is dropped instead of the row.
    const spread = e.days.length > 1
      ? Math.max.apply(null, e.days) - Math.min.apply(null, e.days)
      : 0;
    out.push({
      name, amount: _median(e.totals),
      day: spread <= 8 ? day : null,
      months: e.months.size, window: hist.length,
      fixed: _reviewIgnores(name),
    });
  });
  // Soonest first where a date is known, then the rest by size.
  out.sort((a, b) => {
    if (a.day && b.day && a.day !== b.day) return a.day - b.day;
    if (a.day && !b.day) return -1;
    if (!a.day && b.day) return 1;
    return b.amount - a.amount;
  });
  return out;
}
