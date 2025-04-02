import { FastifyReply, FastifyRequest } from 'fastify';
import ConversationService from './conversation.service';
import {
  CreateConversationInput,
  GetConversationInput,
  UpdateConversationInput,
  AudioFile,
} from './conversation.schema';

export default class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
  ) {}

  async createConversationHandler(
    request: FastifyRequest<{
      Body: CreateConversationInput;
    }>,
    reply: FastifyReply,
  ) {
    const data = await request.file();
    let audioFile: AudioFile | undefined;

    if (data) {
      const buffer = await data.toBuffer();
      audioFile = {
        filename: data.filename,
        mimetype: data.mimetype,
        data: buffer,
      };
    }

    const conversation = await this.conversationService.createConversation({
      ...request.body,
      audioFile,
    });
    return reply.status(201).send(conversation);
  }

  async listConversationsHandler(request: FastifyRequest, reply: FastifyReply) {
    const conversations = await this.conversationService.listConversations();
    return reply.send(conversations);
  }

  async getConversationHandler(
    request: FastifyRequest<{
      Params: GetConversationInput;
    }>,
    reply: FastifyReply,
  ) {
    const conversation = await this.conversationService.getConversation(
      request.params.id,
    );
    return reply.send(conversation);
  }

  async updateConversationHandler(
    request: FastifyRequest<{ Params: GetConversationInput; Body: UpdateConversationInput }>,
    reply: FastifyReply,
  ) {
    const data = await request.file();
    let audioFile: AudioFile | undefined;

    if (data) {
      const buffer = await data.toBuffer();
      audioFile = {
        filename: data.filename,
        mimetype: data.mimetype,
        data: buffer,
      };
    }

    const conversation = await this.conversationService.updateConversation(
      request.params.id,
      {
        ...request.body,
        audioFile,
      },
    );
    return reply.send(conversation);
  }

  async deleteConversationHandler(
    request: FastifyRequest<{ Params: GetConversationInput }>,
    reply: FastifyReply,
  ) {
    await this.conversationService.deleteConversation(request.params.id);
    return reply.status(204).send();
  }
} 