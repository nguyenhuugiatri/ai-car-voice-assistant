/**
 * **Menu** — where you go to reach the other screens.
 *
 * This used to be the opening screen ("home"); climate holds that spot now,
 * and this screen has fallen back to the role it always played: the way to
 * the other screens. Renamed after what it does, not the position it used to
 * occupy.
 *
 * Its `Screen` value is still `'home'` in code — see the note on `SCREENS` in
 * `car-state.ts`: that string is a token for the model, not a label.
 *
 * ### Two tiers, not one flat grid
 *
 * The previous version was a grid of seven same-sized tiles, real ones and
 * unbuilt ones differing only in how faded they were. The person demoing still
 * had to *compare* each tile to know which could be tapped — exactly what this
 * screen must not make anyone do. Now they're fully separated:
 *
 * - **Real tiles** are large cards with **live data** from the screen they
 *   open (temperature, model status). A glance tells you where a tap leads,
 *   and the card isn't just a big icon: it answers up front the question
 *   people open that screen to ask.
 * - **Unbuilt tiles** are small, dashed-bordered, backgroundless, grouped
 *   under the "Coming soon" label. A dashed border is the familiar
 *   "placeholder" convention; with no background they never stand out as much
 *   as the real cards, even on hover.
 *
 * Unbuilt tiles stay here because they're context for the `navigate_to`
 * command, and they show that the menu isn't an empty screen.
 *
 * ### Tapping an unbuilt tile has to show something
 *
 * `setStatusLine` only shows inside the voice card, and that card isn't there
 * when no call is active — so tapping the "Music" tile while idle used
 * to be tapping into the void. Now the screen says it itself right below the
 * grid, in a line with reserved height so the grid doesn't jump when the text
 * appears.
 */

