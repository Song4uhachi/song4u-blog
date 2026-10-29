#!/usr/bin/env node
/**
 * 把 posts/*.md 编译成整个博客。
 *
 * 生成的文件：
 *   index.html           首页 = 文章列表（第一篇通栏 + 其余三列网格 + 分页）
 *   page/2.html ...      第二页及以后
 *   blog/<slug>.html     每篇文章
 *   archive.html         按年份归档
 *   tags.html            全部标签
 *   tags/<标签>.html      某个标签下的文章
 *   search-index.js      站内搜索用的索引
 *   rss.xml / sitemap.xml
 *   about.html           只往里面填头部和页脚，正文是你手写的
 *
 * 用法：npm run blog
 */

import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = path.join(ROOT, 'posts');
const BLOG_DIR = path.join(ROOT, 'blog');
const TAGS_DIR = path.join(ROOT, 'tags');
const PAGE_DIR = path.join(ROOT, 'page');

/* ================================================================== */
/* 改这里                                                              */
/* ================================================================== */

const CONFIG = {
  siteName: 'Song4u',
  tagline: '学习笔记、项目记录，以及折腾各种工具的过程。',

  // 绑定域名后把这里改成完整网址（结尾不要带斜杠）。
  // RSS、sitemap 和分享卡片需要绝对地址，留空时用相对路径。
  siteUrl: '',

  postsPerPage: 10,
};

/** 主导航。想加页面就在这里加一行，头部会自动更新。 */
const NAV = [
  ['首页', 'index.html'],
  ['归档', 'archive.html'],
  ['标签', 'tags.html'],
  ['关于', 'about.html'],
];

/* ================================================================== */
/* 小工具                                                              */
/* ================================================================== */

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function formatDate(value) {
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value || '');
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function frontMatter(raw) {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return { data: {}, body: lines.join('\n') };

  const data = {};
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '---') { i++; break; }
    const m = lines[i].match(/^([A-Za-z_][\w-]*)\s*[:：]\s*(.*)$/);
    if (m) data[m[1].toLowerCase()] = m[2].trim();
  }
  return { data, body: lines.slice(i).join('\n') };
}

