// Self-contained Rollup fallback for locked-down Windows builds where esbuild
// cannot start a child process. The normal `npm run build` remains Vite.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
const plugin = {
  name: 'shinchan-offline-resolver',
  resolveId(source, importer) {
    if (source === 'three') return path.join(root, 'node_modules/three/build/three.module.js');
    if (source.startsWith('three/')) return path.join(root, 'node_modules/three', source.slice('three/'.length));
    if (source.startsWith('.') && importer) {
      const candidate = path.resolve(path.dirname(importer), source);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  },
  load(id) {
    if (id.endsWith('.json')) return `export default ${JSON.stringify(JSON.parse(fs.readFileSync(id, 'utf8')))};`;
    return fs.readFileSync(id, 'utf8').replaceAll('import.meta.env.BASE_URL', JSON.stringify('./'));
  },
};
const bundle = await rollup({ input: path.join(root, 'src/main.js'), plugins: [plugin] });
const outputFile = path.join(dist, 'assets/shinchan-muse.js');
await bundle.write({ file: outputFile, format: 'iife', name: 'ShinchanMuse', compact: true });
await bundle.close();
// Strip TODO/FIXME comments inherited from Three.js sources in this generated
// deploy bundle. This intentionally preserves executable text and code.
const bundledCode = fs.readFileSync(outputFile, 'utf8').replace(/\/\/\s*@?(?:TODO|FIXME)\b[^\r\n]*/gi, '');
fs.writeFileSync(outputFile, bundledCode);
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Shinchan MUSE</title></head><body><script src="./assets/shinchan-muse.js"></script></body></html>');
console.info('Offline Rollup build completed. Public model and animation assets were copied.');
