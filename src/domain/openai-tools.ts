/**
 * Maps the tool table onto OpenAI **function calling**, and maps the result
 * back into exactly the `<tool_call>…</tool_call>` string the whole repo reads.
 *
 * ## Why we still rebuild the `<tool_call>` string instead of returning structured `tool_calls`
 *
 * Because `<tool_call>` is **the shared format of both paths**. Everything
 * after `generate()` — `parseToolCalls`, `buildRetryMessages`, the debug
 * panel's `rawToolCall` column, and even how the eval writes raw output to
 * JSON — already speaks that language. Changing the shape at this layer to be
 * "cleaner" means every one of those places has to learn a second shape, and
 * the debug panel would show two different kinds of text depending on the
 * selected model — i.e. lose the very thing it exists to do.
 *
 * This is an **adapter**, and its cost is one `JSON.stringify`.
 *
 * ## The real difference between grammar and function calling
 *
 * WebLLM's `structural_tag` constrains at the token level: the model *cannot*
 * emit a wrong tool name or a wrong enum. OpenAI doesn't constrain — it's
 * trained to follow the schema and almost always does, but "almost" is not
 * "cannot".
 *
 * So on the cloud path, `validateToolCall` (Zod) is **no longer a redundant
 * layer** — it's the only layer. That's exactly the case the comment in
 * `src/domain/tool-args.ts` named in advance: "the cloud baseline (no
 * grammar at all)".
 */

import { TOOL_CALL_TRIGGER } from './structural-tag'
import { TOOLS, type ToolDefinition } from './tools'

/** The Chat Completions `tools[]` shape. */
export type OpenAiTool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/**
 * `ToolDefinition[]` → `tools[]`.
 *
 * `strict: true` is deliberately **not** enabled. Structured Outputs requires
 * every key in `properties` to be in `required` (optional params must be
 * declared as a union with `null`), while the whole tool table here is built
 * around optional params with defaults: a missing `zone` means `both`, a
 * missing `magnitude` means `normal`. Enabling `strict` would force rewriting
 * `src/domain/tools.ts` for one path, and then WebLLM's grammar would read a
 * different schema — the two paths would diverge right where the eval is
 * comparing them.
 */
export function buildOpenAiTools(
  tools: ToolDefinition[] = TOOLS,
): OpenAiTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema as unknown as Record<string, unknown>,
    },
  }))
}

type RawToolCall = {
  function?: { name?: string; arguments?: string }
}

/**
 * `message.tool_calls` → a `<tool_call>` string, just like the on-device
 * model emits.
 *
 * `arguments` arrives as a **JSON string**, not an object. We don't parse and
 * re-stringify: if OpenAI returns broken JSON (rare, but nothing forbids it),
 * we want that broken string to show up verbatim in the debug panel and go
 * into the correction turn — exactly like broken output from the on-device
 * model. Healing it here would hide the one failure case the retry turn was
 * built to handle.
 */
export function renderToolCall(call: RawToolCall): string | null {
  const name = call.function?.name
  if (!name) return null
  const args = call.function?.arguments?.trim() || '{}'
  return `${TOOL_CALL_TRIGGER}\n{"name": "${name}", "arguments": ${args}}\n</tool_call>`
}
