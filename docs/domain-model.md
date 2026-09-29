# Domain model: `CarState` + the tool surface

The eval suite (`src/eval/`) and the UI both build on this document.

Matching source code: `src/domain/car-state.ts`, `tools.ts`, `structural-tag.ts`, `tool-result.ts`. Vocabulary: `CONTEXT.md`.

## 1. `CarState`

| Field | Type | Notes |
|---|---|---|
| `screen` | `home` / `climate` / `settings` | **Three** screens |
| `temperature` | `{ driver, passenger }` | 14–30, step 1, default 20 |
| `fanSpeed` | `0..7` | `0` is off; no separate flag |
| `seatHeat` | `{ driver, passenger }` | `0..3` |
| `acOn`, `recirculationOn`, `frontDefrostOn`, `rearDefrostOn` | `boolean` |  |

**Two zones, not three.** The demo video shows separate left/right temperatures; `driver` + `passenger` is enough to force the "bên ghế phụ lạnh quá" ("the passenger side is too cold") case. The rear seats were dropped — that is a UI scope decision, not a model capability: the early spike measured Vietnamese zone recognition at 100% (including `ghế sau` → `rear`), so keeping `rear` buys no extra information. Consequence: the case `"Đặt nhiệt độ ghế sau 20 độ"` ("Set the rear seat temperature to 20 degrees") has to leave the eval set.

**No more `sync`, no more `autoOn`.** Both were removed: `sync` is a mechanical detail nobody says out loud (so it never had a tool), and auto mode was just a flag with no effect on the fan or the temperature. A command targeting one zone now touches only that zone, with no state breaking along with it.

**The `settings` screen is real, not a placeholder.** The model picker dropdown and the debug panel already demanded a place to live. Acknowledging it gives `navigate_to` three destinations instead of two — an enum with real pressure to discriminate.

**Drive modes and the control center are not in `CarState`.** There used to be a `src/domain/future-tools.ts` sketching schemas for those two groups, to prove the tool shape could handle them. That file is gone: no line of code imported it and no UI button matched any of its six tools, so it had become a second tool surface to maintain alongside the real one. Its conclusion — the three patterns `set_*` / `adjust_*` / toggle are enough, and no group needs more than 3 parameters — is kept here, where a conclusion belongs.

## 2. The tool surface — 11 tools

`set_temperature` · `adjust_temperature` · `set_fan_speed` · `adjust_fan_speed` · `set_seat_heat` · `set_ac` · `set_recirculation` · `set_defrost` · `navigate_to` · `tell_time` · `answer_in_words`

The `set_*` / `adjust_*` pair embodies one rule: an explicit number → absolute, vague → qualitative. Seat heating only has `set_` because a 0–3 scale is too short for `adjust` to mean anything.

### 2.1 Root decision: the enum describes a _feeling_, not the _movement of a number_

The only systematic failure mode of Qwen2.5-1.5B in the early spike: "Lạnh run rồi" ("I'm shivering") → `direction: "down"`. The model latched onto the keyword _lạnh_ (cold) and mapped it straight to _down_. The hot direction was correct, because there the keyword and the intent happen to coincide.

That is a **parameter naming bug, not a model bug**. `up`/`down` describe the number; what the user says describes a feeling. Hence:

| Tool | enum |
|---|---|
| `adjust_temperature` | `warmer` / `cooler` |
| `adjust_fan_speed` | `stronger` / `weaker` |
| (extension) `adjust_steering_weight` | `heavier` / `lighter` |

The general rule when adding a new `adjust_*` tool: **the enum is the state the user wants to reach.**

### 2.2 `answer_in_words`, not `unsupported`

`at_least_one: true` forces the model to always call a tool, so out-of-scope utterances need an escape hatch. But small models avoid tools that sound like admitting defeat — in the early spike, under the name `unsupported`, it still failed ("Mấy giờ rồi" — "What time is it" → `navigate_to`). Naming it after an action lets it compete on equal terms.

This is an **unverified hypothesis**. The eval suite measures it; prompt work tunes the wording.

### 2.3 The "mở" (open) vs "bật" (turn on) boundary

- **"Mở điều hoà"** ("open the climate") → `navigate_to{screen: "climate"}` (navigation)
- **"Bật điều hoà"** ("turn on the A/C") → `set_ac{on: true}` (state change)

The early spike already showed this case passes with one-line tool descriptions — no elaborate design needed. But both tools' descriptions must mention the boundary, and `tools.ts` does.

