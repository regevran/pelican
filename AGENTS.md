# Repository conventions

- Write component README descriptions in present tense.
- Components are autonomous: they are agnostic about the source of consumed messages and the target of produced messages. Describe a component only by the messages and behavior it owns.
- Use `Coordinate` for shared geographic positions: WGS 84 longitude and latitude in decimal degrees, with height in meters above the WGS 84 ellipsoid.
- Use `Velocity` for shared motion vectors: Earth-centered, Earth-fixed (ECEF) x, y, and z components in meters per second.
- A `Pool` has a unique machine-readable `name` and an exact water-surface boundary. Protection zones and dynamic state do not belong in `Pool`.
- A `Flock` is a tracked world-model entity with a unique machine-readable `name`, `Coordinate` position, and `Velocity` motion vector. Do not add sensor evidence or classification fields until they are designed.
- `WorldState` is a snapshot that composes arrays of `Pool` and `Flock`.
