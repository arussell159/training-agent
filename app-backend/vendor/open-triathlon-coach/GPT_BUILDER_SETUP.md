# GPT builder and OAuth setup

**Project:** Open Triathlon Coach for ChatGPT
**Policy baseline:** 1.0.0
**Reviewed:** 21 July 2026

This file is for the project maintainer. End users should follow the setup in
`README.md`.

## 1. Create or update the GPT

Use this public name:

> Open Triathlon Coach for ChatGPT

Suggested description:

> An independent, open-source triathlon coach for ChatGPT that analyses your
> authorised Intervals.icu activities, wellness, thresholds, and calendar data.
> Not affiliated with or endorsed by Intervals.icu.

Add the independence disclaimer in the long description:

> This project is not owned, operated, affiliated with, or endorsed by
> Intervals.icu or OpenAI.

Paste `API instructions.md` into the GPT Instructions field together with any
separate, compatible triathlon-coaching instructions. Do not paste DEV Basic-auth
overrides into the production GPT.

## 2. Configure the Action

Import:

`action/intervals-oauth-action.json`

Authentication type:

`OAuth`

Authorization URL:

`https://intervals.icu/oauth/authorize`

Token URL:

`https://intervals.icu/api/oauth/token`

Scope string, with no spaces:

`ACTIVITY:READ,WELLNESS:WRITE,CALENDAR:WRITE,LIBRARY:READ,SETTINGS:READ`

Token exchange method:

`POST` / the editor's default POST option

Privacy-policy URL:

`https://takethis88.github.io/Open-Triathlon-Coach-for-ChatGPT/privacy.html`

The ChatGPT editor supplies the OAuth callback URL. Register that exact callback
with Intervals.icu. The current project callback must be checked in the editor
before release; do not assume a copied callback remains valid after recreating
the GPT.

Enter the OAuth client ID and client secret only in the Action editor. Never
commit either value to GitHub, a Knowledge file, a screenshot, a test fixture,
or a conversation.

## 3. Data and model settings

- Keep the GPT-level **“Use conversation data in your GPT to improve our models”**
  setting disabled.
- Do not describe this builder setting as replacing each user's OpenAI
  account-level Data Controls.
- Recommend the highest reasoning level that still supports the Action.
- Do not recommend Pro mode while OpenAI documents custom Actions as unavailable
  in Pro mode.
- Ensure the GPT uses Actions rather than Apps; OpenAI currently states that a GPT
  can use either Apps or Actions, not both at the same time.

## Public compatibility disclosure

Before a public release or documentation update:

- state that the Intervals.icu Action is validated on Plus;
- state that a tested Free account could open the GPT but did not expose the
  Action, so OAuth could not start;
- mark Go and managed-workspace compatibility as unverified until tested;
- distinguish Pro subscription access from Pro mode, which cannot use custom
  Actions under current OpenAI documentation;
- never claim that an athlete ID or API key is a fallback connection method;
- retest plan compatibility after material ChatGPT product changes.

See `COMPATIBILITY.md`.

## 4. Knowledge files

Upload only the curated Knowledge files intended for the GPT. The GitHub
knowledge catalogue may be larger than the files uploaded to the GPT.

Before uploading or committing any academic source:

1. record it in `knowledge/manifest.csv`;
2. verify redistribution rights;
3. put permitted full text in `knowledge/open-access/`;
4. otherwise use an original summary in `knowledge/summaries/`;
5. remove personal athlete data, credentials, and confidential material.

## 5. Test before publishing

Run `tests/acceptance-tests.md` in Preview.

At minimum verify:

- OAuth login resolves the current user through `/athlete/0`;
- no API key or athlete ID is requested;
- run and swim threshold conversion is correct;
- metric and imperial values are labelled;
- read-only review works;
- calendar and wellness writes require explicit intent and confirmation;
- retries do not create duplicates;
- unsupported delete requests are refused accurately;
- privacy-policy URL loads publicly;
- no Pro-mode recommendation appears.

## 6. Publish

A public GPT with Actions requires a valid privacy-policy URL under current
OpenAI documentation. Confirm the GitHub Pages privacy page is live before
selecting public sharing or GPT Store publication.

After publishing, add the public GPT link to `README.md` and `docs/index.html`,
increment the changelog, rerun validation, and create the v1.0 release.
