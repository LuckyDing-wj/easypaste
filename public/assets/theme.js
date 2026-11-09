// 防闪烁：head 内阻塞式外链脚本，先于首次渲染执行
// data-theme 只取 light|dark 两值，system 模式在此解析（CSS 仅保留一份暗色变量）
(function () {
  var mode = 'system';
  try {
    mode = localStorage.getItem('themeMode') || 'system';
  } catch (e) {}
  var dark = mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
