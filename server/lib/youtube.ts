/**
 * Music search configuration via the YouTube Data API v3.
 *
 * Only **searching** needs an API key — playback is handled by the iframe in
 * the browser, no key. So without `YOUTUBE_API_KEY` the app still plays the
 * default playlist, it just can't switch songs on request.
 *
 * The key is server-side for the same reason as ElevenLabs: a key in the bundle
 * is the key of anyone who opens devtools, and the 10,000 units/day quota (one
 * search costs 100) runs out very fast.
 */

const DEFAULT_BASE_URL = 'https://www.googleapis.com/youtube/v3'

/** A query longer than this isn't a song title. */
export const MAX_QUERY_CHARS = 200
export const MAX_RESULTS = 10

/** The shape `src/store/music-store.ts` reads — identical to `MusicTrack`. */
export type SearchTrack = {
  id: string
  title: string
  artist: string
}

export function readYoutubeConfig(): {
  apiKey: string
  baseUrl: string
  reason: string | null
} {
  const apiKey = process.env.YOUTUBE_API_KEY ?? ''
  const baseUrl = (process.env.YOUTUBE_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/$/,
    '',
  )
  return {
    apiKey,
    baseUrl,
    reason: apiKey ? null : 'thiếu YOUTUBE_API_KEY trong môi trường của server',
  }
}

/** The Data API returns HTML-escaped titles (`&#39;`, `&amp;`). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Channel "Sơn Tùng M-TP Official" / "Đen Vâu - Topic" → bare artist name. */
export function cleanChannelTitle(title: string): string {
  return title.replace(/\s*[-–]\s*Topic$/i, '').replace(/\s+Official$/i, '')
}
