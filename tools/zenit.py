#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Command line client of the Zenit command protocol (docs/protocol/protocol-v1.md).

    zenit.py --port /dev/ttyACM0 info
    zenit.py --ws ws://127.0.0.1:8765 status
    zenit.py --port /dev/ttyACM0 settings-set brightness=40 effect=breathing
    zenit.py --port /dev/ttyACM0 light off
    zenit.py --port /dev/ttyACM0 raw '{"cmd":"settings_get"}'
    zenit.py --port /dev/ttyACM0 update-check
    zenit.py --ws ws://zenit-a1b2.local/ws --token <token> status

The reply is printed as JSON. The exit status is 0 for a successful reply, 1 for an error reply and 2 when the board
cannot be reached or answers nothing. The client sends `info` first and waits for its reply, as the protocol asks, and
repeats a request that gets no valid reply (2 s, 5 tries in all).

Needs Python 3.11 or later (what websockets 17 asks for), pyserial for --port and the websockets package, version 17,
for --ws.
"""

import argparse
import contextlib
import hashlib
import hmac
import json
import math
import random
import re
import sys
import time
import unicodedata
import zlib

MARKER = b"@ZN "
REPLY_TIMEOUT = 2.0
ATTEMPTS = 5
BAUD = 115200
# The longest reply line the client accepts (docs/protocol/protocol-v1.md#limits); the board sends far less
MAX_REPLY_LINE = 4096
SUPPORTED_PROTOCOL = 1


class ClientError(Exception):
    """The board could not be reached, or it answered nothing usable."""


def frame(request):
    """The line for a request object: `@ZN <crc> <json>`, without the newline."""
    body = json.dumps(request, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return MARKER + b"%08x " % zlib.crc32(body) + body


def _reject_constant(name):
    raise ValueError(f"{name} is not JSON")


def _object_without_duplicates(pairs):
    keys = [key for key, _ in pairs]
    if len(set(keys)) != len(keys):
        raise ValueError("a key is named twice")
    return dict(pairs)


def _clean(value):
    """Raises ValueError for what Python's parser lets through and the protocol forbids: an unpaired surrogate (a
    paired one has become one character), U+0000, and a number that is not finite (1e999)."""
    if isinstance(value, str):
        if any("\ud800" <= char <= "\udfff" or char == "\x00" for char in value):
            raise ValueError("a string has an unpaired surrogate or U+0000")
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("a number is not finite")
    elif isinstance(value, list):
        for item in value:
            _clean(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            _clean(key)
            _clean(item)


def strict_json(body):
    """The object in `body` (bytes), parsed by the rules of docs/protocol/protocol-v1.md#lines: valid UTF-8, one
    object and nothing after it, no newline or carriage return, no control character in a string, no NaN or Infinity,
    no unpaired surrogate escape, no U+0000, no key named twice. Raises ValueError otherwise. Replies are not bounded
    in nesting by the protocol; a nesting too deep for Python is refused as well."""
    if b"\n" in body or b"\r" in body:
        raise ValueError("a newline or carriage return inside the JSON")
    try:
        value = json.loads(
            body.decode("utf-8"),
            parse_constant=_reject_constant,
            object_pairs_hook=_object_without_duplicates,
        )
        if not isinstance(value, dict):
            raise ValueError("not an object")
        _clean(value)
    except RecursionError:
        raise ValueError("nested too deeply")
    return value


def parse_line(raw):
    """The JSON object of a protocol line, or None for anything else: a log line, a line with a bad checksum, JSON
    that breaks the protocol's rules (strict_json). The client throws these away."""
    if raw.endswith(b"\n"):
        raw = raw[:-1]
    if raw.endswith(b"\r"):
        raw = raw[:-1]
    if not raw.startswith(MARKER) or len(raw) < len(MARKER) + 9 or raw[len(MARKER) + 8 : len(MARKER) + 9] != b" ":
        return None
    digits = raw[len(MARKER) : len(MARKER) + 8]
    if not re.fullmatch(rb"[0-9a-f]{8}", digits):
        return None
    body = raw[len(MARKER) + 9 :]
    if zlib.crc32(body) != int(digits, 16):
        return None
    try:
        return strict_json(body)
    except ValueError:  # includes UnicodeDecodeError and JSONDecodeError
        return None


