/**
 * The referee. It encodes the eval suite's scoring rules, and it is not allowed
 * to loosen a single one of them.
 *
 * Three things that are easy to get wrong, stated up front:
 *
 * 1. **Score on the value AFTER defaults are applied**, not on the raw JSON.
 *    What's worth measuring is the car's behaviour, and the car reads
 *    `zone: 'both'` when the model leaves `zone` out.
 * 2. **`invalid` is a separate column, not a lower score tier.** It counts
 *    *infrastructure* errors — the grammar letting an out-of-enum value through,
 *    or no tool call could be extracted. A case with `invalid` still counts for
 *    `L1` if the tool name is right: mix the two together and a broken grammar
 *    will look like a dumb model.
 * 3. **`flip` only counts `warmer` ↔ `cooler`** — to the letter, because it's
 *    the acceptance criterion for the domain model's enum choice
 *    (`docs/domain-model.md` §2.1), not a score column. A fan
 *    `stronger`/`weaker` flip is still counted, but in `fanFlip` and with no
 *    threshold — nobody has settled that it's the same kind of error.
 */

import { DEFAULT_MAGNITUDE, DEFAULT_ZONE_TARGET } from '../domain/car-state'
import {
  STATE_CHANGING_TOOLS,
  TOOLS_BY_NAME,
  type ArgumentsSchema,
  type ToolName,
} from '../domain/tools'
import type { Case, Kind, Register } from './cases'
import { KINDS, REGISTERS } from './cases'
import type { RunOutput, ToolCall } from './runner'

/* ---------------------------------------------------------------------- */
/* Thresholds — settled BEFORE there were numbers                         */
/* ---------------------------------------------------------------------- */

export const THRESHOLDS = {
  l1: 0.9,
  l2: 0.8,
  /** Out of the 8 out-of-scope cases. */
  fpMax: 1,
  flipMax: 0,
} as const

/* ---------------------------------------------------------------------- */
/* Check arguments against the tool's own JSON Schema                     */
/* ---------------------------------------------------------------------- */

/**
 * Checks against the schema in `src/domain/tools.ts`, not a parallel
 * hand-copied Zod table: two descriptions of the same tool drift apart sooner
 * or later, and when they do the results table lies instead of breaking.
 *
 * Only understands exactly the subset `ArgumentsSchema` allows (`string`+`enum`,
 * `integer`, `number`, `boolean`) — anything else, it complains instead of
 * guessing.
 */
function validateArgs(
  schema: ArgumentsSchema,
  args: Record<string, unknown>,
): { ok: true } | { ok: false; problem: string } {
  for (const name of schema.required) {
    if (args[name] === undefined)
      return { ok: false, problem: `missing \`${name}\`` }
  }

  for (const [name, value] of Object.entries(args)) {
    const property = schema.properties[name]
    if (!property) return { ok: false, problem: `unknown argument \`${name}\`` }

    const enumValues = property.enum as unknown[] | undefined
    if (enumValues && !enumValues.includes(value)) {
      return {
        ok: false,
        problem: `\`${name}\` = ${JSON.stringify(value)} not in enum`,
      }
    }

    switch (property.type) {
      case 'string':
        if (typeof value !== 'string')
          return { ok: false, problem: `\`${name}\` must be a string` }
        break
      case 'integer':
        if (!Number.isInteger(value))
          return { ok: false, problem: `\`${name}\` must be an integer` }
        break
      case 'number':
        if (typeof value !== 'number')
          return { ok: false, problem: `\`${name}\` must be a number` }
        break
      case 'boolean':
        if (typeof value !== 'boolean')
          return { ok: false, problem: `\`${name}\` must be a boolean` }
        break
      default:
        return {
          ok: false,
          problem: `schema has an unsupported type: ${String(property.type)}`,
        }
    }
  }

  return { ok: true }
}

/**
 * Fills in defaults before scoring. Only two defaults, and both come from
 * `src/domain/` rather than rewriting the values here: `zone` → `both`,
 * `magnitude` → `normal`.
 */
function applyDefaults(
  schema: ArgumentsSchema,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const filled = { ...args }
  if (schema.properties.zone && filled.zone === undefined)
    filled.zone = DEFAULT_ZONE_TARGET
  if (schema.properties.magnitude && filled.magnitude === undefined)
    filled.magnitude = DEFAULT_MAGNITUDE
  return filled
}

