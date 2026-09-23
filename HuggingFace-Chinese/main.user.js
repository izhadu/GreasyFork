// ==UserScript==
// @name         HuggingFace 汉化
// @namespace    https://github.com/izhadu/GreasyFork
// @description  中文化 Hugging Face 界面菜单及内容。底层重构，彻底解决火狐拖慢网页问题，实现 0 阻塞、绝对丝滑。
// @copyright    2026, izhadu
// @icon         https://huggingface.co/front/assets/huggingface_logo-noborder.svg
// @version      5.2.4
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

    const regexTrigger = /[\d]|ago|updated|about|closed|now|restricted|task_categories/i;

    // 优化：补充了 .blob-line 和 [class*="hljs"] 拦截语法高亮
    const UNSAFE_SELECTOR = 'script, style, code, pre, noscript, textarea, svg, iframe, canvas, [contenteditable="true"], .cm-editor, .monaco-editor, .ace_editor, .font-mono, .shiki, .highlight, .blob-wrapper, .blob-code, .blob-line, [class*="language-"], [class*="hljs"], [data-testid="file-content"], .file-content, .whitespace-pre, .cm-content, .cm-line, .token, [class*="sourceCode"], [class*="syntax"], [style*="monospace"]';
    const ATTR_SELECTOR = '[placeholder], [title], [aria-label], [value], [data-confirm]';

    const translatedNodes = new WeakSet();

    const textQueue = [];
    const elementQueue = [];
    let qHeadText = 0;
    let qHeadElem = 0;
    let isWorking = false;

    function translate(text) {
        if (!text) return null;
        const originalTrimmed = text.trim();
        if (!originalTrimmed || originalTrimmed.length > 500 || !/[a-zA-Z]/.test(originalTrimmed)) return null;

        const lookupKey = originalTrimmed.replace(/\s+/g, ' ');

        let result = dict.get(lookupKey) || dict.get(originalTrimmed) || lowerDict.get(lookupKey.toLowerCase());
        if (result) return text.replace(originalTrimmed, () => result);

        if (enableRegExp && regexTrigger.test(lookupKey)) {
            for (let i = 0; i < regexRules.length; i++) {
                const [pattern, replacement] = regexRules[i];
                if (pattern.test(originalTrimmed)) {
                    const res = originalTrimmed.replace(pattern, replacement);
                    return text.replace(originalTrimmed, () => res);
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
            translatedNodes.add(node);
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

    function extractNodes(root) {
        // 关键修复：确保传递进来的 root 节点本身不在代码框内
        if (root.nodeType === Node.ELEMENT_NODE && root.closest && root.closest(UNSAFE_SELECTOR)) return;

        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: function (node) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches && node.matches(UNSAFE_SELECTOR)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_SKIP;
                    }
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

        if (root.nodeType === Node.ELEMENT_NODE) {
            if (root.matches && root.matches(ATTR_SELECTOR)) elementQueue.push(root);
            const attrNodes = root.querySelectorAll(ATTR_SELECTOR);
            for (let i = 0; i < attrNodes.length; i++) {
                elementQueue.push(attrNodes[i]);
            }
        }
    }

    function workLoop() {
        const TIME_LIMIT = 12;
        const start = performance.now();

        while (qHeadElem < elementQueue.length && (performance.now() - start) < TIME_LIMIT) {
            translateElementAttributes(elementQueue[qHeadElem++]);
        }

        while (qHeadText < textQueue.length && (performance.now() - start) < TIME_LIMIT) {
            translateTextNode(textQueue[qHeadText++]);
        }

        if (qHeadElem >= elementQueue.length && qHeadText >= textQueue.length) {
            elementQueue.length = 0;
            textQueue.length = 0;
            qHeadElem = 0;
            qHeadText = 0;
            isWorking = false;
        } else {
            requestAnimationFrame(workLoop);
        }
    }

    const observer = new MutationObserver(mutations => {
        let shouldTrigger = false;

        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];

            if (m.type === 'childList') {
                for (let j = 0; j < m.addedNodes.length; j++) {
                    const node = m.addedNodes[j];
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // 关键修复：从 matches 改为了 closest，新渲染的子标签（如 <tr>, <span>）会向上查询，在代码框里则直接忽略
                        if (node.closest && node.closest(UNSAFE_SELECTOR)) continue;
                        extractNodes(node);
                        shouldTrigger = true;
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        if (node.parentElement && !node.parentElement.closest(UNSAFE_SELECTOR) && !translatedNodes.has(node)) {
                            textQueue.push(node);
                            shouldTrigger = true;
                        }
                    }
                }
            } else if (m.type === 'characterData') {
                const node = m.target;
                if (node.parentElement && !node.parentElement.closest(UNSAFE_SELECTOR)) {
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

        extractNodes(document.body);
        if (!isWorking && (textQueue.length > 0 || elementQueue.length > 0)) {
            isWorking = true;
            requestAnimationFrame(workLoop);
        }

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