// 主逻辑（置于 body 末尾的阻塞式外链脚本，执行时 DOM 已就绪）

const unlockPanel = document.getElementById('unlockPanel');
const editorPanel = document.getElementById('editorPanel');
const accessCodeEl = document.getElementById('accessCode');
const unlockBtn = document.getElementById('unlockBtn');
const unlockMsgEl = document.getElementById('unlockMsg');
const contentEl = document.getElementById('content');
const saveBtn = document.getElementById('saveBtn');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const msgEl = document.getElementById('msg');
const statsEl = document.getElementById('stats');
const updatedAtEl = document.getElementById('updatedAt');
const loadingOverlay = document.getElementById('loadingOverlay');
const themeButtons = Array.from(document.querySelectorAll('[data-theme-option]'));
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

const MAX_CONTENT = 1024 * 1024; // 与 set.js 的 1 MiB 上限一致

// data-theme 只取 light|dark，system 模式由 matchMedia 解析
function getThemeMode() {
  try {
    return localStorage.getItem('themeMode') || 'system';
  } catch (e) {
    return 'system';
  }
}

function resolveTheme(mode) {
  const dark = mode === 'dark' || (mode === 'system' && systemTheme.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function applyTheme(mode) {
  try {
    localStorage.setItem('themeMode', mode);
  } catch (e) {}
  resolveTheme(mode);
  themeButtons.forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.themeOption === mode));
  });
}

themeButtons.forEach(button => {
  button.addEventListener('click', () => applyTheme(button.dataset.themeOption));
});

systemTheme.addEventListener('change', () => {
  if (getThemeMode() === 'system') resolveTheme('system');
});

applyTheme(getThemeMode());

// 仅支持 /clip/xxx 路径形式（?secret= 查询串更易进日志/收藏，已移除）
const pathParts = window.location.pathname.split('/').filter(Boolean);
const secret = pathParts.length >= 2 && pathParts[0] === 'clip' ? pathParts[1] : null;

let everLoaded = false; // 是否成功加载过内容（用于过期重解锁时不覆盖未保存的编辑）

function showUnlock(message) {
  unlockPanel.hidden = false;
  editorPanel.hidden = true;
  unlockMsgEl.textContent = message || '';
  loadingOverlay.style.display = 'none';
  accessCodeEl.focus();
}

if (!secret) {
  accessCodeEl.disabled = true;
  unlockBtn.disabled = true;
  unlockMsgEl.textContent = '请通过正确的链接访问';
  loadingOverlay.style.display = 'none';
} else {
  // 先静默尝试：有效期内重新打开无需输入访问码
  load();
}

let lastSaved = '';
let unsavedTimer = null;

function showMsg(text, isError = false) {
  msgEl.textContent = text;
  msgEl.className = 'msg' + (isError ? ' error' : '');
  if (!isError) setTimeout(() => { msgEl.textContent = ''; }, 3000);
}

function updateStats() {
  const text = contentEl.value;
  const chars = text.length;
  const lines = text ? text.split('\n').length : 0;
  statsEl.textContent = chars + ' 字 · ' + lines + ' 行';
}

function markUnsaved() {
  if (contentEl.value === lastSaved) {
    updatedAtEl.className = 'saved';
    updatedAtEl.textContent = updatedAtEl.dataset.time || '';
    return;
  }
  updatedAtEl.className = 'unsaved';
  updatedAtEl.textContent = '未保存';
}

