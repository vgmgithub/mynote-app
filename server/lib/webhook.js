// webhook.js — Razorpay's server-to-server events, for subscription renewals.
//
// A renewal is charged by Razorpay, not by anybody opening the app, so without this a subscription
// silently stops extending: the mandate keeps taking money and the database keeps saying the term
// ended. This is the only path by which a renewal reaches us.
//
// TWO THINGS THAT ARE EASY TO GET WRONG.
//
//   1. The signature is over the RAW body, byte for byte. JSON.parse then re-stringify changes key
//      order and whitespace and the signature stops matching, so the handler must read the raw stream
//      before anything parses it. Vercel parses req.body by default, which is exactly the trap.
//
//   2. Events arrive more than once. Razorpay retries on any non-2xx, and a duplicate must not extend
//      a subscription twice. Every handler here is written to be idempotent on the event id.
import crypto from 'node:crypto';

export const EVENTS = ['subscription.charged', 'subscription.halted', 'subscription.cancelled', 'subscription.completed'];

// The body as it was sent. Returns null when the stream has already been consumed, which is a refusal
// rather than a guess: verifying a reconstructed body would be verifying nothing.
export async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (!req.readable) return null;
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

// HMAC-SHA256 over the raw body, compared in constant time. A length mismatch is rejected before
// timingSafeEqual, which throws on unequal lengths.
export function verifySignature(raw, signature, secret) {
  if (!raw || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// What the event means for one subscription, as plain data. No database: the caller applies it, which
// keeps every rule here readable and testable on its own.
//
// `charged` carries the period end Razorpay itself computed (current_end, unix seconds). Trusting
// theirs rather than recomputing ours keeps the two from drifting apart over many renewals.
export function planFromEvent(body) {
  const event = body && body.event;
  if (EVENTS.indexOf(event) < 0) return { ok: false, ignored: true, event: event || null };
  const sub = body.payload && body.payload.subscription && body.payload.subscription.entity;
  if (!sub || typeof sub.id !== 'string') return { ok: false, error: 'no subscription in payload' };

  // notes.installId is ours, set when the subscription was created. Without it the event cannot be
  // attached to anybody, and guessing is worse than dropping it.
  const installId = sub.notes && typeof sub.notes.installId === 'string' ? sub.notes.installId : null;
  if (!installId || !/^[0-9a-f-]{32,36}$/.test(installId)) return { ok: false, error: 'no installId in notes' };

  const endSec = Number(sub.current_end);
  const currentEnd = Number.isFinite(endSec) && endSec > 0 ? new Date(endSec * 1000) : null;
  // Where this term began, used only under the billing test clock (lib/subscriptions.js).
  const startSec = Number(sub.current_start);
  const start = Number.isFinite(startSec) && startSec > 0 ? { currentStart: new Date(startSec * 1000) } : {};

  if (event === 'subscription.charged') {
    // Paid and extended. This is the only event that grants time.
    return { ok: true, event, id: sub.id, installId, status: 'active', currentEnd, ...start };
  }
  if (event === 'subscription.halted') {
    // The mandate failed after its retries. Access stops at the end of the term already paid for,
    // never immediately: they paid for that time.
    return { ok: true, event, id: sub.id, installId, status: 'halted', currentEnd, ...start };
  }
  // cancelled / completed: no more renewals, but the paid term still runs to its end.
  return { ok: true, event, id: sub.id, installId, status: 'cancelled', currentEnd, ...start };
}