import {
  Camera,
  Car,
  ChevronRight,
  Info,
  Music,
  Navigation,
  Phone,
  Radio,
  Settings,
} from 'lucide-react'
import NumberFlow, { NumberFlowGroup } from '@number-flow/react'
import type { ComponentType, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import { useCarStore } from '@/store/car-store'
import { useMusicStore } from '@/store/music-store'
import { runCommand } from '@/store/run-command'
import { MODEL_OPTIONS, useSessionStore } from '@/store/session-store'

import { SectionLabel } from './ui-bits'

const SOON: { icon: ComponentType<{ className?: string }>; label: string }[] = [
  { icon: Navigation, label: 'Maps' },
  { icon: Phone, label: 'Phone' },
  { icon: Radio, label: 'Radio' },
  { icon: Camera, label: 'Camera' },
]

/** The "not available" notice dismisses itself after this long — enough to read one short line. */
const NOTICE_MS = 3200

/**
 * Card that opens a real screen.
 *
 * `aside` is the live data on the right. The chevron nudges right on hover —
 * `transform` only, no box change — so the card reads as "go to", not as a
 * switch.
 */
function AppCard({
  aside,
  detail,
  icon,
  label,
  onClick,
  pressed,
}: {
  aside?: ReactNode
  detail: ReactNode
  icon: ReactNode
  label: string
  onClick: () => void
  /** Only for toggle cards (Music) — leave empty for cards that open a screen. */
  pressed?: boolean
}) {
  return (
    <button
      aria-pressed={pressed}
      className={cn(
        'car-focus group flex min-h-28 w-full cursor-pointer items-center gap-4 rounded-3xl p-4 text-left lg:min-h-32 lg:p-5',
        'bg-car-surface/70 text-car-ink border border-white/5',
        'transition-[background-color,transform,border-color] duration-150 ease-(--ease-car)',
        'hover:bg-car-surface-2 hover:border-white/10 active:scale-[0.98]',
      )}
      onClick={onClick}
      type="button"
    >
      <span className="bg-car-cold/12 text-car-cold flex size-12 shrink-0 items-center justify-center rounded-2xl lg:size-14">
        {icon}
      </span>

      <span className="min-w-0 flex-1 space-y-1">
        <span className="block text-base font-semibold lg:text-lg">
          {label}
        </span>
        <span className="text-car-ink-muted block truncate text-[13px] lg:text-sm">
          {detail}
        </span>
      </span>

      {aside}

      <ChevronRight
        aria-hidden="true"
        className="text-car-ink-faint size-5 shrink-0 transition-transform duration-150 ease-(--ease-car) group-hover:translate-x-0.5"
      />
    </button>
  )
}

/** Tile with no screen yet. Dashed border, no background: a placeholder, not pretending to be a real tile. */
function SoonTile({
  icon: Icon,
  label,
  onClick,
  picked,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  picked: boolean
}) {
  return (
    <button
      aria-describedby="menu-soon-label"
      className={cn(
        'car-focus flex h-24 min-w-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl lg:h-28',
        'text-car-ink-muted border border-dashed',
        'transition-[border-color,color,transform] duration-150 ease-(--ease-car)',
        'hover:text-car-ink active:scale-[0.97]',
        picked
          ? 'border-car-line text-car-ink'
          : 'border-white/10 hover:border-white/20',
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="text-car-ink-faint size-6 lg:size-7" />
      <span className="max-w-full truncate px-1 text-[13px] font-medium">
        {label}
      </span>
    </button>
  )
}

export function MenuScreen() {
  const setStatusLine = useSessionStore((state) => state.setStatusLine)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  /** Tile with no screen yet — say so plainly, both on screen and in the voice card. */
  const notBuilt = (label: string) => {
    const text = `${label} isn't in this build yet`
    setNotice(label)
    setStatusLine({ phase: 'failed', text })
  }

  return (
    <div className="space-y-6">
      <section aria-label="Apps" className="space-y-3">
        <SectionLabel className="px-1" size="title">
          Apps
        </SectionLabel>
        <div className="grid gap-3 @2xl:grid-cols-2 @2xl:gap-4">
          <CarCard />
          <MusicCard />
          <SettingsCard />
        </div>
      </section>

      <section aria-labelledby="menu-soon-label" className="space-y-3">
        <SectionLabel className="px-1">
          <span id="menu-soon-label">Coming soon</span>
        </SectionLabel>
        <div className="grid grid-cols-3 gap-3 @2xl:grid-cols-5 @2xl:gap-4">
          {SOON.map((item) => (
            <SoonTile
              icon={item.icon}
              key={item.label}
              label={item.label}
              onClick={() => notBuilt(item.label)}
              picked={notice === item.label}
            />
          ))}
        </div>

        {/* Reserve one line of height: the text appearing doesn't push anything down. */}
        <p
          className="text-car-ink-muted flex min-h-5 items-center gap-1.5 px-1 text-[13px]"
          role="status"
        >
          {notice !== null && (
            <>
              <Info aria-hidden="true" className="text-car-ink-faint size-4" />
              {notice} isn't in this build yet.
            </>
          )}
        </p>
      </section>
    </div>
  )
}

/** Car card — opens climate, and previews temperature, fan and A/C. */
function CarCard() {
  const temperature = useCarStore((state) => state.temperature)
  const fanSpeed = useCarStore((state) => state.fanSpeed)
  const acOn = useCarStore((state) => state.acOn)

  const sameTemp = temperature.driver === temperature.passenger
  const detail = [
    fanSpeed === 0 ? 'Fan off' : `Fan ${fanSpeed}`,
    acOn ? 'A/C on' : 'A/C off',
  ].join(' · ')

  return (
    <AppCard
      aside={
        <span
          aria-label={
            sameTemp
              ? `Temperature ${temperature.driver} degrees`
              : `Temperature ${temperature.driver} and ${temperature.passenger} degrees`
          }
          className="font-gauge text-car-ink shrink-0 text-3xl font-semibold tabular-nums lg:text-4xl"
        >
          <NumberFlowGroup>
            <NumberFlow suffix="°" value={temperature.driver} />
            {!sameTemp && (
              <>
                {' · '}
                <NumberFlow suffix="°" value={temperature.passenger} />
              </>
            )}
          </NumberFlowGroup>
        </span>
      }
      detail={detail}
      icon={<Car className="size-6 lg:size-7" />}
      label="Car"
      onClick={() => runCommand((car) => car.navigateTo('climate'))}
    />
  )
}

/**
 * Music card — tap to show the now-playing card on the dock and play the
 * current song; tap again to stop and hide it. There's no dedicated Music
 * screen yet, so this is the only way (besides voice) to turn music on/off.
 */
function MusicCard() {
  const track = useMusicStore((state) => state.queue[state.index])
  const playing = useMusicStore((state) => state.playing)
  const visible = useMusicStore((state) => state.visible)
  const toggleOpen = useMusicStore((state) => state.toggleOpen)

  return (
    <AppCard
      aside={
        playing ? (
          <span className="text-car-ink-muted shrink-0 text-[13px] font-medium lg:text-sm">
            Playing
          </span>
        ) : undefined
      }
      detail={track ? `${track.title} · ${track.artist}` : 'No track'}
      icon={<Music className="size-6 lg:size-7" />}
      label="Music"
      onClick={toggleOpen}
      pressed={visible}
    />
  )
}

/** Settings card — previews the selected model and whether it has finished loading. */
function SettingsCard() {
  const modelId = useSessionStore((state) => state.modelId)
  const engine = useSessionStore((state) => state.engine)

  const model = MODEL_OPTIONS.find((option) => option.id === modelId)

  // `ready`: show nothing — "Ready" would just be clutter on the card.
  const status =
    engine.phase === 'ready'
      ? null
      : engine.phase === 'loading'
        ? {
            dot: 'bg-car-heat animate-pulse',
            text:
              engine.progress > 0
                ? `Loading ${Math.round(engine.progress * 100)}%`
                : 'Loading',
          }
        : engine.phase === 'error'
          ? { dot: 'bg-car-danger', text: 'Load failed' }
          : { dot: 'bg-car-ink-faint', text: 'Not loaded' }

  return (
    <AppCard
      aside={
        status && (
          <span className="text-car-ink-muted flex shrink-0 items-center gap-2 text-[13px] font-medium tabular-nums lg:text-sm">
            <span
              aria-hidden="true"
              className={cn('size-2 rounded-full', status.dot)}
            />
            {status.text}
          </span>
        )
      }
      // Drop the parenthetical note ("(default)", "(on-device)"): the card has
      // only one line, and that note pushes the model name itself out of the
      // frame.
      detail={model?.label.replace(/\s*\(.*\)$/, '') ?? modelId}
      icon={<Settings className="size-6 lg:size-7" />}
      label="Settings"
      onClick={() => runCommand((car) => car.navigateTo('settings'))}
    />
  )
}
