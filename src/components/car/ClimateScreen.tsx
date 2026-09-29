/**
 * The HVAC screen.
 *
 * Every button here goes through `runCommand`, so a manual tap produces exactly
 * the `ToolResult` that voice produces. That's the safety net: if voice breaks
 * but tapping still works, the bug isn't in the UI or the store.
 *
 * ## No more tabs
 *
 * The previous version had three tabs like the original video — but only
 * "Climate" had content; the other two opened onto a single line of apology. A
 * tab bar takes the screen's first row, the thing the user reads even before
 * the buttons, and when two thirds of it lead to empty space it doesn't
 * navigate, it just makes empty promises. Drop it, and the screen gets that
 * whole row back. When the "Seats" tab has real content, rebuild the tab bar at
 * the same time, not before.
 *
 * ## Layout
 *
 * This screen is now just the **control panel** on the right part of the
 * frame; the car and the two temperature columns stand on their own in the
 * left column (`CarStage`), like Tesla's Controls screen opening over the map
 * while the car stays put on the left.
 *
 * The panel splits into two columns when wide enough (container query, not
 * window width — the right part is much narrower than the window), and the
 * boundary between the two columns **is a real system boundary**:
 *
 * - Left column — A/C and seat heating, then wipers at the foot of the column.
 * - Right column — turn signals and doors-windows-mirrors.
 *
 * Both columns are now **real commands**: ever since the body went into
 * `CarState` (the seven tools `set_window`…`set_wipers`), every button here
 * goes through `runCommand` and has a matching spoken command. The only
 * exception is the "Roof" button — a view mode, not a car part.
 *
 * The right column used to be three separate panels, each with a caption
 * "tap-only" almost identical to the other two. Three such lines stacked
 * vertically read as noise — anything repeated three times, the eye skips all
 * three. Now no panel carries that line: the "not yet wired into `CarState`"
 * status is the code's business; for someone sitting in the car, tapping a
 * button and seeing the car react is enough. Dropping two layers of frames and
 * the redundant lines also pulls the right column down to nearly the height of
 * the left, getting rid of the big empty gap under the left column in the old
 * version.
 */

import { Fan, Snowflake } from 'lucide-react'
import { useEffect, useRef } from 'react'

import {
  FAN_SPEED_RANGE,
  INITIAL_CAR_STATE,
  SEAT_HEAT_RANGE,
  ZONES,
  type Zone,
} from '@/domain/car-state'
import { cn } from '@/lib/utils'
import { useCarStore } from '@/store/car-store'
import { usePreviewStore } from '@/store/preview-store'
import { runCommand } from '@/store/run-command'

import {
  FrontDefrostIcon,
  RearDefrostIcon,
  RecirculationIcon,
  DoorIcon,
  HatchIcon,
  MirrorIcon,
  RoofIcon,
  SeatHeatIcon,
  SeatLevelIcon,
  SunroofIcon,
  WindowIcon,
} from './car-icons'
import { DOORS, MIRRORS, type DoorId, type MirrorId } from './car-visuals'
import { TurnSignalControl } from './TurnSignalControl'
import { WiperControl } from './WiperControl'
import {
  LevelMeter,
  ModeSelect,
  Panel,
  SectionLabel,
  ToggleButton,
} from './ui-bits'

const ZONE_LABEL: Record<Zone, string> = {
  driver: 'Driver',
  passenger: 'Passenger',
}

/**
 * A switch tile in the grid, like the square-tile grid on the Tesla screen.
 * Still keeps the LED instead of a solid fill (reason in `ToggleButton`) — with
 * bigger tiles, that reason holds even more.
 */
const TILE = 'h-full min-h-20 @xl:min-h-24'

/**
 * The fan icon next to the "Fan" label **is the fan-off button**, as on a real
 * VF 8 (tap the fan blades to turn on/off, press and hold then slide to adjust
 * the level).
 *
 * Turning the fan off is a separate action from "turning it up or down" —
 * mis-hitting off is very different from mis-hitting the neighboring level —
 * so it doesn't belong in the meter. But it isn't worth an extra cell in the
 * row either: nobody taps − seven times to turn it off, and a separate button
 * next to ± would squeeze the track narrower. The icon in the heading is where
 * the eye already looks when searching for fan speed, and it was sitting idle.
 *
 * Turning back on restores the **level from before it was turned off**, not
 * the default level: someone who kills the fan to take a phone call wants back
 * exactly the airflow they just had.
 */
