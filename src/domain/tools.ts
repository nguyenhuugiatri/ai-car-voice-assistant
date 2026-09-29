/**
 * The tool surface — 20 tools, each with ≤ 3 parameters, named with verbs.
 *
 * `TOOL_NAMES` below is the real count; this comment only repeats it. If you
 * change the list, change this sentence too — don't let two places state two
 * different numbers.
 *
 * Two hard constraints when editing this file:
 *
 * 1. **Property order in `properties` is enforced by the grammar.**
 *    `@mlc-ai/web-xgrammar` 0.1.27 (the version web-llm 0.2.85 pins) generates
 *    the grammar in exact declaration order and has NO `any_order` flag.
 *    Optional params may be missing, but those present must be in order.
 *    Convention: required first, optional after.
 * 2. **`description` is the only channel through which the model knows what a
 *    tool does.** The schema isn't put into the system prompt — the grammar
 *    handles syntax, the prompt handles semantics. So the description must
 *    name the parameters too.
 *
 * Warning for prompt work: intent hints *inside the description* are good
 * (the two-intent-hint prompt reached 14/15). Full conversational examples
 * — especially refusal examples — backfire badly (the few-shot prompt with
 * refusal examples dropped to 5/15). Don't try it again.
 */

import {
  CARGO_TARGETS,
  DEFROST_TARGETS,
  DOOR_TARGETS,
  FAN_DIRECTIONS,
  MIRROR_TARGETS,
  TURN_SIGNALS,
  WIPER_MODES,
  FAN_SPEED_RANGE,
  MAGNITUDES,
  MUSIC_ACTIONS,
  SCREENS,
  SEAT_HEAT_RANGE,
  TEMPERATURE_DIRECTIONS,
  TEMPERATURE_RANGE,
  TIME_QUERIES,
  ZONE_TARGETS,
} from './car-state'

/**
 * The list of tool names, declared as literals.
 *
 * Deliberately NOT derived from `TOOLS.map(t => t.name)`: that gives
 * `ToolName = string`, and then `Expected.tool` in `src/eval/cases.ts` accepts
 * any string — exactly the silent trap the eval's typed expectations are
 * meant to block (an early utterance set kept `rear` and `up`/`down` after the
 * tool surface removed both, and nothing complained).
 *
 * To add or remove a tool, edit here first; `TOOLS` below won't compile if they diverge.
 */
