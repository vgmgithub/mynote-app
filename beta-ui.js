// The Beta Program's client screens: a menu row (Request Beta / weekly feedback), the request sheet, the
// weekly feedback form, and a Home reminder card shown Friday-Sunday when this week is not submitted yet.
// Window logic and validation are pure (beta-core.js); this file is only DOM and the two network calls
// sender.js already exposes (requestBeta, submitBetaFeedback). Every submit is gated on navigator.onLine -
// the server is the only place a submission is ever accepted, so there is nothing useful to queue offline.
import { DB } from './db.js';
import { el, openModal, closeModal, toast, menuItem, isBetaPlan, betaCountdown } from './app.js';
import { getPlanDetail, requestBeta, submitBetaFeedback, getBetaStatus, checkPlan } from './sender.js';
import { currentWindow, QUESTIONS, validateFeedback, offerCopy } from './beta-core.js';
import { markMissing } from './spend-kit.js';

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const LEGAL_CONTACT = 'viewsofvgm@gmail.com';

// ---------- Menu row ----------
// Free/Pro (not yet in the Beta): an invite to request. Beta member: opens the Beta screen (history +
// leaderboard), not the feedback form directly - the form is one button on that screen, not the whole row.
export async function betaMenuItem() {
  if (isBetaPlan()) {
    const detail = await getPlanDetail();
    const beta = detail && detail.beta;
    const w = beta || currentWindow(new Date());
    const desc = !w.isOpen ? 'Feedback opens Friday'
      : w.submitted ? 'This week’s feedback is in - thank you' : 'Share this week’s feedback';
    return menuItem('🧪', 'Beta Plan', desc, () => { closeModal(); openMyBetaSheet(); }, { highlight: true });
  }
  const pending = await DB.get('meta', 'betaRequestPending').catch(() => null);
  if (pending && pending.value) {
    return menuItem('🧪', 'Beta request sent', 'Waiting to hear back - tap for details', () => { closeModal(); openBetaStatusSheet(); });
  }
  return menuItem('🧪', 'Join the MyNotes Beta', 'Try new features early and help shape them', () => { closeModal(); openBetaRequestSheet(); });
}

// ---------- Request sheet ----------
// The pitch, not the contract: a headline, three facts, three steps, the two rewards, one reassurance.
// Every rule and edge case lives in Terms (legal-text.js 'Beta Program'), one tap away - this screen
// only has to make someone want to join and understand the one thing they owe: a check-in each week.
function openBetaRequestSheet() {
  const fact = (big, small) => el('div', { class: 'beta-fact' }, [el('b', { text: big }), el('span', { text: small })]);
  const step = (n, title, text) => el('div', { class: 'beta-step' }, [
    el('span', { class: 'beta-step-n', text: String(n) }),
    el('div', {}, [el('b', { text: title }), el('span', { text })]),
  ]);
  const reward = (cls, who, price, note) => el('div', { class: 'beta-reward ' + cls }, [
    el('span', { class: 'beta-reward-who', text: who }),
    el('b', { class: 'beta-reward-price', text: price }),
    el('span', { class: 'beta-reward-note', text: note }),
  ]);
  const terms = el('button', { class: 'beta-terms-link', type: 'button', text: 'Full Beta terms ›' });
  terms.addEventListener('click', async () => { closeModal(); const { openLegal } = await import('./app.js'); openLegal('terms'); });

  openModal(el('div', { class: 'sheet has-fixed-footer beta-request-sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('div', { class: 'beta-hero' }, [
        el('img', { class: 'beta-hero-ico', src: 'icons/icon-beta.png', alt: '' }),
        el('h2', { text: 'Get Pro free for 6 weeks' }),
        el('p', { text: 'Share a quick check-in each week and help shape what MyNotes builds next.' }),
      ]),
      el('div', { class: 'beta-facts' }, [fact('₹0', 'no payment'), fact('6', 'weeks'), fact('2 min', 'a week')]),
      el('div', { class: 'beta-steps' }, [
        step(1, 'Request', 'We approve each spot by hand.'),
        step(2, 'Check in, Fri–Sun', 'Three taps and a line. Miss one and Beta ends.'),
        step(3, 'Get ranked', 'Best feedback earns the best price.'),
      ]),
      el('div', { class: 'beta-rewards' }, [
        reward('is-top', 'Top 10%', '₹199/yr', 'No lock-in · buy anytime'),
        reward('', 'Everyone else', '₹299/yr', 'Claim within a year'),
      ]),
      el('p', { class: 'beta-safe', text: '🔒 Your data stays safe on any plan. More to share? Email ' + LEGAL_CONTACT }),
      terms,
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Not now', onclick: closeModal }),
      el('button', { class: 'btn primary', text: 'Request to join', onclick: async (e) => {
        if (!online()) { toast('You need to be online to request Beta access'); return; }
        e.target.disabled = true;
        const r = await requestBeta();
        if (!r.ok) { e.target.disabled = false; toast('Could not reach the server - try again'); return; }
        await DB.put('meta', { key: 'betaRequestPending', value: true }).catch(() => {});
        closeModal();
        toast(r.already ? 'You already have a pending Beta request' : 'Beta request sent - you’ll be notified here');
      } }),
    ])]),
  ]));
}

