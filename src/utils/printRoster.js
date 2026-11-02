// src/utils/printRoster.js
// Generates and auto-downloads a PDF roster formatted to the standard PBHS
// JROTC format: cadets grouped by LET level, LET number marker on the first
// cadet of each group, and a LET breakdown + total at the bottom.
//
// cadets — [{fullName, letLevel, ...}]  — names already stored as "LAST, FIRST"
// title  — string shown centered at the top (e.g. "Alpha Company Roster")
// opts   — { extraCols: number of blank data columns (default 6) }

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function printRoster(cadets, title, { extraCols = 6 } = {}) {
  const LET_LEVELS = ['LET 1', 'LET 2', 'LET 3', 'LET 4'];

  const groups = LET_LEVELS
    .map(level => ({
      level,
      members: cadets
        .filter(c => (c.letLevel || '').trim() === level)
        .slice()
        .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '')),
    }))
    .filter(g => g.members.length > 0);

  const counts = LET_LEVELS.map(l => ({
    level: l,
    count: cadets.filter(c => (c.letLevel || '').trim() === l).length,
  })).filter(c => c.count > 0);

  const total = cadets.length;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });

  // ── Title ─────────────────────────────────────────────────────────────────
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  const pageW = doc.internal.pageSize.getWidth();
  doc.text(title, pageW / 2, 40, { align: 'center' });

  // ── Build body rows ───────────────────────────────────────────────────────
  const body = [];
  groups.forEach(({ level, members }) => {
    const letNum = level.replace('LET ', '');
    members.forEach((m, i) => {
      const nameCell = i === 0
        ? {
            content: m.fullName || '',
            styles: {},
            // Render LET number right-aligned inside the name cell via didDrawCell hook
            _letNum: letNum,
          }
        : { content: m.fullName || '' };
      body.push([nameCell, ...Array(extraCols).fill({ content: '' })]);
    });
  });

  // ── Summary rows (LET breakdown + total) ─────────────────────────────────
  body.push([{ content: '', colSpan: extraCols + 1, styles: { cellPadding: 4 } }]);
  counts.forEach(({ level, count }) => {
    body.push([
      { content: `${level}:  ${count}`, styles: { fontStyle: 'normal', halign: 'left', cellPadding: { top: 1, bottom: 1, left: 4 } } },
      ...Array(extraCols).fill({ content: '', styles: { lineWidth: 0 } }),
    ]);
  });
  body.push([
    { content: `Total:  ${total}`, styles: { fontStyle: 'bold', halign: 'left', cellPadding: { top: 1, bottom: 2, left: 4 } } },
    ...Array(extraCols).fill({ content: '', styles: { lineWidth: 0 } }),
  ]);

  // ── Column widths: wide name col + equal blank cols ───────────────────────
  const margin  = 36;
  const usable  = pageW - margin * 2;
  const nameCW  = Math.round(usable * 0.38);
  const blankCW = Math.round((usable - nameCW) / extraCols);

  autoTable(doc, {
    startY: 55,
    head: [['Cadet Name', ...Array(extraCols).fill('')]],
    body,
    margin: { left: margin, right: margin },
    tableWidth: usable,
    columnStyles: {
      0: { cellWidth: nameCW },
      ...Object.fromEntries(
        Array.from({ length: extraCols }, (_, i) => [i + 1, { cellWidth: blankCW }])
      ),
    },
    headStyles: {
      fillColor:  [255, 255, 255],
      textColor:  [0, 0, 0],
      fontStyle:  'bold',
      fontSize:   8,
      lineWidth:  0.75,
      lineColor:  [0, 0, 0],
      cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize:   8,
      fontStyle:  'normal',
      textColor:  [0, 0, 0],
      lineWidth:  0.4,
      lineColor:  [0, 0, 0],
      fillColor:  [255, 255, 255],
      cellPadding: { top: 2, bottom: 2, left: 4, right: 4 },
      minCellHeight: 14,
    },
    // Draw LET number right-aligned inside the name cell for the first cadet
    didDrawCell(data) {
      if (data.column.index !== 0 || data.section !== 'body') return;
      const raw = data.row.raw;
      const cell = Array.isArray(raw) ? raw[0] : null;
      if (!cell?._letNum) return;
      const { x, y, width, height } = data.cell;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(cell._letNum, x + width - 4, y + height / 2 + 3, { align: 'right' });
      doc.setFont('helvetica', 'normal');
    },
    // Don't draw borders on the summary blank cells
    willDrawCell(data) {
      if (data.section !== 'body') return;
      const raw = data.row.raw;
      const isSum = Array.isArray(raw) && raw.length > 1 && raw[1]?.styles?.lineWidth === 0;
      if (isSum && data.column.index > 0) {
        data.cell.styles.lineWidth = 0;
      }
    },
  });

  // ── Save ──────────────────────────────────────────────────────────────────
  const fileName = `${title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_')}.pdf`;
  doc.save(fileName);
}