function firstParagraph(body) {
  const line = body
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('#') && !s.startsWith('```') && !s.startsWith('>') && !s.startsWith('-') && !s.startsWith('|'));
  if (!line) return '';
  const plain = line.replace(/[*`_\[\]()]/g, '');
  return plain.length > 78 ? plain.slice(0, 78) + '…' : plain;
}

function readMinutes(body) {
  const text = body.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, '');
  return Math.max(1, Math.round(text.length / 400));
}

function tagSlug(tag) {
  return tag.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
}
const tagFile = (tag) => `${tagSlug(tag)}.html`;
const tagHref = (tag) => encodeURIComponent(tagSlug(tag)) + '.html';

function absolute(p) {
  return CONFIG.siteUrl ? CONFIG.siteUrl.replace(/\/+$/, '') + p : p;
}

/* ================================================================== */
/* 页面骨架：头部 / 页脚 / 浮层                                        */
/* ================================================================== */

function header(prefix, current) {
  const listItems = (indent) => NAV.map(([label, href]) => {
    const active = label === current ? ' aria-current="page"' : '';
    return `<li><a href="${prefix}${href}"${active}>${label}</a></li>`;
  }).join('\n' + indent);

  const mainnav = listItems('            ');
  const compactNav = listItems('          ');

  return `<header class="site-header" id="masthead">
    <div class="header-branding">
      <div class="container">
        <p class="site-title"><a href="${prefix}index.html">${esc(CONFIG.siteName)}</a></p>
        <p class="site-description">${esc(CONFIG.tagline)}</p>
      </div>
    </div>

    <div class="header-nav">
      <div class="container header-nav__inner">
        <nav class="mainnav" aria-label="主导航">
          <ul>
            ${mainnav}
          </ul>
        </nav>
        <div class="header-actions">
          <button class="icon-btn js-theme" type="button" aria-label="切换深色模式">🌙</button>
          <button class="icon-btn js-search" type="button" aria-label="搜索">🔍</button>
          <button class="icon-btn icon-btn--menu js-menu" type="button" aria-label="打开菜单">☰</button>
        </div>
      </div>
    </div>
  </header>

  <div class="sticky-header" id="stickyHeader">
    <div class="progress"><span class="progress__bar" id="progressBar"></span></div>
    <div class="container sticky-header__inner">
      <a class="sticky-header__brand" href="${prefix}index.html">${esc(CONFIG.siteName)}</a>
      <nav class="mainnav mainnav--compact" aria-label="吸顶导航">
        <ul>
          ${compactNav}
        </ul>
      </nav>
      <div class="header-actions">
        <button class="icon-btn js-theme" type="button" aria-label="切换深色模式">🌙</button>
        <button class="icon-btn js-search" type="button" aria-label="搜索">🔍</button>
        <button class="icon-btn icon-btn--menu js-menu" type="button" aria-label="打开菜单">☰</button>
      </div>
    </div>
  </div>`;
}

function footerRegion(prefix) {
  const mobileLinks = NAV.map(([label, href]) => `<li><a href="${prefix}${href}">${label}</a></li>`).join('\n      ');

  return `<footer class="site-footer" id="colophon">
    <div class="container site-footer__inner">
      <div class="site-info">
        Copyright © <span class="js-year">2026</span>
        <a href="${prefix}index.html">${esc(CONFIG.siteName)}</a>. 保留所有权利
      </div>
      <div class="footer-links">
        <a href="${prefix}rss.xml">RSS</a>
        <a href="${prefix}about.html">关于</a>
      </div>
    </div>
  </footer>

  <nav class="mobile-nav" id="mobileNav" aria-label="移动端菜单">
    <div class="mobile-nav__head">
      <span class="mobile-nav__title">导航</span>
      <button class="icon-btn js-close" type="button" aria-label="关闭菜单">✕</button>
    </div>
    <ul>
      ${mobileLinks}
    </ul>
  </nav>

  <div class="overlay-backdrop" id="backdrop"></div>

  <div class="search-overlay" id="searchOverlay" role="dialog" aria-label="站内搜索">
    <button class="search-close js-close" type="button" aria-label="关闭搜索">✕</button>
    <div class="container">
      <label class="screen-reader-text" for="searchInput">搜索文章</label>
      <input class="search-field" id="searchInput" type="search" placeholder="搜索文章…" autocomplete="off">
      <p class="search-hint">输入关键词即时筛选标题、摘要和标签，按 ESC 关闭。</p>
      <ul class="search-results" id="searchResults"></ul>
    </div>
  </div>

  <button class="back-to-top" id="backToTop" type="button">返回顶部 ↑</button>

  <script src="${prefix}search-index.js"></script>
  <script src="${prefix}script.js"></script>`;
}

function shell({ title, description, prefix, body, canonical, type = 'website', current = '' }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="icon" type="image/svg+xml" href="${prefix}assets/favicon.svg">
  <link rel="stylesheet" href="${prefix}style.css">
  <link rel="alternate" type="application/rss+xml" title="${esc(CONFIG.siteName)} 的博客" href="${prefix}rss.xml">
  ${canonical ? `<link rel="canonical" href="${esc(absolute(canonical))}">` : ''}
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  ${canonical ? `<meta property="og:url" content="${esc(absolute(canonical))}">` : ''}
  <meta name="twitter:card" content="summary">
</head>
<body data-root="${prefix}">
  ${header(prefix, current)}

  <main class="site-content" id="primary">
    <div class="container">
${body}
    </div>
  </main>

  ${footerRegion(prefix)}
</body>
</html>
`;
}

/* ================================================================== */
/* 文章块                                                              */
/* ================================================================== */

function metaLine(post, prefix) {
  const first = post.tags[0];
  const cat = first
    ? `<span class="cat-links"><a href="${prefix}tags/${tagHref(first)}">${esc(first)}</a></span>
          <span class="dot">·</span>
          `
    : '';
  return `        <div class="entry-meta">
          ${cat}<span class="posted-on"><time datetime="${esc(post.date)}">${esc(formatDate(post.date))}</time></span>
        </div>`;
}

function featuredPost(post, prefix) {
  const url = `${prefix}blog/${post.slug}.html`;
  return `      <article class="post-item post-item--featured">
${metaLine(post, prefix)}
        <h2 class="entry-title"><a href="${url}">${esc(post.title)}</a></h2>
        <div class="entry-content">
          <p>${esc(post.summary)}</p>
        </div>
        <footer class="entry-footer">
          <a class="readmore" href="${url}">阅读更多</a>
        </footer>
      </article>`;
}

function gridPost(post, prefix) {
  const url = `${prefix}blog/${post.slug}.html`;
  return `        <article class="post-item">
${metaLine(post, prefix)}
          <h2 class="entry-title"><a href="${url}">${esc(post.title)}</a></h2>
          <div class="entry-content">
            <p>${esc(post.summary)}</p>
          </div>
          <footer class="entry-footer">
            <a class="readmore" href="${url}">阅读更多</a>
          </footer>
        </article>`;
}

/** 第一篇通栏，其余排进三列网格 */
function renderArchive(list, prefix, { featured = true } = {}) {
  if (!list.length) return '      <p class="empty">还没有文章。在 posts/ 里新建一个 .md 文件，然后运行 npm run blog。</p>';

  const withFeature = featured && list.length > 1;
  const items = withFeature ? list.slice(1) : list;

  let html = '';
  if (withFeature) html += featuredPost(list[0], prefix) + '\n\n';
  if (items.length) {
    html += `      <div class="post-grid">\n${items.map((p) => gridPost(p, prefix)).join('\n')}\n      </div>`;
  }
  return html;
}

function pagination(current, total, prefix) {
  if (total <= 1) return '';
  const href = (i) => (i === 1 ? `${prefix}index.html` : `${prefix}page/${i}.html`);

  const items = [];
  if (current > 1) items.push(`<a href="${href(current - 1)}">上一页</a>`);
  for (let i = 1; i <= total; i++) {
    items.push(i === current ? `<span class="current">${i}</span>` : `<a href="${href(i)}">${i}</a>`);
  }
  if (current < total) items.push(`<a href="${href(current + 1)}">下一页</a>`);

  return `      <nav class="pagination" aria-label="分页">\n        ${items.join('\n        ')}\n      </nav>`;
}

/* ================================================================== */
/* 读取 posts/                                                         */
/* ================================================================== */

async function loadPosts() {
  let files;
  try {
    files = await readdir(POSTS_DIR);
  } catch {
    console.log('没有找到 posts/ 目录。');
    return [];
  }

  const posts = [];
  const used = new Set();

  for (const file of files.filter((f) => f.toLowerCase().endsWith('.md'))) {
    const raw = await readFile(path.join(POSTS_DIR, file), 'utf8');
    const { data, body } = frontMatter(raw);

    let slug = (data.slug || file.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''))
      .trim()
      .replace(/\s+/g, '-');
    while (used.has(slug)) slug += '-2';
    used.add(slug);

    posts.push({
      slug,
      title: data.title || file.replace(/\.md$/i, ''),
      date: data.date || '',
      tags: (data.tags || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      summary: data.summary || firstParagraph(body),
      draft: /^(true|yes|1)$/i.test(data.draft || ''),
      body,
    });
  }

  return posts
    .filter((p) => !p.draft)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug));
}

