/**
 * Wipers on the windshield of `CarTopView` — a `<g>` layer inside the car's
 * SVG, sharing its 200×400 coordinate system.
 *
 * ## Shape
 *
 * Two tandem wiper arms, as on a left-hand-drive car: at rest they lie along
 * the base of the windshield, tips pointing right, tight against the rear edge
 * of the hood; the arms are clipped to the glass so they never overlap the
 * hood. When running they sweep up and fan out toward the driver's seat — the
 * driver's side gets the widest wiped area. The arms rotate in the *plane of
 * the glass*, and since the windshield is raked, seen from above distances
 * along the glass are foreshortened: each arm is `translate → scale(1, k) →
 * rotate`, i.e. rotate on the glass first, then project down. That way the
 * sweep comes out as a flattened fan, exactly as seen from above, rather than
 * a circular fan pasted onto the picture.
 *
 * ## Rain
 *
 * There is no "raining" state yet, so rain only collects while the wipers are
 * on — the drops give the wipers something to wipe, and instantly read as
 * "the wipers are working". Rain gets heavier with the wiper level: people
 * pick the level to match the rain, so reading it the other way round works
 * too. Drops inside the sweep vanish the instant the blade passes over them;
 * in the corners of the glass the blade can't reach, rain keeps collecting —
 * as in real life, and it's what makes the swept arc show up without having
 * to draw it.
 *
 * ## Motion
 *
 * Driven by `requestAnimationFrame` rather than CSS animation, because of
 * three things CSS can't do:
 *
 * - **Switching off mid-stroke lets the arms finish back to rest**, instead
 *   of snapping back. Same when changing level mid-way: the unfinished stroke
 *   completes at the old rhythm.
 * - **The intermittent level pauses between two strokes**, and changing level
 *   during the pause takes effect immediately instead of waiting the pause
 *   out.
 * - **Rain drops need to know what angle the blade is at** to vanish at the
 *   right moment.
 *
 * Each frame writes straight to the DOM (the arms' `transform`, the drops'
 * `opacity`) — no `setState`, so the React tree doesn't re-render 60 times a
 * second. Once there's nothing left to do (wipers off, arms back at rest, rain
 * gone) the loop stops itself.
 *
 * When the user asks for reduced motion: no loop, no rain; the arms stay put
 * and the swept area lights up as a static fan — still reads as "the wipers
 * are on".
 */

import { useEffect, useId, useRef } from 'react'

import { WIPER_TIMING, type WiperMode } from './car-visuals'

/** Seen from above, distances along the windshield shrink to this much (raked glass). */
const GLASS_FORESHORTEN = 0.72

type WiperArm = {
  /**
   * Pivot, in viewBox coordinates — just inside the base edge of the glass,
   * tight against the rear edge of the hood, so at rest the blade lies exposed
   * along the base of the windshield.
   */
  pivot: readonly [x: number, y: number]
  length: number
  /** Rest angle, in degrees, in the plane of the glass. Positive moves the tip toward the roof. */
  rest: number
  /** Maximum sweep angle, measured from `rest`. */
  sweep: number
}

/**
 * At the end of a stroke both arms go slightly past vertical, leaning toward
 * the driver's seat — the driver-side arm stops right next to the left
 * A-pillar. At rest, the tip of the driver-side arm stops a few units short of
 * the passenger arm's pivot, so the two arms don't overlap.
 */
const WIPER_ARMS: readonly WiperArm[] = [
  { pivot: [57, 117], length: 44, rest: -8, sweep: 100 },
  { pivot: [104, 110.5], length: 47, rest: 12, sweep: 82 },
]

/** The rubber blade covers the outer part of the arm — the inner part is just the lever. */
const BLADE_START = 0.3

/** Maximum number of drops. When the pool is full, the oldest drop gives way. */
const DROP_POOL = 72

/** Bounding box of the windshield; anything falling outside the glass is cut by `clipPath`. */
const RAIN_AREA = { x: 42, y: 104, width: 116, height: 58 } as const

/** Drops fade in, fade out at the end of their life, and get wiped away very fast by the blade. */
const DROP_FADE_IN_MS = 220
const DROP_FADE_OUT_MS = 700
const DROP_WIPE_MS = 110

type Drop = {
  active: boolean
  x: number
  y: number
  born: number
  life: number
  alpha: number
  wipedAt: number | null
}

/** Current arm angle, as a `0..1` fraction of the sweep. */
function armAngle(arm: WiperArm, fraction: number) {
  return arm.rest + arm.sweep * fraction
}

function armTransform(arm: WiperArm, fraction: number) {
  const [x, y] = arm.pivot
  return `translate(${x} ${y}) scale(1 ${GLASS_FORESHORTEN}) rotate(${+armAngle(arm, fraction).toFixed(2)})`
}

/**
 * The area one arm sweeps, in the arm's rest coordinate system: a fan from
 * the base of the blade to the tip, angle 0 → `sweep`.
 */
