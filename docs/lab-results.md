# Lab Results

The authenticated `/labs` page displays source-reported laboratory results. Open **Lab Results** in the desktop sidebar or **Options → Lab Results** in a mobile page header. The mobile bottom bar retains its five existing destinations.

## Private source

The backend reads `lab-tests/clinical-labs.json` from the repository configured by `TRAINING_DATA_GITHUB_REPO`, `TRAINING_DATA_GITHUB_TOKEN`, and `TRAINING_DATA_GITHUB_BRANCH` (default `main`). This is the existing private training-data connection. An OpenAI key is not needed for the lab page.

Never commit actual patient results, uploaded reports, or identifying patient information to this public application repository. Tests must use synthetic fixtures.

`GET /api/labs` runs after the normal app authentication gate and independently checks `req.appSession`. It verifies that the source repository is private, resolves the configured branch, then reads the fixed file at that commit. Client requests cannot select another repository or file. Only validated display fields are returned; upstream errors and credentials are not exposed. Responses use `Cache-Control: no-store`. No laboratory records are put in browser local storage, bundled frontend assets, or service-worker caches. The endpoint is read-only.

## Source contract

The JSON root has `schema_version: 1` and a `reports` array. Each report requires:

- `id`, `title`, `laboratory`, `collected_date`, `reported_date`, `source_filename`, and `fasting` (`true`, `false`, or `null`). Dates use `YYYY-MM-DD`.
- `results`: each row has a unique `id`, `name`, `section`, numeric or categorical `value`, `unit`, printed `reference`, `flag` (`H`, `L`, or `null`), and one-based `source_page`.
- Optional nullable `risk_ranges`, `population_reference`, and `notes` preserve source context separately.

Preserve collection date separately from report date, exact units, reference inequalities, categorical values, and report order. A lab's H/L flag is not its clinical risk category. Do not recompute flags from population intervals or silently turn laboratory references into individualized treatment targets. Do not add calculated results as though they were measured in the source report.

## Display and behavior

Desktop uses a semantic table with Test, Result, Lab reference, and Report flag columns. Mobile uses compact result cards with the same information. Search and the Flagged filter do not modify the record. Each applicable row exposes the report's additional ranges and notes in a keyboard-operable disclosure. Multiple reports are selectable by collection date; newer collections appear first.

Loading, missing-record, connection-error, and retry states are explicit. A failed branch lookup is not presented as an empty laboratory history. API and page code do not produce diagnoses, training prescriptions, or AI-generated interpretations.

## Validation

`node --test app-backend/lib/lab-results.test.mjs` covers schema preservation, identifiers, invalid records, private-source checks, commit-pinned reads, missing-file versus access errors, authentication, method restrictions, sanitized failures, and desktop/mobile route registration. The normal application build performs the full UI typecheck.