**Adjusting the temperature turns the A/C on.** `set_temperature` and `adjust_temperature` turn `acOn` on if it is off, and `ToolResult` carries `acTurnedOn` so the reply says "Đã bật điều hoà, …" ("Turned on the A/C, …"). Reason: "bật điều hoà 20 độ" ("turn on the A/C, 20 degrees") carries two intents, and the model (measured on `gpt-4.1-mini`, 3/3 runs) only calls `set_temperature` — a rule that lives in TypeScript holds for every model, on-device included. The cost: you can no longer adjust the temperature while the A/C is off, not even with the ± buttons on screen. Exception: if the utterance asks to turn the A/C off (`set_ac` with `on: false`, e.g. "tắt điều hoà rồi để 22 độ" — "turn off the A/C and set 22 degrees"), the temperature command in the same turn does **not** turn the A/C on — the explicit off wins, regardless of the order in which the model calls the tools.

### 2.4 Open: merging the toggles

`set_ac` / `set_recirculation` are nearly identical and compete for the attention of a 1.5B model. Merging them into `set_climate_feature(feature, on)` would leave 10 tools. We chose **not to merge** (a tool name is a stronger signal than an enum value), but this is **a variant for the eval suite to measure**, not something to keep debating.

## 3. Magnitude → number

All arithmetic lives in TypeScript. The model only states the direction and the magnitude.

| `magnitude` | temperature | fan |
|---|---|---|
| `slight` | 1 °C | 1 step |
| `normal` (default) | 2 °C | 2 steps |
| `large` | 4 °C | to the edge (0 or 7) |

For the fan, "hết cỡ" ("all the way") is literal, so `large` hits the edge; for temperature, 4 °C is still a noticeable jump without slamming straight down to 14.

Defaults when the model leaves them empty: `magnitude = normal`, `zone = both`. Someone saying "nóng quá" ("so hot") does not mean "just my side".

## 4. Clamp

At the edge, **clamp silently at the state layer, but return `clamped: true`**. Whatever state can change does change; the trace lets the code-generated reply say "đã ở mức thấp nhất rồi" ("already at the lowest level").

We did not choose "suggest another action" — that is multi-turn dialogue, which was out of scope for this design.

**Deliberately no `minimum`/`maximum` in the JSON Schema**, even though XGrammar really does enforce them for `integer`. If the grammar silently bent "35 độ" (35 degrees) back into range, we would lose the ability to tell "the model misunderstood" from "the user asked for the impossible". The grammar handles syntax; the code handles semantics; Zod is the checkpoint between them.

## 5. Return value

A discriminated union on `kind`: `numeric` · `toggle` · `navigation` · `spoken` · `rejected`. Details in `tool-result.ts`.

The code-generated reply is a `switch` over this union — TypeScript forces every branch to be handled. A flat object with `undefined` fields turns that into a chain of `if`s nobody can check.

## 6. Constraints from `structural_tag`

Measured and researched in the early spike; constraints, not options.

1. **Two-level nested shape**: `response_format.structural_tag.format`, `format.type = "triggered_tags"`. The flat `{ type, tags, triggers }` is the legacy API and does not work through web-llm.
2. **`at_least_one: true`.** With `false`, Qwen produced 0/15 syntactically valid outputs — `triggered_tags` only constrains what follows a trigger, and nothing forces the model to emit the trigger. With `true`: 15/15.
3. **`stop_after_first: true`** — matches exactly the measured configuration. Switching to `false` opens the way to several tool calls per utterance (a secondary goal) but invalidates the 14/15 figure. To change it, re-measure with the eval suite first.
4. **Property order is enforced.** `@mlc-ai/web-xgrammar` 0.1.27 generates the grammar in exactly the declaration order of `properties`, and **has no** `any_order` flag (the docs on `main` do; the pinned version doesn't yet). Convention: **required first, optional after**. Reversing the order makes the grammar reject valid output.
5. **The tool name lives in `begin`, not in the schema.** So the grammar does not let the model invent tool names — the early spike confirmed 0 invented names. `json_schema` only describes the `arguments` object.
6. **The schema does not go into the system prompt** — only `name` + `description`. So the description must also name the parameters.
7. **WebLLM does not parse the structural tag into `message.tool_calls`.** The result sits in `choices[0].message.content` as text; regex it out yourself (`parseToolCalls`).
8. `oneOf` is handled exactly like `anyOf` in this version — don't rely on exclusive semantics. The current tool table doesn't use it.

## 7. Warning for prompt work

Intent hints **inside a tool's `description`** are good — a prompt with just two intent-hint sentences in the system prompt reached 14/15. **Full dialogue examples, especially refusal examples**, backfire badly: a prompt with full examples dropped to 5/15 because Qwen imitated the refusal examples and turned 11/15 utterances into small talk. Don't re-measure from scratch.
