#!/usr/bin/env node
/**
 * 本地博客写作工具。
 *
 * 启动：npm run write
 * 只监听 127.0.0.1，不向局域网或互联网开放。
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TOOL_DIR, '..');
const POSTS_DIR = path.join(ROOT, 'posts');
const ASSETS_DIR = path.join(ROOT, 'assets');
const WRITER_DIR = path.join(TOOL_DIR, 'writer');
const MARKED_FILE = path.join(ROOT, 'node_modules', 'marked', 'lib', 'marked.esm.js');
const SESSION_TOKEN = randomBytes(24).toString('hex');
const HOST = '127.0.0.1';
const REQUEST_LIMIT = 16 * 1024 * 1024;
const IMAGE_LIMIT = 10 * 1024 * 1024;

const STATIC_ROUTES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const SITE_FILES = new Set([
  'index.html',
  'about.html',
  'archive.html',
  'tags.html',
  'style.css',
  'script.js',
  'search-index.js',
  'rss.xml',
  'sitemap.xml',
]);
const SITE_DIRECTORIES = new Set(['assets', 'blog', 'tags', 'page']);
const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function textError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > REQUEST_LIMIT) {
      throw textError(413, '请求内容太大');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw textError(400, '请求内容不是有效的 JSON');
  }
}

function oneLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function parseFrontMatter(raw) {
  const source = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { data: {}, body: source };

  const data = {};
  let listKey = '';

  for (const line of match[1].split('\n')) {
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && listKey) {
      data[listKey] = `${data[listKey] || ''},${listItem[1].trim()}`;
      continue;
    }

    const field = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (field) {
      listKey = field[2].trim() ? '' : field[1].toLowerCase();
      data[field[1].toLowerCase()] = field[2].trim().replace(/^['"]|['"]$/g, '');
    } else if (line.trim()) {
      listKey = '';
    }
  }

  return { data, body: source.slice(match[0].length) };
}

function tagsFrom(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  return [...new Set(raw.split(/[,，、]/).map((tag) => oneLine(tag)).filter(Boolean))];
}

function draftFrom(value) {
  return /^(true|yes|1|是)$/i.test(String(value || '').trim());
}

function validDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.valueOf())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

function safeFilename(value) {
  const filename = String(value || '');
  if (!filename.toLowerCase().endsWith('.md')) return '';
  if (path.basename(filename) !== filename || /[\0-\x1f<>:"/\\|?*]/.test(filename)) return '';
  return filename;
}

function slugFrom(value) {
  const slug = String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'article';
}

function slugFromFilename(filename) {
  return filename.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function firstParagraph(body) {
  return body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line
      && !line.startsWith('#')
      && !line.startsWith('```')
      && !line.startsWith('>')
      && !line.startsWith('-')
      && !line.startsWith('|')) || '';
}

function serializePost(data) {
  const title = oneLine(data.title);
  const date = oneLine(data.date);
  if (!title) throw textError(400, '请填写文章标题');
  if (!validDate(date)) throw textError(400, '请填写有效日期，格式为 YYYY-MM-DD');

  const tags = tagsFrom(data.tags);
  const summary = oneLine(data.summary);
  const body = String(data.content || '').replace(/\r\n?/g, '\n').trimEnd();

  const lines = [
    '---',
    `title: ${title}`,
    `date: ${date}`,
    `tags: ${tags.join(', ')}`,
  ];
  if (summary) lines.push(`summary: ${summary}`);
  if (data.draft === true) lines.push('draft: true');
  lines.push('---', '', body, '');
  return lines.join('\n');
}

async function listPosts() {
  await mkdir(POSTS_DIR, { recursive: true });
  const files = (await readdir(POSTS_DIR))
    .filter((file) => file.toLowerCase().endsWith('.md'))
    .sort();
  const posts = [];

  for (const filename of files) {
    const absolute = path.join(POSTS_DIR, filename);
    const [raw, info] = await Promise.all([readFile(absolute, 'utf8'), stat(absolute)]);
    const { data, body } = parseFrontMatter(raw);
    posts.push({
      filename,
      slug: slugFromFilename(filename),
      title: data.title || filename.replace(/\.md$/i, ''),
      date: data.date || '',
      tags: tagsFrom(data.tags),
      summary: data.summary || firstParagraph(body),
      draft: draftFrom(data.draft),
      updatedAt: info.mtime.toISOString(),
    });
  }

  return posts.sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title, 'zh-CN'));
}

async function freeFilename(date, requestedSlug) {
  const base = `${date}-${slugFrom(requestedSlug)}`;
  let filename = `${base}.md`;
  let suffix = 2;
  while (true) {
    try {
      await stat(path.join(POSTS_DIR, filename));
      filename = `${base}-${suffix++}.md`;
    } catch (error) {
      if (error.code === 'ENOENT') return filename;
      throw error;
    }
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      shell: false,
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} 执行超时`));
    }, 90_000);

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      if (code === 0) resolve({ output, code });
      else {
        const error = new Error(output || `${command} 执行失败`);
        error.code = code;
        error.output = output;
        reject(error);
      }
    });
  });
}

function git(args) {
  return run('git', args);
}

async function repoStatus() {
  const [statusResult, branchResult, remoteResult] = await Promise.all([
    git(['status', '--porcelain']),
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['remote', 'get-url', 'origin']).catch(() => ({ output: '' })),
  ]);
  const changes = statusResult.output ? statusResult.output.split(/\r?\n/).filter(Boolean) : [];
  return {
    branch: branchResult.output.trim(),
    remote: remoteResult.output.trim(),
    changes,
    changedCount: changes.length,
  };
}

function imageExtension(buffer) {
  if (buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'gif';
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return '';
}

async function saveImage(data) {
  const match = String(data.data || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) throw textError(400, '图片格式无效');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length === 0 || buffer.length > IMAGE_LIMIT) {
    throw textError(413, '图片不能超过 10 MB');
  }
  const extension = imageExtension(buffer);
  if (!extension) throw textError(400, '仅支持 PNG、JPG、GIF 或 WebP 图片');

  await mkdir(ASSETS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const filename = `blog-${stamp}-${randomBytes(3).toString('hex')}.${extension}`;
  await writeFile(path.join(ASSETS_DIR, filename), buffer);
  return {
    filename,
    url: `../assets/${filename}`,
  };
}

async function savePost(data) {
  const content = serializePost(data);
  const date = oneLine(data.date);
  const original = data.originalFilename ? safeFilename(data.originalFilename) : '';
  if (data.originalFilename && !original) throw textError(400, '原文件名无效');

  let filename = original;
  if (original) {
    try {
      await stat(path.join(POSTS_DIR, original));
    } catch {
      throw textError(404, '原文章不存在，可能已经被移动或删除');
    }
  } else {
    filename = await freeFilename(date, data.slug || data.title);
  }

  await mkdir(POSTS_DIR, { recursive: true });
  await writeFile(path.join(POSTS_DIR, filename), content, 'utf8');
  return {
    filename,
    slug: slugFromFilename(filename),
    title: oneLine(data.title),
  };
}

async function publish(message) {
  const before = await repoStatus();
  if (before.changedCount === 0) throw textError(409, '没有需要发布的改动');

  await git(['add', '-A']);
  const staged = await git(['diff', '--cached', '--quiet']).then(
    () => false,
    (error) => {
      if (error.code === 1) return true;
      throw error;
    },
  );
  if (!staged) throw textError(409, '没有需要提交的改动');

  const commitMessage = oneLine(message) || '更新博客';
  const commit = await git(['commit', '-m', commitMessage]);
  try {
    const push = await git(['push']);
    return {
      committed: true,
      pushed: true,
      output: [commit.output, push.output].filter(Boolean).join('\n'),
    };
  } catch (error) {
    error.message = `提交成功，但上传 GitHub 失败：${error.message}`;
    error.committed = true;
    throw error;
  }
}

function authorized(req) {
  return req.headers['x-writer-token'] === SESSION_TOKEN;
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/session' && req.method === 'GET') {
    return json(res, 200, { token: SESSION_TOKEN });
  }
  if (!authorized(req)) throw textError(403, '写作工具会话已失效，请刷新页面');

  if (url.pathname === '/api/posts' && req.method === 'GET') {
    return json(res, 200, { posts: await listPosts() });
  }

  if (url.pathname.startsWith('/api/posts/') && req.method === 'GET') {
    const encoded = url.pathname.slice('/api/posts/'.length);
    const filename = safeFilename(decodeURIComponent(encoded));
    if (!filename) throw textError(400, '文件名无效');
    try {
      const raw = await readFile(path.join(POSTS_DIR, filename), 'utf8');
      const { data, body } = parseFrontMatter(raw);
      return json(res, 200, {
        filename,
        slug: slugFromFilename(filename),
        title: data.title || filename.replace(/\.md$/i, ''),
        date: data.date || '',
        tags: tagsFrom(data.tags),
        summary: data.summary || '',
        draft: draftFrom(data.draft),
        content: body,
      });
    } catch (error) {
      if (error.code === 'ENOENT') throw textError(404, '文章不存在');
      throw error;
    }
  }

  if (url.pathname === '/api/posts' && req.method === 'POST') {
    const saved = await savePost(await readJson(req));
    return json(res, 200, { ...saved, posts: await listPosts() });
  }

  if (url.pathname === '/api/assets' && req.method === 'POST') {
    return json(res, 200, await saveImage(await readJson(req)));
  }

  if (url.pathname === '/api/build' && req.method === 'POST') {
    const result = await run(process.execPath, [path.join(TOOL_DIR, 'build-blog.mjs')]);
    return json(res, 200, result);
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    return json(res, 200, await repoStatus());
  }

  if (url.pathname === '/api/publish' && req.method === 'POST') {
    const body = await readJson(req);
    return json(res, 200, await publish(body.message));
  }

  throw textError(404, '接口不存在');
}

async function serveStatic(req, res, url) {
  const route = STATIC_ROUTES.get(url.pathname);
  if (route) {
    const content = await readFile(path.join(WRITER_DIR, route[0]));
    res.writeHead(200, {
      'Content-Type': route[1],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': [
        "default-src 'self'",
        "img-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "frame-src 'self' data: blob:",
        "connect-src 'self'",
      ].join('; '),
    });
    return res.end(content);
  }

  if (url.pathname === '/vendor/marked.esm.js') {
    const content = await readFile(MARKED_FILE);
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(content);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

async function serveSite(res, url) {
  let relative;
  try {
    relative = decodeURIComponent(url.pathname.slice('/site/'.length)) || 'index.html';
  } catch {
    throw textError(400, '网址无效');
  }
  relative = relative.replace(/\\/g, '/');
  if (relative.endsWith('/')) relative += 'index.html';

  const parts = relative.split('/');
  const allowed = parts.length === 1
    ? SITE_FILES.has(parts[0])
    : parts.length === 2
      && SITE_DIRECTORIES.has(parts[0])
      && Boolean(parts[1])
      && !parts[1].startsWith('.');
  if (!allowed) throw textError(404, '页面不存在');

  const extension = path.extname(relative).toLowerCase();
  const contentType = CONTENT_TYPES.get(extension);
  if (!contentType) throw textError(404, '页面不存在');

  try {
    const content = await readFile(path.join(ROOT, relative));
    if (extension === '.html') {
      const rewritten = content.toString('utf8')
        .replace(/((?:href|src)=["'])\//g, '$1/site/');
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(rewritten);
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') throw textError(404, '页面还没有生成');
    throw error;
  }
}

function openBrowser(url) {
  if (process.env.WRITER_NO_OPEN === '1') return;
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

let activePort = Number(process.env.WRITER_PORT) || 4317;

const server = createServer(async (req, res) => {
  try {
    const hostHeader = req.headers.host || '';
    if (![`${HOST}:${activePort}`, `localhost:${activePort}`].includes(hostHeader)) {
      throw textError(403, '仅允许本机访问');
    }

    const url = new URL(req.url || '/', `http://${HOST}:${activePort}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (url.pathname.startsWith('/site/') && req.method === 'GET') {
      await serveSite(res, url);
    } else if (req.method === 'GET') {
      await serveStatic(req, res, url);
    } else {
      throw textError(405, '请求方法不允许');
    }
  } catch (error) {
    const status = error.status || 500;
    if (!res.headersSent) {
      json(res, status, {
        error: status === 500 ? `操作失败：${error.message}` : error.message,
        output: error.output || '',
        committed: Boolean(error.committed),
      });
    } else {
      res.end();
    }
  }
});

function listen(port, remainingAttempts = 10) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && remainingAttempts > 0) {
      listen(port + 1, remainingAttempts - 1);
    } else {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
  server.listen(port, HOST, () => {
    activePort = port;
    const url = `http://${HOST}:${port}`;
    console.log('');
    console.log('  Song4u 写作工具已启动');
    console.log(`  ${url}`);
    console.log('');
    console.log('  写完文章后可以直接点击“发布到 GitHub”。');
    console.log('  关闭这个窗口即可停止工具。');
    console.log('');
    openBrowser(url);
  });
}

listen(activePort);
