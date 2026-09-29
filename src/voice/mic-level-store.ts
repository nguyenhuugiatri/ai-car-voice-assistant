/**
 * Mic level 0..1, kept out of `useCallSession`'s React state.
 *
 * The level changes almost every frame while the mic is open — in a car, with
 * engine and wind noise, an RMS rounded to two decimals rarely holds still.
 * Keeping it in `useState` inside `useCallSession` (called from `App`) means
 * **the whole car screen** re-renders ~60 times a second just so two small
 * things can wiggle: the aurora and the waveform.
 *
 * Instead, `useMicLevel` writes straight into this store, and only components
 * that call `useVoiceLevel` re-render with it.
 */

import { create } from 'zustand'

export const useMicLevelStore = create<{ level: number }>(() => ({ level: 0 }))

/**
 * Mic level for drawing. `live` is the cheap gate — it only changes on a phase
 * change or a mic toggle — so the parent passes a boolean down, and the
 * constantly changing number lives only here.
 */
export function useVoiceLevel(live: boolean): number {
  return useMicLevelStore((state) => (live ? state.level : 0))
}
