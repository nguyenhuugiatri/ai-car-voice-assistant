/**
 * The WebLLM implementation of `Runner`. It is **one** implementation, not the
 * only one — see `runner.ts` for why the cloud baseline must be able to plug in
 * without changing anything in the layer above.
 *
 * The four hard constraints below were all read from the installed
 * `@mlc-ai/web-llm@0.2.85` bundle (`index.js:NNNN` is a line in its prebuilt
 * `lib/index.js`, not in the TypeScript sources on GitHub; the official seed
 * example is
 * https://github.com/mlc-ai/web-llm/tree/main/examples/seed-to-reproduce).
 * They are not style suggestions:
 *
 * 1. **`seed` is passed on EVERY request.** The engine resets the seed to
 *    `Date.now()` after every call (`index.js:13561`). Setting it once at init
 *    is a silent trap: runs still produce numbers, just unreproducible ones.
 * 2. **`temperature: 0` is clamped up to `1e-6`** (`index.js:11667`) —
 *    near-greedy, not argmax. Reports must say exactly that. And **don't** set
 *    `top_p: 0`, it throws `RangeError`; for the most greedy you can get, use a
 *    small `top_p`.
 * 3. **`structural_tag` doesn't bypass seed/temperature** — XGrammar only
 *    applies a bitmask to the logits and then still takes the shared sampling
 *    path, so the two points above apply in full.
 * 4. **When switching models, `await` no matter what.** `reload()` calls
 *    `unload()` itself first, but `GPUDevice.destroy()` is asynchronous; without
 *    `await` the two models overlap on the GPU → `DeviceLostError` from OOM.
 *
 * No evidence yet, so don't assume: there is no official guarantee of WebGPU
 * kernel bit-exactness across runs or across GPUs. The seed gives
 * reproducibility **on the same machine** — which is why exported results
 * always record the GPU.
 */

import {
  CreateWebWorkerMLCEngine,
  prebuiltAppConfig,
  type InitProgressReport,
  type WebWorkerMLCEngine,
} from '@mlc-ai/web-llm'

import { buildResponseFormat, parseToolCalls } from '../domain/structural-tag'
import type { ToolDefinition } from '../domain/tools'
import type { RunOutput, Runner } from './runner'

/** Enough for one tool call; the grammar stops right after `</tool_call>` so it rarely hits the cap. */
const MAX_TOKENS = 256

/** `top_p` can't be 0 (`RangeError`); this is the "smallest still valid" in practice. */
const NEAR_GREEDY_TOP_P = 1e-5

/**
 * **Don't use WebLLM's default Cache API** — same reason and same numbers as
 * `src/llm/engine.ts`, where it was first measured: `cache.put()` with a
 * streaming body from HuggingFace's CDN **always** fails with `NetworkError`,
 * while `fetch` of the same URL arrives in full, and
 * `cache.put(url, new Response(await r.arrayBuffer()))` works. It fails at the
 * storage layer, not the network layer, so retrying fails identically every
 * time.
 *
 * The eval suite once lost two runs to this and nearly misrecorded the cause as
 * "disk full" — the disk really was nearly full at the time, and that was a
 * coincidence.
 *
 * Two files declaring the same constant is deliberate: merging them would make
 * `src/eval` import `src/llm`, i.e. the measuring tool depending on the app.
 * They must be free to diverge — but if you change one, read the other too.
 */
const CACHE_BACKEND = 'indexeddb' as const

/**
 * Qwen3 enables thinking by default — same reason and same fix as
 * `src/llm/engine.ts`: the `<think>` block eats all of `MAX_TOKENS` before
 * reaching `<tool_call>`, so the measurement would be of a model cut off
 * mid-way rather than of the model. Only send the flag to models with a
 * thinking mode; for other models it just injects junk into `raw`.
 */
function thinkingBody(modelId: string | null) {
  return modelId?.startsWith('Qwen3')
    ? { extra_body: { enable_thinking: false } }
    : {}
}

export type RunnerOptions = {
  systemPrompt: string
  tools: ToolDefinition[]
  temperature: number
  seed: number
}

/**
 * Keeps a single engine for the whole run and `reload()`s when switching
 * models.
 *
 * Deliberately does **not** create a new engine per configuration: every
 * `reloadInternal` creates a new `GPUDevice`, and the old device only truly
 * dies after `unload()` finishes.
 */
export type EnginePool = {
  /** Only `reload`s when the model differs from the loaded one. Always `await`. */
  ensureModel: (modelId: string) => Promise<void>
  runnerFor: (options: RunnerOptions) => Runner
  /** After `DeviceLostError`: treat the old engine as dead, rebuild from scratch. */
  reset: () => Promise<void>
  dispose: () => Promise<void>
}

export function createEnginePool(
  onProgress: (report: InitProgressReport) => void,
): EnginePool {
  let engine: WebWorkerMLCEngine | null = null
  let loadedModelId: string | null = null

  const spawn = () =>
    new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

  async function ensureModel(modelId: string): Promise<void> {
    if (engine && loadedModelId === modelId) return

    if (!engine) {
      engine = await CreateWebWorkerMLCEngine(spawn(), modelId, {
        initProgressCallback: onProgress,
        appConfig: { ...prebuiltAppConfig, cacheBackend: CACHE_BACKEND },
      })
    } else {
      // `reload` calls `unload()` itself first. `await` is mandatory, see constraint 4.
      await engine.reload(modelId)
    }
    loadedModelId = modelId
  }

  return {
    ensureModel,

    runnerFor: ({ systemPrompt, tools, temperature, seed }): Runner => ({
      async runOne(text: string): Promise<RunOutput> {
        if (!engine) throw new Error('No model loaded')

        const startedAt = performance.now()
        const reply = await engine.chat.completions.create({
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
          response_format: buildResponseFormat(tools),
          temperature,
          top_p: NEAR_GREEDY_TOP_P,
          max_tokens: MAX_TOKENS,
          // Constraint 1: once per request, not once at init.
          seed,
          ...thinkingBody(loadedModelId),
        })
        const latencyMs = performance.now() - startedAt

        // WebLLM does **not** parse the structural tag into
        // `message.tool_calls` — the result sits in `content` as text.
        const raw = reply.choices[0]?.message?.content ?? ''
        const calls = parseToolCalls(raw)
        const first = calls[0]

        return {
          raw,
          latencyMs,
          call: first
            ? {
                name: first.name,
                arguments: (first.arguments ?? {}) as Record<string, unknown>,
              }
            : null,
        }
      },
    }),

    async reset() {
      try {
        await engine?.unload()
      } catch {
        // If the device is already lost, `unload()` throws again — there's
        // nothing to salvage, and the only thing left that makes sense is to
        // forget it so a fresh engine gets built next time.
      }
      engine = null
      loadedModelId = null
    },

    async dispose() {
      await this.reset()
    },
  }
}

/**
 * The GPU this run ran on. Must be recorded in the result JSON: the seed only
 * guarantees reproducibility **on the same machine**, so a number without a GPU
 * attached can't be compared with anyone's.
 */
export async function describeGpu(): Promise<string> {
  if (!('gpu' in navigator)) return 'no WebGPU'
  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return 'WebGPU provided no adapter'
    const info = adapter.info
    return (
      [info?.vendor, info?.architecture, info?.device, info?.description]
        .filter(Boolean)
        .join(' / ') || 'adapter reported no info'
    )
  } catch (error) {
    return `could not read adapter: ${String(error)}`
  }
}
