/**
 * The WorldState contract, mirrored from messages/. The field names carry the
 * axes and units: meters east, north and up, with z = 0 on the pool water
 * surface. See messages/README.md for the frame itself.
 */

/** A point on the reference plane, as used for a pool boundary. */
export interface PlanarPoint {
  x_meters: number;
  y_meters: number;
}

export interface Position {
  x_meters: number;
  y_meters: number;
  z_meters: number;
}

export interface Velocity {
  x_meters_per_second: number;
  y_meters_per_second: number;
  z_meters_per_second: number;
}

export interface Pool {
  name: string;
  boundary: PlanarPoint[];
}

export interface Flock {
  name: string;
  position: Position;
  velocity: Velocity;
}

export interface WorldState {
  pools: Pool[];
  flocks: Flock[];
}