function sweptArea(arm: WiperArm) {
  const inner = arm.length * BLADE_START
  const angle = (arm.sweep * Math.PI) / 180
  const at = (radius: number, theta: number) =>
    `${+(radius * Math.cos(theta)).toFixed(2)} ${+(radius * Math.sin(theta)).toFixed(2)}`
  return `M${at(inner, 0)} L${at(arm.length, 0)} A${arm.length} ${arm.length} 0 0 1 ${at(arm.length, angle)} L${at(inner, angle)} A${inner} ${inner} 0 0 0 ${at(inner, 0)} Z`
}

/**
 * Whether the blade, having just moved from angle `from` to `to`, swept over
 * this drop. Converts the drop into the arm's coordinate system (undoing the
 * raked projection), then compares radius and angle. There's a margin of a
 * few degrees: in one 16 ms frame at the fast level, the blade covers a good
 * ten degrees.
 */
function isSwept(arm: WiperArm, drop: Drop, from: number, to: number) {
  const [px, py] = arm.pivot
  const dx = drop.x - px
  const dy = (drop.y - py) / GLASS_FORESHORTEN
  const radius = Math.hypot(dx, dy)
  if (radius < arm.length * BLADE_START - 1.5 || radius > arm.length + 1.5) {
    return false
  }
  const theta = (Math.atan2(dy, dx) * 180) / Math.PI
  return theta >= Math.min(from, to) - 2 && theta <= Math.max(from, to) + 2
}

function dropOpacity(drop: Drop, now: number) {
  const fadeIn = Math.min(1, (now - drop.born) / DROP_FADE_IN_MS)
  const fadeOut =
    drop.wipedAt === null
      ? Math.min(1, (drop.born + drop.life - now) / DROP_FADE_OUT_MS)
      : 1 - (now - drop.wipedAt) / DROP_WIPE_MS
  return Math.max(0, Math.min(fadeIn, fadeOut)) * drop.alpha
}

