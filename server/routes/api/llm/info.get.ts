/**
 * `GET /api/llm/info` — whether OpenAI can be called, and with which model.
 *
 * `src/llm/openai.ts` reads the response as `OpenAiInfo`. Without an API key it
 * returns `enabled: false` with a `reason`; the Settings screen says so plainly
 * and the user switches back to an on-device model.
 */

import { defineHandler } from 'nitro'

import { json } from '../../../lib/http'
import { readOpenAiConfig } from '../../../lib/openai'

export default defineHandler(() => json(readOpenAiConfig().info))
