# AI Car Voice Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A car head unit (infotainment) simulator you control by voice, running entirely
in the browser: Web Speech API → LLM (on-device via WebLLM/WebGPU, or OpenAI
through the server) → tool call → UI update. The server only holds the API
keys; the car state lives in the browser.

**[Try the live demo](https://car-voice-demo.vercel.app/)** (Chrome; the voice
interface ships in Vietnamese — see [Language](#language))

https://github.com/user-attachments/assets/728d557d-7124-44d2-998e-641dcc65356c

You speak a command; the browser transcribes it, an LLM turns it into a tool
call, and the car UI updates — climate, windows, doors, seats, music, web
search. The car speaks its reply back through ElevenLabs or the operating
system's voice.

The domain vocabulary is in `CONTEXT.md`, the domain model in
`docs/domain-model.md`. How to contribute: `CONTRIBUTING.md`.

## Running

```bash
pnpm install
cp .env.example .env   # optional: OPENAI_API_KEY, ELEVENLABS_API_KEY
pnpm dev               # one process: UI + /api/*
```

Requires **Chrome** (WebGPU for WebLLM + Web Speech API for speech
recognition).

### Voice

Conversation mode speaks its replies with **ElevenLabs**
(`eleven_v3_conversational`) if `.env` has `ELEVENLABS_API_KEY`, otherwise with
the operating system's vi-VN voice. The small line of text under the
conversation bar always says which one it is using.

The key stays on the Node side and never reaches the browser: it is only read in
`server/routes/api/tts/`. Without the key the app falls back to the OS voice and
nothing breaks. Listening is always done by the Web Speech API.

## Two ways to talk

The mic button in the dock is **push-to-talk**: one press, one command. The
phone button next to it starts **conversation mode** — the mic stays open, the
car works out on its own when you have finished speaking (`src/voice/endpoint.ts`
reads sentence-final particles instead of counting seconds), runs the command,
then speaks its reply before listening again.

This mode is ported from an earlier voice prototype: **listening is still the
browser's Web Speech API**, speaking is ElevenLabs (see "Voice" above) with `speechSynthesis`
as the fallback. If no voice is available the car still listens and still acts;
it just replies in text.

## Language

The voice interface ships in **Vietnamese**: speech recognition, the LLM
prompts, the tool descriptions and the car's spoken replies are all Vietnamese;
the on-screen UI is English. To switch a fork to another language, these are
the main places to change:

| What | Where |
|---|---|
| Language codes (`vi-VN`, `vi`) for recognition, TTS and music search | `src/voice/use-speech-recognition.ts`, `src/voice/use-call-session.ts`, `src/voice/use-speech-queue.ts`, `server/routes/api/tts/index.post.ts`, `server/routes/api/music/search.get.ts` |
| The car's replies | `src/domain/say.ts` |
| Tool descriptions and prompts | `src/domain/tools.ts`, `src/prompt/` |
| End-of-speech detection (sentence-final particles) | `src/voice/endpoint.ts` |
| Eval cases | `src/eval/cases.ts` |

The remaining strings (music and web-search messages) turn up with a grep for
Vietnamese diacritics.

## Server

`server/` is a [Nitro](https://nitro.build) server directory, plugged into Vite
through `nitro/vite` (see `vite.config.ts`). Each file under `server/routes/` is
a route; the same routes run under `pnpm dev` and become Vercel Functions when
deployed.

| Endpoint | What it does | Called by |
|---|---|---|
| `GET /api/llm/info` | Whether there is a key, which model, which allowlist | Settings screen |
| `POST /api/llm/chat` | Chat Completions proxy, filters the body | `src/llm/openai.ts`, the eval suite |
| `GET /api/tts/info` | Whether an ElevenLabs voice is available | `src/voice/tts-remote.ts` |
| `POST /api/tts` | One sentence → mp3 | `src/voice/tts-remote.ts` |
| `GET /api/web/search` | Web search via Tavily, returns snippets | `web_search` in `src/llm/web-tools.ts` |
| `GET /api/web/fetch` | Reads a page's text via Tavily Extract | `web_fetch` in `src/llm/web-tools.ts` |

Routes import `src/domain/*` and `src/llm/*` directly — there is only **one**
copy of the tool table. The body-filtering rules live in
`src/llm/chat-request.ts`; change the token cap or the allowlist there.

## Deploying (Vercel)

Connect the repo to Vercel (or run `vercel deploy`). When building on Vercel,
Nitro picks the `vercel` preset automatically and emits `.vercel/output`
following the Build Output API (static files on the CDN, one Node 24 Function
per `/api/*` route), which Vercel reads directly. `vercel.json` only disables
the framework preset (the Vite preset would go looking for `dist/`) and pins the
install/build commands; the pnpm and Node versions are pinned by
`packageManager`/`engines` in `package.json`. Set `OPENAI_API_KEY`,
`ELEVENLABS_API_KEY` (and the optional variables in `.env.example`) under
Project Settings → Environment Variables.

To try the Vercel build locally: `NITRO_PRESET=vercel pnpm build`. A plain
`pnpm build` produces `.output/`, run with `node .output/server/index.mjs` (or
`pnpm preview`).

> [!WARNING]
> A deployment is **open to everyone**: no password, no rate limit.
> `/api/llm/chat`, `/api/tts` and `/api/web/*` forward requests using your keys,
> so anyone with the URL can spend your quota. If you deploy publicly, add a
> gate first (Vercel Deployment Protection, Cloudflare Access, or a rate limit in
> `server/routes/api/`) before sharing the link.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server (UI + API) |
| `pnpm build` | Type-check, then build into `.output/` |
| `pnpm preview` | Run the build |
| `pnpm typecheck` | Type-check only |
| `pnpm lint` | oxlint |
| `pnpm format` | Prettier |

## Stack

Vite + React 19 + TypeScript + Tailwind v4 + shadcn + Zustand + Zod + `@mlc-ai/web-llm`.
Server: Nitro (Vite plugin). The Vercel AI SDK runs the agent loop in the
browser (`src/llm/agent.ts`). The `persona` and `speech-input` components are
**copied** from AI Elements (Apache-2.0) into `src/components/ai-elements/` —
they are code in this repo, not a dependency.

## License

MIT — see `LICENSE`. Code copied from third parties keeps its original license,
listed in `THIRD-PARTY.md`.

The car in the app is a **simulation** with a made-up `W` badge. This repo is
not affiliated with, sponsored or endorsed by any car maker; brand names that
appear in comments are design-reference notes only.
