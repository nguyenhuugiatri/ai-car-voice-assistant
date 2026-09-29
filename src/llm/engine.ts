/**
 * The head unit's engine — one model, loaded once, kept for the whole session.
 *
 * ## Two providers, one door
 *
 * Since OpenAI was added, this file has **two** paths behind the same set of
 * functions `ensureModel` / `generate` / `converse` / `interrupt`:
 *
 *   - `webllm` — the model runs on the user's machine GPU, output forced by a
 *     grammar;
 *   - `openai` — Chat Completions called through the proxy in Vite, output
 *     forced by `tool_choice: 'required'` (`src/llm/openai.ts`).
 *
 * The branching lives here rather than in `runVoiceCommand` because the voice
 * loop is the only thing in the repo that understands the whole chain text →
 * tool call → state; stuffing an extra `if (provider)` in there would force it
 * to know about both. Here, what it sees is still a `generate` function
 * returning a `Generation`, same as before.
 *
 * The one thing it **must** know is a single fact: `providerOf(modelId)`, so
 * the tool catalog isn't put into the system prompt when the tools already go
 * via `tools[]` — see `src/prompt/system.ts`.
 *
 * The WebLLM part below hasn't changed a single line. It's still the default
 * path of the static build, and the eval suite still measures it.
 *
 * It differs from `src/eval/webllm-runner.ts` in exactly one point of shape:
 * the eval suite takes `onProgress` as a parameter because it builds a pool
 * per run, whereas the app has **one** engine for the whole page, so it's
 * module state with a single registrable progress listener. The four hard
 * constraints of `webllm-runner.ts` (seed on every request, `temperature: 0`
 * clamped to `1e-6`, `top_p` can't be 0, `await` `reload`) still hold exactly
 * and are kept here.
 *
 * **`temperature`/`seed` in the app deliberately differ from the eval.** The
 * eval suite needs reproducibility, so it pins the seed; the app has nothing to
 * reproduce, but also no reason to sample randomly — the same utterance must
 * produce the same command, otherwise the debug panel is no longer usable for
 * debugging. So: near-greedy, fixed seed.
 *
 * This file **does not import the store**. It's the lower layer;
 * `use-engine.ts` is where progress gets wired into `useSessionStore`.
 */

import type { InitProgressReport, WebWorkerMLCEngine } from '@mlc-ai/web-llm'

import { buildResponseFormat } from '@/domain/structural-tag'
import type { ToolDefinition } from '@/domain/tools'
import type { PromptMessage } from '@/prompt/retry'

import * as agent from './agent'
import * as openai from './openai'
import { isOpenAiModel, type OpenAiModelId } from './openai-models'

export type Provider = 'webllm' | 'openai'

/**
 * The provider of a `modelId`.
 *
 * Identified by **the list of OpenAI models**, not by name prefix: WebLLM IDs
 * (`Qwen3-0.6B-q4f16_1-MLC`) and OpenAI IDs (`gpt-4.1-mini`) share one field in
 * the store, and a rule like `startsWith('gpt')` would hold right up until the
 * day someone adds an MLC model whose name starts with `gpt`.
 */
export function providerOf(modelId: string): Provider {
  return isOpenAiModel(modelId) ? 'openai' : 'webllm'
}

/** Enough for one tool call; the grammar stops right after `</tool_call>`. */
const MAX_TOKENS = 256

/** `top_p` can't be 0 (`RangeError`) — see `webllm-runner.ts`. */
const NEAR_GREEDY_TOP_P = 1e-5

/** `0` is clamped by web-llm to `1e-6`: near-greedy, not argmax. */
const TEMPERATURE = 0

const SEED = 1

/**
 * Qwen3 enables thinking by default. For a head unit that's a shutdown: the
 * `<think>…</think>` string eats all of `MAX_TOKENS` before the model gets to
 * emit `<tool_call>` — the `triggered_tags` grammar only constrains what comes
 * **after** the trigger, so it can't block the reasoning part, and latency
 * multiplies several times over.
 *
 * `enable_thinking: false` makes web-llm pre-insert a `<think>\n\n</think>`
 * block at the start of the generation. Only send it to models that actually
 * have this mode: for non-thinking models, that block is junk mixed into the
 * debug panel's `raw`.
 *
 * **Match by list, not by `startsWith('Qwen3')`.** That prefix also hits
 * `Qwen3.5-*` — a different family, which slipped in beyond what whoever wrote
 * that line intended. Here `Qwen3.5` is still in the list because it inherits
 * `Qwen3`'s thinking mode, but now it's there because someone decided so.
 *
 * Not verifiable offline: the real template lives in the `mlc-chat-config.json`
 * downloaded with the weights, not in `prebuiltAppConfig`. The way to check is
 * to open the debug panel — a model without this mode will reveal an empty
 * `<think></think>` block right at the start of `raw`.
 */
