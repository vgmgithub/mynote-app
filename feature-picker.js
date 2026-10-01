import { restoreFromOutsideFile, AGE_BANDS, APP_VERSION, GENDERS, _backupRecordCount, appConfirm, applyAppMode, b, closeModal, dataCount, el, ensureAlias, exportData, field, getAlias, getUserName, hideLoader, markBackedUp, openLegal, openModal, recordLegalAcceptance, refresh, saveUsageProfile, saveUserName, showLoader, state, toast } from './app.js';
import { handleFor } from './alias.js';
import { addAnalysisOnce, normaliseModuleIds, reqsMet, reqsOf, trimAutoAddedCc, websitePicks } from './feature-limit.js';
import { IS_PRODUCTION } from './config.js';
import { DB } from './db.js';
import { sendUsage } from './sender.js';
import { betaOfferBanner } from './beta-ui.js';
import { calc } from './core.js';
import { APP_FOLDER_NAME, fileSystemAccessSupported, pickFolder, writeBackup } from './backup.js';
import { runPlanSetupIfNeeded } from './plan-setup-ui.js';
import { ANNUAL_PRICE, ANNUAL_SAVE_PCT, MONTHLY_PRICE, NOT_ON_SALE, buildCompareHeader, buildPlanCompare } from './plan-compare.js';

// Every feature is on by default. A new user picks what they want; the rest
// are hidden from Home (their data is untouched, just not shown).
export const APP_MODULES = [
  { id: 'stocks', icon: '📈', label: 'Stocks', desc: 'Holdings, monthly returns, heatmap' },
  { id: 'mf', icon: '📊', label: 'Mutual Funds', desc: 'SIPs, returns (XIRR), NAV updates' },
  { id: 'fd', icon: '🏦', label: 'Fixed Deposits', desc: 'Maturity dates and interest' },
  { id: 'metal', icon: '🪙', label: 'Gold & Silver', desc: 'Grams held and value' },
  { id: 'bond', icon: '🧾', label: 'Bonds', desc: 'Coupons and maturity' },
  { id: 'div', icon: '💰', label: 'Dividends', desc: 'Dividends per stock, year by year', requires: 'stocks' },
  { id: 'ef', icon: '🚨', label: 'Emergency Fund', desc: 'A savings pot with targets and loans' },
  { id: 'banksav', icon: '🐷', label: 'Bank Savings', desc: 'Balances across your bank accounts' },
  // Took the place of the Inflation Calculator ('inflation' in older saved choices and backups is read as this - see
  // LEGACY_MODULE_IDS in feature-limit.js). Inflation is one of its tabs now.
  { id: 'calc', icon: '🧮', iconSrc: 'icons/inflation-calc.svg', label: 'Financial Calculators', desc: 'FD, compound interest, inflation, where money could go' },
  { id: 'expense', icon: '🛒', label: 'Expenses', desc: 'Household spending, cash flow and yearly plan' },
  { id: 'cc', icon: '💳', label: 'Credit Cards', desc: 'Card bills, limits and month by month view' },
  { id: 'personal', icon: '👛', iconSrc: 'icons/personal-finance.png', label: 'Personal Spending', desc: 'Your own card/UPI spend and limits' },
  // A view over Expenses and/or Personal Spending, with nothing stored of its own: either one is enough.
  { id: 'analysis', icon: '🔎', label: 'Analysis', desc: 'Spending trends, forecasts and an AI prompt', requires: ['expense', 'personal'] },
  { id: 'health', icon: '🩺', label: 'Health Check', desc: 'Family lab results and trends' },
  { id: 'vault', icon: '🔐', label: 'Password Vault', desc: 'Encrypted passwords, only on this device' },
];
// Presentation only: how the Choose features screen groups its cards. Nothing reads this for gating, limits
// or dependencies; a feature missing from every group is still shown, under "More".
const PICKER_GROUPS = [
  ['\u{1F4B3}', 'Spending', ['expense', 'personal', 'cc', 'analysis']],
  ['\u{1F4C8}', 'Investments', ['stocks', 'mf', 'fd', 'metal', 'bond', 'div']],
  ['\u{1F3AF}', 'Planning', ['ef', 'banksav', 'calc']],
  ['\u2764\uFE0F', 'Family', ['health']],
  ['\u{1F510}', 'Security', ['vault']],
];
export let _modsCache = null;
// Once per app open is enough for the one-time Analysis step: renderHome asks for the choice on every redraw.
let _analysisChecked = false;
export async function getEnabledModules() {
  const r = await DB.get('meta', 'enabledModules').catch(() => null);
  const saved = r && Array.isArray(r.value) ? r.value : null;
  // Read the way everything reads it: an old id (a backup from before Financial Calculators still says 'inflation')
  // becomes what it is now, an id that no longer exists is dropped, so neither can hold one of the five slots.
  const list = saved ? normaliseModuleIds(saved, APP_MODULES) : null;
  _modsCache = list ? new Set(list) : null;
  // Credit Cards used to be part of Expenses, and an old migration switched it on for anyone who had Expenses. It
  // ran for brand-new installs too, so a person who picked five features got a sixth they never chose. It no longer
  // adds anything (what is picked is what is on). An install already put over the Free limit that way has the added
  // Credit Cards taken off again; its records are kept. See feature-limit.js.
  try {
    // The cleaned list is written back, so the picker, the trim below and any backup taken from here all agree.
    if (saved && (list.length !== saved.length || list.some((id, i) => id !== saved[i]))) {
      await DB.put('meta', { key: 'enabledModules', value: list });
    }
    // Review moved from Expenses and Personal Finance into Analysis. Once per install (the marker travels in backups,
    // so an old backup restored later gets the same one-time step): a Free choice with room gets Analysis added; a
    // full one is told where Review went instead. A brand-new install has no choice yet, so it is only marked.
    if (!_analysisChecked) {
      if (!(await DB.get('meta', 'analysisMigrated'))) {
        if (_modsCache) {
          const a = addAnalysisOnce([..._modsCache], FREE_FEATURE_LIMIT, isPaidPlan());
          if (a.added) { _modsCache = new Set(a.enabled); await DB.put('meta', { key: 'enabledModules', value: a.enabled }); }
          if (a.full) await DB.put('meta', { key: 'reviewMovedNote', value: 'show' });
        }
        await DB.put('meta', { key: 'analysisMigrated', value: true });
      }
      _analysisChecked = true;
    }
    if (_modsCache && !(await DB.get('meta', 'ccSplit'))) await DB.put('meta', { key: 'ccSplit', value: true });
    if (_modsCache) {
      const t = trimAutoAddedCc([..._modsCache], FREE_FEATURE_LIMIT, isPaidPlan());
      if (t.changed) {
        _modsCache = new Set(t.enabled);
        await DB.put('meta', { key: 'enabledModules', value: t.enabled });
      }
    }
  } catch (_) {}
  // A Pro member has every feature: nothing is chosen, nothing is limited. The saved choice is left
  // untouched (in meta) in case the plan ever goes back to free.
  if (isPaidPlan()) _modsCache = new Set(APP_MODULES.map((m) => m.id));
  return _modsCache;
}
export const isPaidPlan = () => document.body.dataset.plan === 'paid' || document.body.dataset.plan === 'beta';
// Beta member/contributor: same full access as Pro (isPaidPlan covers both), but its own icon and its own
// menu row (Request Beta / weekly feedback), never the Pro upsell.
export const isBetaPlan = () => document.body.dataset.plan === 'beta';
// The one place that picks the app icon for a plan value ('paid' | 'beta' | anything else = free),
// so Home's title icon, the onboarding logo and the plan-change crossfade never fall out of step.
export const planIcon = (plan) => (plan === 'paid' ? 'icons/icon-pro.png' : plan === 'beta' ? 'icons/icon-beta.png' : 'icons/icon-free.png');
// A feature that depends on another (Dividends need Stocks; Analysis needs Expenses or Personal Spending) is off
// whenever what it needs is off, so every screen, total and reminder stays consistent. Built from APP_MODULES, so the
// dependency is written down in one place only.
const MODULE_REQUIRES = Object.fromEntries(APP_MODULES.filter((m) => m.requires).map((m) => [m.id, reqsOf(m)]));
// A module's icon: its own image when it has one (Personal Spending uses the
// same money note as its Home card), otherwise the emoji.
export function moduleIcon(m) {
  return m.iconSrc ? el('img', { src: m.iconSrc, alt: '', class: 'mod-ico-img' }) : document.createTextNode(m.icon);
}
export const modOn = (set, id) => !set || (set.has(id) && reqsMet(set, MODULE_REQUIRES[id]));
// Free plan: any 5 features. (Paid tiers will lift this later.)
export const FREE_FEATURE_LIMIT = 5;

