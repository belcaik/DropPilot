import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const files = (await readdir('dist')).filter(name => name.endsWith('.zip'));
if (!files.length) throw new Error('No portable ZIP was generated');
for (const name of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join('dist', name))) hash.update(chunk);
  await writeFile(path.join('dist', `${name}.sha256`), `${hash.digest('hex')}  ${name}\n`);
}
