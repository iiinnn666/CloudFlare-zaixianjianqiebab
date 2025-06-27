

# 在线剪贴板 - 基于 Cloudflare Workers

这是一个简单而美观的在线剪贴板，使用 Cloudflare Workers 和 KV 存储构建。它允许您在不同设备之间轻松复制和粘贴文本，并提供了安全的分享功能。

## 功能特性

*   **多设备同步:**  随时随地访问您的剪贴板内容，只需一个浏览器。
*   **美观的 UI:**  精心设计的界面，支持自动暗黑模式，提供舒适的视觉体验。
*   **安全分享:**  生成带有自定义查看次数和有效期的分享链接，方便且安全地与他人共享剪贴板内容。
*   **快速便捷:**  支持一键保存、读取和复制，操作简单高效。
*   **响应式设计:**  完美适配 PC 端和移动端，提供一致的用户体验。
*   **持久化存储:**  利用 Cloudflare KV 存储数据，确保您的剪贴板内容持久保存。
*   **隐私保护:**  支持链接过期和查看次数限制, 不会在服务器永久储存你的剪切板信息。

## 技术栈

*   **Cloudflare Workers:**  用于构建无服务器应用程序。
*   **Cloudflare KV:**  用于存储剪贴板数据和分享链接配置。
*   **HTML, CSS, JavaScript:**  构建用户界面和交互逻辑。
*   **Font Awesome:**  提供图标字体。

## 部署

1. **创建 Cloudflare Workers 项目:**
    *   登录 Cloudflare 控制台。
    *   导航到 "Workers & Pages"。
    *   点击 "Create application"。
    *   选择 "Create Worker"。
    *   为您的 Worker 命名，例如 "online-clipboard"。
    *   选择一个入门模板（例如 "Hello World"）。
    *   点击 "Create Worker"。

2. **绑定 KV 命名空间:**
    *   在 Worker 的设置页面，找到 "Settings" 标签页。
    *   选择 "Variables"。
    *   在 "KV Namespace Bindings" 部分，点击 "Add binding"。
    *   **Variable name:** 输入 `JTB`。
    *   **KV namespace:** 选择您已经创建好的 KV 命名空间，或者点击 "Create a namespace" 新建一个，并命名为 `JTB` (或其他您喜欢的名称)。
    *   点击 "Save"。

2. **变量和机密:**
    *   在 Worker 的设置页面，找到 "变量和机密" 
    *   点击添加
    *   类型选择文本。
    *   **变量名称:** 输入 `USER` 为登录用户名。
    *   **变量名称:** 输入 `PASSWORD` 为登录密码。
    *   点击 "保存"。
    *   
4. **复制代码并部署:**
    *   在 Worker 的 "Quick edit" 页面。
    *   将`index.js`的代码完全替换原有的代码。
    *   点击 "Save and deploy"。

## 使用方法

1. 访问您的 Worker URL。
2. 在文本框中粘贴您想要保存的内容。
3. 点击 "保存到云端" 按钮。
4. 在其他设备上访问相同的 URL，点击 "从云端读取" 按钮即可同步剪贴板内容。
5. 点击 "复制到本地" 按钮可将文本框内容复制到本地剪贴板。
6. 点击 "分享" 按钮可生成分享链接，并设置查看次数和有效期。

