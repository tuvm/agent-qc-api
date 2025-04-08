import { FastifyInstance } from 'fastify';
import { CreateConversationInput, UpdateConversationInput, AudioFile, UploadTask, TaskStatus } from './conversation.schema';
import { writeFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import OpenAI from 'openai';
import { convertToWav } from '../../utils/audioConverter';
import { AudioConfig, ConversationTranscriber, PropertyId, ResultReason, SpeechConfig } from 'microsoft-cognitiveservices-speech-sdk';
import { openPushStream } from '../../utils/filePushStream';
import { processSpeakerSegments, Segment } from '../../utils/conversationProcess';
import { promptLLM } from '../../utils/openAIHelper';
import { jsonExtract } from '../../utils/jsonExtract';
import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import { minioClient } from '../../plugins/minio';
import { rabbitmq } from '../../plugins/rabbitmq';

export default class ConversationService {
  private readonly uploadDir: string;
  private readonly processDir: string;
  private openai: OpenAI;
  private prisma: PrismaClient;

  constructor(private readonly server: FastifyInstance) {
    this.uploadDir = join(process.cwd(), 'uploads', 'audio');
    this.processDir = join(process.cwd(), 'process', 'audio');
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.prisma = new PrismaClient();
  }

  private async saveAudioFile(file: AudioFile): Promise<string> {
    // const filename = `${uuidv4()}-${file.filename}`;
    const filepath = join(this.uploadDir, file.filename);
    await writeFile(filepath, file.data);
    return filepath;
  }

  private async convertToWav(filepath: string, filename: string): Promise<string> {
    // const outputFile = generateRandomFilename('wav');
    const newFilename = `${filename.split('.')[0]}.wav`;
    const outputPath = join(this.processDir, newFilename);
    const outputFile = await convertToWav(filepath, outputPath);
    console.log('🚀 ~ ConversationService ~ convertToWav ~ outputFile:', outputFile)
    return outputPath;
  }

  private async transcribeAudioWithAzure(filepath: string): Promise<string> {
    const speechConfig = SpeechConfig.fromSubscription(process.env.AZURE_SPEECH_KEY || '', process.env.AZURE_SERVICE_REGION || '');
    speechConfig.speechRecognitionLanguage = "vi-VN";
    const audioStream = openPushStream(filepath);
    const audioConfig = AudioConfig.fromStreamInput(audioStream);
    const conversationTranscriber = new ConversationTranscriber(
      speechConfig, 
      audioConfig
    );
    let transcribingStop = false;
    let startTime = Date.now();
    const segments: Segment[] = [];
    const startRecognitionTime = Date.now();
    conversationTranscriber.transcribed = (s, e) => {
      if (e.result.reason === ResultReason.RecognizedSpeech) {
        const text = e.result.text;
        const speakerId = e.result.speakerId || 'Unknown Speaker';
        
        // Try to get the detected language
        const detectedLanguage = e.result.properties.getProperty(
          PropertyId.SpeechServiceConnection_AutoDetectSourceLanguages, 
          'Unknown'
        );
        
        // Attempt to get timestamp information
        let relativeTimestamp = 0;
        let timestampDuration = 0;
        
        try {
          const resultJson = JSON.parse(e.result.properties.getProperty(PropertyId.SpeechServiceResponse_JsonResult, '{}'));
          const offset = resultJson.Offset || 0; // Get the offset in nanoseconds
          const duration = resultJson.Duration || 0; // Get the duration in nanoseconds
          
          // Convert nanoseconds to seconds
          relativeTimestamp = offset / 10_000_000; // Convert to seconds
          timestampDuration = duration / 10_000_000; // Convert to seconds
          
          // Calculate relative timestamp from start of recognition
          relativeTimestamp = relativeTimestamp - (startRecognitionTime / 1000);
        } catch (error) {
          console.log(`Could not extract precise timestamp: ${error}`);
          relativeTimestamp = (Date.now() - startRecognitionTime) / 1000;
        }
        
        // Create a segment with enhanced speaker info, language, and timing
        const segment: Segment = {
          speaker: `Speaker ${speakerId}`,
          text: text,
          language: detectedLanguage,
          timestamp: {
            start: Math.round(relativeTimestamp * 100) / 100,
            duration: Math.round(timestampDuration * 100) / 100
          }
        };
        
        console.log(`Transcribed: Speaker ${speakerId}: ${text} (Language: ${detectedLanguage}, Timestamp: ${JSON.stringify(segment.timestamp)})`);
        segments.push(segment);
      } else if (e.result.reason === ResultReason.NoMatch) {
        console.log(`NOMATCH: Speech could not be transcribed: ${e.result.noMatchDetails}`);
      }
    }
    conversationTranscriber.transcribing = (s, e) => {
      // console.log(`Transcribing: ${e.result.text} (Speaker: ${e.result.speakerId})`);
    };

    // Callback for session started
    conversationTranscriber.sessionStarted = (s, e) => {
      console.log('Conversation transcription session started');
    };

    // Callback for session stopped
    conversationTranscriber.sessionStopped = (s, e) => {
      console.log('Conversation transcription session stopped');
      transcribingStop = true;
    };

    // Callback for cancellation
    conversationTranscriber.canceled = (s, e) => {
      console.log(`Conversation transcription canceled: ${e}`);
      transcribingStop = true;
    };
    await conversationTranscriber.startTranscribingAsync();
    // Wait for completion
    while (!transcribingStop) {
      await new Promise(resolve => setTimeout(resolve, 500));
      // Add a timeout mechanism (e.g., 120 seconds)
      if (Date.now() - startTime > 120000) { // 2 minutes timeout
        console.log('Transcription timeout reached');
        transcribingStop = true;
      }
    }

    // Stop transcribing
    await conversationTranscriber.stopTranscribingAsync();

    // Process and merge speech segments
    const processedSegments = processSpeakerSegments(segments);
    
    // Process the segments to create a transcript with consistent speaker labeling
    const transcriptLines: string[] = [];
    let segmentIndex = 1;
    let totalElapsedTime = 0.0;
    
    for (const segment of processedSegments) {
      const text = segment.text;
      const speaker = segment.speaker || 'Unknown Speaker';
      const language = segment.language || 'Unknown';
      const timestamp = segment.timestamp || {};
      
      // Use actual segment duration or default to text length estimation
      const segmentDuration = timestamp.duration || text.length * 0.5; // Fallback estimation
      
      // Convert seconds to SRT timestamp format (HH:MM:SS,mmm)
      const secondsToSrtTime = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const millisecs = Math.floor((seconds % 1) * 1000);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millisecs.toString().padStart(3, '0')}`;
      };
      
      // Calculate start and end times
      const startTime = totalElapsedTime;
      const endTime = startTime + segmentDuration;
      
      // Convert to SRT timestamp
      const startSrt = secondsToSrtTime(startTime);
      const endSrt = secondsToSrtTime(endTime);
      
      // Create transcript line
      transcriptLines.push(segmentIndex.toString());
      transcriptLines.push(`${startSrt} --> ${endSrt}`);
      transcriptLines.push(`${speaker} [${language}]: ${text}`);
      transcriptLines.push(''); // Blank line between segments
      
      // Update tracking variables
      segmentIndex++;
      totalElapsedTime = endTime;
    }
    
    // Join all lines into a full transcript
    let transcript = transcriptLines.join('\n').trim();
    
    // Post-process step: Handle empty transcript
    if (!transcript) {
      transcript = '1\n00:00:00,000 --> 00:00:01,000\nNo speech detected. / Không nhận diện được giọng nói.';
    } else if (!transcript.includes('Speaker')) {
      transcript = '1\n00:00:00,000 --> 00:00:01,000\nSpeaker 01 [Unknown]: ' + transcript;
    }
    
    console.log(`Full transcript: ${transcript}`);
    return transcript;
  }

  // private async transcribeAudio(file: AudioFile): Promise<string> {
  //   try {
  //     const transcriptionResponse = await this.openai.audio.transcriptions.create({
  //       file: file,
  //       model: "whisper-1",
  //     });
  //     return transcriptionResponse.text;
  //   } catch (error) {
  //     console.error('Error transcribing audio:', error);
  //     throw new Error('Failed to transcribe audio file');
  //   }
  // }

  async createConversation(input: CreateConversationInput) {
    let transcription = '';
    let audioUrl: string | undefined;
    let processAudio: string | undefined;
    let processedData: string | undefined = '';

    let uploadTask: UploadTask;
    const conversationId = uuidv4();
    
    if (input.audioFile) {
      const contentType = input.audioFile.mimetype;
      const fileName = conversationId + '_' + input.audioFile.filename;
      await minioClient.putObject(
        process.env.MINIO_BUCKET_RAW_AUDIO || '',
        fileName,
        input.audioFile.data,
        input.audioFile.data.length,
        { 'Content-Type': contentType }
      );
      uploadTask = {
        status: TaskStatus.SUCCESS,
        filename: fileName,
        mimetype: contentType,
      };
      
      // audioUrl = await this.saveAudioFile(input.audioFile);
      // processAudio = await this.convertToWav(audioUrl, input.audioFile.filename);
      // transcription = await this.transcribeAudioWithAzure(processAudio);
      // processedData = await promptLLM(transcription);
    } else {
      uploadTask = {
        status: TaskStatus.FAILED,
        reason: 'No audio file provided',
      };
    }

    const newConversation = {
      id: conversationId,
      title: input.title,
      description: input.description,
      uploadTask: uploadTask,
      convertTask: {},
      transcribeTask: {},
      analyzeTask: {},
    }
    // const jsonData = jsonExtract(processedData);
    await rabbitmq.channel?.sendToQueue('audio.convert', Buffer.from(JSON.stringify(newConversation)));

    // Save to database
    const conversation = await this.prisma.conversation.create({
      data: newConversation,
    });

    return conversation;
  }

  async getConversation(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });
    return conversation;
  }

  async updateConversation(id: string, input: UpdateConversationInput) {
    let transcription = '';
    let audioUrl: string | undefined;
    let processAudio: string | undefined;

    if (input.audioFile) {
      audioUrl = await this.saveAudioFile(input.audioFile);
      processAudio = await this.convertToWav(audioUrl, input.audioFile.filename);
      transcription = await this.transcribeAudioWithAzure(processAudio);
      const processedData = await promptLLM(transcription);
      const jsonData = jsonExtract(processedData);

      return await this.prisma.conversation.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description,
          // status: input.status,
          audioUrl,
          transcription,
          processedData,
          jsonData,
        },
      });
    }

    return await this.prisma.conversation.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        // status: input.status,
      },
    });
  }

  async deleteConversation(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });

    if (conversation?.audioUrl) {
      try {
        await fs.unlink(conversation.audioUrl);
      } catch (error) {
        console.error('Error deleting audio file:', error);
      }
    }

    await this.prisma.conversation.delete({
      where: { id },
    });

    return true;
  }

  async listConversations() {
    return await this.prisma.conversation.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
} 