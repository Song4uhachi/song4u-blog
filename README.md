# 个人博客 · 使用说明

纯静态站点，没有构建步骤。页面由脚本从 Markdown 生成，发布时 Cloudflare Pages
不需要做任何构建，直接把整个文件夹当成成品发出去。

---

## 一、站点结构

页面自上而下是这几层：

```
┌─ 品牌区 ─────────────── 站点标题 + 一句话描述
├─ 主导航行 ───────────── 导航 + 深色模式 / 搜索 / 菜单按钮
│
├─ 内容区
│    ├─ 首页：最新一篇通栏大区块
│    │         其余文章三列卡片网格
│    │         底部分页
│    ├─ 文章页：标题 + 日期 + 标签 + 正文 + 上一篇/下一篇
│    ├─ 归档页：按年份列出全部文章
│    ├─ 标签页：标签云 / 单个标签下的文章
│    └─ 关于页：个人介绍与联系方式
│
└─ 深色页脚 ───────────── 版权 + RSS / 关于

另外还有三个浮层：
  · 滚动时从顶部滑出的吸顶导航（带阅读进度条）
  · 全屏搜索层（按 ESC 关闭）
  · 手机上从右侧滑出的抽屉菜单
  · 右下角的返回顶部按钮
```

---

## 二、文件分工

```
你只需要改这些：
  posts/*.md            文章，写 Markdown
  about.html            关于页的正文（头部和页脚会自动填，别改标记之间）
  assets/               头像和图标
  style.css             样式和配色

配置在脚本里：
  tools/build-blog.mjs  顶部有站点名称、描述、导航、每页篇数、域名

以下是自动生成的，不要手改：
  index.html            首页
  page/*.html           第二页及以后
  blog/*.html           每篇文章
  archive.html          归档
  tags.html, tags/*.html
  search-index.js       站内搜索索引
  rss.xml, sitemap.xml
```

---

## 三、怎么写一篇文章

1. 在 `posts/` 里新建 `.md`，文件名用 `日期-英文短名.md`，例如 `2026-10-08-dp-notes.md`
2. 开头写一段信息：

````markdown
---
title: 文章标题
date: 2026-10-08
tags: 算法, 笔记
summary: 显示在列表页的一句话摘要，不写就自动取正文第一段。
---

正文从这里开始，用 Markdown 写就行。

## 二级标题

- 列表、引用、表格、行内代码 `like this` 都支持

```cpp
int main() {
    return 0;
}
```
````

3. 运行：

```bash
npm run blog
```

它会重新生成首页、文章页、归档、标签、搜索索引、RSS 和 sitemap，然后照常用
GitHub Desktop 提交并推送即可。

### 几点约定

- `date` 决定排序，格式必须是 `YYYY-MM-DD`
- 文件名开头的日期会从网址里去掉，`2026-10-08-dp-notes.md` 的网址是 `blog/dp-notes.html`
- `tags` 里第一个标签会显示在列表页的卡片上，全部标签都会自动生成标签页
- 文章里要放图片，把图片放进 `assets/`，然后写 `![说明](../assets/图片名.png)`
- 暂时不想公开的文章，在头部加一行 `draft: true`
- 文章超过 10 篇会自动分页，每页篇数在 `tools/build-blog.mjs` 里改

---

## 四、改站点信息和导航

打开 `tools/build-blog.mjs`，最上面有一段配置：

```js
const CONFIG = {
  siteName: 'Song4u',                   // 站点标题
  tagline: '学习笔记、项目记录……',        // 标题下面那行描述
  siteUrl: '',                          // 绑定域名后填这里
  postsPerPage: 10,
};

const NAV = [
  ['首页', 'index.html'],
  ['归档', 'archive.html'],
  ['标签', 'tags.html'],
  ['关于', 'about.html'],
];
```

改完再跑一次 `npm run blog`，头部导航、页脚、吸顶导航会一起更新。

---

## 五、发布到网上

### 第 1 步：推到 GitHub

1. 打开 GitHub Desktop，菜单 `File` → `Add local repository`，选中这个文件夹。
2. 提示 "This directory does not appear to be a Git repository" 时，点 `create a repository` → `Create repository`。
3. 点右上角 `Publish repository`，去掉 `Keep this code private` 的勾，然后 Publish。

### 第 2 步：Cloudflare Pages 部署

1. 打开 [cloudflare.com](https://cloudflare.com) 注册并登录。
2. 左侧菜单 `Workers & Pages` → `Create` → `Pages` → `Connect to Git`。
3. 授权 GitHub，选中刚才的仓库。
4. 构建配置：

| 设置项 | 填什么 |
| --- | --- |
| Framework preset | `None` |
| Build command | 留空 |
| Build output directory | `/` |

5. 点 `Save and Deploy`，十几秒后你会拿到一个 `xxxxx.pages.dev` 的网址。

### 第 3 步：以后更新

改完本地文件，GitHub Desktop 里填一句话 → `Commit to main` → `Push origin`，
一分钟左右线上就更新了。

---

## 六、绑定自己的域名

在 Cloudflare 的 Pages 项目里进 `Custom domains` → `Set up a custom domain`，输入你的域名。
域名在 Cloudflare 上买的话直接确认；在别处买的按提示改 Nameserver。
HTTPS 证书会自动签发，服务器不在中国大陆，不需要 ICP 备案。

绑好之后记得回到 `tools/build-blog.mjs`，把 `siteUrl` 填成完整网址（例如 `https://song4u.com`），
再跑一次 `npm run blog`。RSS 和 sitemap 需要绝对地址。

---

## 七、可能会碰到的问题

**图片不显示**：检查文件名大小写。服务器是 Linux，区分大小写，`Photo.JPG` 和 `photo.jpg` 是两个文件。

**首页 404**：首页必须叫 `index.html`，名字不能改。

**本地双击打不开搜索**：搜索用的是页面内嵌的索引文件，不是网络请求，所以双击也能用。

**关于页的头部没更新**：`about.html` 里有一对 `<!-- SITE_HEADER:START -->` 标记，
删掉标记就没办法自动填充了，恢复它们即可。

**Vercel 打不开**：如果改用 Vercel，默认的 `*.vercel.app` 域名在中国大陆无法访问，
必须绑定自己的域名。Cloudflare Pages 没这个问题。
