/**
 * `useMusicStore` — the music queue and playback state.
 *
 * Kept apart from `useCarStore` because music **isn't car state**: tool calls
 * don't touch it, and it has a source of truth outside JS — the YouTube
 * player. The store holds the *intent* (which track, whether we want it
 * playing), the player reports back the *reality* (playing, track ended,
 * error), and the store corrects itself to match.
 *
 * ### Playback has to start from a tap
 *
 * Browsers block autoplay with sound. So on app open we only `cue` the first
 * track — the now-playing card shows up paused — and the first `playVideo`
 * always sits inside a button's click handler. That's exactly why
 * `prepareMusic()` loads the player right at mount: wait until the tap to load
 * it and the play call falls outside the tap and gets blocked.
 *
 * ### The now-playing card only shows once someone asks for music
 *
 * The player still loads and `cue`s from app open, but the now-playing card in
 * the dock stays **hidden** until the user taps the Music tile or the AI starts
 * music (`visible`). Opening the app to a paused music card already sitting on
 * the dock reads as an ad, not as something you just turned on.
 *
 * Tapping the Music tile again hides the card **and stops the music**: music
 * still playing with its card hidden means losing the only place to turn it
 * off.
 *
 * ### Ducking during a conversation
 *
 * An open mic over loud music means STT transcribes the lyrics as commands.
 * When a conversation opens, the music is ducked to `DUCK_VOLUME` and comes
 * back up when it closes — no pausing, because music cutting out every time
 * you ask "mấy độ rồi" ("what's the temperature?") sounds like the car broke.
 */

import { create } from 'zustand'

import type { MusicAction } from '@/domain/car-state'
import type { ToolResult } from '@/domain/tool-result'
import { DEFAULT_PLAYLIST, type MusicTrack } from '@/music/catalog'
import {
  createPlayer,
  describePlayerError,
  PlayerState,
} from '@/music/youtube-player'

import { useSessionStore } from './session-store'

const FULL_VOLUME = 100
const DUCK_VOLUME = 40
/** "Previous" past this point in a track only seeks back to its start. */
const RESTART_THRESHOLD_SEC = 3
const POSITION_POLL_MS = 500

type MusicState = {
  queue: MusicTrack[]
  index: number
  /** Play intent — set on press, without waiting for the player to confirm. */
  playing: boolean
  positionSec: number
  /** `0` until the player has loaded the track's metadata. */
  durationSec: number
  /**
   * The player failed to load, or nothing in the queue could be played.
   * Vietnamese on purpose: `searchMusic` hands it to `describeResult`, so it
   * is spoken to the driver and returned to the model — never shown as UI.
   */
  error: string | null
  /** Whether the now-playing card shows in the dock — see the top-of-file note. */
  visible: boolean
}

type MusicActions = {
  /** Show the now-playing card and play the current track (Music button, AI tool). */
  open: () => void
  /** Stop the music and hide the now-playing card. */
  close: () => void
  /** The Music tile in Menu: `open` if hidden, `close` if shown. */
  toggleOpen: () => void
  togglePlay: () => void
  play: () => void
  pause: () => void
  next: () => void
  previous: () => void
  seek: (seconds: number) => void
  /** Replace the queue and play from `index`. */
  playQueue: (tracks: MusicTrack[], index?: number) => void
  /** Search YouTube via `/api/music/search`, then play the results. */
  /** If `isStale` is true once the search is done, drop the result: no play, no error. */
  playSearch: (query: string, isStale?: () => boolean) => Promise<void>
}

export type MusicStore = MusicState & MusicActions

type Player = Awaited<ReturnType<typeof createPlayer>>

let player: Player | null = null
let playerPromise: Promise<Player | null> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
/** Consecutive failed tracks — stop at the queue length instead of looping forever. */
let consecutiveErrors = 0
let lastPlayerState: number = PlayerState.UNSTARTED

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    if (!player) return
    useMusicStore.setState({
      positionSec: player.getCurrentTime(),
      durationSec: player.getDuration(),
    })
  }, POSITION_POLL_MS)
}

