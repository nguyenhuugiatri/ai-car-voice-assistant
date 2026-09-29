/**
 * CarState — the single source of truth of the simulated head unit.
 *
 * Foundational decision: every calculation that yields a number lives here,
 * in TypeScript. The model only states direction and magnitude; it never does
 * the math.
 */

export const ZONES = ['driver', 'passenger'] as const
export type Zone = (typeof ZONES)[number]

/** The target of a command. `both` is not a third zone — it's how you target both. */
export const ZONE_TARGETS = ['driver', 'passenger', 'both'] as const
export type ZoneTarget = (typeof ZONE_TARGETS)[number]

/** Default zone when the model doesn't name one — "nóng quá" ("so hot") doesn't imply "just my seat". */
export const DEFAULT_ZONE_TARGET: ZoneTarget = 'both'

/**
 * The three screens.
 *
 * The value `home` keeps its name **in code**, even though that screen is now
 * called "Menu" in the UI. This string isn't a label: it's a token the model
 * emits in `navigate_to`, so it lives in the system prompt, in the eval
 * utterance set, and in the numbers the eval has measured. Changing it is
 * **changing the prompt**, and old eval scores immediately stop being
 * comparable — a job for a deliberate prompt re-evaluation, not for a UI
 * pass. The Vietnamese labels live in `say.ts` and in the components, where
 * labels belong.
 */
export const SCREENS = ['home', 'climate', 'settings'] as const
export type Screen = (typeof SCREENS)[number]

/** Which glass gets defrosted. `both` is how you target both, not a third pane. */
export const DEFROST_TARGETS = ['front', 'rear', 'both'] as const
export type DefrostTarget = (typeof DEFROST_TARGETS)[number]

/* ---------------------------------------------------------------------- */
/* Body — doors, windows, mirrors, trunks, turn signal, wipers            */
/* ---------------------------------------------------------------------- */

/**
 * The enums below **used to live in `src/components/car/car-visuals.ts`**, back
 * when doors and windows were just drawings. Now they're tokens the model
 * emits, so they follow the rule stated at the top of this file: every value a
 * tool call carries is declared here, and `car-visuals.ts` re-exports them for
 * the visuals.
 *
 * Four side doors. Driver on the left — a left-hand-drive car, as in Vietnam.
 * Each door carries its own window, so windows share this set of ids.
 */
export const DOORS = [
  'frontLeft',
  'frontRight',
  'rearLeft',
  'rearRight',
] as const
export type DoorId = (typeof DOORS)[number]

/**
 * The target of a door/window command. `all` is not a fifth door — it's how
 * you target all four, the same role `both` plays in `ZONE_TARGETS`.
 */
export const DOOR_TARGETS = [...DOORS, 'all'] as const
export type DoorTarget = (typeof DOOR_TARGETS)[number]

/** Which doors are open. A missing key means that door is closed. */
export type DoorStates = Partial<Record<DoorId, boolean>>

export const WINDOWS = DOORS
export type WindowId = DoorId

/** Openness `0..100`, `0` is fully closed. A missing key means that window is closed. */
export type WindowPositions = Partial<Record<WindowId, number>>

/** The two side mirrors, mounted on the two front doors. */
export const MIRRORS = ['left', 'right'] as const
export type MirrorId = (typeof MIRRORS)[number]

/** `both` is how you target both mirrors, not a third mirror. */
export const MIRROR_TARGETS = [...MIRRORS, 'both'] as const
export type MirrorTarget = (typeof MIRROR_TARGETS)[number]

/** Which mirrors are folded. A missing key means that mirror is unfolded. */
export type MirrorStates = Partial<Record<MirrorId, boolean>>

/** The two trunks (frunk and trunk). `both` is how you target both. */
export const CARGO_TARGETS = ['front', 'rear', 'both'] as const
export type CargoTarget = (typeof CARGO_TARGETS)[number]

/** Turn signal: off, one side, or hazard lights (both sides blinking together). */
export const TURN_SIGNALS = ['off', 'left', 'right', 'hazard'] as const
export type TurnSignal = (typeof TURN_SIGNALS)[number]

/**
 * Wiper modes, ordered by increasing speed — the array index is the position
 * on the wiper stalk, as in a real car. No `auto`: there's no rain sensor for
 * it to rely on yet.
 */
export const WIPER_MODES = ['off', 'intermittent', 'low', 'high'] as const
export type WiperMode = (typeof WIPER_MODES)[number]

/** Window fully down or fully closed — a one-touch switch, no in-between. */
export const WINDOW_OPEN_POSITION = 100

/**
 * Whether the driver asks for the time, the date, or both.
 *
 * The clock is **not** `CarState` — it isn't in `INITIAL_CAR_STATE` and no
 * tool can change it. The enum still lives here because `src/eval/cases.ts`
 * takes every gradable value from this file (note 2 of the utterance set), and
 * splitting out a separate enum file for just three strings would make the
 * utterance set remember two places instead of one.
 */
