import { connect } from 'amqplib';
import { OpenAI } from 'openai';
import { PrismaClient } from '@prisma/client';

const QUEUE_NAME = 'conversation.analyze';
const EXCHANGE_NAME = 'conversation';
const ROUTING_KEY = 'conversation.analyzed';

interface Message {
  conversationId: string;
  transcription: string;
}

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

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prisma = new PrismaClient();

    console.log('Conversation Analyzer Worker started. Waiting for messages...');

    channel.consume(QUEUE_NAME, async (msg) => {
      if (msg) {
        try {
          const { conversationId, transcription } = JSON.parse(msg.content.toString()) as Message;
          console.log(`Processing conversation analysis for conversation: ${conversationId}`);

          // Analyze transcription with OpenAI
          const analysis = await openai.chat.completions.create({
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant that analyzes customer service conversations.'
              },
              {
                role: 'user',
                content: `Please analyze this customer service conversation and extract key information:\n\n${transcription}`
              }
            ],
            model: 'gpt-4',
          });

          const analysisResult = analysis.choices[0].message.content;

          // Update conversation in database
          await prisma.conversation.update({
            where: { id: conversationId },
            data: {
              transcription,
              processedData: analysisResult,
              status: 'completed'
            }
          });

          console.log(`Conversation analysis completed for conversation: ${conversationId}`);
          channel.ack(msg);
        } catch (error) {
          console.error('Error processing conversation analysis:', error);
          channel.nack(msg);
        }
      }
    });
  } catch (error) {
    console.error('Error starting conversation analyzer worker:', error);
    process.exit(1);
  }
}

startWorker(); 