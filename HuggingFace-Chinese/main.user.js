// ==UserScript==
// @name         HuggingFace 汉化
// @namespace    https://github.com/izhadu/GreasyFork
// @description  中文化 Hugging Face 界面菜单及内容，采用底层 TreeWalker 与 requestIdleCallback 优化，词库彻底解耦。
// @copyright    2026, izhadu
// @icon         https://huggingface.co/front/assets/huggingface_logo-noborder.svg
// @version      3.3.0
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

    const DICT_URL = "https://git.zhadu.com/github.com/izhadu/GreasyFork/blob/main/HuggingFace-Chinese/dict.json";
    const CACHE_KEY = "hf_zh_dict_data";
    
    let dict = new Map();
    let lowerDict = new Map();
    let regexRules = [];
    const enableRegExp = GM_getValue("enable_RegExp", true);

    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'TEXTAREA', 'SVG', 'PATH', 'IFRAME', 'CANVAS']);
    // 使用正则替代数组遍历，在极高频调用的 isUnsafeNode 中提升性能
    const UNSAFE_CLASSES_REGEX = /(cm-editor|monaco-editor|ace_editor)/;

    // Polyfill RequestIdleCallback
    const requestIdle = window.requestIdleCallback || function(cb) {
        return setTimeout(() => cb({ timeRemaining: () => 50 }), 1);
    };

    function initTranslator(configData) {
        dict = new Map(Object.entries(configData.translations));
        lowerDict = new Map();
        
        // 构建全小写索引
        for (let [key, value] of dict.entries()) {
            lowerDict.set(key.toLowerCase(), value);
        }
        
        regexRules = configData.regexRules.map(rule => [new RegExp(rule[0], rule[2] || ""), rule[1]]);
        
        translateAttributes(document.body);
        translateTextNodes(document.body);
    }

    /**
     * 核心翻译逻辑
     * [Why] 修复原版 text.replace(trimmed) 潜在的因内部多个空格折叠导致无法替换的 Bug。
     * 改为提取外围前后缀或精准 replace(originalTrimmed)。
     */
    function translate(text) {
        if (!text) return null;
        
        const originalTrimmed = text.trim();
        if (!originalTrimmed || !/[a-zA-Z]/.test(originalTrimmed)) return null;

        // 折叠内部空格仅用于查字典，不能用于文本 replace
        const lookupKey = originalTrimmed.replace(/\s+/g, ' ');

        // 优先精确匹配
        let result = dict.get(lookupKey) || dict.get(originalTrimmed);
        
        // 兜底忽略大小写匹配
        if (!result) {
            result = lowerDict.get(lookupKey.toLowerCase());
        }

        // 若查到结果，将原包含多空格的 originalTrimmed 部分替换，保留开头/结尾空格
        if (result) {
            return text.replace(originalTrimmed, result);
        }

        // 正则动态处理 (合并正则条件提升命中效率)
        if (enableRegExp && /[\d]|ago|updated|about|closed|now/i.test(lookupKey)) {
            for (let i = 0; i < regexRules.length; i++) {
                const [pattern, replacement] = regexRules[i];
                if (pattern.test(originalTrimmed)) {
                    return text.replace(originalTrimmed, originalTrimmed.replace(pattern, replacement));
                }
            }
        }
        return null;
    }

    function isUnsafeNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (SKIP_TAGS.has(node.tagName)) return true;
        if (node.isContentEditable) return true;
        
        const className = node.className;
        if (typeof className === 'string' && className !== '') {
            return UNSAFE_CLASSES_REGEX.test(className);
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
                if (textNodeRes && textNodeRes !== el.textContent) {
                    el.textContent = textNodeRes;
                    isModified = true;
                }
            }

            const processAttr = (attr) => {
                const val = el.getAttribute(attr);
                if (val) {
                    const res = translate(val);
                    if (res && res !== val) {
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
            const translatedText = translate(textNode.nodeValue);
            // 确保变更发生才重新赋值，避免触发无意义的 DOM 重绘
            if (translatedText && translatedText !== textNode.nodeValue) {
                textNode.nodeValue = translatedText;
            }
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
                        if (node.nodeValue.trim()) {
                            const parent = node.parentNode;
                            if (parent && !isUnsafeNode(parent)) {
                                const res = translate(node.nodeValue);
                                if (res && res !== node.nodeValue) {
                                    node.nodeValue = res;
                                }
                            }
                        }
                    }
                }
            } else if (mutation.type === 'characterData') {
                const node = mutation.target;
                if (node.nodeValue.trim()) {
                    const parent = node.parentNode;
                    if (parent && !isUnsafeNode(parent)) {
                        const res = translate(node.nodeValue);
                        // [Why] 增加严格对比。React 等框架重绘文本节点时，防止翻译回填造成的二次死循环解析。
                        if (res && res !== node.nodeValue) {
                            node.nodeValue = res;
                        }
                    }
                }
            }
        }
    });

    function launch() {
        const localData = GM_getValue(CACHE_KEY, null);
        
        if (localData && localData.translations) {
            initTranslator(localData);
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }

        GM_xmlhttpRequest({
            method: "GET",
            url: DICT_URL + "?t=" + Date.now(),
            onload: (res) => {
                if (res.status === 200) {
                    try {
                        const remoteData = JSON.parse(res.responseText);
                        if (!localData || remoteData.version !== localData.version) {
                            GM_setValue(CACHE_KEY, remoteData);
                            console.info(`[HF中文插件] 词库已在后台静默更新至版本: ${remoteData.version}`);
                            
                            if (!localData) {
                                initTranslator(remoteData);
                                observer.observe(document.body, { childList: true, subtree: true, characterData: true });
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