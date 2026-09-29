/**
 * The run loop: takes a **list of configurations**, runs them sequentially, and
 * returns one table row per configuration.
 *
 * Sequential, not parallel, and this isn't an optimisation for later: two
 * models on the GPU at once is a straight road to `DeviceLostError`. For the
 * same reason, `p50 latency` only means something when only one thing is
 * generating tokens at a time.
 */

import { P0, PROMPT_VARIANTS } from '../prompt/variants'
import { buildSystemPrompt } from '../prompt/system'
import { MODEL_OPTIONS } from '../store/session-store'
import { CASES } from './cases'
import type { EvalConfig } from './runner'
import { scoreCase, summarise, type Outcome, type Summary } from './score'
import { FULL_TOOL_SET, TOOL_SETS } from './tool-sets'
import { createEnginePool, describeGpu } from './webllm-runner'

/**
 * Fixed seed. The date the case set was settled — no
 * mathematical meaning, it just needs to **not change** between runs.
 */
export const SEED_BASE = 20260910

/**
 * `repeats` mode changes the seed per pass. Sounds contrary to "fixed seed" but
 * it's right: `temperature: 0.7` + the **same** seed produces three identical
 * passes, i.e. measures a spread of exactly 0. Pass `k` uses `SEED_BASE + k`.
 */
const seedForPass = (passIndex: number) => SEED_BASE + passIndex

const MODEL_LABEL = Object.fromEntries(
  MODEL_OPTIONS.map((option) => [option.id, option.label]),
) as Record<string, string>

export function describeConfig(config: EvalConfig): string {
  const toolSet = TOOL_SETS.find((set) => set.id === config.toolSetId)
  return [
    MODEL_LABEL[config.modelId] ?? config.modelId,
    toolSet?.label ?? config.toolSetId,
    config.promptVariantId,
  ].join(' · ')
}

/* ---------------------------------------------------------------------- */
/* Configuration catalog                                                  */
/* ---------------------------------------------------------------------- */

const QWEN3_06B = 'Qwen3-0.6B-q4f16_1-MLC'
const QWEN35_08B = 'Qwen3.5-0.8B-q4f16_1-MLC'
const QWEN_1_5B = 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC'
const LLAMA_1B = 'Llama-3.2-1B-Instruct-q4f32_1-MLC'
const QWEN_3B = 'Qwen2.5-3B-Instruct-q4f32_1-MLC'
const QWEN35_4B = 'Qwen3.5-4B-q4f16_1-MLC'

/**
 * Each row changes **exactly one** thing relative to the first row; the rest are
 * the escalation steps for when a row misses the thresholds, pre-built so
 * escalating needs no new code.
 *
 * Escalation originally went in three steps: `prompt` → `tool set` → a
 * bigger model. The `tool set` step **has been withdrawn**, because the
 * merged-toggle set — the only second point on that axis — was removed (reason
 * in `tool-sets.ts`). Two steps remain, and the `tool set` axis now sits still
 * at the standard set.
 *
 * `defaultOn` is **the `prompt` axis** — `P0`/`P1`/`P2` on the same model and
 * the same standard tool set, so comparing them changes only one dimension.
 */
export const CONFIG_CATALOG: Array<EvalConfig & { defaultOn: boolean }> = [
  {
    // The app's new default model. On by default because every old number was
    // measured on Qwen2.5-1.5B: switch models without rerunning this row and
    // the results table is describing a head unit that no longer exists.
    id: 'qwen3-06b-full-P0',
    modelId: QWEN3_06B,
    toolSetId: FULL_TOOL_SET.id,
    promptVariantId: P0.id,
    defaultOn: true,
  },
  {
    // Escalation step if 0.6B misses the threshold: same tool set, same prompt,
    // only the model changes. Off by default — only download these 1.6 GB when
    // the row above says it's needed.
    id: 'qwen35-08b-full-P0',
    modelId: QWEN35_08B,
    toolSetId: FULL_TOOL_SET.id,
    promptVariantId: P0.id,
    defaultOn: false,
  },
  {
    id: 'qwen15-full-P0',
    modelId: QWEN_1_5B,
    toolSetId: FULL_TOOL_SET.id,
    promptVariantId: P0.id,
    defaultOn: true,
  },
  {
    id: 'llama1b-full-P0',
    modelId: LLAMA_1B,
    toolSetId: FULL_TOOL_SET.id,
    promptVariantId: P0.id,
    defaultOn: false,
  },
  {
    id: 'qwen15-full-P1',
    modelId: QWEN_1_5B,
    toolSetId: FULL_TOOL_SET.id,
    promptVariantId: 'P1',
    defaultOn: true,
  },
  {
    id: 'qwen15-full-P2',
    modelId: QWEN_1_5B,
    toolSetId: FULL_TOOL_SET.id,
    promptVariantId: 'P2',
    defaultOn: true,
  },
  {
    id: 'qwen3b-full-P0',
    modelId: QWEN_3B,
    toolSetId: FULL_TOOL_SET.id,
    promptVariantId: P0.id,
    defaultOn: false,
  },
  {
    // The top step. `defaultOn: false` like every escalation step, and here
    // it's mandatory: 3.9 GB is not something to enable by default for a run
    // where people only meant to look at the prompt axis.
    //
    // A caveat when reading this row's results: the table scores **tool names
    // and arguments**, and that's not why this model is here. It's here for
    // the chit-chat — something `score.ts` doesn't and can't score. Whether
    // this row wins or loses, it can't answer the question that brought it in;
    // to find out, you have to listen.
    id: 'qwen35-4b-full-P0',
    modelId: QWEN35_4B,
    toolSetId: FULL_TOOL_SET.id,
    promptVariantId: P0.id,
    defaultOn: false,
  },
]

