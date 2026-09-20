// Carries WorldState from the message bus to HTTP clients over Server-Sent
// Events. The payload is forwarded verbatim: this process never parses,
// validates or reshapes WorldState, it only transports it.

import amqp from "amqplib";
import { createServer } from "node:http";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672/%2F";
const PORT = Number(process.env.WORLD_STATE_STREAM_PORT ?? 8081);

const EXCHANGE_NAME = "pelican.world_state";

// The broadcaster coalesces: a consumed message marks the latest state dirty,
// and a timer flushes it at most this often. That decouples the rate clients
// see from the rate the bus delivers, so a burst of queued messages can never
// flood a client.
const FLUSH_INTERVAL_MS = 100;

// SSE comment lines keep intermediaries (and the Vite dev proxy) from treating
// an idle stream as dead. EventSource ignores them.
const KEEP_ALIVE_INTERVAL_MS = 15_000;

const REATTACH_DELAY_MS = 500;

// How often to report that the bus is still absent at startup. See the waiting
// report further down for why that needs saying at all.
const WAITING_REPORT_INTERVAL_MS = 15_000;

/** The most recent WorldState body, exactly as published. */
let latest;
let pendingFlush = false;
const subscribers = new Set();

/** The channel currently consuming, if any. At most one is ever live. */
let currentChannel;
/** Whether the bus connection is currently up. */
let modelConnected = false;
let connection;
/** Periodic reminder that the bus has not answered yet; see the waiting report. */
let waitingReport;

/**
 * Describe an error for a log line.
 *
 * The bus client does not always populate `message`: across a prolonged outage
 * it can hand back a bare `Error` carrying only a `code`. Interpolating that
 * gives a blank, which reads as though nothing were wrong. Prefer whichever
 * field carries something — the surrounding sentence already says what failed.
 */
function describeError(error) {
  return error?.message || error?.code || "no further detail";
}

function broadcast(payload) {
  for (const subscriber of subscribers) {
    subscriber.write(`data: ${payload}\n\n`);
  }
}

/**
 * Wire a consuming channel onto a freshly connected model.
 *
 * Called by the bus client's recovery after *every* successful connection,
 * including the first, so there is a single wiring path. Any channel from a
 * previous connection is closed first: that invariant is what makes the
 * channel-level recovery below incapable of leaking channels.
 */
async function attach(model) {
  if (currentChannel !== undefined) {
    const previous = currentChannel;
    currentChannel = undefined;
    await previous.close().catch(() => {
      // Already closed. Expected when this is a reconnect rather than a
      // channel-level retry.
    });
  }

  const channel = await model.createChannel();

  // Exclusive and auto-delete: the queue lives only as long as this
  // connection. No backlog can accumulate while no stream is running, and two
  // stream instances get their own private copy instead of competing.
  //
  // The trade is deliberate: the stream is always *current* rather than
  // *exhaustive*. A message published while no stream is connected is not
  // delivered to a later client.
  const { queue } = await channel.assertQueue("", { exclusive: true, autoDelete: true });

  // Must match the producer's declaration exactly, or this fails with
  // PRECONDITION_FAILED.
  await channel.assertExchange(EXCHANGE_NAME, "fanout", { durable: true });
  await channel.bindQueue(queue, EXCHANGE_NAME, "");

  await channel.consume(queue, (message) => {
    if (message === null) {
      return;
    }
    latest = message.content.toString("utf-8");
    pendingFlush = true;
    channel.ack(message);
  });

  currentChannel = channel;
  // Recording the connection here rather than on the 'connect' event is
  // deliberate: recovery runs setup *before* emitting 'connect' (recovery.js
  // calls runSetup, then emit('connect', model)), so the event for the initial
  // connection has already fired by the time the connect() promise settles and
  // a listener could be attached. This runs exactly when we are connected.
  modelConnected = true;
  if (waitingReport !== undefined) {
    clearInterval(waitingReport);
    waitingReport = undefined;
  }
  console.log(`Consuming ${EXCHANGE_NAME} on exclusive queue ${queue}.`);

  // The bus client's recovery restores *connections*; a channel that dies
  // while the connection stays up is not recovered by it, so handle that case
  // here. The guard below is what stops a connection drop from producing a
  // spurious second channel: on a drop the model is marked disconnected, so
  // this declines and the recovery's own attach() does the work instead.
  const reattach = (reason) => {
    if (currentChannel !== channel) {
      // Superseded by a newer attach; the connection was lost, not the channel.
      return;
    }
    currentChannel = undefined;
    console.warn(`Channel ${reason}; re-attaching in ${REATTACH_DELAY_MS} ms.`);
    setTimeout(() => {
      if (!modelConnected || currentChannel !== undefined) {
        return;
      }
      void attach(model).catch((error) => {
        console.warn(`Re-attach failed: ${error.message}`);
      });
    }, REATTACH_DELAY_MS);
  };

  channel.on("close", () => reattach("closed"));
  channel.on("error", (error) => reattach(`errored (${error.message})`));
}

