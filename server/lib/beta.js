// Beta: request -> approve -> weekly feedback -> terminate, plus the cohort ranking and the post-Beta offer.
// See docs/beta-plan.md for the design this implements.
//
// Window math is pure (no DB, no clock of its own) so it is tested without a database. Everything that touches
// the database is also here, kept small: one function per step of the lifecycle.

const IST_MIN = 330; // UTC+5:30. India-only user base (docs/context.md), so the window is simply IST, not per-user.
const DAY_MS = 86400000;

// A UTC instant `d` re-read through IST getUTCDay()/getUTCFullYear() etc: shift the instant by the IST offset,
// then read its UTC fields as if they were IST wall-clock fields. This needs no timezone database, so it is
// exactly as deterministic on any Node runtime as `new Date()` arithmetic already is.
const toIstFields = (d) => new Date(d.getTime() + IST_MIN * 60000);
const fromIstMidnight = (istFields) => new Date(Date.UTC(istFields.getUTCFullYear(), istFields.getUTCMonth(), istFields.getUTCDate()) - IST_MIN * 60000);

// The Friday-to-Sunday window (IST) that contains `now`, as real UTC instants, plus its key (the Friday's date).
// Mirrors the app's own `currentWindow` (beta-core.js) so "is it open" never disagrees between device and server.
export function windowFor(now = new Date()) {
  const ist = toIstFields(now);
  const daysSinceFriday = (ist.getUTCDay() - 5 + 7) % 7; // Fri = 5
  const start = fromIstMidnight(new Date(ist.getTime() - daysSinceFriday * DAY_MS));
  const end = new Date(start.getTime() + 3 * DAY_MS - 1); // Sun 23:59:59.999 IST
  return { weekKey: new Date(start.getTime() + IST_MIN * 60000).toISOString().slice(0, 10), start, end, isOpen: now >= start && now <= end };
}

// The most recently CLOSED window as of `now`: if a window is currently open (Fri-Sun), that means the week
// before it; otherwise (Mon-Thu) the window `windowFor` returns already closed and IS the one just missed.
export function lastClosedWindow(now = new Date()) {
  const w = windowFor(now);
  if (now.getTime() > w.end.getTime()) return w;
  return windowFor(new Date(w.start.getTime() - DAY_MS));
}

const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// ---------- request -> approve/reject ----------
// A fresh row every time, never reactivated: re-requesting after a termination is a brand new pending request,
// needing the admin's approval again, exactly like the first time.
export async function requestBeta(pool, installId) {
  const [existing] = await pool.query("SELECT id FROM beta_requests WHERE install_id = ? AND status = 'pending'", [installId]);
  if (existing.length) return { ok: true, requestId: existing[0].id, already: true };
  const [r] = await pool.query('INSERT INTO beta_requests (install_id, status, requested_at) VALUES (?, ?, ?)', [installId, 'pending', nowIso()]);
  return { ok: true, requestId: r.insertId, already: false };
}

export async function listRequests(pool, status = 'pending') {
  const [rows] = await pool.query('SELECT id, install_id, status, requested_at, reviewed_at, reviewed_note, cohort_id FROM beta_requests WHERE status = ? ORDER BY requested_at ASC', [status]);
  return rows;
}

export async function activeCohort(pool) {
  const [rows] = await pool.query('SELECT id, label, start_date, end_date, active, finalized_at FROM beta_cohort WHERE active = 1 ORDER BY id DESC LIMIT 1');
  return rows[0] || null;
}