// The Free Plan vs Pro Plan comparison, the same table as the website (tap a row to read what it means).
//
// The footer is where somebody acts on what they have just read, so the buy button lives there - but ONLY where a
// payment can really be taken. On the live app Pro is not on sale yet, and the Terms, the Privacy text and this
// very table all say so; offering a purchase there would be a promise the app cannot keep. So the button appears
// on staging and locally, where Razorpay runs in test mode, and the live app keeps its Close button until
// purchases genuinely open.
// Two buy buttons - Monthly and Annual - built once and used wherever Pro can be bought (the plan
// comparison here, and the per-feature Pro sheet below), so the three sheets that offer a purchase
// stay in lockstep rather than each hand-rolling its own pair. `onStarted` runs before checkout opens -
// every caller uses it to close its own sheet first, so Razorpay's window is never behind another.
// Production: the Monthly / Annual buttons answer with this - a small rocket on the pad and a plain "not on sale yet,
// nothing is charged". Its own layer over whatever sheet holds the buttons, so that sheet is still there after OK.
export function showProComingSoon(period, price) {
  if (document.querySelector('.pro-cs-back')) return;
  let back = null;
  const done = () => { if (back) { back.remove(); back = null; } document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') done(); };
  const ok = el('button', { class: 'btn primary pro-cs-ok', type: 'button', text: 'OK, got it', onclick: done });
  back = el('div', { class: 'pro-cs-back', onclick: (e) => { if (e.target === back) done(); } }, [
    el('div', { class: 'pro-cs', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'proSoonTitle' }, [
      el('img', { class: 'pro-cs-art', src: 'icons/coming-soon.svg', alt: '' }),
      el('h3', { id: 'proSoonTitle', class: 'pro-cs-title', text: 'Pro is coming soon' }),
      el('p', { class: 'pro-cs-text', text: 'The ' + (period === 'annual' ? 'Annual' : 'Monthly') + ' plan (' + price + ') is not on sale yet, so nothing is charged. Everything on the Free Plan keeps working as it is.' }),
      ok,
    ]),
  ]);
  document.body.appendChild(back);
  document.addEventListener('keydown', onKey);
  ok.focus();
}
export function _buyPeriodButtons(onStarted) {
  const go = (period, price) => async () => {
    // Production shows the price but does not sell yet: a tap says it is coming soon and nothing starts.
    if (IS_PRODUCTION) { showProComingSoon(period, price); return; }
    onStarted();
    const { startProCheckout } = await import('./pay.js');
    startProCheckout(period);
  };
  const btn = (period, label, price, sub) => {
    const b = el('button', { class: 'btn primary plan-compare-buy plan-buy-btn plan-buy-' + period, type: 'button' }, [
      el('span', { class: 'plan-buy-text' }, [
        el('b', { text: label + ' \u00b7 ' + price }),
        sub ? el('span', { class: 'plan-buy-sub', text: sub }) : null,
      ].filter(Boolean)),
    ]);
    b.addEventListener('click', go(period, price));
    return b;
  };
  return el('div', { class: 'plan-buy-row' }, [
    btn('monthly', 'Monthly', MONTHLY_PRICE),
    btn('annual', 'Annual', ANNUAL_PRICE, 'save ' + ANNUAL_SAVE_PCT + '%'),
  ]);
}

async function showProInfo() {
  // Not for somebody who already has Pro, and not where a payment cannot be taken.
  const canBuy = !IS_PRODUCTION && !isPaidPlan();
  // Production shows the same Monthly / Annual buttons with their prices; tapping says "coming soon".
  const buyRow = (canBuy || (IS_PRODUCTION && !isPaidPlan())) ? _buyPeriodButtons(closeModal) : null;
  // A Beta member or someone whose Beta just ended may be holding a locked-in post-Beta price: shown
  // here (not the free/beta member either way, since it never contradicts the standard price above).
  let offerBanner = null;
  try { offerBanner = await betaOfferBanner(); } catch (_) {}
  // The title and Close stay put; only the table itself scrolls, so the sheet never runs off the screen.
  openModal(el('div', { class: 'sheet pro-sheet plan-compare-sheet has-fixed-footer' }, [
    el('div', { class: 'plan-compare-head' }, [
      el('h2', {}, [el('img', { class: 'pro-title-star', src: 'icons/emoji/pro-star.png', alt: '' }), document.createTextNode('Free Plan or Pro Plan')]),
      el('p', { class: 'hint', text: 'Your ' + FREE_FEATURE_LIMIT + ' Free Plan features stay free. Pro is planned at ' + MONTHLY_PRICE + '/mo or ' + ANNUAL_PRICE + '/yr, unlocking everything for as long as you stay subscribed. ' + NOT_ON_SALE }),
      offerBanner,
    ].filter(Boolean)),
    el('div', { class: 'plan-compare-thead' }, [buildCompareHeader()]),
    el('div', { class: 'sheet-scroll plan-compare-body' }, [buildPlanCompare(FREE_FEATURE_LIMIT, APP_MODULES.length, { noHeader: true })]),
    el('div', { class: 'sheet-footer' }, [
      // Said plainly, because the amount on the button is real money everywhere else.
      canBuy ? el('p', { class: 'hint plan-buy-note', text: 'Test mode: no real money is taken. Cancel anytime.' }) : null,
      buyRow,
      el('div', { class: 'plan-footer-btns' }, [
        el('button', { class: 'btn ' + (canBuy ? 'ghost' : 'primary') + ' plan-compare-close', type: 'button', text: 'Close', onclick: closeModal }),
      ]),
    ].filter(Boolean)),
  ]));
}

// Home's app icon crossfades to the Pro icon and the PRO badge pops in. The Home re-render that follows draws the
// same Pro icon, so nothing visibly jumps.
// Both directions: Free to Pro pops the badge in, Pro to Free fades it out and returns the original icon.
export async function playPlanChange(plan) {
  const full = plan === 'paid' || plan === 'beta';
  const img = document.querySelector('#homeView .home-title-ico');
  if (full) {
    document.body.classList.add('plan-flipped');
    setTimeout(() => document.body.classList.remove('plan-flipped'), 2800);
  }
  if (!img || state.appMode !== 'home') return;
  const pill = document.querySelector('#homeView .pro-pill');
  if (!full && pill) pill.classList.add('is-leaving');
  img.classList.add('is-swapping');
  await new Promise((r) => setTimeout(r, 260));
  img.src = planIcon(plan);
  img.classList.toggle('is-pro', full);
  img.classList.remove('is-swapping');
  await new Promise((r) => setTimeout(r, 320));
}

export function openFeaturePicker(opts) {
  const first = !!(opts && opts.first);
  // Pro members have everything, so there is nothing to pick (the welcome screen still runs on a fresh install).
  if (isPaidPlan() && !first) { toast('All features are unlocked with the Pro Plan.'); return Promise.resolve(); }
  // required: features were never chosen (e.g. a restored backup) - no way out but to choose.
  const required = !!(opts && opts.required);
  document.querySelectorAll('.onboard').forEach((n) => n.remove());
  return Promise.all([
    getEnabledModules(),
    // What the visitor picked on the website before installing, so the app opens
    // with those already ticked instead of an empty list.
    DB.get('meta', 'landingPicks').catch(() => null),
  ]).then(([cur, picked]) => {
    const pre = cur || (picked && Array.isArray(picked.value) ? new Set(normaliseModuleIds(picked.value, APP_MODULES)) : null);
    const chosen = new Set(pre ? APP_MODULES.filter((m) => pre.has(m.id)).map((m) => m.id) : []);
    // Set when the website's five were taken as the choice (goChoose), so the next page can say so.
    let webApplied = null;
    const root = el('div', { class: 'onboard' });
    document.body.appendChild(root);
    document.documentElement.classList.add('locked'); document.body.classList.add('locked');
    const close = () => { root.remove(); document.documentElement.classList.remove('locked'); document.body.classList.remove('locked'); };
    const finish = () => {
      close();
      applyAppMode('home');
      if (first && !isPaidPlan()) toast('You can change features anytime: Menu → Settings → Choose features');
      // Pro's guided yearly plan comes after the shared steps (name, optional age/gender, first backup).
      if (isPaidPlan()) runPlanSetupIfNeeded();
    };

    // One-time, first-run only. Teaches why a backup matters (nothing is online),
    // then creates the app's own backup folder (or, where folders aren't
    // supported, downloads a first backup file). Picking a location needs a tap:
    // browsers don't allow doing it silently.
    // First run only, after features are chosen: a separate, skippable page about the two
    // OPTIONAL details (age group, gender). The anonymous feature counts are already
    // disclosed and can be turned off in Menu > Privacy & Terms; skipping here changes
    // nothing about them.
    const stepAbout = () => {
      root.innerHTML = '';
      const ageSel = el('select', { 'aria-label': 'Age group' }, AGE_BANDS.map((v) => el('option', { value: v, text: v || 'Prefer not to say' })));
      const genSel = el('select', { 'aria-label': 'Gender' }, GENDERS.map((v) => el('option', { value: v, text: v || 'Prefer not to say' })));
      // The name never leaves this device (it only greets you on Home), so it is kept whether they Share or Skip.
      const nameIn = el('input', { class: 'onboard-name', type: 'text', maxlength: '30', placeholder: 'Your first name (optional)', autocomplete: 'given-name', 'aria-label': 'Your name' });
      // Skip and Share both save whatever is in this box, so a name already here (a restored backup) must start in it
      // - an empty box would otherwise delete it.
      getUserName().then((n) => { if (n && !nameIn.value) nameIn.value = n; }).catch(() => {});
      // The anonymous name is settled here, once, using the gender if one was just given. See stepAlias.
      // The anonymous name is settled here, once, using the gender if one was just given. The name is made on this
      // device so it is instant and works with no internet; the server then confirms it (it holds the unique index)
      // and may hand back a different one if this name was already taken.
      const settle = async (gender) => {
        await ensureAlias(gender);
        try { await Promise.race([sendUsage(), new Promise((r) => setTimeout(r, 4000))]); } catch (_) { /* offline: the name stands and is confirmed on the next send */ }
      };
      const share = async () => {
        await saveUserName(nameIn.value);
        await saveUsageProfile({ share: true, ageBand: ageSel.value, gender: genSel.value });
        showLoader('Setting up your anonymous name\u2026');
        await settle(genSel.value);
        hideLoader();
        stepAlias();
      };
      const skip = async () => {
        await saveUserName(nameIn.value);
        await saveUsageProfile({ share: false });
        showLoader('Setting up your anonymous name\u2026');
        await settle('');
        hideLoader();
        stepAlias();
      };
      root.appendChild(el('div', { class: 'onboard-scroll onboard-welcome' }, [
        // Said here, on the page itself: a toast would sit behind this full-screen setup and never be seen.
        ...(webApplied ? [el('div', { class: 'onboard-web-set' }, [
          el('b', { text: '\u2713 Your ' + webApplied.length + ' features from the website are set' }),
          el('span', { text: webApplied.map((id) => (APP_MODULES.find((m) => m.id === id) || { label: id }).label).join(' \u00b7 ') }),
          el('small', { text: 'Change them anytime in Menu \u2192 Settings.' }),
        ])] : []),
        el('div', { class: 'onboard-about-ico', text: '📊' }),
        el('h1', { class: 'onboard-h', text: 'Help us improve MyNotes' }),
        el('p', { class: 'onboard-sub', text: 'All optional. Here is exactly what we use.' }),
        el('div', { class: 'onboard-demo onboard-demo-page' }, [
          el('label', { class: 'onboard-name-wrap' }, [
            el('span', { text: 'What should we call you?' }),
            nameIn,
            el('small', { class: 'onboard-field-note', text: 'Only greets you on Home. Never leaves this device.' }),
          ]),
          el('div', { class: 'onboard-demo-row' }, [
            el('label', {}, [el('span', { text: 'Age group' }), ageSel]),
            el('label', {}, [el('span', { text: 'Gender' }), genSel]),
          ]),
          el('small', { class: 'onboard-field-note', text: 'Counted with the features you chose, so we know who to build for.' }),
        ]),
        el('p', { class: 'onboard-demo-sub onboard-about-skip', text: 'Nothing else is taken: never your money data, notes or contacts. Skip and MyNotes works exactly the same.' }),
      ]));
      root.appendChild(el('div', { class: 'onboard-bar' }, [
        el('button', { class: 'btn ghost', type: 'button', text: 'Skip', onclick: skip }),
        el('button', { class: 'btn primary', type: 'button', text: 'Share', onclick: share }),
      ]));
    };
    // Shown to everyone, Free and Pro, right after the age/gender page: the name they can quote to get help
    // without telling us who they are.
    const stepAlias = async () => {
      root.innerHTML = '';
      const handle = handleFor(await getAlias());
      const copy = el('button', { class: 'btn ghost alias-copy', type: 'button', text: 'Copy', onclick: async () => {
        try { await navigator.clipboard.writeText(handle); toast('Copied ' + handle); } catch (_) { toast(handle); }
      } });
      root.appendChild(el('div', { class: 'onboard-scroll onboard-welcome' }, [
        el('div', { class: 'onboard-about-ico', text: '\u{1FAAA}' }),
        el('h1', { class: 'onboard-h', text: 'This is your anonymous name' }),
        el('p', { class: 'onboard-sub', text: 'Quote it if you ever need help from us.' }),
        el('div', { class: 'alias-card' }, [
          el('div', { class: 'alias-row' }, [el('code', { class: 'alias-name', text: handle }), copy]),
        ]),
        el('p', { class: 'onboard-demo-sub', text: 'It is not your real name and nobody else sees it. Tell us this name and we can look into a problem without you revealing who you are. You will find it any time under Menu.' }),
        el('p', { class: 'onboard-demo-sub onboard-about-skip', text: 'It is chosen once and stays the same, so a name you gave us weeks ago still finds you.' }),
      ]));
      root.appendChild(el('div', { class: 'onboard-bar' }, [
        el('button', { class: 'btn primary', type: 'button', text: 'Continue', onclick: stepBackup }),
      ]));
    };
    const stepBackup = () => {
      root.innerHTML = '';
      const canFolder = fileSystemAccessSupported();
      const risks = [
        ['📱', 'Phone lost or stolen', 'Everything you entered is gone. There is no online copy to recover it from.'],
        ['🧹', 'App data cleared', 'Clearing app or browser storage erases all your records instantly.'],
        ['💥', 'Crash or factory reset', 'A device failure or reset wipes local data. A backup brings it back in one tap.'],
      ];
      const riskCards = risks.map(([ico, t, d]) => {
        const card = el('button', { class: 'onboard-risk', type: 'button' }, [
          el('span', { class: 'onboard-risk-ico', text: ico }),
          el('span', { class: 'onboard-risk-t', text: t }),
          el('span', { class: 'onboard-risk-more', text: '+' }),
          el('span', { class: 'onboard-risk-d', text: d }),
        ]);
        card.addEventListener('click', () => card.classList.toggle('open'));
        return card;
      });
      const stepsBox = el('div', { class: 'onboard-steps' }, (canFolder
        ? ['You pick where to keep it', 'We create a "' + APP_FOLDER_NAME + '" folder just for this app', 'Back up anytime in Menu → Backup & Restore']
        : ['We save a backup file to your Downloads', 'Keep a copy somewhere safe (cloud drive, email, another device)', 'Back up again anytime in Menu → Backup & Restore']
      ).map((t, i) => el('div', { class: 'onboard-step' }, [el('span', { class: 'onboard-step-n', text: String(i + 1) }), el('span', { text: t })])));

      const done = (title, msg) => {
        root.innerHTML = '';
        root.appendChild(el('div', { class: 'onboard-scroll onboard-welcome' }, [
          el('div', { class: 'onboard-done-tick', text: '✓' }),
          el('h1', { class: 'onboard-h', text: title }),
          el('p', { class: 'onboard-sub', text: msg }),
          el('p', { class: 'onboard-sub', text: 'Tip: back up regularly, and keep a second copy of the backup file on Google Drive or another device. We will remind you when it has been a while.' }),
        ]));
        root.appendChild(el('div', { class: 'onboard-bar' }, [el('button', { class: 'btn primary', type: 'button', text: 'Continue', onclick: finish })]));
      };

      const warn = el('div', { class: 'onboard-warn hidden' }, [
        el('b', { text: 'Skip the backup?' }),
        el('div', { text: 'If this device crashes or is lost, your data cannot be recovered. You can set it up later in Menu → Backup & Restore.' }),
        el('div', { class: 'onboard-warn-btns' }, [
          el('button', { class: 'btn primary small', type: 'button', text: 'Set it up now', onclick: () => warn.classList.add('hidden') }),
          el('button', { class: 'btn ghost small', type: 'button', text: 'Skip anyway', onclick: finish }),
        ]),
      ]);
      const primary = el('button', { class: 'btn primary', type: 'button', text: canFolder ? 'Create backup folder' : 'Download my first backup' });
      primary.addEventListener('click', async () => {
        primary.disabled = true;
        try {
          if (canFolder) {
            const h = await pickFolder();
            const data = await DB.exportAll();
            if (_backupRecordCount(data) > 0) {
              await writeBackup(h, data);
              await markBackedUp();
              done('Backup is ready', 'Your backups will be saved in the "' + (h.name || APP_FOLDER_NAME) + '" folder. A first backup is already there.');
            } else {
              // Nothing entered yet: an empty backup could overwrite a good one in this folder.
              done('Backup folder is ready', 'Your backups will be saved in the "' + (h.name || APP_FOLDER_NAME) + '" folder. Add some data, then tap Back up now on the Home screen.');
            }
          } else {
            if (_backupRecordCount(await DB.exportAll()) === 0) {
              done('You are all set', 'Add some data first, then tap Back up now on the Home screen to save your first backup file.');
              return;
            }
            await exportData();
            done('First backup saved', 'The backup file is in your Downloads folder. Keep a copy somewhere safe, such as a cloud drive, email or another device.');
          }
        } catch (e) {
          primary.disabled = false;
          if (e && e.name !== 'AbortError') toast('Could not create the backup. You can do it later in Menu → Backup & Restore.');
        }
      });

      root.appendChild(el('div', { class: 'onboard-scroll onboard-welcome' }, [
        el('div', { class: 'onboard-shield', text: '🛡️' }),
        el('h1', { class: 'onboard-h', text: 'Your data lives only on this device' }),
        el('p', { class: 'onboard-sub', text: 'Nothing is stored online, so a backup is your only safety net.' }),
        el('div', { class: 'onboard-risk-label', text: 'Tap to see what can go wrong' }),
        el('div', { class: 'onboard-risks' }, riskCards),
        el('div', { class: 'onboard-risk-label', text: canFolder ? 'Set it up in one tap' : 'How it works' }),
        stepsBox,
        warn,
      ]));
      root.appendChild(el('div', { class: 'onboard-bar' }, [
        el('button', { class: 'btn ghost', type: 'button', text: 'Skip for now', onclick: () => { warn.classList.remove('hidden'); warn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }),
        primary,
      ]));
    };

    const stepChoose = () => {
      root.innerHTML = '';
      const count = el('span', { class: 'onboard-count' });
      const cont = el('button', { class: 'btn primary', type: 'button' });
      const refresh = () => {
        count.textContent = chosen.size + ' of ' + FREE_FEATURE_LIMIT + ' selected';
        cont.textContent = first ? 'Continue' : 'Save';
        cont.disabled = chosen.size === 0 || chosen.size > FREE_FEATURE_LIMIT;
      };
      // `grid` is still the one container holding every card (Clear uses it); the cards now sit in category sections inside it.
      const grid = el('div', { class: 'onboard-groups' });
      const cards = new Map();
      // A dependent feature is locked, and dropped, while nothing it needs is chosen: Dividends without Stocks,
      // Analysis without either Expenses or Personal Spending.
      const syncDeps = () => {
        APP_MODULES.forEach((m) => {
          if (!m.requires) return;
          const card = cards.get(m.id);
          const locked = !reqsMet(chosen, reqsOf(m));
          if (locked) chosen.delete(m.id);
          card.disabled = locked;
          card.classList.toggle('locked', locked);
          card.classList.toggle('on', chosen.has(m.id));
        });
      };
      const labelOf = (id) => (APP_MODULES.find((x) => x.id === id) || { label: id }).label;
      // Turning off something a chosen feature is built on says so first, rather than quietly taking that feature
      // with it. Nothing is deleted either way: this is only about what shows.
      const warnDependents = (m) => {
        const without = new Set(chosen); without.delete(m.id);
        const hit = APP_MODULES.filter((d) => chosen.has(d.id) && reqsOf(d).includes(m.id));
        if (!hit.length) return Promise.resolve(true);
        const lines = hit.map((d) => {
          const src = reqsOf(d).map(labelOf).join(' / ');
          return reqsMet(without, reqsOf(d))
            ? d.label + ' uses your ' + src + ' data. Turning off ' + m.label + ' may limit ' + d.label + '.'
            : d.label + ' uses your ' + src + ' data. Turning off ' + m.label + ' turns off ' + d.label + ' too.';
        });
        return appConfirm(lines.join('\n\n') + '\n\nYour data is kept either way.', { okText: 'Turn off ' + m.label, danger: false });
      };
      APP_MODULES.forEach((m) => {
        const needs = reqsOf(m).map(labelOf);
        const card = el('button', { class: 'onboard-opt' + (chosen.has(m.id) ? ' on' : ''), type: 'button' }, [
          el('span', { class: 'onboard-opt-ico' }, [moduleIcon(m)]),
          el('span', { class: 'onboard-opt-name', text: m.label }),
          el('span', { class: 'onboard-opt-desc', text: m.desc }),
          needs.length ? el('span', { class: 'onboard-opt-need', text: '* Requires ' + needs.join(' or ') }) : null,
          el('span', { class: 'onboard-opt-tick', text: '✓' }),
        ].filter(Boolean));
        cards.set(m.id, card);
        card.addEventListener('click', async () => {
          if (!chosen.has(m.id) && chosen.size >= FREE_FEATURE_LIMIT) {
            appConfirm('You have picked your ' + FREE_FEATURE_LIMIT + ' Free Plan features.\n\nWant ' + m.label + ' too? Unlock all ' + APP_MODULES.length + ' features with the Pro Plan, or deselect one to swap.',
              { okText: 'See the Pro Plan', danger: false }).then((go) => { if (go) showProInfo(); });
            return;
          }
          if (chosen.has(m.id)) {
            if (!(await warnDependents(m))) return;
            chosen.delete(m.id);
          } else chosen.add(m.id);
          card.classList.toggle('on', chosen.has(m.id));
          syncDeps();
          refresh();
        });
      });
      const placed = new Set();
      const addGroup = (icon, title, ids) => {
        const inner = el('div', { class: 'onboard-grid' });
        ids.forEach((id) => { const c = cards.get(id); if (c) { inner.appendChild(c); placed.add(id); } });
        if (!inner.children.length) return;
        grid.appendChild(el('section', { class: 'onboard-cat' }, [
          el('h2', { class: 'onboard-cat-h' }, [el('span', { class: 'onboard-cat-ico', 'aria-hidden': 'true', text: icon }), document.createTextNode(title)]),
          inner,
        ]));
      };
      PICKER_GROUPS.forEach(([icon, title, ids]) => addGroup(icon, title, ids));
      addGroup('\u2728', 'More', APP_MODULES.map((m) => m.id).filter((id) => !placed.has(id)));
      syncDeps();
      cont.addEventListener('click', async () => {
        await DB.put('meta', { key: 'enabledModules', value: [...chosen] });
        _modsCache = new Set(chosen);
        await DB.put('meta', { key: 'onboarded', value: true });
        if (first) { stepAbout(); return; }
        sendUsage().catch(() => {});
        finish();
      });
      root.appendChild(el('div', { class: 'onboard-scroll' }, [
        el('h1', { class: 'onboard-h', text: 'Choose up to ' + FREE_FEATURE_LIMIT + ' tools to get started' }),
        el('div', { class: 'onboard-pro' }, [
          el('div', { class: 'onboard-pro-badge', text: '⭐ FREE PLAN' }),
          el('div', { class: 'onboard-pro-title', text: 'Try any ' + FREE_FEATURE_LIMIT + ' features, free' }),
          el('div', { class: 'onboard-pro-text', text: 'Love them? Unlock all ' + APP_MODULES.length + ' features with the Pro Plan - every tool, one simple plan, your data still only on your device.' }),
          el('button', { class: 'onboard-pro-btn', type: 'button', text: 'Unlock all features', onclick: showProInfo }),
        ]),
        grid,
      ]));
      root.appendChild(el('div', { class: 'onboard-bar onboard-bar-note' }, [
        el('p', { class: 'onboard-bar-hint', text: 'You can switch your picks anytime, and your existing data stays safe.' }),
        count,
        ...(first || required ? [] : [el('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: close })]),
        cont,
      ]));
      refresh();
    };

    if (!first) { stepChoose(); return; }
    const goChoose = async () => {
      await recordLegalAcceptance();
      // Pro has nothing to pick, but still gets the name and the optional age/gender page; the picker is the only
      // step it skips. stepAbout leads on to the backup step, which ends the flow for both plans.
      if (isPaidPlan()) { stepAbout(); return; }
      // Picked all five on the website before installing? Then that is the choice: saved here, after the terms were
      // accepted (the website only keeps it aside as landingPicks, so it can never skip the welcome), and the picker
      // is not asked again. Fewer than five, or none, and the picker opens with them already ticked.
      const web = websitePicks(picked && picked.value, APP_MODULES, FREE_FEATURE_LIMIT);
      if (!cur && web.length === FREE_FEATURE_LIMIT) {
        await DB.put('meta', { key: 'enabledModules', value: web });
        _modsCache = new Set(web);
        await DB.put('meta', { key: 'onboarded', value: true });
        webApplied = web;
        stepAbout();
        return;
      }
      stepChoose();
    };
    // Every card is an icon tile, a title and exactly two lines. `icon` is an emoji or a ready-made node (the Pro star).
    const point = (icon, title, text, cls) => el('div', { class: 'onboard-point' + (cls ? ' ' + cls : '') }, [
      el('span', { class: 'onboard-point-ico', 'aria-hidden': 'true' }, [typeof icon === 'string' ? document.createTextNode(icon) : icon]),
      el('div', { class: 'onboard-point-body' }, [el('b', { text: title }), el('p', { text })]),
    ]);
    const proStar = () => el('img', { class: 'onboard-pro-star', src: 'icons/emoji/pro-star.png', alt: '' });
    root.appendChild(el('div', { class: 'onboard-scroll onboard-welcome' }, [
      el('img', { class: 'onboard-logo', src: planIcon(document.body.dataset.plan), alt: '' }),
      el('h1', { class: 'onboard-h', text: 'Welcome to MyNotes' }),
      el('p', { class: 'onboard-sub', text: 'One simple place for your everyday money.' }),
      el('div', { class: 'onboard-points' }, [
        point('\u{1F9E0}', 'Track consciously. Spend intentionally.', 'No SMS or email scanning. Noting each spend yourself builds better habits.', 'onboard-kakeibo'),
        point('\u{1F512}', 'Your records never leave this phone', 'No account, no cloud. Just anonymous usage data, which you can switch off.'),
        ...(isPaidPlan()
          ? [point(proStar(), 'You are on the Pro Plan', 'Every feature is unlocked, and a guided yearly plan comes next.', 'onboard-pro-card')]
          : [
            point('\u{1F381}', 'Free Plan: any 5 features', 'Switch between them anytime without losing data. All basics and analysis included.'),
            point(proStar(), 'Pro Plan', 'Every feature unlocked, plus a guided yearly plan. Coming soon.', 'onboard-pro-card'),
          ]),
      ]),
    ]));
    root.appendChild(el('div', { class: 'onboard-bar onboard-bar-legal' }, [
      el('button', { class: 'btn primary', type: 'button', text: 'Get started', onclick: goChoose }),
      // A new phone, or one whose browser data was cleared: restoring FIRST brings back the data AND the anonymous name,
      // before this phone registers an identity of its own.
      el('button', { class: 'link-btn onboard-restore', type: 'button', text: 'Already have a MyNotes backup? Restore it', onclick: () => restoreFromOutsideFile() }),
      el('p', { class: 'legal-consent' }, [
        el('span', { text: 'By continuing you confirm you are 18 or older and agree to our ' }),
        el('a', { href: '#', text: 'Terms', onclick: (e) => { e.preventDefault(); openLegal('terms'); } }),
        el('span', { text: ' and ' }),
        el('a', { href: '#', text: 'Privacy Policy', onclick: (e) => { e.preventDefault(); openLegal('privacy'); } }),
        el('span', { text: '.' }),
      ]),
      // Which build this is, said plainly and quietly, so nobody has to dig for it.
      el('p', { class: 'legal-consent onboard-ver', text: 'MyNotes v' + APP_VERSION }),
    ]));
  });
}

// Shown when no features have been chosen yet: welcome flow on a fresh install,
// a required picker when data already exists (e.g. a restored backup).
export async function maybeShowOnboarding() {
  try {
    if (isPaidPlan()) {
      // Pro: no feature picker, ever. Only the welcome and consent, and only when they have not been accepted yet.
      const acc = await DB.get('meta', 'legalAccepted').catch(() => null);
      if (!(acc && acc.value)) {
        // Real data already here (most commonly a restored backup) is itself proof this is not a brand-new
        // install, even where legalAccepted did not come along - an old backup that predates this field. The
        // welcome/consent chain is for a genuinely empty install; a data-full one gets the flag healed quietly
        // instead of being sent through Get Started again.
        // Marked as healed, not as an acceptance: nobody confirmed 18+ or a Terms version just now.
        if ((await dataCount()) > 0) { await DB.put('meta', { key: 'legalAccepted', value: { healed: true, at: new Date().toISOString() } }).catch(() => {}); }
        else { await openFeaturePicker({ first: true }); return; }
      }
      await runPlanSetupIfNeeded();
      return;
    }
    if (await getEnabledModules()) return;
    // Data already here but no choice made (a restored backup): choose first,
    // Home is not shown until they do. A truly empty install gets the welcome.
    if ((await dataCount()) > 0) { await openFeaturePicker({ required: true }); return; }
    await openFeaturePicker({ first: true });
  } catch (_) {}
}

export function _homeCard(icon, title, sub, onclick) {
  // `icon` is usually an emoji string, but may be a DOM node (e.g. the metals
  // gold/silver-bar SVG) — append nodes, render strings as text.
  const ico = el('span', { class: 'home-card-ico' });
  if (icon && typeof icon === 'object' && icon.nodeType) ico.appendChild(icon);
  else ico.textContent = icon;
  // The badge slot is empty and hidden unless something fills it (see
  // _perDayBadge). It sits between the text and the chevron and is shorter than
  // the 52px icon, so a card that has one is exactly as tall as one that
  // does not.
  return el('button', { class: 'home-card', type: 'button', onclick }, [
    ico,
    el('span', { class: 'home-card-body' }, [
      el('span', { class: 'home-card-title', text: title }),
      el('span', { class: 'home-card-sub', text: sub }),
    ]),
    el('span', { class: 'home-card-badge hidden' }),
    el('span', { class: 'home-card-arrow', text: '›' }),
  ]);
}

