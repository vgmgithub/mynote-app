// POST /api/plan { "installId": "..." } -> { "plan": "free" | "paid" | "beta", "known": true | false, ... }
// The app calls this each time it opens while online, to learn whether this install has Pro or Beta.
// Read-only in that mode: it never creates or changes a row.
//
// POST /api/plan?beta_request=1 { installId } -> a pending Beta request (idempotent: a second tap while one is
// already pending returns the same request rather than making a duplicate).
// POST /api/plan?beta_feedback=1 { installId, weekStart, answers:[{key,value}], commentTitle, commentBody } ->
// this week's feedback submission. Both folded in here (not given files of their own) because Vercel's Hobby
// plan allows twelve functions and twelve are already in use - see api/admin/plan.js's own note on the same
// limit. All three branches are about one install's plan state, which is what this file has always been for.
import { getPool } from '../lib/db.js';
import { matchOrigin } from '../lib/cors.js';
import { planAnswer } from '../lib/installs.js';

const INSTALL_ID = /^[0-9a-f-]{32,36}$/;
const json = (res, code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(body)); };

export default async function handler(req, res) {
  const origin = matchOrigin(req.headers.origin, process.env.ALLOWED_ORIGINS);
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  if (req.query && req.query.beta_request === '1') {
    const id = req.body && req.body.installId;
    if (typeof id !== 'string' || !INSTALL_ID.test(id)) return json(res, 400, { error: 'bad installId' });
    try {
      const { requestBeta } = await import('../lib/beta.js');
      const r = await requestBeta(await getPool(), id);
      return json(res, 200, { requestId: r.requestId, already: r.already });
    } catch (_) { return json(res, 503, { error: 'could not create the request' }); }
  }

  if (req.query && req.query.beta_feedback === '1') {
    try {
      const { validateFeedbackBody, submitFeedback } = await import('../lib/beta.js');
      const parsed = validateFeedbackBody(req.body);
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      const r = await submitFeedback(await getPool(), parsed.value);
      if (!r.ok) return json(res, 409, { error: r.error });
      return json(res, 200, { feedbackId: r.feedbackId });
    } catch (_) { return json(res, 503, { error: 'could not submit feedback' }); }
  }

  const id = req.body && req.body.installId;
  if (typeof id !== 'string' || !INSTALL_ID.test(id)) { res.statusCode = 400; return res.end(); }
  try {
    const answer = await planAnswer(await getPool(), id);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(answer));
  } catch (_) {
    res.statusCode = 503;
    return res.end();
  }
}
