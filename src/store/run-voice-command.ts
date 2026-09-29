/**
 * The voice loop, from a transcript string to `CarState`:
 *
 *   text → system prompt → generate (Web Worker) → parseToolCalls → Zod
 *        → (invalid: retry exactly once) → dispatch → runCommand → UI + debug panel
 *
 * There is exactly one fork: `answer_in_words` inserts an extra **free-form**
 * generation pass (`converse`) to write the reply, before going into
 * `dispatch`. The long reason is in `src/prompt/chat.ts`; the short one is that
 * the tool-calling pass runs at `temperature: 0` under a grammar, and that
 * configuration produces a parrot, not a sentence.
 *
 * It takes **text** in, not audio: speech recognition stops at
 * `useCallSession`, and the debug panel's text box enters this very function
 * with `source: 'text'`. That way, tweaking the prompt or the retry never
 * requires turning the mic on to test.
 *
 * It exits through `runCommand`, even on failure: the "single door" rule
 * (`run-command.ts`) only holds if the voice path goes through it too. So the
 * "didn't
 * understand" case is also a `ToolResult` (`kind: 'rejected'`) passing
 * through the same door, not a separate branch writing its own text to the
 * status bar.
 *
 * The function returns the **reply** (`describeResult`) rather than `void`:
 * conversation mode needs that exact string to read aloud, and needs to know
 * whether the turn got through or was cut off by a later command (`null`).
 * This is *the same string* the status bar shows — what the ear hears and the
 * eye reads never disagree, and that's why it is taken from here instead of
 * generating a separate sentence for the TTS voice.
 *
 * ## Queueing and cancelling: **the later command wins**
 *
 * No queueing. Saying something new while the model is running makes
 * `interrupt()` cut the old turn, and the new utterance runs immediately.
 * Reason: in a car, the latest utterance is always the right one — queueing
 * means the car would do something the user changed their mind about two
 * seconds ago.
 *
 * Cancellation here is a **turn token** (`generation`), not an
 * `AbortController`: `interruptGenerate()` makes the pending `create()` return
 * early with whatever was generated so far instead of throwing, so the only
 * place that can block the stale result is the caller. Every `await` in this
 * function must check `stale()` right after it resumes.
 */

import { snapshotCar } from '@/domain/car-snapshot'
import { dispatch } from '@/domain/dispatch'
import { renderToolCall } from '@/domain/openai-tools'
import { describeResult } from '@/domain/say'
import { parseToolCalls } from '@/domain/structural-tag'
import { validateToolCall, type ValidationResult } from '@/domain/tool-args'
import type { ToolResult } from '@/domain/tool-result'
import { TOOLS, type ToolName } from '@/domain/tools'
import { runAgent, type ToolOutcome } from '@/llm/agent'
import {
  converse,
  ensureModel,
  forgetModelCheck,
  generate,
  interrupt,
  providerOf,
} from '@/llm/engine'
import { buildChatMessages, cleanChatReply } from '@/prompt/chat'
import { buildRetryMessages } from '@/prompt/retry'
import type { OpenAiModelId } from '@/llm/openai-models'
import type { WebToolName } from '@/llm/web-tools'
import {
  buildSystemPrompt,
  buildToolMessages,
  type HistoryTurn,
} from '@/prompt/system'
import { P0 } from '@/prompt/variants'

import { useCarStore } from './car-store'
import { useConversationStore } from './conversation-store'
import { useMusicStore } from './music-store'
import { runCommand, runCommandAsync } from './run-command'
import { useSessionStore, type CommandSource } from './session-store'

/**
 * The app's prompt variant. `P0` because the variants haven't been compared on
 * eval numbers yet — this is a **default awaiting numbers**, not a choice.
 * Once the eval picks a winner, change exactly this line.
 */
const ACTIVE_VARIANT = P0

