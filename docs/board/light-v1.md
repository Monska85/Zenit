# Light, version 1

Status: **proposed**. Why it works this way is recorded in [ADR 0001](../adr/0001-architecture.md). The hardware is described in [`docs/reference/hardware.md`](../reference/hardware.md); the settings named here are read and changed through the [command protocol](../protocol/protocol-v1.md).

This document specifies what the board's LED shows: the channels and their PWM, the brightness curve, the power limit, the effects, the fades, the timer and the behavior at boot. Every rule is a function of the settings and of time, so the simulator and the tests reproduce the board exactly.

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

The engine computes the outputs every 10 ms from a monotonic clock in milliseconds, starting at 0 when the light starts. Each effect is a pure function of the time `t` elapsed since the effect started, of its parameters and, for `twinkle`, of its random sequence. The duties are written to the LEDC channels at every tick. A tick that comes late computes the value of its real time: nothing accumulates.

## Effects

The `effect` setting chooses one of these. Parameters are settings; each effect reads only its own and ignores the others.

| Effect         | Parameters                                     | Default parameters                 |
| -------------- | ---------------------------------------------- | ---------------------------------- |
| `static`       | `color`                                        | `white`                            |
| `color_change` | `colors`, `hold_seconds`, `floor`              | `red, green, blue, white`, 30, 20  |
| `breathing`    | `color`, `period_seconds`, `floor`             | `white`, 8, 20                     |
| `twinkle`      | `color`, `twinkle_strength`                    | `white`, 20                        |
| `fall_asleep`  | `color`, `floor`                               | `white`, 20                        |
| `christmas`    | `color_set`, `hold_seconds`, `floor`           | `christmas`, 30, 20                |

`floor` is a percentage of the full factor: `floor = 20` means `F = 200`.

### `static`

`color`, `F = 1000`.

### `color_change`

Cycles through `colors` (2 to 4 colors, in order, a color may appear once only). Each color takes `hold_seconds + 2` seconds: it fades down to the floor during its last second, the next color starts at the floor and fades up during its first second. With `T = (hold_seconds + 2) * 1000` ms, color index `i = floor(t / T) mod n` and `u = t mod T`:

- `u < 1000`: `F = floor + (1000 - floor) * u / 1000`, except for the very first color after the effect starts, which starts at `F = 1000`;
- `1000 <= u < T - 1000`: `F = 1000`;
- `u >= T - 1000`: `F = 1000 - (1000 - floor) * (u - (T - 1000)) / 1000`.

### `breathing`

`color`, `F = floor + (1000 - floor) * (1 + cos(2 * pi * t / T)) / 2` with `T = period_seconds * 1000` ms, so it starts at full and reaches the floor at half the period.

### `twinkle`

`color`, with a factor that wanders below full like a star in the atmosphere. Every 200 ms the effect draws a target `G` uniformly from `1000 - 10 * twinkle_strength` to 1,000, and `F` moves linearly from its value to `G` over the next 200 ms. The draws come from a 32-bit xorshift generator (`x ^= x << 13; x ^= x >> 17; x ^= x << 5`), seeded from the hardware random number generator at each boot on the board and from a fixed seed in the simulator and the tests. The engine has one sequence: each start of an effect takes it where the previous effect left it (twinkle draws from it, the other effects leave it as it was), so a restart of twinkle after an effect change or light on goes on with the next draws and never repeats a pattern it has already shown, until the sequence comes round after 2^32 - 1 draws; `G = 1000 - 10 * twinkle_strength + (x mod (10 * twinkle_strength + 1))`. `F` starts at 1,000.

### `fall_asleep`

`color`. With a timer running, `F` falls linearly from 1,000 when the countdown starts to `floor` when it ends: `F = 1000 - (1000 - floor * 10) * e / T`, with `e` the time elapsed since the countdown started (at most `T`) and `T` the timer duration. The timer's own fade-out then takes the light to off. With no timer, it behaves as `static`. The effect follows the countdown that was running when it started: a change of `timer_minutes`, or light on during the fade-out, restarts it with the transition of an effect change, from full with the new countdown.

### `christmas`

`color_change` with a preset list: `color_set` `christmas` is `red, green, white`; `ice` is `blue, white`.

## Transitions

Changes never jump:

