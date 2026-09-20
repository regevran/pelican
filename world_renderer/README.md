# World renderer

The world renderer consumes `WorldState` and draws its pools and flocks as a bounded three-dimensional scene in a browser. It renders in the local scene frame: meters, x east, y north, z up, with `z = 0` on the reference plane — the pool water surface. It does not know where on Earth any of it is.

Its message interface is declared in `messages.yaml`.

## Getting the state

The renderer is a browser page, so it reads `WorldState` over Server-Sent Events rather than from the bus directly. It asks its own origin for `/api/world-state` and the dev server proxies that to whatever is serving the stream; the page itself has no host to keep in sync and makes no cross-origin request. Set `PELICAN_BRIDGE_PORT` to point the proxy somewhere other than `127.0.0.1:8081`.

The payload of each event is one `WorldState` message body, exactly as published.

If the proxy ever buffers the stream — SSE has to be passed through as it arrives — the page can be pointed straight at the stream instead, since the stream sends `Access-Control-Allow-Origin: *`. Serve the page with `VITE_WORLD_STATE_URL` set to the stream's absolute URL, or edit `WORLD_STATE_URL` in `src/feed.ts`.

## Reading the scene

Silhouette carries identity and colour reinforces it, so the legend stays legible in greyscale.

| Mark | What it is |
| --- | --- |
| Blue filled outline, recessed below the grid | A pool. The surface is its water-surface ring; the rim slab is what keeps it solid when seen edge-on. |
| Orange cone, apex leading | A flock. It points the way it is moving. |
| Dashed line down to the grid | Height above the water surface. |
| Line fading backwards | The recent path, a few tens of seconds of it. |
| Labelled vertical axis, 0–300 m | The altitude band, with the volume's edges and ceiling. |

The scene distinguishes three things the state can do that look alike from inside the browser: a stream that is connected but silent, a stream whose payload is unusable, and a healthy stream. The status line names all three, because a frozen scene under a green light is the one failure that would otherwise read as a bug in the drawing code.

## Running

```sh
npm install
npm run dev        # serves the page and proxies /api to the stream
npm run build      # tsc --noEmit && vite build
npm run preview    # serves the build, with the same proxy
```

The page needs a producer on the bus and something serving the stream; without either it renders the frame and reports that it is waiting.

## What it deliberately does not do

It does not model water, terrain, birds or drones realistically. It has no imagery, no textures and no geographic coordinates, and it frames its camera from the data's own bounds rather than from any fixed scene size. A producer that flies a different altitude band is drawn with the band it actually uses, up to the ceiling named in `src/palette.ts`.

Every tunable in the renderer — colours, sizes, camera framing, trail length, thresholds — is in `src/palette.ts`.
