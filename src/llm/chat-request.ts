/**
 * Filters the client's body down to exactly the set of fields allowed through
 * to OpenAI.
 *
 * This file deliberately **imports nothing**, for the reason given in
 * `openai-models.ts`: it lives under `src/` but its reader is
 * `server/routes/api/llm/chat.post.ts` (Node), and the server bundle shouldn't
 * drag in the app's dependency tree.
 *
 * Three things are blocked at the door, all for the same reason — a door open
 * to the Internet behind `localhost` is still a door, and this is a demo repo
 * people tend to run with `--host`:
 *
 * 1. `model` must be in the allowlist,
 * 2. `max_tokens` is capped,
 * 3. every unknown field is silently dropped — forwarding things nobody reads
 *    is worse.
 */

/**
 * Hard cap for `max_tokens`. A tool call with ≤ 3 arguments takes under 60
 * tokens, and the car's chit-chat is only a sentence or two — 512 is already
 * generous.
 */
export const MAX_OUTPUT_TOKENS = 512

/**
 * The car's input is an utterance, not a document — but web lookup results
 * are: five excerpts plus one page read (`MAX_PAGE_CHARS` in
 * `server/lib/tavily.ts`) plus history and the car snapshot. This cap is enough
 * for one search → read → speak turn, and still stops someone from using the
 * proxy to translate a whole book.
 */
export const MAX_INPUT_CHARS = 24_000

/** If a car turn takes over 30 s, the driver gave up long ago. */
export const UPSTREAM_TIMEOUT_MS = 30_000

export type SanitizeResult =
  | { body: Record<string, unknown> }
  /** An error string rather than a throw: the caller needs a `400` with a readable message. */
  | { error: string }

export function sanitizeChatRequest(
  raw: unknown,
  fallbackModel: string,
  allowedModels: readonly string[],
): SanitizeResult {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'body is not an object' }
  }
  const input = raw as Record<string, unknown>

  const model =
    typeof input.model === 'string' && input.model ? input.model : fallbackModel
  if (!allowedModels.includes(model)) {
    return { error: `model \`${model}\` is not in the allowlist` }
  }

  const messages = input.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'missing `messages`' }
  }
  const totalChars = messages.reduce((sum: number, message) => {
    const content = (message as { content?: unknown }).content
    return sum + (typeof content === 'string' ? content.length : 0)
  }, 0)
  if (totalChars > MAX_INPUT_CHARS) {
    return { error: `messages too long (max ${MAX_INPUT_CHARS} characters)` }
  }

  const body: Record<string, unknown> = { model, messages }

  // Only the fields the car's loop actually uses. To add a new field, add it
  // here — silently ignoring beats forwarding things nobody reads.
  if (Array.isArray(input.tools) && input.tools.length > 0) {
    body.tools = input.tools
    if (input.tool_choice !== undefined) body.tool_choice = input.tool_choice
    // Default to one tool call per turn: a copy of the grammar's
    // `stop_after_first`, and the configuration the eval suite measures. Only
    // the agent loop asks for `true`, so "bật điều hoà rồi tăng quạt" ("turn on
    // the A/C then raise the fan") finishes in one turn instead of two.
    body.parallel_tool_calls = input.parallel_tool_calls === true
  }
  if (typeof input.temperature === 'number')
    body.temperature = input.temperature
  if (typeof input.top_p === 'number') body.top_p = input.top_p
  body.max_tokens = Math.min(
    typeof input.max_tokens === 'number' ? input.max_tokens : MAX_OUTPUT_TOKENS,
    MAX_OUTPUT_TOKENS,
  )

  return { body }
}
