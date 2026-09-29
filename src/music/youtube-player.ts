/**
 * A hidden YouTube player — the speaker of the Music screen.
 *
 * Uses the **IFrame Player API** rather than pulling the audio stream down and
 * playing it with `<audio>`: playing through the iframe needs no key, no
 * server, and is the only way YouTube allows. The cost is that everything goes
 * through `postMessage` and is therefore asynchronous, and the playback
 * position has to be **polled** — there is no `timeupdate` event.
 *
 * This module only wraps the API for tidiness and typing; deciding which track
 * plays, and when, lives in `useMusicStore`.
 *
 * ### The iframe is hidden but still 200×200
 *
 * Pushed off-screen rather than `display: none` or shrunk to 1px: a fully
 * hidden iframe makes some browsers stop loading it, and YouTube treats a
 * player smaller than 200×200 as invalid.
 */

/** States as in `YT.PlayerState`. */
export const PlayerState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const

type YTPlayer = {
  cueVideoById: (videoId: string) => void
  loadVideoById: (videoId: string) => void
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  setVolume: (volume: number) => void
  getCurrentTime: () => number
  getDuration: () => number
}

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      height: number
      width: number
      playerVars: Record<string, number | string>
      events: {
        onReady: () => void
        onStateChange: (event: { data: number }) => void
        onError: (event: { data: number }) => void
      }
    },
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

export type PlayerEvents = {
  onStateChange: (state: number) => void
  /** YouTube's error code — `101`/`150` mean the channel owner forbids embedding. */
  onError: (code: number) => void
}

let apiPromise: Promise<YTNamespace> | null = null

function loadApi(): Promise<YTNamespace> {
  apiPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT)

    // The API calls exactly this global once it has loaded — no other event.
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }

    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      apiPromise = null
      reject(new Error('không nạp được YouTube IFrame API (mất mạng?)'))
    }
    document.head.append(script)
  })
  return apiPromise
}

export async function createPlayer(events: PlayerEvents): Promise<YTPlayer> {
  const YT = await loadApi()

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '200px',
    height: '200px',
    pointerEvents: 'none',
  })
  const mount = document.createElement('div')
  host.append(mount)
  document.body.append(host)

  return new Promise((resolve) => {
    const player = new YT.Player(mount, {
      height: 200,
      width: 200,
      playerVars: {
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        playsinline: 1,
        rel: 0,
      },
      events: {
        onReady: () => resolve(player),
        onStateChange: (event) => events.onStateChange(event.data),
        onError: (event) => events.onError(event.data),
      },
    })
  })
}

/** Vietnamese on purpose: ends up in `useMusicStore`'s `error`, which is spoken. */
export function describePlayerError(code: number): string {
  switch (code) {
    case 2:
      return 'id video không hợp lệ'
    case 5:
      return 'trình duyệt không phát được video này'
    case 100:
      return 'video đã bị gỡ hoặc để riêng tư'
    case 101:
    case 150:
      return 'chủ kênh không cho phát ngoài YouTube'
    default:
      return `YouTube báo lỗi ${code}`
  }
}
