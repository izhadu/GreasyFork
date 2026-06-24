// ==UserScript==
// @name         HuggingFace 汉化
// @namespace    https://github.com/izhadu/GreasyFork
// @description  中文化 Hugging Face 界面菜单及内容。采用真正的广度优先异步平铺架构，实现 0 阻塞、绝对丝滑。
// @copyright    2026, izhadu
// @icon         https://huggingface.co/front/assets/huggingface_logo-noborder.svg
// @version      5.0.0
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
    const translatedNodes = new WeakSet();

    // 队列系统：摒弃高消耗的 Array.shift()，采用指针游标
    const elementQueue = [];
    const textQueue = [];
    let qHeadElem = 0;
    let qHeadText = 0;
    let isWorking = false;

    function isUnsafeElement(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (SKIP_TAGS.has(node.tagName) || node.isContentEditable) return true;
        const cl = node.classList;
        if (cl && (cl.contains('cm-editor') || cl.contains('monaco-editor') || cl.contains('ace_editor'))) return true;
        return false;
    }

    function checkSafeContext(node) {
        let curr = (node && node.nodeType === Node.ELEMENT_NODE) ? node : (node ? node.parentNode : null);
        while (curr && curr !== document.body && curr !== document.documentElement) {
            if (isUnsafeElement(curr)) return false;
            curr = curr.parentNode;
        }
        return true;
    }

    function translate(text) {
        if (!text) return null;
        const originalTrimmed = text.trim();
        if (!originalTrimmed || originalTrimmed.length > 500 || !/[a-zA-Z]/.test(originalTrimmed)) return null;

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

    function translateTextNode(node) {
        if (translatedNodes.has(node)) return;
        const val = node.nodeValue;
        
        const res = translate(val);
        if (res && res !== val) {
            node.nodeValue = res;
            translatedNodes.add(node); // 内存级防抖，防止 Observer 死循环
        }
    }

    function translateElementAttributes(el) {
        const checkAttr = (attr) => {
            const val = el.getAttribute(attr);
            if (val) {
                const res = translate(val);
                if (res && res !== val) {
                    el.setAttribute(attr, res);
                }
            }
        };

        if (el.tagName === 'INPUT') {
            if (el.type === 'button' || el.type === 'submit') {
                if (el.hasAttribute('value')) checkAttr('value');
            } else {
                if (el.hasAttribute('placeholder')) checkAttr('placeholder');
            }
        }
        
        if (el.hasAttribute('title')) checkAttr('title');
        if (el.hasAttribute('aria-label')) checkAttr('aria-label');
        if (el.hasAttribute('data-confirm')) checkAttr('data-confirm');
    }

    // 核心重构：广度优先平铺，绝不处理深层嵌套，保证 12ms 内安全切断
    function workLoop() {
        const TIME_LIMIT = 12; // 严控在 16.6ms 的刷新帧率安全线内
        const start = performance.now();

        // 1. 元素节点展开与属性翻译
        while (qHeadElem < elementQueue.length && (performance.now() - start) < TIME_LIMIT) {
            const el = elementQueue[qHeadElem++];
            if (isUnsafeElement(el)) continue; 

            translateElementAttributes(el);

            // 只将下一层子节点推入队列，绝不递归
            let child = el.firstChild;
            while (child) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    elementQueue.push(child);
                } else if (child.nodeType === Node.TEXT_NODE) {
                    textQueue.push(child);
                }
                child = child.nextSibling;
            }
        }

        // 2. 文本节点纯粹翻译
        while (qHeadText < textQueue.length && (performance.now() - start) < TIME_LIMIT) {
            const textNode = textQueue[qHeadText++];
            translateTextNode(textNode);
        }

        // 3. 内存回收或延续任务
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
        let added = false;
        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            
            if (m.type === 'childList') {
                for (let j = 0; j < m.addedNodes.length; j++) {
                    const node = m.addedNodes[j];
                    if (node.nodeType === Node.ELEMENT_NODE && checkSafeContext(node)) {
                        elementQueue.push(node);
                        added = true;
                    } else if (node.nodeType === Node.TEXT_NODE && checkSafeContext(node)) {
                        textQueue.push(node);
                        added = true;
                    }
                }
            } else if (m.type === 'characterData') {
                const node = m.target;
                if (!translatedNodes.has(node) && checkSafeContext(node)) {
                    textQueue.push(node);
                    added = true;
                }
            } else if (m.type === 'attributes') {
                const node = m.target;
                if (checkSafeContext(node)) {
                    elementQueue.push(node);
                    added = true;
                }
            }
        }

        if (added && !isWorking) {
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
        
        // 启动初始页面的打碎与解析
        elementQueue.push(document.body);
        isWorking = true;
        requestAnimationFrame(workLoop);
        
        // 开启 C++ 底层过滤监听
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