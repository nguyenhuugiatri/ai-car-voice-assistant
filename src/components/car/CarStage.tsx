/**
 * The car column — the left half of the landscape screen, **staying put across
 * every screen**, like the "car status" area of the Tesla screen (the map or
 * Controls open in the rest of the space; the car doesn't go anywhere).
 *
 * It's where you see whether the last command landed in the right place: seat
 * heating, defrost, airflow and each side's temperature are all drawn on the
 * car itself (see `CarTopView`). So it must not disappear when the user opens
 * the menu or settings — a spoken command can arrive while on any screen.
 *
 * ## Temperatures stand on either side of the car
 *
 * The two temperature columns stand on the side of their own seat, and are
 * the **only place** with temperature buttons — the dock doesn't repeat them.
 * The biggest number on screen sits right next to the cabin it warms or cools,
 * in the same color as the heat glow on the cabin, so the number and the car
 * tell the same story.
 */

import NumberFlow from '@number-flow/react'

import { TEMPERATURE_RANGE, type Zone } from '@/domain/car-state'
import { cn } from '@/lib/utils'
import { useCarStore } from '@/store/car-store'
import { usePreviewStore } from '@/store/preview-store'
import { runCommand } from '@/store/run-command'

import {
  airColor,
  TURN_SIGNAL_PERIOD_MS,
  temperatureColor,
} from './car-visuals'
import { CarTopView } from './CarTopView'
import { playRelay } from './turn-signal-sound'
import { RoundButton } from './ui-bits'

const ZONE_LABEL: Record<Zone, string> = {
  driver: 'Driver',
  passenger: 'Passenger',
}

/**
 * Temperature column for one side.
 *
 * The biggest number on screen, and the only thing at that size — in a car,
 * "what's the temperature now" has to be readable without focusing. The +/−
 * buttons sit above and below the number rather than on either side: a thumb
 * moves vertically more easily than horizontally with the hand still on the
 * steering wheel.
 */
function TemperatureColumn({ zone }: { zone: Zone }) {
  const value = useCarStore((state) => state.temperature[zone])
  const atMax = value >= TEMPERATURE_RANGE.max
  const atMin = value <= TEMPERATURE_RANGE.min

  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-3',
        // Pushed to the outer edge rather than centered in the column: the gap
        // between the number and the body is where the door swings out when
        // opened (`DOOR_OPEN_DEG` in `CarTopView`).
        zone === 'driver' ? 'justify-self-start' : 'justify-self-end',
      )}
    >
      <span className="text-car-ink-muted text-sm font-medium">
        {ZONE_LABEL[zone]}
      </span>

      <RoundButton
        aria-label={`Increase ${ZONE_LABEL[zone].toLowerCase()} temperature`}
        className="lg:h-14 lg:w-14 lg:text-2xl"
        disabled={atMax}
        onClick={() =>
          runCommand((car) =>
            car.setTemperature(car.temperature[zone] + 1, zone),
          )
        }
      >
        +
      </RoundButton>

      <span
        className="font-gauge flex items-start text-[3.5rem] leading-none font-medium tabular-nums transition-colors duration-200 ease-(--ease-car) 2xl:text-7xl"
        style={{ color: temperatureColor(value) }}
      >
        <NumberFlow value={value} />
        <span className="mt-1 text-2xl opacity-70 2xl:text-3xl">°</span>
      </span>

      <RoundButton
        aria-label={`Decrease ${ZONE_LABEL[zone].toLowerCase()} temperature`}
        className="lg:h-14 lg:w-14 lg:text-2xl"
        disabled={atMin}
        onClick={() =>
          runCommand((car) =>
            car.setTemperature(car.temperature[zone] - 1, zone),
          )
        }
      >
        −
      </RoundButton>
    </div>
  )
}

export function CarStage() {
  const temperature = useCarStore((state) => state.temperature)
  const acOn = useCarStore((state) => state.acOn)
  const car = useCarStore()
  const roofHidden = usePreviewStore((state) => state.roofHidden)

  return (
    <section
      aria-label="Car diagram"
      className="relative flex min-h-[28rem] flex-col items-center justify-center overflow-hidden lg:h-full lg:min-h-0"
    >
      {/*
        Stage background: a spotlight on the floor right under the car, and two
        glows on either side tinted by that side's temperature. The glows are
        only 18% strength — enough to see which side is cold, not enough to eat
        into text contrast. Glow color follows `airColor`: with A/C off the
        glows go neutral.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-[background] duration-300"
        style={{
          background: [
            'radial-gradient(34% 44% at 50% 52%, oklch(1 0 0 / 7%), transparent 70%)',
            `radial-gradient(32% 45% at 24% 50%, color-mix(in oklab, ${airColor(temperature.driver, acOn)} 16%, transparent), transparent 100%)`,
            `radial-gradient(32% 45% at 76% 50%, color-mix(in oklab, ${airColor(temperature.passenger, acOn)} 16%, transparent), transparent 100%)`,
          ].join(', '),
        }}
      />

      {/*
        The car column is `minmax(0,auto)` rather than `auto`: on a tall screen
        the car (its width is half its height) is big enough to push the two
        temperature columns out past the stage's `overflow-hidden`. Let the car
        shrink first, and the numbers never get clipped.
      */}
      <div className="relative grid w-full grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center px-5 lg:px-8 2xl:px-11">
        <TemperatureColumn zone="driver" />
        <CarTopView
          className="h-[380px] max-w-full lg:h-[clamp(300px,calc(100dvh-20rem),720px)]"
          doors={car.doors}
          frunkOpen={car.frunkOpen}
          mirrors={car.mirrors}
          roofHidden={roofHidden}
          sunroof={car.sunroof}
          trunkOpen={car.trunkOpen}
          turnSignal={car.turnSignal}
          windows={car.windows}
          wipers={car.wipers}
        />
        <TemperatureColumn zone="passenger" />
      </div>

      {/*
        Clock for the turn signal relay sound: an invisible blinking element,
        so hazard lights (both sides blinking) still produce just one click
        per beat. It lives here rather than in `TurnSignalPanel`: the lamps on
        the car blink on every screen, so the sound has to as well.
      */}
      {car.turnSignal !== 'off' && (
        <span
          aria-hidden="true"
          className="car-blink pointer-events-none absolute size-px"
          key={car.turnSignal}
          onAnimationIteration={() => playRelay(TURN_SIGNAL_PERIOD_MS)}
          onAnimationStart={() => playRelay(TURN_SIGNAL_PERIOD_MS)}
          style={{ animationDuration: `${TURN_SIGNAL_PERIOD_MS}ms` }}
        />
      )}
    </section>
  )
}