class SerialLink:
    """The board's USB serial port."""

    def __init__(self, port, baud=BAUD):
        try:
            import serial
        except ImportError:
            raise ClientError("--port needs the pyserial package (pip install pyserial)")
        self.serial = serial.Serial()
        self.serial.port = port
        self.serial.baudrate = baud
        self.serial.timeout = 0.05
        # Keep both control lines at pyserial's default (raised together, as the kernel does on open). Clearing one of
        # them first would run the reset sequence of the ESP32-C3's USB serial port and restart the board.
        # What pyserial raises when the port fails or the board is unplugged
        self.errors = (OSError, serial.SerialException)
        try:
            self.serial.open()
        except self.errors as error:
            raise ClientError(f"cannot open {port}: {error}")
        self.buffer = b""

    def write_line(self, line):
        try:
            self.serial.write(line + b"\n")
            self.serial.flush()
        except self.errors as error:
            raise ClientError(f"cannot write to the port: {error}")

    def read_line(self, timeout):
        """The next line, without its newline, or None when none arrives within `timeout` seconds."""
        deadline = time.monotonic() + timeout
        while True:
            at = self.buffer.find(b"\n")
            if at >= 0:
                line, self.buffer = self.buffer[:at], self.buffer[at + 1 :]
                return line
            if len(self.buffer) > 2 * MAX_REPLY_LINE:
                self.buffer = b""  # no newline in sight: the bytes are not ours
            if time.monotonic() >= deadline:
                return None
            try:
                self.buffer += self.serial.read(self.serial.in_waiting or 1)
            except self.errors as error:
                raise ClientError(f"cannot read from the port: {error}")

    def close(self):
        try:
            self.serial.close()
        except self.errors as error:
            raise ClientError(f"cannot close the port: {error}")


class WebSocketLink:
    """The WebSocket of the simulator or of a board on WiFi: one message is one line."""

    def __init__(self, url, origin=None):
        try:
            from websockets.exceptions import WebSocketException
            from websockets.sync.client import connect
        except ImportError:
            raise ClientError("--ws needs the websockets package, version 17 (pip install websockets)")
        # What the library raises when the connection fails or closes
        self.errors = (OSError, WebSocketException)
        # The connection stays open for the client's lifetime, so its context is entered here and left in close()
        self.context = contextlib.ExitStack()
        try:
            self.socket = self.context.enter_context(
                connect(url, origin=origin, compression=None, max_size=MAX_REPLY_LINE, open_timeout=5)
            )
        except Exception as error:  # the library raises many types for a refused or failed handshake
            raise ClientError(f"cannot connect to {url}: {error}")

    def write_line(self, line):
        try:
            self.socket.send(line.decode("utf-8"))
        except self.errors as error:
            raise ClientError(f"the connection closed: {error}")

    def read_line(self, timeout):
        try:
            message = self.socket.recv(timeout=timeout)
        except TimeoutError:
            return None
        except Exception as error:
            raise ClientError(f"the connection closed: {error}")
        return message if isinstance(message, bytes) else message.encode("utf-8")

    def close(self):
        try:
            self.context.close()
        except self.errors as error:
            raise ClientError(f"cannot close the connection: {error}")


# ---- What a reply must look like (docs/protocol/protocol-v1.md). A reply that does not match is unusable: the client
# throws it away and asks again. Unknown fields are ignored; every known one must have its type.


# The largest whole number a client reads: what a JavaScript number holds exactly, so the web app reads the same
MAX_INT = 2**53 - 1


def is_int(value):
    return type(value) is int and -MAX_INT <= value <= MAX_INT  # not a bool, not a float such as 1.0


def is_number(value):
    return type(value) in (int, float)


def is_text(value):
    return isinstance(value, str)


def is_bool(value):
    return isinstance(value, bool)


def is_null(value):
    return value is None


class Maybe:
    """A field a reply may leave out (a board from before the WiFi and updates milestone does)."""

    def __init__(self, schema):
        self.schema = schema


