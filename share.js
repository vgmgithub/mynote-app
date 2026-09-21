// The invite message people send each other on WhatsApp, and the link that opens it.
//
// One place for the wording, so the app's menu item and any copy pasted elsewhere say the same thing. It only
// states what is true in the code today: records stay on the phone, no account, no ads, works offline, any five
// features free. It does not say "nothing is ever sent" (anonymous usage counts are), and it does not mention
// Pro pricing, which is not on sale.
import { PRODUCTION_HOSTS } from './config.js';

// The invite always points at the live app, never at whichever copy the sender happens to be using: a friend
// invited from a test copy must land on the real one.
export const INVITE_URL = 'https://' + (PRODUCTION_HOSTS[0] || 'mynotes.viewsofvgm.com');

export function inviteText(url = INVITE_URL) {
  return [
    'Hi! \u{1F44B} I’m using *MyNotes*, a private money app I’d like you to try.',
    '',
    'It keeps your investments, savings, expenses, credit cards, health records and passwords in one place, and your records stay on your phone. No account, no ads, works offline. Any 5 features are free.',
    '',
    '\u{1F4F2} Install in 10 seconds (open this in Chrome, then tap Install):',
    url,
    '',
    'It’s an early version shared with a few people, so tell me what is confusing or broken. Thank you! \u{1F64F}',
  ].join('\n');
}

// wa.me opens the WhatsApp app on a phone and WhatsApp Web on a computer, with the message ready to send.
// No number is given, so the person picks who to send it to.
export function whatsappUrl(text = inviteText()) {
  return 'https://wa.me/?text=' + encodeURIComponent(text);
}
