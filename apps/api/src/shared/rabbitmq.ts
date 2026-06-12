import amqp, { type Channel, type ChannelModel } from "amqplib";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let reconnecting = false;

const MAX_RECONNECT_DELAY = 30_000;
let reconnectDelay = 1_000;

function resetConnection() {
  channel = null;
  connection = null;
}

function scheduleReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  resetConnection();

  setTimeout(async () => {
    reconnecting = false;
    try {
      await getChannel();
      reconnectDelay = 1_000; // reset backoff on success
    } catch {
      // getChannel already logs the error; backoff will increase on next attempt
    }
  }, reconnectDelay);

  // Exponential backoff capped at MAX_RECONNECT_DELAY
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

async function getChannel(): Promise<Channel | null> {
  const url = process.env.RABBITMQ_URL;
  if (!url) {
    return null;
  }

  if (channel) {
    return channel;
  }

  try {
    const nextConnection = await amqp.connect(url);
    connection = nextConnection;

    // Auto-reconnect on connection close/error
    nextConnection.on("error", (err) => {
      console.error("RabbitMQ connection error:", err);
      scheduleReconnect();
    });
    nextConnection.on("close", () => {
      console.warn("RabbitMQ connection closed, scheduling reconnect...");
      scheduleReconnect();
    });

    const nextChannel = await nextConnection.createChannel();
    channel = nextChannel;

    nextChannel.on("error", (err) => {
      console.error("RabbitMQ channel error:", err);
      resetConnection();
    });
    nextChannel.on("close", () => {
      channel = null;
    });

    reconnectDelay = 1_000; // reset backoff on successful connect
    return channel;
  } catch (error) {
    console.error("RabbitMQ connection failed:", error);
    scheduleReconnect();
    return null;
  }
}

let loggedDisabled = false;

export async function publishEvent(
  routingKey: string,
  payload: Record<string, unknown>
): Promise<void> {
  // RabbitMQ is optional. When RABBITMQ_URL is unset the event bus is disabled
  // (e.g. local dev without a broker); skip quietly instead of warning per event.
  if (!process.env.RABBITMQ_URL) {
    if (!loggedDisabled) {
      console.info("[RabbitMQ] Disabled (RABBITMQ_URL not set) — events are not published.");
      loggedDisabled = true;
    }
    return;
  }

  const eventChannel = await getChannel();
  if (!eventChannel) {
    console.warn(`[RabbitMQ] Event dropped (no connection): ${routingKey}`);
    return;
  }

  const exchangeName = process.env.RABBITMQ_EVENTS_EXCHANGE ?? "hfp.events";

  try {
    await eventChannel.assertExchange(exchangeName, "topic", { durable: true });
    eventChannel.publish(exchangeName, routingKey, Buffer.from(JSON.stringify(payload)), {
      persistent: true
    });
  } catch (error) {
    console.error(`[RabbitMQ] Failed to publish event ${routingKey}:`, error);
    resetConnection();
  }
}
