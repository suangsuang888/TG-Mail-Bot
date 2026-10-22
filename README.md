# TG-Mail-Bot
基于 Cloudflare Workers 的无服务器邮件转发系统，支持 Telegram Web App 图文渲染与多邮箱智能分拣

# Cloudflare Email to Telegram Bot 🚀

这是一个基于 Cloudflare Workers 构建的轻量级、无服务器（Serverless）邮件转发系统。它可以将发往你自定义域名的邮件，秒级推送到指定的 Telegram 机器人，并完美支持带图片的 HTML 富文本邮件渲染。

## ✨ 核心特性

- **⚡ 秒级实时推送**：基于 Cloudflare Email Routing，无需定时轮询。
- **📱 Web App 内联阅读**：利用 Telegram Web App 直接在聊天窗口内渲染完整的 HTML 邮件和内嵌图片，并支持一键 Google 翻译。
- **🔀 智能多路由分拣**：支持配置多别名（Alias）数组，精准识别真实收件人，彻底解决历史邮件转发带来的“抢单/截胡”问题。
- **🀄 动态编码修复**：内置强大的字符集识别引擎，完美解决国内邮箱（如 QQ、网易）发送 GBK/GB2312 编码导致的中文乱码问题。

## 🛠️ 部署指南

### 1. 准备工作
- 一个托管在 Cloudflare 的域名，并开启 **电子邮件路由 (Email Routing)** 的“全收 (Catch-all)”规则。
- 一个用于永久存储邮件网页的 **Cloudflare R2 存储桶**。
- 在 Telegram 申请好的 Bot Token 以及你自己的 Chat ID。

### 2. 配置 Worker
1. 在 Cloudflare 创建一个新的 Worker，将本项目中的 `worker.js` 代码粘贴进去。
2. 在代码顶部的 `ROUTING_TABLE` 中配置你的专属分发规则。
3. 进入 Worker 的 **设置 -> 绑定**，添加以下配置：
   - **R2 存储桶绑定**：变量名设为 `R2_BUCKET`。
4. 进入 Worker 的 **设置 -> 变量和机密**，添加兜底环境变量：
   - `TG_BOT_TOKEN`: 你的主机器人 Token。
   - `TG_CHAT_ID`: 你的接收 Chat ID。
   - `WORKER_URL`: 你的 Worker 绑定的自定义访问域名（例如 `https://mail.example.com`）。

### 3. 触发器设置
- 在 Worker 的“触发器”选项卡中，添加一个 **自定义域** 用于访问 Web App 网页。
- 在 Cloudflare 域名的“电子邮件路由”规则中，将“全收”操作指向此 Worker。
