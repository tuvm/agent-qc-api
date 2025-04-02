import { FastifyInstance } from 'fastify';
import ConversationController from './conversation.controller';
import { $ref } from './conversation.schema';
import ConversationService from './conversation.service';

export default async (fastify: FastifyInstance) => {

  const conversationController = new ConversationController(
    new ConversationService(fastify),
  );

  fastify.post(
    '/conversations',
    // {
    //   schema: {
    //     tags: ['Conversations'],
    //     consumes: ['multipart/form-data'],
    //     body: {
    //       type: 'object',
    //       properties: {
    //         // title: { type: 'string' },
    //         // description: { type: 'string' },
    //         // status: { type: 'string', enum: ['active', 'archived', 'deleted'] },
    //         audioFile: { type: 'string', format: 'binary' },
    //       },
    //       // required: ['title'],
    //     },
    //     response: {
    //       201: $ref('createConversationResponseSchema'),
    //     },
    //   },
    // },
    conversationController.createConversationHandler.bind(conversationController),
  );

  fastify.get(
    '/conversations',
    {
      schema: {
        tags: ['Conversations'],
        response: {
          200: $ref('listConversationsResponseSchema'),
        },
      },
    },
    conversationController.listConversationsHandler.bind(conversationController),
  );

  fastify.get(
    '/conversations/:id',
    {
      schema: {
        tags: ['Conversations'],
        params: $ref('getConversationSchema'),
        response: {
          200: $ref('getConversationResponseSchema'),
        },
      },
    },
    conversationController.getConversationHandler.bind(conversationController),
  );

  fastify.put(
    '/conversations/:id',
    {
      schema: {
        tags: ['Conversations'],
        consumes: ['multipart/form-data'],
        params: $ref('getConversationSchema'),
        body: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['active', 'archived', 'deleted'] },
            audioFile: { type: 'string', format: 'binary' },
          },
        },
        response: {
          200: $ref('updateConversationResponseSchema'),
        },
      },
    },
    conversationController.updateConversationHandler.bind(conversationController),
  );

  fastify.delete(
    '/conversations/:id',
    {
      schema: {
        tags: ['Conversations'],
        params: $ref('getConversationSchema'),
        response: {
          204: $ref('deleteConversationResponseSchema'),
        },
      },
    },
    conversationController.deleteConversationHandler.bind(conversationController),
  );
}; 