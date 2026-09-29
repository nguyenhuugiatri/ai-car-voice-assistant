/**
 * The eval suite's set of 52 Vietnamese utterances.
 *
 * Three things to know before editing this file:
 *
 * 1. **Expectations are scored on the value AFTER defaults are applied.** So
 *    every scorable parameter **must** be declared here — including the `zone`
 *    and `magnitude` the utterance doesn't state. The runner is not allowed to
 *    guess on its behalf. A case with no ground truth to compare against
 *    declares `'any'`, explicitly.
 * 2. **Values come from the enums in `src/domain/`.** That is the whole reason
 *    this file is TS and not JSON: when the domain model removed `rear` and
 *    `up`/`down`, an earlier JSON case set didn't make a peep. Here `tsc`
 *    breaks.
 * 3. **`register` cuts across `kind`**; it is not a sixth kind of case. "nóng
 *    vãi" ("hot as hell") and "Giảm nhiệt độ" ("Lower the temperature") are
 *    both implied, just in a different voice.
 */

import type {
  DefrostTarget,
  FanDirection,
  Magnitude,
  Screen,
  TemperatureDirection,
  TimeQuery,
  ZoneTarget,
} from '../domain/car-state'
import type { ToolName } from '../domain/tools'

/* ---------------------------------------------------------------------- */
/* Types                                                                  */
/* ---------------------------------------------------------------------- */

/** The utterance's intent. */
export const KINDS = [
  'direct',
  'implied',
  'trap',
  'out-of-scope',
  'multi-action',
] as const
export type Kind = (typeof KINDS)[number]

/** Register of speech. An attribute that cuts across `kind`. */
export const REGISTERS = ['formal', 'colloquial'] as const
export type Register = (typeof REGISTERS)[number]

/**
 * The set of acceptable values for a parameter.
 *
 * `'any'` means **the utterance doesn't say, there's no ground truth to
 * compare** — not "score loosely so it passes". E.g. "nóng quá" ("so hot")
 * doesn't say how much, so every `magnitude` is correct; but "chỉnh ấm ấm
 * thôi" ("just a little warmer") does, and it must be `slight`.
 */
export type Accept<T> = readonly [T, ...T[]] | 'any'

/**
 * The expectation, as a discriminated union on `tool` — not
 * `{ tool, args: object }`. That way setting `zone` on `set_fan_speed` (a tool
 * with no zone) is a compile error, not a field the runner silently ignores.
 */
export type Expected =
  | { tool: 'set_temperature'; value: Accept<number>; zone: Accept<ZoneTarget> }
  | {
      tool: 'adjust_temperature'
      direction: Accept<TemperatureDirection>
      magnitude: Accept<Magnitude>
      zone: Accept<ZoneTarget>
    }
  | { tool: 'set_fan_speed'; value: Accept<number> }
  | {
      tool: 'adjust_fan_speed'
      direction: Accept<FanDirection>
      magnitude: Accept<Magnitude>
    }
  | { tool: 'set_seat_heat'; level: Accept<number>; zone: Accept<ZoneTarget> }
  | { tool: 'set_ac'; on: boolean }
  | { tool: 'set_recirculation'; on: boolean }
  | { tool: 'set_defrost'; target: Accept<DefrostTarget>; on: boolean }
  | { tool: 'navigate_to'; screen: Accept<Screen> }
  | { tool: 'tell_time'; what: Accept<TimeQuery> }
  /** No scorable parameters: `reason` is free text, and scoring it would be scoring prose style. */
  | { tool: 'answer_in_words' }

export type Case = {
  /** Stable ID. Error reports and exported result files refer to cases by it. */
  id: string
  vi: string
  kind: Kind
  register: Register
  expected: Expected
  /**
   * Only for `kind: 'multi-action'`: the first clause, i.e.
   * the part that is actually scored. `stop_after_first: true` (in
   * `src/domain/structural-tag.ts`) guarantees the rest gets dropped.
   */
  firstClause?: string
  /** Why this case is here. Only written when the reason isn't obvious. */
  note?: string
}

/* ---------------------------------------------------------------------- */
/* 1. Direct, with numbers — 13 cases                                     */
/* ---------------------------------------------------------------------- */

