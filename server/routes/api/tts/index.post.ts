/**
 * `POST /api/tts` — one Vietnamese sentence in, an mp3 **stream** read aloud by
 * ElevenLabs out.
 *
 * A stream rather than a file: `eleven_v3_conversational` delivers its first
 * byte as fast as Flash (~0.35s) but takes twice as long to synthesise the
 * whole sentence (~1s). Collecting it all before returning would throw away
 * exactly that advantage — so every byte that arrives is forwarded right away,
 * and the client starts playing as soon as there's sound.
 *
 * When ElevenLabs returns an error it's a `502` with the verbatim text, and the
 * queue reads that sentence with the OS voice instead of swallowing a reply.
 */

import { defineHandler } from 'nitro'

import {
  MAX_TTS_CHARS,
  OUTPUT_FORMAT,
  readTtsConfig,
  supportsLanguageCode,
} from '../../../lib/eleven'
import { json, readJson } from '../../../lib/http'

export default defineHandler(async (event) => {
  const { apiKey, baseUrl, info } = readTtsConfig()
  if (!info.enabled || !info.voice || !info.model) {
    return json({ error: info.reason }, 503)
  }

  const body = (await readJson(event.req)) as { text?: unknown } | undefined
  if (body === undefined) return json({ error: 'body is not JSON' }, 400)

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return json({ error: 'missing `text`' }, 400)
  if (text.length > MAX_TTS_CHARS) {
    return json(
      { error: `text too long (max ${MAX_TTS_CHARS} characters)` },
      413,
    )
  }

  const target = new URL(
    `${baseUrl}/text-to-speech/${encodeURIComponent(info.voice)}/stream`,
  )
  target.searchParams.set('output_format', OUTPUT_FORMAT)

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': apiKey },
      // If the client cancels (the driver says a new command), close the
      // connection to ElevenLabs too, rather than keeping a stream nobody is
      // listening to until the end of the sentence.
      signal: event.req.signal,
      body: JSON.stringify({
        text,
        model_id: info.model,
        // Force the language instead of letting the model guess: the car's
        // replies are so short — "Đã bật A/C" ("A/C on") — that there isn't
        // enough signal for it to pick Vietnamese correctly.
        ...(supportsLanguageCode(info.model) ? { language_code: 'vi' } : {}),
      }),
    })

    // ElevenLabs errors arrive before the first audio byte, so a clean `502`
    // can still be returned. A failure *mid*-stream just looks to the client
    // like the stream ending early.
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text()
      return json(
        { error: `ElevenLabs ${upstream.status}: ${detail.slice(0, 500)}` },
        502,
      )
    }

    return new Response(upstream.body, {
      headers: {
        'content-type': 'audio/mpeg',
        // Replies repeat a lot ("Đã tăng lên 23 độ", "Raised to 23 degrees"),
        // but leave that to the client: the queue drops the blob once it's
        // read, and a ~400ms network round trip for a repeated reply is an
        // acceptable price in a demo.
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return json(
      { error: `could not reach ElevenLabs: ${(error as Error).message}` },
      502,
    )
  }
})