export const TIME_QUERIES = ['time', 'date', 'both'] as const
export type TimeQuery = (typeof TIME_QUERIES)[number]

/**
 * Music control commands for `control_music`. `off` **stops and hides** the
 * now-playing card (`music-store`'s `close`), while `pause` only pauses and
 * the card stays visible.
 *
 * Music isn't `CarState` either; the enum lives here for the same reason as
 * `TIME_QUERIES`.
 */
export const MUSIC_ACTIONS = [
  'play',
  'pause',
  'next',
  'previous',
  'off',
] as const
export type MusicAction = (typeof MUSIC_ACTIONS)[number]

export const TEMPERATURE_RANGE = { min: 14, max: 30, step: 1 } as const
export const FAN_SPEED_RANGE = { min: 0, max: 7, step: 1 } as const
export const SEAT_HEAT_RANGE = { min: 0, max: 3, step: 1 } as const

export type CarState = {
  screen: Screen
  temperature: Record<Zone, number>
  /** 0 means off — there's no separate on/off flag. */
  fanSpeed: number
  seatHeat: Record<Zone, number>
  acOn: boolean
  recirculationOn: boolean
  frontDefrostOn: boolean
  rearDefrostOn: boolean

  /**
   * The body. It used to live in `usePreviewStore` with a note saying "drawn,
   * but not in `CarState` yet" — moving it here is exactly what that note
   * promised: being here means tools can touch it, `runCommand` can record
   * it, and the reply can say it.
   *
   * `roofHidden` did **not** come along: it's a view mode (hiding the roof to
   * look into the cabin), not a car part, so it stays in `usePreviewStore`.
   */
  doors: DoorStates
  windows: WindowPositions
  mirrors: MirrorStates
  /** Sunroof openness `0..100`, `0` is fully closed. */
  sunroof: number
  frunkOpen: boolean
  trunkOpen: boolean
  turnSignal: TurnSignal
  wipers: WiperMode
}

export const INITIAL_CAR_STATE: CarState = {
  // Boot straight into climate, not the icon grid. This is the screen people
  // actually use — and the only screen where the effect of a spoken command
  // is *visible*, so starting here gives the first command somewhere to show
  // its result right away.
  screen: 'climate',
  temperature: { driver: 20, passenger: 20 },
  fanSpeed: 3,
  seatHeat: { driver: 0, passenger: 0 },
  acOn: true,
  recirculationOn: false,
  frontDefrostOn: false,
  rearDefrostOn: false,

  // Doors closed, windows up, mirrors unfolded, trunks closed, no turn signal,
  // no wipers — the car is parked. An empty map means "everything at default",
  // so we don't have to list four keys just to say all four are closed.
  doors: {},
  windows: {},
  mirrors: {},
  sunroof: 0,
  frunkOpen: false,
  trunkOpen: false,
  turnSignal: 'off',
  wipers: 'off',
}

/* ---------------------------------------------------------------------- */
/* Magnitude → number mapping                                             */
/* ---------------------------------------------------------------------- */

export const MAGNITUDES = ['slight', 'normal', 'large'] as const
export type Magnitude = (typeof MAGNITUDES)[number]

/** A magnitude the model leaves blank is read as `normal`. */
export const DEFAULT_MAGNITUDE: Magnitude = 'normal'

/** The enum describes the *feeling to reach*, not whether the number goes up or down. */
export const TEMPERATURE_DIRECTIONS = ['warmer', 'cooler'] as const
export type TemperatureDirection = (typeof TEMPERATURE_DIRECTIONS)[number]

export const FAN_DIRECTIONS = ['stronger', 'weaker'] as const
export type FanDirection = (typeof FAN_DIRECTIONS)[number]

/** Degrees (°C) for each magnitude. */
export const TEMPERATURE_DELTA: Record<Magnitude, number> = {
  slight: 1,
  normal: 2,
  large: 4,
}

/**
 * Fan steps for each magnitude. `large` means hitting the bound — for the fan,
 * "hết cỡ" ("all the way") is literal, unlike temperature (where `large` is
 * still a finite jump).
 */
export const FAN_DELTA: Record<Magnitude, number | 'toBoundary'> = {
  slight: 1,
  normal: 2,
  large: 'toBoundary',
}

export function clamp(
  value: number,
  range: { min: number; max: number },
): number {
  return Math.min(range.max, Math.max(range.min, value))
}

/** The zones a command actually touches. */
export function resolveZones(target: ZoneTarget): Zone[] {
  if (target === 'both') return [...ZONES]
  return [target]
}

/** The doors (or windows) a command actually touches. */
export function resolveDoors(target: DoorTarget): DoorId[] {
  if (target === 'all') return [...DOORS]
  return [target]
}

/** The mirrors a command actually touches. */
export function resolveMirrors(target: MirrorTarget): MirrorId[] {
  if (target === 'both') return [...MIRRORS]
  return [target]
}