const direct: Case[] = [
  {
    id: 'd01',
    vi: 'Đặt nhiệt độ 22 độ',
    kind: 'direct',
    register: 'formal',
    expected: { tool: 'set_temperature', value: [22], zone: ['both'] },
  },
  {
    id: 'd02',
    vi: 'Chỉnh điều hoà xuống 19 độ',
    kind: 'direct',
    register: 'formal',
    expected: { tool: 'set_temperature', value: [19], zone: ['both'] },
    note: 'Has "xuống" ("down") but is still an absolute command — must not become adjust_temperature.',
  },
  {
    id: 'd03',
    vi: 'Cho bên ghế lái 24 độ',
    kind: 'direct',
    register: 'colloquial',
    expected: { tool: 'set_temperature', value: [24], zone: ['driver'] },
  },
  {
    id: 'd04',
    vi: 'Bên ghế phụ để 26 độ đi',
    kind: 'direct',
    register: 'colloquial',
    expected: { tool: 'set_temperature', value: [26], zone: ['passenger'] },
  },
  {
    id: 'd05',
    vi: 'Vặn máy lạnh 18 độ coi',
    kind: 'direct',
    register: 'colloquial',
    expected: { tool: 'set_temperature', value: [18], zone: ['both'] },
    note: 'Southern regional word ("máy lạnh", "A/C") + the particle "coi".',
  },
  {
    id: 'd06',
    vi: 'Set nhiệt độ 20 độ',
    kind: 'direct',
    register: 'colloquial',
    expected: { tool: 'set_temperature', value: [20], zone: ['both'] },
    note: 'English mixed in ("set").',
  },
  {
    id: 'd07',
    vi: 'Cho 25 độ cả hai bên nha',
    kind: 'direct',
    register: 'colloquial',
    expected: { tool: 'set_temperature', value: [25], zone: ['both'] },
  },
  {
    id: 'd08',
    vi: 'Để quạt số 3',
    kind: 'direct',
    register: 'formal',
    expected: { tool: 'set_fan_speed', value: [3] },
  },
  {
    id: 'd09',
    vi: 'Quạt số 7 luôn',
    kind: 'direct',
    register: 'colloquial',
    expected: { tool: 'set_fan_speed', value: [7] },
  },
  {
    id: 'd10',
    vi: 'Tắt quạt',
    kind: 'direct',
    register: 'formal',
    expected: { tool: 'set_fan_speed', value: [0] },
    note: '0 means off; there is no separate on/off flag. A test of that very choice.',
  },
  {
    id: 'd11',
    vi: 'Bật sưởi ghế mức 2',
    kind: 'direct',
    register: 'formal',
    expected: { tool: 'set_seat_heat', level: [2], zone: ['both'] },
  },
  {
    id: 'd12',
    vi: 'Sưởi ghế lái số 3 đi',
    kind: 'direct',
    register: 'colloquial',
    expected: { tool: 'set_seat_heat', level: [3], zone: ['driver'] },
  },
  {
    id: 'd13',
    vi: 'Tắt sưởi ghế',
    kind: 'direct',
    register: 'formal',
    expected: { tool: 'set_seat_heat', level: [0], zone: ['both'] },
  },
]

/* ---------------------------------------------------------------------- */
/* 2. Implied — 14 cases, both temperature directions                     */
/* ---------------------------------------------------------------------- */

