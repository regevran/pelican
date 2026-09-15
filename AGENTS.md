# Repository conventions

- Write component README descriptions in present tense.
- Components are autonomous: they are agnostic about the source of consumed messages and the target of produced messages. Describe a component only by the messages and behavior it owns.
- Use `Coordinate` for shared geographic positions: WGS 84 longitude and latitude in decimal degrees, with height in meters above the WGS 84 ellipsoid.
