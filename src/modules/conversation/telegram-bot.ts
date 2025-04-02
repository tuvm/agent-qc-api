import { Telegraf } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { SpeechConfig, AudioConfig, ConversationTranscriber, ResultReason, PropertyId } from 'microsoft-cognitiveservices-speech-sdk';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { exec } from 'child_process';

// Load environment variables
dotenv.config();

// Configuration
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY || '';
const AZURE_SERVICE_REGION = process.env.AZURE_SERVICE_REGION || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const FFMPEG_PATH = process.env.FFMPEG_PATH || '';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Initialize Telegram Bot
const bot = new Telegraf(TELEGRAM_TOKEN);

// Ensure audio directory exists
const audioDir = path.join(__dirname, '../../../../audio');
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

// Define types
interface Segment {
  speaker: string;
  text: string;
  language: string;
  timestamp: {
    start: number;
    duration: number;
  };
}

// Utility functions
const generateRandomFilename = (extension: string): string => {
  return path.join(audioDir, `${uuidv4()}.${extension}`);
};

const splitMessage = (message: string, maxLength = 4096): string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < message.length; i += maxLength) {
    chunks.push(message.slice(i, i + maxLength));
  }
  return chunks;
};

const callChatGPT = async (prompt: string): Promise<string> => {
  const response = await openai.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'gpt-4',
  });
  return response.choices[0].message.content || '';
};

const promptLLM = async (transcript: string): Promise<string> => {
  const prompt = `
    Bước 1: Sửa lỗi chính tả của đoạn hội thoại sau và giữ nguyên format thời gian.
    Bước 2: Phân tích đoạn hội thoại chăm sóc khách hàng sau đây và trích xuất thông tin theo định dạng JSON.
    ### **Yêu cầu xử lý:**
    - **Xác định & trích xuất thông tin theo các tiêu chí sau:**
    1. **Thông tin khách hàng**:  
        - Tên khách hàng (nếu có, không lấy đại từ xưng hô như Chị, Anh, Ông, Bà).  
        - Số điện thoại khách hàng (nếu có).  
        - Email khách hàng (nếu có).  
    2. **Thông tin nhân viên tổng đài**:  
        - Tên nhân viên hỗ trợ.  
    3. **Vấn đề khách hàng gặp phải**:  
        - Mô tả ngắn gọn vấn đề chính khách hàng phản ánh hoặc thắc mắc.  
    4. **Giải pháp được đưa ra**:  
        - Mô tả cách nhân viên chăm sóc khách hàng giải quyết vấn đề.  
    5. **Chủ đề cuộc trò chuyện**:  
        - Phân loại cuộc trò chuyện vào một trong các chủ đề như:  
        \`["đặt phòng", "hủy phòng", "khiếu nại dịch vụ", "yêu cầu thông tin", "hỗ trợ kỹ thuật", v.v.]\`.  

    - **Yêu cầu đầu ra:**  
    - Chỉ trả về dữ liệu dưới dạng JSON, không kèm bất kỳ thông tin nào khác.  
    - Dữ liệu JSON phải có cấu trúc như sau:

    Định dạng JSON kết quả mong muốn:
    {
        "khách_hàng": {
            "tên": "[Tên khách hàng]",
            "số_điện_thoại": "[Số điện thoại khách hàng]",
            "email": "[Email khách hàng]"
        },
        "nhân_viên": {
            "tên": "[Tên nhân viên tổng đài]"
        },
        "vấn_đề": "[Vấn đề khách hàng gặp phải]",
        "giải_pháp": "[Giải pháp được đưa ra]",
        "chủ_đề": "[Chủ đề của cuộc trò chuyện]",
        "transcript": "[Đoạn hội thoại đã được sửa lỗi chính tả]" 
    }

    Đoạn hội thoại: ${transcript}
  `;
  return callChatGPT(prompt);
};

const promptCorrect = async (transcript: string): Promise<string> => {
  const prompt = `
    "Sửa lỗi chính tả của đoạn hội thoại sau và giữ nguyên format.
    Đoạn hội thoại: ${transcript}"
  `;
  return callChatGPT(prompt);
};

// Convert audio to WAV format
const convertToWav = async (inputFile: string): Promise<string> => {
  const outputFile = generateRandomFilename('wav');
  console.log(`Converting ${inputFile} to ${outputFile}...`);
  
  const execPromise = promisify(exec);
  await execPromise(`${FFMPEG_PATH} -i ${inputFile} -ar 16000 -ac 1 -acodec pcm_s16le ${outputFile}`);
  
  return outputFile;
};

// Process speaker segments
const processSpeakerSegments = (segments: Segment[], maxGapSeconds = 2.0): Segment[] => {
  if (!segments || segments.length === 0) {
    return segments;
  }

  // Sort segments by start time
  const sortedSegments = [...segments].sort((a, b) => 
    (a.timestamp?.start || 0) - (b.timestamp?.start || 0)
  );
  
  const processedSegments = [sortedSegments[0]];

  for (let i = 1; i < sortedSegments.length; i++) {
    const currentSegment = sortedSegments[i];
    const previousSegment = processedSegments[processedSegments.length - 1];
    
    // Check if same speaker and gap is small
    if (
      currentSegment.speaker === previousSegment.speaker && 
      (currentSegment.timestamp?.start || 0) - 
      ((previousSegment.timestamp?.start || 0) + 
       (previousSegment.timestamp?.duration || 0)) <= maxGapSeconds
    ) {
      // Merge text and update timestamp
      previousSegment.text += ' ' + currentSegment.text;
      previousSegment.timestamp.duration = 
        (currentSegment.timestamp?.start || 0) - 
        (previousSegment.timestamp?.start || 0) + 
        (currentSegment.timestamp?.duration || 0);
    } else {
      // Add new segment if different speaker or large gap
      processedSegments.push(currentSegment);
    }
  }

  return processedSegments;
};

