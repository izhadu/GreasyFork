// ==UserScript==
// @name         HuggingFace 汉化（词库 + AI/多源在线翻译版）
// @name:en      HuggingFace Chinese Translator (Dict + AI/Online Fallback)
// @namespace    https://github.com/izhadu/GreasyFork
// @description  像「沉浸式翻译」那样中文化 Hugging Face 界面与内容：界面术语采用本地词库 + 时间切片 0 延迟精准汉化；未命中长句、Model/Dataset Card (README)、论文摘要与讨论区支持 AI（硅基流动/智谱/DeepSeek等 OpenAI 兼容接口）及多翻译源自动兜底，支持一键开关与原文还原。
// @copyright    2026, izhadu
// @icon         https://huggingface.co/front/assets/huggingface_logo-noborder.svg
// @version      7.0.0
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
// @connect      edge.microsoft.com
// @connect      api.cognitive.microsofttranslator.com
// @connect      translate.googleapis.com
// @connect      fanyi.youdao.com
// @connect      transmart.qq.com
// @connect      api.mymemory.translated.net
// @connect      fanyi-api.baidu.com
// @connect      tmt.tencentcloudapi.com
// @connect      api.siliconflow.cn
// @connect      open.bigmodel.cn
// @connect      api.deepseek.com
// @connect      api.openai.com
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @supportURL   https://github.com/izhadu/GreasyFork/issues
// ==/UserScript==

