# Pelican

Pelican is a message-driven wildlife-deterrence system prototype.

Application processes run natively on Fedora. RabbitMQ is the initial message bus and is the only component run in Docker at this stage.

Each process directory contains a `messages.yaml` file declaring exactly what it consumes and produces. Language-independent message contracts live in `messages/` as JSON Schema files.

The initial vertical slice is:

```text
world_simulator -> WorldState -> RabbitMQ -> world_renderer
```

`WorldState` is intentionally not designed yet; its schema remains empty until that discussion takes place.
