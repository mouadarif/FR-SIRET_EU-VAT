# UI Expert Functionality Brief

This document describes the current app behavior so a UI/UX expert can review the product, information architecture, workflows, accessibility, and visual design without needing to reverse-engineer the code.

## Product Summary

The app is an internal business lookup and enrichment tool for supplier/company identity checks.

It currently supports two main services:

- **INSEE SIRET**: French company lookup and enrichment using INSEE/Sirene data.
- **TVA / VAT Verification**: VAT validation through VIES, including legal name, VAT number, validity status, and registered address.

The app is not a public French or EU institutional service. It should use French/EU accessibility and clarity principles, but should not visually imitate official DSFR or EU branding.

## Primary User Goals

1. Search a French company by name and optional location filters.
2. Search a French company directly by SIRET or SIREN.
3. Validate a single VAT number and see legal name/address/status.
4. Upload a CSV/TSV/Excel file and enrich it in bulk by SIRET.
5. Upload a CSV/TSV/Excel file and validate/enrich it in bulk by VAT.
6. Inspect, filter, sort, export, and copy company/VAT data.

## High-Level Navigation

The top of the app has a neutral service switcher:

- `INSEE SIRET`
  - Subtext: French company search.
  - Default service.
  - Shows INSEE search tabs.

- `TVA / VAT Verification`
  - Subtext: legal name, VAT, and address.
  - Switches the app into VAT/VIES mode.
  - Shows VAT-specific tabs.

When the active service changes, the app resets the active tab:

- INSEE mode starts on name search.
- VAT mode starts on identifier validation.

## INSEE Mode

### Tab: Search By Name

Purpose: find French establishments/companies using a company name and optional location/business filters.

Inputs:

- Company name, required.
- Address, optional.
- Postal code, optional.
- City, optional.
- SIRET, optional.

Validation:

- Company name must pass the name validator.
- Current validation expects at least 3 characters.
- Search button is disabled until the name input is valid.
- Pressing Enter in the company name input triggers search when valid.

Clear actions:

- Each text input has a small clear button when populated.

Backend/data behavior:

- Calls the INSEE search-by-name path through the frontend API client.
- Sends current page and page size.
- Sends advanced filters.

UI result:

- On success, results appear in the results table.
- On no results, an empty state appears with suggestions.
- On error, a global error message appears.

### Advanced Filters

Purpose: refine INSEE name searches before submitting.

The advanced filter panel is collapsible.

Filters:

- NAF activity code.
- Legal form:
  - SAS
  - SARL
  - SA
  - EURL
  - SASU
- Employee range.
- Administrative status:
  - All
  - Active only
  - Closed only

UI behavior:

- The filter button shows how many advanced filters are active.
- The panel uses standard inputs, select controls, and radio buttons.
- Active filters are shown as removable chips below the search form.
- A `Tout effacer` action clears all active filters.

### Tab: Search By Identifier

Purpose: search French company records by exact SIRET or SIREN.

Inputs:

- SIRET:
  - Numeric only.
  - Max length: 14 digits.
  - Valid only when exactly 14 digits.

- SIREN:
  - Numeric only.
  - Max length: 9 digits.
  - Valid only when exactly 9 digits.

Validation:

- Each field displays a validity message.
- Search buttons are disabled until their corresponding identifier is valid.
- Pressing Enter triggers the matching search when valid.

Backend/data behavior:

- SIRET calls the INSEE search-by-SIRET API client method.
- SIREN calls the INSEE search-by-SIREN API client method.

UI result:

- Results use the same results table and company detail modal as name search.

### Tab: INSEE Batch Enrichment

Purpose: upload a file and enrich each row using a selected SIRET column.

Supported input files:

- CSV
- TSV
- XLSX
- XLSM

User flow:

1. Open `Enrichissement en masse`.
2. Choose `SIRET INSEE` from the side treatment selector.
3. Drag/drop or browse for a file.
4. The browser previews the file and extracts column names.
5. The app auto-detects likely SIRET columns when possible.
6. User selects the SIRET column.
7. User clicks `Lancer SIRET INSEE`.
8. File is sent to backend.
9. Backend runs Python enrichment.
10. User downloads `enriched_by_siret.xlsx`.

Important security behavior:

- The browser does not call INSEE directly for batch enrichment.
- INSEE tokens/API keys remain in the backend Python environment.

Backend endpoint:

- `POST /api/enrich-by-siret`

Request fields:

- `file`
- `siret_column`

Output:

- Excel workbook download.
- Original rows plus INSEE enrichment columns.
- Response headers include output filename and input row count.

Progress model:

- Current UI shows upload/backend processing state.
- It does not stream per-row progress from backend.
- Final progress jumps to complete when the backend returns.

## VAT Mode

### Tab: Single VAT Validation

Purpose: validate one VAT number and show legal identity details.

Input:

- VAT number.
- Expected pattern: 2-letter country code followed by 2 to 14 allowed alphanumeric/special characters.
- Example: `FR30334691813`.

Input normalization:

- Uppercases input.
- Removes spaces.
- Removes unsupported characters.
- Max length: 16.

Validation:

