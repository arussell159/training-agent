# Policy baseline

**Project:** Open Triathlon Coach for ChatGPT
**Policy version:** 1.0.0
**Reviewed:** 21 July 2026
**Action schema version:** 2.2.0

This file records the public product, privacy, authentication, safety, and
knowledge-licensing assumptions used by the release pack. It is a documentation
baseline, not a substitute for OpenAI, Intervals.icu, GitHub, or applicable-law
terms.

## Source-of-truth order

1. `action/intervals-oauth-action.json` defines the API operations technically exposed.
2. `API instructions.md` defines permitted and required coach behaviour.
3. `docs/privacy.html` discloses data handling and user controls.
4. `README.md` summarises the project and end-user setup.
5. `knowledge/README.md` governs knowledge-source redistribution.

A lower item must not claim an operation, scope, privacy guarantee, or licence
permission that conflicts with a higher item. Any discovered inconsistency must
be fixed across all affected documents.

## OpenAI product baseline

Reviewed against current official OpenAI documentation on 21 July 2026:

- GPTs in ChatGPT: https://help.openai.com/en/articles/8554407-gpts-in-chatgpt
- Configuring Actions: https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts
- Sharing and publishing GPTs: https://help.openai.com/en/articles/8798878-sharing-and-publishing-gpts
- Data Controls FAQ: https://help.openai.com/en/articles/7730893-data-controls-faq
- Temporary Chat FAQ: https://help.openai.com/en/articles/8914046-temporary-chat-faq
- GPT-5.6 in ChatGPT: https://help.openai.com/en/articles/20001354-gpt-56-in-chatgpt

The release follows these current requirements and limitations:

- A public GPT with an Action needs a valid privacy-policy URL.
- OAuth is used for account-based per-user access.
- The Action editor provides the callback URL.
- Custom Actions are unavailable in Pro mode at this baseline; documentation
  therefore recommends the highest non-Pro reasoning level that keeps the Action
  available.
- The builder has disabled the GPT-level setting labelled “Use conversation data
  in your GPT to improve our models”.
- That builder setting is not described as overriding plan-specific or
  account-level OpenAI Data Controls. Consumer users retain their own model-
  improvement choice; Business, Enterprise, and Edu data is excluded from
  training by default under OpenAI's current guidance.
- GPT builders cannot view individual user conversations through the GPT builder.
- Relevant parts of a request may be sent to the third-party Action service.

## ChatGPT plan and Action compatibility

The GPT itself and its custom Action are treated as separate capabilities.

Current project validation as of 23 July 2026:

- Plus has passed OAuth, authenticated read and controlled calendar-write tests.
- A signed-in Free account could open the GPT, but the Intervals.icu Action was
  unavailable in that test, so OAuth could not start.
- Go has not yet been tested.
- Pro mode cannot use custom Actions under OpenAI's current documentation.
- Business, Enterprise and Edu workspaces may restrict Action domains.

These observations must be described as project test results, not universal
claims about all accounts. Documentation must direct users to
`COMPATIBILITY.md` and must not promise Action availability on an untested plan
or workspace.

When the Action is unavailable, the coach must fail safely and must never ask
for an athlete ID, API key, password or token as an alternative to OAuth.

## Intervals.icu API baseline

Reviewed against:

- Open API overview: https://www.intervals.icu/features/open-api/
- OAuth support and scopes: https://forum.intervals.icu/t/intervals-icu-oauth-support/2759
- Planned workout API guide: https://forum.intervals.icu/t/uploading-planned-workouts-to-intervals-icu/63624

Production scope string:

`ACTIVITY:READ,WELLNESS:WRITE,CALENDAR:WRITE,LIBRARY:READ,SETTINGS:READ`

Intervals.icu WRITE permission includes READ permission for the same category.
The production Action:

- fixes athlete-scoped paths to `/athlete/0`;
- never requests an athlete ID, API key, token, password, or client secret from a user;
- exposes selected reads, `createEvent`, and `updateWellness`;
- marks writes consequential;
- exposes no delete operation;
- does not request ACTIVITY:WRITE, CHATS, athlete-management, or unrelated scopes.

## Data and safety baseline

- The coach depends heavily on source data from Garmin or other watches and bike
  computers, Zwift, smart trainers, power meters, heart-rate sensors, manual
  uploads, and wellness sources.
- Missing, duplicated, miscalibrated, or poorly synced data must be identified as
  a limitation rather than silently filled in.
- Threshold pace returned as speed in metres per second must be converted
  mathematically; decimal speed must never be formatted as decimal pace.
- CTL, ATL, form, HRV, sleep, and similar metrics are contextual coaching inputs,
  not diagnoses.
- Important figures and every material write must be checked by the user.
- The project is not a medical device and does not replace medical care or
  qualified professional coaching.

## Knowledge and copyright baseline

Academic papers are not presumed free of copyright. Full text may be committed
only where a verified licence or permission permits redistribution. Otherwise
the repository may contain bibliographic metadata, links, and original summaries
only. See `knowledge/README.md`.

## Updating this baseline

When an external policy, product limitation, OAuth permission, API operation, or
data practice changes:

1. update this file and increment the policy version;
2. update every affected document and the schema version when applicable;
3. rerun the consistency audit;
4. review the privacy effective date when the change is material;
5. do not publish a new release while validation fails.
