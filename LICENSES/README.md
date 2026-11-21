# Third-party licenses

The firmware links Arduino-ESP32 and ESP-IDF with their components, including the binary-only libraries Espressif distributes (WiFi, PHY, Bluetooth, coexistence); [`LICENSE-EXCEPTION`](../LICENSE-EXCEPTION) gives the permission to combine Zenit with them. The release build writes the firmware's third-party notices from the components it links; that build arrives with the release milestone.

The native tests use ArduinoJson (MIT license), which no firmware or release artifact contains.

A new third-party dependency of the firmware or the web app gets its notice in the same change. Its license must be one that GPL-3.0-or-later can include.
