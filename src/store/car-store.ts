/**
 * `useCarStore` — the car's state, and **only** the car's state.
 *
 * The boundary: this store is the only thing tool calls are allowed to touch.
 * Everything belonging to the conversation session (mic, transcript, reply,
 * debug log, selected model) lives in `useSessionStore`. Keeping the two
 * stores apart means the voice loop only needs to call actions here, without
 * knowing the UI exists.
 *
 * Each action maps 1-1 to a tool in `src/domain/tools.ts` and returns a
 * `ToolResult` — the same value whether the command comes from voice or from a
 * finger. That's the safety net: manual adjustments travel exactly the path
 * voice does.
 */

import { create } from 'zustand'

import {
  clamp,
  DEFAULT_MAGNITUDE,
  DEFAULT_ZONE_TARGET,
  FAN_DELTA,
  FAN_SPEED_RANGE,
  INITIAL_CAR_STATE,
  resolveDoors,
  resolveMirrors,
  resolveZones,
  SEAT_HEAT_RANGE,
  TEMPERATURE_DELTA,
  TEMPERATURE_RANGE,
  WINDOW_OPEN_POSITION,
  ZONES,
  type CargoTarget,
  type CarState,
  type DefrostTarget,
  type DoorTarget,
  type FanDirection,
  type Magnitude,
  type MirrorTarget,
  type Screen,
  type TemperatureDirection,
  type TurnSignal,
  type WiperMode,
  type Zone,
  type ZoneTarget,
} from '@/domain/car-state'
import type { ToolResult } from '@/domain/tool-result'

/**
 * `autoAc: false` — adjust the temperature without turning the A/C on. Used
 * when the same utterance also asked to turn the A/C off ("tắt điều hoà rồi để
 * 22 độ", "turn off the A/C and set 22 degrees"): the explicit off command
 * wins.
 */
export type TemperatureOptions = { autoAc?: boolean }

export type CarActions = {
  setTemperature: (
    value: number,
    zone?: ZoneTarget,
    options?: TemperatureOptions,
  ) => ToolResult
  adjustTemperature: (
    direction: TemperatureDirection,
    magnitude?: Magnitude,
    zone?: ZoneTarget,
    options?: TemperatureOptions,
  ) => ToolResult
  setFanSpeed: (value: number) => ToolResult
  adjustFanSpeed: (direction: FanDirection, magnitude?: Magnitude) => ToolResult
  setSeatHeat: (level: number, zone?: ZoneTarget) => ToolResult
  setAc: (on: boolean) => ToolResult
  setRecirculation: (on: boolean) => ToolResult
  setDefrost: (target: DefrostTarget, on: boolean) => ToolResult
  navigateTo: (screen: Screen) => ToolResult

  setDoor: (target: DoorTarget, open: boolean) => ToolResult
  setWindow: (target: DoorTarget, open: boolean) => ToolResult
  /** `folded: true` means folding the mirror in against the body. */
  setMirror: (target: MirrorTarget, folded: boolean) => ToolResult
  setSunroof: (open: boolean) => ToolResult
  setCargo: (target: CargoTarget, open: boolean) => ToolResult
  setTurnSignal: (signal: TurnSignal) => ToolResult
  setWipers: (mode: WiperMode) => ToolResult

  reset: () => void
}

export type CarStore = CarState & CarActions

/**
 * `ToolResult`'s `from`/`to` is a single pair of numbers, while one command can
 * touch two zones with different values. Convention: the first zone touched
 * is the representative, and `clamped` means "did any zone hit a bound". The
 * reply only needs to say what happened, not list every zone.
 */
function numericResult(
  field: 'temperature' | 'seatHeat',
  zones: Zone[],
  before: Record<Zone, number>,
  after: Record<Zone, number>,
  wanted: Record<Zone, number>,
): ToolResult {
  const lead = zones[0] ?? 'driver'
  return {
    kind: 'numeric',
    field,
    zones,
    from: before[lead],
    to: after[lead],
    clamped: zones.some((zone) => after[zone] !== wanted[zone]),
  }
}

