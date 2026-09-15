export interface Coordinate {
  longitude_degrees: number;
  latitude_degrees: number;
  height_meters: number;
}

export interface Velocity {
  x_meters_per_second: number;
  y_meters_per_second: number;
  z_meters_per_second: number;
}

export interface Pool {
  name: string;
  boundary: Coordinate[];
}

export interface Flock {
  name: string;
  position: Coordinate;
  velocity: Velocity;
}

export interface WorldState {
  pools: Pool[];
  flocks: Flock[];
}
