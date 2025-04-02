import { FastifyInstance, FastifyPluginOptions } from 'fastify';

import fastifyPlugin from 'fastify-plugin';
import conversationRoute from './conversation.route';
import { conversationSchemas } from './conversation.schema';

export default fastifyPlugin(async (fastify: FastifyInstance, options: FastifyPluginOptions) => {
	for (const schema of conversationSchemas) {
		fastify.addSchema(schema);
	}

	await fastify.register(conversationRoute, options);
});
