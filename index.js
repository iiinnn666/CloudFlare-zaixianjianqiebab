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
    // 如果未登录，重定向到登录页面
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

    await JTB.put(shareId, JSON.stringify({ content, maxViews, expireAt, views: 0 }), { expirationTtl: validMinutes ? validMinutes * 60 : undefined });

    const shareUrl = `${url.origin}/s/${shareId}`;
    return new Response(JSON.stringify({ shareUrl }));
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
      if (name === 'session_id') {
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
        if (response.ok) {
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
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      transition: background-color 0.5s ease;
    }
    body.dark-mode {
      background: linear-gradient(135deg, #333 0%, #222 100%);
    }
    h1 {
      color: #2980b9;
      margin-bottom: 20px;
      font-size: 2.5em;
      font-weight: 600;
      opacity: 0;
      animation: fadeIn 1s ease-in-out forwards;
    }
    .dark-mode h1 {
      color: #74a7d2;
    }
    .container {
      background-color: rgba(255, 255, 255, 0.85);
      border-radius: 15px;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
      padding: 40px;
      width: 80%;
      max-width: 500px;
      transition: background-color 0.5s ease;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4' viewBox='0 0 4 4'%3E%3Cpath fill='%239C92AC' fill-opacity='0.1' d='M1 3h1v1H1V3zm2-2h1v1H3V1z'%3E%3C/path%3E%3C/svg%3E");
    }
    .dark-mode .container {
      background-color: rgba(51, 51, 51, 0.85);
      box-shadow: 0 4px 10px rgba(255, 255, 255, 0.1);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4' viewBox='0 0 4 4'%3E%3Cpath fill='%23CCCCCC' fill-opacity='0.1' d='M1 3h1v1H1V3zm2-2h1v1H3V1z'%3E%3C/path%3E%3C/svg%3E");
    }
    textarea {
      width: calc(100% - 30px);
      height: 250px;
      margin-bottom: 20px;
      padding: 15px;
      border: none;
      border-radius: 10px;
      font-size: 18px;
      resize: vertical;
      color: #333;
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
      background-color: #fff;
      overflow: auto;
      transition: box-shadow 0.3s ease;
    }
    .dark-mode textarea {
      color: #eee;
      box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.1);
      background-color: #444;
    }
    textarea:focus {
      outline: none;
      box-shadow: 0 0 5px 2px #2980b9;
    }
    .dark-mode textarea:focus {
      box-shadow: 0 0 5px 2px #74a7d2;
    }
    button {
      background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
      color: white;
      border: 1px solid #2980b9;
      padding: 15px 30px;
      margin: 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 18px;
      transition: all 0.2s ease-in-out;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    button:hover {
      background: linear-gradient(135deg, #2980b9 0%, #3498db 100%);
      transform: scale(1.05);
    }
    button:active {
      transform: scale(0.95);
      box-shadow: none;
    }
    button i {
      margin-right: 10px;
      font-size: 20px;
    }
    .button-group {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
    }
    @media (max-width: 768px) {
      .container { padding: 20px; }
      textarea { height: 200px; font-size: 16px; }
      button { padding: 12px 25px; font-size: 16px; }
      h1 { font-size: 2em; }
    }
    ::-webkit-scrollbar { width: 10px; }
    ::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 10px; }
    ::-webkit-scrollbar-thumb { background: #888; border-radius: 10px; }
    ::-webkit-scrollbar-thumb:hover { background: #555; }
    .dark-mode ::-webkit-scrollbar-track { background: #333; }
    .dark-mode ::-webkit-scrollbar-thumb { background: #666; }
    .dark-mode ::-webkit-scrollbar-thumb:hover { background: #999; }
    .loading { position: relative; }
    .loading::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: 4px solid #fff;
      border-color: #fff transparent #fff transparent;
      animation: loading 1.2s linear infinite;
    }
    @keyframes loading {
      0% { transform: translate(-50%, -50%) rotate(0deg); }
      100% { transform: translate(-50%, -50%) rotate(360deg); }
    }
    .dark-mode .loading::after { border-color: #eee transparent #eee transparent; }
    @keyframes fadeIn {
      0% { opacity: 0; transform: translateY(-20px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .modal {
      display: none; position: fixed; z-index: 1; left: 0; top: 0; width: 100%; height: 100%;
      overflow: auto; background-color: rgba(0, 0, 0, 0.4);
    }
    .modal-content {
      background-color: #fefefe; margin: 15% auto; padding: 20px; border: 1px solid #888;
      width: 80%; max-width: 400px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
    }
    .dark-mode .modal-content { background-color: #444; color: #eee; border: 1px solid #666; }
    .close { color: #aaa; float: right; font-size: 28px; font-weight: bold; }
    .close:hover, .close:focus { color: black; text-decoration: none; cursor: pointer; }
    .dark-mode .close:hover, .dark-mode .close:focus { color: white; }
    .modal-content label { display: block; margin-bottom: 5px; }
    .modal-content input, .modal-content button {
      width: calc(100% - 20px); padding: 10px; margin-bottom: 10px; border-radius: 5px; border: 1px solid #ccc;
    }
    .dark-mode .modal-content input { background-color: #333; color: #fff; border: 1px solid #666; }
    .modal-content button {
      width: 100%; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
      color: white; border: none; cursor: pointer;
    }
    .modal-content button:hover { background: linear-gradient(135deg, #2980b9 0%, #3498db 100%); }
    #shareLink { margin-top: 10px; word-break: break-all; }
    #logoutBtn { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); border-color: #c0392b; }
    #logoutBtn:hover { background: linear-gradient(135deg, #c0392b 0%, #e74c3c 100%); }
  </style>
</head>
<body>
  <div class="container">
    <h1>在线剪贴板</h1>
    <textarea id="clipboard" placeholder="在此处粘贴内容..."></textarea>
    <div class="button-group">
      <button id="saveBtn"><i class="fas fa-cloud-upload-alt"></i>保存到云端</button>
      <button id="readBtn"><i class="fas fa-cloud-download-alt"></i>从云端读取</button>
      <button id="copyBtn"><i class="fas fa-copy"></i>复制到本地</button>
      <button id="shareBtn"><i class="fas fa-share-alt"></i>分享</button>
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
  <script>
    const clipboardTextarea = document.getElementById('clipboard');
    const saveBtn = document.getElementById('saveBtn');
    const readBtn = document.getElementById('readBtn');
    const copyBtn = document.getElementById('copyBtn');
    const shareBtn = document.getElementById('shareBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const shareModal = document.getElementById('shareModal');
    const closeModalBtn = document.querySelector('.close');
    const generateShareLinkBtn = document.getElementById('generateShareLink');
    const shareLinkDiv = document.getElementById('shareLink');

    function checkDarkMode() {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
    }
    checkDarkMode();
    window.matchMedia('(prefers-color-scheme: dark)').addListener(checkDarkMode);

    saveBtn.addEventListener('click', async () => {
      const content = clipboardTextarea.value;
      if (content) {
        saveBtn.classList.add('loading');
        const response = await fetch('/save', { method: 'POST', body: content });
        saveBtn.classList.remove('loading');
        if (response.ok) {
          alert('已保存到云端！');
        } else {
          alert('保存失败！');
        }
      } else {
        alert('剪贴板为空！');
      }
    });

    readBtn.addEventListener('click', async () => {
      readBtn.classList.add('loading');
      const response = await fetch('/read');
      readBtn.classList.remove('loading');
      if (response.ok) {
        const content = await response.text();
        clipboardTextarea.value = content;
      } else {
        alert('读取失败或剪贴板为空！');
      }
    });

    copyBtn.addEventListener('click', () => {
      clipboardTextarea.select();
      document.execCommand('copy');
      alert('已复制到本地剪贴板！');
    });

    shareBtn.addEventListener('click', () => {
      shareModal.style.display = 'block';
    });
    
    logoutBtn.addEventListener('click', () => {
        window.location.href = '/logout';
    });

    closeModalBtn.addEventListener('click', () => {
      shareModal.style.display = 'none';
    });

    generateShareLinkBtn.addEventListener('click', async () => {
      const maxViews = document.getElementById('maxViews').value;
      const validMinutes = document.getElementById('validMinutes').value;

      const response = await fetch('/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          maxViews: maxViews ? parseInt(maxViews) : null,
          validMinutes: validMinutes ? parseInt(validMinutes) : null
        })
      });

      if (response.ok) {
        const { shareUrl } = await response.json();
        shareLinkDiv.innerHTML = \`分享链接: <a href="\${shareUrl}" target="_blank">\${shareUrl}</a>\`;
      } else {
        alert('生成分享链接失败！');
      }
    });

    window.onclick = function(event) {
      if (event.target == shareModal) {
        shareModal.style.display = "none";
      }
    }
  </script>
</body>
</html>
`;
