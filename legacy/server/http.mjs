import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream';
import { createBrotliCompress, createGzip, constants as zlibConstants } from 'node:zlib';

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8',
  '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.bin':'application/octet-stream',
  '.woff2':'font/woff2', '.mp3':'audio/mpeg', '.ogg':'audio/ogg'
};

export function resolvePublicPath(root, requestUrl) {
  if (typeof requestUrl !== 'string' || requestUrl.length > 2048) return null;
  let decoded;
  try { decoded = decodeURIComponent(requestUrl.split('?')[0]); } catch { return null; }
  if (!decoded.startsWith('/') || /[\\:\u0000-\u001f\u007f]/u.test(decoded)) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some(p => p.startsWith('.'))) return null;
  const resolved = path.resolve(root, parts.length ? parts.join('/') : 'index.html');
  return resolved.startsWith(path.resolve(root) + path.sep) ? resolved : null;
}

export function json(res, status, data, head = false) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(head ? undefined : JSON.stringify(data));
}

export function createHttpHandler({ root, health, board, ready, count }) {
  const realRoot = fs.realpathSync(root);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const importmap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  const hash = importmap ? " 'sha256-" + createHash('sha256').update(importmap).digest('base64') + "'" : '';
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    // Only dynamic style attributes remain as compatibility debt (progress bars,
    // swatches and Three.js canvas sizing); scripts/import maps never use unsafe-inline.
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'" + hash
      + "; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:");
    if (!['GET','HEAD'].includes(req.method)) {
      res.setHeader('Allow','GET, HEAD'); return json(res,405,{error:'Method not allowed'});
    }
    const head = req.method === 'HEAD';
    const file = resolvePublicPath(realRoot, req.url);
    if (!file) { count('invalidHttp'); return json(res,400,{error:'Invalid request path'},head); }
    const route = req.url.split('?')[0];
    if (route === '/health') return json(res,200,health(),head);
    if (route === '/ready') return json(res,ready() ? 200 : 503,{ready:ready()},head);
    if (route === '/leaderboard.json') return json(res,200,board(),head);
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) return json(res,404,{error:'Not found'},head);
    try {
      const actual = await fs.promises.realpath(file);
      if (!actual.startsWith(realRoot + path.sep)) return json(res,404,{error:'Not found'},head);
      const stat = await fs.promises.stat(actual);
      if (!stat.isFile()) return json(res,404,{error:'Not found'},head);
      const etag = 'W/"' + stat.size.toString(16) + '-' + stat.mtimeMs.toString(16) + '"';
      res.setHeader('ETag',etag);
      res.setHeader('Cache-Control','public, max-age=0, must-revalidate');
      res.setHeader('Vary','Accept-Encoding');
      res.setHeader('Content-Type',type);
      if (req.headers['if-none-match']?.split(',').map(s=>s.trim()).includes(etag)) {
        res.writeHead(304); return res.end();
      }
      const compressible = /^(text\/|application\/json)/.test(type) && stat.size > 1024;
      const encodings = (req.headers['accept-encoding'] || '').split(',').map(s=>s.trim());
      const accepted = e => encodings.some(s => s.split(';')[0] === e && !/;\s*q=0(?:\.0*)?\s*$/.test(s));
      const coding = compressible && (accepted('br') ? 'br' : accepted('gzip') ? 'gzip' : null);
      if (coding) res.setHeader('Content-Encoding',coding);
      else res.setHeader('Content-Length',stat.size);
      res.writeHead(200);
      if (head) return res.end();
      const stream = fs.createReadStream(actual);
      const done = err => { if (err && !res.destroyed) res.destroy(); };
      if (coding) pipeline(stream,coding === 'br' ? createBrotliCompress({params:{[zlibConstants.BROTLI_PARAM_QUALITY]:4}}) : createGzip(),res,done);
      else pipeline(stream,res,done);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (!['ENOENT','ENOTDIR'].includes(error.code)) count('httpErrors');
      json(res,404,{error:'Not found'},head);
    }
  };
}
