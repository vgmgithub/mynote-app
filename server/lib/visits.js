// Website visit counts: a day and two numbers, never anything about the visitor.

// The calendar day in India (UTC+5:30, no daylight saving), so a visit at 1 AM IST is counted on the right day.
export function istDay(now = Date.now()) {
  return new Date(now + 330 * 60000).toISOString().slice(0, 10);
}

// The body is only ever { first: true|false }; anything else counts as a plain view.
export function parseVisit(body) {
  return { first: !!(body && body.first === true) };
}

export async function countVisit(pool, { first }, now = Date.now()) {
  await pool.query(
    'INSERT INTO site_visits (day, visitors, views) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE visitors = visitors + VALUES(visitors), views = views + 1',
    [istDay(now), first ? 1 : 0]);
}
