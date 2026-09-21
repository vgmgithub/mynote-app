import { DB } from './db.js';
import { ui } from './state.js';
import { el, toast } from './app.js';
import { openInfoSheet } from './expense-ui.js';
import { OUT_KEYS, LABELS, emergencyFloor, balance, remainderForSavings, problemWith, startValues, diffAgainst, toRecord, needsSetup } from './plan-setup.js';

// ---------- Pro: the guided yearly plan setup ----------
// A full-page, mandatory flow (no skip, no close) shown before Home to Pro members. It fills the SAME
// yearly plan record the Expense > Yearly plan tab edits, so nothing new is stored beyond a draft and a
// "done" marker in meta. Order and wording are a suggested priority, not financial advice.
const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

const INFO = {
  salary: 'Your take-home pay each month, after tax and deductions. Every other line in this plan is a share of this number.',
  emergency: [
    'An emergency fund is money kept aside for surprises such as a job loss, a medical bill or an urgent repair, so you never have to borrow or break your investments.',
    'We suggest at least 5% of your salary every month as the minimum: small enough to keep up, and it builds a real cushion steadily. That is why the flow will not go below it.',
    'If you both work, we suggest you contribute equally. Tick the box below, or set it any time on the Emergency Fund Log tab.',
  ],
  parents: 'The amount you plan to send your parents every month. Leave it empty if you do not.',
  houseExp: 'Your monthly contribution to running the house: rent, bills, groceries and so on. The household budget on the Expense Tracker is this amount, plus anything someone else contributes.',
  shared: 'Tick this if someone else, such as a sibling or a tenant, also puts money towards the house every month, and enter their monthly amount. It is added to the household budget.',
  invest: 'Whatever you invest each month, fill only the ones you use. We only show where investing belongs in the order: after your commitments and household costs, before personal spending. We do not suggest amounts.',
  mf: 'Money you put into mutual funds each month, for example your SIPs.',
  fd: 'Money you put into fixed or recurring deposits each month.',
  indStock: 'Money you put into Indian shares or ETFs each month.',
  usStock: 'Money you put into US shares or ETFs each month.',
  metal: 'Money you put into gold or silver each month (coins, digital gold, SGB).',
  card: 'Money you spend on yourself each month, whether you pay by card, UPI or cash. Personal Finance uses it as your card allowance.',
  savings: 'What is left goes to your savings account. We fill in the remainder for you; change it if you plan differently.',
};

const STEP_TITLES = ['Salary', 'Emergency fund', 'Parents', 'House expense', 'Investments', 'Personal spending', 'Savings'];

let running = null;
// Resolves once the person has finished (or straight away when nothing is needed). Never rejects.
export function runPlanSetupIfNeeded() {
  if (running) return running;
  running = (async () => {
    if (document.body.dataset.plan !== 'paid') return;
    // Never before the welcome screen: the Terms and Privacy confirmation must have been given first.
    const acc = await DB.get('meta', 'legalAccepted').catch(() => null);
    if (!(acc && acc.value)) return;
    const year = new Date().getFullYear();
    const [done, allocs, draft] = await Promise.all([
      DB.get('meta', 'planSetupDone').catch(() => null),
      DB.all('allocations').catch(() => []),
      DB.get('meta', 'planSetupDraft').catch(() => null),
    ]);
    const current = (allocs || []).find((a) => Number(a.year) === year) || null;
    if (!needsSetup(done && done.value, current, year)) return;
    await openWizard(year, current, draft && draft.value && draft.value.year === year ? draft.value : null);
  })().catch(() => {}).finally(() => { running = null; });
  return running;
}

