/**
 * The cloud path: calls OpenAI through the server's proxy
 * (`server/routes/api/llm/`).
 *
 * No SDK and no API key here. This whole file only knows one same-origin
 * endpoint, `/api/llm/chat`, and that's the entire point: the API key lives on
 * the Node side, while the browser calls a URL that carries no secret at all.
 *
 * This module's shape deliberately mirrors `src/llm/engine.ts` — `ensure` /
 * `generate` / `converse` / `interrupt` — so `engine.ts` only has to branch on
 * the provider rather than rewrite the loop.
 *
 * ## Cancelling a turn: `AbortController`, not a turn token
 *
 * Unlike WebLLM (`interruptGenerate()` returns early with the partial output,
 * doesn't throw), an `abort`ed `fetch` **throws** `AbortError`. Two different
 * behaviours, but `runVoiceCommand` doesn't need to know: it checks `stale()`
 * after every `await` and in the `catch` branch — both paths stop at the same
 * place.
 */

import { buildOpenAiTools, renderToolCall } from '@/domain/openai-tools'
import type { ToolDefinition } from '@/domain/tools'
import type { PromptMessage } from '@/prompt/retry'

import type { Generation } from './engine'
import { DEFAULT_OPENAI_MODEL, type OpenAiModelId } from './openai-models'

const CHAT_URL = '/api/llm/chat'
const INFO_URL = '/api/llm/info'

/** Enough for one tool call; `parallel_tool_calls: false` blocks a second one. */
const MAX_TOKENS = 256

/** Same budget as the on-device path: a sentence or two, no more. */
const CHAT_MAX_TOKENS = 96

/**
 * `0` here is a real `0`, not clamped to `1e-6` like web-llm: the same
 * utterance gives nearly the same tool call — a precondition for debugging via
 * the debug panel. No pinned `seed`: at temperature `0` it adds nothing, and
 * OpenAI only reproduces on a best-effort basis anyway.
 */
const TEMPERATURE = 0

/** Small talk needs temperature, for the reason given in `src/prompt/chat.ts`. */
const CHAT_TEMPERATURE = 0.7
const CHAT_TOP_P = 0.9

export type OpenAiInfo = {
  enabled: boolean
  model: string | null
  models: readonly string[]
  reason: string | null
}

/** `null` when it can't be queried (no server answers `/api/llm`). */
export async function fetchInfo(): Promise<OpenAiInfo | null> {
  try {
    const res = await fetch(INFO_URL)
    if (!res.ok) return null
    return (await res.json()) as OpenAiInfo
  } catch {
    return null
  }
}

/** The turn in progress. Only one — the car doesn't queue, the later command beats the earlier one. */
let inflight: AbortController | null = null

export function interrupt(): void {
  inflight?.abort()
  inflight = null
}

type ChatResponse = {
  choices: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
    }
  }>
}

async function call(body: Record<string, unknown>): Promise<ChatResponse> {
  // A new turn cuts off the old one right here, without waiting for the caller
  // to remember to call `interrupt()`.
  inflight?.abort()
  const controller = new AbortController()
  inflight = controller

  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      // The proxy always returns JSON with `error` — even on `502`. If it can't
      // be parsed here, the error is outside the proxy (static host with no
      // server, some unfamiliar reverse proxy).
      const detail = await res.text()
      let message = detail.slice(0, 300)
      try {
        const parsed = JSON.parse(detail) as { error?: string }
        if (parsed.error) message = parsed.error
      } catch {
        // Keep the raw `detail` as is.
      }
      throw new Error(message)
    }

    return (await res.json()) as ChatResponse
  } finally {
    if (inflight === controller) inflight = null
  }
}

/**
 * Checks whether the proxy is alive. Symmetric in shape with WebLLM's
 * `ensureModel`, but it **downloads nothing** — so it finishes in one network
 * round trip instead of tens of seconds, and `useEngineBoot` has no progress
 * bar to draw.
 */
export function ensure(): Promise<void> {
  // Remember a **successful** check: `ensureModel` runs before every
  // utterance, and asking the proxy again each time adds a network round trip
  // (100–800 ms on 4G or while the function is still cold) before the model
  // even gets the utterance. Failures aren't remembered — ask again next time.
  // If the proxy dies mid-way the chat turn fails, and `forgetEnsure` clears it.
  ensured ??= check().catch((error: unknown) => {
    ensured = null
    throw error
  })
  return ensured
}

let ensured: Promise<void> | null = null

/** A cloud call just failed: check the proxy again from scratch next time. */
export function forgetEnsure(): void {
  ensured = null
}

async function check(): Promise<void> {
  const info = await fetchInfo()
  if (!info) {
    throw new Error(
      "Can't reach the /api/llm proxy — no server means no cloud path; pick an on-device model",
    )
  }
  if (!info.enabled) throw new Error(info.reason ?? 'Proxy unavailable')
}

/**
 * The tool-calling turn. `tool_choice: 'required'` is the translation of the
 * grammar's `at_least_one: true`: the model has **no** way to stay silent, so
 * `answer_in_words` is still the only tool for "just answer in words".
 */
export async function generate(
  model: OpenAiModelId,
  messages: PromptMessage[],
  tools: ToolDefinition[],
): Promise<Generation> {
  const startedAt = performance.now()
  const reply = await call({
    model,
    messages,
    tools: buildOpenAiTools(tools),
    tool_choice: 'required',
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
  })

  const message = reply.choices[0]?.message
  const first = message?.tool_calls?.[0]
  const rendered = first ? renderToolCall(first) : null

  return {
    // No tool call means returning the raw `content`: `firstToolCall` will
    // reject it and the correction turn runs — same path as an on-device model
    // cut off mid-way.
    raw: rendered ?? message?.content ?? '',
    latencyMs: performance.now() - startedAt,
  }
}

/** The turn that writes the reply for `answer_in_words`. No tools, with temperature. */
export async function converse(
  model: OpenAiModelId,
  messages: PromptMessage[],
): Promise<Generation> {
  const startedAt = performance.now()
  const reply = await call({
    model,
    messages,
    temperature: CHAT_TEMPERATURE,
    top_p: CHAT_TOP_P,
    max_tokens: CHAT_MAX_TOKENS,
  })

  return {
    raw: reply.choices[0]?.message?.content ?? '',
    latencyMs: performance.now() - startedAt,
  }
}

export { DEFAULT_OPENAI_MODEL }
