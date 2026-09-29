/**
 * `GET /api/music/search?q=…` — searches YouTube for songs, returns a list to
 * play.
 *
 * Pre-filtered on YouTube's side: videos only (no channels/playlists), the
 * Music category (`videoCategoryId=10`) and **embeddable** — a non-embeddable
 * video slipping through here would just make the player report error `150`
 * and skip the track, wasting a network round trip.
 */

import { defineHandler } from 'nitro'

import { json } from '../../../lib/http'
import {
  cleanChannelTitle,
  decodeEntities,
  MAX_QUERY_CHARS,
  MAX_RESULTS,
  readYoutubeConfig,
  type SearchTrack,
} from '../../../lib/youtube'

type SearchResponse = {
  items?: Array<{
    id?: { videoId?: string }
    snippet?: { title?: string; channelTitle?: string }
  }>
}

// Error strings stay Vietnamese: the client folds them into a spoken reply
// ("Không tìm được nhạc — …") that also goes back to the model.
export default defineHandler(async (event) => {
  const { apiKey, baseUrl, reason } = readYoutubeConfig()
  if (reason) return json({ error: reason }, 503)

  const query = (new URL(event.req.url).searchParams.get('q') ?? '').trim()
  if (!query) return json({ error: 'thiếu `q`' }, 400)
  if (query.length > MAX_QUERY_CHARS) {
    return json({ error: `truy vấn dài quá ${MAX_QUERY_CHARS} ký tự` }, 413)
  }

  const target = new URL(`${baseUrl}/search`)
  target.search = new URLSearchParams({
    key: apiKey,
    part: 'snippet',
    q: query,
    type: 'video',
    videoCategoryId: '10',
    videoEmbeddable: 'true',
    maxResults: String(MAX_RESULTS),
    regionCode: 'VN',
    relevanceLanguage: 'vi',
  }).toString()

  try {
    const upstream = await fetch(target)
    if (!upstream.ok) {
      const detail = await upstream.text()
      return json(
        { error: `YouTube ${upstream.status}: ${detail.slice(0, 500)}` },
        502,
      )
    }

    const data = (await upstream.json()) as SearchResponse
    const tracks: SearchTrack[] = (data.items ?? []).flatMap((item) => {
      const id = item.id?.videoId
      if (!id) return []
      return [
        {
          id,
          title: decodeEntities(item.snippet?.title ?? ''),
          artist: cleanChannelTitle(
            decodeEntities(item.snippet?.channelTitle ?? ''),
          ),
        },
      ]
    })
    return json({ tracks })
  } catch (error) {
    return json(
      { error: `không gọi được YouTube: ${(error as Error).message}` },
      502,
    )
  }
})
