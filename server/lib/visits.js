// Website visit counts: a day and two numbers, never anything about the visitor.

// The calendar day in India (UTC+5:30, no daylight saving), so a visit at 1 AM IST is counted on the right day.
export function istDay(now = Date.now()) {
  return new Date(now + 330 * 60000).toISOString().slice(0, 10);
}

// The body is only ever { first, fresh }: first visit today from this browser, and first visit ever from it.
// Anything else counts as a plain view. A browser is only "fresh" on its first visit of a day.
export function parseVisit(body) {
  const first = !!(body && body.first === true);
  return { first, fresh: first && !!(body && body.fresh === true) };
}

export async function countVisit(pool, { first, fresh }, now = Date.now()) {
  try {
    await pool.query(
      'INSERT INTO site_visits (day, visitors, views, new_visitors) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE visitors = visitors + VALUES(visitors), views = views + 1, new_visitors = new_visitors + VALUES(new_visitors)',
      [istDay(now), first ? 1 : 0, fresh ? 1 : 0]);
  } catch (e) {
    // A database without schema/009 yet: still count the visit and the view.
    if (!e || e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    await pool.query(
      'INSERT INTO site_visits (day, visitors, views) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE visitors = visitors + VALUES(visitors), views = views + 1',
      [istDay(now), first ? 1 : 0]);
  }
}
