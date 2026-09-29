/**
 * Has the user finished speaking? — `WAIT` or `COMMIT`, and if `WAIT`, how much
 * longer to wait.
 *
 * Ported from an earlier voice prototype, thresholds and word tables
 * unchanged. This is **conversation policy**, not car logic: it knows
 * nothing about tools or `CarState`, and it is a **pure function** — no clock,
 * no state. The caller measures `silenceMs` and schedules its own timers.
 *
 * ## Why diacritics are not stripped
 *
 * `à` (a filler, still thinking) and `ạ` (a politeness particle, sentence
 * over) both strip down to the same string `a`, yet lead to opposite
 * decisions. At this layer tone marks *are* data, not noise. We only apply NFC
 * normalization and collapse whitespace.
 *
 * ## Why Vietnamese is cheaper than other languages here
 *
 * Sentence-final particles (`không`, `nhé`, `ạ`, `đi`…) are a much stronger
 * end-of-turn signal than a period — and streaming ASR almost never returns a
 * period anyway. `bật điều hoà đi` ("turn on the A/C") is done; `cho anh hỏi`
 * ("let me ask") is not, even though both are grammatical.
 *
 * ## The order of the branches matters
 *
 * Reading `evaluateEndpoint` top to bottom is reading in decreasing order of
 * certainty. Reordering them changes behavior; it is not a refactor.
 */

/** Fillers at the end of an utterance: the user is thinking, not done yet. */
const FILLER_TOKENS = new Set(['ờ', 'à', 'ừm', 'um', 'uh'])

/** Lead-in phrases: the main content is certainly still to come after them. */
const FILLER_PHRASES = ['kiểu là', 'ý là', 'hỏi là', 'cho tôi', 'cho anh']

/** Explicit closers — the user says outright that they are done. */
const EXPLICIT_FINISH_PHRASES = ['hết rồi', 'cảm ơn', 'thank you', 'thanks']

/**
 * Vietnamese sentence-final particles. An utterance ending in one of these is
 * almost certainly a complete thought.
 *
 * `đi`, `nào` and `với` are this repo's additions to the earlier prototype:
 * there the user *asks* an assistant, here people *order* the car around — and
 * Vietnamese imperatives close with exactly these three words ("bật điều hoà
 * **đi**" ("turn on the A/C"), "giảm gió **với**" ("turn the fan down")).
 * Without them every command would have to wait for the 1.3 s ceiling.
 */
const COMPLETE_SUFFIXES = new Set([
  'không',
  'chứ',
  'nhỉ',
  'hả',
  'ạ',
  'rồi',
  'đó',
  'vậy',
  'nhé',
  'nha',
  'đi',
  'nào',
  'với',
])

/**
 * Silence ceiling when there is **no semantic signal at all**. Hitting it
 * commits the turn, even without understanding anything about the utterance.
 *
 * This number must be higher than the auto-stop threshold of whichever
 * recognizer is plugged in. Set it lower and it fires first, overriding the
 * recognizer's decision — which is based on the audio, and always better than
 * a clock.
 */
export const NO_SIGNAL_CEILING_MS = 1300

/** Below this, silence means nothing yet — it is just a breath. */
const MIN_SILENCE_MS = 120

/** Minimum silence before a semantic signal is allowed to commit the turn. */
const COMMIT_SILENCE_MS = 250

/** Longest wait when nothing better is known — short enough to re-check soon. */
const MAX_WAIT_SLICE_MS = 300

export type EndpointReason =
  /** Speech in progress; nothing more to discuss. */
  | 'active_speech'
  /** Silence too short to mean anything. */
  | 'short_silence'
  /** Looks complete and nothing is left dangling. */
  | 'stable_complete'
  /** Ends with a lead-in clause (`cho anh hỏi`, "let me ask"). */
  | 'incomplete_clause'
  /** Ends with a filler (`ừm`, "umm"). */
  | 'filler'
  /** Explicitly says it's done (`cảm ơn` ("thanks"), a `?`). */
  | 'explicit_finish'
  /** Hit the silence ceiling; nothing left to wait for. */
  | 'timeout_commit'

export type EndpointDecision = {
  decision: 'WAIT' | 'COMMIT'
  /** 0..1 — confidence in this decision itself, not in the transcript. */
  confidence: number
  /** On `WAIT`, check again after this many ms. Always 0 for `COMMIT`. */
  maxWaitMs: number
  reason: EndpointReason
}

export type EndpointInput = {
  /** The committed part of the transcript, no longer revised by the ASR. */
  stableText: string
  /** The full raw partial, including the part still being revised. */
  fullPartial: string
  /** How long it has been silent as of this call. */
  silenceMs: number
  /** Client-side VAD currently hears speech. */
  localSpeechActive: boolean
}