const implied: Case[] = [
  {
    id: 'i01',
    vi: 'Nóng quá',
    kind: 'implied',
    register: 'formal',
    expected: {
      tool: 'adjust_temperature',
      direction: ['cooler'],
      magnitude: 'any',
      zone: ['both'],
    },
  },
  {
    id: 'i02',
    vi: 'Lạnh quá',
    kind: 'implied',
    register: 'formal',
    expected: {
      tool: 'adjust_temperature',
      direction: ['warmer'],
      magnitude: 'any',
      zone: ['both'],
    },
    note: 'Mirror pair of i01. A systematic failure in early testing was latching onto the keyword "lạnh" ("cold") → lower the number.',
  },
  {
    id: 'i03',
    vi: 'Nóng vãi',
    kind: 'implied',
    register: 'colloquial',
    expected: {
      tool: 'adjust_temperature',
      direction: ['cooler'],
      magnitude: 'any',
      zone: ['both'],
    },
    note: 'Slang.',
  },
  {
    id: 'i04',
    vi: 'Lạnh run hết cả người rồi',
    kind: 'implied',
    register: 'colloquial',
    expected: {
      tool: 'adjust_temperature',
      direction: ['warmer'],
      magnitude: 'any',
      zone: ['both'],
    },
  },
  {
    id: 'i05',
    vi: 'Chỉnh ấm ấm thôi',
    kind: 'implied',
    register: 'colloquial',
    expected: {
      tool: 'adjust_temperature',
      direction: ['warmer'],
      magnitude: ['slight'],
      zone: ['both'],
    },
    note: 'Reduplicated adjective ("ấm ấm", "warm-ish") + "thôi" ("just") signal a small magnitude.',
  },
  {
    id: 'i06',
    vi: 'Mát hơn chút nữa đi',
    kind: 'implied',
    register: 'colloquial',
    expected: {
      tool: 'adjust_temperature',
      direction: ['cooler'],
      magnitude: ['slight'],
      zone: ['both'],
    },
  },
  {
    id: 'i07',
    vi: 'Giảm nhiệt độ xuống giúp tôi',
    kind: 'implied',
    register: 'formal',
    expected: {
      tool: 'adjust_temperature',
      direction: ['cooler'],
      magnitude: 'any',
      zone: ['both'],
    },
  },
  {
    id: 'i08',
    vi: 'Tăng nhiệt độ lên',
    kind: 'implied',
    register: 'formal',
    expected: {
      tool: 'adjust_temperature',
      direction: ['warmer'],
      magnitude: 'any',
      zone: ['both'],
    },
  },
  {
    id: 'i09',
    vi: 'Cóng hết cả tay rồi anh ơi',
    kind: 'implied',
    register: 'colloquial',
    expected: {
      tool: 'adjust_temperature',
      direction: ['warmer'],
      magnitude: 'any',
      zone: ['both'],
    },
    note: 'No "lạnh" ("cold") keyword — must be inferred from "cóng" ("numb with cold").',
  },
  {
    id: 'i10',
    vi: 'Trong xe ngột ngạt quá',
    kind: 'implied',
    register: 'colloquial',
    expected: {
      tool: 'adjust_temperature',
      direction: ['cooler'],
      magnitude: 'any',
      zone: ['both'],
    },
    note: 'No "nóng" ("hot") keyword. Acceptable if it yields cooler; recirculation is a false negative.',
  },
  {
    id: 'i11',
    vi: 'Chỗ tôi lạnh quá',
    kind: 'implied',
    register: 'colloquial',
    expected: {
      tool: 'adjust_temperature',
      direction: ['warmer'],
      magnitude: 'any',
      zone: ['driver'],
    },
    note: 'Direction-flip PLUS inferring the zone. The hardest case in this group.',
  },
  {
    id: 'i12',
    vi: 'Gió mạnh quá',
    kind: 'implied',
    register: 'formal',
    expected: {
      tool: 'adjust_fan_speed',
      direction: ['weaker'],
      magnitude: 'any',
    },
    note: 'Direction-flip on the fan axis: "mạnh quá" ("too strong") is the current feeling, not the target.',
  },
  {
    id: 'i13',
    vi: 'Quạt to lên đi',
    kind: 'implied',
    register: 'colloquial',
    expected: {
      tool: 'adjust_fan_speed',
      direction: ['stronger'],
      magnitude: 'any',
    },
  },
  {
    id: 'i14',
    vi: 'Phả gió yếu yếu thôi',
    kind: 'implied',
    register: 'colloquial',
    expected: {
      tool: 'adjust_fan_speed',
      direction: ['weaker'],
      magnitude: ['slight'],
    },
    note: 'Reduplicated adjective ("yếu yếu", "weak-ish").',
  },
]

/* ---------------------------------------------------------------------- */
/* 3. Traps — 10 cases                                                    */
/* ---------------------------------------------------------------------- */

