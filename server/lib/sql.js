// Pure helpers shared by the scripts, kept dependency-free so they can be unit tested.
export function splitStatements(sqlText) {
  return sqlText
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
}

// Turns rows into INSERT statements that restore on any MySQL. `escape` is mysql2's own
// connection.escape, so quoting and escaping are the driver's, not hand-rolled.
export function toInsertSql(table, rows, escape, batch = 500) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const head = 'INSERT INTO `' + table + '` (' + cols.map((c) => '`' + c + '`').join(', ') + ') VALUES\n';
  const out = [];
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch).map((r) => '(' + cols.map((c) => escape(r[c])).join(', ') + ')');
    out.push(head + chunk.join(',\n') + ';');
  }
  return out.join('\n') + '\n';
}