function stopPolling() {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

function currentTrack(state: MusicState) {
  return state.queue[state.index]
}

/** Load the current track into the player: `load` if it should play, else `cue`. */
function loadCurrent() {
  const state = useMusicStore.getState()
  const track = currentTrack(state)
  if (!player || !track) return
  if (state.playing) player.loadVideoById(track.id)
  else player.cueVideoById(track.id)
}

function goTo(index: number, playing: boolean) {
  const { queue } = useMusicStore.getState()
  if (queue.length === 0) return
  // At the end of the queue, wrap around like a car radio — don't go silent.
  const wrapped = ((index % queue.length) + queue.length) % queue.length
  useMusicStore.setState({
    index: wrapped,
    playing,
    positionSec: 0,
    durationSec: 0,
    error: null,
  })
  loadCurrent()
}

function handleStateChange(state: number) {
  const previous = lastPlayerState
  lastPlayerState = state
  switch (state) {
    case PlayerState.UNSTARTED:
      // Falling back to "unstarted" while loading means the browser blocked
      // autoplay — the play call was outside a tap. The card must show the
      // Play button so the user can tap again, not sit frozen in "playing".
      if (previous === PlayerState.BUFFERING) {
        useMusicStore.setState({ playing: false })
        stopPolling()
      }
      break
    case PlayerState.PLAYING:
      consecutiveErrors = 0
      useMusicStore.setState({ playing: true, error: null })
      startPolling()
      break
    case PlayerState.PAUSED:
      // The player pausing by itself (e.g. headphones unplugged) must also show
      // correctly on the card.
      useMusicStore.setState({ playing: false })
      stopPolling()
      break
    case PlayerState.ENDED:
      stopPolling()
      goTo(useMusicStore.getState().index + 1, true)
      break
    case PlayerState.CUED:
      if (player) useMusicStore.setState({ durationSec: player.getDuration() })
      break
  }
}

function handleError(code: number) {
  const { index, playing, queue } = useMusicStore.getState()
  const reason = describePlayerError(code)
  const track = queue[index]
  console.warn(`[music] skipping "${track?.title}": ${reason}`)

  consecutiveErrors += 1
  if (consecutiveErrors >= queue.length) {
    stopPolling()
    useMusicStore.setState({
      playing: false,
      error: `Không phát được bài nào — ${reason}`,
    })
    return
  }
  goTo(index + 1, playing)
}

function applyVolume(callActive: boolean) {
  player?.setVolume(callActive ? DUCK_VOLUME : FULL_VOLUME)
}

/** Load the player and `cue` the first track. Repeat calls still load only once. */
export function prepareMusic(): Promise<Player | null> {
  playerPromise ??= createPlayer({
    onStateChange: handleStateChange,
    onError: handleError,
  })
    .then((created) => {
      player = created
      applyVolume(useSessionStore.getState().callActive)
      useSessionStore.subscribe((state, prev) => {
        if (state.callActive !== prev.callActive) applyVolume(state.callActive)
      })
      loadCurrent()
      return created
    })
    .catch((error: unknown) => {
      playerPromise = null
      useMusicStore.setState({
        playing: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    })
  return playerPromise
}

export const useMusicStore = create<MusicStore>()((set, get) => ({
  queue: DEFAULT_PLAYLIST,
  index: 0,
  playing: false,
  positionSec: 0,
  durationSec: 0,
  error: null,
  visible: false,

  open: () => {
    set({ visible: true })
    get().play()
  },

  close: () => {
    set({ visible: false })
    get().pause()
  },

  toggleOpen: () => (get().visible ? get().close() : get().open()),

  togglePlay: () => (get().playing ? get().pause() : get().play()),

  play: () => {
    set({ playing: true, error: null })
    if (player) player.playVideo()
    // No player yet: the intent is recorded; `loadCurrent` will `load` once ready.
    else void prepareMusic()
  },

  pause: () => {
    set({ playing: false })
    player?.pauseVideo()
    stopPolling()
  },

  next: () => goTo(get().index + 1, get().playing),

  previous: () => {
    if (get().positionSec > RESTART_THRESHOLD_SEC) {
      get().seek(0)
      return
    }
    goTo(get().index - 1, get().playing)
  },

  seek: (seconds) => {
    const target = Math.max(0, seconds)
    set({ positionSec: target })
    player?.seekTo(target, true)
  },

  playQueue: (tracks, index = 0) => {
    if (tracks.length === 0) return
    consecutiveErrors = 0
    set({ queue: tracks, visible: true })
    if (player) goTo(index, true)
    else {
      set({ index, playing: true, positionSec: 0, durationSec: 0 })
      void prepareMusic()
    }
  },

  playSearch: async (query, isStale) => {
    // Clear the old error first: `searchMusic` reads `error` after this call to
    // tell whether the search failed.
    set({ error: null })
    try {
      const res = await fetch(
        `/api/music/search?q=${encodeURIComponent(query)}`,
      )
      const body = (await res.json()) as {
        tracks?: MusicTrack[]
        error?: string
      }
      if (isStale?.()) return
      if (!res.ok || !body.tracks) {
        throw new Error(body.error ?? `tìm nhạc lỗi ${res.status}`)
      }
      if (body.tracks.length === 0) {
        set({ error: `Không tìm thấy bài nào cho "${query}"` })
        return
      }
      get().playQueue(body.tracks)
    } catch (error) {
      if (isStale?.()) return
      const message = error instanceof Error ? error.message : String(error)
      set({ error: `Không tìm được nhạc — ${message}` })
    }
  },
}))

function trackInfo(state: MusicState) {
  const track = currentTrack(state)
  return track ? { title: track.title, artist: track.artist } : null
}

/**
 * The AI's `control_music`. Returns a `ToolResult` so the reply goes through
 * `describeResult` like every other command.
 *
 * Changing tracks by voice **always shows the card and plays**: if "qua bài
 * khác" ("next song") while the music is off only switched tracks in silence,
 * it would sound like the command didn't take. The card's buttons are
 * different — they keep the current play state (`next`/`previous`).
 */
export function controlMusic(action: MusicAction): ToolResult {
  const store = useMusicStore.getState()
  const before = store.index

  switch (action) {
    case 'play': {
      const alreadySet = store.visible && store.playing
      if (!alreadySet) store.open()
      return {
        kind: 'music',
        action,
        track: trackInfo(useMusicStore.getState()),
        alreadySet,
      }
    }
    case 'pause': {
      const alreadySet = !store.playing
      if (!alreadySet) store.pause()
      return { kind: 'music', action, track: trackInfo(store), alreadySet }
    }
    case 'off': {
      const alreadySet = !store.visible
      if (!alreadySet) store.close()
      return { kind: 'music', action, track: trackInfo(store), alreadySet }
    }
    case 'next':
    case 'previous': {
      if (action === 'next') store.next()
      else store.previous()
      const after = useMusicStore.getState()
      if (!after.visible || !after.playing) after.open()
      return {
        kind: 'music',
        action,
        track: trackInfo(after),
        // `previous` mid-track only seeks back to the start — same track, so a
        // different reply.
        alreadySet: after.index === before,
      }
    }
  }
}

/**
 * The AI's `play_music`. **Waits** for the search to finish before returning:
 * the reply has to say which track is playing, not "đang tìm" ("searching") —
 * and the agent loop needs exactly that result to answer the driver.
 */
export async function searchMusic(
  query: string,
  isStale?: () => boolean,
): Promise<ToolResult> {
  await useMusicStore.getState().playSearch(query, isStale)
  const state = useMusicStore.getState()
  if (state.error) {
    return { kind: 'musicSearchFailed', query, problem: state.error }
  }
  return {
    kind: 'music',
    action: 'play',
    track: trackInfo(state),
    alreadySet: false,
  }
}
