// Privacy Policy + Terms of Use. Plain data (no imports) so the app, the landing page and privacy.html share one copy.
export const LEGAL_UPDATED = '19 September 2026';
export const LEGAL_CONTACT = 'gopalakrishnan.venkatachalapathy@sifycorp.com';

export const PRIVACY = [
  ['The short version', [
    'Your financial records - every amount, holding, expense, note and vault item - stay on your own device. They are never uploaded, and we cannot see them or recover them for you.',
    'We plan to count, anonymously, which features of MyNotes are used, so we can improve it. That count carries no name, no contact details and no financial data, and you can turn it off at any time. Nothing is counted today: it starts only when our analytics service launches.',
    'Your age group and gender are separate: they are only ever sent if you choose to give them.',
    'There is no advertising, and we never sell or rent anything we collect.',
  ]],
  ['What is stored, and where', [
    'Everything you add (investments, expenses, loans, notes, vault items, settings) is stored in your browser/app storage on this device only.',
    'Backups are files you choose to save, in a folder or location you pick (for example a folder synced by your own Google Drive). They never go to our servers.',
    'Your Vault is encrypted on your device with your master password. We cannot read it and cannot reset the password - if you forget it, the vault cannot be opened.',
    'Your optional Marketaux API key is stored on this device and, like everything else, is included in the backup files you make - so keep those files somewhere private.',
    'Your name, if you give one, is stored on this device (and in your own backup files) and is never sent to us.',
  ]],
  ['What leaves your device (only when you use these features)', [
    'Metal rates: when you are online and open Home or a metals screen, your device requests public gold/silver rates from api.gold-api.com and open.er-api.com, at most about once a day (or when you tap refresh). No personal data or holdings are sent.',
    'Mutual fund NAV: when you fetch NAVs, fund names you typed are sent to mfapi.in (public AMFI data) to find the fund. No amounts or units are sent.',
    'News Feed (optional, off until you add your own key): stock names are sent to Marketaux together with your own API key.',
    'Receipt scan (OCR): the text-recognition library and its English language data are downloaded from public content-delivery hosts (such as cdn.jsdelivr.net) when you scan. The photo itself is read on your device and is not uploaded.',
    'Checking for updates: your device asks the site that hosts MyNotes for the latest app files. Like any website, that host may keep ordinary server logs (IP address, time, page requested).',
    'These services have their own privacy policies. If you never use these features, nothing is sent.',
  ]],
  ['Usage information', [
    'Once our analytics service launches, MyNotes will count, anonymously, which features are used and basic app and device details, as described in the Privacy Policy. You can turn this off at any time from Menu > Privacy & Terms. Age group and gender are optional and are only sent if you give them.',
    'You must be 18 or over to use MyNotes.',
    'Your financial records are never part of this and never leave your device.',
  ]],
  ['Third-party services and changes', [
    'Features that rely on third-party services may stop working if those services change. We may update or discontinue features; we will try to keep export of your data working.',
    'Continued use after an update means you accept the updated terms.',
  ]],
  ['Governing law', [
    'These terms are governed by the laws of India, with courts in India having jurisdiction, unless your local consumer law says otherwise.',
  ]],
];



export function renderLegal(el, which) {
  const blocks = (secs) => secs.flatMap(([h, ps]) => [
    el('h3', { text: h }),
    el('ul', {}, ps.map((p) => el('li', { text: p }))),
  ]);
  const w = which === 'terms' ? 'terms' : 'privacy';
  return [
    el('h2', { text: w === 'terms' ? 'Terms of Use' : 'Privacy Policy' }),
    el('p', { class: 'legal-date', text: 'Last updated ' + LEGAL_UPDATED }),
    ...blocks(w === 'terms' ? TERMS : PRIVACY),
  ];
}
