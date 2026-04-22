// ==UserScript==
// @name         Hugging Face 中文化插件
// @namespace    https://github.com/izhadu/GreasyFork
// @description  中文化 Hugging Face 界面菜单及内容，采用底层 TreeWalker 与 requestIdleCallback 优化，并支持讯飞 API 自动排队长文本翻译。
// @copyright    2026, izhadu
// @icon         https://huggingface.co/front/assets/huggingface_logo-noborder.svg
// @version      1.2.2
// @author       izhadu
// @license      GPL-3.0
// @match        https://huggingface.co/*
// @match        https://*.huggingface.co/*
// @match        https://hf-mirror.com/*
// @match        https://*.hf.space/*
// @match        https://hf.space/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      www.iflyrec.com
// @supportURL   https://github.com/izhadu/GreasyFork/issues
// ==/UserScript==

(function () {
    'use strict';

    // ================= 1. 静态词库配置 =================
    const translations = {
        // 导航栏
        "Models": "模型", "Datasets": "数据集", "Spaces": "空间", "Docs": "文档",
        "Solutions": "解决方案", "Pricing": "价格", "Sign in": "登录", "Sign Up": "注册",
        "Search": "搜索", "Blog": "博客", "Enterprise": "企业版", "Login": "登录",
        "Profile": "个人资料", "Settings": "设置", "Logout": "退出登录", "Notifications": "通知", "Help": "帮助",

        // 侧边栏和筛选器
        "Filters": "筛选器", "All": "全部", "Text": "文本", "Image": "图像", "Audio": "音频",
        "Video": "视频", "Multimodal": "多模态", "Table": "表格", "Fill-Mask": "掩码填充",
        "Token Classification": "标记分类", "Text Generation": "文本生成", "Text2Text Generation": "文本到文本生成",
        "Summarization": "摘要生成", "Conversational": "对话", "Feature Extraction": "特征提取",
        "Translation": "翻译", "Multiple Choice": "多项选择", "Text Classification": "文本分类",
        "Question Answering": "问答", "Sentence Similarity": "句子相似度", "Zero-Shot Classification": "零样本分类",
        "Audio-Text-to-Text": "音频文本转文本", "Image-Text-to-Text": "图像文本转文本",
        "Visual Question Answering": "视觉问答", "Document Question Answering": "文档问答",
        "Video-Text-to-Text": "视频文本转文本", "Visual Document Retrieval": "视觉文档检索",
        "Any-to-Any": "任意到任意", "Computer Vision": "计算机视觉", "Depth Estimation": "深度估计",
        "Image Classification": "图像分类", "Object Detection": "目标检测", "Image Segmentation": "图像分割",
        "Text-to-Image": "文本到图像", "Image-to-Text": "图像到文本", "Image-to-Image": "图像到图像",
        "Image-to-Video": "图像到视频", "Unconditional Image Generation": "无条件图像生成",
        "Video Classification": "视频分类", "Text-to-Video": "文本到视频", "Zero-Shot Image Classification": "零样本图像分类",
        "Mask Generation": "掩码生成", "Zero-Shot Object Detection": "零样本目标检测",
        "Text-to-3D": "文本到3D", "Image-to-3D": "图像到3D", "Image Feature Extraction": "图像特征提取",
        "Keypoint Detection": "关键点检测", "Natural Language Processing": "自然语言处理",
        "Table Question Answering": "表格问答", "Text Ranking": "文本排序", "Text-to-Speech": "文本到语音",
        "Text-to-Audio": "文本到音频", "Automatic Speech Recognition": "自动语音识别",
        "Audio-to-Audio": "音频到音频", "Audio Classification": "音频分类", "Voice Activity Detection": "语音活动检测",
        "Tabular": "表格数据", "Tabular Classification": "表格分类", "Tabular Regression": "表格回归",
        "Time Series Forecasting": "时间序列预测", "Reinforcement Learning": "强化学习",
        "Robotics": "机器人学", "Other": "其他", "Graph Machine Learning": "图机器学习",

        // 按钮和操作
        "Load more": "加载更多", "Subscribe": "订阅", "Download": "下载", "Upload": "上传",
        "Create": "创建", "Sign Out": "退出登录", "Cancel": "取消", "Confirm": "确认",
        "Delete": "删除", "Edit": "编辑", "Save": "保存", "Close": "关闭", "Back": "返回",
        "Next": "下一步", "Previous": "上一步", "Continue": "继续", "Submit": "提交",
        "Copy": "复制", "Share": "分享", "Like": "点赞", "Unlike": "取消点赞",
        "Follow": "关注", "Unfollow": "取消关注", "View": "查看", "Hide": "隐藏",
        "Show more": "显示更多", "Show less": "显示较少", "Expand": "展开", "Collapse": "收起",

        // 模型与空间相关
        "Model card": "模型卡片", "Files and versions": "文件与版本", "Community": "社区",
        "Training metrics": "训练指标", "Training logs": "训练日志", "Deploy": "部署",
        "Use in Transformers": "在Transformers中使用", "Hosted inference API": "托管推理API",
        "Contributors": "贡献者", "Licenses": "许可证", "Likes": "点赞数", "Downloads": "下载量",
        "Tasks": "任务类型", "Languages": "语言类型", "Main": "主要", "Libraries": "模型库",
        "Duplicate this Space": "复制此空间", "Embed this Space": "嵌入此空间", "App": "应用",
        "Files": "文件", "Sessions": "会话", "Hardware": "硬件", "Storage": "存储",
        "Variables": "变量", "Logs": "日志",

        // 空间设置页补充
        "Space Hardware": "空间硬件",
        "Choose a hardware for your Space.": "为您的空间选择硬件。",
        "You'll be billed on a per minute basis.": "您将按分钟计费。",
        "View usage in your billing settings.": "在计费设置中查看使用情况。",
        "Sleep time settings": "休眠时间设置",
        "Sleep after": "在此时间后休眠",
        "of inactivity": "无活动",
        "Upgrade to a paid Hardware to set a custom sleep time.": "升级到付费硬件以设置自定义休眠时间。",
        "Pause Space": "暂停空间",
        "Building something cool as a side project?": "正在将其作为业余项目构建一些很酷的东西？",
        "Apply for a community GPU grant.": "申请社区 GPU 资助。",
        "Restart this Space": "重启此空间",
        "Click this button to trigger a restart of your Space.": "点击此按钮以触发空间的重启。",
        "Restart space": "重启空间",
        "Factory rebuild": "恢复出厂构建",
        "CPU basic": "基础 CPU",
        "CPU upgrade": "升级 CPU",
        "Current": "当前",
        "Free": "免费",

        // 文档、主页与列表页
        "On this page": "本页内容", "Table of contents": "目录", "Getting Started": "入门指南",
        "Tutorials": "教程", "Conceptual Guides": "概念指南", "How-to Guides": "操作指南", "API Documentation": "API文档",
        "Collections": "收藏集", "Organizations": "组织", "Posts": "帖子", "Daily Papers": "每日论文",
        "Learn": "学习", "Discord": "Discord社区", "Forum": "论坛", "Github": "GitHub",
        "Enterprise Hub": "企业中心", "Expert Support": "专家支持", "Inference Endpoints": "推理端点",
        "Inbox": "收件箱", "New Model": "新建模型", "New Dataset": "新建数据集", "New Space": "新建空间",
        "New Collection": "新建收藏集", "Create organization": "创建组织", "Usage Quota": "使用配额",
        "Private Storage": "私有存储", "Public Storage": "公共存储", "Zero GPU": "零GPU",
        "Inference Usage": "推理使用量", "Subscribe to PRO": "订阅PRO版", "Access Tokens": "访问令牌",
        "Billing": "账单", "Changelog": "更新日志", "AI & ML interests": "AI与ML兴趣",
        "Recent Activity": "最近活动", "Account": "账户", "Authentication": "认证",
        "SSH and GPG Keys": "SSH和GPG密钥", "Inference Providers": "推理提供商", "Webhooks": "Webhooks",
        "Papers": "论文", "Local Apps and Hardware": "本地应用与硬件", "Gated Repositories": "受限仓库",
        "Content Preferences": "内容偏好", "Connected Apps": "已连接应用", "Theme": "主题",
        "Discussions": "讨论", "Pull requests": "拉取请求", "Welcome to the community": "欢迎来到社区专区",
        "The community tab is the place to discuss and collaborate with the HF community!": "此处是您与 HF 社区交流协作的专属空间！",
        "New discussion": "发起新讨论", "New pull request": "创建拉取请求", "Watch all activity": "查看所有活动动态",
        "View closed": "查看已关闭项", "Short": "排序", "Recently created": "最近创建",
        "Most reactions": "最多互动", "Trending": "热门内容", "Filter by title": "按标题筛选",
        "Filter by name": "按名称筛选", "Resources": "资源", "Search models, datasets, users...": "搜索模型、数据集、用户...",
        "No model card": "无模型卡片", "New: Create and edit this model card directly on the website!": "新功能：直接在线创建并编辑模型卡片！",
        "Contribute a Model Card": "贡献模型卡片", "Adapters": "适配器", "Finetunes": "微调模型",
        "Merges": "合并模型", "Quantizations": "量化模型",
        "Models, datasets and Spaces": "模型、数据集与空间", "Discover, explore and share ML resources": "发现、探索并分享机器学习资源",
        "Top contributors": "顶级贡献者", "Featured Spaces": "精选空间", "All Spaces": "所有空间",
        "Explore": "探索", "Browse models": "浏览模型", "Browse datasets": "浏览数据集", "Browse Spaces": "浏览空间",
        "Light theme": "浅色主题", "Light": "浅色", "Dark": "深色", "System": "系统", "System theme": "系统主题",
        "Sort:": "排序:", "Most likes": "最多点赞", "Most downloads": "最多下载", "Recently updated": "最近更新",
        "Task": "任务", "Library": "库", "Dataset": "数据集", "Architecture": "架构",
        "Model name or keyword": "模型名称或关键词", "Search models": "搜索模型", "Parameters": "参数量",
        "Most parameters": "最多参数", "Least parameters": "最少参数", "Full-text search": "全文检索",
        "Language": "语言", "Dataset name or keyword": "数据集名称或关键词", "Search datasets": "搜索数据集",
        "SDK": "SDK", "Space name or keyword": "空间名称或关键词", "Search Spaces": "搜索空间",
        "Hugging Face Documentation": "Hugging Face 文档", "Search the docs": "搜索文档",
        "Edit this page": "编辑此页", "Feedback": "反馈", "Documentation": "文档",

        // 详情页、通用词汇等
        "Model description": "模型描述", "Intended uses & limitations": "预期用途与限制", "How to use": "如何使用",
        "Limitations and bias": "限制与偏见", "Training data": "训练数据", "Training procedure": "训练过程",
        "Evaluation results": "评估结果", "Citation": "引用", "Model card authors": "模型卡片作者",
        "Model card contributors": "模型卡片贡献者", "Running on": "运行于", "Last updated": "最后更新",
        "Created by": "创建者", "App files": "应用文件", "README.md": "自述文件",
        "Loading": "加载中", "Error": "错误", "Success": "成功", "Warning": "警告", "Info": "信息",
        "No results found": "未找到结果", "Try adjusting your search or filter to find what you're looking for.": "尝试调整搜索或筛选条件来找到您要找的内容。",
        "Something went wrong": "出现了一些问题", "Please try again later": "请稍后再试", "Learn more": "了解更多",
        "Read documentation": "阅读文档", "Get started": "开始使用", "Create new": "新建", "Overview": "概览",
        "API Keys": "API密钥", "Usage": "使用情况", "Members": "成员", "Support": "支持",
        "Privacy Policy": "隐私政策", "Terms of Service": "服务条款", "Cookie Policy": "Cookie政策",
        "About": "关于", "Contact": "联系", "Guides": "指南", "API Reference": "API参考",
        "Model Hub": "模型中心", "Dataset Hub": "数据集中心", "Space Hub": "应用中心", "Inference API": "推理API",
        "Widgets": "小部件", "Training": "训练", "Education": "教育版", "Research": "研究", "Partners": "合作伙伴",
        "Events": "活动", "Careers": "招聘", "Security": "安全", "Status": "状态", "Open source": "开源",
        "Activity": "活动", "Commits": "提交记录"
    };

    const regexRules = [
        [/updated/i, '更新'],
        [/about/i, '于'],
        [/\b(\d+) days?\s+ago\b/i, '$1天前'],
        [/\b(\d+) hours?\s+ago\b/i, '$1小时前'],
        [/\b(\d+) minutes?\s+ago\b/i, '$1分钟前'],
        [/\bJust now\b/i, '刚刚'],
        [/\b(\d+) downloads?\b/i, '$1次下载'],
        [/\b(\d+) likes?\b/i, '$1个点赞'],
        [/\bView closed \(?(\d+)\)?/i, '查看已关闭项 $1'],
        [/\b(\d+) (models?|datasets?|spaces?)\b/i, '$1个$2']
    ];

    // ================= 2. 性能优化核心配置 =================
    
    // 忽略的代码编辑区域与非文本标签，保障滚动流畅不卡顿
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'TEXTAREA', 'SVG', 'PATH', 'IFRAME', 'CANVAS']);
    const SKIP_CLASSES = ['cm-editor', 'monaco-editor', 'ace_editor'];

    // O(1) 复杂度极速查重缓存
    const translatedNodes = new WeakSet();
    const enableRegExp = GM_getValue("enable_RegExp", true);

    // 跨浏览器兼容的后台空闲调度器
    const requestIdle = window.requestIdleCallback || function(cb) {
        return setTimeout(() => cb({ timeRemaining: () => 50 }), 1);
    };

    // ================= 3. 本地静态与正则翻译引擎 =================
    function translate(text) {
        if (!text) return null;
        const trimmed = text.trim().replace(/\s+/g, ' ');
        if (!trimmed || !/[a-zA-Z]/.test(trimmed)) return null;

        if (translations[trimmed]) return text.replace(trimmed, translations[trimmed]);

        if (enableRegExp && (/\d/.test(trimmed) || /ago|updated|about|closed|now/i.test(trimmed))) {
            for (let i = 0; i < regexRules.length; i++) {
                const [pattern, replacement] = regexRules[i];
                if (pattern.test(trimmed)) {
                    return text.replace(trimmed, trimmed.replace(pattern, replacement));
                }
            }
        }
        return null;
    }

    // ================= 4. DOM 处理与观察者层 =================
    function isUnsafeNode(node) {
        if (SKIP_TAGS.has(node.tagName)) return true;
        if (node.isContentEditable) return true;
        if (node.className && typeof node.className === 'string') {
            for (let i=0; i<SKIP_CLASSES.length; i++) {
                if (node.className.includes(SKIP_CLASSES[i])) return true;
            }
        }
        return false;
    }

    function translateAttributes(rootNode) {
        const elements = rootNode.querySelectorAll ? rootNode.querySelectorAll('[title], [placeholder], [aria-label], [value], [data-confirm]') : [];
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (isUnsafeNode(el)) continue;

            const processAttr = (attr) => {
                const val = el.getAttribute(attr);
                if (val) {
                    const res = translate(val);
                    if (res) el.setAttribute(attr, res);
                }
            };

            if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit')) {
                processAttr('value');
            } else if (el.tagName === 'INPUT') {
                processAttr('placeholder');
            }
            processAttr('title');
            processAttr('aria-label');
            processAttr('data-confirm');
        }
    }

    function translateTextNodes(rootNode) {
        const walker = document.createTreeWalker(
            rootNode,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    const parent = node.parentNode;
                    if (!parent || isUnsafeNode(parent)) return NodeFilter.FILTER_REJECT;
                    if (node.nodeValue.length > 500 || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let textNode;
        while ((textNode = walker.nextNode())) {
            if (translatedNodes.has(textNode)) continue;
            const translatedText = translate(textNode.nodeValue);
            if (translatedText) textNode.nodeValue = translatedText;
            translatedNodes.add(textNode);
        }
    }

    const pendingNodes = new Set();
    let isProcessing = false;

    function processQueue(deadline) {
        while (pendingNodes.size > 0 && deadline.timeRemaining() > 2) {
            const node = pendingNodes.values().next().value;
            pendingNodes.delete(node);
            
            if (node.isConnected) {
                translateAttributes(node);
                translateTextNodes(node);
            }
        }

        if (pendingNodes.size > 0) {
            requestIdle(processQueue);
        } else {
            isProcessing = false;
        }
    }

    function queueTranslation(node) {
        if (node.nodeType === Node.ELEMENT_NODE && isUnsafeNode(node)) return;
        pendingNodes.add(node);

        if (!isProcessing) {
            isProcessing = true;
            requestIdle(processQueue);
        }
    }

    // ================= 5. 外部 API 自动翻译 (带智能安全排队) =================
    
    function fetchTranslationAPI(text, callback) {
        GM_xmlhttpRequest({
            method: "POST",
            url: "https://www.iflyrec.com/TranslationService/v1/textTranslation",
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://www.iflyrec.com',
            },
            data: JSON.stringify({
                "from": "2", // 英文
                "to": "1",   // 中文
                "contents": [{ "text": text, "frontBlankLine": 0 }]
            }),
            responseType: "json",
            onload: (res) => {
                try {
                    const { status, response } = res;
                    const translatedText = (status === 200 && response && response.biz) ? response.biz[0].translateResult : "翻译失败";
                    callback(translatedText);
                } catch (error) {
                    callback("翻译失败");
                }
            },
            onerror: () => callback("网络请求失败")
        });
    }

    const apiQueue = [];
    let isRequestingAPI = false;

    function processApiQueue() {
        if (isRequestingAPI || apiQueue.length === 0) return;
        
        isRequestingAPI = true;
        const task = apiQueue.shift();

        fetchTranslationAPI(task.text, (translatedText) => {
            task.callback(translatedText);
            // 延迟 300 毫秒后处理下一个，保护 API 不被封禁
            setTimeout(() => {
                isRequestingAPI = false;
                processApiQueue();
            }, 300); 
        });
    }

    function autoTranslateLongText(selector) {
        const elements = document.querySelectorAll(selector);
        
        for (let i = 0; i < elements.length; i++) {
            let element = elements[i];
            const desc = element.textContent.trim();

            if (!desc || desc.length < 15 || element.dataset.hfAutoTranslated) {
                continue;
            }

            // 标记防重复
            element.dataset.hfAutoTranslated = "1";

            // 生成排队占位符
            const loadingId = 'loading-' + Math.random().toString(36).substr(2, 9);
            const loadingHTML = `<div id="${loadingId}" style='color: #ff9d00; font-size: 12px; margin-top: 5px; font-weight: 500;'>⏳ 自动请求翻译中...</div>`;
            element.insertAdjacentHTML('afterend', loadingHTML);

            // 推入队列
            apiQueue.push({
                text: desc,
                callback: (text) => {
                    const loadingEl = document.getElementById(loadingId);
                    if (loadingEl) loadingEl.remove();

                    if (text && text !== "翻译失败" && text !== "网络请求失败") {
                        const translationHTML = `
                            <div style='background-color: rgba(255, 157, 0, 0.05); border-left: 3px solid #ff9d00; padding: 10px; margin-top: 8px; margin-bottom: 12px; border-radius: 4px;'>
                                <span style='font-size: 14px; line-height: 1.6; color: #333;'>${text.replace(/\n/g, '<br>')}</span>
                            </div>`;
                        element.insertAdjacentHTML('afterend', translationHTML);
                    }
                }
            });
            
            processApiQueue();
        }
    }

    // ================= 6. 核心启动器 =================
    // 获取需要自动翻译长文本的目标（兼容主站、Gradio 和 Streamlit 空间）
    const LONG_TEXT_SELECTORS = 'header p, .prose > p, .markdown p, .gradio-container p, .stMarkdown p, [data-testid="stMarkdownContainer"] p';

    function init() {
        // 初始静态短文本翻译
        translateAttributes(document.body);
        translateTextNodes(document.body);

        // 页面加载后触发 API 长文本翻译
        setTimeout(() => {
            autoTranslateLongText(LONG_TEXT_SELECTORS); 
        }, 1000);

        // 监听 DOM 变化：用于捕捉滚动或点击新加载的短文本
        const observer = new MutationObserver(mutations => {
            for (let i = 0; i < mutations.length; i++) {
                const mutation = mutations[i];
                if (mutation.type === 'childList') {
                    for (let j = 0; j < mutation.addedNodes.length; j++) {
                        const node = mutation.addedNodes[j];
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            queueTranslation(node);
                        } else if (node.nodeType === Node.TEXT_NODE) {
                            if (!translatedNodes.has(node) && node.nodeValue.trim()) {
                                const parent = node.parentNode;
                                if (parent && !isUnsafeNode(parent)) {
                                    const res = translate(node.nodeValue);
                                    if (res) node.nodeValue = res;
                                    translatedNodes.add(node);
                                }
                            }
                        }
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // 定时轮询器：专门用于捕获由框架动态刷新的长文本段落
        setInterval(() => {
            autoTranslateLongText(LONG_TEXT_SELECTORS);
        }, 2000);

        // 扩展菜单命令
        GM_registerMenuCommand(`${enableRegExp ? '🔴 关闭' : '🟢 开启'}正则翻译`, () => {
            GM_setValue('enable_RegExp', !enableRegExp);
            GM_notification(`已${!enableRegExp ? '开启' : '关闭'}正则翻译，刷新页面生效`);
            location.reload();
        });
    }

    // 执行挂载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();