const posts = await loadPosts();

await mkdir(BLOG_DIR, { recursive: true });
await mkdir(TAGS_DIR, { recursive: true });

/* ================================================================== */
/* 首页 + 分页                                                         */
/* ================================================================== */

const perPage = Math.max(1, CONFIG.postsPerPage);
const pageCount = Math.max(1, Math.ceil(posts.length / perPage));

for (let i = 1; i <= pageCount; i++) {
  const slice = posts.slice((i - 1) * perPage, i * perPage);
  const isFirst = i === 1;

  const head = isFirst ? '' : `      <div class="content-head">
        <h1>第 ${i} 页</h1>
        <p>共 ${posts.length} 篇文章</p>
      </div>
`;

  const body = `${head}${renderArchive(slice, '', { featured: isFirst })}

${pagination(i, pageCount, '')}`;

  const html = shell({
    title: isFirst ? `${CONFIG.siteName} · ${CONFIG.tagline}` : `第 ${i} 页 · ${CONFIG.siteName}`,
    description: CONFIG.tagline,
    prefix: '',
    body,
    canonical: isFirst ? '/index.html' : `/page/${i}.html`,
    current: '首页',
  });

  if (isFirst) {
    await writeFile(path.join(ROOT, 'index.html'), html, 'utf8');
    console.log('  首页  index.html');
  } else {
    await mkdir(PAGE_DIR, { recursive: true });
    await writeFile(path.join(PAGE_DIR, `${i}.html`), html, 'utf8');
    console.log(`  分页  page/${i}.html`);
  }
}

await cleanDir(PAGE_DIR, new Set(Array.from({ length: pageCount }, (_, i) => `${i + 2}.html`)));

/* ================================================================== */
/* 文章页                                                              */
/* ================================================================== */

const writtenPosts = new Set();

