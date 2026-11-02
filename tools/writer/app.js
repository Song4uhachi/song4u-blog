import { marked } from '/vendor/marked.esm.js';

const LOCAL_DRAFT_KEY = 'song4u-writer-unsaved-v1';
const appState = {
  token: '',
  posts: [],
  currentFilename: null,
  dirty: false,
  busy: false,
  slugTouched: false,
  imageInsertAt: null,
  toastTimer: 0,
  previewTimer: 0,
  saveTimer: 0,
};

const elements = {
  newPostButton: document.querySelector('#newPostButton'),
  importButton: document.querySelector('#importButton'),
  noteFileInput: document.querySelector('#noteFileInput'),
  imageFileInput: document.querySelector('#imageFileInput'),
  postList: document.querySelector('#postList'),
  postCount: document.querySelector('#postCount'),
  repoDot: document.querySelector('#repoDot'),
  repoStateText: document.querySelector('#repoStateText'),
  siteLink: document.querySelector('#siteLink'),
  saveIndicator: document.querySelector('#saveIndicator'),
  saveStateText: document.querySelector('#saveStateText'),
  titleInput: document.querySelector('#titleInput'),
  dateInput: document.querySelector('#dateInput'),
  slugInput: document.querySelector('#slugInput'),
  tagsInput: document.querySelector('#tagsInput'),
  summaryInput: document.querySelector('#summaryInput'),
  draftInput: document.querySelector('#draftInput'),
  contentInput: document.querySelector('#contentInput'),
  writingCount: document.querySelector('#writingCount'),
  previewFrame: document.querySelector('#previewFrame'),
  viewButton: document.querySelector('#viewButton'),
  buildButton: document.querySelector('#buildButton'),
  publishButton: document.querySelector('#publishButton'),
  toast: document.querySelector('#toast'),
};

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.valueOf() - offset).toISOString().slice(0, 10);
}

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseFrontMatter(raw) {
  const source = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { metadata: {}, body: source };

  const metadata = {};
  let listKey = '';
  for (const line of match[1].split('\n')) {
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && listKey) {
      metadata[listKey] = `${metadata[listKey] || ''},${listItem[1].trim()}`;
      continue;
    }
    const field = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (field) {
      listKey = field[2].trim() ? '' : field[1].toLowerCase();
      metadata[field[1].toLowerCase()] = field[2].trim().replace(/^['"]|['"]$/g, '');
    } else if (line.trim()) {
      listKey = '';
    }
  }
  return { metadata, body: source.slice(match[0].length) };
}

function slugify(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  if (slug) return slug;
  const stamp = new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 12);
  return `article-${stamp}`;
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : '未填写日期';
}

function showToast(message, type = '') {
  window.clearTimeout(appState.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', type === 'error');
  elements.toast.classList.add('is-visible');
  appState.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove('is-visible');
  }, type === 'error' ? 7000 : 3600);
}

async function api(url, options = {}) {
  const method = options.method || 'GET';
  const headers = { ...(options.headers || {}) };
  if (appState.token) headers['X-Writer-Token'] = appState.token;
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  let response;
  try {
    response = await fetch(url, { ...options, method, headers });
  } catch {
    throw new Error('无法连接写作工具，请确认启动窗口没有关闭');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data.output ? `\n${data.output}` : '';
    const error = new Error(`${data.error || `请求失败 (${response.status})`}${details}`);
    error.committed = Boolean(data.committed);
    throw error;
  }
  return data;
}

function readForm() {
  return {
    title: elements.titleInput.value,
    date: elements.dateInput.value,
    slug: elements.slugInput.value,
    tags: elements.tagsInput.value,
    summary: elements.summaryInput.value,
    draft: elements.draftInput.checked,
    content: elements.contentInput.value,
  };
}

function formSnapshot() {
  return {
    ...readForm(),
    currentFilename: appState.currentFilename,
    savedAt: Date.now(),
  };
}

