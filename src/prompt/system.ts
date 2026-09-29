/**
 * Builds the system prompt.
 *
 * Three things are deliberately **not** included here, each for a
 * different reason:
 *
 * 1. **No few-shot.** Measured: few-shot with refusal examples dropped
 *    12/15 → 5/15, Qwen imitated the refusal examples and turned 11/15
 *    utterances into small talk. What few people notice is that
 *    `at_least_one: true` plus `answer_in_words` has **wiped out** the notion
 *    of "not calling a tool" — so few-shot with only positive examples is an
 *    entirely different hypothesis that nobody has measured. It is an open,
 *    unmeasured question, not something settled here.
 * 2. **No stuffing in `CarState`.** Qualitative tools were chosen precisely to
 *    avoid needing it: "nóng quá" ("so hot") yields the same tool call
 *    whether it's 29 or 26 degrees. The only case that sounds like it needs
 *    state — "giảm xuống dưới 25" ("bring it below 25") — is actually
 *    `set_temperature(24)`; the model doesn't need to know the current
 *    temperature.
 * 3. **No description of the `<tool_call>` syntax.** The grammar already
 *    enforces it. The few-shot prompt measured above also spent three lines
 *    teaching the format and bought nothing.
 *
 * The prompt is written in **English** with Vietnamese user utterances: it
 * measured 14/15 and Qwen never once answered in English, so the
 * worry that "a Vietnamese prompt helps the model stay in the right language"
 * has no basis to become a variant.
 */

import { TOOLS, type ToolDefinition } from '../domain/tools'
import type { PromptMessage } from './retry'
import { P0, type PromptVariant } from './variants'

/**
 * The tool catalog for the prompt. This is the only copy — the old
 * `toolCatalogForPrompt` in `src/domain/structural-tag.ts` was removed,
 * because two catalog builders drift apart sooner or later and the eval
 * table would measure the wrong thing.
 *
 * `parameters` only appears in `desc+schema` mode (variant `P1`). In `desc`
 * mode, `description` is the **only** channel through which the model knows
 * which parameters exist — which is why every description in
 * `src/domain/tools.ts` lists its own parameter names.
 */
export function renderToolCatalog(
  variant: PromptVariant,
  tools: ToolDefinition[] = TOOLS,
): string {
  return JSON.stringify(
    tools.map((tool) => {
      // A prompt variant's description overrides are `Partial`: the variant
      // only declares the tools it wants to reword, the rest fall back to
      // `tool.description`.
      const description =
        variant.descriptionOverrides[tool.name] ?? tool.description
      return variant.catalog === 'desc+schema'
        ? { name: tool.name, description, parameters: tool.schema }
        : { name: tool.name, description }
    }),
    null,
    2,
  )
}

/**
 * Intent hints — shared by the single-turn prompt here and the agent loop's
 * prompt (`src/prompt/agent.ts`), because what they say is about *the
 * driver's intent*, not about how the model must answer.
 */
export const INTENT_HINTS = [
  // The original two intent hints, from the prompt that measured 14/15. These
  // two sentences alone were enough to route implied requests to the right
  // tool. Don't add a fourth without measuring.
  'Complaints about feeling hot or cold map to adjust_temperature.',
  'Asking to open or show a screen maps to navigate_to.',
  // The third sentence, added because **there are numbers**: running for real
  // on Qwen3-0.6B, "Mấy giờ rồi" ("what time is it") still went to
  // `answer_in_words` even though `tell_time` was in the catalog with that
  // exact example. The tool description alone couldn't pull it — the other
  // two tools have their own hints, `tell_time` didn't, and it lost to the
  // very tool that `PREAMBLE` names.
  'Asking what time it is or what the date is maps to tell_time.',
]

/**
 * The frame of the two-intent-hint prompt that measured 14/15, with exactly
 * one sentence changed.
 *
 * The original said *"If the request matches no real tool, call
 * `unsupported`"* — framing the escape-hatch tool as an admission of defeat,
 * the very framing the tool was renamed to `answer_in_words` to avoid. The
 * sentence here is phrased as an action, so it competes on equal footing with
 * `navigate_to` instead of being the last refuge.
 *
 * The "exactly one tool call and nothing else" sentence is already enforced
 * by the grammar via `at_least_one` + `stop_after_first`, but we keep it
 * because it costs nothing and it matches the prompt that measured 14/15.
 */
