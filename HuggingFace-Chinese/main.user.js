// ==UserScript==
// @name         HuggingFace 汉化 (性能优化版)
// @namespace    https://github.com/izhadu/GreasyFork
// @description  中文化 Hugging Face 界面菜单及内容。采用时间切片与合并遍历架构，彻底解决浏览器卡顿、拖慢问题。
// @copyright    2026, izhadu
// @icon         https://huggingface.co/front/assets/huggingface_logo-noborder.svg
// @version      4.1.0
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

    function initTranslator(configData) {
        dict = new Map(Object.entries(configData.translations));
        lowerDict = new Map();
        
        for (let [key, value] of dict.entries()) {
            lowerDict.set(key.toLowerCase(), value);
        }
        
        regexRules = configData.regexRules.map(rule => [new RegExp(rule[0], rule[2] || ""), rule[1]]);
        performDOMTranslation(document.body);
    }

    function translate(text) {
        if (!text) return null;
        const originalTrimmed = text.trim();
        if (!originalTrimmed || !/[a-zA-Z]/.test(originalTrimmed)) return null;

        const lookupKey = originalTrimmed.replace(/\s+/g, ' ');

        let result = dict.get(lookupKey) || dict.get(originalTrimmed);
        if (!result) result = lowerDict.get(lookupKey.toLowerCase());

        if (result) return text.replace(originalTrimmed, result);

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
        if (SKIP_TAGS.has(node.tagName) || node.isContentEditable) return true;
        
        // 性能优化：用原生 classList 替代正则匹配
        const cl = node.classList;
        if (cl && (cl.contains('cm-editor') || cl.contains('monaco-editor') || cl.contains('ace_editor'))) {
            return true;
        }
        return false;
    }

    function processElementAttributes(el) {
        if (el.dataset.hfTranslated) return;
        let isModified = false;

        if (el.tagName === 'OPTION') {
            const res = translate(el.textContent);
            if (res && res !== el.textContent) {
                el.textContent = res;
                isModified = true;
            }
        }

        const processAttr = (attr) => {
            if (el.hasAttribute(attr)) {
                const val = el.getAttribute(attr);
                if (val && /[a-zA-Z]/.test(val)) {
                    const res = translate(val);
                    if (res && res !== val) {
                        el.setAttribute(attr, res);
                        isModified = true;
                    }
                }
            }
        };

        if (el.tagName === 'INPUT') {
            if (el.type === 'button' || el.type === 'submit') processAttr('value');
            else processAttr('placeholder');
        }
        processAttr('title');
        processAttr('aria-label');
        processAttr('data-confirm');

        if (isModified) el.dataset.hfTranslated = 'true';
    }

    // 性能优化：将文本和属性的遍历合二为一
    function performDOMTranslation(rootNode) {
        if (isUnsafeNode(rootNode)) return;

        if (rootNode.nodeType === Node.ELEMENT_NODE) {
            processElementAttributes(rootNode);
        }

        const walker = document.createTreeWalker(
            rootNode,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        return isUnsafeNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                    }
                    const val = node.nodeValue;
                    if (!val || val.length > 500 || !val.trim() || !/[a-zA-Z]/.test(val)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                processElementAttributes(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
                const res = translate(node.nodeValue);
                if (res && res !== node.nodeValue) {
                    node.nodeValue = res;
                }
            }
        }
    }

    // 性能优化：时间切片任务队列，防止阻塞主线程
    let mutationQueue = new Set();
    let isProcessing = false;

    function processQueue() {
        if (mutationQueue.size === 0) {
            isProcessing = false;
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
            return;
        }

        observer.disconnect(); // 处理时暂停监听，防止死循环

        const startTime = performance.now();
        const iterator = mutationQueue.values();
        let result = iterator.next();

        // 限制每帧处理时间不超过 15ms
        while (!result.done && (performance.now() - startTime < 15)) {
            const node = result.value;
            mutationQueue.delete(node);
            
            if (document.body.contains(node)) {
                performDOMTranslation(node);
            }
            result = iterator.next();
        }

        if (mutationQueue.size > 0) {
            requestAnimationFrame(processQueue);
        } else {
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
            isProcessing = false;
        }
    }

    const observer = new MutationObserver(mutations => {
        let hasNewNodes = false;
        for (let i = 0; i < mutations.length; i++) {
            const mutation = mutations[i];
            
            if (mutation.type === 'childList') {
                for (let j = 0; j < mutation.addedNodes.length; j++) {
                    const node = mutation.addedNodes[j];
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        mutationQueue.add(node);
                        hasNewNodes = true;
                    } else if (node.nodeType === Node.TEXT_NODE && node.parentNode) {
                        mutationQueue.add(node.parentNode);
                        hasNewNodes = true;
                    }
                }
            } else if (mutation.type === 'characterData' && mutation.target.parentNode) {
                mutationQueue.add(mutation.target.parentNode);
                hasNewNodes = true;
            }
        }

        if (hasNewNodes && !isProcessing) {
            isProcessing = true;
            requestAnimationFrame(processQueue);
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