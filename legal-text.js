// Privacy Policy + Terms of Use. Plain data (no imports) so the app, the landing page and privacy.html share one copy.
export const LEGAL_UPDATED = '19 September 2026';
export const LEGAL_CONTACT = 'gopalakrishnan.venkatachalapathy@sifycorp.com';

export const PRIVACY = [
  ['The short version', [
    'MyNotes keeps everything you enter on your own device. There is no account, no login, no server that stores your data, no advertising and no analytics or tracking.',
    'We (the developer) cannot see your data and cannot recover it for you.',
  ]],
  ['What is stored, and where', [
    'Everything you add (investments, expenses, loans, notes, vault items, settings) is stored in your browser/app storage on this device only.',
    'Backups are files you choose to save, in a folder or location you pick (for example a folder synced by your own Google Drive). They never go to our servers.',
    'Your Vault is encrypted on your device with your master password. We cannot read it and cannot reset the password - if you forget it, the vault cannot be opened.',
    'Your optional Marketaux API key is stored only on this device.',
  ]],
  ['What leaves your device (only when you use these features)', [
    'Metal rates: when you refresh gold/silver prices, your device requests public rates from api.gold-api.com and open.er-api.com. No personal data or holdings are sent.',
    'Mutual fund NAV: when you fetch NAVs, fund names you typed are sent to mfapi.in (public AMFI data) to find the fund. No amounts or units are sent.',
    'News Feed (optional, off until you add your own key): stock names are sent to Marketaux together with your own API key.',
    'Receipt scan (OCR): the text-recognition library is downloaded from cdn.jsdelivr.net when you first scan. The photo itself is read on your device and is not uploaded.',
    'Checking for updates: your device asks the site that hosts MyNotes for the latest app files. Like any website, that host may keep ordinary server logs (IP address, time, page requested).',
    'These services have their own privacy policies. If you never use these features, nothing is sent.',
  ]],
  ['What we do not do', [
    'We do not collect, sell, share or rent your personal or financial data.',
    'We do not use cookies for tracking, advertising SDKs or analytics.',
    'We do not ask for bank logins, card numbers or passwords to any financial account.',
  ]],
  ['Your control', [
    'Settings > Clear all data erases everything on this device. Removing the app or clearing browser site data does the same, and cannot be undone unless you kept a backup.',
    'You can export a full backup and import it again at any time.',
  ]],
  ['Children', [
    'MyNotes is not directed at children under 13 and does not knowingly collect their data (it collects no data at all).',
  ]],
  ['Changes and contact', [
    'If this policy changes, the new version will appear in the app under Menu > Privacy & Terms with a new date.',
    'Questions: ' + LEGAL_CONTACT,
  ]],
];

export const TERMS = [
  ['Not financial advice', [
    'MyNotes is a record-keeping and calculation tool. It is not an investment adviser, research analyst, tax adviser or broker, and is not registered with SEBI or any regulator.',
    'Nothing in the app (totals, returns, allocations, summaries, reminders, "review" or "insight" screens) is a recommendation to buy, sell or hold anything. Decisions are yours; consult a licensed professional for advice.',
  ]],
  ['Accuracy of numbers', [
    'Figures are calculated from what you enter and from third-party data (metal rates, fund NAVs, news). That data can be delayed, wrong or unavailable. Always confirm with your bank, broker, AMC or official statement.',
    'Interest, maturity, XIRR, tax, dividend and loan figures are estimates. The Emergency Fund loan and interest rules are your own household rules, not a lending product.',
    'Metal values are indicative and exclude making charges, GST and dealer spreads.',
  ]],
  ['Your data and backups', [
    'Because data lives only on your device, you are responsible for backups. Data can be lost if you clear browser data, uninstall the app, lose or reset the device, or forget your vault password.',
    'We cannot restore lost data. Back up regularly (Menu > Backup & Restore).',
    'App lock is a convenience to keep casual viewers out; it is not a substitute for your device passcode and disk encryption.',
  ]],
  ['Acceptable use', [
    'Use MyNotes for your own lawful personal record-keeping. Do not attempt to copy, resell, reverse-engineer for resale, or disrupt the app or the services it uses.',
  ]],
  ['Plans and pricing', [
    'The free plan includes any 5 features of your choice. Paid features, if introduced, will work offline and will be described before you buy. Existing data is never held hostage: you can always export your own data.',
  ]],
  ['No warranty and limit of liability', [
    'The app is provided "as is" and "as available", without warranties of any kind, to the fullest extent permitted by law.',
    'To the fullest extent permitted by law, the developer is not liable for any loss (including financial loss, missed payments, wrong decisions or lost data) arising from use of, or inability to use, the app. Nothing here limits liability that cannot be limited by law.',
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
