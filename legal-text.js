// Privacy Policy + Terms of Use. Plain data (no imports) so the app, the landing page and privacy.html share one copy.
export const LEGAL_UPDATED = '19 September 2026';
export const LEGAL_CONTACT = 'gopalakrishnan.venkatachalapathy@sifycorp.com';

export const PRIVACY = [
  ['The short version', [
    'Your financial records - every amount, holding, expense, note and vault item - stay on your own device. They are never uploaded, and we cannot see them or recover them for you.',
    'Sharing usage information is your choice. If you agree, we count which features you use, plus your age group and gender, so we can improve MyNotes. If you skip it, nothing about your use of the app is sent. It never includes your financial data either way.',
    'There is no advertising, and we never sell or rent anything we collect.',
  ]],
  ['What is stored, and where', [
    'Everything you add (investments, expenses, loans, notes, vault items, settings) is stored in your browser/app storage on this device only.',
    'Backups are files you choose to save, in a folder or location you pick (for example a folder synced by your own Google Drive). They never go to our servers.',
    'Your Vault is encrypted on your device with your master password. We cannot read it and cannot reset the password - if you forget it, the vault cannot be opened.',
    'Your optional Marketaux API key is stored only on this device.',
    'Your name, if you give one, is stored only on this device and is never sent anywhere.',
  ]],
  ['What leaves your device (only when you use these features)', [
    'Metal rates: when you are online and open Home or a metals screen, your device requests public gold/silver rates from api.gold-api.com and open.er-api.com. No personal data or holdings are sent.',
    'Mutual fund NAV: when you fetch NAVs, fund names you typed are sent to mfapi.in (public AMFI data) to find the fund. No amounts or units are sent.',
    'News Feed (optional, off until you add your own key): stock names are sent to Marketaux together with your own API key.',
    'Receipt scan (OCR): the text-recognition library is downloaded from cdn.jsdelivr.net when you first scan. The photo itself is read on your device and is not uploaded.',
    'Checking for updates: your device asks the site that hosts MyNotes for the latest app files. Like any website, that host may keep ordinary server logs (IP address, time, page requested).',
    'These services have their own privacy policies. If you never use these features, nothing is sent.',
  ]],
  ['Usage information (only if you choose to share)', [
    'When you first set up MyNotes you are asked, on a separate optional page after choosing your features, whether you would like to help improve the app. You can skip it, and you can change your mind at any time in Menu > Usage data.',
    'If you skip, or later turn sharing off, nothing about your use of the app is sent. MyNotes works exactly the same.',
    'If you share, we may receive: the features you have switched on, your age group (a range, never a date of birth), your gender, your plan (free or paid), app version, device type and operating system, and a random install identifier that is not linked to your identity.',
    'We also see your rough region - for example "India, English". It comes from your device\'s time zone and language setting, so MyNotes never asks for location permission, never uses GPS and never records where you are.',
    'What it is never: your amounts, holdings, transactions, categories, notes, names of funds or stocks, vault contents, or anything you type into a record. We never ask for or collect your name, email address, phone number or any other contact detail. Your own name is optional, is only used to greet you, and stays on this device.',
    'Why: to see which features are worth building on and which are unused, and to support paid plans.',
    'It is sent only when your device is online, and MyNotes keeps working fully offline without it. The rules are the same on free and paid plans.',
  ]],
  ['What we do not do', [
    'We do not collect, sell, share or rent your financial data, and we never sell or rent the usage information you choose to share.',
    'We do not use advertising SDKs or third-party tracking cookies.',
    'We do not ask for bank logins, card numbers or passwords to any financial account.',
  ]],
  ['Your control', [
    'Settings > Clear all data erases everything on this device. Removing the app or clearing browser site data does the same, and cannot be undone unless you kept a backup.',
    'You can export a full backup and import it again at any time.',
  ]],
  ['Age', [
    'MyNotes is for adults aged 18 and over. It is not directed at children, and we do not knowingly collect any information from anyone under 18.',
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
    'Backups are free and unlimited. On the free plan, a backup can be restored on the same device it was made on (including after you reinstall the app on that device). Restoring a backup onto a different device is part of the paid plan. Until the paid plan launches, this limit is not enforced.',
    'App lock is a convenience to keep casual viewers out; it is not a substitute for your device passcode and disk encryption.',
  ]],
  ['Acceptable use', [
    'Use MyNotes for your own lawful personal record-keeping. Do not attempt to copy, resell, reverse-engineer for resale, or disrupt the app or the services it uses.',
  ]],
  ['Plans and pricing', [
    'Our aim is to give you almost every feature for free. The free plan includes any 5 features of your choice, and you can change your choice at any time. You pay only if you want more, such as extra features or moving your data to another device. Paid features will be described before you buy.',
    'Your data is never held hostage: you can always export a full backup of your own data, for free, without limit.',
    'Everyday use works offline on both plans. Some advanced paid features may also run online, and those will say so; your records still stay on your device.',
  ]],
  ['Usage information', [
    'Sharing basic usage information (the features you use, your age group and gender, your plan, app version, device type and rough region) is optional. You agree to it only by choosing to share on the set-up page or in Menu > Usage data, and you can turn it off at any time. The app works the same either way.',
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
