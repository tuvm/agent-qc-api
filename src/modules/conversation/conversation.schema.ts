import { z } from 'zod';
import { buildJsonSchemas } from 'fastify-zod';

const conversationCore = {
  title: z.string({
    required_error: 'Title is required',
    invalid_type_error: 'Title must be a string',
  }).min(1),
  description: z.string().optional(),
  status: z.enum(['active', 'archived', 'deleted']).default('active'),
};

const audioFileSchema = z.object({
  filename: z.string(),
  mimetype: z.string().refine((val) => val.startsWith('audio/'), {
    message: 'File must be an audio file',
  }),
  data: z.instanceof(Buffer),
});

const createConversationSchema = z.object({
  ...conversationCore,
  audioFile: audioFileSchema.optional(),
});

const createConversationResponseSchema = z.object({
  ...conversationCore,
  id: z.string(),
  audioUrl: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const getConversationSchema = z.object({
  id: z.string({
    required_error: 'Conversation ID is required',
    invalid_type_error: 'Conversation ID must be a string',
  }),
});

const getConversationResponseSchema = z.object({
  ...conversationCore,
  id: z.string(),
  audioUrl: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived', 'deleted']).optional(),
  audioFile: audioFileSchema.optional(),
});

const updateConversationResponseSchema = z.object({
  ...conversationCore,
  id: z.string(),
  audioUrl: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const deleteConversationResponseSchema = z.object({});

const listConversationsResponseSchema = z.array(
  z.object({
    ...conversationCore,
    id: z.string(),
    audioUrl: z.string().optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
);

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type GetConversationInput = z.infer<typeof getConversationSchema>;
export type AudioFile = z.infer<typeof audioFileSchema>;

export const { schemas: conversationSchemas, $ref } = buildJsonSchemas(
  {
    createConversationSchema,
    createConversationResponseSchema,
    getConversationSchema,
    getConversationResponseSchema,
    updateConversationSchema,
    updateConversationResponseSchema,
    deleteConversationResponseSchema,
    listConversationsResponseSchema,
  },
  {
    $id: 'conversationSchema',
  },
); 