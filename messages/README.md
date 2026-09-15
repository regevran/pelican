# Message contracts

This directory contains language-independent message contracts expressed as JSON Schema.

Processes communicate only through these contracts and the message bus; they do not import one another's application code.

Reusable domain types live in `types/`. `Coordinate` represents a WGS 84 geographic position using longitude and latitude in decimal degrees, plus height in meters above the WGS 84 ellipsoid.

`Velocity` represents an Earth-centered, Earth-fixed (ECEF) velocity vector in meters per second, matching Cesium's Cartesian world frame.

`Flock` represents a tracked flock in the world model. It composes `Coordinate` for position and `Velocity` for motion.

`Pool` represents a named fish pool and the exact boundary of its water surface. It does not contain protection-zone or dynamic-state information.

`world_state.schema.json` contains a snapshot of the pools and flocks in the world model.
