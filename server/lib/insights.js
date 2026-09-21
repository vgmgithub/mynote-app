// "What stands out": plain-language readings of the figures already on the dashboard, most useful first. Pure: it
// takes the shaped stats and returns [{ level, title, text }]. level is 'good' | 'watch' | 'info'.
// Every line is a count or a rate over the whole install base, never about one person.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function insights(s) {
  const out = [];
  const h = s.headline || {};
  const add = (level, title, text) => out.push({ level, title, text });
  if (!h.total) { add('info', 'No installs yet', 'Figures appear here once the first install checks in.'); return out; }

  const proPct = Math.round((h.paid / h.total) * 1000) / 10;
  add(h.paid ? 'good' : 'info', 'Pro conversion ' + proPct + '%', h.paid + ' of ' + h.total + ' installs are on Pro'
    + (h.active30 ? ' (' + Math.round((h.paid / h.active30) * 1000) / 10 + '% of this month\'s active users).' : '.'));

  const fp = s.freePlan || {};
  if (fp.atLimit > 0) add('watch', fp.atLimit + ' at the free limit', fp.atLimitPct + '% of installs with any feature use all ' + fp.limit
    + ' free slots. They are the people most likely to value Pro, and the ones a "Get Pro" nudge should reach.');

  if (h.stickiness != null && h.active30) {
    add(h.stickiness >= 20 ? 'good' : 'watch', 'Stickiness ' + h.stickiness + '%',
      h.stickiness >= 20 ? 'One in five monthly users opens the app on a given day: a real habit for a money app.'
        : 'Under one in five monthly users opens it on a given day. Reminders and the Coming up card are the levers.');
  }

  if (h.justLapsed > 0) add('watch', h.justLapsed + ' just went quiet', 'Last seen 30 to 60 days ago: still recoverable, unlike the ' + Math.max(0, h.lapsed - h.justLapsed) + ' gone longer.');

  const vh = s.versionHealth || {};
  if (vh.tracked && vh.behind) add('watch', vh.behind + ' on an old build', 'Three or more versions behind, so a fix shipped today is not reaching them.');
  else if (vh.tracked) add('good', 'Updates are landing', vh.onLatestPct + '% are on the newest build.');

  const w = s.weekday || [];
  const best = [...w].sort((a, b) => b.n - a.n)[0];
  if (best && best.n > 0) add('info', 'Busiest day: ' + best.name, 'Most check-ins land on ' + best.name + ' (last 90 days). Ship on a quieter day, announce on this one.');

  const nd = s.newDaily || [];
  if (nd.length) {
    const week = nd.slice(-7).reduce((a, r) => a + r.n, 0), before = nd.slice(-14, -7).reduce((a, r) => a + r.n, 0);
    if (week || before) add(week >= before ? 'good' : 'watch', week + ' new this week', before ? (week >= before ? 'Up from ' : 'Down from ') + before + ' the week before.' : 'Nothing the week before.');
  }

  const pp = (s.planPlatform || []).filter((r) => r.total >= 3 && r.paid > 0).sort((a, b) => b.paidPct - a.paidPct)[0];
  if (pp) add('info', pp.key + ' converts best', pp.paidPct + '% of ' + pp.key + ' installs are on Pro (' + pp.paid + ' of ' + pp.total + ').');

  if ((s.unused || []).length) add('info', s.unused.length + ' feature' + (s.unused.length === 1 ? '' : 's') + ' nobody picked', 'Nobody has switched on: ' + s.unused.join(', ') + '. Worth a look at how they are offered.');
  return out;
}

export { WEEKDAYS };
