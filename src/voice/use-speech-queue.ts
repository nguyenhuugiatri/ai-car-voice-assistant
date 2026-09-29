/**
 * The speech queue. Two sound sources, with **ElevenLabs** preferred.
 *
 * The first version here only had `speechSynthesis`, reasoning that "this repo
 * has no server". That was right architecturally but wrong about what the ear
 * hears: macOS's vi-VN voice reads "Đã tăng lên 23 độ" ("Raised to 23
 * degrees") like a dictation machine, and the whole demo is about *talking to
 * the car*. So the main source is now ElevenLabs, through a thin door on the
 * server (`server/routes/api/tts/`) — the key has to live on the Node side,
 * there is no way around that. With no key or no server it **still works**: it
 * falls back to the OS voice, exactly as before.
 *
 *   - **ElevenLabs** — each chunk costs a network round trip, so chunks are
 *     **ordered the moment they are queued** instead of when their turn to play
 *     comes: while the first chunk is being spoken, the next one is already
 *     synthesized. Without that there is a clearly audible ~400 ms gap between
 *     two sentences. Audio arrives as a **stream** and is played through
 *     `MediaSource` as soon as the first byte lands, because
 *     `eleven_v3_conversational` starts as fast as Flash but takes twice as
 *     long to finish synthesizing a whole sentence.
 *   - **`speechSynthesis`** — the OS's vi-VN voice. Far more robotic, but it
 *     needs no network, costs nothing, and is always there. It is also the
 *     fallback when ElevenLabs fails *midway* — swallowing a reply is worse
 *     than reading it in an ugly voice.
 *
 * It is still a *queue* rather than a `speak()` function, because conversation
 * mode needs two things a bare call doesn't give:
 *
 *   1. **`onIdle`** — fires when speaking is done *and* the caller has
 *      signalled there are no more chunks (`seal`). This is the only correct
 *      signal to reopen the mic; open it early and the mic hears the TTS voice
 *      itself and spawns a command of its own.
 *   2. **`cancel`** — wipes both what is playing and what is waiting, so that
 *      "the later command wins" (see `run-voice-command.ts`) sounds as
 *      decisive as it runs.
 *
 * If no source can speak, `supported: false` and the hook stays completely
 * silent: reading Vietnamese in an English voice is worse than not reading at
 * all. `seal()` still fires `onIdle` right away, so the conversation doesn't
 * hang — it just replies with text in the status bar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchTtsInfo, synthesize, type TtsInfo } from './tts-remote'

export type SpeechQueue = {
  supported: boolean
  /**
   * Name of the voice in use; `null` when nothing can speak.
   *
   * Exposed so the UI can **say plainly what it is speaking with**. Hearing a
   * Vietnamese sentence pronounced like English has exactly three causes —
   * falling back to the OS voice, the wrong voice, or the sentence actually
   * being English — and without this line the user has no way to tell them
   * apart, and whoever fixes it is left guessing.
   */
  voiceName: string | null
  /** Playing, or chunks still waiting to play. */
  speaking: boolean
  /** Append one more chunk to the end of the queue. */
  enqueue: (text: string) => void
  /** Signal "no more chunks" — lets `onIdle` fire once the queue drains. */
  seal: () => void
  /**
   * Cut off: drop every chunk that is waiting or playing. Does not fire
   * `onIdle`.
   *
   * Returns **how far the listener got** (`null` when nothing was being
   * spoken), so the conversation history doesn't record a sentence the driver
   * never heard in full.
   */
  cancel: () => SpokenProgress | null
}

export type SpokenProgress = {
  /** All text queued since the last drain/cut. */
  total: string
  /** Played through the speaker so far — estimated, cut at a word boundary. */
  heard: string
}

/**
 * Assumed speaking rate when there is no better signal — the OS's vi-VN voice
 * reads about 14–16 characters/second. Only used when the engine doesn't fire
 * `boundary`, so its error only lands in the branch that was already blind.
 */
const FALLBACK_CHARS_PER_SEC = 15

/** Cut `text` to its first `chars` chars, backing up to the nearest space so no word is split. */
function cutAtWord(text: string, chars: number): string {
  if (chars >= text.length) return text
  if (chars <= 0) return ''
  const space = text.lastIndexOf(' ', chars)
  return text.slice(0, space > 0 ? space : chars).trim()
}

/**
 * The best Vietnamese voice the machine has, or `null`.
 *
 * Priority is **local before remote**, not "the first vi voice found". A remote
 * voice (`Google Tiếng Việt`) is fetched over the network on every utterance:
 * in a car that loses signal it fails, and the way it fails is *silence, then a
 * fallback to the default voice* — the very bug of a Vietnamese sentence read
 * in an English voice. Local voices are more robotic but never fail that way.
 */
function pickVietnameseVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const vietnamese = voices.filter((voice) =>
    (voice.lang ?? '').toLowerCase().replace('_', '-').startsWith('vi'),
  )
  if (vietnamese.length === 0) return null
  return vietnamese.find((voice) => voice.localService) ?? vietnamese[0] ?? null
}

/**
 * Whether the browser can play an mp3 that is still arriving, via
 * `MediaSource`. Chrome can; iOS Safari only has `ManagedMediaSource` — there
 * we wait for the whole file and play it as before.
 */
function canStreamMp3(): boolean {
  return (
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported('audio/mpeg')
  )
}

export type SpeechQueueOptions = {
  /** Fires when the last chunk finishes after `seal()`. Not fired on `cancel()`. */
  onIdle?: () => void
  /**
   * Speaking rate. `1` means **leave the native rate alone**.
   *
   * The earlier prototype spoke at 1.05 to feel less sluggish. Dropped
   * here, because with the OS voice on macOS, a `rate` other than 1 is an extra
   * variable standing between us and the engine — and when the voice comes out
   * wrong, that's the first variable to rule out. Being 5% faster isn't worth
   * keeping a suspect around.
   */
  rate?: number
}

type QueueItem = {
  text: string
  /** ElevenLabs synthesis already ordered; `null` when using the OS voice. */
  audio: Promise<Response> | null
}

