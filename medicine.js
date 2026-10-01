// Medicine Cabinet (a part of Health Check): the household's medicines with their expiry, type, purpose and how to
// use them. Pure logic - no DOM, no storage - so the status rules are decided here, in one place, and tested.
//
// Record shape (store 'medicines', added in DB v21):
//   { id, name, type, purpose, usage,            // usage = how to take it, as written by the person
//     when: ['morning' | 'afternoon' | 'night'], // optional: when in the day (see MED_TIMES); absent on older records
//     whenNote: 'Before breakfast',              // optional: the "Custom" time - anything apart from morning / afternoon / night
//     cures: ['Headache', 'Body pain'],          // optional: what it cures, as tags (see CURE_TAGS / normaliseCures)
//     personId,                                  // a Health Check person, or null for the whole household
//     expiry: 'YYYY-MM',                         // month and year, as printed on the pack
//     boughtOn: 'YYYY-MM-DD' | '',
//     status: 'active' | 'used' | 'disposed',    // used up, or thrown away once expired
//     closedOn: 'YYYY-MM-DD' | null,             // when it was marked used up or disposed
//     createdAt, updatedAt }

export const MED_TYPES = ['Tablet', 'Capsule', 'Syrup', 'Drops', 'Cream / ointment', 'Inhaler', 'Injection', 'Powder / sachet', 'Spray', 'Other'];
// What a medicine is for: the common ailments, then the parts of the body (eye, ear, nose, mouth, tooth, skin), then the
// kinds of care (wound, first aid, infection, breathing, bones, heart, women's health, baby care, sleep).
export const MED_PURPOSES = ['Fever', 'Pain', 'Cold / cough', 'Stomach', 'Allergy', 'Eye', 'Ear', 'Nose', 'Mouth', 'Tooth', 'Skin', 'Wound', 'First aid',
  'Infection', 'Breathing', 'Bones / joints', 'BP / sugar', 'Heart', 'Women\u2019s health', 'Baby care', 'Vitamins', 'Sleep', 'Other'];

