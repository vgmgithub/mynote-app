// An anonymous, made-up name for an install, such as "swift-otter-4821", shown as @swift-otter-4821.
//
// It exists so a person can ask us for help by quoting a name instead of a long random id, and without giving their
// real name. It is WORKED OUT from the random install id by a fixed rule, so:
//   - the app and the admin page always agree on it, with nothing to store or sync;
//   - it works offline and needs no outside service;
//   - it holds no personal detail: the id is random, and the name is just a different way of writing it.
//
// The same file lives in server/lib/alias.js (the server is deployed on its own and cannot import this one); a test
// keeps the two identical. Change both, or the test fails.
//
// Size: 128 adjectives x 128 animals x 9000 numbers = about 147 million names. Two installs sharing a name is
// possible in principle and becomes likely only around ten thousand installs; the admin page shows the real id on
// request, so an ambiguous name is always resolvable.

export const ADJECTIVES = [
  'amber', 'azure', 'bold', 'brave', 'breezy', 'bright', 'calm', 'cheery', 'chilly', 'clever', 'coral', 'cosmic',
  'cozy', 'crisp', 'curious', 'dapper', 'daring', 'dizzy', 'dreamy', 'eager', 'electric', 'epic', 'fancy', 'fearless',
  'fiery', 'fluffy', 'fresh', 'frosty', 'gentle', 'giant', 'glad', 'golden', 'graceful', 'grand', 'groovy', 'handy',
  'happy', 'hardy', 'hazy', 'honest', 'humble', 'icy', 'ivory', 'jazzy', 'jolly', 'keen', 'kind', 'lively',
  'lucky', 'lunar', 'magic', 'mellow', 'merry', 'mighty', 'misty', 'modern', 'mossy', 'nifty', 'nimble', 'noble',
  'olive', 'orange', 'patient', 'peppy', 'perky', 'pink', 'plucky', 'plum', 'polite', 'proud', 'purple', 'quick',
  'quiet', 'quirky', 'rapid', 'ready', 'rosy', 'royal', 'ruby', 'rustic', 'sage', 'salty', 'sandy', 'sassy',
  'shady', 'shiny', 'silent', 'silver', 'sleek', 'smart', 'smiling', 'snappy', 'snowy', 'snug', 'solar', 'speedy',
  'spicy', 'steady', 'stellar', 'stormy', 'sturdy', 'sunny', 'super', 'sweet', 'swift', 'tame', 'teal', 'tender',
  'tidy', 'tiny', 'topaz', 'tranquil', 'true', 'trusty', 'velvet', 'vivid', 'warm', 'wavy', 'wild', 'windy',
  'wise', 'witty', 'young', 'zen', 'zesty', 'zippy',
];

export const ANIMALS = [
  'alpaca', 'antelope', 'armadillo', 'badger', 'bat', 'bear', 'beaver', 'bee', 'bison', 'bobcat', 'bunny', 'butterfly',
  'camel', 'cat', 'cheetah', 'chick', 'cobra', 'crane', 'cricket', 'deer', 'dingo', 'dolphin', 'donkey', 'duck',
  'eagle', 'elk', 'ermine', 'falcon', 'ferret', 'finch', 'fox', 'gazelle', 'gecko', 'gibbon', 'giraffe', 'goat',
  'gopher', 'hamster', 'hare', 'hawk', 'hedgehog', 'heron', 'hippo', 'horse', 'husky', 'ibis', 'iguana', 'jackal',
  'jaguar', 'jay', 'kitten', 'kiwi', 'koala', 'koi', 'ladybug', 'lemur', 'lion', 'llama', 'lobster', 'lynx',
  'macaw', 'magpie', 'manatee', 'marmot', 'meerkat', 'mole', 'monkey', 'moose', 'mouse', 'narwhal', 'newt', 'ocelot',
  'okapi', 'orca', 'osprey', 'otter', 'owl', 'oyster', 'panda', 'panther', 'parrot', 'pelican', 'penguin', 'pigeon',
  'piglet', 'pony', 'puffin', 'puma', 'python', 'quail', 'rabbit', 'ram', 'raven', 'rhino', 'robin', 'salmon',
  'seal', 'shark', 'sheep', 'shrimp', 'skunk', 'sloth', 'snail', 'sparrow', 'spider', 'squid', 'squirrel', 'stoat',
  'stork', 'swan', 'tapir', 'tiger', 'toucan', 'trout', 'turkey', 'turtle', 'viper', 'walrus', 'weasel', 'whale',
  'wolf', 'wombat', 'yak', 'zebra',
];

// FNV-1a, 32 bit. Not secret and not meant to be: it only spreads an id evenly across the word lists.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// '' for anything that is not an id, so a caller never shows "undefined".
export function aliasFor(installId) {
  if (typeof installId !== 'string' || !installId) return '';
  const a = fnv1a(installId);
  const b = fnv1a(installId + '~alias');
  const adjective = ADJECTIVES[a % ADJECTIVES.length];
  const animal = ANIMALS[Math.floor(a / ADJECTIVES.length) % ANIMALS.length];
  const number = 1000 + (b % 9000);
  return adjective + '-' + animal + '-' + number;
}

// What is shown to people: the name with an @, the way a handle looks.
export const handleFor = (installId) => { const a = aliasFor(installId); return a ? '@' + a : ''; };
