/**
 * The dock — a black strip stuck to the bottom edge, present on every screen,
 * like Tesla's bottom bar: `[menu] [talk] [settings]`.
 *
 * - **No temperature buttons**: temperatures sit on either side of the car in
 *   the left column (`CarStage`) — that column is also on every screen, so
 *   repeating them here would just be two sets of buttons for the same job.
 * - **Screen buttons in the middle**, with the talk button dead center. The
 *   grid opens the menu, the gear opens settings (climate opens from the menu
 *   or by voice).
 *   Replaces the old Menu ↔ "Close" button in the status bar, since
 *   every screen is now one tap away and there's no need for a back button.
 *
 * ### Screen buttons are icon-only, not lit for the open screen
 *
 * The two screen buttons stay really minimal: no label, no indicator light.
 * The talk button is the only thing on the dock allowed to stand out; the open
 * screen is already visible right above. `aria-current` is still kept for
 * screen readers.
 *
 * ### Three-column grid, not centered flex
 *
 * The talk button's label changes length with the phase ("Talk" →
 * "Loading 42%"). With flex `justify-center`, the whole row
 * shifts back and forth every time the label changes and the two screen
 * buttons jump under your finger. `grid-cols-[1fr_auto_1fr]` keeps the talk
 * button centered and the two screen buttons still; only the space in between
 * flexes.
 *
 * The voice layer (`VoiceAurora`, `VoicePanel`) is **no longer** mounted here:
 * sitting on top of the dock, it covered the lower half of the car in
 * `CarStage`. It's now anchored to the top edge of the screen, mounted in
 * `App` — see the comment in `VoiceOverlay`. This bar only keeps the call
 * on/off button, reading `callActive` straight from the store.
 */

