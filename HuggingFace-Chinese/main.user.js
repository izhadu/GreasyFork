// ==UserScript==
// @name         HuggingFace 汉化
// @namespace    https://github.com/izhadu/GreasyFork
// @description  中文化 Hugging Face 界面菜单及内容，采用底层 TreeWalker 剪枝与同步 MutationObserver 架构，彻底解决性能拖慢问题。
// @copyright    2026, izhadu
// @icon         https://huggingface.co/front/assets/huggingface_logo-noborder.svg
// @version      4.0.0
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
    const UNSAFE_CLASSES_REGEX = /(cm-editor|monaco-editor|ace_editor)/;

    function initTranslator(configData) {
        dict = new Map(Object.entries(configData.translations));
        lowerDict = new Map();
        
        for (let [key, value] of dict.entries()) {
            lowerDict.set(key.toLowerCase(), value);
        }
        
        regexRules = configData.regexRules.map(rule => [new RegExp(rule[0], rule[2] || ""), rule[1]]);
        
        performDOMTranslation(document.body);
    }

    /**
     * Translates a given text string based on exact, lowercase, or regex matches.
     * @param {string} text - The original string from the DOM.
     * @returns {string|null} - The translated string or null if no translation exists.
     */
    function translate(text) {
        if (!text) return null;
        
        const originalTrimmed = text.trim();
        // Fast fail for strings without alphabetical characters
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

    /**
     * Determines if a DOM element should be excluded from translation.
     * @param {Node} node - The element node to evaluate.
     * @returns {boolean} - True if the node is unsafe for text mutation.
     */
    function isUnsafeNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (SKIP_TAGS.has(node.tagName)) return true;
        if (node.isContentEditable) return true;
        
        const className = node.getAttribute('class');
        if (className && UNSAFE_CLASSES_REGEX.test(className)) return true;
        
        return false;
    }

    function translateAttributes(rootNode) {
        const processElement = (el) => {
            if (isUnsafeNode(el)) return;
            let isModified = false;

            if (el.tagName === 'OPTION') {
                const res = translate(el.textContent);
                if (res && res !== el.textContent) {
                    el.textContent = res;
                    isModified = true;
                }
            }

            const processAttr = (attr) => {
                const val = el.getAttribute(attr);
                if (val && /[a-zA-Z]/.test(val)) {
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
        };

        if (rootNode.nodeType === Node.ELEMENT_NODE && rootNode.matches && rootNode.matches('optgroup, option, [title], [placeholder], [aria-label], [value], [data-confirm]')) {
            processElement(rootNode);
        }

        if (!rootNode.querySelectorAll) return;
        const elements = rootNode.querySelectorAll('optgroup:not([data-hf-translated]), option:not([data-hf-translated]), [title]:not([data-hf-translated]), [placeholder]:not([data-hf-translated]), [aria-label]:not([data-hf-translated]), [value]:not([data-hf-translated]), [data-confirm]:not([data-hf-translated])');
        for (let i = 0; i < elements.length; i++) {
            processElement(elements[i]);
        }
    }

    /**
     * [Why] Uses NodeFilter.FILTER_REJECT on elements instead of skipping text nodes.
     * By rejecting an entire element branch (e.g. <script> or .cm-editor), the TreeWalker
     * safely ignores thousands of deeply nested code nodes instantaneously, massively boosting performance.
     */
    function translateTextNodes(rootNode) {
        if (isUnsafeNode(rootNode)) return;

        const walker = document.createTreeWalker(
            rootNode,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        return isUnsafeNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
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
            const res = translate(node.nodeValue);
            if (res && res !== node.nodeValue) {
                node.nodeValue = res;
            }
        }
    }

    /**
     * Executes translation pipeline over a target DOM branch.
     */
    function performDOMTranslation(node) {
        translateAttributes(node);
        translateTextNodes(node);
    }

    const observer = new MutationObserver(mutations => {
        /*
         * [Why] CRITICAL PERFORMANCE FIX: Disconnect observer during execution.
         * Preventing the script from capturing its own DOM updates absolutely eradicates 
         * mutation looping, which was the core reason for Firefox locking up the main thread.
         */
        observer.disconnect();

        for (let i = 0; i < mutations.length; i++) {
            const mutation = mutations[i];
            
            if (mutation.type === 'childList') {
                for (let j = 0; j < mutation.addedNodes.length; j++) {
                    const node = mutation.addedNodes[j];
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        performDOMTranslation(node);
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        const val = node.nodeValue;
                        if (val && /[a-zA-Z]/.test(val)) {
                            const parent = node.parentNode;
                            if (parent && !isUnsafeNode(parent)) {
                                const res = translate(val);
                                if (res && res !== val) node.nodeValue = res;
                            }
                        }
                    }
                }
            } else if (mutation.type === 'characterData') {
                const node = mutation.target;
                const val = node.nodeValue;
                if (val && /[a-zA-Z]/.test(val)) {
                    const parent = node.parentNode;
                    if (parent && !isUnsafeNode(parent)) {
                        const res = translate(val);
                        if (res && res !== val) node.nodeValue = res;
                    }
                }
            }
        }

        // Resume observation after batch completion
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
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