const THINKING_MODEL_PREFIXES = ['Qwen3-', 'Qwen3.5-']

function thinkingBody(modelId: string | null) {
  const thinking = THINKING_MODEL_PREFIXES.some((prefix) =>
    modelId?.startsWith(prefix),
  )
  return thinking ? { extra_body: { enable_thinking: false } } : {}
}

/**
 * **Don't use WebLLM's default Cache API.** This is a measured result, not a
 * precaution: on the development machine, `cache.put()` with a response
 * downloaded from HuggingFace's CDN **always** fails with `NetworkError`,
 * while `fetch` of the same URL brings back the full 26.3 MB in 7 s, and
 * `cache.put(url, new Response(await r.arrayBuffer()))` works. I.e.
 * the CDN's streaming body can't be written straight into Cache storage — it
 * fails at the storage layer, not the network layer, so retrying fails
 * identically every time: the load dies at shard 2/30.
 *
 * `web-llm-chat` hit the same class of problem and lets users pick the backend
 * (`useIndexedDBCache` — the old name of this option). Here there's nothing to
 * pick: the Cache API simply can't load the model, so `indexeddb` is the only
 * backend that works, not an advanced option.
 *
 * Note for future maintainers: WebLLM itself states "the Cache API is the most
 * thoroughly tested backend". If HuggingFace changes its CDN and the Cache API
 * works again, measure first and only then switch back — don't switch because
 * you read that sentence.
 */
const CACHE_BACKEND = 'indexeddb' as const

let engine: WebWorkerMLCEngine | null = null
let loadedModelId: string | null = null
/**
 * The currently selected model, cloud models **included**. Kept separate from
 * `loadedModelId` because the two variables answer different questions:
 * `loadedModelId` is "which weights are sitting on the GPU" (only meaningful
 * for WebLLM), while this one is "where does the next generation get sent".
 * Merge them and the cloud path would write into a variable `thinkingBody`
 * reads.
 */
let activeModelId: string | null = null
/** Promise of the load in progress — two callers of `ensureModel` wait on the same load. */
let loading: Promise<void> | null = null

/**
 * The model the in-progress load belongs to. Progress has to carry this ID: a
 * WebLLM load can't be cancelled, so picking Qwen and then switching to GPT
 * leaves Qwen still downloading in the background and still reporting progress
 * — without the ID, the listener would take it for GPT's progress.
 */
let loadingModelId: string | null = null

type ProgressListener = (modelId: string, report: InitProgressReport) => void

let progressListener: ProgressListener | null = null

/** `use-engine.ts` plugs `useSessionStore` in here. Only one listener — the app has only one progress bar. */
export function onEngineProgress(listener: ProgressListener | null): void {
  progressListener = listener
}

export function loadedModel(): string | null {
  return loadedModelId
}

function spawnWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

/**
 * Loads `modelId` if it isn't loaded yet. Safe to call any number of times: if
 * it's already the right model it returns immediately, if a load is in
 * progress it waits on that same load.
 *
 * Throws on failure (no WebGPU, download error, OOM) — `use-engine.ts` catches
 * it and pours it into the status bar, because that's the only place that can
 * talk to the user.
 */
export async function ensureModel(modelId: string): Promise<void> {
  activeModelId = modelId

  // The cloud path has nothing to "load": one network round trip to ask
  // whether the proxy is alive, and done. Throws when the API key is missing
  // or there's no server — `use-engine` puts that message on the status bar,
  // and the user switches back to an on-device model.
  if (providerOf(modelId) === 'openai') {
    await openai.ensure()
    return
  }

  if (engine && loadedModelId === modelId) return
  if (loading) {
    await loading
    if (loadedModelId === modelId) return
  }

  loadingModelId = modelId
  loading = (async () => {
    try {
      if (!engine) {
        // `import()` rather than a static import: web-llm is 6 MB of JS, and
        // `Root.tsx` already chose not to make the head unit download it just
        // to draw the home screen. Here it downloads **in parallel** with the
        // UI appearing, and the user sees the progress bar from the very first
        // frame instead of staring at a blank screen until the bundle arrives.
        const { CreateWebWorkerMLCEngine, prebuiltAppConfig } =
          await import('@mlc-ai/web-llm')
        engine = await CreateWebWorkerMLCEngine(spawnWorker(), modelId, {
          // Read `loadingModelId` at report time rather than capturing `modelId`
          // in the closure: this callback lives as long as the engine, and later
          // `reload`s report through it too.
          initProgressCallback: (report) =>
            loadingModelId && progressListener?.(loadingModelId, report),
          appConfig: { ...prebuiltAppConfig, cacheBackend: CACHE_BACKEND },
        })
      } else {
        // `reload` calls `unload()` itself first, but `GPUDevice.destroy()` is
        // asynchronous — without `await` the two models overlap on the GPU.
        await engine.reload(modelId)
      }
      loadedModelId = modelId
    } catch (error) {
      // An engine that fails mid-way is considered dead: keeping it means the
      // next `reload()` runs on a lost device and the real error gets masked by
      // a second, meaningless one.
      engine = null
      loadedModelId = null
      throw error
    } finally {
      loading = null
      loadingModelId = null
    }
  })()

  await loading
}