export function useSpeechQueue(options: SpeechQueueOptions = {}): SpeechQueue {
  const { onIdle, rate = 1 } = options

  const [browserVoiceName, setBrowserVoiceName] = useState<string | null>(null)
  const [remote, setRemote] = useState<TtsInfo | null>(null)
  const [speaking, setSpeaking] = useState(false)

  /**
   * **`voiceURI`, not the voice object.**
   *
   * Chrome rebuilds the voice list several times over a page's life (on every
   * `voiceschanged`), and a `SpeechSynthesisVoice` kept from an old list becomes
   * meaningless to the engine: `utterance.voice = <old object>` is **silently
   * ignored** — no error, no warning — and the engine falls back to the system
   * default voice. On the test machine that default is `Samantha (en-US)`, so
   * Vietnamese sentences got read in an English voice. Exactly the symptom, and
   * the reason this stores an **identifier** and looks it up again right at
   * speaking time.
   */
  const voiceUriRef = useRef<string | null>(null)
  const queueRef = useRef<QueueItem[]>([])
  const playingRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  /**
   * How to end the currently playing chunk *from outside*.
   *
   * `pause()` doesn't fire `ended`, so if `cancel()` only paused, the playback
   * loop would sit at its `await` forever and the queue would die outright —
   * no later chunk would ever play.
   */
  const settleRef = useRef<(() => void) | null>(null)
  /** Cancel chunks that were ordered but haven't played — they're still billed. */
  const abortRef = useRef<AbortController>(new AbortController())
  const sealedRef = useRef(false)
  /**
   * Every chunk carries the generation stamp from when it was queued.
   * `cancel()` bumps this number, so callbacks of old chunks (which still fire
   * after a cancel) invalidate themselves.
   */
  const generationRef = useRef(0)
  /**
   * The "how far have we spoken" ledger: text of chunks already played, plus a
   * function that measures the chunk currently playing. The measure depends on
   * the source — `<audio>` has `currentTime`, `speechSynthesis` has `boundary`
   * (when the engine bothers to fire it).
   */
  const spokenRef = useRef<{
    total: string[]
    done: string[]
    measure: (() => number) | null
  }>({ total: [], done: [], measure: null })

  const onIdleRef = useRef(onIdle)
  const rateRef = useRef(rate)
  /**
   * `enqueue` must know which source is active, but it runs in callbacks, not
   * during render — going through a ref means switching source doesn't rebuild
   * `enqueue`, and `useCallSession` doesn't have to re-run any effect over it.
   */
  const remoteRef = useRef(false)

  // Ask the server whether ElevenLabs is available. Once per session —
  // `fetchTtsInfo` memoizes, even if this hook is remounted.
  useEffect(() => {
    let alive = true
    void fetchTtsInfo().then((info) => {
      if (alive) setRemote(info)
    })
    return () => {
      alive = false
    }
  }, [])

  // The OS's vi-VN voice — both the fallback and the main source when
  // ElevenLabs isn't available.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

    const pickVoice = () => {
      const vi = pickVietnameseVoice(window.speechSynthesis.getVoices())
      voiceUriRef.current = vi?.voiceURI ?? null
      setBrowserVoiceName(vi ? `${vi.name} (${vi.lang})` : null)
    }

    pickVoice()
    window.speechSynthesis.addEventListener('voiceschanged', pickVoice)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', pickVoice)
      window.speechSynthesis.cancel()
    }
  }, [])

  const useRemote = remote?.enabled === true

  useEffect(() => {
    onIdleRef.current = onIdle
    rateRef.current = rate
    remoteRef.current = useRemote
  })

  const supported = useRemote || browserVoiceName !== null
  const voiceName = useRemote
    ? `ElevenLabs · ${remote.voice} (${remote.model})`
    : browserVoiceName

  /** Speak one chunk with the OS voice. Resolves when done, or on failure. */
  const speakWithBrowser = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve()
        return
      }

      const voices = window.speechSynthesis.getVoices()
      // Look it up again in the *current* list: the voice picked when the page
      // opened may belong to an old list (see the note on `voiceUriRef`).
      const voice =
        voices.find((item) => item.voiceURI === voiceUriRef.current) ??
        pickVietnameseVoice(voices)

      // No Vietnamese voice found → stay **silent** rather than letting the
      // engine choose: it would pick the system default — almost always
      // English — and a Vietnamese sentence in an English voice is worse than
      // silence.
      if (!voice) {
        resolve()
        return
      }

      const utterance = new SpeechSynthesisUtterance(text)
      const startedAt = performance.now()
      let boundary = -1
      utterance.onboundary = (event) => {
        boundary = event.charIndex
      }
      spokenRef.current.measure = () =>
        boundary >= 0
          ? boundary
          : ((performance.now() - startedAt) / 1000) *
            FALLBACK_CHARS_PER_SEC *
            rateRef.current

      utterance.voice = voice
      // Always `vi-VN`, never `voice.lang`: some engines return `vi_VN` or an
      // empty string, and either is enough to lose the voice.
      utterance.lang = 'vi-VN'
      if (rateRef.current !== 1) utterance.rate = rateRef.current
      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()
      window.speechSynthesis.speak(utterance)
    })
  }, [])

  /**
   * Play an mp3 blob. Resolves when the audio ends, even if the file is broken.
   *
   * `chars` is the chunk's text length, used to convert the playback position
   * into characters spoken.
   */
  const playBlob = useCallback((blob: Blob, chars: number) => {
    return new Promise<void>((resolve) => {
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      if (rateRef.current !== 1) audio.playbackRate = rateRef.current
      audioRef.current = audio
      // Time ratio → character ratio. ElevenLabs has an endpoint that returns
      // per-character timestamps, but a barge-in isn't worth a whole different
      // response format.
      spokenRef.current.measure = () =>
        Number.isFinite(audio.duration) && audio.duration > 0
          ? (audio.currentTime / audio.duration) * chars
          : 0

      const done = () => {
        URL.revokeObjectURL(url)
        if (audioRef.current === audio) audioRef.current = null
        if (settleRef.current === done) settleRef.current = null
        resolve()
      }

      settleRef.current = done
      audio.onended = done
      audio.onerror = done
      // `play()` rejects when the browser doesn't allow autoplay yet. That
      // can't happen here — the queue only runs after the user has pressed the
      // mic — but hanging the whole conversation on one rejected promise isn't
      // worth it.
      void audio.play().catch(done)
    })
  }, [])

  /**
   * Play an mp3 stream **while it is still arriving**. Resolves when the audio
   * ends.
   *
   * Resolves `false` when not a single byte could be played (stream broke right
   * at the start, browser won't take mp3) so that `pump` reads that sentence
   * with the OS voice. If it breaks *midway*, play out what has arrived — half a
   * sentence in one voice spliced onto half in another sounds even worse.
   */
  const playStream = useCallback((res: Response, chars: number) => {
    return new Promise<boolean>((resolve) => {
      // `synthesize` only resolves when there is a body.
      const reader = res.body!.getReader()
      const media = new MediaSource()
      const url = URL.createObjectURL(media)
      const audio = new Audio(url)
      if (rateRef.current !== 1) audio.playbackRate = rateRef.current
      audioRef.current = audio
      let bytes = 0
      let settled = false
      // While the stream is still arriving, `duration` only covers what has
      // loaded — dividing by it always looks nearly finished. So until then,
      // estimate from the speaking rate.
      spokenRef.current.measure = () =>
        media.readyState === 'ended' &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
          ? (audio.currentTime / audio.duration) * chars
          : Math.min(chars, audio.currentTime * FALLBACK_CHARS_PER_SEC)

      const done = () => {
        if (settled) return
        settled = true
        // Cut off → stop reading the stream; don't hold a connection open for
        // a sentence nobody will hear.
        void reader.cancel().catch(() => undefined)
        URL.revokeObjectURL(url)
        if (audioRef.current === audio) audioRef.current = null
        if (settleRef.current === done) settleRef.current = null
        resolve(bytes > 0)
      }

      settleRef.current = done
      audio.onended = done
      audio.onerror = done

      const feed = async () => {
        const buffer = media.addSourceBuffer('audio/mpeg')
        try {
          for (;;) {
            const chunk = await reader.read()
            if (settled) return
            if (chunk.done) break
            buffer.appendBuffer(chunk.value)
            bytes += chunk.value.byteLength
            await new Promise((next) =>
              buffer.addEventListener('updateend', next, { once: true }),
            )
          }
        } catch {
          // Stream broke midway: fall through and play out what we have.
        }
        if (settled) return
        // With no bytes at all, `ended` will never fire — finish ourselves.
        if (bytes === 0) {
          done()
          return
        }
        if (media.readyState === 'open') media.endOfStream()
      }

      media.addEventListener('sourceopen', () => void feed().catch(done), {
        once: true,
      })
      // See the note in `playBlob` about `play()` rejecting.
      void audio.play().catch(done)
    })
  }, [])

  const pump = useCallback(async () => {
    if (playingRef.current) return
    playingRef.current = true

    try {
      while (queueRef.current.length > 0) {
        const generation = generationRef.current
        const item = queueRef.current[0]
        if (!item) break

        if (item.audio) {
          let played = false
          try {
            const res = await item.audio
            if (generation !== generationRef.current) return
            if (canStreamMp3()) {
              played = await playStream(res, item.text.length)
            } else {
              const blob = await res.blob()
              if (generation !== generationRef.current) return
              await playBlob(blob, item.text.length)
              played = true
            }
          } catch {
            // Fall through.
          }
          if (generation !== generationRef.current) return
          // ElevenLabs failed (quota exhausted, network down, bad key) — the OS
          // voice beats swallowing one of the assistant's sentences.
          if (!played) await speakWithBrowser(item.text)
        } else {
          await speakWithBrowser(item.text)
        }

        if (generation !== generationRef.current) return
        queueRef.current.shift()
        spokenRef.current.done.push(item.text)
        spokenRef.current.measure = null
      }

      setSpeaking(false)
      spokenRef.current = { total: [], done: [], measure: null }
      if (sealedRef.current) {
        sealedRef.current = false
        onIdleRef.current?.()
      }
    } finally {
      playingRef.current = false
    }
  }, [playBlob, playStream, speakWithBrowser])

  const enqueue = useCallback(
    (text: string) => {
      if (!(supported && text.trim())) return

      // Order it right here instead of waiting for its turn to play — that's
      // the whole reason this queue sounds seamless.
      const audio = remoteRef.current
        ? synthesize(text, abortRef.current.signal)
        : null
      // A chunk that `cancel()` removes from the queue before anyone gets to
      // `await` it is still a rejected promise — attach a handler up front so
      // it doesn't surface as an unhandled rejection. `pump` still catches the
      // real error of the original promise.
      audio?.catch(() => undefined)

      queueRef.current.push({ text, audio })
      spokenRef.current.total.push(text)
      setSpeaking(true)
      void pump()
    },
    [supported, pump],
  )

  const cancel = useCallback((): SpokenProgress | null => {
    const spoken = spokenRef.current
    const current = queueRef.current[0]
    const progress: SpokenProgress | null =
      spoken.total.length === 0
        ? null
        : {
            total: spoken.total.join(' '),
            heard: [
              ...spoken.done,
              current && spoken.measure
                ? cutAtWord(current.text, Math.floor(spoken.measure()))
                : '',
            ]
              .filter(Boolean)
              .join(' '),
          }
    spokenRef.current = { total: [], done: [], measure: null }

    generationRef.current += 1
    queueRef.current = []
    sealedRef.current = false

    abortRef.current.abort()
    abortRef.current = new AbortController()

    audioRef.current?.pause()
    // Release the playback loop from the `await` of the chunk just cut.
    settleRef.current?.()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // `cancel()` fires `onend` for whatever is playing, so the `pump` loop
      // leaves its `await` instead of sitting there forever.
      window.speechSynthesis.cancel()
    }
    setSpeaking(false)
    return progress
  }, [])

  const seal = useCallback(() => {
    // The queue drained before it was even sealed (sentence too short, or no
    // voice at all) — fire right away, or the caller hangs in the speaking
    // state forever.
    if (queueRef.current.length === 0 && !playingRef.current) {
      sealedRef.current = false
      onIdleRef.current?.()
      return
    }
    sealedRef.current = true
  }, [])

  useEffect(
    () => () => {
      cancel()
    },
    [cancel],
  )

  return useMemo(
    () => ({
      supported,
      voiceName,
      speaking,
      enqueue,
      seal,
      cancel,
    }),
    [supported, voiceName, speaking, enqueue, seal, cancel],
  )
}
