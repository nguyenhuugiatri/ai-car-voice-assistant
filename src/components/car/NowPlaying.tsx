/**
 * The **now playing** card — a "tab" that rises out of the dock when music is
 * playing, like the collapsed player at the bottom of the Tesla screen.
 *
 * The component only takes props; the playback source is `useMusicStore`
 * (hidden YouTube), wired up in `Dock`.
 *
 * ### Grown out of the dock, not a separate floating card
 *
 * Same black background, two rounded top corners, no bottom border, and it
 * covers exactly the 1px highlight line on the dock's top edge — so the two
 * blocks read as **one** object: the dock just grew one step taller for the
 * music. A detached floating card looks like a notification, and people wait
 * for notifications to dismiss themselves.
 *
 * The card **floats on top, it doesn't take up space** — same reason as
 * `VoicePanel`: if turning on music pushed the car in the left column up a
 * bit, the layout would jump right where people are looking.
 *
 * ### The play button must not be as bright as the talk button
 *
 * The talk button is the only thing on the dock allowed to stand out (see
 * `Dock`). The play/pause button here should just be a pale grey circle: big
 * enough to tap while driving (48px), but not competing for attention with
 * the talk button right below it.
 *
 * ### The progress bar is the seam
 *
 * Progress runs along the card's bottom edge — right where the card meets the
 * dock. A glance shows how far the song has got without an extra row; the
 * exact numbers sit on the right for anyone who wants to read them.
 */

import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type NowPlayingTrack = {
  artist: string
  /** Cover art. Without one, a colored tile with a music-note icon is used. */
  artworkUrl?: string
  durationSec: number
  title: string
}

function formatTime(totalSec: number) {
  const sec = Math.max(0, Math.floor(totalSec))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/**
 * Largest step (seconds) between two position reads that still counts as
 * "playing steadily". The store polls every 500ms (`POSITION_POLL_MS` in
 * `music-store`); this leaves 3× headroom for late ticks.
 */
const GLIDE_MAX_STEP_SEC = 1.5

/**
 * The progress bar only glides while the song moves forward in small steps.
 * Going back (track change, restart) or jumping far (seek) sets it directly:
 * a new song starts at 0, it doesn't *run backwards* to 0.
 */
function useProgressGlide(positionSec: number) {
  const [last, setLast] = useState({ glide: false, positionSec })
  if (last.positionSec !== positionSec) {
    const step = positionSec - last.positionSec
    const next = { glide: step > 0 && step <= GLIDE_MAX_STEP_SEC, positionSec }
    setLast(next)
    return next.glide
  }
  return last.glide
}

/** Three bouncing bars on the cover art — "now playing". When paused the bars sit still, low. */
function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="car-eq absolute right-1 bottom-1 flex h-3.5 items-end gap-[2px] rounded-[4px] bg-black/55 px-[3px] py-[2px]"
      data-playing={playing}
    >
      <span className="car-eq-bar" />
      <span className="car-eq-bar" />
      <span className="car-eq-bar" />
    </span>
  )
}

