/**
 * `GET /api/web/fetch?url=…&question=…` — reads one page, returns plain text.
 *
 * The page is downloaded and stripped to text by Tavily Extract, not by this
 * server — see the SSRF reasoning in `server/lib/tavily.ts`. Here we only check
 * that the URL is `http(s)`.
 *
 * With a `question`, Tavily keeps only the passages relevant to the question
 * instead of the whole page: much shorter, and the model doesn't have to find
 * a needle in a long article.
 */

import { defineHandler } from 'nitro'

import { json } from '../../../lib/http'
import {
  callTavily,
  MAX_PAGE_CHARS,
  MAX_QUERY_CHARS,
  readTavilyConfig,
  truncate,
} from '../../../lib/tavily'

type TavilyExtractResponse = {
  results?: Array<{ url?: string; raw_content?: string }>
  failed_results?: Array<{ url?: string; error?: string }>
}

export default defineHandler(async (event) => {
  const { reason } = readTavilyConfig()
  if (reason) return json({ error: reason }, 503)

  const params = new URL(event.req.url).searchParams
  let target: URL
  try {
    target = new URL((params.get('url') ?? '').trim())
  } catch {
    return json({ error: '`url` không phải URL hợp lệ' }, 400)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return json({ error: 'chỉ đọc được trang http(s)' }, 400)
  }
  const question = (params.get('question') ?? '')
    .trim()
    .slice(0, MAX_QUERY_CHARS)

  try {
    const data = await callTavily<TavilyExtractResponse>('/extract', {
      urls: [target.href],
      format: 'text',
      extract_depth: 'basic',
      ...(question ? { query: question, chunks_per_source: 3 } : {}),
    })
    const page = data.results?.[0]
    if (!page?.raw_content) {
      const failure = data.failed_results?.[0]?.error ?? 'trang không có chữ'
      return json({ error: `không đọc được trang: ${failure}` }, 502)
    }
    return json({
      url: page.url ?? target.href,
      content: truncate(page.raw_content, MAX_PAGE_CHARS),
    })
  } catch (error) {
    return json(
      { error: `không đọc được trang: ${(error as Error).message}` },
      502,
    )
  }
})
