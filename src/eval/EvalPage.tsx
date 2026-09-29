/**
 * Route `#/eval`: a separate page inside the app itself, not a button buried
 * in `settings`. A run takes several minutes and the table needs the whole
 * screen; cram it into `settings` and both break.
 *
 * Shares `src/domain` and `src/prompt` with the real app, so the schema and the
 * prompt wording never drift from what users actually get. That's why this
 * page lives in the app rather than being a Node script.
 *
 * A **measuring** page, not a product page: no animation, no worrying about
 * narrow screens, every number shown in the rawest readable form.
 */

import { useCallback, useMemo, useRef, useState } from 'react'

import { CASES, COVERED_TOOLS, KINDS, REGISTERS } from './cases'
import {
  CONFIG_CATALOG,
  describeConfig,
  runEval,
  suggestFilename,
  type ConfigRun,
  type EvalRun,
  type Pass,
  type Progress,
} from './run-eval'
import { THRESHOLDS, type Slice, type Summary } from './score'
import { TOOL_SETS } from './tool-sets'
import { PROMPT_VARIANTS } from '../prompt/variants'
import { TOOL_NAMES } from '../domain/tools'

const pct = (value: number) => `${(value * 100).toFixed(1)}%`
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** Mean plus min–max: `repeats` mode only means something if you can see the spread. */
function spread(values: number[], format: (value: number) => string): string {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (values.length === 1) return format(mean)
  const min = Math.min(...values)
  const max = Math.max(...values)
  return `${format(mean)} (${format(min)}–${format(max)})`
}

const metric = (
  passes: Pass[],
  pick: (summary: Summary) => number,
  format: (value: number) => string,
) =>
  spread(
    passes.map((pass) => pick(pass.summary)),
    format,
  )

function SliceRow({ label, slice }: { label: string; slice: Slice }) {
  if (slice.total === 0) return null
  return (
    <tr className="border-t border-neutral-800">
      <td className="py-1 pr-4 text-neutral-400">{label}</td>
      <td className="py-1 pr-4 tabular-nums">
        {slice.l1}/{slice.total} · {pct(slice.l1 / slice.total)}
      </td>
      <td className="py-1 tabular-nums">
        {slice.l2}/{slice.total} · {pct(slice.l2 / slice.total)}
      </td>
    </tr>
  )
}