def conforms(value, schema):
    """Whether `value` fits `schema`: a predicate, a dict (an object with at least these fields; a Maybe field may be
    missing), a one-item list (an array of that), or a tuple (any of these)."""
    if callable(schema):
        return schema(value)
    if isinstance(schema, dict):
        return isinstance(value, dict) and all(
            (key not in value) if isinstance(item, Maybe) and key not in value else
            (key in value and conforms(value[key], item.schema if isinstance(item, Maybe) else item))
            for key, item in schema.items()
        )
    if isinstance(schema, list):
        return isinstance(value, list) and all(conforms(item, schema[0]) for item in value)
    return any(conforms(value, option) for option in schema)


def int_in(low, high):
    return lambda value: is_int(value) and low <= value <= high


def number_in(low, high):
    """Any number, whole or written with a fraction, from `low` to `high`."""
    return lambda value: is_number(value) and low <= value <= high


def distinct_texts(low, high):
    """An array of `low` to `high` texts, none of them twice."""
    return lambda value: conforms(value, [is_text]) and low <= len(value) <= high and len(set(value)) == len(value)


def settings_by_effect(value):
    """`info.effect_settings`: an object from effect name to the settings it reads, each named once. Names are open
    words: an effect or a setting this client does not know is any text."""
    return isinstance(value, dict) and all(
        conforms(names, [is_text]) and len(set(names)) == len(names) for names in value.values()
    )


def one_of(*words):
    return lambda value: is_text(value) and value in words


def matching(pattern):
    compiled = re.compile(pattern)
    return lambda value: is_text(value) and compiled.fullmatch(value) is not None


def where(schema, rule):
    """`schema`, and `rule(value)` of the whole object: the null-when and only-when rules of the specification."""
    return lambda value: conforms(value, schema) and rule(value)


def is_ipv4(value):
    return (
        is_text(value)
        and re.fullmatch(r"(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}", value) is not None
        and all(int(part) <= 255 for part in value.split("."))
    )


def is_network_name(value):
    return is_text(value) and 1 <= len(value.encode("utf-8")) <= 32


