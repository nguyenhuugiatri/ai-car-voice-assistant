/**
 * Climate icons that Lucide doesn't have. Drawn from the standard symbols on
 * real car buttons (ISO 2575) rather than invented: drivers already know the
 * windshield with three wavy arrows by heart, and a "creative" icon here is an
 * icon you have to read a label to understand.
 *
 * Same 24×24 grid and 1.75 stroke as Lucide so they sit side by side without
 * looking off.
 */

import type { SVGProps } from 'react'

import { WIPER_MODES, WIPER_TIMING, type WiperMode } from './car-visuals'

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      {...props}
    />
  )
}

/** Front defrost: curved windshield + three wavy arrows pointing up. */
export function FrontDefrostIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 18c2-9 16-9 18 0" />
      <path d="M8 16c-1-1.5 1-3 0-4.5S9 9 8 7.5" />
      <path d="M12 16c-1-1.5 1-3 0-4.5S13 9 12 7.5" />
      <path d="M16 16c-1-1.5 1-3 0-4.5S17 9 16 7.5" />
    </Icon>
  )
}

/** Rear defrost: rectangular frame + three wavy arrows. */
export function RearDefrostIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect height="12" rx="2.5" width="18" x="3" y="8" />
      <path d="M8 17c-1-1.5 1-3 0-4.5S9 10 8 8.5" />
      <path d="M12 17c-1-1.5 1-3 0-4.5S13 10 12 8.5" />
      <path d="M16 17c-1-1.5 1-3 0-4.5S17 10 16 8.5" />
      <path d="M8 4h8" />
    </Icon>
  )
}

/** Recirculation: car silhouette + a looping arrow inside. */
export function RecirculationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2 16h2.5l2-5.5C7 9 8 8 10 8h4c2 0 3 1 3.5 2.5l2 5.5H22" />
      <path d="M9 15.5a3 3 0 1 1 5.6 1.5" />
      <path d="m14.8 14.6-.2 2.4-2.3-.5" />
    </Icon>
  )
}

/**
 * Window: the side window frame + an arrow showing which way the glass will
 * move when tapped (down if closed, up if open) — like the window switch on
 * the door handle.
 */
export function WindowIcon({
  open,
  ...props
}: SVGProps<SVGSVGElement> & { open: boolean }) {
  return (
    <Icon {...props}>
      <path d="M4 20V11l6-6h10v15Z" />
      {open ? (
        <path d="M14 16V9m-3 3 3-3 3 3" />
      ) : (
        <path d="M14 9v7m-3-3 3 3 3-3" />
      )}
    </Icon>
  )
}

/**
 * Side mirror seen from above, same viewpoint as the car picture: the vertical
 * line is the side of the car, the mirror sticks out sideways when unfolded
 * and lies flat against the side when folded. The icon draws the current
 * state, not the action — one look at the icon tells you what the mirror is
 * doing.
 */
export function MirrorIcon({
  folded,
  side,
  ...props
}: SVGProps<SVGSVGElement> & { folded: boolean; side: 'left' | 'right' }) {
  return (
    <Icon {...props}>
      <g transform={side === 'right' ? 'matrix(-1 0 0 1 24 0)' : undefined}>
        <path d="M18 3v18" />
        {folded ? (
          <path d="M18 8h-4v9.5a2 2 0 0 0 4 0" />
        ) : (
          <path d="M18 9H7.5a2 2 0 0 0 0 4H18" />
        )}
      </g>
    </Icon>
  )
}

/**
 * Sunroof seen from above: roof + glass panel, with an arrow showing which way
 * the panel will slide when tapped (back if closed, forward if open) — same
 * approach as `WindowIcon`.
 */
export function SunroofIcon({
  open,
  ...props
}: SVGProps<SVGSVGElement> & { open: boolean }) {
  return (
    <Icon {...props}>
      <rect height="18" rx="4" width="16" x="4" y="3" />
      <rect height="6" rx="1.5" width="10" x="7" y="6" />
      {open ? (
        <path d="M12 19v-4.5m-2.5 2.5 2.5-2.5 2.5 2.5" />
      ) : (
        <path d="M12 14.5V19m-2.5-2.5L12 19l2.5-2.5" />
      )}
    </Icon>
  )
}

/**
 * Hide/show the roof, seen from above like the car picture: the same roof
 * frame as `SunroofIcon`, with two seats inside. With the roof shown the frame
 * is solid and the seats faint (covered); with the roof hidden the frame turns
 * dashed and the seats clear — exactly what this button toggles.
 */
export function RoofIcon({
  hidden,
  ...props
}: SVGProps<SVGSVGElement> & { hidden: boolean }) {
  return (
    <Icon {...props}>
      <rect
        height="18"
        rx="4"
        strokeDasharray={hidden ? '2.5 2.5' : undefined}
        width="16"
        x="4"
        y="3"
      />
      <g opacity={hidden ? 1 : 0.4}>
        <path d="M8 8.5v4.5h2.5" />
        <path d="M16 8.5v4.5h-2.5" />
        <path d="M8 17h8" />
      </g>
    </Icon>
  )
}

/**
 * Frunk/trunk, seen from above like `RoofIcon`: the same car frame, with a
 * horizontal line across the end that has the lid. When open, an arrow flips
 * out past that end — the state reads through **shape**, not just the LED
 * color, because color is the first thing to fail in harsh sunlight and for
 * color-blind people.
 */
