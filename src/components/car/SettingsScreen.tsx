/**
 * The `settings` screen — it exists because model choice and the debug panel
 * toggle needed somewhere to live, not for decoration.
 *
 * There is **no** manual `persona` `state` picker here: the persona is driven
 * by the real voice loop, so a manual picker could only lie.
 *
 * Switching models is an operation that **takes tens of seconds**, not
 * flipping a switch: `useEngineBoot` sees `modelId` change and reloads from
 * scratch. So loading progress now shows **right inside the card just
 * tapped**, not only in the status bar above — that's exactly where the
 * person who just tapped is looking.
 *
 * ## Why `<select>` was dropped
 *
 * A native dropdown on the car screen is a list of 13px text drawn by the OS,
 * following none of our tokens, and it hides the most important thing when
 * choosing: **each model's label and size**. Comparing two models would mean
 * trying each one — and trying a WebLLM model costs tens of seconds of
 * loading. Radio cards lay everything out at once, each ≥ 64px so a thumb
 * still hits it.
 */

import {
  Bug,
  Check,
  Cloud,
  Cpu,
  HardDrive,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/utils'
import { useCarStore } from '@/store/car-store'
import {
  MODEL_OPTIONS,
  useSessionStore,
  type ModelId,
  type ModelProvider,
} from '@/store/session-store'

import { Panel, SectionLabel } from './ui-bits'

const PROVIDER_GROUPS: {
  icon: ReactNode
  id: ModelProvider
  label: string
}[] = [
  {
    icon: <Cloud className="size-4" />,
    id: 'openai',
    label: 'Cloud',
  },
  {
    icon: <HardDrive className="size-4" />,
    id: 'webllm',
    label: 'On-device',
  },
]

/** Load status, attached to the selected card. */
function EngineStatusLine() {
  const engine = useSessionStore((state) => state.engine)
  const debugOpen = useSessionStore((state) => state.debugOpen)

  if (engine.phase === 'loading') {
    // Cloud models have no percentage to show — a static `0%` looks exactly
    // like a stalled load. Until there's a number, say it in words and show
    // indeterminate progress with a spinning icon, rather than an empty bar.
    const percent = Math.round(engine.progress * 100)
    return (
      <div className="space-y-1.5">
        <p className="text-car-cold flex items-center gap-1.5 text-xs font-medium">
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          <span className="truncate tabular-nums">
            {engine.progress > 0 ? `Loading… ${percent}%` : 'Preparing…'}
          </span>
        </p>
        {engine.progress > 0 && (
          <div
            aria-label="Model download progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percent}
            className="h-1 overflow-hidden rounded-full bg-white/8"
            role="progressbar"
          >
            {/* `scaleX` rather than `width`: progress ticks don't trigger layout. */}
            <div
              className="bg-car-cold h-full origin-left rounded-full transition-transform duration-300 ease-(--ease-car)"
              style={{ transform: `scaleX(${engine.progress})` }}
            />
          </div>
        )}
      </div>
    )
  }

  if (engine.phase === 'error') {
    // The raw error message (env var names, WebGPU stack) only means something
    // to devs — only shown once developer mode is on.
    return (
      <span className="block space-y-1">
        <span className="text-car-danger flex items-start gap-1.5 text-xs font-medium">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          Couldn't load
        </span>
        {debugOpen && (
          <span className="text-car-ink-faint line-clamp-2 block font-mono text-[11px]">
            {engine.message}
          </span>
        )}
      </span>
    )
  }

  // `ready` and `cold`: show nothing — the card only speaks up while loading or
  // on error; "Ready" / "Not loaded" would just be clutter on the card just
  // selected.
  return null
}

function ModelCard({
  checked,
  label,
  onSelect,
  size,
  tag,
}: {
  checked: boolean
  label: string
  onSelect: () => void
  size: string | null
  tag: string | null
}) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        'car-focus group flex min-h-16 w-full cursor-pointer flex-col justify-center gap-1.5 rounded-2xl border p-3 text-left',
        'transition-[background-color,border-color,transform] duration-150 ease-(--ease-car)',
        'active:scale-[0.98]',
        checked
          ? 'border-car-cold/60 bg-car-surface-2'
          : 'bg-car-void/40 border-white/5 hover:border-white/10 hover:bg-white/5',
      )}
      // Roving tabindex: tabbing into the group lands on the selected model,
      // arrow keys move between cards (see `ModelPicker`'s `onKeyDown`).
      data-model-radio=""
      onClick={onSelect}
      role="radio"
      tabIndex={checked ? 0 : -1}
      type="button"
    >
      <span className="flex w-full items-center gap-3">
        {/* Radio dot — changes color and `scale`, not border-width (see `ui-bits`). */}
        <span
          aria-hidden="true"
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
            checked ? 'border-car-cold' : 'border-car-line',
          )}
        >
          <span
            className={cn(
              'bg-car-cold size-2 rounded-full transition-transform duration-150 ease-(--ease-car)',
              checked ? 'scale-100' : 'scale-0',
            )}
          />
        </span>
        <span
          className={cn(
            'truncate text-sm font-medium',
            checked
              ? 'text-car-ink'
              : 'text-car-ink-muted group-hover:text-car-ink',
          )}
        >
          {label}
        </span>
        {tag && (
          <span className="text-car-cold bg-car-cold/10 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
            {tag}
          </span>
        )}
        {size && (
          <span className="text-car-ink-faint ml-auto shrink-0 text-xs tabular-nums">
            {size}
          </span>
        )}
      </span>
      {checked && (
        // Indented by exactly the radio dot + gap, so the status line aligns with the name.
        // `empty:hidden`: an empty status line doesn't leave a stray `gap`.
        <span className="block w-full pl-7 empty:hidden">
          <EngineStatusLine />
        </span>
      )}
    </button>
  )
}

