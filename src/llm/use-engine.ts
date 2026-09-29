/**
 * Loads the model and pours progress into `useSessionStore`.
 *
 * ## **Load as soon as the page opens**, not lazily
 *
 * chat.webllm.ai loads lazily because it's a chat app: once the user has typed
 * their first message they have to wait anyway, and many people open the page
 * without asking anything. A head unit is the opposite — people open it to give
 * commands, and the first command is the **only** one a demo viewer sees. Lazy
 * loading turns 2.3 s into nearly a minute on exactly that command.
 *
 * The cost is that the page downloads hundreds of MB on its own when opened.
 * Acceptable here because this is a demo running on its builder's own machine,
 * not a public website — but if it ever goes on the real internet, this is the
 * first line to reread.
 *
 * Switching models in the Settings screen also goes through here: `modelId`
 * changes → the hook reloads. While reloading, `phase` goes back to `loading`
 * so the Start button locks itself — no separate flag needed.
 */

import { useEffect } from 'react'

import { useSessionStore } from '@/store/session-store'

import { ensureModel, onEngineProgress, providerOf } from './engine'

export function useEngineBoot(): void {
  const modelId = useSessionStore((state) => state.modelId)

  useEffect(() => {
    let cancelled = false
    const { setEngine, setPersonaState } = useSessionStore.getState()

    onEngineProgress((loadingId, report) => {
      // The load of a model that was just switched away from still runs in the
      // background and still reports here.
      if (cancelled || loadingId !== modelId) return
      useSessionStore.getState().setEngine({
        phase: 'loading',
        progress: report.progress,
        text: report.text,
      })
    })

    // The cloud path doesn't download weights, so there's no progress to draw —
    // but it still goes through `loading`, because that's the phase that locks
    // the Start button, and a network round trip to the proxy is still a
    // stretch of time that button mustn't be pressed.
    setEngine({
      phase: 'loading',
      progress: 0,
      text: providerOf(modelId) === 'openai' ? 'Connecting…' : 'Preparing…',
    })
    // Until the car has started, the assistant is asleep. This is `persona`'s
    // `asleep` state used for what it actually means, replacing the fake
    // variable in the Settings screen.
    setPersonaState('asleep')

    ensureModel(modelId)
      .then(() => {
        if (cancelled) return
        useSessionStore.getState().setEngine({ phase: 'ready' })
        useSessionStore.getState().setPersonaState('idle')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        useSessionStore.getState().setEngine({
          phase: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
        useSessionStore.getState().setPersonaState('asleep')
      })

    return () => {
      cancelled = true
      onEngineProgress(null)
    }
  }, [modelId])
}
