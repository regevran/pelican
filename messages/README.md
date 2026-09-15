# Message contracts

This directory contains language-independent message contracts expressed as JSON Schema.

Processes communicate only through these contracts and the message bus; they do not import one another's application code.

Reusable domain types live in `types/`. `Coordinate` represents a WGS 84 geographic position using longitude and latitude in decimal degrees, plus height in meters above the WGS 84 ellipsoid.

`world_state.schema.json` - contains the schema for the state of the world