function FanPowerButton({ fanSpeed }: { fanSpeed: number }) {
  // Remember the most recent running level *no matter who set it* — this
  // button, the slider, or voice. Written in an effect, not in the render
  // body: React makes no guarantees about when a ref read/written during
  // render actually happens.
  const lastOn = useRef<number>(INITIAL_CAR_STATE.fanSpeed)
  useEffect(() => {
    if (fanSpeed > 0) lastOn.current = fanSpeed
  }, [fanSpeed])
  const on = fanSpeed > 0

  return (
    <button
      aria-label={on ? 'Turn fan off' : 'Turn fan on'}
      aria-pressed={on}
      // `-m-2.5`: the hit target stays a full 44px without making the heading
      // row taller.
      className="car-focus -m-2.5 flex size-11 cursor-pointer items-center justify-center rounded-full transition-[background-color,transform] duration-150 ease-out hover:bg-white/5 active:scale-95"
      onClick={() =>
        runCommand((car) => car.setFanSpeed(on ? 0 : lastOn.current))
      }
      // Touch screens have no tooltip, but a mouse does — and this icon is the
      // only place on the screen where "tappable" isn't evident from its shape.
      title={on ? 'Turn fan off' : 'Turn fan on'}
      type="button"
    >
      {/*
        One color for both states: this icon is **the group's label**; if it
        turned blue while the fan runs it would read as a second indicator
        light, while the fan meter right below already states the level far
        more clearly. The state is still readable from the number of lit bars
        on the meter, and from `aria-pressed`.
      */}
      <Fan className="text-car-ink-muted size-4" />
    </button>
  )
}

/**
 * The climate block: four switches, then fan speed.
 *
 * Fan speed shares the block with the switches instead of having its own panel
 * because it's the same system — A/C, recirculation and fan speed all blow out
 * of the same vent — and because the left column needs enough height not to
 * fall short of the right column.
 */
function ClimateBlock() {
  const acOn = useCarStore((state) => state.acOn)
  const recirculationOn = useCarStore((state) => state.recirculationOn)
  const frontDefrostOn = useCarStore((state) => state.frontDefrostOn)
  const rearDefrostOn = useCarStore((state) => state.rearDefrostOn)
  const fanSpeed = useCarStore((state) => state.fanSpeed)

  return (
    // `flex-auto`, not `flex-1`: `flex-1` sets basis 0, so the two panels
    // split the column height in half regardless of what they contain — seat
    // heating (two rows of buttons) swells to match climate (four tiles + fan
    // meter). `flex-auto` keeps the natural size and then adds the surplus, so
    // the ratio between the two blocks is preserved.
    <Panel className="flex flex-auto flex-col gap-3 p-4">
      <SectionLabel icon={<Snowflake className="size-4" />} size="title">
        Climate
      </SectionLabel>

      {/*
        Four tiles, two columns: the old `grid-cols-3` was for laying out six
        tiles, and four tiles on three columns leaves the bottom row one short,
        so the grid reads as incomplete. The upper cap is still 16rem — any
        taller and the tiles become upright rectangles, and a grid of upright
        switches reads as a list rather than a keypad.
      */}
      <div className="grid max-h-64 flex-1 grid-cols-2 gap-2">
        <ToggleButton
          className={TILE}
          active={acOn}
          icon={<Snowflake className="size-6" />}
          label="A/C"
          onClick={() => runCommand((car) => car.setAc(!car.acOn))}
        />
        <ToggleButton
          className={TILE}
          active={recirculationOn}
          icon={<RecirculationIcon className="size-6" />}
          label="Recirculation"
          onClick={() =>
            runCommand((car) => car.setRecirculation(!car.recirculationOn))
          }
        />
        <ToggleButton
          className={TILE}
          active={frontDefrostOn}
          icon={<FrontDefrostIcon className="size-6" />}
          label="Front defrost"
          onClick={() =>
            runCommand((car) => car.setDefrost('front', !car.frontDefrostOn))
          }
          tone="heat"
        />
        <ToggleButton
          className={TILE}
          active={rearDefrostOn}
          icon={<RearDefrostIcon className="size-6" />}
          label="Rear defrost"
          onClick={() =>
            runCommand((car) => car.setDefrost('rear', !car.rearDefrostOn))
          }
          tone="heat"
        />
      </div>

      {/*
        After the tile grid, all of the column's leftover height goes to the
        fan speed meter (capped at 11rem). This is the only place in the block
        that can take it: it's a **meter**, bars rising into a wedge shape, and
        a taller wedge reads its strength more clearly — exactly what it's
        there for. Each bar is also only 27px wide, so extra height makes the
        target genuinely easier to hit, not just more color.
      */}
      <div className="flex max-h-44 flex-1 flex-col gap-2 pt-1">
        {/* No "Level N" number here: the meter just below already draws that
            exact number as lit bars, and repeating it in the heading only adds
            text for the eye to read. The full value is still in
            `aria-valuetext`. */}
        <SectionLabel
          icon={<FanPowerButton fanSpeed={fanSpeed} />}
          size="title"
        >
          Fan
        </SectionLabel>
        <LevelMeter
          ariaLabel="Fan speed"
          max={FAN_SPEED_RANGE.max}
          onSelect={(level) => runCommand((car) => car.setFanSpeed(level))}
          stepperLabels={['Decrease fan speed', 'Increase fan speed']}
          value={fanSpeed}
          valueText={(level) => (level === 0 ? 'Off' : `Level ${level}`)}
        />
      </div>
    </Panel>
  )
}

