/**
 * Zod validation before touching state — the guard on the path from the
 * model into `CarState`.
 *
 * **Why Zod is still needed when the grammar already constrains** (the
 * warning in `src/prompt/retry.ts` is right, just not sufficient):
 * `structural_tag` constrains the output of *the running model*, but
 * `validateToolCall` is the gate of `runVoiceCommand`, and that gate also
 * receives
 * — the cloud baseline (no grammar at all),
 * — and anything typed by hand into the debug panel's command box.
 * So the overlap with the grammar isn't waste: it's the only place the
 * `ValidatedCall` type is produced, and `dispatch` reads exactly that type.
 *
 * `TOOL_ARGS` is keyed by `ToolName`, so adding a tool but forgetting its
 * schema won't compile — the same safety net `TOOLS_BY_NAME` sets up on the
 * grammar side.
 */

import { z } from 'zod'

import {
  CARGO_TARGETS,
  DEFROST_TARGETS,
  DOOR_TARGETS,
  FAN_DIRECTIONS,
  MAGNITUDES,
  MIRROR_TARGETS,
  MUSIC_ACTIONS,
  SCREENS,
  TEMPERATURE_DIRECTIONS,
  TIME_QUERIES,
  TURN_SIGNALS,
  WIPER_MODES,
  ZONE_TARGETS,
} from './car-state'
import { TOOL_NAMES, type ToolName } from './tools'

const zoneTarget = z.enum([...ZONE_TARGETS])
const magnitude = z.enum([...MAGNITUDES])

/**
 * Deliberately **no** `.min()/.max()`: same reason `src/domain/tools.ts`
 * doesn't put `minimum`/`maximum` into the JSON Schema. Forcing "35 độ"
 * ("35 degrees") down to 30 right at the gate loses the ability to tell "the
 * model misunderstood" from "the person asked for the impossible" — clamping
 * is `car-store`'s job, and it leaves a `clamped` trace.
 */
const integer = z.number().int()

/**
 * `strictObject`, not `object`: `z.object` silently **strips** unknown keys. If
 * the model misspells a parameter name (`window` instead of `door`), the
 * optional parameter falls back to its default — and the default for doors,
 * windows and zones is *the whole car*. Reject unknown keys so the model reads
 * the error and fixes itself, just like `additionalProperties: false` in the
 * JSON Schema.
 */
export const TOOL_ARGS = {
  set_temperature: z.strictObject({
    value: integer,
    zone: zoneTarget.optional(),
  }),
  adjust_temperature: z.strictObject({
    direction: z.enum([...TEMPERATURE_DIRECTIONS]),
    magnitude: magnitude.optional(),
    zone: zoneTarget.optional(),
  }),
  set_fan_speed: z.strictObject({ value: integer }),
  adjust_fan_speed: z.strictObject({
    direction: z.enum([...FAN_DIRECTIONS]),
    magnitude: magnitude.optional(),
  }),
  set_seat_heat: z.strictObject({
    level: integer,
    zone: zoneTarget.optional(),
  }),
  set_ac: z.strictObject({ on: z.boolean() }),
  set_recirculation: z.strictObject({ on: z.boolean() }),
  set_defrost: z.strictObject({
    target: z.enum([...DEFROST_TARGETS]),
    on: z.boolean(),
  }),
  set_window: z.strictObject({
    open: z.boolean(),
    door: z.enum([...DOOR_TARGETS]).optional(),
  }),
  set_door: z.strictObject({
    open: z.boolean(),
    door: z.enum([...DOOR_TARGETS]).optional(),
  }),
  set_mirror: z.strictObject({
    folded: z.boolean(),
    mirror: z.enum([...MIRROR_TARGETS]).optional(),
  }),
  set_sunroof: z.strictObject({ open: z.boolean() }),
  set_cargo: z.strictObject({
    target: z.enum([...CARGO_TARGETS]),
    open: z.boolean(),
  }),
  set_turn_signal: z.strictObject({ signal: z.enum([...TURN_SIGNALS]) }),
  set_wipers: z.strictObject({ mode: z.enum([...WIPER_MODES]) }),
  navigate_to: z.strictObject({ screen: z.enum([...SCREENS]) }),
  tell_time: z.strictObject({ what: z.enum([...TIME_QUERIES]) }),
  control_music: z.strictObject({ action: z.enum([...MUSIC_ACTIONS]) }),
  play_music: z.strictObject({ query: z.string().trim().min(1) }),
  answer_in_words: z.strictObject({ reason: z.string().min(1) }),
} satisfies Record<ToolName, z.ZodType>

/**
 * A tool call that has passed the gate. A discriminated union on `name`, so
 * `dispatch` is a `switch` that TypeScript forces to handle all 20 branches —
 * adding a tool is a compile error right where the fix belongs, not a silent
 * `default` branch.
 */
export type ValidatedCall = {
  [Name in ToolName]: {
    name: Name
    arguments: z.infer<(typeof TOOL_ARGS)[Name]>
  }
}[ToolName]

export type ValidationResult =
  | { ok: true; call: ValidatedCall }
  /** `problem` goes straight into `buildRetryMessages`'s correction turn, so it must name the broken field explicitly. */
  | { ok: false; problem: string }

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name)
}

export function validateToolCall(
  name: string,
  args: unknown,
): ValidationResult {
  if (!isToolName(name)) {
    return { ok: false, problem: `unknown tool "${name}"` }
  }

  const parsed = TOOL_ARGS[name].safeParse(args)
  if (!parsed.success) {
    // The correction message sent back to the model is written in English (see
    // `retry.ts`), so keep Zod's message as-is instead of translating it: a
    // translation would give the model a vaguer sentence, and wouldn't help
    // whoever reads the debug panel either.
    const problem = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    return { ok: false, problem: `${name} — ${problem}` }
  }

  return { ok: true, call: { name, arguments: parsed.data } as ValidatedCall }
}