for (const [index, post] of posts.entries()) {
  const html = marked.parse(post.body);
  const newer = posts[index - 1];
  const older = posts[index + 1];

  const tags = post.tags.length
    ? `        <ul class="tags tags--sm entry-tags">
          ${post.tags.map((t) => `<li><a href="../tags/${tagHref(t)}" style="color:inherit">${esc(t)}</a></li>`).join('\n          ')}
        </ul>`
    : '';

  const postnav = (newer || older) ? `
      <nav class="postnav">
        ${older ? `<a href="${older.slug}.html"><span>← 上一篇</span>${esc(older.title)}</a>` : '<span></span>'}
        ${newer ? `<a class="postnav__next" href="${newer.slug}.html"><span>下一篇 →</span>${esc(newer.title)}</a>` : '<span></span>'}
      </nav>` : '';

  const body = `      <article class="post">
        <header class="post-header">
          <p><a class="back-link" href="../index.html">← 返回首页</a></p>
          <h1 class="entry-title">${esc(post.title)}</h1>
          <div class="entry-meta">
            <span class="posted-on"><time datetime="${esc(post.date)}">${esc(formatDate(post.date))}</time></span>
            <span class="dot">·</span>
            <span>约 ${readMinutes(post.body)} 分钟</span>
          </div>
          ${tags}
        </header>
        <div class="prose">
${html.trimEnd()}
        </div>${postnav}
      </article>`;

  await writeFile(path.join(BLOG_DIR, `${post.slug}.html`), shell({
    title: `${post.title} · ${CONFIG.siteName}`,
    description: post.summary,
    prefix: '../',
    body,
    canonical: `/blog/${post.slug}.html`,
    type: 'article',
    current: '首页',
  }), 'utf8');

  writtenPosts.add(`${post.slug}.html`);
  console.log(`  文章  blog/${post.slug}.html`);
}

await cleanDir(BLOG_DIR, writtenPosts);

// 旧结构里的 blog.html 已经并进首页，留着会和新结构重复
try {
  await unlink(path.join(ROOT, 'blog.html'));
  console.log('  清理  blog.html（列表已并入首页）');
} catch {}

/* ================================================================== */
/* 标签                                                                */
/* ================================================================== */

const tagMap = new Map();
for (const post of posts) {
  for (const tag of post.tags) {
    if (!tagMap.has(tag)) tagMap.set(tag, []);
    tagMap.get(tag).push(post);
  }
}

const tags = [...tagMap.keys()].sort(
  (a, b) => tagMap.get(b).length - tagMap.get(a).length || a.localeCompare(b, 'zh')
);

const writtenTags = new Set();

for (const tag of tags) {
  const list = tagMap.get(tag);
  await writeFile(path.join(TAGS_DIR, tagFile(tag)), shell({
    title: `#${tag} · ${CONFIG.siteName}`,
    description: `标签「${tag}」下的全部文章。`,
    prefix: '../',
    canonical: `/tags/${tagFile(tag)}`,
    current: '标签',
    body: `      <div class="content-head">
        <h1>#${esc(tag)}</h1>
        <p>共 ${list.length} 篇 · <a href="../tags.html">看全部标签</a></p>
      </div>

${renderArchive(list, '../', { featured: false })}`,
  }), 'utf8');

  writtenTags.add(tagFile(tag));
  console.log(`  标签  tags/${tagFile(tag)}`);
}

await cleanDir(TAGS_DIR, writtenTags);

const cloud = tags.length
  ? tags.map((t) => `<a href="tags/${tagHref(t)}">${esc(t)} <span>${tagMap.get(t).length}</span></a>`).join('\n        ')
  : '<p class="empty">还没有标签。在文章头部写 <code>tags: 随笔, 折腾</code> 就会自动生成。</p>';

await writeFile(path.join(ROOT, 'tags.html'), shell({
  title: `标签 · ${CONFIG.siteName}`,
  description: '按标签浏览全部文章。',
  prefix: '',
  canonical: '/tags.html',
  current: '标签',
  body: `      <div class="content-head">
        <h1>标签</h1>
        <p>共 ${tags.length} 个标签</p>
      </div>
      <div class="tagcloud">
        ${cloud}
      </div>`,
}), 'utf8');

/* ================================================================== */
/* 归档                                                                */
/* ================================================================== */

const byYear = new Map();
for (const post of posts) {
  const year = (post.date || '').slice(0, 4) || '未标日期';
  if (!byYear.has(year)) byYear.set(year, []);
  byYear.get(year).push(post);
}

const archiveHtml = [...byYear.entries()].map(([year, list]) => `      <h2 class="archive__year">${esc(year)} <span>· ${list.length} 篇</span></h2>
      <ul class="archive__list">
${list.map((p) => `        <li class="archive__item">
          <time class="archive__date">${esc(String(p.date).slice(5) || '——')}</time>
          <a class="archive__link" href="blog/${p.slug}.html">${esc(p.title)}</a>
        </li>`).join('\n')}
      </ul>`).join('\n');

