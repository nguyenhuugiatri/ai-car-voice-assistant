/**
 * Prompt variants — one dimension of the eval's `(model, tool set, prompt)`
 * configuration axes.
 *
 * The boundary between two of the axes:
 *
 * - The **`tool set`** axis = *which tools are present* (standard set vs. a
 *   variant that merges toggles).
 * - The **`prompt`** axis = everything that flows into the system prompt,
 *   **including the tools' `description`**. `description` doesn't touch the
 *   grammar at all (`buildStructuralTag` only reads `name` and `schema`), so
 *   treating it as "tool set" would mix the two variants together and the
 *   eval table would no longer be readable.
 *
 * That's why variants override descriptions via `descriptionOverrides`
 * instead of editing `src/domain/tools.ts` — the default descriptions stay
 * exactly as the tool table defines them.
 *
 * Each variant changes **exactly one** thing relative to `P0`. Change two at
 * once and even if it wins you won't know which one did it.
 */

import type { ToolName } from '../domain/tools'

/** Whether the catalog emits bare `description`s, or includes the parameters' JSON Schema too. */
export type CatalogMode = 'desc' | 'desc+schema'

export type PromptVariant = {
  id: string
  /** One line for the eval table — how this variant differs from `P0`. */
  hypothesis: string
  catalog: CatalogMode
  descriptionOverrides: Partial<Record<ToolName, string>>
}

/**
 * The baseline. It's the two-intent-hint prompt that measured 14/15 tool
 * names, with exactly one sentence changed: the original said *"If the
 * request matches no real tool, call `unsupported`"*, framing the
 * escape-hatch tool as a loser — whereas the tool was renamed to
 * `answer_in_words` precisely to avoid that framing. The new sentence lives
 * in `system.ts`.
 *
 * The original two intent hints are unchanged. The third one (`tell_time`)
 * was added later because it had measurements behind it — see
 * `INTENT_HINTS` in `system.ts`. Every sentence added is an unmeasured
 * variable.
 */
export const P0: PromptVariant = {
  id: 'P0',
  hypothesis:
    'Baseline — the 14/15 two-intent-hint frame, description-only catalog',
  catalog: 'desc',
  descriptionOverrides: {},
}

/**
 * The strongest hypothesis, and the only one with direct evidence: the 14/15
 * figure was measured on a prompt that **did** include the parameters' JSON
 * Schema (each tool was emitted as
 * `{ name, description, parameters: t.schema }`), whereas the tool surface
 * settled "the schema is not put into the system prompt" by argument alone.
 * That is, the 14/15 baseline was never re-measured after the schema was
 * dropped.
 *
 * Most suspicious in the `L2` column: that measurement reached 14/15 on tool
 * names but only 11/15 on arguments, and back then the model *was* seeing the
 * schema.
 *
 * If `P1` beats `P0`, **revisit the tool surface's rule** of keeping the
 * schema out of the prompt (see `src/domain/tools.ts`) — that's where the
 * decision lives, not in the prompt variants.
 */
export const P1: PromptVariant = {
  id: 'P1',
  hypothesis:
    "Catalog with parameters' JSON Schema — evidence: the 14/15 baseline was measured with schema",
  catalog: 'desc+schema',
  descriptionOverrides: {},
}

/**
 * The only systematic failure left: "Mấy giờ rồi" ("what time is it") →
 * `navigate_to` (measured early on, when the escape-hatch tool was still
 * named `unsupported`).
 *
 * The hypothesis: the bug is `navigate_to` **pulling too broadly**, not
 * `answer_in_words` being described too weakly. To a 1.5B model, "cho
 * tôi biết mấy giờ" ("tell me the time") and "cho tôi xem màn hình" ("show me
 * the screen") are both *"display something for me"*.
 *
 * **This hypothesis narrowed considerably once `tell_time` arrived.** Time
 * questions now have their own tool, so `navigate_to`'s "pulling too
 * broadly" only has to compete with the weather, news and maps. `P2` thus
 * only measures the *view a screen ↔ ask about things outside the car*
 * boundary — still worth measuring, but if it beats `P0` the win will be
 * smaller than originally expected.
 *
 * The `answer_in_words` override here **deliberately doesn't repeat the two
 * bugs of the old description** (a negated sentence, and an example string
 * appearing twice) — see the long note in `src/domain/tools.ts`. Before the
 * fix, `P2` carried both bugs verbatim plus one more Vietnamese string, so it
 * would almost certainly have made the "answering with the prompt's own
 * example" symptom worse than `P0`.
 */
export const P2: PromptVariant = {
  id: 'P2',
  hypothesis: 'Two-sided navigate_to ↔ answer_in_words boundary',
  catalog: 'desc',
  descriptionOverrides: {
    navigate_to:
      `Show a different screen. This car has exactly three screens and nothing else: ` +
      `'home', 'climate', 'settings'. Arguments: screen. Vietnamese commands sound like ` +
      `"mở điều hoà" (climate — showing the screen, NOT turning the A/C on), ` +
      `"về màn hình chính" (home), "cho tôi xem phần cài đặt" (settings). ` +
      `Asking to see or to know something that is not one of those three screens — the ` +
      `weather, the news, the map — belongs to answer_in_words; asking the clock or the ` +
      `date belongs to tell_time.`,
    // Not a single Vietnamese word, for the reason documented at length in
    // `src/domain/tools.ts`: Vietnamese strings in this tool's description
    // leak straight into `reason`.
    answer_in_words:
      `Reply with words instead of touching the car. This is the tool for every question ` +
      `the driver asks that the car has no instrument for: the weather, traffic, the news, ` +
      `phone calls, jokes, small talk. Arguments: reason — one short sentence ` +
      `answering the driver, written in Vietnamese, in the assistant's own voice.`,
  },
}

/**
 * `P3 = P1 + P2` is **deliberately not built yet.** Only build it if both
 * `P1` and `P2` beat `P0` in the eval run that picks the final prompt —
 * building it up front gives the table four rows, two of which have no
 * reason to exist yet.
 */
export const PROMPT_VARIANTS: PromptVariant[] = [P0, P1, P2]
