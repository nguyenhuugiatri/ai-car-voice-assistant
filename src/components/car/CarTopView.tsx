/**
 * The car seen from above — the protagonist of the HVAC screen.
 *
 * Not decoration: it's the only place where a single glance shows seat heating
 * on both sides, front/rear defrost, airflow and each side's temperature at
 * once. When a voice command runs, this is the fastest place to see "did the
 * command hit the right zone" — so every piece of state is drawn **on the car
 * itself**, exactly where it happens in the cabin, not in a label next to it.
 *
 * ## Layers, bottom to top
 *
 * shadow → wheels → body → cabin floor (heat glow per side) → seats → airflow →
 * painted roof + panoramic glass (sunroof, rear pane) → windshield/rear window
 * → four doors and their windows → seat heating → lights.
 *
 * Shape and materials follow a D-segment electric SUV as reference: roof
 * painted body color, black-framed panoramic glass, shark fin, black leather
 * interior. The car carries a made-up `W` badge (`FRONT_LOGO`,
 * `TAILGATE_PARTS.logo`) — carmaker names in the comments below are only
 * *design reference* notes, not claims of affiliation; see `THIRD-PARTY.md`.
 *
 * Seat heating sits **above** the glass layer: the glass is tinted, and drawing
 * underneath it would darken the very thing most worth seeing. It is clipped to
 * the front glass pane so it doesn't bleed onto the painted roof.
 *
 * ## Doors and windows
 *
 * Each side door is its own group — painted skin + its window — rotating
 * around a hinge at its front edge, like the car image on Tesla's screen:
 * opening a door swings the door diagonally backwards and reveals the dark door
 * cavity on the body. The window sits *inside* the door so it rotates with it,
 * just like in real life.
 *
 * Doors take `doors`; windows take an opening of `0..100` via `windows`.
 *
 * Side mirrors are mounted on the front doors (opening a door carries the
 * mirror with it) and fold backwards around the mirror base — they take
 * `mirrors`, details in `Mirror`.
 *
 * ## Frunk, trunk
 *
 * Seen straight from above, a lid that lifts only gets *shorter* toward its
 * hinge — so opening the frunk/trunk shrinks the lid along the long axis toward
 * the hinge, revealing the compartment, and the lid brightens a little because
 * it now tilts toward the light (details in `Hatch`). The trunk is an SUV
 * tailgate: hinged at the rear edge of the roof; the spoiler, rear window and
 * the middle section of the tail lights sit on the tailgate, so they open
 * together (`TRUNK`).
 *
 * Here they are **drawn only**, not clickable: the frunk/trunk buttons sit in
 * the same row as the doors in the control panel (`ClimateScreen`). They used
 * to be two floating labels attached to the nose and tail of the car, and were
 * the only two buttons outside the panel — to open the trunk you had to look in
 * a place where no other button lived.
 *
 * ## Sunroof
 *
 * The front pane of the panoramic glass, right above the two front seats. The
 * roof and glass frame are cut out at exactly that pane (mask), and the sliding
 * glass panel lies on top — when closed the two layers meet, leaving only a
 * thin seam. Opening lifts the panel's tail and slides it back over the rear
 * pane; the open gap has no tinted glass, so you look straight down at the
 * seats with sunlight shining through. Opening `0..100` via `sunroof`, like
 * the windows.
 *
 * ## Turn signals
 *
 * Two amber lights per side: the front corner and the rear corner of the car.
 * There's no mirror repeater yet — the mirror rotates with the door and folds,
 * so a light on it must live inside `Mirror`, not in this fixed light layer.
 *
 * The light is an LED strip that **runs sequentially from inside to outside**
 * and then the whole strip turns off — seen from above, that motion shows the
 * turn direction by itself without an arrow. Each light also casts a glow onto
 * the ground *under* the body, so when lit you see light spilling around the
 * car's corner rather than just a colored streak on the paint. When off the
 * lens is still faintly visible, so you know there's a light there.
 *
 * ## Wipers
 *
 * Two wiper arms on the windshield, taking `wipers`. Rain only collects when
 * the wipers are on and gets swept clean exactly as the blade passes — details
 * in `Wipers.tsx`.
 *
 * ## Motion
 *
 * Only things that carry state move: colors transition over 600 ms when state
 * changes (the eye catches it in the periphery). Airflow, however, **stands
 * still**: the car image is always on screen, and endlessly running airflow
 * would keep pulling the eye there — Tesla too only animates the airflow waves
 * inside the climate screen, opened while adjusting. Fan strength reads as the
 * reach of the airflow (`airFlow`).
 */

import { type ReactNode, useId } from 'react'

import {
  FAN_SPEED_RANGE,
  SEAT_HEAT_RANGE,
  ZONES,
  type Zone,
} from '@/domain/car-state'
import { describeCarView, describeSeatHeatButton } from '@/domain/say'
import { cn } from '@/lib/utils'
import { useCarStore } from '@/store/car-store'
import { runCommand } from '@/store/run-command'

import {
  airColor,
  DOORS,
  signalsSide,
  temperatureColor,
  TURN_SIGNAL_PERIOD_MS,
  type DoorId,
  type DoorStates,
  type MirrorId,
  type MirrorStates,
  type TurnSignal,
  type WindowPositions,
  type WiperMode,
} from './car-visuals'
import { Wipers } from './Wipers'

/** Front seat center on the x axis, in the 200×400 coordinate system. */
const SEAT_CX: Record<Zone, number> = { driver: 76, passenger: 124 }

/**
 * Seat heating hit target, in viewBox units. A front seat spans x cx±17,
 * y 180–232.
 *
 * The hit area (`hit`) runs from the car's center line outward, 52 wide so it
 * stays at least 44px in a 330px-tall frame (1 unit ≈ 0.825px) — so it can't be
 * concentric with the seat: the seat is only 24 from the center line, and a
 * concentric 52-wide target would overlap the other seat's target. The
 * *visible* part (`mark`: hover background, focus ring) is concentric with the
 * seat.
 */
const SEAT_HIT = {
  hit: { width: 52, top: 172, height: 68 },
  mark: { width: 46 },
} as const

/**
 * Geometry of the four doors: a strip along the side of the car from the body
 * edge at the waist (`BODY_HALF`) in to the roof edge. `side` is the sign of x
 * relative to the center line, used to mirror the same shape to the right side.
 * The window takes the inner part of the strip, from `windowTop` to the end of
 * the door. The handle (flip-out, nearly flush with the body) sits near the
 * rear edge of each door.
 *
 * `frontSlant` / `rearSlant` are the slant of the front / rear edge: how far
 * the inner corner is set back relative to the outer corner. Real doors aren't
 * rectangular — the front door's leading edge follows the A-pillar raking
 * back, the rear door's trailing edge hugs the C-pillar and wheel arch — and
 * it's those two slanted edges that make an open door read as a "car door"
 * rather than a rectangular bar.
 */

/**
 * The front door's leading edge is the window frame running along the
 * A-pillar: from the mirror base (body edge, y 128) raking back to right by the
 * windshield's top corner (51, 163). That way the door never overlaps the
 * windshield, the window tapers to a point at the front along the A-pillar, and
 * between the two panes there's a silver A-pillar strip narrowing toward the
 * roof — like a real car. With less slant the door's inner corner cuts across
 * the windshield.
 */
const FRONT_DOOR_SLANT = 35

const DOOR_GEOMETRY: Record<
  DoorId,
  {
    side: -1 | 1
    top: number
    bottom: number
    windowTop: number
    frontSlant: number
    rearSlant: number
    mirror?: MirrorId
  }
> = {
  frontLeft: {
    side: -1,
    top: 128,
    bottom: 214,
    windowTop: 134,
    frontSlant: FRONT_DOOR_SLANT,
    rearSlant: -2,
    mirror: 'left',
  },
  rearLeft: {
    side: -1,
    top: 218,
    bottom: 296,
    windowTop: 220,
    frontSlant: 2,
    rearSlant: 10,
  },
  frontRight: {
    side: 1,
    top: 128,
    bottom: 214,
    windowTop: 134,
    frontSlant: FRONT_DOOR_SLANT,
    rearSlant: -2,
    mirror: 'right',
  },
  rearRight: {
    side: 1,
    top: 218,
    bottom: 296,
    windowTop: 220,
    frontSlant: 2,
    rearSlant: 10,
  },
}

/**
 * Outline of one door. `at(u)` converts a distance `u` measured inward from the
 * outer edge into an x coordinate, so the same shape serves both sides.
 *
 * The outer edge is straight because the body side is straight: when closed
 * the door must be seamless with the body. All four corners are rounded; the
 * hinge corner has the smallest radius because that's where the door hugs the
 * fender.
 */
function doorOutline(
  at: (u: number) => number,
  width: number,
  top: number,
  bottom: number,
  frontSlant: number,
  rearSlant: number,
) {
  const inner = at(width)
  const innerTop = top + frontSlant
  const innerBottom = bottom - rearSlant
  return [
    `M${at(0)} ${top + 3}`,
    `Q${at(0)} ${top} ${at(2.5)} ${top}`,
    `L${at(width - 3)} ${innerTop - 0.4}`,
    `Q${inner} ${innerTop} ${inner} ${innerTop + 4}`,
    `L${inner} ${innerBottom - 4}`,
    `Q${inner} ${innerBottom} ${at(width - 3)} ${innerBottom + 0.4}`,
    `L${at(4)} ${bottom}`,
    `Q${at(0)} ${bottom} ${at(0)} ${bottom - 4}`,
    'Z',
  ].join(' ')
}

/**
 * When folded the mirror swings back almost parallel to the car's side. Not
 * 90°: a real folded mirror still sticks out a little because the housing is
 * thicker than the gap between it and the glass.
 */
const MIRROR_FOLD_DEG = 70

/**
 * Door opening angle. Tesla draws about 60°, but here the two temperature
 * columns stand right beside the car: 48° is the largest angle at which the tip
 * of the front door doesn't touch the temperature number in a 430px frame, and
 * it's still diagonal enough to read instantly as "door open".
 */
const DOOR_OPEN_DEG = 48

/**
 * Half the body width at the door section (the car's waist) — the door's outer
 * edge, the mirror base. The front fenders and rear haunches flare out an extra
 * `BODY_FLARE`: the widest point is around the wheels, like a real SUV.
 */
const BODY_HALF = 67.5
const BODY_FLARE = 2

/**
 * Width of the side-window strip seen from above. The glass leans inward
 * (tumblehome), so from above only a narrow dark band remains along the roof
 * edge, and the silver shoulder takes up most of the door's width — like a VF 8
 * photo shot straight from above.
 */
const SIDE_GLASS_WIDTH = 7

/**
 * Body outline, in the 200×400 system — the shape of the new-generation
 * VinFast VF 8 (2026): length 348 (y 26–374), max width 139, matching the
 * 1872 / 4701 mm ratio. Broad nose, large SUV-style corner radii; the front
 * fenders (y 62–112) and rear haunches (y 308–336) flare around the wheel
 * arches, the waist is straight along the doors; the tail is rounder than the
 * nose because the tail lights wrap around the corners.
 */
const BODY = (() => {
  const wide = BODY_HALF + BODY_FLARE
  // Right half, from mid-nose down to mid-tail, coordinates relative to
  // (100, 26); the left half is its mirror image.
  // At every joint, the control points on both sides must be collinear with
  // the joint, otherwise the silver paint surface kinks and the four corners
  // look pinched. Three joints prone to kinking: nose into side (60, 5), the
  // end of the nose curve into the straight vertical side (wide, 36) — the
  // control point before it must share its `x` — and side into tail (62, 341).
  const half: Point[][] = [
    [
      [28, 0],
      [52.3, 0.8],
      [60, 5],
    ],
    [
      [64.75, 7.6],
      [wide, 20],
      [wide, 36],
    ],
    [[wide, 86]],
    [
      [wide, 94],
      [BODY_HALF, 96],
      [BODY_HALF, 102],
    ],
    [[BODY_HALF, 266]],
    [
      [BODY_HALF, 274],
      [wide, 276],
      [wide, 282],
    ],
    [[wide, 310]],
    [
      [wide, 326],
      [66.3, 336.7],
      [62, 341],
    ],
    [
      [55.9, 347.1],
      [32, 348],
      [0, 348],
    ],
  ]
  const at = (side: -1 | 1, [dx, dy]: Point) => `${100 + side * dx} ${26 + dy}`
  const right = half.map(
    (points) =>
      `${points.length === 1 ? 'L' : 'C'}${points.map((p) => at(1, p)).join(' ')}`,
  )
  // Walk the right half backwards: each segment reverses its points, and its
  // last point is the start point of the preceding segment.
  const left = half
    .map((points, index) => {
      const start = index === 0 ? ([0, 0] as Point) : half[index - 1].at(-1)!
      const reversed = [...points.slice(0, -1).reverse(), start]
      return `${points.length === 1 ? 'L' : 'C'}${reversed.map((p) => at(-1, p)).join(' ')}`
    })
    .reverse()
  return `M100 26 ${right.join(' ')} ${left.join(' ')} Z`
})()

/**
 * Roof painted body color, from the windshield's top edge to the tailgate hinge
 * — like a real VF 8 Plus (an SUV roof extends over the cargo area all the way
 * to the spoiler, rather than stopping behind the rear seats like a sedan).
 * Its two side edges meet the side-window strips.
 *
 * Every landmark along the body is measured on a straight-down shot from
 * VinFast's 3D configurator (image aspect exactly 1872 / 4701, i.e. nearly an
 * orthographic projection), as a fraction of length from the nose —
 * y = 26 + 348 × fraction: windshield top 37%, panoramic glass 43.5–77.2%
 * (divider bar at 60.4%), shark fin 81–85%, end of roof 86%.
 */
const ROOF =
  'M51 161 C72 152.8 128 152.8 149 161 L149 322 Q149 325.4 145 325 C124 321.5 76 321.5 55 325 Q51 325.4 51 322 Z'

/**
 * Panoramic glass on the roof: a black frame (`PANORAMA`) split into two panes
 * by a crossbar between the two seat rows. The front pane (`SUNROOF`) is the
 * sliding sunroof, sitting entirely over the two front seats (y 180–232) so
 * that opening it immediately shows the seats light up; the rear pane
 * (`REAR_PANE`) is fixed over the rear bench. These two panes are what let the
 * HVAC screen see through down to the seats.
 */
const PANORAMA = { x: 61.5, y: 177, width: 77, height: 118, rx: 11 } as const
const SUNROOF = { x: 64, y: 179.5, width: 72, height: 54.5, rx: 8 } as const
const REAR_PANE = { x: 64, y: 237.5, width: 72, height: 55, rx: 8 } as const

/**
 * Travel when fully open: the panel slides back almost its entire length while
 * its tail stays inside the panoramic glass frame (286 < 292.5) — sliding over
 * the rear pane.
 */
const SUNROOF_TRAVEL = 52

/**
 * How long the sunroof's closing sequence takes, counting both stages in
 * `Sunroof`: slide forward (1100ms, no delay), then lower onto the roof surface
 * (shadow fades after a 1000ms delay, taking 200ms). Anyone who wants to wait
 * for the panel to finish closing before continuing should wait this long.
 */
const SUNROOF_CLOSE_MS = 1200

/**
 * Shark fin (antenna) at the rear of the roof, just ahead of the spoiler: the
 * pointed tip faces the nose, the bulge toward the rear.
 */
const SHARK_FIN =
  'M100 307 C102.6 309.5 103.6 314.5 103.4 318.6 Q100 321.6 96.6 318.6 C96.4 314.5 97.4 309.5 100 307 Z'

/**
 * Fixed rear quarter glass, from behind the rear door to the spoiler —
 * continuing the side-window strip so the roof edge has one unbroken dark band
 * from the windshield to the tail, like a real car. Its front end is slanted to
 * match the rear door's trailing edge. Left half; the right side is mirrored.
 */
const QUARTER_GLASS = 'M44 291.5 L51 287.5 V322 Q46.5 321 44 313 Z'

/**
 * Windshield: the base edge (by the hood) curves at the top, the roof edge at
 * the bottom. The VF 8's windshield is very raked: projected straight down, its
 * length foreshortens a lot, so the glass is just a horizontal band rather than
 * a large panel. Length / width ≈ 0.41 — even less than the `tren-doc.png`
 * photo (0.44), because that photo is shot slightly off-axis and so shows extra
 * glass. The freed space goes to the hood: the windshield base sits at 26.6%
 * of the car's length from the nose, 30% at the corners. The two A-pillar sides
 * are nearly parallel, bulging slightly outward — the glass reads as a
 * near-rectangular panel rather than narrowing like a funnel. The roof edge
 * bows toward the nose, its middle ~6 ahead of the corners.
 */
const WINDSHIELD =
  'M42 120 C68 102 132 102 158 120 C156.5 135.9 152 150.1 149 161 C128 152.8 72 152.8 51 161 C48 150.1 43.5 135.9 42 120 Z'

/**
 * Black cowl strip at the windshield base — wiper well, defrost vents — ~9
 * thick along the whole base, like a real car: from above it's the darkest
 * black arc between the hood and the glass. Drawn wide, then clipped to
 * `WINDSHIELD`.
 */
const WINDSHIELD_COWL = 'M36 96 H164 V129 C132 111 68 111 36 129 Z'

/** Top edge of the windshield — also the front edge of `ROOF`. */
const WINDSHIELD_ROOF_EDGE = 'M51 161 C72 152.8 128 152.8 149 161'

/** y of the windshield base at x — a parabola approximating the curve in `WINDSHIELD`. */
const windshieldBase = (x: number) => 106.5 + 13.5 * ((x - 100) / 58) ** 2