/**
 * Seat heating, one row of level buttons per side.
 *
 * With three levels, **reading a number is faster than counting bars**. The
 * previous version used a stepped bar like fan speed, but a three-step meter
 * spanning the full column width makes each bar a hundred-odd pixels wide:
 * three huge grey blocks side by side, and to know which level you're on you
 * still have to count them. Real cars go the other way — there are always few
 * levels (Tesla and SYNC both have three) precisely so the driver
 * *recognizes* rather than *counts*, because NHTSA's driver-distraction
 * guidelines allow only 1.5–2 seconds per glance.
 *
 * The side name sits **next to** the button row, not above it: two lines of
 * "Driver" / "Passenger" stacked over the two rows make this block nearly one
 * and a half times as tall without saying anything more — and on a car screen,
 * height is the most expensive thing.
 *
 * ### Also not borrowing the fan speed ± buttons
 *
 * A question that keeps coming back: give seat heating the same shape as
 * `LevelMeter` for "consistency". No. ± buttons are only cheap when people
 * **nudge around a default value** — the tap count grows linearly with the
 * distance to the target. But the two real seat heating actions are the two
 * longest jumps: "just got in, cold → level 3" and "warm now → off". With ±
 * each jump is three taps, times two seats is six, instead of two. Direct
 * selection is always **one tap regardless of target**, so it wins exactly
 * where people actually tap.
 *
 * No real car uses ± for seat heating either: Tesla has you tap to cycle on
 * the seat icon (1→2→3→off) plus an "All Off" button. That saves space, but
 * it's exactly the "tap three times for level 3" pattern this button row
 * avoids.
 */
const SEAT_HEAT_OPTIONS = [
  { id: '0', label: 'Off', off: true },
  ...Array.from({ length: SEAT_HEAT_RANGE.max }, (_, index) => ({
    id: String(index + 1),
    label: String(index + 1),
  })),
]

/**
 * One seat side: a seat with heat waves, the side name, then the row of level
 * buttons.
 *
 * The icon **doesn't repeat** what the button row already says; it says it a
 * different way: the button row answers "which level" on a closer look, the
 * icon answers "which side is warm" at a glance. The two seat sides are
 * stacked, so comparing two wave marks is much faster than scanning which tile
 * in two rows of four is filled.
 */