/* ---------------------------------------------------------------------- */
/* Scoring one case                                                       */
/* ---------------------------------------------------------------------- */

export type Outcome = {
  caseId: string
  kind: Kind
  register: Register
  input: string
  /** The model's verbatim output. This is what you debug with — don't trim it when exporting JSON. */
  raw: string
  latencyMs: number
  /** The tool call, mapped into the standard tool set's space and with defaults applied. */
  call: ToolCall | null
  expectedTool: ToolName
  l1: boolean
  l2: boolean
  fp: boolean
  flip: boolean
  fanFlip: boolean
  invalid: boolean
  /** What went wrong — only present when the case fails `L2`. */
  problem?: string
}

const STATE_CHANGING = new Set<string>(STATE_CHANGING_TOOLS)

/** `'any'` means the utterance doesn't say, there's no ground truth to compare — not loose scoring. */
function accepts(accept: unknown, value: unknown): boolean {
  if (accept === 'any') return true
  if (Array.isArray(accept)) return accept.includes(value)
  return accept === value
}

const OPPOSITE: Record<string, string> = {
  warmer: 'cooler',
  cooler: 'warmer',
  stronger: 'weaker',
  weaker: 'stronger',
}

export function scoreCase(testCase: Case, output: RunOutput): Outcome {
  const base = {
    caseId: testCase.id,
    kind: testCase.kind,
    register: testCase.register,
    input: testCase.vi,
    raw: output.raw,
    latencyMs: output.latencyMs,
    expectedTool: testCase.expected.tool,
    fp: false,
    flip: false,
    fanFlip: false,
  }

  if (!output.call) {
    return {
      ...base,
      call: null,
      l1: false,
      l2: false,
      invalid: true,
      problem: 'could not extract any tool call from the output',
    }
  }

  const definition = TOOLS_BY_NAME[output.call.name as ToolName]
  if (!definition) {
    return {
      ...base,
      call: output.call,
      l1: false,
      l2: false,
      invalid: true,
      problem: `nonexistent tool name: \`${output.call.name}\``,
    }
  }

  const validation = validateArgs(definition.schema, output.call.arguments)
  const args = applyDefaults(definition.schema, output.call.arguments)
  const call: ToolCall = { name: output.call.name, arguments: args }

  const l1 = output.call.name === testCase.expected.tool
  const fp =
    testCase.expected.tool === 'answer_in_words' &&
    STATE_CHANGING.has(call.name)

  // A direction flip only counts when the model calls the **right** tool: the
  // wrong tool is a different kind of error, and mixing it in would rob
  // `flip = 0` of its meaning as an acceptance criterion.
  const expectedDirection =
    'direction' in testCase.expected ? testCase.expected.direction : undefined
  const actualDirection = args.direction
  const flipped =
    l1 &&
    Array.isArray(expectedDirection) &&
    typeof actualDirection === 'string' &&
    expectedDirection.length === 1 &&
    OPPOSITE[expectedDirection[0]] === actualDirection

  if (!validation.ok) {
    return {
      ...base,
      call,
      l1,
      l2: false,
      invalid: true,
      fp,
      flip: flipped && testCase.expected.tool === 'adjust_temperature',
      fanFlip: flipped && testCase.expected.tool === 'adjust_fan_speed',
      problem: validation.problem,
    }
  }

  const mismatches: string[] = []
  if (!l1) {
    mismatches.push(
      `called \`${call.name}\`, expected \`${testCase.expected.tool}\``,
    )
  } else {
    for (const [key, accept] of Object.entries(testCase.expected)) {
      if (key === 'tool') continue
      if (!accepts(accept, args[key])) {
        mismatches.push(
          `\`${key}\` = ${JSON.stringify(args[key])}, expected ${JSON.stringify(accept)}`,
        )
      }
    }
  }

  return {
    ...base,
    call,
    l1,
    l2: mismatches.length === 0,
    invalid: false,
    fp,
    flip: flipped && testCase.expected.tool === 'adjust_temperature',
    fanFlip: flipped && testCase.expected.tool === 'adjust_fan_speed',
    problem: mismatches.length > 0 ? mismatches.join('; ') : undefined,
  }
}

/* ---------------------------------------------------------------------- */
/* Roll up into one table row                                             */
/* ---------------------------------------------------------------------- */

export type Slice = { total: number; l1: number; l2: number }

