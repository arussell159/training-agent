# Validation report

**Result:** PASS
**Policy baseline:** 1.0.0
**Schema version:** 2.2.0
**Run date:** 21 July 2026

## Corrections made before packaging

- Updated the old name in the landing page, privacy policy, schema, and API guide.
- Replaced the obsolete Pro recommendation with the highest Action-compatible reasoning recommendation.
- Clarified that the disabled GPT-level model-improvement setting does not override each user's plan and account-level Data Controls.
- Aligned all OAuth disclosures to `ACTIVITY:READ,WELLNESS:WRITE,CALENDAR:WRITE,LIBRARY:READ,SETTINGS:READ`.
- Excluded Basic-auth DEV files, personal athlete-ID placeholders, and rigid universal CTL/TSB classifications.
- Added consistent device-data, medical-boundary, write-confirmation, privacy, and academic-source licensing policies.

## Automated checks

- [x] All required release files exist
- [x] OpenAPI version is 3.1.0
- [x] Schema uses current brand
- [x] Schema version is current
- [x] OAuth is the only security scheme
- [x] OAuth scope string matches every document — ACTIVITY:READ,WELLNESS:WRITE,CALENDAR:WRITE,LIBRARY:READ,SETTINGS:READ
- [x] Athlete-scoped paths are fixed to /athlete/0
- [x] No arbitrary athlete path exists
- [x] No DELETE operation is exposed
- [x] Operation IDs are unique
- [x] All writes are consequential
- [x] Reads are not marked consequential
- [x] Action descriptions are <=300 characters — maximum=165
- [x] Old public name is absent
- [x] Personal athlete ID is absent
- [x] Personal name is absent
- [x] DEV authentication override is absent
- [x] Old athlete-ID placeholder is absent
- [x] Rigid universal CTL bands are absent
- [x] Pro mode is not positively recommended
- [x] Action-compatible reasoning is recommended
- [x] Disabled GPT-level model-improvement setting is disclosed
- [x] Account-level Data Controls are disclosed
- [x] No absolute no-training promise appears
- [x] No separate project database is disclosed
- [x] Garmin dependency is documented
- [x] Zwift dependency is documented
- [x] Power-meter dependency is documented
- [x] No-delete limitation is documented
- [x] Academic-paper copyright rule is documented
- [x] Policy version is present in every core document
- [x] Privacy URL is consistent
- [x] Contact address is consistent
- [x] Knowledge manifest is empty except for its header
- [x] Logo is included

## Manual checks still required

- Enter the OAuth client ID and secret only in the GPT Action editor.
- Confirm the editor-generated callback URL matches the callback registered with Intervals.icu.
- Publish GitHub Pages and verify the privacy URL before public GPT publication.
- Run `tests/acceptance-tests.md` against a test Intervals.icu account.
- Licence-check every academic source before adding full text.

## External policy sources reviewed

- OpenAI: GPTs in ChatGPT
- OpenAI: Configuring Actions in GPTs
- OpenAI: Sharing and publishing GPTs
- OpenAI: Data Controls FAQ
- OpenAI: Temporary Chat FAQ
- OpenAI: GPT-5.6 in ChatGPT
- Intervals.icu: Open API overview
- Intervals.icu: OAuth scopes documentation
