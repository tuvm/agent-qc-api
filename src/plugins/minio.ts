import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { Client } from 'minio';

export let minioClient: Client;

export default fastifyPlugin(
	async (fastify: FastifyInstance) => {
    minioClient = new Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: process.env.MINIO_USE_SSL == 'true',
      accessKey: process.env.MINIO_ROOT_USER || '',
      secretKey: process.env.MINIO_ROOT_PASSWORD || '',
    });
		
    // Optional: kiểm tra bucket tồn tại
    const bucketRawAudio = process.env.MINIO_BUCKET_RAW_AUDIO || 'agent-qc-raw-audio';
    const bucketProcessedAudio = process.env.MINIO_BUCKET_PROCESSED_AUDIO || 'agent-qc-processed-audio';
    const existsRawAudio = await minioClient.bucketExists(bucketRawAudio);
    if (!existsRawAudio) await minioClient.makeBucket(bucketRawAudio);
    const existsProcessedAudio = await minioClient.bucketExists(bucketProcessedAudio);
    if (!existsProcessedAudio) await minioClient.makeBucket(bucketProcessedAudio);

    // Gắn vào fastify instance
    fastify.decorate('minio', minioClient);
	},
	{ name: 'minio', dependencies: ['config'] },
);
