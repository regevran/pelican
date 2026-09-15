import amqp, { type ChannelModel } from "amqplib";
import type { ServerResponse } from "node:http";
import { relative, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const EXCHANGE_NAME = "pelican.world_state";
const QUEUE_NAME = "pelican.world_renderer";
const rabbitMqUrl = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672/%2F";
const cesiumSource = fileURLToPath(
  new URL("./node_modules/cesium/Build/Cesium", import.meta.url),
);
// vite-plugin-static-copy always preserves the full path from the project
// root, so copying a directory under node_modules would nest it under
// "cesium-static/node_modules/cesium/.../" instead of "cesium-static/Assets".
// Strip that project-root-relative prefix to flatten it to just the folder
// name (Assets, ThirdParty, Widgets, Workers), matching CESIUM_BASE_URL below.
const cesiumSourceStripCount = relative(process.cwd(), cesiumSource).split(sep).length;

function worldStateConsumer(): Plugin {
  let connection: ChannelModel | undefined;
  let latestWorldState: string | undefined;
  const subscribers = new Set<ServerResponse>();

  function broadcast(worldState: string): void {
    for (const subscriber of subscribers) {
      subscriber.write(`data: ${worldState}\n\n`);
    }
  }

  async function startConsumer(): Promise<void> {
    connection = await amqp.connect(rabbitMqUrl);
    const channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE_NAME, "fanout", { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, "");
    await channel.consume(QUEUE_NAME, (message) => {
      if (message === null) {
        return;
      }

      latestWorldState = message.content.toString("utf-8");
      channel.ack(message);
      broadcast(latestWorldState);
    });
  }

  return {
    name: "world-state-consumer",
    configureServer(server) {
      void startConsumer().catch((error: unknown) => {
        server.config.logger.error(`Unable to consume WorldState: ${String(error)}`);
      });

      server.middlewares.use("/api/world-state", (request, response) => {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        if (latestWorldState !== undefined) {
          response.write(`data: ${latestWorldState}\n\n`);
        }

        subscribers.add(response);
        request.on("close", () => {
          subscribers.delete(response);
        });
      });

      server.httpServer?.once("close", () => {
        for (const subscriber of subscribers) {
          subscriber.end();
        }
        subscribers.clear();
        void connection?.close();
      });
    },
  };
}

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify("/cesium-static"),
  },
  plugins: [
    worldStateConsumer(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/Assets`, dest: "cesium-static", rename: { stripBase: cesiumSourceStripCount } },
        { src: `${cesiumSource}/ThirdParty`, dest: "cesium-static", rename: { stripBase: cesiumSourceStripCount } },
        { src: `${cesiumSource}/Widgets`, dest: "cesium-static", rename: { stripBase: cesiumSourceStripCount } },
        { src: `${cesiumSource}/Workers`, dest: "cesium-static", rename: { stripBase: cesiumSourceStripCount } },
      ],
    }),
  ],
});
