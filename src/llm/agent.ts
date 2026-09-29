/**
 * The cloud path's agent loop — the AI SDK's `ToolLoopAgent`, running **in the
 * browser**.
 *
 * ## Why in the browser and not on the server
 *
 * The loop can only loop when tools have `execute`: the AI SDK runs the tool,
 * hands the result back to the model, and the model decides the next step. And
 * `CarState`, `dispatch` and the music player all live here — the server
 * doesn't hold any car. So the loop runs where the car is, while the model
 * goes through the `/api/llm/chat` proxy as before: the API key stays in Node,
 * the browser only changes the URL.
 *
 * ## Why only the cloud path
 *
 * The on-device model is forced by the grammar into exactly one `<tool_call>`
 * per turn, and each generation costs a full second on the user's machine GPU.
 * That path keeps the single-turn loop in `runVoiceCommand`.
 *
 * This file **does not import the store**, same rule as `engine.ts`: running
 * tools is the caller's job, passed in via `execute`.
 */

import { createOpenAI } from '@ai-sdk/openai'
import {
  isStepCount,
  jsonSchema,
  tool,
  ToolLoopAgent,
  type StopCondition,
  type Tool,
} from 'ai'

import { TOOLS, type ToolName } from '@/domain/tools'
import { AGENT_INSTRUCTIONS, buildAgentMessages } from '@/prompt/agent'
import type { HistoryTurn } from '@/prompt/system'

import type { OpenAiModelId } from './openai-models'
import { buildWebTools, isWebTool, type WebLookupListener } from './web-tools'

const CHAT_URL = '/api/llm/chat'

/**
 * Cap on model calls per utterance. A normal command, compound ones included,
 * takes 1 (`toolsSucceeded`); a state question or a failing tool takes 2–3; a
 * web lookup (search → read page → speak) takes 3. Beyond 5 the model is
 * wandering, and the driver has waited too long.
 */
const MAX_STEPS = 5

/**
 * Equal to the proxy's cap (`MAX_OUTPUT_TOKENS`). A compound command calls 3–4
 * tools in parallel in one turn, each call 30–60 tokens plus an ID — 256 could
 * cut the JSON off mid-way, and when a turn ends with `length` the AI SDK runs
 * no tools at all: the whole command is lost, not half of it. You pay per
 * generated token, not per cap, so raising it costs nothing.
 */
const MAX_TOKENS = 512

/** `0` for the same reason as `openai.ts`: the same utterance gives the same command. */
const TEMPERATURE = 0

/**
 * `answer_in_words` is the escape hatch of the single-turn loop — where the
 * model is *forced* to call a tool. In the agent loop the model is allowed to
 * answer directly in text, so that tool would just be a way to spend an extra
 * turn saying something.
 */
const AGENT_TOOLS = TOOLS.filter((t) => t.name !== 'answer_in_words')

/**
 * The result a control tool returns to the loop. `say` is the sentence from
 * `describeResult` — the model reads it when another turn is needed, the
 * driver hears it when the loop stops early (`toolsSucceeded`).
 */
export type ToolOutcome = { ok: boolean; say: string }

export type AgentExecute = (
  name: ToolName,
  input: unknown,
) => Promise<ToolOutcome>

/**
 * Announces a tool call in advance. The AI SDK calls this for **every** tool
 * call of a step before running any tool — so the caller knows the whole
 * compound command, regardless of the order the model lists them in.
 */
export type AgentToolInput = (name: ToolName, input: unknown) => void

/**
 * A snapshot of the car's state, already as a string — the caller reads the
 * store, this file doesn't.
 *
 * Called **once** at the start of the turn and sent along with the utterance,
 * replacing the old `get_car_state` tool: that tool made every question about
 * the car cost two model calls (call the tool, then answer) — measured at ~1s
 * extra for "mấy độ rồi" ("what's the temperature now"). The ~500 tokens of
 * state sit after the cached part of the prompt, so they add almost no latency.
 */
export type AgentReadState = () => string

export type AgentTurn = {
  /**
   * The text the model wrote itself. Empty when the loop stops right after a
   * tool (`toolsSucceeded`) or hits `MAX_STEPS` mid-way.
   */
  text: string
  /** The `say` sentences of the control tools in the last step, in the order the model called them. */
  toolSays: string[]
  /** Latency of each model call, in order — for the debug panel. */
  modelCallsMs: number[]
}