import {
  CircleAlert,
  LayoutGrid,
  LoaderCircle,
  Mic,
  PhoneOff,
  Settings,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import type { Screen } from '@/domain/car-state'
import { cn } from '@/lib/utils'
import { artworkUrl } from '@/music/catalog'
import { useCarStore } from '@/store/car-store'
import { prepareMusic, useMusicStore } from '@/store/music-store'
import { runCommand } from '@/store/run-command'
import { useSessionStore } from '@/store/session-store'

import { NowPlaying } from './NowPlaying'

/** Button that opens a screen. Goes through `runCommand`, like the voice `navigate_to` command. */
function ScreenButton({
  children,
  label,
  target,
}: {
  children: ReactNode
  label: string
  target: Screen
}) {
  const current = useCarStore((state) => state.screen === target)

  return (
    <button
      aria-current={current ? 'page' : undefined}
      aria-label={label}
      className={cn(
        'car-focus flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-2xl',
        'text-car-ink-muted hover:text-car-ink hover:bg-white/4',
        'transition-[background-color,color,transform] duration-150 ease-(--ease-car) active:scale-95',
      )}
      onClick={() => runCommand((car) => car.navigateTo(target))}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

/**
 * The talk button — the main action of the whole product, so it's the only
 * button on the dock with text, and it sits dead center.
 *
 * The label **changes with the engine phase** instead of just dimming while
 * loading. This page loads the model as soon as it opens, so the "can't press
 * it" window lasts tens of seconds and always falls right when people have
 * just opened it and want to use it. A dimmed, unlabeled button there reads
 * as "broken"; the same button saying "Loading 42%" reads as "almost done".
 *
 * While loading, the button itself **fills up** from left to right with the
 * progress — a `scaleX` background layer like the wedge in `LevelMeter`,
 * running on the compositor. The number can be read, the fill can be glanced
 * at: the button is about to light up fully into the "Talk" button.
 *
 * During a conversation, the same button becomes the end button — right where
 * the hand just tapped — with a blinking red dot like a "recording" light: an
 * open mic is something the user must know without having to look up at the
 * voice layer on the top edge.
 */
function VoiceButton({
  active,
  onToggle,
}: {
  active: boolean
  onToggle: (active: boolean) => void
}) {
  const engine = useSessionStore((state) => state.engine)
  const ready = engine.phase === 'ready'
  const loading = engine.phase === 'loading'
  const failed = engine.phase === 'error'
  const progress = loading ? Math.min(1, Math.max(0, engine.progress)) : 0

  const label = active
    ? 'End'
    : ready
      ? 'Talk'
      : loading
        ? `Loading ${Math.round(progress * 100)}%`
        : failed
          ? 'Model error'
          : 'Preparing…'

  const title = active
    ? 'End conversation (Esc)'
    : ready
      ? 'Continuous conversation — the mic reopens after each turn'
      : failed
        ? `Couldn't load the model: ${engine.message}`
        : 'Loading model — anything said now goes nowhere'

  const icon = active ? (
    <PhoneOff className="size-5 shrink-0" />
  ) : ready ? (
    <Mic className="size-5 shrink-0" />
  ) : failed ? (
    <CircleAlert className="size-5 shrink-0" />
  ) : (
    <LoaderCircle className="size-5 shrink-0 animate-spin" />
  )

  return (
    <button
      aria-label={
        active
          ? 'End conversation'
          : ready
            ? 'Start conversation'
            : `Not ready — ${label}`
      }
      className={cn(
        'car-focus relative isolate flex h-14 min-w-44 cursor-pointer items-center justify-center gap-2.5 overflow-hidden rounded-full px-7 lg:min-w-52',
        'text-[15px] font-semibold tabular-nums',
        'transition-[background-color,color,box-shadow,transform] duration-150 ease-(--ease-car) active:scale-[0.97]',
        active &&
          'bg-car-danger/15 text-car-danger hover:bg-car-danger/25 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-car-danger)_40%,transparent)]',
        !active &&
          ready &&
          'bg-car-ink text-car-void shadow-[0_8px_24px_-12px_var(--color-car-cold)] hover:bg-white',
        !active &&
          !ready &&
          'bg-car-surface text-car-ink-muted shadow-[inset_0_0_0_1px_oklch(1_0_0/6%)]',
        // No generic `disabled:` dimming here: this button is locked because
        // it's *loading*, not permanently disabled, so it keeps full text
        // contrast to keep the number readable.
        'disabled:cursor-progress disabled:active:scale-100',
        failed && !active && 'text-car-danger disabled:cursor-not-allowed',
      )}
      disabled={!active && !ready}
      onClick={() => onToggle(!active)}
      title={title}
      type="button"
    >
      {loading && !active && (
        <span
          aria-hidden="true"
          className="bg-car-cold/20 absolute inset-0 -z-10 origin-left transition-transform duration-300 ease-(--ease-car)"
          style={{ transform: `scaleX(${progress})` }}
        />
      )}

      {active && (
        <span aria-hidden="true" className="relative flex size-2 shrink-0">
          <span className="bg-car-danger absolute inset-0 animate-ping rounded-full opacity-60" />
          <span className="bg-car-danger relative size-2 rounded-full" />
        </span>
      )}
      {icon}
      <span>{label}</span>
    </button>
  )
}

/**
 * The now-playing card wired to `useMusicStore`.
 *
 * Split into its own component because the playback position updates every
 * 500ms: reading the store directly in `Dock` would re-render the talk button
 * and both screen buttons at that rate.
 */
function DockNowPlaying() {
  const visible = useMusicStore((state) => state.visible)
  const track = useMusicStore((state) => state.queue[state.index])
  const playing = useMusicStore((state) => state.playing)
  const positionSec = useMusicStore((state) => state.positionSec)
  const durationSec = useMusicStore((state) => state.durationSec)
  const togglePlay = useMusicStore((state) => state.togglePlay)
  const next = useMusicStore((state) => state.next)
  const previous = useMusicStore((state) => state.previous)

  // Load the player on open rather than waiting for a tap — see the comment in
  // `music-store`.
  useEffect(() => {
    void prepareMusic()
  }, [])

  // Don't unmount the card when hidden — unmounted, there'd be nothing left to
  // animate out.
  if (!track) return null

  return (
    <NowPlaying
      onNext={next}
      onPrevious={previous}
      open={visible}
      onTogglePlay={togglePlay}
      playing={playing}
      positionSec={positionSec}
      track={{
        artist: track.artist,
        artworkUrl: artworkUrl(track.id),
        durationSec,
        title: track.title,
      }}
    />
  )
}

export function Dock() {
  const callActive = useSessionStore((state) => state.callActive)
  const setCallActive = useSessionStore((state) => state.setCallActive)

  return (
    <nav
      aria-label="Controls"
      // The bar sticks to the bottom at every size: it's the last child of the
      // `h-dvh` frame in `App` and `shrink-0`, while scrolling stays contained
      // in its siblings above — so no `fixed`/`sticky` needed, and long
      // content can't push it anywhere.
      //
      // `env(safe-area-inset-bottom)` is for the home indicator on iPhone: a
      // bottom-stuck bar with no room left would put the lowest buttons right
      // under the swiping finger.
      className="relative z-10 shrink-0 bg-black px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:px-6"
    >
      <DockNowPlaying />

      {/* Thin top border, strongest in the middle and fading out toward both
          edges — the bar reads as a raised block around the talk button, not
          a line cutting across the screen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent"
      />
      <div className="mx-auto grid max-w-2xl grid-cols-[1fr_auto_1fr] items-center gap-3 lg:gap-6">
        <div className="flex justify-end">
          <ScreenButton label="Menu" target="home">
            <LayoutGrid className="size-6" />
          </ScreenButton>
        </div>
        <VoiceButton active={callActive} onToggle={setCallActive} />
        <div className="flex justify-start">
          <ScreenButton label="Settings" target="settings">
            <Settings className="size-6" />
          </ScreenButton>
        </div>
      </div>
    </nav>
  )
}
