// SPDX-License-Identifier: GPL-3.0-or-later

// Entry point of the host simulator (pio run -e native). It runs the board's light code on a virtual clock and
// records the duty of every channel at every tick. Firmware builds and the test builds skip this file.

#if defined(ZENIT_SIM) && !defined(PIO_UNIT_TESTING)

#include <light_text.h>
#include <zenit_light.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

#include "app.h"
#include "output.h"
#include "platform.h"
#include "settings.h"

namespace
{

struct Event
{
  uint64_t at = 0;
  enum class Kind
  {
    On,
    Off,
    Set
  } kind = Kind::Set;
  std::string key;
  std::string value;
};

struct Options
{
  uint64_t duration_s = 60;
  uint32_t seed = 1;
  zenit::LightSettings stored;
  std::vector<Event> events;
  std::string out = "sim-out";
  bool files = true;
  bool live = false;
};

void usage()
{
  std::puts("usage: program [options]\n"
            "  --duration SECONDS     virtual time to run, whole seconds (default 60)\n"
            "  --seed N               seed of the twinkle effect (default 1)\n"
            "  --set KEY=VALUE        a stored setting at the start (repeat), e.g. --set effect=breathing\n"
            "  --event MS:on|off      turn the light on or off at MS milliseconds (repeat)\n"
            "  --event MS:KEY=VALUE   change a setting at MS milliseconds, as the app does (repeat)\n"
            "  --out DIR              write trace.csv and viewer.html there (default sim-out)\n"
            "  --no-files             write no files\n"
            "  --live                 run in real time and draw the light in the terminal\n"
            "Settings: brightness, effect, color, colors (comma separated), color_set, hold_seconds, period_seconds,\n"
            "floor, twinkle_strength, timer_minutes.");
}

// A whole number from 0 to `max`, digits only.
bool parse_whole(const std::string &text, uint64_t max, uint64_t &out)
{
  if (text.empty() || text.size() > 19)
    return false;
  uint64_t value = 0;
  for (char c : text)
  {
    if (c < '0' || c > '9')
      return false;
    value = value * 10 + static_cast<uint64_t>(c - '0');
  }
  if (value > max)
    return false;
  out = value;
  return true;
}

// The longest run, one week of virtual time.
constexpr uint64_t MAX_DURATION_S = 7 * 24 * 3600;

bool split(const std::string &text, char sep, std::string &left, std::string &right)
{
  size_t at = text.find(sep);
  if (at == std::string::npos)
    return false;
  left = text.substr(0, at);
  right = text.substr(at + 1);
  return true;
}

bool parse(int argc, char **argv, Options &options)
{
  for (int i = 1; i < argc; i++)
  {
    std::string arg = argv[i];
    auto next = [&](std::string &out)
    {
      if (i + 1 >= argc)
        return false;
      out = argv[++i];
      return true;
    };
    std::string value;
    if (arg == "--help" || arg == "-h")
    {
      usage();
      std::exit(0);
    }
    else if (arg == "--duration" && next(value))
    {
      uint64_t seconds;
      if (!parse_whole(value, MAX_DURATION_S, seconds) || seconds == 0)
      {
        std::fprintf(stderr, "--duration %s: expected whole seconds from 1 to %llu\n", value.c_str(),
                     (unsigned long long)MAX_DURATION_S);
        return false;
      }
      options.duration_s = seconds;
    }
    else if (arg == "--seed" && next(value))
    {
      uint64_t seed;
      if (!parse_whole(value, UINT32_MAX, seed))
      {
        std::fprintf(stderr, "--seed %s: expected a whole number from 0 to %u\n", value.c_str(), UINT32_MAX);
        return false;
      }
      options.seed = static_cast<uint32_t>(seed);
    }
    else if (arg == "--set" && next(value))
    {
      std::string key, setting, error;
      if (!split(value, '=', key, setting) || !zenit::set_light_setting(options.stored, key, setting, error))
      {
        std::fprintf(stderr, "--set %s: %s\n", value.c_str(), error.empty() ? "expected KEY=VALUE" : error.c_str());
        return false;
      }
    }
    else if (arg == "--event" && next(value))
    {
      Event event;
      std::string at, action;
      if (!split(value, ':', at, action) || !parse_whole(at, MAX_DURATION_S * 1000, event.at))
      {
        std::fprintf(stderr, "--event %s: expected MS:ACTION, with MS in whole milliseconds\n", value.c_str());
        return false;
      }
      if (action == "on")
        event.kind = Event::Kind::On;
      else if (action == "off")
        event.kind = Event::Kind::Off;
      else if (split(action, '=', event.key, event.value))
      {
        zenit::LightSettings probe;
        std::string error;
        if (!zenit::set_light_setting(probe, event.key, event.value, error))
        {
          std::fprintf(stderr, "--event %s: %s\n", value.c_str(), error.c_str());
          return false;
        }
      }
      else
      {
        std::fprintf(stderr, "--event %s: expected on, off or KEY=VALUE\n", value.c_str());
        return false;
      }
      options.events.push_back(event);
    }
    else if (arg == "--out" && next(value))
      options.out = value;
    else if (arg == "--no-files")
      options.files = false;
    else if (arg == "--live")
      options.live = true;
    else
    {
      std::fprintf(stderr, "unknown or incomplete option: %s\n", arg.c_str());
      usage();
      return false;
    }
  }
  for (const Event &event : options.events)
    if (event.at > options.duration_s * 1000)
    {
      std::fprintf(stderr, "--event at %llu ms is after the end of the run (%llu ms)\n", (unsigned long long)event.at,
                   (unsigned long long)(options.duration_s * 1000));
      return false;
    }
  return true;
}

void run_event(const Event &event, uint64_t now)
{
  if (event.kind == Event::Kind::On || event.kind == Event::Kind::Off)
  {
    app::set_light(event.kind == Event::Kind::On, now);
    platform::log("light %s at %llu ms", event.kind == Event::Kind::On ? "on" : "off", (unsigned long long)now);
    return;
  }
  zenit::LightSettings next = settings::current();
  std::string error;
  zenit::set_light_setting(next, event.key, event.value, error);
  if (app::change_settings(next, now) != settings::Commit::Ok)
    platform::log("cannot save %s", event.key.c_str());
  else
    platform::log("%s=%s at %llu ms", event.key.c_str(), event.value.c_str(), (unsigned long long)now);
}

// How a channel looks on screen: the LED's own color, scaled by its relative luminance.
void screen_color(const zenit::Duties &duties, int &r, int &g, int &b)
{
  auto level = [&](zenit::Channel c)
  {
    return static_cast<double>(duties.value[c]) / zenit::DUTY_MAX;
  };
  double red = level(zenit::RED), green = level(zenit::GREEN), blue = level(zenit::BLUE), white = level(zenit::WHITE);
  auto to8 = [](double v)
  {
    return static_cast<int>(std::min(1.0, v) * 255.0 + 0.5);
  };
  r = to8(red + white);
  g = to8(green + white);
  b = to8(blue + white);
}

void draw_live(const zenit::LightFrame &frame, uint64_t now)
{
  int r, g, b;
  screen_color(frame.duties, r, g, b);
  const zenit::LightStatus &s = frame.status;
  std::printf(
      "\r\x1b[48;2;%d;%d;%dm        \x1b[0m %7.1fs  %-12s %-5s L=%5.1f  duty R%5u G%5u B%5u W%5u  timer %s%u s   ", r,
      g, b, now / 1000.0, zenit::effect_name(s.effect), s.lit ? zenit::color_name(s.color) : "off", s.lightness,
      frame.duties.value[zenit::RED], frame.duties.value[zenit::GREEN], frame.duties.value[zenit::BLUE],
      frame.duties.value[zenit::WHITE], s.timer ? "" : "-", s.timer_remaining_s);
  std::fflush(stdout);
}

const char *VIEWER_HEAD = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zenit simulator</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b0d12; color: #e6e8ee; margin: 16px; }
  #lamp { width: 160px; height: 160px; border-radius: 50%; margin: 12px 0; box-shadow: 0 0 40px #000 inset; }
  canvas { width: 100%; max-width: 1000px; height: 240px; background: #12151c; display: block; }
  input[type=range] { width: 100%; max-width: 1000px; }
  .row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
</style>
</head>
<body>
<h1>Zenit simulator</h1>
<div class="row"><div id="lamp"></div><div><button id="play">Play</button> <span id="info"></span></div></div>
<input id="seek" type="range" min="0" value="0">
<canvas id="chart" width="1000" height="240"></canvas>
<script>
const TRACE = )HTML";

const char *VIEWER_TAIL = R"HTML(;
const MAX = 16383, colors = ['#ff4d4d', '#4dff6a', '#4d7dff', '#f0f0f0'];
const lamp = document.getElementById('lamp'), info = document.getElementById('info');
const seek = document.getElementById('seek'), chart = document.getElementById('chart'), ctx = chart.getContext('2d');
seek.max = TRACE.length - 1;
// The traces are drawn once into an off-screen canvas, one column per pixel; playback only copies it and draws the
// cursor.
const traces = document.createElement('canvas');
traces.width = chart.width; traces.height = chart.height;
(function drawTraces() {
  // Every point carries the lowest and highest duty of the ticks it stands for (fields 5 to 12), and each pixel
  // column draws the range of its points, so a short change is never lost. Points are spread over the full width.
  const t = traces.getContext('2d'), w = chart.width, n = TRACE.length;
  const y = v => chart.height - v / MAX * (chart.height - 4) - 2;
  const column = i => Math.round(i / Math.max(1, n - 1) * (w - 1));
  for (let c = 0; c < 4; c++) {
    t.strokeStyle = colors[c]; t.beginPath();
    for (let i = 0; i < n;) {
      const x = column(i);
      let lo = TRACE[i][5 + 2 * c], hi = TRACE[i][6 + 2 * c], j = i;
      while (j + 1 < n && column(j + 1) === x) { j++; lo = Math.min(lo, TRACE[j][5 + 2 * c]); hi = Math.max(hi, TRACE[j][6 + 2 * c]); }
      i ? t.lineTo(x, y(TRACE[i][c + 1])) : t.moveTo(x, y(TRACE[i][c + 1]));
      t.lineTo(x, y(lo)); t.lineTo(x, y(hi)); t.lineTo(x, y(TRACE[j][c + 1]));
      i = j + 1;
    }
    t.stroke();
  }
})();
function draw() {
  ctx.clearRect(0, 0, chart.width, chart.height);
  ctx.drawImage(traces, 0, 0);
  const x = seek.value / Math.max(1, TRACE.length - 1) * chart.width;
  ctx.strokeStyle = '#888'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, chart.height); ctx.stroke();
}
function show(i) {
  const row = TRACE[i], v = c => Math.min(1, row[c] / MAX);
  const rgb = (r, g, b, w) => `rgb(${Math.round(Math.min(1, r + w) * 255)},${Math.round(Math.min(1, g + w) * 255)},` +
    `${Math.round(Math.min(1, b + w) * 255)})`;
  lamp.style.background = rgb(v(1), v(2), v(3), v(4));
  // A point that stands for several ticks whose duties changed: the ring shows its dimmest tick (fields 13 to 16, a
  // state the LED really had), and the readout gives each changing channel's range, so playback never implies a
  // steady light that was not.
  const dim = c => Math.min(1, row[13 + c] / MAX);
  const varied = [0, 1, 2, 3].some(c => row[5 + 2 * c] !== row[6 + 2 * c]);
  lamp.style.boxShadow = varied ? `0 0 0 12px ${rgb(dim(0), dim(1), dim(2), dim(3))} inset` : '0 0 40px #000 inset';
  const names = ['R', 'G', 'B', 'W'];
  info.textContent = `${(row[0] / 1000).toFixed(2)} s  ` + names.map((n, c) => row[5 + 2 * c] === row[6 + 2 * c]
    ? `${n} ${row[c + 1]}` : `${n} ${row[c + 1]} (${row[5 + 2 * c]} to ${row[6 + 2 * c]} until the next point)`).join('  ');
  draw();
}
let timer = null;
document.getElementById('play').onclick = () => {
  if (timer) { clearInterval(timer); timer = null; return; }
  timer = setInterval(() => { seek.value = (+seek.value + 1) % TRACE.length; show(+seek.value); }, 10);
};
seek.oninput = () => show(+seek.value);
show(0);
</script>
</body>
</html>
)HTML";

