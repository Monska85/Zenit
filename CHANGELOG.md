# Changelog

All notable changes to the firmware are listed here, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Release-please writes a section for each release from the commits on `main`.

## [1.2.0](https://github.com/Monska85/Zenit/compare/v1.1.0...v1.2.0) (2026-11-28)


### Added

* add favorites ([#33](https://github.com/Monska85/Zenit/issues/33)) ([d92dbd6](https://github.com/Monska85/Zenit/commit/d92dbd663cae127f379e5148415bf82c2c77cdc6))
* **light:** add four effects, three palettes and a breathing pattern setting ([#29](https://github.com/Monska85/Zenit/issues/29)) ([f8d5a65](https://github.com/Monska85/Zenit/commit/f8d5a65b1a62ded49ed870a7128306248fe1ac53))
* **web:** move the app's text into translation catalogs ([#34](https://github.com/Monska85/Zenit/issues/34)) ([19718a4](https://github.com/Monska85/Zenit/commit/19718a45ad47587652f7ff5d5705e0d04eb548f2))
* **web:** offer every time zone and the device's own ([#32](https://github.com/Monska85/Zenit/issues/32)) ([536b67e](https://github.com/Monska85/Zenit/commit/536b67eb8fdad2eac0d6cf01701b39e29629ed99))

## [1.1.0](https://github.com/Monska85/Zenit/compare/v1.0.0...v1.1.0) (2026-11-27)


### Added

* **protocol:** report the settings each effect reads ([#23](https://github.com/Monska85/Zenit/issues/23)) ([ee30966](https://github.com/Monska85/Zenit/commit/ee309668b11fb67d4d9638df28328d90046613c5))


### Fixed

* **firmware:** improv deadline, image version skip, login revoke and read errors ([#17](https://github.com/Monska85/Zenit/issues/17)) ([4900018](https://github.com/Monska85/Zenit/commit/4900018d937b9b1a3c041ddb0d4a9ee92f8d2535))
* **firmware:** stop downloads on a network change, close only the judged client and keep every simulator millisecond ([#21](https://github.com/Monska85/Zenit/issues/21)) ([5fd2174](https://github.com/Monska85/Zenit/commit/5fd2174b104e255d9033e86069eee9f86a955ce5))
* **web:** connect over wifi from the published site in chrome ([1f4cc1d](https://github.com/Monska85/Zenit/commit/1f4cc1de8502389528b071ab0f571a430e4785ba))


### Changed

* remove dead code and duplication and fix stale docs ([#22](https://github.com/Monska85/Zenit/issues/22)) ([7f86293](https://github.com/Monska85/Zenit/commit/7f862932ec9e6d7de38875b5566e7daf1eab2dd5))

## 1.0.0 (2026-11-24)


### Added

* **light:** add light engine, firmware, simulator and tests ([72638c6](https://github.com/Monska85/Zenit/commit/72638c60bb11f1e8f11741d5b86ce28f3e000159))
* **protocol:** add command protocol over usb, simulator transport, cli and releases ([6e188e2](https://github.com/Monska85/Zenit/commit/6e188e2d5a9550e39bd45b00e0c50cac7ecad44e))
* **web:** add web app to control the light over usb or websocket ([b8ee982](https://github.com/Monska85/Zenit/commit/b8ee9821303a151c44149bc9cc08a656abaa45c8))
* **web:** move the web app to its own flash partition with automatic updates and repair ([23ec0d2](https://github.com/Monska85/Zenit/commit/23ec0d2bb39f10be762d398e817e13dbbd6372d6))
* **wifi:** add wifi, improv setup, board-served web app and updates with rollback ([a6d70ef](https://github.com/Monska85/Zenit/commit/a6d70ef2078fec0741e56c39e671bdf269781982))


### Fixed

* **firmware:** close page connections that stay idle ([19b615d](https://github.com/Monska85/Zenit/commit/19b615d99fe9cc520d2ac38f5e197d52dd0a9d1a))
* **firmware:** keep brightness 100 at full instead of a dim output ([4b1d495](https://github.com/Monska85/Zenit/commit/4b1d4954c801670dec165726b966f044a1727159))
* **firmware:** move the white channel to gpio10 ([#8](https://github.com/Monska85/Zenit/issues/8)) ([bcccf81](https://github.com/Monska85/Zenit/commit/bcccf8161879e44f48af7ebae7ec42584ae1b9bf))
* **tools:** open the websocket connection as a context manager ([0c85662](https://github.com/Monska85/Zenit/commit/0c8566220e7bc621105c942524f1789dfd80af28))
* **wifi:** accept websocket clients on their first message, as the server never shows the handshake ([bf776f3](https://github.com/Monska85/Zenit/commit/bf776f3f73b645ebe532d9e5c34b39c434c2aa65))
* **wifi:** address review findings on scan timeout and signal range ([dc265dd](https://github.com/Monska85/Zenit/commit/dc265dd19e3cb00ad05eb46c5abdbe0cba5b32e2))


### Changed

* **firmware:** cut 70 KB with the common certificate bundle, the supermini variant and mbedtls sha-256 ([6bba65e](https://github.com/Monska85/Zenit/commit/6bba65ee128003691f7a05d021158af32063fe0b))

## [Unreleased]
