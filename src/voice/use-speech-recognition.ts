/**
 * The Web Speech API as an `enabled` switch, not a button.
 *
 * `SpeechInput` (the dock's mic button) keeps its own on/off state, which suits
 * the user actively pressing it. Conversation mode is the opposite: the mic
 * must turn itself off while the assistant speaks and back on once it's done,
 * so the state has to live outside.
 *
 * Chrome ends the recognition session after a few seconds of silence even with
 * `continuous = true` (measured at 26–54 s). The hook restarts it for as
 * long as `enabled` stays on — otherwise the conversation would go dead silent
 * after the first turn.
 *
 * Ported from an earlier voice prototype with no behavior changes: this is
 * still the **browser STT** path, exactly what this repo uses.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type RecognitionAlternative = { transcript: string }
type RecognitionResult = {
  readonly length: number
  readonly isFinal: boolean
  [index: number]: RecognitionAlternative
}
type RecognitionEvent = Event & {
  resultIndex: number
  results: { readonly length: number; [index: number]: RecognitionResult }
}
type RecognitionInstance = EventTarget & {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionCtor = new () => RecognitionInstance

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  // Brave has `webkitSpeechRecognition` but no key for Google's recognition
  // service: every session reports `network` right after `start`, however many
  // times it retries. Treat it as unsupported so the UI points to Chrome/Edge.
  if ('brave' in navigator) return null
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/**
 * Errors a restart can't fix — mic permission, no mic, a browser without
 * Vietnamese. Restarting straight from `end` makes start → error → end spin
 * nonstop, burning CPU while the user just sees a flickering warning.
 */
const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'language-not-supported',
])

/** Chrome's recognition runs on Google's servers: on network loss, back off and retry. */
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 8000

/**
 * A session that survives this long without an error counts as recovered.
 * Chrome reports `network` almost immediately after `start`, so the `start`
 * event alone proves nothing.
 */
const RECOVERED_AFTER_MS = 3000

function errorMessage(error: string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Mic blocked by the browser. Allow mic access, then turn it back on.'
    case 'audio-capture':
      return 'No microphone found on this device.'
    case 'language-not-supported':
      return "This browser can't recognize Vietnamese."
    case 'network':
      return 'Lost connection to speech recognition, retrying…'
    default:
      return `Speech recognition error (${error}), retrying…`
  }
}

export type SpeechRecognitionOptions = {
  enabled: boolean
  lang?: string
  /** One final chunk. May fire several times within one spoken turn. */
  onFinal?: (text: string) => void
  /** The in-progress (interim) part, replacing the whole previous interim. */
  onInterim?: (text: string) => void
  /** A plain-English warning, readable as-is — not a browser error code. */
  onError?: (message: string) => void
  /** Recognition recovered after a reported error: the caller clears the warning. */
  onRecover?: () => void
  /**
   * The hook writes `restart` here — for the caller to use in callbacks
   * declared before this hook is called.
   */
  restartRef?: { current: () => void }
}

