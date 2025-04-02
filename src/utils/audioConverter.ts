import path from "path";
import fs from "fs";
// import { promisify } from "util";
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const audioOutDir = path.join(__dirname, '../process/audio');
if (!fs.existsSync(audioOutDir)) {
  fs.mkdirSync(audioOutDir, { recursive: true });
}

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export function convertToWav(inputFile: string, outputFile: string) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputFile)
            .toFormat('wav')
            .on('end', () => {
                console.log('Conversion finished:', outputFile);
                resolve(outputFile);
            })
            .on('error', (err: Error) => {
                console.error('Error:', err);
                reject(err);
            })
            .save(outputFile);
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
