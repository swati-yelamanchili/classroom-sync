import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export default function setup() {
  const dir = path.resolve(import.meta.dirname, '.tmp');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: `file:${path.join(dir, 'test.db')}` },
    stdio: 'pipe',
  });
  return () => rmSync(dir, { recursive: true, force: true });
}
