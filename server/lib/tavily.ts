/**
 * Web lookup configuration via Tavily — both searching (`/search`) and reading
 * pages (`/extract`).
 *
 * ## Why Tavily, not OpenAI's built-in web search
 *
 * OpenAI's web search only exists in the Responses API (or dedicated
 * `*-search-api` models, which can't call function tools). Using it would mean
 * dropping the Chat Completions proxy that the agent loop and the eval suite
 * stand on. Self-defined tools take the same old path: the model calls, the
 * browser runs, the result goes back to the model.
 *
 * One API key for both jobs, and pages are downloaded by **Tavily**, not by
 * this server — the route never `fetch`es a model-supplied URL, so there's no
 * door for an utterance to turn the server into a proxy into the internal
 * network (SSRF).
 *
 * Without the API key the route returns `503`; the tool passes that error to
 * the model, and the model says it couldn't look it up. Every car control
 * command still works as before.
 */

const DEFAULT_BASE_URL = 'https://api.tavily.com'

/** A query longer than this isn't a spoken question. */
export const MAX_QUERY_CHARS = 400
/** Enough to pick a source; more results only add tokens to the next model turn. */
export const MAX_RESULTS = 5
/**
 * Text cap for one page read. Tool results go straight into `messages`, and
 * the proxy caps the total at `MAX_INPUT_CHARS` — a full verbatim article would
 * break the whole turn.
 */
export const MAX_PAGE_CHARS = 6000
/** The driver is waiting with their ears: past this long, better to report failure. */
export const UPSTREAM_TIMEOUT_MS = 15_000

export function readTavilyConfig(): {
  apiKey: string
  baseUrl: string
  reason: string | null
} {
  const apiKey = process.env.TAVILY_API_KEY ?? ''
  const baseUrl = (process.env.TAVILY_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/$/,
    '',
  )
  return {
    apiKey,
    baseUrl,
    reason: apiKey ? null : 'thiếu TAVILY_API_KEY trong môi trường của server',
  }
}

/** Calls a Tavily endpoint. Network and HTTP errors both become an `Error` with a readable message. */
export async function callTavily<T>(
  path: '/search' | '/extract',
  body: Record<string, unknown>,
): Promise<T> {
  const { apiKey, baseUrl } = readTavilyConfig()
  const upstream = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!upstream.ok) {
    const detail = await upstream.text()
    throw new Error(`Tavily ${upstream.status}: ${detail.slice(0, 500)}`)
  }
  return (await upstream.json()) as T
}

/** Cuts at the nearest whitespace boundary, so the model doesn't read half a word. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${space > max * 0.8 ? cut.slice(0, space) : cut} …`
}
