import { FastifyInstance } from 'fastify';

import fastifyPlugin from 'fastify-plugin';
import config from './config';
import sensible from './sensible';
import prisma from './prisma';
import redis from './redis';
import swagger from './swagger';
import cookie from './cookie';
import cors from './cors';
import jwt from './jwt';
import multipart from '@fastify/multipart';
import minio from './minio';
import rabbitmq from './rabbitmq';

export default fastifyPlugin(async (fastify: FastifyInstance) => {
	await Promise.all([fastify.register(config), fastify.register(sensible)]);

	// Register RabbitMQ first as other plugins might depend on it
	await fastify.register(rabbitmq);

	await Promise.all([
		fastify.register(prisma),
		fastify.register(redis),
		fastify.register(minio),
		fastify.register(multipart, {
			limits: {
				fileSize: 100 * 1024 * 1024, // 100MB
			},
		}),
		fastify.register(cookie),
		fastify.register(cors),
		fastify.config.NODE_ENV === 'local'
			? /* istanbul ignore next */ fastify.register(swagger)
			: /* istanbul ignore next */ null,
	]);

	await Promise.all([fastify.register(jwt)]);
});
