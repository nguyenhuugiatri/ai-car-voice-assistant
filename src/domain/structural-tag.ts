/**
 * Loads the tool table into WebLLM's `response_format`.
 *
 * The shape is nested two levels deep — `response_format.structural_tag.format`
 * — not a flat `{ type, tags, triggers }` (that's XGrammar's legacy API, not
 * usable through web-llm).
 *
 * The tool name lives in the `begin` string, not in the schema. The good
 * consequence: the grammar won't let the model invent tool names. The one to
 * remember: `schema` only describes the `arguments` object, and the closing
 * `}` of the outer object lives in `end`.
 */

import { TOOLS, type ToolDefinition } from './tools'

export const TOOL_CALL_TRIGGER = '<tool_call>'

export type StructuralTagFormat = {
  type: 'triggered_tags'
  triggers: string[]
  tags: Array<{
    begin: string
    content: { type: 'json_schema'; json_schema: Record<string, unknown> }
    end: string
  }>
  /**
   * `true` is mandatory, not a tweak. `triggered_tags` only constrains what
   * comes AFTER the trigger, and the model isn't forced to emit the trigger at
   * all. Measured: with `false`, Qwen2.5-1.5B got 0/15 syntactically
   * correct — it produced perfect JSON but didn't wrap it in the tag. With
   * `true`: 15/15.
   *
   * The price is that the model has no way to stay silent — hence
   * `answer_in_words` has to exist.
   */
  at_least_one: true
  /**
   * `true` to match exactly the configuration that measured 14/15. Setting
   * `false` would open the door to multiple tool calls per utterance (a
   * secondary goal) but would invalidate the 14/15 figure. If you want to
   * change it, re-measure with the eval suite first.
   */
  stop_after_first: true
}

/**
 * Takes `tools` as a parameter (defaulting to `TOOLS`) instead of reading
 * `TOOLS` directly: the eval's `tool set` axis calls this with the tool
 * table of the set being run. The grammar only reads each tool's `name` and
 * `schema`, nothing else.
 */
export function buildStructuralTag(tools: ToolDefinition[] = TOOLS): {
  type: 'structural_tag'
  format: StructuralTagFormat
} {
  return {
    type: 'structural_tag',
    format: {
      type: 'triggered_tags',
      triggers: [TOOL_CALL_TRIGGER],
      tags: tools.map((tool) => ({
        begin: `${TOOL_CALL_TRIGGER}\n{"name": "${tool.name}", "arguments": `,
        content: { type: 'json_schema', json_schema: tool.schema },
        end: '}\n</tool_call>',
      })),
      at_least_one: true,
      stop_after_first: true,
    },
  }
}

/** Goes straight into `ChatCompletionRequest.response_format`. */
export function buildResponseFormat(tools: ToolDefinition[] = TOOLS) {
  return {
    type: 'structural_tag' as const,
    structural_tag: buildStructuralTag(tools),
  }
}

/**
 * The tool catalog for the system prompt has moved to `src/prompt/system.ts`
 * (`renderToolCatalog`). `description` belongs to the eval's `prompt` axis,
 * not the `tool set` axis, so the catalog has to accept a variant's
 * description overrides — and keeping two catalog builders means they'd drift
 * apart without anyone noticing.
 *
 * This file now only handles what the grammar actually reads: `name` and
 * `schema`.
 */

/**
 * Extracts tool calls from raw text. WebLLM does NOT parse the structural tag
 * into `message.tool_calls` — the result sits in `choices[0].message.content`
 * as text.
 */
export function parseToolCalls(
  content: string,
): Array<{ name: string; arguments: unknown }> {
  const regex = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g
  const calls: Array<{ name: string; arguments: unknown }> = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    try {
      const payload = JSON.parse(match[1])
      if (typeof payload.name === 'string' && payload.arguments !== undefined) {
        calls.push({ name: payload.name, arguments: payload.arguments })
      }
    } catch {
      // The grammar guarantees the syntax inside the tag, so reaching here is
      // abnormal — skip it and let the retry loop handle it.
    }
  }
  return calls
}
