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
constexpr uint8_t CHANNEL_PINS[zenit::CHANNEL_COUNT] = {3, 4, 5, 10};
constexpr uint8_t STATUS_LED_PIN = 8; // on when low
// Arduino's ledcWrite turns the top duty (16,383 at 14 bits) into 2^14 for "full on", which this chip outputs much
// dimmer than 16,382: the board never writes more than this, 0.006 % below full (docs/board/light-v1.md#channels).
constexpr uint16_t BOARD_DUTY_MAX = zenit::DUTY_MAX - 1;

uint32_t board_duty(uint16_t duty) { return duty > BOARD_DUTY_MAX ? BOARD_DUTY_MAX : duty; }
bool attached[zenit::CHANNEL_COUNT] = {false, false, false, false};
// The duty each channel was last given, so a tick that changes nothing makes no driver call.
uint32_t written[zenit::CHANNEL_COUNT] = {0, 0, 0, 0};

void set(size_t channel, uint32_t duty)
{
  // A write that failed is tried again at the next tick.
  if (attached[channel] && written[channel] != duty && ledcWrite(CHANNEL_PINS[channel], duty))
    written[channel] = duty;
}
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
    written[i] = 0;
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
    if (duties.value[i] == 0)
      set(i, 0);
  for (size_t i = 0; i < zenit::CHANNEL_COUNT; i++)
    if (duties.value[i] != 0)
      set(i, board_duty(duties.value[i]));
}

void status_led(bool on) { digitalWrite(STATUS_LED_PIN, on ? LOW : HIGH); }

} // namespace output

#endif
