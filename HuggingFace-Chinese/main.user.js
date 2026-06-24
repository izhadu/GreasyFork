// ==UserScript==
// @name         HuggingFace 汉化
// @namespace    https://github.com/izhadu/GreasyFork
// @description  中文化 Hugging Face 界面菜单及内容。底层重构，彻底解决火狐拖慢网页问题，实现 0 阻塞、绝对丝滑。
// @copyright    2026, izhadu
// @icon         https://huggingface.co/front/assets/huggingface_logo-noborder.svg
// @version      5.2.0
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
    
    // 预编译正则触发器，避免每次都做无意义的正则匹配消耗性能
    const regexTrigger = /[\d]|ago|updated|about|closed|now/i;

    // 使用 CSS 选择器定义非安全区，利用 C++ 底层解析极速匹配
    const UNSAFE_SELECTOR = 'script, style, code, pre, noscript, textarea, svg, iframe, canvas, [contenteditable="true"], .cm-editor, .monaco-editor, .ace_editor';
    const ATTR_SELECTOR = '[placeholder], [title], [aria-label], [value], [data-confirm]';

    const translatedNodes = new WeakSet();

    // 高性能扁平化任务队列
    const textQueue = [];
    const elementQueue = [];
    let qHeadText = 0;
    let qHeadElem = 0;
    let isWorking = false;

    // 翻译核心逻辑
    function translate(text) {
        if (!text) return null;
        const originalTrimmed = text.trim();
        // 过滤空字符、超长文本（避免卡死）、纯符号
        if (!originalTrimmed || originalTrimmed.length > 500 || !/[a-zA-Z]/.test(originalTrimmed)) return null;

        const lookupKey = originalTrimmed.replace(/\s+/g, ' ');

        let result = dict.get(lookupKey) || dict.get(originalTrimmed) || lowerDict.get(lookupKey.toLowerCase());
        if (result) return text.replace(originalTrimmed, result);

        if (enableRegExp && regexTrigger.test(lookupKey)) {
            for (let i = 0; i < regexRules.length; i++) {
                const [pattern, replacement] = regexRules[i];
                if (pattern.test(originalTrimmed)) {
                    return text.replace(originalTrimmed, originalTrimmed.replace(pattern, replacement));
                }
            }
        }
        return null;
    }

    function translateTextNode(node) {
        const val = node.nodeValue;
        const res = translate(val);
        if (res && res !== val) {
            node.nodeValue = res;
            translatedNodes.add(node); // 记录已翻译节点，防抖
        }
    }

    function translateElementAttributes(el) {
        const checkAttr = (attr) => {
            const val = el.getAttribute(attr);
            if (val) {
                const res = translate(val);
                if (res && res !== val) el.setAttribute(attr, res);
            }
        };

        if (el.tagName === 'INPUT') {
            if (el.type === 'button' || el.type === 'submit') {
                checkAttr('value');
            } else {
                checkAttr('placeholder');
            }
        }
        ['title', 'aria-label', 'data-confirm'].forEach(checkAttr);
    }

    // 使用底层的 TreeWalker 极速提取文本节点和元素
    function extractNodes(root) {
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: function(node) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // 如果遇到不该翻译的区块，直接使用 FILTER_REJECT 砍掉整个分支，节约海量性能
                        if (node.matches && node.matches(UNSAFE_SELECTOR)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        // 元素本身不需要加入文本流，只需要找里面的文本，所以跳过元素本身但进入其子节点
                        return NodeFilter.FILTER_SKIP;
                    }
                    // 是安全的文本节点
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let currentNode;
        while ((currentNode = walker.nextNode())) {
            if (!translatedNodes.has(currentNode)) {
                textQueue.push(currentNode);
            }
        }

        // 利用 querySelectorAll 提取需要翻译属性的元素
        if (root.nodeType === Node.ELEMENT_NODE) {
            if (root.matches && root.matches(ATTR_SELECTOR)) elementQueue.push(root);
            const attrNodes = root.querySelectorAll(ATTR_SELECTOR);
            for (let i = 0; i < attrNodes.length; i++) {
                elementQueue.push(attrNodes[i]);
            }
        }
    }

    // 核心帧循环：严格的时间片轮转（Time Slicing）
    function workLoop() {
        const TIME_LIMIT = 12; // 严控在 12ms 以内，为浏览器绘制留出时间
        const start = performance.now();

        // 1. 翻译属性
        while (qHeadElem < elementQueue.length && (performance.now() - start) < TIME_LIMIT) {
            translateElementAttributes(elementQueue[qHeadElem++]);
        }

        // 2. 翻译文本
        while (qHeadText < textQueue.length && (performance.now() - start) < TIME_LIMIT) {
            translateTextNode(textQueue[qHeadText++]);
        }

        // 3. 内存回收或延续任务
        if (qHeadElem >= elementQueue.length && qHeadText >= textQueue.length) {
            elementQueue.length = 0;
            textQueue.length = 0;
            qHeadElem = 0;
            qHeadText = 0;
            isWorking = false;
        } else {
            // 时间用尽，让出主线程，下一帧继续
            requestAnimationFrame(workLoop);
        }
    }

    // 监听器
    const observer = new MutationObserver(mutations => {
        let shouldTrigger = false;

        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            
            if (m.type === 'childList') {
                for (let j = 0; j < m.addedNodes.length; j++) {
                    const node = m.addedNodes[j];
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches && node.matches(UNSAFE_SELECTOR)) continue;
                        extractNodes(node);
                        shouldTrigger = true;
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        // 使用 closest 极速排查父级
                        if (node.parentElement && !node.parentElement.closest(UNSAFE_SELECTOR) && !translatedNodes.has(node)) {
                            textQueue.push(node);
                            shouldTrigger = true;
                        }
                    }
                }
            } else if (m.type === 'characterData') {
                const node = m.target;
                if (!translatedNodes.has(node) && node.parentElement && !node.parentElement.closest(UNSAFE_SELECTOR)) {
                    textQueue.push(node);
                    shouldTrigger = true;
                }
            } else if (m.type === 'attributes') {
                const node = m.target;
                if (!node.closest(UNSAFE_SELECTOR)) {
                    elementQueue.push(node);
                    shouldTrigger = true;
                }
            }
        }

        if (shouldTrigger && !isWorking) {
            isWorking = true;
            requestAnimationFrame(workLoop);
        }
    });

    function initTranslator(configData) {
        dict = new Map(Object.entries(configData.translations));
        lowerDict = new Map();
        for (let [key, value] of dict.entries()) {
            lowerDict.set(key.toLowerCase(), value);
        }
        regexRules = configData.regexRules.map(rule => [new RegExp(rule[0], rule[2] || ""), rule[1]]);
        
        // 初始页面打碎与解析
        extractNodes(document.body);
        if (!isWorking && (textQueue.length > 0 || elementQueue.length > 0)) {
            isWorking = true;
            requestAnimationFrame(workLoop);
        }
        
        // 开启监听
        observer.observe(document.body, { 
            childList: true, 
            subtree: true, 
            characterData: true,
            attributes: true,
            attributeFilter: ['placeholder', 'title', 'aria-label', 'value', 'data-confirm']
        });
    }

    function launch() {
        const localData = GM_getValue(CACHE_KEY, null);
        
        if (localData && localData.translations) {
            initTranslator(localData);
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
                            console.info(`[HF中文插件] 词库已更新至: ${remoteData.version}`);
                            if (!localData) initTranslator(remoteData);
                        }
                    } catch (e) {
                        console.error("[HF中文插件] 解析异常", e);
                    }
                }
            }
        });

        GM_registerMenuCommand(`${enableRegExp ? '关闭' : '开启'}正则翻译`, () => {
            GM_setValue('enable_RegExp', !enableRegExp);
            GM_notification(`已${!enableRegExp ? '开启' : '关闭'}正则翻译，刷新生效`);
            location.reload();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', launch);
    } else {
        launch();
    }
})();