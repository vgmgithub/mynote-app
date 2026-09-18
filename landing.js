// Website landing page: shown when MyNotes is opened in an ordinary browser tab
// instead of as an installed app. It explains the app and how to install it;
// the app itself only opens once installed.
import { el, APP_MODULES, canInstall, triggerInstall } from './app.js';

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
      'Open this page in Chrome.',
      'Tap the ⋮ menu at the top right.',
      'Tap "Install app" (or "Add to Home screen").',
      'Tap Install, then open MyNotes from your home screen.',
    ],
  },
  ios: {
    title: 'iPhone / iPad (Safari)',
    steps: [
      'Open this page in Safari.',
      'Tap the Share button (the square with an arrow).',
      'Scroll down and tap "Add to Home Screen".',
      'Tap Add, then open MyNotes from your home screen.',
    ],
  },
  desktop: {
    title: 'Computer (Chrome / Edge)',
    steps: [
      'Open this page in Chrome or Edge.',
      'Click the install icon at the right end of the address bar (or ⋮ menu → "Install MyNotes").',
      'Click Install.',
      'Open MyNotes from your apps or desktop.',
    ],
  },
};

export function showLanding() {
  document.querySelectorAll('.landing').forEach((n) => n.remove());
  document.body.classList.add('locked');

  const installBtns = [];
  const note = el('div', { class: 'landing-install-note hidden' });
  const refreshInstall = () => {
    installBtns.forEach((b) => { b.textContent = canInstall() ? 'Install MyNotes' : 'How to install'; });
  };
  const goSteps = () => {
    const box = document.getElementById('landing-install');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const onInstallTap = async () => {
    if (!canInstall()) { goSteps(); return; }
    const ok = await triggerInstall();
    if (ok) {
      note.textContent = 'Installed! Open MyNotes from your home screen or app list.';
      note.classList.remove('hidden');
    }
    refreshInstall();
  };
  const installBtn = (cls) => {
    const b = el('button', { class: 'landing-btn ' + cls, type: 'button', onclick: onInstallTap });
    installBtns.push(b);
    return b;
  };

  const featureGrid = el('div', { class: 'landing-features' }, APP_MODULES.map((m) => el('div', { class: 'landing-tile' }, [
    el('span', { class: 'landing-tile-ico', text: m.icon }),
    el('span', { class: 'landing-tile-name', text: m.label }),
  ])));

  const order = [PLATFORM, ...['android', 'ios', 'desktop'].filter((p) => p !== PLATFORM)];
  const guides = order.map((p) => el('div', { class: 'landing-guide' + (p === PLATFORM ? ' is-yours' : '') }, [
    el('div', { class: 'landing-guide-head' }, [
      el('span', { text: GUIDES[p].title }),
      p === PLATFORM ? el('span', { class: 'landing-yours', text: 'Your device' }) : null,
    ].filter(Boolean)),
    el('ol', {}, GUIDES[p].steps.map((t) => el('li', { text: t }))),
  ]));

  const point = (ico, title, text) => el('div', { class: 'landing-point' }, [
    el('span', { class: 'landing-point-ico', text: ico }),
    el('div', {}, [el('b', { text: title }), el('div', { text })]),
  ]);

  const page = el('div', { class: 'landing' }, [
    el('div', { class: 'landing-scroll' }, [
      el('header', { class: 'landing-hero' }, [
        el('img', { class: 'landing-logo', src: 'icons/icon-192.png', alt: 'MyNotes' }),
        el('h1', { text: 'MyNotes' }),
        el('p', { class: 'landing-tagline', text: 'Your money, in one private place.' }),
        el('p', { class: 'landing-lead', text: 'Track your investments, savings, expenses, health records and passwords in one simple app - with all your data stored only on your device. Nothing is ever stored online.' }),
        installBtn('primary'),
        note,
        el('div', { class: 'landing-badges' }, [
          el('span', { text: '🔒 Data stays on your device' }),
          el('span', { text: '📴 Works offline' }),
          el('span', { text: '🚫 No account needed' }),
        ]),
      ]),

      el('section', { class: 'landing-sec' }, [
        el('h2', { text: 'What is MyNotes?' }),
        el('p', { text: 'MyNotes is a personal finance and life-records notebook. Instead of scattering your money details across spreadsheets, apps and paper, you keep them in one place, on your own phone. It calculates returns, maturity dates, spending limits and more for you - and reminds you of what is coming up.' }),
      ]),

      el('section', { class: 'landing-sec' }, [
        el('h2', { text: 'What you can track' }),
        el('p', { class: 'landing-sub', text: 'Pick only the features you need. The free plan includes any 5 of them; MyNotes Pro (coming soon) unlocks all ' + APP_MODULES.length + '.' }),
        featureGrid,
      ]),

      el('section', { class: 'landing-sec' }, [
        el('h2', { text: 'What we do - and what we do not' }),
        el('div', { class: 'landing-points' }, [
          point('🔒', 'Private by design', 'Everything you enter is saved on your own device. We do not have your data, because it never leaves your phone.'),
          point('🚫', 'No account, no cloud', 'No sign-up, no login, no ads, no tracking. There is nothing online to hack, sell or lose.'),
          point('📴', 'Works without internet', 'Open it anywhere, any time. It only goes online if you choose to fetch live rates or news.'),
          point('🗄️', 'Backups in your control', 'You choose where backups are saved, so you can always restore your data if your phone is lost or reset.'),
        ]),
      ]),

      el('section', { class: 'landing-sec', id: 'landing-install' }, [
        el('h2', { text: 'Install MyNotes on your phone' }),
        el('p', { class: 'landing-sub', text: 'MyNotes installs straight from your browser - no app store needed. It takes about 10 seconds.' }),
        installBtn('primary landing-btn-wide'),
        el('div', { class: 'landing-guides' }, guides),
        el('p', { class: 'landing-fine', text: 'After installing, open MyNotes from your home screen. Opening this web page will always show this guide.' }),
      ]),

      el('footer', { class: 'landing-foot', text: 'MyNotes - free for any 5 features. Your data never leaves your device.' }),
    ]),
    el('div', { class: 'landing-bar' }, [installBtn('primary')]),
  ]);
  document.body.appendChild(page);
  refreshInstall();
  window.addEventListener('beforeinstallprompt', () => setTimeout(refreshInstall, 0));
  window.addEventListener('appinstalled', () => {
    note.textContent = 'Installed! Open MyNotes from your home screen or app list.';
    note.classList.remove('hidden');
  });
}
