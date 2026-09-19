// Privacy Policy + Terms of Use. Plain data (no imports) so the app, the landing page and privacy.html share one copy.
export const LEGAL_UPDATED = '19 September 2026';
export const LEGAL_CONTACT = 'gopalakrishnan.venkatachalapathy@sifycorp.com';

export const PRIVACY = [
  ['The short version', [
    'Your financial records - every amount, holding, expense, note and vault item - stay on your own device. They are never uploaded, and we cannot see them or recover them for you.',
    'We do collect basic usage information: which features you switch on and simple app and device details. This tells us which features people actually use so we can improve MyNotes. It never includes your financial data.',
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
  ['Usage information we collect', [
    'What it is: which of the features you have switched on, your plan (free or paid), app version, device type and operating system, rough region, and a random install identifier that is not linked to your identity.',
    'What it is never: your amounts, holdings, transactions, categories, notes, names of funds or stocks, vault contents, or anything you type into a record. Your own name is never sent either - it is optional, it is only used to greet you, and it stays on this device whether you enter it now, later or never.',
    'Every install is counted the same way, by its random identifier, whether or not you enter a name. Skipping the name costs you nothing.',
    'Why: to see which features are worth building on and which are unused, and to support paid plans.',
    'It is sent only when your device is online, and MyNotes keeps working fully offline without it.',
    'Collecting this is part of using MyNotes, on both the free and paid plans. If you would rather not share it, please do not use the app.',
  ]],
  ['What we do not do', [
    'We do not collect, sell, share or rent your financial data, and we never sell or rent the usage information above.',
    'We do not use advertising SDKs or third-party tracking cookies.',
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
    'The free plan includes any 5 features of your choice. Paid features will be described before you buy. Existing data is never held hostage: you can always export your own data.',
    'Everyday use works offline on both plans. Some advanced paid features may also run online, and those will say so; your records still stay on your device.',
  ]],
  ['Usage information', [
    'By using MyNotes you agree that we may collect basic usage information - the features you switch on, your plan, app version, device type, operating system and rough region - as set out in the Privacy Policy. This applies to free and paid plans alike.',
    'Your financial records are never part of this and never leave your device.',
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
