# Review candidate validation · 2026-11-26

Release candidate: v2.0.0. GitHub Pages is intentionally not enabled until owner approval.

## Verified

- All 13 Node built-in regression tests passed: independent storage namespace, input boundaries, zeros, required fields, structured untrusted text, discrepancy signs/statuses, analytics, composed filters, numeric sorting, full backup round-trip, rejection of malformed backups, incomplete drafts and safe CSV output.
- Chrome UI: create a session; save multiple barcodes at one location; reject an incomplete batch without partially saving; preserve an incomplete draft across reload; retain barcode leading zeros; save physical zero; edit a record and update analytics; search notes; filter by status and date; sort quantities; cancel and confirm a record deletion.
- Chrome UI: archive/reopen and rename sessions; require the exact `CLEAR` confirmation before clearing the fictional QA session; load the opt-in fictional demo in a separate session; reload and retain its six records.
- Chrome UI: a change from another tab pauses saving and displays a conflict notice. The preview was reloaded afterward.
- Downloaded actual CSV and JSON files to the device. Inspected the exported CSV: quoted embedded quotes and commas, preserved barcode text with an apostrophe, protected a formula-leading note, retained numeric negative discrepancy and ISO timestamps. Parsed the actual exported JSON through the restore validator: two sessions and two records, with correct 50% match rate, three shortage units and zero overage units.
- Desktop layout visually inspected. Phone and tablet layouts inspected using a temporary local iframe harness at 320, 390 and 768 CSS pixels (305, 375 and 753 usable pixels with browser scrollbars). Fixed an accessibility text positioning issue that caused horizontal page overflow. Verified document width equals viewport width at all three sizes; the records table scrolls inside its own container.
- Scanner-style Enter key from a barcode field advances to physical quantity. Keyboard focus indicator visually checked. No real hardware barcode scanner was used.
- Browser error/warning log check returned no entries during the core workflow tests.
- Existing Norvak logo, approved cover and local Manrope font reused. Original ICQA repository and legacy browser key were not modified. Portfolio remains unchanged pending approved publication.

## Manual checks still needed

- Full browser file-picker restore: the browser automation connection required an extension file-access permission to set a local file. This permission was not expanded. The actual exported backup and restore validator were checked, but selecting a file and confirming restore through the browser remains a manual check.
- Final print preview and printer output: triggering the report caused the browser automation click to time out. The owned test tab was closed and a fresh review tab opened. No print job was submitted; visual inspection of the printed output remains a manual check.
- A physical mobile device and a physical keyboard-emulating scanner were not available for certification. Responsive layouts were checked in browser-rendered frames.

Temporary test harnesses are ignored by Git and are not part of the published application. Fictional QA data only exists in local preview browser storage and is not committed or transferred to GitHub Pages.
