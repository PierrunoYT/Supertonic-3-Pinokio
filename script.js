import * as ort from 'onnxruntime-web';
const presetTexts = window.presetTexts || {};

const PLAY_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7-11-7z"></path></svg>`;
const PAUSE_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 6h3v12H8V6zm5 0h3v12h-3V6z"></path></svg>`;
const STOP_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M7 7h10v10H7V7z"></path></svg>`;

// Lightning background parallax
(function initLightningParallax() {
    if (typeof document === 'undefined') {
        return;
    }

    const runBlink = (className, onComplete) => {
        let remaining = 1 + Math.round(Math.random());
        const blink = () => {
            if (remaining-- <= 0) {
                if (typeof onComplete === 'function') {
                    onComplete();
                }
                return;
            }
            const wait = 20 + Math.random() * 80;
            document.body.classList.add(className);
            setTimeout(() => {
                document.body.classList.remove(className);
                setTimeout(blink, wait);
            }, wait);
        };
        blink();
    };

    const schedule = () => {
        setTimeout(() => runBlink('lightning-flicker', schedule), Math.random() * 10000);
    };
    schedule();
})();

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (match) => {
        switch (match) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return match;
        }
    });
}

function getErrorMessage(error) {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error === undefined || error === null) {
        return 'Unknown error';
    }
    try {
        return JSON.stringify(error);
    } catch (_) {
        return String(error);
    }
}

function formatStatValueWithSuffix(value, suffix, options = {}) {
    const { firstLabel = false } = options;
    if (value === undefined || value === null) {
        return '';
    }
    if (!suffix) {
        const raw = `${value}`;
        return escapeHtml(raw);
    }
    const raw = `${value}`.trim();
    if (!raw || raw === '--' || raw === '-' || raw.toLowerCase() === 'error') {
        return escapeHtml(raw);
    }
    const appendSuffix = (segment, includePrefix = false) => {
        const trimmed = segment.trim();
        if (!trimmed) {
            return '';
        }
        const escapedValue = `<span class="stat-value-number">${escapeHtml(trimmed)}</span>`;
        const suffixSpan = `<span class="stat-label stat-suffix">${escapeHtml(suffix)}</span>`;
        const prefixSpan = includePrefix && firstLabel
            ? `<span class="stat-label stat-suffix stat-prefix">First</span>`
            : '';
        const segmentClass = includePrefix && firstLabel
            ? 'stat-value-segment has-prefix'
            : 'stat-value-segment';
        return `<span class="${segmentClass}">${prefixSpan}${escapedValue}${suffixSpan}</span>`;
    };
    if (raw.includes('/')) {
        const parts = raw.split('/');
        const segments = parts.map((part, index) => appendSuffix(part, index === 0));
        return segments.join(' / ');
    }
    return appendSuffix(raw);
}

/**
 * Unicode text processor
 */
export class UnicodeProcessor {
    constructor(indexer) {
        this.indexer = indexer;
    }

    call(textList, lang = null) {
        const processedTexts = textList.map(t => preprocessText(t, lang));
        const textIdsLengths = processedTexts.map(t => t.length);
        const maxLen = Math.max(...textIdsLengths);
        
        const textIds = [];
        const unsupportedChars = new Set();
        
        for (let i = 0; i < processedTexts.length; i++) {
            const row = new Array(maxLen).fill(0);
            const unicodeVals = textToUnicodeValues(processedTexts[i]);
            for (let j = 0; j < unicodeVals.length; j++) {
                const indexValue = this.indexer[unicodeVals[j]];
                // Check if character is supported (not -1, undefined, or null)
                if (indexValue === undefined || indexValue === null || indexValue === -1) {
                    unsupportedChars.add(processedTexts[i][j]);
                    row[j] = 0; // Use 0 as fallback
                } else {
                    row[j] = indexValue;
                }
            }
            textIds.push(row);
        }
        
        const textMask = getTextMask(textIdsLengths);
        return { textIds, textMask, unsupportedChars: Array.from(unsupportedChars) };
    }
}

const AVAILABLE_LANGS = ["en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi"];

/**
 * Language detection \u2014 Unicode-script first, then Latin scoring.
 *
 * Strategy:
 *   1. Detect non-Latin scripts via Unicode block matches (high confidence).
 *      Hangul \u2192 ko, Hiragana/Katakana \u2192 ja, Arabic \u2192 ar, Devanagari \u2192 hi,
 *      Greek \u2192 el, Cyrillic \u2192 bg/ru/uk via stopword tiebreak.
 *   2. For Latin script, score against a curated set of distinctive
 *      characters and stopwords for the most common languages we cover.
 *      Languages without a high-signal scoring rule (e.g. et, fi, hu, sk,
 *      sl, ro, lt, lv, hr, id) fall through; the caller then uses the
 *      dropdown selection.
 *
 * The model itself is language-agnostic, so misdetection is graceful:
 * the wrong tag still produces understandable speech.
 */
export function detectLanguage(text) {
    if (!text || text.trim().length < 3) {
        return null;
    }

    const sampleText = text.length > 200 ? text.substring(text.length - 200) : text;
    const normalizedText = sampleText.normalize('NFC').toLowerCase();

    // 1) Non-Latin scripts via Unicode blocks (definitive)
    if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(normalizedText)) return 'ko';
    if (/[\u3040-\u30FF]/.test(normalizedText)) return 'ja';                  // Hiragana/Katakana
    if (/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(normalizedText)) return 'ar';
    if (/[\u0900-\u097F]/.test(normalizedText)) return 'hi';                  // Devanagari
    if (/[\u0370-\u03FF]/.test(normalizedText)) return 'el';                  // Greek

    // Cyrillic \u2014 distinguish bg/ru/uk via stopwords + diacritics
    if (/[\u0400-\u04FF]/.test(normalizedText)) {
        const cyrText = ' ' + normalizedText + ' ';
        let ru = 0, uk = 0, bg = 0;
        for (const w of ['\u0438', '\u043D\u0435', '\u044D\u0442\u043E', '\u0447\u0442\u043E', '\u043A\u0430\u043A', '\u0434\u043B\u044F', '\u043D\u043E', '\u0432\u0441\u0435']) if (cyrText.includes(' ' + w + ' ')) ru += 2;
        for (const w of ['\u0442\u0430', '\u043D\u0435', '\u0449\u043E', '\u044F\u043A', '\u0434\u043B\u044F', '\u0430\u043B\u0435', '\u0432\u0441\u0435', '\u0430\u0431\u043E']) if (cyrText.includes(' ' + w + ' ')) uk += 2;
        for (const w of ['\u0438', '\u043D\u0430', '\u043D\u0435', '\u0447\u0435', '\u043A\u0430\u0442\u043E', '\u0441\u044A\u0441', '\u0441\u044A\u0449\u043E']) if (cyrText.includes(' ' + w + ' ')) bg += 2;
        if (/[\u0456\u0457\u0454\u0491]/.test(normalizedText)) uk += 6;
        if (/\u044A/.test(normalizedText)) bg += 4;
        if (/[\u044B\u044D\u0451]/.test(normalizedText)) ru += 4;
        if (uk > ru && uk > bg) return 'uk';
        if (bg > ru && bg > uk) return 'bg';
        return 'ru';
    }

    // 2) Latin script scoring
    const scores = { en: 0, es: 0, fr: 0, pt: 0, de: 0, it: 0, nl: 0, pl: 0, sv: 0, da: 0, tr: 0, vi: 0 };

    // Highly distinctive characters
    if (/\u00F1/.test(normalizedText)) scores.es += 15;
    if (/[\u00BF\u00A1]/.test(normalizedText)) scores.es += 12;
    if (/\u00E3/.test(normalizedText)) scores.pt += 15;
    if (/\u00F5/.test(normalizedText)) scores.pt += 15;
    if (/\u0153/.test(normalizedText)) scores.fr += 15;
    if (/[\u00F9\u00FB]/.test(normalizedText)) scores.fr += 10;
    if (/\u00E7/.test(normalizedText)) { scores.fr += 4; scores.pt += 4; scores.tr += 4; }
    if (/[\u00E8\u00EA\u00EB]/.test(normalizedText)) scores.fr += 5;
    if (/[\u00E0\u00E2]/.test(normalizedText)) scores.fr += 3;
    if (/[\u00EE\u00EF]/.test(normalizedText)) scores.fr += 4;
    if (/\u00F4/.test(normalizedText)) scores.fr += 3;
    if (/\u00DF/.test(normalizedText)) scores.de += 15;
    if (/[\u00E4\u00F6\u00FC]/.test(normalizedText)) { scores.de += 4; scores.sv += 2; }
    if (/\u00E5/.test(normalizedText)) { scores.sv += 8; scores.da += 8; }
    if (/[\u00E6\u00F8]/.test(normalizedText)) scores.da += 12;
    if (/[\u0105\u0119\u0107\u0142\u0144\u015B\u017A\u017C]/.test(normalizedText)) scores.pl += 12;
    if (/[\u011F\u015F\u0131\u0130]/.test(normalizedText)) scores.tr += 12;
    if (/[\u01A1\u01B0\u0103\u0111]/.test(normalizedText)) scores.vi += 12;
    if (/[\u00E0\u1EA3\u00E3\u00E1\u1EA1\u1EB1\u1EAF\u1EB3\u1EB5\u1EB7\u00E2\u1EA7\u1EA5\u1EA9\u1EAB\u1EAD\u00E8\u1EBB\u1EBD\u00E9\u1EB9\u00EA\u1EC1\u1EBF\u1EC3\u1EC5\u1EC7\u00EC\u1EC9\u0129\u00ED\u1ECB\u00F2\u1ECF\u00F5\u00F3\u1ECD\u00F4\u1ED3\u1ED1\u1ED5\u1ED7\u1ED9\u01A1\u1EDD\u1EDB\u1EDF\u1EE1\u1EE3\u00F9\u1EE7\u0169\u00FA\u1EE5\u01B0\u1EEB\u1EE9\u1EED\u1EEF\u1EF1\u1EF3\u1EF7\u1EF9\u00FD\u1EF5]/.test(normalizedText)) scores.vi += 6;

    // Exclusive stopwords (highest signal per language)
    const exclusiveWords = {
        en: ['the', 'is', 'are', 'was', 'were', 'have', 'has', 'been', 'will', 'would', 'this', 'that', 'with', 'from', 'they', 'what', 'which', 'there', 'their', 'about', 'these', 'other', 'into', 'just', 'your', 'some', 'than', 'them', 'then', 'only', 'being', 'through', 'after', 'before'],
        es: ['el', 'los', 'las', 'est\u00E1', 'est\u00E1n', 'porque', 'pero', 'muy', 'tambi\u00E9n', 'm\u00E1s', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'nosotros', 'ellos', 'ellas', 'hola', 'gracias', 'ahora', 'siempre', 'nunca'],
        fr: ['le', 'les', 'est', 'sont', 'dans', 'ce', 'cette', 'ces', 'elle', 'ils', 'elles', 'nous', 'vous', 'avec', 'sur', 'pas', 'plus', 'tout', 'bien', 'fait', '\u00EAtre', 'avoir', 'donc', 'car', 'jamais', 'toujours', 'aussi', 'tr\u00E8s'],
        pt: ['os', 'as', 's\u00E3o', 'est\u00E3o', 'n\u00E3o', 'na', 'no', 'da', 'do', 'das', 'dos', 'ao', 'aos', 'ele', 'ela', 'eles', 'elas', 'n\u00F3s', 'voc\u00EA', 'voc\u00EAs', 'seu', 'sua', 'muito', 'tamb\u00E9m', 'foi', 'mesmo', 'at\u00E9', 'isso', 'ol\u00E1', 'obrigado', 'obrigada'],
        de: ['der', 'die', 'das', 'und', 'ist', 'sind', 'nicht', 'ich', 'wir', 'sie', 'er', 'mit', 'f\u00FCr', 'auf', 'eine', 'einen', 'einem', 'auch', 'aber', 'doch', 'noch', 'nur', 'sehr', 'so', 'oder', 'wenn', 'weil', 'als'],
        it: ['il', 'la', 'gli', 'le', '\u00E8', 'sono', 'non', 'che', 'di', 'per', 'con', 'una', 'uno', 'noi', 'voi', 'loro', 'questo', 'questa', 'anche', 'ma', 'pi\u00F9', 'molto', 'sempre', 'mai'],
        nl: ['de', 'het', 'een', 'en', 'is', 'zijn', 'niet', 'van', 'voor', 'met', 'op', 'aan', 'om', 'maar', 'ook', 'wel', 'nog', 'als', 'dan', 'wat', 'wie', 'hoe', 'omdat', 'altijd', 'nooit'],
        pl: ['jest', 's\u0105', 'nie', 'si\u0119', 'tak', 'czy', 'ale', 'oraz', 'jak', 'tym', 'tego', 'tej', 'jeszcze', 'tylko', 'bardzo', 'zawsze', 'nigdy'],
        sv: ['\u00E4r', 'och', 'inte', 'det', 'att', 'f\u00F6r', 'p\u00E5', 'med', 'som', 'jag', 'vi', 'ni', 'de', 'eller', 'men', 'ocks\u00E5', 'alltid', 'aldrig', 'bara'],
        da: ['er', 'og', 'ikke', 'det', 'at', 'for', 'p\u00E5', 'med', 'som', 'jeg', 'vi', 'de', 'eller', 'men', 'ogs\u00E5', 'altid', 'aldrig', 'bare'],
        tr: ['ve', 'ile', 'i\u00E7in', 'bir', 'bu', '\u015Fu', 'de\u011Fil', 'gibi', '\u00E7ok', 'ama', 'her', 'hi\u00E7', 'yine', 'daha'],
        vi: ['v\u00E0', 'l\u00E0', 'c\u1EE7a', 'kh\u00F4ng', 'm\u1ED9t', 'nh\u1EEFng', 'n\u00E0y', '\u0111\u00F3', 'c\u0169ng', 'v\u1EDBi', 'nh\u01B0', '\u0111\u1EC3', 'nh\u01B0ng', 'r\u1EA5t', 'lu\u00F4n', 'bao']
    };

    const words = normalizedText.match(/[\p{Letter}']+/gu) || [];
    for (const word of words) {
        for (const [lang, wordList] of Object.entries(exclusiveWords)) {
            if (wordList.includes(word)) {
                scores[lang] += 3;
            }
        }
    }

    // 3. Common n-grams (character patterns)
    const ngramPatterns = {
        en: [/th/g, /ing/g, /tion/g, /ight/g, /ould/g],
        es: [/ción/g, /mente/g, /ado/g, /ido/g],
        fr: [/tion/g, /ment/g, /eau/g, /aux/g, /eux/g, /oir/g, /ais/g, /ait/g, /ont/g],
        pt: [/ção/g, /ões/g, /mente/g, /ado/g, /ido/g, /nh/g, /lh/g],
        de: [/sch/g, /chen/g, /lich/g, /ung/g, /ein/g],
        it: [/zione/g, /mente/g, /ono/g, /are/g, /ere/g],
        nl: [/sch/g, /eer/g, /ijk/g, /aar/g],
        pl: [/cz/g, /sz/g, /rz/g, /dzie/g],
        sv: [/skt/g, /tion/g],
        da: [/skt/g, /tion/g, /tt/g],
        tr: [/lar/g, /ler/g, /siz/g, /lik/g],
        vi: [/ng/g, /nh/g, /th/g]
    };

    for (const [lang, patterns] of Object.entries(ngramPatterns)) {
        for (const pattern of patterns) {
            const matches = normalizedText.match(pattern) || [];
            scores[lang] += matches.length * 2;
        }
    }

    // 4. French apostrophe contractions
    const frenchContractions = /[cdjlmnst]'[aeiouéèêàâîïôûù]/g;
    const frenchContractionMatches = normalizedText.match(frenchContractions) || [];
    scores.fr += frenchContractionMatches.length * 5;

    // 5. Definite-article anchors
    if (/\bthe\b/.test(normalizedText)) scores.en += 5;
    if (/\b(el|los)\b/.test(normalizedText)) scores.es += 4;
    if (/\b(le|les)\b/.test(normalizedText)) scores.fr += 4;
    if (/\b(o|os)\b/.test(normalizedText)) scores.pt += 3;
    if (/\b(der|die|das)\b/.test(normalizedText)) scores.de += 5;

    // Pick winner with confidence threshold
    let maxScore = 0;
    let detectedLang = null;

    for (const [lang, score] of Object.entries(scores)) {
        if (score > maxScore) {
            maxScore = score;
            detectedLang = lang;
        }
    }

    if (maxScore >= 4) {
        return detectedLang;
    }

    return null;
}

// Language display names for toast notification (31 languages)
const LANGUAGE_NAMES = {
    'en': 'English',
    'ko': 'Korean',
    'ja': 'Japanese',
    'ar': 'Arabic',
    'bg': 'Bulgarian',
    'cs': 'Czech',
    'da': 'Danish',
    'de': 'German',
    'el': 'Greek',
    'es': 'Spanish',
    'et': 'Estonian',
    'fi': 'Finnish',
    'fr': 'French',
    'hi': 'Hindi',
    'hr': 'Croatian',
    'hu': 'Hungarian',
    'id': 'Indonesian',
    'it': 'Italian',
    'lt': 'Lithuanian',
    'lv': 'Latvian',
    'nl': 'Dutch',
    'pl': 'Polish',
    'pt': 'Portuguese',
    'ro': 'Romanian',
    'ru': 'Russian',
    'sk': 'Slovak',
    'sl': 'Slovenian',
    'sv': 'Swedish',
    'tr': 'Turkish',
    'uk': 'Ukrainian',
    'vi': 'Vietnamese'
};

export function preprocessText(text, lang = null) {
    // Normalize unicode characters
    text = text.normalize('NFKD');
    
    // Remove emojis
    text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, '');
    
    // Replace various dashes and symbols
    const replacements = {
        "–": "-",
        "‑": "-",
        "—": "-",
        "_": " ",
        "\u201C": '"',  // "
        "\u201D": '"',  // "
        "\u2018": "'",  // '
        "\u2019": "'",  // '
        "´": "'",
        "`": "'",
        "[": " ",
        "]": " ",
        "|": " ",
        "/": " ",  // FIXME: `/` should be pronounced.
        "#": " ",  // FIXME: `#` should be pronounced.
        "→": " ",
        "←": " ",
    };
    
    for (const [k, v] of Object.entries(replacements)) {
        text = text.replaceAll(k, v);
    }

    // Remove special symbols
    text = text.replace(/[♥☆♡©\\]/g, "");

    // Replace known expressions
    const exprReplacements = {
        "@": " at ",
        "e.g.,": "for example,",
        "i.e.,": "that is,",
    };
    
    for (const [k, v] of Object.entries(exprReplacements)) {
        text = text.replaceAll(k, v);
    }
    
    // Fix spacing around punctuation
    text = text.replace(/ ,/g, ",");
    text = text.replace(/ \./g, ".");
    text = text.replace(/ !/g, "!");
    text = text.replace(/ \?/g, "?");
    text = text.replace(/ ;/g, ";");
    text = text.replace(/ :/g, ":");
    text = text.replace(/ '/g, "'");
    
    // Remove duplicate quotes
    while (text.includes('""')) {
        text = text.replace(/""/g, '"');
    }
    while (text.includes("''")) {
        text = text.replace(/''/g, "'");
    }
    while (text.includes("``")) {
        text = text.replace(/``/g, "`");
    }
    
    // Remove extra spaces
    text = text.replace(/\s+/g, " ").trim();

    // If text doesn't end with punctuation, quotes, or closing brackets, add a period
    if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) {
        text += ".";
    }
    
    // Add language tags
    if (lang !== null) {
        if (!AVAILABLE_LANGS.includes(lang)) {
            throw new Error(`Invalid language: ${lang}`);
        }
        text = `<${lang}>` + text + `</${lang}>`;
    } else {
        text = `<na>` + text + `</na>`;
    }
    
    return text;
}

