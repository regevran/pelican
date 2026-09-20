/**
 * Turns the states arriving from the feed into a pose for any instant.
 *
 * States arrive about twice a second; the page draws sixty times a second.
 * Drawing the newest state directly would step the whole scene every 500 ms,
 * so a pose is instead interpolated across the interval between the last two
 * states and the scene is drawn one interval behind the data.
 *
 * Deliberately free of any three.js import: this is arithmetic over the
 * contract, and keeping it that way means it can be reasoned about and tested
 * without a renderer.
 */

import {
  MIN_INTERVAL_MS,
  SNAP_DISTANCE_METERS,
} from "./palette";
import type { Pool, Position, Velocity, WorldState } from "./world-state";

interface Sample {
  /** When this state arrived, in milliseconds, on `performance.now()`'s clock. */
  at: number;
  state: WorldState;
}

export interface SampledFlock {
  name: string;
  position: Position;
  velocity: Velocity;
  /**
   * The pose came from a discontinuity — a new entity, or a jump too large to
   * be motion — rather than from interpolation. A trail should start over
   * rather than span it.
   */
  jumped: boolean;
}

export interface SampledWorld {
  pools: Pool[];
  flocks: SampledFlock[];
}

const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

const lerp = (from: number, to: number, alpha: number): number =>
  from + (to - from) * alpha;

function distanceBetween(from: Position, to: Position): number {
  return Math.hypot(
    to.x_meters - from.x_meters,
    to.y_meters - from.y_meters,
    to.z_meters - from.z_meters,
  );
}

function lerpPosition(from: Position, to: Position, alpha: number): Position {
  return {
    x_meters: lerp(from.x_meters, to.x_meters, alpha),
    y_meters: lerp(from.y_meters, to.y_meters, alpha),
    z_meters: lerp(from.z_meters, to.z_meters, alpha),
  };
}

/**
 * Velocity is interpolated too, because it drives the flock's orientation: at
 * 2 Hz a heading change arrives in discrete hops and the cone would visibly
 * step. It is a vector, so there is no angle wrapping to get wrong.
 */
function lerpVelocity(from: Velocity, to: Velocity, alpha: number): Velocity {
  return {
    x_meters_per_second: lerp(
      from.x_meters_per_second,
      to.x_meters_per_second,
      alpha,
    ),
    y_meters_per_second: lerp(
      from.y_meters_per_second,
      to.y_meters_per_second,
      alpha,
    ),
    z_meters_per_second: lerp(
      from.z_meters_per_second,
      to.z_meters_per_second,
      alpha,
    ),
  };
}

export class Sampler {
  private previous: Sample | undefined;
  private current: Sample | undefined;

  push(state: WorldState, at: number): void {
    this.previous = this.current;
    this.current = { at, state };
  }

  /**
   * The pose for `now`, or undefined before the first state has arrived.
   *
   * With only one state there is no interval to interpolate across, so that
   * state is held as-is; this matters on a cold start and after a reconnect,
   * where for one tick there is nothing to glide between.
   */
  sample(now: number): SampledWorld | undefined {
    const current = this.current;
    if (current === undefined) return undefined;

    const previous = this.previous;
    if (previous === undefined) {
      return {
        pools: current.state.pools,
        flocks: current.state.flocks.map((flock) => ({
          name: flock.name,
          position: flock.position,
          velocity: flock.velocity,
          jumped: true,
        })),
      };
    }

    // The measured interval, not the nominal tick: validation and publish time
    // vary, and using the nominal value would drift the pose against the data.
    const interval = Math.max(current.at - previous.at, MIN_INTERVAL_MS);
    // Clamping to 1 is also the freeze: once the interval has elapsed with no
    // new state, the pose holds at the last known one instead of extrapolating
    // off into the dark on a stalled producer.
    const alpha = clamp01((now - current.at) / interval);

    const previousByName = new Map(
      previous.state.flocks.map((flock) => [flock.name, flock]),
    );

    const flocks = current.state.flocks.map((flock): SampledFlock => {
      const before = previousByName.get(flock.name);
      if (before === undefined) {
        return {
          name: flock.name,
          position: flock.position,
          velocity: flock.velocity,
          jumped: true,
        };
      }

      if (distanceBetween(before.position, flock.position) > SNAP_DISTANCE_METERS) {
        return {
          name: flock.name,
          position: flock.position,
          velocity: flock.velocity,
          jumped: true,
        };
      }

      return {
        name: flock.name,
        position: lerpPosition(before.position, flock.position, alpha),
        velocity: lerpVelocity(before.velocity, flock.velocity, alpha),
        jumped: false,
      };
    });

    return { pools: current.state.pools, flocks };
  }
}