export const TOOL_NAMES = [
  'set_temperature',
  'adjust_temperature',
  'set_fan_speed',
  'adjust_fan_speed',
  'set_seat_heat',
  'set_ac',
  'set_recirculation',
  'set_defrost',
  'set_window',
  'set_door',
  'set_mirror',
  'set_sunroof',
  'set_cargo',
  'set_turn_signal',
  'set_wipers',
  'navigate_to',
  'tell_time',
  'control_music',
  'play_music',
  'answer_in_words',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/**
 * Tools that do NOT touch `CarState` — they answer, switch screens, or control
 * music (music lives in `useMusicStore`, not in the car's state).
 */
const READ_ONLY_TOOLS = new Set<ToolName>([
  'navigate_to',
  'tell_time',
  'control_music',
  'play_music',
  'answer_in_words',
])

/** Tools that actually touch `CarState`. The eval's `FP` column counts exactly this set. */
export const STATE_CHANGING_TOOLS = TOOL_NAMES.filter(
  (
    name,
  ): name is Exclude<
    ToolName,
    | 'navigate_to'
    | 'tell_time'
    | 'control_music'
    | 'play_music'
    | 'answer_in_words'
  > => !READ_ONLY_TOOLS.has(name),
)

/** JSON Schema for the `arguments` object, in the subset XGrammar actually enforces. */
export type ArgumentsSchema = {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required: string[]
  additionalProperties: false
}

/**
 * A tool. Its name **must** be in `TOOL_NAMES`.
 *
 * There used to also be a `ToolShape` — same shape but with a free-form
 * `name: string` — for two things now deleted: `future-tools.ts`
 * (unimplemented tools) and the eval's merged tool set (which emitted
 * `set_climate_feature`). Nothing needs names outside `TOOL_NAMES` anymore, so
 * the looser type went too: every function that takes `tools` now only takes
 * tools with declared names, and a made-up name is a compile error rather
 * than an `invalid` row in the eval table.
 */
export type ToolDefinition = {
  name: ToolName
  description: string
  schema: ArgumentsSchema
}

const zoneProperty = {
  type: 'string',
  enum: [...ZONE_TARGETS],
  description: "Which side of the cabin. Defaults to 'both' when omitted.",
} as const

const magnitudeProperty = {
  type: 'string',
  enum: [...MAGNITUDES],
  description: "How big a change. Defaults to 'normal' when omitted.",
} as const

/**
 * Deliberately NO `minimum`/`maximum`, even though XGrammar does enforce them.
 * If the grammar forced "35 độ" ("35 degrees") into range on its own, we'd
 * lose the ability to tell "the model misunderstood" from "the user asked for
 * the impossible". Clamping is TypeScript's job, and it must leave a trace
 * (`clamped`).
 */
export const TOOLS: ToolDefinition[] = [
  {
    name: 'set_temperature',
    description:
      `Set the climate temperature to an exact number the user said. Arguments: value (integer °C, ` +
      `nominal range ${TEMPERATURE_RANGE.min}–${TEMPERATURE_RANGE.max}), zone (optional). ` +
      `Vietnamese commands sound like "để 22 độ" or "chỉnh điều hoà lên 25 độ".`,
    schema: {
      type: 'object',
      properties: {
        value: { type: 'integer', description: 'Target temperature in °C.' },
        zone: zoneProperty,
      },
      required: ['value'],
      additionalProperties: false,
    },
  },
  {
    name: 'adjust_temperature',
    description:
      `Make the cabin warmer or cooler when the user describes a FEELING rather than a number. ` +
      `Arguments: direction ('warmer' if the user feels cold, 'cooler' if the user feels hot), ` +
      `magnitude (optional), zone (optional). Vietnamese commands sound like "nóng quá" (cooler), ` +
      `"lạnh run rồi" (warmer), "ấm hơn chút" (warmer, slight).`,
    schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: [...TEMPERATURE_DIRECTIONS],
          description:
            'The state the user wants to reach, not the direction the number moves.',
        },
        magnitude: magnitudeProperty,
        zone: zoneProperty,
      },
      required: ['direction'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_fan_speed',
    description:
      `Set the blower to an exact level. Arguments: value (integer ${FAN_SPEED_RANGE.min}–${FAN_SPEED_RANGE.max}, ` +
      `where ${FAN_SPEED_RANGE.min} turns the blower off). Vietnamese commands sound like ` +
      `"để quạt số 3" or "tắt quạt" (value 0).`,
    schema: {
      type: 'object',
      properties: {
        value: { type: 'integer', description: 'Blower level; 0 is off.' },
      },
      required: ['value'],
      additionalProperties: false,
    },
  },
  {
    name: 'adjust_fan_speed',
    description:
      `Make the airflow stronger or weaker when the user describes a feeling rather than a level. ` +
      `Arguments: direction ('stronger' or 'weaker'), magnitude (optional). Vietnamese commands ` +
      `sound like "gió mạnh quá" (weaker) or "quạt to lên" (stronger).`,
    schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: [...FAN_DIRECTIONS],
          description: 'The airflow the user wants to reach.',
        },
        magnitude: magnitudeProperty,
      },
      required: ['direction'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_seat_heat',
    description:
      `Set seat heating level. Arguments: level (integer ${SEAT_HEAT_RANGE.min}–${SEAT_HEAT_RANGE.max}, ` +
      `where ${SEAT_HEAT_RANGE.min} is off), zone (optional). Vietnamese commands sound like ` +
      `"bật sưởi ghế" (level 2) or "tắt sưởi ghế lái" (level 0, zone driver).`,
    schema: {
      type: 'object',
      properties: {
        level: {
          type: 'integer',
          description: 'Seat heating level; 0 is off.',
        },
        zone: zoneProperty,
      },
      required: ['level'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_ac',
    description:
      `Turn the air conditioning compressor on or off. Arguments: on (boolean). Vietnamese commands ` +
      `sound like "bật điều hoà" (on) or "tắt điều hoà" (off). Note: "MỞ điều hoà" usually means ` +
      `showing the climate screen — use navigate_to for that.`,
    schema: {
      type: 'object',
      properties: { on: { type: 'boolean' } },
      required: ['on'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_recirculation',
    description:
      `Turn cabin air recirculation on or off. Arguments: on (boolean). Vietnamese commands sound ` +
      `like "bật lấy gió trong" (on) or "lấy gió ngoài đi" (off).`,
    schema: {
      type: 'object',
      properties: { on: { type: 'boolean' } },
      required: ['on'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_defrost',
    description:
      `Turn window defrost on or off. Arguments: target ('front', 'rear' or 'both'), on (boolean). ` +
      `Vietnamese commands sound like "sấy kính trước" or "bật sưởi kính sau".`,
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: [...DEFROST_TARGETS] },
        on: { type: 'boolean' },
      },
      required: ['target', 'on'],
      additionalProperties: false,
    },
  },
  /* -------------------------------------------------------------------- */
  /* Body — seven tools built from the buttons on the climate screen      */
  /* -------------------------------------------------------------------- */

  /**
   * The seven tools below map 1-to-1 onto the six button groups in the right
   * block of the climate screen (turn signal, windows, doors, mirrors,
   * trunks, roof) plus the wipers panel at the foot of the left column. If a
   * button can be pressed, it can be spoken — that's the boundary, not a
   * wish list.
   *
   * Exactly one button has **no** tool: "Mui xe" ("Roof"). It hides/shows the
   * roof to look into the cabin — a view mode of the simulator, not a car
   * part; no car can "bật ẩn mui" ("turn on roof hiding"), so it stays in
   * `usePreviewStore` and voice doesn't touch it.
   *
   * Merge or split, by the rule that the tool name is a stronger signal than
   * an enum value: split by **part** (doors vs. windows vs. mirrors), merge by
   * **position** (four doors are one enum parameter, not four tools). That
   * boundary is also the one speakers use: "hạ kính" ("lower the window") is
   * one action, "hạ kính sau trái" ("lower the rear-left window") is the same
   * action stated more precisely.
   */
  {
    name: 'set_window',
    description:
      `Roll a side window down or up. Arguments: open (boolean — true lowers the glass), ` +
      `door (optional, which window; defaults to all four). Vietnamese commands sound like ` +
      `"hạ kính xuống" (open true), "đóng kính lại" (open false), ` +
      `"hạ kính bên tôi" (open true, door frontLeft).`,
    schema: {
      type: 'object',
      properties: {
        open: { type: 'boolean' },
        door: {
          type: 'string',
          enum: [...DOOR_TARGETS],
          description:
            "Which window. Defaults to 'all' (all four) when omitted.",
        },
      },
      required: ['open'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_door',
    description:
      `Unlatch or close a passenger door — the door itself, not its window. Arguments: ` +
      `open (boolean), door (optional when closing; defaults to all four). Opening needs a ` +
      `named door: "mở cửa lái" (open true, door frontLeft), "mở hết cửa" (open true, door all). ` +
      `"đóng cửa" (open false) closes all four.`,
    schema: {
      type: 'object',
      properties: {
        open: { type: 'boolean' },
        door: {
          type: 'string',
          enum: [...DOOR_TARGETS],
          description:
            "Which door. Defaults to 'all' when omitted, but only when closing.",
        },
      },
      required: ['open'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_mirror',
    description:
      `Fold the wing mirrors in against the body, or unfold them back out. Arguments: ` +
      `folded (boolean — true folds them in), mirror (optional; defaults to both). ` +
      `Vietnamese commands sound like "gập gương lại" (folded true), ` +
      `"mở gương ra" (folded false), "gập gương phải" (folded true, mirror right).`,
    schema: {
      type: 'object',
      properties: {
        folded: { type: 'boolean' },
        mirror: {
          type: 'string',
          enum: [...MIRROR_TARGETS],
          description: "Which mirror. Defaults to 'both' when omitted.",
        },
      },
      required: ['folded'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_sunroof',
    description:
      `Open or close the glass roof panel above the cabin. Arguments: open (boolean). ` +
      `Vietnamese commands sound like "mở cửa sổ trời" (open true) or ` +
      `"đóng cửa sổ trời lại" (open false).`,
    schema: {
      type: 'object',
      properties: { open: { type: 'boolean' } },
      required: ['open'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_cargo',
    description:
      `Open or close a luggage compartment: the tailgate at the back or the storage well ` +
      `under the bonnet. Arguments: target ('front' for the bonnet well, 'rear' for the ` +
      `tailgate, 'both'), open (boolean). Vietnamese commands sound like "mở cốp" (rear, ` +
      `open true — an unqualified cốp is the rear one), "mở cốp trước" (front, open true).`,
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: [...CARGO_TARGETS] },
        open: { type: 'boolean' },
      },
      required: ['target', 'open'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_turn_signal',
    description:
      `Work the indicator stalk or the hazard switch. Arguments: signal ('left', 'right', ` +
      `'hazard' for all four flashing together, 'off' to cancel). Vietnamese commands sound ` +
      `like "xi nhan trái" (left), "bật đèn khẩn cấp" (hazard), "tắt xi nhan" (off).`,
    schema: {
      type: 'object',
      properties: { signal: { type: 'string', enum: [...TURN_SIGNALS] } },
      required: ['signal'],
      additionalProperties: false,
    },
  },
  {
    /**
     * The four settings are **four wiping styles**, not four steps on one
     * scale — so this is `set_wipers(mode)` with an enum, not a
     * `set_`/`adjust_` pair like the fan. "Ngắt quãng" ("intermittent") and
     * "chậm" ("low") sweep at the same speed and differ only in the pause;
     * asking for "mạnh hơn" ("stronger") between those two is meaningless.
     */
    name: 'set_wipers',
    description:
      `Set the windscreen wipers. Arguments: mode ('off', 'intermittent' for a slow sweep ` +
      `with a long pause, 'low' for steady sweeping, 'high' for fast). Vietnamese commands ` +
      `sound like "bật gạt mưa" (low), "gạt mưa nhanh lên" (high), "tắt gạt mưa" (off), ` +
      `"cho gạt mưa chạy ngắt quãng" (intermittent).`,
    schema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: [...WIPER_MODES] } },
      required: ['mode'],
      additionalProperties: false,
    },
  },

  {
    name: 'navigate_to',
    description:
      `Show a different screen. Arguments: screen ('home', 'climate' or 'settings'). Vietnamese ` +
      `commands sound like "mở điều hoà" (climate — showing the screen, NOT turning the A/C on), ` +
      `"về màn hình chính" (home), "cho tôi xem phần cài đặt" (settings).`,
    schema: {
      type: 'object',
      properties: { screen: { type: 'string', enum: [...SCREENS] } },
      required: ['screen'],
      additionalProperties: false,
    },
  },
  {
    /**
     * The clock is something the car **really has** — `new Date()` is right
     * at hand. Before this tool, "mấy giờ rồi" ("what time is it") had to go
     * through `answer_in_words` and end in an apology for a perfectly
     * answerable question; that was both a wrong answer and something that
     * skewed `answer_in_words` into a "refusal tool".
     *
     * The model only chooses *what* is asked; formatting the sentence is
     * `say.ts`'s job — replies are built by code, not by the model.
     */
    name: 'tell_time',
    description:
      `Tell the driver what time it is or what today's date is. The car reads its own clock, ` +
      `so this is a real answer. Arguments: what ('time' for the clock, 'date' for the ` +
      `calendar day and weekday, 'both' when the driver asks for both). Vietnamese questions ` +
      `sound like "mấy giờ rồi" (time), "hôm nay ngày bao nhiêu" (date), ` +
      `"hôm nay thứ mấy" (date).`,
    schema: {
      type: 'object',
      properties: { what: { type: 'string', enum: [...TIME_QUERIES] } },
      required: ['what'],
      additionalProperties: false,
    },
  },
  {
    /**
     * Music without searching: play, pause, skip, turn off. The parameter is
     * an enum, so it's allowed Vietnamese examples like every other control
     * tool.
     *
     * Split from `play_music` precisely because of that: merged into one tool
     * with a free-form `query`, the example "bật nhạc" ("play music") would
     * leak into `query` — the same bug documented at length in
     * `answer_in_words` below.
     */
    name: 'control_music',
    description:
      `Control the music player without searching. Arguments: action ('play' to start or ` +
      `resume the current song, 'pause', 'next' for the next song, 'previous' for the ` +
      `previous song, 'off' to stop the music and hide the player). Vietnamese commands ` +
      `sound like "bật nhạc lên" (play), "dừng nhạc một chút" (pause), "qua bài khác" ` +
      `(next), "quay lại bài trước" (previous), "tắt nhạc đi" (off).`,
    schema: {
      type: 'object',
      properties: { action: { type: 'string', enum: [...MUSIC_ACTIONS] } },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    /**
     * Search YouTube, then play. **The description has no Vietnamese at all**
     * — `query` is a free-form string, same constraint as `answer_in_words`
     * (see the note there).
     */
    name: 'play_music',
    description:
      `Search for music and play it. Use only when the driver names what to play: a song ` +
      `title, an artist, or a genre or mood. To just start, pause or skip music without ` +
      `naming anything, use control_music. Arguments: query — the song, artist or genre ` +
      `exactly as the driver said it, without the words asking to play.`,
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "What to search for, in the driver's own words.",
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    /**
     * Not named `unsupported`. Since `at_least_one: true` forces the model to
     * always call a tool, this tool is the only escape hatch for out-of-scope
     * utterances — and small models shy away from tools that sound like
     * admitting defeat. It's named after an action so it competes on equal
     * footing with navigate_to.
     *
     * **This description must NOT contain a single Vietnamese word.** This
     * constraint cost us three rounds to learn, so don't loosen it:
     *
     * 1. *Negation.* The first version said `Never echo the driver's words
     *    back: for "mấy giờ rồi", reason is "…"`. The 0.6B model can't handle
     *    negation — what it picked up was the surface *echo the driver's
     *    words back*.
     * 2. *Repeated string.* `"mấy giờ rồi"` ("what time is it") appeared
     *    twice, while every other Vietnamese string in the whole prompt
     *    appeared once. Ask for "làm một bài thơ" ("write a poem") and the
     *    car read out "mấy giờ rồi" — the most-repeated string wins.
     * 3. *Removing the repetition still wasn't enough.* With both bugs above
     *    fixed and the examples replaced by three new, non-overlapping
     *    strings, rerun: asking "mấy giờ rồi" produced `reason`
     *    `"hát cho tôi nghe đi"` ("sing me something") — exactly the first
     *    example of the just-fixed version.
     *
     * Conclusion after round three: the problem is neither *repetition* nor
     * *negation*. It's that **any Vietnamese string** in the description of
     * the tool the model just picked becomes a candidate for a free-form
     * `string` parameter. The grammar forces it to fill in `reason`, and the
     * nearest Vietnamese in sight is this very tool's example.
     *
     * So this tool routes **in English only**. It's the fallback tool and
     * `PREAMBLE` already points straight at it, so it doesn't need Vietnamese
     * examples to get picked — while every other tool keeps its examples,
     * because their parameters are enums and numbers, with no room for a
     * free-form string to fall into.
     */
    name: 'answer_in_words',
    description:
      `Reply with words instead of touching the car. This is the tool for anything this car ` +
      `cannot do: the weather, traffic, the news, phone calls, jokes, ` +
      `small talk, and any question the car has no instrument to answer. Arguments: reason — ` +
      `one short sentence answering the driver, written in Vietnamese, in the assistant's ` +
      `own voice.`,
    schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description:
            "The assistant's Vietnamese reply, addressed to the driver.",
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
]

/**
 * Quick lookup table. `Object.fromEntries` loses the type so we have to cast —
 * and since we cast, add a runtime check: `TOOL_NAMES` catches **extra**
 * names, only this place catches **missing** ones (a name declared but its
 * tool definition forgotten).
 */
export const TOOLS_BY_NAME = Object.fromEntries(
  TOOLS.map((tool) => [tool.name, tool]),
) as Record<ToolName, ToolDefinition>

const missingTools = TOOL_NAMES.filter((name) => !TOOLS_BY_NAME[name])
if (missingTools.length > 0) {
  throw new Error(
    `TOOL_NAMES declares names with no definition: ${missingTools.join(', ')}`,
  )
}