export function HatchIcon({
  end,
  open,
  ...props
}: SVGProps<SVGSVGElement> & { end: 'front' | 'rear'; open: boolean }) {
  return (
    <Icon {...props}>
      <rect height="18" rx="4" width="16" x="4" y="3" />
      {end === 'front' ? (
        <>
          <path d="M4.6 8.5h14.8" />
          {open && <path d="M12 6.5v-4m-2 2 2-2 2 2" />}
        </>
      ) : (
        <>
          <path d="M4.6 15.5h14.8" />
          {open && <path d="M12 17.5v4m-2-2 2 2 2-2" />}
        </>
      )}
    </Icon>
  )
}

/** Car door seen from the side: door frame with a window and a handle. */
export function DoorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 21V11l6-7h10v17Z" />
      <path d="M5.5 11h13" />
      <path d="M14 15h3" />
    </Icon>
  )
}

/** Wipers: windshield + wiper arm from a bottom pivot + dashed sweep arc. */
export function WiperIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 19 5.5 7.5c4-1.4 9-1.4 13 0L20 19Z" />
      <path d="M6.8 15.5a6 6 0 0 1 10.4 0" strokeDasharray="1 2.2" />
      <path d="M12 18.5 8.5 11" />
    </Icon>
  )
}

/**
 * One wiper level: glass frame, wiper arm, and **as many ticks as the level
 * number** — one tick is intermittent, two is slow, three is fast, matching
 * the `I / II / III` printed on real wiper stalks (Tesla puts this very symbol
 * on screen; BMW, and the stalk set the VF8 borrows from them, mark it much
 * the same way). The "Off" level has no ticks.
 *
 * On the selected level the arm **actually sweeps**, at that level's exact
 * `WIPER_TIMING`, so the speed isn't read from text but seen at a glance —
 * and it matches the two wiper arms running on the car picture. The rhythm is
 * handled by CSS (`car-wipe`); the component only sets `animation-duration`.
 * The cycle includes the pause, so the intermittent level wipes once and then
 * stands still, as in real life.
 */
export function WiperModeIcon({
  mode,
  running = false,
  ...props
}: SVGProps<SVGSVGElement> & { mode: WiperMode; running?: boolean }) {
  const timing = mode === 'off' ? null : WIPER_TIMING[mode]
  const ticks = Math.max(0, WIPER_MODES.indexOf(mode))

  return (
    <Icon {...props}>
      <path d="M4 19 5.5 7.5c4-1.4 9-1.4 13 0L20 19Z" />
      {/* Ticks line up from the left edge inward, in the lower half of the
          glass — where the arm doesn't reach, so a wipe stroke never covers
          them. Slanted the same way as the arm: upright, three ticks side by
          side read as a bar chart; slanted, they read as streaks of water
          just wiped away. */}
      {Array.from({ length: ticks }, (_, i) => (
        <path d={`M${6.2 + i * 2.4} 15.6l1 -2.9`} key={i} />
      ))}
      <path
        className={
          running && timing
            ? // The slow level pauses 120ms between strokes — under a tenth of
              // the cycle, not worth its own keyframe. The intermittent level
              // pauses for nearly two thirds, and that stillness *is* what
              // people recognize.
              mode === 'intermittent'
              ? 'car-wipe-pause'
              : 'car-wipe'
            : undefined
        }
        d="M12 18.6 16.3 11.4"
        style={
          running && timing
            ? { animationDuration: `${timing.sweep + timing.pause}ms` }
            : undefined
        }
      />
    </Icon>
  )
}

/** Seat heating: seat silhouette + three heat waves. */
export function SeatHeatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 3v10a2 2 0 0 0 2 2h8l2 6" />
      <path d="M6 13h9" />
      <path d="M12 9c-.8-1 .8-2 0-3s.8-2 0-3" />
      <path d="M16 9c-.8-1 .8-2 0-3s.8-2 0-3" />
    </Icon>
  )
}

/** The three heat waves of `SeatLevelIcon`, inner to outer — level 1 is only the one next to the seatback. */
const SEAT_HEAT_WAVES = [
  'M11 10c-.9-1.1.9-2.2 0-3.3s.9-2.2 0-3.3',
  'M15 10c-.9-1.1.9-2.2 0-3.3s.9-2.2 0-3.3',
  'M19 10c-.9-1.1.9-2.2 0-3.3s.9-2.2 0-3.3',
]

/**
 * A seat with **exactly as many waves as the heat level** — the same heat-wave
 * symbol as the two defrost icons above, so the three heat-related things on
 * this screen speak one visual language.
 *
 * With it, "which side is warm, and how warm" is answered by *shape*, not by
 * scanning for which cell in the `Off 1 2 3` row is filled. Those are two
 * different ways of looking: the first is a glance, the second is reading — and
 * NHTSA's driver-distraction guidelines allow only 1.5–2 seconds per glance.
 *
 * Waves not yet reached **are still drawn** rather than hidden: hide them and
 * the icon changes shape with the level, and the eye has to recount from
 * scratch every time; keep the frame fixed and only change what's lit, and
 * comparing the two seats is just comparing two patches of light.
 */
export function SeatLevelIcon({
  level,
  ...props
}: SVGProps<SVGSVGElement> & { level: number }) {
  return (
    <Icon {...props}>
      {/* Seat seen from the side, always at the same opacity — it's the seat, not the state. */}
      <path d="M5 3v11a2 2 0 0 0 2 2h8l2 5" opacity="0.55" />
      <path d="M5 14h9" opacity="0.55" />
      {SEAT_HEAT_WAVES.map((d, index) => (
        <path
          className="transition-opacity duration-200 ease-(--ease-car)"
          d={d}
          key={d}
          opacity={index < level ? 1 : 0.16}
        />
      ))}
    </Icon>
  )
}
