/**
 * `GET /api/web/search?q=…&topic=general|news` — searches the web, returns a few
 * short results for the model to read.
 *
 * Returns excerpts (`content`) rather than whole pages: most in-car questions
 * ("trời Hà Nội mai mưa không" — "will it rain in Hanoi tomorrow", "giá xăng
 * hôm nay" — "petrol price today") can be answered from an excerpt, and every
 * character here is a token in the next model turn. When it needs a closer
 * read, the model calls `web_fetch` with a URL taken from here.
 */

import { defineHandler } from 'nitro'

import { json } from '../../../lib/http'
import {
  callTavily,
  MAX_QUERY_CHARS,
  MAX_RESULTS,
  readTavilyConfig,
} from '../../../lib/tavily'

type TavilySearchResponse = {
  results?: Array<{
    title?: string
    url?: string
    content?: string
    published_date?: string
  }>
}

/** Keep in sync with `WebSearchResult` in `src/llm/web-tools.ts`. */
type WebSearchResult = {
  title: string
  url: string
  content: string
  published?: string
}

export default defineHandler(async (event) => {
  const { reason } = readTavilyConfig()
  if (reason) return json({ error: reason }, 503)

  const params = new URL(event.req.url).searchParams
  const query = (params.get('q') ?? '').trim()
  if (!query) return json({ error: 'thiếu `q`' }, 400)
  if (query.length > MAX_QUERY_CHARS) {
    return json({ error: `truy vấn dài quá ${MAX_QUERY_CHARS} ký tự` }, 413)
  }
  const topic = params.get('topic') === 'news' ? 'news' : 'general'

  try {
    const data = await callTavily<TavilySearchResponse>('/search', {
      query,
      topic,
      search_depth: 'basic',
      max_results: MAX_RESULTS,
      // The driver is in Vietnam: "thời tiết mai" ("weather tomorrow") means
      // the weather here. Tavily only accepts `country` with topic `general`.
      ...(topic === 'general' ? { country: 'vietnam' } : {}),
    })
    const results: WebSearchResult[] = (data.results ?? []).flatMap((item) =>
      item.url
        ? [
            {
              title: item.title ?? '',
              url: item.url,
              content: item.content ?? '',
              ...(item.published_date
                ? { published: item.published_date }
                : {}),
            },
          ]
        : [],
    )
    return json({ results })
  } catch (error) {
    return json(
      { error: `không tìm được trên web: ${(error as Error).message}` },
      502,
    )
  }
})
