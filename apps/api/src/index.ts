import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);

async function start(): Promise<void> {
  const app = await createApp();
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API listening on port ${port}`);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
