# Light, version 1

Status: **accepted**. Why it works this way is recorded in [ADR 0001](../adr/0001-architecture.md). The hardware is described in [`docs/reference/hardware.md`](../reference/hardware.md); the settings named here are read and changed through the [command protocol](../protocol/protocol-v1.md).

This document specifies what the board's LED shows: the channels and their PWM, the brightness curve, the power limit, the effects, the fades, the timer, the favorites and the behavior at boot. Every rule is a function of the settings and of time, so the simulator and the tests reproduce the board exactly.

## Channels

| Color   | GPIO | Full-scale LED power |
| ------- | ---- | -------------------- |
| `red`   | 3    | 610 mW               |
| `green` | 4    | 870 mW               |
| `blue`  | 5    | 870 mW               |
| `white` | 10   | 870 mW               |

- Every channel is PWM, active high, on its own LEDC channel, all on one timer.
- **PWM:** 1,000 Hz, 14 bits: a duty from 0 to 16,383. Firmware constants, not settings. The board writes a duty of 16,383 as 16,382: Arduino's `ledcWrite` turns the top value into 2^14 for "full on", which the ESP32-C3 outputs much dimmer than 16,382 (measured on the wired unit). The engine, the simulator and the conformance cases keep 16,383.
- **One color at a time.** The engine lights at most one channel at any moment; the others have duty 0.
- The full-scale power is the LED power at duty 16,383, from the [electrical values](../reference/hardware.md#electrical-values). Firmware constants.

## Brightness curve

Brightness is a perceptual lightness `L` from 0 to 100 (CIE 1931 L\*). The relative luminance is:

- `Y = ((L + 16) / 116)^3` when `L > 8`;
- `Y = L / 903.3` when `L <= 8`.

The duty before the power limit is `D = round(16383 * Y)`, computed in IEEE 754 double precision, rounding half away from zero. `L = 0` gives 0 and `L = 100` gives 16,383.

| `L` | `Y`      | `D`    |
| --- | -------- | ------ |
| 1   | 0.001107 | 18     |
| 20  | 0.029891 | 490    |
| 60  | 0.281233 | 4,607  |
| 100 | 1        | 16,383 |

## Power limit

`LIMIT_MW` is a firmware constant, 1,000 mW, set by the thermal test. For the duties `D_c` of the four channels and their full-scale powers `P_c`, the estimated power is `P = sum(D_c * P_c) / 16383`. When `P > LIMIT_MW`, every duty becomes `floor(D_c * LIMIT_MW / P)`, so the color is kept and the power never exceeds the limit. With one channel at a time and a limit of 1,000 mW, the limit does not bind; it is applied to every output anyway, and the tests cover it with lower limits.

## Levels

An effect produces a color and a factor `F` from 0 to 1,000 (per mille). The lightness sent to the curve is `L = B * F / 1000`, where `B` is the `brightness` setting (1 to 100), then multiplied by the fade factor of the [transitions](#transitions) and of the [timer](#timer). `L` is kept as a double until the curve.

## Engine tick

The engine computes the outputs every 10 ms from a monotonic clock in milliseconds, starting at 0 when the light starts. Each effect is a pure function of the time `t` elapsed since the effect started, of its parameters and, for `twinkle`, `shooting_star` and `hop`, of the [random sequence](#random-choices). The duties are computed at every tick; the board writes a channel's duty to its LEDC channel only when it differs from the one last written, the channels going to 0 first. A tick that comes late computes the value of its real time: nothing accumulates.

## Effects

The `effect` setting chooses one of these. Parameters are settings; each effect reads only its own and ignores the others.

| Effect             | Parameters                              | Default parameters                |
| ------------------ | --------------------------------------- | --------------------------------- |
| `static`           | `color`                                 | `white`                           |
| `color_change`     | `colors`, `hold_seconds`                | `red, green, blue, white`, 30     |
| `breathing`        | `color`, `period_seconds`, `floor`      | `white`, 8, 20                    |
| `twinkle`          | `color`, `twinkle_strength`             | `white`, 20                       |
| `fall_asleep`      | `color`, `floor`                        | `white`, 20                       |
| `christmas`        | `color_set`, `hold_seconds`             | `christmas`, 30                   |
| `shooting_star`    | `color`                                 | `white`                           |
| `guided_breathing` | `color`, `breath_pattern`, `floor`      | `white`, `4-7-8`, 20              |
| `jingle`           | `color_set`                             | `christmas`                       |
| `hop`              | `color_set`                             | `christmas`                       |

`floor` is a percentage of the full factor: `floor = 20` means `F = 200`, and `low = 10 * floor` below.

`info.effect_settings` reports the Parameters column of this table, in this order ([protocol](../protocol/protocol-v1.md#info)). It is built from the same registry in `lib/ZenitLight` that decides which parameter changes restart an effect. `fall_asleep` also follows the countdown of `timer_minutes`, a setting of the whole light that is not listed (see [Timer](#timer)).

Times are whole milliseconds and `t` is the time since the effect started. The formulas are computed in IEEE 754 double precision; `F` is not rounded (the curve rounds the duty). `ease(p) = (1 - cos(pi * p)) / 2` is a cosine easing from 0 at `p = 0` to 1 at `p = 1`.

### Random choices

`twinkle`, `shooting_star` and `hop` make their random choices from one sequence of the engine, a 32-bit xorshift generator: each draw is the step `x ^= x << 13; x ^= x >> 17; x ^= x << 5` on the unsigned 32-bit state `x`, and the draw is the new `x`. It is seeded from the hardware random number generator at each boot on the board and from a fixed seed in the simulator and the tests (a seed of 0 counts as 1). Each start of an effect takes the sequence where the previous effect left it (the effects above draw from it, the others leave it as it was), so a restart after an effect change or light on goes on with the next draws and never repeats a pattern it has already shown, until the sequence comes round after 2^32 - 1 draws. Each effect says which draws it makes and in which order; `x mod m` is the remainder of the draw divided by `m`. The engine runs the effect at every tick whether anything shows, so while the light is off or fully dark an effect keeps drawing, and the next start goes on from a later point of the sequence.

### Palettes

`color_set` chooses a palette, a preset list of colors in order, read by `christmas`, `jingle` and `hop`:

| `color_set` | Colors                       |
| ----------- | ---------------------------- |
| `christmas` | `red`, `green`, `white`      |
| `ice`       | `blue`, `white`              |
| `aurora`    | `green`, `blue`              |
| `sunset`    | `red`, `white`               |
| `all`       | `red`, `green`, `blue`, `white` |

`n` below is the number of colors of the list an effect cycles through.

### At most 3 light changes a second

Light that flashes more than 3 times a second can trigger seizures in people with photosensitive epilepsy ([WCAG 2.2, success criterion 2.3.1](https://www.w3.org/TR/WCAG22/#three-flashes-or-below-threshold)). No effect shows more than 3 light changes in any one second. A light change is a flash, a rise of `F` by 100 or more followed by a fall of 100 or more (or a fall followed by a rise), or a switch to another color; a switch of color inside a flash, as in `jingle` and `hop`, counts with that flash. Every effect keeps the rule by its own timing, at any value of its parameters: the shortest time between two changes is 600 ms in `jingle`, 700 ms in `hop` and in a `twinkle` dip (two knots of at least 350 ms), 3.5 s in `breathing` (its shortest breath, 0.89 of the shortest period), 7 s in `color_change` and `christmas`, 10 s in `shooting_star`, 16 s in `guided_breathing`. The rule binds what an effect shows by itself; the [transitions](#transitions) follow the person's own changes. The native tests run every effect at its fastest settings and count.

### `static`

`color`, `F = 1000`.

### `color_change`

Cycles through `colors` (2 to 4 colors, in order, a color may appear once only). Each color takes `hold_seconds + 2` seconds: it fades to dark during its last second and the next color rises from dark during its first second, so the switch happens with the light dark. With `T = (hold_seconds + 2) * 1000` ms, color index `i = floor(t / T) mod n` and `u = t mod T`:

- `u < 1000`: `F = u`, except for the very first color after the effect starts (`t < T`), which starts at `F = 1000`;
- `1000 <= u < T - 1000`: `F = 1000`;
- `u >= T - 1000`: `F = T - u`.

`floor` is not read.

### `breathing`

`color`. Slow breaths that drift a little in length and depth. With `T = period_seconds * 1000` ms, `u = t mod (1961 * T)` and `a = u / T`:

- `phase = 2 * pi * a + 0.45 * sin(2 * pi * a / 3.7)`;
- `depth = 0.86 + 0.14 * sin(2 * pi * a / 5.3 + 1.1)`;
- `F = low + (1000 - low) * depth * (1 + cos(phase)) / 2`.

A breath lasts from 0.89 to 1.14 times `T` and reaches from 0.72 to 1 times the span above `low`; the light is at `low` when `cos(phase) = -1`. `1961 * T` is a whole number of each of the three periods (`T`, `3.7 * T` and `5.3 * T`), so `u` changes nothing but keeps the arithmetic exact over days. At `t = 0`, `F = low + (1000 - low) * (0.86 + 0.14 * sin(1.1))`, 987.80 with `floor` 20.

### `twinkle`

`color`, with a factor that wanders below full at an uneven pace, like a star in the atmosphere. The wander goes from knot to knot. With `s = twinkle_strength`, each knot makes three draws, in this order:

1. its length `d = 350 + (x mod 551)` ms, from 350 to 900;
2. whether it is a deep dip: deep when `x mod 100 < 7`;
3. its target `G`: deep, `G = 1000 - 14 * s + (x mod (4 * s + 1))`; otherwise `G = 1000 - 10 * s * (q / 1000)^1.6` with `q = x mod 1001`, so targets lean toward full.

The first knot starts with the effect at `t = 0` from `F = 1000`, and each knot starts where the previous one ends, from its target. Within a knot that starts at `k` and goes from `A` to `G`, `F = A + (G - A) * ease((t - k) / d)`. The next knot is drawn when `t` reaches the end of the current one.

### `fall_asleep`

`color`. With a timer running, `F` falls linearly from 1,000 when the countdown starts to `floor` when it ends: `F = 1000 - (1000 - floor * 10) * e / T`, with `e` the time elapsed since the countdown started (at most `T`) and `T` the timer duration. The timer's own fade-out then takes the light to off. With no timer, it behaves as `static`. The effect follows the countdown that was running when it started: a change of `timer_minutes`, or light on during the fade-out, restarts it with the transition of an effect change, with the new countdown. That countdown starts at the moment of the change and the effect starts at the end of the 500 ms fade-down, so `e` is already 500 at the effect's `t = 0` and it starts slightly below full (with a new timer of 1 minute and `floor` 20, at `F = 993.33`).

### `christmas`

`color_change` with the colors of the [palette](#palettes) `color_set`.

### `shooting_star`

`color`. A sky at a fixed level, `S = 450` (a constant of the effect, not `floor`), and now and then a flash: 120 ms up to full, then back toward the sky with a time constant of 450 ms. The time from the start to the first flash, and from each flash to the next, is `10000 + (x mod 50001)` ms, from 10 to 60 seconds: one draw when the effect starts, then one at each flash. Before the first flash `F = S`. With `e` the time since the last flash started:

- `e < 120`: `F = S + (1000 - S) * e / 120`;
- `e >= 120`: `F = S + (1000 - S) * exp(-(e - 120) / 450)`.

### `guided_breathing`

`color`. A pacer to breathe with: the light rises while breathing in, stays at full while holding, falls while breathing out, and with `box` stays at `low` while holding empty. `breath_pattern` chooses the phases, in seconds:

| `breath_pattern` | In | Hold at full | Out | Hold at `low` | Cycle |
| ---------------- | -- | ------------ | --- | ------------- | ----- |
| `4-7-8`          | 4  | 7            | 8   | none          | 19    |
| `box`            | 4  | 4            | 4   | 4             | 16    |

With `u = t mod cycle` and `p` the fraction of the current phase gone by:

- in: `F = low + (1000 - low) * ease(p)`;
- hold at full: `F = 1000`;
- out: `F = 1000 - (1000 - low) * ease(p)`;
- hold at `low`: `F = low`.

The effect starts at the start of "in", at `low`.

### `jingle`

`color_set`. Pulses in the rhythm of the Jingle Bells chorus at 100 beats a minute (a beat is 600 ms): notes of 1, 1, 2, 1, 1, 2, 1, 1, 1, 1 and 4 beats, then 4 beats of rest, a cycle of 20 beats, 12,000 ms. The notes start at 0, 600, 1,200, 2,400, 3,000, 3,600, 4,800, 5,400, 6,000, 6,600 and 7,200 ms of the cycle, with lengths `N` of 600, 600, 1,200, 600, 600, 1,200, 600, 600, 600, 600 and 2,400 ms. With `c = floor(t / 12000)`, `u = t mod 12000`, `k` the last note (0 to 10) that starts at or before `u`, and `e = u - start of k`:

- color: palette color `(11 * c + k) mod n`, so each note takes the next color of the palette;
- `e < 60`: `F = 300 + 700 * e / 60`;
- `e >= 60`: `F = 300 + 700 * exp(-(e - 60) / (0.35 * N))`.

The last note's decay goes on through the rest, to the end of the cycle.

### `hop`

`color_set`. A new color of the palette every 700 ms, never the same twice in a row, with a short dip around each hop. Hop `h = floor(t / 700)` and `u = t mod 700`. The color of hop 0 is palette color `x mod n`, one draw when the effect starts. Each later hop makes one draw, `j = x mod (n - 1)`, and takes palette color `j` when `j` is below the current color's index, `j + 1` otherwise: one of the other colors.

- `h > 0` and `u < 150`: `F = 400 + 600 * ease(u / 150)`;
- `u >= 550`: `F = 1000 - 600 * ease((u - 550) / 150)`;
- otherwise `F = 1000`.

So the light dips to 40 % in 150 ms, switches color at the bottom and rises in 150 ms; the very first color starts at full.

## Transitions

Changes never jump:

- **Brightness** moves linearly in `L` from the value shown to the new one in 500 ms, whatever the size of the change.
- **Effect, or a parameter the running effect reads:** the light holds the color and the factor it shows and takes the factor down to 20 % of itself in 500 ms. The new effect then starts at `t = 0`, and the factor moves linearly, in 500 ms, from that level to the new effect's own factor as it moves: at a fraction `u` of the 500 ms the factor is `level + (F(t) - level) * u`, with `F(t)` the new effect's factor at that moment, not at its start. Another change during the fade-down keeps fading and shows the latest settings. A change back to the running effect during the fade-down turns back from where it is to the effect's own factor, at the rate of a full fade-down (a change of 800 in 500 ms, so a return of `d` takes `d * 500 / 800` ms, rounded to the nearest millisecond, with `d` measured at the moment of the turn-back; the effect keeps moving during the return, so a moving effect such as `twinkle` can make it slightly faster or slower), unless the running effect has moved to another color meanwhile: then the fade-down goes on and the effect starts again. A fade-down that restarts the running effect for a new countdown (see [Timer](#timer)) is never turned back. A parameter the running effect does not read changes nothing.
- **Light on and off** move at the rate of a full fade in 1,000 ms: from off, on takes 1,000 ms; from a partial level, the matching part of that time. Off is reported at once (`status` says off), while the light fades out; changes during that fade-out follow the rules above and keep fading out. A change once the light is off has no transition: nothing shows, and the next light on fades in to the new settings. On during the fade-out comes back from the current level, and restarts the timer.
- A change that arrives during a transition starts from the current output.

## Timer

- The `timer_minutes` setting is 0 (no timer) or 1 to 360. It is saved.
- The countdown starts when the light starts (power-on or light on), and again from the full duration when `timer_minutes` changes while the light is on, or when the light is turned on during the timer's fade-out. A timer that was fading out comes back up at the rate of light on.
- Off during the timer's fade-out starts from the level the fade reached, at the rate of a full fade.
- When it ends, the light fades out in 30 seconds, linearly in `L`, and stays off.
- Off, from the app or from the timer, is not saved: the light stays off until the board restarts or the app turns it on again.

## Favorites

A favorite is a named look the board keeps: an effect, a brightness and the settings that effect reads (its `Parameters` above). The timer and the power state are not part of a look. The board keeps at most 6, in the order they were saved; the names and the commands are in the [protocol](../protocol/protocol-v1.md#favorites).

- **Ready-made.** A board with no stored favorites has two: `Starry night` (id 1), `shooting_star` in `white` at brightness 60 (its sky at 45 %), and `Christmas` (id 2), `christmas` with the `christmas` palette and `hold_seconds` 30 at brightness 60. They are ordinary favorites: they can be renamed, replaced and deleted. Nothing is written for them until the first change of the favorites, so a deleted ready-made favorite stays deleted after a restart. A reset to defaults brings both back, with none marked.
- **Saving** copies the current light settings but `timer_minutes` into the favorite (all of them, whatever the effect reads).
- **Applying** sets `effect`, `brightness` and the settings the favorite's effect reads, as one change with the [transitions](#transitions), saves them, and turns the light on (from off it fades in over 1,000 ms and the timer starts; when on, the timer keeps running). The other settings keep their values, so a later change of effect finds the person's own choices.
- **Turn on with this.** At most one favorite is marked. When one is, it is applied, before the light fades in, at every turn-on from off (`light` with `on: true` while `light.on` is false) and at every [start](#start). On during the timer's fade-out is not a turn-on from off: the light comes back up as it is. The timer is not part of a look, so a turn-on starts it as usual. With no mark, the light turns on with the settings as they are. Deleting the marked favorite clears the mark; saving over it keeps it.
- **A favorite the board cannot read** (an effect code this firmware does not know, a damaged entry) is left out when the favorites are read, and a mark that names no favorite counts as none.

## Start

1. Before the pins are attached, every duty is 0. The gate pull-downs keep the channels off while the chip boots.
2. The board reads the settings. A board that has never been configured uses the defaults: `static`, `white`, brightness 60, no timer.
3. When a favorite is marked to turn on with, its look becomes the light settings and is saved (when it differs). While a new firmware is on trial it is applied but not saved: the previous firmware may boot again, and nothing is saved before the new one confirms; the next save that changes a setting writes it. If the save fails, the light starts with the stored settings.
4. The light fades in over 1,000 ms to the configuration, and the timer starts.

A new firmware on its trial boot confirms itself once the settings are read and the first output is applied.

## Board LED

The ESP32-C3 SuperMini's blue LED (GPIO 8, on when low) is always off, except while the board joins a WiFi network after an Improv setup, when it blinks at 2 Hz.

## Status

`status` reports the light as specified in the [protocol](../protocol/protocol-v1.md#status): on or off, the effect, the color lit now, the lightness `L` now, the power scale, and the timer.

## Stored settings

The light settings are a record of 18 bytes, stored in NVS (namespace `zenit`) together with the [board record](wifi-and-updates-v1.md#stored-settings) as one blob under the key `settings`: the light record first, then the board record, 273 bytes. The blob is written in one step, so a save is all or nothing even when the power fails during it, and a save of both records has no state in between to repair. `conformance/board/stored.json` gives what is read from each combination. Version 2 is 18 bytes:

| Byte   | Content                                                                           |
| ------ | --------------------------------------------------------------------------------- |
| 0      | Version, `2`                                                                      |
| 1      | `brightness`                                                                      |
| 2      | `effect`: `static` 0, `color_change` 1, `breathing` 2, `twinkle` 3, `fall_asleep` 4, `christmas` 5, `shooting_star` 6, `guided_breathing` 7, `jingle` 8, `hop` 9 |
| 3      | `color`: `white` 0, `red` 1, `green` 2, `blue` 3                                  |
| 4      | Number of colors in `colors`                                                      |
| 5..8   | The colors of `colors`, coded as `color`; unused bytes are 0                      |
| 9      | `color_set`: `christmas` 0, `ice` 1, `aurora` 2, `sunset` 3, `all` 4              |
| 10..11 | `hold_seconds`, little endian                                                     |
| 12     | `period_seconds`                                                                  |
| 13     | `floor`                                                                           |
| 14     | `twinkle_strength`                                                                |
| 15..16 | `timer_minutes`, little endian                                                    |
| 17     | `breath_pattern`: `4-7-8` 0, `box` 1                                              |

Version 1, written by firmware 1.1.0 and earlier, is the first 17 bytes of this table with `1` in byte 0, in a blob of 272 bytes; its codes are those of version 2. A blob is read when it is 273 bytes with a light record of version 2, or 272 bytes with a light record of version 1: a version 1 record keeps every value and takes the default `breath_pattern`. Any other blob is damaged: both records take their defaults. The board writes version 2 at the next save. Reading an older record writes nothing, except a new token when the stored one is damaged, written in the layout the blob had (version 1 stays version 1). A firmware from before version 2 reads a 273-byte blob as damaged. While a new firmware is on trial (see [Rollback](wifi-and-updates-v1.md#rollback)) the previous one may boot again, so a version 1 blob keeps the version 1 layout at every save of that boot, unless the save sets a `breath_pattern` other than the default, which version 1 cannot hold; the first save after the firmware confirms writes version 2. An older firmware flashed over USB over a version 2 blob starts from the defaults.

These codes never change meaning: a new effect, color, color set or pattern takes the next free code. A record of another size or version is ignored and the defaults apply; a field out of its range keeps its default and the others load. Nothing is written when no setting changes. The cases in `conformance/light/record.json` give records and their settings both ways.

## Stored favorites

The favorites are a record of their own, version 1, stored in NVS (namespace `zenit`) under the key `favorites`, apart from the settings blob, so a firmware from before favorites never reads it and a rollback to it is safe. It is 598 bytes, written in one step:

| Byte     | Content                                                                                   |
| -------- | ----------------------------------------------------------------------------------------- |
| 0        | Version, `1`                                                                              |
| 1        | Number of favorites, 0 to 6                                                               |
| 2        | The id of the favorite marked to turn on with, or 0 for none                              |
| 3        | Where the search for the next id starts (1 to 255; 0 reads as 1)                          |
| 4..597   | Six entries of 99 bytes; the entries after the number of favorites are all 0               |

An entry is the favorite's id (1 byte, 1 to 255), its name in UTF-8 padded with 0 (80 bytes) and its look as a light record of version 2 (18 bytes, the table of [Stored settings](#stored-settings), with `timer_minutes` 0). A new favorite takes the first id from byte 3 on that no favorite has, skipping 0 and wrapping after 255, and byte 3 then names the id after it.

A missing record is the two ready-made favorites, with next id 3 and no mark. A record of another size or version, or with more than 6 favorites, is damaged: the ready-made favorites, and the next change writes over it. An entry with id 0 or the id of an earlier entry, a name that breaks the rules or repeats an earlier one, or a light record of another version or with an unknown effect code is left out; a field of the light record out of its range keeps its default. If the record cannot be read (an I/O error) the board shows the ready-made favorites and refuses every change until a restart, as for the settings. The cases in `conformance/light/favorites_record.json` give records and what is read from them.

## Measurements

On an ESP32-C3 SuperMini with this milestone's firmware (2026-11-21): the firmware takes 315 KB of its 1,984 KiB slot (the layout before [ADR 0005](../adr/0005-web-app-partition.md); the slot is now 1,728 KiB); the loop task's minimum free stack is 6,276 bytes of 8,192 after a minute of running; the heap has 281,796 bytes free, with a largest block of 139,252 bytes. Measured with a temporary task that printed `uxTaskGetStackHighWaterMark` of the loop task once a second; the measuring code is not in the repository.

## Simulator and tests

The simulator runs the engine with a virtual clock and writes the duty of each channel at every tick. `--seed N` fixes the seed of the random sequence. The conformance cases in `conformance/light/` give settings, a sequence of events (setting changes, light on and off) and the expected duties at chosen times, worked out by hand from this document.

## Limits

| Limit                   | Value                     |
| ----------------------- | ------------------------- |
| `brightness`            | 1 to 100                  |
| `colors`                | 2 to 4, no repeats        |
| `hold_seconds`          | 5 to 600                  |
| `period_seconds`        | 4 to 20                   |
| `floor`                 | 5 to 80                   |
| `twinkle_strength`      | 5 to 50                   |
| `breath_pattern`        | `4-7-8` or `box`          |
| `timer_minutes`         | 0, or 1 to 360            |
| Favorites               | 6                         |
| Favorite name           | 1 to 20 characters        |
| `LIMIT_MW`              | 1,000 (firmware constant) |
| Engine tick             | 10 ms                     |
