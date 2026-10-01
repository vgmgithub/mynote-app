// Medicine Cabinet type icons: one small drawing per type (a scored tablet, a capsule, a syrup bottle, an ointment
// tube...), used on the type tiles, the form header and each medicine's card. Plain SVG strings on a 32 x 32 grid,
// so this file is pure data - nothing here touches the page.
const S = (body) => '<svg viewBox="0 0 32 32" aria-hidden="true">' + body + '</svg>';

export const MED_TYPE_SVG = {
  // Two round tablets seen at an angle - each a thick disc with its score line - one behind the other.
  Tablet: S('<path d="M13 10.5v2.6a7.5 4.2 0 0 0 15 0v-2.6z" fill="#93c5fd" stroke="#1d4ed8" stroke-width="1.2" stroke-linejoin="round"/>'
    + '<ellipse cx="20.5" cy="10.5" rx="7.5" ry="4.2" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.2"/>'
    + '<path d="M16.2 10.5h8.6" stroke="#60a5fa" stroke-width="1.2" stroke-linecap="round"/>'
    + '<path d="M2.5 18.5v3.4a10 5.6 0 0 0 20 0v-3.4z" fill="#cbd5e1" stroke="#475569" stroke-width="1.3" stroke-linejoin="round"/>'
    + '<ellipse cx="12.5" cy="18.5" rx="10" ry="5.6" fill="#ffffff" stroke="#475569" stroke-width="1.3"/>'
    + '<path d="M6.5 18.5h12" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>'),
  // A two-colour capsule, tilted.
  Capsule: S('<g transform="rotate(-40 16 16)"><rect x="5" y="11" width="22" height="10" rx="5" fill="#ffffff"/>'
    + '<path d="M16 11h6a5 5 0 0 1 0 10h-6z" fill="#ef4444"/>'
    + '<rect x="5" y="11" width="22" height="10" rx="5" fill="none" stroke="#475569" stroke-width="1.5"/>'
    + '<path d="M16 11v10" stroke="#475569" stroke-width="1.5"/><path d="M8.5 14.2h4" stroke="#cbd5e1" stroke-width="1.4" stroke-linecap="round"/></g>'),
  // An amber syrup bottle with a white cap and a label.
  Syrup: S('<rect x="12" y="2.5" width="8" height="5" rx="1.3" fill="#f8fafc" stroke="#475569" stroke-width="1.3"/>'
    + '<path d="M13 7.5h6v2.7c3 1 5.2 3.3 5.2 6.5V26a3 3 0 0 1-3 3H10.8a3 3 0 0 1-3-3v-9.3c0-3.2 2.2-5.5 5.2-6.5z" fill="#d97706" stroke="#92400e" stroke-width="1.3" stroke-linejoin="round"/>'
    + '<rect x="10" y="16.5" width="12" height="7.5" rx="1.2" fill="#fff7ed"/>'
    + '<path d="M16 18.2v4.2M13.9 20.3h4.2" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round"/>'
    + '<path d="M10.4 12.6c1-.9 2-1.4 3-1.7" stroke="#fbbf24" stroke-width="1.3" stroke-linecap="round" fill="none"/>'),
  // A dropper bottle and a drop.
  Drops: S('<path d="M13.5 2.5h3l1.6 6.5h-6.2z" fill="#f1f5f9" stroke="#475569" stroke-width="1.3" stroke-linejoin="round"/>'
    + '<rect x="9.5" y="9" width="11" height="17" rx="3" fill="#38bdf8" stroke="#0369a1" stroke-width="1.3"/>'
    + '<rect x="11.5" y="14.5" width="7" height="6" rx="1" fill="#e0f2fe"/>'
    + '<path d="M25.5 17.5c0 0 3.2 3.8 3.2 5.8a3.2 3.2 0 0 1-6.4 0c0-2 3.2-5.8 3.2-5.8z" fill="#0ea5e9" stroke="#0369a1" stroke-width="1"/>'),
  // A tube of ointment.
  'Cream / ointment': S('<g transform="rotate(-32 16 16)">'
    + '<path d="M6 11.5h15l3 1.6v5.8l-3 1.6H6z" fill="#f8fafc" stroke="#475569" stroke-width="1.3" stroke-linejoin="round"/>'
    + '<rect x="3" y="10.8" width="3.4" height="10.4" rx=".8" fill="#cbd5e1" stroke="#475569" stroke-width="1.1"/>'
    + '<path d="M3.9 13h1.6M3.9 16h1.6M3.9 19h1.6" stroke="#64748b" stroke-width=".9"/>'
    + '<rect x="9.5" y="13.4" width="8" height="5.2" rx="1" fill="#a7f3d0"/>'
    + '<rect x="24" y="13.4" width="4.2" height="5.2" rx="1" fill="#10b981" stroke="#047857" stroke-width="1.1"/></g>'),
  // A blue canister in its inhaler, mouthpiece to the right.
  Inhaler: S('<rect x="11" y="2.5" width="7.5" height="14" rx="2.6" fill="#60a5fa" stroke="#1d4ed8" stroke-width="1.3"/>'
    + '<path d="M8.5 15a2 2 0 0 1 2-2h8.5a2 2 0 0 1 2 2v7h5.2a2 2 0 0 1 2 2v2.6a2 2 0 0 1-2 2H10.5a2 2 0 0 1-2-2z" fill="#e2e8f0" stroke="#475569" stroke-width="1.3" stroke-linejoin="round"/>'
    + '<path d="M25 25.2h2" stroke="#475569" stroke-width="1.3" stroke-linecap="round"/>'),
  // A syringe.
  Injection: S('<g transform="rotate(45 16 16)">'
    + '<rect x="12" y="1.5" width="8" height="2.2" rx="1.1" fill="#475569"/><rect x="15" y="3.5" width="2" height="5.5" fill="#475569"/>'
    + '<rect x="10.5" y="8.6" width="11" height="2.2" rx="1.1" fill="#94a3b8"/>'
    + '<rect x="12" y="10.5" width="8" height="13" rx="1.6" fill="#e0f2fe" stroke="#0369a1" stroke-width="1.3"/>'
    + '<rect x="12.7" y="16.5" width="6.6" height="6.3" fill="#38bdf8"/>'
    + '<path d="M13.5 13.5h2.2M13.5 16.3h2.2M13.5 19.1h2.2" stroke="#0369a1" stroke-width="1"/>'
    + '<rect x="15" y="23.5" width="2" height="2.6" fill="#94a3b8"/><path d="M16 26.1v4.6" stroke="#475569" stroke-width="1.2" stroke-linecap="round"/></g>'),
  // A sachet with a torn zigzag top.
  'Powder / sachet': S('<path d="M8 6.5l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V27a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" fill="#fde68a" stroke="#b45309" stroke-width="1.3" stroke-linejoin="round"/>'
    + '<rect x="11" y="11.5" width="10" height="7.5" rx="1.2" fill="#ffffff"/>'
    + '<path d="M16 13.2v4.2M13.9 15.3h4.2" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round"/>'
    + '<circle cx="12.2" cy="23.5" r="1" fill="#b45309"/><circle cx="16" cy="24.6" r="1" fill="#b45309"/><circle cx="19.8" cy="23.5" r="1" fill="#b45309"/>'),
  // A nasal spray with a puff of mist.
  Spray: S('<path d="M14.5 2.5h3v6.5h-3z" fill="#f1f5f9" stroke="#475569" stroke-width="1.2"/>'
    + '<rect x="11" y="9" width="10" height="3" rx="1" fill="#94a3b8"/>'
    + '<rect x="10" y="12" width="12" height="17" rx="3" fill="#a78bfa" stroke="#6d28d9" stroke-width="1.3"/>'
    + '<rect x="12" y="16.5" width="8" height="6.5" rx="1.1" fill="#ede9fe"/>'
    + '<circle cx="21" cy="4.5" r="1.1" fill="#a78bfa"/><circle cx="24.2" cy="6.2" r="1.3" fill="#a78bfa"/><circle cx="23.4" cy="2.6" r=".9" fill="#a78bfa"/><circle cx="26.6" cy="3.8" r=".8" fill="#c4b5fd"/>'),
  Other: S('<circle cx="16" cy="16" r="11.5" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.4"/>'
    + '<path d="M16 10v12M10 16h12" stroke="#475569" stroke-width="2.2" stroke-linecap="round"/>'),
};

// The drawing for a type; a type typed before the list existed (or none) gets the tablet.
export const medTypeSvg = (type) => MED_TYPE_SVG[type] || MED_TYPE_SVG.Tablet;