function ModelPicker() {
  const modelId = useSessionStore((state) => state.modelId)
  const setModelId = useSessionStore((state) => state.setModelId)
  const groupRef = useRef<HTMLDivElement>(null)

  /**
   * Arrow keys **only move focus**, they don't select — a deliberate departure
   * from the ARIA radio pattern. In the standard pattern, moving across three
   * cards means three model switches, i.e. three loads of tens of seconds each
   * cancelled mid-way. Selecting is Enter/Space, like pressing a button.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1 }[
      event.key
    ]
    if (step === undefined) return
    const radios = Array.from(
      groupRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-model-radio]',
      ) ?? [],
    )
    const index = radios.indexOf(document.activeElement as HTMLButtonElement)
    if (index === -1) return
    event.preventDefault()
    radios[(index + step + radios.length) % radios.length]?.focus()
  }

  return (
    <div
      aria-label="Choose AI model"
      className="space-y-4"
      onKeyDown={onKeyDown}
      ref={groupRef}
      role="radiogroup"
    >
      {PROVIDER_GROUPS.map((group) => (
        <div className="space-y-2" key={group.id}>
          <span className="text-car-ink-muted flex items-center gap-1.5 text-[13px] font-medium">
            {group.icon}
            {group.label}
          </span>
          <div className="grid gap-2 @lg:grid-cols-2">
            {MODEL_OPTIONS.filter((option) => option.provider === group.id).map(
              (option) => (
                <ModelCard
                  checked={option.id === modelId}
                  key={option.id}
                  // The parenthetical notes ("(default)", "(on-device)") are
                  // already conveyed by the tag and the group name — like the
                  // Settings card in `MenuScreen`.
                  label={option.label.replace(/\s*\(.*\)$/, '')}
                  onSelect={() => setModelId(option.id as ModelId)}
                  size={option.size}
                  tag={option.tag}
                />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A settings row: icon, title, explanation — the control sits on the right. */
function SettingRow({
  children,
  hint,
  icon,
  title,
}: {
  children: ReactNode
  hint: string
  icon: ReactNode
  title: string
}) {
  return (
    <Panel className="flex items-center gap-4 p-4">
      <span className="bg-car-surface-2 text-car-ink-muted flex size-10 shrink-0 items-center justify-center rounded-xl">
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <h2 className="text-car-ink text-sm font-semibold">{title}</h2>
        <p className="text-car-ink-muted text-xs">{hint}</p>
      </div>
      {children}
    </Panel>
  )
}

/**
 * `role="switch"` rather than a button whose text flips back and forth: screen
 * readers need to know this is a switch *and* which position it's in, not
 * infer it from the label. Drawn as a track with a knob because that's the
 * shape the eye reads as "on/off" in a single glance.
 */
function DebugSwitch() {
  const debugOpen = useSessionStore((state) => state.debugOpen)
  const toggleDebug = useSessionStore((state) => state.toggleDebug)

  return (
    <button
      aria-checked={debugOpen}
      aria-label="Dev mode"
      // 44px hit area, the track inside only 28px — the hit area is bigger than the drawing.
      className="car-focus flex h-11 w-16 shrink-0 cursor-pointer items-center justify-center rounded-full"
      onClick={toggleDebug}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          'relative h-7 w-12 rounded-full transition-[background-color,box-shadow] duration-150 ease-(--ease-car)',
          debugOpen ? 'bg-car-cold car-glow-cold' : 'bg-car-surface-2',
        )}
      >
        <span
          className={cn(
            'absolute top-1 left-1 size-5 rounded-full shadow-sm transition-transform duration-150 ease-(--ease-car)',
            debugOpen
              ? 'bg-car-cold-ink translate-x-5'
              : 'bg-car-ink-muted translate-x-0',
          )}
        />
      </span>
    </button>
  )
}

