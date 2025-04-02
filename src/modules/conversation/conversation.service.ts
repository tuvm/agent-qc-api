import { FastifyInstance } from 'fastify';
import { CreateConversationInput, UpdateConversationInput, AudioFile } from './conversation.schema';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

export default class ConversationService {
  private readonly uploadDir: string;

  constructor(private readonly server: FastifyInstance) {
    this.uploadDir = join(process.cwd(), 'uploads', 'audio');
  }

  private async saveAudioFile(file: AudioFile): Promise<string> {
    const fileExtension = file.filename.split('.').pop();
    const fileName = `${uuidv4()}.${fileExtension}`;
    const filePath = join(this.uploadDir, fileName);

    await writeFile(filePath, file.data);
    return `/uploads/audio/${fileName}`;
  }

  async createConversation(input: CreateConversationInput) {
    let audioUrl: string | undefined;

    if (input.audioFile) {
      audioUrl = await this.saveAudioFile(input.audioFile);
    }

    // TODO: Implement database integration
    return {
      id: '1',
      title: input.title,
      description: input.description,
      status: input.status,
      audioUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getConversation(id: string) {
    // TODO: Implement database integration
    return {
      id,
      title: 'Sample Conversation',
      description: 'Sample Description',
      status: 'active',
      audioUrl: '/uploads/audio/sample.mp3',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async updateConversation(id: string, input: UpdateConversationInput) {
    let audioUrl: string | undefined;

    if (input.audioFile) {
      audioUrl = await this.saveAudioFile(input.audioFile);
    }

    // TODO: Implement database integration
    return {
      id,
      title: input.title || 'Sample Conversation',
      description: input.description,
      status: input.status || 'active',
      audioUrl,
      updatedAt: new Date(),
    };
  }

  async deleteConversation(id: string) {
    console.log('Deleting conversation', id);
    // TODO: Implement database integration and file deletion
    return true;
  }

  async listConversations() {
    // TODO: Implement database integration
    return [
      {
        id: '1',
        title: 'Sample Conversation',
        description: 'Sample Description',
        status: 'active',
        audioUrl: '/uploads/audio/sample.mp3',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
  }
} 