function SeatHeatRow({ zone }: { zone: Zone }) {
  const level = useCarStore((state) => state.seatHeat[zone])
  const on = level > 0

  return (
    <div className="flex items-center gap-3">
      {/*
        `whitespace-nowrap` + content-sized width: if "Passenger" wraps onto two
        lines, the two seat rows end up different heights and the whole block
        goes lopsided — and the two seat sides can only be read by comparing
        them with each other.
      */}
      <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        {/*
          One size up from the group label icon (size-4): this isn't a label,
          it's the **gauge** for the whole row — the only thing in the block
          that answers "which side is warm" without reading any text.
        */}
        <SeatLevelIcon
          className={cn(
            'size-8 shrink-0 transition-colors duration-200 ease-(--ease-car)',
            on ? 'text-car-heat' : 'text-car-ink-faint',
          )}
          level={level}
        />
        {/*
          The side name **lights up when the seat is heating**. When a row is
          on, all three of its parts change together — waves on the seat, side
          name, level tile — so the difference between the two rows is big
          enough to spot in peripheral vision, without scanning tile by tile.
        */}
        <span
          className={cn(
            'w-12 text-xs transition-colors duration-200 ease-(--ease-car)',
            on ? 'text-car-ink' : 'text-car-ink-muted',
          )}
        >
          {ZONE_LABEL[zone]}
        </span>
      </span>
      <ModeSelect
        ariaLabel={`${ZONE_LABEL[zone]} seat heating`}
        className="min-w-0 flex-1"
        onSelect={(id) =>
          runCommand((car) => car.setSeatHeat(Number(id), zone))
        }
        options={SEAT_HEAT_OPTIONS}
        tone="heat"
        value={String(level)}
      />
    </div>
  )
}

/**
 * This block **keeps its natural height**; it doesn't stretch with the column.
 *
 * The previous version gave it `flex-auto` to soak up the extra height from the
 * longer right column. Wrong place: the four "Off 1 2 3" tiles got stretched to
 * 96px into four slabs, 13px text floating in empty space, and the selected
 * tile became a solid orange block the size of a fist — exactly what
 * `ToggleButton` has a dedicated note to avoid, because it overwhelms the car
 * and the temperature readout, which deserve the attention more.
 *
 * Not all spare height can be handed to tap targets. A four-level selector has
 * a *right* height (~48px), and taller than that doesn't make taps more
 * accurate, it only adds colored area. The surplus now goes to the climate
 * block — the six tiles there form a two-dimensional grid; scaling it up grows
 * both dimensions evenly, so it stays balanced.
 */
function SeatHeatBlock() {
  return (
    <Panel className="flex shrink-0 flex-col gap-3 p-4">
      <SectionLabel icon={<SeatHeatIcon className="size-4" />} size="title">
        Seat heating
      </SectionLabel>
      <div className="flex flex-col gap-2">
        {ZONES.map((zone) => (
          <SeatHeatRow key={zone} zone={zone} />
        ))}
      </div>
    </Panel>
  )
}

const DOOR_LABEL: Record<DoorId, string> = {
  frontLeft: 'Front left',
  frontRight: 'Front right',
  rearLeft: 'Rear left',
  rearRight: 'Rear right',
}

const MIRROR_LABEL: Record<MirrorId, string> = {
  left: 'Left',
  right: 'Right',
}

/**
 * Windows, doors, mirrors, frunk/trunk, roof — in exactly that order.
 *
 * Windows and doors are two rows of four buttons in the same positional order,
 * so **every column is one door**: the top row is the window, the bottom row is
 * that same door's panel. Windows come first because they're tapped most
 * often, whereas opening a door is rare and a bigger deal.
 *
 * The frunk and trunk used to be floating labels attached to the front and
 * rear of the car in the left column. They were the only two buttons outside
 * the control panel, so opening either meant looking in a place where no other
 * button lives — and on a real car, opening the trunk is also a button on the
 * panel, not a touch on the body. Now they have their own row, right before
 * the roof row.
 *
 * Labels are **position names**, not action names. The previous version had
 * window labels change with state ("Lower window" / "Close window"), so four
 * adjacent buttons all read "Lower window" — with four identical-looking
 * buttons you had to count from the screen edge to know which window you were
 * tapping. State is already conveyed by the LED and the icon shape, and
 * `aria-label` still carries the full phrase "open, tap to close" for screen
 * readers. This also matches the climate switch grid on the left, where labels
 * are always names ("A/C", "Auto") rather than actions ("Turn on A/C").
 *
 * **These are real commands now.** Doors, windows, mirrors, frunk/trunk and
 * the sunroof are in `CarState` and have their own tools, so every button below
 * goes through `runCommand` like the climate buttons: a manual tap also
 * produces a `ToolResult`, also shows up in the debug panel, and voice calls
 * exactly these functions.
 *
 * Except **"Roof"** — hiding/showing the roof is a view mode, not a car part,
 * so it stays in `usePreviewStore` and has no tool. It's the only button here
 * that voice can't reach, and that's deliberate.
 */
