# Message contracts

This directory contains language-independent message contracts expressed as JSON Schema.

Processes communicate only through these contracts and the message bus; they do not import one another's application code.

## The scene frame

Every position and velocity is expressed in one local frame: right-handed, in meters, with `x` east, `y` north and `z` up, and `z = 0` on the reference plane — the pool water surface.

The frame fixes orientation, handedness, units and the datum, because consumers depend on them: an altitude, or a line dropped to the water surface, means nothing without knowing where zero is. It deliberately does not fix the horizontal origin. Each producer picks its own, and a consumer never needs to know it, because a consumer frames itself from the data's own bounds. That is what keeps components autonomous: they agree on the shape of the world without agreeing on where in it they are.

Field names carry the axes and units, so no separate frame field is needed.

## Types

Reusable domain types live in `types/`. `Position` is a point in that frame, in `x_meters`, `y_meters` and `z_meters`. It documents no range: which altitudes are plausible is a producer's policy rather than the contract's, so fixing a band here would stop a second producer flying a different one.

`PlanarPoint` is a point on the reference plane — `x_meters` and `y_meters` only. Boundaries use it because a water surface lies on that plane by definition, so carrying a height would create a second, contradictory source of truth for it.

`Velocity` is a motion vector in that frame, in meters per second.

`Flock` represents a tracked flock in the world model. It composes `Position` for position and `Velocity` for motion.

`Pool` represents a named fish pool and the exact boundary of its water surface. It does not contain protection-zone or dynamic-state information.

`world_state.schema.json` contains a snapshot of the pools and flocks in the world model.
