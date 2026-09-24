// Pure logic for the Beta Program client screens: no DOM, no network, no Date.now()/Math.random() at
// import time (those live in beta-ui.js, where they can be exercised). Mirrors server/lib/beta.js's
// Friday-through-Sunday window, but on the DEVICE'S OWN clock rather than IST: the reminder banner and
// the "you can submit now" state need to feel right wherever the phone actually is, and the server
// re-checks in IST anyway (its own windowFor) before it ever accepts a submission, so a phone in a
// different time zone can only ever be a little early or late showing the banner - never accepted late.
//
// weekKey identifies a window by its Friday's local date (YYYY-MM-DD), matching the server's own key
// so a submission's weekStart lines up on both sides.

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

// Friday=5 ... Sunday=0 (Date#getDay: Sun=0..Sat=6). Days since the most recent Friday, counting today
// as 0 when today is itself Friday.
const daysSinceFriday = (day) => (day + 2) % 7;

export function currentWindow(now) {
  const day = now.getDay();
  const back = daysSinceFriday(day);
  const fri = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 0, 0, 0, 0);
  const weekKey = ymd(fri);
  // The window is open for Friday, Saturday and Sunday (back is 0, 1 or 2); Monday through Thursday it
  // is closed (back is 3, 4, 5 or 6).
  const isOpen = back <= 2;
  return { weekKey, isOpen };
}

// The week just missed: the same idea as the server's lastClosedWindow, for the reminder banner's own
// "you didn't submit last week either" wording. Not currently shown differently from a same-week miss,
// but kept separate so that copy can change later without touching the window math again.
export function lastClosedWindow(now) {
  const { weekKey, isOpen } = currentWindow(now);
  if (!isOpen) return { weekKey, isOpen: false };
  const fri = new Date(weekKey + 'T00:00:00');
  const prevFri = new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() - 7);
  return { weekKey: ymd(prevFri), isOpen: false };
}

// A short, fixed set of MCQ questions plus one free-text pair (title + body), matching what
// server/lib/beta.js's validateFeedbackBody expects: answers keyed by `key`, every one answered.
export const QUESTIONS = [
  { key: 'value', label: 'How useful was MyNotes to you this week?',
    options: ['Very useful', 'Somewhat useful', 'Not very useful', "Didn't get to use it"] },
  { key: 'friction', label: 'Did anything feel confusing or get in your way?',
    options: ['Nothing', 'A little', 'Yes, more than once'] },
  { key: 'would_recommend', label: 'Would you recommend MyNotes to a friend right now?',
    options: ['Yes', 'Maybe', 'Not yet'] },
];

// Every question answered (non-blank), and a non-blank title and body - the same shape the server
// insists on, checked here first so a person sees what is missing before the request even goes out.
export function validateFeedback(state) {
  if (!state) return { ok: false, error: 'nothing to submit' };
  const answers = Array.isArray(state.answers) ? state.answers : [];
  for (const q of QUESTIONS) {
    const a = answers.find((x) => x && x.key === q.key);
    if (!a || typeof a.value !== 'string' || !a.value.trim()) return { ok: false, error: 'missing:' + q.key };
  }
  if (!state.commentTitle || !state.commentTitle.trim()) return { ok: false, error: 'missing:title' };
  if (!state.commentBody || !state.commentBody.trim()) return { ok: false, error: 'missing:body' };
  return { ok: true };
}

// What the post-Beta offer card says, from the server's own plan code - never a price hardcoded twice.
export function offerCopy(planCode) {
  if (planCode === 'pro_beta_contributor') {
    return { label: 'Beta Contributor price', price: '₹199/yr', note: 'locked for life, thank you for your contribution' };
  }
  if (planCode === 'pro_beta_member') {
    return { label: 'Beta Member price', price: '₹299/yr', note: 'locked for your first year' };
  }
  return null;
}
