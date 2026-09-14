import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blender = process.env.BLENDER_PATH || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
for (const name of ['right-hand-photo-cutout.png', 'right-hand-grip-cutout.png']) {
  if (!existsSync(path.join(root, 'apps/client/public/assets/hand', name))) {
    throw new Error('Missing photo cutout: '+name+'. See tools/PHOTO-HAND.md.');
  }
}
for (const pose of ['open', 'grip']) {
  const result = spawnSync(blender, [
    '--background', '--factory-startup', '--python-exit-code', '1',
    '--python', path.join(root, 'tools/build-photo-hand.py'), '--', '--pose', pose,
  ], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