- Valid format message appears when pattern matches.
- Error message prompts user to start with country code.
- Button disabled until format is valid.
- Pressing Enter triggers validation when valid.

Backend/data behavior:

- Current single VAT validation uses the frontend VIES API client path.
- VIES payload is normalized into a search-result-like format.

Displayed result:

- VAT/VIES label.
- Valid/invalid pill.
- Legal name.
- VAT number.
- Registered address.
- Request date.
- Request identifier when returned.
- Original VAT number.

States:

- Loading state.
- Error state.
- Empty state.
- Valid result card.
- Invalid result card.

### Tab: VAT Batch Enrichment

Purpose: upload a supplier/company file and enrich each row by VAT through backend VIES validation.

Supported input files:

- CSV
- TSV
- XLSX
- XLSM

User flow:

1. Click `TVA / VAT Verification`.
2. Open `Validation en masse`.
3. In the side treatment selector, choose `TVA / VAT Verification`.
4. Drag/drop or browse for a file.
5. Browser previews file and extracts column names.
6. App auto-detects likely VAT and country columns when possible.
7. User selects the VAT column.
8. User optionally selects a country-code column.
9. User clicks `Lancer TVA / VAT Verification`.
10. File is sent to backend.
11. Backend validates each VAT row against VIES.
12. User downloads `enriched_by_vat.xlsx`.

VAT column behavior:

- If VAT value includes country prefix, for example `FR12345678901`, country column can be empty.
- If VAT value does not include country prefix, user should select a country-code column.

Backend endpoint:

- `POST /api/enrich-by-vat`

Request fields:

- `file`
- `vat_column`
- `country_column`, optional.

Output:

- Excel workbook download.
- Original input columns are preserved.
- Appended columns include:
  - `VIES_Source_VAT`
  - `VIES_Source_Country_Code`
  - `VIES_Normalized_VAT`
  - `VIES_Status`
  - `VIES_Is_Valid`
  - `VIES_User_Error`
  - `VIES_Name`
  - `VIES_Legal_Name`
  - `VIES_Address`
  - `VIES_Registered_Address`
  - `VIES_Request_Date`
  - `VIES_Request_Identifier`
  - `VIES_Country_Code`
  - `VIES_VAT_Number`
  - `VIES_Original_VAT_Number`
  - `VIES_Error_Message`
  - `VIES_Raw_*` fields from flattened raw response payload.

Row-level error statuses:

- `MISSING_VAT`: mapped VAT field is empty.
- `INVALID_INPUT`: country code or VAT body is missing/invalid.
- `ERROR`: VIES/network/JSON issue for that row.
- `VALID`: VAT is valid.
- `INVALID`: VAT is invalid or VIES returned invalid.

Progress model:

- Same as SIRET batch: upload/backend processing state, then final workbook.
- Does not currently show streamed per-row VIES progress.

## Shared Batch Upload Behavior

The batch UI is shared between SIRET and VAT workflows.

Common controls:

- Side treatment selector:
  - `SIRET INSEE`
  - `TVA / VAT Verification`
- Drag-and-drop upload zone.
- File picker.
- File name display.
- Row count display.
- Column mapping table.
- Example value preview from first row.
- Backend processing indicator.
- Download result button.
- Reset/new-file button.

Browser preview:

- CSV/TSV parsed in browser.
- XLSX/XLSM parsed in browser using ExcelJS.
- Adds internal `_row_id` field for preview/state handling.
- Supports header detection for Excel worksheets.

Local persistence:

- Batch state can be saved to local browser storage.
- If restored file is only a mock reference, user must select the source file again before processing.

## Results Table

Purpose: display INSEE search results in a dense, inspectable table.

Features:

- Loading state.
- Error state.
- Empty state with search suggestions.
- Sortable columns.
- Keyboard-openable rows:
  - Rows have `tabIndex=0`.
  - Enter or Space opens details.
- Click row to open company detail modal.
- Status badge for administrative state:
  - Active
  - Closed
- SIRET-specific styling.
- Column picker:
  - Show/hide available columns.
  - At least one column must remain visible.
  - Reset to default columns.
- `aria-sort` on sortable table headers.

Current result filtering:

- A result filter bar appears after results.
- Filters visible result rows by:
  - Company name.
  - Address.
  - SIRET.
  - City.
  - Postal code.
  - Administrative status.
- Shows count when active filters reduce the result set.
- Clear result filters action.

Pagination:

- Shows current range and total.
- Page size choices:
  - 10
  - 25
  - 50
  - 100
- Previous/next buttons.
- Client-side pagination is used for SIREN result sets.
- Name search keeps server-aware pagination.

Export:

- Exports visible/selected columns.
- CSV export.
- Excel-compatible HTML `.xls` export.

## Company Detail Modal

Purpose: inspect one company record in detail.

Open behavior:

- Click a table row.
- Press Enter or Space while row is focused.

Close behavior:

- Close button.
- Overlay click.
- Escape key.

Accessibility behavior:

- Uses `role="dialog"`.
- Uses `aria-modal="true"`.
- Focus moves to close button on open.

Content:

- Company display name.
- Active/closed status badge.
- Quick-copy section:
  - SIRET.
  - SIREN.