function markSaved(time) {
  lastSaved = contentEl.value;
  updatedAtEl.className = 'saved';
  const text = '上次保存: ' + formatTime(time);
  updatedAtEl.textContent = text;
  updatedAtEl.dataset.time = text;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

contentEl.addEventListener('input', () => {
  updateStats();
  clearTimeout(unsavedTimer);
  unsavedTimer = setTimeout(markUnsaved, 300);
});

// 加载内容（授权通过 checkAuth 校验，靠 cookie 免输访问码）
async function load() {
  if (!secret) return;
  try {
    const res = await fetch('/api/get', {
      headers: {
        'X-Clip-Secret': secret
      }
    });
    if (res.status === 403) {
      showUnlock();
      return;
    }
    if (!res.ok) {
      showUnlock('加载失败，请刷新重试');
      return;
    }
    const data = await res.json();
    unlockPanel.hidden = true;
    editorPanel.hidden = false;
    everLoaded = true;
    contentEl.value = data.content || '';
    lastSaved = contentEl.value;
    updateStats();
    if (data.updatedAt) markSaved(data.updatedAt);
    contentEl.focus();
  } catch (e) {
    showUnlock('加载失败，请检查网络后重试');
  } finally {
    contentEl.placeholder = '在此粘贴内容...';
    loadingOverlay.style.display = 'none';
  }
}

unlockPanel.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = accessCodeEl.value.trim();
  if (!secret || !code) {
    unlockMsgEl.textContent = secret ? '请输入访问码' : '请通过正确的链接访问';
    return;
  }

  unlockMsgEl.textContent = '';
  unlockBtn.disabled = true;
  unlockBtn.textContent = '验证中...';

  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clip-Secret': secret
      },
      body: JSON.stringify({ code })
    });
    if (res.status === 429) {
      unlockMsgEl.textContent = '尝试次数过多，请 5 分钟后再试';
      return;
    }
    if (!res.ok) {
      unlockMsgEl.textContent = '访问码或链接密钥无效';
      return;
    }
    // 之前加载过说明只是授权过期，不重新拉取以免覆盖未保存内容
    if (everLoaded) {
      unlockPanel.hidden = true;
      editorPanel.hidden = false;
      contentEl.focus();
    } else {
      await load();
    }
  } catch (err) {
    unlockMsgEl.textContent = '验证失败，请检查网络后重试';
  } finally {
    unlockBtn.disabled = false;
    unlockBtn.textContent = '解锁';
  }
});

// 保存
let saving = false;
saveBtn.addEventListener('click', async () => {
  if (!secret || saving) return;
  if (contentEl.value.length > MAX_CONTENT) {
    showMsg('内容超过 1 MiB 上限，无法保存', true);
    return;
  }
  saving = true;
  saveBtn.disabled = true;
  try {
    const res = await fetch('/api/set', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clip-Secret': secret
      },
      body: JSON.stringify({ content: contentEl.value })
    });
    if (res.status === 403) {
      showUnlock('访问已过期，请重新输入访问码');
    } else if (res.status === 413) {
      showMsg('内容超过 1 MiB 上限，无法保存', true);
    } else if (res.status === 429) {
      showMsg('保存过于频繁，请稍后再试', true);
    } else if (!res.ok) {
      showMsg('保存失败: HTTP ' + res.status, true);
    } else {
      showMsg('已保存');
      saveBtn.classList.add('saved');
      setTimeout(() => saveBtn.classList.remove('saved'), 1000);
      markSaved(new Date().toISOString());
    }
  } catch (e) {
    showMsg('保存失败', true);
  } finally {
    saveBtn.disabled = false;
    saving = false;
  }
});

// 复制
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(contentEl.value);
    showMsg('已复制');
  } catch (e) {
    showMsg('复制失败', true);
  }
});

// 清空
clearBtn.addEventListener('click', () => {
  contentEl.value = '';
  contentEl.focus();
  updateStats();
  markUnsaved();
});

// Ctrl+S 保存
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (secret) saveBtn.click();
  }
});

// 粘贴自动保存（防抖 1.5s，且仅内容有变化时才写 KV）
let pasteTimer = null;
contentEl.addEventListener('paste', () => {
  clearTimeout(pasteTimer);
  pasteTimer = setTimeout(() => {
    updateStats();
    if (secret && contentEl.value !== lastSaved) saveBtn.click();
  }, 1500);
});

// 有未保存内容时离开页面给出提醒
window.addEventListener('beforeunload', (e) => {
  if (secret && contentEl.value !== lastSaved) {
    e.preventDefault();
    e.returnValue = '';
  }
});
