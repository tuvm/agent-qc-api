import { connect } from 'amqplib';
import { MinioClient } from '../../utils/minioClient';
import { transcribeAudioWithAzure } from '../../utils/audioTranscriber';

const QUEUE_NAME = 'audio.transcribe';
const EXCHANGE_NAME = 'audio';
const ROUTING_KEY = 'audio.transcribed';

async function startWorker() {
  try {
    const connection = await connect({
      hostname: process.env.RABBITMQ_HOST,
      port: parseInt(process.env.RABBITMQ_PORT || '5672'),
      username: process.env.RABBITMQ_USER,
      password: process.env.RABBITMQ_PASSWORD,
    });

    const channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, QUEUE_NAME);

    console.log('Audio Transcriber Worker started. Waiting for messages...');

    channel.consume(QUEUE_NAME, async (msg) => {
      if (msg) {
        try {
          const { conversationId, audioFile } = JSON.parse(msg.content.toString());
          console.log(`Processing audio transcription for conversation: ${conversationId}`);

          // Download audio file from Minio
          const minioClient = new MinioClient();
          const audioBuffer = await minioClient.getObject(
            process.env.MINIO_BUCKET_PROCESSED_AUDIO || '',
            audioFile
          );

          // Transcribe audio
          const transcription = await transcribeAudioWithAzure(audioBuffer);

          // Publish message for next step
          await channel.publish(
            EXCHANGE_NAME,
            ROUTING_KEY,
            Buffer.from(JSON.stringify({
              conversationId,
              transcription
            }))
          );

          console.log(`Audio transcription completed for conversation: ${conversationId}`);
          channel.ack(msg);
        } catch (error) {
          console.error('Error processing audio transcription:', error);
          channel.nack(msg);
        }
      }
    });
  } catch (error) {
    console.error('Error starting audio transcriber worker:', error);
    process.exit(1);
  }
}

startWorker(); 