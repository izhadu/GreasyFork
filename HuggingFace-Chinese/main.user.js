// ==UserScript==
// @name         HuggingFace 汉化
// @namespace    https://github.com/izhadu/GreasyFork
// @description  中文化 Hugging Face 界面菜单及内容。基于 TreeWalker、时间切片及增量观测深度优化，彻底解决拖慢网页及卡顿问题，实现 0 阻塞、绝对丝滑。
// @copyright    2026, izhadu
// @icon         https://huggingface.co/front/assets/huggingface_logo-noborder.svg
// @version      6.1.0
// @author       izhadu
// @license      GPL-3.0
// @match        https://huggingface.co/*
// @match        https://*.huggingface.co/*
// @match        https://hf-mirror.com/*
// @match        https://*.hf.space/*
// @match        https://hf.space/*
// @run-at       document-start
// @connect      raw.githubusercontent.com
// @connect      git.zhadu.com
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @supportURL   https://github.com/izhadu/GreasyFork/issues
// ==/UserScript==

(function () {
    'use strict';

    const PRIMARY_DICT_URL = "https://git.zhadu.com/github.com/izhadu/GreasyFork/blob/main/HuggingFace-Chinese/dict.json";
    const FALLBACK_DICT_URL = "https://raw.githubusercontent.com/izhadu/GreasyFork/main/HuggingFace-Chinese/dict.json";

    const CACHE_KEY = "hf_zh_dict_data";
    const CACHE_META_KEY = "hf_zh_dict_meta";
    const REGEX_ENABLED_KEY = "enable_RegExp";

    const FETCH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时自动检查一次更新
    const REQUEST_TIMEOUT_MS = 10000;
    const MAX_TEXT_LENGTH = 500;
    const TIME_SLICE_MS = 12;
    const TIME_CHECK_INTERVAL = 20;

    const UNSAFE_SELECTOR = [
        'script', 'style', 'code', 'pre', 'noscript', 'textarea', 'svg', 'iframe', 'canvas',
        '[contenteditable="true"]', '[translate="no"]', '.notranslate',
        '.cm-editor', '.monaco-editor', '.ace_editor', '.font-mono', '.shiki', '.highlight',
        '.blob-wrapper', '.blob-code', '.blob-line', '.file-content', '.whitespace-pre',
        '.cm-content', '.cm-line', '.token',
        '[class*="language-"]', '[class*="hljs"]', '[data-testid="file-content"]',
        '[class*="sourceCode"]', '[class*="syntax"]', '[style*="monospace"]'
    ].join(', ');

    const ATTR_SELECTOR = '[placeholder], [title], [aria-label], [data-confirm], input[type="button"][value], input[type="submit"][value]';
    const TRANSLATABLE_ATTRS = ['title', 'aria-label', 'data-confirm'];
    const OBSERVED_ATTRS = ['placeholder', 'title', 'aria-label', 'value', 'data-confirm'];

    const ASCII_LETTER_RE = /[a-zA-Z]/;
    const MULTI_SPACE_RE = /\s+/g;
    const TRAILING_PUNCT_RE = /(:|\.{3}|…)$/;
    const SORT_PREFIX_RE = /^Sort:\s*(.+)$/;
    const STATUS_DATE_PREFIX_RE = /^(Last\s+)?(Updated|Created)\s+(.+)$/i;
    const DMY_DATE_RE = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/;
    const MD_DATE_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,\s*(\d{4}))?$/;
    const MY_DATE_RE = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/;

    const SHORT_MONTHS = {
        Jan: '1月', Feb: '2月', Mar: '3月', Apr: '4月', May: '5月', Jun: '6月',
        Jul: '7月', Aug: '8月', Sep: '9月', Oct: '10月', Nov: '11月', Dec: '12月'
    };
    const FULL_MONTHS = {
        January: '1月', February: '2月', March: '3月', April: '4月', May: '5月', June: '6月',
        July: '7月', August: '8月', September: '9月', October: '10月', November: '11月', December: '12月'
    };

    let dict = new Map();
    let lowerDict = new Map();
    let anchoredRegexRules = [];
    let partialRegexRules = [];
    let currentVersion = null;
    let isObserverAttached = false;

    const enableRegExp = GM_getValue(REGEX_ENABLED_KEY, true);

    // 记录已写入的文本与属性值，防止 MutationObserver 自我触发造成死循环或重复扫描
    let translatedTextMap = new WeakMap();
    let translatedAttrMap = new WeakMap();

    const pendingText = new Set();
    const pendingElem = new Set();
    let isWorking = false;

    function buildDictionary(configData) {
        const nextDict = new Map();
        const nextLowerDict = new Map();

        for (const [key, value] of Object.entries(configData.translations)) {
            if (!key || key.startsWith('@comment') || typeof value !== 'string') continue;
            nextDict.set(key, value);
            const lowerKey = key.toLowerCase();
            if (!nextLowerDict.has(lowerKey)) {
                nextLowerDict.set(lowerKey, value);
            }
        }

        const nextAnchored = [];
        const nextPartial = [];

        if (Array.isArray(configData.regexRules)) {
            for (let i = 0; i < configData.regexRules.length; i++) {
                const rule = configData.regexRules[i];
                if (!Array.isArray(rule) || rule.length < 2) continue;
                const [patternStr, replacement, flags = ''] = rule;
                try {
                    const regex = new RegExp(patternStr, flags);
                    if (patternStr.startsWith('^') && patternStr.endsWith('$')) {
                        nextAnchored.push([regex, replacement]);
                    } else {
                        nextPartial.push([regex, replacement]);
                    }
                } catch (err) {
                    console.warn('[HF中文插件] 无效的正则规则已跳过:', patternStr, err);
                }
            }
        }

        dict = nextDict;
        lowerDict = nextLowerDict;
        anchoredRegexRules = nextAnchored;
        partialRegexRules = nextPartial;
        currentVersion = configData.version || null;

        // 词库更新时重置已翻译缓存，确保新词条可生效
        translatedTextMap = new WeakMap();
        translatedAttrMap = new WeakMap();
    }

    function applyRegexRules(text) {
        for (let i = 0; i < anchoredRegexRules.length; i++) {
            const [pattern, replacement] = anchoredRegexRules[i];
            if (pattern.global) pattern.lastIndex = 0;
            const replaced = text.replace(pattern, replacement);
            if (replaced !== text) return replaced;
        }

        let current = text;
        let changed = false;
        for (let i = 0; i < partialRegexRules.length; i++) {
            const [pattern, replacement] = partialRegexRules[i];
            if (pattern.global) pattern.lastIndex = 0;
            const replaced = current.replace(pattern, replacement);
            if (replaced !== current) {
                current = replaced;
                changed = true;
            }
        }
        return changed ? current : null;
    }

    function lookupDict(key) {
        const direct = dict.get(key) ?? lowerDict.get(key.toLowerCase());
        if (direct !== undefined) return direct;

        const punctMatch = TRAILING_PUNCT_RE.exec(key);
        if (punctMatch) {
            const base = key.slice(0, -punctMatch[0].length).trimEnd();
            if (base) {
                const baseHit = dict.get(base) ?? lowerDict.get(base.toLowerCase());
                if (baseHit !== undefined) {
                    const zhPunct = punctMatch[0] === ':' ? '：' : '…';
                    if (
                        baseHit.endsWith(zhPunct) ||
                        (zhPunct === '：' && baseHit.endsWith(':')) ||
                        (zhPunct === '…' && baseHit.endsWith('...'))
                    ) {
                        return baseHit;
                    }
                    return baseHit + zhPunct;
                }
            }
        }
        return undefined;
    }

    function translateBuiltin(str) {
        let m = DMY_DATE_RE.exec(str);
        if (m) return `${m[3]}年${SHORT_MONTHS[m[2]]}${parseInt(m[1], 10)}日`;

        m = MD_DATE_RE.exec(str);
        if (m) return (m[3] ? `${m[3]}年` : '') + `${SHORT_MONTHS[m[1]]}${parseInt(m[2], 10)}日`;

        m = MY_DATE_RE.exec(str);
        if (m) return `${m[2]}年${FULL_MONTHS[m[1]]}`;

        m = SORT_PREFIX_RE.exec(str);
        if (m) {
            const sub = lookupDict(m[1].trim());
            if (sub !== undefined) return `排序：${sub}`;
        }

        m = STATUS_DATE_PREFIX_RE.exec(str);
        if (m) {
            const subRes = translateCore(m[3].trim());
            if (subRes !== null) {
                const prefix = m[1] ? '最后' : '';
                const action = m[2].toLowerCase() === 'created' ? '创建于 ' : '更新于 ';
                return `${prefix}${action}${subRes}`;
            }
        }

        return null;
    }

    function translateCore(lookupKey) {
        const dictHit = lookupDict(lookupKey);
        if (dictHit !== undefined) return dictHit;

        const builtinHit = translateBuiltin(lookupKey);
        if (builtinHit !== null) return builtinHit;

        if (enableRegExp && (anchoredRegexRules.length > 0 || partialRegexRules.length > 0)) {
            return applyRegexRules(lookupKey);
        }

        return null;
    }

    function translate(text) {
        if (!text) return null;

        // 优先精确匹配原始文本（保留带前后空格的片段词条，如 " directly."）
        const exactMatch = dict.get(text);
        if (exactMatch !== undefined) return exactMatch;

        const originalTrimmed = text.trim();
        if (!originalTrimmed || originalTrimmed.length > MAX_TEXT_LENGTH || !ASCII_LETTER_RE.test(originalTrimmed)) {
            return null;
        }

        const lookupKey = originalTrimmed.replace(MULTI_SPACE_RE, ' ');
        const directOriginal = lookupKey !== originalTrimmed ? dict.get(originalTrimmed) : undefined;
        const result = directOriginal ?? translateCore(lookupKey);

        if (result !== null && result !== undefined) {
            return text.replace(originalTrimmed, () => result);
        }

        return null;
    }

    function translateTextNode(node) {
        if (!node.isConnected) return;
        const val = node.nodeValue;
        if (!val || translatedTextMap.get(node) === val) return;

        const res = translate(val);
        if (res !== null && res !== val) {
            translatedTextMap.set(node, res);
            node.nodeValue = res;
        } else {
            translatedTextMap.set(node, val);
        }
    }

    function checkAndTranslateAttr(el, attr, cache) {
        if (!el.hasAttribute(attr)) return;
        const val = el.getAttribute(attr);
        if (!val || cache[attr] === val) return;

        const res = translate(val);
        if (res !== null && res !== val) {
            cache[attr] = res;
            el.setAttribute(attr, res);
        } else {
            cache[attr] = val;
        }
    }

    function translateElementAttributes(el) {
        if (!el.isConnected) return;
        let cache = translatedAttrMap.get(el);
        if (!cache) {
            cache = Object.create(null);
            translatedAttrMap.set(el, cache);
        }

        if (el.tagName === 'INPUT') {
            if (el.type === 'button' || el.type === 'submit') {
                checkAndTranslateAttr(el, 'value', cache);
            } else {
                checkAndTranslateAttr(el, 'placeholder', cache);
            }
        } else if (el.hasAttribute('placeholder')) {
            checkAndTranslateAttr(el, 'placeholder', cache);
        }

        for (let i = 0; i < TRANSLATABLE_ATTRS.length; i++) {
            checkAndTranslateAttr(el, TRANSLATABLE_ATTRS[i], cache);
        }
    }

    function extractNodes(root) {
        if (!root || (root.nodeType === Node.ELEMENT_NODE && root.closest && root.closest(UNSAFE_SELECTOR))) {
            return;
        }

        if (root.nodeType === Node.ELEMENT_NODE && root.matches && root.matches(ATTR_SELECTOR)) {
            pendingElem.add(root);
        }

        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
                acceptNode(node) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.matches && node.matches(UNSAFE_SELECTOR)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        if (node.matches && node.matches(ATTR_SELECTOR)) {
                            pendingElem.add(node);
                        }
                        return NodeFilter.FILTER_SKIP;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let currentNode;
        while ((currentNode = walker.nextNode())) {
            if (translatedTextMap.get(currentNode) !== currentNode.nodeValue) {
                pendingText.add(currentNode);
            }
        }
    }

    function scheduleWork() {
        if (!isWorking && (pendingElem.size > 0 || pendingText.size > 0)) {
            isWorking = true;
            requestAnimationFrame(workLoop);
        }
    }

    function workLoop() {
        const start = performance.now();
        let count = 0;
        let exceeded = false;

        for (const el of pendingElem) {
            pendingElem.delete(el);
            translateElementAttributes(el);
            if (++count % TIME_CHECK_INTERVAL === 0 && (performance.now() - start) >= TIME_SLICE_MS) {
                exceeded = true;
                break;
            }
        }

        if (!exceeded) {
            for (const node of pendingText) {
                pendingText.delete(node);
                translateTextNode(node);
                if (++count % TIME_CHECK_INTERVAL === 0 && (performance.now() - start) >= TIME_SLICE_MS) {
                    exceeded = true;
                    break;
                }
            }
        }

        if (pendingElem.size > 0 || pendingText.size > 0) {
            requestAnimationFrame(workLoop);
        } else {
            isWorking = false;
        }
    }

    const observer = new MutationObserver(mutations => {
        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];

            if (m.type === 'childList') {
                for (let j = 0; j < m.addedNodes.length; j++) {
                    const node = m.addedNodes[j];
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.closest && node.closest(UNSAFE_SELECTOR)) continue;
                        extractNodes(node);
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        if (
                            node.parentElement &&
                            !node.parentElement.closest(UNSAFE_SELECTOR) &&
                            translatedTextMap.get(node) !== node.nodeValue
                        ) {
                            pendingText.add(node);
                        }
                    }
                }
            } else if (m.type === 'characterData') {
                const node = m.target;
                if (
                    translatedTextMap.get(node) !== node.nodeValue &&
                    node.parentElement &&
                    !node.parentElement.closest(UNSAFE_SELECTOR)
                ) {
                    pendingText.add(node);
                }
            } else if (m.type === 'attributes') {
                const el = m.target;
                if (el.nodeType !== Node.ELEMENT_NODE || el.closest(UNSAFE_SELECTOR)) continue;
                const attr = m.attributeName;
                const cache = translatedAttrMap.get(el);
                if (cache && attr && cache[attr] === el.getAttribute(attr)) continue;
                pendingElem.add(el);
            }
        }

        scheduleWork();
    });

    function applyConfig(configData) {
        if (!document.body) return;
        buildDictionary(configData);
        extractNodes(document.body);
        scheduleWork();

        if (!isObserverAttached) {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: OBSERVED_ATTRS
            });
            isObserverAttached = true;
        }
    }

    function requestDict(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: `${url}?t=${Date.now()}`,
                timeout: REQUEST_TIMEOUT_MS,
                onload: (res) => {
                    if (res.status !== 200) {
                        reject(new Error(`HTTP ${res.status}`));
                        return;
                    }
                    try {
                        const data = JSON.parse(res.responseText);
                        if (!data || typeof data.translations !== 'object') {
                            reject(new Error('词库格式无效'));
                            return;
                        }
                        resolve(data);
                    } catch (err) {
                        reject(err);
                    }
                },
                onerror: () => reject(new Error('网络请求失败')),
                ontimeout: () => reject(new Error('请求超时'))
            });
        });
    }

    async function fetchAndUpdateDict({ force = false, notify = false } = {}) {
        const meta = GM_getValue(CACHE_META_KEY, null);
        if (!force && meta && typeof meta.lastFetch === 'number' && (Date.now() - meta.lastFetch) < FETCH_INTERVAL_MS) {
            return;
        }

        let remoteData = null;
        try {
            remoteData = await requestDict(PRIMARY_DICT_URL);
        } catch (primaryErr) {
            console.warn('[HF中文插件] 主词库源拉取失败，尝试备用源:', primaryErr.message);
            try {
                remoteData = await requestDict(FALLBACK_DICT_URL);
            } catch (fallbackErr) {
                console.error('[HF中文插件] 词库更新失败:', fallbackErr);
                if (notify) {
                    GM_notification({ title: 'HuggingFace 汉化', text: '词库更新失败，请检查网络连接', timeout: 3000 });
                }
                return;
            }
        }

        GM_setValue(CACHE_META_KEY, { lastFetch: Date.now() });

        if (!currentVersion || remoteData.version !== currentVersion) {
            GM_setValue(CACHE_KEY, remoteData);
            console.info(`[HF中文插件] 词库已更新至: ${remoteData.version}`);
            applyConfig(remoteData);
            if (notify) {
                GM_notification({
                    title: 'HuggingFace 汉化',
                    text: `词库已更新至 ${remoteData.version}`,
                    timeout: 3000
                });
            }
        } else if (notify) {
            GM_notification({
                title: 'HuggingFace 汉化',
                text: `当前已是最新词库 (${currentVersion})`,
                timeout: 3000
            });
        }
    }

    function registerMenuCommands() {
        GM_registerMenuCommand(`${enableRegExp ? '🟢 关闭' : '🔴 开启'}正则翻译`, () => {
            GM_setValue(REGEX_ENABLED_KEY, !enableRegExp);
            GM_notification({
                title: 'HuggingFace 汉化',
                text: `已${!enableRegExp ? '开启' : '关闭'}正则翻译，即将刷新页面`,
                timeout: 2000
            });
            location.reload();
        });

        GM_registerMenuCommand('🔄 立即更新汉化词库', () => {
            fetchAndUpdateDict({ force: true, notify: true });
        });
    }

    function launch() {
        if (!document.body) return;

        registerMenuCommands();

        const localData = GM_getValue(CACHE_KEY, null);
        if (localData && localData.translations) {
            applyConfig(localData);
        }

        fetchAndUpdateDict({ force: !localData || !localData.translations, notify: false });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', launch, { once: true });
    } else {
        launch();
    }
})();