/**
 * Front defrost: air blows from the defrost vents at the windshield base (top
 * edge, by the hood) up toward the roof — the same strand style as the cabin
 * airflow, so the eye immediately reads "air is blowing onto the glass". The
 * strands flare slightly outward like air spreading over the glass. The base
 * curves along `windshieldBase`.
 */
const DEFROST_STRANDS = [64, 76, 88, 100, 112, 124, 136].map((x, index) => {
  const top = windshieldBase(x) + 1.5
  const end = x + (x - 100) * 0.18
  const sway = index % 2 === 0 ? 2 : -2
  return `M${x} ${top} C${x + sway} ${top + 19} ${end - sway} 147 ${end} 158`
})

/** Maps a point on a lid to its open position, returning an `"x y"` string for a path. */
type LiftMap = (x: number, y: number) => string

const point = (x: number, y: number) => `${+x.toFixed(2)} ${+y.toFixed(2)}`

/** `steps + 1` points along a cubic curve, including both ends. */
function cubicPoints(
  [p0, p1, p2, p3]: readonly [Point, Point, Point, Point],
  steps: number,
): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps
    const at = (axis: 0 | 1) =>
      (1 - t) ** 3 * p0[axis] +
      3 * (1 - t) ** 2 * t * p1[axis] +
      3 * (1 - t) * t ** 2 * p2[axis] +
      t ** 3 * p3[axis]
    return [at(0), at(1)] as const
  })
}

/**
 * Geometry of one hatch lid. Coordinates on the hinge line are written directly
 * into the path; every coordinate *off* the hinge goes through `m` — so when it
 * opens, the hinge edge stays perfectly still, the gap around it doesn't change,
 * and only the lifting part of the lid moves.
 */
type HatchShape = {
  /** y of the hinge line at x — a parabola through both ends and the apex of the curved edge. */
  hinge: (x: number) => number
  /** Distance from the hinge to the free edge — for the lid thickness and the `bow` curve. */
  length: number
  /**
   * How far the free edge bows out when fully open (`depth` at the center
   * line, down to 0 at `±halfWidth`). The lid's edge curls down to wrap the
   * body — deeper in the middle than at the corners — and when the lid stands
   * up, that curl flips toward the camera: seen from above, the free edge
   * becomes a convex curve. Without it the open lid is a flat vertical board in
   * front of a curved compartment opening.
   */
  bow?: { depth: number; halfWidth: number }
  /**
   * Open pose for a lid that *swings backwards* instead of lifting up
   * (`liftMap`) — the tailgate, see `tailgateSwing`. With it, the open lid
   * doesn't show its underside.
   */
  swing?: LiftMap
  outline: (m: LiftMap) => string
  /**
   * Glass pane on the lid, cut out of the painted panel to see through to the
   * compartment below. The glass draws itself in `children`.
   */
  window?: (m: LiftMap) => string
  crease: (m: LiftMap) => string
  creaseColor: string
}

/**
 * The hood's front edge when closed, from left corner to right corner: hugging
 * right behind the wing-shaped light bar (a ~2-unit gap behind the trim), the
 * two corners curving around the turn signal tips. Sampled into points so each
 * one can be mapped through `m` — like `tailgateAcross`: Bézier control points
 * sit off the curve, and `m` would pull them to the wrong place.
 */
const FRUNK_FRONT_EDGE = (
  [
    [
      [44.5, 43],
      [45, 38.5],
      [47.5, 36],
      [53, 35.2],
    ],
    [
      [53, 35.2],
      [78, 32],
      [122, 32],
      [147, 35.2],
    ],
    [
      [147, 35.2],
      [152.5, 36],
      [155, 38.5],
      [155.5, 43],
    ],
  ] as const
).flatMap((curve, index) =>
  cubicPoints(curve, index === 1 ? 20 : 4).slice(index === 0 ? 0 : 1),
)

/**
 * Hood — its hinge is the windshield base itself (42,120) → (100,106.5) →
 * (158,120), where the wipers sit: like a real car, the hood's rear edge runs
 * right up to the glass with no trim strip in between. The raked windshield
 * pushes its base far back toward the cabin, and the hood takes all of that
 * space: from above the hood is the largest panel of the nose. When opened the
 * front edge lifts, the lid shrinks toward the glass and the compartment is
 * revealed behind the light bar.
 */
const FRUNK: HatchShape = {
  hinge: windshieldBase,
  length: 75,
  // The hinge (windshield base) curves by 13.5 while the closed front edge is
  // nearly straight: shrinking toward the hinge alone would make the open front
  // edge inherit the base's curve and sag into a crescent. A negative `bow`
  // pulls the middle of the edge back, keeping about the closed curvature.
  bow: { depth: -5, halfWidth: 56 },
  // Like the tailgate, the lid covers the whole top of the nose. The lights,
  // however, do *not* move with the lid — on the VF 8 the light cluster is
  // mounted on the body, and the lid only covers what's behind it.
  outline: (m) =>
    `M${FRUNK_FRONT_EDGE.map(([x, y]) => m(x, y)).join(' L')} L158 120 C132 102 68 102 42 120 Z`,
  crease: (m) =>
    `M${m(74, 42)} C${m(71, 59)} ${m(67, 81)} ${m(63, 105)} M${m(126, 42)} C${m(129, 59)} ${m(133, 81)} ${m(137, 105)}`,
  creaseColor: 'oklch(0.45 0.01 255)',
}

/** Tailgate hinge: (55,325) → (100,322.4) → (145,325). */
const trunkHinge = (x: number) => 322.375 + (2.625 / 45 ** 2) * (x - 100) ** 2

/**
 * The tailgate is split into three regions along its length: the spoiler, the
 * rear window (including its black frame), and the lower panel carrying the
 * tail lights. Everything on the tailgate is written in *on-tailgate*
 * coordinates `(x, v)`: `v` is 0 at the hinge, 1 at the end of the spoiler, 2
 * at the base of the glass, 3 at the bottom edge — so the same point has its
 * place both closed and open, and the light bar, glass and lettering stay
 * attached to the tailgate throughout the animation.
 *
 * When closed — measured on a straight-down shot from VinFast's configurator —
 * each landmark is a curve in x (`TAILGATE_SHUT`): the body-colored spoiler
 * covers almost all of the cargo area; the rear window is so raked that only a
 * dark crescent band remains, its ends wrapping up around the two corners; the
 * upright lower panel is just a thin sliver.
 */
const TAILGATE_SHUT: readonly ((x: number) => number)[] = [
  trunkHinge,
  // spoiler's rear edge is straight across, corners rounded with radius 12 —
  // the glass wraps around them
  (x) => {
    const corner = Math.max(0, Math.abs(x - 100) - 36.8)
    return 338.5 + Math.sqrt(Math.max(0, 144 - corner ** 2))
  },
  (x) => 367 - 12 * ((x - 100) / 52) ** 4,
  (x) => 355 + 17.4 * Math.max(0, 1 - Math.abs((x - 100) / 52) ** 5) ** 0.2,
]

/**
 * When open: the tailgate swings up and back — the glass and lower panel are
 * nearly horizontal so they get much longer, the spoiler stands up so it gets
 * shorter, and the free edge widens because it's now high up, close to the
 * camera. Length of each region measured from the hinge (`run`), with the three
 * regions proportioned per the photo (31 : 48 : 40).
 *
 * The total length does not follow the photo, though: the configurator's
 * camera stands close, so perspective magnifies the raised tailgate; measured
 * as-is, the tailgate's edge would stick out past the tail by nearly 70 units,
 * sweeping outside the whole stage area. Here it stops at ~31.
 */
const TAILGATE_OPEN = {
  run: (x: number) => {
    const corner = ((x - 100) / 52) ** 4
    return [22 - 2 * corner, 34, 27 - 4 * corner] as const
  },
  flare: 0.14,
} as const

const TAILGATE_OPEN_LENGTH = TAILGATE_OPEN.run(100).reduce((a, b) => a + b)

/** Closed y of the point `(x, v)` on the tailgate surface. */
function tailgateY(x: number, v: number) {
  const region = Math.max(0, Math.min(2, Math.floor(v)))
  const from = TAILGATE_SHUT[region](x)
  return from + (v - region) * (TAILGATE_SHUT[region + 1](x) - from)
}

/**
 * Half-width of the tailgate at level `v`: equal to the roof at the spoiler,
 * widening along the glass, then narrowing on the lower panel — rounding the
 * two corners of the free edge.
 */
const tailgateHalf = (v: number) =>
  v <= 1 ? 48.8 : v <= 2 ? 48.8 + 3.2 * (v - 1) : 52 - 4.5 * (v - 2) ** 3

/**
 * Maps a point of the closed tailgate to its open position: recover its `v`
 * from the closed landmarks, then place it by each region's open length.
 */
function swingPoint(x: number, y: number): [number, number] {
  const shut = TAILGATE_SHUT.map((edge) => edge(x))
  const run = TAILGATE_OPEN.run(x)
  let along = 0
  for (let region = 0; region < 3; region++) {
    const span = shut[region + 1] - shut[region]
    const part = span > 0 ? (y - shut[region]) / span : 0
    if (part <= 1 || region === 2) {
      along += run[region] * Math.max(0, part)
      break
    }
    along += run[region]
  }
  const spread =
    1 + TAILGATE_OPEN.flare * Math.min(1, along / TAILGATE_OPEN_LENGTH)
  return [100 + (x - 100) * spread, trunkHinge(x) + along]
}

const tailgateSwing: LiftMap = (x, y) => point(...swingPoint(x, y))

/** Point `(x, v)` on the tailgate surface, through `m`. */
const onTailgate = (m: LiftMap, x: number, v: number) => m(x, tailgateY(x, v))

/**
 * A run of `L` commands across the tailgate at level `v` from `from` to `to`,
 * without a start point — it continues the path being drawn. Points rather than
 * curves: `swingPoint` stretches each region differently, so control points
 * lying off the curve would be pulled to the wrong place.
 */
function tailgateAcross(
  m: LiftMap,
  v: number,
  from: number,
  to: number,
  steps = 24,
) {
  return Array.from({ length: steps }, (_, index) => {
    const x = from + ((to - from) * (index + 1)) / steps
    return `L${onTailgate(m, x, v)}`
  }).join(' ')
}

/**
 * A run of `L` commands along the tailgate's side edge on `side`, from level
 * `from` to `to`, without a start point. Steps of 1/8, so it always passes
 * exactly through the two kinks at `v` 1 and 2.
 */
function tailgateEdge(m: LiftMap, side: -1 | 1, from: number, to: number) {
  const steps = Math.round(Math.abs(to - from) * 8)
  return Array.from({ length: steps }, (_, index) => {
    const v = from + ((to - from) * (index + 1)) / steps
    const x = 100 + side * tailgateHalf(v)
    return `L${onTailgate(m, x, v)}`
  }).join(' ')
}

/**
 * Tailgate — SUV style, not a sedan trunk lid: hinged at the rear edge of the
 * roof. The spoiler, rear window, lower panel and the middle section of the
 * tail light bar are all *one* tailgate and open together (`TAILGATE_PARTS`).
 * The free edge stops short of the rear bumper, leaving a thin bumper strip;
 * the two corner lights wrapping the sides stay on the body, like a real VF 8.
 */
const TRUNK: HatchShape = {
  hinge: trunkHinge,
  length: 49,
  // The tail is already round, so the free edge curves on its own; no `bow`
  // needed.
  swing: tailgateSwing,
  outline: (m) =>
    `M55 325 C76 321.5 124 321.5 145 325 Q${m(148.5, 325.6)} ${m(148.8, 328)} ${tailgateEdge(m, 1, 0.25, 3)} ${tailgateAcross(m, 3, 147.5, 52.5)} ${tailgateEdge(m, -1, 3, 0.25)} Q${m(51.5, 325.6)} 55 325 Z`,
  window: (m) => TAILGATE_PARTS.pane(m),
  // fold crease just below the glass base, at the top of the lower panel
  crease: (m) =>
    `M${onTailgate(m, 50, 2.12)} ${tailgateAcross(m, 2.12, 50, 150)}`,
  creaseColor: 'oklch(0.42 0.01 255)',
}

/** Glass pane inside the black frame, in `v`: thin frame at the spoiler end, thick at the glass base. */
const REAR_PANE_V = { top: 1.08, bottom: 1.82 } as const

/**
 * The middle tail light bar on the lower panel, as a function of distance `d`
 * from the center line. Two shapes for the two poses, with the same number of
 * points so the path's `d` interpolates from one shape to the other. The real
 * light bar is a curve in 3D space whose top-down shape changes with the
 * tailgate angle — the model's three flat regions can't produce that on their
 * own.
 *
 * - Open (`open`, in `v`), measured on a top-down photo with the trunk open:
 *   sags in the middle (`level` — ends by the glass corners at 2.19, middle
 *   2.42), sweeps down at ~15 from the center line (`dip`), stopping at ±6.4
 *   level with the logo's tips. Extends all the way to the lower panel's edge —
 *   when open the corner lights stay on the body, nothing continues the bar,
 *   so stopping early would leave a gap.
 * - Closed (`shut`, in y): a mirror image of the headlights (`LAMP_TRIM`,
 *   `HEADLIGHT`). The black trim runs as one continuous strip across the logo,
 *   its ends continuing into the two corner trims on the body — at the joint
 *   (51, 368.8) sharing their direction — so the tail reads as one continuous
 *   "wing" like the nose; the tailgate gap cuts across it without showing.
 *   The LED strip is set back 4 units from the corner turn signal tips, like
 *   the headlights, broken at the logo, its two inner ends sweeping toward the
 *   tail edge (`hook`).
 */
const TAIL_LIGHT = {
  // nearly straight on both sides, rounded through the middle
  level: (d: number) =>
    2.19 + 0.23 * (1 - (Math.hypot(d, 10) - 10) / (Math.hypot(52, 10) - 10)),
  /** Sweeps down along `t` from 0 (where the curve starts) to 1 (the light's tip); past 1 it continues straight. */
  dip: (d: number) => {
    const t = Math.max(0, (15 - d) / 8.6)
    return 0.2 * (t <= 1 ? t * t * (2 - t) : t)
  },
  open: (d: number) => TAIL_LIGHT.level(d) + TAIL_LIGHT.dip(d),
  shut: (d: number) => 370.6 - 1.8 * (d / 49) ** 4.6,
  hook: (d: number) => 1.7 * Math.max(0, 1 - (d - 3.2) / 4) ** 2,
}

/** `d` values of the LED strip on each half, from the outer end in to the logo — denser toward the sweep. */
const TAIL_LIGHT_D = Array.from(
  { length: 24 },
  (_, index) => +(3.2 + 41.8 * (1 - index / 23) ** 1.5).toFixed(2),
)

/** Open `d` of the LED strip for a given closed `d`: from the logo tip out to near the tailgate edge. */
const openLightD = (d: number) => 6.4 + ((d - 3.2) * (49.8 - 6.4)) / 41.8

/** Signed `d` of the closed trim, one continuous strip from the left corner to the right. */
const TAIL_TRIM_D = Array.from(
  { length: 81 },
  (_, index) => -49 + 1.225 * index,
)

/**
 * The black trim when open, as offsets from `level` (in `v`). The top edge runs
 * unbroken across the logo; the bottom edge hugs below the light bar and
 * flattens into a floor at `floor` in the middle — the logo sits neatly inside
 * a black V-shaped "shield", as in the photo.
 */
const TAIL_TRIM_OPEN = {
  top: -0.09,
  bottom: 0.07,
  floor: 2.66,
  /** Half-width when open: right at the lower panel's edge (`tailgateHalf` around `v` 2.3). */
  half: 51.8,
} as const

/**
 * The brand's W when open: half-width `half`, the two outer tips `top` and the
 * two bottoms `tip` as offsets from `level(0)`. About 9 wide; the height keeps
 * a fixed ratio rather than following `v`, because the model's lower panel is
 * short — following `v` would squash the letter flat.
 */
const TAIL_LOGO_OPEN = { half: 4.6, top: -0.04, tip: 0.2 } as const

/** `v` on the lower panel of the point whose closed y is `y`, at x. */
function shutV(x: number, y: number) {
  const fold = TAILGATE_SHUT[2](x)
  return 2 + (y - fold) / (TAILGATE_SHUT[3](x) - fold)
}

/**
 * Half-width of the closed tailgate at height `y`, along the lower panel's side
 * edge — that edge both narrows (`tailgateHalf`) and runs along `v`, so step
 * through `v` and then interpolate.
 */
function tailgateShutHalf(y: number) {
  const at = (v: number) => {
    const half = tailgateHalf(v)
    return [half, tailgateY(100 - half, v)] as const
  }
  let [prevHalf, prevY] = at(2)
  for (let step = 1; step <= 40; step++) {
    const [half, edgeY] = at(2 + step / 40)
    if (edgeY >= y) {
      return prevHalf + ((half - prevHalf) * (y - prevY)) / (edgeY - prevY)
    }
    prevHalf = half
    prevY = edgeY
  }
  return prevHalf
}

/** Joins points into a polyline path. */
const polyline = (points: string[]) =>
  `M${points[0]} ${points
    .slice(1)
    .map((p) => `L${p}`)
    .join(' ')}`

