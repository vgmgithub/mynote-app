// Website landing page: shown when MyNotes is opened in an ordinary browser tab
// instead of as an installed app. It explains the app, lets the visitor try the
// feature picker before installing, and shows how to install it.
import { el, APP_MODULES, canInstall, triggerInstall } from './app.js';
import { DB } from './db.js';

const FREE_PICKS = 5;

const PLATFORM = (() => {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
})();

const GUIDES = {
  android: {
    title: 'Android (Chrome)',
    steps: [
      'Tap the ⋮ menu at the top right.',
      'Tap "Install app" (or "Add to Home screen").',
      'Tap Install - MyNotes appears on your home screen.',
    ],
  },
  ios: {
    title: 'iPhone / iPad (Safari)',
    steps: [
      'Tap the Share button (the square with an arrow).',
      'Scroll down and tap "Add to Home Screen".',
      'Tap Add - MyNotes appears on your home screen.',
    ],
  },
  desktop: {
    title: 'Computer (Chrome / Edge)',
    steps: [
      'Click the install icon at the right of the address bar.',
      'Or open the ⋮ menu and choose "Install MyNotes".',
      'Click Install - it opens in its own window.',
    ],
  },
};

// Sample screens, so the app can be seen before it is installed. The figures are
// made up; the layout mirrors the real thing.
const row = (left, right, cls) => el('div', { class: 'lp-row' }, [
  el('span', { class: 'lp-row-l', text: left }),
  el('span', { class: 'lp-row-r ' + (cls || ''), text: right }),
]);
const statCard = (label, value, badge, good) => el('div', { class: 'lp-stat' }, [
  el('span', { class: 'lp-stat-l', text: label }),
  el('span', { class: 'lp-stat-v' }, [value, badge ? el('span', { class: 'lp-pill ' + (good ? 'good' : 'bad'), text: badge }) : null].filter(Boolean)),
]);
const sectionCard = (ico, title, sub) => el('div', { class: 'lp-card' }, [
  el('span', { class: 'lp-card-ico', text: ico }),
  el('span', {}, [el('span', { class: 'lp-card-t', text: title }), el('span', { class: 'lp-card-s', text: sub })]),
  el('span', { class: 'lp-card-arrow', text: '›' }),
]);

const DEMOS = [
  {
    id: 'home', label: 'Home', build: () => [
      el('div', { class: 'lp-stats' }, [
        statCard('Total invested', '₹4,82,000'),
        statCard('Total earned', '₹88,640', '+18.4%', true),
      ]),
      el('div', { class: 'lp-due' }, [
        el('span', { class: 'lp-due-badge', text: '⏰ Coming up' }),
        el('span', { class: 'lp-due-text', text: 'FD matures in 3 days · ₹1,04,200' }),
      ]),
      sectionCard('💼', 'Investment', 'Stocks · MF · FD · Gold'),
      sectionCard('💳', 'Expense', 'Budget · Cards · Tracker'),
      sectionCard('🩺', 'Health Check', 'Reports · Family history'),
    ],
  },
  {
    id: 'invest', label: 'Investments', build: () => [
      el('div', { class: 'lp-stats' }, [
        statCard('Portfolio value', '₹5,70,640'),
        statCard('Returns (XIRR)', '14.2%', 'Above', true),
      ]),
      el('div', { class: 'lp-list' }, [
        row('Stocks · 12 holdings', '+21.5%', 'good'),
        row('Mutual funds · 6 SIPs', '+13.8%', 'good'),
        row('Fixed deposits · 4 active', '7.4% p.a.'),
        row('Gold · 42 g', '+9.1%', 'good'),
        row('Bonds · 2 active', '11.5% p.a.'),
      ]),
    ],
  },
  {
    id: 'expense', label: 'Expenses', build: () => [
      el('div', { class: 'lp-budget' }, [
        el('div', { class: 'lp-budget-top' }, [
          el('span', { text: 'Left this month' }),
          el('b', { text: '₹12,480' }),
        ]),
        el('div', { class: 'lp-bar' }, [el('span', { style: 'width:62%' })]),
        el('div', { class: 'lp-budget-foot', text: '₹640 a day for 19 days left' }),
      ]),
      el('div', { class: 'lp-list' }, [
        row('Grocery', '₹8,240'),
        row('Rent & bills', '₹18,000'),
        row('Eat out', '₹3,120'),
        row('Fuel', '₹2,400'),
        row('Refund', '-₹899', 'good'),
      ]),
    ],
  },
  {
    id: 'health', label: 'Health', build: () => [
      el('div', { class: 'lp-person' }, [
        el('span', { class: 'lp-avatar', text: '🧑' }),
        el('span', {}, [el('span', { class: 'lp-card-t', text: 'Ravi · 38' }), el('span', { class: 'lp-card-s', text: 'Last check: 12 Aug 2026' })]),
      ]),
      el('div', { class: 'lp-list' }, [
        row('Fasting sugar', '96 mg/dL ✓', 'good'),
        row('HbA1c', '5.4 % ✓', 'good'),
        row('LDL', '142 mg/dL ↑', 'bad'),
        row('Haemoglobin', '14.8 g/dL ✓', 'good'),
        row('BP systolic', '128 mmHg ✓', 'good'),
      ]),
    ],
  },
];

