import amqp, { type ChannelModel } from "amqplib";
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
    });
  }

  return {
    name: "world-state-consumer",
    configureServer(server) {
      void startConsumer().catch((error: unknown) => {
        server.config.logger.error(`Unable to consume WorldState: ${String(error)}`);
      });

      server.middlewares.use("/api/world-state", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        if (latestWorldState === undefined) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: "WorldState is not available yet." }));
          return;
        }

        response.end(latestWorldState);
      });

      server.httpServer?.once("close", () => {
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