/**
 * Reset **takes two taps**. If one slipped tap on a bumpy road wiped the whole
 * car state, nothing would signal that anything had just happened. No dialog:
 * a dialog covers the screen and makes the driver read a sentence; changing
 * the text right on the button keeps the thumb in the right place for the
 * second tap.
 */
function ResetButton() {
  const reset = useCarStore((state) => state.reset)
  const [phase, setPhase] = useState<'idle' | 'armed' | 'done'>('idle')

  useEffect(() => {
    if (phase === 'idle') return
    const timer = setTimeout(
      () => setPhase('idle'),
      phase === 'armed' ? 3000 : 1600,
    )
    return () => clearTimeout(timer)
  }, [phase])

  const onClick = () => {
    if (phase === 'armed') {
      reset()
      setPhase('done')
    } else {
      setPhase('armed')
    }
  }

  return (
    <button
      aria-live="polite"
      className={cn(
        'car-focus flex h-11 min-w-32 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium',
        'transition-[background-color,color,transform] duration-150 ease-(--ease-car) active:scale-[0.97]',
        phase === 'idle' &&
          'bg-car-surface-2 text-car-ink-muted hover:text-car-ink',
        phase === 'armed' && 'bg-car-danger/20 text-car-danger',
        phase === 'done' && 'bg-car-surface-2 text-car-signal-tell',
      )}
      onClick={onClick}
      type="button"
    >
      {phase === 'done' ? (
        <>
          <Check className="size-4" />
          Reset done
        </>
      ) : phase === 'armed' ? (
        'Tap again'
      ) : (
        'Reset'
      )}
    </button>
  )
}

export function SettingsScreen() {
  return (
    <div className="grid content-start gap-3 @2xl:grid-cols-2 @2xl:gap-4">
      <Panel className="space-y-4 p-5 @2xl:col-span-2">
        <SectionLabel icon={<Cpu className="size-4" />} size="title">
          AI model
        </SectionLabel>
        <ModelPicker />
      </Panel>

      <SettingRow
        hint="Show technical details"
        icon={<Bug className="size-5" />}
        title="Dev mode"
      >
        <DebugSwitch />
      </SettingRow>

      <SettingRow
        hint="Back to how it started"
        icon={<RotateCcw className="size-5" />}
        title="Reset car"
      >
        <ResetButton />
      </SettingRow>
    </div>
  )
}
