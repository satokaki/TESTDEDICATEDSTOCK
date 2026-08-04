import { jsPDF } from 'jspdf';

/**
 * Reusable tabular report PDF engine (jspdf, text-based, paginated).
 * Used by every report module so design changes live in one place.
 *
 * columns: [{ key, header, align?: 'left'|'right'|'center', width?: number }]
 * rows: array of plain objects (keys match columns)
 * meta: { company?, period?, printedBy? }
 */
export function exportReportToPDF({ title, subtitle, columns, rows, fileName, meta = {} }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 30;
  const usableW = pageW - margin * 2;
  const rowH = 16;

  const fmtDateTime = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const now = new Date();

  // Column widths: explicit width wins; remaining space split evenly among the rest.
  const specifiedSum = columns.reduce((s, c) => s + (c.width || 0), 0);
  const unspecCount = columns.filter((c) => !c.width).length;
  const autoW = unspecCount > 0 ? (usableW - specifiedSum) / unspecCount : 0;
  const colW = columns.map((c) => c.width || autoW);

  const alignOf = (c) => (c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left');

  const drawHeader = () => {
    let y = margin + 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20, 20, 20);
    doc.text(meta.company || 'LAB PRO — E-Liquid Management', margin, y);
    y += 16;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(95, 95, 95);
    if (meta.period) { doc.text(`Periode: ${meta.period}`, margin, y); y += 12; }
    doc.text(`Dicetak: ${fmtDateTime(now)}`, margin, y);
    if (meta.printedBy) doc.text(`Dicetak oleh: ${meta.printedBy}`, margin + 240, y);
    y += 12;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 20);
    doc.text(title || 'Laporan', margin, y);
    y += 12;
    if (subtitle) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(95, 95, 95);
      doc.text(subtitle, margin, y);
      y += 12;
    }
    y += 4;
    doc.setDrawColor(205, 210, 215); doc.setLineWidth(0.8);
    doc.line(margin, y, pageW - margin, y);
    return y + 12;
  };

  const drawFooter = (page) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(135, 135, 135);
    doc.text(`LAB PRO · ${fmtDateTime(now)}`, margin, pageH - 12);
    doc.text(`Halaman ${page}`, pageW - margin, pageH - 12, { align: 'right' });
  };

  const drawTableHeader = (y) => {
    doc.setFillColor(235, 238, 242); doc.setTextColor(40, 40, 40);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.rect(margin, y - 10, usableW, rowH, 'F');
    let x = margin;
    columns.forEach((c, i) => {
      const align = alignOf(c);
      const tx = align === 'right' ? x + colW[i] - 4 : align === 'center' ? x + colW[i] / 2 : x + 4;
      doc.text(String(c.header || ''), tx, y + 1, align === 'left' ? undefined : { align });
      x += colW[i];
    });
    return y + rowH;
  };

  const drawRow = (row, y, shade) => {
    if (shade) { doc.setFillColor(248, 249, 251); doc.rect(margin, y - 10, usableW, rowH, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(40, 40, 40);
    let x = margin;
    columns.forEach((c, i) => {
      const val = row[c.key];
      const txt = val === null || val === undefined ? '' : String(val);
      const align = alignOf(c);
      const tx = align === 'right' ? x + colW[i] - 4 : align === 'center' ? x + colW[i] / 2 : x + 4;
      // Clamp text to column width (rough char cap)
      const max = Math.floor(colW[i] / 4.4);
      const out = txt.length > max ? txt.slice(0, max - 1) + '…' : txt;
      doc.text(out, tx, y + 1, align === 'left' ? undefined : { align });
      x += colW[i];
    });
    return y + rowH;
  };

  let page = 1;
  let y = drawHeader();
  drawFooter(page);
  y = drawTableHeader(y);
  rows.forEach((row, ri) => {
    if (y > pageH - margin - 24) {
      drawFooter(page);
      doc.addPage();
      page += 1;
      y = drawHeader();
      drawFooter(page);
      y = drawTableHeader(y);
    }
    y = drawRow(row, y, ri % 2 === 1);
  });

  doc.save(fileName || 'laporan.pdf');
}