export function evaluateEndpoint({
  stableText,
  fullPartial,
  silenceMs,
  localSpeechActive,
}: EndpointInput): EndpointDecision {
  // Still hearing speech: nothing to discuss.
  if (localSpeechActive) {
    return wait({ confidence: 1, maxWaitMs: 0, reason: 'active_speech' })
  }

  // Silence shorter than a breath carries no information yet.
  if (silenceMs < MIN_SILENCE_MS) {
    return wait({
      confidence: 1,
      maxWaitMs: MIN_SILENCE_MS - silenceMs,
      reason: 'short_silence',
    })
  }

  // The user said outright that they're done — the surest case, no need to
  // wait for enough silence.
  if (endsExplicitFinish(fullPartial)) {
    return commit({ confidence: 0.98, reason: 'explicit_finish' })
  }

  // Ends with a filler or a lead-in clause: wait, but with a ceiling.
  if (endsFillerOrIncomplete(fullPartial) && silenceMs < NO_SIGNAL_CEILING_MS) {
    return wait({
      confidence: 0.9,
      maxWaitMs: NO_SIGNAL_CEILING_MS - silenceMs,
      reason: fillerReason(fullPartial),
    })
  }

  // Complete thought, enough silence, and stable has caught up with partial.
  if (
    looksSyntacticallyComplete(stableText) &&
    silenceMs >= COMMIT_SILENCE_MS &&
    stablePrefixIsCurrent(stableText, fullPartial)
  ) {
    return commit({ confidence: 0.9, reason: 'stable_complete' })
  }

  // No idea what the utterance means, but we have waited as long as allowed.
  if (silenceMs >= NO_SIGNAL_CEILING_MS) {
    return commit({ confidence: 0.65, reason: 'timeout_commit' })
  }

  return wait({
    confidence: 0.7,
    maxWaitMs: Math.min(
      Math.max(NO_SIGNAL_CEILING_MS - silenceMs, 0),
      MAX_WAIT_SLICE_MS,
    ),
    reason: 'short_silence',
  })
}

function endsExplicitFinish(text: string): boolean {
  const normalized = normalizeText(text)
  if (!normalized) return false
  if (normalized.endsWith('?')) return true
  const lower = normalized.toLowerCase()
  return EXPLICIT_FINISH_PHRASES.some((phrase) => lower.endsWith(phrase))
}

function endsFillerOrIncomplete(text: string): boolean {
  const normalized = normalizeText(text)
  if (!normalized) return false
  const tokens = tokenizeLower(normalized)
  const last = tokens[tokens.length - 1]
  if (last !== undefined && FILLER_TOKENS.has(last)) return true
  const lower = normalized.toLowerCase()
  return FILLER_PHRASES.some((phrase) => lower.endsWith(phrase))
}

function looksSyntacticallyComplete(text: string): boolean {
  const normalized = normalizeText(text)
  if (!normalized) return false
  if (normalized.endsWith('?')) return true

  const tokens = tokenizeLower(normalized)
  // A lone word is not enough to count as a sentence.
  if (tokens.length < 2) return false

  const last = tokens[tokens.length - 1]
  if (last !== undefined && COMPLETE_SUFFIXES.has(last)) return true

  // "xin chào" ("hello") is a complete sentence; after "xin chào em" ("hello
  // there") people keep talking.
  return last === 'chào' && tokens.length <= 3
}

/**
 * `false` when `fullPartial` has significantly more content than `stableText`
 * — the stabilizer hasn't caught up, so `stableText` is just a stale prefix of
 * a still-growing utterance. Committing the turn then would cut off the tail.
 *
 * Allows a drift of exactly one token, so a punctuation fix at the end doesn't
 * block the commit.
 */
function stablePrefixIsCurrent(
  stableText: string,
  fullPartial: string,
): boolean {
  const stable = tokenizeLower(normalizeText(stableText))
  const full = tokenizeLower(normalizeText(fullPartial))
  return full.length <= stable.length + 1
}

function fillerReason(text: string): 'filler' | 'incomplete_clause' {
  const tokens = tokenizeLower(normalizeText(text))
  const last = tokens[tokens.length - 1]
  return last !== undefined && FILLER_TOKENS.has(last)
    ? 'filler'
    : 'incomplete_clause'
}

/**
 * NFC + collapse whitespace. Deliberately does **not** strip diacritics — see
 * the note at the top of the file.
 *
 * NFC is required, not cosmetic: macOS returns NFD strings, so an `ạ` typed on
 * this machine and an `ạ` coming back from the ASR are two different strings
 * unless normalized, and `Set.has` will miss.
 */
function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/**
 * Splits on whitespace, **keeping punctuation attached to words**.
 *
 * Known consequence: `"ừm."` does not match `FILLER_TOKENS`. Acceptable,
 * because the Web Speech API almost never returns punctuation mid-turn for
 * Vietnamese.
 */
function tokenizeLower(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase())
}

function wait(params: {
  confidence: number
  maxWaitMs: number
  reason: EndpointReason
}): EndpointDecision {
  return { decision: 'WAIT', ...params }
}

function commit(params: {
  confidence: number
  reason: EndpointReason
}): EndpointDecision {
  return { decision: 'COMMIT', maxWaitMs: 0, ...params }
}
