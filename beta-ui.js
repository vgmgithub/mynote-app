// The Beta Program's client screens: a menu row (Request Beta / weekly feedback), the request sheet, the
// weekly feedback form, and a Home reminder card shown Friday-Sunday when this week is not submitted yet.
// Window logic and validation are pure (beta-core.js); this file is only DOM and the two network calls
// sender.js already exposes (requestBeta, submitBetaFeedback). Every submit is gated on navigator.onLine -
// the server is the only place a submission is ever accepted, so there is nothing useful to queue offline.
import { DB } from './db.js';
import { el, openModal, closeModal, toast, menuItem, isBetaPlan } from './app.js';
import { getPlanDetail, requestBeta, submitBetaFeedback, checkPlan } from './sender.js';
import { currentWindow, QUESTIONS, validateFeedback, offerCopy } from './beta-core.js';
import { markMissing } from './spend-kit.js';

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

// ---------- Menu row ----------
// Free/Pro (not yet in the Beta): an invite to request. Beta member: this week's feedback status.
export async function betaMenuItem() {
  if (isBetaPlan()) {
    const detail = await getPlanDetail();
    const beta = detail && detail.beta;
    const w = beta || currentWindow(new Date());
    const desc = !w.isOpen ? 'Feedback opens Friday'
      : w.submitted ? 'This week’s feedback is in - thank you' : 'Share this week’s feedback';
    return menuItem('🧪', 'Beta feedback', desc, () => { closeModal(); openBetaFeedbackSheet(); });
  }
  const pending = await DB.get('meta', 'betaRequestPending').catch(() => null);
  if (pending && pending.value) {
    return menuItem('🧪', 'Beta request sent', 'Waiting to hear back - tap for details', () => { closeModal(); openBetaStatusSheet(); });
  }
  return menuItem('🧪', 'Join the MyNotes Beta', 'Try new features early and help shape them', () => { closeModal(); openBetaRequestSheet(); });
}

// ---------- Request sheet ----------
function openBetaRequestSheet() {
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Join the MyNotes Beta' }),
    el('p', { class: 'hint', text: 'Beta members get every feature unlocked in exchange for a short weekly check-in (Friday-Sunday, three quick questions and a comment). At the end of a 6-week round, the owner reviews feedback and decides who continues.' }),
    el('p', { class: 'hint', text: 'No payment is involved. Requesting does not guarantee a spot.' }),
    el('div', { class: 'btn-row' }, [
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
    ]),
  ]));
}

function openBetaStatusSheet() {
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Beta request' }),
    el('p', { class: 'hint', text: 'Your request to join the MyNotes Beta is waiting for review. Nothing else to do for now - check back here, or reopen the app once approved.' }),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal })]),
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
  return el('div', { class: 'beta-offer-banner' }, [
    el('div', { class: 'beta-offer-title', text: copy.label + ': ' + copy.price }),
    el('div', { class: 'beta-offer-sub', text: copy.note + ' · offer ends in ' + days + (days === 1 ? ' day' : ' days') }),
  ]);
}