function ConfigDetail({ run }: { run: ConfigRun }) {
  const [open, setOpen] = useState(false)
  const first = run.passes[0]
  if (!first) return null

  // Debug on the first pass: later passes are only for measuring spread, not
  // for cherry-picking a nice one.
  const failures = first.outcomes.filter((outcome) => !outcome.l2)

  return (
    <details
      className="rounded border border-neutral-800 bg-neutral-950 p-3"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm text-neutral-300">
        {run.label} — {failures.length} cases failing L2
      </summary>

      <div className="mt-3 grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs text-neutral-500 uppercase">By kind</h4>
          <table className="w-full text-sm">
            <tbody>
              {KINDS.map((kind) => (
                <SliceRow
                  key={kind}
                  label={kind}
                  slice={first.summary.byKind[kind]}
                />
              ))}
            </tbody>
          </table>

          <h4 className="mt-4 mb-1 text-xs text-neutral-500 uppercase">
            By register
          </h4>
          <table className="w-full text-sm">
            <tbody>
              {REGISTERS.map((register) => (
                <SliceRow
                  key={register}
                  label={register}
                  slice={first.summary.byRegister[register]}
                />
              ))}
            </tbody>
          </table>

          <p className="mt-4 text-xs text-neutral-500">
            4 <code>multi-action</code> cases (outside the threshold, scored on
            the first clause): L1 {first.summary.multi.l1}/
            {first.summary.multi.total} · L2 {first.summary.multi.l2}/
            {first.summary.multi.total}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Same numbers over the whole case set: L1{' '}
            {pct(first.summary.l1PctAll)} · L2 {pct(first.summary.l2PctAll)}
          </p>
          {first.summary.fanFlip > 0 && (
            <p className="mt-1 text-xs text-amber-400">
              Fan <code>stronger</code>/<code>weaker</code> flips:{' '}
              {first.summary.fanFlip} — no threshold, but the same kind of error
              as <code>flip</code>.
            </p>
          )}
        </div>

        <div>
          <h4 className="mb-1 text-xs text-neutral-500 uppercase">
            Cases failing L2 (first pass)
          </h4>
          <ul className="space-y-2 text-sm">
            {failures.map((outcome) => (
              <li
                key={outcome.caseId}
                className="border-l-2 border-rose-700 pl-2"
              >
                <div className="text-neutral-200">
                  <span className="text-neutral-500">{outcome.caseId}</span>{' '}
                  {outcome.input}
                </div>
                <div className="text-xs text-rose-300">{outcome.problem}</div>
                <div className="text-xs text-neutral-500">
                  {outcome.call
                    ? `${outcome.call.name}(${JSON.stringify(outcome.call.arguments)})`
                    : 'no tool call'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-neutral-500">
          System prompt used
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-black p-2 text-[11px] whitespace-pre-wrap text-neutral-400">
          {run.systemPrompt}
        </pre>
      </details>
    </details>
  )
}

export default function EvalPage() {
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(CONFIG_CATALOG.filter((item) => item.defaultOn).map((i) => i.id)),
  )
  const [repeatsMode, setRepeatsMode] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<EvalRun | null>(null)
  const [running, setRunning] = useState(false)
  const cancelled = useRef(false)

  const uncovered = useMemo(
    () => TOOL_NAMES.filter((name) => !COVERED_TOOLS.has(name)),
    [],
  )

  const start = useCallback(async () => {
    cancelled.current = false
    setRunning(true)
    setResult(null)
    try {
      const run = await runEval({
        configs: CONFIG_CATALOG.filter((item) => selected.has(item.id)),
        // Default to 1 pass at temperature 0 so the loop is fast enough to
        // actually get used; 3 passes at 0.7 only for the measurement that
        // settles the model.
        repeats: repeatsMode ? 3 : 1,
        temperature: repeatsMode ? 0.7 : 0,
        onProgress: setProgress,
        isCancelled: () => cancelled.current,
      })
      setResult(run)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }, [repeatsMode, selected])

  const download = useCallback(() => {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = suggestFilename(result)
    anchor.click()
    URL.revokeObjectURL(url)
  }, [result])

  return (
    <div className="min-h-dvh bg-neutral-900 p-6 text-neutral-100">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">
          Vietnamese eval suite — {CASES.length} cases
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Thresholds, settled before running:{' '}
          <strong>L1 ≥ {pct(THRESHOLDS.l1)}</strong> ·{' '}
          <strong>L2 ≥ {pct(THRESHOLDS.l2)}</strong> ·{' '}
          <strong>FP ≤ {THRESHOLDS.fpMax}</strong> ·{' '}
          <strong>flip = {THRESHOLDS.flipMax}</strong>. If it fails, escalate
          prompt → tool set → bigger model; don't lower the thresholds.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          L1%/L2% are computed over 46 cases — the 4 <code>multi-action</code>{' '}
          cases are outside the threshold. <code>temperature: 0</code> is
          clamped by web-llm to 1e-6, i.e. <strong>near-greedy</strong>, not
          argmax. The seed only reproduces on the same machine.
          {uncovered.length > 0 && (
            <> Tools not covered by any case: {uncovered.join(', ')}.</>
          )}
        </p>
      </header>

      <section className="mb-6 space-y-2">
        {CONFIG_CATALOG.map((config) => {
          const toolSet = TOOL_SETS.find((set) => set.id === config.toolSetId)
          const variant = PROMPT_VARIANTS.find(
            (item) => item.id === config.promptVariantId,
          )
          return (
            <label key={config.id} className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(config.id)}
                disabled={running}
                onChange={(event) =>
                  setSelected((previous) => {
                    const next = new Set(previous)
                    if (event.target.checked) next.add(config.id)
                    else next.delete(config.id)
                    return next
                  })
                }
              />
              <span>
                <span className="text-neutral-100">
                  {describeConfig(config)}
                </span>
                <span className="block text-xs text-neutral-500">
                  {toolSet?.hypothesis} · {variant?.hypothesis}
                </span>
              </span>
            </label>
          )
        })}

        <label className="flex items-center gap-3 pt-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={repeatsMode}
            disabled={running}
            onChange={(event) => setRepeatsMode(event.target.checked)}
          />
          <code>repeats</code> mode: 3 passes at <code>temperature: 0.7</code>,
          seed changes per pass, prints min/max too
        </label>
      </section>

      <section className="mb-6 flex items-center gap-3">
        <button
          type="button"
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium disabled:opacity-40"
          disabled={running || selected.size === 0}
          onClick={start}
        >
          Run {selected.size} configurations
        </button>
        <button
          type="button"
          className="rounded border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
          disabled={!running}
          onClick={() => {
            cancelled.current = true
          }}
        >
          Stop
        </button>
        <button
          type="button"
          className="rounded border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
          disabled={!result}
          onClick={download}
        >
          Download JSON
        </button>
        {result && (
          <span className="text-xs text-neutral-500">GPU: {result.gpu}</span>
        )}
      </section>

      {progress && (
        <section className="mb-6 rounded border border-neutral-800 bg-neutral-950 p-3 text-sm">
          <div className="text-neutral-300">
            [{progress.configIndex + 1}/{progress.configTotal}]{' '}
            {progress.configLabel} — {progress.phase}
            {progress.passTotal > 1 &&
              ` · pass ${progress.passIndex + 1}/${progress.passTotal}`}
          </div>
          <div className="text-xs text-neutral-500">
            {progress.phase === 'running' &&
              `case ${progress.caseIndex + 1}/${progress.caseTotal} — `}
            {progress.detail}
          </div>
          <div className="mt-2 h-1 w-full bg-neutral-800">
            <div
              className="h-1 bg-emerald-600"
              style={{
                width: `${((progress.caseIndex + 1) / progress.caseTotal) * 100}%`,
              }}
            />
          </div>
        </section>
      )}

      {result && (
        <>
          <table className="mb-6 w-full text-sm">
            <thead className="text-left text-xs text-neutral-500 uppercase">
              <tr>
                <th className="py-2 pr-4">Configuration</th>
                <th className="py-2 pr-4">L1%</th>
                <th className="py-2 pr-4">L2%</th>
                <th className="py-2 pr-4">FP</th>
                <th className="py-2 pr-4">flip</th>
                <th className="py-2 pr-4">invalid</th>
                <th className="py-2 pr-4">p50</th>
                <th className="py-2 pr-4">total</th>
                <th className="py-2">verdict</th>
              </tr>
            </thead>
            <tbody>
              {result.configs.map((configRun) => {
                const passes = configRun.passes
                if (configRun.error || passes.length === 0) {
                  return (
                    <tr
                      key={configRun.config.id}
                      className="border-t border-neutral-800"
                    >
                      <td className="py-2 pr-4">{configRun.label}</td>
                      <td className="py-2 text-rose-400" colSpan={8}>
                        died mid-way: {configRun.error ?? 'no passes'}
                      </td>
                    </tr>
                  )
                }
                const verdict = passes[0].summary.verdict
                return (
                  <tr
                    key={configRun.config.id}
                    className="border-t border-neutral-800"
                  >
                    <td className="py-2 pr-4">{configRun.label}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {metric(passes, (s) => s.l1Pct, pct)}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {metric(passes, (s) => s.l2Pct, pct)}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {metric(passes, (s) => s.fp, String)}/
                      {passes[0].summary.fpOf}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {metric(passes, (s) => s.flip, String)}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {metric(passes, (s) => s.invalid, String)}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {metric(
                        passes,
                        (s) => s.p50LatencyMs,
                        (v) => `${Math.round(v)} ms`,
                      )}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {metric(passes, (s) => s.totalMs, secs)}
                    </td>
                    <td
                      className={
                        verdict.pass
                          ? 'py-2 text-emerald-400'
                          : 'py-2 text-rose-400'
                      }
                    >
                      {verdict.pass ? 'pass' : verdict.failures.join('; ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="space-y-3">
            {result.configs.map((configRun) => (
              <ConfigDetail key={configRun.config.id} run={configRun} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
