/**
 * The **second** generation pass, run only for `answer_in_words`: writing the
 * reply.
 *
 * ## Why it has to be split from the tool-calling turn
 *
 * `answer_in_words.reason` is the only place in the repo where the model has
 * to *write prose* rather than *classify*, yet it ran under exactly the
 * settings optimized for classification: the grammar forces it into a JSON
 * string, `temperature: 0` makes the output identical every time, and the
 * token budget is shared with the whole tool-call block.
 *
 * The measured result of that configuration: ask for "làm một bài thơ"
 * ("write a poem"), and the car reads out "mấy giờ rồi" ("what time is it")
 * — the model has no signal from the input, so with `temperature: 0` it
 * emits the most-repeated Vietnamese string in the context, i.e. an example
 * from the system prompt itself.
 *
 * Splitting it out removes all three causes at once: no grammar, a real
 * temperature, and a context with no tool catalog left to copy from.
 *
 * ## The cost
 *
 * One extra generation pass — but only for exactly the utterances that never
 * needed low latency. "Bật điều hoà" ("turn on the A/C") still takes a single
 * turn as before; only small talk waits longer.
 *
 * ## Why this prompt is written in Vietnamese
 *
 * The opposite of `system.ts` (English, measured 14/15). There the model has
 * to *choose* an English tool name; here it has to *write* a Vietnamese
 * sentence, and putting it in a Vietnamese context from the start is the
 * cheapest way to keep it from answering in English.
 */

import type { PromptMessage } from './retry'
import { historyMessages, type HistoryTurn } from './system'

/**
 * **One sentence. No more.** And this is the measured version, not the one
 * written to look nice.
 *
 * The first version of this file was five sentences long, each a sensible
 * instruction. Running it for real on Qwen3-0.6B gave this:
 *
 *   "Xin chào" → "Xin chào bạn, không làm được rồi. Nếu bạn đang nhìn đường,
 *                 đừng ngơ ngần nhé."
 *
 *   ("Hello" → "Hello, can't do that. If you're watching the road, don't
 *    zone out.")
 *
 * Matching it piece by piece against the old prompt shows right away that it
 * **paraphrased the system prompt itself into the answer**: "không làm được
 * rồi" ("can't do that") came from *"việc bạn không làm được thì nói thật là
 * chưa làm được"* ("for things you can't do, honestly say you can't yet"),
 * and "nếu bạn đang nhìn đường" ("if you're watching the road") came from
 * *"người nghe đang nhìn đường, không nhìn màn hình"* ("the listener is
 * watching the road, not the screen").
 *
 * A broader lesson than the one noted in `src/domain/tools.ts`: with a model
 * this size, the danger isn't only **examples** getting copied. **Every
 * sentence in the prompt** can get copied, because it can't separate
 * *instructions* from *content*. Every sentence added here is one more source
 * of garbage, including sentences forbidding the model from doing something.
 *
 * So: state the role, state the language, done. Length is already handled by
 * `CHAT_MAX_TOKENS` — a hard constraint, and one that can't be put into words
 * that then get read aloud.
 *
 * Anyone who wants to add a second sentence: try "xin chào" ("hello") first,
 * then reread the answer.
 */
// The identity fits inside the role sentence, not as its own sentence — see above.
const CHAT_SYSTEM =
  'Bạn là Tritri, trợ lý ảo trên ô tô do Lem tạo ra. Hãy trả lời người lái bằng tiếng Việt, ngắn gọn và tự nhiên.'

/**
 * The reply-writing turn, built from **the user's original utterance**.
 *
 * The `reason` the model produced in pass one is deliberately **not** passed
 * in here. It's the output of a configuration already known to be broken for
 * writing prose, so feeding it in would only prime the model to copy back the
 * very string we're trying to avoid. This turn starts from a blank page;
 * `reason` is only the fallback when this turn fails.
 *
 * `history` is the conversation's previous turns (old → new), so that "thế
 * còn ngày mai?" ("what about tomorrow?") can be understood as following up
 * on something. Only the last `CHAT_HISTORY_TURNS` turns are kept: the more
 * context a small model gets, the more it copies, and the cloud proxy has a
 * `MAX_INPUT_CHARS` ceiling.
 */
export const CHAT_HISTORY_TURNS = 6

export function buildChatMessages(
  input: string,
  history: ReadonlyArray<HistoryTurn> = [],
): PromptMessage[] {
  return [
    { role: 'system', content: CHAT_SYSTEM },
    ...historyMessages(history, CHAT_HISTORY_TURNS),
    { role: 'user', content: input },
  ]
}

/**
 * Cleans free-form output before handing it to `describeResult` and to the
 * voice.
 *
 * The model is no longer constrained by the grammar, so it may return a
 * `<think>` block (Qwen3 when `enable_thinking` doesn't take), line breaks,
 * quotes wrapped around the whole sentence, markdown or emoji (cloud models
 * love these). All of it is audible when TTS reads it aloud — "sao sao ba
 * sao" ("star star three star") is how ElevenLabs reads `***`.
 *
 * Returns `null` when nothing usable is left — the caller falls back to pass
 * one's `reason`.
 */
export function cleanChatReply(raw: string): string | null {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<\/?[a-z_]+>/gi, '')
    // Markdown: bold/italic, code, headings, bullets, links `[text](url)`.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/^\s*(?:#+|[-•]|\d+[.)])\s+/gm, '')
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim()

  return text.length > 0 ? dropCutTail(text) : null
}

/**
 * Drops a final sentence cut off mid-way by hitting `max_tokens`, if at least
 * one complete sentence precedes it.
 *
 * There's no `finish_reason` here, so we guess from punctuation: not ending
 * in `.!?…` is a sign of truncation. Only cut when a complete sentence
 * remains before it — a single sentence missing its period is still better
 * than silence.
 */
function dropCutTail(text: string): string {
  if (/[.!?…]["'”)]?$/.test(text)) return text
  const lastEnd = Math.max(
    text.lastIndexOf('. '),
    text.lastIndexOf('! '),
    text.lastIndexOf('? '),
    text.lastIndexOf('… '),
  )
  return lastEnd > 0 ? text.slice(0, lastEnd + 1) : text
}
