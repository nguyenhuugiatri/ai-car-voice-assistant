/**
 * `POST /api/llm/chat` → OpenAI's Chat Completions.
 *
 * ## This proxy is thin, but not transparent
 *
 * It does **not** forward the client's body as is: `sanitizeChatRequest` blocks
 * models outside the allowlist, caps `max_tokens`, drops unknown fields. When
 * OpenAI returns an error it's a `502` with the verbatim text, and
 * `runVoiceCommand` turns it into a `rejected` `ToolResult` like any other
 * error.
 *
 * ## Why it does **not** use the AI SDK
 *
 * The proxy's job is forwarding. The client sends its own `tools[]` (the eval
 * suite's "tool set" axis relies on exactly this to run a tool table other than
 * the standard one), and `converse()` sends **no** tools at all to get prose.
 * Going through `generateText` would mean rebuilding the `choices[0].message`
 * envelope for the client to read — translating forth and back. The AI SDK
 * runs in the browser (`src/llm/agent.ts`) and calls this proxy like an
 * ordinary Chat Completions endpoint.
 */

import { defineHandler } from 'nitro'

import {
  sanitizeChatRequest,
  UPSTREAM_TIMEOUT_MS,
} from '../../../../src/llm/chat-request'
import {
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODEL_IDS,
} from '../../../../src/llm/openai-models'
import { json, readJson } from '../../../lib/http'
import { readOpenAiConfig } from '../../../lib/openai'

export default defineHandler(async (event) => {
  const { apiKey, baseUrl, info } = readOpenAiConfig()
  if (!info.enabled) return json({ error: info.reason }, 503)

  const parsed = await readJson(event.req)
  if (parsed === undefined) return json({ error: 'body is not JSON' }, 400)

  const checked = sanitizeChatRequest(
    parsed,
    info.model ?? DEFAULT_OPENAI_MODEL,
    OPENAI_MODEL_IDS,
  )
  if ('error' in checked) return json({ error: checked.error }, 400)

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(checked.body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    const text = await upstream.text()
    if (!upstream.ok) {
      return json(
        { error: `OpenAI ${upstream.status}: ${text.slice(0, 500)}` },
        502,
      )
    }

    // Return the body verbatim: the client reads `choices[0].message.tool_calls`,
    // and parse-then-stringify here only has a chance to break things, never to
    // fix anything.
    return new Response(text, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return json(
      { error: `could not reach OpenAI: ${(error as Error).message}` },
      502,
    )
  }
})