function openWizard(year, existing, draft) {
  return new Promise((resolve) => {
    document.querySelectorAll('.onboard').forEach((n) => n.remove());
    const root = el('div', { class: 'onboard ps-root' });
    document.body.appendChild(root);
    document.body.classList.add('locked');

    const v = Object.assign(startValues(existing), draft && draft.v ? draft.v : {});
    v.couple = !!(draft && draft.v && draft.v.couple);
    let step = draft && Number.isInteger(draft.step) ? Math.min(Math.max(draft.step, 0), 7) : 0; // 0 = intro, 1..7 = steps
    let savingsTouched = !!(draft && draft.v && draft.v.savingsTouched);

    const scroll = el('div', { class: 'onboard-scroll ps-scroll' });
    const strip = el('div', { class: 'ps-balance' });
    const back = el('button', { class: 'btn ghost', type: 'button', text: 'Back' });
    const next = el('button', { class: 'btn primary', type: 'button', text: 'Next' });
    root.appendChild(scroll);
    root.appendChild(el('div', { class: 'onboard-bar ps-bar' }, [strip, el('div', { class: 'ps-buttons' }, [back, next])]));

    const infoBtn = (title, text) => el('button', { class: 'info-btn', type: 'button', 'aria-label': 'About ' + title, text: 'i', onclick: () => openInfoSheet(title, text) });
    const numField = (key, label, infoText, hint) => {
      const inp = el('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', placeholder: '0', value: v[key] ? v[key] : '' });
      inp.addEventListener('input', () => { v[key] = Math.max(0, Number(inp.value) || 0); if (key === 'savings') savingsTouched = true; paint(); });
      return el('div', { class: 'ps-field' }, [
        el('div', { class: 'ps-field-head' }, [el('label', { text: label }), infoBtn(label, infoText)]),
        el('div', { class: 'ps-input-wrap' }, [inp, el('span', { class: 'ps-cur', text: '₹' })]),
        hint ? el('p', { class: 'hint ps-hint', text: hint }) : null,
      ].filter(Boolean));
    };
    const point = (icon, title, text, hero) => el('div', { class: 'onboard-point' + (hero ? ' onboard-kakeibo' : '') }, [
      el('span', { class: 'onboard-point-ico', 'aria-hidden': 'true', text: icon }),
      el('div', { class: 'onboard-point-body' }, [el('b', { text: title }), el('p', { text })]),
    ]);

    const saveDraft = () => DB.put('meta', { key: 'planSetupDraft', value: { year, step, v: Object.assign({}, v, { savingsTouched }) } }).catch(() => {});

    const blocked = () => {
      if (step === 1 && !(v.salary > 0)) return problemWith(v);
      if (step === 2 && v.emergency + 1e-9 < emergencyFloor(v.salary)) return problemWith(v);
      return null;
    };
    function paint() {
      const bal = balance(v);
      strip.innerHTML = '';
      if (step >= 1 && v.salary > 0) {
        strip.appendChild(el('span', { class: 'ps-bal-label', text: 'Left to allocate' }));
        strip.appendChild(el('span', { class: 'ps-bal-val' + (bal < 0 ? ' is-neg' : ''), text: inr(bal) }));
      }
      const why = blocked();
      next.disabled = !!why;
      const note = scroll.querySelector('.ps-block-note');
      if (note) note.textContent = why || '';
      back.style.display = step === 0 ? 'none' : '';
      next.textContent = step === 0 ? 'Plan my year' : step === 7 ? 'Finish' : 'Next';
    }

    const render = () => {
      scroll.innerHTML = '';
      scroll.scrollTop = 0;
      if (step === 0) {
        // The page is about one idea: the app runs on what you note. Four cards say how often, each one closed
        // until tapped and none of them highlighted.
        scroll.appendChild(el('div', { class: 'ps-hero' }, [
          el('div', { class: 'ps-hero-badge', text: '\u2B50 PRO' }),
          el('h1', { class: 'ps-hero-h', text: 'MyNotes runs on your input' }),
          el('p', { class: 'ps-hero-sub', text: 'You note it, we do the maths and the insights. Here is how often.' }),
        ]));
        const rhythm = [
          ['\u{1F5D3}\uFE0F', 'Once a year', 'Your annual budget', 'Set your Annual Allocation: salary, savings and every spending line.'],
          ['\u{1F4C5}', 'Once a month', 'Your monthly updates', 'Log emergency fund, card bills, cash flow fixes, loans and investments.'],
          ['\u{1F50D}', 'Once a week', 'Your spending review', 'Review your spending patterns and insights to see where money goes.'],
          ['\u{1F6D2}', 'Every day', 'Your daily spends', 'Note each personal and house spend as you pay. The rest is built from it.'],
        ];
        scroll.appendChild(el('div', { class: 'ps-rhythm' }, rhythm.map(([ico, when, what, more], n) => {
          const card = el('button', { class: 'ps-r-card', type: 'button', 'aria-expanded': 'false', style: 'animation-delay:' + (120 + n * 110) + 'ms' }, [
            el('span', { class: 'ps-r-ico', text: ico }),
            el('span', { class: 'ps-r-body' }, [el('span', { class: 'ps-r-when', text: when }), el('b', { text: what }), el('span', { class: 'ps-r-more', text: more })]),
            el('span', { class: 'ps-r-chev', text: '\u203A' }),
          ]);
          card.addEventListener('click', () => {
            const open = !card.classList.contains('open');
            card.classList.toggle('open', open);
            card.setAttribute('aria-expanded', open ? 'true' : 'false');
          });
          return card;
        })));
        // The privacy idea stays, small and below: what we never do, with the fuller Kakeibo reason one tap away.
        scroll.appendChild(el('button', {
          class: 'ps-privacy ps-privacy-quiet', type: 'button',
          onclick: () => openInfoSheet('Why you write it down', [
            'We could read your SMS or email to fill things in for you. MyNotes never does. That is for your privacy, and because noting down each spend yourself, even a digital payment, makes you pause and spend with intention.',
            'This is the idea behind Kakeibo, the Japanese habit of writing down every spend. You add the numbers; we do the maths, the insights and the comparisons.',
          ]),
        }, [
          el('span', { class: 'ps-privacy-txt' }, [el('b', { text: 'We never read your SMS or email.' }), el('span', { text: ' You note it yourself.' })]),
          el('span', { class: 'ps-privacy-i', text: 'i' }),
        ]));
        scroll.appendChild(el('p', { class: 'hint ps-foot', text: 'A suggested order to help you allocate, not financial advice.' }));
        return;
      }
      scroll.appendChild(el('p', { class: 'ps-stepno', text: 'Step ' + step + ' of 7' }));
      scroll.appendChild(el('h1', { class: 'onboard-h ps-h', text: STEP_TITLES[step - 1] }));
      const S = {
        1: () => [numField('salary', 'Salary (in hand, per month)', INFO.salary, 'Required. Everything else is planned as a share of this.')],
        2: () => {
          const floor = emergencyFloor(v.salary);
          if (v.emergency < floor) v.emergency = floor;
          const cb = el('input', { type: 'checkbox' });
          cb.checked = !!v.couple;
          cb.addEventListener('change', () => { v.couple = cb.checked; });
          return [
            numField('emergency', 'Emergency fund (per month)', INFO.emergency, 'Required. Minimum ' + inr(floor) + ' (5% of your salary), already filled in.'),
            el('label', { class: 'ps-check' }, [cb, el('span', { text: 'We are a working couple and will contribute equally' })]),
            el('p', { class: 'hint ps-hint', text: 'Sets equal contributions on the Emergency Fund Log tab. You can change it there any time.' }),
          ];
        },
        3: () => [numField('home', 'Parents (per month)', INFO.parents, 'Optional. What you plan to send your parents each month.')],
        4: () => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = !!v.sharedOn;
          const sub = numField('sharedAmount', 'Their monthly share of house expense', INFO.shared, 'Counted in the household budget only, not added to your allocations.');
          sub.classList.toggle('hidden', !v.sharedOn);
          cb.addEventListener('change', () => { v.sharedOn = cb.checked; sub.classList.toggle('hidden', !cb.checked); paint(); });
          return [
            numField('houseExp', 'House expense (per month)', INFO.houseExp, 'Optional. Your share of running the house.'),
            el('label', { class: 'ps-check' }, [cb, el('span', { text: 'Does anyone else share the house expenses?' }), infoBtn('Shared house expenses', INFO.shared)]),
            sub,
          ];
        },
        5: () => [
          el('p', { class: 'hint ps-hint', text: INFO.invest }),
          numField('mf', 'Mutual Funds', INFO.mf), numField('fd', 'FD', INFO.fd), numField('indStock', 'Indian stocks', INFO.indStock),
          numField('usStock', 'US stocks', INFO.usStock), numField('metal', 'Metal', INFO.metal),
        ],
        6: () => [numField('card', 'Personal spending (card, UPI, cash)', INFO.card, 'Optional. Whatever way you pay, this is your own spending.')],
        7: () => {
          if (!savingsTouched) v.savings = remainderForSavings(v);
          const lines = ['salary'].concat(OUT_KEYS.filter((k) => k !== 'savings' && v[k] > 0));
          return [
            numField('savings', 'Savings (what is left)', INFO.savings, 'Filled in with what remains after everything above. Change it if you plan differently.'),
            el('div', { class: 'ps-summary' }, lines.map((k) => el('div', { class: 'ps-sum-row' }, [el('span', { text: LABELS[k] }), el('b', { text: inr(v[k]) })]))),
          ];
        },
      };
      S[step]().forEach((n) => scroll.appendChild(n));
      scroll.appendChild(el('p', { class: 'ps-block-note' }));
    };

    let mode = 'steps'; // 'diff' while the comparison for an existing plan is showing
    back.addEventListener('click', () => {
      if (mode === 'diff') { mode = 'steps'; render(); paint(); return; }
      if (step > 0) { step -= 1; render(); paint(); saveDraft(); }
    });
    next.addEventListener('click', () => {
      if (mode === 'diff') { commit(toRecord(year, v, existing)); return; }
      if (blocked()) return;
      if (step < 7) { step += 1; render(); paint(); saveDraft(); return; }
      finish();
    });

    const commit = async (rec) => {
      if (rec) await DB.put('allocations', rec);
      if (v.couple) await DB.put('meta', { key: 'efSplitMode', value: 'equal', updatedAt: new Date().toISOString() });
      await DB.put('meta', { key: 'planSetupDone', value: { year, at: new Date().toISOString() } });
      await DB.del('meta', 'planSetupDraft').catch(() => {});
      ui._allocYear = year;
      root.remove();
      document.body.classList.remove('locked');
      toast('Yearly plan saved. You can edit it any time on Expense > Yearly plan.');
      resolve();
    };
    // Something already stored for this year (an import or an earlier plan) that differs: show both, ask first.
    const finish = () => {
      const diff = existing ? diffAgainst(existing, v) : [];
      if (!existing) { commit(toRecord(year, v, null)); return; }
      if (!diff.length) { commit(null); return; }
      mode = 'diff';
      scroll.innerHTML = '';
      scroll.appendChild(el('h1', { class: 'onboard-h ps-h', text: 'Update your ' + year + ' plan?' }));
      scroll.appendChild(el('p', { class: 'onboard-sub', text: 'You already have a plan for this year. These lines would change. Nothing else is touched.' }));
      scroll.appendChild(el('div', { class: 'ps-diff' }, diff.map((r) => el('div', { class: 'ps-diff-row' }, [
        el('span', { class: 'ps-diff-label', text: r.label }),
        el('span', { class: 'ps-diff-old', text: inr(r.old) }),
        el('span', { class: 'ps-diff-arrow', text: '→' }),
        el('b', { class: 'ps-diff-new', text: inr(r.now) }),
      ]))));
      strip.innerHTML = '';
      back.style.display = '';
      next.disabled = false;
      next.textContent = 'Update my plan';
    };

    render();
    paint();
  });
}
