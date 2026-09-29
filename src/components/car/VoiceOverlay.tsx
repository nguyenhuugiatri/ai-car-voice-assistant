/**
 * The voice conversation card. The light effects — the aurora along the top
 * edge and the wave bars — live separately in `VoiceAurora`.
 *
 * `VoicePanel` is a card floating in the middle of the screen, just below the
 * aurora. The card has **two tiers**, and which tier is bigger is the most
 * important decision in this file:
 *
 * - **The assistant's reply is the main content**: 22px, up to three lines,
 *   spanning the full width of the card.
 * - **What the machine heard is the secondary line**: 13px, grey, one line,
 *   on top.
 *
 * The previous version did the opposite: the heard text was 20px, while the
 * reply was squeezed into a single 13px line at the bottom of the card. Why
 * the change: these two lines answer two different questions, and the user
 * **doesn't need both at once**. While speaking, they want to know "did it
 * hear me right?", but a spoken turn only lasts a few seconds. After that,
 * all the while the assistant speaks and the user waits for the car to
 * respond, what they want to know is "what did the car do?". That 13px line
 * was the one that had to answer it, even though 13px text is nearly
 * unreadable while the car is moving — and it was the **only** place telling
 * whether the command succeeded or failed.
 *
 * The heard text still needs to be shown: it's what lets you tell "the model
 * misunderstood" from "the mic misheard", two errors with completely different
 * fixes. It just no longer takes the reply's place.
 *
 * ## Height
 *
 * The card is **taller** than the previous version and **no longer fits** in
 * the gap between the bottom of the status bar (56px) and the top edge of the
 * car (~157px): secondary line 44px, reply block at least 60px, plus padding
 * comes to ~146px; a three-line reply makes it ~176px. The card will overlap
 * the top edge of the car and of the control panel.
 *
 * This is a deliberate trade-off, not a layout bug: in exchange, a glance is
 * enough to read the reply. Two things keep this trade-off from being worse:
 *
 * - The reply block has `min-h-15`, so when moving from the "thinking" phase
 *   to the "speaking" phase the card **keeps the same height**. The card only
 *   grows once, when the reply runs past two lines, rather than jerking with
 *   every word.
 * - The card still **floats over** the interface, taking no space in the
 *   layout. If opening a conversation pushed the whole screen down, the layout
 *   would jump every time you tap to talk, and the thing jumping would be the
 *   car itself — what the user is looking at.
 *
 * Note: while the card is showing, the top edge area of the right-hand control
 * panel **can't be tapped**. The card only appears during a conversation, so
 * that's acceptable.
 *
 * ## Reply block content, in priority order
 *
 * There's only one block; four kinds of content take turns, never two at the
 * same time:
 *
 * 1. **Warning** has the highest priority: if the browser can't listen,
 *    everything else is meaningless.
 * 2. **Thinking** — static text, holding the place for the upcoming reply.
 * 3. **Reply** (`done`/`failed`). `pending` lines are skipped because they
 *    only repeat the secondary line; see `answer`.
 * 4. **Placeholder text** when there's nothing to show yet: "Listening…", or
 *    a prompt to turn the mic on if it's muted. Never left empty: a big card
 *    with a blank main block looks frozen, especially right after you finish
 *    speaking while the machine waits on endpointing.
 *
 * Outside a conversation, the card **doesn't show**, not even right after
 * tapping a button on the control panel: the button changing state right
 * under the finger is already the feedback; a floating card on top would only
 * cover the car and the control panel itself.
 *
 * The `aria-live="polite"` region wrapping the card lives in `App`, not here:
 * the region has to be in the DOM before the text appears for screen readers
 * to announce it. `polite` is used so new lines don't cut in while the user is
 * speaking.
 */

