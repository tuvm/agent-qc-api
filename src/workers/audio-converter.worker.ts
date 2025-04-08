import { connect } from 'amqplib';
import { minioClient } from '../plugins/minio';
import { convertToWav } from '../utils/audioConverter';
import { ConvertTask } from '../modules/conversation/conversation.schema';
import { PrismaClient } from '@prisma/client';

const QUEUE_NAME = 'audio.convert';
const EXCHANGE_NAME = 'audio';

const prisma = new PrismaClient();

async function startWorker() {
  try {
    const connection = await connect({
      hostname: process.env.RABBITMQ_HOST,
      port: parseInt(process.env.RABBITMQ_PORT || '5672'),
      username: process.env.RABBITMQ_USER,
      password: process.env.RABBITMQ_PASSWORD,
    });

    const channel = await connection.createChannel();
    await channel.assertQueue('audio.convert', { durable: true });
    await channel.assertQueue('audio.transcribe', { durable: true });

    await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
    await channel.bindQueue('audio.convert', EXCHANGE_NAME, QUEUE_NAME);
    await channel.bindQueue('audio.transcribe', EXCHANGE_NAME, 'audio.transcribe');
    console.log('Audio Converter Worker started. Waiting for messages...');

    channel.consume('audio.convert', async (msg) => {
      if (msg) {
        let conversationId: string = '';
        try {
          const { id, uploadTask } = JSON.parse(msg.content.toString());
          conversationId = id;
          console.log(`Processing audio conversion for conversation: ${id}`);

          // Download audio file from Minio
          const audioBuffer = await minioClient.getObject(
            process.env.MINIO_BUCKET_RAW_AUDIO || '',
            uploadTask.filename
          );
          // Convert to WAV
          const wavBuffer = await convertToWav(await audioBuffer.read());

          // Upload converted file to Minio
          const wavFileName = `${id}_converted.wav`;
          await minioClient.putObject(
            process.env.MINIO_BUCKET_PROCESSED_AUDIO || '',
            wavFileName,
            wavBuffer
          );

          const convertTask: ConvertTask = {
            status: 'SUCCESS',
            filename: wavFileName,
            mimetype: 'audio/wav',
          };

          // Update conversation in database
          await prisma.conversation.update({
            where: { id },
            data: {
              convertTask: convertTask
            }
          });

          // Publish message for next step
          await channel.sendToQueue(
            'audio.transcribe',
            Buffer.from(JSON.stringify({
              id,
              wavFileName
            }))
          );

          console.log(`Audio conversion completed for conversation: ${id}`);
        } catch (error) {
          console.error('Error processing audio conversion:', error);
          if (conversationId) {
            await prisma.conversation.update({
              where: { id: conversationId },
              data: {
                convertTask: { status: 'FAILED', reason: (error as Error).message }
              }
            });
          }
        }
      } else {
        console.log('No message received');
      }
    }, { noAck: true });
  } catch (error) {
    console.error('Error starting audio converter worker:', error);
    process.exit(1);
  }
}

startWorker(); 