function fillForm(post) {
  elements.titleInput.value = post.title || '';
  elements.dateInput.value = post.date || today();
  elements.slugInput.value = post.slug || slugify(post.title);
  elements.tagsInput.value = Array.isArray(post.tags) ? post.tags.join(', ') : post.tags || '';
  elements.summaryInput.value = post.summary || '';
  elements.draftInput.checked = Boolean(post.draft);
  elements.contentInput.value = String(post.content || '').replace(/^\n+/, '');
  updatePreview();
}

function updateWritingCount() {
  const content = elements.contentInput.value;
  const characters = content.replace(/\s/g, '').length;
  const minutes = Math.max(1, Math.ceil(characters / 400));
  elements.writingCount.textContent = `${characters.toLocaleString('zh-CN')} 字 · 约 ${minutes} 分钟`;
}

function markDirty() {
  appState.dirty = true;
  elements.saveIndicator.className = 'save-indicator is-dirty';
  elements.saveStateText.textContent = '有未保存修改';
  window.clearTimeout(appState.saveTimer);
  appState.saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(formSnapshot()));
    } catch {
      // 本地草稿只是额外保障，存储失败不影响正常保存。
    }
  }, 300);
}

function markSaved(message = '所有修改已保存') {
  appState.dirty = false;
  elements.saveIndicator.className = 'save-indicator is-saved';
  elements.saveStateText.textContent = message;
  window.clearTimeout(appState.saveTimer);
  localStorage.removeItem(LOCAL_DRAFT_KEY);
}

function confirmDiscard() {
  if (!appState.dirty) return true;
  return window.confirm('当前文章还有未保存的修改，确定要离开吗？');
}

function newPost(options = {}) {
  if (!options.force && !confirmDiscard()) return;
  appState.currentFilename = null;
  appState.slugTouched = false;
  fillForm({
    title: '',
    date: today(),
    slug: '',
    tags: '',
    summary: '',
    draft: false,
    content: '',
  });
  elements.slugInput.disabled = false;
  appState.dirty = false;
  elements.saveIndicator.className = 'save-indicator';
  elements.saveStateText.textContent = '新文章';
  renderPostList();
  elements.titleInput.focus();
}

function renderPostList() {
  elements.postCount.textContent = String(appState.posts.length);
  elements.postList.replaceChildren();
  if (appState.posts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'post-list-empty';
    empty.textContent = '还没有文章。新建一篇，或者导入 Obsidian 笔记。';
    elements.postList.append(empty);
    return;
  }

  for (const post of appState.posts) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'post-item';
    button.classList.toggle('is-active', post.filename === appState.currentFilename);
    button.dataset.filename = post.filename;

    const title = document.createElement('span');
    title.className = 'post-item__title';
    title.textContent = post.title;

    const meta = document.createElement('span');
    meta.className = 'post-item__meta';
    const date = document.createElement('span');
    date.textContent = formatDate(post.date);
    meta.append(date);
    if (post.draft) {
      const draft = document.createElement('span');
      draft.className = 'post-item__draft';
      draft.textContent = '草稿';
      meta.append(draft);
    }

    button.append(title, meta);
    button.addEventListener('click', () => openPost(post.filename));
    elements.postList.append(button);
  }
}

async function loadPosts() {
  const data = await api('/api/posts');
  appState.posts = data.posts;
  renderPostList();
}