/**
 * Parts mounted on the tailgate, written through `m` like the lid outline so
 * they move with it when it opens.
 *
 * - Spoiler: painted panel from the hinge to `v` 1, its rear edge a dark lip
 *   (`lip`) — the spoiler's underside is in shadow.
 * - Rear window: black frame (`frame`, even-odd to cut out the pane) and the
 *   glass pane (`pane`). When closed both are dark; when open the pane is
 *   clear, showing through into the trunk.
 * - Lower panel (from the glass base to the free edge) — to brighten when open.
 * - Defrost grid: lines across the pane, their ends joined to two bus bars
 *   along the edges.
 * - Lights: *one* light bar and the logo on the lower panel. When closed the
 *   panel is upright, so from above the light bar flattens into a red streak by
 *   the tail edge; when open it stretches into a V.
 */
const TAILGATE_PARTS = {
  spoiler: (m: LiftMap) =>
    `M55 325 C76 321.5 124 321.5 145 325 Q${m(148.5, 325.6)} ${m(148.8, 328)} ${tailgateEdge(m, 1, 0.25, 1)} ${tailgateAcross(m, 1, 148.8, 51.2)} ${tailgateEdge(m, -1, 1, 0.25)} Q${m(51.5, 325.6)} 55 325 Z`,
  lip: (m: LiftMap) =>
    `M${onTailgate(m, 148.8, 1)} ${tailgateAcross(m, 1, 148.8, 51.2)}`,
  frame: (m: LiftMap) => `${TAILGATE_PARTS.glass(m)} ${TAILGATE_PARTS.pane(m)}`,
  glass: (m: LiftMap) =>
    `M${onTailgate(m, 51.2, 1)} ${tailgateAcross(m, 1, 51.2, 148.8)} ${tailgateEdge(m, 1, 1, 2)} ${tailgateAcross(m, 2, 152, 48)} ${tailgateEdge(m, -1, 2, 1)} Z`,
  pane: (m: LiftMap) => {
    const { top, bottom } = REAR_PANE_V
    const at = (x: number, v: number) => onTailgate(m, x, v)
    return `M${at(67, top)} ${tailgateAcross(m, top, 67, 133, 10)} Q${at(138, top)} ${at(138, top + 0.12)} L${at(138, bottom - 0.12)} Q${at(138, bottom)} ${at(133, bottom)} ${tailgateAcross(m, bottom, 133, 67, 10)} Q${at(62, bottom)} ${at(62, bottom - 0.12)} L${at(62, top + 0.12)} Q${at(62, top)} ${at(67, top)} Z`
  },
  lower: (m: LiftMap) =>
    `M${onTailgate(m, 48, 2)} ${tailgateAcross(m, 2, 48, 152)} ${tailgateEdge(m, 1, 2, 3)} ${tailgateAcross(m, 3, 147.5, 52.5, 16)} ${tailgateEdge(m, -1, 3, 2)} Z`,
  grid: (m: LiftMap) =>
    [1, 2, 3, 4].map((step) => {
      const { top, bottom } = REAR_PANE_V
      const v = top + ((bottom - top) * step) / 5
      return `M${onTailgate(m, 64, v)} ${tailgateAcross(m, v, 64, 136)}`
    }),
  bus: (m: LiftMap) =>
    [64, 136].map((x) => {
      const { top, bottom } = REAR_PANE_V
      const span = bottom - top
      return `M${onTailgate(m, x, top + span * 0.1)} L${onTailgate(m, x, top + span * 0.9)}`
    }),
  // Filled shape: top edge left to right, bottom edge back again. When closed
  // it's a 4.6-thick strip around the `shut` curve (offset along the normal,
  // like a butt-capped stroke); when open it's the black shield
  // `TAIL_TRIM_OPEN`.
  trim: (m: LiftMap, open: boolean) => {
    const edge = (side: -1 | 1) =>
      TAIL_TRIM_D.map((d) => {
        if (open) {
          const x = 100 + (d * TAIL_TRIM_OPEN.half) / 49
          const dist = Math.abs(x - 100)
          const { bottom, floor, top } = TAIL_TRIM_OPEN
          const level = TAIL_LIGHT.level(dist)
          const v =
            side < 0
              ? level + top
              : Math.min(floor, level + bottom + TAIL_LIGHT.dip(dist))
          return onTailgate(m, x, v)
        }
        const slope =
          -Math.sign(d) * ((1.8 * 4.6) / 49) * (Math.abs(d) / 49) ** 3.6
        const k = 2.3 / Math.hypot(1, slope)
        const y = TAIL_LIGHT.shut(Math.abs(d)) + side * k
        // The top corners at both ends extend all the way to the tailgate's
        // side edge: a square cut falls ~0.5 short, and the tailgate paint
        // shows as a wedge between this trim and the corner trim.
        const x =
          side < 0 && Math.abs(d) === 49
            ? 100 + Math.sign(d) * tailgateShutHalf(y)
            : 100 + d - side * slope * k
        return onTailgate(m, x, shutV(x, y))
      })
    return `${polyline([...edge(-1), ...edge(1).reverse()])} Z`
  },
  // Two halves, each drawn from the outer end in to the logo, like `HEADLIGHT`.
  light: (m: LiftMap, open: boolean) =>
    ([-1, 1] as const)
      .map((side) =>
        polyline(
          TAIL_LIGHT_D.map((d) => {
            if (open) {
              const far = openLightD(d)
              return onTailgate(m, 100 + side * far, TAIL_LIGHT.open(far))
            }
            const x = 100 + side * d
            const v = shutV(x, TAIL_LIGHT.shut(d) + TAIL_LIGHT.hook(d))
            return onTailgate(m, x, v)
          }),
        ),
      )
      .join(' '),
  // Like `FRONT_LOGO` flipped: the W is upright on screen — the two outer tips
  // set in by 1 from the trim (`wing`), the two bottoms pointing toward the
  // tail edge (`tip`, where the old V's point was), the middle peak a quarter
  // of the height from the outer tips.
  logo: (m: LiftMap, open: boolean) => {
    const level = TAIL_LIGHT.level(0)
    const { half, wing, tip } = open
      ? {
          half: TAIL_LOGO_OPEN.half,
          wing: level + TAIL_LOGO_OPEN.top,
          tip: level + TAIL_LOGO_OPEN.tip,
        }
      : {
          half: 2.2,
          wing: shutV(97.8, TAIL_LIGHT.shut(2.2) - 1),
          tip: shutV(100, TAIL_LIGHT.shut(0) + 1.3),
        }
    // Middle peak a quarter of the height from the outer tips — the W's
    // proportions.
    const crest = wing + (tip - wing) * 0.25
    return polyline([
      onTailgate(m, 100 - half, wing),
      onTailgate(m, 100 - half / 2, tip),
      onTailgate(m, 100, crest),
      onTailgate(m, 100 + half / 2, tip),
      onTailgate(m, 100 + half, wing),
    ])
  },
}

/**
 * A fully open lid keeps 74% of its length seen from above — the cosine of a
 * ~42° lift angle: the compartment shows a strip behind the lights, enough to
 * read "trunk open", while the lid still covers most of the top of the nose.
 */
const HATCH_OPEN_SCALE = 0.74

/**
 * Lid thickness, in viewBox units — the strip of underside revealed at the free
 * edge when open. Absolute rather than proportional: a longer lid isn't a
 * thicker one.
 */
const HATCH_THICKNESS = 1.6

/**
 * Camera height above the car, in viewBox units — the sole source of the
 * sideways widening when a lid lifts.
 *
 * The car image is a straight top-down projection: a lid rotating around its
 * hinge axis (parallel to the x axis) changes *no point's x*. The only thing
 * that makes a raised lid look bigger is perspective: a point at height z looks
 * H/(H − z) times larger: the hood's front edge (length 63, lifted 53° →
 * z ≈ 50) widens by ~7%.
 */
const CAMERA_HEIGHT = 784

/**
 * A lifted lid seen from above: the farther a point is from the hinge, the more
 * it shrinks toward it (`scale` is the remaining length ratio = cos of the lift
 * angle), and the more it widens because it's higher up, closer to the camera —
 * the hinge edge is at height 0 so it keeps its width. `bow` curves the free
 * edge by the sine of the lift angle: 0 when closed, full when fully open.
 */
function liftMap(shape: HatchShape, scale: number): LiftMap {
  const lift = Math.sin(Math.acos(scale))
  return (x, y) => {
    const hingeY = shape.hinge(x)
    const along = Math.abs(y - hingeY)
    const reach = Math.min(1, along / shape.length)
    const height = along * lift
    const nx = 100 + ((x - 100) * CAMERA_HEIGHT) / (CAMERA_HEIGHT - height)
    const bow = shape.bow
      ? shape.bow.depth *
        Math.max(0, 1 - ((x - 100) / shape.bow.halfWidth) ** 2) *
        reach *
        lift
      : 0
    const ny = hingeY + Math.sign(y - hingeY) * (along * scale + bow)
    return point(nx, ny)
  }
}

/**
 * The shape is set via CSS `d` so the browser can interpolate between closed
 * and open (the two paths share the same command structure), and interrupt
 * midway like a `transform`. The `d` attribute is kept for browsers without
 * support: the lid still shows the right state, it just doesn't animate.
 */
function morph(d: string) {
  return { d, style: { d: `path("${d}")` } }
}

/**
 * Hatch lid timing. The lid is heavy and driven by gas struts: it starts
 * slowly and eases to a gentle stop on arrival — like the folding mirror, not
 * snapping out like touch feedback (`--ease-car` covers 97% of the distance in
 * the first half, making the lid look jerky). Everything mounted on the lid and
 * everything that changes with the lid uses this same timing.
 */
const HATCH_MOTION = 'transition-[d] duration-950 ease-(--ease-car-move)'

type Point = readonly [x: number, y: number]

/**
 * The two left turn signals, each a cubic curve drawn **from the inner end to
 * the outer end** — the running direction of the sequential LEDs. `glow` is the
 * center of the glow cast onto the ground. The right side is mirrored across
 * the center line (`x → 200 − x`).
 */
const SIGNAL_LAMPS: readonly {
  curve: readonly [Point, Point, Point, Point]
  glow: Point
}[] = [
  // front corner — the tip of the wing sweeping around to the side,
  // continuing the headlight
  {
    curve: [
      [53, 30.8],
      [45.5, 31.8],
      [39.5, 35.5],
      [35.6, 47],
    ],
    glow: [37, 38],
  },
  // rear corner — the end of the tail light bar wrapping around the corner, on
  // the body outside the tailgate
  {
    curve: [
      [51, 368.8],
      [44, 367.6],
      [38.6, 364.2],
      [35, 353],
    ],
    glow: [37, 366],
  },
]

/**
 * The car's signature: a wing-shaped LED bar spanning almost the full width of
 * the nose, with the W logo in the middle; set in ~2.6 units from the body edge
 * following the nose's arc, leaving a small gap before the inner end of the
 * turn signal so the two lights don't overlap. For the tail lights, the middle
 * section sits on the tailgate (`TAILGATE_PARTS`); only the two corners are on
 * the body.
 *
 * The light bar doesn't run through the logo: in the middle it breaks in two,
 * the two inner ends sweeping down to exactly the height of the W's two peaks,
 * so the logo sits in a black trim recess between the two light ends — at both
 * nose and tail. "Down" for someone standing looking at it means toward the
 * car's edge on screen (see `FRONT_LOGO`).
 */
const HEADLIGHT =
  'M57 30.4 C66.79 29.38 79.67 28.79 93 28.64 C95 28.6 95.6 28.2 96.8 26.9 M103.2 26.9 C104.4 28.2 105 28.6 107 28.64 C120.33 28.79 133.21 29.38 143 30.4'

/**
 * Gloss-black trim wrapping the light bar — headlights and both turn signal
 * ends — so the whole bar reads as one continuous "wing", like the VF 8's
 * nose. At the tail only the two corner pieces remain on the body; the middle
 * piece moves with the tailgate, and the tailgate gap cuts across the light
 * bar just like on the real car.
 */
const LAMP_TRIM = [
  'M35.6 47 C39.5 35.5 45.5 31.8 53 30.8 L57 30.4 C80 28 120 28 143 30.4 L147 30.8 C154.5 31.8 160.5 35.5 164.4 47',
  'M35 353 C38.6 364.2 44 367.6 51 368.8',
  'M165 353 C161.4 364.2 156 367.6 149 368.8',
]

/**
 * The W logo between the headlights. A logo faces whoever stands looking at
 * it: standing in front of the nose means facing the tail, so the front W is
 * upside down on screen; the tail W (on the tailgate, `TAILGATE_PARTS.logo`)
 * stays upright.
 *
 * Being upside down, on screen the W's two outer tips are *below* (`29.2`) and
 * the two bottoms point *up* to `26.9` — exactly the height of `HEADLIGHT`'s
 * inner ends, just like the old V's point. The middle peak is a quarter of the
 * height from the outer tips.
 */
const FRONT_LOGO = 'M97.8 29.2 L98.9 26.9 L100 28.62 L101.1 26.9 L102.2 29.2'

/**
 * 19-inch tires (≈ 235/55R19) seen from above: a real car hides almost all of
 * the wheel under the fender; here they poke out 3 units beyond the fender's
 * widest point so they still read as "wheels". `WHEEL_X` is the outer edge of
 * the left wheels; the right side is mirrored. `WHEEL_Y` is the top edge of the
 * two wheels — front axle at y 95, rear axle at y 305: a wheelbase of 2840 /
 * 4701 mm, with nearly equal overhangs at both ends.
 */
const WHEEL = { width: 17, height: 54, rx: 4 } as const
const WHEEL_X = 100 - BODY_HALF - BODY_FLARE - 3
const WHEEL_Y = [68, 278] as const

/**
 * Tread grooves are evenly spaced by angle around the tire's axis, not along
 * its length, so they bunch up at both ends — the tread reads as a cylinder
 * curving away.
 */
const TREAD = Array.from(
  { length: 11 },
  (_, index) =>
    +(
      (WHEEL.height / 2) *
      (1 - Math.cos(((index + 1) * Math.PI) / 12))
    ).toFixed(2),
)

function signalCurve(
  [p0, p1, p2, p3]: readonly [Point, Point, Point, Point],
  side: -1 | 1,
) {
  const at = ([x, y]: Point) => `${side === -1 ? x : 200 - x} ${y}`
  return `M${at(p0)} C${at(p1)} ${at(p2)} ${at(p3)}`
}

/** Bottom edge of the dashboard right in front of the seats — where the airflow starts. */
const VENT_Y = 155

/**
 * Bottom edge of the dashboard, where the row of air vents sits. The leather
 * dashboard trim and the A/C compressor's cool haze both run along this line,
 * so they always line up exactly.
 */
const DASH_EDGE = 'M50 153.2 C80 147.2 120 147.2 150 153.2'

/**
 * The area of cool air spilling into the cabin while the compressor runs. Its
 * top edge is **`DASH_EDGE` itself**, not a horizontal line: cutting straight
 * across the curved dashboard makes the haze a rectangle pasted over the car,
 * instantly visible as two separate pieces.
 *
 * The sides extend out past the cabin walls (x 44/156) and the bottom goes
 * past where the gradient is fully transparent — so none of the other three
 * sides has an edge: the sides are cut exactly at the car's walls by the cabin
 * `clipPath`, the bottom fades out by itself.
 */
const AC_HAZE =
  'M44 156.5 L50 153.2 C80 147.2 120 147.2 150 153.2 L156 156.5 V184 H44 Z'

/**
 * Cool air in the rear row, blowing from the rear vents at the end of the
 * center console (`Console` stops at y 234) — the VF 8 has rear vents exactly
 * there. The glow's center sits right at the console's end and is drawn
 * **under** the console, so its top half is hidden behind the console and the
 * haze reads as spilling from the console toward the rear bench, not a spot
 * pasted in the middle of the floor. The sides are cut by the cabin
 * `clipPath`, the bottom is hidden under the rear seat cushion.
 */
const REAR_VENT = { cx: 100, cy: 234, r: 34 } as const

/**
 * Recirculation: an **air swirl** spinning in the gap between the two seat
 * rows.
 *
 * This is the other half of a circulation loop — `airFlow` already draws the
 * outgoing direction (vents blowing down onto the seats), but not the return.
 * Turning recirculation on closes that loop *inside the cabin*; when off
 * nothing is drawn, because the air then flows one way.
 *
 * The two previous versions both drew a **return path along the car's side**:
 * the first had an arrowhead at the end of the stroke, the second dropped the
 * arrow and ran a light pulse backwards up it. Both failed for the same reason
 * — a vertical, thin, bright stroke right next to the airflow, which is also
 * vertical-thin-bright, reads as more air blowing rather than air returning;
 * and the arrow became the nth arrow on a screen already full of arrows (turn
 * signals, windows, doors, trunk, roof).
 *
 * The swirl avoids both: its **rotating circular** shape can't be confused with
 * any vertical stroke in the cabin, and it says "air churning inside the car"
 * by itself, no arrow needed.
 *
 * Its position is also the only free spot left: the gap between the front row
 * (ending at y≈232) and the rear bench (starting at y≈248), on the car's center
 * line. The radius matches half that gap so the swirl doesn't overlap any seat.
 */
const RECIRC_SWIRL_AT = { r: 9, x: 100, y: 240 } as const

/**
 * Two dashed rings of air around the swirl, rotating in **opposite directions**
 * at different speeds: a lone swirl in the middle of the cabin is a small
 * isolated dot; adding these two rings makes it a whole mass of rotating air —
 * the shape of a storm on a satellite image.
 *
 * The strokes are faint and sparse (more gap than dash), so even though their
 * radius reaches over the edges of the front seats and rear bench, they still
 * read as thin air drifting past rather than a ring drawn on top of the seats.
 *
 * Each ring rotates only 180° per cycle (`car-swirl`), so the dash pattern
 * **must repeat an exact whole number of times per half turn** — otherwise at
 * the end of the cycle the image jumps back and the eye sees a jerk. That's why
 * the dashes are declared as *fractions of the circumference*
 * (`pathLength="1"`, see `ringDash`) with an even `count`, rather than in
 * viewBox units: in viewBox units the dash period would have to divide
 * `π · r` evenly, and changing the radius would break it immediately.
 */