// The viewer keeps at most this many points; a longer run keeps every n-th tick in the viewer, while trace.csv has
// every tick.
constexpr size_t MAX_VIEWER_POINTS = 60000;

// The LED power of some duties, to find the dimmest tick of a point.
double power_of(const zenit::Duties &d)
{
  double mw = 0;
  for (size_t c = 0; c < zenit::CHANNEL_COUNT; c++)
    mw += static_cast<double>(d.value[c]) * zenit::FULL_SCALE_MW[c];
  return mw;
}

// One point of the viewer: the time and duties of its first tick, the lowest and highest duty of each channel over
// the ticks it stands for (for the chart), and the duties of its dimmest tick, a state the LED really had (for
// playback).
struct ViewerPoint
{
  uint64_t time = 0;
  zenit::Duties first, low, high, dimmest;
  void start(uint64_t t, const zenit::Duties &d)
  {
    time = t;
    first = low = high = dimmest = d;
  }
  void add(const zenit::Duties &d)
  {
    for (size_t c = 0; c < zenit::CHANNEL_COUNT; c++)
    {
      low.value[c] = std::min(low.value[c], d.value[c]);
      high.value[c] = std::max(high.value[c], d.value[c]);
    }
    if (power_of(d) < power_of(dimmest))
      dimmest = d;
  }
};