// Approve: joins the current cohort, installs.plan becomes 'beta', any past termination reason is cleared (it
// described the stint that just ended, not this new one). Reject: the request is marked, nothing else changes.
export async function reviewRequest(pool, requestId, decision, note) {
  const [rows] = await pool.query('SELECT id, install_id, status FROM beta_requests WHERE id = ?', [requestId]);
  if (!rows.length || rows[0].status !== 'pending') return { ok: false, error: 'no such pending request' };
  const installId = rows[0].install_id;
  if (decision === 'approve') {
    const cohort = await activeCohort(pool);
    if (!cohort) return { ok: false, error: 'no active cohort to approve into' };
    await pool.query("UPDATE beta_requests SET status = 'approved', reviewed_at = ?, reviewed_note = ?, cohort_id = ? WHERE id = ?", [nowIso(), note || null, cohort.id, requestId]);
    await pool.query("UPDATE installs SET plan = 'beta', beta_terminated_reason = NULL WHERE install_id = ?", [installId]);
    return { ok: true, installId, cohortId: cohort.id };
  }
  await pool.query("UPDATE beta_requests SET status = 'rejected', reviewed_at = ?, reviewed_note = ? WHERE id = ?", [nowIso(), note || null, requestId]);
  return { ok: true, installId };
}

// ---------- weekly feedback ----------
// Server-side re-validation of the window (the client already gates Submit on it, and on being online at all) -
// defense in depth against a stale cached form: the ONLY moment that matters is now, on THIS server.
export function validateFeedbackBody(body) {
  const b = body || {};
  if (typeof b.installId !== 'string' || !/^[0-9a-f-]{32,36}$/.test(b.installId)) return { ok: false, error: 'bad installId' };
  if (typeof b.weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.weekStart)) return { ok: false, error: 'bad weekStart' };
  if (!Array.isArray(b.answers) || !b.answers.length || b.answers.length > 20) return { ok: false, error: 'bad answers' };
  for (const a of b.answers) {
    if (!a || typeof a.key !== 'string' || a.key.length > 40) return { ok: false, error: 'bad answer key' };
    if (typeof a.value !== 'string' || !a.value.trim() || a.value.length > 2000) return { ok: false, error: 'every question needs an answer' };
  }
  const title = typeof b.commentTitle === 'string' ? b.commentTitle.trim().slice(0, 80) : '';
  const body_ = typeof b.commentBody === 'string' ? b.commentBody.trim().slice(0, 4000) : '';
  if (!title || !body_) return { ok: false, error: 'the comment needs a heading and a body' };
  return { ok: true, value: { installId: b.installId, weekStart: b.weekStart, answers: b.answers, commentTitle: title, commentBody: body_ } };
}

export async function submitFeedback(pool, input, now = new Date()) {
  const [[install]] = await pool.query('SELECT plan FROM installs WHERE install_id = ?', [input.installId]);
  if (!install || install.plan !== 'beta') return { ok: false, error: 'not an active Beta install' };
  const w = windowFor(now);
  if (!w.isOpen || w.weekKey !== input.weekStart) return { ok: false, error: 'the window for that week is not open' };
  const [req] = await pool.query("SELECT cohort_id FROM beta_requests WHERE install_id = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1", [input.installId]);
  const cohortId = req.length ? req[0].cohort_id : (await activeCohort(pool) || {}).id;
  if (!cohortId) return { ok: false, error: 'no cohort on record for this install' };
  try {
    const [r] = await pool.query(
      'INSERT INTO beta_feedback (install_id, cohort_id, week_start, submitted_at, comment_title, comment_body) VALUES (?, ?, ?, ?, ?, ?)',
      [input.installId, cohortId, input.weekStart, nowIso(), input.commentTitle, input.commentBody]);
    for (const a of input.answers) {
      await pool.query('INSERT INTO beta_feedback_answers (feedback_id, question_key, answer_value) VALUES (?, ?, ?)', [r.insertId, a.key, a.value.slice(0, 2000)]);
    }
    return { ok: true, feedbackId: r.insertId };
  } catch (e) {
    if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) return { ok: false, error: 'already submitted for this week' };
    throw e;
  }
}