export function useSpeechRecognition({
  enabled,
  lang = 'vi-VN',
  onFinal,
  onInterim,
  onError,
  onRecover,
  restartRef,
}: SpeechRecognitionOptions) {
  const [supported] = useState(() => getRecognitionCtor() !== null)
  const [listening, setListening] = useState(false)

  const onFinalRef = useRef(onFinal)
  const onInterimRef = useRef(onInterim)
  const onErrorRef = useRef(onError)
  const onRecoverRef = useRef(onRecover)
  const enabledRef = useRef(enabled)

  // Synced in an effect, not during render: the `SpeechRecognition` handlers
  // live outside React and only run after paint, so being one beat late is
  // harmless — whereas writing refs during render breaks under StrictMode.
  useEffect(() => {
    onFinalRef.current = onFinal
    onInterimRef.current = onInterim
    onErrorRef.current = onError
    onRecoverRef.current = onRecover
    enabledRef.current = enabled
  })

  const recognitionRef = useRef<RecognitionInstance | null>(null)
  /** Guards `start()`, which throws InvalidStateError if a session is running. */
  const runningRef = useRef(false)
  /**
   * Only accept results from the running session. After `abort()` Chrome may
   * still emit a result from the old audio; the flag goes off right at
   * `abort()` and only comes back on at the next session's `start`.
   */
  const acceptResultsRef = useRef(false)
  /** Hit an unfixable error: no auto-restart until `enabled` is toggled again. */
  const blockedRef = useRef(false)
  /** Consecutive error count — decides the pause before the next retry. */
  const failuresRef = useRef(0)
  /** An error was reported and recovery hasn't been reported yet. */
  const reportedRef = useRef(false)

  useEffect(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) return

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang

    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let recoverTimer: ReturnType<typeof setTimeout> | null = null

    const clearRecoverTimer = () => {
      if (recoverTimer) clearTimeout(recoverTimer)
      recoverTimer = null
    }

    const markRecovered = () => {
      clearRecoverTimer()
      failuresRef.current = 0
      if (reportedRef.current) {
        reportedRef.current = false
        onRecoverRef.current?.()
      }
    }

    const handleStart = () => {
      runningRef.current = true
      acceptResultsRef.current = true
      setListening(true)
      clearRecoverTimer()
      if (failuresRef.current > 0 || reportedRef.current) {
        recoverTimer = setTimeout(markRecovered, RECOVERED_AFTER_MS)
      }
    }

    const handleEnd = () => {
      runningRef.current = false
      setListening(false)
      clearRecoverTimer()
      onInterimRef.current?.('')
      // Chrome ends the session on its own after silence — restart if we're
      // still in a listening turn. With no error, setTimeout(0), just to avoid
      // calling start() inside the end handler; right after an error, back off
      // progressively so it doesn't spin.
      if (!enabledRef.current || blockedRef.current) return
      const failures = failuresRef.current
      const delay =
        failures === 0
          ? 0
          : Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS)
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (!enabledRef.current || blockedRef.current || runningRef.current)
          return
        try {
          recognition.start()
        } catch {
          // Another session got going first — ignore.
        }
      }, delay)
    }

    const handleResult = (event: Event) => {
      if (!acceptResultsRef.current) return
      const speechEvent = event as RecognitionEvent
      let final = ''
      let interim = ''

      for (
        let i = speechEvent.resultIndex;
        i < speechEvent.results.length;
        i += 1
      ) {
        const result = speechEvent.results[i]
        const transcript = result?.[0]?.transcript ?? ''
        if (result?.isFinal) final += transcript
        else interim += transcript
      }

      // Words arriving means recognition really works — no need to wait it out.
      if (failuresRef.current > 0 || reportedRef.current) markRecovered()

      onInterimRef.current?.(interim)
      if (final.trim()) onFinalRef.current?.(final.trim())
    }

    const handleError = (event: Event) => {
      const error = (event as Event & { error?: string }).error ?? 'unknown'
      // `no-speech` and `aborted` are normal in a quiet conversation —
      // handleEnd will restart, no need to report them to the UI.
      if (error === 'no-speech' || error === 'aborted') return

      clearRecoverTimer()
      if (FATAL_ERRORS.has(error)) blockedRef.current = true
      else failuresRef.current += 1
      reportedRef.current = true
      onErrorRef.current?.(errorMessage(error))
    }

    recognition.addEventListener('start', handleStart)
    recognition.addEventListener('end', handleEnd)
    recognition.addEventListener('result', handleResult)
    recognition.addEventListener('error', handleError)
    recognitionRef.current = recognition

    return () => {
      enabledRef.current = false
      if (retryTimer) clearTimeout(retryTimer)
      clearRecoverTimer()
      recognition.removeEventListener('start', handleStart)
      recognition.removeEventListener('end', handleEnd)
      recognition.removeEventListener('result', handleResult)
      recognition.removeEventListener('error', handleError)
      try {
        recognition.abort()
      } catch {
        // Never started.
      }
      recognitionRef.current = null
      runningRef.current = false
    }
  }, [lang])

  useEffect(() => {
    const recognition = recognitionRef.current
    if (!recognition) return

    // Flipping the switch again (unmuting, calling again) is how the user says
    // "try again": they may have just granted mic permission.
    if (!enabled) {
      blockedRef.current = false
      failuresRef.current = 0
    }

    if (enabled && !runningRef.current) {
      try {
        recognition.start()
      } catch {
        // The old session hasn't reached `end` yet — handleEnd will restart it.
      }
    } else if (!enabled && runningRef.current) {
      // `abort()`, not `stop()`: `stop()` still emits the results of the audio
      // being processed, but by now the turn has already been sent — more
      // results only create a duplicate command, and a duplicate here means
      // the car does it twice.
      acceptResultsRef.current = false
      recognition.abort()
    }
  }, [enabled])

  /**
   * Drop the running session and open a new one, without turning `enabled`
   * off.
   *
   * Used when a turn has just been sent but the mic must keep listening: the
   * tail of the utterance just sent must not fall into the next turn.
   * `handleEnd` calls `start()` again by itself.
   */
  const restart = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition || !runningRef.current) return
    acceptResultsRef.current = false
    onInterimRef.current?.('')
    recognition.abort()
  }, [])

  useEffect(() => {
    if (restartRef) restartRef.current = restart
  }, [restart, restartRef])

  return { supported, listening, restart }
}