export function textToUnicodeValues(text) {
    return Array.from(text).map(char => char.charCodeAt(0));
}

export function lengthToMask(lengths, maxLen = null) {
    maxLen = maxLen || Math.max(...lengths);
    const mask = [];
    for (let i = 0; i < lengths.length; i++) {
        const row = [];
        for (let j = 0; j < maxLen; j++) {
            row.push(j < lengths[i] ? 1.0 : 0.0);
        }
        mask.push([row]);
    }
    return mask;
}

export function getTextMask(textIdsLengths) {
    return lengthToMask(textIdsLengths);
}

export function getLatentMask(wavLengths, cfgs) {
    const baseChunkSize = cfgs.ae.base_chunk_size;
    const chunkCompressFactor = cfgs.ttl.chunk_compress_factor;
    const latentSize = baseChunkSize * chunkCompressFactor;
    const latentLengths = wavLengths.map(len => 
        Math.floor((len + latentSize - 1) / latentSize)
    );
    return lengthToMask(latentLengths);
}

export function sampleNoisyLatent(duration, cfgs) {
    const sampleRate = cfgs.ae.sample_rate;
    const baseChunkSize = cfgs.ae.base_chunk_size;
    const chunkCompressFactor = cfgs.ttl.chunk_compress_factor;
    const ldim = cfgs.ttl.latent_dim;

    const wavLenMax = Math.max(...duration.map(d => d[0][0])) * sampleRate;
    const wavLengths = duration.map(d => Math.floor(d[0][0] * sampleRate));
    const chunkSize = baseChunkSize * chunkCompressFactor;
    const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
    const latentDim = ldim * chunkCompressFactor;

    const noisyLatent = [];
    for (let b = 0; b < duration.length; b++) {
        const batch = [];
        for (let d = 0; d < latentDim; d++) {
            const row = [];
            for (let t = 0; t < latentLen; t++) {
                const u1 = Math.random();
                const u2 = Math.random();
                const randNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
                row.push(randNormal);
            }
            batch.push(row);
        }
        noisyLatent.push(batch);
    }

    const latentMask = getLatentMask(wavLengths, cfgs);
    
    for (let b = 0; b < noisyLatent.length; b++) {
        for (let d = 0; d < noisyLatent[b].length; d++) {
            for (let t = 0; t < noisyLatent[b][d].length; t++) {
                noisyLatent[b][d][t] *= latentMask[b][0][t];
            }
        }
    }

    return { noisyLatent, latentMask };
}

export async function loadOnnx(onnxPath, opts) {
    return await ort.InferenceSession.create(onnxPath, opts);
}

export async function loadOnnxAll(basePath, opts, onProgress) {
    const models = [
        { name: 'Duration Predictor', path: `${basePath}/duration_predictor.onnx`, key: 'dpOrt' },
        { name: 'Text Encoder', path: `${basePath}/text_encoder.onnx`, key: 'textEncOrt' },
        { name: 'Vector Estimator', path: `${basePath}/vector_estimator.onnx`, key: 'vectorEstOrt' },
        { name: 'Vocoder', path: `${basePath}/vocoder.onnx`, key: 'vocoderOrt' }
    ];

    const result = {};
    let loadedCount = 0;
    
    // Load all models in parallel
    const loadPromises = models.map(async (model) => {
        const session = await loadOnnx(model.path, opts);
        loadedCount++;
        if (onProgress) {
            onProgress(model.name, loadedCount, models.length);
        }
        return { key: model.key, session };
    });
    
    // Wait for all models to load
    const loadedModels = await Promise.all(loadPromises);
    
    // Organize results
    loadedModels.forEach(({ key, session }) => {
        result[key] = session;
    });

    try {
        // Download counting. Skip localhost to avoid noisy requests during local testing.
        const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
        const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(hostname);
        if (!isLocalhost) {
            await fetch('https://huggingface.co/Supertone/supertonic-3/resolve/main/config.json', {
                mode: 'no-cors',
                cache: 'no-store'
            });
        }
    } catch (error) {
        console.warn('Failed to update download count:', error);
    }
    return result;
}

export async function loadCfgs(basePath) {
    const response = await fetch(`${basePath}/tts.json`);
    return await response.json();
}

export async function loadProcessors(basePath) {
    const response = await fetch(`${basePath}/unicode_indexer.json`);
    const unicodeIndexerData = await response.json();
    const textProcessor = new UnicodeProcessor(unicodeIndexerData);
    
    return { textProcessor };
}

function parseWavFile(buffer) {
    const view = new DataView(buffer);
    
    // Check RIFF header
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== 'RIFF') {
        throw new Error('Not a valid WAV file');
    }
    
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (wave !== 'WAVE') {
        throw new Error('Not a valid WAV file');
    }
    
    let offset = 12;
    let fmtChunk = null;
    let dataChunk = null;
    
    while (offset < buffer.byteLength) {
        const chunkId = String.fromCharCode(
            view.getUint8(offset), 
            view.getUint8(offset + 1), 
            view.getUint8(offset + 2), 
            view.getUint8(offset + 3)
        );
        const chunkSize = view.getUint32(offset + 4, true);
        
        if (chunkId === 'fmt ') {
            fmtChunk = {
                audioFormat: view.getUint16(offset + 8, true),
                numChannels: view.getUint16(offset + 10, true),
                sampleRate: view.getUint32(offset + 12, true),
                bitsPerSample: view.getUint16(offset + 22, true)
            };
        } else if (chunkId === 'data') {
            dataChunk = {
                offset: offset + 8,
                size: chunkSize
            };
            break;
        }
        
        offset += 8 + chunkSize;
    }
    
    if (!fmtChunk || !dataChunk) {
        throw new Error('Invalid WAV file format');
    }
    
    const bytesPerSample = fmtChunk.bitsPerSample / 8;
    const numSamples = Math.floor(dataChunk.size / (bytesPerSample * fmtChunk.numChannels));
    const audioData = new Float32Array(numSamples);
    
    if (fmtChunk.bitsPerSample === 16) {
        for (let i = 0; i < numSamples; i++) {
            let sample = 0;
            for (let ch = 0; ch < fmtChunk.numChannels; ch++) {
                const sampleOffset = dataChunk.offset + (i * fmtChunk.numChannels + ch) * 2;
                sample += view.getInt16(sampleOffset, true);
            }
            audioData[i] = (sample / fmtChunk.numChannels) / 32768.0;
        }
    } else if (fmtChunk.bitsPerSample === 24) {
        // Support 24-bit PCM
        for (let i = 0; i < numSamples; i++) {
            let sample = 0;
            for (let ch = 0; ch < fmtChunk.numChannels; ch++) {
                const sampleOffset = dataChunk.offset + (i * fmtChunk.numChannels + ch) * 3;
                // Read 3 bytes and convert to signed 24-bit integer
                const byte1 = view.getUint8(sampleOffset);
                const byte2 = view.getUint8(sampleOffset + 1);
                const byte3 = view.getUint8(sampleOffset + 2);
                let value = (byte3 << 16) | (byte2 << 8) | byte1;
                // Convert to signed (two's complement)
                if (value & 0x800000) {
                    value = value - 0x1000000;
                }
                sample += value;
            }
            audioData[i] = (sample / fmtChunk.numChannels) / 8388608.0; // 2^23
        }
    } else if (fmtChunk.bitsPerSample === 32) {
        for (let i = 0; i < numSamples; i++) {
            let sample = 0;
            for (let ch = 0; ch < fmtChunk.numChannels; ch++) {
                const sampleOffset = dataChunk.offset + (i * fmtChunk.numChannels + ch) * 4;
                sample += view.getFloat32(sampleOffset, true);
            }
            audioData[i] = sample / fmtChunk.numChannels;
        }
    } else {
        throw new Error(`Unsupported bit depth: ${fmtChunk.bitsPerSample}. Supported formats: 16-bit, 24-bit, 32-bit`);
    }
    
    return {
        sampleRate: fmtChunk.sampleRate,
        audioData: audioData
    };
}

