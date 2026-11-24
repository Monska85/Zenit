# Hardware reference

This document collects the hardware facts the firmware depends on. It is an English summary of the project plan and the wiring guide, which are kept outside this repository. When they change, update this document in the same change as the firmware that depends on them.

## Components

| Part                | Model                                                     | Notes                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microcontroller     | ESP32-C3 SuperMini                                        | 22.70 x 18.22 mm, 4 MB flash, native USB (USB-Serial/JTAG). Known weak WiFi antenna on some boards.                                                                                                            |
| LED                 | CREE RGBW-1225 on a 22 x 22 x 2 mm aluminium board        | Four separate dies: red, green, blue and a true white. Pads from the left, label up: R-, R+, G-, G+, B-, B+, W-, W+. The die group is centered in width and 3.5 mm off center toward the printed label. |
| Channel driver      | XY-MOS dual MOSFET module (D4184), one per channel        | Low-side switch, control 3.3 to 20 V, PWM 0 to 20 kHz, no optocoupler.                                                                                                                                         |
| Series resistor     | 2 W metal film, 1 %                                       | 10 ohm on red, 6.8 ohm on green, blue and white.                                                                                                                                                               |
| Power input         | USB-C panel socket with CC resistors                      | 5 V, up to 3 A, from any USB charger or power bank.                                                                                                                                                            |
| Heat sink           | 25 x 25 x 10 mm aluminium, pin fin, with thermal pad      | The LED board sits on it, held by a printed clip.                                                                                                                                                              |

## MOSFET module

Pins (as printed under the board): VIN+, VIN-, OUT+, OUT-, TRIG/PWM, GND.

- VIN+ is connected to OUT+.
- OUT- is the drain of the two MOSFETs in parallel.
- The signal GND is connected to VIN-.
- The gate has a 100 ohm series resistor and a 10 kohm pull-down on the module, so no external pull-down is needed and the channel stays off while the ESP32 boots.
- No flyback diode: with an LED and a resistor it is not needed.
- The two MOSFETs dissipate a few mW and stay at ambient temperature.

## Wiring

Each channel X (R, G, B, W):

```text
+5 V ── VIN+ ── OUT+ ── series resistor ── X+ (LED die) X- ── OUT- ──(MOSFET)── VIN- ── GND
GPIO ── TRIG/PWM                                    ESP32 GND ── module GND
```

- The ESP32 is powered through its 5V and G pins from the same +5 V and GND node as the four modules.
- GPIO high turns the channel on; PWM is active high.

## Pins

| Function                            | GPIO |
| ----------------------------------- | ---- |
| Red channel                         | 3    |
| Green channel                       | 4    |
| Blue channel                        | 5    |
| White channel                       | 10   |
| Board blue LED (on when driven low) | 8    |

- Not used for channels: GPIO 2, 8 and 9 (boot strapping, board LED, BOOT button) and GPIO 18 to 21 (USB).
- GPIO 9 would boot the chip into download mode if held low at power-on.
- GPIO 6 (MTCK) has a weak pull-up from reset until the firmware sets the pin: on it, the white channel lit for a moment at every power-on. White is on GPIO 10 instead.
- The pin order follows the board layout so that no wire crosses.

## Electrical values

- Channel current at 100 %: red (5 - 2.1) / 10 = 0.29 A; green, blue and white (5 - 3.1) / 6.8 = 0.28 A.
- LED power at 100 % (forward voltage times current): red about 0.61 W; green, blue and white about 0.87 W each.
- All four channels at 100 %: about 1.1 A, plus about 0.1 A for the ESP32.
- Power in the red series resistor: about 0.8 W.
- Verified PWM: 1 kHz on all four channels on the first wired unit. The test set a 16-bit duty value, which its API scales to the hardware resolution: the ESP32-C3 has at most 14 bits at 1 kHz, which the firmware uses.

## Thermal limits

- The base is printed in PLA, which softens at 55 to 60 degrees C.
- Heat sink estimate: 20 to 25 K/W, about +25 degrees C at 1 W on the LED.
- Normal use is white alone, about 1 W. The firmware limits the total LED power to about 1 to 1.5 W. The thermal test with the heat sink (one hour at full light in the closed base) is not done yet, so the limit is a constant that is easy to change.
- The series resistors reach 60 to 80 degrees C at 0.6 to 0.8 W; they are mounted away from the plastic.
- The ESP32-C3 runs at about 40 degrees C.

## Light quality

- Mixed colors (for example red and blue together) project stars with colored fringes, because the four dies are side by side. Effects prefer the pure colors: red, green, blue or white alone.
- The red die is the weakest to the eye.

## Safety rules

- Never connect the ESP32's own USB-C port while the panel socket is powered: on the SuperMini the USB 5 V is tied to the 5V pin. To flash the firmware, disconnect the panel socket (or the 5V wire) first. On USB alone the board runs and can be configured, but the LED has no power.
- Without the heat sink: white only, at most 50 % PWM, short sessions.
- Do not look at the LED from close by at full power.

## Future rotation

The base keeps room for a dome rotation upgrade, not part of the 2026 units: a NEMA 17 pancake stepper motor with a TMC2209 driver in StealthChop, controlled over UART, possibly with a shielded 5 to 9 V boost converter. The firmware keeps the motor as its own future module and reserves no pins for it yet.