function openBetaStatusSheet() {
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Beta request' }),
    el('p', { class: 'hint', text: 'Your request to join the MyNotes Beta is waiting for review. Nothing else to do for now - check back here, or reopen the app once approved.' }),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal })]),
  ]));
}

// ---------- Beta screen: history + leaderboard + this week's action ----------
// What a joined member sees from the Menu: which week of the round this is, every submission they have
// made (not just this week's), the top 5 by score, and their own place among them - then, if this
// week's window is open, the button to fill it in.
// 'YYYY-MM-DD...' (the server's raw week_start) -> '25 Sep'. Nobody wants to read an ISO timestamp.
function _weekLabel(iso) {
  const d = new Date(iso);
  return isNaN(d) ? String(iso || '') : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
// A plain list, newest first - realistically at most a handful of weeks, so a static list reads better
// than a rotating single card (which also hid the raw ISO date behind an unlabelled row).
function feedbackList(rows) {
  const cards = rows.map((f) => el('div', { class: 'beta-fb-card' }, [
    el('div', { class: 'beta-fb-row1' }, [
      el('span', { class: 'beta-fb-week', text: 'Week of ' + _weekLabel(f.weekStart) }),
      el('span', { class: 'beta-fb-state' + (f.reviewed ? ' is-done' : ''),
        text: f.reviewed ? (f.score == null ? 'Reviewed' : f.score + ' pts') : 'Awaiting review' }),
    ]),
    el('div', { class: 'beta-fb-title', text: f.title || 'No title given' }),
  ]));
  return el('div', { class: 'beta-fb-list' }, [
    el('div', { class: 'upc-head' }, [
      el('span', { class: 'upc-label', text: 'Your submissions' }),
      el('span', { class: 'upc-count', text: rows.length + (rows.length === 1 ? ' item' : ' items') }),
    ]),
    ...cards,
  ]);
}

export async function openMyBetaSheet() {
  const s = await getBetaStatus();
  const w = currentWindow(new Date());
  const rows = (s && s.feedback) || [];
  const top5 = (s && s.top5) || [];
  const myInTop5 = !!(s && s.myPosition && s.myPosition <= 5);
  openModal(el('div', { class: 'sheet has-fixed-footer beta-status-sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: 'Beta Plan' }),
      s && s.cohort && s.cohort.endDate ? betaCountdown(s.cohort.endDate, s.weekNumber, s.totalWeeks) : null,
      s && s.cohort ? el('p', { class: 'hint', text: s.weekNumber
        ? (s.weekNumber - 1) + ' of ' + s.totalWeeks + ' weeks gone · ' + rows.length + (rows.length === 1 ? ' submission so far' : ' submissions so far')
        : s.cohort.label }) : null,
      top5.length ? el('div', { class: 'beta-top5' }, [
        el('div', { class: 'beta-top5-h', text: 'Leaderboard · top 5' }),
        el('div', { class: 'beta-rank-table' }, [
          ...top5.map((t) => el('div', { class: 'beta-rank-row' + (s.myPosition === t.position ? ' is-me' : '') }, [
            el('span', { class: 'beta-rank-pos', text: '#' + t.position }),
            el('span', { class: 'beta-rank-name', text: t.name }),
            el('span', { class: 'beta-rank-pts', text: t.score + ' pts' }),
          ])),
          !myInTop5 && s.myPosition ? el('div', { class: 'beta-rank-row is-me is-outside' }, [
            el('span', { class: 'beta-rank-pos', text: '#' + s.myPosition }),
            el('span', { class: 'beta-rank-name', text: 'You' }),
            el('span', { class: 'beta-rank-pts', text: s.myScore + ' pts' }),
          ]) : null,
        ].filter(Boolean)),
      ]) : (s && s.cohort ? el('p', { class: 'hint', text: 'Ranking not yet released.' }) : null),
      rows.length ? feedbackList(rows)
        : el('p', { class: 'hint', text: 'Nothing submitted yet - your first weekly form starts your history here.' }),
      el('p', { class: 'hint', text: 'Want to share more than the form allows - a screen recording or screenshot? Email it any time to ' + LEGAL_CONTACT + '.' }),
    ].filter(Boolean)),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
      w.isOpen
        ? el('button', { class: 'btn primary', text: 'This week’s feedback', onclick: () => { closeModal(); openBetaFeedbackSheet(); } })
        : null,
    ].filter(Boolean))]),
  ]));
}