async function openPost(filename) {
  if (filename === appState.currentFilename) return;
  if (!confirmDiscard()) return;

  try {
    const post = await api(`/api/posts/${encodeURIComponent(filename)}`);
    appState.currentFilename = post.filename;
    appState.slugTouched = true;
    fillForm(post);
    elements.slugInput.disabled = true;
    appState.dirty = false;
    elements.saveIndicator.className = 'save-indicator is-saved';
    elements.saveStateText.textContent = '文章已载入';
    renderPostList();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function saveCurrent(options = {}) {
  const form = readForm();
  if (!oneLine(form.title)) {
    elements.titleInput.focus();
    throw new Error('请先填写文章标题');
  }
  if (!form.date) {
    elements.dateInput.focus();
    throw new Error('请选择文章日期');
  }

  const result = await api('/api/posts', {
    method: 'POST',
    body: JSON.stringify({
      ...form,
      originalFilename: appState.currentFilename,
    }),
  });

  appState.currentFilename = result.filename;
  elements.slugInput.value = result.slug;
  elements.slugInput.disabled = true;
  appState.posts = result.posts;
  renderPostList();
  markSaved(`已保存 · ${result.filename}`);
  if (!options.silent) showToast('文章已保存');
  return result;
}

async function saveAndBuild() {
  if (appState.busy) return;
  setBusy(true);
  try {
    await saveCurrent({ silent: true });
    const result = await api('/api/build', { method: 'POST' });
    const summary = result.output.split('\n').find((line) => line.includes('完成：')) || '网站已重新生成';
    showToast(summary);
    await refreshRepoStatus();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

async function publishToGitHub() {
  if (appState.busy) return;
  if (!window.confirm('将保存当前文章、重新生成网站，并提交上传所有本地改动。继续吗？')) return;

  setBusy(true);
  try {
    await saveCurrent({ silent: true });
    await api('/api/build', { method: 'POST' });
    const result = await api('/api/publish', {
      method: 'POST',
      body: JSON.stringify({
        message: `发布文章：${oneLine(elements.titleInput.value) || '更新博客'}`,
      }),
    });
    if (result.pushed) showToast('发布成功，GitHub 已收到最新版本');
    await loadPosts();
    await refreshRepoStatus();
  } catch (error) {
    const message = error.committed
      ? `${error.message}\n可以在 GitHub Desktop 中点击 Push origin 重试。`
      : error.message;
    showToast(message, 'error');
    await refreshRepoStatus().catch(() => {});
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  appState.busy = busy;
  for (const button of [elements.newPostButton, elements.importButton, elements.buildButton, elements.publishButton]) {
    button.disabled = busy;
  }
  document.body.style.cursor = busy ? 'progress' : '';
}

async function refreshRepoStatus() {
  try {
    const status = await api('/api/status');
    elements.repoDot.className = `state-dot ${status.changedCount ? 'is-dirty' : 'is-clean'}`;
    elements.repoStateText.textContent = status.changedCount
      ? `${status.branch} · ${status.changedCount} 个文件待发布`
      : `${status.branch} · 工作区干净`;
  } catch {
    elements.repoDot.className = 'state-dot';
    elements.repoStateText.textContent = '无法检查 Git 状态';
  }
}

function previewDocument(title, html) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <base href="/site/blog/">
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      max-width: 760px;
      margin: 0 auto;
      padding: 28px 30px 70px;
      color: #363b40;
      background: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                   "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      font-size: 16px;
      line-height: 1.82;
      overflow-wrap: break-word;
    }
    h1, h2, h3, h4 { color: #16181a; line-height: 1.42; }
    h1 { margin: 0 0 .8em; font-size: 1.85em; letter-spacing: -.025em; }
    h2 { margin-top: 1.8em; font-size: 1.35em; }
    h3 { margin-top: 1.55em; font-size: 1.13em; }
    p { margin: .9em 0; }
    a { color: #2f6feb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    blockquote {
      margin: 1.2em 0;
      padding: .35em 1em;
      border-left: 3px solid #2f6feb;
      background: #f7f9fd;
      color: #626b77;
    }
    pre {
      padding: 15px 17px;
      overflow: auto;
      border-radius: 9px;
      background: #171b22;
      color: #dfe5ee;
      line-height: 1.65;
    }
    code {
      padding: .16em .38em;
      border-radius: 4px;
      background: #eef1f5;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: .9em;
    }
    pre code { padding: 0; background: transparent; color: inherit; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 7px 10px; border: 1px solid #e4e7eb; text-align: left; }
    th { background: #f7f8fa; }
    .empty {
      display: grid;
      min-height: 70vh;
      place-items: center;
      color: #9aa2ad;
      text-align: center;
    }
  </style>
</head>
<body>
  ${html || `<div class="empty">${title ? '正文还是空的' : '在左侧开始写文章，这里会实时预览'}</div>`}
</body>
</html>`;
}

function updatePreview() {
  updateWritingCount();
  window.clearTimeout(appState.previewTimer);
  appState.previewTimer = window.setTimeout(() => {
    const title = oneLine(elements.titleInput.value);
    const source = elements.contentInput.value;
    let html = '';
    try {
      html = marked.parse(source, { gfm: true, breaks: false });
    } catch {
      html = '<p>Markdown 暂时无法预览，正文仍会原样保存。</p>';
    }
    elements.previewFrame.srcdoc = previewDocument(title, html);
  }, 90);
}

function replaceSelection(before, after, placeholder) {
  const textarea = elements.contentInput;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || placeholder;
  textarea.setRangeText(`${before}${selected}${after}`, start, end, 'end');
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function prefixSelectedLines(prefix) {
  const textarea = elements.contentInput;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1;
  const lineEndIndex = textarea.value.indexOf('\n', end);
  const lineEnd = lineEndIndex === -1 ? textarea.value.length : lineEndIndex;
  const selected = textarea.value.slice(lineStart, lineEnd);
  const replacement = selected.split('\n').map((line) => `${prefix}${line}`).join('\n');
  textarea.setRangeText(replacement, lineStart, lineEnd, 'end');
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyFormat(format) {
  if (!format) return;
  if (format === 'heading') return prefixSelectedLines('## ');
  if (format === 'quote') return prefixSelectedLines('> ');
  if (format === 'list') return prefixSelectedLines('- ');
  if (format === 'bold') return replaceSelection('**', '**', '重点文字');
  if (format === 'italic') return replaceSelection('*', '*', '文字');
  if (format === 'code') return replaceSelection('```cpp\n', '\n```', '在这里写代码');
  if (format === 'link') return replaceSelection('[', '](https://)', '链接文字');
  if (format === 'image') {
    appState.imageInsertAt = elements.contentInput.selectionStart;
    elements.imageFileInput.click();
  }
}

function insertAt(position, text) {
  const textarea = elements.contentInput;
  const at = Number.isInteger(position) ? position : textarea.selectionStart;
  textarea.setRangeText(text, at, at, 'end');
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file, position) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('请选择图片文件', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('图片不能超过 10 MB', 'error');
    return;
  }

  try {
    showToast('正在插入图片…');
    const data = await fileAsDataUrl(file);
    const result = await api('/api/assets', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, data }),
    });
    insertAt(position, `\n![${file.name.replace(/\.[^.]+$/, '')}](${result.url})\n`);
    showToast('图片已插入并保存到 assets/');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function importNote(file) {
  if (!file) return;
  if (!confirmDiscard()) return;

  try {
    const raw = await file.text();
    const { metadata, body } = parseFrontMatter(raw);
    const stem = file.name.replace(/\.(md|markdown)$/i, '');
    const title = metadata.title || stem;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(metadata.date || '') ? metadata.date : today();
    const draft = /^(true|yes|1|是)$/i.test(metadata.draft || '');
    appState.currentFilename = null;
    appState.slugTouched = false;
    fillForm({
      title,
      date,
      slug: slugify(title),
      tags: metadata.tags || '',
      summary: metadata.summary || '',
      draft,
      content: body,
    });
    elements.slugInput.disabled = false;
    markDirty();
    showToast('笔记已导入，检查信息后点击保存');
    elements.titleInput.focus();
  } catch (error) {
    showToast(`导入失败：${error.message}`, 'error');
  } finally {
    elements.noteFileInput.value = '';
  }
}

function restoreLocalDraft() {
  let snapshot;
  try {
    snapshot = JSON.parse(localStorage.getItem(LOCAL_DRAFT_KEY) || 'null');
  } catch {
    localStorage.removeItem(LOCAL_DRAFT_KEY);
    return;
  }
  if (!snapshot || Date.now() - Number(snapshot.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) return;
  if (!snapshot.title && !snapshot.content) return;
  if (!window.confirm('发现上次关闭工具时未保存的草稿，要恢复吗？')) {
    localStorage.removeItem(LOCAL_DRAFT_KEY);
    return;
  }

  appState.currentFilename = snapshot.currentFilename || null;
  fillForm(snapshot);
  elements.slugInput.disabled = Boolean(appState.currentFilename);
  appState.dirty = true;
  elements.saveIndicator.className = 'save-indicator is-dirty';
  elements.saveStateText.textContent = '已恢复未保存草稿';
  showToast('已恢复上次未保存的草稿');
}

function openGeneratedArticle() {
  if (!appState.currentFilename) {
    showToast('请先保存文章');
    return;
  }
  if (elements.draftInput.checked) {
    showToast('这是草稿，生成网站时不会公开显示');
    return;
  }
  const slug = elements.slugInput.value;
  window.open(`/site/blog/${encodeURIComponent(slug)}.html`, '_blank', 'noopener');
}

function bindEvents() {
  elements.newPostButton.addEventListener('click', () => newPost());
  elements.importButton.addEventListener('click', () => elements.noteFileInput.click());
  elements.noteFileInput.addEventListener('change', () => importNote(elements.noteFileInput.files[0]));
  elements.imageFileInput.addEventListener('change', () => {
    const file = elements.imageFileInput.files[0];
    const position = appState.imageInsertAt;
    elements.imageFileInput.value = '';
    uploadImage(file, position);
  });

  for (const input of [
    elements.titleInput,
    elements.dateInput,
    elements.slugInput,
    elements.tagsInput,
    elements.summaryInput,
    elements.draftInput,
    elements.contentInput,
  ]) {
    input.addEventListener('input', () => {
      markDirty();
      updatePreview();
    });
  }

  elements.slugInput.addEventListener('input', () => {
    appState.slugTouched = true;
  });
  elements.titleInput.addEventListener('input', () => {
    if (!appState.currentFilename && !appState.slugTouched) {
      elements.slugInput.value = slugify(elements.titleInput.value);
    }
  });

  for (const button of document.querySelectorAll('[data-format]')) {
    button.addEventListener('click', () => applyFormat(button.dataset.format));
  }

  elements.buildButton.addEventListener('click', saveAndBuild);
  elements.publishButton.addEventListener('click', publishToGitHub);
  elements.viewButton.addEventListener('click', openGeneratedArticle);
  elements.siteLink.addEventListener('click', (event) => {
    event.preventDefault();
    window.open('/site/index.html', '_blank', 'noopener');
  });

  elements.contentInput.addEventListener('paste', (event) => {
    const image = [...(event.clipboardData?.items || [])]
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile();
    if (!image) return;
    event.preventDefault();
    uploadImage(image, elements.contentInput.selectionStart);
  });

  elements.contentInput.addEventListener('dragover', (event) => {
    if ([...(event.dataTransfer?.items || [])].some((item) => item.type.startsWith('image/'))) {
      event.preventDefault();
    }
  });
  elements.contentInput.addEventListener('drop', (event) => {
    const image = [...(event.dataTransfer?.files || [])].find((file) => file.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    uploadImage(image, elements.contentInput.selectionStart);
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveAndBuild();
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!appState.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

async function init() {
  bindEvents();
  elements.dateInput.value = today();
  updatePreview();

  try {
    const session = await api('/api/session');
    appState.token = session.token;
    await loadPosts();
    newPost({ force: true });
    restoreLocalDraft();
    await refreshRepoStatus();
  } catch (error) {
    showToast(error.message, 'error');
    elements.saveStateText.textContent = '连接失败';
  }
}

init();
