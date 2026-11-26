# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of tools/zenit.py: python3 -m unittest discover -s tools

The client is tested against scripted links, and against the simulator when its program is built (pio run -e native).
"""

import io
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import zenit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SIMULATOR = ROOT / ".pio" / "build" / "native" / "program"
# CI has every dependency and builds the simulator first: a missing one there is a failure, not a skip
IN_CI = bool(os.environ.get("CI"))
try:
    import websockets.exceptions

    HAVE_WEBSOCKETS = True
except ImportError:
    HAVE_WEBSOCKETS = False


def reply_line(**fields):
    return zenit.frame(fields)


class ScriptedLink:
    """A link whose replies come from `respond(sent_line) -> list of lines`; an empty queue is a timeout."""

    def __init__(self, respond):
        self.respond = respond
        self.sent = []
        self.queue = []
        self.closed = False

    def write_line(self, line):
        self.sent.append(line)
        self.queue.extend(self.respond(line, len(self.sent)))

    def read_line(self, timeout):
        return self.queue.pop(0) if self.queue else None

    def close(self):
        self.closed = True


def seq_of(line):
    return zenit.parse_line(line)["seq"]


LIGHT = {"on": True, "effect": "static", "color": "white", "lightness": 60.0, "power_scale": 100, "timer": None}
SETTINGS = {
    "brightness": 60,
    "effect": "static",
    "color": "white",
    "colors": ["red", "green"],
    "color_set": "christmas",
    "hold_seconds": 30,
    "period_seconds": 8,
    "floor": 20,
    "twinkle_strength": 20,
    "timer_minutes": 0,
}
INFO = {
    "protocol": 1,
    "firmware": "1.0.0",
    "board": "simulator",
    "boot_id": 7,
    "colors": ["white"],
    "effects": ["static"],
    "color_sets": ["ice"],
    "power_limit_mw": 1000,
    "memory": {"free": 0, "largest": 0},
    "nvs": {"used": 0, "free": 0},
    "limits": {"line": 1024},
}
# A well formed success reply of each command, with a field that is not in the protocol, which clients ignore
FIELDS = {
    "info": INFO,
    "status": {"light": LIGHT},
    "light": {"light": LIGHT},
    "settings_get": {"settings": SETTINGS},
    "settings_set": {"settings": SETTINGS},
    "settings_reset": {"settings": SETTINGS},
}


def good_reply(line, **changes):
    """A well formed success reply to a request line, with `changes` over its fields."""
    request = zenit.parse_line(line)
    fields = dict(FIELDS.get(request["cmd"], {}), future_field=[1], **changes)
    return reply_line(seq=request["seq"], ok=True, **fields)


def echo_ok(line, count):
    return [good_reply(line)]


class FrameTest(unittest.TestCase):
    def test_frame_matches_the_specification(self):
        self.assertEqual(zenit.frame({"seq": 1, "cmd": "info"}), b'@ZN 3c250228 {"seq":1,"cmd":"info"}')

    def test_frame_keeps_utf8(self):
        line = zenit.frame({"seq": 1, "cmd": "x", "text": "café"})
        self.assertIn("café".encode(), line)
        self.assertEqual(zenit.parse_line(line)["text"], "café")

    def test_parse_line_accepts_a_frame_with_or_without_the_newline(self):
        line = b'@ZN 3c250228 {"seq":1,"cmd":"info"}'
        for raw in (line, line + b"\n", line + b"\r\n"):
            self.assertEqual(zenit.parse_line(raw), {"seq": 1, "cmd": "info"})

    def test_parse_line_throws_away_everything_else(self):
        for raw in (
            b"zenit: firmware 1.0.0 on esp32c3",
            b"",
            b"@ZN",
            b'@ZN 3c250229 {"seq":1,"cmd":"info"}',
            b'@ZN 3C250228 {"seq":1,"cmd":"info"}',
            b'@ZN 3c25022 {"seq":1,"cmd":"info"}',
            b'@ZN 3c250228{"seq":1,"cmd":"info"}',
            b"@ZN 00000000 ",
            zenit.frame({}).replace(b"{}", b"[]"),
            b'@ZN 00000000 {"a":1}',
            b'@zn 3c250228 {"seq":1,"cmd":"info"}',
            b" @ZN 3c250228 " + b'{"seq":1,"cmd":"info"}',
        ):
            self.assertIsNone(zenit.parse_line(raw), raw)

    @staticmethod
    def checksummed(body):
        import zlib

        return b"@ZN %08x " % zlib.crc32(body) + body

    def test_parse_line_throws_away_json_the_protocol_forbids_even_with_a_good_checksum(self):
        bad = {
            "NaN": b'{"seq":NaN}',
            "Infinity": b'{"seq":Infinity}',
            "-Infinity": b'{"seq":-Infinity}',
            "a number too big for a float": b'{"x":1e999}',
            "a negative one": b'{"x":-1e999}',
            "a key twice": b'{"seq":1,"seq":2}',
            "a key twice, one escaped": b'{"a":1,"\\u0061":2}',
            "a key twice, nested": b'{"light":{"on":true,"on":false}}',
            "a key twice in an array": b'{"l":[{"a":1,"a":2}]}',
            "a tab inside a string": b'{"a":"x\ty"}',
            "a control character inside a string": b'{"a":"x\x01y"}',
            "a lone high surrogate": b'{"a":"\\ud800"}',
            "a lone low surrogate": b'{"a":"\\udc00"}',
            "a lone surrogate in a key": b'{"\\ud800":1}',
            "a lone surrogate in an array": b'{"a":["\\ud800"]}',
            "a high surrogate and a letter": b'{"a":"\\ud800\\u0041"}',
            "an escaped U+0000": b'{"a":"\\u0000"}',
            "an escaped U+0000 in a key": b'{"\\u0000":1}',
            "a raw U+0000": b'{"a":"\x00"}',
            "invalid UTF-8": b'{"a":"\xff"}',
            "a truncated sequence": b'{"a":"\xc3"}',
            "an encoded surrogate": b'{"a":"\xed\xa0\x80"}',
            "an overlong form": b'{"a":"\xc0\x80"}',
            "a byte order mark": b'\xef\xbb\xbf{"a":1}',
            "data after the object": b'{"a":1} x',
            "a second object": b'{"a":1}{"b":2}',
            "a comment": b'{"a":1} // c',
            "a trailing comma": b'{"a":1,}',
            "single quotes": b"{'a':1}",
            "an unquoted key": b'{a:1}',
            "a leading plus": b'{"a":+1}',
            "a leading zero": b'{"a":01}',
            "a newline between tokens": b'{"a":\n1}',
            "a carriage return between tokens": b'{"a":\r1}',
            "a carriage return at the end": b'{"a":1}\r',
            "nesting too deep for Python": b'{"a":' + b"[" * 100000 + b"]" * 100000 + b"}",
        }
        for name, body in bad.items():
            self.assertIsNone(zenit.parse_line(self.checksummed(body)), name)

    def test_parse_line_accepts_what_the_protocol_allows(self):
        good = {
            "a paired surrogate escape": (b'{"a":"\\ud83d\\ude00"}', {"a": "\U0001F600"}),
            "an escaped newline in a string": (b'{"a":"x\\ny"}', {"a": "x\ny"}),
            "tabs and spaces between tokens": (b'{ "a"\t:\t[ 1 , 2.5 , -3e2 , null , true ] }', {"a": [1, 2.5, -300.0, None, True]}),
            "the same key in different objects": (b'{"a":{"a":1},"b":{"a":2}}', {"a": {"a": 1}, "b": {"a": 2}}),
            "nesting deeper than a request may": (b'{"a":{"b":{"c":{"d":{"e":[1]}}}}}', {"a": {"b": {"c": {"d": {"e": [1]}}}}}),
            "UTF-8 text": ('{"a":"caf\u00e9"}'.encode(), {"a": "caf\u00e9"}),
            "an unknown field": (b'{"future":{"x":[]}}', {"future": {"x": []}}),
        }
        for name, (body, value) in good.items():
            self.assertEqual(zenit.parse_line(self.checksummed(body)), value, name)

    def test_a_forbidden_reply_with_a_good_checksum_is_discarded_and_the_request_repeated(self):
        client = zenit.Client(
            ScriptedLink(lambda line, count: [self.checksummed(b'{"seq":%d,"ok":true,"ok":true}' % seq_of(line))]),
            timeout=2,
            seq=10,
            attempts=3,
        )
        with self.assertRaisesRegex(zenit.ClientError, "no reply to status after 3 tries$"):
            client.request("status")
        link = ScriptedLink(
            lambda line, count: [self.checksummed(b'{"seq":%d,"ok":NaN}' % seq_of(line))]
            if count < 3
            else [good_reply(line)]
        )
        client = zenit.Client(link, timeout=2, seq=10)
        self.assertTrue(client.request("status")["ok"])
        self.assertEqual(len(link.sent), 3)

    def test_parse_line_throws_away_a_checksummed_array_and_bad_utf8(self):
        import zlib

        for body in (b"[1]", b"\xff"):
            raw = b"@ZN %08x " % zlib.crc32(body) + body
            self.assertIsNone(zenit.parse_line(raw))


class RetryTest(unittest.TestCase):
    def client(self, respond, **kwargs):
        link = ScriptedLink(respond)
        return zenit.Client(link, timeout=2, seq=10, **kwargs), link

    def test_the_reply_with_the_same_seq_is_returned(self):
        client, link = self.client(echo_ok)
        reply = client.request("status")
        self.assertEqual((reply["seq"], reply["ok"], reply["light"]["lightness"]), (10, True, 60.0))
        self.assertEqual(len(link.sent), 1)
        self.assertEqual(zenit.parse_line(link.sent[0]), {"seq": 10, "cmd": "status"})

    def test_send_takes_any_field_name_and_a_given_seq(self):
        client, link = self.client(echo_ok)
        client.send("x", {"command": 1, "self": 2, "fields": 3}, seq=99)
        self.assertEqual(zenit.parse_line(link.sent[0]), {"seq": 99, "cmd": "x", "command": 1, "self": 2, "fields": 3})
        client.send("x", {})
        self.assertEqual(seq_of(link.sent[1]), 10)

    def test_a_field_named_seq_or_cmd_is_refused(self):
        client, link = self.client(echo_ok)
        for fields in ({"seq": 1}, {"cmd": "x"}):
            with self.assertRaises(zenit.ClientError):
                client.send("x", fields)
        self.assertEqual(link.sent, [])

    def test_each_request_has_a_new_seq(self):
        client, link = self.client(echo_ok)
        client.request("status")
        client.request("status")
        self.assertEqual([seq_of(line) for line in link.sent], [10, 11])

    def test_a_missing_reply_repeats_the_same_line(self):
        client, link = self.client(lambda line, count: [] if count < 3 else echo_ok(line, count))
        self.assertTrue(client.request("status")["ok"])
        self.assertEqual(len(link.sent), 3)
        self.assertEqual(len(set(link.sent)), 1)

    def test_it_gives_up_after_five_tries(self):
        client, link = self.client(lambda line, count: [])
        with self.assertRaisesRegex(zenit.ClientError, "no reply to status after 5 tries"):
            client.request("status")
        self.assertEqual(len(link.sent), 5)

    def test_attempts_can_be_changed(self):
        client, link = self.client(lambda line, count: [], attempts=2)
        with self.assertRaises(zenit.ClientError):
            client.request("status")
        self.assertEqual(len(link.sent), 2)

    def test_bad_frame_repeats_at_once(self):
        def respond(line, count):
            return [reply_line(ok=False, error="bad_frame", message="x")] if count == 1 else echo_ok(line, count)

        client, link = self.client(respond)
        self.assertTrue(client.request("status")["ok"])
        self.assertEqual(len(link.sent), 2)

    def test_lines_to_throw_away_are_skipped_without_a_new_try(self):
        def respond(line, count):
            return [
                b"zenit: log line",
                b'@ZN 00000000 {"seq":10,"ok":false}',  # bad checksum
                reply_line(event="x", detail=1),  # an event
                reply_line(seq=99, ok=True, light=LIGHT),  # another request's reply
                good_reply(line),
            ]

        client, link = self.client(respond)
        self.assertEqual(client.request("status")["seq"], 10)
        self.assertEqual(len(link.sent), 1)

    def test_an_error_reply_is_a_reply(self):
        client, _ = self.client(lambda line, count: [reply_line(seq=seq_of(line), ok=False, error="bad_request", message="m")])
        self.assertEqual(client.request("settings_set", brightness=0)["error"], "bad_request")

    def test_fields_are_sent(self):
        client, link = self.client(echo_ok)
        client.request("settings_set", brightness=40, colors=["red", "blue"])
        self.assertEqual(
            zenit.parse_line(link.sent[0]),
            {"seq": 10, "cmd": "settings_set", "brightness": 40, "colors": ["red", "blue"]},
        )

    def test_seq_wraps_at_32_bits(self):
        link = ScriptedLink(echo_ok)
        client = zenit.Client(link, seq=2**32 - 1)
        client.request("status")
        client.request("status")
        self.assertEqual([seq_of(line) for line in link.sent], [2**32 - 1, 0])

    def test_the_handshake_checks_the_protocol_version(self):
        client, link = self.client(echo_ok)
        self.assertEqual(client.handshake()["board"], "simulator")
        client, link = self.client(lambda line, count: [good_reply(line, protocol=2)])
        with self.assertRaisesRegex(zenit.ClientError, "protocol 2"):
            client.handshake()
        client, link = self.client(lambda line, count: [reply_line(seq=seq_of(line), ok=False, error="bad_request", message="m")])
        with self.assertRaisesRegex(zenit.ClientError, "info failed"):
            client.handshake()


class ReplyValidationTest(unittest.TestCase):
    """A reply with a wrong type is unusable: the client asks again, and fails after its tries."""

    def client(self, respond, **kwargs):
        link = ScriptedLink(respond)
        return zenit.Client(link, timeout=2, seq=10, **kwargs), link

    def assert_discarded(self, command, make_reply):
        """`make_reply(line)` is the only reply the board ever sends: the client must not accept it."""
        client, link = self.client(lambda line, count: [make_reply(line)])
        with self.assertRaisesRegex(zenit.ClientError, f"no reply to {command} after 5 tries that was well formed"):
            client.request(command)
        self.assertEqual(len(link.sent), 5)

    def test_a_seq_that_is_not_the_same_integer_is_not_the_reply(self):
        for seq in (10.0, True, "10", [10], None, 11):
            client, link = self.client(lambda line, count: [reply_line(seq=seq, ok=True, light=LIGHT)], attempts=2)
            with self.assertRaisesRegex(zenit.ClientError, "no reply to status after 2 tries$"):
                client.request("status")

    def test_a_seq_of_true_is_not_1(self):
        link = ScriptedLink(lambda line, count: [reply_line(seq=True, ok=True, light=LIGHT)])
        client = zenit.Client(link, timeout=2, seq=1, attempts=1)
        with self.assertRaises(zenit.ClientError):
            client.request("status")

    def test_a_seq_out_of_range_is_not_a_reply(self):
        link = ScriptedLink(lambda line, count: [good_reply(line)])
        client = zenit.Client(link, timeout=2, attempts=1)
        with self.assertRaises(zenit.ClientError):
            client.send("status", {}, seq=2**32)
        self.assertEqual(client.send("status", {}, seq=2**32 - 1)["seq"], 2**32 - 1)

    def test_ok_must_be_a_boolean(self):
        for ok in ("false", "true", 1, 0, None, [], "ok"):
            self.assert_discarded("status", lambda line, ok=ok: reply_line(seq=seq_of(line), ok=ok, light=LIGHT))
        self.assert_discarded("status", lambda line: reply_line(seq=seq_of(line), light=LIGHT))

    def test_an_error_reply_needs_text_error_and_message(self):
        for fields in (
            {},
            {"error": "bad_request"},
            {"message": "m"},
            {"error": 5, "message": "m"},
            {"error": "bad_request", "message": None},
            {"error": ["bad_request"], "message": "m"},
        ):
            self.assert_discarded("status", lambda line, f=fields: reply_line(seq=seq_of(line), ok=False, **f))

    def test_known_fields_of_a_success_reply_need_their_types(self):
        broken = {
            "info": [
                {"protocol": "1"},
                {"protocol": 1.0},
                {"protocol": True},
                {"firmware": 1},
                {"board": None},
                {"boot_id": "7"},
                {"colors": "white"},
                {"colors": [1]},
                {"power_limit_mw": 1.5},
                {"memory": {"free": 1}},
                {"memory": []},
                {"nvs": {"used": "0", "free": 0}},
                {"limits": {"line": "1024"}},
                {"limits": {}},
            ],
            "status": [{"light": None}, {"light": {**LIGHT, "on": "true"}}, {"light": {**LIGHT, "lightness": "60.0"}}, {"light": {**LIGHT, "power_scale": 100.5}}, {"light": {**LIGHT, "timer": {"minutes": 1}}}, {"light": {**LIGHT, "color": 5}}, {"light": {k: v for k, v in LIGHT.items() if k != "effect"}}],
            "settings_get": [{"settings": []}, {"settings": {**SETTINGS, "brightness": "60"}}, {"settings": {**SETTINGS, "brightness": 60.0}}, {"settings": {**SETTINGS, "colors": ["red", 2]}}, {"settings": {k: v for k, v in SETTINGS.items() if k != "floor"}}],
        }
        for command, changes in broken.items():
            for change in changes:
                self.assert_discarded(command, lambda line, c=change: good_reply(line, **c))

    def test_a_well_formed_reply_with_unknown_fields_and_nullable_parts_is_accepted(self):
        client, _ = self.client(lambda line, count: [good_reply(line, extra={"a": [1]}, light={**LIGHT, "color": None, "timer": {"minutes": 1, "remaining": 5, "later": True}, "lightness": 7})])
        self.assertEqual(client.request("status")["light"]["lightness"], 7)

    def test_an_unknown_command_needs_only_the_common_fields(self):
        client, _ = self.client(lambda line, count: [reply_line(seq=seq_of(line), ok=True, anything="goes")])
        self.assertTrue(client.request("future_command")["ok"])

    def test_a_malformed_reply_is_followed_by_a_good_one_within_the_tries(self):
        def respond(line, count):
            return [good_reply(line, protocol="1")] if count < 3 else [good_reply(line)]

        client, link = self.client(respond)
        self.assertEqual(client.handshake()["protocol"], 1)
        self.assertEqual(len(link.sent), 3)

    def test_a_bad_frame_reply_with_a_wrong_type_is_ignored(self):
        def respond(line, count):
            if count == 1:
                return [reply_line(ok="false", error="bad_frame", message="m")]
            return [good_reply(line)]

        client, link = self.client(respond)
        client.request("status")
        self.assertEqual(len(link.sent), 2)

    def test_the_cli_fails_clearly_on_a_malformed_reply(self):
        link = ScriptedLink(lambda line, count: [good_reply(line, protocol="1")])
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(zenit, "SerialLink", return_value=link), mock.patch("sys.stderr", err):
            status = zenit.main(["--port", "x", "--timeout", "0.01", "--attempts", "2", "info"], out)
        self.assertEqual(status, 2)
        self.assertEqual(out.getvalue(), "")
        self.assertIn("no reply to info after 2 tries that was well formed", err.getvalue())


class ArgumentsTest(unittest.TestCase):
    def test_parse_value(self):
        self.assertEqual(zenit.parse_value("brightness", "40"), 40)
        self.assertEqual(zenit.parse_value("brightness", "-3"), -3)
        self.assertEqual(zenit.parse_value("effect", "breathing"), "breathing")
        self.assertEqual(zenit.parse_value("colors", "red,blue"), ["red", "blue"])
        self.assertEqual(zenit.parse_value("colors", "red"), ["red"])
        self.assertEqual(zenit.parse_value("x", "true"), True)
        self.assertEqual(zenit.parse_value("x", "false"), False)
        self.assertIsNone(zenit.parse_value("x", "null"))
        self.assertEqual(zenit.parse_value("x", "4.5"), "4.5")
        self.assertEqual(zenit.parse_value("x", ""), "")

    def test_parse_settings(self):
        self.assertEqual(zenit.parse_settings(["brightness=40", "colors=red,blue"]), {"brightness": 40, "colors": ["red", "blue"]})
        for bad in ("brightness", "=3"):
            with self.assertRaises(ValueError):
                zenit.parse_settings([bad])

    def request(self, *argv):
        return zenit.request_of(zenit.build_parser().parse_args(["--port", "x", *argv]))

    def test_request_of(self):
        self.assertEqual(self.request("info"), ("info", {}))
        self.assertEqual(self.request("settings-get"), ("settings_get", {}))
        self.assertEqual(self.request("settings-reset"), ("settings_reset", {}))
        self.assertEqual(self.request("settings-set", "brightness=40"), ("settings_set", {"brightness": 40}))
        self.assertEqual(self.request("light", "on"), ("light", {"on": True}))
        self.assertEqual(self.request("light", "off"), ("light", {"on": False}))
        self.assertEqual(self.request("raw", '{"cmd":"light","on":true}'), ("light", {"on": True}))
        self.assertEqual(self.request("wifi-forget"), ("wifi_forget", {}))
        self.assertEqual(self.request("token-regenerate"), ("token_regenerate", {}))
        self.assertEqual(self.request("update-check"), ("update_check", {}))
        self.assertEqual(self.request("update-install"), ("update_install", {"target": "firmware"}))
        self.assertEqual(self.request("update-install", "--force"), ("update_install", {"target": "firmware", "force": True}))
        self.assertEqual(self.request("update-install", "--web"), ("update_install", {"target": "web"}))
        with self.assertRaises(ValueError):
            self.request("raw", "[1]")
        with self.assertRaises(ValueError):
            self.request("raw", '{"seq":1}')
        with self.assertRaises(ValueError):
            self.request("raw", "not json")

    def test_port_or_ws_is_required_and_exclusive(self):
        parser = zenit.build_parser()
        for argv in (["info"], ["--port", "a", "--ws", "ws://x", "info"]):
            with self.assertRaises(SystemExit), mock.patch("sys.stderr", io.StringIO()):
                parser.parse_args(argv)


WIFI = {"state": "connected", "ssid": "HomeNet", "rssi": -61, "ip": "192.168.1.20", "hostname": "zenit-a1b2"}
TIME = {"synced": True, "epoch": 1790000000, "local_minute": 853}
UPDATE = {
    "mode": "automatic",
    "state": "idle",
    "available": None,
    "last_check": None,
    "last_result": "never",
    "progress": None,
    "trial": False,
    "skipped": None,
    "rolled_back": None,
}


WEB = {"state": "ok", "version": "1.0.0", "available": None, "last_result": "never", "retry_in": None}


class WebAppUpdatesRepliesTest(unittest.TestCase):
    """The web app in its own partition: `update.target` and `update.web`, optional for a board from before them."""

    def accepted(self, **update):
        return zenit.valid_body("status", {"ok": True, "light": LIGHT, "update": {**UPDATE, **update}})

    def test_the_web_part_is_optional_but_checked(self):
        self.assertTrue(self.accepted())
        self.assertTrue(self.accepted(target=None, web=WEB))
        self.assertTrue(self.accepted(state="downloading", progress=10, target="web", web={**WEB, "state": "installing", "version": None}))
        self.assertTrue(self.accepted(web={**WEB, "state": "missing", "version": None, "last_result": "unreachable", "retry_in": 61}))
        self.assertTrue(self.accepted(web={**WEB, "last_result": "available", "available": "1.1.0"}))
        self.assertTrue(self.accepted(web={**WEB, "state": "incompatible", "last_result": "incompatible"}))
        self.assertTrue(self.accepted(web={**WEB, "state": "repairing", "version": None}))  # a newer state

    def test_web_values_the_specification_does_not_allow_are_refused(self):
        bad = [
            {"target": "both"}, {"target": "web"}, {"web": {**WEB, "state": 1}},
            {"web": {**WEB, "version": None}}, {"web": {**WEB, "state": "incompatible", "version": None}},
            {"web": {**WEB, "state": "missing"}}, {"web": {**WEB, "state": "installing"}},
            {"web": {**WEB, "retry_in": 30}}, {"web": {**WEB, "retry_in": -1}},
            {"web": {**WEB, "last_result": "available"}}, {"web": {**WEB, "last_result": "up_to_date", "available": "1.1.0"}},
            {"web": {**WEB, "last_result": "incompatible", "available": "2.0.0"}}, {"web": {**WEB, "available": "1.1"}},
            {"web": {**WEB, "version": "1..2"}}, {"web": {**WEB, "version": "1."}}, {"web": {**WEB, "version": "01.2.3"}},
            {"web": {**WEB, "version": "12345.12345.12345"}},
            {"web": {k: v for k, v in WEB.items() if k != "retry_in"}},
        ]  # fmt: skip
        for change in bad:
            self.assertFalse(self.accepted(**change), str(change))

    def test_the_web_setting_is_optional_but_a_boolean(self):
        self.assertTrue(zenit.valid_body("settings_get", {"ok": True, "settings": {**SETTINGS, "update_web": False}}))
        self.assertFalse(zenit.valid_body("settings_get", {"ok": True, "settings": {**SETTINGS, "update_web": "no"}}))


class WifiAndUpdatesRepliesTest(unittest.TestCase):
    """The replies of milestone 4: new parts a board of before it leaves out, and the new commands."""

    def accepted(self, command, **fields):
        return zenit.valid_body(command, {"ok": True, **fields})

    def test_the_new_parts_of_status_are_optional_but_checked(self):
        self.assertTrue(self.accepted("status", light=LIGHT))
        self.assertTrue(self.accepted("status", light=LIGHT, wifi=WIFI, time=TIME, update=UPDATE))
        self.assertFalse(self.accepted("status", light=LIGHT, wifi={**WIFI, "state": 3}))
        # A very strong signal can read slightly above 0 dBm
        self.assertTrue(self.accepted("status", light=LIGHT, wifi={**WIFI, "rssi": 3}))
        self.assertFalse(self.accepted("status", light=LIGHT, time={**TIME, "synced": 1}))
        self.assertFalse(self.accepted("status", light=LIGHT, update={**UPDATE, "progress": 1.5}))

    def test_status_parts_with_a_value_the_specification_does_not_allow_are_refused(self):
        bad_wifi = [
            {"hostname": "zenit"}, {"rssi": 128}, {"rssi": -200}, {"ssid": ""}, {"ssid": "x" * 33},
            {"ip": "300.1.1.1"}, {"state": "connected", "ip": None}, {"state": "connecting", "ip": "192.168.1.5"},
            {"state": "wrong_password", "rssi": -60, "ip": None},
            {"state": "not_configured", "ip": None, "rssi": None, "ssid": "HomeNet"},
        ]  # fmt: skip
        for change in bad_wifi:
            self.assertFalse(self.accepted("status", light=LIGHT, wifi={**WIFI, **change}), str(change))
        bad_time = [
            {"synced": True, "epoch": None, "local_minute": None}, {"synced": False, "epoch": 5, "local_minute": None},
            {"synced": True, "epoch": 5, "local_minute": 1440}, {"synced": True, "epoch": -1, "local_minute": 3},
        ]  # fmt: skip
        for time in bad_time:
            self.assertFalse(self.accepted("status", light=LIGHT, time=time), str(time))
        bad_update = [
            {"state": "downloading", "progress": 500}, {"state": "downloading", "progress": -1},
            {"state": "downloading", "progress": None}, {"state": "idle", "progress": 5},             {"available": "1.2"}, {"available": "1.2.0-rc.1"},
            {"skipped": "latest"}, {"rolled_back": 3}, {"last_check": -5},
            {"last_result": "available", "available": None}, {"last_result": "skipped", "available": None},
            {"last_result": "up_to_date", "available": "1.2.0"},
        ]  # fmt: skip
        for change in bad_update:
            self.assertFalse(self.accepted("status", light=LIGHT, update={**UPDATE, **change}), str(change))
        good = {**UPDATE, "state": "downloading", "progress": 100, "available": "1.2.0", "last_result": "available"}
        self.assertTrue(self.accepted("status", light=LIGHT, update=good))

    def test_the_words_a_newer_firmware_may_add_are_accepted(self):
        accepted = [
            {"wifi": {**WIFI, "state": "roaming"}},
            {"wifi": {**WIFI, "state": "roaming", "ip": None, "rssi": None}},
            {"update": {**UPDATE, "state": "paused"}},
            {"update": {**UPDATE, "state": "paused", "progress": 40}},
            {"update": {**UPDATE, "mode": "smart"}},
            {"update": {**UPDATE, "last_result": "rate_limited"}},
        ]
        for part in accepted:
            self.assertTrue(self.accepted("status", light=LIGHT, **part), str(part))
        board = {"wifi_power": "21", "update_mode": "smart"}
        self.assertTrue(self.accepted("settings_get", settings={**SETTINGS, **board}))
        self.assertTrue(self.accepted("update_check", update={**UPDATE, "last_result": "rate_limited"}))

    def test_board_settings_outside_the_specified_ranges_are_refused(self):
        board = {"wifi_power": "auto", "update_mode": "off", "update_firmware": True, "check_hours": 6, "install_start": 0,
                 "install_end": 0, "timezone": "UTC0", "time_sync_hours": 6, "ntp_server": "pool.ntp.org", "network_login": False}  # fmt: skip
        bad = [
            {"check_hours": 0}, {"check_hours": 169},
            {"install_start": 1440}, {"install_end": -1}, {"time_sync_hours": 0}, {"time_sync_hours": 169},
            {"timezone": ""}, {"timezone": "A B"}, {"timezone": "x" * 65}, {"ntp_server": ""},
            {"ntp_server": "bad host"}, {"ntp_server": "h" * 65}, {"token": "ABCDEFGHIJ012345"}, {"token": "abc"},
        ]  # fmt: skip
        for change in bad:
            settings = {**SETTINGS, **board, **change}
            self.assertFalse(self.accepted("settings_get", settings=settings), str(change))

    def test_the_token_and_the_nonce_have_their_shapes(self):
        for token in ("abc", "ABCDEFGHIJ012345", "abcdefghij01234!"):
            self.assertFalse(self.accepted("token_regenerate", token=token), token)
        for nonce in ("00", "0" * 31, "0" * 33, "G" * 32, "A" * 32):
            self.assertFalse(self.accepted("auth_challenge", nonce=nonce), nonce)

    def test_board_settings_are_optional_but_checked(self):
        board = {"wifi_power": "auto", "update_mode": "off", "update_firmware": True, "check_hours": 6, "install_start": 0,
                 "install_end": 0, "timezone": "UTC0", "time_sync_hours": 6, "ntp_server": "pool.ntp.org", "network_login": False}
        self.assertTrue(self.accepted("settings_get", settings=SETTINGS))
        self.assertTrue(self.accepted("settings_get", settings={**SETTINGS, **board, "token": "abcdefghij012345"}))
        self.assertFalse(self.accepted("settings_get", settings={**SETTINGS, **board, "check_hours": "6"}))
        self.assertFalse(self.accepted("settings_get", settings={**SETTINGS, **board, "network_login": 0}))

    def test_the_replies_of_the_new_commands(self):
        self.assertTrue(self.accepted("token_regenerate", token="abcdefghij012345"))
        self.assertFalse(self.accepted("token_regenerate"))
        self.assertTrue(self.accepted("auth_challenge", nonce="00" * 16))
        self.assertTrue(self.accepted("auth"))
        self.assertTrue(self.accepted("wifi_forget"))
        self.assertTrue(self.accepted("update_check", update=UPDATE))
        self.assertFalse(self.accepted("update_install", update={**UPDATE, "trial": "no"}))

    def test_login_answers_the_challenge_with_the_hmac_of_the_nonce_under_the_token(self):
        import hashlib
        import hmac

        nonce = "000102030405060708090a0b0c0d0e0f"
        sent = []

        def respond(line, count):
            request = zenit.parse_line(line)
            sent.append(request)
            if request["cmd"] == "auth_challenge":
                return [reply_line(seq=request["seq"], ok=True, nonce=nonce)]
            return [reply_line(seq=request["seq"], ok=True)]

        client = zenit.Client(ScriptedLink(respond), timeout=2, seq=1)
        self.assertTrue(client.login("abcdefghij012345")["ok"])
        expected = hmac.new(b"abcdefghij012345", nonce.encode(), hashlib.sha256).hexdigest()
        self.assertEqual([r["cmd"] for r in sent], ["auth_challenge", "auth"])
        self.assertEqual(sent[1]["hmac"], expected)

    def test_a_refused_challenge_is_returned_as_it_is(self):
        link = ScriptedLink(lambda line, count: [reply_line(seq=seq_of(line), ok=False, error="bad_request", message="x")])
        self.assertFalse(zenit.Client(link, timeout=2, seq=1).login("abcdefghij012345")["ok"])


class MainTest(unittest.TestCase):
    def run_main(self, argv, respond):
        link = ScriptedLink(respond)
        out = io.StringIO()
        with mock.patch.object(zenit, "SerialLink", return_value=link), mock.patch("sys.stderr", io.StringIO()) as err:
            status = zenit.main(["--port", "x", *argv], out)
        return status, out.getvalue(), err.getvalue(), link

    @staticmethod
    def board(line, count):
        request = zenit.parse_line(line)
        if request["cmd"] in ("info", "light"):
            return [good_reply(line)]
        return [reply_line(seq=request["seq"], ok=False, error="bad_request", message="no")]

    def test_info_is_printed_after_one_request(self):
        status, out, _, link = self.run_main(["info"], self.board)
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(out)["board"], "simulator")
        self.assertEqual(len(link.sent), 1)
        self.assertTrue(link.closed)

    def test_raw_uses_its_own_seq_and_matches_the_reply_on_it(self):
        status, out, _, link = self.run_main(["raw", '{"cmd":"light","on":true,"seq":424242}'], self.board)
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(out)["seq"], 424242)
        self.assertEqual(zenit.parse_line(link.sent[-1]), {"seq": 424242, "cmd": "light", "on": True})

    def test_raw_ignores_a_reply_of_another_seq(self):
        def board(line, count):
            request = zenit.parse_line(line)
            if request["cmd"] == "info":
                return [good_reply(line)]
            return [reply_line(seq=1, ok=True, wrong=True), good_reply(line, right=True)]

        status, out, _, _ = self.run_main(["raw", '{"cmd":"status","seq":7}'], board)
        self.assertEqual(status, 0)
        self.assertEqual((json.loads(out)["seq"], json.loads(out)["right"]), (7, True))

    def test_raw_without_seq_gets_one(self):
        _, _, _, link = self.run_main(["raw", '{"cmd":"light","on":false}'], self.board)
        sent = zenit.parse_line(link.sent[-1])
        self.assertIsInstance(sent["seq"], int)
        self.assertEqual((sent["cmd"], sent["on"]), ("light", False))

    def test_raw_sends_info_again_instead_of_reusing_the_handshake(self):
        _, _, _, link = self.run_main(["raw", '{"cmd":"info"}'], self.board)
        self.assertEqual([zenit.parse_line(line)["cmd"] for line in link.sent], ["info", "info"])

    def test_raw_fields_named_like_parameters_of_the_client_do_not_crash(self):
        for name in ("command", "fields", "seq_", "self"):
            status, _, _, link = self.run_main(["raw", json.dumps({"cmd": "light", "on": True, name: 1})], self.board)
            self.assertEqual(status, 0, name)
            self.assertEqual(zenit.parse_line(link.sent[-1])[name], 1)

    def test_seq_and_cmd_are_not_settings(self):
        for key in ("seq", "cmd"):
            with mock.patch.object(zenit, "SerialLink") as opened, mock.patch("sys.stderr", io.StringIO()):
                self.assertEqual(zenit.main(["--port", "x", "settings-set", f"{key}=5"]), 2)
            opened.assert_not_called()

    def test_a_command_follows_the_handshake(self):
        status, out, _, link = self.run_main(["light", "off"], self.board)
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(out)["light"]["effect"], "static")
        self.assertEqual([zenit.parse_line(line)["cmd"] for line in link.sent], ["info", "light"])

    def test_an_error_reply_exits_with_1(self):
        status, out, _, _ = self.run_main(["status"], self.board)
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(out)["error"], "bad_request")

    def test_no_reply_exits_with_2(self):
        status, out, err, link = self.run_main(["--timeout", "0.01", "--attempts", "2", "info"], lambda line, count: [])
        self.assertEqual(status, 2)
        self.assertEqual(out, "")
        self.assertIn("no reply to info", err)
        self.assertTrue(link.closed)

    def test_a_bad_argument_exits_with_2_before_connecting(self):
        with mock.patch.object(zenit, "SerialLink") as opened, mock.patch("sys.stderr", io.StringIO()):
            self.assertEqual(zenit.main(["--port", "x", "settings-set", "brightness"]), 2)
        opened.assert_not_called()

    def test_an_unreachable_board_exits_with_2(self):
        with mock.patch.object(zenit, "SerialLink", side_effect=zenit.ClientError("cannot open x")), mock.patch(
            "sys.stderr", io.StringIO()
        ) as err:
            self.assertEqual(zenit.main(["--port", "x", "info"]), 2)
        self.assertIn("cannot open x", err.getvalue())


class FakeSerial:
    """pyserial's Serial, with a failure of the board's port injected into one operation."""

    def __init__(self, failing):
        self.failing = failing
        self.closed = False

    def fail(self, operation):
        if self.failing == operation:
            raise FakeSerialModule.SerialException(f"{operation} failed")

    def open(self):
        self.fail("open")

    def write(self, data):
        self.fail("write")
        return len(data)

    def flush(self):
        self.fail("flush")

    @property
    def in_waiting(self):
        self.fail("in_waiting")
        return 0

    def read(self, size):
        self.fail("read")
        time.sleep(0.001)
        return b""

    def close(self):
        self.closed = True
        self.fail("close")


class FakeSerialModule:
    """The `serial` module as SerialLink uses it."""

    class SerialException(OSError):  # as in pyserial, an IOError
        pass

    def __init__(self, failing):
        self.port = FakeSerial(failing)

    def Serial(self):
        return self.port


class TransportFailureTest(unittest.TestCase):
    """A board unplugged or a connection lost in the middle of a request is a connection failure, exit status 2."""

    def serial_link(self, failing):
        module = FakeSerialModule(failing)
        with mock.patch.dict(sys.modules, {"serial": module}):
            return zenit.SerialLink("x"), module.port

    def test_serial_operations_that_fail_raise_the_client_error(self):
        for failing, operation in [
            ("write", lambda link: link.write_line(b"line")),
            ("flush", lambda link: link.write_line(b"line")),
            ("read", lambda link: link.read_line(1)),
            ("in_waiting", lambda link: link.read_line(1)),
            ("close", lambda link: link.close()),
        ]:
            link, _ = self.serial_link(failing)
            with self.assertRaises(zenit.ClientError, msg=failing):
                operation(link)

    def test_a_port_that_cannot_be_opened_raises_the_client_error(self):
        with self.assertRaises(zenit.ClientError):
            self.serial_link("open")

    def run_main(self, failing):
        module = FakeSerialModule(failing)
        with mock.patch.dict(sys.modules, {"serial": module}), mock.patch("sys.stderr", io.StringIO()) as err:
            status = zenit.main(["--port", "x", "--timeout", "0.05", "--attempts", "1", "info"], io.StringIO())
        return status, err.getvalue(), module.port

    def test_main_exits_with_2_when_the_port_fails(self):
        for failing in ("write", "read"):
            status, err, port = self.run_main(failing)
            self.assertEqual(status, 2, failing)
            self.assertIn(f"{failing} failed", err)
            self.assertTrue(port.closed)

    def test_a_port_that_fails_to_close_after_a_failure_reports_the_first_failure(self):
        module = FakeSerialModule("write")
        module.port.close = lambda: (_ for _ in ()).throw(FakeSerialModule.SerialException("close failed"))
        with mock.patch.dict(sys.modules, {"serial": module}), mock.patch("sys.stderr", io.StringIO()) as err:
            self.assertEqual(zenit.main(["--port", "x", "--attempts", "1", "info"], io.StringIO()), 2)
        self.assertIn("write failed", err.getvalue())
        self.assertNotIn("close failed", err.getvalue())

    def test_a_link_that_fails_to_close_after_its_reply_exits_with_2(self):
        class Closing(ScriptedLink):
            def close(self):
                raise zenit.ClientError("cannot close the port: gone")

        out = io.StringIO()
        with mock.patch.object(zenit, "SerialLink", return_value=Closing(echo_ok)), mock.patch(
            "sys.stderr", io.StringIO()
        ) as err:
            self.assertEqual(zenit.main(["--port", "x", "info"], out), 2)
        self.assertIn("cannot close the port", err.getvalue())
        self.assertEqual(out.getvalue(), "")

    @unittest.skipUnless(HAVE_WEBSOCKETS or IN_CI, "needs the websockets package")
    def test_websocket_send_and_close_that_fail_raise_the_client_error(self):
        closed = websockets.exceptions.ConnectionClosedError(None, None)
        for failing in ("send", "close"):
            for error in (closed, OSError("reset")):
                self.check_websocket_failure(failing, error)

    def check_websocket_failure(self, failing, error):
        socket = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = socket
        if failing == "send":
            socket.send.side_effect = error
        else:
            context.__exit__.side_effect = error
        with mock.patch("websockets.sync.client.connect", return_value=context):
            link = zenit.WebSocketLink("ws://127.0.0.1:1")
        with self.assertRaises(zenit.ClientError, msg=f"{failing} {error!r}"):
            link.write_line(b"line") if failing == "send" else link.close()


class SharedRepliesTest(unittest.TestCase):
    """conformance/client/replies.json, the replies both clients must accept or refuse (web/test/replies.test.ts runs
    the same file through the web app's validBody)."""

    def setUp(self):
        self.cases = json.loads((ROOT / "conformance" / "client" / "replies.json").read_text(encoding="utf-8"))["cases"]

    def test_each_reply_is_accepted_or_refused_as_the_case_says(self):
        for case in self.cases:
            # Through the client's own reader: the framed body, numbers written as in the file (60.0 stays a fraction)
            reply = zenit.parse_line(zenit.frame(case["reply"]))
            self.assertIsNotNone(reply, case["note"])
            self.assertEqual(zenit.valid_body(case["command"], reply), case["valid"], f"{case['command']}: {case['note']}")

    def test_every_command_of_the_reply_table_has_a_valid_and_a_refused_case(self):
        for command in zenit.REPLIES:
            self.assertEqual({case["valid"] for case in self.cases if case["command"] == command}, {True, False}, command)


class ConformanceTest(unittest.TestCase):
    """The protocol conformance cases (conformance/protocol), read from the client's side, as web/test/conformance.test.ts
    does: a line the board refuses is a line the client throws away, a request it frames reads back the same, and a
    reply the board gives is one the client accepts."""

    # Limits only the board has: it reads 1,024 bytes and 4 levels, the client more
    BOARD_ONLY = {"framing_line_limit", "framing_nesting_limit"}
    SAMPLES = {"string": "1.0.0", "integer": 1, "boolean": True}

    @classmethod
    def setUpClass(cls):
        folder = ROOT / "conformance" / "protocol"
        cls.cases = {path.stem: json.loads(path.read_text(encoding="utf-8")) for path in sorted(folder.glob("*.json"))}

    @classmethod
    def concrete(cls, value):
        """`$any` and `$pattern` placeholders as a sample of their type."""
        if isinstance(value, list):
            return [cls.concrete(item) for item in value]
        if isinstance(value, dict):
            if len(value) == 1 and isinstance(value.get("$any"), str):
                return cls.SAMPLES[value["$any"]]
            if len(value) == 1 and isinstance(value.get("$pattern"), str):
                pattern = value["$pattern"]
                match = re.fullmatch(r"\^\[a-z0-9\]\{(\d+)\}\$", pattern)
                if match is None:
                    raise AssertionError(f"no sample for the pattern {pattern}")
                return ("abcdefghij0123456789" * 4)[: int(match.group(1))]
            return {key: cls.concrete(item) for key, item in value.items()}
        return value

    @staticmethod
    def steps(case):
        # The clock, the simulator's events and control lines are for the board
        return [step for step in case["steps"] if not {"advance_ms", "event", "control", "close_requested"} & step.keys()]

    def test_cases_are_present(self):
        self.assertGreater(len(self.cases), 20)

    def test_lines_the_board_refuses_are_thrown_away_and_the_ones_it_answers_are_read(self):
        for name, case in self.cases.items():
            if name in self.BOARD_ONLY:
                continue
            for step in self.steps(case):
                transport = step.get("transport", case.get("transport", "usb"))
                if isinstance(step.get("send"), str):
                    line = step["send"].encode("utf-8")
                elif "send_hex" in step:
                    line = bytes.fromhex(step["send_hex"])
                else:
                    continue
                if b"\n" in line or re.search("nest|level", step.get("note", ""), re.I):
                    continue  # two lines, or a nesting only the board limits
                if transport == "wifi" and b"\r" in line:
                    continue  # over WebSocket a carriage return stays in the JSON, and a board never sends one
                expect = step.get("expect")
                refused = expect is None or (expect.get("ok") is False and expect.get("error") == "bad_frame")
                label = f"{name}: {step.get('note', step.get('send', step.get('send_hex')))}"
                self.assertEqual(zenit.parse_line(line) is None, refused, label)

    def test_requests_are_framed_so_that_they_read_back_the_same(self):
        for name, case in self.cases.items():
            for step in self.steps(case):
                if isinstance(step.get("send"), dict):
                    self.assertEqual(zenit.parse_line(zenit.frame(step["send"])), step["send"], name)

    def test_the_replies_of_the_board_are_accepted(self):
        for name, case in self.cases.items():
            command = ""
            for step in self.steps(case):
                if isinstance(step.get("send"), dict):
                    command = str(step["send"].get("cmd"))
                elif isinstance(step.get("send"), str):
                    read = zenit.parse_line(step["send"].encode("utf-8"))
                    command = read["cmd"] if read is not None and isinstance(read.get("cmd"), str) else ""
                if not step.get("expect"):
                    continue
                reply = self.concrete(step["expect"])
                if reply.get("ok") is False:
                    reply = dict(reply, message="for people")  # the cases leave out the message, which is for people
                read = zenit.parse_line(zenit.frame(reply))
                self.assertIsNotNone(read, f"{name}: {step.get('note', '')}")
                if read.get("ok") is False or "seq" in read:
                    self.assertTrue(zenit.valid_body(command, read), f"{name}: {command} {step.get('note', '')}")


class SimulatorLink:
    """The simulator's standard input and output, as a link."""

    def __init__(self):
        self.process = subprocess.Popen(
            [str(SIMULATOR), "--protocol", "--live"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
        self.lines = queue.Queue()
        threading.Thread(target=self.pump, daemon=True).start()

    def pump(self):
        for line in self.process.stdout:
            self.lines.put(line.rstrip(b"\n"))

    def write_line(self, line):
        self.process.stdin.write(line + b"\n")
        self.process.stdin.flush()

    def read_line(self, timeout):
        try:
            return self.lines.get(timeout=timeout)
        except queue.Empty:
            return None

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=5)
        self.process.stdout.close()


@unittest.skipUnless(SIMULATOR.exists() or IN_CI, "the simulator is not built (pio run -e native)")
class SimulatorTest(unittest.TestCase):
    def setUp(self):
        self.link = SimulatorLink()
        self.addCleanup(self.link.close)
        self.client = zenit.Client(self.link, timeout=2)
        self.client.handshake()

    def test_info(self):
        self.assertEqual(self.client.info["board"], "simulator")
        self.assertEqual(self.client.info["limits"], {"line": 1024})

    def test_settings_round_trip(self):
        reply = self.client.request("settings_set", brightness=40, colors=["blue", "white"])
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["settings"]["brightness"], 40)
        self.assertEqual(self.client.request("settings_get")["settings"]["colors"], ["blue", "white"])
        self.assertEqual(self.client.request("settings_reset")["settings"]["brightness"], 60)

    def test_light_and_errors(self):
        self.assertFalse(self.client.request("light", on=False)["light"]["on"])
        self.assertTrue(self.client.request("light", on=True)["light"]["on"])
        self.assertEqual(self.client.request("settings_set", brightness=0)["error"], "bad_request")
        self.assertEqual(self.client.request("fly")["error"], "unknown_command")

    def test_a_damaged_line_is_answered_with_bad_frame_and_the_client_repeats(self):
        damaged = [True]
        write = self.link.write_line

        def flaky(line):
            if damaged[0]:
                damaged[0] = False
                line = line[:-1] + b"X"
            write(line)

        self.link.write_line = flaky
        reply = self.client.request("status")
        self.assertTrue(reply["ok"])
        self.assertFalse(damaged[0])

    def test_main_over_a_scripted_port(self):
        with mock.patch.object(zenit, "SerialLink", return_value=SimulatorLink()), mock.patch("sys.stderr", io.StringIO()):
            out = io.StringIO()
            self.assertEqual(zenit.main(["--port", "x", "settings-set", "effect=breathing", "period_seconds=12"], out), 0)
        self.assertEqual(json.loads(out.getvalue())["settings"]["period_seconds"], 12)


@unittest.skipUnless(SIMULATOR.exists() or IN_CI, "the simulator is not built (pio run -e native)")
class SimulatorControlLinesTest(unittest.TestCase):
    def run_simulator(self, args, text):
        done = subprocess.run([str(SIMULATOR), "--protocol", *args], input=text, capture_output=True, text=True, timeout=20)
        self.assertEqual(done.returncode, 0)
        return done.stdout, done.stderr

    def test_advance_moves_virtual_time(self):
        out, err = self.run_simulator([], zenit.frame({"seq": 1, "cmd": "status"}).decode() + "\n!advance 1000\n"
                                      + zenit.frame({"seq": 2, "cmd": "status"}).decode() + "\n")
        replies = [zenit.parse_line(line.encode()) for line in out.splitlines() if line.startswith("@ZN ")]
        self.assertEqual([r["light"]["lightness"] for r in replies], [0.0, 60.0])
        self.assertEqual(err, "")

    def test_a_scan_ranks_every_access_point_and_keeps_the_best_sixteen_names(self):
        # 16 names at -80, a late stronger access point of one of them, a late stronger new name, a late weak one
        entries = [f"N{i}:-80:YES" for i in range(16)] + ["N3:-30:YES", "Late:-20:NO", "Weak:-90:YES"]
        out, err = self.run_simulator([], "!scan " + " ".join(entries) + "\n!scan-list\n")
        self.assertEqual(err, "")
        lines = [line for line in out.splitlines() if line.startswith("!scan-list")]
        self.assertEqual(lines[-1], "!scan-list end")
        names = [line.split()[1] for line in lines[:-1]]
        self.assertEqual(len(names), 16)
        self.assertEqual(names[:3], ["Late", "N3", "N1"])
        self.assertNotIn("N0", names)
        self.assertNotIn("Weak", names)
        self.assertEqual(lines[0], "!scan-list Late -20 NO")

    def test_names_that_cannot_be_reported_never_rank_in_a_scan(self):
        # 16 strong names with a control byte or invalid UTF-8, then one valid weak name
        bad = [f"bad\x01N{i}:-10:YES".encode() for i in range(8)] + [f"\xffN{i}:-10:YES".encode("latin-1") for i in range(8)]
        entries = b" ".join(bad + [b"Valid:-80:YES"])
        done = subprocess.run([str(SIMULATOR), "--protocol"], input=b"!scan " + entries + b"\n!scan-list\n", capture_output=True, timeout=20)
        self.assertEqual(done.returncode, 0)
        lines = [line for line in done.stdout.decode("utf-8", "replace").splitlines() if line.startswith("!scan-list")]
        self.assertEqual(lines, ["!scan-list Valid -80 YES", "!scan-list end"])

    def test_a_name_that_is_too_long_is_refused_whole_not_cut_to_fit(self):
        # 33 bytes strong (the first 32 would be a valid name), then a valid weak one
        out, err = self.run_simulator([], "!scan " + "a" * 33 + ":-10:YES " + "a" * 32 + ":-60:YES\n!scan-list\n")
        lines = [line for line in out.splitlines() if line.startswith("!scan-list")]
        self.assertEqual(lines, ["!scan-list " + "a" * 32 + " -60 YES", "!scan-list end"])

    def test_control_lines_with_a_name_or_token_that_does_not_fit_are_refused_not_cut(self):
        _, err = self.run_simulator([], "!token " + "a" * 17 + "\n!store-wifi ssid=" + "b" * 33 + "\n!net ssid=" + "c" * 33 + "\n")
        self.assertEqual(err.count("refused"), 3)

    def test_advance_is_refused_in_live_mode_and_reported(self):
        _, err = self.run_simulator(["--live"], "!advance 1000\n")
        self.assertIn("refused: the clock is real in --live mode", err)

    def test_bad_control_lines_are_reported(self):
        _, err = self.run_simulator([], "!advance soon\n!advance\n!bogus\n!wifi-open\n!advance 99999999999999\n")
        self.assertEqual(err.count("refused: expected whole milliseconds"), 2)
        self.assertIn("unknown control line '!bogus'", err)
        self.assertIn("'!wifi-open' ignored: only the wifi transport has connections", err)

    def test_wifi_connection_lines_are_taken_by_the_wifi_transport(self):
        _, err = self.run_simulator(["--transport", "wifi"], "!wifi-open\n!wifi-close\n")
        self.assertEqual(err, "")

    def test_the_wifi_transport_keeps_a_carriage_return_the_usb_transport_strips(self):
        request = zenit.frame({"seq": 1, "cmd": "info"}).decode() + "\r\n"
        usb, _ = self.run_simulator([], request)
        wifi, _ = self.run_simulator(["--transport", "wifi"], request)
        self.assertEqual(zenit.parse_line(usb.splitlines()[-1].encode())["ok"], True)
        self.assertEqual(zenit.parse_line(wifi.splitlines()[-1].encode())["error"], "bad_frame")

    def test_a_wifi_close_is_acknowledged_after_the_replies_before_it(self):
        text = zenit.frame({"seq": 1, "cmd": "info"}).decode() + "\n!wifi-close\n"
        out, _ = self.run_simulator(["--transport", "wifi"], text)
        lines = [line for line in out.splitlines() if line.startswith(("@ZN ", "!"))]
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("@ZN "))
        self.assertEqual(lines[1], "!wifi-closed")

    def test_a_control_line_is_never_a_request(self):
        out, _ = self.run_simulator([], "!advance 10\n!info\n")
        self.assertEqual([line for line in out.splitlines() if line.startswith("@ZN ")], [])


if __name__ == "__main__":
    unittest.main()