const traps: Case[] = [
  {
    id: 't01',
    vi: 'Mở điều hoà',
    kind: 'trap',
    register: 'formal',
    expected: { tool: 'navigate_to', screen: ['climate'] },
    note: 'First half of the mandatory trap pair. "Mở" ("open") = navigation.',
  },
  {
    id: 't02',
    vi: 'Bật điều hoà',
    kind: 'trap',
    register: 'formal',
    expected: { tool: 'set_ac', on: true },
    note: 'Second half of the mandatory trap pair. "Bật" ("turn on") = state change.',
  },
  {
    id: 't03',
    vi: 'Bật máy lạnh lên coi',
    kind: 'trap',
    register: 'colloquial',
    expected: { tool: 'set_ac', on: true },
    note: 'Same trap pair but colloquial register + Southern word. Measures whether t02 survives a change of register.',
  },
  {
    id: 't04',
    vi: 'Mở cái điều hoà ra xem nào',
    kind: 'trap',
    register: 'colloquial',
    expected: { tool: 'navigate_to', screen: ['climate'] },
    note: 'Colloquial version of t01. "ra xem" ("to have a look") reinforces the navigation reading.',
  },
  {
    id: 't05',
    vi: 'Tắt điều hoà',
    kind: 'trap',
    register: 'formal',
    expected: { tool: 'set_ac', on: false },
  },
  {
    id: 't06',
    vi: 'Về màn hình chính',
    kind: 'trap',
    register: 'formal',
    expected: { tool: 'navigate_to', screen: ['home'] },
  },
  {
    id: 't07',
    vi: 'Cho tôi xem phần cài đặt',
    kind: 'trap',
    register: 'formal',
    expected: { tool: 'navigate_to', screen: ['settings'] },
  },
  {
    id: 't09',
    vi: 'Bật lấy gió trong',
    kind: 'trap',
    register: 'formal',
    expected: { tool: 'set_recirculation', on: true },
  },
  {
    id: 't10',
    vi: 'Lấy gió ngoài đi, trong xe bí quá',
    kind: 'trap',
    register: 'colloquial',
    expected: { tool: 'set_recirculation', on: false },
    note: '"Lấy gió ngoài" ("outside air") = recirculation OFF. Flips the boolean, not the tool.',
  },
  {
    id: 't11',
    vi: 'Kính mờ hết rồi',
    kind: 'trap',
    register: 'colloquial',
    expected: { tool: 'set_defrost', target: ['front'], on: true },
    note: 'Never says "sấy" ("defrost"). The only case that forces inferring defrost from a symptom.',
  },
]

/* ---------------------------------------------------------------------- */
/* 4. Out of scope — 8 cases (the denominator of the FP ≤ 1 threshold)    */
/* ---------------------------------------------------------------------- */

const outOfScope: Case[] = [
  {
    id: 'o09',
    vi: 'Làm một bài thơ đi',
    kind: 'out-of-scope',
    register: 'colloquial',
    expected: { tool: 'answer_in_words' },
    note:
      'Regression case, reported by a real user: the car once answered this with the literal string ' +
      '"mấy giờ rồi" ("what time is it") — an example copied straight out of the `answer_in_words` description. ' +
      'Scoring here only catches the tool name; the wording has to be listened to, or read in `raw`.',
  },
  {
    id: 'o02',
    vi: 'Kể cho tôi một câu chuyện cười',
    kind: 'out-of-scope',
    register: 'formal',
    expected: { tool: 'answer_in_words' },
  },
  {
    id: 'o03',
    vi: 'Ngoài trời hôm nay bao nhiêu độ?',
    kind: 'out-of-scope',
    register: 'formal',
    expected: { tool: 'answer_in_words' },
    note: 'Has both "độ" ("degrees") and question form. The strongest bait for set_temperature.',
  },
  {
    id: 'o04',
    vi: 'Mở nhạc lên đi',
    kind: 'out-of-scope',
    register: 'colloquial',
    expected: { tool: 'answer_in_words' },
    note: 'Media was out of scope when this case set was written, but "mở" ("open") baits straight into navigate_to.',
  },
  {
    id: 'o05',
    vi: 'Sắp tới ngã tư chưa ông?',
    kind: 'out-of-scope',
    register: 'colloquial',
    expected: { tool: 'answer_in_words' },
    note: '"Ngã tư" ("intersection") baits navigate_to if the model takes "navigation" literally.',
  },
  {
    id: 'o06',
    vi: 'Chán vãi, nói gì đi',
    kind: 'out-of-scope',
    register: 'colloquial',
    expected: { tool: 'answer_in_words' },
    note: 'Slang, with no intent at all.',
  },
  {
    id: 'o07',
    vi: 'Gọi cho vợ tôi cái',
    kind: 'out-of-scope',
    register: 'colloquial',
    expected: { tool: 'answer_in_words' },
  },
  {
    id: 'o08',
    vi: 'Còn bao nhiêu xăng đấy?',
    kind: 'out-of-scope',
    register: 'colloquial',
    expected: { tool: 'answer_in_words' },
    note: 'About the car, but this car has no tool that can answer it.',
  },
]

