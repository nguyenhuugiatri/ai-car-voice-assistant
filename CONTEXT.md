# Ubiquitous language

The project's glossary. It holds only the meaning of words — no technical decisions, and it is not a spec.

## Car state

**CarState** — The whole simulated state of the head unit at a point in time. The single source of truth that the UI reads and tools write.

**Zone** — One side of the cabin with its own temperature. Exactly two zones: `driver` and `passenger`. `both` is not a third zone but a way of targeting both at once.

**Sync** — The state where the two zones are tied to the same temperature. While on, adjusting one zone drags the other along. It turns itself off when a command targets one zone by name. The user does not turn it on or off directly by voice.

**Screen** — The screen currently shown. Exactly three: `home` (icon grid), `climate` (climate control), `settings` (model picker + debug panel).

**Seat heat** — Seat heating, a discrete scale `0..3` per zone. `0` is off.

**Fan speed** — Fan strength, scale `0..7`. `0` is off; there is no separate on/off flag.

## Easily confused boundaries

**"Mở điều hoà"** ("open the climate") — Switches the screen to `climate`. A **navigation** action.

**"Bật điều hoà"** ("turn on the A/C") — Turns on the A/C compressor. A **state change** action.

In everyday Vietnamese these two sentences are near-synonyms, but they are entirely different actions. The domain model must tell them apart by **tool name**, not rely on the model inferring it from context.

## Talking to the car

**Push-to-talk** — Opens the mic for exactly one utterance: press, speak, and the mic closes itself on the first final result. One press is one command.

**Conversation mode** — The mic stays open: listen → think → speak → listen again, with no touch needed between turns. It is not "push-to-talk on repeat", because it has two things the other lacks: the machine has to decide on its own **when the user has finished speaking**, and the car **speaks its reply aloud**.

**Turn** — One listen-think-speak cycle. Turn boundaries are decided by `evaluateEndpoint`, not by the user pressing anything.

**Endpoint** — The decision "the user has finished speaking". It relies first on Vietnamese **sentence-final particles**; the silence timer is only a backstop ceiling: "bật điều hoà đi" ("turn on the A/C, go on") is already complete, so it is endpointed after ~250 ms, while "cho tôi…" ("give me…") waits up to 1.3 s.

**Barge-in** — Speaking over the car while it is talking makes it stop talking. **On** by default: it is the only way to cut off a long answer. The cost: the car speaker sits close to the mic, so the echo of its own voice can make the car interrupt itself.

## Commands and tools

**Tool** — An action that speech can trigger. Its name is always a verb. No more than three parameters.

**Absolute command** — An utterance containing an explicit number ("22 độ", "22 degrees"). Maps to a `set_*` tool.

**Qualitative command** — An utterance that only states a direction and an intensity ("nóng quá" — "so hot", "ấm hơn chút" — "a bit warmer"). Maps to an `adjust_*` tool.

**Direction** — The state the speaker wants to reach, not the direction the number moves. Temperature: `warmer` / `cooler`. Fan: `stronger` / `weaker`. The distinction is essential, not a naming preference: someone saying "lạnh quá" ("so cold") is describing _how they feel right now_, and what they mean is the opposite of the keyword they used.

**Magnitude** — The intensity of a qualitative command: `slight`, `normal`, `large`. The model only states the intensity; converting it into a concrete number always happens in TypeScript code, never in the model.

**Clamped** — The outcome of a command that hit the edge of a value's range. The state still changes up to the edge; the event is recorded so the reply says exactly what happened.

**Configuration** — A `(model, tool set, prompt)` triple. It is the unit the eval suite scores. "Which model is better" is shorthand; what can actually be compared is always a configuration, because changing the prompt changes the score too.

**Register** — The tone of an utterance: `formal` (bookish) or `colloquial`. It cuts across every intent type rather than being a type of its own — "nóng vãi" ("hot as hell") and "Giảm nhiệt độ" ("Lower the temperature") are both qualitative commands, just in different registers. Split out so we can measure how many points a model loses when people talk like real people.

**False positive** — An utterance that only needed an answer in words but made the car **change state**. A different _kind_ of error from scoring the wrong tool, not a more severe degree of it: it is the car doing something nobody asked for. The reverse — answering in words when it should have acted — is far milder.

**Direction-flip** — Returning `warmer` when it should be `cooler` (or vice versa). The systematic failure mode of small models: latching onto the keyword _lạnh_ (cold) in "lạnh quá" and ignoring that the speaker is describing how they feel right now. Counted separately because it is the test of the enum naming choice itself.

**Out of scope** — An utterance that matches no action of the car ("mấy giờ rồi" — "what time is it"). The correct result is calling `answer_in_words` — **answering in words** — not staying silent, and not calling the closest tool. The grammar forces every turn to end in a tool call, so "do nothing" is itself an action that has to be named.
