addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/') {
    // 主页，提供 HTML 界面
    return new Response(htmlTemplate, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  } else if (path === '/save' && request.method === 'POST') {
    // 保存剪贴板内容
    const content = await request.text();
    if (content) {
      await JTB.put("clipboard", content); // 使用 "clipboard" 作为固定的键名
      return new Response('好的');
    } else {
      return new Response('内容为空', { status: 400 });
    }
  } else if (path === '/read' && request.method === 'GET') {
    // 读取剪贴板内容
    const content = await JTB.get("clipboard"); // 使用 "clipboard" 作为固定的键名
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
    // 分享剪贴板内容
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
  } else if (path.startsWith('/s/') && request.method === 'GET') {
    // 查看分享的剪贴板内容
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

    // 更新查看次数
    await JTB.put(shareId, JSON.stringify({ content, maxViews, expireAt, views: views + 1 }));

    return new Response(content);
  }

  // 其他路径返回 404
  return new Response('未找到', { status: 404 });
}

// 生成 UUID
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

const htmlTemplate = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <title>在线剪贴板</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="https://img.xwyue.com/i/2025/01/06/677b63d2572db.png">

  <!-- iOS 添加到主屏幕的相关设置 -->
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
      transition: box-shadow 0.3s ease; /* 添加过渡效果 */
    }
    .dark-mode textarea {
      color: #eee;
      box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.1);
      background-color: #444;
    }
    textarea:focus {
      outline: none;
      box-shadow: 0 0 5px 2px #2980b9; /* 聚焦时添加更明显的阴影 */
    }
    .dark-mode textarea:focus {
      box-shadow: 0 0 5px 2px #74a7d2; /* 暗黑模式聚焦时添加更明显的阴影 */
    }
    button {
      background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
      color: white;
      border: 1px solid #2980b9; /* 添加细边框 */
      padding: 15px 30px;
      margin: 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 18px;
      transition: all 0.2s ease-in-out; /* 更快的过渡 */
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); /* 移除悬停时的阴影 */
    }
    button:hover {
      background: linear-gradient(135deg, #2980b9 0%, #3498db 100%);
      transform: scale(1.05); /* 放大效果 */
    }
    button:active {
      transform: scale(0.95); /* 点击时缩小 */
      box-shadow: none;
    }
    button i {
      margin-right: 10px;
      font-size: 20px; /* 增大图标 */
    }
    .button-group {
      display: flex;
      justify-content: center;
    }

    /* 媒体查询：针对小屏幕设备 (例如手机) */
    @media (max-width: 768px) {
      .container {
        padding: 20px;
      }
      textarea {
        height: 200px;
        font-size: 16px;
      }
      button {
        padding: 12px 25px;
        font-size: 16px;
      }
      h1 {
        font-size: 2em;
      }
      .button-group{
        flex-wrap: wrap;
      }
    }

    /* 自定义滚动条 */
    ::-webkit-scrollbar {
      width: 10px;
    }
    ::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 10px;
    }
    ::-webkit-scrollbar-thumb {
      background: #888;
      border-radius: 10px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #555;
    }
    .dark-mode ::-webkit-scrollbar-track {
      background: #333;
    }
    .dark-mode ::-webkit-scrollbar-thumb {
      background: #666;
    }
    .dark-mode ::-webkit-scrollbar-thumb:hover {
      background: #999;
    }

    /* 加载动画 */
    .loading {
      position: relative;
    }
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
      0% {
        transform: translate(-50%, -50%) rotate(0deg);
      }
      100% {
        transform: translate(-50%, -50%) rotate(360deg);
      }
    }
    .dark-mode .loading::after {
      border-color: #eee transparent #eee transparent;
    }

    /* 标题动画 */
    @keyframes fadeIn {
      0% {
        opacity: 0;
        transform: translateY(-20px);
      }
      100% {
        opacity: 1;
        transform: translateY(0);
      }
    }
    /*分享*/
    .modal {
      display: none;
      position: fixed;
      z-index: 1;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      overflow: auto;
      background-color: rgba(0, 0, 0, 0.4);
    }
    .modal-content {
      background-color: #fefefe;
      margin: 15% auto;
      padding: 20px;
      border: 1px solid #888;
      width: 80%;
      max-width: 400px;
      border-radius: 10px;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
    }
    .dark-mode .modal-content {
      background-color: #444;
      color: #eee;
      border: 1px solid #666;
    }
    .close {
      color: #aaa;
      float: right;
      font-size: 28px;
      font-weight: bold;
    }
    .close:hover,
    .close:focus {
      color: black;
      text-decoration: none;
      cursor: pointer;
    }
    .dark-mode .close:hover,
    .dark-mode .close:focus {
      color: white;
    }
    .modal-content label {
      display: block;
      margin-bottom: 5px;
    }
    .modal-content input,
    .modal-content button {
      width: calc(100% - 20px);
      padding: 10px;
      margin-bottom: 10px;
      border-radius: 5px;
      border: 1px solid #ccc;
    }
    .dark-mode .modal-content input {
        background-color: #333;
        color: #fff;
        border: 1px solid #666;
    }
    .modal-content button {
      width: 100%;
      background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
      color: white;
      border: none;
      cursor: pointer;
    }
    .modal-content button:hover {
      background: linear-gradient(135deg, #2980b9 0%, #3498db 100%);
    }
    #shareLink {
      margin-top: 10px;
      word-break: break-all;
    }
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
    const shareModal = document.getElementById('shareModal');
    const closeModalBtn = document.querySelector('.close');
    const generateShareLinkBtn = document.getElementById('generateShareLink');
    const shareLinkDiv = document.getElementById('shareLink');

    // 自动检测暗黑模式
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
        saveBtn.classList.add('loading'); // 添加 loading 类
        const response = await fetch('/save', { method: 'POST', body: content });
        saveBtn.classList.remove('loading'); // 移除 loading 类
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
      readBtn.classList.add('loading'); // 添加 loading 类
      const response = await fetch('/read');
      readBtn.classList.remove('loading'); // 移除 loading 类
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
