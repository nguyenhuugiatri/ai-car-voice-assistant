/**
 * Reusable UI bits for the head unit. Deliberately not shadcn components:
 * buttons on a car screen are bigger, rounder, and have only two states,
 * on/off — shadcn's `Button` package can't express the latter.
 *
 * Rules for the whole file, and the reason they're gathered here instead of
 * scattered across each screen:
 *
 * - **No tap target smaller than 44px.** This is a screen tapped while
 *   driving, with a thumb, on a bumpy road. A 32px button is a missed tap, and
 *   a missed tap on the climate screen means the driver looks down a second
 *   time.
 * - **Every button has `car-focus`.** None of the buttons here is a shadcn
 *   `<button>`, so nothing provides a focus ring out of the box; without it,
 *   keyboard navigation through the head unit loses track.
 * - **Touch feedback doesn't change the box size.** Change color and `scale`,
 *   not padding or border-width: `scale` doesn't drag the surrounding layout
 *   along, border does.
 */

import type {
  ComponentProps,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from 'react'
import { useRef } from 'react'

import { cn } from '@/lib/utils'

/** Shared background of a content block. The second of three surface levels. */
export function Panel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'bg-car-surface/70 rounded-3xl border border-white/5 backdrop-blur-sm',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A label above a control block, at two levels.
 *
 * Since the separate panels were merged into one panel with subgroups, one font
 * size is no longer enough: if the panel title and the group labels inside it
 * look identical, the reader can't tell whether "Doors" belongs to "Exterior"
 * or sits alongside it. `title` is brighter and bolder; `group` keeps the old
 * look, so all existing call sites are unchanged.
 */
export function SectionLabel({
  className,
  icon,
  children,
  hint,
  size = 'group',
}: {
  className?: string
  icon?: ReactNode
  children: ReactNode
  hint?: ReactNode
  size?: 'title' | 'group'
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 font-medium',
        size === 'title'
          ? 'text-car-ink text-sm font-semibold'
          : 'text-car-ink-muted text-[13px]',
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        {icon}
        {children}
      </span>
      {hint !== undefined && (
        <span className="text-car-ink font-gauge text-base font-semibold tabular-nums">
          {hint}
        </span>
      )}
    </div>
  )
}

/**
 * Button that toggles a boolean field of `CarState`.
 *
 * Borrows the look of the physical buttons on a real climate panel: an
 * **indicator bar** at the top of the button (`.car-led`) lights up when on.
 * No solid fill — this grid has six buttons and three of them are already on
 * in the initial state; filling all three solid leaves the screen as just three
 * blue blocks, and what deserves attention — the car and the temperature
 * readout right above it — loses out in prominence. The indicator is small but
 * glows, enough to catch at a glance.
 */
export function ToggleButton({
  active,
  className,
  icon,
  label,
  tone = 'cold',
  ...props
}: ComponentProps<'button'> & {
  active: boolean
  icon?: ReactNode
  label: string
  /**
   * `heat` for things that *give off heat* — defrost. In the car image right
   * above the button grid, the A/C airflow is also drawn blue; if the defrost
   * buttons were blue too, two opposite things would share one color, and
   * what's on would be hard to tell apart from what's cooling.
   */
  tone?: 'cold' | 'heat'
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'car-focus relative flex h-[4.5rem] min-w-11 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl pt-1.5',
        'border border-white/5 bg-gradient-to-b text-[13px] font-medium',
        'transition-[background-color,color,transform] duration-150 ease-(--ease-car)',
        'active:scale-[0.97]',
        active
          ? 'from-car-surface-2 to-car-surface text-car-ink'
          : 'from-car-surface/80 to-car-surface/50 text-car-ink-muted hover:text-car-ink',
        className,
      )}
      type="button"
      {...props}
    >
      <span
        aria-hidden="true"
        className="car-led absolute top-2 h-[3px] w-6 rounded-full"
        data-on={active}
        data-tone={tone}
      />
      <span
        className={cn(
          'transition-colors duration-150',
          !active && 'text-car-ink-faint',
          active && (tone === 'heat' ? 'text-car-heat' : 'text-car-cold'),
        )}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  )
}

/**
 * ± step button: a 44px circle by default (temperature, overlaid on the car
 * image in `CarStage`).
 *
 * Height and width are split into `h-11`/`w-11` rather than combined as
 * `size-11`, so call sites can override the height alone — `size-*` and `h-*`
 * don't override each other in `cn`, so combining them leaves both classes
 * alive and stylesheet order decides which one wins. See `STEPPER` in
 * `LevelMeter`.
 */