export type Summary = {
  /**
   * Main denominator = **the whole set minus the 4 `multi-action`
   * (multi-action) cases** (49 with the current 53-case set; it was 46 back when
   * the set was 50).
   *
   * The 4 `multi-action` cases sit OUTSIDE the pass threshold because
   * `stop_after_first: true` guarantees they can never be complete. The
   * threshold, however, was written with the arithmetic note "(45/50)", i.e.
   * over the whole set. Both can't be right at once. Read it in the way that
   * keeps both: **the threshold is a percentage** (`L1 ≥ 90%`), and "45/50" is
   * just an illustrative multiplication — so the percentage is taken over the
   * set that is actually constrained.
   *
   * The absolute number is deliberately no longer pinned here: it was already
   * wrong once when the case set went from 50 to 53, and nothing forces a
   * hand-copied constant in a comment to stay correct.
   *
   * So nobody has to rerun 5 minutes over a different reading, `l1PctAll` sits
   * right next to it and is always exported to the JSON.
   */
  scored: Slice
  l1Pct: number
  l2Pct: number
  l1PctAll: number
  l2PctAll: number
  /** The 4 `multi-action` cases, scored on the first clause, outside the threshold. */
  multi: Slice
  fp: number
  /** Number of cases that should be `answer_in_words` — the denominator of `fp`. */
  fpOf: number
  flip: number
  fanFlip: number
  invalid: number
  p50LatencyMs: number
  totalMs: number
  byKind: Record<Kind, Slice>
  byRegister: Record<Register, Slice>
  /** Checked against `THRESHOLDS`. Don't edit the thresholds — if it fails, escalate. */
  verdict: { pass: boolean; failures: string[] }
}

const emptySlice = (): Slice => ({ total: 0, l1: 0, l2: 0 })

function addTo(slice: Slice, outcome: Outcome): void {
  slice.total += 1
  if (outcome.l1) slice.l1 += 1
  if (outcome.l2) slice.l2 += 1
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return Math.round(sorted[index])
}

export function summarise(outcomes: Outcome[], totalMs: number): Summary {
  const scored = emptySlice()
  const multi = emptySlice()
  const all = emptySlice()
  const byKind = Object.fromEntries(
    KINDS.map((kind) => [kind, emptySlice()]),
  ) as Record<Kind, Slice>
  const byRegister = Object.fromEntries(
    REGISTERS.map((register) => [register, emptySlice()]),
  ) as Record<Register, Slice>

  let fp = 0
  let fpOf = 0
  let flip = 0
  let fanFlip = 0
  let invalid = 0

  for (const outcome of outcomes) {
    addTo(all, outcome)
    addTo(outcome.kind === 'multi-action' ? multi : scored, outcome)
    addTo(byKind[outcome.kind], outcome)
    addTo(byRegister[outcome.register], outcome)

    if (outcome.expectedTool === 'answer_in_words') fpOf += 1
    if (outcome.fp) fp += 1
    if (outcome.flip) flip += 1
    if (outcome.fanFlip) fanFlip += 1
    if (outcome.invalid) invalid += 1
  }

  const pct = (part: number, whole: number) => (whole === 0 ? 0 : part / whole)
  const l1Pct = pct(scored.l1, scored.total)
  const l2Pct = pct(scored.l2, scored.total)

  const failures: string[] = []
  if (l1Pct < THRESHOLDS.l1)
    failures.push(`L1 ${(l1Pct * 100).toFixed(1)}% < ${THRESHOLDS.l1 * 100}%`)
  if (l2Pct < THRESHOLDS.l2)
    failures.push(`L2 ${(l2Pct * 100).toFixed(1)}% < ${THRESHOLDS.l2 * 100}%`)
  if (fp > THRESHOLDS.fpMax) failures.push(`FP ${fp} > ${THRESHOLDS.fpMax}`)
  if (flip > THRESHOLDS.flipMax)
    failures.push(`flip ${flip} > 0 → revisit the tool enums`)

  return {
    scored,
    l1Pct,
    l2Pct,
    l1PctAll: pct(all.l1, all.total),
    l2PctAll: pct(all.l2, all.total),
    multi,
    fp,
    fpOf,
    flip,
    fanFlip,
    invalid,
    p50LatencyMs: percentile(
      outcomes.map((outcome) => outcome.latencyMs),
      0.5,
    ),
    totalMs,
    byKind,
    byRegister,
    verdict: { pass: failures.length === 0, failures },
  }
}
