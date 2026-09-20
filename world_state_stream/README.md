# World state stream

The world state stream carries `WorldState` from the message bus to HTTP clients over Server-Sent Events. It forwards each message body verbatim: it does not parse, validate or reshape `WorldState`, and it publishes nothing back to the bus.

Its message interface is declared in `messages.yaml`.

## HTTP interface

`GET /api/world-state` responds with `text/event-stream`. Each `data:` frame is one `WorldState` message body, byte for byte as published. A client that connects between two publications immediately receives the most recent `WorldState`, so it does not start blank.

`GET /api/world-state/latest` responds with the most recent `WorldState` as plain JSON, or `503` before the first one arrives. This exists so the stream can be inspected with `curl` without reading SSE framing.

Every response carries `Access-Control-Allow-Origin: *`, so a client served from another origin can consume the stream directly rather than through a proxy.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672/%2F` | The message bus to consume from. |
| `WORLD_STATE_STREAM_PORT` | `8081` | The port the HTTP interface listens on. |

## Running

```sh
npm install
npm start
```

The process serves HTTP immediately and connects to the bus in the background, so it starts cleanly whether or not the bus is reachable, and survives the bus going away and returning. While it is waiting for the bus it says so every 15 seconds, so a bus that is absent — at startup or later — is visible in the log rather than silent.

## Delivery

The stream consumes from a private, exclusive, auto-deleting queue bound to the `pelican.world_state` exchange. The queue exists only while the stream is connected, so no backlog accumulates while no client is running, and two stream instances never contend for messages.

This is a deliberate trade: the stream is always *current* rather than *exhaustive*. A message published while nothing is connected is not delivered to a later client. Retaining history is not this component's concern.

Because each instance owns its own queue, running a second stream is safe rather than a conflict.
