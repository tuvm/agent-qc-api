import os
import configparser
import requests
import telebot
import time
from pydub import AudioSegment
import azure.cognitiveservices.speech as speechsdk
from openai import OpenAI
import json
import logging
import random
import string

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Function to generate a random file name
def generate_random_filename(extension):
    return f"audio/{''.join(random.choices(string.ascii_lowercase + string.digits, k=10))}.{extension}"

# Read config.ini
config = configparser.ConfigParser()
config.read('config.ini')

# Information from config.ini
TELEGRAM_TOKEN = config['TELEGRAM']['TOKEN']
AZURE_SPEECH_KEY = config['AZURE']['SPEECH_KEY']
AZURE_SERVICE_REGION = config['AZURE']['SERVICE_REGION']
OPENAI_API_KEY = config['OPENAI']['API_KEY']

# Setup OpenAI API key
client = OpenAI(api_key=OPENAI_API_KEY)

# Initialize Telegram Bot
bot = telebot.TeleBot(TELEGRAM_TOKEN)

# Ensure the audio folder exists
if not os.path.exists('audio'):
    os.makedirs('audio')

# Locate the ffmpeg folder dynamically
ffmpeg_folder = config['paths']['ffmpeg_folder']
if os.path.exists(ffmpeg_folder):
    os.environ["PATH"] = ffmpeg_folder + ";" + os.environ["PATH"]
else:
    raise FileNotFoundError(f"ffmpeg folder not found at {ffmpeg_folder}")

def split_message(message, max_length=4096):
    """Split a message into chunks of a specified maximum length."""
    return [message[i:i + max_length] for i in range(0, len(message), max_length)]

def call_chatgpt(prompt):
    response = client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="gpt-4o",
    )
    return response.choices[0].message.content

def prompt_llm(transcript):
    prompt = f"""
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
        `["đặt phòng", "hủy phòng", "khiếu nại dịch vụ", "yêu cầu thông tin", "hỗ trợ kỹ thuật", v.v.]`.  

    - **Yêu cầu đầu ra:**  
    - Chỉ trả về dữ liệu dưới dạng JSON, không kèm bất kỳ thông tin nào khác.  
    - Dữ liệu JSON phải có cấu trúc như sau:

    Định dạng JSON kết quả mong muốn:
    {{
        "khách_hàng": {{
            "tên": "[Tên khách hàng]",
            "số_điện_thoại": "[Số điện thoại khách hàng]",
            "email": "[Email khách hàng]"
        }},
        "nhân_viên": {{
            "tên": "[Tên nhân viên tổng đài]"
        }},
        "vấn_đề": "[Vấn đề khách hàng gặp phải]",
        "giải_pháp": "[Giải pháp được đưa ra]",
        "chủ_đề": "[Chủ đề của cuộc trò chuyện]",
        "transcript": "[Đoạn hội thoại đã được sửa lỗi chính tả]" 
    }}

    Đoạn hội thoại: {transcript}

    """
    return call_chatgpt(prompt)

def prompt_correct(transcript):
    prompt = f"""
    "Sửa lỗi chính tả của đoạn hội thoại sau và giữ nguyên format.
    Đoạn hội thoại: {transcript}"
    """
    return call_chatgpt(prompt)

# Hàm chuyển đổi OGG/MP3 → WAV
def convert_to_wav(input_file):
    output_file = generate_random_filename("wav")
    logging.info(f"Converting {input_file} to {output_file}...")
    audio = AudioSegment.from_file(input_file)
    audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)  # Chuẩn PCM 16-bit
    audio.export(output_file, format="wav")
    return output_file