/**
 * Turns older than this no longer serve as context for the model — they stay
 * in the history for review, the model just doesn't see them anymore.
 *
 * The car can now ask back ("Mở cửa nào ạ?", "Which door?"), and the next turn
 * is read as the answer. Without a limit, "cửa lái" ("driver's door") said
 * twenty minutes later would still open a door, and "tắt nó đi" ("turn it
 * off") would latch onto an "it" from the start of the trip. Five minutes is
 * long enough for a Q&A interrupted by having to watch the road, and short
 * enough that a new utterance is a new utterance.
 */
const CONTEXT_TTL_MS = 5 * 60_000

/** Bumped per command. A turn that's no longer the latest has its result dropped. */
let generation = 0

/**
 * The running turn, along with the sentences of tools that **have touched the
 * car** in that turn.
 *
 * On the cloud path, tools run mid-loop: step 1 has already changed the car,
 * and only at step 2 does the model write the reply. If the turn is cut off at
 * step 2, what was done can't be undone, so it has to go into the history —
 * otherwise the next turn won't know "ấm hơn chút" ("a bit warmer") already
 * raised it, and the resent utterance would raise it once more.
 */
let inflight: {
  generation: number
  source: Extract<CommandSource, 'voice' | 'text'>
  input: string
  says: string[]
} | null = null

/**
 * Abandon the running turn: log what it did into the history (marked
 * `interrupted`). Returns `true` if that turn touched the car — in that case
 * the caller must **not** resend the old utterance.
 */
function abandonInflight(): boolean {
  const turn = inflight
  inflight = null
  if (!turn || turn.says.length === 0) return false
  useConversationStore.getState().pushTurn({
    source: turn.source,
    user: turn.input,
    assistant: joinSays(turn.says) ?? '',
    actions: turn.says,
    failed: false,
    interrupted: true,
  })
  return true
}

const round = (ms: number) => Math.round(ms)

function firstToolCall(raw: string): ValidationResult {
  const calls = parseToolCalls(raw)
  const first = calls[0]
  if (!first) {
    // The grammar (`at_least_one: true`) should have blocked this case, so
    // getting here almost always means a turn cut off midway by `interrupt()`
    // — or a runner without a grammar (the cloud baseline).
    return { ok: false, problem: 'no <tool_call> block in the output' }
  }
  return validateToolCall(first.name, first.arguments)
}

/**
 * Drop the running turn without replacing it with another one.
 *
 * Unlike the engine's `interrupt()`, it **also bumps the turn token**, and
 * that's the part that matters: `interrupt()` makes `generate()` return early
 * with a partial output instead of throwing, so unless the turn is marked
 * stale, that partial output still flows on through `dispatch` and the car
 * does something nobody asked for — exactly the kind of error CONTEXT.md calls
 * a *false positive*.
 *
 * Callers: conversation mode, when the user cuts in while the assistant is
 * thinking, or on hang-up mid-turn.
 *
 * Returns `true` if the cancelled turn **had touched the car** (a tool ran
 * before it was cut). What was done is logged into the history; the caller
 * must not resend the old utterance.
 */
export function cancelVoiceCommand(): boolean {
  const session = useSessionStore.getState()
  if (!session.thinking) return false

  generation += 1
  interrupt()
  session.setThinking(false)
  session.setPersonaState('idle')
  return abandonInflight()
}