function OpeningsControl() {
  const { doors, frunkOpen, mirrors, sunroof, trunkOpen, windows } =
    useCarStore()
  const roofHidden = usePreviewStore((state) => state.roofHidden)
  const onToggleRoof = usePreviewStore((state) => state.toggleRoof)
  const sunroofOpen = sunroof > 0
  const openWindows = DOORS.filter((door) => (windows[door] ?? 0) > 0).length

  return (
    <>
      <div className="space-y-2">
        <SectionLabel
          icon={<WindowIcon className="size-4" open={openWindows > 0} />}
          size="title"
        >
          Windows
        </SectionLabel>
        <div className="grid grid-cols-4 gap-2">
          {DOORS.map((door) => {
            const open = (windows[door] ?? 0) > 0
            return (
              <ToggleButton
                active={open}
                aria-label={`${DOOR_LABEL[door]} window: ${open ? 'open, tap to close' : 'closed, tap to open'}`}
                icon={<WindowIcon className="size-5" open={open} />}
                key={`window-${door}`}
                label={DOOR_LABEL[door]}
                onClick={() => runCommand((car) => car.setWindow(door, !open))}
              />
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel icon={<DoorIcon className="size-4" />} size="title">
          Doors
        </SectionLabel>
        <div className="grid grid-cols-4 gap-2">
          {DOORS.map((door) => {
            const open = doors[door] ?? false
            return (
              <ToggleButton
                active={open}
                aria-label={`${DOOR_LABEL[door]} door: ${open ? 'open, tap to close' : 'closed, tap to open'}`}
                icon={<DoorIcon className="size-5" />}
                key={door}
                label={DOOR_LABEL[door]}
                onClick={() => runCommand((car) => car.setDoor(door, !open))}
              />
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel
          icon={<MirrorIcon className="size-4" folded={false} side="left" />}
          size="title"
        >
          Mirrors
        </SectionLabel>
        <div className="grid grid-cols-4 gap-2">
          {MIRRORS.map((mirror) => {
            const folded = mirrors[mirror] ?? false
            return (
              <ToggleButton
                active={folded}
                aria-label={`${MIRROR_LABEL[mirror]} mirror: ${folded ? 'folded, tap to unfold' : 'open, tap to fold'}`}
                icon={
                  <MirrorIcon
                    className="size-5"
                    folded={folded}
                    side={mirror}
                  />
                }
                key={`mirror-${mirror}`}
                label={`${MIRROR_LABEL[mirror]} mirror`}
                onClick={() =>
                  runCommand((car) => car.setMirror(mirror, !folded))
                }
              />
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel
          icon={<HatchIcon className="size-4" end="rear" open={trunkOpen} />}
          size="title"
        >
          Cargo
        </SectionLabel>
        {/*
          The frunk and trunk are split off from the door grid: they aren't
          doors you get in and out through, and sharing a row would stretch the
          door row to six tiles, so the eye would have to count to tell which
          tiles are doors.
        */}
        <div className="grid grid-cols-4 gap-2">
          <ToggleButton
            active={frunkOpen}
            aria-label={`Frunk: ${frunkOpen ? 'open, tap to close' : 'closed, tap to open'}`}
            icon={<HatchIcon className="size-5" end="front" open={frunkOpen} />}
            label="Frunk"
            onClick={() =>
              runCommand((car) => car.setCargo('front', !car.frunkOpen))
            }
          />
          <ToggleButton
            active={trunkOpen}
            aria-label={`Trunk: ${trunkOpen ? 'open, tap to close' : 'closed, tap to open'}`}
            icon={<HatchIcon className="size-5" end="rear" open={trunkOpen} />}
            label="Trunk"
            onClick={() =>
              runCommand((car) => car.setCargo('rear', !car.trunkOpen))
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel
          icon={<SunroofIcon className="size-4" open={sunroofOpen} />}
          size="title"
        >
          Roof
        </SectionLabel>
        {/* Two things on top of the car, but of different kinds: one is a real
            car part, the other just a view mode — then again, both change
            exactly the patch of roof the user is looking at, so side by side
            is the right place to find them. */}
        <div className="grid grid-cols-4 gap-2">
          <ToggleButton
            active={sunroofOpen}
            aria-label={`Sunroof: ${sunroofOpen ? 'open, tap to close' : 'closed, tap to open'}`}
            icon={<SunroofIcon className="size-5" open={sunroofOpen} />}
            label="Sunroof"
            onClick={() =>
              runCommand((car) => car.setSunroof(!(car.sunroof > 0)))
            }
          />
          {/* A *show*-roof button, not a hide button: by default the roof is
              already cut away to look straight into the cabin, so the initial
              state has to be "not pressed" — LED off. Pressing it puts the
              roof back on and lights the button up. */}
          <ToggleButton
            active={!roofHidden}
            aria-label={`Roof: ${roofHidden ? 'hidden, tap to show' : 'shown, tap to hide and see into the cabin'}`}
            icon={<RoofIcon className="size-5" hidden={roofHidden} />}
            label="Roof"
            onClick={onToggleRoof}
          />
        </div>
      </div>
    </>
  )
}

/**
 * Right column: turn signals, windows, doors, mirrors, frunk/trunk, roof —
 * gathered into one block.
 *
 * **No more "Exterior" heading.** The six groups below — turn signals, windows,
 * doors, mirrors, frunk/trunk, roof — already say what they are, and all six
 * are clearly exterior parts of the car, so the heading only added a line of
 * text without telling anything apart from anything. Dropping it promotes the
 * group labels straight to heading level, on par with "Climate" and "Seat
 * heating" in the left column, and each group starts right at the panel's top
 * edge.
 */
function PreviewBlock() {
  const turnSignal = useCarStore((state) => state.turnSignal)

  return (
    <Panel className="space-y-4 p-4">
      <TurnSignalControl
        onChange={(signal) => runCommand((car) => car.setTurnSignal(signal))}
        signal={turnSignal}
      />
      <OpeningsControl />
    </Panel>
  )
}

/**
 * Wipers sit on their own at the foot of the left column; see the note in
 * `WiperControl`.
 */
function WiperBlock() {
  const wipers = useCarStore((state) => state.wipers)

  return (
    <WiperControl
      mode={wipers}
      onChange={(mode) => runCommand((car) => car.setWipers(mode))}
    />
  )
}

/**
 * The two columns are **unequal in width so they can be equal in height**, and
 * their bottoms are pulled level.
 *
 * The previous version split evenly and aligned `items-start`: the left column
 * measured 562px, the right 756px. Nearly 200px of difference meant a black
 * patch as tall as three rows of buttons under the left column, right in the
 * middle of the screen — neither margin nor content.
 *
 * Three changes fix it, and deliberately **not** a fourth one of trimming the
 * right column:
 *
 * 1. **5:6 tilts the width toward "Exterior"** — that's the squeezed block; it
 *    has three four-column grids while the climate grid has only three columns.
 *    Wider means shorter.
 * 2. **The left column stretches to match**, and the surplus height flows into
 *    the *climate block* — the six-tile grid grows until the tiles are square,
 *    then the fan speed meter takes up the rest.
 * 3. **The wipers move entirely to the left column** as a third panel. It's
 *    the cheapest block to move — one row of four buttons, unrelated to
 *    doors-windows or turn signals — so moving it removes a row on the right
 *    and adds one on the left at the same time, twice the gain of any
 *    stretching approach.
 *
 * Where the surplus goes **is a choice, not a technicality**. The first
 * version poured it into the seat heating block because it was the last block
 * in the column: the four "Off 1 2 3" tiles got stretched to 96px into four
 * slabs with small text floating in the middle, and the selected tile became a
 * solid orange patch the size of a fist. A four-level selector has a *right*
 * height, and taller than that doesn't make taps more accurate, just more
 * colorful. So the seat heating block is now `shrink-0`, and the surplus goes
 * to the two things that genuinely benefit from growing: the two-dimensional
 * tile grid, and a meter whose height is the very thing it speaks with.
 *
 * If the left column later ends up longer than the right, this mechanism stops
 * working on its own (nothing left to stretch) and the empty patch drops to the
 * foot of the right column — at that point `PreviewBlock` needs this same
 * treatment, rather than changing the ratio back.
 */
export function ClimateScreen() {
  return (
    <div className="grid w-full gap-3 @2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="flex flex-col gap-3">
        <ClimateBlock />
        <SeatHeatBlock />
        <WiperBlock />
      </div>
      <PreviewBlock />
    </div>
  )
}
