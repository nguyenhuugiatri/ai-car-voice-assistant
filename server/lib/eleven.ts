/**
 * ElevenLabs TTS voice configuration.
 *
 * Calling ElevenLabs directly from the browser means **stuffing `xi-api-key`
 * into code running on other people's machines**. With an API key billed per
 * character that's not a trade-off, it's a bug — so the key lives only here.
 */

/**
 * `eleven_v3_conversational` — the real-time version of v3: it pronounces
 * Vietnamese tones far more accurately than `eleven_flash_v2_5`, while the
 * first byte is only a few tens of ms slower (measured via `/stream`). Plain
 * `eleven_v3` has the same voice quality but is three times slower.
 * `eleven_multilingual_v2` does **not** know Vietnamese, don't switch to it.
 */
const DEFAULT_MODEL = 'eleven_v3_conversational'
/**
 * "Jessica" — one of ElevenLabs' **default** voices, callable even on a free
 * account.
 *
 * Don't switch to a voice from the voice library: the free tier returns `402
 * paid_plan_required`, and that's how an earlier voice demo once died. Default
 * voices tried and working: `EXAVITQu4vr4xnSDxMaL` (Sarah),
 * `cgSgspJ2msm6clMCkdW9` (Jessica), `JBFqnCBsd6RMkjVDRZzb` (George),
 * `pFZP5JQG7iQjIQuC4Bku` (Lily).
 */
const DEFAULT_VOICE = 'cgSgspJ2msm6clMCkdW9'
const DEFAULT_BASE_URL = 'https://api.elevenlabs.io/v1'

export const OUTPUT_FORMAT = 'mp3_44100_128'

/** Text longer than this isn't a reply from the car — block it at the door so a
 * client-side bug doesn't burn through the character quota. */
export const MAX_TTS_CHARS = 600

/** The shape `src/voice/tts-remote.ts` reads from `GET /api/tts/info`. */
export type TtsInfo = {
  enabled: boolean
  voice: string | null
  model: string | null
  /** Why it's unavailable. `null` when available. */
  reason: string | null
}

export function readTtsConfig(): {
  apiKey: string
  baseUrl: string
  info: TtsInfo
} {
  const apiKey = process.env.ELEVENLABS_API_KEY ?? ''
  const baseUrl = (process.env.ELEVENLABS_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/$/,
    '',
  )

  if (!apiKey) {
    return {
      apiKey,
      baseUrl,
      info: {
        enabled: false,
        voice: null,
        model: null,
        reason: 'ELEVENLABS_API_KEY is missing from the server environment',
      },
    }
  }

  return {
    apiKey,
    baseUrl,
    info: {
      enabled: true,
      voice: process.env.TTS_VOICE || DEFAULT_VOICE,
      model: process.env.TTS_MODEL || DEFAULT_MODEL,
      reason: null,
    },
  }
}

/** The `v2_5` and `v3` families accept `language_code`; sending it with `eleven_multilingual_v2` is a 400. */
export function supportsLanguageCode(model: string): boolean {
  return model.endsWith('_v2_5') || model.startsWith('eleven_v3')
}
