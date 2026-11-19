import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const builtClient = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (!config.clientDistDir && existsSync(builtClient)) config.clientDistDir = builtClient;

const db = new PrismaClient();
const server = createApp(db, config);

await server.sessions.recover();

server.httpServer.listen(config.port, () => {
  console.info(`Classroom Sync server on http://localhost:${config.port}`);
  if (config.clientDistDir) console.info(`Serving the built client from ${config.clientDistDir}`);
});

const shutdown = () => {
  void server.close().finally(() => db.$disconnect().finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