const PREAMBLE = [
  'You are the voice assistant of a car head unit. The user speaks Vietnamese.',
  'Always answer with exactly one tool call and nothing else.',
  // This sentence must list everything the car **can do**, or it's lying.
  // `tell_time` was added later, so "the clock" has to be here — this fixes a
  // sentence that had become wrong, it's not a new variable to test. The
  // seven body tools (windows, doors, mirrors, sunroof, trunks, turn signal,
  // wipers) came later still, and for the same reason "the body of the car"
  // has to be here too. Same for the two music tools: without "music", this
  // sentence tells the model to push "bật nhạc" ("play music") to
  // `answer_in_words`.
  'If the request is not about climate, the body of the car, screens, music or the clock, ' +
    'call `answer_in_words` to reply in words.',
  ...INTENT_HINTS,
].join(' ')

/**
 * `catalog: false` for the cloud path — and this is a decision, not a
 * convenience flag.
 *
 * With WebLLM, the catalog in the prompt is the **only channel** through which
 * the model knows which tools exist: the grammar only enforces syntax, it
 * describes nothing. With OpenAI function calling, `tools[]` already carries
 * `name`, `description` and `parameters` — also stuffing the catalog into the
 * prompt sends the same table twice, and that isn't "redundant to be safe":
 * it's two descriptions that can diverge within the same context, exactly
 * the kind of contradiction that forces the model to pick a side.
 *
 * The rest — `PREAMBLE` — is still sent, because it doesn't describe tools
 * but **hints at intent** ("hot/cold → adjust_temperature"), and that's
 * something `tools[]` has nowhere to hold.
 */
/**
 * The number of previous conversation turns fed into WebLLM's **tool
 * selection** turn, so that "tắt nó đi" ("turn it off") or "to hơn nữa"
 * ("turn it up more") has something to latch onto.
 *
 * Far fewer than the reply-writing turn's `CHAT_HISTORY_TURNS` (6), because
 * the risk here is different: a 0.6B model that sees "bật điều hoà" ("turn on
 * the A/C") just before will readily call that same command again for an
 * unrelated utterance. Two turns are enough for pronouns, and this is an
 * **unmeasured** variable — `run-eval.ts` still runs without history, so the
 * eval table's numbers don't change. To change this number, add multi-turn
 * conversation cases to the eval first.
 */
export const TOOL_HISTORY_TURNS = 2

/**
 * The tool selection turn: system prompt, a few previous turns, then the
 * current utterance.
 *
 * Previous turns carry only two strings (what the driver said, what the car
 * replied) — old tool calls aren't rebuilt, because the grammar only
 * constrains *this* turn's output, and an old `<tool_call>` sitting in context
 * is just one more thing for the model to copy.
 */
export function buildToolMessages(
  system: string,
  input: string,
  history: ReadonlyArray<HistoryTurn> = [],
): PromptMessage[] {
  return [
    { role: 'system', content: system },
    ...historyMessages(history, TOOL_HISTORY_TURNS),
    { role: 'user', content: input },
  ]
}

/** A past turn, just the part the prompt needs — `ConversationTurn` satisfies this type. */
export type HistoryTurn = {
  user: string
  assistant: string
  /** Sentences describing what the car **already did** in that turn. */
  actions?: readonly string[]
  interrupted?: boolean
}

/**
 * Conversation history → `user`/`assistant` pairs, keeping the last `turns`
 * turns. Shared by the tool selection turn, the reply-writing turn and the
 * agent loop.
 *
 * A barged-in turn keeps only the part the driver heard — sometimes an empty
 * string, because the cut came while audio was still loading. The car,
 * however, already finished acting. If the model only sees the heard part,
 * "thêm 2 độ nữa" ("2 more degrees") on the next turn gets read as if the
 * previous turn never raised it, so what was done is appended to the reply.
 */
export function historyMessages(
  history: ReadonlyArray<HistoryTurn>,
  turns: number,
): Array<PromptMessage & { role: 'user' | 'assistant' }> {
  return history.slice(-turns).flatMap((turn) => {
    const done =
      turn.interrupted && turn.actions?.length
        ? `[interrupted; the car already did: ${turn.actions.join('; ')}]`
        : ''
    const content = [turn.assistant, done].filter(Boolean).join(' ')
    // Nothing left = barged in before the car could speak, and that turn didn't touch the car.
    return content
      ? [
          { role: 'user' as const, content: turn.user },
          { role: 'assistant' as const, content },
        ]
      : [{ role: 'user' as const, content: turn.user }]
  })
}

export function buildSystemPrompt(
  variant: PromptVariant = P0,
  tools: ToolDefinition[] = TOOLS,
  { catalog = true }: { catalog?: boolean } = {},
): string {
  if (!catalog) return PREAMBLE
  return `${PREAMBLE} Available tools: ${renderToolCatalog(variant, tools)}`
}
