# Hugging Face 中文化插件 (Hugging Face Chinese Translation)

[![License: GPL v3](https://img.shields.io/badge/License-GPL_v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![GreasyFork](https://img.shields.io/badge/GreasyFork-v1.1.2-red)](https://greasyfork.org/zh-CN/scripts/537528)

这是一个旨在为 [Hugging Face](https://huggingface.co/) 社区用户提供极致流畅中文化体验的 Tampermonkey 用户脚本。

## ⚡ 性能突破：我们是如何做到“零卡顿”的？
Hugging Face 作为一个基于 React/Svelte 构建的现代单页应用 (SPA)，DOM 节点刷新极其频繁。传统翻译脚本在滚动页面时往往会引起严重掉帧。我们采用了最底层的浏览器接口彻底解决了这个问题：

* **`requestIdleCallback` 智能调度：** 脚本放弃了激进的实时翻译，改为只在浏览器 CPU 完全空闲的毫秒级缝隙中进行工作。**你的鼠标滚动和点击优先级永远最高。**
* **原生 `TreeWalker` 引擎：** 抛弃缓慢的 JS 递归，直接调用 C++ 级别的 DOM 文本遍历接口。
* **安全沙盒：** 脚本会自动识别并跳过代码编辑器区 (`contenteditable`、Monaco Editor 等)，绝不污染你的代码输入。
* **正则预检 (Fast-path)：** 在执行高消耗的正则表达式前，增加原生字符串指纹过滤，使循环开销降低 90%。

## 🛠️ 安装指南

1.  **准备环境：** 请确保您的浏览器已安装了用户脚本管理器，例如 [Tampermonkey](https://www.tampermonkey.net/)。
2.  **一键安装：** 前往 [GreasyFork 脚本主页](https://greasyfork.org/zh-CN/scripts/537528) 点击 **安装**。
3.  *(可选) 从 GitHub 源安装：* 点击此仓库中的 `main.user.js`，选择 `Raw` 即可触发管理器安装。

## ⚙️ 进阶功能：正则动态翻译
脚本除了提供静态词汇映射外，还支持动态时间与数量的匹配。
你可以在浏览器扩展菜单中点击 **🟢 开启正则翻译** / **🔴 关闭正则翻译** 自由切换。
* 支持翻译：*“3 days ago”* -> *“3天前”*
* 支持翻译：*“1000 downloads”* -> *“1000次下载”*

## 🤝 参与贡献
欢迎提交 Pull Request 来完善词库！你只需要在 `main.user.js` 中的 `translations` 字典里增加对应的中英文字段即可。

---
*本项目代码维护于 GitHub 仓库：[izhadu/GreasyFork](https://github.com/izhadu/GreasyFork)*