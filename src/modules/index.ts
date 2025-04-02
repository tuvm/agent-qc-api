import { FastifyInstance, FastifyPluginOptions } from 'fastify';

import fastifyPlugin from 'fastify-plugin';
import auth from './auth';
import conversation from './conversation';

const getOptionsWithPrefix = (options: FastifyPluginOptions, prefix: string) => {
	return {
		...options,
		prefix: options.prefix + prefix,
	};
};

export default fastifyPlugin(async (fastify: FastifyInstance, options: FastifyPluginOptions) => {
	fastify.get('/api/health', async () => {
		return { status: 'OK' };
	});

	await Promise.all([fastify.register(auth, getOptionsWithPrefix(options, '/auth'))]);

  await Promise.all([
    fastify.register(conversation, getOptionsWithPrefix(options, '/conversation')),
  ]);
});