(function () {
    'use strict';

    /* ============================================================
     * 一、核心配置与常量
     * ============================================================ */
    const PRIMARY_DICT_URL = "https://git.zhadu.com/github.com/izhadu/GreasyFork/blob/main/HuggingFace-Chinese/dict.json";
    const FALLBACK_DICT_URL = "https://raw.githubusercontent.com/izhadu/GreasyFork/main/HuggingFace-Chinese/dict.json";

    const CACHE_KEY = "hf_zh_dict_data";
    const CACHE_META_KEY = "hf_zh_dict_meta";
    const REGEX_ENABLED_KEY = "enable_RegExp";
    const ONLINE_ENABLED_KEY = "hf_zh_online_enabled";
    const ONLINE_CACHE_KEY = "hf_zh_online_cache_v1";
    const CREDS_KEY = "hf_zh_creds_v1";

    const FETCH_INTERVAL_MS = 6 * 60 * 60 * 1000;
    const REQUEST_TIMEOUT_MS = 10000;
    const MAX_TEXT_LENGTH = 500;
    const TIME_SLICE_MS = 12;
    const TIME_CHECK_INTERVAL = 20;
    const ONLINE_CACHE_MAX = 5000;

    const CFG = {
        online: GM_getValue(ONLINE_ENABLED_KEY, false), // 在线/AI 兜底总开关（默认关闭，开启后未命中长句自动翻译）
        enableRegExp: GM_getValue(REGEX_ENABLED_KEY, true),
        providers: ['ai', 'baidu', 'tencentcloud', 'tencent', 'bing', 'youdao', 'google', 'mymemory'],
        batchItems: 20,
        batchChars: 2200,
        apiDelay: 80,
        maxRetry: 2,
        translateReadme: false,     // 页面内按钮控制：是否翻译模型卡/数据集卡/论文摘要正文
        translateDiscussion: false  // 页面内按钮控制：是否翻译讨论/PR 评论正文
    };

    // 绝对禁区：代码块、编辑器、公式、文件名列表、搜索下拉建议等永远不翻译
    const HARD_SKIP_SELECTOR = [
        'script', 'style', 'code', 'pre', 'kbd', 'samp', 'var', 'noscript', 'textarea',
        'svg', 'iframe', 'canvas', 'math', 'object',
        '[contenteditable="true"]', '[translate="no"]', '.notranslate',
        '[data-hf-zh-skip]', '[data-hf-zh-toggle]',
        '.cm-editor', '.monaco-editor', '.ace_editor', '.font-mono', '.shiki', '.highlight',
        '.blob-wrapper', '.blob-code', '.blob-line', '.file-content', '.whitespace-pre',
        '.cm-content', '.cm-line', '.token',
        '[class*="language-"]', '[class*="hljs"]', '[data-testid="file-content"]',
        '[class*="sourceCode"]', '[class*="syntax"]', '[style*="monospace"]',
        '[role="searchbox"]', '[role="listbox"]', '[role="option"]', '[role="tree"]'
    ].join(', ');

    // 正文区域选择器（默认保护不乱翻，点击页面「AI 翻译正文」按钮后才翻译）
    const README_SELECTORS = '.prose, .markdown-body, .model-card-content, .dataset-card-content, .space-card-content, .blog-content';
    const DISCUSSION_SELECTORS = '[class*="comment-body"], [class*="discussion-body"], .comment-content';

    // 用户名 / 仓库路径等专有名词选择器
    const USER_REPO_SELECTORS = '[data-testid="breadcrumb"], a[href^="/models/"], a[href^="/datasets/"], a[href^="/spaces/"]';

    const ATTR_SELECTOR = '[placeholder], [title], [aria-label], [data-confirm], input[type="button"][value], input[type="submit"][value]';
    const TRANSLATABLE_ATTRS = ['title', 'aria-label', 'data-confirm'];
    const OBSERVED_ATTRS = ['placeholder', 'title', 'aria-label', 'value', 'data-confirm'];

    const ASCII_LETTER_RE = /[a-zA-Z]/;
    const CJK_RE = /[\u2E80-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;
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

    let translatedTextMap = new WeakMap();
    let translatedAttrMap = new WeakMap();
    const originalTextMap = new WeakMap(); // 节点 -> 原始英文（用于一键还原）
    const zhToEn = new Map();              // 在线译文 -> 英文原文

    const pendingText = new Set();
    const pendingElem = new Set();
    let isWorking = false;

    /* ============================================================
     * 二、在线翻译持久化缓存与凭据管理
     * ============================================================ */
    const onlineCache = new Map();
    (function loadOnlineCache() {
        try {
            const raw = GM_getValue(ONLINE_CACHE_KEY, '');
            if (!raw) return;
            const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
            for (const k in obj) onlineCache.set(k, obj[k]);
        } catch (e) {}
    })();

    let saveCacheTimer = null;
    function saveOnlineCache() {
        if (saveCacheTimer) return;
        saveCacheTimer = setTimeout(() => {
            saveCacheTimer = null;
            try {
                const entries = [...onlineCache.entries()].slice(-ONLINE_CACHE_MAX);
                GM_setValue(ONLINE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
            } catch (e) {}
        }, 1500);
    }

    const creds = (function loadCreds() {
        try {
            const raw = GM_getValue(CREDS_KEY, '');
            if (!raw) return {};
            return (typeof raw === 'string' ? JSON.parse(raw) : raw) || {};
        } catch (e) {
            return {};
        }
    })();

    function saveCreds() {
        try {
            GM_setValue(CREDS_KEY, JSON.stringify(creds));
        } catch (e) {}
    }

    function isConfigured(name) {
        if (name === 'baidu') return !!(creds.baidu && creds.baidu.appid && creds.baidu.key);
        if (name === 'tencentcloud') return !!(creds.tencentcloud && creds.tencentcloud.secretId && creds.tencentcloud.secretKey);
        if (name === 'ai') return !!(creds.ai && creds.ai.apiKey && creds.ai.model && creds.ai.baseUrl);
        return true;
    }

    /* ============================================================
     * 三、本地词库构建与快速匹配引擎
     * ============================================================ */
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

        if (CFG.enableRegExp && (anchoredRegexRules.length > 0 || partialRegexRules.length > 0)) {
            return applyRegexRules(lookupKey);
        }

        return null;
    }

    function translateLocal(text) {
        if (!text) return null;

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

    /* ============================================================
     * 四、在线/AI 翻译判定与多源请求引擎
     * ============================================================ */
    function isOnlineTranslatable(text) {
        const t = (text || '').trim();
        if (t.length < 3 || t.length > 1200) return false;
        if (CJK_RE.test(t)) return false;
        if (!ASCII_LETTER_RE.test(t)) return false;
        // 单个词不走在线机翻，防止误翻模型名、作者名、标签或专有名词
        if (!/\s/.test(t)) return false;
        if (/^[\d\s\W]+$/.test(t)) return false;
        if (/^v?\d+(\.\d+){1,4}[-+.\w]*$/i.test(t)) return false;
        if (/^(https?:\/\/|www\.)/i.test(t)) return false;
        // 形如 owner/repo 的仓库标识符不翻译
        if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(t)) return false;
        return true;
    }

    function isProtectedContentZone(el) {
        if (!el || !el.closest) return false;
        if (el.closest(README_SELECTORS)) return !CFG.translateReadme;
        if (el.closest(DISCUSSION_SELECTORS)) return !CFG.translateDiscussion;
        return false;
    }

    function gmRequest(opts) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                timeout: REQUEST_TIMEOUT_MS,
                onload: (r) => (r.status >= 200 && r.status < 300)
                    ? resolve(r.responseText)
                    : reject(new Error('HTTP ' + r.status)),
                onerror: () => reject(new Error('network')),
                ontimeout: () => reject(new Error('timeout')),
                ...opts
            });
        });
    }
    const gmGet = (url) => gmRequest({ method: 'GET', url });
    const gmPost = (url, body, headers = {}) => gmRequest({ method: 'POST', url, data: body, headers });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // 1. AI 翻译（OpenAI 兼容接口：硅基流动 / 智谱 GLM / DeepSeek / OpenAI 等）
    async function aiBatch(texts) {
        if (!isConfigured('ai')) throw new Error('ai unconfigured');
        const a = creds.ai;
        const base = String(a.baseUrl).replace(/\/+$/, '');
        const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
        const body = JSON.stringify({
            model: a.model,
            temperature: 0,
            messages: [
                {
                    role: 'system',
                    content: 'You are a professional AI/ML localization engine for Hugging Face. Translate each input English string into natural Simplified Chinese (keep technical identifiers like PyTorch, Safetensors, GGUF, LoRA, Transformers, ZeroGPU intact). Return ONLY a valid JSON array of translated strings with the exact same length and order, without markdown code fences or explanations.'
                },
                { role: 'user', content: JSON.stringify(texts) }
            ]
        });
        const res = await gmPost(url, body, {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + a.apiKey
        });
        const data = JSON.parse(res);
        const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        const cleaned = content.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        const arr = JSON.parse(cleaned);
        if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error('ai align');
        return arr.map((x) => String(x));
    }

    // 2. 百度翻译 API（需 APPID + Key）
    function utf8(s) {
        try { return unescape(encodeURIComponent(s)); } catch (e) { return s; }
    }
    function md5(str) {
        function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
        function cmn(q, a, b, x, s2, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s2) | (a >>> (32 - s2)), b); }
        function ff(a, b, c, d, x, s2, t) { return cmn((b & c) | ((~b) & d), a, b, x, s2, t); }
        function gg(a, b, c, d, x, s2, t) { return cmn((b & d) | (c & (~d)), a, b, x, s2, t); }
        function hh(a, b, c, d, x, s2, t) { return cmn(b ^ c ^ d, a, b, x, s2, t); }
        function ii(a, b, c, d, x, s2, t) { return cmn(c ^ (b | (~d)), a, b, x, s2, t); }
        function md5blk(s2) {
            const k = [];
            for (let i = 0; i < 64; i += 4) {
                k[i >> 2] = s2.charCodeAt(i) + (s2.charCodeAt(i + 1) << 8) + (s2.charCodeAt(i + 2) << 16) + (s2.charCodeAt(i + 3) << 24);
            }
            return k;
        }
        function cycle(x, k) {
            let a = x[0], b = x[1], c = x[2], d = x[3];
            a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586); c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
            a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426); c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
            a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417); c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
            a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101); c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
            a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632); c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
            a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083); c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
            a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690); c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
            a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784); c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
            a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463); c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
            a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353); c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
            a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222); c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
            a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835); c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
            a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415); c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
            a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606); c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
            a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744); c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
            a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379); c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
            x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
        }
        function md5str(s2) {
            const n = s2.length, state = [1732584193, -271733879, -1732584194, 271733878];
            let i;
            for (i = 64; i <= s2.length; i += 64) cycle(state, md5blk(s2.substring(i - 64, i)));
            s2 = s2.substring(i - 64);
            let tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            for (i = 0; i < s2.length; i++) tail[i >> 2] |= s2.charCodeAt(i) << ((i % 4) << 3);
            tail[i >> 2] |= 0x80 << ((i % 4) << 3);
            if (i > 55) { cycle(state, tail); tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
            tail[14] = n * 8;
            cycle(state, tail);
            return state;
        }
        function rhex(n) {
            let s2 = '';
            for (let j = 0; j < 4; j++) s2 += ('0' + ((n >> (j * 8)) & 255).toString(16)).slice(-2);
            return s2;
        }
        return md5str(str).map(rhex).join('');
    }

    async function baiduBatch(texts) {
        if (!isConfigured('baidu')) throw new Error('baidu unconfigured');
        const { appid, key } = creds.baidu;
        const q = texts.join('\n');
        const salt = String(Date.now());
        const sign = md5(utf8(appid + q + salt + key));
        const url = 'https://fanyi-api.baidu.com/api/trans/vip/translate?q=' + encodeURIComponent(q)
            + '&from=auto&to=zh&appid=' + encodeURIComponent(appid)
            + '&salt=' + salt + '&sign=' + sign;
        const data = JSON.parse(await gmGet(url));
        if (!data || data.error_code) throw new Error('baidu ' + (data ? data.error_code : 'empty'));
        const arr = (data.trans_result || []).map((x) => x.dst);
        if (arr.length !== texts.length) throw new Error('baidu align');
        return arr;
    }

    // 3. 腾讯云机器翻译 TMT（TC3-HMAC-SHA256 签名）
    function hexOf(buf) {
        return Array.prototype.map.call(new Uint8Array(buf), (b) => ('0' + b.toString(16)).slice(-2)).join('');
    }
    async function sha256Hex(str) {
        return hexOf(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
    }
    async function hmacHex(keyStr, msgStr) {
        const enc = new TextEncoder();
        const k = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return hexOf(await crypto.subtle.sign('HMAC', k, enc.encode(msgStr)));
    }
    async function tencentCloudOne(text) {
        const c = creds.tencentcloud;
        const region = c.region || 'ap-guangzhou';
        const service = 'tmt', host = 'tmt.tencentcloudapi.com', action = 'TextTranslate', version = '2018-03-21';
        const payload = JSON.stringify({ SourceText: text, Source: 'en', Target: 'zh', ProjectId: 0 });
        const ts = Math.floor(Date.now() / 1000);
        const date = new Date(ts * 1000).toISOString().slice(0, 10);
        const ct = 'application/json; charset=utf-8';
        const canonicalHeaders = 'content-type:' + ct + '\nhost:' + host + '\n';
        const signedHeaders = 'content-type;host';
        const hashedPayload = await sha256Hex(payload);
        const canonicalRequest = 'POST\n/\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + hashedPayload;
        const credentialScope = date + '/' + service + '/tc3_request';
        const stringToSign = 'TC3-HMAC-SHA256\n' + ts + '\n' + credentialScope + '\n' + await sha256Hex(canonicalRequest);
        const secretDate = await hmacHex('TC3' + c.secretKey, date);
        const secretService = await hmacHex(secretDate, service);
        const secretSigning = await hmacHex(secretService, 'tc3_request');
        const signature = await hmacHex(secretSigning, stringToSign);
        const auth = 'TC3-HMAC-SHA256 Credential=' + c.secretId + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
        const res = await gmPost('https://' + host, payload, {
            'Content-Type': ct, 'Authorization': auth, 'X-TC-Action': action,
            'X-TC-Timestamp': String(ts), 'X-TC-Version': version, 'X-TC-Region': region
        });
        const data = JSON.parse(res);
        const r = data.Response || {};
        if (r.Error) throw new Error('tencentcloud ' + r.Error.Code);
        return (r.TextTranslate && r.TextTranslate.TargetText) || '';
    }
    async function tencentCloudBatch(texts) {
        if (!isConfigured('tencentcloud')) throw new Error('tencentcloud unconfigured');
        const out = [];
        for (let i = 0; i < texts.length; i++) {
            out.push(await tencentCloudOne(texts[i]));
            await sleep(80);
        }
        return out;
    }

    // 4. 腾讯交互翻译 Transmart（免费免 Key）
    async function tencentBatch(texts) {
        const body = JSON.stringify({
            header: { fn: 'auto_translation', client_key: 'browser-chrome-120.0.0-' + Date.now() },
            type: 'plain',
            model_category: 'normal',
            source: { lang: 'en', text_list: texts },
            target: { lang: 'zh' }
        });
        const res = await gmPost('https://transmart.qq.com/api/imt', body, {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        });
        const data = JSON.parse(res);
        const arr = data && (data.auto_translation || (data.data && data.data.auto_translation));
        if (Array.isArray(arr) && arr.length === texts.length) return arr.map((x) => (x == null ? '' : String(x)));
        throw new Error('tencent bad');
    }

    // 5. 必应 / Edge 内置翻译（免费免 Key）
    let bingToken = null, bingTokenExp = 0;
    async function bingBatch(texts) {
        if (!bingToken || Date.now() > bingTokenExp) {
            const jwt = await gmGet('https://edge.microsoft.com/translate/auth');
            bingToken = (jwt || '').trim();
            if (!bingToken) throw new Error('bing auth empty');
            bingTokenExp = Date.now() + 8 * 60 * 1000;
        }
        const body = JSON.stringify(texts.map((t) => ({ Text: t })));
        const res = await gmPost(
            'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hans',
            body,
            { 'Authorization': 'Bearer ' + bingToken, 'Content-Type': 'application/json' }
        );
        const arr = JSON.parse(res);
        return arr.map((o) => (o.translations && o.translations[0] ? o.translations[0].text : ''));
    }

    // 6. 有道免费接口
    async function youdaoBatch(texts) {
        const url = 'https://fanyi.youdao.com/translate?&doctype=json&type=AUTO&i=' + encodeURIComponent(texts.join('\n'));
        const data = JSON.parse(await gmGet(url));
        if (!data || !data.translateResult) throw new Error('youdao empty');
        const out = data.translateResult.map((line) => line.map((seg) => seg.tgt || '').join(''));
        if (out.length !== texts.length) throw new Error('youdao align');
        return out;
    }

    // 7. Google 免费接口
    async function googleBatch(texts) {
        const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q='
            + encodeURIComponent(texts.join('\n'));
        const data = JSON.parse(await gmGet(url));
        if (!data || !data[0]) throw new Error('google empty');
        let out = '';
        for (const seg of data[0]) if (seg && seg[0]) out += seg[0];
        const parts = out.split('\n');
        if (parts.length !== texts.length) throw new Error('google align');
        return parts;
    }

    // 8. MyMemory 免费兜底
    async function myMemoryBatch(texts) {
        const out = [];
        for (const t of texts) {
            const url = 'https://api.mymemory.translated.net/get?langpair=en|zh-CN&q=' + encodeURIComponent(t);
            const data = JSON.parse(await gmGet(url));
            const s = (data && data.responseData && data.responseData.translatedText) || '';
            if (!s) throw new Error('mymemory empty');
            out.push(s);
            await sleep(120);
        }
        return out;
    }

    const PROVIDERS = {
        ai: aiBatch,
        baidu: baiduBatch,
        tencentcloud: tencentCloudBatch,
        tencent: tencentBatch,
        bing: bingBatch,
        youdao: youdaoBatch,
        google: googleBatch,
        mymemory: myMemoryBatch
    };

    // 翻译源熔断：连续失败 2 次冷却 5 分钟
    const providerState = Object.create(null);
    function providerAvailable(name) {
        if (!isConfigured(name)) return false;
        const st = providerState[name];
        return !st || !st.until || Date.now() > st.until;
    }
    function providerFail(name) {
        const st = providerState[name] || (providerState[name] = { fails: 0, until: 0 });
        st.fails += 1;
        if (st.fails >= 2) {
            st.until = Date.now() + 5 * 60 * 1000;
            st.fails = 0;
        }
    }
    function providerOk(name) {
        const st = providerState[name];
        if (st) st.fails = 0;
    }

    async function translateTextsOnline(texts) {
        for (const name of CFG.providers) {
            const fn = PROVIDERS[name];
            if (!fn || !providerAvailable(name)) continue;
            try {
                const r = await fn(texts);
                if (Array.isArray(r) && r.length === texts.length) {
                    providerOk(name);
                    return r;
                }
                providerFail(name);
            } catch (e) {
                providerFail(name);
                console.debug('[HF中文插件] 翻译源切换:', name, e && e.message);
            }
        }
        return null;
    }

    /* ============================================================
     * 五、在线批量队列与懒加载调度
     * ============================================================ */
    const apiQueue = [];
    const queuedOnlineNodes = new WeakSet();
    let apiRunning = false;
    let flushTimer = null;

    function applyTextToNode(node, trimmedSrc, zh) {
        if (!node || !node.isConnected) return;
        const raw = node.nodeValue || '';
        if (!originalTextMap.has(node)) originalTextMap.set(node, raw);
        const nextVal = raw.replace(trimmedSrc, () => zh);
        translatedTextMap.set(node, nextVal);
        zhToEn.set(zh, trimmedSrc);
        node.nodeValue = nextVal;
    }

    function enqueueNodeForOnline(node) {
        if (!node || !node.isConnected || queuedOnlineNodes.has(node)) return;
        const raw = node.nodeValue || '';
        const trimmed = raw.trim();
        if (!isOnlineTranslatable(trimmed)) return;

        const norm = trimmed.replace(MULTI_SPACE_RE, ' ');
        if (onlineCache.has(norm)) {
            applyTextToNode(node, trimmed, onlineCache.get(norm));
            return;
        }

        queuedOnlineNodes.add(node);
        apiQueue.push(node);
        if (!flushTimer) {
            flushTimer = setTimeout(drainApiQueue, 150);
        }
    }

    function chunkOnlineNodes(nodes) {
        const groups = [];
        let cur = [], chars = 0;
        for (const node of nodes) {
            if (!node.isConnected) continue;
            const t = (node.nodeValue || '').trim();
            if (!t) continue;
            if (cur.length >= CFG.batchItems || (chars + t.length > CFG.batchChars && cur.length > 0)) {
                groups.push(cur);
                cur = [];
                chars = 0;
            }
            cur.push(node);
            chars += t.length;
        }
        if (cur.length) groups.push(cur);
        return groups;
    }

    async function drainApiQueue() {
        flushTimer = null;
        if (apiRunning) return;
        apiRunning = true;
        try {
            while (apiQueue.length > 0) {
                const batch = apiQueue.splice(0, apiQueue.length);
                const groups = chunkOnlineNodes(batch);
                for (const group of groups) {
                    const rawTrimmed = [];
                    const normTexts = [];
                    const validNodes = [];

                    for (const node of group) {
                        if (!node.isConnected) continue;
                        const t = (node.nodeValue || '').trim();
                        const norm = t.replace(MULTI_SPACE_RE, ' ');
                        if (onlineCache.has(norm)) {
                            applyTextToNode(node, t, onlineCache.get(norm));
                            continue;
                        }
                        validNodes.push(node);
                        rawTrimmed.push(t);
                        normTexts.push(norm);
                    }

                    if (!validNodes.length) continue;

                    const results = await translateTextsOnline(normTexts);
                    if (results) {
                        for (let i = 0; i < validNodes.length; i++) {
                            const zh = (results[i] || '').trim();
                            if (zh && CJK_RE.test(zh)) {
                                onlineCache.set(normTexts[i], zh);
                                applyTextToNode(validNodes[i], rawTrimmed[i], zh);
                            }
                        }
                        saveOnlineCache();
                    }
                    if (CFG.apiDelay) await sleep(CFG.apiDelay);
                }
            }
        } finally {
            apiRunning = false;
        }
    }

    function restoreOnlineTranslations(root = document.body) {
        if (!root) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
            if (originalTextMap.has(n)) {
                const orig = originalTextMap.get(n);
                translatedTextMap.set(n, orig);
                n.nodeValue = orig;
                originalTextMap.delete(n);
                queuedOnlineNodes.delete(n);
            }
        }
    }

    /* ============================================================
     * 六、DOM 遍历与时间切片引擎
     * ============================================================ */
    function translateTextNode(node) {
        if (!node.isConnected) return;
        const val = node.nodeValue;
        if (!val || translatedTextMap.get(node) === val) return;

        const parent = node.parentElement;
        if (!parent) return;

        // 1. 优先走本地词库与内置正则（0 延迟）
        const localRes = translateLocal(val);
        if (localRes !== null && localRes !== val) {
            translatedTextMap.set(node, localRes);
            node.nodeValue = localRes;
            return;
        }

        // 2. 本地未命中时：检查是否允许走在线/AI 翻译
        translatedTextMap.set(node, val);
        if (parent.tagName === 'OPTION') return;
        if (parent.closest && parent.closest(USER_REPO_SELECTORS)) return;

        const inReadme = !!(parent.closest && parent.closest(README_SELECTORS));
        const inDiscussion = !!(parent.closest && parent.closest(DISCUSSION_SELECTORS));

        if (inReadme) {
            if (CFG.translateReadme) enqueueNodeForOnline(node);
            return;
        }
        if (inDiscussion) {
            if (CFG.translateDiscussion) enqueueNodeForOnline(node);
            return;
        }

        if (CFG.online) {
            enqueueNodeForOnline(node);
        }
    }

    function checkAndTranslateAttr(el, attr, cache) {
        if (!el.hasAttribute(attr)) return;
        const val = el.getAttribute(attr);
        if (!val || cache[attr] === val) return;

        const res = translateLocal(val);
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
        if (!root || (root.nodeType === Node.ELEMENT_NODE && root.closest && root.closest(HARD_SKIP_SELECTOR))) {
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
                        if (node.matches && node.matches(HARD_SKIP_SELECTOR)) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        if (isProtectedContentZone(node)) {
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

    /* ============================================================
     * 七、页面内「AI 翻译正文」快捷按钮（Model/Dataset Card & 讨论区）
     * ============================================================ */
    const TOGGLE_STYLE = `
        [data-hf-zh-toggle] {
            all: unset;
            box-sizing: border-box;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-left: 8px;
            padding: 2px 10px;
            border: 1px solid rgba(120, 120, 128, 0.25);
            border-radius: 999px;
            font-size: 12px;
            font-weight: 500;
            line-height: 18px;
            color: inherit;
            background: rgba(120, 120, 128, 0.08);
            vertical-align: middle;
            transition: all 0.15s ease;
            white-space: nowrap;
            user-select: none;
        }
        [data-hf-zh-toggle]:hover {
            background: rgba(255, 157, 11, 0.15);
            border-color: #ff9d0b;
        }
        [data-hf-zh-toggle][data-on] {
            background: rgba(255, 157, 11, 0.2);
            border-color: #ff9d0b;
            color: #d97706;
        }
    `;

    function ensureToggleStyle() {
        if (document.getElementById('hf-zh-toggle-style')) return;
        const st = document.createElement('style');
        st.id = 'hf-zh-toggle-style';
        st.textContent = TOGGLE_STYLE;
        (document.head || document.documentElement).appendChild(st);
    }

    function toggleContentZone(kind, btn) {
        const isReadme = kind === 'readme';
        const next = isReadme ? !CFG.translateReadme : !CFG.translateDiscussion;
        if (isReadme) CFG.translateReadme = next;
        else CFG.translateDiscussion = next;

        const baseLabel = isReadme ? 'AI 翻译卡片正文' : 'AI 翻译讨论';
        if (next) {
            btn.setAttribute('data-on', '');
            btn.textContent = '✓ ' + baseLabel;
        } else {
            btn.removeAttribute('data-on');
            btn.textContent = '🌐 ' + baseLabel;
        }

        const selector = isReadme ? README_SELECTORS : DISCUSSION_SELECTORS;
        const zones = document.querySelectorAll(selector);
        zones.forEach((zone) => {
            if (next) {
                // 清除已读缓存标记以触发在线翻译
                const walker = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
                let n;
                while ((n = walker.nextNode())) {
                    translatedTextMap.delete(n);
                    queuedOnlineNodes.delete(n);
                }
                extractNodes(zone);
            } else {
                restoreOnlineTranslations(zone);
            }
        });
        if (next) scheduleWork();
    }

    function mountContentToggles() {
        if (!document.body) return;
        ensureToggleStyle();

        // 在带有 .prose 的模型卡/数据集卡/论文页顶部注入「🌐 AI 翻译卡片正文」按钮
        const proseEl = document.querySelector(README_SELECTORS);
        if (proseEl && !document.querySelector('[data-hf-zh-toggle="readme"]')) {
            const headerTarget = proseEl.parentElement && proseEl.parentElement.querySelector('h1, h2');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('data-hf-zh-toggle', 'readme');
            btn.setAttribute('data-hf-zh-skip', '');
            const on = CFG.translateReadme;
            if (on) btn.setAttribute('data-on', '');
            btn.textContent = (on ? '✓ ' : '🌐 ') + 'AI 翻译卡片正文';
            btn.title = '调用配置的 AI 或在线翻译源翻译 README / 论文正文（再次点击还原英文）';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleContentZone('readme', btn);
            });
            if (headerTarget) {
                headerTarget.appendChild(btn);
            } else {
                proseEl.insertAdjacentElement('beforebegin', btn);
            }
        }
    }

    /* ============================================================
     * 八、MutationObserver 动态观测
     * ============================================================ */
    const observer = new MutationObserver(mutations => {
        let hasNewElements = false;
        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];

            if (m.type === 'childList') {
                for (let j = 0; j < m.addedNodes.length; j++) {
                    const node = m.addedNodes[j];
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.closest && node.closest(HARD_SKIP_SELECTOR)) continue;
                        if (isProtectedContentZone(node)) continue;
                        extractNodes(node);
                        hasNewElements = true;
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        const p = node.parentElement;
                        if (
                            p &&
                            !p.closest(HARD_SKIP_SELECTOR) &&
                            !isProtectedContentZone(p) &&
                            translatedTextMap.get(node) !== node.nodeValue
                        ) {
                            pendingText.add(node);
                        }
                    }
                }
            } else if (m.type === 'characterData') {
                const node = m.target;
                const p = node.parentElement;
                if (
                    translatedTextMap.get(node) !== node.nodeValue &&
                    p &&
                    !p.closest(HARD_SKIP_SELECTOR) &&
                    !isProtectedContentZone(p)
                ) {
                    queuedOnlineNodes.delete(node);
                    pendingText.add(node);
                }
            } else if (m.type === 'attributes') {
                const el = m.target;
                if (el.nodeType !== Node.ELEMENT_NODE || el.closest(HARD_SKIP_SELECTOR)) continue;
                const attr = m.attributeName;
                const cache = translatedAttrMap.get(el);
                if (cache && attr && cache[attr] === el.getAttribute(attr)) continue;
                pendingElem.add(el);
            }
        }

        if (hasNewElements) mountContentToggles();
        scheduleWork();
    });

    /* ============================================================
     * 九、词库拉取与菜单设置
     * ============================================================ */
    function applyConfig(configData) {
        if (!document.body) return;
        buildDictionary(configData);
        mountContentToggles();
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

    function toggleOnlineMode() {
        CFG.online = !CFG.online;
        GM_setValue(ONLINE_ENABLED_KEY, CFG.online);
        if (!CFG.online) {
            restoreOnlineTranslations(document.body);
        }
        GM_notification({
            title: 'HuggingFace 汉化',
            text: `在线/AI 兜底翻译已${CFG.online ? '开启' : '关闭'}，即将刷新生效`,
            timeout: 2000
        });
        location.reload();
    }

    function registerMenuCommands() {
        GM_registerMenuCommand(`① 在线/AI 兜底翻译（当前：${CFG.online ? '🟢 开' : '⚪ 关'}）[Alt+T]`, toggleOnlineMode);

        GM_registerMenuCommand(`② 正则动态翻译（当前：${CFG.enableRegExp ? '🟢 开' : '⚪ 关'}）`, () => {
            GM_setValue(REGEX_ENABLED_KEY, !CFG.enableRegExp);
            GM_notification({
                title: 'HuggingFace 汉化',
                text: `已${!CFG.enableRegExp ? '开启' : '关闭'}正则翻译，即将刷新页面`,
                timeout: 2000
            });
            location.reload();
        });

        GM_registerMenuCommand('③ 设置 AI 翻译（硅基流动 / 智谱 GLM / DeepSeek / OpenAI）', () => {
            const base = window.prompt(
                '接口地址 Base URL（如硅基流动 https://api.siliconflow.cn/v1 、智谱 https://open.bigmodel.cn/api/paas/v4 、DeepSeek https://api.deepseek.com/v1）：',
                (creds.ai && creds.ai.baseUrl) || 'https://api.siliconflow.cn/v1'
            );
            if (base === null) return;
            const key = window.prompt('API Key（留空清除）：', (creds.ai && creds.ai.apiKey) || '');
            if (key === null) return;
            const model = window.prompt(
                '模型名（如 Qwen/Qwen2.5-7B-Instruct 、glm-4-flash 、deepseek-chat）：',
                (creds.ai && creds.ai.model) || 'Qwen/Qwen2.5-7B-Instruct'
            );
            if (model === null) return;
            creds.ai = { baseUrl: base.trim(), apiKey: key.trim(), model: model.trim() };
            saveCreds();
            GM_notification({ title: 'HuggingFace 汉化', text: 'AI 翻译配置已保存', timeout: 2000 });
            location.reload();
        });

        GM_registerMenuCommand('④ 设置百度翻译（APPID / 密钥）', () => {
            const appid = window.prompt('百度翻译 APPID（留空清除）：', (creds.baidu && creds.baidu.appid) || '');
            if (appid === null) return;
            const key = window.prompt('百度翻译密钥（留空清除）：', (creds.baidu && creds.baidu.key) || '');
            if (key === null) return;
            creds.baidu = { appid: appid.trim(), key: key.trim() };
            saveCreds();
            location.reload();
        });

        GM_registerMenuCommand('⑤ 设置腾讯云机器翻译（SecretId / SecretKey）', () => {
            const sid = window.prompt('腾讯云 SecretId（留空清除）：', (creds.tencentcloud && creds.tencentcloud.secretId) || '');
            if (sid === null) return;
            const skey = window.prompt('腾讯云 SecretKey（留空清除）：', (creds.tencentcloud && creds.tencentcloud.secretKey) || '');
            if (skey === null) return;
            const region = window.prompt('地域 Region（默认 ap-guangzhou）：', (creds.tencentcloud && creds.tencentcloud.region) || 'ap-guangzhou');
            if (region === null) return;
            creds.tencentcloud = { secretId: sid.trim(), secretKey: skey.trim(), region: (region || 'ap-guangzhou').trim() };
            saveCreds();
            location.reload();
        });

        GM_registerMenuCommand('⑥ 清空在线/AI 翻译缓存', () => {
            onlineCache.clear();
            GM_setValue(ONLINE_CACHE_KEY, '');
            GM_notification({ title: 'HuggingFace 汉化', text: '在线翻译缓存已清空', timeout: 2000 });
            location.reload();
        });

        GM_registerMenuCommand('⑦ 清空所有自定义翻译密钥', () => {
            creds.ai = null;
            creds.baidu = null;
            creds.tencentcloud = null;
            saveCreds();
            GM_notification({ title: 'HuggingFace 汉化', text: '所有自定义翻译密钥已清空', timeout: 2000 });
            location.reload();
        });

        GM_registerMenuCommand('🔄 立即更新本地汉化词库', () => {
            fetchAndUpdateDict({ force: true, notify: true });
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 't' || e.key === 'T')) {
            e.preventDefault();
            toggleOnlineMode();
        }
    });

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
