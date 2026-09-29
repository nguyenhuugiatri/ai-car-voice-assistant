/**
 * Left/right turn signals and hazard lights.
 *
 * Three mutually exclusive switches — the car has just one turn signal stalk
 * and one hazard button, never "left" and "right" at once. Tapping the active
 * switch again turns it off; tapping another switch goes straight to it, like
 * flicking the stalk from left to right.
 *
 * When on, the button's icon is **lit steady** (a green arrow like the
 * indicator on the instrument cluster, a red triangle like a real hazard
 * button) — the button only shows state; blinking is reserved for the lamps on
 * the car picture, since blinking in two places at once is just visual noise.
 * The tick-tock relay sound plays in `CarStage` (an always-mounted element),
 * taking its rhythm from the lamps' own CSS animation (`animationstart` /
 * `animationiteration`) rather than a separate `setInterval` — two clocks
 * running in parallel drift apart after a few minutes, sound against lamps.
 * When the user asks for reduced motion, the lamps light steady, with no
 * rhythm and therefore no sound.
 *
 * Turn signals are part of `CarState` and have a `set_turn_signal` tool, so
 * these three switches go through `runCommand` like every other button.
 *
 * This is **a sub-group** inside the "Exterior" block of `ClimateScreen`, not
 * its own panel: see the note on the same point in `WiperControl`.
 */

import type { SVGProps } from 'react'

import { cn } from '@/lib/utils'

import type { TurnSignal } from './car-visuals'
import { SectionLabel, ToggleButton } from './ui-bits'

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      {...props}
    />
  )
}

/** Turn indicator arrow (ISO 2575): a block arrow, filled in while blinking. */
function TurnArrowIcon({
  direction,
  ...props
}: SVGProps<SVGSVGElement> & { direction: 'left' | 'right' }) {
  return (
    <Icon {...props}>
      <path
        d="M3 12 11 4.5V9h10v6H11v4.5Z"
        transform={direction === 'right' ? 'matrix(-1 0 0 1 24 0)' : undefined}
      />
    </Icon>
  )
}

/** Hazard lights (ISO 2575): two nested triangles. */
function HazardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3 22 20H2Z" />
      <path d="M12 9.5 16.5 17h-9Z" />
    </Icon>
  )
}

const SWITCHES = [
  { id: 'left', label: 'Left', aria: 'Left turn signal' },
  { id: 'hazard', label: 'Hazard', aria: 'Hazard lights' },
  { id: 'right', label: 'Right', aria: 'Right turn signal' },
] as const satisfies readonly {
  id: Exclude<TurnSignal, 'off'>
  label: string
  aria: string
}[]

export function TurnSignalControl({
  onChange,
  signal,
}: {
  onChange: (signal: TurnSignal) => void
  signal: TurnSignal
}) {
  return (
    <div className="space-y-2">
      <SectionLabel
        icon={<TurnArrowIcon className="size-4" direction="left" />}
        size="title"
      >
        Turn signal
      </SectionLabel>

      <div className="grid grid-cols-3 gap-2">
        {SWITCHES.map(({ id, label, aria }) => {
          const on = signal === id
          const iconClass = cn(
            'size-6',
            on &&
              (id === 'hazard' ? 'text-car-danger' : 'text-car-signal-tell'),
          )
          return (
            <ToggleButton
              active={on}
              aria-label={`${aria}: ${on ? 'blinking, tap to turn off' : 'tap to turn on'}`}
              icon={
                id === 'hazard' ? (
                  <HazardIcon className={iconClass} />
                ) : (
                  <TurnArrowIcon
                    className={iconClass}
                    direction={id}
                    fill={on ? 'currentColor' : 'none'}
                  />
                )
              }
              key={id}
              label={label}
              onClick={() => onChange(on ? 'off' : id)}
            />
          )
        })}
      </div>
    </div>
  )
}