/**
 * Stop as soon as **every** tool of the last step is a control tool and ran
 * successfully — LangChain's `return_direct` rule: once the outcome is certain,
 * `describeResult`'s template sentence is the answer, no model turn needed to
 * rewrite it. That way a normal command costs just one model call.
 *
 * Keep going when:
 * - a tool failed (bad arguments, music search found nothing) — the model reads
 *   the error to fix it or explain. "Every", not "any": if part of a compound
 *   command failed, the model has to see the whole turn;
 * - a tool threw — it's missing from `toolResults`, so comparing lengths
 *   catches it;
 * - there's a web lookup tool — its result is material for the model to read,
 *   not a sentence for the driver to hear.
 */
const toolsSucceeded: StopCondition<Record<string, Tool>> = ({ steps }) => {
  const last = steps.at(-1)
  if (!last || last.toolCalls.length === 0) return false
  return (
    last.toolResults.length === last.toolCalls.length &&
    last.toolResults.every(
      (r) => !isWebTool(r.toolName) && (r.output as ToolOutcome).ok === true,
    )
  )
}

let inflight: AbortController | null = null

export function interrupt(): void {
  inflight?.abort()
  inflight = null
}

function buildTools(
  execute: AgentExecute,
  onToolInput?: AgentToolInput,
  onWebLookup?: WebLookupListener,
): Record<string, Tool> {
  return {
    ...buildCarTools(execute, onToolInput),
    ...buildWebTools(onWebLookup),
  }
}

function buildCarTools(
  execute: AgentExecute,
  onToolInput?: AgentToolInput,
): Record<string, Tool> {
  return Object.fromEntries(
    AGENT_TOOLS.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        // Hand-written schema going out, Zod checking on the way back — same
        // rule as `server/lib/car-tools.ts`.
        inputSchema: jsonSchema(
          definition.schema as unknown as Parameters<typeof jsonSchema>[0],
        ),
        onInputAvailable: ({ input }) => onToolInput?.(definition.name, input),
        execute: (input) => execute(definition.name, input),
      }),
    ]),
  )
}

export async function runAgent({
  modelId,
  input,
  history,
  execute,
  readState,
  onToolInput,
  onWebLookup,
}: {
  modelId: OpenAiModelId
  input: string
  history: ReadonlyArray<HistoryTurn>
  execute: AgentExecute
  readState: AgentReadState
  onToolInput?: AgentToolInput
  onWebLookup?: WebLookupListener
}): Promise<AgentTurn> {
  inflight?.abort()
  const controller = new AbortController()
  inflight = controller

  const modelCallsMs: number[] = []
  const provider = createOpenAI({
    // The proxy doesn't read this header — the real API key lives on the
    // server. The SDK just requires it to be non-empty.
    apiKey: 'proxy',
    baseURL: `${location.origin}/api/llm`,
    // The SDK calls `<baseURL>/chat/completions`; the proxy listens at
    // `/api/llm/chat`.
    fetch: async (_url, init) => {
      const startedAt = performance.now()
      try {
        return await fetch(CHAT_URL, init)
      } finally {
        modelCallsMs.push(performance.now() - startedAt)
      }
    },
  })

  const agent = new ToolLoopAgent({
    model: provider.chat(modelId),
    instructions: AGENT_INSTRUCTIONS,
    tools: buildTools(execute, onToolInput, onWebLookup),
    stopWhen: [toolsSucceeded, isStepCount(MAX_STEPS)],
    temperature: TEMPERATURE,
    maxOutputTokens: MAX_TOKENS,
    // A network retry here doubles an utterance's latency; if it fails,
    // report it right away.
    maxRetries: 0,
    // Compound commands call all their tools in one turn. The proxy forces
    // `false` by default for the eval.
    providerOptions: { openai: { parallelToolCalls: true } },
  })

  try {
    const result = await agent.generate({
      messages: buildAgentMessages(input, history, readState()),
      abortSignal: controller.signal,
    })
    const last = result.steps.at(-1)
    return {
      text: result.text,
      toolSays: (last?.toolResults ?? [])
        .filter((r) => !isWebTool(r.toolName))
        .map((r) => (r.output as ToolOutcome).say),
      modelCallsMs,
    }
  } finally {
    if (inflight === controller) inflight = null
  }
}
