// The anonymous name an install is known by: one word, such as @Meharika or @Vikrant.
//
// Why it exists: somebody can ask us for help by quoting a name instead of a long random id, and without telling us
// who they are.
//
// How it is chosen:
//   - Once, on the first run, and then kept. It is stored on the device and sent with the usage counts, and the
//     SERVER is what makes it unique: the alias column has a unique index, and a name already taken is swapped for
//     another before it is stored (see server/lib/store.js). Two people can never end up with the same name.
//   - If a gender was given on the "Help us improve" page the word is built to read that way, otherwise it reads
//     neither way. The choice is made at that moment and FROZEN: changing or removing gender later never renames
//     anybody, because support has to be able to match a name somebody quoted weeks ago. The Privacy text says so.
//
// Names are built from syllables rather than picked from a list, so there are several thousand per gender. A clash
// is uncommon and the server simply draws again, so nobody ever waits. Nothing in a name comes from anything the
// person typed.
//
// server/lib/alias.js is an identical copy, because the server is deployed on its own and cannot import this file.
// A test fails if the two drift apart.

// A name is built as: a stem that ends in a consonant, an optional middle, then a gendered ending that starts
// with a vowel. That order is what keeps them pronounceable: Kir + an = Kiran, Meh + ar + ika = Meharika.
const STEM = ['Ar', 'Av', 'Chir', 'Dev', 'Dhan', 'Ek', 'Gau', 'Gir', 'Har', 'Hem', 'Ish', 'Jag', 'Jai', 'Kal',
  'Kan', 'Kav', 'Kir', 'Lav', 'Mad', 'Mah', 'Man', 'Meh', 'Mit', 'Nal', 'Nav', 'Nid', 'Nil', 'Pal', 'Par', 'Pav',
  'Pra', 'Rag', 'Raj', 'Ram', 'Rav', 'Rit', 'Roh', 'Sab', 'Sam', 'Shan', 'Shar', 'Sid', 'Sur', 'Tan', 'Tar', 'Tej',
  'Vai', 'Var', 'Ved', 'Vij', 'Vin', 'Yash'];

// Optional middle, vowel then consonant, so the ending still lands on a vowel start.
const MID = ['al', 'am', 'an', 'ar', 'av', 'il', 'in', 'ir', 'ish', 'it', 'ul', 'ur', 'ay', 'esh'];

// The ending is what makes a name read as a woman, a man, or neither.
const END_FEMALE = ['a', 'i', 'ya', 'ika', 'ita', 'ani', 'isha', 'ira', 'ini', 'iya'];
const END_MALE = ['an', 'av', 'esh', 'it', 'ul', 'ay', 'ir', 'ansh', 'ant', 'in'];
const END_NEUTRAL = ['am', 'en', 'il', 'in', 'ar', 'as', 'un', 'ish', 'ay', 'ul'];
export const MAX_LEN = 12;
export const MIN_LEN = 4;

export function endingsFor(gender) {
  const g = String(gender || '').trim().toLowerCase();
  if (g === 'female') return END_FEMALE;
  if (g === 'male') return END_MALE;
  return END_NEUTRAL;   // no gender given, or 'Other': a name that reads neither way
}

// A name is one word of letters only, 4 to 12 long. Used by the admin search to tell a name from an install id.
export const ALIAS_RE = /^@?[A-Za-z]{4,12}$/;
export const isAlias = (s) => typeof s === 'string' && ALIAS_RE.test(s.trim());
export const normaliseAlias = (s) => (isAlias(s) ? s.trim().replace(/^@/, '') : '');

// `rand` returns a float in [0,1); it is passed in so tests are not random. In the app it is crypto-backed.
export function makeAlias(gender, rand = defaultRand) {
  const pick = (list) => list[Math.floor(rand() * list.length) % list.length];
  const ends = endingsFor(gender);
  for (let attempt = 0; attempt < 12; attempt++) {
    // A middle roughly half the time, so short and long names both occur.
    const word = pick(STEM) + (rand() < 0.5 ? pick(MID) : '') + pick(ends);
    const name = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    if (name.length >= MIN_LEN && name.length <= MAX_LEN) return name;
  }
  // Every draw was too long: trim to the cap rather than return nothing.
  const fallback = (pick(STEM) + pick(ends)).slice(0, MAX_LEN);
  return fallback.charAt(0).toUpperCase() + fallback.slice(1).toLowerCase();
}

function defaultRand() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (c && c.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] / 4294967296;
  }
  return Math.random();
}

// What people see: the name with an @, the way a handle looks.
export const handleFor = (alias) => (alias ? '@' + String(alias).replace(/^@/, '') : '');