export function RoundButton({
  className,
  children,
  ...props
}: ComponentProps<'button'>) {
  return (
    <button
      className={cn(
        'car-focus flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full',
        'bg-car-surface-2 text-car-ink border border-white/5 text-xl leading-none font-medium',
        'transition-[background-color,transform] duration-150 ease-(--ease-car)',
        'hover:bg-car-line/40 active:scale-95',
        'disabled:bg-car-surface/50 disabled:text-car-ink-faint disabled:hover:bg-car-surface/50 disabled:cursor-not-allowed disabled:active:scale-100',
        className,
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * Pick one of a few named modes. Mutually exclusive; exactly one is always on.
 *
 * Only seat heating uses it now — the wipers went one step further, to
 * `ToggleButton`s with pictures. But the reason for moving away from the
 * stepped bar is shared by both, so it stays here.
 *
 * A stepped bar draws **magnitude** via bar height; the wipers have no
 * magnitude at all — "Intermittent" and "Slow" are two *modes*, not two
 * *levels* of the same thing, so rising bars are just a pretty picture carrying
 * no information. Worse, at the top step every bar is lit and the control turns
 * into three blue rectangles floating unlabeled: to know how it's wiping you
 * have to read the small text in the right corner.
 *
 * Real cars choose this too. Tesla makes its four wiper settings four discrete
 * named positions (I, II, III, IIII, Auto), and a long-standing user complaint
 * is wanting them *split out into real buttons* instead of a slider — it gets
 * swiped by mistake when the car jolts.
 *
 * The "off" option gets a neutral fill rather than the system color: blue
 * means "running", so a big blue tile saying "Off" reads backwards.
 *
 * ### Only for a few options
 *
 * Apple HIG and most design systems cap this kind of selector at **five
 * options**: beyond that each option gets narrow enough to miss, and the label
 * row becomes a string of text to read rather than glance at. Seat heating has
 * four options, so it fits within the limit; fan speed, with eight steps,
 * stays in `LevelMeter`. The boundary between the two blocks in
 * `ClimateScreen` is exactly that boundary; don't merge them to "look
 * consistent".
 */
export function ModeSelect<T extends string>({
  ariaLabel,
  className,
  onSelect,
  options,
  tone = 'cold',
  value,
}: {
  ariaLabel: string
  className?: string
  onSelect: (id: T) => void
  /**
   * `off` for the "not running" option — it gets a neutral fill instead of the
   * system color.
   */
  options: readonly { id: T; label: string; off?: boolean }[]
  tone?: 'cold' | 'heat'
  value: T
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        // `gap-2`, not `gap-1`: the Euro NCAP 2026 protocol (SD 203) requires
        // touch areas of at least 10×10mm **spaced 4mm apart**. With a
        // four-pixel gap between two 44px-tall tiles, on glass and under
        // vibration, the two tiles read as one continuous strip — and a thumb
        // slipping one millimeter lands on the neighboring option. A wide gap
        // isn't just visual; it's the part *nobody hits* between two targets.
        'flex items-stretch gap-2 rounded-2xl border border-white/5 bg-black/20 p-1.5',
        className,
      )}
      role="radiogroup"
    >
      {options.map((option) => {
        const on = option.id === value
        return (
          <button
            aria-checked={on}
            className={cn(
              // `h-full min-h-11`, not `h-11`: where the parent block
              // stretches (seat heating in `ClimateScreen`) the button grows
              // with the block, and where the parent hugs its content (wipers)
              // `h-full` has nothing to hold on to, so `min-h-11` keeps it at
              // 44px as before.
              // `text-sm tabular-nums`: the number is what *has to be read* in
              // this block, and NHTSA allows only 2 seconds per glance. 13px is
              // a secondary-label size, not a value size. `tabular-nums` keeps
              // "1 2 3" in exactly one place instead of shifting when the
              // level changes.
              'car-focus h-full min-h-11 min-w-11 flex-1 cursor-pointer rounded-xl px-2 text-sm font-medium tabular-nums',
              'transition-[background-color,color,box-shadow] duration-150 ease-(--ease-car)',
              'active:scale-[0.97]',
              !on && 'text-car-ink-muted hover:text-car-ink hover:bg-white/5',
              on && option.off && 'bg-car-surface-2 text-car-ink',
              on &&
                !option.off &&
                (tone === 'heat'
                  ? 'car-glow-heat bg-car-heat text-car-heat-ink'
                  : 'car-glow-cold bg-car-cold text-car-cold-ink'),
            )}
            key={option.id}
            onClick={() => onSelect(option.id)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The wedge's shape: the top edge runs from 62% of the height at the left edge
 * up to 8% at the right edge. Not 0–100%, because with a needle-sharp wedge
 * level 1 is as thin as a thread — on a car screen, "fan level 1" still has to
 * visibly read as *some airflow*.
 */
const WEDGE = 'polygon(0% 62%, 100% 8%, 100% 100%, 0% 100%)'

/**
 * The meter's two ± buttons: rounded columns as tall as the track, not 44px
 * circles.
 *
 * The track stretches with the parent's height (fan speed goes up to 11rem), so
 * round buttons locked at 44px leave two empty columns on either side and waste
 * exactly what's scarcest in a moving car: tap area. As tall as the track, they
 * can be hit without aiming, and they share the same shape language as every
 * other rounded tile on the screen.
 *
 * The background is still darker than the track and there's still a `gap-2`
 * gap; otherwise three equally tall blocks would read as one continuous strip
 * and the ± ends would blend into the meter.
 *
 * `RoundButton` keeps its circle shape where it really is a floating button:
 * the temperature ± overlaid on the car image in `CarStage`.
 */
const STEPPER = 'h-full self-stretch rounded-2xl'

/**
 * A meter for **magnitude**: fan speed `0..7`.
 *
 * Only fan speed uses it now. Wipers and seat heating have moved to
 * `ModeSelect` — the former because they're named modes rather than levels,
 * the latter because with three levels reading a number is faster than
 * counting bars. Fan speed stays here because it really is a quantity, and
 * because with eight steps, eight labels won't fit in the frame's width.
 *
 * ### One continuous wedge, not eight separate blocks
 *
 * The previous version built the wedge from eight separate rising bars. It
 * broke down because the *on* bars are always the *lowest* ones: at level 2/7,
 * the blue part is two tiny dashes huddled at the foot of a rising grey mass —
 * the eye reads "two stray blue bars", not "the fan is low". The wedge only
 * says what it means to say when it's one continuous shape that gets *filled
 * progressively* from the left, just like Tesla's fan slider or the
 * press-hold-and-slide gesture on a real VF 8.
 *
 * So now: one continuous wedge in a recessed track, the on part filled with
 * `car-cold`, the not-yet-reached part dimmed. The vertical lines dividing the
 * wedge into `max` steps remain — countable when needed, but not cutting the
 * wedge into separate pieces.
 *
 * ### Three ways to adjust, for three situations
 *
 * NHTSA's driver-distraction guidelines set a benchmark of ≤ 1.5–2 seconds per
 * glance, and beyond 4–5 steps the driver has to *count* rather than
 * *recognize*. So:
 *
 * - **±** — the main path while driving, two columns as tall as the track, no
 *   need to aim at all; adjusting the fan while driving is "a bit stronger"
 *   anyway.
 * - **Tap/drag on the wedge** — jump straight to the desired level while the
 *   car is stationary.
 * - **Keyboard** — `role="slider"`, arrows move one step, Home/End go to
 *   either end.
 *
 * The "off" step is no longer a tile *inside* the meter. It used to be a
 * double-width tile, the same tone as the track, punching a hole right at the
 * head of the wedge and cutting in half the very shape this whole component
 * exists to draw. No real car puts "Off" in the middle of a meter either:
 * turning the fan off is the fan icon (VF 8), and on the meter 0 sits at the
 * far left — drag all the way left, or press − down to the bottom.
 */
export function LevelMeter({
  ariaLabel,
  max,
  onSelect,
  stepperLabels,
  value,
  valueText,
}: {
  ariaLabel: string
  max: number
  onSelect: (level: number) => void
  /** Screen-reader labels for the two ± buttons: decrease, then increase. */
  stepperLabels: [string, string]
  value: number
  /** Takes a level, returns the screen-reader label for that level. */
  valueText: (level: number) => string
}) {
  const trackRef = useRef<HTMLDivElement>(null)

  /**
   * The level under a touch point. `ceil`, not `round`: each level occupies an
   * equal span of its own, and 0 only lands at the left edge and beyond —
   * sliding off the left of the track turns it off, while inside the track it
   * never turns off by accident.
   */
  const levelAt = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return value
    const ratio = (clientX - box.left) / box.width
    return Math.max(0, Math.min(max, Math.ceil(ratio * max)))
  }

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    // Only follow the captured finger: `setPointerCapture` lets you drag
    // outside the track and keep control — a thumb on a bumpy road rarely
    // moves in a straight line.
    if (event.type === 'pointermove' && event.buttons === 0) return
    if (event.type === 'pointerdown') {
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus()
    }
    const next = levelAt(event.clientX)
    if (next === value) return
    // One vibration pulse each time you *cross a step* — just like the detent
    // of a physical knob, and what makes it possible to drag without looking.
    // No vibration on every touch: vibration that doesn't correspond to any
    // change is just noise.
    navigator.vibrate?.(8)
    onSelect(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = {
      ArrowDown: value - 1,
      ArrowLeft: value - 1,
      ArrowRight: value + 1,
      ArrowUp: value + 1,
      End: max,
      Home: 0,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    onSelect(Math.max(0, Math.min(max, next)))
  }

  return (
    // `h-full min-h-11`: in a stretching parent (fan speed in `ClimateScreen`)
    // the whole meter grows with the block — a bigger wedge reads more
    // clearly. When the parent hugs its content, `h-full` has nothing to hold
    // on to and `min-h-11` keeps it at 44px.
    <div className="flex h-full min-h-11 items-center gap-2">
      <RoundButton
        aria-label={stepperLabels[0]}
        className={STEPPER}
        disabled={value <= 0}
        onClick={() => onSelect(value - 1)}
      >
        −
      </RoundButton>

      {/* The track can shrink; the two ± buttons can't. */}
      <div
        aria-label={ariaLabel}
        aria-valuemax={max}
        aria-valuemin={0}
        aria-valuenow={value}
        aria-valuetext={valueText(value)}
        aria-orientation="horizontal"
        className={cn(
          // `touch-none`: a horizontal finger drag on the track adjusts the
          // fan, it doesn't scroll the page — left at the default, the browser
          // hijacks the gesture midway.
          'car-focus group relative min-w-0 flex-1 cursor-pointer touch-none self-stretch',
          'rounded-2xl border border-white/5 bg-black/20',
        )}
        onKeyDown={onKeyDown}
        onPointerDown={onPointer}
        onPointerMove={onPointer}
        ref={trackRef}
        role="slider"
        tabIndex={0}
      >
        {/*
          The wedge runs flush to the track's border: no more `p-1` rim. The
          radius is 15px rather than the track's 16px — the 1px border eats
          into the inner radius, and leaving it at `rounded-2xl` leaves a
          sliver of dark background showing at all four corners.
        */}
        <div className="absolute inset-0 overflow-hidden rounded-[15px]">
          <div className="absolute inset-0" style={{ clipPath: WEDGE }}>
            {/* The not-yet-reached part: still the wedge, just not lit yet. */}
            <div className="absolute inset-0 bg-white/8 transition-colors duration-150 group-hover:bg-white/12" />
            {/*
              The running part. Clipped with `scaleX`, not with `width` or a
              gradient stop: the browser can't interpolate gradients (a step
              change with no motion doesn't show which way you just adjusted),
              and with `width` every step is a layout pass. `scaleX` runs on
              the compositor, and a solid color block stretches without
              distortion.
            */}
            <div
              className="bg-car-cold absolute inset-0 origin-left transition-transform duration-150 ease-(--ease-car)"
              style={{ transform: `scaleX(${value / max})` }}
            />
            {/*
              Step dividers, drawn over both parts so the wedge stays
              countable.

              Each divider sits at the *start* of its period and the whole
              layer is shifted 2px left, rather than placing dividers at the
              end of the period: at the end, step `max` would stick a
              background-colored line right at the track's right edge, which
              reads as a gap rather than a divider. Shifting left pushes the
              first divider out of the frame, where `overflow-hidden` clips it,
              and the remaining `max - 1` dividers land exactly where they were.
            */}
            <div
              className="absolute inset-0"
              style={{
                background: `repeating-linear-gradient(to right, var(--color-car-bg) 0 2px, transparent 2px calc(100% / ${max}))`,
                transform: 'translateX(-2px)',
              }}
            />
          </div>
        </div>
      </div>

      <RoundButton
        aria-label={stepperLabels[1]}
        className={STEPPER}
        disabled={value >= max}
        onClick={() => onSelect(value + 1)}
      >
        +
      </RoundButton>
    </div>
  )
}