# Cải tiến xử lý phân tách giọng nói
def process_speaker_segments(segments, max_gap_seconds=2.0):
    """
    Xử lý và gộp các đoạn phát biểu của cùng một người nói 
    khi khoảng cách giữa chúng ngắn.
    """
    if not segments:
        return segments

    # Sắp xếp các đoạn theo thời gian bắt đầu
    sorted_segments = sorted(segments, key=lambda x: x.get('timestamp', {}).get('start', 0))
    processed_segments = [sorted_segments[0]]

    for current_segment in sorted_segments[1:]:
        previous_segment = processed_segments[-1]
        
        # Kiểm tra nếu cùng một người nói
        if (current_segment.get('speaker') == previous_segment.get('speaker') and 
            current_segment.get('timestamp', {}).get('start', 0) - 
            (previous_segment.get('timestamp', {}).get('start', 0) + 
             previous_segment.get('timestamp', {}).get('duration', 0)) <= max_gap_seconds):
            
            # Gộp văn bản và cập nhật thời gian
            previous_segment['text'] += ' ' + current_segment['text']
            previous_segment['timestamp']['duration'] = (
                current_segment.get('timestamp', {}).get('start', 0) - 
                previous_segment.get('timestamp', {}).get('start', 0)
            ) + current_segment.get('timestamp', {}).get('duration', 0)
        else:
            # Thêm đoạn mới nếu khác người hoặc khoảng cách lớn
            processed_segments.append(current_segment)

    return processed_segments

# Hàm tạo conversation transcriber với cấu hình nâng cao
def create_advanced_conversation_transcriber():
    # Cấu hình speech
    speech_config = speechsdk.SpeechConfig(
        subscription=AZURE_SPEECH_KEY, 
        region=AZURE_SERVICE_REGION
    )
    
    # Cấu hình nhận diện ngôn ngữ tự động
    auto_detect_source_language_config = speechsdk.languageconfig.AutoDetectSourceLanguageConfig(
        languages=["en-US", "vi-VN", "ko-KR", "zh-CN"]  # Mở rộng danh sách ngôn ngữ
    )
    
    # Thiết lập các thuộc tính để cải thiện nhận diện
    speech_config.set_property(
        speechsdk.PropertyId.SpeechServiceResponse_RequestWordLevelTimestamps, 
        'true'
    )
    speech_config.set_property(
        speechsdk.PropertyId.SpeechServiceResponse_DiarizeIntermediateResults, 
        'true'
    )

    return speech_config, auto_detect_source_language_config

