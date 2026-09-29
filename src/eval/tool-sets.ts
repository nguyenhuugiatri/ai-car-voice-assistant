/**
 * The **`tool set`** axis of the `(model, tool set, prompt)` configuration.
 *
 * Right now this axis has **exactly one point**: the real `TOOLS` table from
 * `src/domain/tools.ts`. It is still an axis rather than a constant because
 * `toolSetId` is written into every row of the exported results — dropping
 * that field would make the old result files unreadable.
 *
 * ## The merged-toggle set has been removed
 *
 * There used to be a `MERGED_TOOL_SET`: `set_ac` and `set_recirculation` merged
 * into `set_climate_feature(feature, on)`, built to test a hypothesis the
 * domain model left open — two on/off tools with near-identical descriptions
 * might be splitting a small model's attention. The domain model chose not to
 * merge (a tool name is a stronger signal than an enum value; see
 * `docs/domain-model.md`), and that hypothesis is now dropped for good rather
 * than kept in reserve: it was a second tool surface that had to be edited in
 * parallel with the real one every time `TOOLS` changed, and no button in the
 * UI corresponds to `set_climate_feature`.
 *
 * `normalise` went at the same time — the merged set was the only thing that
 * needed it. If a variant that emits names outside `TOOL_NAMES` is added later,
 * rebuild `normalise` **together with** that variant; don't keep an identity
 * function around waiting for work: `src/eval/cases.ts` declares expectations
 * in terms of `ToolName`, so any variant that renames tools must declare its
 * own mapping back to the standard names, and that's its own business.
 */

import type { ToolDefinition } from '../domain/tools'
import { TOOLS } from '../domain/tools'

export type ToolSet = {
  id: string
  label: string
  /** One line for the table: how this set differs from the standard set. */
  hypothesis: string
  tools: ToolDefinition[]
}

/** The standard set: exactly the domain's `TOOLS` table. */
export const FULL_TOOL_SET: ToolSet = {
  id: 'tools-full',
  label: 'standard set',
  hypothesis: 'Standard set — tool names are the signal, not enum values',
  tools: TOOLS,
}

export const TOOL_SETS: ToolSet[] = [FULL_TOOL_SET]