- **Brightness** moves linearly in `L` from the value shown to the new one in 500 ms, whatever the size of the change.
- **Effect, or a parameter the running effect reads:** the light holds the color and the factor it shows and takes the factor down to 20 % of itself in 500 ms. The new effect then starts at `t = 0`, and the factor moves linearly, in 500 ms, from that level to the new effect's own factor. Another change during the fade-down keeps fading and shows the latest settings. A change back to the running effect during the fade-down turns back from where it is to the effect's own factor, at the rate of a full fade-down (a change of 800 in 500 ms, so a return of `d` takes `d * 500 / 800` ms, rounded to the nearest millisecond, with `d` measured at the moment of the turn-back; the effect keeps moving during the return, so a moving effect such as `twinkle` can make it slightly faster or slower), unless the running effect has moved to another color meanwhile: then the fade-down goes on and the effect starts again. A fade-down that restarts the running effect for a new countdown (see [Timer](#timer)) is never turned back. A parameter the running effect does not read changes nothing.
- **Light on and off** move at the rate of a full fade in 1,000 ms: from off, on takes 1,000 ms; from a partial level, the matching part of that time. Off is reported at once (`status` says off), while the light fades out; changes during that fade-out follow the rules above and keep fading out. On during the fade-out comes back from the current level, and restarts the timer.
- A change that arrives during a transition starts from the current output.

## Timer

- The `timer_minutes` setting is 0 (no timer) or 1 to 360. It is saved.
- The countdown starts when the light starts (power-on or light on), and again from the full duration when `timer_minutes` changes while the light is on, or when the light is turned on during the timer's fade-out. A timer that was fading out comes back up at the rate of light on.
- Off during the timer's fade-out starts from the level the fade reached, at the rate of a full fade.
- When it ends, the light fades out in 30 seconds, linearly in `L`, and stays off.
- Off, from the app or from the timer, is not saved: the light stays off until the board restarts or the app turns it on again.

## Start

1. Before the pins are attached, every duty is 0. The gate pull-downs keep the channels off while the chip boots.
2. The board reads the settings. A board that has never been configured uses the defaults: `static`, `white`, brightness 60, no timer.
3. The light fades in over 1,000 ms to the saved configuration, and the timer starts.

A new firmware on its trial boot confirms itself once the settings are read and the first output is applied.

## Board LED

The ESP32-C3 SuperMini's blue LED (GPIO 8, on when low) is always off, except while the board joins a WiFi network after an Improv setup, when it blinks at 2 Hz.

## Status

`status` reports the light as specified in the [protocol](../protocol/protocol-v1.md#status): on or off, the effect, the color lit now, the lightness `L` now, the power scale, and the timer.

## Stored settings

The light settings are a record of 17 bytes, stored in NVS (namespace `zenit`) together with the [board record](wifi-and-updates-v1.md#stored-settings) as one blob under the key `settings`: the light record first, then the board record, 272 bytes. The blob is written in one step, so a save is all or nothing even when the power fails during it, and a save of both records has no state in between to repair. A board from before the blob has the records under the keys `light` and `board`; they are read while `settings` is missing, and the next save writes the blob. A blob of another size is damaged: both records take their defaults. `conformance/board/stored.json` gives what is read from each combination. Version 1 is 17 bytes:

| Byte  | Content                                                                           |
| ----- | --------------------------------------------------------------------------------- |
| 0     | Version, `1`                                                                      |
| 1     | `brightness`                                                                      |
| 2     | `effect`: `static` 0, `color_change` 1, `breathing` 2, `twinkle` 3, `fall_asleep` 4, `christmas` 5 |
| 3     | `color`: `white` 0, `red` 1, `green` 2, `blue` 3                                  |
| 4     | Number of colors in `colors`                                                      |
| 5..8  | The colors of `colors`, coded as `color`; unused bytes are 0                      |
| 9     | `color_set`: `christmas` 0, `ice` 1                                               |
| 10..11 | `hold_seconds`, little endian                                                    |
| 12    | `period_seconds`                                                                  |
| 13    | `floor`                                                                           |
| 14    | `twinkle_strength`                                                                |
| 15..16 | `timer_minutes`, little endian                                                   |

These codes never change meaning: a new effect, color or color set takes the next free code. A record of another size or version is ignored and the defaults apply; a field out of its range keeps its default and the others load. Nothing is written when no setting changes. The cases in `conformance/light/record.json` give records and their settings both ways.

## Measurements

On an ESP32-C3 SuperMini with this milestone's firmware (2026-11-21): the firmware takes 315 KB of its 1,984 KiB slot; the loop task's minimum free stack is 6,276 bytes of 8,192 after a minute of running; the heap has 281,796 bytes free, with a largest block of 139,252 bytes. Measured with a temporary task that printed `uxTaskGetStackHighWaterMark` of the loop task once a second; the measuring code is not in the repository.

## Simulator and tests

The simulator runs the engine with a virtual clock and writes the duty of each channel at every tick. `--seed N` fixes the `twinkle` seed. The conformance cases in `conformance/light/` give settings, a sequence of events (setting changes, light on and off) and the expected duties at chosen times, worked out by hand from this document.

## Limits

| Limit                   | Value                     |
| ----------------------- | ------------------------- |
| `brightness`            | 1 to 100                  |
| `colors`                | 2 to 4, no repeats        |
| `hold_seconds`          | 5 to 600                  |
| `period_seconds`        | 4 to 20                   |
| `floor`                 | 5 to 80                   |
| `twinkle_strength`      | 5 to 50                   |
| `timer_minutes`         | 0, or 1 to 360            |
| `LIMIT_MW`              | 1,000 (firmware constant) |
| Engine tick             | 10 ms                     |
