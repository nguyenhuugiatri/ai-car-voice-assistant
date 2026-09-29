/**
 * The top status bar — thin, like the top strip of the Tesla screen (time,
 * outside temperature, a few status icons). In a real car this strip holds
 * nothing you tap often, so it doesn't compete for space with the car and the
 * control panel.
 *
 * The reply and the listening/thinking state are **not** in this bar:
 * they're in `VoiceOverlay`, a separate layer over the top edge of the screen.
 * Same area, different layer — this bar is thin and static, the other one
 * thickens with the voice and only shows while talking.
 *
 * ## First-load UX
 *
 * The model is hundreds of MB to download. Progress is reported in **the
 * status bar, not a full-screen overlay**, and that's a choice rather than a
 * shortcut: a real car boots up gradually — backlight first, map later —
 * instead of blocking the driver with a loading screen. The manual buttons
 * stay usable throughout loading; the only thing locked is the mic, since
 * it's the only thing that actually needs the model.
 *
 * Shows **both `progress` and `report.text`**: the percentage tells you how
 * long is left, and WebLLM's text is the only thing that distinguishes
 * "downloading weights" from "compiling shaders" — the latter sits at 100% and
 * looks exactly like a hang.
 */

import { Bug } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import { useSessionStore } from '@/store/session-store'

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 20_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** Model load progress, or the load error. Empty once ready. */
function EngineLine() {
  const engine = useSessionStore((state) => state.engine)

  if (engine.phase === 'error') {
    return (
      <p className="text-car-danger truncate text-sm">
        Couldn't load the model: {engine.message}
      </p>
    )
  }

  if (engine.phase !== 'loading') return null

  const percent = Math.round(Math.min(1, Math.max(0, engine.progress)) * 100)

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="text-car-ink-muted shrink-0 text-sm">
        Starting system… <span className="tabular-nums">{percent}%</span>
      </span>
      <div
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="h-1 w-28 shrink-0 overflow-hidden rounded-full bg-white/8"
        role="progressbar"
      >
        <div
          className="bg-car-cold h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      {/* WebLLM's text, shown verbatim: rewording "Fetching param cache"
          into a generic sentence would erase exactly the detail used to tell
          the two phases apart. */}
      <span className="text-car-ink-faint truncate font-mono text-[11px]">
        {engine.text}
      </span>
    </div>
  )
}

export function StatusBar({
  debugShown,
  onToggleDebug,
}: {
  debugShown: boolean
  onToggleDebug: () => void
}) {
  const now = useNow()
  const debugEnabled = useSessionStore((state) => state.debugOpen)
  const eventCount = useSessionStore((state) => state.events.length)

  // `hourCycle: 'h23'`: `en-US` defaults to a 12-hour clock; the car keeps 24-hour.
  const time = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const date = now.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
  })

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 px-4 lg:px-6">
      <div className="min-w-0 flex-1">
        <EngineLine />
      </div>

      {/*
        The debug panel is a developer tool, not part of the car — so it's a
        small chip that opens a drawer, taking no fixed space. Turn it off
        entirely in the Settings screen and the chip goes away too.
      */}
      {debugEnabled && (
        <button
          aria-expanded={debugShown}
          className={cn(
            'car-focus flex h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-[13px] font-medium',
            'transition-[background-color,color] duration-150 ease-out',
            debugShown
              ? 'bg-car-surface-2 text-car-ink'
              : 'text-car-ink-muted hover:text-car-ink hover:bg-white/6',
          )}
          onClick={onToggleDebug}
          type="button"
        >
          <Bug className="size-4" />
          Debug
          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[11px] tabular-nums">
            {eventCount}
          </span>
        </button>
      )}

      <p className="flex shrink-0 items-baseline gap-3">
        <span className="text-car-ink-muted text-sm capitalize">{date}</span>
        <time
          className="text-car-ink font-gauge text-xl font-medium tabular-nums"
          dateTime={now.toISOString()}
        >
          {time}
        </time>
      </p>
    </header>
  )
}
