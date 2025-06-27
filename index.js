/*
 * =====================================================================================
 *
 * Filename:  index.js
 *
 * Description:  在线剪贴板 Cloudflare Worker
 * - 支持登录验证
 * - 支持文本、文件（通过URL）的跨设备同步
 * - 支持创建、管理、修改、删除带权限（查看次数、有效期）的分享链接
 *
 * Version:  2.0
 * Revision:  2025-06-27 (新增分享管理功能)
 *
 * =====================================================================================
 */


// 部署前，请确保已经在 Cloudflare Worker 的设置中完成了两件事：
// 1. 绑定了一个 KV Namespace，并将其命名为 `JTB`。
// 2. 在环境变量 (Environment Variables) 中设置了 `USER` 和 `PASSWORD` 用于登录。


addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

/**
 * 处理所有传入的请求
 * @param {Request} request
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // 1. 处理公开的分享链接 /s/ (无需登录)
  if (path.startsWith('/s/') && request.method === 'GET') {
    const shareId = path.substring(3);
    const data = await JTB.get(shareId);

    if (!data) {
      return new Response('分享链接无效或已过期', { status: 404 });
    }

    const { content, maxViews, expireAt, views } = JSON.parse(data);

    if (expireAt && Date.now() > expireAt) {
      await JTB.delete(shareId); // 过期则删除
      return new Response('分享链接已过期', { status: 403 });
    }

    if (maxViews && views >= maxViews) {
      await JTB.delete(shareId); // 达到最大查看次数则删除
      return new Response('分享链接已达到最大查看次数', { status: 403 });
    }

    // 只有在设置了最大查看次数时，才更新计数
    if (maxViews) {
      await JTB.put(shareId, JSON.stringify({ content, maxViews, expireAt, views: views + 1 }));
    }

    return new Response(content);
  }

  // 2. 处理登录和登出 (无需登录)
  if (path === '/login') {
    if (request.method === 'POST') {
      const formData = await request.formData();
      const username = formData.get('username');
      const password = formData.get('password');

      // 与Cloudflare环境变量进行比对
      if (username === USER && password === PASSWORD) {
        const sessionId = generateUUID();
        await JTB.put(`session:${sessionId}`, 'true', { expirationTtl: 86400 }); // Session有效期24小时

        const headers = new Headers();
        headers.append('Set-Cookie', `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`);
        headers.append('Location', '/');

        return new Response(null, {
          status: 302,
          headers,
        });
      } else {
        return new Response('用户名或密码错误', { status: 401 });
      }
    }
    // GET请求则显示登录页面
    return new Response(loginPage, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  if (path === '/logout') {
    const cookieHeader = request.headers.get('Cookie') || '';
    const sessionId = (cookieHeader.match(/session_id=([^;]+)/) || [])[1];
    if (sessionId) {
      await JTB.delete(`session:${sessionId}`);
    }
    return new Response(null, {
      status: 302,
      headers: {
        'Set-Cookie': 'session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Location': '/login'
      }
    });
  }

  // 3. 对所有其他路由进行身份验证
  const authenticated = await isAuthenticated(request);
  if (!authenticated) {
    // 如果是API请求，返回401，否则重定向
    if (path.startsWith('/api/')) {
        return new Response('Unauthorized', { status: 401 });
    }
    return Response.redirect(`${url.origin}/login`, 302);
  }

  // --- 从这里开始，都是需要登录后才能访问的受保护路由 ---

  if (path === '/') {
    // 主页
    return new Response(htmlTemplate, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  } else if (path === '/save' && request.method === 'POST') {
    // 保存到云端
    const content = await request.text();
    if (content) {
      await JTB.put("clipboard", content);
      return new Response('好的');
    } else {
      return new Response('内容为空', { status: 400 });
    }
  } else if (path === '/read' && request.method === 'GET') {
    // 从云端读取
    const content = await JTB.get("clipboard");
    if (content) {
      return new Response(content);
    } else {
      return new Response('剪贴板为空', { status: 404 });
    }
  } else if (path === '/manifest.json') {
    return new Response(manifestContent, {
      headers: { 'Content-Type': 'application/json' },
    });
  } else if (path === '/share' && request.method === 'POST') {
    // 创建分享链接
    const content = await JTB.get("clipboard");
    if (!content) {
      return new Response('剪贴板为空', { status: 400 });
    }

    const { maxViews, validMinutes } = await request.json();
    const shareId = generateUUID();
    const expireAt = validMinutes ? Date.now() + validMinutes * 60 * 1000 : null;

    // expirationTtl的单位是秒
    const expirationTtl = validMinutes ? validMinutes * 60 : undefined;

    await JTB.put(shareId, JSON.stringify({ content, maxViews, expireAt, views: 0 }), { expirationTtl });

    const shareUrl = `${url.origin}/s/${shareId}`;
    return new Response(JSON.stringify({ shareUrl }), { headers: { 'Content-Type': 'application/json' }});
  } 
  
  // --- 新增的管理分享链接的API ---
  else if (path === '/api/shares' && request.method === 'GET') {
    const list = await JTB.list();
    let shares = [];
    for (const key of list.keys) {
      // 过滤掉非分享链接的key (例如 session:..., clipboard)
      if (key.name.includes('-') && key.name.length === 36) { // 简单的UUID判断
        const data = await JTB.get(key.name);
        if (data) {
          try {
            const shareData = JSON.parse(data);
            shares.push({
              id: key.name,
              url: `${url.origin}/s/${key.name}`,
              ...shareData
            });
          } catch(e) {
            // 忽略无法解析的脏数据
          }
        }
      }
    }
    // 按创建时间排序（假设时间戳在expireAt中，越大的越新）
    shares.sort((a, b) => (b.expireAt || Infinity) - (a.expireAt || Infinity));
    return new Response(JSON.stringify(shares), { headers: { 'Content-Type': 'application/json' } });
  } 
  else if (path.startsWith('/api/shares/') && request.method === 'DELETE') {
    const shareId = path.substring('/api/shares/'.length);
    await JTB.delete(shareId);
    return new Response('删除成功', { status: 200 });
  } 
  else if (path.startsWith('/api/shares/') && request.method === 'PUT') {
    const shareId = path.substring('/api/shares/'.length);
    const existingData = await JTB.get(shareId);

    if (!existingData) {
        return new Response('分享链接不存在', { status: 404 });
    }

    const updates = await request.json();
    const data = JSON.parse(existingData);

    // 更新数据
    data.maxViews = updates.maxViews ? parseInt(updates.maxViews) : null;
    data.expireAt = updates.validMinutes ? Date.now() + parseInt(updates.validMinutes) * 60 * 1000 : null;
    const expirationTtl = updates.validMinutes ? parseInt(updates.validMinutes) * 60 : undefined;

    await JTB.put(shareId, JSON.stringify(data), { expirationTtl });
    return new Response('更新成功', { status: 200 });
  }


  // 其他未找到的路径返回404
  return new Response('未找到', { status: 404 });
}

/**
 * 检查Cookie中是否存在有效的session
 * @param {Request} request
 */