RELEASE = matching(r"(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})")
TOKEN = matching(r"[a-z0-9]{16}")
SETTINGS = {
    # The ranges of docs/protocol/protocol-v1.md#settings_get-settings_set
    "brightness": int_in(1, 100),
    "effect": is_text,
    "color": is_text,
    "colors": distinct_texts(2, 4),
    "color_set": is_text,
    "hold_seconds": int_in(5, 600),
    "period_seconds": int_in(4, 20),
    # A firmware from before guided_breathing has no breath_pattern
    "breath_pattern": Maybe(is_text),
    "floor": int_in(5, 80),
    "twinkle_strength": int_in(5, 50),
    "timer_minutes": int_in(0, 360),
    # Words a newer firmware may extend are any text (docs/protocol/protocol-v1.md#versions)
    "wifi_power": Maybe(is_text),
    "update_mode": Maybe(is_text),
    "update_firmware": Maybe(is_bool),
    "update_web": Maybe(is_bool),
    "check_hours": Maybe(int_in(1, 168)),
    "install_start": Maybe(int_in(0, 1439)),
    "install_end": Maybe(int_in(0, 1439)),
    "timezone": Maybe(matching(r"[\x21-\x7e]{1,64}")),
    "time_sync_hours": Maybe(int_in(1, 168)),
    "ntp_server": Maybe(matching(r"[A-Za-z0-9.-]{1,64}")),
    "network_login": Maybe(is_bool),
    "token": Maybe(TOKEN),
}
# The states of this version that are not connected, and the update states that are not downloading
WIFI_STATES_WITHOUT_ADDRESS = ("not_configured", "connecting", "not_found", "wrong_password", "no_address")
UPDATE_STATES_WITHOUT_PROGRESS = ("idle", "checking", "verifying", "restarting")
WIFI = where(
    {
        "state": is_text,
        "ssid": (is_network_name, is_null),
        "rssi": (int_in(-128, 127), is_null),
        "ip": (is_ipv4, is_null),
        "hostname": matching(r"zenit-[0-9a-f]{4}"),
    },
    # An address and a signal only while connected; no network stored, no name. A state this client does not know has
    # no rule.
    lambda wifi: (
        wifi["ip"] is not None
        if wifi["state"] == "connected"
        else wifi["state"] not in WIFI_STATES_WITHOUT_ADDRESS or (wifi["ip"] is None and wifi["rssi"] is None)
    )
    and (wifi["state"] != "not_configured" or wifi["ssid"] is None),
)
# `synced`, the time and the minute of the day come together
TIME = where(
    {"synced": is_bool, "epoch": (int_in(0, MAX_INT), is_null), "local_minute": (int_in(0, 1439), is_null)},
    lambda time: (time["synced"] is True) == (time["epoch"] is not None)
    and (time["synced"] is True) == (time["local_minute"] is not None),
)
# The web app in the board's own partition: a version while it holds one that reads, a version offered after a check
# that found one, a wait only while a missing or incompatible app is being repaired. A state this client does not know
# has no rule.
WEB_STATES_WITH_VERSION = ("ok", "incompatible")
WEB_STATES_WITHOUT_VERSION = ("missing", "installing")
WEB = where(
    {
        "state": is_text,
        # A release of at most 16 characters, as the image's header holds
        "version": (matching(r"(?=.{1,16}$)(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})"), is_null),
        "available": (RELEASE, is_null),
        "last_result": is_text,
        "retry_in": (int_in(0, 2**32), is_null),
    },
    lambda web: (web["state"] not in WEB_STATES_WITH_VERSION or web["version"] is not None)
    and (web["state"] not in WEB_STATES_WITHOUT_VERSION or web["version"] is None)
    and (web["state"] != "ok" or web["retry_in"] is None)
    and (web["last_result"] != "available" or web["available"] is not None)
    and (web["last_result"] not in ("up_to_date", "incompatible") or web["available"] is None),
)
UPDATE = where(
    {
        "mode": is_text,
        "state": is_text,
        "available": (RELEASE, is_null),
        "last_check": (int_in(0, MAX_INT), is_null),
        "last_result": is_text,
        "progress": (int_in(0, 100), is_null),
        "trial": is_bool,
        "skipped": (RELEASE, is_null),
        "rolled_back": (RELEASE, is_null),
        "target": Maybe((one_of("firmware", "web"), is_null)),
        "web": Maybe(WEB),
    },
    # A percentage only while downloading; a version offered after a check that found one; a target only while a
    # check or an install runs
    lambda update: (update["state"] != "idle" or update.get("target") is None)
    and (
        update["progress"] is not None
        if update["state"] == "downloading"
        else update["state"] not in UPDATE_STATES_WITHOUT_PROGRESS or update["progress"] is None
    )
    and (update["last_result"] not in ("available", "skipped") or update["available"] is not None)
    and (update["last_result"] != "up_to_date" or update["available"] is None),
)
# The ranges of docs/protocol/protocol-v1.md#status: a timer counts down from its minutes
TIMER = where(
    {"minutes": int_in(1, 360), "remaining": is_int},
    lambda timer: 0 <= timer["remaining"] <= timer["minutes"] * 60,
)
LIGHT = {
    "on": is_bool,
    "effect": is_text,
    "color": (is_text, is_null),
    "lightness": number_in(0, 100),
    "power_scale": int_in(1, 100),
    "timer": (is_null, TIMER),
}
# The favorites of docs/protocol/protocol-v1.md#favorites
MAX_FAVORITES = 6
MAX_FAVORITE_NAME = 20
# Control and invisible formatting characters, which a name may not hold
REFUSED_IN_NAME = re.compile("[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]")


def is_favorite_name(value):
    """1 to 20 characters (code points), none refused, no space at either end."""
    return (
        is_text(value)
        and 1 <= len(value) <= MAX_FAVORITE_NAME
        and not value.startswith(" ")
        and not value.endswith(" ")
        and REFUSED_IN_NAME.search(value) is None
    )


