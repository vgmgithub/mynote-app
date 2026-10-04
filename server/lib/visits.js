// Website visit counts: a day and a few numbers, never anything about the visitor.
//
// Uniqueness is decided by the browser, not the server: it remembers the day, week and month it was last
// counted (and whether it was ever counted) and says "first" for each period once. The server only adds
// those flags up, so it never needs an identifier to tell a repeat visit from a new one.

// The calendar day in India (UTC+5:30, no daylight saving), so a visit at 1 AM IST is counted on the right day.
export function istDay(now = Date.now()) {
  return new Date(now + 330 * 60000).toISOString().slice(0, 10);
}

// The body is only ever { first, fresh, week, month }: this browser's first visit today, ever, this week and
// this month. Anything else counts as a plain view. A visit can only be first of a longer period if it is
// also the first of the day.
export function parseVisit(body) {
  const b = body && typeof body === 'object' ? body : {};
  const first = b.first === true;
  return { first, fresh: first && b.fresh === true, week: first && b.week === true, month: first && b.month === true };
}

const n = (v) => (v ? 1 : 0);
// Newest schema first; a database still missing a column (schema/009, 010 not applied yet) gets the older
// statement, so the visit and the view are never lost.
const STATEMENTS = [
  ['INSERT INTO site_visits (day, visitors, views, new_visitors, week_visitors, month_visitors) VALUES (?, ?, 1, ?, ?, ?) ON DUPLICATE KEY UPDATE visitors = visitors + VALUES(visitors), views = views + 1, new_visitors = new_visitors + VALUES(new_visitors), week_visitors = week_visitors + VALUES(week_visitors), month_visitors = month_visitors + VALUES(month_visitors)',
    (d, v) => [d, n(v.first), n(v.fresh), n(v.week), n(v.month)]],
  ['INSERT INTO site_visits (day, visitors, views, new_visitors) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE visitors = visitors + VALUES(visitors), views = views + 1, new_visitors = new_visitors + VALUES(new_visitors)',
    (d, v) => [d, n(v.first), n(v.fresh)]],
  ['INSERT INTO site_visits (day, visitors, views) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE visitors = visitors + VALUES(visitors), views = views + 1',
    (d, v) => [d, n(v.first)]],
];

export async function countVisit(pool, visit, now = Date.now()) {
  const day = istDay(now);
  for (let i = 0; i < STATEMENTS.length; i++) {
    try { await pool.query(STATEMENTS[i][0], STATEMENTS[i][1](day, visit)); return; }
    catch (e) { if (!e || e.code !== 'ER_BAD_FIELD_ERROR' || i === STATEMENTS.length - 1) throw e; }
  }
}