bool write_viewer(const std::string &dir, const std::vector<ViewerPoint> &points)
{
  std::ofstream html(dir + "/viewer.html");
  if (!html)
    return false;
  html << VIEWER_HEAD << "[";
  for (size_t i = 0; i < points.size(); i++)
  {
    const ViewerPoint &p = points[i];
    html << (i ? "," : "") << '[' << p.time;
    for (size_t c = 0; c < zenit::CHANNEL_COUNT; c++)
      html << ',' << p.first.value[c];
    for (size_t c = 0; c < zenit::CHANNEL_COUNT; c++)
      html << ',' << p.low.value[c] << ',' << p.high.value[c];
    for (size_t c = 0; c < zenit::CHANNEL_COUNT; c++)
      html << ',' << p.dimmest.value[c];
    html << ']';
  }
  html << "]" << VIEWER_TAIL;
  return static_cast<bool>(html);
}

} // namespace

int main(int argc, char **argv)
{
  Options options;
  if (!parse(argc, argv, options))
    return 2;

  settings::sim_store(options.stored);
  settings::begin();
  output::begin();
  platform::sim_set_now_ms(0);
  app::begin(0, options.seed);
  platform::log("firmware %s on %s", platform::firmware_version(), platform::board_name());

  const uint64_t end = options.duration_s * 1000;
  const uint64_t ticks = end / zenit::TICK_MS + 1;
  const uint64_t stride = (ticks + MAX_VIEWER_POINTS - 1) / MAX_VIEWER_POINTS;
  std::vector<ViewerPoint> viewer;
  std::ofstream csv;
  if (options.files)
  {
    std::error_code ec;
    std::filesystem::create_directories(options.out, ec);
    csv.open(options.out + "/trace.csv");
    if (!csv)
    {
      std::fprintf(stderr, "cannot write to %s\n", options.out.c_str());
      return 1;
    }
    csv << "time_ms,red,green,blue,white\n";
  }
  size_t next_event = 0;
  std::stable_sort(options.events.begin(), options.events.end(),
                   [](const Event &a, const Event &b)
                   {
                     return a.at < b.at;
                   });
  const auto wall_start = std::chrono::steady_clock::now();

  uint64_t tick_index = 0;
  for (uint64_t now = 0; now <= end; now += zenit::TICK_MS, tick_index++)
  {
    platform::sim_set_now_ms(now);
    while (next_event < options.events.size() && options.events[next_event].at <= now)
    {
      if (options.live)
        std::putchar('\n');
      run_event(options.events[next_event++], now);
    }
    const zenit::LightFrame &frame = app::tick(now);
    if (options.files)
    {
      const zenit::Duties &d = frame.duties;
      csv << now << ',' << d.value[0] << ',' << d.value[1] << ',' << d.value[2] << ',' << d.value[3] << '\n';
      // A new point every stride ticks, holding the range of the ticks until the next one; the last tick always
      // gets its own point.
      const bool last = now + zenit::TICK_MS > end;
      if (tick_index % stride == 0 || (last && viewer.size() < MAX_VIEWER_POINTS))
      {
        viewer.emplace_back();
        viewer.back().start(now, d);
      }
      else
      {
        viewer.back().add(d);
        if (last)
        {
          // The cap is full: the last point keeps its range and shows the final tick's duties.
          viewer.back().time = now;
          viewer.back().first = d;
        }
      }
    }
    if (options.live)
    {
      std::this_thread::sleep_until(wall_start + std::chrono::milliseconds(now));
      if (now % 100 == 0)
        draw_live(frame, now);
    }
  }
  if (options.live)
    std::putchar('\n');
  if (options.files)
  {
    csv.close();
    if (!csv || !write_viewer(options.out, viewer))
    {
      std::fprintf(stderr, "cannot write to %s\n", options.out.c_str());
      return 1;
    }
    platform::log("wrote %s/trace.csv and %s/viewer.html", options.out.c_str(), options.out.c_str());
  }
  return 0;
}

#endif