/* ---------------------------------------------------------------------- */
/* 5. Multi-action — 4 cases, OUTSIDE the pass bar                        */
/* ---------------------------------------------------------------------- */

const multiAction: Case[] = [
  {
    id: 'm01',
    vi: 'Bật điều hoà rồi để 21 độ',
    kind: 'multi-action',
    register: 'formal',
    firstClause: 'Bật điều hoà',
    expected: { tool: 'set_ac', on: true },
  },
  {
    id: 'm02',
    vi: 'Giảm nhiệt độ với lại tăng quạt lên giùm',
    kind: 'multi-action',
    register: 'colloquial',
    firstClause: 'Giảm nhiệt độ',
    expected: {
      tool: 'adjust_temperature',
      direction: ['cooler'],
      magnitude: 'any',
      zone: ['both'],
    },
  },
  {
    id: 'm03',
    vi: 'Bật sưởi kính sau rồi tăng quạt lên',
    kind: 'multi-action',
    register: 'formal',
    firstClause: 'Bật sưởi kính sau',
    expected: { tool: 'set_defrost', target: ['rear'], on: true },
    note: 'The only case covering target rear.',
  },
  {
    id: 'm04',
    vi: 'Nóng quá, mở màn hình điều hoà ra coi',
    kind: 'multi-action',
    register: 'colloquial',
    firstClause: 'Nóng quá',
    expected: {
      tool: 'adjust_temperature',
      direction: ['cooler'],
      magnitude: 'any',
      zone: ['both'],
    },
    note: 'First clause is implied, second is navigation — the reverse order of m01.',
  },
]

/* ---------------------------------------------------------------------- */
/* 4b. Asking the time, asking the date — 3 cases                         */
/* ---------------------------------------------------------------------- */

/**
 * Before `tell_time` existed, "Mấy giờ rồi" ("What time is it") was the
 * `out-of-scope` case `o01` — and that was a convenient lie:
 * the car **has** a clock, that question can always be answered. Filing it
 * under out of scope is what pulled `answer_in_words` off course into "the tool
 * for refusing", and dragged along the symptom of reading examples out loud.
 *
 * The `o01` ID stays even though the case changed group: exported result files
 * refer to cases by ID, and changing an ID loses the history. An ID says
 * *which case*, not *which group it belongs to*.
 *
 * Reuses `kind: 'direct'` instead of opening a sixth `kind`: adding a value
 * to `KINDS` means adding a column to the `byKind` table and a row to every
 * previous run, in exchange for a group of three cases. Not worth it.
 */
const timeQueries: Case[] = [
  {
    id: 'o01',
    vi: 'Mấy giờ rồi',
    kind: 'direct',
    register: 'formal',
    expected: { tool: 'tell_time', what: ['time', 'both'] },
    note: 'In early testing this came out as navigate_to, then as answer_in_words. Now it has a real tool.',
  },
  {
    // Prefix `g` (giờ, "time"). `t` already belongs to the traps group — `o01`
    // keeps its old ID for history's sake, but the two new cases have no reason
    // to borrow another group's prefix.
    id: 'g02',
    vi: 'Hôm nay ngày bao nhiêu?',
    kind: 'direct',
    register: 'formal',
    expected: { tool: 'tell_time', what: ['date', 'both'] },
  },
  {
    id: 'g03',
    vi: 'Hôm nay thứ mấy nhỉ',
    kind: 'direct',
    register: 'colloquial',
    expected: { tool: 'tell_time', what: ['date', 'both'] },
    note: '"Thứ mấy" ("what day of the week") is a date, not a time — a test of the `what` enum.',
  },
]