# Xử lý voice hoặc audio file
@bot.message_handler(content_types=['voice', 'audio'])
def handle_audio(message):
    start_time = time.time()  # Start time for processing
    logging.info("Start processing audio...")

    # Xác định loại file: voice message (OGG) hoặc audio file (MP3, WAV,...)
    if message.content_type == 'voice':
        logging.info("Voice message received (OGG format)")
        file_info = bot.get_file(message.voice.file_id)
        file_extension = "ogg"
    else:
        logging.info("Audio file received")
        file_info = bot.get_file(message.audio.file_id)
        file_extension = file_info.file_path.split('.')[-1].lower()

    file_url = f'https://api.telegram.org/file/bot{TELEGRAM_TOKEN}/{file_info.file_path}'
    
    # Tải file từ Telegram
    file = requests.get(file_url)

    # Kiểm tra kích thước file (tối đa 10MB)
    if len(file.content) > 10 * 1024 * 1024:
        bot.reply_to(message, "File audio quá lớn. Vui lòng gửi file nhỏ hơn 10MB.")
        return
    
    # Lưu file với định dạng phù hợp
    audio_filename = f"audio/audio.{file_extension}"
    with open(audio_filename, 'wb') as f:
        f.write(file.content)

    # Nếu file là OGG hoặc MP3, chuyển sang WAV
    if file_extension in ["ogg", "mp3", "aac", "m4a", "wma", "flac", "alac", "aiff", "wav"]:
        audio_filename = convert_to_wav(audio_filename)

    # Kiểm tra file WAV có hợp lệ không
    if os.path.getsize(audio_filename) == 0:
        logging.info("File audio bị rỗng!")
        bot.reply_to(message, "Không thể xử lý file âm thanh, vui lòng thử lại.")
        return

    logging.info("Initializing Azure Speech to Text with ConversationTranscriber for English and Vietnamese...")

    # Configure speech recognition with diarization
    speech_config = speechsdk.SpeechConfig(subscription=AZURE_SPEECH_KEY, region=AZURE_SERVICE_REGION)
    
    # Enable language auto-detection between English and Vietnamese
    auto_detect_source_language_config = speechsdk.languageconfig.AutoDetectSourceLanguageConfig(
        languages=["en-US", "vi-VN"]
    )
    
    # Set diarization property
    speech_config.set_property(property_id=speechsdk.PropertyId.SpeechServiceResponse_DiarizeIntermediateResults, value='true')
    speech_config.set_property(property_id=speechsdk.PropertyId.SpeechServiceResponse_RequestWordLevelTimestamps, value='true')

    # Setup audio configuration
    audio_config = speechsdk.audio.AudioConfig(filename=audio_filename)
    
    # Create the conversation transcriber with language auto-detection
    conversation_transcriber = speechsdk.transcription.ConversationTranscriber(
        speech_config=speech_config, 
        audio_config=audio_config,
        auto_detect_source_language_config=auto_detect_source_language_config
    )

    # Variables to track recognition state and results
    transcribing_stop = False
    segments = []
    start_recognition_time = time.time()

    # Callback for transcribed speech
    def conversation_transcriber_transcribed_cb(evt):
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            text = evt.result.text
            speaker_id = evt.result.speaker_id if evt.result.speaker_id else "Unknown Speaker"
            
            # Try to get the detected language
            detected_language = evt.result.properties.get(
                speechsdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguageResult, 
                "Unknown"
            )
            
            # Attempt to get timestamp information
            try:
                result_json = json.loads(evt.result.properties.get(speechsdk.PropertyId.SpeechServiceResponse_JsonResult))
                offset = result_json.get('Offset', 0)  # Get the offset in nanoseconds
                duration = result_json.get('Duration', 0)  # Get the duration in nanoseconds
                
                # Convert nanoseconds to seconds
                timestamp_offset = offset / 10_000_000  # Convert to seconds
                timestamp_duration = duration / 10_000_000  # Convert to seconds
                
                # Calculate relative timestamp from start of recognition
                relative_timestamp = timestamp_offset - start_recognition_time
            except Exception as e:
                logging.info(f"Could not extract precise timestamp: {e}")
                relative_timestamp = time.time() - start_recognition_time
                timestamp_duration = 0
            
            # Create a segment with enhanced speaker info, language, and timing
            segment = {
                "speaker": f"Speaker {speaker_id}",
                "text": text,
                "language": detected_language,
                "timestamp": {
                    "start": round(relative_timestamp, 2),
                    "duration": round(timestamp_duration, 2)
                }
            }
            
            logging.info(f"Transcribed: Speaker {speaker_id}: {text} (Language: {detected_language}, Timestamp: {segment['timestamp']})")
            segments.append(segment)
        elif evt.result.reason == speechsdk.ResultReason.NoMatch:
            logging.info(f"NOMATCH: Speech could not be transcribed: {evt.result.no_match_details}")

    # Callback for transcribing (in-progress) speech
    def conversation_transcriber_transcribing_cb(evt):
        logging.info(f"Transcribing: {evt.result.text} (Speaker: {evt.result.speaker_id})")

    # Callback for session started
    def conversation_transcriber_session_started_cb(evt):
        logging.info("Conversation transcription session started")

    # Callback for session stopped
    def conversation_transcriber_session_stopped_cb(evt):
        logging.info("Conversation transcription session stopped")
        nonlocal transcribing_stop
        transcribing_stop = True

    # Callback for cancellation
    def conversation_transcriber_recognition_canceled_cb(evt):
        logging.info(f"Conversation transcription canceled: {evt}")
        nonlocal transcribing_stop
        transcribing_stop = True

    # Connect callbacks to the events fired by the conversation transcriber
    conversation_transcriber.transcribed.connect(conversation_transcriber_transcribed_cb)
    conversation_transcriber.transcribing.connect(conversation_transcriber_transcribing_cb)
    conversation_transcriber.session_started.connect(conversation_transcriber_session_started_cb)
    conversation_transcriber.session_stopped.connect(conversation_transcriber_session_stopped_cb)
    conversation_transcriber.canceled.connect(conversation_transcriber_recognition_canceled_cb)

    # Start transcribing
    conversation_transcriber.start_transcribing_async()

    # Wait for completion
    while not transcribing_stop:
        time.sleep(0.5)
        # Add a timeout mechanism (e.g., 60 seconds)
        if time.time() - start_time > 120:  # 2 minutes timeout
            logging.info("Transcription timeout reached")
            transcribing_stop = True

    # Stop transcribing
    conversation_transcriber.stop_transcribing_async()
    
    # Xử lý và gộp các đoạn phát biểu
    processed_segments = process_speaker_segments(segments)
    
    # Process the segments to create a transcript with consistent speaker labeling
    current_speaker = None
    current_text = []
    transcript_lines = []
    segment_index = 1
    total_elapsed_time = 0.0
    
    for segment in processed_segments:
        text = segment["text"]
        speaker = segment.get("speaker", "Unknown Speaker")
        language = segment.get("language", "Unknown")
        timestamp = segment.get("timestamp", {})
        
        # Use actual segment duration or default to text length estimation
        segment_duration = timestamp.get('duration', len(text) * 0.5)  # Fallback estimation
        
        # Convert seconds to SRT timestamp format (HH:MM:SS,mmm)
        def seconds_to_srt_time(seconds):
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            secs = int(seconds % 60)
            millisecs = int((seconds % 1) * 1000)
            return f"{hours:02d}:{minutes:02d}:{secs:02d},{millisecs:03d}"
        
        # Calculate start and end times
        start_time = total_elapsed_time
        end_time = start_time + segment_duration
        
        # Convert to SRT timestamp
        start_srt = seconds_to_srt_time(start_time)
        end_srt = seconds_to_srt_time(end_time)
        
        # Create transcript line
        transcript_lines.append(str(segment_index))
        transcript_lines.append(f"{start_srt} --> {end_srt}")
        transcript_lines.append(f"{speaker} [{language}]: {text}")
        transcript_lines.append("")  # Blank line between segments
        
        # Update tracking variables
        segment_index += 1
        total_elapsed_time = end_time
    
    # Join all lines into a full transcript
    transcript = "\n".join(transcript_lines).strip()
    
    # Post-process step: Handle empty transcript
    if not transcript:
        transcript = "1\n00:00:00,000 --> 00:00:01,000\nNo speech detected. / Không nhận diện được giọng nói."
    elif "Speaker" not in transcript:
        transcript = "1\n00:00:00,000 --> 00:00:01,000\nSpeaker 01 [Unknown]: " + transcript
    
    logging.info(f"Full transcript: {transcript}")
    
    if transcript:
        logging.info("Generating summary with OpenAI...")
        processing_data = prompt_llm(transcript)
        logging.info(processing_data)                              
        # Split the message into chunks and send each chunk separately
        messages = split_message(processing_data)
        for msg in messages:
            bot.reply_to(message, msg)
        logging.info("Summary has been sent to the user.")
    else:
        bot.reply_to(message, "Không nhận diện được giọng nói. Vui lòng thử lại.")

# Fix the logging format for the polling error
def log_error(e):
    logging.error(f"Polling error occurred: {str(e)}")

# Start polling
while True:
    try:
        logging.info("Starting bot polling...")
        bot.polling(non_stop=True)
    except Exception as e:
        log_error(e)
        logging.info("Waiting 10 seconds before reconnecting...")
        time.sleep(10)