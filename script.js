import { STORAGE_KEY, MAX_RECORDS, MAX_SESSIONS, newId, emptyDraft, emptyEntry, hasDraft, initialState, validateEntry, validateState, textValue, quantity, discrepancy, statusOf, metrics, selectRecords, localDate, toCSV, demoSession } from './core.js';
import { loadExcelEngine, buildAuditWorkbook } from './excel.js';

const $ = id => document.getElementById(id);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const fmt = n => n.toLocaleString();
const session = () => state.sessions.find(s => s.id === state.activeSessionId);
const sessionRecords = () => state.records.filter(r => r.sessionId === state.activeSessionId);
const humanDate = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
let state, lastStored = null, blocked = false, saved = true, fatalStorage = false, toastTimer, page = 1;
let sort = 'createdAt', direction = 'desc', pendingConfirmation = null;
const PAGE_SIZE = 25;

function storageAlert(message) {
  $('storage-alert').replaceChildren(el('span', message));
  const reload = el('button', 'Reload latest data', 'button secondary');
  reload.type = 'button';
  reload.addEventListener('click', () => {
    if (!saved || (blocked && !fatalStorage)) download(JSON.stringify(state, null, 2), `inventory-audit-unsaved-${localDate(new Date())}.json`, 'application/json');
    window.location.reload();
  });
  $('storage-alert').append(reload);
  $('storage-alert').hidden = false;
  $('save-state').textContent = '⚠ Saving needs attention';
  $('save-state').style.color = 'var(--amber)';
}
try {
  lastStored = localStorage.getItem(STORAGE_KEY);
  state = lastStored ? validateState(JSON.parse(lastStored)) : initialState();
} catch {
  state = initialState(); blocked = true; fatalStorage = true;
  storageAlert('Saved data could not be read. Existing storage has been left intact. Use Data & backups to download recovery data or restore a valid V2 backup.');
}
function persist(next, { recovery = false } = {}) {
  if (blocked && !recovery) throw new Error('Saving is paused. Back up your data, then reload the latest data or restore a valid backup.');
  if (localStorage.getItem(STORAGE_KEY) !== lastStored && !recovery) {
    blocked = true;
    storageAlert('Another tab changed this audit. Saving is paused to protect both copies. Reload to continue; an unsaved draft will be downloaded first.');
    throw new Error('Another tab changed the data. Reload before saving.');
  }
  const candidate = { ...next, revision: next.revision + 1 };
  const raw = JSON.stringify(candidate);
  try { localStorage.setItem(STORAGE_KEY, raw); }
  catch {
    saved = false;
    storageAlert('This browser could not save your data. Storage may be full or unavailable. Export a backup before leaving this page, then free browser storage or try another browser.');
    throw new Error('Could not save. Your audit has not been added. Keep this page open and download a backup.');
  }
  state = candidate; lastStored = raw; saved = true;
  if (recovery) { blocked = false; fatalStorage = false; $('storage-alert').hidden = true; }
  $('save-state').textContent = `✓ Saved in this browser · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  $('save-state').style.color = '';
}
function commit(change, options) {
  const next = structuredClone(state);
  change(next);
  persist(next, options);
  render();
}
function notify(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 8500 : 4500);
}
const run = fn => async (...args) => { try { await fn(...args); } catch (error) { notify(error.message || 'Something went wrong. Your data has not been changed.', true); } };
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function backup() {
  download(JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2), `inventory-audit-v2-${localDate(new Date())}.json`, 'application/json');
  notify('Backup downloaded. Keep it somewhere safe.');
}
function getFilters() {
  return { sessionId: state.activeSessionId, search: $('search').value, status: $('status-filter').value,
    from: $('date-from').value, to: $('date-to').value, sort, direction };
}
function filteredRecords() { return selectRecords(state.records, getFilters()); }
function resetFilters() {
  $('search').value = ''; $('status-filter').value = 'all'; $('date-from').value = ''; $('date-to').value = ''; page = 1;
}
function render() {
  const current = session();
  $('session-select').replaceChildren(...state.sessions.map(s => {
    const option = el('option', s.name + (s.archived ? ' · archived' : ''));
    option.value = s.id; option.selected = s.id === state.activeSessionId; return option;
  }));
  $('session-count').textContent = state.sessions.length;
  $('session-status').textContent = current.archived ? 'Archived' : 'Open';
  $('session-date').textContent = `Started ${humanDate(current.createdAt)}`;
  const m = metrics(sessionRecords());
  for (const key of ['locations', 'total', 'matches', 'discrepancies', 'shortage', 'overage']) $('metric-' + key).textContent = fmt(m[key]);
  $('metric-rate').textContent = m.rate === null ? '—' : `${Number(m.rate.toFixed(1))}%`;
  $('match-ring').style.setProperty('--rate', `${m.rate ?? 0}%`);
  $('match-ring').setAttribute('aria-label', m.rate === null ? 'No records yet' : `${Number(m.rate.toFixed(1))} percent of records match`);
  renderDraft(); renderRecords();
}
function renderDraft() {
  $('location').value = state.draft.location;
  $('entry-rows').replaceChildren();
  state.draft.entries.forEach((entry, index) => {
    const row = $('entry-template').content.firstElementChild.cloneNode(true);
    row.querySelector('legend').textContent = `Barcode entry ${index + 1}`;
    for (const field of ['upc', 'found', 'expected', 'notes']) row.querySelector('.' + field).value = entry[field];
    row.querySelector('.remove-entry').disabled = state.draft.entries.length === 1 || Boolean(state.draft.editingId);
    row.querySelector('.remove-entry').setAttribute('aria-label', `Remove barcode entry ${index + 1}`);
    row.querySelector('.remove-entry').addEventListener('click', run(async () => {
      if (Object.values(state.draft.entries[index]).some(Boolean) && !await confirmAction('Remove this barcode entry?', 'This removes this unsaved entry from your draft.', 'Remove entry', true)) return;
      commit(next => next.draft.entries.splice(index, 1));
    }));
    row.addEventListener('input', () => { captureDraft(); updateDifference(row); });
    $('entry-rows').append(row); updateDifference(row);
  });
  const editing = Boolean(state.draft.editingId);
  $('entry-title').textContent = editing ? 'Edit audit record' : 'Log an audit';
  $('save-records').textContent = editing ? 'Save changes' : '+ Save audit';
  $('add-upc').hidden = editing;
  $('cancel-edit').hidden = !editing;
  $('archived-note').hidden = !session().archived;
  $('audit-form').hidden = session().archived;
  $('draft-state').textContent = hasDraft(state.draft) ? 'Draft saved in this browser' : 'Draft saves automatically';
}
function captureDraft() {
  state.draft = { location: $('location').value, editingId: state.draft.editingId, entries: [...$('entry-rows').children].map(row => Object.fromEntries(['upc', 'found', 'expected', 'notes'].map(field => [field, row.querySelector('.' + field).value]))) };
  try { persist(state); $('draft-state').textContent = 'Draft saved in this browser'; }
  catch (error) { saved = false; $('draft-state').textContent = 'Draft not saved — back up now'; if (!blocked) notify(error.message, true); }
}
function updateDifference(row) {
  const output = row.querySelector('output');
  try {
    const n = quantity(row.querySelector('.found').value) - quantity(row.querySelector('.expected').value);
    output.textContent = `${n > 0 ? '+' : ''}${fmt(n)}`;
    output.style.color = n === 0 ? 'var(--green)' : n < 0 ? 'var(--pink)' : 'var(--cyan)';
  } catch { output.textContent = '—'; output.style.color = ''; }
}
function statusBadge(record) {
  const status = statusOf(record), d = discrepancy(record);
  return el('span', status === 'match' ? '✓ Match' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))} ${status === 'shortage' ? 'Short' : 'Over'}`, `status-badge status-${status}`);
}
function renderRecords() {
  const filtered = filteredRecords(), total = sessionRecords().length;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); page = Math.max(1, Math.min(page, pages));
  const from = $('date-from').value, to = $('date-to').value;
  $('date-error').hidden = !from || !to || from <= to;
  $('records-body').replaceChildren(...filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(recordRow));
  $('records-count').textContent = fmt(total);
  $('empty-state').hidden = filtered.length > 0;
  $('records-table').hidden = filtered.length === 0;
  $('empty-state').querySelector('h3').textContent = total ? 'No counts match these filters.' : 'Your next audit starts here.';
  $('empty-state').querySelector('p').textContent = total ? 'Try another search, change a date, or reset the filters.' : 'Save your first count above, or explore with fictional demo inventory.';
  $('load-demo').hidden = total > 0;
  $('results-label').textContent = `${fmt(filtered.length)} of ${fmt(total)} records · ${filtered.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} shown` : 'none shown'}`;
  $('page-label').textContent = `Page ${page} of ${pages}`;
  $('prev-page').disabled = page === 1; $('next-page').disabled = page === pages;
  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.removeAttribute('aria-sort');
    th.querySelector('span').textContent = th.dataset.sort === sort ? direction === 'asc' ? '↑' : '↓' : '↕';
    if (th.dataset.sort === sort) th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
  }
  $('print-heading').textContent = `Session: ${session().name} | ${new Date().toLocaleString()} | ${filtered.length} filtered records | ${$('search').value ? 'Search: ' + $('search').value + ' | ' : ''}Status: ${$('status-filter').selectedOptions[0].textContent} | Dates: ${from || 'any'} to ${to || 'any'} (local time). Statistics cover the entire session.`;
}
function recordRow(r) {
  const tr = el('tr'); tr.dataset.recordId = r.id;
  const timeCell = el('td', undefined, 'timestamp'), time = el('time', humanDate(r.createdAt));
  time.dateTime = r.createdAt; time.title = `Created: ${new Date(r.createdAt).toLocaleString()}\nUpdated: ${new Date(r.updatedAt).toLocaleString()}`;
  time.append(el('span', new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
  timeCell.append(time); tr.append(timeCell, el('td', r.location, 'location-cell'), el('td', r.upc, 'barcode-cell'), el('td', fmt(r.found), 'number-cell'), el('td', fmt(r.expected), 'number-cell'));
  const differenceCell = el('td'); differenceCell.append(statusBadge(r));
  tr.append(differenceCell, el('td', r.notes || '—', 'note-cell'));
  const actionsCell = el('td', undefined, 'no-print'), actions = el('div', undefined, 'row-actions');
  const edit = el('button', '✎', 'icon-button'); edit.type = 'button'; edit.title = 'Edit record'; edit.setAttribute('aria-label', `Edit ${r.upc} at ${r.location}`);
  edit.disabled = session().archived; edit.addEventListener('click', run(() => editRecord(r)));
  const remove = el('button', '×', 'icon-button delete-button'); remove.type = 'button'; remove.title = 'Delete record'; remove.setAttribute('aria-label', `Delete ${r.upc} at ${r.location}`);
  remove.disabled = session().archived;
  remove.addEventListener('click', run(async () => {
    if (!await confirmAction('Delete this audit record?', `${r.upc} at ${r.location} will be removed. This cannot be undone. Download a backup first if you need a copy.`, 'Delete record', true)) return;
    commit(next => { next.records = next.records.filter(x => x.id !== r.id); if (next.draft.editingId === r.id) next.draft = emptyDraft(); });
    notify('Audit record deleted.');
  }));
  actions.append(edit, remove); actionsCell.append(actions); tr.append(actionsCell); return tr;
}
async function discardDraft() {
  if (!hasDraft(state.draft)) return true;
  return confirmAction('Leave this draft?', 'Your current draft will be cleared. Save the audit first if you want to keep it.', 'Clear draft', true);
}
async function editRecord(r) {
  if (!await discardDraft()) return;
  commit(next => { next.draft = { location: r.location, editingId: r.id, entries: [{ upc: r.upc, found: String(r.found), expected: String(r.expected), notes: r.notes }] }; });
  $('location').focus(); $('entry-title').scrollIntoView({ block: 'center' });
}
$('audit-form').addEventListener('submit', event => {
  event.preventDefault(); $('form-error').hidden = true;
  try {
    if (session().archived) throw new Error('Reopen this session before saving.');
    const entries = state.draft.entries.map((entry, i) => {
      try { return validateEntry(entry, state.draft.location); }
      catch (error) { throw new Error(`Barcode entry ${i + 1}: ${error.message}`); }
    });
    const editing = state.draft.editingId, location = entries[0].location;
    if (!editing && state.records.length + entries.length > MAX_RECORDS) throw new Error(`The app supports up to ${fmt(MAX_RECORDS)} records. Back up and clear older sessions first.`);
    const now = new Date().toISOString();
    commit(next => {
      if (editing) {
        const index = next.records.findIndex(r => r.id === editing);
        if (index < 0) throw new Error('This record is no longer available.');
        next.records[index] = { ...next.records[index], ...entries[0], updatedAt: now };
      } else next.records.push(...entries.map(entry => ({ ...entry, id: newId(), sessionId: next.activeSessionId, createdAt: now, updatedAt: now })));
      next.draft = emptyDraft(); next.draft.location = location;
    });
    notify(editing ? 'Changes saved.' : `${entries.length} audit ${entries.length === 1 ? 'record' : 'records'} saved.`);
    $('entry-rows').querySelector('.upc').focus();
  } catch (error) { $('form-error').textContent = error.message; $('form-error').hidden = false; notify(error.message, true); }
});
$('audit-form').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || event.target.tagName !== 'INPUT') return;
  event.preventDefault();
  const inputs = [...$('audit-form').querySelectorAll('input')];
  const index = inputs.indexOf(event.target), next = inputs[index + 1];
  if (next) next.focus(); else $('audit-form').requestSubmit();
});
$('location').addEventListener('input', captureDraft);
$('add-upc').addEventListener('click', run(() => {
  if (state.draft.entries.length >= 40) throw new Error('Save this batch before adding more than 40 barcodes.');
  commit(next => next.draft.entries.push(emptyEntry()));
  $('entry-rows').lastElementChild.querySelector('.upc').focus();
}));
$('cancel-edit').addEventListener('click', run(async () => { if (await discardDraft()) commit(next => { next.draft = emptyDraft(); }); }));
$('session-select').addEventListener('change', run(async event => {
  const id = event.target.value;
  if (!await discardDraft()) { event.target.value = state.activeSessionId; return; }
  resetFilters(); commit(next => { next.activeSessionId = id; next.draft = emptyDraft(); });
}));

function openDialog(title, content) {
  if (pendingConfirmation) { pendingConfirmation(false); pendingConfirmation = null; }
  $('dialog-title').textContent = title; $('dialog-content').replaceChildren(content);
  if (!$('app-dialog').open) $('app-dialog').showModal();
  const target = $('dialog-content').querySelector('input,button,select');
  (target || $('close-dialog')).focus();
}
$('close-dialog').addEventListener('click', () => $('app-dialog').close());
$('app-dialog').addEventListener('close', () => { if (pendingConfirmation) { pendingConfirmation(false); pendingConfirmation = null; } });
function confirmAction(title, message, label = 'Continue', danger = false, typed = '') {
  const content = el('div'); content.append(el('p', message));
  let input;
  if (typed) { const field = el('label', `Type ${typed} to confirm`); input = el('input'); input.autocomplete = 'off'; field.append(input); content.append(field); }
  const actions = el('div', undefined, 'dialog-actions');
  const cancel = el('button', 'Cancel', 'button secondary'), accept = el('button', label, `button ${danger ? 'danger' : 'primary'}`);
  cancel.type = accept.type = 'button';
  if (typed) { accept.disabled = true; input.addEventListener('input', () => { accept.disabled = input.value !== typed; }); }
  actions.append(cancel, accept); content.append(actions); openDialog(title, content);
  if (!typed) cancel.focus();
  return new Promise(resolve => {
    pendingConfirmation = resolve;
    cancel.addEventListener('click', () => $('app-dialog').close());
    accept.addEventListener('click', () => { pendingConfirmation = null; $('app-dialog').close(); resolve(true); });
  });
}
function sessionNameDialog(existing) {
  const content = el('form'), label = el('label', 'Session name'), input = el('input');
  input.required = true; input.maxLength = 80; input.placeholder = 'e.g. Receiving · Thursday morning'; input.value = existing?.name || '';
  label.append(input); const submit = el('button', existing ? 'Save name' : 'Create session', 'button primary'); submit.type = 'submit';
  content.append(label, submit);
  content.addEventListener('submit', run(async event => {
    event.preventDefault();
    const name = textValue(input.value, 'Session name', 80);
    if (!existing && state.sessions.length >= MAX_SESSIONS) throw new Error(`The app supports up to ${MAX_SESSIONS} sessions.`);
    if (!existing && hasDraft(state.draft)) {
      if (!await discardDraft()) return;
    }
    commit(next => {
      if (existing) next.sessions.find(s => s.id === existing.id).name = name;
      else { const id = newId(); next.sessions.push({ id, name, createdAt: new Date().toISOString(), archived: false }); next.activeSessionId = id; next.draft = emptyDraft(); }
    });
    resetFilters(); renderRecords(); $('app-dialog').close(); notify(existing ? 'Session renamed.' : 'New audit session created.');
  }));
  openDialog(existing ? 'Rename audit session' : 'Start a new audit', content);
}
function showSessions() {
  const content = el('div'); content.append(el('p', 'Keep counts organized by shift, area, or audit. Archived sessions stay available for reports and backups.'));
  const create = el('button', '+ New session', 'button primary'); create.addEventListener('click', () => sessionNameDialog()); content.append(create);
  for (const s of state.sessions) {
    const item = el('div', undefined, 'session-list-item'), count = state.records.filter(r => r.sessionId === s.id).length;
    item.append(el('strong', s.name + (s.id === state.activeSessionId ? ' · current' : '')), el('p', `${s.archived ? 'Archived' : 'Open'} · ${count} records · ${humanDate(s.createdAt)}`));
    const use = el('button', s.id === state.activeSessionId ? 'Current session' : 'Open session', 'text-button'); use.disabled = s.id === state.activeSessionId;
    use.addEventListener('click', run(async () => { if (!await discardDraft()) return; resetFilters(); commit(next => { next.activeSessionId = s.id; next.draft = emptyDraft(); }); $('app-dialog').close(); }));
    const rename = el('button', 'Rename', 'text-button'); rename.addEventListener('click', () => sessionNameDialog(s));
    const archive = el('button', s.archived ? 'Reopen' : 'Archive', 'text-button');
    archive.addEventListener('click', run(async () => {
      if (s.id === state.activeSessionId && hasDraft(state.draft) && !await discardDraft()) return;
      commit(next => { next.sessions.find(x => x.id === s.id).archived = !s.archived; if (s.id === next.activeSessionId) next.draft = emptyDraft(); });
      showSessions(); notify(s.archived ? 'Session reopened.' : 'Session archived.');
    }));
    item.append(use, rename, archive); content.append(item);
  }
  openDialog('Audit sessions', content);
}
function showData() {
  const content = el('div');
  const storage = el('section', undefined, 'data-section');
  storage.append(el('h3', 'Your counts stay in this browser'), el('p', 'No account or cloud sync. Other devices and browser profiles have separate data. Clearing browser data can remove your audits. Download backups regularly. Avoid confidential inventory in a public demo.'));
  const back = el('button', 'Download JSON backup', 'button primary'); back.addEventListener('click', backup); storage.append(back);
  if (fatalStorage) {
    const raw = el('button', 'Download raw recovery data', 'button secondary');
    raw.addEventListener('click', () => download(lastStored || 'Storage was unavailable.', 'inventory-audit-recovery.txt', 'text/plain')); storage.append(raw);
  }
  const restore = el('section', undefined, 'data-section');
  restore.append(el('h3', 'Restore a V2 backup'), el('p', 'Restore replaces all V2 sessions, records, and the current draft. It never changes the original ICQA Tool data. Only use backups you trust. Maximum file size: 8 MB.'));
  const label = el('label', 'Choose an Inventory Audit V2 JSON file'), file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; label.append(file); restore.append(label);
  file.addEventListener('change', run(async () => {
    const selected = file.files[0]; if (!selected) return;
    if (selected.size > 8 * 1024 * 1024) throw new Error('This backup is too large. Maximum size is 8 MB.');
    let restored;
    try { restored = validateState(JSON.parse(await selected.text())); }
    catch (error) { file.value = ''; throw new Error(`Backup not restored: ${error.message}`); }
    const ok = await confirmAction('Replace V2 data with this backup?', `Restore ${restored.sessions.length} sessions and ${restored.records.length} records. A copy of your current V2 data will download first. Existing data will then be replaced.`, 'Restore backup', true, 'RESTORE');
    if (!ok) return;
    if (fatalStorage) download(lastStored || '', 'inventory-audit-before-restore.txt', 'text/plain'); else backup();
    persist(restored, { recovery: fatalStorage }); resetFilters(); render(); notify('Backup restored and saved in this browser.');
  }));
  const demo = el('section', undefined, 'data-section');
  demo.append(el('h3', 'Take a test drive'), el('p', 'Create a separate session with six entirely fictional inventory records. Your other sessions stay available.'));
  const load = el('button', 'Load fictional demo', 'button secondary'); load.addEventListener('click', run(loadDemo)); demo.append(load);
  const danger = el('section', undefined, 'danger-zone');
  danger.append(el('h3', 'Clear this session’s history'), el('p', `Remove all saved records in “${session().name}”. Other sessions and the original ICQA Tool are unaffected. This cannot be undone. Download a backup first.`));
  const clear = el('button', 'Clear current session', 'button danger'); clear.disabled = session().archived;
  clear.addEventListener('click', run(async () => {
    if (!await confirmAction('Clear current session?', `Delete all ${sessionRecords().length} records and the draft in “${session().name}”? Keep a backup if you may need them.`, 'Clear history', true, 'CLEAR')) return;
    commit(next => { next.records = next.records.filter(r => r.sessionId !== next.activeSessionId); next.draft = emptyDraft(); }); notify('Current session history cleared.');
  }));
  danger.append(clear); content.append(storage, restore, demo, danger); openDialog('Data & backups', content);
}
async function loadDemo() {
  if (state.sessions.length >= MAX_SESSIONS || state.records.length + 6 > MAX_RECORDS) throw new Error('Back up and clear old records before loading the demo.');
  if (!await discardDraft()) return;
  const demo = demoSession(); resetFilters();
  commit(next => { next.sessions.push(demo.session); next.records.push(...demo.records); next.activeSessionId = demo.session.id; next.draft = emptyDraft(); });
  $('app-dialog').close(); notify('Fictional demo loaded in its own session.');
}
function showGuide() {
  const content = el('div'); content.append(el('p', 'A focused workflow for inventory control. Every record belongs to a session.'));
  const list = el('ol', undefined, 'guide-list');
  for (const text of ['Start or choose a session. Enter the inventory location.', 'Scan a UPC / barcode, then enter physical and system quantities. Zero is valid; blanks, negative numbers, and decimals are not.', 'Enter moves between fields. A keyboard-style scanner with an Enter suffix moves from barcode to physical quantity. Tab also works normally.', 'Add more UPC rows for the same location, then Save audit. The location stays ready for the next count; duplicate barcodes are allowed for recounts.', 'Use search, status, and local calendar dates to narrow records. Click a column heading to sort. Excel, CSV and print include all filtered results, across every page.', 'Edit or delete a count using its row actions. Archive finished sessions to protect them from edits; reopen when needed.', 'Download JSON backups for a full copy of all sessions and drafts. Restore replaces V2 data after confirmation. This app does not migrate the original tool’s HTML storage.']) list.append(el('li', text));
  content.append(list, el('h3', 'Excel & Google Sheets'), el('p', 'Choose Export report, then Export Excel (.xlsx). The workbook includes your filtered audit records and a summary. To use Google Sheets, open a spreadsheet and choose File → Import → Upload, then select the downloaded Excel file. Opening a downloaded file on your computer uses the app assigned to that file type.'), el('h3', 'How the numbers work'), el('p', 'Difference = physical − system. Zero is a match; a negative difference is a shortage; a positive difference is an overage. Match rate is matching records ÷ total records. Shortage and overage units are summed separately, without canceling each other out. Dashboard metrics always cover the whole current session, including recounts. They do not represent total inventory on hand.'), el('h3', 'Independent by design'), el('p', 'Inventory Audit by Norvak is independent software, without affiliation with any employer, retailer, or warehouse operator. Use fictional records for demonstrations. Browser-local storage is not encrypted and is not an enterprise inventory system.'));
  openDialog('Count with confidence', content);
}
for (const id of ['guide-nav', 'help-button']) $(id).addEventListener('click', showGuide);
for (const id of ['data-nav', 'footer-data']) $(id).addEventListener('click', showData);
$('sessions-nav').addEventListener('click', showSessions);
$('new-session').addEventListener('click', () => sessionNameDialog());
$('load-demo').addEventListener('click', run(loadDemo));
for (const id of ['search', 'status-filter', 'date-from', 'date-to']) $(id).addEventListener('input', () => { page = 1; renderRecords(); });
$('reset-filters').addEventListener('click', () => { resetFilters(); renderRecords(); });
for (const th of document.querySelectorAll('th[data-sort]')) th.querySelector('button').addEventListener('click', () => {
  direction = sort === th.dataset.sort && direction === 'asc' ? 'desc' : 'asc'; sort = th.dataset.sort; page = 1; renderRecords();
});
$('prev-page').addEventListener('click', () => { page--; renderRecords(); });
$('next-page').addEventListener('click', () => { page++; renderRecords(); });
function showExport() {
  const records = filteredRecords();
  if (!records.length) return notify('There are no matching records to export.', true);
  const snapshot = structuredClone(state.sessions), name = session().name;
  const content = el('div');
  content.append(el('p', `${records.length} filtered records from “${name}”. All matching pages are included.`));
  const excel = el('button', 'Export Excel (.xlsx)', 'button primary');
  const csv = el('button', 'Download CSV', 'button secondary');
  excel.type = csv.type = 'button';
  excel.addEventListener('click', run(async () => {
    excel.disabled = true; excel.textContent = 'Preparing Excel…';
    try {
      const XLSX = await loadExcelEngine();
      const workbook = buildAuditWorkbook(XLSX, records, snapshot, name);
      const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
      download(bytes, `inventory-audit-${localDate(new Date())}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      notify('Excel file downloaded. Open it in Excel or import it into Google Sheets.');
    } finally { excel.disabled = false; excel.textContent = 'Export Excel (.xlsx)'; }
  }));
  csv.addEventListener('click', () => {
    download(toCSV(records, snapshot), `inventory-audit-${localDate(new Date())}.csv`, 'text/csv;charset=utf-8');
    notify(`${records.length} filtered records exported as CSV.`);
  });
  content.append(excel, csv, el('h3', 'Use in Google Sheets'), el('p', 'Open a spreadsheet in Google Sheets, then choose File → Import → Upload and select the downloaded .xlsx file. Excel export includes an Audit records sheet and a Summary sheet.'), el('p', 'If a downloaded file opens in VS Code, use Open with → Excel on your computer, or import the file into Google Sheets. Your browser does not upload this report automatically.'));
  openDialog('Export audit records', content);
}
$('export-button').addEventListener('click', showExport);
function preparePrint() {
  $('records-body').replaceChildren(...filteredRecords().map(recordRow));
  $('results-label').textContent = `${filteredRecords().length} filtered records · all pages`;
}
window.addEventListener('beforeprint', preparePrint);
window.addEventListener('afterprint', renderRecords);
$('print-button').addEventListener('click', () => { renderRecords(); window.print(); });
window.addEventListener('storage', event => {
  if ((event.key === STORAGE_KEY || event.key === null) && event.newValue !== lastStored) {
    blocked = true;
    storageAlert('Audit data changed in another tab. Saving is paused to prevent overwriting it. Reload to use the latest copy; any unsaved draft will be downloaded first.');
  }
});
window.addEventListener('beforeunload', event => { if (!saved) { event.preventDefault(); event.returnValue = ''; } });
render();
