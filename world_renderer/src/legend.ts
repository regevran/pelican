/**
 * The key, and the line saying whether the data is flowing.
 *
 * The swatches are silhouettes rather than colour chips on purpose: colour is
 * the second thing a reader uses, and a key that only works in colour is no key
 * at all. Each shape here is the shape the scene actually draws, so matching a
 * mark on screen to a row is a matter of outline, not of hue.
 */

import { AERIAL_KINDS } from "./entities/aerial-layer";
import type { FeedStatus } from "./feed";
import {
  DROP_LINE_COLOR,
  FLOCK_EDGE_COLOR,
  POOL_SURFACE_COLOR,
  POOL_WATERLINE_COLOR,
  TRAIL_COLOR,
} from "./palette";

const css = (color: number): string =>
  `#${color.toString(16).padStart(6, "0")}`;

function row(swatch: string, label: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "legend-row";
  element.innerHTML =
    `<svg class="legend-swatch" viewBox="0 0 24 24" aria-hidden="true">` +
    `${swatch}</svg><span class="legend-label">${label}</span>`;
  return element;
}

/** A pool: an irregular outline on the water plane, filled as the surface is. */
function poolSwatch(): string {
  return (
    `<path d="M3 12 L7 5 L16 4 L21 10 L18 19 L8 20 Z"` +
    ` fill="${css(POOL_SURFACE_COLOR)}" fill-opacity="0.45"` +
    ` stroke="${css(POOL_WATERLINE_COLOR)}" stroke-width="1.5"/>`
  );
}

/**
 * The drop line: down from a mark to the water plane, which is what altitude is
 * measured against.
 */
function dropLineSwatch(): string {
  return (
    `<line x1="2" y1="21" x2="22" y2="21" stroke="${css(POOL_WATERLINE_COLOR)}" stroke-width="1.5"/>` +
    `<line x1="12" y1="7" x2="12" y2="21" stroke="${css(DROP_LINE_COLOR)}"` +
    ` stroke-width="1.5" stroke-dasharray="3 2.5"/>` +
    `<circle cx="12" cy="5" r="2.5" fill="${css(FLOCK_EDGE_COLOR)}"/>`
  );
}

/** The trail: the same run of segments the scene draws, fading backwards. */
function trailSwatch(): string {
  const segment = (from: number, to: number, opacity: number): string =>
    `<line x1="${from}" y1="12" x2="${to}" y2="12" stroke="${css(TRAIL_COLOR)}"` +
    ` stroke-width="2.5" stroke-linecap="round" opacity="${opacity}"/>`;

  return (
    segment(2, 9, 0.15) +
    segment(9, 16, 0.5) +
    segment(16, 20, 0.95) +
    `<circle cx="21" cy="12" r="2.5" fill="${css(FLOCK_EDGE_COLOR)}"/>`
  );
}

export function renderLegend(host: HTMLElement): void {
  const rows: HTMLElement[] = [
    row(poolSwatch(), "pool — water surface and rim"),
    ...AERIAL_KINDS.map((kind) =>
      row(
        `<path d="${kind.legendShape}" fill="${css(kind.color)}"` +
          ` stroke="${css(FLOCK_EDGE_COLOR)}" stroke-width="1.5"/>`,
        kind.label,
      ),
    ),
    row(dropLineSwatch(), "dashed — height above the water surface"),
    row(trailSwatch(), "fading — recent path"),
  ];

  const note = document.createElement("div");
  note.className = "legend-note";
  note.textContent =
    "meters · x east, y north, z up · z = 0 at the water surface";

  host.replaceChildren(...rows, note);
}

function describe(status: FeedStatus): [tone: string, text: string] {
  switch (status.kind) {
    case "connecting":
      return ["waiting", "connecting to the world state stream…"];
    case "idle":
      return ["waiting", "connected — no state yet"];
    case "live":
      return ["live", "live"];
    case "waiting":
      return ["lost", `stream lost — ${status.detail}`];
    case "stalled":
      // Not a transport failure, and it must not be mistaken for one: the
      // scene is frozen because nothing is being published, not because the
      // page lost touch with the bus.
      return ["lost", `no state for ${status.seconds} s`];
    case "invalid":
      // Worth its own tone: the connection is fine, so nothing else on the page
      // would look wrong — the scene would simply be empty or subtly absurd.
      return ["error", `unusable state — ${status.detail}`];
  }
}

export function renderStatus(host: HTMLElement, status: FeedStatus): void {
  const [tone, text] = describe(status);
  const className = `status status-${tone}`;
  // The age of the last state is only knowable by asking, so this is called
  // every frame; rewriting the same words sixty times a second would make the
  // browser re-lay-out the line for nothing.
  if (host.textContent === text && host.className === className) return;
  host.className = className;
  host.textContent = text;
}