const SWIRL_RINGS = [
  { count: 8, duty: 0.3, ms: 5200, opacity: 0.32, r: 13.5, reverse: false },
  { count: 10, duty: 0.2, ms: 7200, opacity: 0.24, r: 17, reverse: true },
] as const

/**
 * Dash pattern of an air ring, as fractions of the circumference: `count` equal
 * periods, each with a `duty` fraction of dash and the rest gap.
 */
function ringDash(count: number, duty: number) {
  return `${duty / count} ${(1 - duty) / count}`
}

/**
 * Two swirl arms symmetric about the center, each an Archimedean spiral of a
 * little over one turn — the shape of a cyclone on a weather report, instantly
 * readable at any size.
 *
 * Drawn in a radius-1 system, then scaled with `scale` where used, like
 * `SNOWFLAKE`. Two arms (rather than three or four) is just right: at 8 viewBox
 * units, any more arms and the spiral turns merge into a solid blob.
 */
const SWIRL = (() => {
  const TURNS = 1.15
  const STEPS = 40
  const arms: string[] = []
  for (const phase of [0, Math.PI]) {
    const points: string[] = []
    for (let step = 0; step <= STEPS; step++) {
      const t = step / STEPS
      const angle = phase + t * TURNS * 2 * Math.PI
      // The radius goes from the core (0.16) out to the edge (1) — spreading
      // out toward the outside thanks to `t ** 0.85`, so the outer turns don't
      // crowd together like the inner ones.
      const radius = 0.16 + 0.84 * t ** 0.85
      points.push(
        [Math.cos(angle) * radius, Math.sin(angle) * radius]
          .map((value) => value.toFixed(3))
          .join(' '),
      )
    }
    arms.push(`M${points[0]} L${points.slice(1).join(' L')}`)
  }
  return arms.join(' ')
})()

/**
 * A six-armed snowflake, drawn in a radius-1 system then scaled with `scale`
 * where used — the same shape at any size.
 *
 * The arms are three crossing diameters, each arm tip with two slanted
 * branches — enough that at 2 units (≈3px in a 380px frame) the eye still
 * reads a snowflake rather than a speck of light.
 */
const SNOWFLAKE = (() => {
  const arms: string[] = []
  const at = (angle: number, radius: number) =>
    [Math.cos(angle) * radius, Math.sin(angle) * radius].map((value) =>
      value.toFixed(3),
    )
  for (let index = 0; index < 3; index++) {
    const angle = (index * Math.PI) / 3
    arms.push(`M${at(angle, -1).join(' ')} L${at(angle, 1).join(' ')}`)
  }
  for (let index = 0; index < 6; index++) {
    const angle = (index * Math.PI) / 3
    const root = at(angle, 0.52).join(' ')
    for (const side of [-1, 1]) {
      const branch = at(angle + (side * Math.PI) / 4, 0.34).join(' ')
      arms.push(`M${root} l${branch}`)
    }
  }
  return arms.join(' ')
})()

/**
 * A snowflake of radius `r`, centered at the origin of its containing group.
 * The stroke is divided by `r` so a large flake doesn't bring a thick stroke
 * with it.
 *
 * Colored by that side's temperature like the air strands, but **mixed half
 * with white**: in exactly the strand color a flake on top of a strand
 * disappears, while pure white would still show blue snow flying through
 * orange airflow at 28°.
 */
function Snowflake({ color, r }: { color: string; r: number }) {
  return (
    <g transform={`scale(${r})`}>
      <path
        className="car-state-fade"
        d={SNOWFLAKE}
        fill="none"
        stroke={`color-mix(in oklab, ${color} 55%, white)`}
        style={{ transition: 'stroke 600ms var(--ease-car-state)' }}
        strokeLinecap="round"
        strokeWidth={0.9 / r}
      />
    </g>
  )
}

/** Airflow reach by fan speed: step 1 just touches the seat edge, step 7 reaches the seatback. */
function airReach(fanSpeed: number): number {
  return 26 + (fanSpeed / FAN_SPEED_RANGE.max) * 44
}

/**
 * Airflow from a dashboard air vent down onto one seat, car-ad style: a few
 * thin air strands weaving in parallel (`strands`), a faint glow hugging them
 * (`glow`) and a few scattered specks of light (`motes`). Color and the
 * fade-out over distance live in the `air-*` gradient.
 *
 * Fan strength reads as **reach** and flare, not as a number of bars: step 1 is
 * two short strands just touching the seat edge — still instantly reading as
 * "a light breeze on the seat", whereas a single bar says nothing. The exact
 * number is already on the climate screen.
 *
 * Always draws all 5 strand slots (extra slots are `opacity: 0`, stacked on the
 * outermost strand) so changing fan step is an interpolation, not a rebuild of
 * the shape.
 */
function airFlow(cx: number, fanSpeed: number) {
  const share = fanSpeed / FAN_SPEED_RANGE.max
  const length = airReach(fanSpeed)
  const end = VENT_Y + length
  const count = 2 + Math.round(share * 3)

  // All strands share the same S shape — offset slightly — so they read as one
  // flowing stream of air rather than a few separate strokes.
  const strand = (x0: number, x1: number, sway: number) => {
    const points = [
      [x0, VENT_Y],
      [x0 + sway, VENT_Y + length * 0.35],
      [x1 - sway, VENT_Y + length * 0.7],
      [x1, end],
    ] as const
    const at = (t: number) =>
      [0, 1].map(
        (axis) =>
          (1 - t) ** 3 * points[0][axis] +
          3 * (1 - t) ** 2 * t * points[1][axis] +
          3 * (1 - t) * t ** 2 * points[2][axis] +
          t ** 3 * points[3][axis],
      )
    const [p0, p1, p2, p3] = points
    return { d: `M${p0} C${p1} ${p2} ${p3}`, at }
  }

  const STRAND_SLOTS = 5
  const strands: { d: string; visible: boolean }[] = []
  const motes: { visible: boolean; x: number; y: number }[] = []
  for (let slot = 0; slot < STRAND_SLOTS; slot++) {
    // Extra slots stack on the outermost visible strand: when the fan speeds
    // up they split off from there instead of appearing out of thin air.
    const index = Math.min(slot, count - 1)
    const offset = index - (count - 1) / 2
    const { d, at } = strand(
      cx + offset * 1.6,
      cx + offset * (4 + share * 2),
      2.5 + (index % 2) * 1.5,
    )
    strands.push({ d, visible: slot < count })
    if (slot % 2 === 0) {
      const [x, y] = at(0.3 + (index % 4) * 0.12)
      motes.push({ visible: slot < count, x, y })
    }
  }
  return { glow: strand(cx, cx, 3).d, motes, strands, width: 7 + share * 9 }
}

