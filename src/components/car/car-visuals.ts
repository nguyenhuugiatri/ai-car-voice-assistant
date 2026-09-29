/**
 * Constants and pure functions for the car visuals, split out of
 * `CarTopView.tsx` so that file only exports components (Vite's Fast Refresh
 * requires it).
 */

import {
  TEMPERATURE_RANGE,
  type TurnSignal,
  type WiperMode,
} from '@/domain/car-state'

/**
 * The body ids are **no longer declared here**. Ever since voice could reach
 * the doors, windows, mirrors, trunk/frunk, turn signals and wipers, they've
 * been tokens the model generates — so they moved to
 * `src/domain/car-state.ts`, alongside `SCREENS` and `ZONE_TARGETS`, per the
 * rule written at the top of that file.
 *
 * Re-exported here so the visuals still import from a single place
 * (`./car-visuals`) and no component has to know where the domain/visuals
 * boundary lies.
 */
export {
  DOORS,
  MIRRORS,
  TURN_SIGNALS,
  WINDOWS,
  WIPER_MODES,
  type DoorId,
  type DoorStates,
  type MirrorId,
  type MirrorStates,
  type TurnSignal,
  type WindowId,
  type WindowPositions,
  type WiperMode,
} from '@/domain/car-state'

export const WIPER_LABEL: Record<WiperMode, string> = {
  off: 'Off',
  intermittent: 'Intermittent',
  low: 'Slow',
  high: 'Fast',
}

/**
 * Timing per level, in milliseconds. `sweep` is one stroke out and back;
 * `pause` is the rest between two strokes; `rain` is how many drops collect
 * per second. Intermittent uses the slow level's speed, as on a real car — it
 * only differs in the pause.
 *
 * The wipers on the car picture (`Wipers`) and the tiny wiper on the level
 * button (`WiperModeIcon`) both read these numbers, so the button runs at the
 * same rhythm as the car: one look at the button tells you how fast the glass
 * gets wiped at that level.
 */
export const WIPER_TIMING: Record<
  Exclude<WiperMode, 'off'>,
  { sweep: number; pause: number; rain: number }
> = {
  intermittent: { sweep: 1300, pause: 2400, rain: 7 },
  low: { sweep: 1300, pause: 120, rain: 12 },
  high: { sweep: 750, pause: 0, rain: 20 },
}

/**
 * Period of one flash (on + off). Lighting regulations allow 60–120 flashes
 * per minute; 800 ms is 75 per minute — the familiar tick-tock of a passenger
 * car. Everything that blinks with the turn signal (lamps on the car, the
 * arrow on the button, the relay sound) reads this one number so they don't
 * drift out of phase.
 */
export const TURN_SIGNAL_PERIOD_MS = 800

/** Whether side `side` is blinking — hazard lights included. */
export function signalsSide(signal: TurnSignal, side: 'left' | 'right') {
  return signal === side || signal === 'hazard'
}

/**
 * Temperature → color, shared by the cabin glow, the airflow particles and the
 * temperature number.
 *
 * Around 22–23° it's the neutral text color; toward either extreme it deepens
 * gradually to blue or amber. There's a neutral band rather than a straight
 * interpolation from cold to hot, because 22° isn't "a bit cold" — it's the
 * setting people leave alone.
 *
 * Mixed in `oklab`, **not** `oklch`: the neutral text leans blue (hue 255),
 * and interpolating around the hue wheel from amber (66) to there takes the
 * short way through pink — 28° comes out salmon instead of warm.
 */
export function temperatureColor(value: number): string {
  if (value <= TEMPERATURE_COLD_END) {
    const share = Math.round(
      ((TEMPERATURE_COLD_END - value) /
        (TEMPERATURE_COLD_END - TEMPERATURE_RANGE.min)) *
        70 +
        30,
    )
    return `color-mix(in oklab, var(--color-car-cold) ${share}%, var(--color-car-ink))`
  }
  if (value >= TEMPERATURE_WARM_START) {
    const share = Math.round(
      ((value - TEMPERATURE_WARM_START) /
        (TEMPERATURE_RANGE.max - TEMPERATURE_WARM_START)) *
        70 +
        30,
    )
    return `color-mix(in oklab, var(--color-car-heat) ${share}%, var(--color-car-ink))`
  }
  return 'var(--color-car-ink)'
}

/** The two edges of the neutral temperature band, see `temperatureColor`. */
const TEMPERATURE_COLD_END = 22
const TEMPERATURE_WARM_START = 24

/**
 * Color of the airflow blowing into one side — not always the color of that
 * side's temperature number.
 *
 * With A/C off, every temperature color on the car — airflow, cabin glow,
 * background glow — goes neutral, **the warm side included**. Physically,
 * heating doesn't need the compressor, but on this screen the A/C button reads
 * as "is the climate running or not": if it's off and raising the temperature
 * still shows an orange tint, users take it as the off button not working.
 *
 * This is where the A/C button can be read **on the car itself**: off, the
 * colors fade; back on, the colors return along with the mist at the vent
 * edges. The temperature number keeps its color — it's the setpoint, not the
 * running state.
 */
export function airColor(value: number, acOn: boolean): string {
  if (!acOn) return 'var(--color-car-ink)'
  return temperatureColor(value)
}
