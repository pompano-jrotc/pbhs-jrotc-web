/**
 * exportCSV — convert an array of flat objects to a CSV file download.
 *
 * @param {Object[]} rows     - data rows (flat objects)
 * @param {string}   filename - e.g. "roster_alpha.csv"
 * @param {Object[]} [colDefs] - optional: [{ key, label }] to control column order + headers.
 *                              If omitted, all keys from the first row are used.
 */
export function exportCSV(rows, filename, colDefs) {
  if (!rows?.length) return;

  const cols = colDefs || Object.keys(rows[0]).map(k => ({ key: k, label: k }));

  const escape = (val) => {
    if (val == null) return '';
    const str = String(val);
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const header = cols.map(c => escape(c.label)).join(',');
  const body   = rows.map(row =>
    cols.map(c => escape(row[c.key])).join(',')
  ).join('\n');

  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
