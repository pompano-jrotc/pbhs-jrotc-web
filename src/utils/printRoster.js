// src/utils/printRoster.js
// Opens a print-ready window for a cadet roster formatted to the standard
// PBHS JROTC format: cadets grouped by LET level, Last-First names, and a
// LET breakdown + total at the bottom.
//
// cadets  — [{fullName, letLevel, ...}]
// title   — string shown centered at the top (e.g. "Alpha Company Roster")
// opts    — { extraCols: number of blank columns to the right (default 6) }

export function printRoster(cadets, title, { extraCols = 6 } = {}) {
  function toLastFirst(fullName = '') {
    const name = fullName.trim();
    const idx  = name.lastIndexOf(' ');
    if (idx === -1) return name;
    return `${name.slice(idx + 1)}, ${name.slice(0, idx)}`;
  }

  const LET_LEVELS = ['LET 1', 'LET 2', 'LET 3', 'LET 4'];

  const groups = LET_LEVELS
    .map(level => ({
      level,
      members: cadets
        .filter(c => (c.letLevel || '').trim() === level)
        .map(c => ({ ...c, displayName: toLastFirst(c.fullName) }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }))
    .filter(g => g.members.length > 0);

  const counts = LET_LEVELS.map(l => ({
    level: l,
    count: cadets.filter(c => (c.letLevel || '').trim() === l).length,
  })).filter(c => c.count > 0);

  const total = cadets.length;

  const emptyTd = '<td></td>'.repeat(extraCols);

  const rowsHtml = groups
    .map(({ level, members }) => {
      const letNum = level.replace('LET ', '');
      return members
        .map((m, i) => `
          <tr>
            <td class="name-cell">
              ${m.displayName}
              ${i === 0 ? `<span class="let-num">${letNum}</span>` : ''}
            </td>
            ${emptyTd}
          </tr>`)
        .join('');
    })
    .join('');

  const summaryHtml =
    counts.map(({ level, count }) =>
      `<tr class="sum-row"><td>${level}:</td><td>${count}</td>${'<td></td>'.repeat(extraCols - 1)}</tr>`
    ).join('') +
    `<tr class="sum-total"><td><strong>Total:</strong></td><td><strong>${total}</strong></td>${'<td></td>'.repeat(extraCols - 1)}</tr>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 0.6in 0.75in; font-size: 9pt; color: #000; }
    h1   { text-align: center; font-size: 11pt; font-weight: bold; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { border: 1.5px solid #000; padding: 4px 6px; text-align: left; font-weight: bold; }
    td { border: 1px solid #000; padding: 3px 6px; height: 18px; }
    th:first-child, td:first-child { width: 220px; }
    .name-cell { position: relative; }
    .let-num { float: right; font-weight: bold; }
    .gap td  { border: none; height: 14px; }
    .sum-row td, .sum-total td { border: none; padding: 1px 6px; }
    @media print { body { margin: 0.5in; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <table>
    <thead>
      <tr>
        <th>Cadet Name</th>
        ${'<th></th>'.repeat(extraCols)}
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="gap"><td colspan="${extraCols + 1}"></td></tr>
      ${summaryHtml}
    </tbody>
  </table>
  <script>setTimeout(() => { window.focus(); window.print(); }, 300);</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=850,height=1000');
  if (!win) { alert('Allow pop-ups for this site to print the roster.'); return; }
  win.document.write(html);
  win.document.close();
}
