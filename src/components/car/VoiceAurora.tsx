/**
 * The two **light** pieces of the voice layer. The text lives in
 * `VoiceOverlay`.
 *
 * - `VoiceAurora` — an aurora along the top edge of the screen: a "the car is
 *   listening" signal caught out of the corner of your eye, not read, not a
 *   small orb to hunt for in a corner. It thickens with the mic level, so the
 *   speaker knows immediately whether their voice is getting through.
 * - `VoiceWave` — five tiny wave bars embedded in the `VoicePanel` card,
 *   answering a narrower question: **does the mic hear anything at all**.
 *
 * Why split them out of `VoiceOverlay`: these two have no state, no
 * conditional branches, only visuals — whereas `VoicePanel` over there is all
 * show/hide rules for text. Mixed together, every edit to one means skimming
 * through the other.
 *
 * Both only draw; the "how it looks" part is in `index.css` (`.car-voice-*`),
 * including how they behave when the user asks for reduced motion.
 */

import { useEffect, useRef } from 'react'

import { useSessionStore } from '@/store/session-store'
import { useVoiceLevel } from '@/voice/mic-level-store'
import type { CallSession } from '@/voice/use-call-session'

/** Visible phase of the voice layer — `idle` draws nothing. */
type VoicePhase = CallSession['phase'] | 'idle'

/**
 * A raw mic level of 0..~0.2 is normal speech. Multiply by 6 so a normal voice
 * gets near the top of the scale, instead of having to shout to see the bars
 * budge.
 */
const LEVEL_GAIN = 6

function normalizeLevel(level: number) {
  return Math.min(1, Math.max(0, level * LEVEL_GAIN))
}

/**
 * Per-phase tempo, set via `playbackRate` rather than changing
 * `animation-duration` in CSS: change the duration mid-way and the browser
 * recomputes progress against the new duration, so the ribbons and wave bars
 * **jump position** right at the phase change. `updatePlaybackRate` keeps the
 * position and only changes speed — and it scales everything evenly, so the
 * periods still don't divide into each other.
 */
const PHASE_RATE: Record<string, { thinking: number }> = {
  'car-voice-drift': { thinking: 4 },
  'car-voice-flow': { thinking: 3.2 },
  'car-voice-bar': { thinking: 1.45 },
}

/** Sets the speed of every animation inside `root` whose name is in `PHASE_RATE`. */
function applyPhaseRate(root: Element | null, phase: string) {
  if (!root) return
  for (const animation of root.getAnimations({ subtree: true })) {
    if (!(animation instanceof CSSAnimation)) continue
    const rates = PHASE_RATE[animation.animationName]
    if (!rates) continue
    const rate = phase === 'thinking' ? rates.thinking : 1
    if (animation.playbackRate !== rate) animation.updatePlaybackRate(rate)
  }
}

/**
 * Four ribbons of light, covering all four of the car's
 * `--color-car-voice-*` colors. Each has its own width, drift range and
 * period — and the periods **don't divide into each other** (8.5 / 11 / 14 /
 * 17 s), so the group takes over 20 minutes to repeat the exact same frame.
 * The human eye picks up cycles very fast; once it does, this stops reading as
 * "light" and becomes "a looping animation".
 */
const RIBBONS = [
  { dur: '11s', left: '-12%', tint: '2', width: '70%', x0: '-10%', x1: '16%' },
  { dur: '8.5s', left: '18%', tint: '3', width: '62%', x0: '12%', x1: '-14%' },
  { dur: '14s', left: '44%', tint: '4', width: '78%', x0: '-8%', x1: '10%' },
  { dur: '17s', left: '6%', tint: '1', width: '46%', x0: '26%', x1: '-8%' },
] as const

/**
 * The aurora box's height follows the screen, not a fixed px value: on a
 * 1024px head unit the real height is only a bit over 600px, and 160px of
 * aurora is nearly a quarter of the screen — too thick, it stops being a
 * glowing edge and becomes a background. The three steps 128/160/176 keep the
 * band at roughly 20% of the height on any screen.
 *
 * The ribbons are anchored in **percentages of the box** rather than
 * `-top-28 h-[220px]` as before. Those two px values were only right when the
 * box was exactly 160px; shrink the box one step and the ribbon centers drift
 * outside the mask and the band gets visibly thinner with nobody knowing why.
 * Tying them to percentages keeps the "ribbon center sits above the screen
 * edge" ratio the same at every step.
 */