// What a medicine cures, as tags (kept on the record as `cures`, an optional list of short words - a medicine
// noted before this existed has none, and any word the person types is a tag too). These are the suggestions,
// each with the types it usually comes as and the purposes it belongs to, so the form can put the likely ones
// first: those matching both the chosen type and purpose, then the type, then the purpose, then the rest.
export const CURE_TAGS = [
  // fever, pain
  ['Fever', ['Tablet', 'Syrup', 'Capsule', 'Drops'], ['Fever', 'Baby care']],
  ['Headache', ['Tablet', 'Capsule'], ['Pain', 'Fever']],
  ['Body pain', ['Tablet', 'Capsule', 'Cream / ointment', 'Spray'], ['Pain', 'Fever']],
  ['Muscle pain', ['Cream / ointment', 'Spray', 'Tablet'], ['Pain', 'Bones / joints']],
  ['Joint pain', ['Cream / ointment', 'Spray', 'Tablet'], ['Pain', 'Bones / joints']],
  ['Back pain', ['Cream / ointment', 'Spray', 'Tablet'], ['Pain', 'Bones / joints']],
  ['Arthritis', ['Tablet', 'Cream / ointment'], ['Bones / joints', 'Pain']],
  ['Sprain', ['Spray', 'Cream / ointment'], ['Pain', 'Bones / joints', 'First aid']],
  ['Period pain', ['Tablet'], ['Women’s health', 'Pain']],
  // cold, throat, nose, breathing
  ['Cold', ['Tablet', 'Syrup', 'Capsule'], ['Cold / cough']],
  ['Cough', ['Syrup', 'Tablet'], ['Cold / cough', 'Baby care']],
  ['Sore throat', ['Syrup', 'Tablet', 'Spray'], ['Cold / cough', 'Mouth']],
  ['Throat infection', ['Tablet', 'Syrup', 'Capsule'], ['Infection', 'Cold / cough']],
  ['Blocked nose', ['Drops', 'Spray', 'Tablet'], ['Nose', 'Cold / cough', 'Baby care']],
  ['Sneezing', ['Tablet', 'Spray', 'Syrup'], ['Allergy', 'Nose']],
  ['Nose bleed', ['Spray', 'Drops'], ['Nose', 'First aid']],
  ['Asthma', ['Inhaler', 'Tablet'], ['Breathing', 'Allergy']],
  ['Wheezing', ['Inhaler', 'Syrup'], ['Breathing']],
  ['Breathlessness', ['Inhaler'], ['Breathing']],
  // stomach
  ['Acidity', ['Tablet', 'Syrup', 'Powder / sachet'], ['Stomach']],
  ['Gas', ['Tablet', 'Powder / sachet', 'Syrup'], ['Stomach']],
  ['Loose motion', ['Tablet', 'Powder / sachet', 'Syrup'], ['Stomach']],
  ['Constipation', ['Powder / sachet', 'Syrup', 'Tablet'], ['Stomach']],
  ['Vomiting', ['Tablet', 'Syrup'], ['Stomach']],
  ['Dehydration', ['Powder / sachet'], ['Stomach', 'First aid']],
  ['Motion sickness', ['Tablet'], ['Stomach']],
  ['Worms', ['Tablet', 'Syrup'], ['Stomach', 'Infection']],
  // eyes, ears
  ['Red eyes', ['Drops'], ['Eye']],
  ['Eye infection', ['Drops', 'Cream / ointment'], ['Eye', 'Infection']],
  ['Dry eyes', ['Drops'], ['Eye']],
  ['Itchy eyes', ['Drops'], ['Eye', 'Allergy']],
  ['Ear pain', ['Drops'], ['Ear', 'Pain']],
  ['Ear infection', ['Drops', 'Tablet'], ['Ear', 'Infection']],
  ['Ear wax', ['Drops'], ['Ear']],
  // mouth, teeth
  ['Mouth ulcer', ['Cream / ointment', 'Tablet'], ['Mouth']],
  ['Bad breath', ['Spray'], ['Mouth']],
  ['Toothache', ['Tablet', 'Cream / ointment'], ['Tooth', 'Pain']],
  ['Gum swelling', ['Cream / ointment', 'Tablet'], ['Tooth', 'Mouth']],
  ['Sensitive teeth', ['Cream / ointment'], ['Tooth']],
  ['Teething', ['Cream / ointment', 'Drops'], ['Tooth', 'Baby care']],
  // skin, wounds
  ['Itching', ['Cream / ointment', 'Tablet'], ['Allergy', 'Skin']],
  ['Rash', ['Cream / ointment', 'Powder / sachet'], ['Skin', 'Allergy']],
  ['Skin allergy', ['Cream / ointment', 'Tablet'], ['Allergy', 'Skin']],
  ['Allergy', ['Tablet', 'Syrup'], ['Allergy']],
  ['Fungal infection', ['Cream / ointment', 'Powder / sachet'], ['Skin', 'Infection']],
  ['Acne', ['Cream / ointment', 'Tablet'], ['Skin']],
  ['Insect bite', ['Cream / ointment', 'Spray'], ['Skin', 'Allergy', 'First aid']],
  ['Burn', ['Cream / ointment', 'Spray'], ['Wound', 'First aid', 'Skin']],
  ['Cut / wound', ['Cream / ointment', 'Spray', 'Powder / sachet'], ['Wound', 'First aid']],
  ['Bruise', ['Cream / ointment', 'Spray'], ['Wound', 'Pain']],
  ['Diaper rash', ['Cream / ointment', 'Powder / sachet'], ['Baby care', 'Skin']],
  // infection
  ['Bacterial infection', ['Tablet', 'Capsule', 'Syrup'], ['Infection']],
  ['Urine infection', ['Tablet', 'Capsule'], ['Infection']],
  // heart, BP, sugar
  ['BP', ['Tablet'], ['BP / sugar', 'Heart']],
  ['Sugar', ['Tablet', 'Injection'], ['BP / sugar']],
  ['Cholesterol', ['Tablet'], ['BP / sugar', 'Heart']],
  ['Heart care', ['Tablet'], ['Heart']],
  ['Blood thinner', ['Tablet'], ['Heart']],
  ['Thyroid', ['Tablet'], ['Other']],
  // vitamins
  ['Vitamin D', ['Capsule', 'Tablet', 'Powder / sachet'], ['Vitamins']],
  ['Vitamin B12', ['Tablet', 'Injection', 'Capsule'], ['Vitamins']],
  ['Iron', ['Tablet', 'Syrup'], ['Vitamins']],
  ['Calcium', ['Tablet'], ['Vitamins', 'Bones / joints']],
  ['Multivitamin', ['Tablet', 'Capsule', 'Syrup'], ['Vitamins']],
  ['Weakness', ['Syrup', 'Tablet', 'Powder / sachet'], ['Vitamins']],
  // women, baby, sleep
  ['Irregular periods', ['Tablet'], ['Women’s health']],
  ['Pregnancy care', ['Tablet', 'Capsule'], ['Women’s health', 'Vitamins']],
  ['Colic', ['Drops', 'Syrup'], ['Baby care', 'Stomach']],
  ['Sleep', ['Tablet'], ['Sleep']],
];
const CURE_MAX = 8, CURE_LEN = 30;
// Tidy, de-duplicated (ignoring case) and capped: up to 8 tags of up to 30 characters.
export function normaliseCures(list) {
  const seen = new Set(), out = [];
  (Array.isArray(list) ? list : []).forEach((t) => {
    const v = String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, CURE_LEN);
    if (!v || seen.has(v.toLowerCase()) || out.length >= CURE_MAX) return;
    seen.add(v.toLowerCase()); out.push(v);
  });
  return out;
}
// Every cure that can be suggested: the built-in list, plus every cure already on a medicine in the cabinet (so
// a tag typed once is offered on all the others), each remembering the types and purposes it has been used with.
// `own` marks the ones the person made up.
export function cureCatalog(medicines) {
  const byKey = new Map();
  CURE_TAGS.forEach(([name, types, purposes]) => byKey.set(name.toLowerCase(), { name, types: types.slice(), purposes: purposes.slice(), own: false }));
  (medicines || []).forEach((m) => {
    normaliseCures(m && m.cures).forEach((c) => {
      const k = c.toLowerCase();
      let e = byKey.get(k);
      if (!e) { e = { name: c, types: [], purposes: [], own: true }; byKey.set(k, e); }
      if (m.type && !e.types.includes(m.type)) e.types.push(m.type);
      if (m.purpose && !e.purposes.includes(m.purpose)) e.purposes.push(m.purpose);
    });
  });
  return [...byKey.values()];
}
// The suggestions to show, best first for this type and purpose, leaving out what is already picked. Among equals
// the person's own cures come first, then the built-in list in its order.
export function rankCures(type, purpose, picked, catalog) {
  const have = new Set(normaliseCures(picked).map((t) => t.toLowerCase()));
  const score = (c) => (c.types.includes(type) ? 2 : 0) + (c.purposes.includes(purpose) ? 1 : 0);
  return (catalog || cureCatalog([])).map((c, i) => ({ c, i, s: score(c) }))
    .filter((x) => !have.has(x.c.name.toLowerCase()))
    .sort((a, b) => b.s - a.s || (b.c.own ? 1 : 0) - (a.c.own ? 1 : 0) || a.i - b.i)
    .map((x) => x.c.name);
}

