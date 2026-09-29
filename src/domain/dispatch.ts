/**
 * `ValidatedCall` → a command that runs against `CarStore`.
 *
 * This is the **final piece** between the two halves that were deliberately
 * built apart: the tool table (`src/domain/tools.ts`) and the action table
 * (`src/store/car-store.ts`). A 1-to-1 mapping, no other logic —
 * every calculation already lives in the store, every type constraint already
 * lives in `tool-args.ts`.
 *
 * Returns a **function**, not a result: `runCommand` is the only gate allowed
 * to read `useCarStore.getState()` (see the "`+` button / frozen value"
 * rationale there), so this place only describes *what will happen*, it
 * doesn't do it.
 *
 * Two tools don't touch the store: `answer_in_words` builds a `ToolResult` of
 * kind `spoken` directly (and `describeResult` puts `reason` on screen),
 * `tell_time` builds kind `time` from the system clock. Both answer rather
 * than control, so they have no matching action in `car-store`.
 *
 * The two music tools don't touch `CarStore` either: they call `music-store`,
 * which holds the player, directly — still inside the thunk, so the command
 * only runs when `runCommand` executes it.
 */

import type { CarStore, TemperatureOptions } from '@/store/car-store'
import { controlMusic, searchMusic } from '@/store/music-store'

import type { ValidatedCall } from './tool-args'
import type { ToolResult } from './tool-result'

/**
 * A command ready to run. Mostly synchronous; `play_music` returns a `Promise`
 * because it has to wait for YouTube's results — see `runCommandAsync`.
 */
export type Command = (car: CarStore) => ToolResult | Promise<ToolResult>

export type DispatchOptions = TemperatureOptions & {
  /**
   * Whether the turn has been cancelled. Only `play_music` needs it: it waits
   * on YouTube, and a turn cut off while waiting must not play music anymore.
   */
  isStale?: () => boolean
}

export function dispatch(
  call: ValidatedCall,
  { isStale, ...temperatureOptions }: DispatchOptions = {},
): Command {
  switch (call.name) {
    case 'set_temperature': {
      const { value, zone } = call.arguments
      return (car) => car.setTemperature(value, zone, temperatureOptions)
    }
    case 'adjust_temperature': {
      const { direction, magnitude, zone } = call.arguments
      return (car) =>
        car.adjustTemperature(direction, magnitude, zone, temperatureOptions)
    }
    case 'set_fan_speed': {
      const { value } = call.arguments
      return (car) => car.setFanSpeed(value)
    }
    case 'adjust_fan_speed': {
      const { direction, magnitude } = call.arguments
      return (car) => car.adjustFanSpeed(direction, magnitude)
    }
    case 'set_seat_heat': {
      const { level, zone } = call.arguments
      return (car) => car.setSeatHeat(level, zone)
    }
    case 'set_ac': {
      const { on } = call.arguments
      return (car) => car.setAc(on)
    }
    case 'set_recirculation': {
      const { on } = call.arguments
      return (car) => car.setRecirculation(on)
    }
    case 'set_defrost': {
      const { target, on } = call.arguments
      return (car) => car.setDefrost(target, on)
    }
    case 'set_window': {
      const { open, door } = call.arguments
      return (car) => car.setWindow(door ?? 'all', open)
    }
    case 'set_door': {
      const { open, door } = call.arguments
      // Opening doors while the car may be moving: don't guess all four. The
      // rule lives here, not just in the prompt, so it holds even for on-device
      // models that don't know to ask.
      if (open && door === undefined) {
        return () => ({ kind: 'spoken', reason: 'Mở cửa nào ạ?' })
      }
      return (car) => car.setDoor(door ?? 'all', open)
    }
    case 'set_mirror': {
      const { folded, mirror } = call.arguments
      return (car) => car.setMirror(mirror ?? 'both', folded)
    }
    case 'set_sunroof': {
      const { open } = call.arguments
      return (car) => car.setSunroof(open)
    }
    case 'set_cargo': {
      const { target, open } = call.arguments
      return (car) => car.setCargo(target, open)
    }
    case 'set_turn_signal': {
      const { signal } = call.arguments
      return (car) => car.setTurnSignal(signal)
    }
    case 'set_wipers': {
      const { mode } = call.arguments
      return (car) => car.setWipers(mode)
    }
    case 'navigate_to': {
      const { screen } = call.arguments
      return (car) => car.navigateTo(screen)
    }
    case 'tell_time': {
      const { what } = call.arguments
      // `new Date()` is read inside the thunk, not here: `dispatch` runs once
      // validation is done, while `runCommand` is when the command actually
      // executes.
      return () => ({ kind: 'time', what, at: new Date() })
    }
    case 'control_music': {
      const { action } = call.arguments
      return () => controlMusic(action)
    }
    case 'play_music': {
      const { query } = call.arguments
      return () => searchMusic(query, isStale)
    }
    case 'answer_in_words': {
      const { reason } = call.arguments
      return () => ({ kind: 'spoken', reason })
    }
  }
}