/* ---------------------------------------------------------------------- */
/* Results                                                                */
/* ---------------------------------------------------------------------- */

export type Pass = {
  seed: number
  temperature: number
  outcomes: Outcome[]
  summary: Summary
}

export type ConfigRun = {
  config: EvalConfig
  label: string
  /**
   * What the model was actually asked: the built system prompt, so the JSON
   * proves what it measured.
   */
  systemPrompt: string
  passes: Pass[]
  /** The run died mid-way (device lost, model failed to load…). */
  error?: string
}

export type EvalRun = {
  startedAt: string
  gpu: string
  userAgent: string
  /** Written straight into the file so reading it later needs no other document. */
  notes: string[]
  configs: ConfigRun[]
}

export type Progress = {
  configIndex: number
  configTotal: number
  configLabel: string
  phase: 'loading model' | 'running' | 'done'
  detail: string
  caseIndex: number
  caseTotal: number
  passIndex: number
  passTotal: number
}

export type RunOptions = {
  configs: EvalConfig[]
  /** 1 pass at `temperature: 0` (default), or 3 passes at `0.7`. */
  repeats: number
  temperature: number
  onProgress: (progress: Progress) => void
  isCancelled: () => boolean
}

const NOTES = [
  '`temperature: 0` is clamped by web-llm to 1e-6 → NEAR-greedy, not argmax.',
  'seed is passed on every request; the seed only reproduces on the same machine — there is no guarantee of WebGPU kernel bit-exactness across GPUs.',
  'L1%/L2% are computed over the case set MINUS the 4 `multi-action` cases; `l1PctAll` is the same number over the whole set.',
  'This table is NOT comparable with runs before `tell_time`: the tool set changed (11 → 12), the catalog in the prompt changed with it, and the case set became 53 (`o01` moved to a new group, `g02`/`g03`/`o09` added).',
  'Pass thresholds, settled before running: L1 ≥ 90%, L2 ≥ 80%, FP ≤ 1, flip = 0. If it fails, escalate; do not lower the thresholds.',
]

export async function runEval(options: RunOptions): Promise<EvalRun> {
  const { configs, repeats, temperature, onProgress, isCancelled } = options

  const run: EvalRun = {
    startedAt: new Date().toISOString(),
    gpu: await describeGpu(),
    userAgent: navigator.userAgent,
    notes: NOTES,
    configs: [],
  }

  /**
   * Downloading weights is the **longest** phase of the run — several minutes
   * the first time for each model — so its progress has to flow straight to
   * the UI. Catching it here and then printing it only once at the start would
   * leave people staring at a frozen line of text, guessing whether the app has
   * hung or is still downloading.
   */
  let emitLoading: (text: string) => void = () => {}
  const pool = createEnginePool((report) => emitLoading(report.text))

  try {
    for (const [configIndex, config] of configs.entries()) {
      const label = describeConfig(config)
      const toolSet =
        TOOL_SETS.find((set) => set.id === config.toolSetId) ?? FULL_TOOL_SET
      const variant =
        PROMPT_VARIANTS.find((item) => item.id === config.promptVariantId) ?? P0
      const systemPrompt = buildSystemPrompt(variant, toolSet.tools)

      const configRun: ConfigRun = { config, label, systemPrompt, passes: [] }
      run.configs.push(configRun)

      const report = (
        phase: Progress['phase'],
        caseIndex: number,
        passIndex: number,
        detail = '',
      ) =>
        onProgress({
          configIndex,
          configTotal: configs.length,
          configLabel: label,
          phase,
          detail,
          caseIndex,
          caseTotal: CASES.length,
          passIndex,
          passTotal: repeats,
        })

      try {
        emitLoading = (text) => report('loading model', 0, 0, text)
        report('loading model', 0, 0, 'opening engine…')
        await pool.ensureModel(config.modelId)
        emitLoading = () => {}

        for (let passIndex = 0; passIndex < repeats; passIndex += 1) {
          const seed = seedForPass(passIndex)
          const runner = pool.runnerFor({
            systemPrompt,
            tools: toolSet.tools,
            temperature,
            seed,
          })

          const outcomes: Outcome[] = []
          const startedAt = performance.now()

          for (const [caseIndex, testCase] of CASES.entries()) {
            if (isCancelled()) throw new Error('user stopped the run')
            report('running', caseIndex, passIndex, testCase.vi)

            const output = await runner.runOne(testCase.vi)
            outcomes.push(scoreCase(testCase, output))
          }

          configRun.passes.push({
            seed,
            temperature,
            outcomes,
            summary: summarise(outcomes, performance.now() - startedAt),
          })
        }
      } catch (error) {
        configRun.error = error instanceof Error ? error.message : String(error)
        // Device lost kills the whole engine, not just this configuration.
        // Rebuild and move on: losing one table row beats losing a whole
        // five-minute run.
        await pool.reset()
        if (isCancelled()) break
      }

      report('done', CASES.length, repeats - 1)
    }
  } finally {
    await pool.dispose()
  }

  return run
}

/** Suggested filename for the downloaded results JSON. */
export function suggestFilename(run: EvalRun): string {
  return `eval-${run.startedAt.replace(/[:.]/g, '-')}.json`
}
