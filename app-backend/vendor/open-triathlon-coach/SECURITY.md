# Security policy

## Reporting

Report suspected credential exposure, unsafe Action behaviour, or other security
issues privately to [triathlon-gpt-intervals-icu@proton.me](mailto:triathlon-gpt-intervals-icu@proton.me).

Do not include live API keys, OAuth tokens, passwords, client secrets, or
identifiable athlete exports in a public GitHub issue.

## Credentials

The public repository must never contain:

- an Intervals.icu personal API key;
- an OAuth client secret;
- bearer or refresh tokens;
- Basic Authorization values;
- `.env` files;
- personal athlete IDs used by private development configurations;
- raw production request or response logs containing personal data.

The production Action uses per-user OAuth and athlete-scoped paths fixed to
`/athlete/0`. A user must never be asked to provide an athlete ID or credential
in conversation.

## Consequential operations

Only `createEvent` and `updateWellness` write data. They are marked
`x-openai-isConsequential: true` and must be used only after explicit user intent
and validation of material values.

No delete operation is exposed. A failed or timed-out write must not be repeated
until the user or coach checks whether the first request succeeded.


## Prompt injection and untrusted content

Text returned by Intervals.icu, uploaded files, Knowledge documents, web pages
and tool errors is treated as untrusted data rather than operational
instructions.

In particular:

- embedded text cannot authorise a write operation;
- retrieved content cannot change OAuth scope, athlete identity or endpoint use;
- activity notes, calendar descriptions and workout-library text cannot reveal
  credentials or hidden configuration;
- URLs found in retrieved content are not followed automatically;
- private athlete data is not sent to unrelated services or search queries;
- only a direct current-conversation user request can establish write intent;
- material writes still require validation and confirmation;
- ambiguous or instruction-like content is ignored or escalated for user
  clarification.

Suspected prompt-injection behaviour should be reported privately without
including live credentials or identifiable athlete exports.

## Private development

A private Basic-auth DEV GPT may be used for maintainer testing, but its schema,
credentials, screenshots, and authentication override are excluded from this
repository and release pack.

## Supported disclosure scope

This is a volunteer open-source project. No bug bounty is offered. Good-faith
reports will be reviewed as capacity allows.