export async function runVoiceCommand(
  text: string,
  source: Extract<CommandSource, 'voice' | 'text'> = 'voice',
): Promise<string | null> {
  const input = text.trim()
  if (!input) return null

  const session = useSessionStore.getState()
  if (session.thinking) {
    interrupt()
    abandonInflight()
  }

  const myGeneration = ++generation
  const stale = () => generation !== myGeneration
  inflight = { generation: myGeneration, source, input, says: [] }

  session.setLastTranscript(input)
  session.setThinking(true)
  session.setPersonaState('thinking')
  session.setStatusLine({ phase: 'pending', text: `Processing “${input}”…` })

  const steps: Array<{ label: string; ms: number }> = []
  const startedAt = performance.now()

  // Snapshot the history *before* this turn is logged, so the utterance being
  // asked doesn't show up twice.
  const contextSince = Date.now() - CONTEXT_TTL_MS
  const history = useConversationStore
    .getState()
    .turns.filter((turn) => !turn.failed && turn.at >= contextSince)

  /** Every turn that gets through ends here: log it to history, return the reply. */
  const finish = (result: ToolResult): string => {
    const says = inflight?.generation === myGeneration ? inflight.says : []
    if (inflight?.generation === myGeneration) inflight = null
    const reply = describeResult(result)
    useConversationStore.getState().pushTurn({
      source,
      user: input,
      assistant: reply,
      // The cloud path collects each tool's sentence in `says`; on the
      // single-pass path the reply itself is what was done. After a barge-in,
      // the reply may hold only the part that was heard — `actions` keeps what
      // the car did for the next turn's context.
      actions: says.length > 0 ? [...says] : touchesCar(result) ? [reply] : [],
      failed: result.kind === 'rejected',
    })
    return reply
  }

  try {
    // Normally the model has finished loading since the page opened. Called
    // here so the first command still works if the user is quicker than the
    // progress bar.
    await ensureModel(session.modelId)
    if (stale()) return null

    // The cloud path runs an agent loop: the model sees the tool results before
    // it speaks.
    if (providerOf(session.modelId) === 'openai') {
      return await runAgentTurn({
        modelId: session.modelId as OpenAiModelId,
        input,
        source,
        history,
        startedAt,
        stale,
        finish,
      })
    }

    // Only WebLLM is left by now, where the catalog in the prompt is the only
    // way the model knows which tools exist — see `prompt/system.ts`.
    const messages = buildToolMessages(
      buildSystemPrompt(ACTIVE_VARIANT, TOOLS),
      input,
      history,
    )

    let generated = await generate(messages, TOOLS)
    if (stale()) return null
    steps.push({ label: 'generate', ms: round(generated.latencyMs) })

    let validation = firstToolCall(generated.raw)

    // Retry exactly once. This branch may almost never run; `steps` will
    // tell, since the retry pass shows up as its own line.
    let retried = false
    if (!validation.ok) {
      retried = true
      const retry = await generate(
        buildRetryMessages(messages, generated.raw, validation.problem),
        TOOLS,
      )
      if (stale()) return null
      steps.push({ label: 'retry', ms: round(retry.latencyMs) })
      generated = retry
      validation = firstToolCall(retry.raw)
    }

    const context = {
      source,
      input,
      rawToolCall: generated.raw.trim(),
      latencyMs: round(performance.now() - startedAt),
      steps,
      retried,
    }

    if (!validation.ok) {
      // Still invalid after the corrective pass → report "not understood".
      // Goes through `runCommand` like every other command; this one just
      // doesn't touch `CarState`.
      const { problem } = validation
      return finish(
        runCommand(
          () => ({ kind: 'rejected', toolName: 'unknown', problem }),
          context,
        ),
      )
    }

    let { call } = validation

    // Small talk gets one more generation pass so there's a decent sentence to
    // read aloud. Only `answer_in_words` takes this branch — every control
    // command is still a single pass, so the latency of "bật điều hoà" ("turn
    // on the A/C") doesn't change by a single millisecond.
    if (call.name === 'answer_in_words') {
      const chat = await converse(buildChatMessages(input, history))
      if (stale()) return null
      steps.push({ label: 'write reply', ms: round(chat.latencyMs) })
      context.latencyMs = round(performance.now() - startedAt)

      const written = cleanChatReply(chat.raw)
      // On failure, fall back to the first pass's `reason`. It may be clumsy,
      // but it's Vietnamese and it exists — silence mid-conversation is worse.
      if (written) {
        call = { name: 'answer_in_words', arguments: { reason: written } }
        context.rawToolCall = `${context.rawToolCall}\n\n[write reply] ${chat.raw.trim()}`
      }
    }

    // `play_music` has to wait for YouTube, so the door here is the `async` one.
    const result = await runCommandAsync(
      dispatch(call, { isStale: stale }),
      context,
      stale,
    )
    if (!result) return null
    return finish(result)
  } catch (error) {
    if (stale()) return null
    forgetModelCheck()
    const message = error instanceof Error ? error.message : String(error)
    const context = {
      source,
      input,
      rawToolCall: `[error] ${message}`,
      latencyMs: round(performance.now() - startedAt),
      steps,
    }

    // Cloud path: a tool touched the car at an earlier step, then a later step
    // failed. What was done can't be undone, so it has to be said — a bare
    // "sự cố" ("system problem") message makes the driver repeat themselves
    // and the car do it twice. Goes through like a successful turn so it lands
    // in the history.
    const done = inflight?.generation === myGeneration ? inflight.says : []
    const joined = joinSays(done)
    if (joined) {
      return finish(
        runCommand(
          () => ({
            kind: 'spoken',
            reason: `${joined}. Kết nối vừa bị gián đoạn nên có thể chưa làm hết`,
          }),
          context,
        ),
      )
    }

    return finish(
      runCommand(
        () => ({ kind: 'rejected', toolName: 'engine', problem: message }),
        context,
      ),
    )
  } finally {
    // An old turn that was cut off retreats quietly: the new turn is running and
    // has set its own `thinking`/`persona`; overwriting them here would switch
    // off someone else's lights.
    if (!stale()) {
      if (inflight?.generation === myGeneration) inflight = null
      useSessionStore.getState().setThinking(false)
      useSessionStore.getState().setPersonaState('idle')
    }
  }
}

