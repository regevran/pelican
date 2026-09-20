# Repository conventions

- Write component README descriptions in present tense.
- Components are autonomous: they are agnostic about the source of consumed messages and the target of produced messages. Describe a component only by the messages and behavior it owns.
- Use `Position` for shared positions in the local scene frame: meters east, north and up, with `z = 0` on the reference plane (the pool water surface).
- Use `Velocity` for shared motion vectors in that same frame: x east, y north, and z up, in meters per second.
- A `Pool` has a unique machine-readable `name` and an exact water-surface boundary, given as a `PlanarPoint` ring on the reference plane. Protection zones and dynamic state do not belong in `Pool`.
- A `Flock` is a tracked world-model entity with a unique machine-readable `name`, a `Position`, and a `Velocity`. Do not add sensor evidence or classification fields until they are designed.
- `WorldState` is a snapshot that composes arrays of `Pool` and `Flock`.
