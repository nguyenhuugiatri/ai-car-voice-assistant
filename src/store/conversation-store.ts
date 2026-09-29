/**
 * `useConversationStore` — the conversation history: what the driver said,
 * what the car replied.
 *
 * Kept apart from `useSessionStore`'s `events` because the two answer different
 * questions: `events` is the technical log for the debug panel (raw tool calls,
 * latency, manual adjustments too), while this is **the conversation** — only
 * spoken/typed turns, only two strings.
 *
 * ### Why `sessionStorage` and not `localStorage`
 *
 * Reload the page midway and the conversation is still there, but closing the
 * tab ends it. A car is a shared device — the next trip shouldn't open with the
 * previous driver's questions.
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { CommandSource } from './session-store'

export type ConversationTurn = {
  id: string
  at: number
  source: Extract<CommandSource, 'voice' | 'text'>
  /** What the driver said/typed. */
  user: string
  /** The car's reply — the exact string the status bar shows and the TTS reads. */
  assistant: string
  /** Rejected turn (not understood, engine error). Never used as model context. */
  failed: boolean
  /** The driver barged in mid-reply — `assistant` holds only the part heard. */
  interrupted?: boolean
  /**
   * Sentences for what the car **actually did** in the turn. Not cut by
   * `truncateReply`: the driver may not have heard it all, but the car did all
   * of it — the next turn's model has to know that (see `historyMessages`).
   */
  actions?: string[]
}

type ConversationState = {
  turns: ConversationTurn[]
}

type ConversationActions = {
  pushTurn: (turn: Omit<ConversationTurn, 'id' | 'at'>) => void
  /**
   * The driver cut in while the car was speaking `reply`: replace that turn's
   * reply with the part that actually came out of the speaker. The next turn's
   * model should only "remember" what the driver heard — remembering the whole
   * sentence, it would carry on as if the cut-off part had been heard.
   *
   * Only edits the **last** turn, and only if its reply matches `reply`, so a
   * late barge-in can never edit the wrong turn.
   */
  truncateReply: (reply: string, heard: string) => void
  clearTurns: () => void
}

/** Cap on stored turns — sessionStorage is limited, and nobody scrolls back 200 lines. */
const MAX_TURNS = 100

export const useConversationStore = create<
  ConversationState & ConversationActions
>()(
  persist(
    (set) => ({
      turns: [],

      pushTurn: (turn) =>
        set((state) => ({
          turns: [
            ...state.turns,
            { ...turn, id: crypto.randomUUID(), at: Date.now() },
          ].slice(-MAX_TURNS),
        })),

      truncateReply: (reply, heard) =>
        set((state) => {
          const last = state.turns.at(-1)
          if (!last || last.assistant !== reply || heard === reply) return state
          return {
            turns: [
              ...state.turns.slice(0, -1),
              {
                ...last,
                assistant: heard ? `${heard}…` : '',
                interrupted: true,
              },
            ],
          }
        }),

      clearTurns: () => set({ turns: [] }),
    }),
    {
      name: 'car-conversation',
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
)