const FAQS = [
  ['Is it really free?', 'Any 5 features, free forever. Pro unlocks all ' + APP_MODULES.length + ' later.'],
  ['Where is my data stored?', 'On your device only. No server, no copy anywhere else.'],
  ['What if I lose my phone?', 'Back up from inside the app and keep a copy on Drive. Restoring brings it all back.'],
  ['Do I need internet?', 'No. Only live rates and news need it.'],
  ['Is it on the app store?', 'No. It installs from this page in about 10 seconds.'],
];

export function showLanding() {
  document.querySelectorAll('.landing').forEach((n) => n.remove());
  document.body.classList.add('locked');

  // ---- install buttons ----
  const installBtns = [];
  const note = el('div', { class: 'landing-note hidden' });
  const refreshInstall = () => {
    const ready = canInstall();
    installBtns.forEach((b) => { b.textContent = (b.dataset.short === '1' ? (ready ? 'Install' : 'How to install') : (ready ? 'Install free - 10 seconds' : 'How to install')); });
  };
  const goSteps = () => {
    const box = document.getElementById('landing-install');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const onInstallTap = async () => {
    if (!canInstall()) { goSteps(); return; }
    if (await triggerInstall()) {
      note.textContent = '🎉 Installed! Open MyNotes from your home screen.';
      note.classList.remove('hidden');
    }
    refreshInstall();
  };
  const installBtn = (cls, short) => {
    const b = el('button', { class: 'landing-btn ' + cls, type: 'button', onclick: onInstallTap });
    if (short) b.dataset.short = '1';
    installBtns.push(b);
    return b;
  };

  // ---- interactive demo phone ----
  const screen = el('div', { class: 'lp-screen' });
  const tabs = el('div', { class: 'lp-tabs' });
  const dots = el('div', { class: 'lp-dots' });
  let demoIx = 0, demoTimer = null;
  // dir: 'next' slides in from the right, 'prev' from the left, none = fade.
  const showDemo = (i, dir) => {
    demoIx = i;
    screen.innerHTML = '';
    screen.classList.remove('is-in', 'dir-next', 'dir-prev');
    if (dir) screen.classList.add('dir-' + dir);
    DEMOS[i].build().forEach((n) => screen.appendChild(n));
    void screen.offsetWidth;
    screen.classList.add('is-in');
    tabs.querySelectorAll('button').forEach((b, ix) => b.classList.toggle('on', ix === i));
    dots.querySelectorAll('span').forEach((d, ix) => d.classList.toggle('on', ix === i));
    // Keep the active tab in view when swiping moves past the visible ones.
    const on = tabs.querySelector('.lp-tab.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  };
  const stopAuto = () => { clearInterval(demoTimer); demoTimer = null; };
  const goTo = (i, dir) => { stopAuto(); showDemo((i + DEMOS.length) % DEMOS.length, dir); };
  DEMOS.forEach((d, i) => {
    tabs.appendChild(el('button', {
      class: 'lp-tab', type: 'button', text: d.label,
      onclick: () => goTo(i, i > demoIx ? 'next' : i < demoIx ? 'prev' : null),
    }));
    dots.appendChild(el('span', { class: 'lp-dot-nav', onclick: () => goTo(i, i > demoIx ? 'next' : 'prev') }));
  });
  const phone = el('div', { class: 'lp-phone' }, [
    el('div', { class: 'lp-phone-bar' }, [el('span', { class: 'lp-notch' })]),
    el('div', { class: 'lp-phone-head' }, [
      el('img', { class: 'lp-phone-logo', src: 'icons/icon-192.png', alt: '' }),
      el('span', { class: 'lp-phone-title', text: 'MyNotes' }),
      el('span', { class: 'lp-phone-dots', text: '⋮' }),
    ]),
    screen,
  ]);

  // Swipe the phone left / right to move between screens (touch and mouse drag).
  // Mostly-vertical drags are left alone so the page still scrolls.
  let sx = 0, sy = 0, tracking = false;
  const swipeStart = (x, y) => { sx = x; sy = y; tracking = true; };
  const swipeEnd = (x, y) => {
    if (!tracking) return;
    tracking = false;
    const dx = x - sx, dy = y - sy;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) goTo(demoIx + 1, 'next'); else goTo(demoIx - 1, 'prev');
  };
  phone.addEventListener('touchstart', (e) => { const t = e.touches[0]; swipeStart(t.clientX, t.clientY); }, { passive: true });
  phone.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; swipeEnd(t.clientX, t.clientY); }, { passive: true });
  phone.addEventListener('mousedown', (e) => swipeStart(e.clientX, e.clientY));
  phone.addEventListener('mouseup', (e) => swipeEnd(e.clientX, e.clientY));
  phone.addEventListener('mouseleave', () => { tracking = false; });
  const swipeHint = el('div', { class: 'lp-swipe-hint', text: '← swipe →' });

  // ---- try-it feature picker ----
  const picks = new Set();
  const counter = el('div', { class: 'lp-pick-count' });
  const pickMsg = el('div', { class: 'lp-pick-msg' });
  const savePicks = () => { DB.put('meta', { key: 'landingPicks', value: [...picks] }).catch(() => {}); };
  const updatePicks = () => {
    counter.innerHTML = '';
    for (let i = 0; i < FREE_PICKS; i++) counter.appendChild(el('span', { class: 'lp-dot' + (i < picks.size ? ' on' : '') }));
    counter.appendChild(el('span', { class: 'lp-pick-n', text: picks.size + ' of ' + FREE_PICKS + ' picked' }));
    pickMsg.textContent = picks.size === 0
      ? 'Tap the ones you would actually use.'
      : picks.size < FREE_PICKS
        ? 'Nice. ' + (FREE_PICKS - picks.size) + ' more included free.'
        : 'That is your free plan ready. Install and it starts with these.';
    pickMsg.classList.toggle('is-full', picks.size === FREE_PICKS);
  };
  const tileFor = (m) => {
    const need = m.requires && APP_MODULES.find((x) => x.id === m.requires);
    const tile = el('button', { class: 'lp-tile', type: 'button' }, [
      el('span', { class: 'lp-tile-ico', text: m.icon }),
      el('span', { class: 'lp-tile-name', text: m.label }),
      el('span', { class: 'lp-tile-tick', text: '✓' }),
    ]);
    tile.addEventListener('click', () => {
      if (picks.has(m.id)) picks.delete(m.id);
      else if (picks.size >= FREE_PICKS) {
        pickMsg.textContent = 'Free plan covers ' + FREE_PICKS + '. Unpick one, or get them all with Pro later.';
        pickMsg.classList.add('is-full');
        return;
      } else if (need && !picks.has(need.id)) {
        pickMsg.textContent = m.label + ' works together with ' + need.label + ' - pick that first.';
        return;
      } else picks.add(m.id);
      // Dividends cannot stand without Stocks.
      APP_MODULES.forEach((x) => { if (x.requires && !picks.has(x.requires)) picks.delete(x.id); });
      grid.querySelectorAll('.lp-tile').forEach((t, ix) => t.classList.toggle('on', picks.has(APP_MODULES[ix].id)));
      updatePicks();
      savePicks();
    });
    return tile;
  };
  const grid = el('div', { class: 'lp-tiles' }, APP_MODULES.map(tileFor));
  updatePicks();

  // ---- FAQ ----
  const faq = el('div', { class: 'lp-faq' }, FAQS.map(([q, a]) => {
    const item = el('div', { class: 'lp-faq-item' }, [
      el('button', { class: 'lp-faq-q', type: 'button' }, [el('span', { text: q }), el('span', { class: 'lp-faq-plus', text: '+' })]),
      el('div', { class: 'lp-faq-a', text: a }),
    ]);
    item.querySelector('.lp-faq-q').addEventListener('click', () => item.classList.toggle('open'));
    return item;
  }));

  // ---- install guides ----
  const order = [PLATFORM, ...['android', 'ios', 'desktop'].filter((p) => p !== PLATFORM)];
  const guides = order.map((p, i) => {
    const g = el('div', { class: 'landing-guide' + (i === 0 ? ' is-yours open' : '') }, [
      el('button', { class: 'landing-guide-head', type: 'button' }, [
        el('span', { text: GUIDES[p].title }),
        i === 0 ? el('span', { class: 'landing-yours', text: 'Your device' }) : el('span', { class: 'lp-faq-plus', text: '+' }),
      ]),
      el('ol', {}, GUIDES[p].steps.map((t) => el('li', { text: t }))),
    ]);
    g.querySelector('.landing-guide-head').addEventListener('click', () => g.classList.toggle('open'));
    return g;
  });

  const point = (ico, title, text) => el('div', { class: 'landing-point' }, [
    el('span', { class: 'landing-point-ico', text: ico }),
    el('div', {}, [el('b', { text: title }), el('div', { text })]),
  ]);

  const page = el('div', { class: 'landing' }, [
    el('div', { class: 'landing-scroll' }, [
      el('header', { class: 'landing-hero' }, [
        el('span', { class: 'lp-kicker', text: '⚡ No account · No ads · Works offline' }),
        el('h1', {}, ['Your whole money life,', el('br'), el('span', { class: 'lp-grad', text: 'private on your phone' })]),
        el('p', { class: 'landing-lead', text: 'Money, health and passwords in one app - stored on your phone, never online.' }),
        el('button', { class: 'landing-btn ghost', type: 'button', text: 'See it first ↓', onclick: () => document.getElementById('lp-demo').scrollIntoView({ behavior: 'smooth', block: 'start' }) }),
        note,
        el('div', { class: 'landing-badges' }, [
          el('span', { text: '🔒 Data never leaves you' }),
          el('span', { text: '🆓 5 features free' }),
          el('span', { text: '⏱️ 10-second install' }),
        ]),
      ]),

      el('section', { class: 'landing-sec lp-reveal', id: 'lp-demo' }, [
        el('h2', { text: 'Take a look inside' }),
        el('p', { class: 'landing-sub', text: 'Sample data - tap to explore.' }),
        tabs,
        phone,
        dots,
        swipeHint,
      ]),

      el('section', { class: 'landing-sec lp-reveal' }, [
        el('h2', { text: 'Pick your 5 free features' }),
        el('p', { class: 'landing-sub', text: 'Pick any ' + FREE_PICKS + ' of ' + APP_MODULES.length + ', free. We remember them for you.' }),
        counter,
        grid,
        pickMsg,
      ]),

      el('section', { class: 'landing-sec lp-reveal' }, [
        el('h2', { text: 'Why it is different' }),
        el('div', { class: 'landing-points' }, [
          point('🔒', 'Private by design', 'Saved on your phone, nowhere else.'),
          point('🚫', 'No account, no cloud', 'No sign-up, no ads, no tracking.'),
          point('📴', 'Works offline', 'Open it anywhere, any time.'),
          point('🗄️', 'Backups you control', 'Saved where you choose.'),
        ]),
      ]),

      el('section', { class: 'landing-sec lp-reveal' }, [
        el('h2', { text: 'Questions' }),
        faq,
      ]),

      el('section', { class: 'landing-sec lp-reveal', id: 'landing-install' }, [
        el('img', { class: 'landing-install-logo', src: 'icons/icon-192.png', alt: 'MyNotes' }),
        el('h2', { text: 'Install MyNotes' }),
        el('p', { class: 'landing-sub', text: 'Straight from this page - no app store.' }),
        el('div', { class: 'landing-guides' }, guides),
        el('p', { class: 'landing-fine', text: 'Then open MyNotes from your home screen.' }),
      ]),

      el('footer', { class: 'landing-foot', text: 'MyNotes · 5 features free · Stays on your device.' }),
    ]),
    el('div', { class: 'landing-bar' }, [
      el('div', { class: 'landing-bar-text' }, [
        el('b', { text: 'Free forever for 5 features' }),
        el('span', { text: 'No account · No ads' }),
      ]),
      installBtn('primary', true),
    ]),
  ]);

  document.body.appendChild(page);
  // Sections fill the visible area (the scroller, not the whole window - the
  // install bar takes its own strip), so their content sits centred on screen.
  const scroller = page.querySelector('.landing-scroll');
  const fitSections = () => page.style.setProperty('--lp-vh', scroller.clientHeight + 'px');
  fitSections();
  // The bar's height changes once its button text is set, so follow the scroller live.
  if ('ResizeObserver' in window) new ResizeObserver(fitSections).observe(scroller);
  else window.addEventListener('resize', fitSections);
  showDemo(0);
  refreshInstall();

  // Cycle the demo until the visitor takes over.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) demoTimer = setInterval(() => { if (demoTimer) showDemo((demoIx + 1) % DEMOS.length, 'next'); }, 3800);

  // Reveal sections as they scroll in.
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -10% 0px' });
    page.querySelectorAll('.lp-reveal').forEach((n) => io.observe(n));
  } else {
    page.querySelectorAll('.lp-reveal').forEach((n) => n.classList.add('in'));
  }

  window.addEventListener('beforeinstallprompt', () => setTimeout(refreshInstall, 0));
  window.addEventListener('appinstalled', () => {
    note.textContent = '🎉 Installed! Open MyNotes from your home screen.';
    note.classList.remove('hidden');
  });
}
