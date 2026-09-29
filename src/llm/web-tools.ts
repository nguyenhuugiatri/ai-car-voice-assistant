/**
 * `web_search` and `web_fetch` — the agent loop's two lookup tools.
 *
 * ## Why they're not in `src/domain/tools.ts`'s `TOOLS`
 *
 * `TOOLS` is **the car's** tool table: WebLLM's grammar, the eval suite and
 * the FP column all stand on it. Lookup tools only make sense when the model
 * **can read the result** — i.e. only on the cloud path. The on-device model is
 * forced into exactly one tool call and then stops; giving it `web_search`
 * gives it a way to call a tool without ever hearing the answer. So these two
 * tools only plug into `ToolLoopAgent`, and the car's table stays unchanged.
 *
 * ## Why they run right here, not via `dispatch` / `runCommand`
 *
 * They don't touch the car, have no `ToolResult`, no template sentence to read
 * out — the result is material for the model, not a sentence for the driver.
 * Going through the control-command door would mean inventing a `kind` just so
 * the status bar can print raw JSON.
 *
 * The API key lives on the server (`/api/web/*`), for the same reason as every
 * other key in the repo.
 */

import { jsonSchema, tool, type Tool } from 'ai'

export const WEB_TOOL_NAMES = ['web_search', 'web_fetch'] as const
export type WebToolName = (typeof WEB_TOOL_NAMES)[number]

export function isWebTool(name: string): name is WebToolName {
  return (WEB_TOOL_NAMES as readonly string[]).includes(name)
}

/** Keep in sync with `server/routes/api/web/search.get.ts`. */
export type WebSearchResult = {
  title: string
  url: string
  content: string
  published?: string
}

/**
 * Tells the caller the model is doing a lookup — a lookup takes a second or
 * two, and a status bar frozen on "Đang xử lý…" ("Processing…") that whole time
 * feels like the car has hung.
 */
export type WebLookupListener = (name: WebToolName, input: unknown) => void

/**
 * Errors become **text returned to the model**, not throws: if the tool throws,
 * the AI SDK carries on but the model only sees a generic error. When it sees
 * "thiếu TAVILY_API_KEY" ("missing TAVILY_API_KEY") or "không đọc được trang"
 * ("couldn't read the page"), it tells the driver what actually happened.
 */
async function getJson<T>(
  url: string,
  abortSignal: AbortSignal | undefined,
): Promise<T | { error: string }> {
  try {
    const res = await fetch(url, { signal: abortSignal })
    const body = (await res.json()) as T & { error?: string }
    if (!res.ok) return { error: body.error ?? `lỗi ${res.status}` }
    return body
  } catch (error) {
    // Turn cancelled: let the AI SDK stop the loop, don't swallow it into a
    // result.
    if (abortSignal?.aborted) throw error
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function buildWebTools(
  onLookup?: WebLookupListener,
): Record<WebToolName, Tool> {
  return {
    web_search: tool({
      description:
        `Search the web for live or factual information the car does not have: weather, ` +
        `traffic, news, prices, opening hours, sports results, facts you are unsure of. ` +
        `Arguments: query — a short search query in the language most likely to find ` +
        `good results; topic — 'news' for recent events, otherwise 'general'. Returns ` +
        `titles, URLs and short excerpts.`,
      inputSchema: jsonSchema<{ query: string; topic?: 'general' | 'news' }>({
        type: 'object',
        properties: {
          query: { type: 'string' },
          topic: { type: 'string', enum: ['general', 'news'] },
        },
        required: ['query'],
        additionalProperties: false,
      }),
      execute: async (input, { abortSignal }) => {
        onLookup?.('web_search', input)
        const params = new URLSearchParams({ q: input.query })
        if (input.topic) params.set('topic', input.topic)
        return getJson<{ results: WebSearchResult[] }>(
          `/api/web/search?${params}`,
          abortSignal,
        )
      },
    }),
    web_fetch: tool({
      description:
        `Read the text of one web page. Use it when search excerpts are not enough to ` +
        `answer, or when the driver gives a URL. Arguments: url — a full http(s) URL, ` +
        `usually one returned by web_search; question — optional, what you need from ` +
        `the page, so only the relevant passages come back.`,
      inputSchema: jsonSchema<{ url: string; question?: string }>({
        type: 'object',
        properties: {
          url: { type: 'string' },
          question: { type: 'string' },
        },
        required: ['url'],
        additionalProperties: false,
      }),
      execute: async (input, { abortSignal }) => {
        onLookup?.('web_fetch', input)
        const params = new URLSearchParams({ url: input.url })
        if (input.question) params.set('question', input.question)
        return getJson<{ url: string; content: string }>(
          `/api/web/fetch?${params}`,
          abortSignal,
        )
      },
    }),
  }
}