function ControlButton({
  children,
  label,
  onClick,
  primary = false,
}: {
  children: ReactNode
  label: string
  onClick?: () => void
  primary?: boolean
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        'car-focus flex shrink-0 cursor-pointer items-center justify-center rounded-full',
        'transition-[background-color,color,transform] duration-150 ease-(--ease-car) active:scale-95',
        primary
          ? 'text-car-ink size-12 bg-white/10 hover:bg-white/16'
          : 'text-car-ink-muted hover:text-car-ink size-11 hover:bg-white/6',
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

export function NowPlaying({
  onNext,
  onOpen,
  onPrevious,
  open,
  onTogglePlay,
  playing,
  positionSec,
  track,
}: {
  onNext?: () => void
  /** Tap on the cover art / song title — will later open the Music screen. */
  onOpen?: () => void
  onPrevious?: () => void
  /** `false` = tucked into the dock and not tappable/focusable, but still mounted. */
  open: boolean
  onTogglePlay?: () => void
  playing: boolean
  positionSec: number
  track: NowPlayingTrack
}) {
  const progress =
    track.durationSec > 0
      ? Math.min(1, Math.max(0, positionSec / track.durationSec))
      : 0
  const glide = useProgressGlide(positionSec)

  return (
    <div
      // `-1px` so the card covers the highlight line on the dock's top edge:
      // otherwise that line cuts across the card's base and the two blocks
      // become two objects again.
      className="pointer-events-none absolute inset-x-0 bottom-[calc(100%-1px)] z-10 flex justify-center px-3 lg:px-6"
    >
      <section
        aria-label="Now playing"
        data-open={open}
        // Hidden but still mounted: `inert` keeps Tab and screen readers out of
        // the buttons while they're transparent.
        inert={!open}
        className={cn(
          'car-now-playing pointer-events-auto relative w-full max-w-2xl overflow-hidden rounded-t-3xl bg-black',
          'border border-b-0 border-white/8',
        )}
      >
        <div className="flex items-center gap-3 py-2.5 pr-2.5 pl-2.5 lg:gap-4 lg:pr-4">
          <button
            aria-label={`Open Music — ${track.title}, ${track.artist}`}
            className="car-focus group flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl text-left"
            onClick={onOpen}
            type="button"
          >
            <span className="bg-car-surface relative size-12 shrink-0 overflow-hidden rounded-xl">
              {track.artworkUrl ? (
                <img
                  alt=""
                  className="car-artwork size-full object-cover"
                  height={48}
                  // `key` by URL: a track change starts a new image from transparent,
                  // rather than the old image sitting there until the new one loads.
                  key={track.artworkUrl}
                  onLoad={(event) => {
                    event.currentTarget.dataset.loaded = 'true'
                  }}
                  src={track.artworkUrl}
                  width={48}
                />
              ) : (
                <span className="from-car-voice-1 to-car-voice-4 flex size-full items-center justify-center bg-gradient-to-br">
                  <Music className="text-car-void/70 size-5" />
                </span>
              )}
              <Equalizer playing={playing} />
            </span>

            <span className="flex min-w-0 flex-col">
              <span className="text-car-ink group-hover:text-car-ink truncate text-[15px] leading-tight font-semibold">
                {track.title}
              </span>
              <span className="text-car-ink-muted truncate text-[13px] leading-snug">
                {track.artist}
              </span>
            </span>
          </button>

          <span className="font-gauge text-car-ink-faint hidden shrink-0 text-xs tabular-nums sm:block">
            {formatTime(positionSec)}
            <span className="text-car-line"> / </span>
            {formatTime(track.durationSec)}
          </span>

          <div className="flex shrink-0 items-center gap-1">
            <ControlButton label="Previous" onClick={onPrevious}>
              <SkipBack className="size-5 fill-current" />
            </ControlButton>
            <ControlButton
              label={playing ? 'Pause' : 'Play'}
              onClick={onTogglePlay}
              primary
            >
              {playing ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="size-5 translate-x-px fill-current" />
              )}
            </ControlButton>
            <ControlButton label="Next" onClick={onNext}>
              <SkipForward className="size-5 fill-current" />
            </ControlButton>
          </div>
        </div>

        {/* The seam with the dock = the progress bar. */}
        <div
          aria-label="Song progress"
          aria-valuemax={Math.round(track.durationSec)}
          aria-valuemin={0}
          aria-valuenow={Math.round(positionSec)}
          aria-valuetext={`${formatTime(positionSec)} of ${formatTime(track.durationSec)}`}
          className="absolute inset-x-5 bottom-0 h-[3px] overflow-hidden rounded-full bg-white/8"
          role="progressbar"
        >
          <div
            className={cn(
              'bg-car-ink/85 absolute inset-0 origin-left',
              // 500ms linear = exactly one position poll: as one tick ends the
              // next begins, so the bar moves continuously instead of jerking.
              glide && 'transition-transform duration-500 ease-linear',
            )}
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      </section>
    </div>
  )
}
