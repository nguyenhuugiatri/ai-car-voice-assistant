/**
 * Wipers: three levels — Intermittent, Slow, Fast — one illustrated button per
 * level. Tapping the running level again turns it off, like twisting the wiper
 * stalk back to `0`.
 *
 * **No separate "Off" tile.** The cost: when the wipers are off no button is
 * lit, so this block doesn't say "off" by itself — you have to infer it from
 * nothing being on, and the way to turn off (tap again) isn't apparent from the
 * button shapes. In return the three levels get wider and the block loses a
 * column. If users turn out to hunt for the off switch, the cheapest fix is a
 * `hint` in the header ("Off" / "Fast"), not rebuilding a fourth tile.
 *
 * The first version shared the level bar with fan speed: four rising bars, with
 * the mode name in the header's right corner. It was wrong because **wipers
 * have no magnitude**. "Intermittent" and "Slow" are two different kinds of
 * wiping, not two levels of the same thing.
 *
 * The next version split it into four named buttons — more correct, but still
 * **four text tiles**: four words side by side have to be read before you can
 * choose, and reading means taking your eyes off the road. Real cars don't
 * make you read — the stalk is printed with `I / II / III` and the instrument
 * cluster draws the very wiper that's running; Tesla, after years of criticism
 * for burying the wipers in the touchscreen, also uses that same row of ticks
 * rather than words.
 *
 * So now each button is **glass + wiper arm + as many ticks as the level
 * number**, and the selected button has its arm sweeping at that level's exact
 * rhythm (`WiperModeIcon`, same `WIPER_TIMING` as the two wiper arms on the
 * car picture). The text name stays under the icon: it costs no extra glance
 * but gives a foothold to people not yet used to the symbols, and it's what
 * screen readers read out.
 *
 * The button is also exactly the kind of button the doors, windows and mirrors
 * in the "Exterior" panel use, so the whole screen is down to **one** button
 * style instead of two.
 *
 * Wipers are part of `CarState` and have a `set_wipers` tool, so these three
 * buttons go through `runCommand` — saying "bật gạt mưa" ("turn on the
 * wipers") lights up this same button.
 *
 * This is the **last panel of the left column**, no longer a sub-group of the
 * "Exterior" block. It used to sit on the right with the turn signals and
 * doors/windows, but the right column was carrying three button grids while the
 * left only had climate and seat heating — moving it here makes the two columns
 * nearly equal without trimming anything.
 */

import { WIPER_LABEL, WIPER_MODES, type WiperMode } from './car-visuals'
import { WiperIcon, WiperModeIcon } from './car-icons'
import { Panel, SectionLabel, ToggleButton } from './ui-bits'

/** The three wiping levels. `off` has no button of its own — it's "no level on". */
const RUNNING_MODES = WIPER_MODES.filter((mode) => mode !== 'off')

export function WiperControl({
  mode,
  onChange,
}: {
  mode: WiperMode
  onChange: (mode: WiperMode) => void
}) {
  return (
    <Panel className="shrink-0 space-y-3 p-4">
      <SectionLabel icon={<WiperIcon className="size-4" />} size="title">
        Wipers
      </SectionLabel>
      {/* `group` rather than `radiogroup`: `ToggleButton` conveys state via
          `aria-pressed`, and `aria-pressed` isn't allowed on `role="radio"`.
          Three mutually exclusive buttons still read correctly — each is a
          switch, and at most one is on. */}
      <div
        aria-label="Wiper mode"
        className="grid grid-cols-3 gap-2"
        role="group"
      >
        {RUNNING_MODES.map((option) => {
          const on = option === mode
          return (
            <ToggleButton
              active={on}
              aria-label={`${WIPER_LABEL[option]}: ${on ? 'wiping, tap to turn off' : 'tap to turn on'}`}
              icon={
                <WiperModeIcon
                  // One step larger than the other groups' icons: it carries
                  // more information (glass frame, arm, level ticks), so at
                  // 24px the ticks blur together into a grey smudge.
                  className="size-7"
                  // `key` by the selected level: changing level restarts the
                  // arm from rest, rather than cutting the old level's stroke
                  // mid-way.
                  key={mode}
                  mode={option}
                  running={on}
                />
              }
              key={option}
              label={WIPER_LABEL[option]}
              onClick={() => onChange(on ? 'off' : option)}
            />
          )
        })}
      </div>
    </Panel>
  )
}
