/**
 * Cloud path configuration: API key, base URL, default model and allowlist.
 *
 * Reads `process.env` inside a **function**, not at module level. On Vercel a
 * route runs as a Function: environment variables are present at call time,
 * whereas a constant read at module level can freeze the build-time value.
 */

import {
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODEL_IDS,
  isOpenAiModel,
} from '../../src/llm/openai-models'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/** The shape `src/llm/openai.ts` reads from `GET /api/llm/info`. */
export type OpenAiInfo = {
  enabled: boolean
  /** The default model chosen by env — the client uses it when it doesn't specify one. */
  model: string | null
  /** Every allowed model, so the UI doesn't have to guess. */
  models: readonly string[]
  /** Why it's unavailable. `null` when available. */
  reason: string | null
}

export function readOpenAiConfig(): {
  apiKey: string
  baseUrl: string
  info: OpenAiInfo
} {
  const apiKey = process.env.OPENAI_API_KEY ?? ''
  const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/$/,
    '',
  )

  if (!apiKey) {
    return {
      apiKey,
      baseUrl,
      info: {
        enabled: false,
        model: null,
        models: OPENAI_MODEL_IDS,
        reason: 'OPENAI_API_KEY is missing from the server environment',
      },
    }
  }

  const configured = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
  return {
    apiKey,
    baseUrl,
    info: {
      enabled: true,
      model: isOpenAiModel(configured) ? configured : DEFAULT_OPENAI_MODEL,
      models: OPENAI_MODEL_IDS,
      reason: null,
    },
  }
}