// Create advanced conversation transcriber
const createAdvancedConversationTranscriber = () => {
  // Configure speech
  const speechConfig = SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SERVICE_REGION);
  
  // Configure auto language detection
  const autoDetectSourceLanguageConfig = {
    languages: ['en-US', 'vi-VN', 'ko-KR', 'zh-CN']
  };
  
  // Set properties to improve recognition
  speechConfig.setProperty(
    PropertyId.SpeechServiceResponse_RequestWordLevelTimestamps, 
    'true'
  );
  speechConfig.setProperty(
    PropertyId.SpeechServiceResponse_DiarizeIntermediateResults, 
    'true'
  );

  return { speechConfig, autoDetectSourceLanguageConfig };
};

// Handle audio messages
bot.on(['voice', 'audio'], async (ctx) => {
  const startTime = Date.now();
  console.log('Start processing audio...');

  try {
    // Determine file type and get file info
    let fileInfo;
    let fileExtension;
    
    if (ctx.message.voice) {
      console.log('Voice message received (OGG format)');
      fileInfo = await ctx.telegram.getFile(ctx.message.voice.file_id);
      fileExtension = 'ogg';
    } else if (ctx.message.audio) {
      console.log('Audio file received');
      fileInfo = await ctx.telegram.getFile(ctx.message.audio.file_id);
      fileExtension = ctx.message.audio.mime_type?.split('/')[1] || 'mp3';
    } else {
      await ctx.reply('Unsupported audio format');
      return;
    }

    // Download file from Telegram
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    const audioFilename = generateRandomFilename(fileExtension);
    
    // Download file
    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(audioFilename);
      https.get(fileUrl, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(audioFilename, () => {});
        reject(err);
      });
    });

    // Check file size (max 10MB)
    const stats = fs.statSync(audioFilename);
    if (stats.size > 10 * 1024 * 1024) {
      await ctx.reply('File audio quá lớn. Vui lòng gửi file nhỏ hơn 10MB.');
      fs.unlinkSync(audioFilename);
      return;
    }

    // Convert to WAV if needed
    let wavFilename = audioFilename;
    if (['ogg', 'mp3', 'aac', 'm4a', 'wma', 'flac', 'alac', 'aiff'].includes(fileExtension)) {
      wavFilename = await convertToWav(audioFilename);
      // Clean up original file
      fs.unlinkSync(audioFilename);
    }

    // Check if WAV file is valid
    if (fs.statSync(wavFilename).size === 0) {
      console.log('File audio bị rỗng!');
      await ctx.reply('Không thể xử lý file âm thanh, vui lòng thử lại.');
      fs.unlinkSync(wavFilename);
      return;
    }

    console.log('Initializing Azure Speech to Text with ConversationTranscriber...');

    // Configure speech recognition with diarization
    const { speechConfig, autoDetectSourceLanguageConfig } = createAdvancedConversationTranscriber();
    
    // Setup audio configuration
    const audioConfig = AudioConfig.fromWavFileInput(wavFilename);
    
    // Create the conversation transcriber
    const conversationTranscriber = new ConversationTranscriber(
      speechConfig, 
      audioConfig
    );

    // Variables to track recognition state and results
    let transcribingStop = false;
    const segments: Segment[] = [];
    const startRecognitionTime = Date.now();

    // Callback for transcribed speech
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
    };

    // Callback for transcribing (in-progress) speech
    conversationTranscriber.transcribing = (s, e) => {
      console.log(`Transcribing: ${e.result.text} (Speaker: ${e.result.speakerId})`);
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

    // Start transcribing
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
    
    // Clean up WAV file
    fs.unlinkSync(wavFilename);
    
    if (transcript) {
      console.log('Generating summary with OpenAI...');
      const processingData = await promptLLM(transcript);
      console.log(processingData);
      
      // Split the message into chunks and send each chunk separately
      const messages = splitMessage(processingData);
      for (const msg of messages) {
        await ctx.reply(msg);
      }
      console.log('Summary has been sent to the user.');
    } else {
      await ctx.reply('Không nhận diện được giọng nói. Vui lòng thử lại.');
    }
  } catch (error) {
    console.error('Error processing audio:', error);
    await ctx.reply('Đã xảy ra lỗi khi xử lý âm thanh. Vui lòng thử lại sau.');
  }
});

// Start the bot
const startBot = () => {
  console.log('Starting Telegram bot...');
  bot.launch()
    .then(() => {
      console.log('Telegram bot started successfully');
    })
    .catch((error) => {
      console.error('Error starting Telegram bot:', error);
      // Retry after 10 seconds
      setTimeout(startBot, 10000);
    });
  
  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
};

export { startBot }; 