import { z } from 'zod';
import { buildJsonSchemas } from 'fastify-zod';

export enum TaskStatus {
  SUCCESS = 'SUCCESS',
  WAITING = 'WAITING',
  FAILED = 'FAILED',
  PROCESSING = 'PROCESSING',
};

const TaskStatusSchema = z.enum(['SUCCESS', 'WAITING', 'FAILED', 'PROCESSING']).default('WAITING').optional();

const uploadTaskSchema = {
  status: TaskStatusSchema,
  filename: z.string().optional(),
  reason: z.string().optional(),
  mimetype: z.string().refine((val) => val.startsWith('audio/'), {
    message: 'File must be an audio file',
  }).optional(),
};

const convertTaskSchema = {
  status: TaskStatusSchema,
  filename: z.string().optional(),
  reason: z.string().optional(),
  mimetype: z.string().refine((val) => val.startsWith('audio/wav'), {
    message: 'File must be an wav file',
  }).optional(),
};

const transcribeTaskSchema = {
  status: TaskStatusSchema,
  transcription: z.string().optional(),
  language: z.string().optional(),
  reason: z.string().optional(),
};

const analyzeTaskSchema = {
  status: TaskStatusSchema,
  processedData: z.string().optional(),
  jsonData: z.any().optional(),
  reason: z.string().optional(),
};

const conversationCore = {
  title: z.string({
    required_error: 'Title is required',
    invalid_type_error: 'Title must be a string',
  }).min(1),
  description: z.string().optional(),
  uploadTask: z.object(uploadTaskSchema).optional(),
  convertTask: z.object(convertTaskSchema).optional(),
  transcribeTask: z.object(transcribeTaskSchema).optional(),
  analyzeTask: z.object(analyzeTaskSchema).optional(),
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

export type UploadTask = z.infer<typeof conversationCore.uploadTask>;
export type ConvertTask = z.infer<typeof conversationCore.convertTask>;
export type TranscribeTask = z.infer<typeof conversationCore.transcribeTask>;
export type AnalyzeTask = z.infer<typeof conversationCore.analyzeTask>;
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