export const useCarStore = create<CarStore>()((set, get) => ({
  ...INITIAL_CAR_STATE,

  setTemperature(value, zone = DEFAULT_ZONE_TARGET, { autoAc = true } = {}) {
    const state = get()
    const zones = resolveZones(zone)
    const before = state.temperature
    const wanted = { ...before }
    const after = { ...before }
    for (const target of zones) {
      wanted[target] = value
      after[target] = clamp(value, TEMPERATURE_RANGE)
    }
    set({ temperature: after, acOn: state.acOn || autoAc })
    return {
      ...numericResult('temperature', zones, before, after, wanted),
      acTurnedOn: !state.acOn && autoAc,
    }
  },

  adjustTemperature(
    direction,
    magnitude = DEFAULT_MAGNITUDE,
    zone,
    { autoAc = true } = {},
  ) {
    const state = get()
    const zones = resolveZones(zone ?? DEFAULT_ZONE_TARGET)
    const step = TEMPERATURE_DELTA[magnitude]
    const delta = direction === 'warmer' ? step : -step
    const before = state.temperature
    const wanted = { ...before }
    const after = { ...before }
    for (const target of zones) {
      wanted[target] = before[target] + delta
      after[target] = clamp(wanted[target], TEMPERATURE_RANGE)
    }
    set({ temperature: after, acOn: state.acOn || autoAc })
    return {
      ...numericResult('temperature', zones, before, after, wanted),
      acTurnedOn: !state.acOn && autoAc,
    }
  },

  setFanSpeed(value) {
    const from = get().fanSpeed
    const to = clamp(value, FAN_SPEED_RANGE)
    set({ fanSpeed: to })
    return {
      kind: 'numeric',
      field: 'fanSpeed',
      zones: [],
      from,
      to,
      clamped: to !== value,
    }
  },

  adjustFanSpeed(direction, magnitude = DEFAULT_MAGNITUDE) {
    const from = get().fanSpeed
    const step = FAN_DELTA[magnitude]
    const wanted =
      step === 'toBoundary'
        ? direction === 'stronger'
          ? FAN_SPEED_RANGE.max
          : FAN_SPEED_RANGE.min
        : from + (direction === 'stronger' ? step : -step)
    const to = clamp(wanted, FAN_SPEED_RANGE)
    set({ fanSpeed: to })
    return {
      kind: 'numeric',
      field: 'fanSpeed',
      zones: [],
      from,
      to,
      // `large` deliberately runs to the bound, so reaching it isn't clamping.
      clamped: step !== 'toBoundary' && to !== wanted,
    }
  },

  setSeatHeat(level, zone = DEFAULT_ZONE_TARGET) {
    const before = get().seatHeat
    const zones: Zone[] = zone === 'both' ? [...ZONES] : [zone]
    const wanted = { ...before }
    const after = { ...before }
    for (const target of zones) {
      wanted[target] = level
      after[target] = clamp(level, SEAT_HEAT_RANGE)
    }
    set({ seatHeat: after })
    return numericResult('seatHeat', zones, before, after, wanted)
  },

  setAc(on) {
    const alreadySet = get().acOn === on
    set({ acOn: on })
    return { kind: 'toggle', feature: 'ac', on, alreadySet }
  },

  setRecirculation(on) {
    const alreadySet = get().recirculationOn === on
    set({ recirculationOn: on })
    return { kind: 'toggle', feature: 'recirculation', on, alreadySet }
  },

  /**
   * `target: 'both'` flips two switches, but a `ToolResult` can describe only
   * one. The front windshield is the representative; `alreadySet` is only true
   * when **both** were already as requested.
   */
  setDefrost(target, on) {
    const state = get()
    const touchesFront = target === 'front' || target === 'both'
    const touchesRear = target === 'rear' || target === 'both'
    const alreadySet =
      (!touchesFront || state.frontDefrostOn === on) &&
      (!touchesRear || state.rearDefrostOn === on)
    set({
      frontDefrostOn: touchesFront ? on : state.frontDefrostOn,
      rearDefrostOn: touchesRear ? on : state.rearDefrostOn,
    })
    return {
      kind: 'toggle',
      feature: touchesFront ? 'frontDefrost' : 'rearDefrost',
      on,
      alreadySet,
    }
  },

  navigateTo(screen) {
    const from = get().screen
    set({ screen })
    return { kind: 'navigation', from, to: screen }
  },

  /* -------------------------------------------------------------------- */
  /* Body                                                                 */
  /* -------------------------------------------------------------------- */

  setDoor(target, open) {
    const before = get().doors
    const targets = resolveDoors(target)
    const alreadySet = targets.every((door) => (before[door] ?? false) === open)
    const after = { ...before }
    for (const door of targets) after[door] = open
    set({ doors: after })
    return { kind: 'opening', part: 'door', targets, open, alreadySet }
  },

  /**
   * A window is a one-touch switch with no in-between steps:
   * `WINDOW_OPEN_POSITION` or `0`. Voice also has no way to say "hạ kính một
   * phần ba" ("lower the window a third") without adding a numeric parameter —
   * and nobody has asked for that parameter yet.
   */
  setWindow(target, open) {
    const before = get().windows
    const targets = resolveDoors(target)
    const position = open ? WINDOW_OPEN_POSITION : 0
    const alreadySet = targets.every((door) => (before[door] ?? 0) > 0 === open)
    const after = { ...before }
    for (const door of targets) after[door] = position
    set({ windows: after })
    return { kind: 'opening', part: 'window', targets, open, alreadySet }
  },

  /**
   * `ToolResult`'s `open` means the mirror is **unfolded**, the opposite of the
   * `folded` the command takes. The sign flips here rather than in `say.ts`:
   * the `opening` kind has a single open/close axis, and that axis must point
   * the same way for all six parts.
   */
  setMirror(target, folded) {
    const before = get().mirrors
    const targets = resolveMirrors(target)
    const alreadySet = targets.every(
      (mirror) => (before[mirror] ?? false) === folded,
    )
    const after = { ...before }
    for (const mirror of targets) after[mirror] = folded
    set({ mirrors: after })
    return {
      kind: 'opening',
      part: 'mirror',
      targets,
      open: !folded,
      alreadySet,
    }
  },

  setSunroof(open) {
    const alreadySet = get().sunroof > 0 === open
    set({ sunroof: open ? WINDOW_OPEN_POSITION : 0 })
    return {
      kind: 'opening',
      part: 'sunroof',
      targets: [],
      open,
      alreadySet,
    }
  },

  /**
   * Two trunks, one command. `target: 'both'` touches both, but a `ToolResult`
   * can describe only one `part` — the rear trunk is the representative, the
   * same convention `setDefrost` uses for the front windshield.
   */
  setCargo(target, open) {
    const state = get()
    const touchesFront = target === 'front' || target === 'both'
    const touchesRear = target === 'rear' || target === 'both'
    const alreadySet =
      (!touchesFront || state.frunkOpen === open) &&
      (!touchesRear || state.trunkOpen === open)
    set({
      frunkOpen: touchesFront ? open : state.frunkOpen,
      trunkOpen: touchesRear ? open : state.trunkOpen,
    })
    return {
      kind: 'opening',
      part: touchesRear ? 'trunk' : 'frunk',
      targets: [],
      open,
      alreadySet,
    }
  },

  setTurnSignal(signal) {
    const from = get().turnSignal
    set({ turnSignal: signal })
    return { kind: 'turnSignal', from, to: signal }
  },

  setWipers(mode) {
    const from = get().wipers
    set({ wipers: mode })
    return { kind: 'wipers', from, to: mode }
  },

  reset() {
    set({ ...INITIAL_CAR_STATE })
  },
}))
