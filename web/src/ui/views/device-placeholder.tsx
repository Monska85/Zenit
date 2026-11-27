// SPDX-License-Identifier: GPL-3.0-or-later

/** What shows while the Device page loads: its heading and the outlines of its first cards. */
export function DevicePlaceholder() {
  return (
    <div data-testid="device-placeholder" className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Device</h1>
      <p role="status" className="sr-only">
        Loading the Device page...
      </p>
      {[40, 28, 32].map((height) => (
        <div
          key={height}
          aria-hidden
          className="rounded-2xl border border-border bg-card motion-safe:animate-pulse"
          style={{ height: `${height * 4}px` }}
        />
      ))}
    </div>
  );
}