import {
  CircleAlert,
  LoaderCircle,
  MicOff,
  Square,
  TriangleAlert,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { useEffect } from 'react'

import { VOICE_GLYPH_SLOT, VoiceWave } from '@/components/car/VoiceAurora'
import { cn } from '@/lib/utils'
import { useSessionStore, type StatusLine } from '@/store/session-store'
import type { CallSession } from '@/voice/use-call-session'

/**
 * Reply colors. **Only the two abnormal states get an icon.**
 *
 * The previous version put an icon on all three states, including `done`. At
 * 13px that made sense: relying on color alone fails for people with red-green
 * color blindness (~8% of men), in harsh sunlight slanting through the glass,
 * or during a 0.3-second glance — the eye picks up shape before color. But at
 * 22px, a **normal** reply has nothing to be confused with: it's just the
 * reply, and a tick before every line only adds clutter exactly where things
 * need to be tidiest.
 *
 * `failed` and `pending` keep their icons, because there the color does carry
 * meaning.
 */
const ANSWER_TONE: Record<
  StatusLine['phase'],
  { icon: ComponentType<{ className?: string }> | null; text: string }
> = {
  pending: { icon: LoaderCircle, text: 'text-car-ink-muted' },
  done: { icon: null, text: 'text-car-ink' },
  failed: { icon: CircleAlert, text: 'text-car-danger' },
}

/**
 * The reply — the card's biggest line. Up to three lines, then clipped: any
 * longer and the user should **listen** instead of read, because reading five
 * lines while driving is exactly what this interface wants to avoid.
 *
 * While the assistant is speaking, a band of light sweeps across the text.
 * This isn't word-synced karaoke (the TTS here returns no timestamps); it just
 * signals "this sentence is being spoken", so the "Stop speaking" button above
 * makes sense. Only `done` lines get the sweep: a sweep over an error line
 * would look like loading.
 */
function Answer({ line, speaking }: { line: StatusLine; speaking: boolean }) {
  const tone = ANSWER_TONE[line.phase]
  const Icon = tone.icon

  return (
    <p
      className={cn(
        'flex items-start gap-2.5 text-[22px] leading-snug font-medium lg:text-2xl',
        'transition-colors duration-700 ease-[var(--ease-car)]',
        // Once spoken, the reply recedes to the secondary color: it's now
        // history, and the eye is freed up for the wave bars — the signal that
        // the car is waiting for the next turn.
        !speaking && line.phase === 'done' ? 'text-car-ink-muted' : tone.text,
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            'mt-1 size-5 shrink-0',
            line.phase === 'pending' && 'animate-spin',
          )}
        />
      )}
      <span
        className={cn(
          'line-clamp-3',
          speaking && line.phase === 'done' && 'car-voice-sweep',
        )}
        lang="vi"
      >
        {line.text}
      </span>
    </p>
  )
}

/**
 * Placeholder text for the "thinking" phase, placed exactly where the upcoming
 * reply will appear, so when the reply arrives the text is **replaced in
 * place**.
 *
 * The text is static, with no blinking ellipsis: the wave bars on the
 * secondary line switch to the "thinking" rhythm at the same moment, and two
 * moving indicators side by side look like two different things loading.
 */
function Thinking() {
  return <span className="text-car-ink-faint text-lg">Thinking…</span>
}

/**
 * Warning. Same font size as "Thinking…" rather than 13px like the previous
 * version: this is the only place saying the car can't hear,
 * and it sits in the big block, so there's no reason for small text.
 *
 * The `heat` color here doesn't mean "heating"; it's a warning level milder
 * than `danger`, for problems that haven't broken the feature but that the
 * user needs to know about.
 */
function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="text-car-heat flex items-start gap-2.5 text-lg leading-snug">
      {/* Box exactly one text line tall, so the icon stays centered on the
          first line even when the text wraps. */}
      <span className="flex h-lh shrink-0 items-center">
        <TriangleAlert aria-hidden="true" className="size-5" />
      </span>
      <span className="line-clamp-2">{children}</span>
    </p>
  )
}

/**
 * Background and touch feedback shared by every button on the card. In a car
 * there's no pointer, so `hover` only serves people testing on a computer; the
 * real feedback the driver gets is `active:scale-95` — the finger covers the
 * spot it just tapped, so the button has to **move slightly** for the user to
 * know they hit it.
 */
const CONTROL = cn(
  'car-focus flex size-11 shrink-0 cursor-pointer items-center justify-center',
  'rounded-xl bg-white/8 text-car-ink-muted',
  'hover:bg-white/12 hover:text-car-ink active:scale-95',
  'transition-[background-color,color,transform] duration-150 ease-[var(--ease-car)]',
)

