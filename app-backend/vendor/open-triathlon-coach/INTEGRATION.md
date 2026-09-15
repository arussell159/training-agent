# Application integration

Upstream: https://github.com/Takethis88/Open-Triathlon-Coach-for-ChatGPT
Pinned commit: eee623bc79a158a50405adb0195aa7afb52f4da6

Original MIT attribution and files are retained. `API instructions.md` is loaded unchanged.
This is an API-runtime adaptation, not the hosted custom GPT. Its empty public knowledge manifest does not include private GPT Knowledge files.

The adapter derives the 22 operation definitions from the original Intervals.icu OpenAPI Action schema and executes GET operations against the official API. Athlete-scoped paths remain fixed to /athlete/0. Personal API-key authentication is handled only by backend Settings, rather than ChatGPT OAuth.

Runtime instructions distinguish this app's authentication, storage and UI from the upstream ChatGPT product. Raw Intervals.icu thresholds/units are preserved for coaching. Calendar and wellness writes from chat are preview-only; conversational approval cannot execute them. Direct calendar controls separately perform and verify move/copy/delete operations.

Activities and planned events use distinct IDs. Completed activities cannot be moved or deleted through calendar controls. Paired sessions are combined without inventing telemetry. Old provider-specific structured review patches are rejected. Missing capabilities/data are reported rather than fabricated.

Verification uses mocked responses and does not transmit private athlete data or change the user's account. The user must enter their API key in Settings to validate the live connection.