await writeFile(path.join(ROOT, 'archive.html'), shell({
  title: `归档 · ${CONFIG.siteName}`,
  description: '按时间倒序列出全部文章。',
  prefix: '',
  canonical: '/archive.html',
  current: '归档',
  body: `      <div class="content-head">
        <h1>归档</h1>
        <p>共 ${posts.length} 篇文章</p>
      </div>
${archiveHtml || '      <p class="empty">还没有文章。</p>'}`,
}), 'utf8');

/* ================================================================== */
/* 站内搜索索引                                                        */
/* ================================================================== */

const searchIndex = posts.map((p) => ({
  title: p.title,
  url: `blog/${p.slug}.html`,
  date: p.date,
  tags: p.tags,
  summary: p.summary,
}));

await writeFile(
  path.join(ROOT, 'search-index.js'),
  '/* 由 npm run blog 自动生成，不要手改 */\nwindow.SEARCH_INDEX = '
    + JSON.stringify(searchIndex, null, 2) + ';\n',
  'utf8'
);

/* ================================================================== */
/* 关于页：只注入头部和页脚                                            */
/* ================================================================== */

function replaceRegion(html, name, content) {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a === -1 || b === -1 || b < a) return null;
  return html.slice(0, a + start.length) + '\n\n' + content + '\n\n  ' + html.slice(b);
}

let aboutNote = 'about.html 里没有找到标记，已跳过';
try {
  const aboutPath = path.join(ROOT, 'about.html');
  let about = await readFile(aboutPath, 'utf8');
  const withHeader = replaceRegion(about, 'SITE_HEADER', header('', '关于'));
  const withFooter = withHeader === null ? null : replaceRegion(withHeader, 'SITE_FOOTER', footerRegion(''));

  if (withFooter !== null) {
    await writeFile(aboutPath, withFooter, 'utf8');
    aboutNote = 'about.html 的头部和页脚已更新';
  }
} catch (e) {
  aboutNote = `about.html 处理失败：${e.message}`;
}

/* ================================================================== */
/* RSS 和 sitemap                                                      */
/* ================================================================== */

function rfc822(dateStr) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? new Date(`${dateStr}T08:00:00+08:00`)
    : new Date();
  return d.toUTCString();
}

await writeFile(path.join(ROOT, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(CONFIG.siteName)} 的博客</title>
    <link>${esc(absolute('/index.html'))}</link>
    <description>${esc(CONFIG.tagline)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${rfc822(posts[0]?.date || '')}</lastBuildDate>
${posts.map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(absolute(`/blog/${p.slug}.html`))}</link>
      <guid isPermaLink="true">${esc(absolute(`/blog/${p.slug}.html`))}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <description>${esc(p.summary)}</description>
      <content:encoded><![CDATA[${marked.parse(p.body)}]]></content:encoded>
    </item>`).join('\n')}
  </channel>
</rss>
`, 'utf8');

const sitemapUrls = [
  ['/index.html', posts[0]?.date],
  ...Array.from({ length: pageCount - 1 }, (_, i) => [`/page/${i + 2}.html`, posts[0]?.date]),
  ['/archive.html', posts[0]?.date],
  ['/tags.html', posts[0]?.date],
  ['/about.html', ''],
  ...posts.map((p) => [`/blog/${p.slug}.html`, p.date]),
  ...tags.map((t) => [`/tags/${tagFile(t)}`, tagMap.get(t)[0]?.date]),
];

await writeFile(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(([loc, lastmod]) => `  <url>
    <loc>${esc(absolute(loc))}</loc>${lastmod ? `\n    <lastmod>${esc(lastmod)}</lastmod>` : ''}
  </url>`).join('\n')}
</urlset>
`, 'utf8');

/* ================================================================== */

console.log(`\n完成：${posts.length} 篇文章、${tags.length} 个标签、${pageCount} 页`);
console.log(`  ${aboutNote}`);
if (!CONFIG.siteUrl) {
  console.log('  提示：CONFIG.siteUrl 还是空的，RSS 和 sitemap 用的是相对地址。');
}

/* ================================================================== */

/** 删掉目录里不再需要的旧页面 */
async function cleanDir(dir, keep) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return;
  }

  for (const file of files) {
    if (file.endsWith('.html') && !keep.has(file)) {
      await unlink(path.join(dir, file));
      console.log(`  清理  ${path.basename(dir)}/${file}`);
    }
  }
}