export function Wipers({
  clip,
  mode,
}: {
  /** `url(#…)` of the windshield-shaped `clipPath` — keeps rain and the swept area off the paint. */
  clip: string
  mode: WiperMode
}) {
  const armRefs = useRef<Array<SVGGElement | null>>([])
  const dropRefs = useRef<Array<SVGCircleElement | null>>([])
  const modeRef = useRef(mode)
  const wakeRef = useRef(() => {})
  const dropFill = `${useId().replace(/:/g, '')}-drop`

  useEffect(() => {
    // These two arrays live for the component's whole lifetime; each callback
    // ref only writes into its own slot.
    const armElements = armRefs.current
    const dropElements = dropRefs.current
    const drops: Drop[] = Array.from({ length: DROP_POOL }, () => ({
      active: false,
      x: 0,
      y: 0,
      born: 0,
      life: 0,
      alpha: 0,
      wipedAt: null,
    }))
    let frame = 0
    let last = 0
    let sweepStart: number | null = null
    let sweepDuration = 0
    let lastSweepEnd = -Infinity
    let fraction = 0
    let pending = 0

    const spawn = (now: number) => {
      const free = drops.findIndex((drop) => !drop.active)
      const index =
        free !== -1
          ? free
          : drops.reduce(
              (oldest, drop, i) =>
                drop.born < drops[oldest]!.born ? i : oldest,
              0,
            )
      const drop = drops[index]!
      drop.active = true
      drop.x = RAIN_AREA.x + Math.random() * RAIN_AREA.width
      drop.y = RAIN_AREA.y + Math.random() * RAIN_AREA.height
      drop.born = now
      drop.life = 5000 + Math.random() * 4000
      drop.alpha = 0.5 + Math.random() * 0.45
      drop.wipedAt = null
      const element = dropElements[index]
      if (element) {
        element.setAttribute('cx', drop.x.toFixed(2))
        element.setAttribute('cy', drop.y.toFixed(2))
        element.setAttribute('r', (0.55 + Math.random() * 0.75).toFixed(2))
      }
    }

    const tick = (now: number) => {
      // rAF stops while the tab is hidden; on return, don't dump a whole
      // minute of rain into a single frame.
      const elapsed = last ? Math.min(now - last, 100) : 0
      last = now
      const current = modeRef.current
      const timing = current === 'off' ? null : WIPER_TIMING[current]

      // A new stroke only starts from rest; the timing is re-read every frame,
      // so changing level during the pause takes effect immediately.
      if (sweepStart === null && timing && now >= lastSweepEnd + timing.pause) {
        sweepStart = now
        sweepDuration = timing.sweep
      }
      let next = 0
      if (sweepStart !== null) {
        const progress = (now - sweepStart) / sweepDuration
        if (progress >= 1) {
          sweepStart = null
          lastSweepEnd = now
        } else {
          // Out and back in one stroke, slow at both ends like the crank of a
          // wiper motor.
          next = (1 - Math.cos(2 * Math.PI * progress)) / 2
        }
      }

      if (timing) {
        pending += (timing.rain * elapsed) / 1000
        for (; pending >= 1; pending -= 1) spawn(now)
      }

      if (next !== fraction) {
        WIPER_ARMS.forEach((arm, index) => {
          armElements[index]?.setAttribute('transform', armTransform(arm, next))
          const from = armAngle(arm, fraction)
          const to = armAngle(arm, next)
          for (const drop of drops) {
            if (
              drop.active &&
              drop.wipedAt === null &&
              isSwept(arm, drop, from, to)
            ) {
              drop.wipedAt = now
            }
          }
        })
        fraction = next
      }

      let raining = false
      drops.forEach((drop, index) => {
        if (!drop.active) return
        const opacity = dropOpacity(drop, now)
        const gone =
          opacity <= 0 &&
          (drop.wipedAt !== null || now >= drop.born + drop.life)
        if (gone) drop.active = false
        else raining = true
        const element = dropElements[index]
        if (element) element.style.opacity = gone ? '0' : opacity.toFixed(3)
      })

      if (timing || sweepStart !== null || raining) {
        frame = requestAnimationFrame(tick)
      } else {
        frame = 0
        last = 0
      }
    }

    const wake = () => {
      if (frame) return
      last = 0
      frame = requestAnimationFrame(tick)
    }
    wakeRef.current = wake
    wake()

    return () => {
      cancelAnimationFrame(frame)
      wakeRef.current = () => {}
      WIPER_ARMS.forEach((arm, index) =>
        armElements[index]?.setAttribute('transform', armTransform(arm, 0)),
      )
      for (const element of dropElements) {
        if (element) element.style.opacity = '0'
      }
    }
  }, [])

  useEffect(() => {
    modeRef.current = mode
    wakeRef.current()
  }, [mode])

  const on = mode !== 'off'

  return (
    <g>
      {/* Water drop on glass: clear in the middle, rim catching the light —
          filled solid it looks like a snowflake. */}
      <defs>
        <radialGradient cx="0.5" cy="0.5" id={dropFill} r="0.5">
          <stop offset="0" stopColor="oklch(0.9 0.03 230)" stopOpacity="0.2" />
          <stop
            offset="0.7"
            stopColor="oklch(0.9 0.03 230)"
            stopOpacity="0.35"
          />
          <stop offset="1" stopColor="oklch(0.95 0.02 230)" stopOpacity="0.9" />
        </radialGradient>
      </defs>
      <g clipPath={clip}>
        {/* swept area: wiped glass is slightly brighter — stands out when rain collects around it */}
        {WIPER_ARMS.map((arm) => (
          <path
            className="transition-opacity duration-500 ease-(--ease-car)"
            d={sweptArea(arm)}
            fill="white"
            key={arm.pivot[0]}
            opacity={on ? 0.05 : 0}
            transform={armTransform(arm, 0)}
          />
        ))}
        {/* Rain drops: created once up front; the loop only changes position and opacity. */}
        {Array.from({ length: DROP_POOL }, (_, index) => (
          <circle
            fill={`url(#${dropFill})`}
            key={index}
            ref={(element) => {
              dropRefs.current[index] = element
            }}
            style={{ opacity: 0 }}
          />
        ))}
      </g>

      {/* The two wiper arms, drawn in the arm's coordinate system: pivot at the
          origin, tip at (length, 0). Clipped to the glass so they don't
          overlap the edge of the hood. */}
      <g clipPath={clip}>
        {WIPER_ARMS.map((arm, index) => (
          <g
            key={arm.pivot[0]}
            ref={(element) => {
              armRefs.current[index] = element
            }}
            transform={armTransform(arm, 0)}
          >
            <path
              d={`M0 0 H${arm.length * 0.62}`}
              stroke="oklch(0.2 0.006 255)"
              strokeLinecap="round"
              strokeWidth="1.4"
            />
            <path
              d={`M${arm.length * BLADE_START} 0 H${arm.length}`}
              stroke="oklch(0.1 0.005 255)"
              strokeLinecap="round"
              strokeWidth="2.2"
            />
            {/* highlight along the back of the blade — without it the dark blade sinks into the dark glass */}
            <path
              d={`M${arm.length * BLADE_START + 1} -0.9 H${arm.length - 1}`}
              stroke="oklch(0.6 0.01 255)"
              strokeLinecap="round"
              strokeOpacity="0.7"
              strokeWidth="0.5"
            />
            {/* pivot cap: small dark dot, faint rim — big and bright turns it into a bolt */}
            <circle
              fill="oklch(0.12 0.005 255)"
              r="1.5"
              stroke="oklch(0.32 0.008 255)"
              strokeWidth="0.4"
            />
          </g>
        ))}
      </g>
    </g>
  )
}