export function CarTopView({
  className,
  doors = {},
  frunkOpen = false,
  mirrors = {},
  roofHidden = false,
  sunroof = 0,
  trunkOpen = false,
  turnSignal = 'off',
  windows = {},
  wipers = 'off',
}: {
  /**
   * Size of the car box — only set the height; the width follows the `1/2`
   * ratio of the `viewBox`. Defaults to 330px, fitting the portrait frame.
   */
  className?: string
  doors?: DoorStates
  frunkOpen?: boolean
  mirrors?: MirrorStates
  /**
   * Removes the roof to look straight into the cabin (a "cutaway"): the painted
   * roof, panoramic glass frame, both roof glass panes, rear quarter glass and
   * shark fin all disappear. Not a state of the real car — just a view mode, so
   * the car doesn't "open its roof", it just stops covering: seats, dashboard
   * and steering wheel stay where they were.
   */
  roofHidden?: boolean
  /** Sunroof opening `0..100`, `0` is fully closed. */
  sunroof?: number
  trunkOpen?: boolean
  turnSignal?: TurnSignal
  windows?: WindowPositions
  wipers?: WiperMode
}) {
  const seatHeat = useCarStore((state) => state.seatHeat)
  const fanSpeed = useCarStore((state) => state.fanSpeed)
  const acOn = useCarStore((state) => state.acOn)
  const temperature = useCarStore((state) => state.temperature)
  const frontDefrostOn = useCarStore((state) => state.frontDefrostOn)
  const rearDefrostOn = useCarStore((state) => state.rearDefrostOn)
  const recirculationOn = useCarStore((state) => state.recirculationOn)

  // One set of ids per instance: SVG `<defs>` are global to the document, so if
  // two cars both use `#body` the second picks up the first one's gradient.
  const uid = useId().replace(/:/g, '')
  const id = (name: string) => `${uid}-${name}`
  const url = (name: string) => `url(#${id(name)})`

  const description = describeCarView({
    acOn,
    doors,
    fanSpeed,
    frontDefrostOn,
    frunkOpen,
    rearDefrostOn,
    recirculationOn,
    roofHidden,
    seatHeat,
    sunroof,
    temperature,
    trunkOpen,
    turnSignal,
    windows,
    wipers,
  })

  const signalSides = ([-1, 1] as const).filter((side) =>
    signalsSide(turnSignal, side === -1 ? 'left' : 'right'),
  )
  const blinkStyle = { animationDuration: `${TURN_SIGNAL_PERIOD_MS}ms` }

  // `z-10`: open doors are drawn spilling outside the car frame, over the
  // temperature columns on both sides (`CarStage`). Without raising the layer,
  // the passenger side — after the car in the DOM — would cover the door,
  // while the driver side wouldn't: the two sides would look inconsistent.
  return (
    <div className="relative z-10 flex shrink-0 flex-col items-center">
      {/* Aspect ratio locked to the `viewBox` so the seat buttons overlay the seats exactly by percentage. */}
      <div className={cn('relative aspect-[1/2] h-[330px]', className)}>
        <svg
          aria-label={description}
          className="absolute inset-0 size-full overflow-visible"
          fill="none"
          role="img"
          viewBox="0 0 200 400"
        >
          <defs>
            {/* Silver paint under studio lighting like a car render: the sides
              curve away so they're dark, then the top is moderately and evenly
              bright — not puffed up like a pillow. The shoulder highlight isn't
              in this gradient but is a stroke running along the body edge
              (`shoulder`, drawn after the doors): the gradient only changes
              color along x, so at the four rounded corners its vertical bright
              band cuts across the curve into a sharp point sticking out —
              exactly where the eye looks first. */}
            {/* User space, not the bounding box: a door reusing this gradient
              must get exactly the color band of the body section it replaces,
              rather than squeezing the whole dark-light-dark band into its
              narrow width. */}
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={id('body')}
              x1={100 - BODY_HALF - BODY_FLARE}
              x2={100 + BODY_HALF + BODY_FLARE}
              y1="0"
              y2="0"
            >
              <stop offset="0" stopColor="oklch(0.3 0.012 255)" />
              <stop offset="0.05" stopColor="oklch(0.6 0.01 255)" />
              <stop offset="0.3" stopColor="oklch(0.7 0.009 255)" />
              <stop offset="0.5" stopColor="oklch(0.78 0.008 255)" />
              <stop offset="0.7" stopColor="oklch(0.7 0.009 255)" />
              <stop offset="0.95" stopColor="oklch(0.6 0.01 255)" />
              <stop offset="1" stopColor="oklch(0.3 0.012 255)" />
            </linearGradient>
            {/* Shoulder highlight: paints the stroke running around the body
              edge, so it's never pointed at the corners. Fades toward the nose
              and tail because there the paint surface falls away rather than
              folding into a shoulder. */}
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={id('shoulder')}
              x1="0"
              x2="0"
              y1="26"
              y2="374"
            >
              <stop offset="0" stopColor="white" stopOpacity="0" />
              <stop offset="0.14" stopColor="white" stopOpacity="0.62" />
              <stop offset="0.5" stopColor="white" stopOpacity="0.55" />
              <stop offset="0.86" stopColor="white" stopOpacity="0.45" />
              <stop offset="1" stopColor="white" stopOpacity="0" />
            </linearGradient>
            {/* Studio light shining from above: the nose is brighter than the
              tail. */}
            {/* Also in user space, so the hatch lids can reuse it and get
              exactly the light/dark section of where they sit on the body. */}
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={id('sheen')}
              x1="0"
              x2="0"
              y1="26"
              y2="374"
            >
              <stop offset="0" stopColor="white" stopOpacity="0.22" />
              <stop offset="0.45" stopColor="white" stopOpacity="0" />
              <stop offset="1" stopColor="black" stopOpacity="0.28" />
            </linearGradient>
            {/* Mirror paint: the mirror sticks out past the body edge, so using
              `body` would land it in the dark band by the edge, completely
              detached from the bright body. Its own bounding-box gradient
              rotates with it when the mirror folds: bright top, dark edges. */}
            <linearGradient id={id('mirror')} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="oklch(0.56 0.01 255)" />
              <stop offset="0.3" stopColor="oklch(0.82 0.006 255)" />
              <stop offset="0.7" stopColor="oklch(0.74 0.008 255)" />
              <stop offset="1" stopColor="oklch(0.5 0.01 255)" />
            </linearGradient>
            {/* Glass nearly black, cool-toned — bright blue is toy glass. */}
            <linearGradient id={id('glass')} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="oklch(0.24 0.02 245)" />
              <stop offset="1" stopColor="oklch(0.1 0.012 255)" />
            </linearGradient>
            {/* Diagonal reflection streak on the panoramic glass. */}
            <linearGradient id={id('glare')} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0.28" stopColor="white" stopOpacity="0" />
              <stop offset="0.4" stopColor="white" stopOpacity="0.12" />
              <stop offset="0.5" stopColor="white" stopOpacity="0" />
            </linearGradient>
            {/* The windshield/rear window are raked so they reflect the sky:
              bright at the low edge (glass base), darkening toward the roof.
              `y1`/`y2` are swapped for the rear window. */}
            <linearGradient id={id('sky-front')} x1="0" x2="0" y1="0" y2="1">
              <stop
                offset="0"
                stopColor="oklch(0.9 0.02 235)"
                stopOpacity="0.2"
              />
              <stop
                offset="0.55"
                stopColor="oklch(0.9 0.02 235)"
                stopOpacity="0"
              />
            </linearGradient>
            <linearGradient id={id('sky-rear')} x1="0" x2="0" y1="1" y2="0">
              <stop
                offset="0"
                stopColor="oklch(0.9 0.02 235)"
                stopOpacity="0.16"
              />
              <stop
                offset="0.6"
                stopColor="oklch(0.9 0.02 235)"
                stopOpacity="0"
              />
            </linearGradient>
            <clipPath id={id('body-clip')}>
              <path d={BODY} />
            </clipPath>
            <filter
              height="140%"
              id={id('soft')}
              width="140%"
              x="-20%"
              y="-20%"
            >
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
            <filter
              height="130%"
              id={id('contact')}
              width="140%"
              x="-20%"
              y="-15%"
            >
              <feGaussianBlur stdDeviation="3" />
            </filter>
            {ZONES.map((zone) => (
              <radialGradient
                cx="0.5"
                cy="0.5"
                id={id(`cabin-${zone}`)}
                key={zone}
                r="0.6"
              >
                <stop
                  offset="0"
                  stopColor={airColor(temperature[zone], acOn)}
                  stopOpacity="0.45"
                  className="car-state-fade"
                  style={{
                    transition: 'stop-color 600ms var(--ease-car-state)',
                  }}
                />
                <stop
                  offset="1"
                  stopColor={airColor(temperature[zone], acOn)}
                  stopOpacity="0"
                  className="car-state-fade"
                  style={{
                    transition: 'stop-color 600ms var(--ease-car-state)',
                  }}
                />
              </radialGradient>
            ))}
            {/* airflow only below the vent edge: at high fan the ~16-thick glow
                with its round, blurred head would poke up onto the dashboard
                as a detached column */}
            <clipPath id={id('air')}>
              <rect height="120" width="200" x="0" y={VENT_Y} />
            </clipPath>
            {/* airflow: fades in out of the vent slot over the first ~9 units
                — fully opaque right at the edge would make the strand ends
                look chopped flat — then fades out toward the end of its
                reach */}
            {ZONES.map((zone) => {
              const color = airColor(temperature[zone], acOn)
              const emerge = Math.min(0.3, 9 / airReach(fanSpeed))
              return (
                <linearGradient
                  gradientUnits="userSpaceOnUse"
                  id={id(`air-${zone}`)}
                  key={zone}
                  x1="0"
                  x2="0"
                  y1={VENT_Y}
                  y2={VENT_Y + airReach(fanSpeed)}
                >
                  <stop
                    offset="0"
                    stopColor={color}
                    stopOpacity="0"
                    className="car-state-fade"
                    style={{
                      transition: 'stop-color 600ms var(--ease-car-state)',
                    }}
                  />
                  <stop
                    offset={emerge * 0.45}
                    stopColor={color}
                    stopOpacity="0.4"
                    className="car-state-fade"
                    style={{
                      transition: 'stop-color 600ms var(--ease-car-state)',
                    }}
                  />
                  <stop
                    offset={emerge}
                    stopColor={color}
                    stopOpacity="0.95"
                    className="car-state-fade"
                    style={{
                      transition: 'stop-color 600ms var(--ease-car-state)',
                    }}
                  />
                  <stop
                    offset="0.7"
                    stopColor={color}
                    stopOpacity="0.45"
                    className="car-state-fade"
                    style={{
                      transition: 'stop-color 600ms var(--ease-car-state)',
                    }}
                  />
                  <stop
                    offset="1"
                    stopColor={color}
                    stopOpacity="0"
                    className="car-state-fade"
                    style={{
                      transition: 'stop-color 600ms var(--ease-car-state)',
                    }}
                  />
                </linearGradient>
              )
            })}
            {/* shape of the haze collecting just below the row of air vents
                while the A/C runs — dense by the dashboard edge, fully faded
                before reaching the seats so it doesn't compete with the
                airflow. White because it's only used as a mask; the color is
                in `ac-tint`. */}
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={id('ac-haze')}
              x1="0"
              x2="0"
              y1={VENT_Y - 8}
              y2={VENT_Y + 25}
            >
              <stop offset="0" stopColor="white" stopOpacity="0.55" />
              <stop offset="0.45" stopColor="white" stopOpacity="0.22" />
              <stop offset="1" stopColor="white" stopOpacity="0" />
            </linearGradient>
            <radialGradient
              cx={REAR_VENT.cx}
              cy={REAR_VENT.cy}
              gradientUnits="userSpaceOnUse"
              id={id('ac-haze-rear')}
              r={REAR_VENT.r}
            >
              <stop offset="0" stopColor="white" stopOpacity="0.5" />
              <stop offset="0.4" stopColor="white" stopOpacity="0.2" />
              <stop offset="1" stopColor="white" stopOpacity="0" />
            </radialGradient>
            {/* Haze color by each side's temperature: the left half follows the
                driver seat, the right half the passenger seat, blending around
                the center console. The two white gradients above only hold the
                haze's **shape** (used as a mask); the color lives here — so
                the dashboard and the rear row always match the numbers on
                both sides. Uses `temperatureColor` rather than `airColor`: the
                whole group only shows while the A/C is on, and while fading
                out after turning off the color must not jump to white. */}
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={id('ac-tint')}
              x1="60"
              x2="140"
              y1="0"
              y2="0"
            >
              {ZONES.map((zone) => (
                <stop
                  className="car-state-fade"
                  key={zone}
                  offset={zone === 'driver' ? 0.3 : 0.7}
                  stopColor={temperatureColor(temperature[zone])}
                  style={{
                    transition: 'stop-color 600ms var(--ease-car-state)',
                  }}
                />
              ))}
            </linearGradient>
            <mask
              height="200"
              id={id('ac-haze-mask')}
              maskUnits="userSpaceOnUse"
              width="200"
              x="0"
              y="100"
            >
              {/* Slightly blur the whole shape: haze with a crisp edge is paint, not haze. */}
              <path d={AC_HAZE} fill={url('ac-haze')} filter={url('soft')} />
              <rect
                fill={url('ac-haze-rear')}
                filter={url('soft')}
                height={REAR_VENT.r * 2}
                width={REAR_VENT.r * 2}
                x={REAR_VENT.cx - REAR_VENT.r}
                y={REAR_VENT.cy - REAR_VENT.r}
              />
            </mask>
            {/* recirculation swirl: dense at the core, fully faded at the arm
                tips — the swirl arms have no ends, they just thin out into the
                cabin. Bounding-box coordinates so the gradient rotates with the
                shape without going off-center. */}
            <radialGradient id={id('swirl')}>
              <stop
                offset="0"
                stopColor="oklch(0.93 0.02 240)"
                stopOpacity="0.95"
              />
              <stop
                offset="0.6"
                stopColor="oklch(0.93 0.02 240)"
                stopOpacity="0.72"
              />
              <stop
                offset="1"
                stopColor="oklch(0.93 0.02 240)"
                stopOpacity="0"
              />
            </radialGradient>
            {/* faint glow under the swirl: separates it from the dark floor,
                the same way the seat heating glow separates the heat mark from
                the seat */}
            <radialGradient id={id('swirl-core')}>
              <stop
                offset="0"
                stopColor="oklch(0.93 0.02 240)"
                stopOpacity="0.2"
              />
              <stop
                offset="1"
                stopColor="oklch(0.93 0.02 240)"
                stopOpacity="0"
              />
            </radialGradient>
            {/* front defrost: dense at the glass base (defrost vents), fading toward the roof */}
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={id('defrost-front')}
              x1="0"
              x2="0"
              y1="106"
              y2="161"
            >
              <stop
                offset="0"
                stopColor="var(--color-car-heat)"
                stopOpacity="0.42"
              />
              <stop
                offset="1"
                stopColor="var(--color-car-heat)"
                stopOpacity="0"
              />
            </linearGradient>
            <linearGradient
              gradientUnits="userSpaceOnUse"
              id={id('defrost-strand')}
              x1="0"
              x2="0"
              y1="107"
              y2="158"
            >
              <stop
                offset="0"
                stopColor="oklch(0.93 0.06 70)"
                stopOpacity="0"
              />
              <stop
                offset="0.18"
                stopColor="oklch(0.93 0.06 70)"
                stopOpacity="0.9"
              />
              <stop
                offset="0.65"
                stopColor="oklch(0.93 0.06 70)"
                stopOpacity="0.45"
              />
              <stop
                offset="1"
                stopColor="oklch(0.93 0.06 70)"
                stopOpacity="0"
              />
            </linearGradient>
            {/* Black seat leather: the cushion is puffed so it's brightest
                along the center ridge, darkening quickly toward the edges where
                the leather rolls down. Bounding-box based, so every seat piece
                — cushion, back, headrest — catches light across exactly its
                own width, without a gradient per piece.

                Black leather on a black floor: the seats only stand out from
                the floor by being one step brighter and by their shadows, so
                this band must stay bright enough in the middle — pushing it
                darker to be "truly black" makes the seats melt into the
                floor. */}
            <linearGradient id={id('leather')} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="oklch(0.23 0.006 265)" />
              <stop offset="0.16" stopColor="oklch(0.34 0.008 265)" />
              <stop offset="0.5" stopColor="oklch(0.39 0.008 265)" />
              <stop offset="0.84" stopColor="oklch(0.34 0.008 265)" />
              <stop offset="1" stopColor="oklch(0.23 0.006 265)" />
            </linearGradient>
            {/* The center panel is recessed between the two bolsters, so it's darker than the seat surface. */}
            <linearGradient
              id={id('leather-panel')}
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop offset="0" stopColor="oklch(0.3 0.007 265)" />
              <stop offset="1" stopColor="oklch(0.25 0.006 265)" />
            </linearGradient>
            {/* Black plastic of the center console: the rounded top edge catches the overhead light. */}
            <linearGradient id={id('console')} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="oklch(0.14 0.006 255)" />
              <stop offset="0.35" stopColor="oklch(0.27 0.008 255)" />
              <stop offset="0.65" stopColor="oklch(0.24 0.008 255)" />
              <stop offset="1" stopColor="oklch(0.14 0.006 255)" />
            </linearGradient>
            <radialGradient id={id('heat')} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="var(--color-car-heat)" />
              <stop
                offset="1"
                stopColor="var(--color-car-heat)"
                stopOpacity="0"
              />
            </radialGradient>
            <filter
              height="200%"
              id={id('glow')}
              width="200%"
              x="-50%"
              y="-50%"
            >
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
            <filter
              height="160%"
              id={id('shadow')}
              width="160%"
              x="-30%"
              y="-30%"
            >
              <feGaussianBlur stdDeviation="9" />
            </filter>
            <filter
              height="200%"
              id={id('door-shadow')}
              width="300%"
              x="-100%"
              y="-50%"
            >
              <feGaussianBlur stdDeviation="2.5" />
            </filter>
            <filter
              height="160%"
              id={id('hatch-shade')}
              width="160%"
              x="-30%"
              y="-30%"
            >
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <filter
              height="160%"
              id={id('sunroof-shadow')}
              width="140%"
              x="-20%"
              y="-30%"
            >
              <feGaussianBlur stdDeviation="2" />
            </filter>
            {/* Sunlight coming through the sunroof opening: warm white, fading toward the edges. */}
            <radialGradient id={id('sun')} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="oklch(0.98 0.04 90)" />
              <stop
                offset="1"
                stopColor="oklch(0.98 0.04 90)"
                stopOpacity="0"
              />
            </radialGradient>
            {/* The front edge follows the windshield base and both glass edges
                exactly (up to where they meet x 50/150): the cabin floor only
                shows through the glass, never poking up onto the hood. */}
            <clipPath id={id('cabin')}>
              <path d="M42 120 C68 102 132 102 158 120 C156.5 135.9 152.5 150.1 150 161 V300 H50 V161 C47.5 150.1 43.5 135.9 42 120 Z" />
            </clipPath>
            <clipPath id={id('windshield')}>
              <path d={WINDSHIELD} />
            </clipPath>
            {/* The roof and glass frame cut out both glass panes — the sliding
                panel fills the front opening, the fixed pane fills the rear
                one. */}
            <mask id={id('roof')}>
              <path d={ROOF} fill="white" />
              <rect fill="black" {...SUNROOF} />
              <rect fill="black" {...REAR_PANE} />
            </mask>
            <clipPath id={id('sunroof-opening')}>
              <rect {...SUNROOF} />
            </clipPath>
            {/* Both roof glass panes. Anything inside the cabin that's drawn
                **above** the roof layer must be clipped to this, otherwise it
                climbs onto the painted crossbar between the two seat rows
                (y 234–237.5) — instantly reading as a sticker on the roof
                rather than something happening in the cabin. */}
            <clipPath id={id('glass-roof')}>
              <rect {...SUNROOF} />
              <rect {...REAR_PANE} />
            </clipPath>
            {/* The roof curves down at both side edges: darkening toward the side windows. */}
            <linearGradient id={id('roof-edge')} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="black" stopOpacity="0.32" />
              <stop offset="0.1" stopColor="black" stopOpacity="0" />
              <stop offset="0.9" stopColor="black" stopOpacity="0" />
              <stop offset="1" stopColor="black" stopOpacity="0.32" />
            </linearGradient>
            {/* Black plastic wheel-arch cladding, only around the wheels. */}
            <clipPath id={id('arches')}>
              {WHEEL_Y.map((y) => (
                <rect
                  height={WHEEL.height + 6}
                  key={y}
                  width="200"
                  x="0"
                  y={y - 3}
                />
              ))}
            </clipPath>
            {/* Tire surface: dark shoulders, the center tread band catching a
              little light — symmetric so both sides' wheels can share it. Kept
              dark and low-contrast: the wheels are just a backdrop for the
              body; any brighter and they compete with the state for the eye. */}
            <linearGradient id={id('tire')} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="oklch(0.13 0.005 255)" />
              <stop offset="0.22" stopColor="oklch(0.2 0.006 255)" />
              <stop offset="0.5" stopColor="oklch(0.17 0.006 255)" />
              <stop offset="0.78" stopColor="oklch(0.2 0.006 255)" />
              <stop offset="1" stopColor="oklch(0.13 0.005 255)" />
            </linearGradient>
            {/* Both ends of the tire curve down out of the light. */}
            <linearGradient id={id('tire-round')} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="black" stopOpacity="0.7" />
              <stop offset="0.24" stopColor="black" stopOpacity="0" />
              <stop offset="0.76" stopColor="black" stopOpacity="0" />
              <stop offset="1" stopColor="black" stopOpacity="0.7" />
            </linearGradient>
            <radialGradient id={id('signal-glow')} cx="0.5" cy="0.5" r="0.5">
              <stop
                offset="0"
                stopColor="var(--color-car-signal)"
                stopOpacity="0.75"
              />
              <stop
                offset="1"
                stopColor="var(--color-car-signal)"
                stopOpacity="0"
              />
            </radialGradient>
          </defs>

          {/* shadow on the ground */}
          <ellipse
            cx="100"
            cy="206"
            fill="black"
            filter={url('shadow')}
            opacity="0.7"
            rx="80"
            ry="190"
          />
          {/* contact shadow: dense, tight to the body edge — without it the car looks like it's floating */}
          <path
            d={BODY}
            fill="black"
            filter={url('contact')}
            opacity="0.8"
            stroke="black"
            strokeWidth="5"
          />
          {/* where the tires press on the ground is much darker */}
          {WHEEL_Y.map((y) =>
            [-1, 1].map((side) => (
              <ellipse
                cx={100 + side * (100 - WHEEL_X - WHEEL.width / 2)}
                cy={y + WHEEL.height / 2}
                fill="black"
                filter={url('contact')}
                key={`${side}-${y}`}
                rx={WHEEL.width / 2 + 3}
                ry={WHEEL.height / 2 + 2}
              />
            )),
          )}

          {/* Turn signal glow cast onto the ground, under the body so it only
              spills out around the car's corners. `key` follows the mode so
              everything that blinks — here, on the lights and on the button —
              restarts the same cycle together when the mode changes, without
              drifting out of phase. */}
          <g key={`glow-${turnSignal}`}>
            {signalSides.map((side) =>
              SIGNAL_LAMPS.map(({ glow: [x, y] }) => (
                <ellipse
                  className="car-blink"
                  cx={side === -1 ? x : 200 - x}
                  cy={y}
                  fill={url('signal-glow')}
                  key={`${side}-${y}`}
                  rx="30"
                  ry="26"
                  style={blinkStyle}
                />
              )),
            )}
          </g>

          {/* wheels — drawn before the body so the body hides their inner part */}
          {WHEEL_Y.map((y) =>
            [WHEEL_X, 200 - WHEEL_X - WHEEL.width].map((x) => (
              <g key={`${x}-${y}`}>
                <rect fill={url('tire')} x={x} y={y} {...WHEEL} />
                <path
                  d={TREAD.map(
                    (dy) => `M${x + 1.4} ${y + dy} h${WHEEL.width - 2.8}`,
                  ).join(' ')}
                  stroke="oklch(0.1 0.005 255)"
                  strokeOpacity="0.6"
                  strokeWidth="0.8"
                />
                <rect
                  fill={url('tire-round')}
                  stroke="oklch(0.09 0.005 255)"
                  strokeWidth="0.8"
                  x={x}
                  y={y}
                  {...WHEEL}
                />
              </g>
            )),
          )}

          {/* body */}
          {/* No black outline: the body edge reads through the paint's dark
              band at the sides, the soft shadow by the edge and the thin
              bright rim line (drawn after the doors, see below). */}
          <path d={BODY} fill={url('body')} />
          <path d={BODY} fill={url('sheen')} />
          {/* black plastic wheel-arch cladding — a dark band hugging the fender edge around the wheels */}
          <g clipPath={url('arches')}>
            <g clipPath={url('body-clip')}>
              <path d={BODY} stroke="oklch(0.16 0.006 255)" strokeWidth="3.4" />
            </g>
          </g>
          {/* hood (frunk) — hinged at the edge by the windshield */}
          <Hatch
            body={url('body')}
            clipId={id('frunk')}
            open={frunkOpen}
            shade={url('hatch-shade')}
            shape={FRUNK}
            sheen={url('sheen')}
          />

          {/* cabin floor: temperature glow on each side */}
          <g clipPath={url('cabin')}>
            <rect
              fill="oklch(0.11 0.008 265)"
              height="216"
              width="100"
              x="50"
              y="88"
            />
            {ZONES.map((zone) => (
              <rect
                fill={url(`cabin-${zone}`)}
                height="216"
                key={zone}
                width="80"
                x={zone === 'driver' ? 40 : 80}
                y="88"
              />
            ))}

            {/* Door trims on both sides, one plain panel: just so the cabin
                has two side walls instead of seats floating against the glass
                edge. No floor carpet — a dark panel covering the floor would
                swallow each side's temperature glow. */}
            {([-1, 1] as const).map((side) => (
              <rect
                fill="oklch(0.18 0.008 265)"
                height="138"
                key={side}
                width="7"
                x={side === -1 ? 50 : 143}
                y="161"
              />
            ))}

            {/* The dashboard covers everything from the windshield base (top
                edge hidden under the cowl) to its bottom edge at VENT_Y — seen
                through the glass it's one continuous panel, no floor showing. */}
            <path
              d="M38 116 C66 96 134 96 162 116 C158 132.6 153 145 150 155 C120 149 80 149 50 155 C47 145 42 132.6 38 116 Z"
              fill="oklch(0.36 0.008 255)"
            />
            {/* leather strip across the dashboard edge, one step brighter than
                the plastic — seen through the windshield it's what separates
                the dashboard from the floor */}
            <path
              d={DASH_EDGE}
              fill="none"
              stroke="oklch(0.3 0.008 265)"
              strokeWidth="1.8"
            />
            {/* Compressor running: the vent edge is covered in haze, cool air
                spilling into the cabin. Drawn even when the fan is off —
                turning on the A/C turns on the compressor, not the fan, so the
                A/C button must still read on the car at fan 0. Sits below the
                steering wheel and seats: the haze is something inside the
                cabin, not an overlay on the interior. The rear row has its own
                glow at `REAR_VENT`. */}
            <g
              className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
              opacity={acOn ? 1 : 0}
              pointerEvents="none"
            >
              <rect
                fill={url('ac-tint')}
                height="200"
                mask={url('ac-haze-mask')}
                width="200"
                x="0"
                y="100"
              />
              <path
                d={DASH_EDGE}
                fill="none"
                filter={url('glow')}
                stroke={url('ac-tint')}
                strokeLinecap="round"
                strokeOpacity="0.8"
                strokeWidth="1.6"
              />
            </g>
            {/* Center console between the two front seats. Starts behind the
                windshield's top edge rather than at the foot of the dashboard:
                from above it sits right under the rearview mirror, and the two
                would merge into one T-shaped block. */}
            <Console leather={url('leather')} paint={url('console')} />
            {/* The center screen stands on the dashboard, facing the cabin:
                from above you only see its top edge and the light it casts
                down behind it. */}
            <ellipse
              cx="100"
              cy="149.5"
              fill="oklch(0.6 0.08 230)"
              opacity="0.22"
              rx="11"
              ry="2.2"
            />
            <rect
              fill="oklch(0.09 0.005 255)"
              height="2"
              rx="1"
              width="24"
              x="88"
              y="145"
            />
            <path
              d="M89 145.3 H111"
              stroke="oklch(0.5 0.01 255)"
              strokeLinecap="round"
              strokeWidth="0.4"
            />
            {/* steering wheel: column, rim, three spokes, hub — tilted toward
                the driver so from above it's a flat oval, sitting entirely
                within the windshield */}
            <g strokeLinecap="round">
              <path
                d="M76 148 V152"
                stroke="oklch(0.26 0.01 255)"
                strokeWidth="3"
              />
              <ellipse
                cx="76"
                cy="153.5"
                fill="oklch(0.12 0.01 255 / 0.4)"
                rx="10.5"
                ry="4.4"
                stroke="oklch(0.42 0.01 255)"
                strokeWidth="1.8"
              />
              <path
                d="M66.2 154 H71.5 M80.5 154 H85.8 M76 156 V157.6"
                stroke="oklch(0.32 0.01 255)"
                strokeWidth="1.2"
              />
              <ellipse
                cx="76"
                cy="154"
                fill="oklch(0.28 0.01 255)"
                rx="3.4"
                ry="2"
              />
            </g>
            {/* interior rearview mirror + ADAS camera housing hanging from the windshield's top edge */}
            <path
              d="M95.5 157 L97 152.5 H103 L104.5 157 Z"
              fill="oklch(0.15 0.006 255)"
            />
            <rect
              fill="oklch(0.2 0.008 255)"
              height="3.2"
              rx="1.5"
              width="20"
              x="90"
              y="150.4"
            />
            <path
              d="M91.2 153.3 H108.8"
              stroke="oklch(0.55 0.02 240)"
              strokeLinecap="round"
              strokeWidth="0.5"
            />

            {/* front seats — black leather */}
            {ZONES.map((zone) => (
              <FrontSeat
                cx={SEAT_CX[zone]}
                key={zone}
                leather={url('leather')}
                panel={url('leather-panel')}
                shadow={url('soft')}
              />
            ))}
            <RearBench
              leather={url('leather')}
              panel={url('leather-panel')}
              shadow={url('soft')}
            />
          </g>

          {/* airflow from the dashboard air vents down onto each seat, colored
              by that side's temperature — the air blows inside the cabin, so
              it sits below the roof and panoramic glass: with the sunroof open
              the frame edge covers it rather than being covered by it. Also below the seat heating layer so the heat marks aren't hidden by the airflow. */}
          {ZONES.map((zone) => {
            const { glow, motes, strands, width } = airFlow(
              SEAT_CX[zone],
              fanSpeed,
            )
            const stroke = url(`air-${zone}`)
            return (
              <g
                className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
                clipPath={url('air')}
                key={zone}
                opacity={fanSpeed > 0 ? 1 : 0}
                stroke={stroke}
                strokeLinecap="round"
              >
                <path
                  className="transition-[d,stroke-width] duration-600 ease-(--ease-car-state)"
                  filter={url('glow')}
                  opacity="0.4"
                  strokeWidth={width}
                  {...morph(glow)}
                />
                {strands.map(({ d, visible }, index) => (
                  <path
                    className="transition-[d,opacity] duration-600 ease-(--ease-car-state)"
                    key={index}
                    opacity={visible ? 1 : 0}
                    strokeWidth="1.1"
                    {...morph(d)}
                  />
                ))}
                {/* Specks scattered in the airflow. When the compressor runs,
                    those very specks **become snowflakes** — same place, same
                    count, only the shape changes: an in-place crossfade, not
                    another layer of particles flying in. Both shapes stay
                    mounted so switching is smooth, and both stand still: the
                    strands already tell the "blowing" story, and moving the
                    flakes too would turn the airflow into noise. */}
                {motes.map(({ visible, x, y }, index) => (
                  <g
                    className="transition-[transform,opacity] duration-600 ease-(--ease-car-state)"
                    key={index}
                    opacity={visible ? 1 : 0}
                    stroke="none"
                    style={{ transform: `translate(${x}px, ${y}px)` }}
                  >
                    <circle
                      className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
                      cx="0"
                      cy="0"
                      fill="oklch(0.97 0.02 230)"
                      opacity={acOn ? 0 : 1}
                      r="0.9"
                    />
                    <g
                      className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
                      opacity={acOn ? 1 : 0}
                    >
                      {/* Three flakes, three sizes: a perfectly uniform row of
                          particles looks like a pattern, not something drifting
                          in the air. */}
                      <Snowflake
                        color={temperatureColor(temperature[zone])}
                        r={[2.2, 1.7, 2][index % 3]}
                      />
                    </g>
                  </g>
                ))}
              </g>
            )
          })}

          {/* The roof and everything on it (except the sunroof, see below).
              Hiding the roof peels a layer away rather than swapping the
              image: both layers stay mounted and crossfade so the eye sees
              what was just removed. */}
          {/* A thin dashed line remains exactly at the roof edge — the eye
              still reads a cutaway car, not a cabin floating in the middle of
              the body. */}
          <path
            className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
            d={ROOF}
            opacity={roofHidden ? 1 : 0}
            stroke="oklch(0.92 0.005 255)"
            strokeDasharray="4 4"
            strokeOpacity="0.22"
            strokeWidth="0.8"
          />
          <g
            className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
            opacity={roofHidden ? 0 : 1}
          >
            {/* painted roof + black-framed panoramic glass, with both panes cut out */}
            <g mask={url('roof')}>
              <path d={ROOF} fill={url('body')} />
              <path d={ROOF} fill={url('sheen')} />
              <rect
                fill={url('roof-edge')}
                height="172"
                width="98"
                x="51"
                y="156"
              />
              <rect fill="oklch(0.11 0.006 255)" {...PANORAMA} />
            </g>
            <path
              d={SHARK_FIN}
              fill={url('mirror')}
              stroke="oklch(0.25 0.01 255)"
              strokeOpacity="0.6"
              strokeWidth="0.5"
            />
            {/* fixed rear quarter glass */}
            {([-1, 1] as const).map((side) => (
              <path
                d={QUARTER_GLASS}
                fill="oklch(0.24 0.02 245)"
                key={side}
                stroke="oklch(0.62 0.02 240)"
                strokeOpacity="0.2"
                strokeWidth="0.5"
                transform={side === 1 ? 'matrix(-1 0 0 1 200 0)' : undefined}
              />
            ))}
            {/* rear glass pane — fixed, tinted, lets you see through to the rear bench */}
            <rect fill={url('glass')} opacity="0.42" {...REAR_PANE} />
            <rect fill={url('glare')} {...REAR_PANE} />
            <rect
              fill="none"
              stroke="oklch(0.7 0.03 240)"
              strokeOpacity="0.18"
              strokeWidth="0.8"
              {...REAR_PANE}
            />
          </g>

          {/* Recirculation: an air swirl spinning between the two seat rows,
              with two rings of air around it — a mass of air churning inside
              the cabin instead of escaping outside. Sits **above** the fixed
              glass layer: under the glass, the tint would swallow these thin
              strokes. But **below** the sunroof — when opened, the panel
              slides back to cover exactly the gap between the two rows, and
              the swirl is air inside the cabin, so it must sink beneath that
              panel rather than float on top. In exchange it has to be clipped
              to the two roof glass panes —
              the outer ring spans y 223–257, straddling exactly the painted
              crossbar between the two seat rows. With the roof hidden there
              are no panes left to clip to, so it's clipped to the cabin, the
              same boundary as the seat heating.

              The positioning (`transform`) always lives on the *parent*
              element, the animation on the child: the animation's CSS
              `transform` overrides the `transform` attribute, so putting both
              on one element flings the shape off the car. */}
          <g
            className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
            clipPath={url(roofHidden ? 'cabin' : 'glass-roof')}
            opacity={recirculationOn ? 1 : 0}
          >
            {SWIRL_RINGS.map(({ count, duty, ms, opacity, r, reverse }) => (
              <circle
                className="car-swirl"
                cx={RECIRC_SWIRL_AT.x}
                cy={RECIRC_SWIRL_AT.y}
                fill="none"
                key={r}
                pathLength="1"
                r={r}
                stroke="oklch(0.93 0.02 240)"
                strokeDasharray={ringDash(count, duty)}
                strokeLinecap="round"
                strokeOpacity={opacity}
                strokeWidth="0.9"
                style={{
                  animationDirection: reverse ? 'reverse' : undefined,
                  animationDuration: `${ms}ms`,
                }}
              />
            ))}
            <g
              transform={`translate(${RECIRC_SWIRL_AT.x} ${RECIRC_SWIRL_AT.y})`}
            >
              <circle
                fill={url('swirl-core')}
                r={RECIRC_SWIRL_AT.r * 1.5}
                stroke="none"
              />
              <g className="car-swirl">
                <path
                  d={SWIRL}
                  fill="none"
                  stroke={url('swirl')}
                  strokeLinecap="round"
                  strokeWidth={1.1 / RECIRC_SWIRL_AT.r}
                  transform={`scale(${RECIRC_SWIRL_AT.r})`}
                />
              </g>
            </g>
          </g>

          {/* The sunroof is drawn even with the roof hidden — it's a
              controllable part; dropping it entirely would mean pressing the
              switch and seeing nothing. But once closed it fades away
              completely: with no roof, the closed panel is just a tinted patch
              over the front seats, exactly what hiding the roof wants to get
              rid of.

              When closing, **watch the whole closing sequence first**, then
              fade: wait exactly `SUNROOF_CLOSE_MS` (the glass slides back into
              place, then lowers) before starting to fade, otherwise the glass
              evaporates mid-slide.

              When hiding the roof, though, the glass was already closed
              beforehand and must disappear right away along with the roof —
              waiting here would leave a patch of glass floating over the
              cabin. `key` changes with the view mode so the `<g>` is
              rebuilt: the first `opacity` value of a new node runs no
              transition and applies immediately, so there's no need to
              remember the previous state to skip the delay. */}
          <g
            className="car-state-fade transition-opacity duration-650 ease-(--ease-car-state)"
            key={roofHidden ? 'cut' : 'roofed'}
            opacity={roofHidden && sunroof === 0 ? 0 : 1}
            style={{
              transitionDelay:
                roofHidden && sunroof === 0 ? `${SUNROOF_CLOSE_MS}ms` : '0ms',
            }}
          >
            <Sunroof
              glare={url('glare')}
              glass={url('glass')}
              open={sunroof}
              shadow={url('sunroof-shadow')}
              sun={url('sun')}
            />
          </g>

          {/* windshield */}
          <path
            d={WINDSHIELD}
            fill={url('glass')}
            fillOpacity="0.32"
            stroke="oklch(0.12 0.008 255)"
            strokeWidth="0.8"
          />
          <path d={WINDSHIELD} fill={url('sky-front')} />
          <path d={WINDSHIELD} fill={url('glare')} />

          {/* front defrost: a glow spreading up from the glass base + air
              strands blowing up toward the roof, clipped to the glass; the
              strands emerge from under the cowl strip, exactly where the
              defrost vents are */}
          <g
            className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
            clipPath={url('windshield')}
            opacity={frontDefrostOn ? 1 : 0}
          >
            <path d={WINDSHIELD} fill={url('defrost-front')} />
            <g
              stroke={url('defrost-strand')}
              strokeLinecap="round"
              strokeWidth="1"
            >
              {DEFROST_STRANDS.map((d) => (
                <path d={d} key={d} />
              ))}
            </g>
          </g>

          {/* black cowl strip at the glass base + black ceramic frit around
              the glass edge, thickest at the roof edge — above the defrost
              air: the defrost only spreads over the clear part of the glass */}
          <g
            clipPath={url('windshield')}
            fill="none"
            stroke="oklch(0.1 0.006 255)"
          >
            <path
              d={WINDSHIELD_COWL}
              fill="oklch(0.1 0.006 255)"
              stroke="none"
            />
            <path d={WINDSHIELD} strokeWidth="5" />
            <path d={WINDSHIELD_ROOF_EDGE} strokeWidth="10" />
          </g>

          {/* wipers — above the defrost air: the blades sit outside the glass */}
          <Wipers clip={url('windshield')} mode={wipers} />

          {/* four doors, each carrying its own window */}
          {DOORS.map((door) => {
            const { mirror, ...geometry } = DOOR_GEOMETRY[door]
            return (
              <Door
                body={url('body')}
                clipId={id(`door-${door}`)}
                shadow={url('door-shadow')}
                key={door}
                mirrorPaint={url('mirror')}
                {...geometry}
                mirrorFolded={mirror && (mirrors[mirror] ?? false)}
                open={doors[door] ?? false}
                windowOpen={windows[door] ?? 0}
              />
            )
          })}

          {/* Body edge: the shoulder highlight, a soft shadow hugging the
              inside (the paint curving away out of the light) and a thin
              bright rim separating the car from the dark background. Drawn
              after the doors so it runs continuously over both the doors and
              the body — the doors use the same gradient, so no seam shows.

              Both strokes are the `BODY` outline clipped to the body itself:
              the outer half of the stroke is cut away, leaving a band tucked
              inside the edge, running around the car's shape. The highlight
              is wider, so it reaches further in than the shadow on top of it
              — the part that peeks out is the shoulder. */}
          <g clipPath={url('body-clip')} pointerEvents="none">
            <path d={BODY} stroke={url('shoulder')} strokeWidth="7" />
            <path
              d={BODY}
              filter={url('soft')}
              stroke="black"
              strokeOpacity="0.55"
              strokeWidth="3.2"
            />
          </g>
          <path
            d={BODY}
            stroke="oklch(0.92 0.005 255)"
            strokeOpacity="0.22"
            strokeWidth="0.6"
          />

          {/* seat heating — an amber glow + as many heat marks as levels.
              Clipped to the front glass pane: the seats are only visible
              through the glass, and a glow spilling over would bleed onto the
              painted roof. With the roof hidden there's no pane left to clip
              to — clip to the cabin, the same boundary as the seat it's
              heating. */}
          {ZONES.map((zone) => {
            const level = seatHeat[zone]
            const cx = SEAT_CX[zone]
            return (
              <g
                clipPath={url(roofHidden ? 'cabin' : 'sunroof-opening')}
                key={zone}
              >
                <ellipse
                  className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
                  cx={cx}
                  cy="204"
                  fill={url('heat')}
                  opacity={[0, 0.5, 0.7, 0.95][level]}
                  rx="26"
                  ry="32"
                />
                {Array.from({ length: SEAT_HEAT_RANGE.max }, (_, index) => (
                  <path
                    className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
                    d={`M${cx - 8 + index * 8} 206 c-2 -3 2 -6 0 -9 c-2 -3 2 -6 0 -9`}
                    key={index}
                    opacity={index < level ? 1 : 0}
                    stroke="oklch(0.97 0.05 75)"
                    strokeLinecap="round"
                    strokeWidth="1.6"
                    style={{ transitionDelay: `${index * 120}ms` }}
                  />
                ))}
              </g>
            )
          })}

          {/* LED headlights on the gloss-black trim; the two rear corner trims
              — the middle section of the tail lights is on the tailgate */}
          {LAMP_TRIM.map((d) => (
            <path
              d={d}
              key={d}
              stroke="oklch(0.13 0.008 255)"
              strokeLinecap="round"
              strokeWidth="4.6"
            />
          ))}
          <path
            d={HEADLIGHT}
            filter={url('glow')}
            stroke="oklch(0.95 0.04 220)"
            strokeLinecap="round"
            strokeWidth="3"
          />
          <path
            d={HEADLIGHT}
            stroke="white"
            strokeLinecap="round"
            strokeWidth="1.4"
          />
          <path
            d={FRONT_LOGO}
            stroke="oklch(0.93 0.005 255)"
            strokeLinecap="round"
            strokeLinejoin="round"
            // Thinner than the old V: four strokes in the same width, and thick
            // strokes would clump together.
            strokeWidth="0.62"
          />

          {/* turn signals: the faint lens is always visible, the LED strip
              runs when blinking. When off it's just a smoked lens within the
              black trim — like a real VF 8, the turn signal is part of the
              light bar rather than a separate orange streak. */}
          {([-1, 1] as const).map((side) =>
            SIGNAL_LAMPS.map(({ curve }) => (
              <path
                d={signalCurve(curve, side)}
                key={`${side}-${curve[0][1]}`}
                stroke="oklch(0.42 0.05 60)"
                strokeLinecap="round"
                strokeOpacity="0.55"
                strokeWidth="1.6"
              />
            )),
          )}
          <g key={`lamp-${turnSignal}`}>
            {signalSides.map((side) =>
              SIGNAL_LAMPS.map(({ curve }) => (
                <g key={`${side}-${curve[0][1]}`}>
                  <path
                    className="car-blink-sweep"
                    d={signalCurve(curve, side)}
                    filter={url('glow')}
                    pathLength={1}
                    stroke="var(--color-car-signal)"
                    strokeLinecap="round"
                    strokeWidth="4"
                    style={blinkStyle}
                  />
                  <path
                    className="car-blink-sweep"
                    d={signalCurve(curve, side)}
                    pathLength={1}
                    stroke="oklch(0.94 0.09 75)"
                    strokeLinecap="round"
                    strokeWidth="1.8"
                    style={blinkStyle}
                  />
                </g>
              )),
            )}
          </g>

          {/* Tailgate — hinged at the rear edge of the roof. Drawn last: when
              open it rises above everything at the tail, so it must cover the
              body edge and the two corner lights rather than letting them
              show through the tailgate. */}
          <Hatch
            body={url('body')}
            clipId={id('trunk')}
            open={trunkOpen}
            shade={url('hatch-shade')}
            shape={TRUNK}
            sheen={url('sheen')}
          >
            {(m) => {
              const pane = TAILGATE_PARTS.pane(m)
              const light = TAILGATE_PARTS.light(m, trunkOpen)
              // When closed the stroke width matches the headlights, so both
              // ends of the car share the same look.
              const lamp = (open: number, shut: number) => ({
                className:
                  'transition-[d,stroke-width] duration-950 ease-(--ease-car-move)',
                strokeWidth: trunkOpen ? open : shut,
              })
              return (
                <>
                  {/* When open the lower panel is nearly horizontal, facing up to catch the light. */}
                  <path
                    className="transition-[d,opacity] duration-950 ease-(--ease-car-move)"
                    fill="white"
                    opacity={trunkOpen ? 0.12 : 0}
                    {...morph(TAILGATE_PARTS.lower(m))}
                  />
                  {/* Rear window: black frame + glass pane. When closed the
                      glass is raked, reflects the sky, and reads as one dark
                      band; when open the pane is nearly horizontal and clear —
                      you see through into the trunk and the ground behind the
                      car. */}
                  <path
                    className={HATCH_MOTION}
                    fill="oklch(0.12 0.006 255)"
                    fillRule="evenodd"
                    stroke="oklch(0.1 0.006 255)"
                    strokeWidth="0.6"
                    {...morph(TAILGATE_PARTS.frame(m))}
                  />
                  <path
                    className="transition-[d,fill-opacity] duration-950 ease-(--ease-car-move)"
                    fill={url('glass')}
                    fillOpacity={trunkOpen ? 0.3 : 0.9}
                    {...morph(pane)}
                  />
                  <path
                    className={HATCH_MOTION}
                    fill={url('sky-rear')}
                    {...morph(pane)}
                  />
                  <path
                    className="transition-[d,opacity] duration-950 ease-(--ease-car-move)"
                    fill={url('glare')}
                    opacity={trunkOpen ? 1 : 0}
                    {...morph(pane)}
                  />
                  <path
                    className="transition-[d,stroke-opacity] duration-950 ease-(--ease-car-move)"
                    fill="none"
                    stroke="oklch(0.7 0.03 240)"
                    strokeOpacity={trunkOpen ? 0.4 : 0.12}
                    strokeWidth="0.5"
                    {...morph(pane)}
                  />
                  {/* spoiler painted body color, dark rear lip */}
                  <path
                    className={HATCH_MOTION}
                    fill={url('body')}
                    {...morph(TAILGATE_PARTS.spoiler(m))}
                  />
                  <path
                    className={HATCH_MOTION}
                    fill={url('sheen')}
                    {...morph(TAILGATE_PARTS.spoiler(m))}
                  />
                  <path
                    className={HATCH_MOTION}
                    stroke="oklch(0.14 0.008 255)"
                    strokeLinecap="round"
                    strokeWidth="0.9"
                    {...morph(TAILGATE_PARTS.lip(m))}
                  />

                  {/* rear defrost: a light tint on the glass + a glowing grid of heater lines */}
                  <g
                    className="car-state-fade transition-opacity duration-600 ease-(--ease-car-state)"
                    opacity={rearDefrostOn ? 1 : 0}
                    strokeLinecap="round"
                  >
                    <path
                      className={HATCH_MOTION}
                      fill="var(--color-car-heat)"
                      opacity="0.14"
                      {...morph(pane)}
                    />
                    <g
                      filter={url('glow')}
                      opacity="0.7"
                      stroke="var(--color-car-heat)"
                      strokeWidth="2"
                    >
                      {TAILGATE_PARTS.grid(m).map((d, index) => (
                        <path
                          className={HATCH_MOTION}
                          key={index}
                          {...morph(d)}
                        />
                      ))}
                    </g>
                    <g stroke="oklch(0.93 0.06 70)" strokeWidth="0.7">
                      {TAILGATE_PARTS.grid(m).map((d, index) => (
                        <path
                          className={HATCH_MOTION}
                          key={index}
                          {...morph(d)}
                        />
                      ))}
                    </g>
                    <g
                      opacity="0.45"
                      stroke="oklch(0.93 0.06 70)"
                      strokeWidth="1"
                    >
                      {TAILGATE_PARTS.bus(m).map((d, index) => (
                        <path
                          className={HATCH_MOTION}
                          key={index}
                          {...morph(d)}
                        />
                      ))}
                    </g>
                  </g>

                  {/* middle section of the tail light bar on the black trim,
                      the V logo between the two wings — one single bar,
                      moving with the lower panel */}
                  <g strokeLinecap="round" strokeLinejoin="round">
                    {/* Square-cut ends: stopping exactly at the joint with the
                        corner trim, not overlapping the turn signal tips. */}
                    <path
                      className={HATCH_MOTION}
                      fill="oklch(0.13 0.008 255)"
                      {...morph(TAILGATE_PARTS.trim(m, trunkOpen))}
                    />
                    <path
                      {...lamp(2.6, 3)}
                      filter={url('glow')}
                      stroke="oklch(0.62 0.22 25)"
                      {...morph(light)}
                    />
                    <path
                      {...lamp(1.2, 1.4)}
                      stroke="oklch(0.72 0.2 25)"
                      {...morph(light)}
                    />
                    {/* Chrome W: sharp corners, bevel-cut stroke ends. Thinner
                        than the old V — four strokes in the same width, and
                        thick strokes would clump together. */}
                    <path
                      {...lamp(0.8, 0.62)}
                      stroke="oklch(0.9 0.005 255)"
                      strokeLinecap="butt"
                      strokeLinejoin="miter"
                      {...morph(TAILGATE_PARTS.logo(m, trunkOpen))}
                    />
                  </g>
                </>
              )
            }}
          </Hatch>
        </svg>

        {/*
        Tap a seat to raise seat heating by one level (past the top level it
        goes back to off) — like on a real car's screen. It's an HTML `<button>`
        overlaid on the SVG rather than a clickable SVG element: `role="img"`
        can't contain interactive children, and an HTML button gets keyboard
        focus for free. The hit target is wider than the seat so it's at least
        44px.
      */}
        {ZONES.map((zone) => {
          const level = seatHeat[zone]
          const { hit, mark } = SEAT_HIT
          const hitX = zone === 'driver' ? 100 - hit.width : 100
          const markX = SEAT_CX[zone] - mark.width / 2 - hitX
          return (
            <button
              aria-label={describeSeatHeatButton(zone, level)}
              className="group absolute cursor-pointer outline-none"
              key={zone}
              onClick={() =>
                runCommand((car) =>
                  car.setSeatHeat(
                    (car.seatHeat[zone] + 1) % (SEAT_HEAT_RANGE.max + 1),
                    zone,
                  ),
                )
              }
              style={{
                left: `${(hitX / 200) * 100}%`,
                width: `${(hit.width / 200) * 100}%`,
                top: `${(hit.top / 400) * 100}%`,
                height: `${(hit.height / 400) * 100}%`,
              }}
              type="button"
            >
              <span
                className="group-focus-visible:ring-car-cold group-focus-visible:ring-offset-car-bg absolute inset-y-0 rounded-2xl transition-[background-color,transform] duration-150 ease-(--ease-car) group-hover:bg-white/5 group-focus-visible:ring-2 group-focus-visible:ring-offset-2 group-active:scale-[0.97] group-active:bg-white/10"
                style={{
                  left: `${(markX / hit.width) * 100}%`,
                  width: `${(mark.width / hit.width) * 100}%`,
                }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Hatch lid: a fixed compartment underneath, and a lid that lifts — which, seen
 * from above, shrinks toward its hinge — when opened.
 *
 * Changes the lid's *shape* (`d`) rather than `scaleY`-ing the whole group: the
 * hinge edge is a curve, and an affine scale can only hold a straight line
 * still — scaling around a straight line drags the curved edge off, so the gap
 * around the hinge opens up in one place and closes in another. In real life
 * the hinge doesn't budge; here it doesn't either (`liftMap`).
 *
 * A lid that merely shrinks reads as "a shorter lid next to a black hole", not
 * "trunk open". What makes it read as the latter:
 *
 * - **The compartment is a box with a floor**: the floor is lighter than the
 *   background, the inner walls darken toward the opening (a soft edge shadow,
 *   clipped to exactly the compartment's shape), a dark seal around the
 *   opening.
 * - **The lid widens at its free edge** — closer to the camera — into a
 *   perspective trapezoid.
 * - **The lid has thickness**: a darker copy of the lid shrinks less than the
 *   lid, so opening reveals a strip of underside at the free edge — a solid lid
 *   standing up, not a sheet of paper.
 * - **The lid casts a shadow** onto the compartment floor, right behind the
 *   free edge.
 *
 * The compartment, thickness and shadow sit *under* the lid: when closed the
 * lid covers them completely, looking just as before.
 *
 * A lid with `swing` (the tailgate) swings backwards when opened: no underside
 * shows, and the lid's shadow falls into the compartment and onto the ground
 * behind the car.
 */
function Hatch({
  body,
  children,
  clipId,
  open,
  shade,
  shape,
  sheen,
}: {
  body: string
  /**
   * Things mounted on the lid (glass, lights…), drawn through the lid's `m` so
   * they move with it. Every path must go through `morph` and `HATCH_MOTION`
   * to share the same timing.
   */
  children?: (m: LiftMap) => ReactNode
  clipId: string
  open: boolean
  shade: string
  shape: HatchShape
  sheen: string
}) {
  const shut = liftMap(shape, 1)
  const raised = shape.swing ?? liftMap(shape, HATCH_OPEN_SCALE)
  const pose = open ? raised : shut
  const closed = shape.outline(shut)
  // Glass pane cut out of the painted panel (even-odd), to see through into
  // the compartment.
  const lid = morph(
    shape.window
      ? `${shape.outline(pose)} ${shape.window(pose)}`
      : shape.outline(pose),
  )
  const motion = HATCH_MOTION

  return (
    <g>
      <clipPath id={clipId}>
        <path d={closed} />
      </clipPath>

      {/* a lid swinging backwards casts a shadow onto the ground behind the
          tail — the shadow follows the lid, not showing up ahead of it where
          the lid hasn't reached yet */}
      {shape.swing && (
        <path
          className="transition-[d,opacity] duration-950 ease-(--ease-car-move)"
          fill="black"
          filter={shade}
          opacity={open ? 0.55 : 0}
          transform="translate(0 5)"
          {...lid}
        />
      )}

      {/* compartment: floor, inner walls, lid shadow — clipped neatly inside the opening */}
      <g clipPath={`url(#${clipId})`}>
        <path d={closed} fill="oklch(0.3 0.008 255)" />
        <path
          d={closed}
          filter={shade}
          stroke="oklch(0.06 0.005 255)"
          strokeWidth="11"
        />
        {/* The tailgate covers the whole opening, the compartment is only
            visible through the glass — a lighter shadow so the floor still
            shows through the glass. */}
        <path
          className="transition-opacity duration-950 ease-(--ease-car-move)"
          d={shape.outline(
            shape.swing ?? liftMap(shape, HATCH_OPEN_SCALE + 0.02),
          )}
          fill="black"
          filter={shade}
          opacity={open ? (shape.swing ? 0.4 : 0.75) : 0}
        />
      </g>
      {/* Panel gap around the lid: thin, faint — a bold outline turns the lid into a picture frame. */}
      <path
        d={closed}
        fill="none"
        stroke="oklch(0.14 0.008 255)"
        strokeOpacity="0.55"
        strokeWidth="1.2"
      />
      {/* Open: a dark seal around the opening, drawn *inside* it (a stroke of
          double the width, then clipped to the opening). Unclipped, the outer
          half of the stroke spills onto the body: where the lifted lid widens
          outward the lid covers it, but at the two hinge ends the widening
          goes to 0, so exactly those two corners show a black wedge as if
          chipped. */}
      <path
        className="transition-[stroke-opacity] duration-950 ease-(--ease-car-move)"
        clipPath={`url(#${clipId})`}
        d={closed}
        fill="none"
        stroke="oklch(0.14 0.008 255)"
        strokeOpacity={open ? 1 : 0}
        strokeWidth="4.8"
      />

      {/* lid underside — revealed as a strip at the free edge when the lid stands up */}
      {!shape.swing && (
        <path
          className={motion}
          fill="oklch(0.36 0.01 255)"
          stroke="oklch(0.2 0.01 255)"
          strokeWidth="0.35"
          {...morph(
            shape.outline(
              open
                ? liftMap(
                    shape,
                    HATCH_OPEN_SCALE + HATCH_THICKNESS / shape.length,
                  )
                : shut,
            ),
          )}
        />
      )}

      <path className={motion} fill={body} fillRule="evenodd" {...lid} />
      <path className={motion} fill={sheen} fillRule="evenodd" {...lid} />
      {/* lid creases: soft streaks, not drawn lines */}
      <path
        className={motion}
        stroke={shape.creaseColor}
        strokeLinecap="round"
        strokeOpacity="0.45"
        strokeWidth="0.8"
        {...morph(shape.crease(pose))}
      />
      {/* a lid tilted toward the light is brighter — paint only, not over the lights */}
      <path
        className="transition-[d,opacity] duration-950 ease-(--ease-car-move)"
        fill="white"
        fillRule="evenodd"
        opacity={open ? 0.14 : 0}
        {...lid}
      />
      {children?.(pose)}
    </g>
  )
}

/**
 * The center panel of a cushion piece: the recessed part between the two
 * bolsters.
 *
 * Seen from above, what makes a rounded rectangle read as a **car seat** is
 * exactly this contrast — bright bolsters at both edges, a darker seat well in
 * the middle. That's all it takes: at actual size (1 unit ≈ 0.8 px) stitching
 * and stitch ribs don't become a pattern but noise, and three noisy seats side
 * by side make the whole cabin hard on the eyes.
 */
function SeatPanel({
  fill,
  height,
  width,
  x,
  y,
}: {
  fill: string
  height: number
  width: number
  x: number
  y: number
}) {
  return (
    <rect
      fill={fill}
      height={height}
      rx={Math.min(3.4, width * 0.16)}
      width={width}
      x={x}
      y={y}
    />
  )
}

/** Headrest: a plain leather piece, with an extra dark layer because it stands upright, away from the overhead light. */
function Headrest({
  cx,
  leather,
  width,
  y,
}: {
  cx: number
  leather: string
  width: number
  y: number
}) {
  const height = width * 0.5
  return (
    <>
      <path
        d={`M${cx - width * 0.27} ${y - 2.5} V${y + 2} M${cx + width * 0.27} ${y - 2.5} V${y + 2}`}
        stroke="oklch(0.26 0.01 255)"
        strokeWidth="1.8"
      />
      <rect
        fill={leather}
        height={height}
        rx={height / 2.2}
        width={width}
        x={cx - width / 2}
        y={y}
      />
      <rect
        fill="black"
        fillOpacity="0.14"
        height={height}
        rx={height / 2.2}
        width={width}
        x={cx - width / 2}
        y={y}
      />
    </>
  )
}

/**
 * A front seat seen straight from above.
 *
 * Three pieces in sequence along the car's length: the seat cushion is
 * horizontal so its whole surface shows, the seatback stands nearly upright so
 * it's foreshortened into a narrow strip (but with shoulders wider than the
 * cushion), then the headrest. Between cushion and back is a dark gap — where
 * the seat folds, and the only thing separating two pieces of the same leather
 * color.
 *
 * No seatbelt is drawn: it carries *no* state, yet sits exactly where the seat
 * heating glow appears — the one detail competing with information for space.
 */
function FrontSeat({
  cx,
  leather,
  panel,
  shadow,
}: {
  cx: number
  leather: string
  panel: string
  shadow: string
}) {
  return (
    <g>
      <rect
        fill="black"
        fillOpacity="0.5"
        filter={shadow}
        height="52"
        rx="9"
        width="32"
        x={cx - 16}
        y="182"
      />
      {/* seat cushion */}
      <rect
        fill={leather}
        height="29"
        rx="7.5"
        width="31"
        x={cx - 15.5}
        y="179"
      />
      <SeatPanel fill={panel} height={25.6} width={16} x={cx - 8} y={180.7} />
      {/* fold gap between cushion and seatback */}
      <rect
        fill="black"
        fillOpacity="0.45"
        height="2.6"
        rx="1.3"
        width="29"
        x={cx - 14.5}
        y="207.2"
      />
      {/* seatback */}
      <rect
        fill={leather}
        height="16.5"
        rx="6.5"
        width="34"
        x={cx - 17}
        y="209"
      />
      <SeatPanel fill={panel} height={13.1} width={17} x={cx - 8.5} y={210.7} />
      <Headrest cx={cx} leather={leather} width={19} y={223.5} />
    </g>
  )
}

/**
 * Three-seat rear bench: one continuous cushion — just like the VF 8's
 * one-piece rear bench — divided into three seats by three recessed seat
 * wells rather than three separate blocks. The middle seat is narrower and its
 * headrest smaller than the two sides.
 */
function RearBench({
  leather,
  panel,
  shadow,
}: {
  leather: string
  panel: string
  shadow: string
}) {
  const seats = [
    { cx: 76, width: 22 },
    { cx: 100, width: 17 },
    { cx: 124, width: 22 },
  ]
  return (
    <g>
      <rect
        fill="black"
        fillOpacity="0.5"
        filter={shadow}
        height="44"
        rx="9"
        width="80"
        x="60"
        y="251"
      />
      {/* seat cushion */}
      <rect fill={leather} height="25" rx="7" width="79" x="60.5" y="248" />
      {seats.map(({ cx, width }) => (
        <SeatPanel
          fill={panel}
          height={21.6}
          key={cx}
          width={width}
          x={cx - width / 2}
          y={249.7}
        />
      ))}
      {/* fold gap */}
      <rect
        fill="black"
        fillOpacity="0.45"
        height="2.6"
        rx="1.3"
        width="77"
        x="61.5"
        y="271.6"
      />
      {/* seatback */}
      <rect fill={leather} height="14" rx="6" width="80" x="60" y="273" />
      {seats.map(({ cx, width }) => (
        <SeatPanel
          fill={panel}
          height={10.6}
          key={cx}
          width={width}
          x={cx - width / 2}
          y={274.7}
        />
      ))}
      {seats.map(({ cx, width }) => (
        <Headrest
          cx={cx}
          key={cx}
          leather={leather}
          width={width === 17 ? 14 : 18}
          y={285.5}
        />
      ))}
    </g>
  )
}

/**
 * Center console between the two front seats: wireless charging tray, two cup
 * holders, then the leather-covered armrest lid, lighter than the plastic —
 * just three pieces, enough for the console to read as a console rather than a
 * black bar splitting the cabin in two.
 */
function Console({ leather, paint }: { leather: string; paint: string }) {
  return (
    <g>
      <rect fill={paint} height="74" rx="5" width="17" x="91.5" y="160" />
      <rect
        fill="oklch(0.11 0.005 255)"
        height="14"
        rx="2.5"
        width="11"
        x="94.5"
        y="164.5"
      />
      {[96.3, 103.7].map((cx) => (
        <circle
          cx={cx}
          cy="186"
          fill="oklch(0.1 0.005 255)"
          key={cx}
          r="3.4"
          stroke="oklch(0.3 0.01 255)"
          strokeWidth="0.6"
        />
      ))}
      <rect fill={leather} height="32" rx="4" width="14" x="93" y="196" />
    </g>
  )
}

/**
 * Sunroof: a fixed opening in the roof, and the sliding glass panel on top of
 * it.
 *
 * Two-stage motion like a real sunroof: opening **lifts the glass's tail
 * first** (a shadow appears — from above, the shadow is the only thing saying
 * "the panel has left the roof surface") and only then slides back; closing
 * slides forward and only then lowers. The two stages are two
 * `transition-delay`s that swap depending on direction, so reversing midway
 * makes each property turn around from exactly where it currently is.
 *
 * When open, the gap has no tinted glass: the front seats brighten noticeably
 * under the patch of sunlight.
 */
function Sunroof({
  glare,
  glass,
  open,
  shadow,
  sun,
}: {
  glare: string
  glass: string
  open: number
  shadow: string
  sun: string
}) {
  const share = Math.min(100, Math.max(0, open)) / 100
  const isOpen = share > 0
  const { y, width, height } = SUNROOF
  const liftDelay = isOpen ? '0ms' : '1000ms'
  const slideDelay = isOpen ? '180ms' : '0ms'

  return (
    <g>
      {/* sunlight shining through the opening onto the two front seats */}
      <ellipse
        className="transition-opacity duration-1100 ease-(--ease-car-move)"
        cx="100"
        cy={y + height / 2}
        fill={sun}
        opacity={0.28 * share}
        rx={width / 2 - 4}
        ry={height / 2}
        style={{ transitionDelay: slideDelay }}
      />
      {/* Seal around the opening — always a thin stroke. It used to thicken
          when opening and thin again when closing, but a stroke changing width
          while the panel is still sliding looks very odd, and it adds nothing:
          whether the glass has lifted is already told by the shadow and the
          glass edge. */}
      <rect
        fill="none"
        stroke="oklch(0.1 0.008 255)"
        strokeWidth="1"
        {...SUNROOF}
      />

      <g
        className="transition-transform duration-1100 ease-(--ease-car-move)"
        style={{
          transform: `translateY(${share * SUNROOF_TRAVEL}px)`,
          transitionDelay: slideDelay,
        }}
      >
        <rect
          className="transition-opacity duration-200 ease-(--ease-car-state)"
          fill="black"
          filter={shadow}
          opacity={isOpen ? 0.6 : 0}
          style={{ transitionDelay: liftDelay }}
          {...SUNROOF}
          y={y + 4}
        />
        <rect fill={glass} opacity="0.42" {...SUNROOF} />
        <rect fill={glare} {...SUNROOF} />
        {/* the glass edge brightens once lifted — separating the panel from the roof below */}
        <rect
          className="transition-[stroke-opacity] duration-200 ease-(--ease-car-state)"
          fill="none"
          stroke="oklch(0.7 0.03 240)"
          strokeOpacity={isOpen ? 0.55 : 0.18}
          strokeWidth="0.8"
          style={{ transitionDelay: liftDelay }}
          {...SUNROOF}
        />
      </g>
    </g>
  )
}

/**
 * One side door: a dark door cavity fixed on the body, and the door (painted
 * skin + window) rotating around a hinge at the front-outer corner.
 *
 * Rotates with CSS `transform` rather than changing coordinates: `transform`
 * runs on the GPU and can be interrupted midway — pressing close while the door
 * is half open turns it around from exactly its current angle instead of
 * jumping back to the start.
 */
function Door({
  body,
  bottom,
  clipId,
  frontSlant,
  mirrorFolded,
  mirrorPaint,
  open,
  rearSlant,
  shadow,
  side,
  top,
  windowOpen,
  windowTop,
}: {
  body: string
  /** Id for the clip-path that clips the window to exactly the door's shape. */
  clipId: string
  shadow: string
  bottom: number
  frontSlant: number
  /** Absent means the door carries no mirror (rear doors). */
  mirrorFolded?: boolean
  mirrorPaint: string
  open: boolean
  rearSlant: number
  side: -1 | 1
  top: number
  windowOpen: number
  windowTop: number
}) {
  const outer = 100 + side * BODY_HALF
  // in to the roof edge (x = 51 / 149)
  const width = BODY_HALF - 49
  const at = (u: number) => outer - side * u
  const outline = doorOutline(at, width, top, bottom, frontSlant, rearSlant)
  // The left side rotates positively (the door's front end swings left), the
  // right side the opposite way.
  const angle = open ? -side * DOOR_OPEN_DEG : 0

  return (
    <g>
      <clipPath id={clipId}>
        <path d={outline} />
      </clipPath>
      {/* door cavity: only visible once the door has moved away */}
      <path d={outline} fill="oklch(0.1 0.008 255)" />
      <path
        d={`M${at(3)} ${top + 5} V${bottom - 5}`}
        stroke="oklch(0.3 0.01 255)"
        strokeLinecap="round"
        strokeWidth="1.2"
      />

      <g
        className="transition-transform duration-800 ease-(--ease-car-move)"
        style={{
          transform: `rotate(${angle}deg)`,
          transformBox: 'view-box',
          transformOrigin: `${outer}px ${top}px`,
        }}
      >
        {/* The shadow and bright edge only show when open: when closed the
            door must be one piece with the body, no seam showing. Without
            them an open door is just a gray streak sinking into the dark
            background. */}
        <path
          className="car-state-fade transition-opacity duration-800 ease-(--ease-car-move)"
          d={outline}
          fill="black"
          filter={shadow}
          opacity={open ? 0.6 : 0}
          transform={`translate(${side * 3} 4)`}
        />
        {/* The mirror housing is drawn before the door skin: the root part
            tucked under the door edge is hidden by the door, and the joint
            with the body is covered by `MirrorFoot` (drawn after the door). */}
        {mirrorFolded !== undefined && (
          <Mirror
            folded={mirrorFolded}
            paint={mirrorPaint}
            shadow={shadow}
            side={side}
            top={top}
          />
        )}
        {/* the door outline is a panel gap: thin and faint, like the hatch lid's gap */}
        <path
          d={outline}
          fill={body}
          stroke="oklch(0.14 0.008 255)"
          strokeOpacity="0.55"
          strokeWidth="0.6"
        />
        <path
          className="car-state-fade transition-opacity duration-800 ease-(--ease-car-move)"
          d={`M${outer} ${top + 3} V${bottom - 4}`}
          opacity={open ? 1 : 0}
          stroke="oklch(0.86 0.008 255)"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
        {mirrorFolded !== undefined && (
          <MirrorFoot paint={mirrorPaint} side={side} top={top} />
        )}
        {/* flush door handle: dark recess, bright edge on top */}
        <path
          d={`M${outer - side * 3} ${bottom - 24} v9`}
          stroke="oklch(0.3 0.01 255)"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
        <path
          d={`M${outer - side * 4.2} ${bottom - 24} v9`}
          stroke="oklch(0.9 0.005 255)"
          strokeLinecap="round"
          strokeOpacity="0.4"
          strokeWidth="0.5"
        />
        <SideWindow
          bottom={Math.max(bottom, bottom - rearSlant)}
          clip={`url(#${clipId})`}
          draftTop={
            mirrorFolded === undefined ? windowTop + 2 : top + MIRROR_WAKE
          }
          open={windowOpen}
          side={side}
          top={windowTop}
        />
        {/* Inner door trim — dark plastic panel, leather-wrapped armrest —
            sticking into the cabin past the glass edge. Only shown when open:
            when closed it sits under the roof edge. */}
        <g
          className="car-state-fade transition-opacity duration-800 ease-(--ease-car-move)"
          opacity={open ? 1 : 0}
          strokeLinecap="round"
        >
          <path
            d={`M${at(width + 1.6)} ${top + frontSlant + 3} L${at(width + 1.6)} ${bottom - rearSlant - 3}`}
            stroke="oklch(0.14 0.008 255)"
            strokeWidth="3.4"
          />
          <path
            d={`M${at(width + 1.8)} ${top + frontSlant + (bottom - top) * 0.3} L${at(width + 1.8)} ${bottom - rearSlant - (bottom - top) * 0.18}`}
            stroke="oklch(0.3 0.008 265)"
            strokeWidth="1.6"
          />
        </g>
      </g>
    </g>
  )
}

/**
 * Side mirror on the front door. Folding swings the whole mirror housing back
 * around the mirror base until it's nearly parallel to the car's side — just
 * like a real folding motor.
 *
 * It sits *inside* the door's rotation group, so opening the door carries the
 * mirror with it; the two rotations are nested, each around its own axis, so an
 * open door with a folded mirror is still correct.
 *
 * The fold is slow and steady (`--ease-car-move`, 950 ms) rather than snapping
 * like the doors: the mirror is motor-driven, and that mechanical pace is what
 * makes the eye read "the mirror is folding" rather than "the image just
 * changed".
 */
/** `out` is the distance sticking out past the body edge at the door section; negative is inset. */
const mirrorAt = (side: -1 | 1) => (out: number) =>
  100 + side * (BODY_HALF + out)

/**
 * The fold axis is at the outer end of the mirror base, not at the body edge:
 * the housing rotates around the joint on the base, while the base stays still
 * on the door.
 */
const MIRROR_PIVOT_OUT = 3

/**
 * Distance from the front of the front door to behind the mirror's tail,
 * including when folded (the mirror's tip leans back to about top + 22). The
 * window's draft streak starts here so it doesn't overlap the mirror.
 */
const MIRROR_WAKE = 24

/**
 * Mirror base — a fixed mounting plate on the door, drawn *after* the door skin
 * so it covers the body edge. Without it, once the mirror is folded, the part
 * still sticking out gets cut off from the car by the body edge's dark outline,
 * looking like a floating mirror. Only the outline of the protruding part is
 * drawn: the part on the door blends into the paint.
 */
function MirrorFoot({
  paint,
  side,
  top,
}: {
  paint: string
  side: -1 | 1
  top: number
}) {
  const at = mirrorAt(side)
  const rim = `L${at(3)} ${top + 3.8} C${at(5)} ${top + 4.2} ${at(5)} ${top + 11.8} ${at(3)} ${top + 12.2} L${at(0)} ${top + 12.8}`

  return (
    <g>
      <path
        d={`M${at(-1)} ${top + 3} L${at(0)} ${top + 3.2} ${rim} L${at(-1)} ${top + 13} Z`}
        fill={paint}
      />
      <path
        d={`M${at(0)} ${top + 3.2} ${rim}`}
        fill="none"
        stroke="oklch(0.2 0.01 255)"
        strokeLinecap="round"
        strokeOpacity="0.6"
        strokeWidth="0.6"
      />
    </g>
  )
}

function Mirror({
  folded,
  paint,
  shadow,
  side,
  top,
}: {
  folded: boolean
  paint: string
  shadow: string
  side: -1 | 1
  top: number
}) {
  const at = mirrorAt(side)
  // The housing's root tucks under the mirror base (`MirrorFoot`), so when
  // folded the joint is still covered by the base and no cut edge shows. The
  // two root corners are rounded: when folded they rotate out from under the
  // base, and square corners would show as a sharp point.
  const housing = `M${at(1.5)} ${top + 5} Q${at(1.5)} ${top + 1} ${at(5.5)} ${top + 2.5} L${at(12)} ${top + 5} C${at(15)} ${top + 6} ${at(15)} ${top + 12} ${at(12)} ${top + 13} L${at(5.5)} ${top + 13.8} Q${at(1.5)} ${top + 15} ${at(1.5)} ${top + 11} Z`
  // The left side rotates counterclockwise (the mirror's tip swings back), the
  // right side the opposite way.
  const angle = folded ? side * MIRROR_FOLD_DEG : 0

  return (
    <g
      className="transition-transform duration-950 ease-(--ease-car-move)"
      style={{
        transform: `rotate(${angle}deg)`,
        transformBox: 'view-box',
        transformOrigin: `${at(MIRROR_PIVOT_OUT)}px ${top + 8}px`,
      }}
    >
      <path d={housing} fill="black" filter={shadow} opacity="0.5" />
      <path
        d={housing}
        fill={paint}
        stroke="oklch(0.2 0.01 255)"
        strokeOpacity="0.6"
        strokeWidth="0.6"
      />
      {/* mirror glass on the rear edge — just a streak, since the glass faces the tail */}
      <path
        d={`M${at(5)} ${top + 13.3} L${at(11.5)} ${top + 12.4}`}
        stroke="oklch(0.62 0.04 240)"
        strokeLinecap="round"
        strokeWidth="1.1"
      />
    </g>
  )
}

/**
 * One side window. When opened the glass retracts backwards and reveals a
 * **pitch-black** gap in front, plus a draft streak along the outside — from
 * above you can't see the glass lowering, so the opening is read by the
 * *length of the gap*.
 *
 * The side windows are deliberately lighter than the panoramic glass: if both
 * were dark the gap and the glass would be the same color, and a window 60%
 * open would look exactly like a closed one.
 */
function SideWindow({
  bottom,
  clip,
  draftTop,
  open,
  side,
  top,
}: {
  bottom: number
  /** Clips the glass to the door's shape, so both ends of the glass follow the door's slanted edges. */
  clip: string
  /** Where the draft streak starts — on front doors it must be set back behind the mirror. */
  draftTop: number
  open: number
  side: -1 | 1
  top: number
}) {
  const share = Math.min(100, Math.max(0, open)) / 100
  const length = bottom - top
  const gap = length * share
  // The inner edge follows the roof edge (x = 51 / 149); the rest out to the
  // body edge is the car's shoulder.
  const x = side === -1 ? 51 - SIDE_GLASS_WIDTH : 149
  // Draft streak outside the body edge, not over the paint.
  const draft = 100 + side * (BODY_HALF + 5)

  return (
    <g>
      <g clipPath={clip}>
        <rect
          fill="oklch(0.06 0.005 255)"
          height={length}
          rx="3"
          width={SIDE_GLASS_WIDTH}
          x={x}
          y={top}
        />
        <rect
          className="transition-[y,height] duration-700 ease-(--ease-car-move)"
          fill="oklch(0.24 0.02 245)"
          height={length - gap}
          rx="3"
          stroke="oklch(0.62 0.02 240)"
          strokeOpacity="0.3"
          strokeWidth="0.5"
          width={SIDE_GLASS_WIDTH}
          x={x}
          y={top + gap}
        />
        {/* the glass tilts outward and reflects the sky: outer edge brighter than inner edge */}
        <rect
          className="transition-[y,height] duration-700 ease-(--ease-car-move)"
          fill="oklch(0.85 0.02 235)"
          height={length - gap}
          opacity="0.1"
          rx="3"
          width="4"
          x={side === -1 ? x : x + SIDE_GLASS_WIDTH - 4}
          y={top + gap}
        />
      </g>
      {/* The draft streak is always mounted and moves in step with the
          glass: growing as the glass retracts, shrinking as it closes. If it
          only appeared once open, it would pop out at full length on the
          first frame while the glass is still sliding. */}
      {[0, 1].map((index) => (
        <path
          className="transition-[d,opacity] duration-700 ease-(--ease-car-move)"
          key={index}
          opacity={share > 0 ? 0.7 : 0}
          stroke="var(--color-car-ink-muted)"
          strokeLinecap="round"
          strokeWidth="1.2"
          {...morph(
            `M${draft + side * index * 4} ${draftTop + index * 6} v${share > 0 ? Math.max(10, gap * 0.7) : 0}`,
          )}
        />
      ))}
    </g>
  )
}
