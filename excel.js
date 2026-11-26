import { discrepancy, statusOf, metrics } from './core.js';

// SheetJS is vendored and loaded only when an Excel export is requested.
let enginePromise;
export function loadExcelEngine() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (enginePromise) return enginePromise;
  enginePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./assets/vendor/xlsx.mini.min.js', import.meta.url).href;
    script.onload = () => window.XLSX ? resolve(window.XLSX) : fail();
    script.onerror = fail;
    function fail() {
      script.remove(); enginePromise = undefined;
      reject(new Error('Excel export could not load. Please try again, or download CSV.'));
    }
    document.head.append(script);
  });
  return enginePromise;
}

export function buildAuditWorkbook(XLSX, records, sessions, sessionName, exportedAt = new Date().toISOString()) {
  const names = new Map(sessions.map(s => [s.id, s.name]));
  const headings = ['Session', 'Created at (ISO)', 'Updated at (ISO)', 'Location', 'UPC / barcode', 'Physical', 'System', 'Discrepancy', 'Status', 'Notes'];
  const rows = [headings, ...records.map(r => [names.get(r.sessionId) || '', r.createdAt, r.updatedAt,
    r.location, r.upc, r.found, r.expected, discrepancy(r), statusOf(r), r.notes])];
  // Plain strings become text cells, including formula-leading notes and barcode
  // leading zeros. Only counts and differences become numeric cells. No formulas.
  const data = XLSX.utils.aoa_to_sheet(rows);
  data['!cols'] = [28, 26, 26, 20, 22, 14, 14, 16, 14, 60].map(wch => ({ wch }));
  data['!autofilter'] = { ref: `A1:J${rows.length}` };
  const m = metrics(records);
  const summary = XLSX.utils.aoa_to_sheet([
    ['Inventory Audit by Norvak', 'v2.0.1'],
    ['Audit session', sessionName],
    ['Exported at (ISO)', exportedAt],
    ['Scope', 'Filtered records in the selected session'],
    ['Locations audited', m.locations], ['Audit records', m.total],
    ['Matching records', m.matches], ['Records with discrepancies', m.discrepancies],
    ['Shortage units', m.shortage], ['Overage units', m.overage],
    ['Match rate', m.rate === null ? 'No records' : m.rate / 100],
    ['How to read this report', 'Recounts are separate records. Summary metrics cover only the exported selection.'],
    ['Privacy', 'This file was generated in your browser. It was not automatically uploaded or synchronized.']
  ]);
  if (m.rate !== null) summary.B11.z = '0.0%';
  summary['!cols'] = [{ wch: 30 }, { wch: 95 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, data, 'Audit records');
  XLSX.utils.book_append_sheet(workbook, summary, 'Summary');
  workbook.Props = { Title: 'Inventory Audit by Norvak', Author: 'Norvak Web', Subject: 'Inventory audit report' };
  return workbook;
}
