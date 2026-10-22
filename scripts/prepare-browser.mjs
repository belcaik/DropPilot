import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
const args = [cli, 'install', 'chromium'];
if (process.platform === 'linux' && process.env.CI) args.push('--with-deps');
const result = spawnSync(process.execPath, args, {
  cwd: root,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(root, '.browsers') },
  stdio: 'inherit'
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
