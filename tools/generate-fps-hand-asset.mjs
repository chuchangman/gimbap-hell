import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blender = process.env.BLENDER_PATH || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
if (!existsSync(path.join(root, 'assets-src/hand-realistic/source/base.obj'))) {
  throw new Error('Missing CC0 authoring sources. See tools/REALISTIC-HAND.md. The published GLB does not require Blender.');
}
const result = spawnSync(blender, [
  '--background', '--factory-startup', '--python-exit-code', '1',
  '--python', path.join(root, 'tools/build-realistic-hand.py'),
], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