/**
 * One utterance on the cloud path: `ToolLoopAgent` calls tools, reads the
 * results, then speaks.
 *
 * Each tool call still goes through `validateToolCall` → `dispatch` →
 * `runCommandAsync` — the very door of the single-pass loop, so the debug panel
 * shows each step as before. The difference is that results are **handed back
 * to the model**: on bad arguments the model reads `problem` and fixes it at
 * the next step (replacing the single-pass retry), and `play_music` returns
 * the real track title so the model says "đang phát …" ("now playing …")
 * instead of "đang tìm …" ("searching for …").
 */
async function runAgentTurn({
  modelId,
  input,
  source,
  history,
  startedAt,
  stale,
  finish,
}: {
  modelId: OpenAiModelId
  input: string
  source: Extract<CommandSource, 'voice' | 'text'>
  history: ReadonlyArray<HistoryTurn>
  startedAt: number
  stale: () => boolean
  finish: (result: ToolResult) => string
}): Promise<string | null> {
  /** The latest tool result — fallback reply if the model doesn't get to speak. */
  let lastResult: ToolResult | null = null
  /**
   * Whether this utterance asks to turn the A/C off. If so, adjusting the
   * temperature in the same turn must not turn the A/C back on — the explicit
   * off command wins, whether the model calls `set_ac` before or after
   * `set_temperature`.
   */
  let acOffRequested = false

  const onToolInput = (name: ToolName, args: unknown) => {
    if (name === 'set_ac' && (args as { on?: unknown } | null)?.on === false) {
      acOffRequested = true
    }
  }

  const execute = async (
    name: ToolName,
    args: unknown,
  ): Promise<ToolOutcome> => {
    // The turn was cut off by a later command: it must not touch the car.
    if (stale()) throw new Error('turn was cancelled')

    const rawToolCall =
      renderToolCall({
        function: { name, arguments: JSON.stringify(args ?? {}) },
      }) ?? name
    const context = {
      source,
      input,
      rawToolCall,
      latencyMs: round(performance.now() - startedAt),
    }

    const validation = validateToolCall(name, args)
    if (!validation.ok) {
      runCommand(
        () => ({
          kind: 'rejected',
          toolName: name,
          problem: validation.problem,
        }),
        context,
      )
      return {
        ok: false,
        say: `Error: invalid arguments — ${validation.problem}`,
      }
    }

    const result = await runCommandAsync(
      dispatch(validation.call, { autoAc: !acOffRequested, isStale: stale }),
      context,
      stale,
    )
    if (!result) throw new Error('turn was cancelled')
    lastResult = result
    const ok = result.kind !== 'rejected' && result.kind !== 'musicSearchFailed'
    const say = describeResult(result)
    if (ok) inflight?.says.push(say)
    return { ok, say }
  }

  // Snapshot once at the start of the turn, sent along with the utterance.
  // Tools that run afterwards return their own `say`, so the model still knows
  // what the car just changed.
  const readState = (): string => {
    if (stale()) throw new Error('turn was cancelled')
    const music = useMusicStore.getState()
    const track = music.visible ? music.queue[music.index] : undefined
    return JSON.stringify(
      snapshotCar(
        useCarStore.getState(),
        track
          ? { title: track.title, artist: track.artist, playing: music.playing }
          : null,
      ),
    )
  }

  // A web lookup costs a second or two per step; say what's being looked up so
  // the status bar doesn't sit on "Processing…" as if the car had frozen.
  const onWebLookup = (name: WebToolName, args: unknown) => {
    if (stale()) return
    const { query, url } = (args ?? {}) as { query?: string; url?: string }
    useSessionStore.getState().setStatusLine({
      phase: 'pending',
      text:
        name === 'web_search'
          ? `Searching the web for “${query ?? input}”…`
          : `Reading ${URL.parse(url ?? '')?.hostname ?? 'page'}…`,
    })
  }

  const turn = await runAgent({
    modelId,
    input,
    history,
    execute,
    readState,
    onToolInput,
    onWebLookup,
  })
  if (stale()) return null

  // If the loop stops right after a tool, the template sentence is the reply;
  // the model only writes its own when it gets extra steps (tool failed, a
  // question about state, small talk).
  const text = cleanChatReply(turn.text) ?? joinSays(turn.toolSays)
  const steps = turn.modelCallsMs.map((ms, i) => ({
    label: `step ${i + 1}`,
    ms: round(ms),
  }))
  const context = {
    source,
    input,
    rawToolCall: turn.text.trim(),
    latencyMs: round(performance.now() - startedAt),
    steps,
  }

  if (text) {
    return finish(runCommand(() => ({ kind: 'spoken', reason: text }), context))
  }
  // Hit `MAX_STEPS` without speaking: the last tool's reply is still true.
  const fallback: ToolResult = lastResult ?? {
    kind: 'rejected',
    toolName: 'agent',
    problem: 'model gave no reply',
  }
  return finish(runCommand(() => fallback, context))
}

/** Whether this result changed anything on the car — a plain answer didn't. */
function touchesCar(result: ToolResult): boolean {
  return (
    result.kind !== 'spoken' &&
    result.kind !== 'rejected' &&
    result.kind !== 'musicSearchFailed' &&
    result.kind !== 'time'
  )
}

/**
 * "Đã bật điều hoà" + "Đã tăng quạt lên mức 5" → "Đã bật điều hoà, đã tăng
 * quạt lên mức 5" ("Turned on the A/C" + "Raised the fan to level 5" → one
 * sentence). One sentence read in a single breath instead of two broken by a
 * period — the driver listens, not reads.
 */
function joinSays(says: string[]): string | null {
  const parts = says.map((say) => say.trim()).filter(Boolean)
  if (parts.length === 0) return null
  return parts
    .map((part, i) =>
      i === 0
        ? part[0].toLocaleUpperCase('vi') + part.slice(1)
        : part[0].toLocaleLowerCase('vi') + part.slice(1),
    )
    .join(', ')
}
