/**
 * The interface of the thing that runs one utterance.
 *
 * **WebGPU, WebLLM, workers and models must not be mentioned in this file.**
 * That is the whole reason it exists: a cloud baseline has to plug into the
 * eval suite as just another configuration, not by editing the runner. The
 * WebLLM implementation lives in `webllm-runner.ts`; the day there's a cloud
 * one, add `cloud-runner.ts` next to it.
 *
 * `runOne` returns **the raw output too**, not just the tool call. Not
 * redundant: the exported JSON must include each case's raw output, so
 * failures can be debugged without rerunning five minutes. The raw output is
 * the one thing only the runner gets to see.
 */

export type ToolCall = {
  name: string
  arguments: Record<string, unknown>
}

export type RunOutput = {
  /** `null` when no tool call could be extracted from the output. */
  call: ToolCall | null
  /** The model's verbatim output, before parsing. */
  raw: string
  /** ms, measured around exactly one generation. */
  latencyMs: number
}

export type Runner = {
  runOne: (text: string) => Promise<RunOutput>
}

/**
 * One row of the table. `configId` is the stable key — exported result files
 * and every error report refer to it.
 */
export type EvalConfig = {
  id: string
  modelId: string
  toolSetId: string
  promptVariantId: string
}
