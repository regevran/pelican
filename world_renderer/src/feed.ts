/**
 * The WorldState feed: a Server-Sent Events connection to the message bus
 * bridge, plus what the page should say about it.
 *
 * EventSource reconnects on its own, on the interval the stream's `retry`
 * directive sets, so there is no retry loop here — only the reporting of what
 * it is doing. That reporting is deliberately larger than "is the socket
 * open": a healthy socket with a silent producer is the case that would
 * otherwise freeze the scene under a green light.
 */

import { STALE_AFTER_MS } from "./palette";
import type { WorldState } from "./world-state";

/**
 * Where the stream is served. The default is a path on this origin, which the
 * dev server and the preview server both proxy to the stream.
 *
 * `VITE_WORLD_STATE_URL` overrides it with an absolute URL, which is the way
 * round a proxy that buffers the stream instead of passing it through — the
 * stream sends `Access-Control-Allow-Origin: *` so the browser will accept it
 * from another origin.
 */
export const WORLD_STATE_URL: string =
  import.meta.env.VITE_WORLD_STATE_URL ?? "/api/world-state";

export type FeedStatus =
  /** No connection yet, or the first attempt is in flight. */
  | { kind: "connecting" }
  /** The connection is open and states are arriving. */
  | { kind: "live" }
  /** The connection is open but nothing has ever arrived. */
  | { kind: "idle" }
  /** The connection dropped; EventSource is retrying. */
  | { kind: "waiting"; detail: string }
  /** Connected, but no state has arrived for a while. */
  | { kind: "stalled"; seconds: number }
  /**
   * Something is arriving but it is not a usable WorldState. Distinct from
   * `waiting` because the connection is healthy — the payload is the problem,
   * which is what a producer still speaking the old frame would look like.
   */
  | { kind: "invalid"; detail: string };

export interface FeedHandlers {
  onState: (state: WorldState) => void;
}

/**
 * Structural check, not the schema: the page cannot afford a validator and the
 * producer already validated on its side. This catches a payload in the wrong
 * shape — most usefully, an old-format one, which would otherwise be
 * reinterpreted as meters and drawn near the origin as though it were real.
 */
function looksLikeWorldState(value: unknown): value is WorldState {
  if (typeof value !== "object" || value === null) return false;
  const { pools, flocks } = value as Partial<WorldState>;
  return Array.isArray(pools) && Array.isArray(flocks);
}

export class WorldStateFeed {
  private readonly source: EventSource;
  /** What the transport alone has to say, before data age is considered. */
  private transport: FeedStatus = { kind: "connecting" };
  /** When a state last arrived, or 0 if none ever has. */
  private lastStateAt = 0;

  constructor(
    private readonly handlers: FeedHandlers,
    url: string = WORLD_STATE_URL,
  ) {
    this.source = new EventSource(url);
    this.source.onopen = () => {
      // Opening a connection is not the same as receiving anything on it, and
      // saying "live" before the first state would be a claim about data.
      this.transport = this.lastStateAt === 0 ? { kind: "idle" } : { kind: "live" };
    };
    this.source.onmessage = (event) => this.receive(event.data);
    this.source.onerror = () => {
      this.transport = this.errorStatus();
    };
  }

  /**
   * What to say about the feed right now.
   *
   * Asked once a frame rather than pushed on change, because the one thing
   * worth saying here — that the data has stopped — is the absence of an event
   * and has to be noticed rather than received.
   */
  statusAt(now: number): FeedStatus {
    if (this.transport.kind !== "live") return this.transport;
    // Never any data at all is a different condition from data that stopped,
    // and the transport status already describes it.
    if (this.lastStateAt === 0) return this.transport;

    const silence = now - this.lastStateAt;
    if (silence <= STALE_AFTER_MS) return this.transport;
    return { kind: "stalled", seconds: Math.round(silence / 1000) };
  }

  close(): void {
    this.source.close();
  }

  /**
   * `onerror` fires for a dropped connection and for a fatal one, and the
   * event carries no reason. `readyState` is the only thing that separates
   * them: EventSource is CLOSED when it has given up, and CONNECTING when it
   * is retrying by itself.
   */
  private errorStatus(): FeedStatus {
    if (this.source.readyState === EventSource.CLOSED) {
      return { kind: "waiting", detail: "the browser stopped retrying" };
    }
    return { kind: "waiting", detail: "reconnecting" };
  }

  private receive(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.transport = { kind: "invalid", detail: "the state is not JSON" };
      return;
    }

    if (!looksLikeWorldState(parsed)) {
      this.transport = {
        kind: "invalid",
        detail: "the state has no pools and flocks arrays",
      };
      return;
    }

    this.transport = { kind: "live" };
    this.lastStateAt = performance.now();
    this.handlers.onState(parsed);
  }
}
