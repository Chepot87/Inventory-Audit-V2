// Pure data operations shared by the interface and Node's built-in tests.
export const STORAGE_KEY = 'norvak.inventory-audit.v2';
export const VERSION = 2;
export const MAX_QUANTITY = 1000000000;
export const MAX_RECORDS = 20000;
export const MAX_SESSIONS = 500;
export const newId = () => crypto.randomUUID();
export const emptyEntry = () => ({ upc: '', found: '', expected: '', notes: '' });
export const emptyDraft = () => ({ location: '', entries: [emptyEntry()], editingId: null });
export const hasDraft = d => Boolean(d.editingId || d.entries.some(e => Object.values(e).some(v => v !== '')));
export function initialState() {
  const id = newId();
  return { schemaVersion: VERSION, revision: 0, activeSessionId: id,
    sessions: [{ id, name: 'My first audit', createdAt: new Date().toISOString(), archived: false }],
    records: [], draft: emptyDraft() };
}
export function textValue(value, label, max, required = true) {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result)) {
    throw new Error(`${label} ${required ? 'is required and ' : ''}must be ${max} characters or fewer, without control characters.`);
  }
  return result;
}
export function quantity(value, label = 'Quantity') {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) {
    throw new Error(`${label} must be a whole number, including zero.`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_QUANTITY) throw new Error(`${label} must be between 0 and ${MAX_QUANTITY.toLocaleString('en-US')}.`);
  return n;
}
export function validateEntry(entry, location) {
  return { location: textValue(location, 'Location', 80).toUpperCase(),
    upc: textValue(entry.upc, 'UPC / barcode', 100),
    found: quantity(entry.found, 'Physical quantity'), expected: quantity(entry.expected, 'System quantity'),
    notes: textValue(entry.notes, 'Notes', 1000, false) };
}
export const discrepancy = r => r.found - r.expected;
export const statusOf = r => discrepancy(r) === 0 ? 'match' : discrepancy(r) < 0 ? 'shortage' : 'overage';
export function metrics(records) {
  const matches = records.filter(r => statusOf(r) === 'match').length;
  return { locations: new Set(records.map(r => r.location.toUpperCase())).size, total: records.length, matches,
    discrepancies: records.length - matches,
    shortage: records.reduce((n, r) => n + Math.max(0, -discrepancy(r)), 0),
    overage: records.reduce((n, r) => n + Math.max(0, discrepancy(r)), 0),
    rate: records.length ? matches / records.length * 100 : null };
}
export function selectRecords(records, { sessionId, search = '', status = 'all', from = '', to = '', sort = 'createdAt', direction = 'desc' } = {}) {
  const needle = search.trim().toLocaleLowerCase();
  return records.filter(r => {
    const date = localDate(r.createdAt);
    return (!sessionId || r.sessionId === sessionId) && (!needle || [r.location, r.upc, r.notes].some(t => t.toLocaleLowerCase().includes(needle))) &&
      (status === 'all' || (status === 'discrepancy' ? statusOf(r) !== 'match' : statusOf(r) === status)) &&
      (!from || date >= from) && (!to || date <= to);
  }).sort((a, b) => {
    const va = sort === 'discrepancy' ? discrepancy(a) : a[sort];
    const vb = sort === 'discrepancy' ? discrepancy(b) : b[sort];
    const result = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
    return (direction === 'asc' ? result : -result) || a.id.localeCompare(b.id);
  });
}
export function localDate(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid backup timestamp.');
  return new Date(value).toISOString();
}
const validId = v => textValue(v, 'Identifier', 100);
export function validateState(input) {
  if (!input || input.schemaVersion !== VERSION || !Array.isArray(input.sessions) || !Array.isArray(input.records) ||
    !input.sessions.length || input.sessions.length > MAX_SESSIONS || input.records.length > MAX_RECORDS) throw new Error('This is not a supported Inventory Audit V2 backup.');
  const sessions = input.sessions.map(s => {
    if (!s || typeof s.archived !== 'boolean') throw new Error('Invalid session.');
    return { id: validId(s.id), name: textValue(s.name, 'Session name', 80), createdAt: validDate(s.createdAt), archived: s.archived };
  });
  const ids = new Set(sessions.map(s => s.id));
  if (ids.size !== sessions.length || !ids.has(input.activeSessionId)) throw new Error('Invalid or duplicate session identifiers.');
  const records = input.records.map(r => {
    if (!r || !ids.has(r.sessionId)) throw new Error('A record references an unknown session.');
    return { id: validId(r.id), sessionId: r.sessionId, ...validateEntry(r, r.location), createdAt: validDate(r.createdAt), updatedAt: validDate(r.updatedAt) };
  });
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('Duplicate record identifiers.');
  const draft = input.draft ?? emptyDraft();
  if (!draft || !Array.isArray(draft.entries) || !draft.entries.length || draft.entries.length > 40) throw new Error('Invalid saved draft.');
  const cleanDraft = { location: textValue(draft.location, 'Draft location', 80, false), editingId: draft.editingId === null ? null : validId(draft.editingId),
    entries: draft.entries.map(e => ({ upc: textValue(e.upc, 'Draft barcode', 100, false), found: textValue(e.found, 'Draft quantity', 30, false), expected: textValue(e.expected, 'Draft quantity', 30, false), notes: textValue(e.notes, 'Draft notes', 1000, false) })) };
  if (cleanDraft.editingId && (!records.some(r => r.id === cleanDraft.editingId && r.sessionId === input.activeSessionId) || cleanDraft.entries.length !== 1)) throw new Error('Invalid edit draft.');
  return { schemaVersion: VERSION, revision: Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0, activeSessionId: input.activeSessionId, sessions, records, draft: cleanDraft };
}
// Quoting protects CSV syntax. Prefixing untrusted text protects spreadsheet formulas
// and preserves leading zeros in barcode cells when opened in common spreadsheets.
export function csvCell(value, forceText = false) {
  let text = String(value);
  if (forceText || (typeof value !== 'number' && (/^[\s\uFEFF]*[=+@\-]/u.test(text) || /^[\t\r\n]/.test(text)))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function toCSV(records, sessions) {
  const names = new Map(sessions.map(s => [s.id, s.name]));
  const header = ['Session', 'Created at (ISO)', 'Updated at (ISO)', 'Location', 'UPC / barcode', 'Physical', 'System', 'Discrepancy', 'Status', 'Notes'];
  return '\uFEFF' + [header.map(v => csvCell(v)).join(','), ...records.map(r => [csvCell(names.get(r.sessionId)), csvCell(r.createdAt), csvCell(r.updatedAt), csvCell(r.location), csvCell(r.upc, true), csvCell(r.found), csvCell(r.expected), csvCell(discrepancy(r)), csvCell(statusOf(r)), csvCell(r.notes)].join(','))].join('\r\n');
}
export function demoSession() {
  const id = newId(), now = new Date().toISOString();
  const items = [['DEMO-A01','000001234501',24,24,'Fictional notebooks'],['DEMO-A01','000001234502',8,12,'Fictional pens. Recount requested.'],['DEMO-A02','000001234503',18,16,'Fictional folders'],['DEMO-B01','000001234504',0,3,'Fictional labels. Empty bin.'],['DEMO-B02','000001234505',10,10,'Fictional tape'],['DEMO-C01','000001234506',36,36,'Fictional envelopes']];
  return { session: { id, name: 'Demo · fictional inventory', createdAt: now, archived: false }, records: items.map(([location, upc, found, expected, notes]) => ({ id: newId(), sessionId: id, location, upc, found, expected, notes, createdAt: now, updatedAt: now })) };
}