export type Generation = {
  /** The model's verbatim output, before parsing. The debug panel shows exactly this string. */
  raw: string
  latencyMs: number
}

/**
 * One generation. Takes the whole `messages` array rather than a single
 * utterance, because the retry turn resends the entire conversation along
 * with the broken output (`buildRetryMessages`).
 */
export async function generate(
  messages: PromptMessage[],
  tools: ToolDefinition[],
): Promise<Generation> {
  if (activeModelId && providerOf(activeModelId) === 'openai') {
    return openai.generate(activeModelId as OpenAiModelId, messages, tools)
  }

  if (!engine) throw new Error('No model loaded')

  const startedAt = performance.now()
  const reply = await engine.chat.completions.create({
    stream: false,
    messages,
    response_format: buildResponseFormat(tools),
    temperature: TEMPERATURE,
    top_p: NEAR_GREEDY_TOP_P,
    max_tokens: MAX_TOKENS,
    // Once per request: the engine resets the seed to `Date.now()` after every call.
    seed: SEED,
    ...thinkingBody(loadedModelId),
  })

  return {
    // WebLLM does **not** parse the structural tag into `message.tool_calls`.
    raw: reply.choices[0]?.message?.content ?? '',
    latencyMs: performance.now() - startedAt,
  }
}

/** Enough for a sentence or two. Anything longer and the driver has run out of patience. */
const CHAT_MAX_TOKENS = 96

/**
 * Enough that asking the same thing twice doesn't give word-for-word the same
 * reply, not enough for the model to wander off. Not a measured number — tweak
 * it and you'll hear the difference.
 */
const CHAT_TEMPERATURE = 0.7
const CHAT_TOP_P = 0.9

/**
 * A **free-form** generation, for `answer_in_words`. See `src/prompt/chat.ts`
 * for why it has to be a separate generation rather than a parameter of
 * `generate`.
 *
 * It differs from `generate` in exactly three places, and all three are why it
 * exists:
 *
 * - **No `response_format`.** No grammar means no JSON string squeezing the
 *   prose, and the model isn't forced to look at the tool catalog.
 * - **Has temperature.** `generate` runs near-greedy so the same command gives
 *   the same tool call — right for control, but for small talk that's a parrot.
 * - **No pinned `seed`.** web-llm resets the seed to `Date.now()` after every
 *   request, so leaving it out is enough for every generation to differ.
 */
export async function converse(messages: PromptMessage[]): Promise<Generation> {
  if (activeModelId && providerOf(activeModelId) === 'openai') {
    return openai.converse(activeModelId as OpenAiModelId, messages)
  }

  if (!engine) throw new Error('No model loaded')

  const startedAt = performance.now()
  const reply = await engine.chat.completions.create({
    stream: false,
    messages,
    temperature: CHAT_TEMPERATURE,
    top_p: CHAT_TOP_P,
    max_tokens: CHAT_MAX_TOKENS,
    ...thinkingBody(loadedModelId),
  })

  return {
    raw: reply.choices[0]?.message?.content ?? '',
    latencyMs: performance.now() - startedAt,
  }
}

/**
 * Interrupts the generation in progress (the later command beats the earlier
 * one). The pending `create()` returns early with what has been generated so
 * far; the caller discards that result using its turn token, without reading
 * it.
 *
 * The cloud path **throws** `AbortError` instead of returning early. That
 * difference doesn't leak out: `runVoiceCommand` checks `stale()` both after
 * every `await` and in `catch`, so the two behaviours stop at the same place.
 * Call both unconditionally — for a provider that isn't running, its call is a
 * no-op.
 */
/**
 * A turn just failed: drop the remembered proxy check, so the next
 * `ensureModel` reports the right reason (missing API key, dead proxy) instead
 * of heading straight into another failing chat turn.
 */
export function forgetModelCheck(): void {
  openai.forgetEnsure()
}

export function interrupt(): void {
  engine?.interruptGenerate()
  openai.interrupt()
  agent.interrupt()
}
