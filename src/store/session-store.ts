/**
 * `useSessionStore` — everything that is **not** car state: the mic, the
 * transcript, the reply on the voice card, the debug panel's log, the selected
 * model, and the `persona`'s `state`.
 *
 * Tool calls must never touch this store (see `car-store.ts`). It exists so
 * the UI has somewhere to display the flow, and so the voice loop has
 * somewhere to pour data into without reworking `CarState`.
 */

import { create } from 'zustand'

import type { PersonaState } from '@/components/ai-elements/persona'
import type { ToolResult } from '@/domain/tool-result'

/**
 * The model is a configuration variable with a dropdown; the eval suite
 * decides the winning model.
 *
 * The list has **two families**, told apart by `provider` (see
 * `src/llm/engine.ts`):
 *
 *   - `openai` — called through the server's proxy, needs `OPENAI_API_KEY` in
 *     the environment. Downloads nothing, ready as soon as the page opens, and
 *     this is the default.
 *   - `webllm` — runs on the user's GPU. No key, no network after the first
 *     download, but that first download is hundreds of MB.
 *
 * Both are kept rather than deleting WebLLM: without a key there is no cloud
 * path, and all the earlier measurements are about those very models —
 * deleting them would throw away the meaning of the eval table. The cloud path
 * is **one more configuration**, not a replacement.
 *
 * The Settings screen only shows `tag` (a highlight label, mostly `null`) and
 * `size` (download size, on-device models only). `note` is a technical note
 * (VRAM, eval numbers) for developers — don't put `note` in the UI.
 */
export const MODEL_OPTIONS = [
  {
    provider: 'openai',
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini (default)',
    tag: 'Recommended',
    size: null,
    note: 'Cloud — fast, good at tool calls, no download. Needs OPENAI_API_KEY.',
  },
  {
    provider: 'openai',
    id: 'gpt-4.1-nano',
    label: 'GPT-4.1 nano',
    tag: 'Fastest',
    size: null,
    note: 'Cloud — the latency floor. Weaker at direction-flip ("lạnh quá" ("so cold") → warmer).',
  },
  {
    provider: 'openai',
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    tag: null,
    size: null,
    note: 'Cloud — the step up, for checking whether mini fails because of the model or the prompt.',
  },
  {
    provider: 'openai',
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    tag: null,
    size: null,
    note: 'Cloud — previous-generation baseline, kept to compare against 4.1 mini.',
  },
  {
    provider: 'webllm',
    id: 'Qwen3-0.6B-q4f16_1-MLC',
    label: 'Qwen3-0.6B (on-device)',
    tag: 'Lightest',
    size: '1.4 GB',
    note: '1.4 GB VRAM, q4f16_1 — runs with enable_thinking: false',
  },
  {
    provider: 'webllm',
    id: 'Qwen3.5-0.8B-q4f16_1-MLC',
    label: 'Qwen3.5-0.8B',
    tag: null,
    size: '1.6 GB',
    note: '1.6 GB VRAM — the step above 0.6B, cheaper than jumping straight to 1.5B',
  },
  {
    provider: 'webllm',
    id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    label: 'Qwen2.5-1.5B',
    tag: null,
    size: null,
    note: 'Early spike: 14/15 tool names',
  },
  {
    provider: 'webllm',
    id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    label: 'Llama-3.2-1B',
    tag: null,
    size: null,
    note: 'Early spike: 3/15 — kept only as a baseline',
  },
  {
    provider: 'webllm',
    id: 'Qwen2.5-3B-Instruct-q4f32_1-MLC',
    label: 'Qwen2.5-3B',
    tag: null,
    size: null,
    note: 'Escalation step if 1.5B misses the eval threshold',
  },
  {
    provider: 'webllm',
    /**
     * The largest step in the list, and the first one **without** WebLLM's
     * `low_resource_required` flag — 3.9 GB VRAM, nearly three times the
     * default.
     *
     * It's here for a specific reason, not to "try a big model just in case":
     * chit-chat needs a model that can separate *instructions* from *content*,
     * and 0.6B measurably can't — it paraphrases the system prompt into its
     * replies ("không làm được rồi" ("can't do that"), "nếu bạn đang nhìn
     * đường" ("if you're watching the road")). That's not something wording
     * can patch; only switching models fixes it.
     *
     * The price: a noticeably longer load on page open, and per-turn latency
     * rises with it. For the control path (`temperature: 0`, one tool call)
     * 0.6B was already enough, so this is a real trade-off — not a pure
     * upgrade.
     */
    id: 'Qwen3.5-4B-q4f16_1-MLC',
    label: 'Qwen3.5-4B',
    tag: null,
    size: '3.9 GB',
    note: '3.9 GB VRAM — the step for chit-chat; 0.6B parrots the system prompt back',
  },
] as const

