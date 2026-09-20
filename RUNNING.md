# Running Pelican

Everything below runs natively on Fedora except the message bus, which runs in Docker.

## Quick start

```sh
./scripts/install.sh                # once per clone, and after moving the repository
systemctl --user start pelican.target
```

Then open **<http://localhost:5173>**. The scene appears as soon as the first `WorldState` arrives, a second or two after starting.

`pelican.target` is the one thing to start and stop. It is a systemd *target* rather than a *service* on purpose: a target is systemd's word for exactly this — a named group of units with no process of its own. Starting it starts all four components; stopping it stops all four.

None of the units are enabled by you having installed them. `systemctl --user enable pelican.target` is the separate decision to start the stack at login, and `loginctl enable-linger $USER` extends that to before you log in.

## What runs

| Process | Unit | Listens on | Needs |
| --- | --- | --- | --- |
| RabbitMQ | `pelican-broker` | `5672` (AMQP), `15672` (management UI) | — |
| `world_simulator` | `pelican-simulator` | nothing | RabbitMQ |
| `world_state_stream` | `pelican-bridge` | `8081` | RabbitMQ (retries until it is there) |
| `world_renderer` | `pelican-renderer` | `5173` | `world_state_stream` |

Each component tolerates the one it depends on being absent, which is why they can start in any order and why a failure shows up as a wait rather than a cascade.

## Running one component yourself

The stack is supervised for the three components you rarely touch, and the fourth — whichever you are editing — is yours to run in a terminal. To hand a unit back to yourself, stop it and run the command you already know:

| Component | Hand it back | Take it again |
| --- | --- | --- |
| renderer | `systemctl --user stop pelican-renderer` then `cd world_renderer && npm run dev` | `Ctrl+C`, then `systemctl --user start pelican-renderer` |
| bridge | `systemctl --user stop pelican-bridge` then `cd world_state_stream && npm start` | `Ctrl+C`, then `systemctl --user start pelican-bridge` |
| simulator | `systemctl --user stop pelican-simulator` then `world_simulator/.venv/bin/python -m world_simulator` | `Ctrl+C`, then `systemctl --user start pelican-simulator` |
| broker | `systemctl --user stop pelican-broker` then `docker compose up` | `Ctrl+C`, then `systemctl --user start pelican-broker` |

Stopping one unit leaves the rest running, so nothing else moves while you work.

## Controlling the units

Each unit takes the same verbs. `restart` is the common one — it is how you pick up an edit that is not watched, such as anything under `world_simulator` or `world_state_stream`.

```sh
systemctl --user start    pelican-broker      # one component
systemctl --user stop     pelican-simulator
systemctl --user restart  pelican-bridge
systemctl --user status   pelican-renderer    # is it running, and since when
systemctl --user is-active pelican-broker     # just the state, for a script
journalctl --user -u pelican-simulator -f     # follow one component's output
```

For the whole stack, the same verbs on the target:

```sh
systemctl --user start   pelican.target
systemctl --user stop    pelican.target
systemctl --user restart pelican.target
systemctl --user status  pelican.target       # every component's state in one view
journalctl --user -u pelican-broker -u pelican-simulator -u pelican-bridge -u pelican-renderer -f
```

Because output goes to the journal rather than to a terminal, reading it is a query: `journalctl --user -u pelican-bridge --since "10 min ago"`.

## Running by hand

Without systemd, the same four processes in four terminals. This is also the path when you want to watch a component's output directly rather than through the journal.

```sh
docker compose up -d                                                  # the broker

world_simulator/.venv/bin/python -m world_simulator                   # the producer

cd world_state_stream && npm start                                    # the bridge

cd world_renderer && npm run dev                                      # the page
```

| Address | What it is |
| --- | --- |
| <http://localhost:5173> | The rendered scene. This is the one you want. |
| <http://localhost:4173> | The same page built for production (`npm run preview`). |
| <http://localhost:8081/api/world-state> | The raw `WorldState` stream. |
| <http://localhost:8081/api/world-state/latest> | The most recent `WorldState` as plain JSON. |
| <http://localhost:15672> | RabbitMQ management UI — `guest` / `guest`. |

## First-time setup

`install.sh` warns if any of these are missing, but does not do them for you.

```sh
python3 -m venv world_simulator/.venv
world_simulator/.venv/bin/pip install -e world_simulator

cd world_state_stream && npm install && cd ..
cd world_renderer     && npm install && cd ..

./scripts/install.sh
```

## Checking one layer at a time

When the page is blank, work up from the bottom. Each command tests exactly one hop, and none of them care whether the component is running under systemd.

