# Knowledge-base policy

**Policy baseline:** 1.0.0  
**Reviewed:** 21 July 2026

This directory is the public, licence-audited catalogue for evidence used by
Open Triathlon Coach for ChatGPT. It is not a dump of everything uploaded to a private GPT.

## Copyright rule

Academic papers are usually copyrighted. “Academic”, “free to read”, “found on
Google Scholar”, “available through a university”, or “has a DOI” does not by
itself permit republication of the PDF.

Commit full text only when one of the following has been verified:

- public domain or CC0;
- CC BY;
- CC BY-SA;
- another licence that clearly permits public redistribution and whose
  conditions are followed;
- an author manuscript whose repository or rights statement clearly permits
  redistribution;
- explicit written permission from the rights holder.

Licences such as CC BY-NC may permit a non-commercial repository but can create
downstream restrictions. Record them accurately and do not relicense the source
under MIT. CC BY-ND and other no-derivatives terms require special care:
unchanged redistribution may be allowed, but adapted or extracted derivative
material may not be. When rights are uncertain, do not commit the full text.

## Sources without redistribution permission

For a paywalled, publisher-controlled, free-to-read, or unclear source, commit
only:

- bibliographic metadata;
- DOI and official landing-page URL;
- the licence status and date checked;
- an original summary written for this project;
- short quotations only where legally justified and necessary;
- an evidence note explaining relevance, limitations, and intended coaching use.

Do not upload the publisher PDF.

## Directory use

- `manifest.csv` — one row for every source considered or used.
- `open-access/` — only redistributable full text plus a sidecar licence note.
- `summaries/` — original project summaries and evidence notes.

Suggested filenames:

- `open-access/<source-id>.pdf`
- `open-access/<source-id>.license.md`
- `summaries/<source-id>.md`

## Manifest requirements

Every source must record:

- stable project ID;
- title, authors, and year;
- DOI and official URL where available;
- exact licence and licence URL;
- whether redistribution was verified;
- the date and person/process that checked it;
- full-text and summary paths;
- notes on corrections, retractions, or uncertainty.

## Evidence quality

A redistribution licence says what may be copied; it does not prove scientific
quality. Summaries should separately record:

- study design and population;
- sample size where material;
- intervention and comparator;
- main outcomes;
- limitations and applicability to triathlon;
- whether findings are observational, mechanistic, or causal;
- conflicts of interest or funding where relevant;
- later corrections, expressions of concern, or retractions.

Avoid converting a single paper into a universal coaching rule. Prefer
systematic reviews, consensus statements, primary research, and triangulation
across credible sources.

## Prohibited content

Do not commit:

- books or book chapters without redistribution permission;
- publisher PDFs with unknown or restrictive rights;
- files obtained through institutional or subscription access unless their
  separate licence permits redistribution;
- copyrighted figures extracted from restricted papers;
- real athlete activities, wellness records, medical details, names, IDs, or
  location history;
- API keys, OAuth tokens, client secrets, or private GPT exports;
- confidential coaching notes or third-party personal data.

## GPT Knowledge uploads

The GPT should receive a curated subset, preferably clear Markdown evidence
summaries plus selected openly licensed sources. Instructions and behavioural
rules belong in the GPT Instructions field, not in academic source files.

Third-party sources keep their original licences. The repository's MIT License
applies only to original project code and documentation unless a file explicitly
states otherwise.
