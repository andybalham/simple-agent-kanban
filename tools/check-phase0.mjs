import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const requiredPaths = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'eslint.config.js',
  '.env.example',
  'src/core/index.ts',
  'src/db/index.ts',
  'src/server/index.ts',
  'src/server/httpServer.ts',
  'src/mcp/index.ts',
  'src/web/App.tsx',
  'src/web/main.tsx',
];

const root = process.cwd();

await Promise.all(requiredPaths.map((path) => access(join(root, path))));

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const requiredScripts = ['dev', 'dev:web', 'dev:server', 'dev:mcp', 'build', 'lint', 'test'];

for (const script of requiredScripts) {
  if (!packageJson.scripts?.[script]) {
    throw new Error(`Missing package script: ${script}`);
  }
}

console.log('Phase 0 scaffold looks complete.');
