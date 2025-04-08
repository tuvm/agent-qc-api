import path from "path";
import fs from "fs";
// import { promisify } from "util";
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { Readable } from 'stream';

const audioOutDir = path.join(__dirname, '../process/audio');
if (!fs.existsSync(audioOutDir)) {
  fs.mkdirSync(audioOutDir, { recursive: true });
}

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export function convertToWav(inputBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const inputStream = Readable.from(inputBuffer);
        
        const stream = ffmpeg()
            .input(inputStream)
            .toFormat('wav')
            .on('end', () => {
                const outputBuffer = Buffer.concat(chunks);
                resolve(outputBuffer);
            })
            .on('error', (err: Error) => {
                console.error('Error:', err);
                reject(err);
            })
            .pipe();

        stream.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });
    });
}

// Ví dụ sử dụng
// const inputFilePath = path.resolve(__dirname, 'input.mp3'); // Thay bằng file của bạn
// const outputFilePath = path.resolve(__dirname, 'output.wav');

// convertToWav(inputFilePath, outputFilePath)
//     .then(() => console.log('Done!'))
//     .catch((err) => console.error('Conversion failed:', err));

export const generateRandomFilename = (extension: string): string => {
  return path.join(audioOutDir, `${uuidv4()}.${extension}`);
};