// When in the day it is taken - any of the three, kept on the record as `when` (an optional list: a medicine
// noted before this existed simply has none). Always stored in this order, so it reads Morning, Afternoon, Night.
export const MED_TIMES = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['night', 'Night']];
// The "Custom" time: a short free-text note (up to 100 characters, whitespace tidied) for anything the three
// times of day don't cover - "before breakfast", "every 6 hours", "only when needed".
export const MED_WHEN_NOTE_MAX = 100;
export function normaliseWhenNote(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MED_WHEN_NOTE_MAX);
}
export function normaliseWhen(list) {
  const set = new Set(Array.isArray(list) ? list : []);
  return MED_TIMES.map(([id]) => id).filter((id) => set.has(id));
}

// How far ahead an expiry counts as "coming up": time enough to buy a fresh pack before this one runs out of date.
export const MED_SOON_DAYS = 30;

// The safe way to get rid of one, said in one place so the card and the confirm agree.
export const DISPOSE_TIP = 'Don’t flush it or pour it down the drain. A pharmacy take-back is best; otherwise take it out of the strip or bottle, '
  + 'mix it with used tea leaves or soil in a sealed bag, and put it in the bin.';

const DAY = 86400000;
const isYm = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));

// A pack printed "EXP 03/2027" is good through the LAST day of March 2027.
export function expiryEnd(ym) {
  if (!isYm(ym)) return null;
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  return y + '-' + String(m).padStart(2, '0') + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
}

