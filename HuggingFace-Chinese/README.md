# HuggingFace 汉化（词库 + AI/多源在线翻译版）

[![License: GPL v3](https://img.shields.io/badge/License-GPL_v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![GreasyFork](https://img.shields.io/badge/GreasyFork-v7.0.0-orange)](https://greasyfork.org/zh-CN/scripts/574934)

一款专为 [Hugging Face](https://huggingface.co/)（及 `hf-mirror.com` 镜像站）打造的**双引擎中文化用户脚本**：界面高频术语采用**本地词库 0 延迟精准翻译**，长句、模型/数据集卡片（README）、论文摘要与讨论区支持 **AI 大模型（OpenAI 兼容接口）及多翻译源自动兜底**。

---

## ✨ 核心特性

### 1. 双层混合翻译架构
* **第一层：零请求本地词库 + 动态规则引擎**
  * 覆盖导航栏、筛选器、排序菜单、模型/数据集/Spaces/存储桶（Buckets）、设置、账单、MCP 服务器等全站高频界面术语（1890+ 精校词条 & 110+ 动态正则）。
  * 内置**末尾标点自动回填**（自动兼容 `:`、`...`、`…` 变体）、**前缀递归翻译**（`Sort: ...`、`Updated ...`、`Created ...`）及**多格式日期汉化**（如 `8 Jun 2026` → `2026年6月8日`、`Updated about 3 days ago` → `更新于 大约 3 天前`）。
* **第二层：AI 大模型 + 8 大在线翻译源智能兜底**
  * **AI 翻译优先**：支持接入 **硅基流动 (SiliconFlow)**、**智谱 GLM**、**DeepSeek**、**OpenAI** 等任意 OpenAI 兼容接口（`/chat/completions`），针对 AI/ML 领域定制提示词，自动保留 `PyTorch`、`Safetensors`、`GGUF`、`LoRA`、`ZeroGPU` 等技术术语不误翻。
  * **多源自动熔断与切换**：内置 `AI → 百度 API → 腾讯云 TMT → 腾讯交互翻译 → 必应/Edge → 有道 → Google → MyMemory` 优先级链；无需配置 Key 即可直接使用免费源，单一源连续失败 2 次自动熔断冷却 5 分钟并无缝切换备用源。
  * **批量合并与持久化缓存**：自动按批次（最多 20 条 / 2200 字符）合并请求防限流，并将译文持久化缓存至本地（上限 5000 条），二次浏览 0 请求秒出。

### 2. 页面内「🌐 AI 翻译卡片正文」按需开关
* 默认保护 `.prose` / `.markdown-body`（模型卡、数据集卡、论文正文）不自动机翻，保持专业阅读体验。
* 在卡片顶部自动注入 **「🌐 AI 翻译卡片正文」** 胶囊按钮：
  * **点击开启**：调用已配置的 AI 或在线翻译源批量翻译正文。
  * **再次点击**：无需刷新页面，立即从内存快照 **100% 还原英文原文**。

### 3. ⚡ 极致性能：真正“零卡顿”
* **`requestAnimationFrame` 时间切片（Time Slicing）**：将 DOM 翻译任务严格限制在每帧 `12ms` 时间预算内执行，超时自动让出主线程，确保页面滚动与点击交互永远保持最高优先级。
* **单遍 `TreeWalker` + `WeakMap` 防环缓存**：在一次 C++ 级 DOM 遍历中同时完成节点筛选与属性提取；通过 `WeakMap` 记录已写入的节点值，彻底消除 `MutationObserver` 自我触发引起的重扫与死循环。
* **严格的安全沙盒与专有名词保护**：自动跳过代码块（`pre` / `code` / Monaco / CodeMirror / Shiki / Highlight.js）、搜索下拉框、面包屑路径；单个英文单词、版本号、URL、`owner/repo` 仓库标识符绝不送入在线机翻。

---

## 🛠️ 安装指南

1. **安装脚本管理器**：请确保浏览器已安装 [Tampermonkey](https://www.tampermonkey.net/) 或 Violentmonkey。
2. **一键安装**：前往 [GreasyFork 脚本主页](https://greasyfork.org/zh-CN/scripts/574934) 点击 **安装**。
3. **从 GitHub 源安装（可选）**：打开本仓库中的 [`main.user.js`](https://github.com/izhadu/GreasyFork/raw/main/HuggingFace-Chinese/main.user.js) 即可触发安装。

---

## ⚙️ 菜单设置与快捷键

点击浏览器扩展栏中的 Tampermonkey 图标，即可使用以下功能：

| 菜单项 / 快捷键 | 功能说明 |
| :--- | :--- |
| **`① 在线/AI 兜底翻译 [Alt+T]`** | 开启/关闭未命中长句的在线与 AI 兜底翻译（快捷键 **`Alt + T`** 一键切换并还原） |
| **`② 正则动态翻译`** | 开启/关闭相对时间、数量统计等动态正则匹配 |
| **`③ 设置 AI 翻译`** | 配置 OpenAI 兼容接口（Base URL、API Key、模型名，如 `Qwen/Qwen2.5-7B-Instruct`、`glm-4-flash`、`deepseek-chat`） |
| **`④ 设置百度翻译`** | 配置百度翻译开放平台 `APPID` 与密钥 |
| **`⑤ 设置腾讯云机器翻译`** | 配置腾讯云 TMT `SecretId`、`SecretKey` 与地域 |
| **`⑥ 清空在线/AI 翻译缓存`** | 一键清除本地持久化的在线翻译缓存 |
| **`⑦ 清空所有自定义翻译密钥`** | 清除本地保存的所有第三方 API Key |
| **`🔄 立即更新本地汉化词库`** | 强制从远程主备源拉取最新 `dict.json` 并热重载生效 |

---

## 🤝 参与贡献

欢迎提交 Issue 或 Pull Request 来完善精准词库！
你只需编辑本仓库中的 [`dict.json`](https://github.com/izhadu/GreasyFork/blob/main/HuggingFace-Chinese/dict.json) 文件，新增或修正中英文字段（客户端每 6 小时自动静默检查更新，也可通过菜单手动立即更新）。

---
*本项目代码维护于 GitHub 仓库：[izhadu/GreasyFork](https://github.com/izhadu/GreasyFork)*