/* ---------------------------------------------------------------------- */

export const CASES: Case[] = [
  ...direct,
  ...implied,
  ...traps,
  ...timeQueries,
  ...outOfScope,
  ...multiAction,
]

/**
 * Invariants of the case set, checked at module load.
 *
 * This is the kind of constraint TypeScript can't express, and also the kind
 * that drifts most easily when adding cases: add 3 `formal` cases for
 * convenience and slip below 40% `colloquial` without anyone
 * noticing. Better to break here than in the results table.
 */
/**
 * Total **52**, no longer 50.
 *
 * The arrival of `tell_time` already lost direct comparison with every previous
 * run — the tool set changed, and the catalog in the prompt changed with it —
 * so clinging to the number 50 would only buy a superficial sameness. Settle
 * on a new baseline instead, and write down here exactly how it differs:
 *
 * - `direct` 13 → 16: three time/date questions added (`o01`
 *   moved over, `t02`, `t03`).
 * - `out-of-scope` stays at **8**: `o01` out, `o09` ("làm một bài thơ", "write
 *   a poem") in. This number must hold, because it's the denominator of the
 *   `FP ≤ 1` threshold in `score.ts`.
 *
 * The `L1`/`L2` thresholds are percentages, so they need no change; their
 * denominator goes from 46 to 48 (52 minus the 4 `multi-action` cases).
 *
 * `trap` 11 → 10: `set_auto_climate` was removed from the tool set, so
 * case `t08` ("Để auto đi cho khoẻ", "Just put it on auto") has nothing left
 * to score against. ID `t08` is left empty, not renumbered: `id` is the stable
 * ID that exported result files refer to.
 */
const KIND_QUOTA: Record<Kind, number> = {
  direct: 16,
  implied: 14,
  trap: 10,
  'out-of-scope': 8,
  'multi-action': 4,
}

const TOTAL_CASES = Object.values(KIND_QUOTA).reduce((a, b) => a + b, 0)

export const MIN_COLLOQUIAL_RATIO = 0.4

function assertCaseSetInvariants(cases: Case[]): void {
  const problems: string[] = []

  if (cases.length !== TOTAL_CASES)
    problems.push(`must be exactly ${TOTAL_CASES} cases, got ${cases.length}`)

  const ids = new Set(cases.map((c) => c.id))
  if (ids.size !== cases.length) problems.push('duplicate `id` values')

  for (const kind of KINDS) {
    const actual = cases.filter((c) => c.kind === kind).length
    if (actual !== KIND_QUOTA[kind]) {
      problems.push(`kind "${kind}": need ${KIND_QUOTA[kind]}, got ${actual}`)
    }
  }

  const colloquial = cases.filter((c) => c.register === 'colloquial')
  if (colloquial.length / cases.length < MIN_COLLOQUIAL_RATIO) {
    problems.push(
      `"colloquial" only ${colloquial.length}/${cases.length}, below the ${MIN_COLLOQUIAL_RATIO} threshold`,
    )
  }
  // Spread evenly, not piled into one kind: every kind needs at least one
  // colloquial case.
  for (const kind of KINDS) {
    if (!colloquial.some((c) => c.kind === kind)) {
      problems.push(`kind "${kind}" has no "colloquial" case`)
    }
  }

  for (const c of cases) {
    if (c.kind === 'multi-action' && !c.firstClause) {
      problems.push(`${c.id}: a multi-action case must state its first clause`)
    }
    if (c.kind === 'out-of-scope' && c.expected.tool !== 'answer_in_words') {
      problems.push(`${c.id}: an out-of-scope case must expect answer_in_words`)
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Eval case set violates invariants:\n- ${problems.join('\n- ')}`,
    )
  }
}

assertCaseSetInvariants(CASES)

/**
 * Exactly the set of tool names this case set covers. So that the eval page
 * can print which tools haven't been measured.
 */
export const COVERED_TOOLS: ReadonlySet<ToolName> = new Set(
  CASES.map((c) => c.expected.tool),
)