// Days from today (a 'YYYY-MM-DD' local date) to the end of the expiry month: 0 on its last day, negative once expired.
export function daysToExpiry(ym, today) {
  const end = expiryEnd(ym);
  if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) return null;
  return Math.round((Date.parse(end) - Date.parse(today)) / DAY);
}

// Where one medicine stands today.
//   used / disposed   closed: kept only as history
//   expired           past its expiry month - dispose of it (and buy again if it is still needed)
//   soon              expires within MED_SOON_DAYS - buy a fresh one before then
//   ok                fine
//   unknown           no expiry recorded
export function medStatus(m, today, soonDays = MED_SOON_DAYS) {
  const st = m && m.status;
  if (st === 'used' || st === 'disposed') return { state: st, days: null };
  const days = daysToExpiry(m && m.expiry, today);
  if (days == null) return { state: 'unknown', days: null };
  if (days < 0) return { state: 'expired', days };
  if (days <= soonDays) return { state: 'soon', days };
  return { state: 'ok', days };
}

// The "Coming up" list: everything still in the cabinet that has expired or is about to - expired first, then the
// soonest. Closed (used up / disposed) medicines never appear.
export function comingUp(list, today, soonDays = MED_SOON_DAYS) {
  return (list || [])
    .map((m) => ({ m, s: medStatus(m, today, soonDays) }))
    .filter((x) => x.s.state === 'expired' || x.s.state === 'soon')
    .sort((a, b) => a.s.days - b.s.days || String(a.m.name || '').localeCompare(String(b.m.name || '')))
    .map((x) => Object.assign({}, x.m, { _status: x.s }));
}

// The cabinet itself, in the order worth reading it: the soonest expiry first, anything without an expiry last.
export function sortByExpiry(list) {
  return (list || []).slice().sort((a, b) => {
    const ea = isYm(a.expiry) ? a.expiry : '9999-99', eb = isYm(b.expiry) ? b.expiry : '9999-99';
    return ea.localeCompare(eb) || String(a.name || '').localeCompare(String(b.name || ''));
  });
}

// A fresh copy for "buy again": the same medicine with the purchase and expiry left for the new pack.
export function restockCopy(m) {
  return {
    name: m.name || '', type: m.type || '', purpose: m.purpose || '', usage: m.usage || '', when: normaliseWhen(m.when), whenNote: normaliseWhenNote(m.whenNote), cures: normaliseCures(m.cures),
    personId: m.personId != null ? m.personId : null, expiry: '', boughtOn: '', status: 'active', closedOn: null,
  };
}

// "Mar 2027" for 'YYYY-MM'.
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function expiryLabel(ym) {
  return isYm(ym) ? MONS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4) : 'No expiry noted';
}

// The short word a card shows for its status.
export function statusText(s) {
  if (!s) return '';
  if (s.state === 'expired') return s.days === -1 ? 'Expired yesterday' : 'Expired';
  if (s.state === 'soon') return s.days === 0 ? 'Expires today' : s.days === 1 ? 'Expires tomorrow' : 'Expires in ' + s.days + ' days';
  if (s.state === 'used') return 'Used up';
  if (s.state === 'disposed') return 'Disposed';
  if (s.state === 'unknown') return 'No expiry';
  return 'In date';
}