async function isAuthenticated(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';');
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'session_id' && value) {
        const sessionExists = await JTB.get(`session:${value}`);
        return sessionExists === 'true';
      }
    }
  }
  return false;
}

/**
 * 生成一个UUID
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


/*
 * ============================================================================
 * 前端资源部分
 * ============================================================================
 */

const manifestContent = `{
  "name": "在线剪贴板",
  "short_name": "剪贴板",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f4f4f4",
  "theme_color": "#007bff",
  "icons": [
    {
      "src": "https://img.xwyue.com/i/2025/01/06/677b63d2572db.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "https://img.xwyue.com/i/2025/01/06/677b63d2572db.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}`;

const loginPage = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <title>登录 - 在线剪贴板</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f0f2f5; margin: 0; }
    .login-container { background: white; padding: 2rem 2.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); text-align: center; max-width: 320px; width: 100%; }
    h1 { margin-top: 0; color: #333; }
    form { display: flex; flex-direction: column; }
    input { padding: 0.8rem; margin-bottom: 1rem; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
    button { padding: 0.8rem; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; transition: background-color 0.2s; }
    button:hover { background-color: #0056b3; }
    #errorMessage { color: red; margin-top: 1rem; min-height: 1.2em; }
  </style>
</head>
<body>
  <div class="login-container">
    <h1>登录</h1>
    <form>
      <input type="text" id="username" name="username" placeholder="用户" required>
      <input type="password" id="password" name="password" placeholder="密码" required>
      <button type="submit">登录</button>
    </form>
    <div id="errorMessage"></div>
  </div>
  <script>
    const form = document.querySelector('form');
    const errorMessage = document.getElementById('errorMessage');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      try {
        const response = await fetch('/login', {
          method: 'POST',
          body: formData
        });
        if (response.redirected) { // 检查是否发生重定向
          window.location.href = response.url;
        } else if (response.ok) {
           window.location.href = '/';
        } else {
          const error = await response.text();
          errorMessage.textContent = error;
        }
      } catch (err) {
        errorMessage.textContent = '发生网络错误，请重试。';
      }
    });
  </script>
</body>
</html>
`;

const htmlTemplate = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <title>在线剪贴板</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="https://img.xwyue.com/i/2025/01/06/677b63d2572db.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="在线剪贴板">
  <link rel="apple-touch-icon" href="https://img.xwyue.com/i/2025/01/06/677b63d2572db.png">
  <link rel="manifest" href="/manifest.json">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.0/css/all.min.css">
  <style>
    body {
      font-family: 'Helvetica Neue', 'Arial', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      margin: 0; padding: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      transition: background-color 0.5s ease;
    }
    body.dark-mode { background: linear-gradient(135deg, #333 0%, #222 100%); }
    h1 { color: #2980b9; margin-bottom: 20px; font-size: 2.5em; font-weight: 600; opacity: 0; animation: fadeIn 1s ease-in-out forwards; }
    .dark-mode h1 { color: #74a7d2; }
    @keyframes fadeIn { 0% { opacity: 0; transform: translateY(-20px); } 100% { opacity: 1; transform: translateY(0); } }
    .container {
      background-color: rgba(255, 255, 255, 0.85); border-radius: 15px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
      padding: 40px; width: 80%; max-width: 500px; transition: background-color 0.5s ease;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4' viewBox='0 0 4 4'%3E%3Cpath fill='%239C92AC' fill-opacity='0.1' d='M1 3h1v1H1V3zm2-2h1v1H3V1z'%3E%3C/path%3E%3C/svg%3E");
    }
    .dark-mode .container {
      background-color: rgba(51, 51, 51, 0.85); box-shadow: 0 4px 10px rgba(255, 255, 255, 0.1);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4' viewBox='0 0 4 4'%3E%3Cpath fill='%23CCCCCC' fill-opacity='0.1' d='M1 3h1v1H1V3zm2-2h1v1H3V1z'%3E%3C/path%3E%3C/svg%3E");
    }
    textarea {
      width: calc(100% - 30px); height: 250px; margin-bottom: 20px; padding: 15px; border: none; border-radius: 10px; font-size: 18px;
      resize: vertical; color: #333; box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1); background-color: #fff; overflow: auto;
      transition: box-shadow 0.3s ease;
    }
    .dark-mode textarea { color: #eee; box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.1); background-color: #444; }
    textarea:focus { outline: none; box-shadow: 0 0 5px 2px #2980b9; }
    .dark-mode textarea:focus { box-shadow: 0 0 5px 2px #74a7d2; }
    button {
      background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; border: 1px solid #2980b9; padding: 15px 30px;
      margin: 5px; border-radius: 8px; cursor: pointer; font-size: 18px; transition: all 0.2s ease-in-out; display: flex;
      align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    button:hover { background: linear-gradient(135deg, #2980b9 0%, #3498db 100%); transform: scale(1.05); }
    button:active { transform: scale(0.95); box-shadow: none; }
    button i { margin-right: 10px; font-size: 20px; }
    .button-group { display: flex; justify-content: center; flex-wrap: wrap; }
    .modal {
        display: none; position: fixed; z-index: 100; left: 0; top: 0; width: 100%; height: 100%;
        overflow: auto; background-color: rgba(0, 0, 0, 0.5); animation: fadeIn 0.3s;
    }
    .modal-content {
        background-color: #fefefe; margin: 10% auto; padding: 20px; border: 1px solid #888;
        width: 90%; max-width: 700px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
    }
    .dark-mode .modal-content { background-color: #444; color: #eee; border: 1px solid #666; }
    .close { color: #aaa; float: right; font-size: 28px; font-weight: bold; }
    .close:hover, .close:focus { color: black; text-decoration: none; cursor: pointer; }
    .dark-mode .close:hover, .dark-mode .close:focus { color: white; }
    .modal-content label { display: block; margin-bottom: 5px; }
    .modal-content input, .modal-content button {
        width: calc(100% - 22px); padding: 10px; margin-bottom: 10px; border-radius: 5px; border: 1px solid #ccc;
    }
    .dark-mode .modal-content input { background-color: #333; color: #fff; border: 1px solid #666; }
    .modal-content button {
        width: 100%; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
        color: white; border: none; cursor: pointer;
    }
    #shareLink { margin-top: 10px; word-break: break-all; }
    #logoutBtn { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); border-color: #c0392b; }
    #logoutBtn:hover { background: linear-gradient(135deg, #c0392b 0%, #e74c3c 100%); }
    #manageSharesBtn { background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%); border-color: #27ae60; }
    #manageSharesBtn:hover { background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%); }
    
    #shareListContainer { max-height: 400px; overflow-y: auto; margin-top: 20px; }
    .share-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .share-table th, .share-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    .dark-mode .share-table th, .dark-mode .share-table td { border: 1px solid #666; }
    .share-table th { background-color: #f2f2f2; font-weight: bold; }
    .dark-mode .share-table th { background-color: #555; }
    .share-table .action-btn { font-size: 12px; padding: 5px 10px; margin: 0 2px; border-radius: 4px; }
    .share-table .edit-btn { background: #f39c12; border: none; }
    .share-table .delete-btn { background: #e74c3c; border: none; }
    .share-table a { color: #3498db; text-decoration: none; }
    .dark-mode .share-table a { color: #5dade2; }
    .share-table a:hover { text-decoration: underline; }

    @media (max-width: 768px) {
        .container { padding: 20px; }
        textarea { height: 200px; font-size: 16px; }
        button { padding: 12px 25px; font-size: 16px; width: calc(50% - 10px); }
        h1 { font-size: 2em; }
        .modal-content { width: 95%; margin: 5% auto; }
        .share-table { font-size: 12px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>在线剪贴板</h1>
    <textarea id="clipboard" placeholder="在此处粘贴内容..."></textarea>
    <div class="button-group">
      <button id="saveBtn"><i class="fas fa-cloud-upload-alt"></i>保存</button>
      <button id="readBtn"><i class="fas fa-cloud-download-alt"></i>读取</button>
      <button id="copyBtn"><i class="fas fa-copy"></i>复制</button>
      <button id="shareBtn"><i class="fas fa-share-alt"></i>分享</button>
      <button id="manageSharesBtn"><i class="fas fa-list-check"></i>管理分享</button>
      <button id="logoutBtn"><i class="fas fa-sign-out-alt"></i>登出</button>
    </div>
  </div>

  <div id="shareModal" class="modal">
    <div class="modal-content">
      <span class="close">&times;</span>
      <h2>分享设置</h2>
      <label for="maxViews">最大查看次数 (留空表示无限制):</label>
      <input type="number" id="maxViews" placeholder="例如: 5">
      <label for="validMinutes">有效时间 (分钟，留空表示永久有效):</label>
      <input type="number" id="validMinutes" placeholder="例如: 60">
      <button id="generateShareLink">生成分享链接</button>
      <div id="shareLink"></div>
    </div>
  </div>

  <div id="manageModal" class="modal">
    <div class="modal-content">
        <span class="close">&times;</span>
        <h2>管理分享链接</h2>
        <div id="shareListContainer"></div>
    </div>
  </div>

  <script>
    // --- DOM元素获取 ---
    const clipboardTextarea = document.getElementById('clipboard');
    const saveBtn = document.getElementById('saveBtn');
    const readBtn = document.getElementById('readBtn');
    const copyBtn = document.getElementById('copyBtn');
    const shareBtn = document.getElementById('shareBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const shareModal = document.getElementById('shareModal');
    const generateShareLinkBtn = document.getElementById('generateShareLink');
    const shareLinkDiv = document.getElementById('shareLink');
    const manageSharesBtn = document.getElementById('manageSharesBtn');
    const manageModal = document.getElementById('manageModal');
    const shareListContainer = document.getElementById('shareListContainer');
    
    // --- 统一模态框处理 ---
    document.querySelectorAll('.modal .close').forEach(btn => {
        btn.onclick = () => btn.closest('.modal').style.display = 'none';
    });
    window.onclick = (event) => {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = "none";
        }
    }

    // --- 暗黑模式检测 ---
    function checkDarkMode() {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
    }
    checkDarkMode();
    window.matchMedia('(prefers-color-scheme: dark)').addListener(checkDarkMode);
    
    // --- 核心按钮事件监听 ---
    saveBtn.addEventListener('click', async () => {
      const content = clipboardTextarea.value;
      if (!content) return alert('剪贴板为空！');
      await fetch('/save', { method: 'POST', body: content }).then(res => {
        if (res.ok) alert('已保存到云端！'); else alert('保存失败！');
      });
    });

    readBtn.addEventListener('click', async () => {
      const response = await fetch('/read');
      if (response.ok) clipboardTextarea.value = await response.text();
      else alert('读取失败或剪贴板为空！');
    });

    copyBtn.addEventListener('click', () => {
      if (!clipboardTextarea.value) return alert('内容为空！');
      clipboardTextarea.select();
      document.execCommand('copy');
      alert('已复制到本地剪贴板！');
    });

    logoutBtn.addEventListener('click', () => { window.location.href = '/logout'; });
    
    shareBtn.addEventListener('click', () => {
        document.getElementById('maxViews').value = '';
        document.getElementById('validMinutes').value = '';
        shareLinkDiv.innerHTML = '';
        shareModal.style.display = 'block';
    });

    generateShareLinkBtn.addEventListener('click', async () => {
      const maxViews = document.getElementById('maxViews').value;
      const validMinutes = document.getElementById('validMinutes').value;
      const response = await fetch('/share', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxViews: maxViews ? parseInt(maxViews) : null,
          validMinutes: validMinutes ? parseInt(validMinutes) : null
        })
      });
      if (response.ok) {
        const { shareUrl } = await response.json();
        shareLinkDiv.innerHTML = \`分享链接: <a href="\${shareUrl}" target="_blank">\${shareUrl}</a>\`;
      } else { alert('生成分享链接失败！剪贴板可能为空。'); }
    });

    // --- 新增：管理分享功能 ---
    manageSharesBtn.addEventListener('click', () => {
        manageModal.style.display = 'block';
        loadShareList();
    });

    function formatTimestamp(timestamp) {
        if (!timestamp) return '永久';
        const date = new Date(timestamp);
        if (date < new Date()) return '<strong>已过期</strong>';
        return date.toLocaleString('zh-CN', { hour12: false });
    }

    async function loadShareList() {
        shareListContainer.innerHTML = '<p>加载中...</p>';
        const response = await fetch('/api/shares');
        if (!response.ok) {
            shareListContainer.innerHTML = '<p>加载失败，请重试。</p>';
            return;
        }
        const shares = await response.json();
        if (shares.length === 0) {
            shareListContainer.innerHTML = '<p>暂无分享链接。</p>';
            return;
        }

        const tableHTML = \`
            <table class="share-table">
                <thead>
                    <tr>
                        <th>链接</th>
                        <th>已查看/最大</th>
                        <th>过期时间</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                \${shares.map(share => \`
                    <tr data-id="\${share.id}">
                        <td><a href="\${share.url}" target="_blank">.../\${share.id.substr(-12)}</a></td>
                        <td>\${share.views} / \${share.maxViews || '∞'}</td>
                        <td>\${formatTimestamp(share.expireAt)}</td>
                        <td>
                            <button class="action-btn edit-btn" data-id="\${share.id}">编辑</button>
                            <button class="action-btn delete-btn" data-id="\${share.id}">删除</button>
                        </td>
                    </tr>
                \`).join('')}
                </tbody>
            </table>
        \`;
        shareListContainer.innerHTML = tableHTML;
    }

    shareListContainer.addEventListener('click', async (e) => {
        const target = e.target.closest('.action-btn');
        if (!target) return;
        
        const shareId = target.dataset.id;

        if (target.classList.contains('delete-btn')) {
            if (confirm('确定要删除这个分享链接吗？此操作不可恢复。')) {
                const res = await fetch(\`/api/shares/\${shareId}\`, { method: 'DELETE' });
                if(res.ok) { loadShareList(); } else { alert('删除失败！'); }
            }
        }

        if (target.classList.contains('edit-btn')) {
            const newMaxViews = prompt("请输入新的最大查看次数 (留空或输入0表示无限制):", "");
            if (newMaxViews === null) return; // 用户取消

            const newValidMinutes = prompt("请输入新的有效时间 (分钟，从现在开始计算，留空表示永久):", "");
            if (newValidMinutes === null) return; // 用户取消
            
            const res = await fetch(\`/api/shares/\${shareId}\`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    maxViews: newMaxViews || null,
                    validMinutes: newValidMinutes || null
                })
            });

            if(res.ok) { loadShareList(); } else { alert('更新失败！'); }
        }
    });
  </script>
</body>
</html>
`;