export async function feedbackStatus(pool, installId, weekKey) {
  const [rows] = await pool.query('SELECT id, reviewed, total_score FROM beta_feedback WHERE install_id = ? AND week_start = ?', [installId, weekKey]);
  if (!rows.length) return null;
  return { submitted: true, reviewed: !!rows[0].reviewed, score: rows[0].total_score == null ? null : Number(rows[0].total_score) };
}

// Shared by both ways Beta ends (docs/beta-plan.md "Rules for termination"): the install drops to Free, and
// its own tier (Member/Contributor/none) is snapshotted right now, against everyone reviewed so far - never
// redone later, so a person who already left is never re-ranked by people who join or get reviewed afterwards.
async function endBetaForInstall(pool, installId, reason) {
  const [req] = await pool.query("SELECT cohort_id FROM beta_requests WHERE install_id = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1", [installId]);
  await pool.query("UPDATE installs SET plan = 'free', beta_terminated_reason = ? WHERE install_id = ?", [reason, installId]);
  if (req.length && req[0].cohort_id) { try { await offerOnPersonalEnd(pool, installId, req[0].cohort_id); } catch (_) { /* ranking needs reviewed feedback; fine if there is none yet */ } }
}

// ---------- the automatic "missed the window" sweep (server cron) ----------
// Authoritative and can't be dodged by simply not opening the app that weekend (docs/beta-plan.md, point 3).
// Only installs approved before the window they are being judged on STARTED are swept - someone approved
// mid-window has not had a fair chance at it yet.
export async function sweepMissedWindows(pool, now = new Date()) {
  const w = lastClosedWindow(now);
  const [betaInstalls] = await pool.query("SELECT install_id FROM installs WHERE plan = 'beta'");
  let terminated = 0;
  for (const { install_id: installId } of betaInstalls) {
    const [approved] = await pool.query(
      "SELECT reviewed_at FROM beta_requests WHERE install_id = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1", [installId]);
    if (!approved.length || new Date(approved[0].reviewed_at) >= w.start) continue; // too new to owe this window
    const [fb] = await pool.query('SELECT 1 FROM beta_feedback WHERE install_id = ? AND week_start = ?', [installId, w.weekKey]);
    if (fb.length) continue; // submitted - safe
    await endBetaForInstall(pool, installId, 'missed_week');
    terminated++;
  }
  return { weekKey: w.weekKey, checked: betaInstalls.length, terminated };
}

// An admin's call, not automatic: reads a submission, decides it is not genuine, ends Beta for that install now.
export async function terminateNotGenuine(pool, installId, note) {
  await endBetaForInstall(pool, installId, 'not_genuine');
  if (note) await pool.query('UPDATE beta_feedback SET reviewed = 1 WHERE install_id = ? AND reviewed = 0', [installId]);
  return { ok: true };
}

// ---------- scoring: per answer, rolled up ----------
// One rating per answer (not one per submission - see docs/beta-plan.md "Per-answer scoring"). The roll-up
// formula is deliberately the simplest possible (a plain average) and lives in ONE place so it can be swapped
// for whatever rubric the owner settles on later, without touching the schema or the call sites.
export function scoreSubmission(answers) {
  const rated = (answers || []).filter((a) => a.score != null && Number.isFinite(Number(a.score)));
  if (!rated.length) return null;
  return Math.round((rated.reduce((s, a) => s + Number(a.score), 0) / rated.length) * 100) / 100;
}

export async function rateAnswer(pool, answerId, score, note) {
  const s = score == null ? null : Math.max(0, Math.min(100, Math.round(Number(score))));
  await pool.query('UPDATE beta_feedback_answers SET score = ?, admin_note = ? WHERE id = ?', [s, note ? String(note).slice(0, 255) : null, answerId]);
  const [[row]] = await pool.query('SELECT feedback_id FROM beta_feedback_answers WHERE id = ?', [answerId]);
  if (!row) return { ok: false };
  const [answers] = await pool.query('SELECT score FROM beta_feedback_answers WHERE feedback_id = ?', [row.feedback_id]);
  const total = scoreSubmission(answers);
  await pool.query('UPDATE beta_feedback SET total_score = ? WHERE id = ?', [total, row.feedback_id]);
  return { ok: true, feedbackId: row.feedback_id, totalScore: total };
}