```sh
# Is the broker up, and is the bridge attached to it?
# Expect one queue (an amq.gen-* name) with 1 consumer.
docker exec pelican-rabbitmq rabbitmqctl list_queues name messages consumers

# Is the producer publishing? Expect a fresh WorldState, and a 503 before the first tick.
curl -s http://localhost:8081/api/world-state/latest

# Is the bridge streaming? Expect one frame immediately, then one every ~0.5 s.
# -N is required; without it curl buffers and the stream looks dead.
curl -sN http://localhost:8081/api/world-state

# The same, through the page's own dev server. Expect exactly the same output.
curl -sN http://localhost:5173/api/world-state
```

If the last two commands disagree, the problem is the proxy rather than anything below it: point the page straight at the bridge instead, by running the dev server with `VITE_WORLD_STATE_URL=http://localhost:8081/api/world-state npm run dev`.

## Configuration

| Variable | Read by | Default |
| --- | --- | --- |
| `RABBITMQ_URL` | `world_simulator`, `world_state_stream` | `amqp://guest:guest@localhost:5672/%2F` |
| `WORLD_STATE_STREAM_PORT` | `world_state_stream` | `8081` |
| `PELICAN_BRIDGE_PORT` | `world_renderer` (the proxy target) | `8081` |
| `VITE_WORLD_STATE_URL` | `world_renderer` (bypasses the proxy) | unset — the page asks its own origin |

These are read from the environment. Exported variables in your shell reach the units in the *by hand* path but **not** the supervised one, which starts with no shell environment at all. To override a value for a unit:

```sh
systemctl --user edit pelican-bridge     # opens a drop-in; add [Service] Environment=RABBITMQ_URL=...
systemctl --user restart pelican-bridge
```

## Stopping

`systemctl --user stop pelican.target` stops everything. On the by-hand path, `Ctrl+C` in each terminal and `docker compose down` for the broker.

## The broker container

The broker unit runs `docker compose up`, so under systemd the compose file is what owns the container and the container carries compose's labels.

This machine is not in that state yet. The running `pelican-rabbitmq` was started by hand before the repository existed:

```sh
docker run -d --name pelican-rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4-management
```

It has no compose labels, and compose manages containers by name rather than adopting containers it did not create — so before the first `systemctl --user start pelican-broker`, that container has to go:

```sh
docker rm -f pelican-rabbitmq
```

Skip that and the unit does not fail once, it fails repeatedly: compose exits `1` with `Conflict. The container name "/pelican-rabbitmq" is already in use`, and `Restart=on-failure` starts it straight back up. `install.sh` warns when it finds the container in this state, because a crash-loop is a much worse thing to debug than a message.

Until you do, `docker compose ps` prints an empty list, `docker compose down` does nothing, and the container is addressed by name instead:

```sh
docker stop pelican-rabbitmq
docker start pelican-rabbitmq
```

Once the unit owns the broker, testing a broker outage is `systemctl --user stop pelican-broker` and `systemctl --user start pelican-broker`.

Do not test it with `docker stop pelican-rabbitmq`. The unit's main process is `docker compose up`, so stopping the container makes compose exit, and systemd then runs the unit's `ExecStop=docker compose down` — which removes the container and its network along with it. The broker unit ends up `inactive (dead)` and the container is gone, which looks like a broken install rather than a test. The stack does recover from that state (`systemctl --user start pelican-broker` rebuilds it in a couple of seconds), but it is not what you meant to do.

Stopping `pelican-broker` deliberately runs the same `down`, so the container is recreated on the next start. That is harmless here: the exchange is re-declared by the simulator and the bridge's queue is exclusive and auto-deleting, so a recreated broker has no state worth keeping.

## When something looks wrong

| What you see | What it usually means |
| --- | --- |
| Page loads, frame and legend drawn, status says *connecting* | The bridge is not listening on `8081`. `systemctl --user status pelican-bridge`. |
| Status says *connected — no state yet* | The bridge is up but the producer is not publishing. `systemctl --user status pelican-simulator`. |
| Status says *no state for N s* | The stream is connected and used to deliver, but has gone quiet. Usually the producer died on a broker restart; under systemd `Restart=on-failure` brings it back by itself. |
| Status says *unusable state* | Something is arriving that is not a `WorldState`. Usually a producer publishing in an old message frame. |
| The scene is empty but the status says *live* | A pool ring with fewer than three points is skipped with a warning. `journalctl --user -u pelican-renderer`. |
| Nothing appears at all, no frame | The page failed to start rather than failed to draw. Check the browser console and `journalctl --user -u pelican-renderer`. |
| A unit is in `activating (auto-restart)` | It is crash-looping. `journalctl --user -u <unit> -n 50` for why. |
| `pelican-broker` restarts in a loop | A container of that name exists that compose did not create, so it cannot claim it. `docker rm -f pelican-rabbitmq`. |
| Nothing is listening on `5173` | `pelican-renderer` is stopped — you probably stopped it to run the dev server yourself. |
