// Medicine Cabinet (a part of Health Check): the household's medicines with their expiry, type, purpose and how to
// use them. Pure logic - no DOM, no storage - so the status rules are decided here, in one place, and tested.
//
// Record shape (store 'medicines', added in DB v21):
//   { id, name, type, purpose, usage,            // usage = how to take it, as written by the person
//     when: ['morning' | 'afternoon' | 'night'], // optional: when in the day (see MED_TIMES); absent on older records
//     cures: ['Headache', 'Body pain'],          // optional: what it cures, as tags (see CURE_TAGS / normaliseCures)
//     personId,                                  // a Health Check person, or null for the whole household
//     expiry: 'YYYY-MM',                         // month and year, as printed on the pack
//     boughtOn: 'YYYY-MM-DD' | '',
//     status: 'active' | 'used' | 'disposed',    // used up, or thrown away once expired
//     closedOn: 'YYYY-MM-DD' | null,             // when it was marked used up or disposed
//     createdAt, updatedAt }

export const MED_TYPES = ['Tablet', 'Capsule', 'Syrup', 'Drops', 'Cream / ointment', 'Inhaler', 'Injection', 'Powder / sachet', 'Spray', 'Other'];
export const MED_PURPOSES = ['Fever', 'Pain', 'Cold / cough', 'Stomach', 'Allergy', 'Eye', 'Nose', 'Mouth', 'Wound', 'First aid', 'Skin', 'BP / sugar', 'Vitamins', 'Other'];

// What a medicine cures, as tags (kept on the record as `cures`, an optional list of short words - a medicine
// noted before this existed has none, and any word the person types is a tag too). These are the suggestions,
// each with the types it usually comes as and the purposes it belongs to, so the form can put the likely ones
// first: those matching both the chosen type and purpose, then the type, then the purpose, then the rest.
export const CURE_TAGS = [
  ['Fever', ['Tablet', 'Syrup', 'Capsule'], ['Fever']],
  ['Headache', ['Tablet', 'Capsule'], ['Pain', 'Fever']],
  ['Body pain', ['Tablet', 'Capsule', 'Cream / ointment', 'Spray'], ['Pain', 'Fever']],
  ['Muscle pain', ['Cream / ointment', 'Spray', 'Tablet'], ['Pain']],
  ['Joint pain', ['Cream / ointment', 'Spray', 'Tablet'], ['Pain']],
  ['Back pain', ['Cream / ointment', 'Spray', 'Tablet'], ['Pain']],
  ['Period pain', ['Tablet'], ['Pain']],
  ['Toothache', ['Tablet'], ['Pain', 'Mouth']],
  ['Ear pain', ['Drops'], ['Pain']],
  ['Cold', ['Tablet', 'Syrup', 'Capsule'], ['Cold / cough']],
  ['Cough', ['Syrup', 'Tablet'], ['Cold / cough']],
  ['Sore throat', ['Syrup', 'Tablet', 'Spray'], ['Cold / cough', 'Mouth']],
  ['Blocked nose', ['Drops', 'Spray', 'Tablet'], ['Nose', 'Cold / cough']],
  ['Sneezing', ['Tablet', 'Spray', 'Syrup'], ['Allergy', 'Nose']],
  ['Nose bleed', ['Spray', 'Drops'], ['Nose', 'First aid']],
  ['Acidity', ['Tablet', 'Syrup', 'Powder / sachet'], ['Stomach']],
  ['Gas', ['Tablet', 'Powder / sachet', 'Syrup'], ['Stomach']],
  ['Loose motion', ['Tablet', 'Powder / sachet', 'Syrup'], ['Stomach']],
  ['Constipation', ['Powder / sachet', 'Syrup', 'Tablet'], ['Stomach']],
  ['Vomiting', ['Tablet', 'Syrup'], ['Stomach']],
  ['Dehydration', ['Powder / sachet'], ['Stomach', 'First aid']],
  ['Motion sickness', ['Tablet'], ['Stomach']],
  ['Itching', ['Cream / ointment', 'Tablet'], ['Allergy', 'Skin']],
  ['Rash', ['Cream / ointment', 'Powder / sachet'], ['Skin', 'Allergy']],
  ['Skin allergy', ['Cream / ointment', 'Tablet'], ['Allergy', 'Skin']],
  ['Fungal infection', ['Cream / ointment', 'Powder / sachet'], ['Skin']],
  ['Insect bite', ['Cream / ointment', 'Spray'], ['Skin', 'Allergy', 'First aid']],
  ['Burn', ['Cream / ointment', 'Spray'], ['Wound', 'First aid', 'Skin']],
  ['Cut / wound', ['Cream / ointment', 'Spray', 'Powder / sachet'], ['Wound', 'First aid']],
  ['Sprain', ['Spray', 'Cream / ointment'], ['Pain', 'First aid']],
  ['Red eyes', ['Drops'], ['Eye']],
  ['Eye infection', ['Drops', 'Cream / ointment'], ['Eye']],
  ['Dry eyes', ['Drops'], ['Eye']],
  ['Itchy eyes', ['Drops'], ['Eye', 'Allergy']],
  ['Mouth ulcer', ['Cream / ointment', 'Tablet'], ['Mouth']],
  ['Bad breath', ['Spray'], ['Mouth']],
  ['Asthma', ['Inhaler', 'Tablet'], ['Allergy']],
  ['Breathlessness', ['Inhaler'], ['Other']],
  ['BP', ['Tablet'], ['BP / sugar']],
  ['Sugar', ['Tablet', 'Injection'], ['BP / sugar']],
  ['Cholesterol', ['Tablet'], ['BP / sugar']],
  ['Thyroid', ['Tablet'], ['Other']],
  ['Vitamin D', ['Capsule', 'Tablet', 'Powder / sachet'], ['Vitamins']],
  ['Vitamin B12', ['Tablet', 'Injection', 'Capsule'], ['Vitamins']],
  ['Iron', ['Tablet', 'Syrup'], ['Vitamins']],
  ['Calcium', ['Tablet'], ['Vitamins']],
  ['Weakness', ['Syrup', 'Tablet', 'Powder / sachet'], ['Vitamins']],
  ['Sleep', ['Tablet'], ['Other']],
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
// The suggestions to show, best first for this type and purpose, leaving out what is already picked.
export function rankCures(type, purpose, picked) {
  const have = new Set(normaliseCures(picked).map((t) => t.toLowerCase()));
  const score = ([, types, purposes]) => (types.includes(type) ? 2 : 0) + (purposes.includes(purpose) ? 1 : 0);
  return CURE_TAGS.map((c, i) => ({ c, i, s: score(c) }))
    .filter((x) => !have.has(x.c[0].toLowerCase()))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c[0]);
}

// When in the day it is taken - any of the three, kept on the record as `when` (an optional list: a medicine
// noted before this existed simply has none). Always stored in this order, so it reads Morning, Afternoon, Night.
export const MED_TIMES = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['night', 'Night']];
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
    name: m.name || '', type: m.type || '', purpose: m.purpose || '', usage: m.usage || '', when: normaliseWhen(m.when), cures: normaliseCures(m.cures),
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
