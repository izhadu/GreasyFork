// ==UserScript==
// @name         HuggingFace 汉化
// @namespace    https://github.com/izhadu/GreasyFork
// @description  中文化 Hugging Face 界面菜单及内容，采用底层 TreeWalker 与 requestIdleCallback 优化，词库彻底解耦。
// @copyright    2026, izhadu
// @icon         https://huggingface.co/front/assets/huggingface_logo-noborder.svg
// @version      3.1.0
// @author       izhadu
// @license      GPL-3.0
// @match        https://huggingface.co/*
// @match        https://*.huggingface.co/*
// @match        https://hf-mirror.com/*
// @match        https://*.hf.space/*
// @match        https://hf.space/*
// @run-at       document-start
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @supportURL   https://github.com/izhadu/GreasyFork/issues
// ==/UserScript==

(function () {
    'use strict';

    /**
     * @why 指向 GitHub Raw 原始文件层，规避第三方 CDN 的审核与长周期缓存。
     */
    const DICT_URL = "https://raw.githubusercontent.com/izhadu/GreasyFork/main/HuggingFace-Chinese/dict.json";
    const CACHE_KEY = "hf_zh_dict_data";
    
    let dict = new Map();
    let regexRules = [];
    const enableRegExp = GM_getValue("enable_RegExp", true);

    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'TEXTAREA', 'SVG', 'PATH', 'IFRAME', 'CANVAS']);
    const SKIP_CLASSES = ['cm-editor', 'monaco-editor', 'ace_editor'];
    const translatedNodes = new WeakSet();

    const requestIdle = window.requestIdleCallback || function(cb) {
        return setTimeout(() => cb({ timeRemaining: () => 50 }), 1);
    };

    /**
     * @why 构建运行时翻译环境。将 JSON 格式的字符串规则映射为内存中的 Map 实例与 RegExp 对象。
     */
    function initTranslator(configData) {
        dict = new Map(Object.entries(configData.translations));
        regexRules = configData.regexRules.map(rule => [new RegExp(rule[0], rule[2] || ""), rule[1]]);
        
        translateAttributes(document.body);
        translateTextNodes(document.body);
    }

    function translate(text) {
        if (!text) return null;
        const trimmed = text.trim().replace(/\s+/g, ' '); 
        if (!trimmed || !/[a-zA-Z]/.test(trimmed)) return null;

        if (dict.has(trimmed)) return text.replace(trimmed, dict.get(trimmed));
        if (dict.has(text)) return dict.get(text);

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

    function isUnsafeNode(node) {
        if (SKIP_TAGS.has(node.tagName)) return true;
        if (node.isContentEditable) return true;
        if (node.className && typeof node.className === 'string') {
            for (let i = 0; i < SKIP_CLASSES.length; i++) {
                if (node.className.includes(SKIP_CLASSES[i])) return true;
            }
        }
        return false;
    }

    function translateAttributes(rootNode) {
        if (!rootNode.querySelectorAll) return;
        const elements = rootNode.querySelectorAll('optgroup:not([data-hf-translated]), option:not([data-hf-translated]), [title]:not([data-hf-translated]), [placeholder]:not([data-hf-translated]), [aria-label]:not([data-hf-translated]), [value]:not([data-hf-translated]), [data-confirm]:not([data-hf-translated])');
        
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (isUnsafeNode(el)) continue;

            let isModified = false;

            if (el.tagName === 'OPTION') {
                const textNodeRes = translate(el.textContent);
                if (textNodeRes) {
                    el.textContent = textNodeRes;
                    isModified = true;
                }
            }

            const processAttr = (attr) => {
                const val = el.getAttribute(attr);
                if (val) {
                    const res = translate(val);
                    if (res) {
                        el.setAttribute(attr, res);
                        isModified = true;
                    }
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

            if (isModified) el.setAttribute('data-hf-translated', 'true');
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
            if (translatedText) {
                textNode.nodeValue = translatedText;
            }
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

    /**
     * @why 核心下发控制层。优先保证首屏渲染速度（利用本地缓存引擎直启），网络请求于后台隐式进行版本校对。
     */
    function launch() {
        const localData = GM_getValue(CACHE_KEY, null);
        
        // 1. 本地缓存直接启动引擎，无网络延迟阻塞
        if (localData && localData.translations) {
            initTranslator(localData);
            observer.observe(document.body, { childList: true, subtree: true });
        }

        // 2. 后台异步拉取 GitHub Raw 配置进行版本比对
        GM_xmlhttpRequest({
            method: "GET",
            url: DICT_URL + "?t=" + Date.now(),
            onload: (res) => {
                if (res.status === 200) {
                    try {
                        const remoteData = JSON.parse(res.responseText);
                        
                        // 若本地无数据或远端版本号更新，则覆盖写入
                        if (!localData || remoteData.version !== localData.version) {
                            GM_setValue(CACHE_KEY, remoteData);
                            console.info(`[HF中文插件] 词库已在后台静默更新至版本: ${remoteData.version}`);
                            
                            // 初次安装场景：写入后即刻拉起引擎
                            if (!localData) {
                                initTranslator(remoteData);
                                observer.observe(document.body, { childList: true, subtree: true });
                            }
                        }
                    } catch (e) {
                        console.error("[HF中文插件] 远程词库 JSON 解析异常", e);
                    }
                }
            }
        });

        GM_registerMenuCommand(`${enableRegExp ? '关闭' : '开启'}正则翻译`, () => {
            GM_setValue('enable_RegExp', !enableRegExp);
            GM_notification(`已${!enableRegExp ? '开启' : '关闭'}正则翻译，刷新页面生效`);
            location.reload();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', launch);
    } else {
        launch();
    }
})();