- Full field list:
  - Flattens nested objects.
  - Excludes `_raw`.
  - Shows key/value rows.
  - Each value can be copied.

Known UX consideration:

- It does not trap focus inside the modal.
- Large raw payloads can make the modal long and dense.

## API / Data Layer Features

### INSEE API Client

Responsibilities:

- Search by SIRET.
- Search by SIREN.
- Search by company name.
- Normalize INSEE responses into UI records.
- Use request queueing/deduplication/caching where implemented.
- Build INSEE query parameters through query builder utilities.

### VIES API Client

Responsibilities:

- Validate a single VAT number.
- Fetch VIES configuration/countries where needed.
- Normalize VIES responses into UI-friendly VAT records.
- Extract legal name and registered address from multiple possible VIES response shapes.
- Retry transient failures.
- Use browser dev proxy for VIES CORS in local development.

### Backend FastAPI Service

Endpoints:

- `GET /api/health`
- `POST /api/enrich-by-siret`
- `POST /api/enrich-by-vat`

Responsibilities:

- Accept uploaded files.
- Validate file type.
- Read CSV/TSV/XLSX/XLSM.
- Validate selected column names.
- Run Python SIRET enrichment via `enrich_by_siret.py`.
- Run backend VIES validation for uploaded VAT files.
- Return enriched Excel workbook.
- Clean temporary files after response.

Security boundary:

- Batch enrichment external calls happen server-side.
- INSEE secrets remain in backend environment.
- Uploaded files are temporary and cleaned after response.

## Supported File Types

Supported:

- `.csv`
- `.tsv`
- `.xlsx`
- `.xlsm`

Not supported:

- `.xls`
- `.xlsb`

User-facing unsupported-format behavior:

- Browser preview rejects unsupported Excel formats.
- Backend also rejects unsupported extensions.

## Main UI States To Review

A UI expert should review each of these states:

1. Initial app load in INSEE mode.
2. Switching from INSEE to TVA / VAT Verification.
3. Name search empty form.
4. Name search validation error.
5. Advanced filters collapsed.
6. Advanced filters expanded.
7. Active filters chips.
8. Search loading state.
9. No results state.
10. Results table with many columns.
11. Column picker open.
12. Result filter bar with active filters.
13. Pagination with many pages.
14. Company detail modal.
15. Single VAT input empty.
16. Single VAT invalid format.
17. Single VAT valid result.
18. Single VAT invalid result.
19. Batch upload empty state.
20. Batch file loaded with detected SIRET column.
21. Batch file loaded with detected VAT column.
22. Batch missing required column selection.
23. Batch processing state.
24. Batch backend error state.
25. Batch completed/download state.
26. Mobile layout for header, tabs, forms, tables, and batch side selector.

## Accessibility / Compliance Review Targets

Baseline expected review:

- WCAG / EN 301 549 / RGAA-inspired checks.
- Keyboard access to all controls.
- Visible focus on all buttons, inputs, selects, table rows, modal controls.
- Form labels are always visible and connected to controls.
- Error messages are close to the failing action and understandable.
- Table sorting state is announced.
- Modal focus behavior is safe.
- Color contrast for badges, active states, disabled controls, and errors.
- Responsive behavior for table-heavy screens.
- No reliance on color alone for validity/status.

Known areas that likely need expert attention:

- Some UI text has encoding/mojibake issues in source/output.
- Batch progress is not truly granular; it is backend-level, not per-row.
- The results table can become dense on small screens.
- Company detail modal can become overwhelming with all flattened fields.
- Single VAT validation still uses frontend VIES client while batch VAT uses backend.
- The app has mixed French/English labels, especially around VAT.
- Some buttons use text labels that may be too technical for non-developers.
- Current app does not include legal/privacy/accessibility pages.

## Information Architecture Questions For The UI Expert

1. Should INSEE and VAT be top-level services, or should the app be organized by task: search, verify, enrich?
2. Should single lookup and batch enrichment share more visual structure?
3. Should VAT be called `TVA`, `Validation TVA`, `VAT Verification`, or a bilingual label everywhere?
4. Should SIRET/VAT batch workflows be separate pages instead of a side selector?
5. Should advanced INSEE filters be shown earlier, collapsed differently, or grouped by user intent?
6. How should dense INSEE results be made usable for non-technical users?
7. Should raw technical fields be hidden behind an "advanced details" disclosure in the modal?
8. Should batch enrichment show a pre-flight summary before upload?
9. Should batch enrichment offer a sample output preview before download?
10. What should the mobile experience prioritize: search first, upload first, or results inspection?

## Suggested Deliverables From The UI Expert

Ask the UI expert for:

- Navigation/information architecture critique.
- Labeling and terminology recommendations.
- Screen-by-screen usability issues.
- Accessibility/RGAA/WCAG findings.
- Mobile/table responsiveness recommendations.
- Batch workflow redesign proposal.
- Modal/details redesign proposal.
- Error-state and empty-state copy improvements.
- Visual hierarchy and spacing system recommendations.
- Prioritized change list: quick wins, medium changes, deeper redesign.