function respond(response, status, headers, body) {
  response.writeHead(status, headers);
  response.end(body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === "/api/world-state/latest") {
    if (latest === undefined) {
      respond(
        response,
        503,
        { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        JSON.stringify({ error: "no WorldState has arrived yet" }),
      );
      return;
    }
    respond(
      response,
      200,
      { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      latest,
    );
    return;
  }

  if (url.pathname !== "/api/world-state") {
    respond(response, 404, { "Content-Type": "text/plain" }, "Not found\n");
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    // no-transform matters: it forbids an intermediary from buffering or
    // recompressing the stream out of existence.
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });
  response.flushHeaders();
  response.write("retry: 2000\n\n");

  // Replay the current state, so a client connecting between two publications
  // is not blank until the next one.
  if (latest !== undefined) {
    response.write(`data: ${latest}\n\n`);
  }

  subscribers.add(response);
  const unsubscribe = () => {
    subscribers.delete(response);
  };
  // 'close' catches the client going away; 'error' catches a socket that dies
  // mid-write, which would otherwise surface as an unhandled stream error.
  request.on("close", unsubscribe);
  response.on("error", unsubscribe);
});

const flushTimer = setInterval(() => {
  if (!pendingFlush || latest === undefined) {
    return;
  }
  pendingFlush = false;
  broadcast(latest);
}, FLUSH_INTERVAL_MS);

const keepAliveTimer = setInterval(() => {
  for (const subscriber of subscribers) {
    subscriber.write(": keep-alive\n\n");
  }
}, KEEP_ALIVE_INTERVAL_MS);

function shutdown() {
  console.log("Shutting down.");
  clearInterval(flushTimer);
  clearInterval(keepAliveTimer);
  clearInterval(waitingReport);
  for (const subscriber of subscribers) {
    subscriber.end();
  }
  subscribers.clear();
  server.close();
  if (connection !== undefined) {
    void connection.close().catch(() => {
      // Nothing useful left to do while exiting.
    });
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Listen before connecting, and deliberately do not await the connection
// before that: with the default maxRetries of Infinity the connect promise
// does not settle until the bus appears, and the interface must serve (and
// report that it is waiting) meanwhile.
server.listen(PORT, () => {
  console.log(`Serving WorldState at http://localhost:${PORT}/api/world-state`);
});

// The bus client's own retry loop reports nothing until its first success:
// connect() does not settle until then, so there is no model to attach the
// 'connect-failed' listeners to, and a bus that is absent from the start would
// otherwise produce no output whatsoever — a log indistinguishable from a
// healthy one. Say so ourselves until attach() gets through.
console.log(`Connecting to the message bus at ${RABBITMQ_URL}.`);
waitingReport = setInterval(() => {
  console.warn(`Still waiting for the message bus at ${RABBITMQ_URL}.`);
}, WAITING_REPORT_INTERVAL_MS);

try {
  connection = await amqp.connect(RABBITMQ_URL, {
    recovery: {
      initialDelay: 250,
      maxDelay: 5000,
      factor: 2,
      jitter: 0.2,
      setup: attach,
    },
  });
} catch (error) {
  // Reachable only for a malformed URL or similar. A merely absent bus does
  // not reject: with the default maxRetries of Infinity it waits.
  clearInterval(waitingReport);
  waitingReport = undefined;
  console.error(`Cannot connect to the message bus: ${describeError(error)}`);
  process.exitCode = 1;
}

if (connection !== undefined) {
  console.log("Connected to the message bus.");

  // The initial 'connect' has already fired by the time connect() settles (see
  // attach), so these listeners only ever observe later transitions.
  connection.on("connect", () => {
    console.log("Reconnected to the message bus.");
  });

  connection.on("disconnect", (error) => {
    modelConnected = false;
    console.warn(`Lost the message bus: ${describeError(error)}`);
  });

  // Missing this listener does not leave the error merely unreported: Node
  // re-throws an unhandled 'error' event and the process dies. The recovery
  // layer emits one when a connection closes abnormally — it arrives as
  // "Unexpected close", which is what a broker going away mid-conversation
  // looks like — so without this the component is at its most fragile exactly
  // when it is supposed to be recovering. Recovery has already scheduled the
  // next attempt by the time this fires, so there is nothing to do but say so.
  connection.on("error", (error) => {
    console.warn(`Message bus error: ${describeError(error)}`);
  });

  connection.on("connect-failed", (error) => {
    console.warn(`Cannot reach the message bus: ${describeError(error)}`);
  });

  connection.on("reconnect-scheduled", ({ attempt, delay, error }) => {
    console.warn(`Reconnect attempt ${attempt} in ${delay} ms (${describeError(error)}).`);
  });
}
