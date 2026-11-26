import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, MAX_QUANTITY, quantity, validateEntry, initialState, emptyEntry, hasDraft, validateState, discrepancy, statusOf, metrics, selectRecords, csvCell, toCSV, demoSession, localDate } from '../core.js';

test('storage namespace is independent from legacy HTML storage', () => {
  assert.equal(STORAGE_KEY, 'norvak.inventory-audit.v2'); assert.notEqual(STORAGE_KEY, 'inventoryLogTable');
});
test('quantities accept zero and reject ambiguous or invalid input', () => {
  for (const value of ['0', 0, '12', '00012', MAX_QUANTITY]) assert.equal(quantity(value), Number(value));
  for (const value of ['', ' ', -1, '-1', '1.5', 1.5, '2e3', '3x', '+1', NaN, Infinity, null, undefined, true, [], {}, MAX_QUANTITY + 1]) assert.throws(() => quantity(value));
});
test('record validation requires location and UPC, preserving barcode zeros', () => {
  const entry = { upc: ' 0012345 ', found: '0', expected: '5', notes: ' Recount ' };
  assert.deepEqual(validateEntry(entry, ' a-01 '), { location: 'A-01', upc: '0012345', found: 0, expected: 5, notes: 'Recount' });
  for (const location of ['', ' ', 'x'.repeat(81)]) assert.throws(() => validateEntry(entry, location));
  assert.throws(() => validateEntry({ ...entry, upc: '' }, 'A'));
  assert.throws(() => validateEntry({ ...entry, notes: 'x'.repeat(1001) }, 'A'));
  assert.throws(() => validateEntry({ ...entry, found: '' }, 'A'));
});
test('untrusted markup remains plain structured text', () => {
  const entry = validateEntry({ upc: '<img src=x onerror=alert(1)>', found: 1, expected: 1, notes: '<script>alert(1)</script>' }, 'A');
  assert.equal(entry.notes, '<script>alert(1)</script>');
  assert.equal(typeof entry.upc, 'string');
});
test('discrepancy is physical minus system with separate statuses', () => {
  for (const [found, expected, difference, status] of [[0,0,0,'match'],[0,8,-8,'shortage'],[12,9,3,'overage']]) {
    assert.equal(discrepancy({ found, expected }), difference); assert.equal(statusOf({ found, expected }), status);
  }
});
test('session metrics do not net shortages against overages', () => {
  const { records } = demoSession();
  assert.deepEqual(metrics(records), { locations:5, total:6, matches:3, discrepancies:3, shortage:7, overage:2, rate:50 });
  assert.deepEqual(metrics([]), { locations:0, total:0, matches:0, discrepancies:0, shortage:0, overage:0, rate:null });
});
test('search, status, session and local date filters compose', () => {
  const { records, session } = demoSession();
  assert.equal(selectRecords(records, { search:'notebooks' }).length, 1);
  assert.equal(selectRecords(records, { search:'demo-a01' }).length, 2);
  assert.equal(selectRecords(records, { search:'000001234502' }).length, 1);
  assert.equal(selectRecords(records, { status:'discrepancy' }).length, 3);
  assert.equal(selectRecords(records, { status:'shortage' }).length, 2);
  assert.equal(selectRecords(records, { status:'overage' }).length, 1);
  assert.equal(selectRecords(records, { status:'match', sessionId:session.id }).length, 3);
  assert.equal(selectRecords(records, { sessionId:'other' }).length, 0);
  const day = localDate(records[0].createdAt);
  assert.equal(selectRecords(records, { from:day, to:day }).length, 6);
  assert.equal(selectRecords(records, { from:'2099-01-01' }).length, 0);
  assert.equal(selectRecords(records, { to:'2000-01-01' }).length, 0);
  assert.equal(selectRecords(records, { search:'pens', status:'match' }).length, 0);
});
test('sorting quantities and differences is numeric', () => {
  const { records } = demoSession();
  assert.deepEqual(selectRecords(records, { sort:'found', direction:'asc' }).map(r => r.found), [0,8,10,18,24,36]);
  assert.deepEqual(selectRecords(records, { sort:'discrepancy', direction:'desc' }).map(discrepancy), [2,0,0,0,-3,-4]);
});
test('JSON backups round-trip all records, sessions and edit drafts', () => {
  const state = initialState(), demo = demoSession(); state.sessions.push(demo.session); state.records.push(...demo.records);
  state.activeSessionId = demo.session.id;
  state.draft = { location:'DEMO-A01', editingId:demo.records[0].id, entries:[{ upc:'00123', found:'0', expected:'4', notes:'Unsaved edit' }] };
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
});
test('invalid backups reject the whole file rather than partially importing', () => {
  const valid = initialState(), demo = demoSession(); valid.sessions.push(demo.session); valid.records = demo.records;
  const invalid = [ { ...valid, schemaVersion:1 }, { ...valid, sessions:[] }, { ...valid, activeSessionId:'missing' }, { ...valid, sessions:[...valid.sessions, valid.sessions[0]] }, { ...valid, records:[...valid.records, valid.records[0]] }, { ...valid, records:[{ ...valid.records[0], sessionId:'missing' }] }, { ...valid, records:[{ ...valid.records[0], createdAt:'invalid' }] }, { ...valid, records:[{ ...valid.records[0], expected:-1 }] }, { ...valid, draft:{ location:'A', entries:[], editingId:null } }, { ...valid, draft:{ ...valid.draft, editingId:'missing' } } ];
  for (const state of invalid) assert.throws(() => validateState(state));
});
test('drafts preserve incomplete quantities without treating them as counts', () => {
  const state = initialState(); state.draft.entries[0].found = '-';
  assert.equal(validateState(state).draft.entries[0].found, '-');
  assert.throws(() => validateEntry(state.draft.entries[0], 'A'));
  assert.equal(hasDraft({ location:'A', entries:[emptyEntry()], editingId:null }), false);
  assert.equal(hasDraft(state.draft), true);
});
test('CSV escapes quotes, commas, newlines and formula prefixes', () => {
  assert.equal(csvCell('He said "check", then\nleft'), '"He said ""check"", then\nleft"');
  for (const value of ['=SUM(1,2)', '+cmd', '-cmd', '@SUM(A1)', '\t=cmd', ' \r=cmd', '\n@cmd', '\uFEFF=cmd']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell(-4), '"-4"'); assert.equal(csvCell('00123', true), '"\'00123"');
});
test('CSV export contains structured data and UTC timestamps', () => {
  const { records, session } = demoSession(); records[0].notes = '=HYPERLINK("evil")'; session.name = '@untrusted';
  const csv = toCSV(records, [session]);
  assert.ok(csv.startsWith('\uFEFF"Session"')); assert.ok(csv.includes('"\'@untrusted"')); assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
  assert.ok(csv.includes('"\'000001234501"')); assert.ok(csv.includes('"-4"')); assert.ok(csv.includes(records[0].createdAt));
});