function IconButton({
  children,
  className,
  label,
  onClick,
}: {
  children: ReactNode
  className?: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className={cn(CONTROL, className)}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

/**
 * The secondary line's glyph slot: wave bars, or a crossed-out mic icon when
 * muted. Both cases have a fixed width of `VOICE_GLYPH_SLOT` — if the slot
 * sized to its content, every mute/unmute would shift the text on the right by
 * a few px.
 *
 * The card no longer has a phase label ("Listening"/"Thinking"): the aurora
 * along the top edge and these wave bars already convey the same information
 * more gently — just look, no reading needed.
 */
function MicGlyph({ session }: { session: CallSession }) {
  if (session.muted) {
    return (
      <span
        className={cn('flex shrink-0 justify-center', VOICE_GLYPH_SLOT)}
        title="Mic off"
      >
        <MicOff aria-hidden="true" className="text-car-ink-faint size-4" />
      </span>
    )
  }
  return <VoiceWave live={session.levelLive} phase={session.phase} />
}

export type VoicePanelProps = {
  /** `null` when no conversation is in progress. */
  session: CallSession | null
  onClose: () => void
}

export function VoicePanel({ session, onClose }: VoicePanelProps) {
  const statusLine = useSessionStore((state) => state.statusLine)

  // Shortcuts for people testing on a computer: Esc to end, M to toggle mic.
  useEffect(() => {
    if (!session) return
    const onKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'Escape') onClose()
      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault()
        session.toggleMute()
      }
    }
    document.addEventListener('keydown', onKeydown)
    return () => document.removeEventListener('keydown', onKeydown)
  }, [onClose, session])

  if (!session) return null

  const heard = `${session.draft} ${session.interim}`.trim() || session.lastTurn

  const warning = warningFor(session)

  // During a conversation, the `pending` line duplicates the secondary line:
  // `run-voice-command` sets it to `Processing “<what was just said>”…` as
  // soon as the "thinking" phase starts, i.e. it repeats the secondary line
  // verbatim, and restates the "processing" status that the aurora and wave
  // bars already convey.
  //
  // The reply is tied to `lastTurn` instead of hiding itself after a timeout:
  // as long as the question is on the secondary line the reply stays, and both
  // disappear together when the user starts saying something new. The previous
  // version hid it after 4 seconds, leaving the question stranded above an
  // empty block — looking as if the assistant hadn't replied. This also
  // automatically drops old lines from before the conversation opened, since
  // `lastTurn` is empty right after opening.
  const answer =
    session.lastTurn && statusLine?.phase !== 'pending' ? statusLine : null

  // Key for the reply block: changing the key remounts the block and
  // `.car-voice-swap`'s `@starting-style` runs the entry effect. "Listening…"
  // and the turn-on-mic prompt share a key — pressing M toggles between those
  // two lines, and keyboard actions shouldn't animate.
  const swapKey = warning
    ? 'warning'
    : session.phase === 'thinking'
      ? 'thinking'
      : answer
        ? `answer:${answer.phase}:${answer.text}`
        : 'hint'

  return (
    <div
      className={cn(
        'car-voice-panel',
        'bg-car-void/80 overflow-hidden rounded-3xl border border-white/10',
        'shadow-2xl shadow-black/60 backdrop-blur-xl',
        // Fixed width so the reply doesn't wrap too early.
        'w-[min(50rem,calc(100vw-2rem))] p-4',
      )}
    >
      {/*
        Secondary line: [mic glyph] [heard text] [button]. `min-w-0` is
        required: without it, `truncate` doesn't clip the text but stretches
        the whole flex row instead. `min-h-11` reserves the height of the
        "Stop speaking" button, so when the button appears or disappears, the
        reply block below isn't pushed up or down.
      */}
      <div className="mb-2.5 flex min-h-11 items-center gap-3">
        <MicGlyph session={session} />
        <p
          className="text-car-ink-faint min-w-0 flex-1 truncate text-[13px]"
          lang={heard ? 'vi' : undefined}
        >
          {heard ? `“${heard}”` : session.muted && 'Mic off'}
        </p>
        {/*
          The button stays 44px like every other button in the car even though
          it's on the secondary line: button size is set by the finger, not by
          information hierarchy. The "Stop speaking" button only appears in the
          speaking phase and is anchored right, so when it appears the text on
          the left just **gets clipped earlier** while its left edge stays put.
        */}
        {session.phase === 'speaking' && (
          <IconButton label="Stop speaking" onClick={session.interrupt}>
            <Square className="size-3.5 fill-current" />
          </IconButton>
        )}{' '}
      </div>

      {/*
        Reply block. `min-h-15` keeps the card's height constant when moving
        from the "thinking" phase to the "speaking" phase.
      */}
      <div className="flex min-h-15 items-center">
        <div className="car-voice-swap" key={swapKey}>
          {warning ? (
            <Warning>{warning}</Warning>
          ) : session.phase === 'thinking' ? (
            <Thinking />
          ) : answer ? (
            <Answer line={answer} speaking={session.phase === 'speaking'} />
          ) : (
            <p className="text-car-ink-faint text-lg">
              {session.muted
                ? 'Mic off. Turn it on to keep talking'
                : 'Listening…'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The session's most important warning, or `null`. The priority order is
 * deliberate: an active error first, then no speech recognition (breaks the
 * whole feature), and last no TTS voice (still usable, you just have to read
 * the text).
 */
function warningFor(session: CallSession) {
  if (session.error) return session.error
  if (!session.supported.recognition) {
    return "This browser can't recognize speech. Open it in Chrome or Edge."
  }
  if (!session.supported.voice) {
    return 'No Vietnamese voice on this device. The car still listens and acts, but replies in text only.'
  }
  return null
}
