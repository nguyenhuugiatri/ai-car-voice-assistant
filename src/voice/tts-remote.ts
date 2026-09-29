/**
 * Client for `/api/tts` — the server's ElevenLabs mouth.
 *
 * Kept apart from the speech queue because the two fail in different ways: a
 * failure here means *no neural voice*, while a queue failure means *no sound
 * at all*. Keeping them separate means the fall-back-to-the-browser branch
 * lives in exactly one place.
 *
 * See `server/routes/api/tts/` for the Node side.
 */

export type TtsInfo = {
  enabled: boolean
  voice: string | null
  model: string | null
  /** Why it's unavailable — shown verbatim; don't make the user guess. */
  reason: string | null
}

const UNAVAILABLE: TtsInfo = {
  enabled: false,
  voice: null,
  model: null,
  reason: 'no /api/tts (running without the server?)',
}

/**
 * The engine doesn't change during a session, so ask exactly once for the
 * whole app — several `useSpeechQueue`s at once still cost one round trip.
 */
let infoPromise: Promise<TtsInfo> | null = null

export function fetchTtsInfo(): Promise<TtsInfo> {
  infoPromise ??= fetch('/api/tts/info')
    .then((res) => (res.ok ? (res.json() as Promise<TtsInfo>) : UNAVAILABLE))
    // Without the middleware, `fetch` gets `index.html` itself with a 200 and
    // `res.json()` throws — same exit as a network error, and likewise means
    // "fall back to the browser's voice".
    .catch(() => UNAVAILABLE)
  return infoPromise
}

/**
 * Orders synthesis of one sentence. Resolves **as soon as ElevenLabs starts
 * returning audio** (headers in, mp3 not complete yet) with a `Response` whose
 * body is the mp3 stream — the player plays it as far as it has read. Throws
 * on failure before the first audio byte.
 */
export async function synthesize(
  text: string,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
  if (!res.ok || !res.body) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error ?? `TTS error ${res.status}`)
  }
  return res
}
