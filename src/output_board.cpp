// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef ZENIT_SIM

#include "output.h"

#include <Arduino.h>

#include "platform.h"

namespace output
{

namespace
{
// GPIO of each channel, by zenit::Channel (docs/reference/hardware.md#pins).
constexpr uint8_t CHANNEL_PINS[zenit::CHANNEL_COUNT] = {3, 4, 5, 6};
constexpr uint8_t STATUS_LED_PIN = 8; // on when low
bool attached[zenit::CHANNEL_COUNT] = {false, false, false, false};
} // namespace

void begin()
{
  // The gate pull-downs keep the channels off while the chip boots: keep them low until the PWM runs.
  for (uint8_t pin : CHANNEL_PINS)
  {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
  for (size_t i = 0; i < zenit::CHANNEL_COUNT; i++)
  {
    attached[i] = ledcAttach(CHANNEL_PINS[i], zenit::PWM_FREQUENCY_HZ, zenit::PWM_BITS);
    if (attached[i])
      ledcWrite(CHANNEL_PINS[i], 0);
    else
      platform::log("cannot attach the PWM of GPIO %u", CHANNEL_PINS[i]);
  }
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, HIGH);
}

void write(const zenit::Duties &duties)
{
  // Channels going to 0 first, then the lit one, so two dies are never on together during a color switch.
  for (size_t i = 0; i < zenit::CHANNEL_COUNT; i++)
    if (attached[i] && duties.value[i] == 0)
      ledcWrite(CHANNEL_PINS[i], 0);
  for (size_t i = 0; i < zenit::CHANNEL_COUNT; i++)
    if (attached[i] && duties.value[i] != 0)
      ledcWrite(CHANNEL_PINS[i], duties.value[i]);
}

void status_led(bool on) { digitalWrite(STATUS_LED_PIN, on ? LOW : HIGH); }

} // namespace output

#endif
