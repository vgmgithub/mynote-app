// POST /api/create-order { installId, plan?, period? } -> subscription: { subscription_id, key_id, amount, currency, period }
//                                                       -> one-time:    { order_id, key_id, amount, currency }
// Step 1 of checkout. The price is set here, never by the app (see lib/plans.js, lib/razorpay-subs.js).
//
// `period` picks the flow: 'monthly' or 'annual' (the only two on sale - lib/plans.js SELLABLE_PERIODS)
// opens a Razorpay Subscription, a recurring mandate. Omitting `period` also means a subscription - the
// default is 'annual', the same default lib/plans.js uses everywhere else a period is optional, so an
// older request shaped like this endpoint used to be is still buying a subscription, not a one-time order.
// The one-time Orders flow (lib/razorpay.js) only remains reachable for 'lifetime', which is priced and
// stored but not yet on sale - so in practice this endpoint sells subscriptions today, and nothing else,
// until lifetime is switched on.
import { getPool } from '../lib/db.js';
import { matchOrigin } from '../lib/cors.js';
import { isSellable } from '../lib/plans.js';
import { parseCreate as parseSubCreate, createSubscription } from '../lib/razorpay-subs.js';
import { parseCreate as parseOrderCreate, createOrder } from '../lib/razorpay.js';

const json = (res, code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(body)); };

export default async function handler(req, res) {
  const origin = matchOrigin(req.headers.origin, process.env.ALLOWED_ORIGINS);
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const period = req.body && req.body.period;
  if (typeof period === 'string' && period && !isSellable(period)) {
    // Explicitly asked for something not for sale (e.g. 'lifetime' today): the one-time flow, so a
    // future lifetime launch has somewhere to go without touching this branch again.
    const input = parseOrderCreate(req.body);
    if (!input.ok) return json(res, input.status, { error: input.error });
    const r = await createOrder({ env: process.env, installId: input.installId });
    if (!r.ok) return json(res, r.status, { error: r.error });
    return json(res, 200, { order_id: r.order_id, amount: r.amount, currency: r.currency, key_id: r.key_id });
  }

  const input = parseSubCreate(req.body);
  if (!input.ok) return json(res, input.status, { error: input.error });
  try {
    const pool = await getPool();
    // A Beta Member/Contributor with an unexpired, unredeemed offer buys at THEIR price, not the standard one -
    // the one new step this needs (docs/beta-plan.md, Phase 3). Everything after this line is unchanged: the
    // same checkout, the same confirm, the same webhook: only which plan_code gets charged differs. Only
    // applies when the app asked for the default 'pro' - never overrides a plan explicitly requested otherwise.
    let plan = input.plan;
    if (plan === 'pro') {
      try {
        const { activeOffer } = await import('../lib/beta.js');
        const offer = await activeOffer(pool, input.installId);
        if (offer) plan = offer.planCode;
      } catch (_) { /* no beta tables yet: the standard price applies */ }
    }
    const r = await createSubscription({ env: process.env, pool, installId: input.installId, plan, period: input.period });
    if (!r.ok) return json(res, r.status, { error: r.error });
    return json(res, 200, { subscription_id: r.subscription_id, key_id: r.key_id, amount: r.amount, currency: r.currency, period: r.period });
  } catch (e) {
    // "Payments are not set up on this server" is what the app used to say for every 503 here, and it
    // is the wrong thing to say when the keys are fine and it is the plan tables that are missing -
    // it sends somebody looking for deleted environment variables. A missing table is a setup step
    // that has not been run (schema/006_subscriptions.sql), so it says so, and says it distinctly
    // enough that the app can too.
    const missingTable = e && (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146);
    if (missingTable) return json(res, 503, { error: 'the subscription plans are not set up on this server yet', reason: 'plans_missing' });
    return json(res, 503, { error: 'could not start the subscription', reason: 'subscription_failed' });
  }
}
