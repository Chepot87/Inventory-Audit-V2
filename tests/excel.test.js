import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { inflateRawSync } from 'node:zlib';
import { buildAuditWorkbook } from '../excel.js';
import { demoSession, selectRecords } from '../core.js';

const context = vm.createContext({ console, Uint8Array, ArrayBuffer, Buffer, TextEncoder, TextDecoder });
vm.runInContext(readFileSync(new URL('../assets/vendor/xlsx.mini.min.js', import.meta.url), 'utf8'), context);
const XLSX = context.XLSX;
function zipEntry(bytes, filename) {
  const zip = Buffer.from(bytes);
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8), size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    if (name === filename) return (method === 8 ? inflateRawSync(zip.subarray(start, start + size)) : zip.subarray(start, start + size)).toString('utf8');
    offset = start + size;
  }
  throw new Error(`Missing XLSX part: ${filename}`);
}
test('Excel retains leading zeros and formula-leading values as text cells', () => {
  const { records, session } = demoSession();
  records[0].notes = '=HYPERLINK("example")'; session.name = '@fictional';
  const workbook = buildAuditWorkbook(XLSX, records, [session], session.name);
  const sheet = workbook.Sheets['Audit records'];
  assert.equal(sheet.E2.t, 's'); assert.equal(sheet.E2.v, '000001234501');
  assert.equal(sheet.A2.t, 's'); assert.equal(sheet.J2.t, 's');
  assert.equal(sheet.J2.v, '=HYPERLINK("example")'); assert.equal(sheet.J2.f, undefined);
  assert.equal(sheet.F2.t, 'n'); assert.equal(sheet.H3.v, -4);
});
test('actual XLSX bytes round-trip quantities, text, Unicode and summary', () => {
  const { records, session } = demoSession(); records[0].notes = 'Auditoría, "revisar"\nPróximo conteo';
  const bytes = XLSX.write(buildAuditWorkbook(XLSX, records, [session], session.name), { bookType:'xlsx', type:'array', compression:true });
  assert.equal(Buffer.from(bytes).subarray(0, 2).toString(), 'PK');
  const restored = XLSX.read(bytes, { type:'array' });
  assert.equal(restored.SheetNames.join(','), 'Audit records,Summary');
  const data = restored.Sheets['Audit records'], summary = restored.Sheets.Summary;
  assert.equal(data.E2.v, records[0].upc); assert.equal(data.J2.v, records[0].notes);
  assert.equal(data.F5.v, 0); assert.equal(data.H3.v, -4);
  assert.equal(data['!autofilter'].ref, 'A1:J7');
  assert.equal(summary.B6.v, 6); assert.equal(summary.B9.v, 7); assert.equal(summary.B10.v, 2); assert.equal(summary.B11.v, .5);
});
test('XLSX XML contains no formulas or executable injected markup', () => {
  const { records, session } = demoSession(); records[0].notes = '</c><f>SUM(1,2)</f><img src="x">'; records[1].notes = '=SUM(1,2)';
  const bytes = XLSX.write(buildAuditWorkbook(XLSX, records, [session], session.name), { bookType:'xlsx', type:'array', compression:true });
  const xml = zipEntry(bytes, 'xl/worksheets/sheet1.xml');
  assert.ok(!xml.includes('<f>')); assert.ok(!xml.includes('<img')); assert.ok(xml.includes('&lt;f&gt;'));
  assert.ok(xml.includes('000001234501')); assert.ok(zipEntry(bytes, '[Content_Types].xml').includes('spreadsheetml.sheet.main+xml'));
});
test('filtered export summary counts only the exported selection', () => {
  const { records, session } = demoSession();
  const selection = selectRecords(records, { status:'shortage', sessionId:session.id });
  const workbook = buildAuditWorkbook(XLSX, selection, [session], session.name);
  assert.equal(workbook.Sheets['Audit records']['!ref'], 'A1:J3');
  assert.equal(workbook.Sheets.Summary.B6.v, 2); assert.equal(workbook.Sheets.Summary.B9.v, 7);
  assert.equal(workbook.Sheets.Summary.B10.v, 0); assert.equal(workbook.Sheets.Summary.B11.v, 0);
});
