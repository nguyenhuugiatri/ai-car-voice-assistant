/**
 * The retry turn — "if it's wrong, retry exactly once".
 *
 * **Important warning: this loop may almost never run.**
 *
 * The retry rule was written before anyone knew how far `structural_tag`
 * could constrain. Now we know: the grammar already enforces enums, types,
 * required params, and even the tool name (the name lives in the `begin`
 * string, not in the schema). Zod runs *after* the grammar, so mostly there's
 * nothing left to catch. What remains is almost only `parseToolCalls` coming
 * back empty — an infrastructure failure, not a semantic one.
 *
 * As for the real failure seen in the first measurements — "Mấy giờ rồi"
 * ("what time is it") → `navigate_to` — Zod **cannot** detect it: the JSON is
 * perfectly valid, just the wrong tool. Retry can't rescue that kind of error;
 * only the wording of the tool descriptions can (variant `P2`).
 *
 * So don't tweak the wording here before there are numbers. The eval table
 * already has an `invalid` column — if the whole utterance set comes out with
 * `invalid = 0`, **drop retry entirely**; don't optimize a dead branch.
 */

export type PromptMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Keeps the entire original turn, appends the broken output in the
 * `assistant` role, then a correcting `user` turn.
 *
 * Two deliberate choices:
 *
 * - **Keep the raw output as the `assistant` turn**, not a summary. The model
 *   can fix what it sees; retelling it in words loses the very character
 *   that caused the error.
 * - **The correction is written in English and names the broken field
 *   explicitly.** Same language as the system prompt (measured: English
 *   prompt + Vietnamese user utterances = 14/15), and it names the field
 *   because a generic "try again" gives the model no information beyond what
 *   it had the first time.
 */
export function buildRetryMessages(
  original: PromptMessage[],
  rawOutput: string,
  problem: string,
): PromptMessage[] {
  return [
    ...original,
    { role: 'assistant', content: rawOutput },
    {
      role: 'user',
      content:
        `That tool call was rejected: ${problem}. ` +
        `Emit one corrected tool call for the same request. Change only what was wrong.`,
    },
  ]
}
