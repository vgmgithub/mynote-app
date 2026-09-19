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
    'Not active yet: MyNotes sends no usage information today. The rest of this section describes what will happen once our analytics service launches, and the app will tell you when it does.',
    'Membership check (not active yet, like the rest of this section): once paid plans exist, each time you open MyNotes while online it asks our server whether this install has MyNotes Pro. It sends only the random install identifier, nothing about your features, amounts or notes. This check is separate from the anonymous usage counts and the usage-counts switch does not stop it, because it is how the app knows to show your Pro status. Your status is remembered on your device only and is never part of a backup.',
    'Anonymous usage counts (on unless you turn them off): the features you have switched on, your plan (free or paid), app version, device type and operating system, a country-level region, and a random install identifier that is not linked to your identity. Your region comes from your device\'s time zone and language setting, so MyNotes never asks for location permission and never uses GPS.',
    'We will not store your IP address with these counts, and we will use them only in aggregate to see which features are used and which are not.',
    'You can turn the anonymous usage counts off at any time: Menu > Privacy & Terms, then "Turn off anonymous usage counts". MyNotes works exactly the same either way. Turning them off also asks our server to delete what it holds for this install, and so does Menu > Clear all data. If you are a Pro member, the server keeps only your random install identifier and your membership status, so that your Pro stays valid; everything else about you is erased.',
    'You can see exactly what would be sent, word for word, at Menu > Privacy & Terms, then "Show what MyNotes would send".',
    'Age group and gender are optional and separate. They are sent only if you choose to give them, on the page shown after you pick your features or later from Menu > Help improve MyNotes. You can remove them at any time with the "Remove my age group and gender" button at the top of this Privacy Policy screen. They are a range and a choice, never a date of birth.',
    'What we never collect: your amounts, holdings, transactions, categories, notes, names of funds or stocks, vault contents, or anything you type into a record. We never ask for or collect your name, email address, phone number or any other contact detail. Your own name is optional, is only used to greet you, and stays on this device.',
    'The rules are the same on free and paid plans, and usage information is sent only when your device is online.',
  ]],
  ['What we do not do', [
    'We do not collect, sell, share or rent your financial data, and we never sell or rent usage information.',
    'We do not use advertising SDKs or third-party tracking cookies.',
    'We do not ask for bank logins, card numbers or passwords to any financial account.',
  ]],
  ['Your control', [
    'Menu > Clear all data erases everything on this device. Removing the app or clearing browser site data does the same, and cannot be undone unless you kept a backup.',
    'You can export a full backup and import it again at any time.',
  ]],
  ['Age', [
    'MyNotes is for adults aged 18 and over. When you continue past the welcome screen you confirm that you are 18 or older. It is not directed at children, and we do not knowingly collect any information from anyone under 18.',
    'We keep a note on your device of which version of these documents you accepted, that you confirmed you are 18+, and when. It is stored only on your device.',
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
    'Backups are free and unlimited, and today a backup can be restored on any device. When the paid plan launches, restoring a backup onto a different device is planned to become a paid feature. Restoring on the device the backup was made on (including after you reinstall the app on that device) will stay free. We will tell you in the app before this changes.',
    'App lock is a convenience to keep casual viewers out; it is not a substitute for your device passcode and disk encryption.',
  ]],
  ['Acceptable use', [
    'Use MyNotes for your own lawful personal record-keeping. Do not attempt to copy, resell, reverse-engineer for resale, or disrupt the app or the services it uses.',
  ]],
  ['Plans and pricing', [
    'Our aim is to give you almost every feature for free. The free plan includes any 5 features of your choice, and you can change your choice at any time. You pay only if you want more, such as extra features or, in future, moving your data to another device. Paid features will be described before you buy.',
    'Your data is never held hostage: you can always export a full backup of your own data, for free, without limit.',
    'Everyday use works offline on both plans. Some advanced paid features may also run online, and those will say so; your records still stay on your device.',
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
