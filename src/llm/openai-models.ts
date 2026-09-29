/**
 * The list of OpenAI models the head unit is allowed to call.
 *
 * This file deliberately **imports nothing** — it's pure constants, because
 * the two sides that read it live in different worlds:
 * `src/store/session-store.ts` (runs in the browser) and the routes in
 * `server/` (run in Node). Adding a heavy import here drags the app's whole
 * dependency tree into the server bundle.
 *
 * This is also the real **allowlist**: the proxy rejects any `model` not on
 * the list. The client picks the model, but the client has no right to invent
 * one — a bug on the browser side must not turn into a big-model bill.
 *
 * ## Why the default is `gpt-4.1-mini`
 *
 * The constraint of this problem is **latency to the first tool call**, not
 * prose quality: each generation is exactly one tool call with ≤ 3 arguments,
 * and the driver can hear every hundred milliseconds.
 *
 * - The `gpt-4.1` family calls tools fast because it has **no thinking phase**
 *   — the first token out already starts the tool call. Reasoning families
 *   (`o*`, `gpt-5*`) burn hundreds of tokens thinking silently before opening
 *   their mouth; for "bật điều hoà" ("turn on the A/C") that's money and time
 *   paid for something nobody needs.
 * - `mini` rather than `nano` as the default because the hard part of this
 *   command set isn't syntax but **direction-flip** (CONTEXT.md): "lạnh quá"
 *   ("so cold") must yield `warmer`. That's reasoning about the speaker's
 *   intent, and that's exactly where nano falls short.
 * - `nano` is still here: for measuring the lower bound on latency, or once
 *   the prompt has pinned the command set down so tightly that flips no longer
 *   happen.
 *
 * Don't change the default because you read a benchmark table. Change it
 * because the eval suite (`src/eval`) produces the numbers.
 */

export const OPENAI_MODEL_IDS = [
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4.1',
  'gpt-4o-mini',
] as const

export type OpenAiModelId = (typeof OPENAI_MODEL_IDS)[number]

export function isOpenAiModel(id: string): id is OpenAiModelId {
  return (OPENAI_MODEL_IDS as readonly string[]).includes(id)
}

/** The app's default. Read the "Why" section at the top of the file before editing this line. */
export const DEFAULT_OPENAI_MODEL: OpenAiModelId = 'gpt-4.1-mini'