def name_key(name):
    """Two names are the same when equal with the ASCII letters compared without case."""
    return name.translate(str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"))


# A favorite: its look is the effect, the brightness and the settings that effect reads, with their ranges
FAVORITE = {
    "id": int_in(1, 255),
    "name": is_favorite_name,
    "effect": is_text,
    "brightness": SETTINGS["brightness"],
    **{
        key: Maybe(SETTINGS[key])
        for key in ("color", "colors", "color_set", "hold_seconds", "period_seconds", "floor", "twinkle_strength")
    },
    "breath_pattern": SETTINGS["breath_pattern"],
}
# The list: at most 6, ids and names each once, a mark that names one of them
FAVORITES = where(
    {"favorites": [FAVORITE], "start": (int_in(1, 255), is_null)},
    lambda reply: len(reply["favorites"]) <= MAX_FAVORITES
    and len({item["id"] for item in reply["favorites"]}) == len(reply["favorites"])
    and len({name_key(item["name"]) for item in reply["favorites"]}) == len(reply["favorites"])
    and (reply["start"] is None or reply["start"] in {item["id"] for item in reply["favorites"]}),
)
# `info.limits`: the favorites limits come together, from the firmware with favorites
LIMITS = where(
    {"line": is_int, "favorites": Maybe(int_in(1, 255)), "favorite_name": Maybe(int_in(1, 255))},
    lambda limits: ("favorites" in limits) == ("favorite_name" in limits),
)
# The known fields of a successful reply, by command
REPLIES = {
    "info": {
        "protocol": is_int,
        "firmware": is_text,
        "board": is_text,
        "boot_id": is_int,
        "colors": [is_text],
        "effects": [is_text],
        "effect_settings": Maybe(settings_by_effect),
        "color_sets": [is_text],
        "breath_patterns": Maybe([is_text]),
        "power_limit_mw": is_int,
        "memory": {"free": is_int, "largest": is_int},
        "nvs": {"used": is_int, "free": is_int},
        "limits": LIMITS,
    },
    "status": {"light": LIGHT, "wifi": Maybe(WIFI), "time": Maybe(TIME), "update": Maybe(UPDATE)},
    "light": {"light": LIGHT},
    "settings_get": {"settings": SETTINGS},
    "settings_set": {"settings": SETTINGS},
    "settings_reset": {"settings": SETTINGS},
    "token_regenerate": {"token": TOKEN},
    "auth_challenge": {"nonce": matching(r"[0-9a-f]{32}")},
    "update_check": {"update": UPDATE},
    "update_install": {"update": UPDATE},
    "favorites": FAVORITES,
    "favorite_save": FAVORITES,
    "favorite_rename": FAVORITES,
    "favorite_delete": FAVORITES,
    "favorite_start": FAVORITES,
    "favorite_apply": {"light": LIGHT, "settings": SETTINGS},
}


def valid_seq(value):
    return is_int(value) and 0 <= value < 2**32


def valid_body(command, reply):
    """Whether `ok`, the error fields and the command's known fields of a reply have their types."""
    ok = reply.get("ok")
    if ok is False:
        return is_text(reply.get("error")) and is_text(reply.get("message"))
    return ok is True and conforms(reply, REPLIES.get(command, {}))


def is_bad_frame_reply(reply):
    """The reply to a line the board could not read: no `seq`, an error."""
    return "seq" not in reply and valid_body("", reply) and reply.get("ok") is False and reply.get("error") == "bad_frame"


class Client:
    """One request in flight at a time, repeated until a valid reply with the same `seq` arrives."""

    def __init__(self, link, timeout=REPLY_TIMEOUT, attempts=ATTEMPTS, seq=None):
        self.link = link
        self.timeout = timeout
        self.attempts = attempts
        # A random start: a board remembers its last reply, and a new run must not look like a retry of the last one
        self.seq = random.randrange(0, 2**31) if seq is None else seq
        self.info = None

    def request(self, command, **fields):
        """`send` with the fields as keyword arguments, for a command whose field names are known to be safe."""
        return self.send(command, fields)

    def send(self, command, fields, seq=None):
        """Sends a request and returns the reply object. `fields` is a dict, so any field name is fine. A `seq` given
        is used and matched in the reply as it is; otherwise the next one is. Raises ClientError when no reply
        arrives."""
        if "seq" in fields or "cmd" in fields:
            raise ClientError("seq and cmd are not fields: pass seq as the argument")
        if seq is None:
            seq = self.seq
            self.seq = (self.seq + 1) % 2**32
        line = frame({"seq": seq, "cmd": command, **fields})
        malformed = False
        for _ in range(self.attempts):
            self.link.write_line(line)
            deadline = time.monotonic() + self.timeout
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                raw = self.link.read_line(remaining)
                if raw is None:
                    break
                reply = parse_line(raw)
                if reply is None or ("event" in reply and "seq" not in reply):
                    continue  # a line to throw away, or an event this client does not know
                # The same seq, of the same JSON type: 1.0 and true are not 1
                if type(reply.get("seq")) is type(seq) and reply["seq"] == seq:
                    if valid_body(command, reply) and (not is_int(seq) or valid_seq(reply["seq"])):
                        return reply
                    malformed = True  # unusable: ask again
                    continue
                if is_bad_frame_reply(reply):
                    break  # the board did not understand the line: send it again at once
        raise ClientError(f"no reply to {command} after {self.attempts} tries" + (" that was well formed" if malformed else ""))

    def login(self, token):
        """The network login of a WiFi client: auth_challenge, then auth with the HMAC-SHA256 of the nonce under the
        token. Returns the reply of `auth`."""
        challenge = self.request("auth_challenge")
        if not challenge.get("ok"):
            return challenge
        digest = hmac.new(token.encode("ascii"), challenge["nonce"].encode("ascii"), hashlib.sha256).hexdigest()
        return self.request("auth", hmac=digest)

    def handshake(self):
        """`info` first, as the protocol asks, and a check of the protocol version."""
        reply = self.request("info")
        if not reply.get("ok"):
            raise ClientError(f"info failed: {reply.get('error')}")
        if reply.get("protocol") != SUPPORTED_PROTOCOL:
            raise ClientError(f"the board speaks protocol {reply.get('protocol')}, this client protocol {SUPPORTED_PROTOCOL}")
        self.info = reply
        return reply


def parse_value(key, text):
    """The JSON value of a `key=value` setting: whole numbers, true, false and null as such, `colors` as a comma
    separated list, anything else as text."""
    if key == "colors":
        return [name for name in text.split(",") if name]
    if text in ("true", "false", "null"):
        return json.loads(text)
    if re.fullmatch(r"-?[0-9]+", text):
        return int(text)
    return text


def parse_settings(pairs):
    settings = {}
    for pair in pairs:
        key, sep, text = pair.partition("=")
        if not sep or not key:
            raise ValueError(f"expected KEY=VALUE, got '{pair}'")
        if key in ("seq", "cmd"):
            raise ValueError(f"'{key}' is not a setting")
        settings[key] = parse_value(key, text)
    return settings


def build_parser():
    parser = argparse.ArgumentParser(description="Command line client of the Zenit command protocol.")
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--port", help="USB serial port of the board, e.g. /dev/ttyACM0")
    where.add_argument("--ws", metavar="URL", help="WebSocket of the simulator or the board, e.g. ws://127.0.0.1:8765")
    parser.add_argument("--origin", help="Origin header to send with --ws (none by default, as command line clients do)")
    parser.add_argument("--token", help="the board's token, to log in over --ws when network login is on")
    parser.add_argument("--timeout", type=float, default=REPLY_TIMEOUT, help="seconds to wait for a reply (default 2)")
    parser.add_argument("--attempts", type=int, default=ATTEMPTS, help="tries in all for a request (default 5)")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("info", help="what the board is and supports")
    commands.add_parser("status", help="the state of the light")
    commands.add_parser("settings-get", help="every setting")
    commands.add_parser("settings-reset", help="every setting back to its default (USB only)")
    settings = commands.add_parser("settings-set", help="change settings, e.g. brightness=40 colors=red,blue")
    settings.add_argument("settings", nargs="+", metavar="KEY=VALUE")
    commands.add_parser("wifi-forget", help="forget the stored WiFi network (USB only)")
    commands.add_parser("token-regenerate", help="make a new token (USB only)")
    commands.add_parser("update-check", help="check for a firmware and web app update now")
    install = commands.add_parser("update-install", help="install the firmware version the last check found")
    what = install.add_mutually_exclusive_group()
    what.add_argument("--force", action="store_true", help="install a version on the skip list")
    what.add_argument("--web", action="store_true", help="install the web app version the last check found instead")
    light = commands.add_parser("light", help="turn the light on or off, without saving")
    light.add_argument("state", choices=["on", "off"])
    commands.add_parser("favorites", help="the favorites and the one the light turns on with")
    save = commands.add_parser("favorite-save", help="save the current look as a new favorite, or over one with --id")
    target = save.add_mutually_exclusive_group(required=True)
    target.add_argument("--name", help="the name of a new favorite")
    target.add_argument("--id", type=int, help="the favorite that takes the current look")
    rename = commands.add_parser("favorite-rename", help="rename a favorite")
    rename.add_argument("id", type=int)
    rename.add_argument("name")
    for name, text in (("favorite-delete", "delete a favorite"), ("favorite-apply", "apply a favorite and turn on")):
        commands.add_parser(name, help=text).add_argument("id", type=int)
    start = commands.add_parser("favorite-start", help="the favorite the light turns on with, or none")
    start.add_argument("id", help="a favorite's id, or none")
    raw = commands.add_parser("raw", help="send a request object as it is; `seq` is added unless given")
    raw.add_argument("json", help='e.g. \'{"cmd":"settings_get"}\'')
    return parser


def request_of(args):
    """(command, fields) of the parsed command line."""
    if args.command == "settings-set":
        return "settings_set", parse_settings(args.settings)
    if args.command == "light":
        return "light", {"on": args.state == "on"}
    if args.command == "update-install":
        if args.web:
            return "update_install", {"target": "web"}
        return "update_install", {"target": "firmware", **({"force": True} if args.force else {})}
    if args.command == "favorite-save":
        # Names travel in normalization form C, as the protocol asks of clients
        if args.name is not None:
            return "favorite_save", {"name": unicodedata.normalize("NFC", args.name)}
        return "favorite_save", {"id": args.id}
    if args.command == "favorite-rename":
        return "favorite_rename", {"id": args.id, "name": unicodedata.normalize("NFC", args.name)}
    if args.command in ("favorite-delete", "favorite-apply"):
        return args.command.replace("-", "_"), {"id": args.id}
    if args.command == "favorite-start":
        if args.id == "none":
            return "favorite_start", {"id": None}
        if not args.id.isdigit():
            raise ValueError("favorite-start expects a favorite's id or none")
        return "favorite_start", {"id": int(args.id)}
    if args.command == "raw":
        fields = json.loads(args.json)
        if not isinstance(fields, dict) or not isinstance(fields.get("cmd"), str):
            raise ValueError('raw expects a JSON object with a text "cmd"')
        command = fields.pop("cmd")
        return command, fields
    return args.command.replace("-", "_"), {}


def main(argv=None, out=None):
    out = out or sys.stdout
    args = build_parser().parse_args(argv)
    try:
        command, fields = request_of(args)
    except ValueError as error:
        print(f"zenit: {error}", file=sys.stderr)
        return 2
    link = None
    try:
        link = SerialLink(args.port) if args.port else WebSocketLink(args.ws, args.origin)
        client = Client(link, args.timeout, args.attempts)
        client.handshake()
        if args.token and args.ws:
            login = client.login(args.token)
            if not login.get("ok"):
                print(f"zenit: the login failed: {login.get('error')}", file=sys.stderr)
                return 2
        seq = fields.pop("seq", None) if args.command == "raw" else None
        # raw sends what it is given, even `info`
        reply = client.info if args.command == "info" else client.send(command, fields, seq)
        # A link that fails to close has failed: the reply may not be the whole story
        closing, link = link, None
        closing.close()
    except ClientError as error:
        print(f"zenit: {error}", file=sys.stderr)
        return 2
    finally:
        # After an earlier failure the link is closed as well as it can be, and the first error is the one reported
        if link is not None:
            with contextlib.suppress(ClientError):
                link.close()
    print(json.dumps(reply, indent=2, ensure_ascii=False), file=out)
    return 0 if reply.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