export async function markReviewed(pool, feedbackId, reviewed = true) {
  await pool.query('UPDATE beta_feedback SET reviewed = ? WHERE id = ?', [reviewed ? 1 : 0, feedbackId]);
}

export async function listFeedbackForAdmin(pool, cohortId) {
  const [rows] = await pool.query(
    `SELECT f.id, f.install_id, f.week_start, f.submitted_at, f.comment_title, f.comment_body, f.reviewed, f.total_score
     FROM beta_feedback f WHERE f.cohort_id = ? ORDER BY f.submitted_at DESC`, [cohortId]);
  const [answers] = rows.length
    ? await pool.query('SELECT id, feedback_id, question_key, answer_value, score, admin_note FROM beta_feedback_answers WHERE feedback_id IN (?)', [rows.map((r) => r.id)])
    : [[]];
  const byFeedback = new Map();
  answers.forEach((a) => { if (!byFeedback.has(a.feedback_id)) byFeedback.set(a.feedback_id, []); byFeedback.get(a.feedback_id).push(a); });
  return rows.map((r) => ({ ...r, total_score: r.total_score == null ? null : Number(r.total_score), answers: byFeedback.get(r.id) || [] }));
}

// ---------- ranking: top 10% of the pool become Contributors, everyone else who completed becomes a Member ----------
// Pure (rows in, ranking out) so the deterministic tie-break and the cutoff maths are tested without a database.
//   pool       every { installId, terminatedReason } ever approved into the cohort (terminatedReason null if not)
//   scores     Map<installId, { avg, firstSubmittedAt }> - avg is that person's mean submission score, over
//              REVIEWED submissions only (docs/beta-plan.md: "only reviewed... scores affect the leaderboard")
// Returns every pool member with a tier: 'contributor' | 'member' | null (terminated, or no reviewed score yet).
export function rankCohort(pool_, scores) {
  const eligible = pool_.filter((p) => !p.terminatedReason && scores.has(p.installId));
  const winners = Math.max(1, Math.floor(pool_.length * 0.10));
  // Tie-break: higher average per-answer score first (the closest proxy this simplified, single-score-per-answer
  // schema has to "product impact" until the owner finalises named rating dimensions - see docs/beta-plan.md),
  // then whoever submitted their first review earlier - rewards consistency among genuine equals. Never random.
  const sorted = eligible.slice().sort((a, b) => {
    const sa = scores.get(a.installId), sb = scores.get(b.installId);
    return sb.avg - sa.avg || new Date(sa.firstSubmittedAt) - new Date(sb.firstSubmittedAt);
  });
  const contributors = new Set(sorted.slice(0, winners).map((p) => p.installId));
  return pool_.map((p) => ({
    installId: p.installId,
    tier: p.terminatedReason ? null : !scores.has(p.installId) ? null : contributors.has(p.installId) ? 'contributor' : 'member',
  }));
}

export async function rankCohortFromDb(pool, cohortId) {
  const [reqs] = await pool.query("SELECT install_id FROM beta_requests WHERE cohort_id = ? AND status = 'approved'", [cohortId]);
  const [installs] = reqs.length ? await pool.query('SELECT install_id, beta_terminated_reason FROM installs WHERE install_id IN (?)', [reqs.map((r) => r.install_id)]) : [[]];
  const reasonOf = new Map(installs.map((i) => [i.install_id, i.beta_terminated_reason]));
  const poolRows = reqs.map((r) => ({ installId: r.install_id, terminatedReason: reasonOf.get(r.install_id) || null }));
  const [fb] = reqs.length
    ? await pool.query("SELECT install_id, total_score, submitted_at FROM beta_feedback WHERE cohort_id = ? AND reviewed = 1 AND total_score IS NOT NULL", [cohortId])
    : [[]];
  const byInstall = new Map();
  fb.forEach((r) => {
    const e = byInstall.get(r.install_id) || { sum: 0, n: 0, first: r.submitted_at };
    e.sum += Number(r.total_score); e.n += 1;
    if (new Date(r.submitted_at) < new Date(e.first)) e.first = r.submitted_at;
    byInstall.set(r.install_id, e);
  });
  const scores = new Map([...byInstall].map(([id, e]) => [id, { avg: e.sum / e.n, firstSubmittedAt: e.first }]));
  return rankCohort(poolRows, scores);
}

