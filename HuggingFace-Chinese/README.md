# HuggingFace 汉化

[![License: GPL v3](https://img.shields.io/badge/License-GPL_v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![GreasyFork](https://img.shields.io/badge/GreasyFork-v1.1.2-red)](https://greasyfork.org/zh-CN/scripts/537528)

这是一个旨在为 [Hugging Face](https://huggingface.co/) 社区用户提供极致流畅中文化体验的 Tampermonkey 用户脚本。

## ⚡ 性能突破：我们是如何做到“零卡顿”的？
Hugging Face 作为一个基于 React/Svelte 构建的现代单页应用 (SPA)，DOM 节点刷新极其频繁。传统翻译脚本在滚动页面时往往会引起严重掉帧。我们在架构与底层 API 调用上进行了深度优化，彻底解决了这个问题：

* **`requestAnimationFrame` 时间切片：** 放弃阻塞式的实时翻译，采用时间切片（Time Slicing）机制，将翻译任务拆分并限制在每帧的规定时间内执行。**确保你的鼠标滚动和点击交互永远保持最高优先级。**
* **单遍 `TreeWalker` 引擎：** 抛弃缓慢的 `querySelectorAll` 与 JS 递归，将属性提取与文本探测合并到一次 C++ 级别的 DOM 树遍历中完成，大幅降低 DOM 操作开销。
* **内存与 GC 极致优化：** 延迟所有字符串的降级转换（如 `.toLowerCase()`），并在 `MutationObserver` 引入动态标记清除机制，拦截无效文本的重复遍历，极大地缓解了浏览器的垃圾回收（GC）压力。
* **安全沙盒与属性预检：** 自动跳过代码编辑器区，且利用 `hasAttribute` 预检降低了对大量元素的无用属性读取。

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
欢迎提交 Pull Request 来完善词库！你只需要修改本仓库中的 `dict.json` 文件，增加对应的中英文字段即可（系统会自动分发更新）。

---
*本项目代码维护于 GitHub 仓库：[izhadu/GreasyFork](https://github.com/izhadu/GreasyFork)*