export type ModelId = (typeof MODEL_OPTIONS)[number]['id']
export type ModelProvider = (typeof MODEL_OPTIONS)[number]['provider']

/** Where a command came from — the debug panel must tell touch from voice. */
export type CommandSource = 'manual' | 'voice' | 'text'

export type DebugEvent = {
  id: number
  at: number
  source: CommandSource
  /** What the user said/typed. Empty for manual adjustments. */
  input?: string
  /** Raw JSON of the tool call — filled in by the voice loop. */
  rawToolCall?: string
  result?: ToolResult
  latencyMs?: number
  /**
   * Timings for each step of the loop, recorded in full. A single total
   * `latencyMs` can't answer the real question — is it slow in the model or in
   * the retry pass?
   */
  steps?: Array<{ label: string; ms: number }>
  /** The first pass was rejected; this is the corrective pass's result. */
  retried?: boolean
}

/**
 * The engine's lifecycle, as seen from the UI.
 *
 * `loading` carries `progress` **and** `text`: `report.progress` is what can
 * draw the progress bar, while `report.text` is the only thing that tells
 * "downloading 600 MB of weights" apart from "compiling shaders" — two equally
 * long phases where only the first has a moving percentage.
 */
export type EngineStatus =
  | { phase: 'cold' }
  | { phase: 'loading'; progress: number; text: string }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

/**
 * The status bar has two phases, just like the video: "Working…" then
 * "Done". Manual adjustments jump straight
 * to `done`; voice commands stay at `pending` while the model thinks.
 */
export type StatusLine = { phase: 'pending' | 'done' | 'failed'; text: string }

type SessionState = {
  personaState: PersonaState
  statusLine: StatusLine | null
  micActive: boolean
  lastTranscript: string
  debugOpen: boolean
  events: DebugEvent[]
  modelId: ModelId
  engine: EngineStatus
  /** A generation is running. A later utterance cuts off this one — no queueing. */
  thinking: boolean
  /**
   * Conversation mode is open: the mic turns itself back on after each turn,
   * and the assistant reads its reply aloud.
   *
   * Lives here rather than in a `useState` in the dock because it's **a mode of
   * the session**, not the state of a button: the voice layer, the debug panel
   * and the talk button in the dock all need to know whether the car is in a
   * conversation.
   */
  callActive: boolean
}

type SessionActions = {
  setPersonaState: (state: PersonaState) => void
  setStatusLine: (line: StatusLine | null) => void
  setMicActive: (active: boolean) => void
  setLastTranscript: (text: string) => void
  toggleDebug: () => void
  setModelId: (id: ModelId) => void
  setEngine: (status: EngineStatus) => void
  setThinking: (thinking: boolean) => void
  setCallActive: (active: boolean) => void
  pushEvent: (event: Omit<DebugEvent, 'id' | 'at'>) => void
  clearEvents: () => void
}

let nextEventId = 1

/** The debug panel is a sliding window, not a log: keep the latest 50 events. */
const MAX_EVENTS = 50

export const useSessionStore = create<SessionState & SessionActions>()(
  (set) => ({
    personaState: 'idle',
    statusLine: null,
    micActive: false,
    lastTranscript: '',
    debugOpen: false, // off by default, turned on in the Settings screen
    events: [],
    modelId: MODEL_OPTIONS[0].id,
    engine: { phase: 'cold' },
    thinking: false,
    callActive: false,

    setPersonaState: (personaState) => set({ personaState }),
    setStatusLine: (statusLine) => set({ statusLine }),
    setMicActive: (micActive) => set({ micActive }),
    setLastTranscript: (lastTranscript) => set({ lastTranscript }),
    toggleDebug: () => set((state) => ({ debugOpen: !state.debugOpen })),
    setModelId: (modelId) => set({ modelId }),
    setEngine: (engine) => set({ engine }),
    setThinking: (thinking) => set({ thinking }),
    setCallActive: (callActive) => set({ callActive }),

    pushEvent: (event) =>
      set((state) => ({
        events: [
          { ...event, id: nextEventId++, at: Date.now() },
          ...state.events,
        ].slice(0, MAX_EVENTS),
      })),

    clearEvents: () => set({ events: [] }),
  }),
)