export function arrayToTensor(array, dims) {
    const flat = array.flat(Infinity);
    return new ort.Tensor('float32', Float32Array.from(flat), dims);
}

export function intArrayToTensor(array, dims) {
    const flat = array.flat(Infinity);
    return new ort.Tensor('int64', BigInt64Array.from(flat.map(x => BigInt(x))), dims);
}

export function writeWavFile(audioData, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = audioData.length * bitsPerSample / 8;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // RIFF header
    view.setUint8(0, 'R'.charCodeAt(0));
    view.setUint8(1, 'I'.charCodeAt(0));
    view.setUint8(2, 'F'.charCodeAt(0));
    view.setUint8(3, 'F'.charCodeAt(0));
    view.setUint32(4, 36 + dataSize, true);
    view.setUint8(8, 'W'.charCodeAt(0));
    view.setUint8(9, 'A'.charCodeAt(0));
    view.setUint8(10, 'V'.charCodeAt(0));
    view.setUint8(11, 'E'.charCodeAt(0));
    
    // fmt chunk
    view.setUint8(12, 'f'.charCodeAt(0));
    view.setUint8(13, 'm'.charCodeAt(0));
    view.setUint8(14, 't'.charCodeAt(0));
    view.setUint8(15, ' '.charCodeAt(0));
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // data chunk
    view.setUint8(36, 'd'.charCodeAt(0));
    view.setUint8(37, 'a'.charCodeAt(0));
    view.setUint8(38, 't'.charCodeAt(0));
    view.setUint8(39, 'a'.charCodeAt(0));
    view.setUint32(40, dataSize, true);
    
    // Write audio data
    for (let i = 0; i < audioData.length; i++) {
        const sample = Math.max(-1, Math.min(1, audioData[i]));
        const intSample = Math.floor(sample * 32767);
        view.setInt16(44 + i * 2, intSample, true);
    }
    
    return buffer;
}



