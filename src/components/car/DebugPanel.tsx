/**
 * Debug panel — off by default, can be turned on in the Settings screen. On
 * the landscape screen it's a floating drawer opened from the Debug chip, not
 * a fixed part of the layout.
 *
 * Each event shows three columns (what the speaker said, the raw tool call
 * JSON, latency), and the panel adds two more things:
 *
 * - **Command text box.** A text input path, parallel to the mic, going
 *   through the very same `runVoiceCommand`. It lives here rather than in the
 *   Settings screen because this is where you *read* the results — if typing
 *   and reading were a screen switch apart, nobody could use it for debugging.
 *   It's also the only way to exercise the loop when speaking aloud isn't
 *   convenient.
 * - **Per-step timings.** A single total can't tell "the model is slow" apart
 *   from "it spent an extra retry turn", and that's the real question when
 *   watching 4 s go by.
 *
 * This is **a tool for the developer standing next to the car**, so it's
 * treated as a tool rather than decoration: text big enough to read without
 * leaning in (the previous version was 10px), close and clear buttons with
 * 44px hit areas, and each event split into labeled lines instead of one
 * pasted JSON blob. When measuring latency, `ms` is the number that has to
 * jump out at a glance — so it's styled as a number, not blended into the
 * rest.
 */

import { CornerDownLeft, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import { useCarStore } from '@/store/car-store'
import { runVoiceCommand } from '@/store/run-voice-command'
import { useSessionStore } from '@/store/session-store'

const SOURCE_META = {
  manual: { label: 'touch', className: 'bg-white/10 text-car-ink-muted' },
  voice: { label: 'voice', className: 'bg-car-cold/25 text-car-cold' },
  text: { label: 'typed', className: 'bg-car-heat/25 text-car-heat' },
} as const

/** One `key=value` pair of the state line. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-car-ink-faint">{label}</span>
      <span className="text-car-ink-muted">=</span>
      <span className="text-car-ink">{value}</span>
    </span>
  )
}

function StateLine() {
  const state = useCarStore()

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-xl bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed">
      <Field label="screen" value={state.screen} />
      <Field
        label="temp"
        value={`${state.temperature.driver}/${state.temperature.passenger}`}
      />
      <Field label="fan" value={String(state.fanSpeed)} />
      <Field
        label="seat"
        value={`${state.seatHeat.driver}/${state.seatHeat.passenger}`}
      />
      <Field label="ac" value={String(state.acOn)} />
      <Field label="recirc" value={String(state.recirculationOn)} />
      <Field
        label="defrost"
        value={`${String(state.frontDefrostOn)}/${String(state.rearDefrostOn)}`}
      />
    </div>
  )
}

/** The text input path — same loop as the mic, only the `source` differs. */
function TextCommandInput() {
  const [text, setText] = useState('')
  const engine = useSessionStore((state) => state.engine)
  const ready = engine.phase === 'ready'

  return (
    <form
      className="flex shrink-0 items-center gap-2 px-3 pb-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || !text.trim()) return
        void runVoiceCommand(text, 'text')
        setText('')
      }}
    >
      <input
        aria-label="Type a command instead of speaking"
        className="car-focus bg-car-void/60 text-car-ink placeholder:text-car-ink-faint h-11 min-w-0 flex-1 rounded-xl border border-white/8 px-3 text-sm disabled:opacity-50"
        disabled={!ready}
        onChange={(event) => setText(event.target.value)}
        placeholder={ready ? 'Type a command: nóng quá' : 'Loading model…'}
        value={text}
      />
      <button
        aria-label="Run command"
        className="car-focus bg-car-surface-2 text-car-ink-muted hover:text-car-ink flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!ready || !text.trim()}
        type="submit"
      >
        <CornerDownLeft className="size-4" />
      </button>
    </form>
  )
}

export function DebugPanel({ onClose }: { onClose: () => void }) {
  const events = useSessionStore((state) => state.events)
  const clearEvents = useSessionStore((state) => state.clearEvents)

  return (
    // Floating drawer on the right, opened from the Debug chip in the status
    // bar. It takes no fixed space: a real car has no such panel, so the car's
    // layout has to hold up with it closed.
    <aside
      aria-label="Debug panel"
      className="bg-car-void/90 flex max-h-full min-h-0 flex-col rounded-3xl border border-white/10 shadow-2xl shadow-black/60 backdrop-blur-xl"
    >
      <div className="flex shrink-0 items-center gap-1 px-2 pt-1">
        <p className="text-car-ink-muted flex flex-1 items-center gap-2 px-2 text-xs font-medium">
          Debug
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] tabular-nums">
            {events.length}
          </span>
        </p>

        <button
          aria-label="Clear debug log"
          className="car-focus text-car-ink-faint hover:text-car-danger disabled:hover:text-car-ink-faint flex size-11 cursor-pointer items-center justify-center rounded-xl transition-colors duration-150 hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          disabled={events.length === 0}
          onClick={clearEvents}
          type="button"
        >
          <Trash2 className="size-4" />
        </button>
        <button
          aria-label="Close debug panel"
          className="car-focus text-car-ink-muted hover:text-car-ink flex size-11 cursor-pointer items-center justify-center rounded-xl transition-colors duration-150 hover:bg-white/8"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

      <TextCommandInput />

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pb-3">
        <StateLine />

        {events.length === 0 ? (
          <p className="text-car-ink-faint px-1 py-2 text-xs">
            No commands yet. Tap any button to see its{' '}
            <span className="font-mono">ToolResult</span>.
          </p>
        ) : (
          events.map((event) => {
            const source = SOURCE_META[event.source]

            return (
              <div
                className="space-y-1 rounded-xl border border-white/5 bg-white/4 p-2.5 font-mono text-[11px] leading-relaxed"
                key={event.id}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 font-sans text-[10px] font-medium',
                      source.className,
                    )}
                  >
                    {source.label}
                  </span>
                  <span className="text-car-ink-faint tabular-nums">
                    {new Date(event.at).toLocaleTimeString('en-GB', {
                      hour12: false,
                    })}
                  </span>
                  {event.retried && (
                    <span className="bg-car-heat/20 text-car-heat rounded px-1.5 py-0.5 font-sans text-[10px] font-medium">
                      retry
                    </span>
                  )}
                  {event.latencyMs !== undefined && (
                    <span className="text-car-ink ml-auto rounded bg-white/8 px-1.5 py-0.5 tabular-nums">
                      {event.latencyMs} ms
                    </span>
                  )}
                </div>

                {event.steps && event.steps.length > 0 && (
                  <div className="text-car-ink-faint flex flex-wrap gap-x-2">
                    {event.steps.map((step) => (
                      <span key={step.label}>
                        {step.label}
                        <span className="text-car-ink-muted">
                          {' '}
                          {step.ms} ms
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                {event.input && (
                  <p className="text-car-ink font-sans text-[13px]" lang="vi">
                    “{event.input}”
                  </p>
                )}
                {event.rawToolCall && (
                  <p className="text-car-cold break-all">{event.rawToolCall}</p>
                )}
                {event.result && (
                  <p className="text-car-ink-muted break-all">
                    {JSON.stringify(event.result)}
                  </p>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
