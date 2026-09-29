# Security

## Reporting a vulnerability

Don't open a public issue. Use
[GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(the **Security** tab → *Report a vulnerability*). This is a personal project
with no SLA — I'll try to reply within a week.

## Before you deploy

This repo **does not protect your deployment for you**:

- **No authentication.** Anyone with the URL can use the whole app.
- **No rate limit.** `/api/llm/chat`, `/api/tts` and `/api/web/*` forward
  requests using your `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` and
  `TAVILY_API_KEY`. A public deployment that gets discovered means burnt quota.

If you deploy publicly, add a gate first: Vercel Deployment Protection,
Cloudflare Access, or a rate limit in `server/routes/api/`.

The only built-in defense is the **model allowlist** in
`src/llm/openai-models.ts` and the body filter in `src/llm/chat-request.ts` —
they stop the proxy from being used as a general-purpose OpenAI gateway (swapping
the model, inflating `max_tokens`), but they cannot stop abuse of the app's own
intended purpose.

## Keys

The environment variables here **deliberately have no `VITE_` prefix**: variables
with that prefix are baked straight into the bundle that runs on the user's
machine. Keys are only read inside `server/`. Never add `VITE_` to any key.

`.env` is in `.gitignore` and has never been committed.
