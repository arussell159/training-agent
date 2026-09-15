# ChatGPT plan and Action compatibility

**Last reviewed:** 23 July 2026

Open Triathlon Coach for ChatGPT can be opened as a custom GPT, but its live
Intervals.icu connection requires the custom Action to be available in the
specific ChatGPT account, model and session.

## Current validation status

| ChatGPT plan or environment | Project status |
|---|---|
| Plus | **Validated end to end.** The Intervals.icu OAuth prompt, authenticated reads and a controlled calendar write have been tested successfully. |
| Free | **GPT access confirmed, Action unavailable in our test.** The account could open and use the GPT, but ChatGPT did not expose the Intervals.icu Action, so OAuth could not start. Live Intervals.icu access is therefore not currently claimed as supported on Free. |
| Go | **Not yet tested.** Do not assume compatibility solely because custom GPT access is included. |
| Pro subscription | **Not yet tested end to end.** OpenAI states that custom Actions are unavailable in Pro mode. A Pro subscriber would need to use a non-Pro, Action-compatible model or mode where available. |
| Business, Enterprise or Edu | **Not yet tested by this project.** Workspace administrators can restrict GPT Actions or Action domains, so availability depends on workspace policy. |

This table records project testing, not a universal statement about every
OpenAI account. OpenAI states that signed-in users can use GPTs, while individual
capabilities may still be unavailable for a particular account, subscription or
managed workspace.

## Required fallback behaviour

When the Intervals.icu Action is unavailable, the coach must say:

> The Intervals.icu Action is unavailable in this ChatGPT session, so I cannot
> access or connect your account here. I will not ask for an athlete ID or API
> key.

It must not:

- ask for an Intervals.icu athlete ID, API key, password, token or Authorization
  header;
- imply that an athlete ID can replace OAuth;
- simulate a live athlete overview;
- claim that an API request or connection attempt occurred when no Action was
  available;
- state that the user's plan is definitely the cause unless ChatGPT explicitly
  reports that reason.

## Official OpenAI references

- GPT availability: https://help.openai.com/en/articles/8554407-gpts-in-chatgpt
- Free-tier GPT access: https://help.openai.com/en/articles/9275245-using-chatgpt-without-logging-in
- Action configuration and limitations: https://help.openai.com/en/articles/9442513
- GPT troubleshooting and missing capabilities: https://help.openai.com/en/articles/11325361
- ChatGPT Go: https://help.openai.com/en/articles/11989085-what-is-chatgpt-go

Recheck these sources before making broader plan-compatibility claims because
ChatGPT plans and capabilities can change.