// Smooth scroll functionality
document.addEventListener('DOMContentLoaded', () => {
    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const href = this.getAttribute('href');
            const target = document.querySelector(href);
            if (target) {
                // Update URL with anchor
                if (history.pushState) {
                    history.pushState(null, null, href);
                }
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Add scroll animation for sections
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
});

// TTS Demo functionality
(async function() {
    // Check if we're on a page with the TTS demo
    const demoTextInput = document.getElementById('demoTextInput');
    if (!demoTextInput) return;
    
    // Configure ONNX Runtime WASM assets
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/';
    ort.env.wasm.numThreads = 1;
    

    // Configuration
    const REF_EMBEDDING_PATHS = {
        'F1': 'assets/voice_styles/F1.json',
        'F2': 'assets/voice_styles/F2.json',
        'F3': 'assets/voice_styles/F3.json',
        'F4': 'assets/voice_styles/F4.json',
        'F5': 'assets/voice_styles/F5.json',
        'M1': 'assets/voice_styles/M1.json',
        'M2': 'assets/voice_styles/M2.json',
        'M3': 'assets/voice_styles/M3.json',
        'M4': 'assets/voice_styles/M4.json',
        'M5': 'assets/voice_styles/M5.json'
    };

    // Voice descriptions
    const VOICE_DESCRIPTIONS = {
        'F1': 'Sarah - A calm female voice with a slightly low tone; steady and composed.',
        'F2': 'Lily - A bright, cheerful female voice; lively, playful, and youthful with spirited energy.',
        'F3': 'Jessica - A clear, professional announcer-style female voice; articulate and broadcast-ready.',
        'F4': 'Olivia - A crisp, confident female voice; distinct and expressive with strong delivery.',
        'F5': 'Emily - A kind, gentle female voice; soft-spoken, calm, and naturally soothing.',
        'M1': 'Alex - A lively, upbeat male voice with confident energy and a standard, clear tone.',
        'M2': 'James - A deep, robust male voice; calm, composed, and serious with a grounded presence.',
        'M3': 'Robert - A polished, authoritative male voice; confident and trustworthy with strong presentation quality.',
        'M4': 'Sam - A soft, neutral-toned male voice; gentle and approachable with a youthful, friendly quality.',
        'M5': 'Daniel - A warm, soft-spoken male voice; calm and soothing with a natural storytelling quality.'
    };

    // Global state
    let models = null;
    let cfgs = null;
    let processors = null;
    let currentVoice = 'M3'; // Default to Robert voice
    
    // Detect browser language and set initial language
    function detectBrowserLanguage() {
        // Get browser language (works in Chrome, Safari, Edge, Firefox, Opera, Samsung Internet)
        const browserLang = navigator.language || navigator.userLanguage || 'en';

        // Extract language code (e.g., 'en-US' -> 'en', 'ko-KR' -> 'ko')
        const langCode = browserLang.split('-')[0].toLowerCase();

        // Reuse the 31-language list defined at module top-level
        return AVAILABLE_LANGS.includes(langCode) ? langCode : 'en';
    }
    
    let currentLanguage = detectBrowserLanguage(); // Auto-detect from browser
    let refEmbeddingCache = {}; // Cache for embeddings
    let currentStyleTtlTensor = null;
    let currentStyleDpTensor = null;
    let modelsLoading = false; // Track if models are currently loading
    let modelsLoaded = false; // Track if models are fully loaded
    let modelsLoadPromise = null; // Promise for model loading

    // UI Elements
    const demoStatusBox = document.getElementById('demoStatusBox');
    const demoStatusText = document.getElementById('demoStatusText');
    const demoGenerateBtn = document.getElementById('demoGenerateBtn');
    const demoTotalSteps = document.getElementById('demoTotalSteps');
    const demoSpeed = document.getElementById('demoSpeed');
    const demoTotalStepsValue = document.getElementById('demoTotalStepsValue');
    const demoSpeedValue = document.getElementById('demoSpeedValue');
    const demoResults = document.getElementById('demoResults');
    const demoError = document.getElementById('demoError');
    const demoCharCount = document.getElementById('demoCharCount');
    const demoCharCounter = document.getElementById('demoCharCounter');
    const demoCharWarning = document.getElementById('demoCharWarning');
    const fixedFontPresets = new Set(['paragraph', 'script']);
    let currentPreset = 'quote'; // Initialize with quote

    // Text validation constants
    const MIN_CHARS = 10;
    const MAX_CHUNK_LENGTH_DEFAULT = 300; // Maximum length for each chunk (default)
    const MAX_CHUNK_LENGTH_CJK = 120; // Maximum length for Korean/Japanese
    function getMaxChunkLength() {
        return (currentLanguage === 'ko' || currentLanguage === 'ja') ? MAX_CHUNK_LENGTH_CJK : MAX_CHUNK_LENGTH_DEFAULT;
    }
    
    // Custom audio player state (shared across generations)
    let audioContext = null;
    let scheduledSources = [];
    let audioChunks = [];
    let totalDuration = 0;
    let startTime = 0;
    let pauseTime = 0;
    let isPaused = false;
    let isPlaying = false;
    let animationFrameId = null;
    let playPauseBtn = null;
    let progressBar = null;
    let currentTimeDisplay = null;
    let durationDisplay = null;
    let progressFill = null;
    let firstChunkGenerationTime = 0; // Processing time for first chunk
    let totalChunks = 0;
    let nextScheduledTime = 0; // Next time to schedule audio chunk
    let currentGenerationTextLength = 0;
    let supertonicPlayerRecord = null; // Supertonic player record for cross-player pause management
    let isGenerating = false; // Track if speech generation is in progress
    
    // Track all custom audio players
    let customAudioPlayers = [];

    const isMobileViewport = () => window.matchMedia('(max-width: 768px)').matches;
    // Check if device actually supports touch (not just viewport size)
    const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const trimDecimalsForMobile = (formatted) => {
        if (!formatted) return formatted;
        return isMobileViewport() ? formatted.replace(/\.\d{2}$/, '') : formatted;
    };

    function pauseAllPlayersExcept(currentPlayer) {
        customAudioPlayers.forEach(player => {
            if (player !== currentPlayer && player && typeof player.pausePlayback === 'function') {
                player.pausePlayback();
            }
        });
    }


    /**
     * Chunk text into smaller pieces based on sentence boundaries
     * @param {string} text - The text to chunk
     * @param {number} maxLen - Maximum length for each chunk
     * @returns {Array<string>} - Array of text chunks
     */
    function chunkText(text, maxLen = getMaxChunkLength()) {
        // Split by paragraph (two or more newlines)
        const paragraphs = text.trim().split(/\n\s*\n+/).filter(p => p.trim());
        
        const chunks = [];
        
        for (let paragraph of paragraphs) {
            paragraph = paragraph.trim();
            if (!paragraph) continue;
            
            // Split by sentence boundaries (period, question mark, exclamation mark followed by space)
            // But exclude common abbreviations like Mr., Mrs., Dr., etc. and single capital letters like F.
            const sentences = paragraph.split(/(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/);
            
            let currentChunk = "";
            
            for (let sentence of sentences) {
                if (currentChunk.length + sentence.length + 1 <= maxLen) {
                    currentChunk += (currentChunk ? " " : "") + sentence;
                } else {
                    if (currentChunk) {
                        chunks.push(currentChunk.trim());
                    }
                    currentChunk = sentence;
                }
            }
            
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
        }
        
        return chunks;
    }

    function showDemoStatus(message, type = 'info', progress = null) {
        demoStatusText.innerHTML = message;
        demoStatusBox.className = 'demo-status-box';
        demoStatusBox.style.removeProperty('--status-progress');
        demoStatusBox.style.display = ''; // Show the status box
        
        if (type === 'success') {
            demoStatusBox.classList.add('success');
        } else if (type === 'error') {
            demoStatusBox.classList.add('error');
        }
        
        // Update progress bar
        if (progress !== null && progress >= 0 && progress <= 100) {
            const clampedProgress = Math.max(0, Math.min(progress, 100));
            demoStatusBox.style.setProperty('--status-progress', `${clampedProgress}%`);
            demoStatusBox.classList.toggle('complete', clampedProgress >= 100);
        } else if (type === 'success' || type === 'error') {
            demoStatusBox.style.removeProperty('--status-progress');
            demoStatusBox.classList.remove('complete');
        } else {
            demoStatusBox.style.removeProperty('--status-progress');
            demoStatusBox.classList.remove('complete');
        }
    }

    function hideDemoStatus() {
        demoStatusBox.style.display = 'none';
    }

    function showDemoError(message) {
        demoError.textContent = message;
        demoError.classList.add('active');
    }

    function hideDemoError() {
        demoError.classList.remove('active');
    }
    
    // Language toast notification
    const languageToast = document.getElementById('languageToast');
    const languageToastMessage = document.getElementById('languageToastMessage');
    let languageToastTimeout = null;
    
    function showLanguageToast(fromLang, toLang) {
        if (!languageToast || !languageToastMessage) return;
        
        const fromName = LANGUAGE_NAMES[fromLang] || fromLang;
        const toName = LANGUAGE_NAMES[toLang] || toLang;
        
        languageToastMessage.innerHTML = `Language auto-detected: <strong>${toName}</strong>`;
        
        // Clear any existing timeout
        if (languageToastTimeout) {
            clearTimeout(languageToastTimeout);
        }
        
        // Show toast
        languageToast.classList.add('show');
        
        // Hide after 3 seconds
        languageToastTimeout = setTimeout(() => {
            languageToast.classList.remove('show');
        }, 3000);
    }

    // Validate characters in text
    function validateCharacters(text) {
        if (!processors || !processors.textProcessor) {
            return { valid: true, unsupportedChars: [] };
        }
        
        try {
            // Extract unique characters to minimize preprocessText calls
            const uniqueChars = [...new Set(text)];
            
            // Build mapping for unique chars only (much faster for long texts)
            // For example, Korean '간' -> 'ㄱㅏㄴ', so we map 'ㄱ','ㅏ','ㄴ' -> '간'
            const processedToOriginal = new Map();
            const charToProcessed = new Map();
            
            for (const char of uniqueChars) {
                const processedChar = preprocessText(char);
                charToProcessed.set(char, processedChar);
                
                // Map each processed character back to its original
                for (const pc of processedChar) {
                    if (!processedToOriginal.has(pc)) {
                        processedToOriginal.set(pc, new Set());
                    }
                    processedToOriginal.get(pc).add(char);
                }
            }
            
            // Build full processed text using cached mappings
            const fullProcessedText = Array.from(text).map(c => charToProcessed.get(c)).join('');
            
            // Check the entire processed text once (efficient)
            const { unsupportedChars } = processors.textProcessor.call([fullProcessedText]);
            
            // Map unsupported processed chars back to original chars
            const unsupportedOriginalChars = new Set();
            if (unsupportedChars && unsupportedChars.length > 0) {
                for (const unsupportedChar of unsupportedChars) {
                    const originalChars = processedToOriginal.get(unsupportedChar);
                    if (originalChars) {
                        originalChars.forEach(c => unsupportedOriginalChars.add(c));
                    }
                }
            }
            
            const unsupportedCharsArray = Array.from(unsupportedOriginalChars);
            return { 
                valid: unsupportedCharsArray.length === 0, 
                unsupportedChars: unsupportedCharsArray
            };
        } catch (error) {
            return { valid: true, unsupportedChars: [] };
        }
    }

    // Update character counter and validate text length
    function updateCharCounter() {
        const rawText = demoTextInput.textContent || demoTextInput.innerText || '';
        const text = rawText.replace(/\n$/g, ''); // Remove trailing newline that browsers may add
        const length = text.length;
        
        demoCharCount.textContent = length;
        
        if (fixedFontPresets.has(currentPreset)) {
            demoTextInput.style.fontSize = '1.5rem';
        } else {
            // Get the actual width of the textarea
            const textareaWidth = demoTextInput.offsetWidth;
            // Check if mobile (572px or less) for 2x font size scaling
            const isMobile = window.innerWidth <= 572;
            const mobileMultiplier = isMobile ? 2 : 1;

            let fontSizeRatio;
            if (length <= 100) {
                fontSizeRatio = 0.055 * mobileMultiplier; // 5.5% of width
            } else if (length <= 200) {
                fontSizeRatio = 0.04 * mobileMultiplier; // 4% of width
            } else if (length < 240) {
                fontSizeRatio = 0.053125 * mobileMultiplier; // ~5.3125% of width
            } else if (length < 400) {
                fontSizeRatio = 0.0425 * mobileMultiplier; // ~4.25% of width
            } else if (length < 700) {
                fontSizeRatio = 0.031875 * mobileMultiplier; // ~3.1875% of width
            } else {
                fontSizeRatio = 0.025 * mobileMultiplier; // 2.5% of width
            }

            // Calculate font size based on actual width
            const fontSize = textareaWidth * fontSizeRatio;
            demoTextInput.style.fontSize = `${fontSize}px`;
        }
        
        // Remove all status classes
        demoCharCounter.classList.remove('error', 'warning', 'valid');
        
        // Check for unsupported characters first (only if models are loaded)
        let hasUnsupportedChars = false;
        if (models && processors && length > 0) {
            const validation = validateCharacters(text);
            if (!validation.valid && validation.unsupportedChars.length > 0) {
                hasUnsupportedChars = true;
                const charList = validation.unsupportedChars.slice(0, 5).map(c => `"${c}"`).join(', ');
                const moreChars = validation.unsupportedChars.length > 5 ? ` and ${validation.unsupportedChars.length - 5} more` : '';
                showDemoError(`Unsupported characters detected: ${charList}${moreChars}. Please remove them before generating speech.`);
            } else {
                hideDemoError();
            }
        }
        
        // Update status based on length and character validation
        if (length < MIN_CHARS) {
            demoCharCounter.classList.add('error');
            demoCharWarning.textContent = '(At least 10 characters)';
            demoGenerateBtn.disabled = true;
        } else if (hasUnsupportedChars) {
            demoCharCounter.classList.add('error');
            demoCharWarning.textContent = '(Unsupported characters)';
            demoGenerateBtn.disabled = true;
        } else {
            demoCharCounter.classList.add('valid');
            demoCharWarning.textContent = '';
            // Enable only if models are loaded AND not currently generating
            demoGenerateBtn.disabled = !models || isGenerating;
        }
    }

    // Validate text input
    function validateTextInput(text) {
        if (!text || text.trim().length === 0) {
            return { valid: false, message: 'Please enter some text.' };
        }
        if (text.length < MIN_CHARS) {
            return { valid: false, message: `Text must be at least ${MIN_CHARS} characters long. (Currently ${text.length})` };
        }
        return { valid: true };
    }

    // Load pre-extracted style embeddings from JSON
    async function loadStyleEmbeddings(voice) {
        try {
            // Check if already cached
            if (refEmbeddingCache[voice]) {
                return refEmbeddingCache[voice];
            }
            
            const embeddingPath = REF_EMBEDDING_PATHS[voice];
            if (!embeddingPath) {
                throw new Error(`No embedding path configured for voice: ${voice}`);
            }
            
            const response = await fetch(embeddingPath);
            if (!response.ok) {
                throw new Error(`Failed to fetch embedding: ${response.statusText}`);
            }
            
            const embeddingData = await response.json();
            
            // Convert JSON data to ONNX tensors
            // Flatten nested arrays before creating Float32Array
            const styleTtlData = embeddingData.style_ttl.data.flat(Infinity);
            const styleTtlTensor = new ort.Tensor(
                embeddingData.style_ttl.type || 'float32',
                Float32Array.from(styleTtlData),
                embeddingData.style_ttl.dims
            );
            
            const styleDpData = embeddingData.style_dp.data.flat(Infinity);
            const styleDpTensor = new ort.Tensor(
                embeddingData.style_dp.type || 'float32',
                Float32Array.from(styleDpData),
                embeddingData.style_dp.dims
            );
            
            const embeddings = {
                styleTtl: styleTtlTensor,
                styleDp: styleDpTensor
            };
            
            // Cache the embeddings
            refEmbeddingCache[voice] = embeddings;
            
            return embeddings;
        } catch (error) {
            throw error;
        }
    }
    
    // Switch to a different voice
    async function switchVoice(voice) {
        try {
            const embeddings = await loadStyleEmbeddings(voice);
            
            currentStyleTtlTensor = embeddings.styleTtl;
            currentStyleDpTensor = embeddings.styleDp;
            currentVoice = voice;
            
            // Update active speaker in UI
            if (typeof window.updateActiveSpeaker === 'function') {
                window.updateActiveSpeaker(voice);
            }
            
            // Re-validate text after switching voice
            updateCharCounter();
        } catch (error) {
            showDemoError(`Failed to load voice ${voice}: ${getErrorMessage(error)}`);
            throw error;
        }
    }

    // Warmup models with dummy inference (no audio playback, no UI updates)
    async function warmupModels() {
        try {
            const dummyText = 'Hello, this is a quick warmup.';
            const totalStep = 1;
            const durationFactor = 1.0;
            
            const textList = [dummyText];
            const bsz = 1;
            
            // Use pre-computed style embeddings
            const styleTtlTensor = currentStyleTtlTensor;
            const styleDpTensor = currentStyleDpTensor;
            
            // Step 1: Estimate duration
            const { textIds, textMask } = processors.textProcessor.call(textList, currentLanguage);
            
            const textIdsShape = [bsz, textIds[0].length];
            const textMaskShape = [bsz, 1, textMask[0][0].length];
            const textMaskTensor = arrayToTensor(textMask, textMaskShape);
            
            const dpResult = await models.dpOrt.run({
                text_ids: intArrayToTensor(textIds, textIdsShape),
                style_dp: styleDpTensor,
                text_mask: textMaskTensor
            });
            
            const durOnnx = Array.from(dpResult.duration.data);
            for (let i = 0; i < durOnnx.length; i++) {
                durOnnx[i] *= durationFactor;
            }
            const durReshaped = [];
            for (let b = 0; b < bsz; b++) {
                durReshaped.push([[durOnnx[b]]]);
            }
            
            // Step 2: Encode text
            const textEncResult = await models.textEncOrt.run({
                text_ids: intArrayToTensor(textIds, textIdsShape),
                style_ttl: styleTtlTensor,
                text_mask: textMaskTensor
            });
            
            const textEmbTensor = textEncResult.text_emb;
            
            // Step 3: Denoising
            let { noisyLatent, latentMask } = sampleNoisyLatent(durReshaped, cfgs);
            const latentShape = [bsz, noisyLatent[0].length, noisyLatent[0][0].length];
            const latentMaskShape = [bsz, 1, latentMask[0][0].length];
            const latentMaskTensor = arrayToTensor(latentMask, latentMaskShape);
                    
            const totalStepArray = new Array(bsz).fill(totalStep);
            const scalarShape = [bsz];
            const totalStepTensor = arrayToTensor(totalStepArray, scalarShape);
            
            for (let step = 0; step < totalStep; step++) {
                const currentStepArray = new Array(bsz).fill(step);
            
                const vectorEstResult = await models.vectorEstOrt.run({
                    noisy_latent: arrayToTensor(noisyLatent, latentShape),
                    text_emb: textEmbTensor,
                    style_ttl: styleTtlTensor,
                    text_mask: textMaskTensor,
                    latent_mask: latentMaskTensor,
                    total_step: totalStepTensor,
                    current_step: arrayToTensor(currentStepArray, scalarShape)
                });
                
                const denoisedLatent = Array.from(vectorEstResult.denoised_latent.data);
                
                // Update latent
                let idx = 0;
                for (let b = 0; b < noisyLatent.length; b++) {
                    for (let d = 0; d < noisyLatent[b].length; d++) {
                        for (let t = 0; t < noisyLatent[b][d].length; t++) {
                            noisyLatent[b][d][t] = denoisedLatent[idx++];
                        }
                    }
                }
            }
            
            // Step 4: Generate waveform
            const vocoderResult = await models.vocoderOrt.run({
                latent: arrayToTensor(noisyLatent, latentShape)
            });
            
            // Warmup complete - no need to process the audio further
        } catch (error) {
            console.warn('Warmup failed (non-critical):', getErrorMessage(error));
            // Don't throw - warmup failure shouldn't prevent normal usage
        }
    }

    // Load models on page load
    async function initializeModels() {
        // If models are already loading, return the existing promise
        if (modelsLoading && modelsLoadPromise) {
            return modelsLoadPromise;
        }
        
        // If models are already loaded, return immediately
        if (modelsLoaded && models) {
            return;
        }
        
        modelsLoading = true;
        // Disable speaker selection during model loading
        const speakerItemsForLoading = document.querySelectorAll('.speaker-item[data-voice]');
        speakerItemsForLoading.forEach(item => item.classList.add('disabled'));
        
        // Disable language selection during model loading
        const languageItemsForLoading = document.querySelectorAll('.speaker-item[data-language]');
        languageItemsForLoading.forEach(item => item.classList.add('disabled'));
        
        modelsLoadPromise = (async () => {
            try {
                showDemoStatus('<strong>Loading configuration...</strong>', 'info', 5);
            
            const basePath = 'assets/onnx';
            
            // Load config
            cfgs = await loadCfgs(basePath);
            
            let useWebGPU = !!navigator.gpu && window.isSecureContext;
            let executionProvider = useWebGPU ? 'webgpu' : 'wasm';

            // Load models with appropriate backend
            let backendName = useWebGPU ? 'WebGPU' : 'WASM';
            showDemoStatus(`<strong>${backendName} detected! Loading models...</strong>`, 'info', 10);

            const loadBundle = async () => {
                const modelsLoadPromise = loadOnnxAll(basePath, {
                    executionProviders: [executionProvider],
                    graphOptimizationLevel: 'all'
                }, (modelName, current, total) => {
                    const progress = 10 + (current / total) * 70; // 10-80% for model loading
                    showDemoStatus(`<strong>Loading models with ${backendName} (${current}/${total}):</strong> ${modelName}...`, 'info', progress);
                });

                // Load processors in parallel with models
                return await Promise.all([
                    modelsLoadPromise,
                    loadProcessors(basePath)
                ]);
            };

            let loadedModels;
            let loadedProcessors;
            try {
                [loadedModels, loadedProcessors] = await loadBundle();
            } catch (error) {
                if (!useWebGPU) {
                    throw error;
                }
                console.warn('WebGPU model load failed, falling back to WASM:', error);
                useWebGPU = false;
                executionProvider = 'wasm';
                backendName = 'WASM';
                showDemoStatus('<strong>WebGPU unavailable. Falling back to WASM...</strong>', 'info', 10);
                [loadedModels, loadedProcessors] = await loadBundle();
            }
            
            models = loadedModels;
            processors = loadedProcessors;            
            showDemoStatus('<strong>Loading reference embeddings...</strong>', 'info', 85);
            
            // Load pre-extracted embeddings for default voice
            const embeddings = await loadStyleEmbeddings(currentVoice);
            currentStyleTtlTensor = embeddings.styleTtl;
            currentStyleDpTensor = embeddings.styleDp;
            
            showDemoStatus('<strong>Warming up models...</strong>', 'info', 90);
            
            // Warmup step: run inference once in background with dummy text
            await warmupModels();
            
                hideDemoStatus();
                
                demoGenerateBtn.disabled = false;
                demoTotalSteps.disabled = false;
                demoSpeed.disabled = false;
                
                // Enable voice toggle buttons after models are loaded
                const voiceToggleTexts = document.querySelectorAll('.voice-toggle-text');
                voiceToggleTexts.forEach(text => text.classList.remove('disabled'));
                
                // Validate initial text now that models are loaded
                updateCharCounter();
                
                // Mark models as loaded
                modelsLoaded = true;
                modelsLoading = false;
                
                // Re-enable speaker selection after model loading
                speakerItemsForLoading.forEach(item => item.classList.remove('disabled'));
                
                // Re-enable language selection after model loading
                languageItemsForLoading.forEach(item => item.classList.remove('disabled'));
                
            } catch (error) {
                modelsLoading = false;
                // Re-enable speaker selection on error too
                speakerItemsForLoading.forEach(item => item.classList.remove('disabled'));
                
                // Re-enable language selection on error too
                languageItemsForLoading.forEach(item => item.classList.remove('disabled'));
                const errorMessage = getErrorMessage(error);
                showDemoStatus(`<strong>Error:</strong> ${errorMessage}`, 'error');
                showDemoError(`Failed to initialize: ${errorMessage}. Check console for details.`);
                throw error;
            }
        })();
        
        return modelsLoadPromise;
    }


    // Supertonic synthesis function (extracted for parallel execution)
    async function generateSupertonicSpeech(text, totalStep, durationFactor) {
        const supertonicStartTime = Date.now();
        
        try {
            const textList = [text];
            const bsz = 1;
            const sampleRate = cfgs.ae.sample_rate;
            
            // Use pre-computed style embeddings
            const styleTtlTensor = currentStyleTtlTensor;
            const styleDpTensor = currentStyleDpTensor;
            
            // Step 1: Estimate duration
            const { textIds, textMask, unsupportedChars } = processors.textProcessor.call(textList, currentLanguage);
            
            // Check for unsupported characters
            if (unsupportedChars && unsupportedChars.length > 0) {
                const charList = unsupportedChars.map(c => `"${c}"`).join(', ');
                throw new Error(`Unsupported characters: ${charList}`);
            }
            
            const textIdsShape = [bsz, textIds[0].length];
            const textMaskShape = [bsz, 1, textMask[0][0].length];
            const textMaskTensor = arrayToTensor(textMask, textMaskShape);
            
            const dpResult = await models.dpOrt.run({
                text_ids: intArrayToTensor(textIds, textIdsShape),
                style_dp: styleDpTensor,
                text_mask: textMaskTensor
            });
            
            const durOnnx = Array.from(dpResult.duration.data);
            // Apply duration factor to adjust speech length (once)
            for (let i = 0; i < durOnnx.length; i++) {
                durOnnx[i] *= durationFactor;
            }
            const durReshaped = [];
            for (let b = 0; b < bsz; b++) {
                durReshaped.push([[durOnnx[b]]]);
            }
            
            // Step 2: Encode text
            const textEncResult = await models.textEncOrt.run({
                text_ids: intArrayToTensor(textIds, textIdsShape),
                style_ttl: styleTtlTensor,
                text_mask: textMaskTensor
            });
            
            const textEmbTensor = textEncResult.text_emb;
            
            // Step 3: Denoising
            let { noisyLatent, latentMask } = sampleNoisyLatent(durReshaped, cfgs);
            const latentDim = noisyLatent[0].length;
            const latentLen = noisyLatent[0][0].length;
            const latentShape = [bsz, latentDim, latentLen];
            const latentMaskShape = [bsz, 1, latentMask[0][0].length];
            const latentMaskTensor = arrayToTensor(latentMask, latentMaskShape);
            
            // Pre-allocate flat buffer for latent data to avoid repeated allocations
            const latentBufferSize = bsz * latentDim * latentLen;
            const latentBuffer = new Float32Array(latentBufferSize);
            
            // Initialize latent buffer from noisyLatent
            let initIdx = 0;
            for (let b = 0; b < bsz; b++) {
                for (let d = 0; d < latentDim; d++) {
                    for (let t = 0; t < latentLen; t++) {
                        latentBuffer[initIdx++] = noisyLatent[b][d][t];
                    }
                }
            }
                    
            // Prepare constant tensors
            const scalarShape = [bsz];
            const totalStepTensor = arrayToTensor(new Array(bsz).fill(totalStep), scalarShape);
            
            // Pre-create all step tensors to avoid repeated allocations
            const stepTensors = [];
            for (let step = 0; step < totalStep; step++) {
                stepTensors.push(arrayToTensor(new Array(bsz).fill(step), scalarShape));
            }
            
            for (let step = 0; step < totalStep; step++) {
                // Create tensor from pre-allocated buffer
                const noisyLatentTensor = new ort.Tensor('float32', latentBuffer, latentShape);
            
                const vectorEstResult = await models.vectorEstOrt.run({
                    noisy_latent: noisyLatentTensor,
                    text_emb: textEmbTensor,
                    style_ttl: styleTtlTensor,
                    text_mask: textMaskTensor,
                    latent_mask: latentMaskTensor,
                    total_step: totalStepTensor,
                    current_step: stepTensors[step]
                });
                
                // Copy denoised result directly into pre-allocated buffer
                const denoisedData = vectorEstResult.denoised_latent.data;
                latentBuffer.set(denoisedData);
            }
            
            // Step 4: Generate waveform - use latentBuffer directly
            const vocoderResult = await models.vocoderOrt.run({
                latent: new ort.Tensor('float32', latentBuffer, latentShape)
            });
            
            const wavBatch = vocoderResult.wav_tts.data;
            const wavLen = Math.floor(sampleRate * durOnnx[0]);
            // Create a copy of the audio data (not a view) to prevent buffer reuse issues
            const audioData = wavBatch.slice(0, wavLen);
            
            // Calculate times for Supertonic
            const supertonicEndTime = Date.now();
            const supertonicProcessingTime = (supertonicEndTime - supertonicStartTime) / 1000;
            const audioDurationSec = durOnnx[0];
            
            return {
                success: true,
                processingTime: supertonicProcessingTime,
                audioDuration: audioDurationSec,
                audioData: audioData,
                sampleRate: sampleRate,
                text: text
            };
        } catch (error) {
            return {
                success: false,
                error: getErrorMessage(error),
                text: text
            };
        }
    }

    // Format time: 60초 미만 -> 00.00, 60분 미만 -> 00:00.00, 60분 이상 -> 00:00:00.00
    function formatTimeDetailed(seconds) {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const ms = Math.floor((secs % 1) * 100);
        const wholeSecs = Math.floor(secs);
        
        if (seconds < 60) {
            return `${wholeSecs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
        } else if (seconds < 3600) {
            return `${mins.toString().padStart(2, '0')}:${wholeSecs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
        } else {
            return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${wholeSecs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
        }
    }

    // Generate Supertonic speech with chunking support and progressive playback
    async function generateSupertonicSpeechChunked(text, totalStep, durationFactor, onFirstChunkReady, onChunkAdded) {
        const supertonicStartTime = Date.now();
        const sampleRate = cfgs.ae.sample_rate;
        const silenceDuration = 0.3; // 0.3 seconds of silence between chunks
        
        try {
            // Split text into chunks
            const chunks = chunkText(text);
            
            const audioDataArrays = [];
            const durations = [];
            const silenceSamples = Math.floor(silenceDuration * sampleRate);
            let firstChunkEndTime = 0;
            let firstChunkTime = 0;
            
            // Generate speech for each chunk
            for (let i = 0; i < chunks.length; i++) {
                const chunkText = chunks[i];
                
                const result = await generateSupertonicSpeech(chunkText, totalStep, durationFactor);
                
                if (!result.success) {
                    throw new Error(`Failed to generate chunk ${i + 1}: ${result.error}`);
                }
                
                // Use raw Float32Array directly - no WAV encode/decode round-trip
                const audioData = result.audioData;
                
                audioDataArrays.push(audioData);
                durations.push(result.audioDuration);
                
                // Progressive playback: pass raw Float32Array directly to callbacks
                if (i === 0 && onFirstChunkReady) {
                    // First chunk ready - send it immediately
                    firstChunkEndTime = Date.now();
                    firstChunkTime = (firstChunkEndTime - supertonicStartTime) / 1000;
                    
                    const totalDurationSoFar = result.audioDuration;
                    const processedChars = chunks[0].length;
                    // Pass raw audio data and sample rate directly
                    onFirstChunkReady(audioData, sampleRate, totalDurationSoFar, text, chunks.length, firstChunkTime, processedChars);
                } else if (i > 0 && onChunkAdded) {
                    // Subsequent chunks - send just the new chunk
                    const totalDurationSoFar = durations.slice(0, i + 1).reduce((sum, dur) => sum + dur, 0) + silenceDuration * i;
                    const currentProcessingTime = (Date.now() - supertonicStartTime) / 1000;
                    const processedChars = chunks.slice(0, i + 1).reduce((sum, chunk) => sum + chunk.length, 0);
                    // Pass raw audio data and sample rate directly
                    onChunkAdded(audioData, sampleRate, totalDurationSoFar, i + 1, chunks.length, currentProcessingTime, processedChars);
                }
            }
            
            // Concatenate all audio chunks with silence for final result
            const totalDuration = durations.reduce((sum, dur) => sum + dur, 0) + silenceDuration * (chunks.length - 1);
            
            // Calculate total samples needed
            let totalSamples = 0;
            for (let i = 0; i < audioDataArrays.length; i++) {
                totalSamples += audioDataArrays[i].length;
                if (i < audioDataArrays.length - 1) {
                    totalSamples += silenceSamples;
                }
            }
            
            const wavCat = new Float32Array(totalSamples);
            
            let currentIdx = 0;
            for (let i = 0; i < audioDataArrays.length; i++) {
                // Copy audio data
                const audioData = audioDataArrays[i];
                wavCat.set(audioData, currentIdx);
                currentIdx += audioData.length;
                
                // Add silence if not the last chunk
                if (i < audioDataArrays.length - 1) {
                    // Silence is already zeros in Float32Array, just skip the indices
                    currentIdx += silenceSamples;
                }
            }
            
            // Create final WAV file
            const wavBuffer = writeWavFile(wavCat, sampleRate);
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            
            const supertonicEndTime = Date.now();
            const supertonicProcessingTime = (supertonicEndTime - supertonicStartTime) / 1000;
            
            return {
                success: true,
                processingTime: supertonicProcessingTime,
                audioDuration: totalDuration,
                url: url,
                text: text,
                firstChunkTime: firstChunkTime
            };
        } catch (error) {
            return {
                success: false,
                error: getErrorMessage(error),
                text: text
            };
        }
    }

    // Main synthesis function
    async function generateSpeech() {
        let text = (demoTextInput.textContent || demoTextInput.innerText || '').trim();
                
        // Validate text input
        const validation = validateTextInput(text);
        if (!validation.valid) {
            showDemoError(validation.message);
            return;
        }
        
        if (!models || !cfgs || !processors) {
            showDemoError('Models are still loading. Please wait.');
            return;
        }
        
        if (!currentStyleTtlTensor || !currentStyleDpTensor) {
            showDemoError('Reference embeddings are not ready. Please wait.');
            return;
        }
        
        // Validate characters before generation
        const charValidation = validateCharacters(text);
        if (!charValidation.valid && charValidation.unsupportedChars.length > 0) {
            const charList = charValidation.unsupportedChars.map(c => `"${c}"`).join(', ');
            showDemoError(`Cannot generate speech: Unsupported characters found: ${charList}`);
            return;
        }

        currentGenerationTextLength = text.length;
        
        try {
            isGenerating = true;
            demoGenerateBtn.disabled = true;
            
            // Disable speaker selection during generation
            const speakerItemsForGeneration = document.querySelectorAll('.speaker-item[data-voice]');
            speakerItemsForGeneration.forEach(item => item.classList.add('disabled'));
            
            // Disable language selection during generation
            const languageItemsForGeneration = document.querySelectorAll('.speaker-item[data-language]');
            languageItemsForGeneration.forEach(item => item.classList.add('disabled'));
            
            hideDemoError();
            hideDemoStatus(); // Hide the status box when starting generation
            
            // Clean up previous audio playback
            if (audioContext) {
                // Stop all scheduled sources
                scheduledSources.forEach(source => {
                    try {
                        source.stop();
                    } catch (e) {
                        // Already stopped
                    }
                });
                scheduledSources = [];
                
                // Close audio context
                if (audioContext.state !== 'closed') {
                    audioContext.close();
                }
                audioContext = null;
            }
            
            // Cancel animation frame
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            
            // Clean up all custom audio players
            customAudioPlayers.forEach(player => {
                if (player.cleanup) {
                    player.cleanup();
                }
            });
            customAudioPlayers = [];
            
            // Reset state
            audioChunks = [];
            totalDuration = 0;
            startTime = 0;
            pauseTime = 0;
            isPaused = false;
            isPlaying = false;
            firstChunkGenerationTime = 0; // Processing time for first chunk
            totalChunks = 0;
            nextScheduledTime = 0; // Next time to schedule audio chunk
            
            // Show result shell(s) immediately
            const createInitialResultItem = (system, titleMain, titleSub, titleColor, includeStatus) => {
                const titleStatus = includeStatus
                    ? `<span class="title-status status-running" id="${system}-status">⏳ Running...</span>`
                    : '';
                return `
                    <div class="demo-result-item ${system}-result-item generating" id="${system}-result" style="--result-progress: 0%;">
                        <div class="demo-result-title">
                            <span class="title-main" style="color: ${titleColor};">${titleMain}</span>
                            <span class="title-sub">${titleSub}</span>
                            ${titleStatus}
                        </div>
                        <div class="demo-result-info">
                    <!--
                    <div class="stat">
                        <div class="stat-value" id="${system}-chars">--</div>
                        <div class="stat-label">Processed Chars</div>
                    </div>
                    -->
                            <div class="stat">
                                <div class="stat-value" id="${system}-time">--</div>
                            <div class="stat-label">Processing Time<span class="stat-arrow stat-arrow--down">↓</span></div>
                            </div>
                            <div class="stat">
                                <div class="stat-value" id="${system}-cps">--</div>
                            <div class="stat-label">Chars/sec<span class="stat-arrow stat-arrow--up">↑</span></div>
                            </div>
                            <div class="stat">
                                <div class="stat-value" id="${system}-rtf">--</div>
                            <div class="stat-label">RTF<span class="stat-arrow stat-arrow--down">↓</span></div>
                            </div>
                        </div>
                        <div class="custom-audio-player">
                        <div class="demo-placeholder-audio">Generating speech...</div>
                        </div>
                    </div>
                `;
            };
            const supertonicInitial = createInitialResultItem(
                'supertonic',
                'Supertonic',
                'On-Device',
                'var(--accent-yellow)',
                false
            );
            demoResults.style.display = 'flex';
            demoResults.innerHTML = supertonicInitial;
            
            const totalStep = parseInt(demoTotalSteps.value);
            const speed = parseFloat(demoSpeed.value);
            const durationFactor = speedToDurationFactor(speed);
            
            // Track which one finishes first
            let latestSupertonicProcessedChars = 0;
            
            // Helper functions for custom player
            const formatTime = (seconds, { trimMobile = false } = {}) => {
                const mins = Math.floor(seconds / 60);
                const secs = seconds % 60;
                const secString = secs.toFixed(2).padStart(5, '0');
                let formatted = `${mins}:${secString}`;
                if (trimMobile) {
                    formatted = trimDecimalsForMobile(formatted);
                }
                return formatted;
            };
            
            const updateProgress = () => {
                if (!isPlaying || !audioContext) return;
                
                const currentTime = isPaused ? pauseTime : (audioContext.currentTime - startTime);
                const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
                
                if (progressFill) {
                    progressFill.style.width = `${Math.min(progress, 100)}%`;
                }
                if (currentTimeDisplay) {
                    currentTimeDisplay.textContent = formatTime(Math.min(currentTime, totalDuration), { trimMobile: true });
                }
                
                if (currentTime < totalDuration) {
                    animationFrameId = requestAnimationFrame(updateProgress);
                } else {
                    // Playback finished
                    isPlaying = false;
                    isPaused = false;
                    if (playPauseBtn) {
                        playPauseBtn.innerHTML = PLAY_ICON_SVG;
                    }
                }
            };
            
            const togglePlayPause = () => {
                if (!audioContext || audioChunks.length === 0) return;
                
                if (isPaused) {
                    // Resume from paused position
                    pauseAllPlayersExcept(supertonicPlayerRecord);
                    
                    const seekTime = pauseTime;
                    
                    // Find which chunk we should start from
                    let accumulatedTime = 0;
                    let startChunkIndex = 0;
                    let offsetInChunk = seekTime;
                    
                    for (let i = 0; i < audioChunks.length; i++) {
                        const chunkDuration = audioChunks[i].buffer.duration;
                        if (accumulatedTime + chunkDuration > seekTime) {
                            startChunkIndex = i;
                            offsetInChunk = seekTime - accumulatedTime;
                            break;
                        }
                        accumulatedTime += chunkDuration + 0.3;
                    }
                    
                    // Stop any existing sources
                    scheduledSources.forEach(source => {
                        try {
                            source.stop();
                        } catch (e) {
                            // Already stopped
                        }
                    });
                    scheduledSources = [];
                    
                    // Resume AudioContext if suspended
                    if (audioContext.state === 'suspended') {
                        audioContext.resume();
                    }
                    
                    // Reschedule from the pause point
                    startTime = audioContext.currentTime - seekTime;
                    let nextStartTime = audioContext.currentTime;
                    
                    for (let i = startChunkIndex; i < audioChunks.length; i++) {
                        const source = audioContext.createBufferSource();
                        source.buffer = audioChunks[i].buffer;
                        source.connect(audioContext.destination);
                        
                        if (i === startChunkIndex) {
                            source.start(nextStartTime, offsetInChunk);
                            nextStartTime += (audioChunks[i].buffer.duration - offsetInChunk);
                        } else {
                            source.start(nextStartTime);
                            nextStartTime += audioChunks[i].buffer.duration;
                        }
                        
                        if (i < audioChunks.length - 1) {
                            nextStartTime += 0.3;
                        }
                        
                        scheduledSources.push(source);
                    }
                    
                    nextScheduledTime = nextStartTime;
                    
                    isPaused = false;
                    isPlaying = true;
                    playPauseBtn.innerHTML = PAUSE_ICON_SVG;
                    updateProgress();
                } else if (isPlaying) {
                    // Pause playback
                    pauseTime = audioContext.currentTime - startTime;
                    audioContext.suspend();
                    isPaused = true;
                    playPauseBtn.innerHTML = PLAY_ICON_SVG;
                    if (animationFrameId) {
                        cancelAnimationFrame(animationFrameId);
                    }
                } else {
                    // Was finished, restart from beginning
                    pauseAllPlayersExcept(supertonicPlayerRecord);
                    
                    pauseTime = 0;
                    
                    // Resume AudioContext if suspended
                    if (audioContext.state === 'suspended') {
                        audioContext.resume();
                    }
                    
                    // Stop any existing sources
                    scheduledSources.forEach(source => {
                        try {
                            source.stop();
                        } catch (e) {
                            // Already stopped
                        }
                    });
                    scheduledSources = [];
                    
                    // Restart from beginning
                    startTime = audioContext.currentTime;
                    let nextStartTime = audioContext.currentTime;
                    
                    for (let i = 0; i < audioChunks.length; i++) {
                        const source = audioContext.createBufferSource();
                        source.buffer = audioChunks[i].buffer;
                        source.connect(audioContext.destination);
                        source.start(nextStartTime);
                        nextStartTime += audioChunks[i].buffer.duration;
                        
                        if (i < audioChunks.length - 1) {
                            nextStartTime += 0.3;
                        }
                        
                        scheduledSources.push(source);
                    }
                    
                    nextScheduledTime = nextStartTime;
                    
                    isPlaying = true;
                    isPaused = false;
                    playPauseBtn.innerHTML = PAUSE_ICON_SVG;
                    updateProgress();
                }
            };
            
            const seekTo = (percentage) => {
                if (!audioContext || audioChunks.length === 0) return;
                
                const seekTime = (percentage / 100) * totalDuration;
                
                // Remember current playing state
                const wasPlaying = isPlaying;
                const wasPaused = isPaused;
                
                // Stop all current sources
                scheduledSources.forEach(source => {
                    try {
                        source.stop();
                    } catch (e) {
                        // Already stopped
                    }
                });
                scheduledSources = [];
                
                // Cancel animation
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                }
                
                // Find which chunk we should start from
                let accumulatedTime = 0;
                let startChunkIndex = 0;
                let offsetInChunk = seekTime;
                
                for (let i = 0; i < audioChunks.length; i++) {
                    const chunkDuration = audioChunks[i].buffer.duration;
                    if (accumulatedTime + chunkDuration > seekTime) {
                        startChunkIndex = i;
                        offsetInChunk = seekTime - accumulatedTime;
                        break;
                    }
                    accumulatedTime += chunkDuration + 0.3; // Include silence
                }
                
                // If paused or finished, just update the pause position
                if (wasPaused || !wasPlaying) {
                    pauseTime = seekTime;
                    
                    // Update UI
                    if (progressFill) {
                        const progress = (seekTime / totalDuration) * 100;
                        progressFill.style.width = `${Math.min(progress, 100)}%`;
                    }
                    if (currentTimeDisplay) {
                    currentTimeDisplay.textContent = formatTime(seekTime, { trimMobile: true });
                    }
                    
                    // Set to paused state so play button will resume from seek position
                    isPaused = true;
                    isPlaying = true; // Valid state for playback
                    
                    if (playPauseBtn) {
                        playPauseBtn.innerHTML = PLAY_ICON_SVG;
                    }
                    
                    return;
                }
                
                // Resume AudioContext if it was suspended
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                
                // Reschedule from the seek point
                startTime = audioContext.currentTime - seekTime;
                let nextStartTime = audioContext.currentTime;
                
                for (let i = startChunkIndex; i < audioChunks.length; i++) {
                    const source = audioContext.createBufferSource();
                    source.buffer = audioChunks[i].buffer;
                    source.connect(audioContext.destination);
                    
                    if (i === startChunkIndex) {
                        // Start from offset
                        source.start(nextStartTime, offsetInChunk);
                        nextStartTime += (audioChunks[i].buffer.duration - offsetInChunk);
                    } else {
                        source.start(nextStartTime);
                        nextStartTime += audioChunks[i].buffer.duration;
                    }
                    
                    // Add silence between chunks
                    if (i < audioChunks.length - 1) {
                        nextStartTime += 0.3;
                    }
                    
                    scheduledSources.push(source);
                }
                
                // Update nextScheduledTime for any future chunks
                nextScheduledTime = nextStartTime;
                
                // Resume playing state
                isPlaying = true;
                isPaused = false;
                if (playPauseBtn) {
                    playPauseBtn.innerHTML = PAUSE_ICON_SVG;
                }
                
                // Restart progress animation
                updateProgress();
            };
            
            // Callback for first chunk ready - create custom player and start playback
            // Helper function to create AudioBuffer directly from Float32Array
            const createAudioBufferFromFloat32 = (audioData, sampleRate) => {
                const audioBuffer = audioContext.createBuffer(1, audioData.length, sampleRate);
                audioBuffer.getChannelData(0).set(audioData);
                return audioBuffer;
            };
            
            const onFirstChunkReady = async (audioData, sampleRate, duration, text, numChunks, firstChunkTime, processedChars) => {
                totalChunks = numChunks;
                firstChunkGenerationTime = firstChunkTime;
                
                const container = document.getElementById('demoResults');
                

                const textLength = currentGenerationTextLength > 0
                    ? currentGenerationTextLength
                    : (text ? text.length : 0);
                const isBatch = textLength >= getMaxChunkLength();
                const processingTimeStr = isBatch && firstChunkTime
                    ? `${formatTimeDetailed(firstChunkTime)} / ${formatTimeDetailed(firstChunkTime)}`
                    : formatTimeDetailed(firstChunkTime);
                const safeInitialChars = typeof processedChars === 'number' ? processedChars : 0;
                const displayedInitialChars = textLength > 0 ? Math.min(safeInitialChars, textLength) : safeInitialChars;
                const charsPerSec = firstChunkTime > 0 && displayedInitialChars > 0
                    ? (displayedInitialChars / firstChunkTime).toFixed(1)
                    : '0.0';
                const rtf = duration > 0 && firstChunkTime > 0 ? (firstChunkTime / duration).toFixed(3) : '-';
                const progressValue = textLength > 0 ? Math.min(100, (displayedInitialChars / textLength) * 100) : 0;

                const resultItemEl = document.getElementById('supertonic-result');
                if (!resultItemEl) {
                    console.warn('Supertonic result container not found.');
                    return;
                }

                resultItemEl.classList.remove('generating');
                resultItemEl.style.setProperty('--result-progress', `${progressValue}%`);

                const titleMainEl = resultItemEl.querySelector('.title-main');
                if (titleMainEl) {
                    titleMainEl.textContent = 'Supertonic';
                    titleMainEl.style.color = 'var(--accent-yellow)';
                }
                const titleSubEl = resultItemEl.querySelector('.title-sub');
                if (titleSubEl) {
                    titleSubEl.textContent = 'On-Device';
                }

                const infoContainer = resultItemEl.querySelector('.demo-result-info');
                if (infoContainer) {
                    infoContainer.classList.remove('error');
                }
                const timeElInitial = document.getElementById('supertonic-time');
                if (timeElInitial) {
                    timeElInitial.innerHTML = formatStatValueWithSuffix(processingTimeStr, 's', { firstLabel: true });
                }
                const cpsElInitial = document.getElementById('supertonic-cps');
                if (cpsElInitial) {
                    cpsElInitial.textContent = charsPerSec;
                }
                const rtfElInitial = document.getElementById('supertonic-rtf');
                if (rtfElInitial) {
                    rtfElInitial.innerHTML = formatStatValueWithSuffix(rtf, 'x');
                }

                const playerContainer = resultItemEl.querySelector('.custom-audio-player');
                if (playerContainer) {
                    playerContainer.style.display = '';
                    playerContainer.innerHTML = `
                        <button id="play-pause-btn" class="player-btn">${PAUSE_ICON_SVG}</button>
                        <div class="time-display" id="current-time">0:00.00</div>
                        <div class="progress-container" id="progress-container">
                            <div class="progress-bar">
                                <div class="progress-fill" id="progress-fill"></div>
                            </div>
                        </div>
                        <div class="time-display" id="total-duration">${formatTime(duration, { trimMobile: true })}</div>
                        <div class="demo-result-actions" style="display: none;">
                            <button class="demo-download-btn" id="supertonic-download" aria-label="Download WAV" title="Download WAV">
                                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                            </button>
                        </div>
                    `;
                }

                container.style.display = 'flex';
                latestSupertonicProcessedChars = displayedInitialChars;
                
                 // Get UI elements
                 playPauseBtn = document.getElementById('play-pause-btn');
                 progressBar = document.getElementById('progress-container');
                 currentTimeDisplay = document.getElementById('current-time');
                durationDisplay = document.getElementById('total-duration');
                progressFill = document.getElementById('progress-fill');
                
                // Initialize Web Audio API
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                startTime = audioContext.currentTime;
                totalDuration = duration;
                isPlaying = true;
                isPaused = false;
                
                // Create Supertonic player record and register it
                const pausePlayback = () => {
                    if (!audioContext || audioContext.state === 'closed') return;
                    if (isPlaying) {
                        pauseTime = audioContext.currentTime - startTime;
                        scheduledSources.forEach(source => {
                            try {
                                source.stop();
                            } catch (e) {
                                // Already stopped
                            }
                        });
                        scheduledSources = [];
                        audioContext.suspend();
                        isPaused = true;
                        isPlaying = false;
                        if (playPauseBtn) {
                            playPauseBtn.innerHTML = PLAY_ICON_SVG;
                        }
                        if (animationFrameId) {
                            cancelAnimationFrame(animationFrameId);
                        }
                    }
                };
                
                supertonicPlayerRecord = {
                    audioContext: audioContext,
                    pausePlayback: pausePlayback
                };
                
                // Remove old Supertonic player if exists and add new one
                customAudioPlayers = customAudioPlayers.filter(p => p !== supertonicPlayerRecord && p.audioContext !== audioContext);
                customAudioPlayers.push(supertonicPlayerRecord);
                
                // Pause all other players before starting Supertonic
                pauseAllPlayersExcept(supertonicPlayerRecord);
                
                // Create AudioBuffer directly from Float32Array - no WAV encode/decode
                const audioBuffer = createAudioBufferFromFloat32(audioData, sampleRate);
                
                audioChunks.push({ buffer: audioBuffer, duration: audioBuffer.duration });
                
                // Play first chunk immediately
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);
                source.start(audioContext.currentTime);
                scheduledSources.push(source);
                
                // Set next scheduled time for additional chunks
                nextScheduledTime = audioContext.currentTime + audioBuffer.duration + 0.3; // Add silence gap
                
                // Setup player controls
                playPauseBtn.addEventListener('click', togglePlayPause);
                
                progressBar.addEventListener('click', (e) => {
                    const rect = progressBar.getBoundingClientRect();
                    const percentage = ((e.clientX - rect.left) / rect.width) * 100;
                    seekTo(percentage);
                });
                
                // Start progress animation
                updateProgress();
            };
            
            // Callback for each additional chunk - schedule seamlessly
            const onChunkAdded = async (audioData, sampleRate, duration, chunkIndex, totalChunks, currentProcessingTime, processedChars) => {
                if (!audioContext) return;
                
                // Create AudioBuffer directly from Float32Array - no WAV encode/decode
                const audioBuffer = createAudioBufferFromFloat32(audioData, sampleRate);
                
                const chunkDuration = audioBuffer.duration;
                audioChunks.push({ buffer: audioBuffer, duration: chunkDuration });
                
                // Schedule the new chunk at the pre-calculated time
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);
                source.start(nextScheduledTime);
                scheduledSources.push(source);
                
                // Update next scheduled time for the next chunk
                nextScheduledTime = nextScheduledTime + audioBuffer.duration + 0.3; // Add silence gap
                
                // Update total duration
                totalDuration = duration;
                
                // Update duration display with smooth animation
                if (durationDisplay) {
                    durationDisplay.textContent = formatTime(duration, { trimMobile: true });
                    durationDisplay.style.transition = 'color 0.3s';
                    durationDisplay.style.color = '#ffffff';
                    setTimeout(() => {
                        durationDisplay.style.color = '';
                    }, 300);
                }
                
                // Update info display
                const textLengthCandidate = currentGenerationTextLength > 0
                    ? currentGenerationTextLength
                    : (demoTextInput.textContent || demoTextInput.innerText || '').trim().length;
                const textLength = textLengthCandidate;
                const isBatch = textLength >= getMaxChunkLength();
                const timeEl = document.getElementById('supertonic-time');
                const durationEl = document.getElementById('supertonic-duration');
                const cpsEl = document.getElementById('supertonic-cps');
                const rtfEl = document.getElementById('supertonic-rtf');
                const effectiveProcessedChars = typeof processedChars === 'number' ? processedChars : latestSupertonicProcessedChars;

                if (effectiveProcessedChars < latestSupertonicProcessedChars) {
                    return;
                }

                const clampedProcessedChars = textLength > 0 ? Math.min(effectiveProcessedChars, textLength) : effectiveProcessedChars;
                const progressValue = textLength > 0 ? Math.min(100, (clampedProcessedChars / textLength) * 100) : 0;
                if (durationEl) {
                    durationEl.textContent = formatTimeDetailed(duration);
                }
                if (timeEl && isBatch && firstChunkGenerationTime > 0 && currentProcessingTime) {
                    const timeDisplay = `${formatTimeDetailed(firstChunkGenerationTime)} / ${formatTimeDetailed(currentProcessingTime)}`;
                    timeEl.innerHTML = formatStatValueWithSuffix(timeDisplay, 's', { firstLabel: true });
                }
                if (cpsEl && currentProcessingTime > 0 && clampedProcessedChars >= 0) {
                    const charsPerSec = (clampedProcessedChars / currentProcessingTime).toFixed(1);
                    cpsEl.textContent = charsPerSec;
                }
                if (rtfEl && duration > 0 && currentProcessingTime > 0) {
                    const rtf = (currentProcessingTime / duration).toFixed(3);
                    rtfEl.innerHTML = formatStatValueWithSuffix(rtf, 'x');
                }
                const resultItemEl = document.getElementById('supertonic-result');
                if (resultItemEl) {
                    resultItemEl.style.setProperty('--result-progress', `${progressValue}%`);
                }
                latestSupertonicProcessedChars = clampedProcessedChars;
            };
            
            // Start all syntheses simultaneously
            const result = await generateSupertonicSpeechChunked(
                text, 
                totalStep, 
                durationFactor, 
                onFirstChunkReady, 
                onChunkAdded
            );
            
            if (result.success) {
                const textLength = result.text ? result.text.length : 0;
                const isBatch = textLength >= getMaxChunkLength();
                const processingTimeStr = isBatch && firstChunkGenerationTime > 0
                    ? `${formatTimeDetailed(firstChunkGenerationTime)} / ${formatTimeDetailed(result.processingTime)}`
                    : formatTimeDetailed(result.processingTime);
                const charsPerSec = result.processingTime > 0 ? (textLength / result.processingTime).toFixed(1) : '0.0';
                const progressValue = textLength > 0 ? 100 : 0;
                
                const timeEl = document.getElementById('supertonic-time');
                const durationEl = document.getElementById('supertonic-duration');
                const cpsEl = document.getElementById('supertonic-cps');
                const rtfEl = document.getElementById('supertonic-rtf');
                
                if (timeEl) timeEl.innerHTML = formatStatValueWithSuffix(processingTimeStr, 's', { firstLabel: true });
                if (durationEl) durationEl.textContent = formatTimeDetailed(result.audioDuration);
                latestSupertonicProcessedChars = textLength;
                if (cpsEl) cpsEl.textContent = charsPerSec;
                if (rtfEl) {
                    const rtf = result.audioDuration > 0 ? (result.processingTime / result.audioDuration).toFixed(3) : '-';
                    rtfEl.innerHTML = formatStatValueWithSuffix(rtf, 'x');
                }
                const resultItemEl = document.getElementById('supertonic-result');
                if (resultItemEl) {
                    resultItemEl.style.setProperty('--result-progress', `${progressValue}%`);
                }
                
                // Final duration update (if custom player was used)
                if (audioContext && audioChunks.length > 0) {
                    totalDuration = result.audioDuration;
                    if (durationDisplay) {
                        durationDisplay.textContent = formatTime(result.audioDuration, { trimMobile: true });
                    }
                }
                
                // Always show download button
                const downloadBtn = document.getElementById('supertonic-download');
                if (downloadBtn) {
                    downloadBtn.parentElement.style.display = 'block';
                    downloadBtn.onclick = () => downloadDemoAudio(result.url, 'supertonic_speech.wav');
                }
            }
            
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            showDemoStatus(`<strong>Error:</strong> ${errorMessage}`, 'error');
            showDemoError(`Error during synthesis: ${errorMessage}`);
            console.error('Synthesis error:', error);
            
            // Restore placeholder
            demoResults.style.display = 'none';
            demoResults.innerHTML = `
                <div class="demo-placeholder">
                    <div class="demo-placeholder-icon">🎙️</div>
                    <p>Your generated speech will appear here</p>
                </div>
            `;
        } finally {
            isGenerating = false;
            demoGenerateBtn.disabled = false;
            
            // Re-enable speaker selection after generation
            const speakerItemsForGeneration = document.querySelectorAll('.speaker-item[data-voice]');
            speakerItemsForGeneration.forEach(item => item.classList.remove('disabled'));
            
            // Re-enable language selection after generation
            const languageItemsForGeneration = document.querySelectorAll('.speaker-item[data-language]');
            languageItemsForGeneration.forEach(item => item.classList.remove('disabled'));
        }
    }

    // Download handler (make it global)
    window.downloadDemoAudio = function(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    };

    // Helper function to convert speed to durationFactor
    function speedToDurationFactor(speed, offset=0.05) {
        return 1 / (speed + offset);
    }

    // Update slider value displays
    function updateSliderValues() {
        demoTotalStepsValue.textContent = demoTotalSteps.value + ' Steps';
        // Display speed with 'x' suffix (e.g., 1.0x, 0.7x, 1.5x)
        const speed = parseFloat(demoSpeed.value);
        demoSpeedValue.textContent = speed.toFixed(2) + 'x';
    }
    
    // Attach slider event listeners
    demoTotalSteps.addEventListener('input', updateSliderValues);
    demoSpeed.addEventListener('input', updateSliderValues);
    
    // Initialize slider values
    updateSliderValues();

    // Attach generate function to button
    demoGenerateBtn.addEventListener('click', generateSpeech);

    // Preset text items (defined before input listener to share scope)
    const presetItems = document.querySelectorAll('.preset-item[data-preset]');
    const freeformBtn = document.getElementById('freeformBtn');
    // currentLanguage is already declared above (line 902)
    let isPresetChanging = false; // Flag to track if text change is from preset button
    
    // Helper function to update active button state
    function updateActiveButton(presetType) {
        // Remove active from all preset items
        presetItems.forEach(item => item.classList.remove('active'));
        
        // Add active to the specified item
        if (presetType) {
            const targetItem = document.querySelector(`.preset-item[data-preset="${presetType}"]`);
            if (targetItem) {
                targetItem.classList.add('active');
            }
        }
        currentPreset = presetType;
        updateQuoteModeState(presetType === 'quote');
    }

    function updateQuoteModeState(isQuote) {
        if (!demoResults) return;
        demoResults.classList.toggle('quote-mode', Boolean(isQuote));
    }
    
    // Initialize quote button active state
    updateActiveButton('quote');
    if (presetTexts.quote && typeof presetTexts.quote === 'object' && presetTexts.quote[currentLanguage]) {
        demoTextInput.textContent = presetTexts.quote[currentLanguage];
        updateCharCounter();
    }
    
    presetItems.forEach(item => {
        item.addEventListener('click', () => {
            const presetType = item.getAttribute('data-preset');
            
            if (presetType === 'freeform') {
                // Freeform item: clear text
                isPresetChanging = true;
                demoTextInput.textContent = '';
                updateActiveButton('freeform');
                updateCharCounter();
                isPresetChanging = false;
            } else {
                // Other preset items: set text
                const preset = presetTexts[presetType];
                if (preset && typeof preset === 'object' && preset[currentLanguage]) {
                    const text = preset[currentLanguage];
                    isPresetChanging = true;
                    demoTextInput.textContent = text;
                    updateActiveButton(presetType);
                    updateCharCounter();
                    isPresetChanging = false;
                } else if (preset && typeof preset === 'string') {
                    // Fallback for old format (shouldn't happen, but just in case)
                    isPresetChanging = true;
                    demoTextInput.textContent = preset;
                    updateActiveButton(presetType);
                    updateCharCounter();
                    isPresetChanging = false;
                }
            }
        });
    });

    // Handle paste event to remove styles and paste only text
    demoTextInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Trigger input event to update character counter
        demoTextInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Update character counter on input
    let previousTextValue = demoTextInput.textContent || demoTextInput.innerText || '';
    // Update left border line height to match demo-input-section height
    const demoInputSection = document.querySelector('.demo-input-section');
    function updateLeftBorderHeight() {
        if (demoInputSection) {
            const height = demoInputSection.offsetHeight;
            demoInputSection.style.setProperty('--demo-text-input-height', `${height}px`);
        }
    }
    
    // Initialize and observe height changes
    updateLeftBorderHeight();
    const resizeObserver = new ResizeObserver(() => {
        updateLeftBorderHeight();
    });
    if (demoInputSection) {
        resizeObserver.observe(demoInputSection);
    }
    
    // Auto-calculate text input height for screens wider than 768px
    function calculateTextInputHeight() {
        if (window.innerWidth <= 768) {
            // Reset to default height for screens 768px and below
            demoTextInput.style.height = '';
            return;
        }
        
        const viewportHeight = window.innerHeight;
        const interactiveDemoEl = document.querySelector('.interactive-demo');
        const containerEl = document.querySelector('.container');
        const headerWrapperEl = document.querySelector('.demo-header-wrapper');
        const controlsEl = document.querySelector('.demo-controls');
        const inputLabelEl = document.querySelector('.demo-input-label');
        const presetRowEl = document.querySelector('#presetControlsRow');
        const outputSectionEl = document.querySelector('.demo-output-section');
        const contentEl = document.querySelector('.demo-content');
        
        // Get computed styles for gaps and paddings
        const interactiveDemoStyle = window.getComputedStyle(interactiveDemoEl || document.body);
        const containerStyle = window.getComputedStyle(containerEl || document.body);
        const contentStyle = window.getComputedStyle(contentEl || document.body);
        
        // Calculate total height of elements above and below text input
        let totalHeight = 0;
        
        // Interactive demo padding
        const interactiveDemoPaddingTop = parseFloat(interactiveDemoStyle.paddingTop) || 0;
        const interactiveDemoPaddingBottom = parseFloat(interactiveDemoStyle.paddingBottom) || 0;
        totalHeight += interactiveDemoPaddingTop + interactiveDemoPaddingBottom;
        
        // Container padding
        const containerPaddingTop = parseFloat(containerStyle.paddingTop) || 0;
        const containerPaddingBottom = parseFloat(containerStyle.paddingBottom) || 0;
        totalHeight += containerPaddingTop + containerPaddingBottom;
        
        // Header wrapper
        if (headerWrapperEl) {
            totalHeight += headerWrapperEl.offsetHeight;
        }
        
        // Demo controls
        if (controlsEl) {
            totalHeight += controlsEl.offsetHeight;
        }
        
        // Demo content gap (top)
        const contentGap = parseFloat(contentStyle.gap) || 0;
        totalHeight += contentGap;
        
        // Input label
        if (inputLabelEl) {
            totalHeight += inputLabelEl.offsetHeight;
        }
        
        // Preset controls row
        if (presetRowEl) {
            totalHeight += presetRowEl.offsetHeight;
        }
        
        // Demo content gap (bottom)
        totalHeight += contentGap;
        
        // Output section
        if (outputSectionEl) {
            totalHeight += outputSectionEl.offsetHeight;
        }
        
        // Calculate available height for text input
        const availableHeight = viewportHeight - totalHeight - 275; // Subtract 275px
        
        // Set minimum height (e.g., 200px) and maximum height
        const minHeight = 200;
        const maxHeight = availableHeight - 20; // 20px buffer
        
        if (availableHeight > minHeight) {
            demoTextInput.style.height = `${Math.max(minHeight, maxHeight)}px`;
        } else {
            demoTextInput.style.height = `${minHeight}px`;
        }
    }
    
    // Calculate on load and resize
    calculateTextInputHeight();
    window.addEventListener('resize', calculateTextInputHeight);
    
    // Observe elements that might change height
    const heightObserver = new ResizeObserver(() => {
        calculateTextInputHeight();
    });
    
    const headerWrapperEl = document.querySelector('.demo-header-wrapper');
    const controlsEl = document.querySelector('.demo-controls');
    const presetRowEl = document.querySelector('#presetControlsRow');
    const outputSectionEl = document.querySelector('.demo-output-section');
    
    if (headerWrapperEl) heightObserver.observe(headerWrapperEl);
    if (controlsEl) heightObserver.observe(controlsEl);
    if (presetRowEl) heightObserver.observe(presetRowEl);
    if (outputSectionEl) heightObserver.observe(outputSectionEl);
    
    // Auto-hide scrollbar functionality
    let scrollbarTimeout;
    demoTextInput.addEventListener('scroll', () => {
        // Add scrolling class to show scrollbar
        demoTextInput.classList.add('scrolling');
        
        // Clear existing timeout
        if (scrollbarTimeout) {
            clearTimeout(scrollbarTimeout);
        }
        
        // Hide scrollbar after 1.5 seconds of no scrolling
        scrollbarTimeout = setTimeout(() => {
            demoTextInput.classList.remove('scrolling');
        }, 1500);
    });
    
    demoTextInput.addEventListener('input', () => {
        updateCharCounter();
        
        // If text was modified by user (not from preset button), switch to freeform
        const currentText = demoTextInput.textContent || demoTextInput.innerText || '';
        if (!isPresetChanging && currentText !== previousTextValue) {
            updateActiveButton('freeform');
            }
        
        if (currentPreset === 'freeform') {
            // Auto-detect language when user is typing (not from preset)
            const detectedLang = detectLanguage(currentText);
            if (detectedLang && detectedLang !== currentLanguage) {
                const previousLang = currentLanguage;
                currentLanguage = detectedLang;
                window.updateActiveLanguage(currentLanguage);
                showLanguageToast(previousLang, detectedLang);
            }
        }
        
        previousTextValue = currentText;
    });
    
    // Update font size when window is resized (for responsive width-based font sizing)
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            updateCharCounter();
        }, 100);
    });
    
    // Initialize character counter
    updateCharCounter();

    // Speaker list handler (replaces voice select dropdown)
    const speakerList = document.getElementById('speakerList');
    const speakerItems = speakerList ? speakerList.querySelectorAll('.speaker-item[data-voice]') : [];
    let voiceSelectDisabled = false;
    
    // Update active speaker item (global function for use in switchVoice)
    window.updateActiveSpeaker = function(voice) {
        if (!speakerList || !speakerItems) return;
        speakerItems.forEach(item => {
            if (item.dataset.voice === voice) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    };
    
    // Initialize active speaker
    if (speakerList && speakerItems.length > 0) {
        window.updateActiveSpeaker(currentVoice);
    }
    
    // Handle speaker item clicks and hover tooltips
    const speakerTooltip = document.getElementById('speakerTooltip');
    
    if (speakerList) {
        speakerItems.forEach(item => {
            // Track if click was triggered by touch event (to prevent double execution)
            let clickFromTouch = false;
            
            // Click handler
            item.addEventListener('click', async (e) => {
                // On touch devices with mobile viewport, ignore native click events (we'll trigger manually from touchend)
                // PC (even with narrow viewport) should always handle clicks
                if (isTouchDevice() && isMobileViewport() && !clickFromTouch) {
                    return;
                }
                
                // Reset flag
                clickFromTouch = false;
                
                if (voiceSelectDisabled || modelsLoading || isGenerating) return;
                
                const selectedVoice = item.dataset.voice;
            
            // If already selected, just auto-generate and play
            if (selectedVoice === currentVoice) {
                const text = (demoTextInput.textContent || demoTextInput.innerText || '').trim();
                if (text.length >= 10 && !isGenerating && models && cfgs && processors) {
                    generateSpeech();
                }
                return;
            }
            
            // Disable all controls while loading
            const wasDisabled = demoGenerateBtn.disabled;
            demoGenerateBtn.disabled = true;
            voiceSelectDisabled = true;
                
                // Update UI immediately
                window.updateActiveSpeaker(selectedVoice);
            
            try {
                await switchVoice(selectedVoice);
                // Re-enable if models are loaded
                if (models && cfgs && processors) {
                    demoGenerateBtn.disabled = false;
                    voiceSelectDisabled = false;
                        
                        // Auto-generate and play after voice change
                        const text = (demoTextInput.textContent || demoTextInput.innerText || '').trim();
                        if (text.length >= 10 && !isGenerating) {
                            generateSpeech();
                        }
                }
            } catch (error) {
                console.error('Failed to switch voice:', error);
                // Revert selection on error
                    window.updateActiveSpeaker(currentVoice);
                voiceSelectDisabled = false;
                if (!wasDisabled) demoGenerateBtn.disabled = false;
            }
        });
        
            // Hover handler for tooltip
            if (speakerTooltip) {
                // Desktop hover events
                item.addEventListener('mouseenter', (e) => {
                    if (isTouchDevice() && isMobileViewport()) return; // Skip on touch devices with mobile viewport
                    const voice = item.dataset.voice;
                    if (voice && VOICE_DESCRIPTIONS[voice]) {
                        speakerTooltip.textContent = VOICE_DESCRIPTIONS[voice];
                        speakerTooltip.style.display = 'block';
                        updateTooltipPosition(e, speakerTooltip);
                    }
                });
                
                item.addEventListener('mousemove', (e) => {
                    if (isTouchDevice() && isMobileViewport()) return; // Skip on touch devices with mobile viewport
                    if (speakerTooltip.style.display === 'block') {
                        updateTooltipPosition(e, speakerTooltip);
                    }
                });
                
                item.addEventListener('mouseleave', () => {
                    if (isTouchDevice() && isMobileViewport()) return; // Skip on touch devices with mobile viewport
                    speakerTooltip.style.display = 'none';
                });
                
                // Mobile touch events
                let touchStartTime = 0;
                let touchHandled = false;
                let touchStartY = 0;
                const TOUCH_MOVE_THRESHOLD = 10; // pixels
                
                item.addEventListener('touchstart', (e) => {
                    if (!isTouchDevice() || !isMobileViewport()) return;
                    
                    touchHandled = false;
                    const touch = e.touches[0];
                    touchStartTime = Date.now();
                    touchStartY = touch.clientY;
                    
                    const voice = item.dataset.voice;
                    if (voice && VOICE_DESCRIPTIONS[voice]) {
                        // Prevent default to block text selection
                        e.preventDefault();
                        
                        // Show tooltip with mobile styling
                        speakerTooltip.textContent = VOICE_DESCRIPTIONS[voice];
                        speakerTooltip.style.display = 'block';
                        updateTooltipPositionMobile(speakerTooltip, touch.clientY);
                    }
                }, { passive: false });
                
                item.addEventListener('touchmove', (e) => {
                    if (!isTouchDevice() || !isMobileViewport()) return;
                    
                    const touch = e.touches[0];
                    const deltaY = Math.abs(touch.clientY - touchStartY);
                    
                    // Check if touch moved significantly
                    if (deltaY > TOUCH_MOVE_THRESHOLD) {
                        touchHandled = true;
                        // Hide tooltip if user moves finger
                        speakerTooltip.style.display = 'none';
                    }
                    
                    // Prevent default to avoid scrolling while showing tooltip
                    e.preventDefault();
                }, { passive: false });
                
                item.addEventListener('touchend', (e) => {
                    if (!isTouchDevice() || !isMobileViewport()) return;
                    
                    const touchEndTime = Date.now();
                    const touchDuration = touchEndTime - touchStartTime;
                    
                    // Hide tooltip
                    speakerTooltip.style.display = 'none';
                    
                    // Always prevent default to avoid text selection
                    e.preventDefault();
                    
                    // Only allow click if it was a short tap without movement
                    if (!touchHandled && touchDuration < 500) {
                        // Short tap - trigger click event manually after a small delay
                        clickFromTouch = true;
                        setTimeout(() => {
                            const clickEvent = new MouseEvent('click', {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            });
                            item.dispatchEvent(clickEvent);
                        }, 50);
                    } else {
                        // Long press or moved - prevent click
                        touchHandled = true;
                        e.stopPropagation();
                    }
                }, { passive: false });
                
                item.addEventListener('touchcancel', (e) => {
                    if (!isTouchDevice() || !isMobileViewport()) return;
                    
                    // Hide tooltip
                    speakerTooltip.style.display = 'none';
                    touchHandled = true;
                    
                    // Prevent default
                    e.preventDefault();
                }, { passive: false });
                
                // Prevent context menu (long press menu)
                item.addEventListener('contextmenu', (e) => {
                    if (isTouchDevice() && isMobileViewport()) {
                        e.preventDefault();
                        return false;
                    }
                });
            }
        });
    }

    // Function to update tooltip position (40px above mouse pointer)
    function updateTooltipPosition(event, tooltip) {
        const x = event.clientX;
        const y = event.clientY - 40; // 40px above mouse pointer
        
        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
        
        // Adjust if tooltip goes off screen
        const tooltipRect = tooltip.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        if (tooltipRect.right > windowWidth) {
            tooltip.style.left = (windowWidth - tooltipRect.width - 10) + 'px';
        }
        if (tooltipRect.left < 0) {
            tooltip.style.left = '10px';
        }
        if (tooltipRect.top < 0) {
            tooltip.style.top = (event.clientY + 40) + 'px';
        }
        if (tooltipRect.bottom > windowHeight) {
            tooltip.style.top = (windowHeight - tooltipRect.height - 10) + 'px';
        }
    }
    
    // Function to update tooltip position for mobile (centered, 75px above touch point)
    function updateTooltipPositionMobile(tooltip, touchY) {
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        // Set mobile-specific styles
        tooltip.style.width = '90%';
        tooltip.style.left = '5%'; // Center: (100% - 90%) / 2 = 5%
        tooltip.style.right = 'auto';
        tooltip.style.marginLeft = '0';
        tooltip.style.marginRight = '0';
        tooltip.style.whiteSpace = 'normal';
        tooltip.style.textAlign = 'center';
        
        // Position tooltip 75px above touch point (60px + 15px)
        const y = touchY - 75;
        tooltip.style.top = y + 'px';
        
        // Adjust if tooltip goes off screen
        const tooltipRect = tooltip.getBoundingClientRect();
        
        if (tooltipRect.top < 10) {
            // If tooltip goes above viewport, position it below touch point instead
            tooltip.style.top = (touchY + 20) + 'px';
        }
        if (tooltipRect.bottom > windowHeight - 10) {
            tooltip.style.top = (windowHeight - tooltipRect.height - 10) + 'px';
        }
    }
    
    // Language selection handler
    const languageList = document.getElementById('languageList');
    const languageItems = languageList ? languageList.querySelectorAll('.speaker-item[data-language]') : [];
    const rtlLanguages = new Set(['ar']);

    function applyInterfaceDirection(language) {
        const isRtl = rtlLanguages.has(language);
        const direction = isRtl ? 'rtl' : 'ltr';
        const lang = language || 'en';

        document.documentElement.lang = lang;
        document.documentElement.dir = direction;
        document.documentElement.dataset.language = lang;
        document.body.classList.toggle('rtl-language', isRtl);

        demoTextInput.setAttribute('lang', lang);
        demoTextInput.setAttribute('dir', direction);
        demoTextInput.classList.toggle('rtl-text', isRtl);

        if (demoResults) {
            demoResults.setAttribute('lang', lang);
            demoResults.setAttribute('dir', direction);
        }
    }
    
    // Update active language item (global function for use in language change)
    window.updateActiveLanguage = function(language) {
        applyInterfaceDirection(language);
        if (languageList && languageItems) {
            languageItems.forEach(item => {
                if (item.dataset.language === language) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        }
    };
    
    // Initialize active language
    if (languageList && languageItems.length > 0) {
        window.updateActiveLanguage(currentLanguage);
    }
    
    // Handle language item clicks
    if (languageList) {
        languageItems.forEach(item => {
            item.addEventListener('click', async (e) => {
                // Don't allow language change during model loading or generation
                if (modelsLoading || isGenerating) return;
                
                const selectedLanguage = item.dataset.language;
                
                // If already selected, just auto-generate and play
                if (selectedLanguage === currentLanguage) {
                    const text = (demoTextInput.textContent || demoTextInput.innerText || '').trim();
                    if (text.length >= 10 && !isGenerating && models && cfgs && processors) {
                        generateSpeech();
                    }
                    return;
                }
                
                // Update language
                currentLanguage = selectedLanguage;
                window.updateActiveLanguage(currentLanguage);
                
                // Update text if we're on a preset (not freeform)
                if (currentPreset && currentPreset !== 'freeform' && presetTexts[currentPreset]) {
                    const preset = presetTexts[currentPreset];
                    if (preset && typeof preset === 'object' && preset[currentLanguage]) {
                        isPresetChanging = true;
                        demoTextInput.textContent = preset[currentLanguage];
                        updateCharCounter();
                        isPresetChanging = false;
                    }
                }
                
                // Auto-generate and play after language change
                // Wait a bit for UI to update
                await new Promise(resolve => setTimeout(resolve, 100));
                const text = (demoTextInput.textContent || demoTextInput.innerText || '').trim();
                if (text.length >= 10 && !isGenerating && models && cfgs && processors) {
                    generateSpeech();
                }
            });
        });
    }

    // Title animation setup
    const demoTitleLeft = document.querySelector('.demo-title-left');
    const demoTitleRight = document.querySelector('.demo-title-right');
    const demoOutputSection = document.querySelector('.demo-output-section');

    // Initialize Text with letters wrapped in spans
    if (demoTitleLeft) {
        const text = demoTitleLeft.textContent.trim();
        demoTitleLeft.innerHTML = text.split('').map(char => 
            char === ' ' ? ' ' : `<span class="letter visible">${char}</span>`
        ).join('');
    }

    // Text animation on demo-input-section click
    if (demoInputSection && demoTitleLeft) {
        demoInputSection.addEventListener('click', () => {
            const letters = demoTitleLeft.querySelectorAll('.letter');
            // Reset all letters
            letters.forEach(letter => {
                letter.classList.remove('visible');
            });
            
            // Show letters one by one (total 0.25s = 0.125s / 2)
            letters.forEach((letter, index) => {
                setTimeout(() => {
                    letter.classList.add('visible');
                }, index * 0.0625 * 1000); // 0.0625s delay between each letter
            });
        });
    }

    // Speech animation on demo-output-section click
    if (demoOutputSection && demoTitleRight) {
        demoOutputSection.addEventListener('click', (event) => {
            if (event.target.closest('#demoGenerateBtn')) {
                return;
            }
            demoTitleRight.classList.remove('animate-speech');
            // Trigger reflow
            void demoTitleRight.offsetWidth;
            demoTitleRight.classList.add('animate-speech');
        });
    }

    // Initialize models
    initializeModels();
})();

// v3 cache-bust
