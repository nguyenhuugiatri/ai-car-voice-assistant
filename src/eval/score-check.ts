/**
 * Checks `score.ts`'s scoring rules against simulated output.
 *
 *     pnpm dlx tsx src/eval/score-check.ts
 *
 * It exists because if the scorer is wrong then **every** number the eval
 * suite collects is wrong, and that error can't be seen from the table — the
 * table is still full of numbers, just wrong ones. Runs without a GPU and without
 * downloading a model.
 *
 * The project has no test runner yet, so this file prints its own results.
 */

import { TOOLS_BY_NAME } from '../domain/tools'
import { CASES } from './cases'
import type { RunOutput, ToolCall } from './runner'
import { scoreCase, summarise } from './score'

const caseById = (id: string) => {
  const found = CASES.find((item) => item.id === id)
  if (!found)
    throw new Error(`no case \`${id}\` — fix this file, not the case set`)
  return found
}

const output = (call: ToolCall | null): RunOutput => ({
  call,
  raw: call ? JSON.stringify(call) : '(no tag)',
  latencyMs: 1000,
})

type Check = {
  name: string
  caseId: string
  call: ToolCall | null
  expect: Partial<Record<'l1' | 'l2' | 'fp' | 'flip' | 'invalid', boolean>>
}

/**
 * Each check here is **one scoring rule**, not a random example. Delete one and
 * you must be able to say which rule no longer applies.
 */
const CHECKS: Check[] = [
  {
    name: 'missing `zone` gets the default `both`, still passes L2',
    caseId: 'd01',
    call: { name: 'set_temperature', arguments: { value: 22 } },
    expect: { l1: true, l2: true, invalid: false },
  },
  {
    name: '`zone` present but wrong fails L2, still passes L1',
    caseId: 'd01',
    call: { name: 'set_temperature', arguments: { value: 22, zone: 'driver' } },
    expect: { l1: true, l2: false, invalid: false },
  },
  {
    name: 'wrong tool → fails both L1 and L2',
    caseId: 'd01',
    call: { name: 'adjust_temperature', arguments: { direction: 'cooler' } },
    expect: { l1: false, l2: false, invalid: false },
  },
  {
    name: 'out-of-enum value is `invalid` (infrastructure), but L1 still counts',
    caseId: 'd01',
    call: { name: 'set_temperature', arguments: { value: 22, zone: 'rear' } },
    expect: { l1: true, l2: false, invalid: true },
  },
  {
    name: 'no tool call could be extracted → `invalid`',
    caseId: 'd01',
    call: null,
    expect: { l1: false, l2: false, invalid: true },
  },
  {
    name: 'nonexistent tool name → `invalid`',
    caseId: 'd01',
    call: { name: 'set_temp', arguments: { value: 22 } },
    expect: { l1: false, l2: false, invalid: true },
  },
]

/* ---------------------------------------------------------------------- */

let failed = 0

function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

for (const item of CHECKS) {
  const outcome = scoreCase(caseById(item.caseId), output(item.call))
  const wrong = Object.entries(item.expect).filter(
    ([key, value]) => outcome[key as keyof typeof outcome] !== value,
  )
  check(
    item.name,
    wrong.length === 0,
    wrong
      .map(
        ([key, value]) =>
          `${key}: expected ${value}, got ${outcome[key as 'l1']}`,
      )
      .join('; '),
  )
}

/* --- Two rules that need the real case set; find cases by property --- */

const flipCase = CASES.find(
  (item) =>
    item.expected.tool === 'adjust_temperature' &&
    Array.isArray(item.expected.direction) &&
    item.expected.direction.length === 1,
)
if (flipCase && 'direction' in flipCase.expected) {
  const wanted = (flipCase.expected.direction as readonly string[])[0]
  const opposite = wanted === 'warmer' ? 'cooler' : 'warmer'
  const flipped = scoreCase(
    flipCase,
    output({ name: 'adjust_temperature', arguments: { direction: opposite } }),
  )
  check(
    `flipping ${wanted}→${opposite} is counted in \`flip\` (${flipCase.id})`,
    flipped.flip && !flipped.l2,
  )
  const right = scoreCase(
    flipCase,
    output({ name: 'adjust_temperature', arguments: { direction: wanted } }),
  )
  check('right direction means `flip` must be 0', !right.flip && right.l1)
}

const outOfScope = CASES.find((item) => item.kind === 'out-of-scope')!
const falsePositive = scoreCase(
  outOfScope,
  output({ name: 'set_ac', arguments: { on: true } }),
)
check(
  `an out-of-scope case that changes car state is an FP (${outOfScope.id})`,
  falsePositive.fp,
)
const falseNegative = scoreCase(
  CASES.find((item) => item.kind === 'direct')!,
  output({ name: 'answer_in_words', arguments: { reason: 'chịu' } }),
)
check(
  'the reverse (answering in words to a case that should act) is NOT an FP',
  !falseNegative.fp,
)
const navigation = scoreCase(
  outOfScope,
  output({ name: 'navigate_to', arguments: { screen: 'home' } }),
)
check(
  'a failure seen in early testing ("Mấy giờ rồi" → navigate_to) is not an FP: navigate_to does not change car state',
  !navigation.fp && !navigation.l1,
)

/* --- The table's denominators --- */

const perfect = CASES.map((item) => {
  const args: Record<string, unknown> = {}
  for (const [key, accept] of Object.entries(item.expected)) {
    if (key === 'tool') continue
    // `'any'` = the utterance doesn't say → the model **leaves out** the
    // argument. Assigning `undefined` would create a present-but-empty key,
    // something real JSON never has.
    if (accept === 'any') continue
    args[key] = Array.isArray(accept) ? accept[0] : accept
  }

  // Required arguments the expectation says nothing about — only
  // `answer_in_words.reason`, which is free text so the eval deliberately
  // doesn't score it. The grammar still forces the model to emit it, so the
  // fake output needs it too, otherwise the 8 out-of-scope cases would show up
  // as `invalid`.
  const schema = TOOLS_BY_NAME[item.expected.tool].schema
  for (const name of schema.required) {
    if (args[name] !== undefined) continue
    const property = schema.properties[name]
    const enumValues = property.enum as unknown[] | undefined
    args[name] =
      enumValues?.[0] ??
      (property.type === 'boolean'
        ? true
        : property.type === 'string'
          ? 'x'
          : 0)
  }
  return scoreCase(item, output({ name: item.expected.tool, arguments: args }))
})
const summary = summarise(perfect, 60_000)

check(
  'main denominator = whole set minus the 4 `multi-action` cases',
  summary.scored.total === CASES.length - 4 && summary.multi.total === 4,
  `scored=${summary.scored.total}, multi=${summary.multi.total}, total=${CASES.length}`,
)
check(
  '"perfect" expectations must give L1 = L2 = 100% and a passing verdict',
  summary.l1Pct === 1 && summary.l2Pct === 1 && summary.verdict.pass,
  summary.verdict.failures.join('; '),
)
check(
  'no case is `invalid` when the model returns exactly what the case set expects',
  summary.invalid === 0,
  `invalid=${summary.invalid}`,
)
check(
  'the FP denominator is the number of cases expecting answer_in_words',
  summary.fpOf ===
    CASES.filter((c) => c.expected.tool === 'answer_in_words').length,
  `fpOf=${summary.fpOf}`,
)
check('p50 latency is computed', summary.p50LatencyMs === 1000)

console.log(failed ? `\n${failed} checks failed` : '\nall clear')
