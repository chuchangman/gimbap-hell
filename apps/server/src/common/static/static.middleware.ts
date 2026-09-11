import type { NextFunction, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { createBrotliCompress, createGzip, constants as zlibConstants } from 'node:zlib';
import type { MetricsService } from '../metrics.service.js';
import { resolvePublicPath } from './resolve-path.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

/** 컨트롤러가 맡는 경로 — 정적 서빙이 건드리지 않고 넘긴다 */
const ROUTES = new Set(['/health', '/ready', '/leaderboard.json']);

function json(res: Response, status: number, data: unknown, head = false): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(head ? undefined : JSON.stringify(data));
}

/**
 * 레거시 server/http.mjs 를 그대로 옮긴 정적 서버.
 * Nest 라우터보다 먼저 걸어 보안 헤더를 모든 응답에 붙이고,
 * 컨트롤러가 맡는 경로만 통과시킨다.
 */
export function createStaticMiddleware(root: string, metrics: MetricsService) {
  const realRoot = fs.realpathSync(root);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const importmap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  const hash = importmap
    ? " 'sha256-" + createHash('sha256').update(importmap).digest('base64') + "'"
    : '';

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // 진행 바 · 색 견본 · 캔버스 크기 조정에 쓰는 동적 style 속성만 예외로 남는다.
    // 스크립트와 import map 은 unsafe-inline 을 쓰지 않는다.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'" +
        hash +
        /* connect-src 에 blob: 이 필요하다 — GLTFLoader 가 GLB 안에 박힌
           리소스를 blob URL 로 만들어 fetch 한다. 없으면 그 에셋만 조용히
           로드에 실패한다(브라우저 콘솔에만 남는다). 우리 페이지가 스스로
           만든 blob 이고, 외부 출처는 여전히 막힌다. */
        "; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:",
    );
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return json(res, 405, { error: 'Method not allowed' });
    }
    const head = req.method === 'HEAD';
    const file = resolvePublicPath(realRoot, req.url);
    if (!file) {
      metrics.count('invalidHttp');
      return json(res, 400, { error: 'Invalid request path' }, head);
    }
    const route = req.url.split('?')[0];
    if (ROUTES.has(route)) return next();
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) return json(res, 404, { error: 'Not found' }, head);
    try {
      const actual = await fs.promises.realpath(file);
      if (!actual.startsWith(realRoot + path.sep))
        return json(res, 404, { error: 'Not found' }, head);
      const stat = await fs.promises.stat(actual);
      if (!stat.isFile()) return json(res, 404, { error: 'Not found' }, head);
      const etag = 'W/"' + stat.size.toString(16) + '-' + stat.mtimeMs.toString(16) + '"';
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Type', type);
      if (
        req.headers['if-none-match']
          ?.split(',')
          .map((s) => s.trim())
          .includes(etag)
      ) {
        res.writeHead(304);
        res.end();
        return;
      }
      const compressible = /^(text\/|application\/json)/.test(type) && stat.size > 1024;
      const encodings = (req.headers['accept-encoding'] || '')
        .toString()
        .split(',')
        .map((s) => s.trim());
      const accepted = (e: string) =>
        encodings.some((s) => s.split(';')[0] === e && !/;\s*q=0(?:\.0*)?\s*$/.test(s));
      const coding = compressible && (accepted('br') ? 'br' : accepted('gzip') ? 'gzip' : null);
      if (coding) res.setHeader('Content-Encoding', coding);
      else res.setHeader('Content-Length', stat.size);
      res.writeHead(200);
      if (head) {
        res.end();
        return;
      }
      const stream = fs.createReadStream(actual);
      const done = (err: NodeJS.ErrnoException | null) => {
        if (err && !res.destroyed) res.destroy();
      };
      if (coding)
        pipeline(
          stream,
          coding === 'br'
            ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } })
            : createGzip(),
          res,
          done,
        );
      else pipeline(stream, res, done);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || ''))
        metrics.count('httpErrors');
      json(res, 404, { error: 'Not found' }, head);
    }
  };
}