// Applies a ranking (finalize): writes an offer for every ranked person who does not already have one for this
// cohort's tier. Idempotent - running it twice never creates a second offer for the same person.
export async function finalizeCohort(pool, cohortId) {
  const ranking = await rankCohortFromDb(pool, cohortId);
  let offered = 0;
  for (const r of ranking) {
    if (!r.tier) continue;
    const planCode = r.tier === 'contributor' ? 'pro_beta_contributor' : 'pro_beta_member';
    const [existing] = await pool.query('SELECT id FROM beta_offers WHERE install_id = ? AND plan_code = ?', [r.installId, planCode]);
    if (existing.length) continue;
    const expires = new Date(Date.now() + 365 * DAY_MS);
    await pool.query('INSERT INTO beta_offers (install_id, plan_code, expires_at, created_at) VALUES (?, ?, ?, ?)', [r.installId, planCode, expires.toISOString().slice(0, 19).replace('T', ' '), nowIso()]);
    offered++;
  }
  await pool.query('UPDATE beta_cohort SET finalized_at = ? WHERE id = ?', [nowIso(), cohortId]);
  return { ranking, offered };
}

// Also called the moment an individual's Beta ends (missed week / not genuine), per docs/beta-plan.md: their own
// tier is whatever the ranking says AS OF NOW against everyone reviewed so far - snapshotted once, never redone.
export async function offerOnPersonalEnd(pool, installId, cohortId) {
  const ranking = await rankCohortFromDb(pool, cohortId);
  const mine = ranking.find((r) => r.installId === installId);
  if (!mine || !mine.tier) return null;
  const planCode = mine.tier === 'contributor' ? 'pro_beta_contributor' : 'pro_beta_member';
  const [existing] = await pool.query('SELECT id FROM beta_offers WHERE install_id = ? AND plan_code = ?', [installId, planCode]);
  if (existing.length) return { planCode, created: false };
  const expires = new Date(Date.now() + 365 * DAY_MS);
  await pool.query('INSERT INTO beta_offers (install_id, plan_code, expires_at, created_at) VALUES (?, ?, ?, ?)', [installId, planCode, expires.toISOString().slice(0, 19).replace('T', ' '), nowIso()]);
  return { planCode, created: true };
}

// ---------- the post-Beta purchase window (Phase 3) ----------
// Unexpired and unredeemed: the ONE thing this checks is whether the purchase OPPORTUNITY still stands, never
// how long a bought subscription itself lasts (that is always a full term from the purchase date, unchanged).
export async function activeOffer(pool, installId, now = new Date()) {
  const [rows] = await pool.query(
    'SELECT plan_code, expires_at FROM beta_offers WHERE install_id = ? AND redeemed_subscription_id IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1',
    [installId, now.toISOString().slice(0, 19).replace('T', ' ')]);
  return rows[0] ? { planCode: rows[0].plan_code, expiresAt: new Date(rows[0].expires_at).toISOString() } : null;
}

export async function redeemOffer(pool, installId, planCode, subscriptionId) {
  await pool.query('UPDATE beta_offers SET redeemed_subscription_id = ? WHERE install_id = ? AND plan_code = ? AND redeemed_subscription_id IS NULL', [subscriptionId, installId, planCode]);
}
