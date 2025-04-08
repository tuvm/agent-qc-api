import { FastifyPluginAsync } from 'fastify';
import { connect, Connection, Channel, ChannelModel } from 'amqplib';

declare module 'fastify' {
  interface FastifyInstance {
    rabbitmq: {
      connection: Connection;
      channel: Channel;
    };
  }
}

export const rabbitmq: {
  connection: ChannelModel | null;
  channel: Channel | null ;
} = {
  connection: null,
  channel: null,
};

const rabbitmqPlugin: FastifyPluginAsync = async (fastify) => {
  try {
    const connection = await connect({
      hostname: process.env.RABBITMQ_HOST || 'localhost',
      port: parseInt(process.env.RABBITMQ_PORT || '5672'),
      username: process.env.RABBITMQ_USER || 'guest',
      password: process.env.RABBITMQ_PASSWORD || 'guest',
    });

    const channel = await connection.createChannel();

    // Declare exchanges
    await channel.assertExchange('audio', 'direct', { durable: true });
    await channel.assertExchange('conversation', 'direct', { durable: true });

    // Declare queues
    await channel.assertQueue('audio.convert', { durable: true });
    await channel.assertQueue('audio.transcribe', { durable: true });
    await channel.assertQueue('conversation.analyze', { durable: true });

    // Bind queues to exchanges
    await channel.bindQueue('audio.convert', 'audio', 'audio.convert');
    await channel.bindQueue('audio.transcribe', 'audio', 'audio.transcribe');
    await channel.bindQueue('conversation.analyze', 'conversation', 'conversation.analyze');

    rabbitmq.connection = connection;
    rabbitmq.channel = channel;

    fastify.addHook('onClose', async () => {
      await channel.close();
      await connection.close();
    });

    fastify.log.info('RabbitMQ plugin registered successfully');
  } catch (error) {
    fastify.log.error('Error registering RabbitMQ plugin:', error);
    throw error;
  }
};

export default rabbitmqPlugin; 