const RIBBON_BOX = '-top-[70%] h-[155%]'

export function VoiceAurora({ live }: { live: boolean }) {
  const level = useVoiceLevel(live)
  // The phase comes from `personaState`, not the conversation session: commands
  // typed in the debug panel also go through the "thinking" phase, and the
  // aurora has to run then too.
  const personaState = useSessionStore((state) => state.personaState)
  const phase: VoicePhase =
    personaState === 'listening' ||
    personaState === 'thinking' ||
    personaState === 'speaking'
      ? personaState
      : 'idle'

  // While "thinking" the mic is off and `level` drops to 0 — left alone, the
  // aurora would collapse exactly when it needs to show the system is still
  // working. Pin a thin baseline level instead.
  const field = phase === 'thinking' ? 0.12 : normalizeLevel(level)

  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    applyPhaseRate(rootRef.current, phase)
  }, [phase])

  return (
    <div
      aria-hidden="true"
      ref={rootRef}
      className="car-voice-aurora pointer-events-none absolute inset-x-0 top-0 z-30 h-32 overflow-hidden sm:h-40 lg:h-44"
      data-phase={phase}
    >
      <div
        className="car-voice-field absolute inset-0"
        style={{ ['--voice-level' as string]: field }}
      >
        {RIBBONS.map((ribbon) => (
          <div
            className={`car-voice-ribbon absolute ${RIBBON_BOX}`}
            key={ribbon.tint}
            style={{
              ['--dur' as string]: ribbon.dur,
              ['--tint' as string]: `var(--color-car-voice-${ribbon.tint})`,
              ['--x0' as string]: ribbon.x0,
              ['--x1' as string]: ribbon.x1,
              left: ribbon.left,
              width: ribbon.width,
            }}
          />
        ))}
      </div>

      {/* The edge line sits outside `.car-voice-field`: it's the screen's
          border, not the voice's, so it doesn't scale with the mic level. */}
      <div className="car-voice-edge absolute top-0 left-0 h-0.5" />
    </div>
  )
}

/**
 * Per-bar gain. Tall in the middle, tapering toward both sides — the familiar
 * shape of a spectrum, rather than five levers jumping in lockstep.
 */
const BAR_GAINS = [0.5, 0.78, 1, 0.72, 0.44]

/**
 * Bar height floor during silence. Not 0: a bar that disappears loses its
 * anchor too; and not too low either — below ~4px the five bars read as five
 * **dots**, and dots are exactly what the previous version used for another
 * meaning ("still alive"). 0.2 × 20px = 4px still reads as a bar while being
 * clearly lower than when there's sound.
 */
const BAR_FLOOR = 0.2

/**
 * **Fixed** width of the bar group: 5 bars × 3px + 4 gaps × 3px = 27px.
 * Hard-coded here instead of letting flex measure it, because this spot has a
 * second tenant — the crossed-out mic icon when the mic is off (`VoicePanel`)
 * — and the two take turns in the same slot. If the slot shrank to fit its
 * content, every mic on/off would shift the phase label and the heard text on
 * the right sideways by a few px. One slot, one width, shared: see
 * `VOICE_GLYPH_SLOT` in `VoicePanel`.
 */
export const VOICE_GLYPH_SLOT = 'w-[27px]'

export function VoiceWave({
  live,
  phase,
}: {
  live: boolean
  phase: CallSession['phase']
}) {
  const level = useVoiceLevel(live)
  const normalized = normalizeLevel(level)

  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    applyPhaseRate(rootRef.current, phase)
  }, [phase])

  return (
    <div
      aria-hidden="true"
      ref={rootRef}
      className={`car-voice-wave flex h-5 shrink-0 items-center justify-center gap-[3px] ${VOICE_GLYPH_SLOT}`}
      data-phase={phase}
    >
      {BAR_GAINS.map((gain, index) => (
        <span
          className="bg-car-voice-2 h-full w-[3px] rounded-full"
          key={gain}
          style={{
            ['--bar' as string]: Math.max(BAR_FLOOR, normalized * gain),
            ['--gain' as string]: gain,
            // Offset each bar's phase so the machine rhythm in the
            // "thinking"/"speaking" phases rolls as a wave rather than five
            // bars pulsing in unison.
            animationDelay: `${index * 90}ms`,
          }}
        />
      ))}
    </div>
  )
}