// ---------- Weekly feedback ----------
function chipRow(q, picked, onPick) {
  return el('div', { class: 'beta-q' }, [
    el('div', { class: 'beta-q-label', text: q.label }),
    el('div', { class: 'beta-chips' }, q.options.map((opt) => el('button', {
      type: 'button', class: 'beta-chip' + (picked === opt ? ' is-on' : ''), text: opt,
      onclick: () => onPick(opt),
    }))),
  ]);
}

export async function openBetaFeedbackSheet() {
  const detail = await getPlanDetail();
  const w = (detail && detail.beta) || currentWindow(new Date());
  if (!w.isOpen) {
    openModal(el('div', { class: 'sheet' }, [
      el('h2', { text: 'Beta feedback' }),
      el('p', { class: 'hint', text: 'This week’s window opens Friday and stays open through Sunday. Nothing to submit right now.' }),
      el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal })]),
    ]));
    return;
  }
  if (w.submitted) {
    openModal(el('div', { class: 'sheet' }, [
      el('h2', { text: 'Beta feedback' }),
      el('p', { class: 'hint', text: 'You’ve already sent this week’s feedback - thank you. The next window opens next Friday.' }),
      el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal })]),
    ]));
    return;
  }
  const answers = {};
  const body = { title: '', body: '' };
  const qWrap = el('div', { class: 'beta-qs' });
  const redraw = () => {
    qWrap.innerHTML = '';
    for (const q of QUESTIONS) qWrap.appendChild(chipRow(q, answers[q.key], (opt) => { answers[q.key] = opt; redraw(); }));
  };
  redraw();
  const titleField = el('input', { class: 'field-input', type: 'text', placeholder: 'One line: what stood out this week', maxlength: '80' });
  const bodyField = el('textarea', { class: 'field-input', rows: '4', placeholder: 'A sentence or two - anything that helped, or got in your way' });
  titleField.addEventListener('input', () => { body.title = titleField.value; });
  bodyField.addEventListener('input', () => { body.body = bodyField.value; });
  const submitBtn = el('button', { class: 'btn primary', text: 'Submit feedback' });
  submitBtn.addEventListener('click', async () => {
    const state = {
      answers: QUESTIONS.map((q) => ({ key: q.key, value: answers[q.key] || '' })),
      commentTitle: body.title, commentBody: body.body,
    };
    const check = validateFeedback(state);
    if (!check.ok) { markMissing(qWrap); toast('Please answer every question and add a short comment'); return; }
    if (!online()) { toast('You need to be online to submit feedback'); return; }
    submitBtn.disabled = true;
    const r = await submitBetaFeedback({ weekStart: w.weekKey, ...state });
    if (!r.ok) { submitBtn.disabled = false; toast('Could not reach the server - try again'); return; }
    closeModal();
    toast('Thank you - this week’s feedback is in');
    checkPlan().catch(() => {});
  });
  openModal(el('div', { class: 'sheet beta-sheet' }, [
    el('h2', { text: 'This week’s feedback' }),
    qWrap,
    el('div', { class: 'field' }, [el('label', { text: 'Title' }), titleField]),
    el('div', { class: 'field' }, [el('label', { text: 'Comment' }), bodyField]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Not now', onclick: closeModal }),
      submitBtn,
    ]),
  ]));
}

// ---------- Home reminder card ----------
// Shown only while the window is open and this week is not yet submitted - the same "don't nag" rule as
// the renewal card, minus its own countdown (there is nothing precise to count down to here).
export async function homeBetaCard() {
  if (!isBetaPlan()) return null;
  const detail = await getPlanDetail();
  const w = (detail && detail.beta) || currentWindow(new Date());
  if (!w.isOpen || w.submitted) return null;
  return el('div', { class: 'home-beta-card', role: 'status' }, [
    el('div', { class: 'home-beta-body' }, [
      el('div', { class: 'home-beta-title', text: '🧪 This week’s Beta feedback is open' }),
      el('div', { class: 'home-beta-sub', text: 'Three quick questions and a short comment' }),
    ]),
    el('button', { class: 'btn primary sm', text: 'Share feedback', onclick: () => openBetaFeedbackSheet() }),
  ]);
}

// ---------- Post-Beta offer copy (Phase 3), read by the Pro comparison page ----------
export async function betaOfferBanner() {
  const detail = await getPlanDetail();
  const offer = detail && detail.betaOffer;
  if (!offer) return null;
  const copy = offerCopy(offer.planCode);
  if (!copy) return null;
  const days = Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - Date.now()) / 864e5));
  // A Contributor's price never expires (server sets its row's date ~100 years out, since the column
  // cannot be null) - past a year out is a good enough proxy for "don't show a countdown" without the
  // client needing to know that number is a placeholder.
  const countdown = days > 365 ? '' : ' · offer ends in ' + days + (days === 1 ? ' day' : ' days');
  return el('div', { class: 'beta-offer-banner' }, [
    el('div', { class: 'beta-offer-title', text: copy.label + ': ' + copy.price }),
    el('div', { class: 'beta-offer-sub', text: copy.note + countdown }),
  ]);
}
