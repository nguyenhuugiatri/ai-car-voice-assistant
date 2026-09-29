/**
 * `GET /api/tts/info` — whether an ElevenLabs voice is available.
 *
 * Without an API key it returns `enabled: false` with a `reason`; the UI falls
 * back to `speechSynthesis` and says plainly why.
 */

import { defineHandler } from 'nitro'

import { readTtsConfig } from '../../../lib/eleven'
import { json } from '../../../lib/http'

export default defineHandler(() => json(readTtsConfig().info))
