# Pelican

Pelican is a message-driven wildlife-deterrence system prototype.

Application processes run natively on Fedora. RabbitMQ is the initial message bus and is the only component run in Docker at this stage.

Each process directory contains a `messages.yaml` file declaring exactly what it consumes and produces. Language-independent message contracts live in `messages/` as JSON Schema files.

The vertical slice is:

```text
world_simulator -> WorldState -> RabbitMQ -> world_state_stream -> SSE -> world_renderer
```

`WorldState` is a snapshot of the world model: pools and flocks in a local scene frame — meters, x east, y north, z up, with `z = 0` on the pool water surface. `world_renderer` is a browser page, so `world_state_stream` carries the same messages to it over HTTP instead of asking the browser to speak AMQP.

`messages/README.md` describes the frame and the conventions the contracts follow. `RUNNING.md` says how to start, check and stop the components.
