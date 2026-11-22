# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of tools/zenit.py: python3 -m unittest discover -s tools

The client is tested against scripted links, and against the simulator when its program is built (pio run -e native).
"""

import io
import json
import os
import queue
import subprocess
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import zenit  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SIMULATOR = ROOT / ".pio" / "build" / "native" / "program"


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


@unittest.skipUnless(SIMULATOR.exists(), "the simulator is not built (pio run -e native)")
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


@unittest.skipUnless(SIMULATOR.exists(), "the simulator is not built (pio run -e native)")
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
