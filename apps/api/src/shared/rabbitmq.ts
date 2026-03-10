import amqp, { type Channel, type ChannelModel } from "amqplib";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

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
    channel = await nextConnection.createChannel();
    return channel;
  } catch (error) {
    console.error("RabbitMQ connection failed:", error);
    return null;
  }
}

export async function publishEvent(
  routingKey: string,
  payload: Record<string, unknown>
): Promise<void> {
  const eventChannel = await getChannel();
  if (!eventChannel) {
    return;
  }

  const exchangeName = process.env.RABBITMQ_EVENTS_EXCHANGE ?? "hfp.events";

  await eventChannel.assertExchange(exchangeName, "topic", { durable: true });
  eventChannel.publish(
    exchangeName,
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true }
  );
}
