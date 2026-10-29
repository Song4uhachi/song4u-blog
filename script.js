/* ==========================================================================
   站点脚本：主题切换 / 吸顶导航 / 阅读进度 / 抽屉菜单 / 搜索 / 返回顶部
   不需要任何依赖，直接引这一份就行。
   ========================================================================== */

(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;
  var base = body.getAttribute('data-root') || '';

  /* ---------------------------------------------------------------- 主题 */

  var THEME_KEY = 'theme';

  function readSavedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    document.querySelectorAll('.js-theme').forEach(function (btn) {
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    });
  }

  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(readSavedTheme() || (prefersDark ? 'dark' : 'light'));

  /* ------------------------------------------------------- 滚动相关效果 */

  var sticky = document.getElementById('stickyHeader');
  var progressBar = document.getElementById('progressBar');
  var backToTop = document.getElementById('backToTop');

  function onScroll() {
    var y = window.pageYOffset || document.documentElement.scrollTop;

    if (sticky) sticky.classList.toggle('is-visible', y > 240);
    if (backToTop) backToTop.classList.toggle('is-visible', y > 520);

    if (progressBar) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      progressBar.style.width = (max > 0 ? Math.min(100, (y / max) * 100) : 0) + '%';
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* ------------------------------------------------------- 抽屉 / 搜索 */

  var drawer = document.getElementById('mobileNav');
  var backdrop = document.getElementById('backdrop');
  var searchOverlay = document.getElementById('searchOverlay');
  var searchInput = document.getElementById('searchInput');
  var searchResults = document.getElementById('searchResults');

  function closePanels() {
    if (drawer) drawer.classList.remove('is-open');
    if (searchOverlay) searchOverlay.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-open');
    body.classList.remove('is-locked');
  }

  function openDrawer() {
    closePanels();
    if (drawer) drawer.classList.add('is-open');
    if (backdrop) backdrop.classList.add('is-open');
    body.classList.add('is-locked');
  }

  function openSearch() {
    closePanels();
    if (searchOverlay) searchOverlay.classList.add('is-open');
    body.classList.add('is-locked');
    if (searchInput) {
      searchInput.value = '';
      renderResults('');
      setTimeout(function () { searchInput.focus(); }, 60);
    }
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('.js-theme')) {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      return;
    }
    if (event.target.closest('.js-menu')) { openDrawer(); return; }
    if (event.target.closest('.js-search')) { openSearch(); return; }
    if (event.target.closest('.js-close') || event.target.closest('.overlay-backdrop')) { closePanels(); return; }
    if (event.target.closest('#backToTop')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closePanels();
  });

  /* ------------------------------------------------------------ 搜索 */

  var searchIndex = window.SEARCH_INDEX || [];

  function renderResults(keyword) {
    if (!searchResults) return;
    searchResults.textContent = '';

    var query = keyword.trim().toLowerCase();
    if (!query) return;

    var hits = searchIndex.filter(function (post) {
      return (post.title + ' ' + post.summary + ' ' + post.tags.join(' '))
        .toLowerCase()
        .indexOf(query) > -1;
    }).slice(0, 20);

    if (!hits.length) {
      var none = document.createElement('li');
      none.className = 'search-hint';
      none.textContent = '没有找到匹配的文章。';
      searchResults.appendChild(none);
      return;
    }

    hits.forEach(function (post) {
      var li = document.createElement('li');
      var link = document.createElement('a');
      var title = document.createElement('strong');
      var summary = document.createElement('em');

      link.href = base + post.url;
      title.textContent = post.title;
      summary.textContent = post.date + ' · ' + post.summary;

      link.appendChild(title);
      link.appendChild(summary);
      li.appendChild(link);
      searchResults.appendChild(li);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', function () { renderResults(searchInput.value); });
  }

  /* ------------------------------------------------------------ 杂项 */

  var year = new Date().getFullYear();
  document.querySelectorAll('.js-year').forEach(function (el) { el.textContent = year; });
})();
