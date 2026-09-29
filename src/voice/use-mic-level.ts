/**
 * Real-time mic volume level, and the "user started speaking" signal.
 *
 * The Web Speech API doesn't say whether the mic is loud or quiet, only which
 * words it heard. Conversation mode needs that number for two things:
 *
 *   1. The orb on the dock swells with the voice — the only evidence the user
 *      has that the car *is listening*, while no words have appeared yet.
 *   2. **Barge-in**: while the assistant is speaking, recognition is off, so
 *      the volume level is all that's left to tell the user just cut in.
 *
 * `echoCancellation` is what stops the assistant's own TTS voice from echoing
 * into the mic and barging in on itself. It isn't perfect, especially in a
 * car, where the speakers are louder than in any office — barge-in is still on
 * by default because the driver has no other way to cut off a long reply (see
 * `use-call-session.ts`).
 *
 * Ported as-is from an earlier voice prototype.
 */

import { useEffect, useRef, useState } from 'react'

import { useMicLevelStore } from './mic-level-store'

export type MicLevelOptions = {
  enabled: boolean
  /**
   * Fires once for each new burst of speech that crosses the threshold.
   * Returning `false` means "doesn't count yet": the burst isn't latched, and
   * if the next frame is still over the threshold, it asks again.
   */
  onSpeechStart?: () => boolean | void
  /**
   * RMS 0..1. 0.05 ≈ normal speech at arm's length from the mic.
   *
   * Can be changed on the fly without reopening the mic — the caller raises
   * the threshold while the car is speaking so speaker echo isn't counted as
   * someone cutting in.
   */
  threshold?: number
  /** Must stay loud this long to count as speech — filters out taps and doors. */
  sustainMs?: number
}

/**
 * Doesn't return `level`: the mic level goes straight into `useMicLevelStore`
 * (RMS rounded to 2 decimals), so the component holding this hook doesn't
 * re-render on every frame.
 */
export type MicLevel = {
  error: string | null
}

const RELEASE_RATIO = 0.6
const RELEASE_MS = 400

export function useMicLevel({
  enabled,
  onSpeechStart,
  threshold = 0.05,
  sustainMs = 180,
}: MicLevelOptions): MicLevel {
  const [error, setError] = useState<string | null>(null)

  const onSpeechStartRef = useRef(onSpeechStart)
  const thresholdRef = useRef(threshold)
  const sustainMsRef = useRef(sustainMs)
  useEffect(() => {
    onSpeechStartRef.current = onSpeechStart
    thresholdRef.current = threshold
    sustainMsRef.current = sustainMs
  })

  useEffect(() => {
    // No need to reset the level to 0 here: the previous effect run already did
    // it in its cleanup, which is also when the mic actually turns off.
    if (!enabled) return

    let disposed = false
    let frame = 0
    let stream: MediaStream | null = null
    let context: AudioContext | null = null

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
      } catch {
        if (!disposed) setError("Couldn't open the mic to measure its level.")
        return
      }
      if (disposed) {
        for (const track of stream.getTracks()) track.stop()
        return
      }

      setError(null)
      context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.6
      context.createMediaStreamSource(stream).connect(analyser)

      const samples = new Uint8Array(analyser.fftSize)
      let loudSince: number | null = null
      let quietSince: number | null = null
      let latched = false
      let shown = 0

      const tick = () => {
        if (disposed) return
        frame = requestAnimationFrame(tick)

        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) {
          const normalized = (sample - 128) / 128
          sum += normalized * normalized
        }
        const rms = Math.sqrt(sum / samples.length)

        const rounded = Math.round(rms * 100) / 100
        if (rounded !== shown) {
          shown = rounded
          useMicLevelStore.setState({ level: rounded })
        }

        const now = performance.now()
        const threshold = thresholdRef.current
        if (rms >= threshold) {
          quietSince = null
          loudSince ??= now
          if (!latched && now - loudSince >= sustainMsRef.current) {
            latched = onSpeechStartRef.current?.() !== false
          }
        } else {
          loudSince = null
          if (latched && rms < threshold * RELEASE_RATIO) {
            quietSince ??= now
            if (now - quietSince >= RELEASE_MS) latched = false
          }
        }
      }

      frame = requestAnimationFrame(tick)
    }

    void start()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      if (stream) for (const track of stream.getTracks()) track.stop()
      void context?.close().catch(() => undefined)
      useMicLevelStore.setState({ level: 0 })
    }
  }, [enabled])

  return { error }
}
