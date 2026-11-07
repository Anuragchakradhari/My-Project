/**
 * Language Translator Web Application
 * 
 * Provides real-time text translation, language swapping, text-to-speech pronunciation,
 * clipboard copying, and a persistent Vocabulary Notebook across 90+ world languages
 * with accessible semantics, offline storage, session fallback, and robust error handling.
 */

"use strict";

/* ==========================================================================
   Configuration & Translation Providers
   ========================================================================== */

const DEFAULT_SOURCE_CODE = "en-GB";
const DEFAULT_TARGET_CODE = "hi-IN";
const TRANSLATION_TIMEOUT_MS = 12000; // 12 seconds request timeout per translation provider

/**
 * Normalize and resolve provider-specific language codes
 * @param {"google" | "myMemory"} provider
 * @param {string} bcpCode - e.g. "en-GB", "ur-PK"
 * @returns {string}
 */
function getProviderLanguageCode(provider, bcpCode) {
    if (!bcpCode || typeof bcpCode !== "string") return "en";
    const subtag = bcpCode.split("-")[0].toLowerCase();

    if (provider === "google") {
        // Google GTX uses the primary ISO-639-1 language subtag
        return subtag;
    }

    if (provider === "myMemory") {
        // MyMemory accepts standard BCP-47 or ISO-639-1 language codes
        return bcpCode;
    }

    return subtag;
}

/**
 * Translation Provider Implementations
 * 
 * Provider Limitations & Technical Notes:
 * 1. Google Web Client (Primary):
 *    - Uses client web endpoint (`translate.googleapis.com/translate_a/single?client=gtx`).
 *    - Unofficial endpoint with no formal SLA or guaranteed uptime.
 *    - Requires no credentials/secrets, making it suitable for client-side applications.
 *    - May be subject to IP-level rate-limiting (HTTP 429) or CORS restrictions under heavy traffic.
 * 
 * 2. MyMemory Translated API (Fallback):
 *    - Public crowdsourced translation memory service (`api.mymemory.translated.net/get`).
 *    - Free anonymous usage is capped at approximately 5,000 characters/day per IP.
 *    - Responses must be explicitly inspected for warning messages and non-200 responseStatus fields.
 */
const translationProviders = {
    google: {
        name: "Google Web Client (Unofficial)",
        async translate(text, fromCode, toCode, signal) {
            const fromLang = getProviderLanguageCode("google", fromCode);
            const toLang = getProviderLanguageCode("google", toCode);

            const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`;

            const response = await fetch(endpoint, { signal });

            if (!response.ok) {
                if (response.status === 400) {
                    throw new Error("UNSUPPORTED_LANGUAGE");
                }
                if (response.status === 429) {
                    throw new Error("RATE_LIMITED");
                }
                throw new Error(`Primary provider returned HTTP ${response.status} (${response.statusText})`);
            }

            const data = await response.json();

            if (!Array.isArray(data) || !Array.isArray(data[0])) {
                throw new Error("MALFORMED_RESPONSE");
            }

            const translated = data[0]
                .map(segment => (Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : ""))
                .join("");

            if (!translated || !translated.trim()) {
                throw new Error("EMPTY_TRANSLATION");
            }

            return translated;
        }
    },

    myMemory: {
        name: "MyMemory Translated API (Fallback)",
        async translate(text, fromCode, toCode, signal) {
            // First attempt with full BCP-47 codes (e.g. en-GB|ur-PK)
            const endpoint = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromCode}|${toCode}`;
            let response = await fetch(endpoint, { signal });
            let data = null;
            let needsSubtagRetry = false;

            if (!response.ok) {
                if (response.status === 429) {
                    throw new Error("RATE_LIMITED");
                }
                needsSubtagRetry = true;
            } else {
                data = await response.json();
                const internalStatus = Number(data?.responseStatus);
                const details = (data?.responseDetails || "").toUpperCase();
                if (internalStatus !== 200 && (details.includes("INVALID") || internalStatus === 403)) {
                    needsSubtagRetry = true;
                }
            }

            // Retry with primary subtags (e.g. en|ur) if regional pair failed
            if (needsSubtagRetry) {
                const fromSub = fromCode.split("-")[0].toLowerCase();
                const toSub = toCode.split("-")[0].toLowerCase();
                if (fromSub !== fromCode || toSub !== toCode) {
                    const fallbackEndpoint = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromSub}|${toSub}`;
                    const fbResponse = await fetch(fallbackEndpoint, { signal });
                    if (fbResponse.ok) {
                        const fbData = await fbResponse.json();
                        const fbStatus = Number(fbData?.responseStatus);
                        const fbTrans = fbData?.responseData?.translatedText;
                        if (
                            fbStatus === 200 &&
                            typeof fbTrans === "string" &&
                            fbTrans.trim() &&
                            !/^MYMEMORY WARNING/i.test(fbTrans.trim()) &&
                            !/^'[^']+' IS AN INVALID/i.test(fbTrans.trim())
                        ) {
                            response = fbResponse;
                            data = fbData;
                            needsSubtagRetry = false;
                        }
                    }
                }
            }

            if (!response.ok) {
                if (response.status === 429) {
                    throw new Error("RATE_LIMITED");
                }
                throw new Error(`Fallback provider returned HTTP ${response.status} (${response.statusText})`);
            }

            if (!data || typeof data !== "object") {
                throw new Error("MALFORMED_RESPONSE");
            }

            const internalStatus = Number(data.responseStatus);
            if (internalStatus !== 200) {
                const details = (data.responseDetails || "").toUpperCase();
                if (details.includes("INVALID TARGET LANGUAGE") || details.includes("INVALID SOURCE LANGUAGE") || internalStatus === 403) {
                    throw new Error("UNSUPPORTED_LANGUAGE");
                }
                if (internalStatus === 429 || details.includes("QUOTA") || details.includes("LIMIT")) {
                    throw new Error("RATE_LIMITED");
                }
                throw new Error(data.responseDetails || `Fallback API status error: ${data.responseStatus}`);
            }

            if (!data.responseData || typeof data.responseData.translatedText !== "string") {
                throw new Error("MALFORMED_RESPONSE");
            }

            const translated = data.responseData.translatedText.trim();

            if (/^MYMEMORY WARNING/i.test(translated)) {
                throw new Error("RATE_LIMITED");
            }
            if (/^'[^']+' IS AN INVALID/i.test(translated)) {
                throw new Error("UNSUPPORTED_LANGUAGE");
            }

            let finalTranslation = translated;
            if (Array.isArray(data.matches)) {
                for (const match of data.matches) {
                    if (match && (match.id === 0 || match.id === "0") && typeof match.translation === "string" && match.translation.trim()) {
                        finalTranslation = match.translation.trim();
                        break;
                    }
                }
            }

            finalTranslation = decodeHtmlEntities(finalTranslation);

            if (!finalTranslation) {
                throw new Error("EMPTY_TRANSLATION");
            }

            return finalTranslation;
        }
    }
};

/**
 * Decode HTML entities in translated strings (e.g., &quot;, &#39;, &amp;)
 * @param {string} str
 * @returns {string}
 */
function decodeHtmlEntities(str) {
    if (!str || typeof str !== "string" || !str.includes("&")) return str;
    const doc = new DOMParser().parseFromString(str, "text/html");
    return doc.body.textContent || str;
}

/* ==========================================================================
   Storage Adapter (Versioned LocalStorage with In-Memory Session Fallback)
   ========================================================================== */

/**
 * StorageAdapter manages reading and writing vocabulary entries.
 * - Uses window.localStorage when available.
 * - Falls back to in-memory session persistence when localStorage is unavailable, blocked, or in recovery mode.
 * - Strictly validates schema version (v1) and individual entries.
 * - Safeguards unsupported/newer versions and malformed data by preserving them untouched.
 * - Gracefully handles QuotaExceededError without data loss or UI inconsistency.
 */
const StorageAdapter = {
    KEY: "translator_vocab_notebook_v1",
    SUPPORTED_VERSIONS: [1, 2],
    CURRENT_VERSION: 2,

    mode: "localStorage", // "localStorage" | "memory"
    isProtected: false, // Set to true when malformed or unsupported version is detected
    protectionReason: null, // "UNSUPPORTED_VERSION" | "CORRUPTED_JSON" | "INVALID_STRUCTURE"
    preservedRawPayload: null, // Preserved raw payload to protect against destructive writes

    memoryStore: {
        version: 2,
        entries: [],
        learningHistory: {
            quizHistory: [],
            flashcardStats: {
                totalReviews: 0,
                cardAssessments: {}
            },
            dailyActivity: {}
        }
    },

    /**
     * Probe whether localStorage is currently readable and writable
     * @returns {boolean}
     */
    isLocalStorageAvailable() {
        try {
            const probeKey = "__vocab_storage_probe__";
            window.localStorage.setItem(probeKey, probeKey);
            window.localStorage.removeItem(probeKey);
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Initialize adapter mode
     */
    init() {
        this.isProtected = false;
        this.protectionReason = null;
        this.preservedRawPayload = null;

        if (this.isLocalStorageAvailable()) {
            this.mode = "localStorage";
        } else {
            this.mode = "memory";
            console.warn("[StorageAdapter] localStorage is not accessible. Initialized in-memory session fallback.");
        }
    },

    /**
     * Safely load and validate stored vocabulary entries and learning history
     * @returns {{ mode: "localStorage" | "memory", entries: Array<Object>, learningHistory: Object, notice: string, unsupportedVersion?: any }}
     */
    load() {
        if (this.mode !== "localStorage") {
            return {
                mode: "memory",
                entries: [...this.memoryStore.entries],
                learningHistory: JSON.parse(JSON.stringify(this.memoryStore.learningHistory)),
                notice: this.isProtected ? "PROTECTED_RECOVERY_ACTIVE" : "SESSION_FALLBACK_ACTIVE"
            };
        }

        try {
            const raw = window.localStorage.getItem(this.KEY);
            if (!raw) {
                const defaultHistory = this.sanitizeLearningHistory(null);
                this.memoryStore.entries = [];
                this.memoryStore.learningHistory = defaultHistory;
                return { mode: "localStorage", entries: [], learningHistory: defaultHistory, notice: "EMPTY" };
            }

            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (jsonErr) {
                console.error("[StorageAdapter] Malformed JSON in localStorage. Preserving raw data:", jsonErr);
                this.isProtected = true;
                this.protectionReason = "CORRUPTED_JSON";
                this.preservedRawPayload = raw;
                this.mode = "memory";
                const defaultHistory = this.sanitizeLearningHistory(null);
                this.memoryStore.entries = [];
                this.memoryStore.learningHistory = defaultHistory;
                return {
                    mode: "memory",
                    entries: [],
                    learningHistory: defaultHistory,
                    notice: "CORRUPTED_JSON_PRESERVED"
                };
            }

            // Legacy array format check: [ { ... }, { ... } ]
            if (Array.isArray(parsed)) {
                const validEntries = this.sanitizeEntries(parsed);
                const defaultHistory = this.sanitizeLearningHistory(null);
                if (validEntries.length > 0) {
                    try {
                        const payload = {
                            version: this.CURRENT_VERSION,
                            entries: validEntries,
                            learningHistory: defaultHistory
                        };
                        window.localStorage.setItem(this.KEY, JSON.stringify(payload));
                        this.memoryStore.entries = [...validEntries];
                        this.memoryStore.learningHistory = defaultHistory;
                        return {
                            mode: "localStorage",
                            entries: validEntries,
                            learningHistory: defaultHistory,
                            notice: "LEGACY_DATA_MIGRATED"
                        };
                    } catch (migErr) {
                        console.warn("[StorageAdapter] Migration write failed. Preserving original payload in memory:", migErr);
                        this.isProtected = true;
                        this.protectionReason = "MIGRATION_WRITE_FAILED";
                        this.preservedRawPayload = raw;
                        this.mode = "memory";
                        this.memoryStore.entries = [...validEntries];
                        this.memoryStore.learningHistory = defaultHistory;
                        return {
                            mode: "memory",
                            entries: validEntries,
                            learningHistory: defaultHistory,
                            notice: "LEGACY_MIGRATION_FAILED_SESSION_ONLY"
                        };
                    }
                }

                // If legacy array had no recoverable valid entries, preserve it
                this.isProtected = true;
                this.protectionReason = "INVALID_LEGACY_ARRAY";
                this.preservedRawPayload = raw;
                this.mode = "memory";
                this.memoryStore.entries = [];
                this.memoryStore.learningHistory = defaultHistory;
                return { mode: "memory", entries: [], learningHistory: defaultHistory, notice: "CORRUPTED_DATA_PRESERVED" };
            }

            if (!parsed || typeof parsed !== "object") {
                this.isProtected = true;
                this.protectionReason = "INVALID_STRUCTURE";
                this.preservedRawPayload = raw;
                this.mode = "memory";
                const defaultHistory = this.sanitizeLearningHistory(null);
                this.memoryStore.entries = [];
                this.memoryStore.learningHistory = defaultHistory;
                return { mode: "memory", entries: [], learningHistory: defaultHistory, notice: "INVALID_STRUCTURE_PRESERVED" };
            }

            const version = parsed.version;

            // Legacy object format without version: { entries: [...] }
            if (version === undefined && Array.isArray(parsed.entries)) {
                const validEntries = this.sanitizeEntries(parsed.entries);
                const defaultHistory = this.sanitizeLearningHistory(null);
                if (validEntries.length > 0) {
                    try {
                        const payload = {
                            version: this.CURRENT_VERSION,
                            entries: validEntries,
                            learningHistory: defaultHistory
                        };
                        window.localStorage.setItem(this.KEY, JSON.stringify(payload));
                        this.memoryStore.entries = [...validEntries];
                        this.memoryStore.learningHistory = defaultHistory;
                        return {
                            mode: "localStorage",
                            entries: validEntries,
                            learningHistory: defaultHistory,
                            notice: "LEGACY_DATA_MIGRATED"
                        };
                    } catch (migErr) {
                        this.isProtected = true;
                        this.protectionReason = "MIGRATION_WRITE_FAILED";
                        this.preservedRawPayload = raw;
                        this.mode = "memory";
                        this.memoryStore.entries = [...validEntries];
                        this.memoryStore.learningHistory = defaultHistory;
                        return {
                            mode: "memory",
                            entries: validEntries,
                            learningHistory: defaultHistory,
                            notice: "LEGACY_MIGRATION_FAILED_SESSION_ONLY"
                        };
                    }
                }

                this.isProtected = true;
                this.protectionReason = "INVALID_LEGACY_ENTRIES";
                this.preservedRawPayload = raw;
                this.mode = "memory";
                this.memoryStore.entries = [];
                this.memoryStore.learningHistory = defaultHistory;
                return { mode: "memory", entries: [], learningHistory: defaultHistory, notice: "CORRUPTED_DATA_PRESERVED" };
            }

            // Unsupported schema version policy:
            if (!this.SUPPORTED_VERSIONS.includes(version)) {
                console.warn(`[StorageAdapter] Unsupported schema version (v${version}). Preserving stored data.`);
                this.isProtected = true;
                this.protectionReason = "UNSUPPORTED_VERSION";
                this.preservedRawPayload = parsed;
                this.mode = "memory";

                // Salvage any readable entries and history for display during this session
                const salvageable = Array.isArray(parsed.entries) ? this.sanitizeEntries(parsed.entries) : [];
                const salvageableHistory = this.sanitizeLearningHistory(parsed.learningHistory || null);
                this.memoryStore.entries = [...salvageable];
                this.memoryStore.learningHistory = salvageableHistory;

                return {
                    mode: "memory",
                    entries: salvageable,
                    learningHistory: salvageableHistory,
                    notice: "UNSUPPORTED_VERSION_PRESERVED",
                    unsupportedVersion: version
                };
            }

            // Supported Schema Version 1 -> Migrate to Version 2
            if (version === 1) {
                if (!Array.isArray(parsed.entries)) {
                    this.isProtected = true;
                    this.protectionReason = "CORRUPTED_ENTRIES";
                    this.preservedRawPayload = raw;
                    this.mode = "memory";
                    const defaultHistory = this.sanitizeLearningHistory(null);
                    return { mode: "memory", entries: [], learningHistory: defaultHistory, notice: "CORRUPTED_ENTRIES_PRESERVED" };
                }

                const validEntries = this.sanitizeEntries(parsed.entries);
                const initialHistory = this.sanitizeLearningHistory(parsed.learningHistory || null);

                try {
                    const payload = {
                        version: this.CURRENT_VERSION,
                        entries: validEntries,
                        learningHistory: initialHistory
                    };
                    window.localStorage.setItem(this.KEY, JSON.stringify(payload));
                    this.memoryStore.entries = [...validEntries];
                    this.memoryStore.learningHistory = initialHistory;
                    return {
                        mode: "localStorage",
                        entries: validEntries,
                        learningHistory: initialHistory,
                        notice: "VERSION_1_MIGRATED"
                    };
                } catch (migErr) {
                    console.warn("[StorageAdapter] Version 1 migration write failed. Preserving original payload in memory:", migErr);
                    this.isProtected = true;
                    this.protectionReason = "MIGRATION_WRITE_FAILED";
                    this.preservedRawPayload = raw;
                    this.mode = "memory";
                    this.memoryStore.entries = [...validEntries];
                    this.memoryStore.learningHistory = initialHistory;
                    return {
                        mode: "memory",
                        entries: validEntries,
                        learningHistory: initialHistory,
                        notice: "VERSION_1_MIGRATION_FAILED_SESSION_ONLY"
                    };
                }
            }

            // Supported Schema Version 2: validate entries array and learningHistory
            if (!Array.isArray(parsed.entries)) {
                this.isProtected = true;
                this.protectionReason = "CORRUPTED_ENTRIES";
                this.preservedRawPayload = raw;
                this.mode = "memory";
                const defaultHistory = this.sanitizeLearningHistory(null);
                return { mode: "memory", entries: [], learningHistory: defaultHistory, notice: "CORRUPTED_ENTRIES_PRESERVED" };
            }

            const validEntries = this.sanitizeEntries(parsed.entries);
            const validHistory = this.sanitizeLearningHistory(parsed.learningHistory);
            this.memoryStore.entries = [...validEntries];
            this.memoryStore.learningHistory = validHistory;
            return { mode: "localStorage", entries: validEntries, learningHistory: validHistory, notice: "CLEAN" };

        } catch (readErr) {
            console.error("[StorageAdapter] Read failure from localStorage:", readErr);
            this.mode = "memory";
            return {
                mode: "memory",
                entries: [...this.memoryStore.entries],
                learningHistory: JSON.parse(JSON.stringify(this.memoryStore.learningHistory)),
                notice: "STORAGE_READ_FAILED"
            };
        }
    },

    /**
     * Persist entries and/or learning history using active storage mode
     * @param {Array<Object>} [entries]
     * @param {Object} [learningHistory]
     * @returns {{ success: boolean, persistedToDisk: boolean, mode: string, isProtected?: boolean, error?: string, warning?: string }}
     */
    save(entries, learningHistory) {
        const sanitizedEntries = (entries !== undefined)
            ? this.sanitizeEntries(entries)
            : [...this.memoryStore.entries];

        const sanitizedHistory = (learningHistory !== undefined)
            ? this.sanitizeLearningHistory(learningHistory)
            : (this.memoryStore.learningHistory ? this.sanitizeLearningHistory(this.memoryStore.learningHistory) : this.sanitizeLearningHistory(null));

        // Protected recovery mode: NEVER overwrite preserved raw payload on disk!
        if (this.isProtected) {
            this.memoryStore.entries = [...sanitizedEntries];
            this.memoryStore.learningHistory = sanitizedHistory;
            return {
                success: true,
                persistedToDisk: false,
                mode: "memory",
                isProtected: true,
                warning: "PROTECTED_RECOVERY_MODE"
            };
        }

        // Standard in-memory session mode
        if (this.mode === "memory") {
            this.memoryStore.entries = [...sanitizedEntries];
            this.memoryStore.learningHistory = sanitizedHistory;
            return {
                success: true,
                persistedToDisk: false,
                mode: "memory",
                isProtected: false
            };
        }

        // Persistent localStorage mode
        try {
            const payload = {
                version: this.CURRENT_VERSION,
                entries: sanitizedEntries,
                learningHistory: sanitizedHistory
            };
            window.localStorage.setItem(this.KEY, JSON.stringify(payload));
            this.memoryStore.entries = [...sanitizedEntries];
            this.memoryStore.learningHistory = sanitizedHistory;
            return {
                success: true,
                persistedToDisk: true,
                mode: "localStorage"
            };
        } catch (writeErr) {
            const isQuota = writeErr.name === "QuotaExceededError" || writeErr.code === 22 || writeErr.code === 1014;
            if (isQuota) {
                console.error("[StorageAdapter] localStorage quota exceeded:", writeErr);
                this.memoryStore.entries = [...sanitizedEntries];
                this.memoryStore.learningHistory = sanitizedHistory;
                return {
                    success: false,
                    error: "QUOTA_EXCEEDED",
                    persistedToDisk: false,
                    mode: "localStorage"
                };
            }

            console.error("[StorageAdapter] localStorage write failure, falling back to session memory:", writeErr);
            this.mode = "memory";
            this.memoryStore.entries = [...sanitizedEntries];
            this.memoryStore.learningHistory = sanitizedHistory;
            return {
                success: true,
                persistedToDisk: false,
                mode: "memory",
                warning: "FALLBACK_TO_SESSION_MEMORY"
            };
        }
    },

    /**
     * Strictly validate individual vocabulary entries, repairing missing/duplicate IDs
     * without silently dropping valid translation data
     * @param {Array} rawEntries
     * @returns {Array<Object>}
     */
    sanitizeEntries(rawEntries) {
        if (!Array.isArray(rawEntries)) return [];
        const seenIds = new Set();
        const valid = [];

        for (let i = 0; i < rawEntries.length; i++) {
            const entry = rawEntries[i];
            if (!entry || typeof entry !== "object") continue;

            const sourceText = typeof entry.sourceText === "string" ? entry.sourceText.trim() : "";
            const translatedText = typeof entry.translatedText === "string" ? entry.translatedText.trim() : "";

            if (!sourceText || !translatedText) {
                continue;
            }

            let id = typeof entry.id === "string" && entry.id.trim().length > 0 ? entry.id.trim() : "";
            if (!id || seenIds.has(id)) {
                id = generateUniqueId();
            }
            seenIds.add(id);

            const fromCode = typeof entry.fromCode === "string" && entry.fromCode.trim() ? entry.fromCode.trim() : DEFAULT_SOURCE_CODE;
            const toCode = typeof entry.toCode === "string" && entry.toCode.trim() ? entry.toCode.trim() : DEFAULT_TARGET_CODE;
            const fromName = typeof entry.fromName === "string" && entry.fromName.trim()
                ? entry.fromName.trim()
                : (typeof countries === "object" && countries && countries[fromCode] ? countries[fromCode] : fromCode);
            const toName = typeof entry.toName === "string" && entry.toName.trim()
                ? entry.toName.trim()
                : (typeof countries === "object" && countries && countries[toCode] ? countries[toCode] : toCode);

            const createdAt = typeof entry.createdAt === "number" && !isNaN(entry.createdAt) && entry.createdAt > 0
                ? entry.createdAt
                : Date.now();

            const isFavorite = Boolean(entry.isFavorite);

            valid.push({
                id,
                sourceText: entry.sourceText,
                translatedText: entry.translatedText,
                fromCode,
                fromName,
                toCode,
                toName,
                createdAt,
                isFavorite
            });
        }

        return valid;
    },

    /**
     * Strictly sanitize learning history payload, ensuring valid structure,
     * numeric bounds, and clean associations
     * @param {Object} rawHistory
     * @returns {{
     *   quizHistory: Array<Object>,
     *   flashcardStats: { totalReviews: number, cardAssessments: Object },
     *   dailyActivity: Object
     * }}
     */
    sanitizeLearningHistory(rawHistory) {
        const defaultHistory = {
            quizHistory: [],
            flashcardStats: {
                totalReviews: 0,
                cardAssessments: {}
            },
            dailyActivity: {}
        };

        if (!rawHistory || typeof rawHistory !== "object") {
            return defaultHistory;
        }

        // 1. Sanitize quizHistory
        const validQuizHistory = [];
        const seenQuizIds = new Set();

        if (Array.isArray(rawHistory.quizHistory)) {
            for (let i = 0; i < rawHistory.quizHistory.length; i++) {
                const item = rawHistory.quizHistory[i];
                if (!item || typeof item !== "object") continue;

                let id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : generateUniqueId();
                if (seenQuizIds.has(id)) {
                    id = generateUniqueId();
                }
                seenQuizIds.add(id);

                const timestamp = typeof item.timestamp === "number" && !isNaN(item.timestamp) && item.timestamp > 0
                    ? item.timestamp
                    : Date.now();

                const date = typeof item.date === "string" && item.date.trim()
                    ? item.date.trim()
                    : new Date(timestamp).toISOString();

                const totalQuestions = typeof item.totalQuestions === "number" && !isNaN(item.totalQuestions) && item.totalQuestions >= 0
                    ? Math.floor(item.totalQuestions)
                    : 0;

                const correctCount = typeof item.correctCount === "number" && !isNaN(item.correctCount) && item.correctCount >= 0
                    ? Math.min(totalQuestions, Math.floor(item.correctCount))
                    : 0;

                const incorrectCount = typeof item.incorrectCount === "number" && !isNaN(item.incorrectCount) && item.incorrectCount >= 0
                    ? Math.min(totalQuestions - correctCount, Math.floor(item.incorrectCount))
                    : Math.max(0, totalQuestions - correctCount);

                const percentage = totalQuestions > 0
                    ? Math.round((correctCount / totalQuestions) * 100)
                    : 0;

                const direction = item.direction === "reverse" ? "reverse" : "forward";
                const languagePair = typeof item.languagePair === "string" && item.languagePair.trim()
                    ? item.languagePair.trim()
                    : "all";

                validQuizHistory.push({
                    id,
                    timestamp,
                    date,
                    totalQuestions,
                    correctCount,
                    incorrectCount,
                    percentage,
                    direction,
                    languagePair
                });
            }
        }

        // 2. Sanitize flashcardStats
        let totalReviews = 0;
        const cardAssessments = {};

        if (rawHistory.flashcardStats && typeof rawHistory.flashcardStats === "object") {
            const rawTotal = rawHistory.flashcardStats.totalReviews;
            if (typeof rawTotal === "number" && !isNaN(rawTotal) && rawTotal >= 0) {
                totalReviews = Math.floor(rawTotal);
            }

            if (rawHistory.flashcardStats.cardAssessments && typeof rawHistory.flashcardStats.cardAssessments === "object") {
                for (const [entryId, assessment] of Object.entries(rawHistory.flashcardStats.cardAssessments)) {
                    if (typeof entryId !== "string" || !entryId.trim() || !assessment || typeof assessment !== "object") continue;

                    const knewCount = typeof assessment.knewCount === "number" && assessment.knewCount >= 0
                        ? Math.floor(assessment.knewCount)
                        : 0;
                    const practiceCount = typeof assessment.practiceCount === "number" && assessment.practiceCount >= 0
                        ? Math.floor(assessment.practiceCount)
                        : 0;
                    const lastAssessment = assessment.lastAssessment === "practice" ? "practice" : "knew";
                    const lastReviewed = typeof assessment.lastReviewed === "number" && assessment.lastReviewed > 0
                        ? assessment.lastReviewed
                        : Date.now();

                    cardAssessments[entryId.trim()] = {
                        knewCount,
                        practiceCount,
                        lastAssessment,
                        lastReviewed
                    };
                }
            }
        }

        // Ensure totalReviews reflects at least the sum of per-card assessments if missing
        let calculatedAssessments = 0;
        for (const ca of Object.values(cardAssessments)) {
            calculatedAssessments += (ca.knewCount + ca.practiceCount);
        }
        if (totalReviews < calculatedAssessments) {
            totalReviews = calculatedAssessments;
        }

        // 3. Sanitize or Derive dailyActivity
        const dailyActivity = {};
        if (rawHistory.dailyActivity && typeof rawHistory.dailyActivity === "object") {
            for (const [dateKey, dayData] of Object.entries(rawHistory.dailyActivity)) {
                if (typeof dateKey !== "string" || !dateKey.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
                if (!dayData || typeof dayData !== "object") continue;

                dailyActivity[dateKey] = {
                    date: dateKey,
                    flashcardReviews: typeof dayData.flashcardReviews === "number" && dayData.flashcardReviews >= 0 ? Math.floor(dayData.flashcardReviews) : 0,
                    quizAttempts: typeof dayData.quizAttempts === "number" && dayData.quizAttempts >= 0 ? Math.floor(dayData.quizAttempts) : 0,
                    quizCorrect: typeof dayData.quizCorrect === "number" && dayData.quizCorrect >= 0 ? Math.floor(dayData.quizCorrect) : 0,
                    quizIncorrect: typeof dayData.quizIncorrect === "number" && dayData.quizIncorrect >= 0 ? Math.floor(dayData.quizIncorrect) : 0
                };
            }
        }

        // Populate any missing daily dates from quiz history
        for (let i = 0; i < validQuizHistory.length; i++) {
            const q = validQuizHistory[i];
            const d = new Date(q.timestamp);
            if (!isNaN(d.getTime())) {
                const dateKey = d.toISOString().split("T")[0];
                if (!dailyActivity[dateKey]) {
                    dailyActivity[dateKey] = {
                        date: dateKey,
                        flashcardReviews: 0,
                        quizAttempts: 0,
                        quizCorrect: 0,
                        quizIncorrect: 0
                    };
                    for (let j = 0; j < validQuizHistory.length; j++) {
                        const q2 = validQuizHistory[j];
                        const d2 = new Date(q2.timestamp);
                        if (!isNaN(d2.getTime()) && d2.toISOString().split("T")[0] === dateKey) {
                            dailyActivity[dateKey].quizAttempts++;
                            dailyActivity[dateKey].quizCorrect += (q2.correctCount || 0);
                            dailyActivity[dateKey].quizIncorrect += (q2.incorrectCount || 0);
                        }
                    }
                }
            }
        }

        return {
            quizHistory: validQuizHistory,
            flashcardStats: {
                totalReviews,
                cardAssessments
            },
            dailyActivity
        };
    }
};

/* ==========================================================================
   Application State
   ========================================================================== */

const state = {
    isTranslating: false,
    activeRequestId: 0,
    currentAbortController: null,
    activeUtterance: null,
    lastTranslatedSourceText: "",
    lastTranslatedFromCode: "",
    lastTranslatedToCode: "",
    statusTimeoutId: null
};

const notebookState = {
    entries: [],
    searchQuery: "",
    languageFilter: "all",
    favoritesOnly: false,
    activeTab: "translator" // "translator" | "notebook" | "practice" | "progress"
};

const practiceState = {
    currentIndex: 0,
    isAnswerShown: false,
    sessionResults: new Map(), // entry id -> "knew" | "practice"
    subMode: "flashcards" // "flashcards" | "quiz"
};

const quizState = {
    direction: "forward", // "forward" | "reverse"
    selectedLanguagePair: "all",
    questionCount: 5,
    shuffleOrder: true,

    status: "idle", // "idle" | "active" | "completed"
    questions: [],
    currentIndex: 0,
    userAnswers: [],
    isAnswerSubmitted: false,
    isAttemptRecorded: false,
    correctCount: 0,
    incorrectCount: 0
};

const progressState = {
    flashcardReviews: 0,
    cardAssessments: {},
    dailyActivity: {},
    reviewedCardIds: new Set(),
    quizHistory: [] // Array of { id, timestamp, date, totalQuestions, correctCount, incorrectCount, percentage, direction, languagePair }
};

/* ==========================================================================
   DOM Elements Cache
   ========================================================================== */

const elements = {
    // Navigation & Tabs
    tabTranslator: document.getElementById("tab-translator"),
    tabNotebook: document.getElementById("tab-notebook"),
    tabPractice: document.getElementById("tab-practice"),
    tabProgress: document.getElementById("tab-progress"),
    panelTranslator: document.getElementById("panel-translator"),
    panelNotebook: document.getElementById("panel-notebook"),
    panelPractice: document.getElementById("panel-practice"),
    panelProgress: document.getElementById("panel-progress"),
    notebookCountBadge: document.getElementById("notebook-count-badge"),

    // Translator Panel
    fromText: document.querySelector(".from-text"),
    toText: document.querySelector(".to-text"),
    selectFrom: document.getElementById("from-select") || document.querySelectorAll("select")[0],
    selectTo: document.getElementById("to-select") || document.querySelectorAll("select")[1],
    exchangeBtn: document.getElementById("exchange-btn") || document.querySelector(".exchange-btn"),
    translateBtn: document.getElementById("translate-btn") || document.querySelector(".translate-btn"),
    statusArea: document.getElementById("status-area"),
    fromVolumeBtn: document.getElementById("from-volume-btn"),
    fromCopyBtn: document.getElementById("from-copy-btn"),
    toVolumeBtn: document.getElementById("to-volume-btn"),
    toCopyBtn: document.getElementById("to-copy-btn"),
    saveTranslationBtn: document.getElementById("save-translation-btn"),
    translatorPrivacyNotice: document.getElementById("translator-privacy-notice"),

    // Notebook Panel
    notebookSearchInput: document.getElementById("notebook-search-input"),
    notebookSearchClearBtn: document.getElementById("notebook-search-clear-btn"),
    notebookLangFilter: document.getElementById("notebook-lang-filter"),
    notebookFavFilterBtn: document.getElementById("notebook-fav-filter-btn"),
    notebookClearAllBtn: document.getElementById("notebook-clear-all-btn"),
    notebookResultsCount: document.getElementById("notebook-results-count"),
    notebookResetFiltersBtn: document.getElementById("notebook-reset-filters-btn"),
    notebookEntriesList: document.getElementById("notebook-entries-list"),
    notebookEmptyState: document.getElementById("notebook-empty-state"),
    emptyStartTranslatingBtn: document.getElementById("empty-start-translating-btn"),

    // Practice / Flashcards Panel
    practiceModeFlashcardsBtn: document.getElementById("practice-mode-flashcards-btn"),
    practiceModeQuizBtn: document.getElementById("practice-mode-quiz-btn"),
    practiceFlashcardsContainer: document.getElementById("practice-flashcards-container"),
    practiceQuizContainer: document.getElementById("practice-quiz-container"),

    practiceCardCounter: document.getElementById("practice-card-counter"),
    practiceKnownCount: document.getElementById("practice-known-count"),
    practiceLearningCount: document.getElementById("practice-learning-count"),
    practiceRestartBtn: document.getElementById("practice-restart-btn"),
    practiceCardContainer: document.getElementById("practice-card-container"),
    flashcard: document.getElementById("flashcard"),
    flashcardFront: document.getElementById("flashcard-front"),
    flashcardBack: document.getElementById("flashcard-back"),
    flashcardFrontLang: document.getElementById("flashcard-front-lang"),
    flashcardBackLang: document.getElementById("flashcard-back-lang"),
    flashcardFrontText: document.getElementById("flashcard-front-text"),
    flashcardBackText: document.getElementById("flashcard-back-text"),
    flashcardFrontSpeakBtn: document.getElementById("flashcard-front-speak-btn"),
    flashcardBackSpeakBtn: document.getElementById("flashcard-back-speak-btn"),
    flashcardStatusTag: document.getElementById("flashcard-status-tag"),
    flashcardFlipBtn: document.getElementById("flashcard-flip-btn"),
    flashcardFlipBtnText: document.getElementById("flashcard-flip-btn-text"),
    practiceNeedWorkBtn: document.getElementById("practice-need-work-btn"),
    practiceKnewItBtn: document.getElementById("practice-knew-it-btn"),
    practicePrevBtn: document.getElementById("practice-prev-btn"),
    practiceNextBtn: document.getElementById("practice-next-btn"),
    practiceEmptyState: document.getElementById("practice-empty-state"),
    practiceEmptyTranslateBtn: document.getElementById("practice-empty-translate-btn"),
    practiceEmptyNotebookBtn: document.getElementById("practice-empty-notebook-btn"),

    // Quiz Panel Elements
    quizSetupView: document.getElementById("quiz-setup-view"),
    quizDirForwardBtn: document.getElementById("quiz-dir-forward-btn"),
    quizDirReverseBtn: document.getElementById("quiz-dir-reverse-btn"),
    quizLangPairItem: document.getElementById("quiz-lang-pair-item"),
    quizLangPairSelect: document.getElementById("quiz-lang-pair-select"),
    quizCountSelect: document.getElementById("quiz-count-select"),
    quizShuffleCheck: document.getElementById("quiz-shuffle-check"),
    quizSmallPoolNotice: document.getElementById("quiz-small-pool-notice"),
    quizSmallPoolText: document.getElementById("quiz-small-pool-text"),
    quizEligibilityWarning: document.getElementById("quiz-eligibility-warning"),
    quizWarningText: document.getElementById("quiz-warning-text"),
    quizWarningFlashcardsBtn: document.getElementById("quiz-warning-flashcards-btn"),
    quizWarningTranslateBtn: document.getElementById("quiz-warning-translate-btn"),
    quizStartBtn: document.getElementById("quiz-start-btn"),

    quizActiveView: document.getElementById("quiz-active-view"),
    quizQuestionCounter: document.getElementById("quiz-question-counter"),
    quizProgressBar: document.getElementById("quiz-progress-bar"),
    quizQuitBtn: document.getElementById("quiz-quit-btn"),
    quizPromptBadge: document.getElementById("quiz-prompt-badge"),
    quizPromptSpeakBtn: document.getElementById("quiz-prompt-speak-btn"),
    quizPromptText: document.getElementById("quiz-prompt-text"),
    quizOptionsGrid: document.getElementById("quiz-options-grid"),
    quizFeedbackBanner: document.getElementById("quiz-feedback-banner"),
    quizNextBtn: document.getElementById("quiz-next-btn"),
    quizNextBtnText: document.getElementById("quiz-next-btn-text"),

    quizResultsView: document.getElementById("quiz-results-view"),
    quizResultsPercent: document.getElementById("quiz-results-percent"),
    quizResultsMessage: document.getElementById("quiz-results-message"),
    quizResultsTotal: document.getElementById("quiz-results-total"),
    quizResultsCorrect: document.getElementById("quiz-results-correct"),
    quizResultsIncorrect: document.getElementById("quiz-results-incorrect"),
    quizReviewSection: document.getElementById("quiz-review-section"),
    quizReviewToggleBtn: document.getElementById("quiz-review-toggle-btn"),
    quizReviewToggleText: document.getElementById("quiz-review-toggle-text"),
    quizReviewList: document.getElementById("quiz-review-list"),
    quizRetakeBtn: document.getElementById("quiz-retake-btn"),
    quizSettingsBtn: document.getElementById("quiz-settings-btn"),
    quizBackFlashcardsBtn: document.getElementById("quiz-back-flashcards-btn"),

    // Learning Progress Dashboard Elements
    progressTotalVocab: document.getElementById("progress-total-vocab"),
    progressTotalFavs: document.getElementById("progress-total-favs"),
    progressFlashcardsReviewed: document.getElementById("progress-flashcards-reviewed"),
    progressQuizAttempts: document.getElementById("progress-quiz-attempts"),
    progressQuizAccuracy: document.getElementById("progress-quiz-accuracy"),
    progressQuizCorrect: document.getElementById("progress-quiz-correct"),
    progressQuizIncorrect: document.getElementById("progress-quiz-incorrect"),
    progressResetHistoryBtn: document.getElementById("progress-reset-history-btn"),
    progressDailyEmptyState: document.getElementById("progress-daily-empty-state"),
    progressDailyContainer: document.getElementById("progress-daily-container"),
    progressDailyList: document.getElementById("progress-daily-list"),
    progressEmptyState: document.getElementById("progress-empty-state"),
    progressEmptyQuizBtn: document.getElementById("progress-empty-quiz-btn"),
    progressEmptyFlashcardsBtn: document.getElementById("progress-empty-flashcards-btn"),
    progressHistoryContainer: document.getElementById("progress-history-container"),
    progressHistoryList: document.getElementById("progress-history-list"),

    // Confirmation Modals
    confirmModal: document.getElementById("vocab-confirm-modal"),
    modalCancelBtn: document.getElementById("modal-cancel-btn"),
    modalConfirmBtn: document.getElementById("modal-confirm-btn"),
    progressResetModal: document.getElementById("progress-reset-confirm-modal"),
    resetModalCancelBtn: document.getElementById("reset-modal-cancel-btn"),
    resetModalConfirmBtn: document.getElementById("reset-modal-confirm-btn")
};


/* ==========================================================================
   Status & Accessibility Helpers
   ========================================================================== */

/**
 * Display a user-facing status message in the accessible live region
 * @param {string} message - Message text
 * @param {"info" | "success" | "error" | "loading"} [type="info"] - Status category
 * @param {number} [autoDismissMs=0] - Milliseconds before clearing message (0 = persistent)
 */
function showStatus(message, type = "info", autoDismissMs = 0) {
    if (state.statusTimeoutId) {
        clearTimeout(state.statusTimeoutId);
        state.statusTimeoutId = null;
    }

    if (!elements.statusArea) return;

    elements.statusArea.textContent = message;
    elements.statusArea.className = `status-message visible ${type}`;

    if (autoDismissMs > 0) {
        state.statusTimeoutId = setTimeout(() => {
            clearStatus();
        }, autoDismissMs);
    }
}

/**
 * Clear the status message area
 */
function clearStatus() {
    if (state.statusTimeoutId) {
        clearTimeout(state.statusTimeoutId);
        state.statusTimeoutId = null;
    }
    if (!elements.statusArea) return;
    elements.statusArea.textContent = "";
    elements.statusArea.className = "status-message";
}

/**
 * Update UI loading state for translate button
 * @param {boolean} isLoading
 */
function setLoadingState(isLoading) {
    state.isTranslating = isLoading;

    if (!elements.translateBtn) return;

    elements.translateBtn.disabled = isLoading;

    if (isLoading) {
        elements.translateBtn.innerHTML = `
            <span class="btn-text">Translating...</span>
            <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
        `;
    } else {
        elements.translateBtn.innerHTML = `
            <span class="btn-text">Translate Text</span>
            <i class="fas fa-arrow-right" aria-hidden="true"></i>
        `;
    }

    updateSaveButtonState();
}

/* ==========================================================================
   Language Dropdown Initialization
   ========================================================================== */

/**
 * Populate a select dropdown with language options using safe DOM APIs
 * @param {HTMLSelectElement} selectElement
 * @param {string} defaultCode
 */
function populateLanguageOptions(selectElement, defaultCode) {
    if (!selectElement) return;

    selectElement.innerHTML = "";

    if (typeof countries !== "object" || countries === null) {
        console.error("The countries catalog was not found. Please ensure countries.js is loaded.");
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const code of Object.keys(countries)) {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = countries[code];

        if (code === defaultCode) {
            option.selected = true;
        }

        fragment.appendChild(option);
    }

    selectElement.appendChild(fragment);

    if (countries[defaultCode]) {
        selectElement.value = defaultCode;
    }
}

/* ==========================================================================
   Translation Pipeline & Error Handling
   ========================================================================== */

/**
 * Execute a provider translation with a dedicated timeout and abort synchronization
 * @param {Function} providerFn - Async function (signal: AbortSignal) => Promise<string>
 * @param {AbortSignal} [parentSignal] - Parent signal tracking user cancellation
 * @param {number} [timeoutMs=TRANSLATION_TIMEOUT_MS] - Timeout duration in milliseconds
 * @returns {Promise<string>}
 */
async function callProviderWithTimeout(providerFn, parentSignal, timeoutMs = TRANSLATION_TIMEOUT_MS) {
    if (parentSignal && parentSignal.aborted) {
        const cancelErr = new Error("USER_CANCELLED");
        cancelErr.name = "AbortError";
        throw cancelErr;
    }

    const providerController = new AbortController();
    let isTimedOut = false;
    let timerId = null;

    const onParentAbort = () => {
        providerController.abort();
    };

    if (parentSignal) {
        parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }

    timerId = setTimeout(() => {
        isTimedOut = true;
        providerController.abort();
    }, timeoutMs);

    try {
        const result = await providerFn(providerController.signal);
        return result;
    } catch (err) {
        if (parentSignal && parentSignal.aborted) {
            const cancelErr = new Error("USER_CANCELLED");
            cancelErr.name = "AbortError";
            throw cancelErr;
        }

        if (isTimedOut) {
            const timeoutErr = new Error("TIMEOUT");
            timeoutErr.name = "TimeoutError";
            timeoutErr.timeoutMs = timeoutMs;
            throw timeoutErr;
        }

        throw err;
    } finally {
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
        if (parentSignal) {
            parentSignal.removeEventListener("abort", onParentAbort);
        }
    }
}

/**
 * Execute translation with primary provider and fallback provider
 * @param {string} text
 * @param {string} fromLang
 * @param {string} toLang
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function requestTranslation(text, fromLang, toLang, signal) {
    let primaryError = null;

    // 1. Attempt Primary Provider (Google GTX) with timeout
    try {
        return await callProviderWithTimeout(
            (providerSignal) => translationProviders.google.translate(text, fromLang, toLang, providerSignal),
            signal,
            TRANSLATION_TIMEOUT_MS
        );
    } catch (err) {
        if (signal?.aborted || err.message === "USER_CANCELLED" || (err.name === "AbortError" && !err.timeoutMs)) {
            throw err;
        }
        primaryError = err;
        if (err.message === "TIMEOUT") {
            console.warn(`[Translator] Primary provider timed out after ${TRANSLATION_TIMEOUT_MS}ms. Attempting fallback provider...`);
        } else {
            console.warn(`[Translator] Primary provider failed (${err.message}). Attempting fallback provider...`);
        }
    }

    // Check if user cancelled while primary provider was failing or timing out
    if (signal?.aborted) {
        const cancelErr = new Error("USER_CANCELLED");
        cancelErr.name = "AbortError";
        throw cancelErr;
    }

    // 2. Attempt Fallback Provider (MyMemory) with timeout
    try {
        return await callProviderWithTimeout(
            (providerSignal) => translationProviders.myMemory.translate(text, fromLang, toLang, providerSignal),
            signal,
            TRANSLATION_TIMEOUT_MS
        );
    } catch (fallbackErr) {
        if (signal?.aborted || fallbackErr.message === "USER_CANCELLED" || (fallbackErr.name === "AbortError" && !fallbackErr.timeoutMs)) {
            throw fallbackErr;
        }
        console.warn(`[Translator] Fallback provider failed (${fallbackErr.message}).`);

        if (primaryError?.message === "TIMEOUT" && fallbackErr.message === "TIMEOUT") {
            const err = new Error("TRANSLATION_TIMEOUT");
            err.primary = primaryError;
            err.fallback = fallbackErr;
            throw err;
        }

        if (primaryError?.message === "UNSUPPORTED_LANGUAGE" || fallbackErr.message === "UNSUPPORTED_LANGUAGE") {
            const err = new Error("UNSUPPORTED_LANGUAGE");
            err.primary = primaryError;
            err.fallback = fallbackErr;
            throw err;
        }

        if (primaryError?.message === "RATE_LIMITED" || fallbackErr.message === "RATE_LIMITED") {
            const err = new Error("RATE_LIMITED");
            err.primary = primaryError;
            err.fallback = fallbackErr;
            throw err;
        }

        if (primaryError?.message === "TIMEOUT") {
            const err = new Error("FALLBACK_FAILED_AFTER_TIMEOUT");
            err.primary = primaryError;
            err.fallback = fallbackErr;
            throw err;
        }

        const combinedError = new Error("ALL_PROVIDERS_FAILED");
        combinedError.primary = primaryError;
        combinedError.fallback = fallbackErr;
        throw combinedError;
    }
}

/**
 * Handle translation errors with user-friendly actionable feedback
 * @param {Error} error
 * @param {string} fromCode
 * @param {string} toCode
 */
function handleTranslationError(error, fromCode, toCode) {
    const fromName = countries?.[fromCode] || fromCode;
    const toName = countries?.[toCode] || toCode;

    const isOffline = (typeof navigator !== "undefined" && navigator.onLine === false) ||
        error.message === "NETWORK_ERROR" ||
        (error.primary instanceof TypeError || error.fallback instanceof TypeError) ||
        error instanceof TypeError;

    if (error.message === "TRANSLATION_TIMEOUT" || error.message === "FALLBACK_FAILED_AFTER_TIMEOUT" || error.message === "TIMEOUT") {
        showStatus("Translation request timed out. The translation service took too long to respond. Please try again.", "error");
        if (elements.toText) elements.toText.placeholder = "Translation timed out";
    } else if (error.message === "UNSUPPORTED_LANGUAGE") {
        showStatus(`The language pair (${fromName} → ${toName}) is not supported by available translation providers.`, "error");
        if (elements.toText) elements.toText.placeholder = "Language pair unsupported";
    } else if (error.message === "RATE_LIMITED") {
        showStatus("Translation service rate limit reached. Please wait a few moments and try again.", "error");
        if (elements.toText) elements.toText.placeholder = "Rate limit reached. Please wait.";
    } else if (isOffline) {
        showStatus("Network connection error. Please verify your internet connection.", "error");
        if (elements.toText) elements.toText.placeholder = "Network offline";
    } else {
        showStatus("Translation service is currently unreachable. Please check your connection or try again later.", "error");
        if (elements.toText) elements.toText.placeholder = "Translation unavailable";
    }

    updateSaveButtonState();
}

/**
 * Main translation controller with race-condition prevention & state synchronization
 */
async function translateText() {
    if (!elements.fromText || !elements.toText || !elements.selectFrom || !elements.selectTo) {
        return;
    }

    if (state.isTranslating) {
        return;
    }

    const text = elements.fromText.value.trim();
    const fromCode = elements.selectFrom.value;
    const toCode = elements.selectTo.value;

    if (!text) {
        elements.toText.value = "";
        elements.toText.placeholder = "Translation will appear here...";
        showStatus("Please enter text to translate.", "info", 4000);
        elements.fromText.focus();
        updateSaveButtonState();
        return;
    }

    if (fromCode === toCode) {
        cancelActiveRequest();
        elements.toText.value = text;
        state.lastTranslatedSourceText = text;
        state.lastTranslatedFromCode = fromCode;
        state.lastTranslatedToCode = toCode;
        showStatus("Source and target languages are identical; no translation needed.", "info", 4000);
        updateSaveButtonState();
        return;
    }

    // Prevent redundant translation requests if identical translation is already active & displayed
    if (
        text === state.lastTranslatedSourceText &&
        fromCode === state.lastTranslatedFromCode &&
        toCode === state.lastTranslatedToCode &&
        elements.toText.value.trim() &&
        elements.toText.value.trim() !== "Translating..."
    ) {
        showStatus("Text is already translated to the selected language.", "info", 3000);
        updateSaveButtonState();
        return;
    }

    cancelActiveRequest();

    const requestId = ++state.activeRequestId;
    state.currentAbortController = new AbortController();
    const { signal } = state.currentAbortController;

    setLoadingState(true);
    elements.toText.value = "";
    elements.toText.placeholder = "Translating...";

    const fromName = countries?.[fromCode] || fromCode;
    const toName = countries?.[toCode] || toCode;
    showStatus(`Translating from ${fromName} to ${toName}...`, "loading");

    let hasError = false;

    try {
        const translatedResult = await requestTranslation(text, fromCode, toCode, signal);

        if (signal.aborted || requestId !== state.activeRequestId) {
            return;
        }

        elements.toText.value = translatedResult;
        state.lastTranslatedSourceText = text;
        state.lastTranslatedFromCode = fromCode;
        state.lastTranslatedToCode = toCode;
        showStatus("Translation completed successfully.", "success", 4000);
    } catch (err) {
        if (signal.aborted || err.name === "AbortError" || err.message === "USER_CANCELLED" || requestId !== state.activeRequestId) {
            return;
        }

        hasError = true;
        handleTranslationError(err, fromCode, toCode);
    } finally {
        if (requestId === state.activeRequestId) {
            setLoadingState(false);
            if (!elements.toText.value && !hasError) {
                elements.toText.placeholder = "Translation will appear here...";
            }
            updateSaveButtonState();
        }
    }
}

/**
 * Abort active translation request and restore button state
 */
function cancelActiveRequest() {
    state.activeRequestId++;
    if (state.currentAbortController) {
        state.currentAbortController.abort();
        state.currentAbortController = null;
    }
    setLoadingState(false);
}

/* ==========================================================================
   User Action Handlers (Swap, Copy, Speech)
   ========================================================================== */

/**
 * Swap source and target languages and text values
 */
function swapLanguages() {
    if (!elements.selectFrom || !elements.selectTo || !elements.fromText || !elements.toText) {
        return;
    }

    const wasTranslating = state.isTranslating;
    cancelActiveRequest();
    clearStatus();

    // 1. Swap language selector values
    const tempLang = elements.selectFrom.value;
    elements.selectFrom.value = elements.selectTo.value;
    elements.selectTo.value = tempLang;

    // 2. Handle text values safely:
    // If a valid translation had been completed, place the translated text into fromText
    // so the user can easily translate it back in the reverse direction.
    // Otherwise, retain user's typed fromText intact (do not wipe it with empty toText).
    const hadValidTranslation = hasValidTranslation();
    const currentFrom = elements.fromText.value;
    const currentTo = elements.toText.value;

    if (hadValidTranslation && currentTo.trim()) {
        elements.fromText.value = currentTo;
    } else if (!wasTranslating && currentTo.trim() && !currentFrom.trim()) {
        elements.fromText.value = currentTo;
    }

    // Always clear target text to await a new translation request in the new direction
    elements.toText.value = "";
    elements.toText.placeholder = elements.fromText.value.trim()
        ? "Press Translate to update translation..."
        : "Translation will appear here...";

    // 3. Invalidate translation state so unverified reverse translations cannot be saved
    state.lastTranslatedSourceText = "";
    state.lastTranslatedFromCode = "";
    state.lastTranslatedToCode = "";

    if (elements.exchangeBtn) {
        elements.exchangeBtn.classList.add("rotated");
        setTimeout(() => elements.exchangeBtn.classList.remove("rotated"), 350);
    }

    const fromName = countries?.[elements.selectFrom.value] || elements.selectFrom.value;
    const toName = countries?.[elements.selectTo.value] || elements.selectTo.value;
    showStatus(`Swapped languages: now translating from ${fromName} to ${toName}.`, "info", 3500);

    updateSaveButtonState();
}


/**
 * Reusable clipboard copy function supporting modern and legacy APIs
 * @param {string} text
 * @param {string} label
 * @param {HTMLElement} [buttonElement]
 * @returns {Promise<boolean>}
 */
async function copyToClipboard(text, label, buttonElement) {
    if (!text || !text.trim()) {
        showStatus(`No ${label.toLowerCase()} available to copy.`, "info", 3500);
        return false;
    }

    let copied = false;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function" && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch (err) {
            console.warn("Clipboard API failed; attempting fallback:", err);
        }
    }

    if (!copied) {
        try {
            const tempArea = document.createElement("textarea");
            tempArea.value = text;
            tempArea.setAttribute("readonly", "");
            tempArea.style.position = "fixed";
            tempArea.style.left = "-9999px";
            tempArea.style.top = "0";
            document.body.appendChild(tempArea);
            tempArea.focus();
            tempArea.select();
            copied = document.execCommand("copy");
            document.body.removeChild(tempArea);
        } catch (err) {
            console.error("Copy fallback command failed:", err);
            copied = false;
        }
    }

    if (copied) {
        if (buttonElement) {
            showCopyFeedback(buttonElement, label);
        }
        showStatus(`${label} copied to clipboard.`, "success", 3000);
        return true;
    } else {
        showStatus(`Failed to copy ${label.toLowerCase()}. Please select and copy manually.`, "error", 4000);
        return false;
    }
}

/**
 * Copy text from Translator textareas
 * @param {boolean} isFrom - true for source text, false for translated text
 * @param {HTMLElement} buttonElement
 */
function copyText(isFrom, buttonElement) {
    const textarea = isFrom ? elements.fromText : elements.toText;
    const rawText = textarea ? textarea.value : "";
    const label = isFrom ? "Source text" : "Translated text";
    return copyToClipboard(rawText, label, buttonElement);
}

/**
 * Display temporary visual success checkmark on the copy button
 * @param {HTMLElement} buttonElement
 * @param {string} label
 */
function showCopyFeedback(buttonElement, label) {
    if (!buttonElement) return;

    const icon = buttonElement.querySelector("i");
    if (!icon) return;

    if (buttonElement._copyTimeout) {
        clearTimeout(buttonElement._copyTimeout);
    } else {
        buttonElement._originalClass = icon.className;
        buttonElement._originalTitle = buttonElement.title;
        buttonElement._originalAriaLabel = buttonElement.getAttribute("aria-label");
    }

    icon.className = "fas fa-check";
    buttonElement.classList.add("copy-success");
    buttonElement.title = "Copied!";
    buttonElement.setAttribute("aria-label", `${label} copied to clipboard`);

    buttonElement._copyTimeout = setTimeout(() => {
        icon.className = buttonElement._originalClass || "fas fa-copy";
        buttonElement.classList.remove("copy-success");
        buttonElement.title = buttonElement._originalTitle || "";
        if (buttonElement._originalAriaLabel) {
            buttonElement.setAttribute("aria-label", buttonElement._originalAriaLabel);
        }
        delete buttonElement._copyTimeout;
        delete buttonElement._originalClass;
        delete buttonElement._originalTitle;
        delete buttonElement._originalAriaLabel;
    }, 1500);
}

/**
 * Pronounce any text using the Web Speech API
 * @param {string} text
 * @param {string} langCode
 * @param {string} label
 * @param {HTMLElement} [buttonElement]
 */
function pronounceText(text, langCode, label, buttonElement) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
        showStatus("Text-to-speech pronunciation is not supported in this browser.", "error", 4000);
        return;
    }

    const cleanText = (text || "").trim();
    if (!cleanText) {
        showStatus(`No ${label} available to pronounce.`, "info", 3500);
        return;
    }

    try {
        window.speechSynthesis.cancel();

        document.querySelectorAll(".icon-btn.speaking-active, .card-icon-btn.speaking-active").forEach(btn => {
            btn.classList.remove("speaking-active");
        });

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = langCode || "en-US";
        state.activeUtterance = utterance;

        if (buttonElement) {
            buttonElement.classList.add("speaking-active");
        }

        showStatus(`Pronouncing ${label}...`, "info");

        const cleanup = () => {
            if (buttonElement) {
                buttonElement.classList.remove("speaking-active");
            }
            if (state.activeUtterance === utterance) {
                state.activeUtterance = null;
            }
        };

        utterance.onend = () => {
            cleanup();
            clearStatus();
        };

        utterance.onerror = (event) => {
            cleanup();
            if (event.error !== "canceled" && event.error !== "interrupted") {
                console.warn("SpeechSynthesis error:", event);
                showStatus(`Pronunciation failed for ${label} (${event.error || "playback error"}).`, "error", 4000);
            }
        };

        window.speechSynthesis.speak(utterance);
    } catch (err) {
        if (buttonElement) {
            buttonElement.classList.remove("speaking-active");
        }
        console.error("SpeechSynthesis invocation failed:", err);
        showStatus("Unable to start audio pronunciation.", "error", 4000);
    }
}

/**
 * Pronounce text from Translator textareas
 * @param {boolean} isFrom - true for source text, false for translated text
 * @param {HTMLElement} buttonElement
 */
function speakText(isFrom, buttonElement) {
    const textarea = isFrom ? elements.fromText : elements.toText;
    const select = isFrom ? elements.selectFrom : elements.selectTo;
    const text = textarea ? textarea.value.trim() : "";
    const langCode = select ? select.value : "en-US";
    const label = isFrom ? "source text" : "translated text";
    pronounceText(text, langCode, label, buttonElement);
}

/* ==========================================================================
   Vocabulary Notebook Logic
   ========================================================================== */

/**
 * Generate a unique ID for a vocabulary entry
 * @returns {string}
 */
function generateUniqueId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `vocab_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Format timestamp into localized human-readable string
 * @param {number} timestamp
 * @returns {string}
 */
function formatTimestamp(timestamp) {
    try {
        const date = new Date(timestamp);
        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    } catch {
        return new Date(timestamp).toLocaleDateString();
    }
}

/**
 * Check if an identical translation already exists in entries
 * @param {Array<Object>} entries
 * @param {string} sourceText
 * @param {string} translatedText
 * @param {string} fromCode
 * @param {string} toCode
 * @returns {Object | null}
 */
function findDuplicateEntry(entries, sourceText, translatedText, fromCode, toCode) {
    if (!Array.isArray(entries)) return null;
    const normSrc = (sourceText || "").trim().toLowerCase();
    const normTrans = (translatedText || "").trim().toLowerCase();

    return entries.find(e =>
        e &&
        e.fromCode === fromCode &&
        e.toCode === toCode &&
        (typeof e.sourceText === "string" ? e.sourceText : "").trim().toLowerCase() === normSrc &&
        (typeof e.translatedText === "string" ? e.translatedText : "").trim().toLowerCase() === normTrans
    ) || null;
}

/**
 * Check whether a valid translation matching current inputs is available in the Translator
 * @returns {boolean}
 */
function hasValidTranslation() {
    if (state.isTranslating) return false;
    if (!elements.fromText || !elements.toText || !elements.selectFrom || !elements.selectTo) return false;

    const currentSource = elements.fromText.value.trim();
    const currentTarget = elements.toText.value.trim();
    const currentFrom = elements.selectFrom.value;
    const currentTo = elements.selectTo.value;

    if (!currentSource || !currentTarget || currentTarget === "Translating...") {
        return false;
    }

    // Must match the exact source text and language pair of the last completed translation
    return (
        currentSource === state.lastTranslatedSourceText &&
        currentFrom === state.lastTranslatedFromCode &&
        currentTo === state.lastTranslatedToCode
    );
}

/**
 * Update the state and visual appearance of the Save Translation bookmark button
 */
function updateSaveButtonState() {
    if (!elements.saveTranslationBtn) return;

    const valid = hasValidTranslation();
    elements.saveTranslationBtn.disabled = !valid;

    const icon = elements.saveTranslationBtn.querySelector("i");
    if (!icon) return;

    if (!valid) {
        icon.className = "far fa-bookmark";
        elements.saveTranslationBtn.classList.remove("saved-active");
        elements.saveTranslationBtn.title = "Save translation to Vocabulary Notebook";
        elements.saveTranslationBtn.setAttribute("aria-label", "Save translation to Vocabulary Notebook");
        return;
    }

    const sourceText = elements.fromText.value.trim();
    const translatedText = elements.toText.value.trim();
    const fromCode = elements.selectFrom?.value;
    const toCode = elements.selectTo?.value;

    const isDuplicate = findDuplicateEntry(notebookState.entries, sourceText, translatedText, fromCode, toCode);

    if (isDuplicate) {
        icon.className = "fas fa-bookmark";
        elements.saveTranslationBtn.classList.add("saved-active");
        elements.saveTranslationBtn.title = "Saved in Vocabulary Notebook (click to review duplicate feedback)";
        elements.saveTranslationBtn.setAttribute("aria-label", "Translation already saved in Vocabulary Notebook");
    } else {
        icon.className = "far fa-bookmark";
        elements.saveTranslationBtn.classList.remove("saved-active");
        elements.saveTranslationBtn.title = "Save translation to Vocabulary Notebook";
        elements.saveTranslationBtn.setAttribute("aria-label", "Save translation to Vocabulary Notebook");
    }
}

/**
 * Save current translation to the Vocabulary Notebook with safe storage adapter
 */
function saveCurrentTranslation() {
    if (!hasValidTranslation()) {
        showStatus("Please translate text before saving to the notebook.", "info", 3500);
        return;
    }

    const sourceText = elements.fromText.value.trim();
    const translatedText = elements.toText.value.trim();
    const fromCode = elements.selectFrom.value;
    const toCode = elements.selectTo.value;
    const fromName = countries?.[fromCode] || fromCode;
    const toName = countries?.[toCode] || toCode;

    // Duplicate detection
    const existing = findDuplicateEntry(notebookState.entries, sourceText, translatedText, fromCode, toCode);
    if (existing) {
        showStatus(`This translation is already in your Vocabulary Notebook (saved ${formatTimestamp(existing.createdAt)}).`, "info", 4500);
        updateSaveButtonState();
        return;
    }

    const newEntry = {
        id: generateUniqueId(),
        sourceText,
        translatedText,
        fromCode,
        fromName,
        toCode,
        toName,
        createdAt: Date.now(),
        isFavorite: false
    };

    const candidateEntries = [newEntry, ...notebookState.entries];
    const saveResult = StorageAdapter.save(candidateEntries);

    if (saveResult.success) {
        notebookState.entries = candidateEntries;

        // Visual animation on bookmark button
        if (elements.saveTranslationBtn) {
            elements.saveTranslationBtn.classList.add("save-success");
            const icon = elements.saveTranslationBtn.querySelector("i");
            if (icon) icon.className = "fas fa-bookmark";

            setTimeout(() => {
                if (elements.saveTranslationBtn) {
                    elements.saveTranslationBtn.classList.remove("save-success");
                }
            }, 600);
        }

        updateNotebookBadge();
        updateNotebookLanguageFilterOptions();
        renderNotebookView();
        syncPracticeState();
        if (notebookState.activeTab === "practice") {
            renderPracticeView();
        }
        updateSaveButtonState();
        if (typeof updateProgressDashboard === "function") {
            updateProgressDashboard();
        }
        if (typeof renderProgressView === "function") {
            renderProgressView();
        }

        const preview = sourceText.length > 25 ? `${sourceText.slice(0, 25)}...` : sourceText;

        if (!saveResult.persistedToDisk) {
            if (saveResult.isProtected) {
                showStatus(`Saved "${preview}" for this session only (storage is in protected recovery mode).`, "info", 6500);
            } else {
                showStatus(`Saved "${preview}" for this session only. (Local storage unavailable; entries will not survive page refresh.)`, "info", 6500);
            }
        } else {
            showStatus(`Saved "${preview}" to Vocabulary Notebook!`, "success", 3500);
        }
    } else {
        if (saveResult.error === "QUOTA_EXCEEDED") {
            showStatus("Local storage quota exceeded. Could not save translation. Please delete older entries to free up space.", "error", 6000);
        } else {
            showStatus("Unable to save translation due to browser storage restrictions.", "error", 5000);
        }
    }
}

/**
 * Delete a single vocabulary entry by ID
 * @param {string} id
 */
function deleteEntry(id) {
    const candidateEntries = notebookState.entries.filter(e => e.id !== id);
    const removed = notebookState.entries.find(e => e.id === id);
    if (!removed) return;

    const saveResult = StorageAdapter.save(candidateEntries);
    if (saveResult.success) {
        notebookState.entries = candidateEntries;
        updateNotebookBadge();
        updateNotebookLanguageFilterOptions();
        renderNotebookView();
        syncPracticeState();
        if (notebookState.activeTab === "practice") {
            renderPracticeView();
        }
        updateSaveButtonState();
        if (typeof updateProgressDashboard === "function") {
            updateProgressDashboard();
        }
        if (typeof renderProgressView === "function") {
            renderProgressView();
        }

        const preview = removed.sourceText.length > 25 ? `${removed.sourceText.slice(0, 25)}...` : removed.sourceText;
        if (!saveResult.persistedToDisk) {
            if (saveResult.isProtected) {
                showStatus(`Removed "${preview}" for this session only (storage is in protected recovery mode).`, "info", 4500);
            } else {
                showStatus(`Removed "${preview}" for this session only (entries will not survive page refresh).`, "info", 4500);
            }
        } else {
            showStatus(`Removed "${preview}" from your notebook.`, "info", 3000);
        }
    } else {
        showStatus("Failed to delete entry: storage operation failed.", "error", 4000);
    }
}

/**
 * Toggle favorite status of a vocabulary entry
 * @param {string} id
 * @param {HTMLButtonElement} buttonElement
 */
function toggleFavorite(id, buttonElement) {
    const entry = notebookState.entries.find(e => e.id === id);
    if (!entry) return;

    const newFavoriteState = !entry.isFavorite;
    const candidateEntries = notebookState.entries.map(e => e.id === id ? { ...e, isFavorite: newFavoriteState } : e);

    const saveResult = StorageAdapter.save(candidateEntries);
    if (saveResult.success) {
        notebookState.entries = candidateEntries;
        const updatedEntry = notebookState.entries.find(e => e.id === id);

        if (buttonElement) {
            const icon = buttonElement.querySelector("i");
            if (updatedEntry.isFavorite) {
                buttonElement.classList.add("active");
                buttonElement.title = "Remove from favorites";
                buttonElement.setAttribute("aria-label", "Remove from favorites");
                buttonElement.setAttribute("aria-pressed", "true");
                if (icon) icon.className = "fas fa-star";
            } else {
                buttonElement.classList.remove("active");
                buttonElement.title = "Mark as favorite";
                buttonElement.setAttribute("aria-label", "Mark as favorite");
                buttonElement.setAttribute("aria-pressed", "false");
                if (icon) icon.className = "far fa-star";
            }
        }

        if (notebookState.favoritesOnly) {
            renderNotebookView();
        }

        if (typeof updateProgressDashboard === "function") {
            updateProgressDashboard();
        }
        if (typeof renderProgressView === "function") {
            renderProgressView();
        }

        const preview = entry.sourceText.length > 20 ? `${entry.sourceText.slice(0, 20)}...` : entry.sourceText;
        const favNotice = newFavoriteState ? `Marked "${preview}" as favorite.` : `Removed "${preview}" from favorites.`;

        if (!saveResult.persistedToDisk) {
            if (saveResult.isProtected) {
                showStatus(`${favNotice} (Session only; storage in protected recovery mode).`, "info", 3500);
            } else {
                showStatus(`${favNotice} (Session only; entries will not survive page refresh).`, "info", 3500);
            }
        } else {
            showStatus(favNotice, "info", 2500);
        }
    } else {
        showStatus("Failed to update favorite status: storage operation failed.", "error", 4000);
    }
}

/**
 * Load a saved entry into the Translator interface
 * @param {Object} entry
 */
function useInTranslator(entry) {
    if (!entry) return;

    if (elements.fromText) elements.fromText.value = entry.sourceText;
    if (elements.toText) elements.toText.value = entry.translatedText;

    if (elements.selectFrom && entry.fromCode) {
        const hasOption = Array.from(elements.selectFrom.options).some(opt => opt.value === entry.fromCode);
        if (hasOption) {
            elements.selectFrom.value = entry.fromCode;
        }
    }
    if (elements.selectTo && entry.toCode) {
        const hasOption = Array.from(elements.selectTo.options).some(opt => opt.value === entry.toCode);
        if (hasOption) {
            elements.selectTo.value = entry.toCode;
        }
    }

    state.lastTranslatedSourceText = entry.sourceText.trim();
    state.lastTranslatedFromCode = entry.fromCode;
    state.lastTranslatedToCode = entry.toCode;

    switchTab("translator");
    updateSaveButtonState();

    const preview = entry.sourceText.length > 25 ? `${entry.sourceText.slice(0, 25)}...` : entry.sourceText;
    showStatus(`Loaded "${preview}" into the translator.`, "info", 3500);

    if (elements.fromText) {
        elements.fromText.focus();
    }
}

/**
 * Clear all vocabulary entries after confirmation
 */
function clearAllEntries() {
    if (notebookState.entries.length === 0) return;

    const previousCount = notebookState.entries.length;
    const saveResult = StorageAdapter.save([]);

    if (saveResult.success) {
        notebookState.entries = [];
        updateNotebookBadge();
        updateNotebookLanguageFilterOptions();
        renderNotebookView();
        syncPracticeState();
        if (notebookState.activeTab === "practice") {
            renderPracticeView();
        }
        updateSaveButtonState();
        if (typeof updateProgressDashboard === "function") {
            updateProgressDashboard();
        }
        if (typeof renderProgressView === "function") {
            renderProgressView();
        }

        if (!saveResult.persistedToDisk) {
            if (saveResult.isProtected) {
                showStatus(`Cleared ${previousCount} translations for this session only (storage is in protected recovery mode).`, "info", 5000);
            } else {
                showStatus(`Cleared ${previousCount} translations for this session only (entries will not survive page refresh).`, "info", 5000);
            }
        } else {
            showStatus(`All ${previousCount} saved translations have been cleared.`, "info", 4000);
        }
    } else {
        showStatus("Failed to clear translations: storage operation failed.", "error", 4000);
    }
}


/* ==========================================================================
   Notebook UI Rendering & Filtering
   ========================================================================== */

/**
 * Filter entries according to active search query, language filter, and favorite filter
 * @returns {Array<Object>}
 */
function getFilteredEntries() {
    const query = notebookState.searchQuery.trim().toLowerCase();
    const lang = notebookState.languageFilter;
    const favsOnly = notebookState.favoritesOnly;

    return notebookState.entries.filter(entry => {
        if (favsOnly && !entry.isFavorite) return false;
        if (lang !== "all" && entry.fromCode !== lang && entry.toCode !== lang) return false;

        if (query) {
            const inSource = (entry.sourceText || "").toLowerCase().includes(query);
            const inTrans = (entry.translatedText || "").toLowerCase().includes(query);
            const inFromName = (entry.fromName || "").toLowerCase().includes(query);
            const inToName = (entry.toName || "").toLowerCase().includes(query);
            if (!inSource && !inTrans && !inFromName && !inToName) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Create a safe DOM element card for a single vocabulary entry
 * @param {Object} entry
 * @returns {HTMLElement}
 */
function createNotebookCardElement(entry) {
    const card = document.createElement("article");
    card.className = "vocab-card";
    card.dataset.id = entry.id;

    // Header
    const header = document.createElement("div");
    header.className = "vocab-card-header";

    const langBadge = document.createElement("span");
    langBadge.className = "vocab-card-lang-badge";
    const globeIcon = document.createElement("i");
    globeIcon.className = "fas fa-globe-americas";
    globeIcon.setAttribute("aria-hidden", "true");
    const langLabel = document.createTextNode(` ${entry.fromName} → ${entry.toName}`);
    langBadge.appendChild(globeIcon);
    langBadge.appendChild(langLabel);

    const dateElem = document.createElement("time");
    dateElem.className = "vocab-card-date";
    dateElem.dateTime = new Date(entry.createdAt).toISOString();
    dateElem.textContent = formatTimestamp(entry.createdAt);

    const topActions = document.createElement("div");
    topActions.className = "vocab-card-top-actions";

    // Favorite Button
    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = `card-icon-btn fav-btn ${entry.isFavorite ? "active" : ""}`;
    favBtn.title = entry.isFavorite ? "Remove from favorites" : "Mark as favorite";
    favBtn.setAttribute("aria-label", entry.isFavorite ? "Remove from favorites" : "Mark as favorite");
    favBtn.setAttribute("aria-pressed", entry.isFavorite ? "true" : "false");
    const favIcon = document.createElement("i");
    favIcon.className = entry.isFavorite ? "fas fa-star" : "far fa-star";
    favIcon.setAttribute("aria-hidden", "true");
    favBtn.appendChild(favIcon);
    favBtn.addEventListener("click", () => toggleFavorite(entry.id, favBtn));

    // Delete Button
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "card-icon-btn delete-btn";
    deleteBtn.title = "Delete translation";
    deleteBtn.setAttribute("aria-label", "Delete saved translation");
    const deleteIcon = document.createElement("i");
    deleteIcon.className = "fas fa-trash-alt";
    deleteIcon.setAttribute("aria-hidden", "true");
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener("click", () => deleteEntry(entry.id));

    topActions.appendChild(favBtn);
    topActions.appendChild(deleteBtn);

    header.appendChild(langBadge);
    header.appendChild(dateElem);
    header.appendChild(topActions);

    // Body
    const body = document.createElement("div");
    body.className = "vocab-card-body";

    // Source Column
    const srcCol = document.createElement("div");
    srcCol.className = "vocab-card-col";

    const srcHead = document.createElement("div");
    srcHead.className = "vocab-col-header";
    const srcLabel = document.createElement("span");
    srcLabel.className = "vocab-col-label";
    srcLabel.textContent = `Original (${entry.fromName})`;

    const srcActions = document.createElement("div");
    srcActions.className = "vocab-col-actions";

    const srcSpeakBtn = document.createElement("button");
    srcSpeakBtn.type = "button";
    srcSpeakBtn.className = "card-icon-btn";
    srcSpeakBtn.title = "Listen to original";
    srcSpeakBtn.setAttribute("aria-label", "Listen to original text");
    const srcSpeakIcon = document.createElement("i");
    srcSpeakIcon.className = "fas fa-volume-up";
    srcSpeakIcon.setAttribute("aria-hidden", "true");
    srcSpeakBtn.appendChild(srcSpeakIcon);
    srcSpeakBtn.addEventListener("click", () => pronounceText(entry.sourceText, entry.fromCode, "original text", srcSpeakBtn));

    const srcCopyBtn = document.createElement("button");
    srcCopyBtn.type = "button";
    srcCopyBtn.className = "card-icon-btn";
    srcCopyBtn.title = "Copy original text";
    srcCopyBtn.setAttribute("aria-label", "Copy original text to clipboard");
    const srcCopyIcon = document.createElement("i");
    srcCopyIcon.className = "fas fa-copy";
    srcCopyIcon.setAttribute("aria-hidden", "true");
    srcCopyBtn.appendChild(srcCopyIcon);
    srcCopyBtn.addEventListener("click", () => copyToClipboard(entry.sourceText, "Original text", srcCopyBtn));

    srcActions.appendChild(srcSpeakBtn);
    srcActions.appendChild(srcCopyBtn);
    srcHead.appendChild(srcLabel);
    srcHead.appendChild(srcActions);

    const srcText = document.createElement("p");
    srcText.className = "vocab-col-text";
    srcText.textContent = entry.sourceText;

    srcCol.appendChild(srcHead);
    srcCol.appendChild(srcText);

    // Arrow Divider
    const arrowWrap = document.createElement("div");
    arrowWrap.className = "vocab-card-arrow";
    arrowWrap.setAttribute("aria-hidden", "true");
    const arrowIcon = document.createElement("i");
    arrowIcon.className = "fas fa-arrow-right";
    arrowWrap.appendChild(arrowIcon);

    // Target Column
    const tgtCol = document.createElement("div");
    tgtCol.className = "vocab-card-col target";

    const tgtHead = document.createElement("div");
    tgtHead.className = "vocab-col-header";
    const tgtLabel = document.createElement("span");
    tgtLabel.className = "vocab-col-label";
    tgtLabel.textContent = `Translation (${entry.toName})`;

    const tgtActions = document.createElement("div");
    tgtActions.className = "vocab-col-actions";

    const tgtSpeakBtn = document.createElement("button");
    tgtSpeakBtn.type = "button";
    tgtSpeakBtn.className = "card-icon-btn";
    tgtSpeakBtn.title = "Listen to translation";
    tgtSpeakBtn.setAttribute("aria-label", "Listen to translated text");
    const tgtSpeakIcon = document.createElement("i");
    tgtSpeakIcon.className = "fas fa-volume-up";
    tgtSpeakIcon.setAttribute("aria-hidden", "true");
    tgtSpeakBtn.appendChild(tgtSpeakIcon);
    tgtSpeakBtn.addEventListener("click", () => pronounceText(entry.translatedText, entry.toCode, "translated text", tgtSpeakBtn));

    const tgtCopyBtn = document.createElement("button");
    tgtCopyBtn.type = "button";
    tgtCopyBtn.className = "card-icon-btn";
    tgtCopyBtn.title = "Copy translation";
    tgtCopyBtn.setAttribute("aria-label", "Copy translated text to clipboard");
    const tgtCopyIcon = document.createElement("i");
    tgtCopyIcon.className = "fas fa-copy";
    tgtCopyIcon.setAttribute("aria-hidden", "true");
    tgtCopyBtn.appendChild(tgtCopyIcon);
    tgtCopyBtn.addEventListener("click", () => copyToClipboard(entry.translatedText, "Translated text", tgtCopyBtn));

    tgtActions.appendChild(tgtSpeakBtn);
    tgtActions.appendChild(tgtCopyBtn);
    tgtHead.appendChild(tgtLabel);
    tgtHead.appendChild(tgtActions);

    const tgtText = document.createElement("p");
    tgtText.className = "vocab-col-text translated";
    tgtText.textContent = entry.translatedText;

    tgtCol.appendChild(tgtHead);
    tgtCol.appendChild(tgtText);

    body.appendChild(srcCol);
    body.appendChild(arrowWrap);
    body.appendChild(tgtCol);

    // Footer
    const footer = document.createElement("div");
    footer.className = "vocab-card-footer";

    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "use-in-translator-btn";
    useBtn.title = "Open this translation in the Translator";
    useBtn.setAttribute("aria-label", "Open this translation in Translator");
    const useIcon = document.createElement("i");
    useIcon.className = "fas fa-external-link-alt";
    useIcon.setAttribute("aria-hidden", "true");
    const useText = document.createElement("span");
    useText.textContent = "Open in Translator";
    useBtn.appendChild(useIcon);
    useBtn.appendChild(useText);
    useBtn.addEventListener("click", () => useInTranslator(entry));

    footer.appendChild(useBtn);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);

    return card;
}

/**
 * Render the entire notebook view based on current state and filters
 */
function renderNotebookView() {
    if (!elements.notebookEntriesList || !elements.notebookEmptyState) return;

    const totalCount = notebookState.entries.length;
    const filtered = getFilteredEntries();

    if (elements.notebookClearAllBtn) {
        elements.notebookClearAllBtn.disabled = totalCount === 0;
    }

    const hasFilter = Boolean(
        notebookState.searchQuery.trim() ||
        notebookState.languageFilter !== "all" ||
        notebookState.favoritesOnly
    );

    if (elements.notebookResetFiltersBtn) {
        elements.notebookResetFiltersBtn.hidden = !hasFilter;
    }

    if (totalCount === 0) {
        elements.notebookEmptyState.hidden = false;
        elements.notebookEntriesList.hidden = true;
        elements.notebookEntriesList.innerHTML = "";
        if (elements.notebookResultsCount) {
            elements.notebookResultsCount.textContent = "0 saved items";
        }
        return;
    }

    elements.notebookEmptyState.hidden = true;
    elements.notebookEntriesList.hidden = false;
    elements.notebookEntriesList.innerHTML = "";

    if (elements.notebookResultsCount) {
        if (hasFilter) {
            elements.notebookResultsCount.textContent = `Showing ${filtered.length} of ${totalCount} saved items`;
        } else {
            elements.notebookResultsCount.textContent = `${totalCount} saved item${totalCount === 1 ? "" : "s"}`;
        }
    }

    if (filtered.length === 0) {
        const filterEmpty = document.createElement("div");
        filterEmpty.className = "filter-empty-state";

        const icon = document.createElement("i");
        icon.className = "fas fa-search";
        icon.style.fontSize = "24px";
        icon.style.color = "#94a3b8";
        icon.setAttribute("aria-hidden", "true");

        const msg = document.createElement("p");
        msg.textContent = "No saved translations match your search or filter.";

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "primary-pill-btn";
        resetBtn.textContent = "Clear Filters";
        resetBtn.addEventListener("click", resetNotebookFilters);

        filterEmpty.appendChild(icon);
        filterEmpty.appendChild(msg);
        filterEmpty.appendChild(resetBtn);

        elements.notebookEntriesList.appendChild(filterEmpty);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of filtered) {
        fragment.appendChild(createNotebookCardElement(entry));
    }
    elements.notebookEntriesList.appendChild(fragment);
}

/**
 * Update the badge count in navigation tab
 */
function updateNotebookBadge() {
    if (!elements.notebookCountBadge) return;
    const count = notebookState.entries.length;
    elements.notebookCountBadge.textContent = String(count);
    elements.notebookCountBadge.setAttribute("aria-label", `${count} saved translation${count === 1 ? "" : "s"}`);
}

/**
 * Populate language filter options from distinct languages in saved entries
 */
function updateNotebookLanguageFilterOptions() {
    if (!elements.notebookLangFilter) return;

    const currentSelected = notebookState.languageFilter;
    elements.notebookLangFilter.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All Languages";
    elements.notebookLangFilter.appendChild(allOpt);

    const distinctCodes = new Map();
    for (const entry of notebookState.entries) {
        if (entry.fromCode && entry.fromName) {
            distinctCodes.set(entry.fromCode, entry.fromName);
        }
        if (entry.toCode && entry.toName) {
            distinctCodes.set(entry.toCode, entry.toName);
        }
    }

    const sorted = Array.from(distinctCodes.entries()).sort((a, b) => a[1].localeCompare(b[1]));

    for (const [code, name] of sorted) {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = name;
        if (code === currentSelected) {
            opt.selected = true;
        }
        elements.notebookLangFilter.appendChild(opt);
    }

    if (currentSelected !== "all" && !distinctCodes.has(currentSelected)) {
        notebookState.languageFilter = "all";
        elements.notebookLangFilter.value = "all";
    }
}

/**
 * Reset all active filters in the notebook toolbar
 */
function resetNotebookFilters() {
    notebookState.searchQuery = "";
    notebookState.languageFilter = "all";
    notebookState.favoritesOnly = false;

    if (elements.notebookSearchInput) {
        elements.notebookSearchInput.value = "";
    }
    if (elements.notebookSearchClearBtn) {
        elements.notebookSearchClearBtn.hidden = true;
    }
    if (elements.notebookLangFilter) {
        elements.notebookLangFilter.value = "all";
    }
    if (elements.notebookFavFilterBtn) {
        elements.notebookFavFilterBtn.setAttribute("aria-pressed", "false");
        const icon = elements.notebookFavFilterBtn.querySelector("i");
        if (icon) icon.className = "far fa-star";
    }

    renderNotebookView();
}

/* ==========================================================================
   Practice Mode & Flashcard Engine
   ========================================================================== */

/**
 * Synchronize practice state with current vocabulary entries
 */
function syncPracticeState() {
    const total = notebookState.entries.length;
    if (total === 0) {
        practiceState.currentIndex = 0;
        practiceState.isAnswerShown = false;
        practiceState.sessionResults.clear();

        if (typeof quizState !== "undefined") {
            quizState.status = "idle";
            quizState.questions = [];
            quizState.userAnswers = [];
            quizState.isAnswerSubmitted = false;
        }
        if (typeof updateQuizSetupOptions === "function") {
            updateQuizSetupOptions();
        }
        if (typeof updateProgressDashboard === "function") {
            updateProgressDashboard();
        }
        if (typeof renderProgressView === "function") {
            renderProgressView();
        }
        return;
    }

    // Remove any flashcard session results for entries that no longer exist
    const validIds = new Set(notebookState.entries.map(e => e.id));
    for (const id of practiceState.sessionResults.keys()) {
        if (!validIds.has(id)) {
            practiceState.sessionResults.delete(id);
        }
    }

    // Clamp current flashcard index within valid bounds
    if (practiceState.currentIndex >= total) {
        practiceState.currentIndex = total - 1;
        practiceState.isAnswerShown = false;
    } else if (practiceState.currentIndex < 0) {
        practiceState.currentIndex = 0;
        practiceState.isAnswerShown = false;
    }

    // Sync active quiz state if active
    if (typeof quizState !== "undefined" && quizState.status === "active") {
        const hasDeletedQuestion = quizState.questions.some(q => !validIds.has(q.entryId));
        if (hasDeletedQuestion || total < 2) {
            quizState.status = "idle";
            quizState.questions = [];
            quizState.userAnswers = [];
            quizState.isAnswerSubmitted = false;
            showStatus("Vocabulary entries changed during quiz. Returned to quiz setup.", "info", 4000);
        }
    }

    if (typeof updateQuizSetupOptions === "function") {
        updateQuizSetupOptions();
    }

    if (typeof updateProgressDashboard === "function") {
        updateProgressDashboard();
    }
}

/**
 * Switch Practice sub-mode between Flashcards and Quiz
 * @param {"flashcards" | "quiz"} subMode
 */
function switchPracticeSubMode(subMode) {
    practiceState.subMode = (subMode === "quiz") ? "quiz" : "flashcards";
    renderPracticeView();
}

/**
 * Render the practice view (empty state vs active flashcard container vs quiz)
 */
function renderPracticeView() {
    if (!elements.panelPractice) return;

    syncPracticeState();
    const total = notebookState.entries.length;

    if (total === 0) {
        if (elements.practiceEmptyState) elements.practiceEmptyState.hidden = false;
        if (elements.practiceFlashcardsContainer) elements.practiceFlashcardsContainer.hidden = true;
        if (elements.practiceCardContainer) elements.practiceCardContainer.hidden = true;
        if (elements.practiceQuizContainer) elements.practiceQuizContainer.hidden = true;
        if (elements.practiceCardCounter) elements.practiceCardCounter.textContent = "Card 0 of 0";
        if (elements.practiceKnownCount) elements.practiceKnownCount.textContent = "0";
        if (elements.practiceLearningCount) elements.practiceLearningCount.textContent = "0";
        return;
    }

    if (elements.practiceEmptyState) elements.practiceEmptyState.hidden = true;

    if (practiceState.subMode === "quiz") {
        if (elements.practiceFlashcardsContainer) elements.practiceFlashcardsContainer.hidden = true;
        if (elements.practiceCardContainer) elements.practiceCardContainer.hidden = true;
        if (elements.practiceQuizContainer) elements.practiceQuizContainer.hidden = false;
        if (elements.practiceModeFlashcardsBtn) {
            elements.practiceModeFlashcardsBtn.classList.remove("active");
            elements.practiceModeFlashcardsBtn.setAttribute("aria-selected", "false");
            elements.practiceModeFlashcardsBtn.setAttribute("tabindex", "-1");
        }
        if (elements.practiceModeQuizBtn) {
            elements.practiceModeQuizBtn.classList.add("active");
            elements.practiceModeQuizBtn.setAttribute("aria-selected", "true");
            elements.practiceModeQuizBtn.setAttribute("tabindex", "0");
        }
        if (typeof renderQuizView === "function") {
            renderQuizView();
        }
    } else {
        if (elements.practiceFlashcardsContainer) elements.practiceFlashcardsContainer.hidden = false;
        if (elements.practiceCardContainer) elements.practiceCardContainer.hidden = false;
        if (elements.practiceQuizContainer) elements.practiceQuizContainer.hidden = true;
        if (elements.practiceModeFlashcardsBtn) {
            elements.practiceModeFlashcardsBtn.classList.add("active");
            elements.practiceModeFlashcardsBtn.setAttribute("aria-selected", "true");
            elements.practiceModeFlashcardsBtn.setAttribute("tabindex", "0");
        }
        if (elements.practiceModeQuizBtn) {
            elements.practiceModeQuizBtn.classList.remove("active");
            elements.practiceModeQuizBtn.setAttribute("aria-selected", "false");
            elements.practiceModeQuizBtn.setAttribute("tabindex", "-1");
        }
        renderPracticeCard();
    }
}

/**
 * Render current flashcard content, metadata, counter, and evaluation states
 */
function renderPracticeCard() {
    const total = notebookState.entries.length;
    if (total === 0) {
        renderPracticeView();
        return;
    }

    syncPracticeState();
    const entry = notebookState.entries[practiceState.currentIndex];
    if (!entry) {
        renderPracticeView();
        return;
    }

    // 1. Progress Counter
    if (elements.practiceCardCounter) {
        elements.practiceCardCounter.textContent = `Card ${practiceState.currentIndex + 1} of ${total}`;
    }

    // 2. Score Summary
    let knownCount = 0;
    let practiceCount = 0;
    for (const e of notebookState.entries) {
        const res = practiceState.sessionResults.get(e.id);
        if (res === "knew") knownCount++;
        else if (res === "practice") practiceCount++;
    }
    if (elements.practiceKnownCount) elements.practiceKnownCount.textContent = String(knownCount);
    if (elements.practiceLearningCount) elements.practiceLearningCount.textContent = String(practiceCount);

    // 3. Front Face: Source Word / Phrase & Language
    if (elements.flashcardFrontLang) {
        elements.flashcardFrontLang.textContent = entry.fromName || entry.fromCode;
    }
    if (elements.flashcardFrontText) {
        elements.flashcardFrontText.textContent = entry.sourceText;
    }

    // 4. Back Face: Translated Word / Phrase & Target Language
    if (elements.flashcardBackLang) {
        elements.flashcardBackLang.textContent = entry.toName || entry.toCode;
    }
    if (elements.flashcardBackText) {
        elements.flashcardBackText.textContent = entry.translatedText;
    }

    // 5. Answer Visibility & Button State
    if (elements.flashcardBack && elements.flashcardFlipBtn) {
        if (practiceState.isAnswerShown) {
            elements.flashcardBack.hidden = false;
            elements.flashcardFlipBtn.setAttribute("aria-expanded", "true");
            elements.flashcardFlipBtn.innerHTML = `
                <i class="fas fa-eye-slash" aria-hidden="true"></i>
                <span id="flashcard-flip-btn-text">Hide Answer</span>
            `;
        } else {
            elements.flashcardBack.hidden = true;
            elements.flashcardFlipBtn.setAttribute("aria-expanded", "false");
            elements.flashcardFlipBtn.innerHTML = `
                <i class="fas fa-eye" aria-hidden="true"></i>
                <span id="flashcard-flip-btn-text">Show Answer</span>
            `;
        }
    }

    // 6. Session Evaluation States & Tag
    const result = practiceState.sessionResults.get(entry.id);
    if (elements.practiceKnewItBtn) {
        elements.practiceKnewItBtn.classList.toggle("active", result === "knew");
    }
    if (elements.practiceNeedWorkBtn) {
        elements.practiceNeedWorkBtn.classList.toggle("active", result === "practice");
    }

    if (elements.flashcardStatusTag) {
        if (result === "knew") {
            elements.flashcardStatusTag.hidden = false;
            elements.flashcardStatusTag.className = "flashcard-status-tag knew";
            elements.flashcardStatusTag.textContent = "✓ Marked as Known";
        } else if (result === "practice") {
            elements.flashcardStatusTag.hidden = false;
            elements.flashcardStatusTag.className = "flashcard-status-tag practice";
            elements.flashcardStatusTag.textContent = "⟳ Marked for More Practice";
        } else {
            elements.flashcardStatusTag.hidden = true;
            elements.flashcardStatusTag.textContent = "";
        }
    }

    // 7. Navigation Boundary Controls
    if (elements.practicePrevBtn) {
        elements.practicePrevBtn.disabled = practiceState.currentIndex <= 0;
    }
    if (elements.practiceNextBtn) {
        elements.practiceNextBtn.disabled = practiceState.currentIndex >= total - 1;
    }
}

/**
 * Toggle flashcard reveal / hide state
 */
function toggleFlashcardAnswer() {
    if (notebookState.entries.length === 0) return;
    practiceState.isAnswerShown = !practiceState.isAnswerShown;
    const entry = notebookState.entries[practiceState.currentIndex];
    renderPracticeCard();
    if (practiceState.isAnswerShown && entry) {
        showStatus(`Answer: ${entry.translatedText}`, "info", 2000);
    }
}

/**
 * Record session result ("knew" or "practice") for current card
 * @param {"knew" | "practice"} result
 */
function recordPracticeResult(result) {
    if (notebookState.entries.length === 0) return;
    const entry = notebookState.entries[practiceState.currentIndex];
    if (!entry) return;

    const isFirstAssessmentForCard = !practiceState.sessionResults.has(entry.id);
    practiceState.sessionResults.set(entry.id, result);
    renderPracticeCard();

    if (isFirstAssessmentForCard && typeof progressState !== "undefined") {
        progressState.flashcardReviews++;
        if (progressState.reviewedCardIds) {
            progressState.reviewedCardIds.add(entry.id);
        }

        // Association of assessment result with vocabulary entry
        if (!progressState.cardAssessments) progressState.cardAssessments = {};
        if (!progressState.cardAssessments[entry.id]) {
            progressState.cardAssessments[entry.id] = {
                knewCount: 0,
                practiceCount: 0,
                lastAssessment: result,
                lastReviewed: Date.now()
            };
        }
        if (result === "knew") {
            progressState.cardAssessments[entry.id].knewCount++;
        } else {
            progressState.cardAssessments[entry.id].practiceCount++;
        }
        progressState.cardAssessments[entry.id].lastAssessment = result;
        progressState.cardAssessments[entry.id].lastReviewed = Date.now();

        // Daily activity tracking
        const todayKey = new Date().toISOString().split("T")[0];
        if (!progressState.dailyActivity) progressState.dailyActivity = {};
        if (!progressState.dailyActivity[todayKey]) {
            progressState.dailyActivity[todayKey] = {
                date: todayKey,
                flashcardReviews: 0,
                quizAttempts: 0,
                quizCorrect: 0,
                quizIncorrect: 0
            };
        }
        progressState.dailyActivity[todayKey].flashcardReviews++;

        // Persist safely via StorageAdapter
        if (typeof StorageAdapter !== "undefined" && typeof StorageAdapter.save === "function") {
            StorageAdapter.save(undefined, {
                quizHistory: progressState.quizHistory,
                flashcardStats: {
                    totalReviews: progressState.flashcardReviews,
                    cardAssessments: progressState.cardAssessments
                },
                dailyActivity: progressState.dailyActivity
            });
        }

        if (typeof updateProgressDashboard === "function") {
            updateProgressDashboard();
        }
        if (typeof renderProgressView === "function") {
            renderProgressView();
        }
    }

    const label = result === "knew" ? "Marked card as known." : "Marked card for more practice.";
    showStatus(label, "info", 1800);
}

/**
 * Navigate to previous or next card
 * @param {"prev" | "next"} direction
 */
function navigatePracticeCard(direction) {
    const total = notebookState.entries.length;
    if (total === 0) return;

    if (direction === "prev" && practiceState.currentIndex > 0) {
        practiceState.currentIndex--;
        practiceState.isAnswerShown = false;
        renderPracticeCard();
    } else if (direction === "next" && practiceState.currentIndex < total - 1) {
        practiceState.currentIndex++;
        practiceState.isAnswerShown = false;
        renderPracticeCard();
    }
}

/**
 * Reset practice session scores and restart from card 1
 */
function restartPracticeSession() {
    practiceState.currentIndex = 0;
    practiceState.isAnswerShown = false;
    practiceState.sessionResults.clear();
    renderPracticeView();
    showStatus("Practice session restarted.", "info", 2500);
}

/* ==========================================================================
   Vocabulary Quiz Engine
   ========================================================================== */

/**
 * Shuffle an array using Fisher-Yates algorithm
 * @param {Array} array
 * @returns {Array}
 */
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Get entries eligible for quiz based on language pair filter
 * @param {string} [pairFilter]
 * @returns {Array<Object>}
 */
function getQuizEligibleEntries(pairFilter) {
    const pair = pairFilter !== undefined ? pairFilter : (quizState.selectedLanguagePair || "all");
    return notebookState.entries.filter(e => {
        if (!e || typeof e !== "object") return false;
        const src = (e.sourceText || "").trim();
        const trans = (e.translatedText || "").trim();
        if (!src || !trans) return false;
        if (pair !== "all") {
            const entryPair = `${e.fromCode}|${e.toCode}`;
            return entryPair === pair;
        }
        return true;
    });
}

/**
 * Update quiz setup options (language pairs, question counts, warnings)
 */
function updateQuizSetupOptions() {
    if (!elements.quizSetupView) return;

    const totalNotebook = notebookState.entries.length;

    // 1. Language Pair select options
    const pairsMap = new Map();
    for (const e of notebookState.entries) {
        if (!e.fromCode || !e.toCode) continue;
        const key = `${e.fromCode}|${e.toCode}`;
        const label = `${e.fromName || e.fromCode} → ${e.toName || e.toCode}`;
        pairsMap.set(key, { label, count: (pairsMap.get(key)?.count || 0) + 1 });
    }

    if (elements.quizLangPairSelect) {
        const currentVal = elements.quizLangPairSelect.value || quizState.selectedLanguagePair || "all";
        elements.quizLangPairSelect.innerHTML = `<option value="all">All Language Pairs (${totalNotebook} words)</option>`;
        for (const [key, info] of pairsMap.entries()) {
            const opt = document.createElement("option");
            opt.value = key;
            opt.textContent = `${info.label} (${info.count} words)`;
            elements.quizLangPairSelect.appendChild(opt);
        }
        if (pairsMap.has(currentVal) || currentVal === "all") {
            elements.quizLangPairSelect.value = currentVal;
            quizState.selectedLanguagePair = currentVal;
        } else {
            elements.quizLangPairSelect.value = "all";
            quizState.selectedLanguagePair = "all";
        }
    }

    if (elements.quizLangPairItem) {
        elements.quizLangPairItem.hidden = (pairsMap.size <= 1);
    }

    const selectedPair = elements.quizLangPairSelect?.value || "all";
    const eligible = getQuizEligibleEntries(selectedPair);
    const eligibleCount = eligible.length;

    // 2. Question count select options
    if (elements.quizCountSelect) {
        const currentCountVal = elements.quizCountSelect.value;
        elements.quizCountSelect.innerHTML = "";
        const optionsCounts = [5, 10, 15, 20];
        let hasAnyNumeric = false;
        optionsCounts.forEach(cnt => {
            if (eligibleCount >= cnt) {
                const opt = document.createElement("option");
                opt.value = String(cnt);
                opt.textContent = `${cnt} Questions`;
                elements.quizCountSelect.appendChild(opt);
                hasAnyNumeric = true;
            }
        });
        const allOpt = document.createElement("option");
        allOpt.value = "all";
        allOpt.textContent = `All Available Words (${eligibleCount})`;
        elements.quizCountSelect.appendChild(allOpt);

        if (currentCountVal && (currentCountVal === "all" || Number(currentCountVal) <= eligibleCount)) {
            elements.quizCountSelect.value = currentCountVal;
        } else if (hasAnyNumeric) {
            elements.quizCountSelect.value = "5";
        } else {
            elements.quizCountSelect.value = "all";
        }
    }

    // 3. Direction Buttons
    if (elements.quizDirForwardBtn && elements.quizDirReverseBtn) {
        const isForward = quizState.direction === "forward";
        elements.quizDirForwardBtn.classList.toggle("active", isForward);
        elements.quizDirForwardBtn.setAttribute("aria-checked", isForward ? "true" : "false");
        elements.quizDirReverseBtn.classList.toggle("active", !isForward);
        elements.quizDirReverseBtn.setAttribute("aria-checked", !isForward ? "true" : "false");
    }

    // 4. Eligibility and Warning states
    if (eligibleCount < 2) {
        if (elements.quizEligibilityWarning) elements.quizEligibilityWarning.hidden = false;
        if (elements.quizWarningText) {
            elements.quizWarningText.textContent = `A multiple-choice quiz requires at least 2 saved words to provide answer choices. You currently have ${eligibleCount} eligible saved word${eligibleCount === 1 ? "" : "s"}.`;
        }
        if (elements.quizSmallPoolNotice) elements.quizSmallPoolNotice.hidden = true;
        if (elements.quizStartBtn) elements.quizStartBtn.disabled = true;
    } else {
        if (elements.quizEligibilityWarning) elements.quizEligibilityWarning.hidden = true;
        if (elements.quizStartBtn) elements.quizStartBtn.disabled = false;

        if (eligibleCount === 2 || eligibleCount === 3) {
            if (elements.quizSmallPoolNotice) elements.quizSmallPoolNotice.hidden = false;
            if (elements.quizSmallPoolText) {
                elements.quizSmallPoolText.textContent = `With ${eligibleCount} saved entries in this set, questions will feature ${eligibleCount} answer choices instead of 4.`;
            }
        } else {
            if (elements.quizSmallPoolNotice) elements.quizSmallPoolNotice.hidden = true;
        }
    }
}

/**
 * Generate randomized multiple-choice quiz questions from eligible entries
 * @param {Object} [config]
 * @returns {Array<Object>}
 */
function generateQuizQuestions(config = {}) {
    const direction = config.direction || quizState.direction || "forward";
    const pair = config.languagePair || quizState.selectedLanguagePair || "all";
    const requestedCount = config.count !== undefined ? config.count : (quizState.questionCount || 5);
    const shuffle = config.shuffle !== undefined ? Boolean(config.shuffle) : Boolean(quizState.shuffleOrder);

    const eligible = getQuizEligibleEntries(pair);
    if (eligible.length < 2) {
        return [];
    }

    let questionEntries = [...eligible];
    if (shuffle) {
        questionEntries = shuffleArray(questionEntries);
    }

    let totalQuestions = questionEntries.length;
    if (requestedCount !== "all") {
        const num = Number(requestedCount);
        if (!isNaN(num) && num > 0 && num < totalQuestions) {
            totalQuestions = num;
        }
    }

    const sampledEntries = questionEntries.slice(0, totalQuestions);

    const questions = sampledEntries.map(entry => {
        const isForward = direction === "forward";
        const promptText = isForward ? entry.sourceText.trim() : entry.translatedText.trim();
        const promptLang = isForward ? (entry.fromName || entry.fromCode) : (entry.toName || entry.toCode);
        const promptLangCode = isForward ? entry.fromCode : entry.toCode;
        const targetLang = isForward ? (entry.toName || entry.toCode) : (entry.fromName || entry.fromCode);
        const targetLangCode = isForward ? entry.toCode : entry.fromCode;
        const correctAnswer = isForward ? entry.translatedText.trim() : entry.sourceText.trim();

        const normCorrect = correctAnswer.toLowerCase();
        const distractorCandidates = [];
        const seenTexts = new Set([normCorrect]);

        // Prioritize distractors with matching target language
        for (const candEntry of eligible) {
            const candText = (isForward ? candEntry.translatedText : candEntry.sourceText).trim();
            const normCand = candText.toLowerCase();
            if (!seenTexts.has(normCand)) {
                seenTexts.add(normCand);
                distractorCandidates.push(candText);
            }
        }

        // If not enough from eligible, check all notebook entries
        if (distractorCandidates.length < 3) {
            for (const candEntry of notebookState.entries) {
                const candText = (isForward ? candEntry.translatedText : candEntry.sourceText).trim();
                const normCand = candText.toLowerCase();
                if (!seenTexts.has(normCand)) {
                    seenTexts.add(normCand);
                    distractorCandidates.push(candText);
                }
            }
        }

        const shuffledDistractors = shuffleArray(distractorCandidates);
        const selectedDistractors = shuffledDistractors.slice(0, 3);
        const options = shuffleArray([correctAnswer, ...selectedDistractors]);
        const correctOptionIndex = options.indexOf(correctAnswer);

        return {
            entryId: entry.id,
            entry,
            direction,
            promptText,
            promptLang,
            promptLangCode,
            targetLang,
            targetLangCode,
            correctAnswer,
            options,
            correctOptionIndex
        };
    });

    return questions;
}

/**
 * Start a new quiz session with current settings
 */
function startQuiz() {
    const pair = elements.quizLangPairSelect?.value || "all";
    const countVal = elements.quizCountSelect?.value || "5";
    const shuffle = elements.quizShuffleCheck ? elements.quizShuffleCheck.checked : true;
    const direction = quizState.direction || "forward";

    quizState.selectedLanguagePair = pair;
    quizState.questionCount = countVal === "all" ? "all" : Number(countVal);
    quizState.shuffleOrder = shuffle;

    const questions = generateQuizQuestions({
        direction,
        languagePair: pair,
        count: countVal,
        shuffle
    });

    if (questions.length === 0) {
        showStatus("Not enough saved words to generate a quiz. Please save more words first.", "error", 4000);
        return;
    }

    quizState.questions = questions;
    quizState.currentIndex = 0;
    quizState.userAnswers = [];
    quizState.correctCount = 0;
    quizState.incorrectCount = 0;
    quizState.isAnswerSubmitted = false;
    quizState.isAttemptRecorded = false;
    quizState.status = "active";

    renderQuizView();
    showStatus(`Quiz started! ${questions.length} questions ready.`, "info", 2000);
}

/**
 * Render the current quiz view state (setup vs active question vs results)
 */
function renderQuizView() {
    updateQuizSetupOptions();

    if (quizState.status === "active") {
        if (elements.quizSetupView) elements.quizSetupView.hidden = true;
        if (elements.quizActiveView) elements.quizActiveView.hidden = false;
        if (elements.quizResultsView) elements.quizResultsView.hidden = true;
        renderQuizQuestion();
    } else if (quizState.status === "completed") {
        if (elements.quizSetupView) elements.quizSetupView.hidden = true;
        if (elements.quizActiveView) elements.quizActiveView.hidden = true;
        if (elements.quizResultsView) elements.quizResultsView.hidden = false;
        renderQuizResults();
    } else {
        if (elements.quizSetupView) elements.quizSetupView.hidden = false;
        if (elements.quizActiveView) elements.quizActiveView.hidden = true;
        if (elements.quizResultsView) elements.quizResultsView.hidden = true;
    }
}

/**
 * Render active quiz question and multiple choice option buttons
 */
function renderQuizQuestion() {
    const total = quizState.questions.length;
    if (total === 0 || quizState.currentIndex >= total) {
        exitQuizToSetup();
        return;
    }

    const q = quizState.questions[quizState.currentIndex];
    quizState.isAnswerSubmitted = false;

    // 1. Counter & Progress Bar
    if (elements.quizQuestionCounter) {
        elements.quizQuestionCounter.textContent = `Question ${quizState.currentIndex + 1} of ${total}`;
    }
    if (elements.quizProgressBar) {
        const pct = Math.round(((quizState.currentIndex + 1) / total) * 100);
        elements.quizProgressBar.style.width = `${pct}%`;
        const track = elements.quizProgressBar.parentElement;
        if (track) {
            track.setAttribute("aria-valuenow", String(quizState.currentIndex + 1));
            track.setAttribute("aria-valuemax", String(total));
        }
    }

    // 2. Question Prompt & Badge
    if (elements.quizPromptBadge) {
        elements.quizPromptBadge.textContent = q.promptLang;
    }
    if (elements.quizPromptText) {
        elements.quizPromptText.textContent = q.promptText;
    }

    // 3. Clear Feedback Banner
    if (elements.quizFeedbackBanner) {
        elements.quizFeedbackBanner.hidden = true;
        elements.quizFeedbackBanner.className = "quiz-feedback-banner";
        elements.quizFeedbackBanner.textContent = "";
    }

    // 4. Multiple Choice Options Grid
    if (elements.quizOptionsGrid) {
        elements.quizOptionsGrid.innerHTML = "";
        q.options.forEach((optText, idx) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "quiz-option-btn";
            btn.setAttribute("role", "radio");
            btn.setAttribute("aria-checked", "false");
            btn.setAttribute("data-index", String(idx));

            const keySpan = document.createElement("span");
            keySpan.className = "quiz-opt-key";
            keySpan.textContent = String(idx + 1);

            const textSpan = document.createElement("span");
            textSpan.className = "quiz-opt-text";
            textSpan.textContent = optText;

            const icon = document.createElement("i");
            icon.className = "quiz-opt-icon far fa-circle";
            icon.setAttribute("aria-hidden", "true");

            btn.appendChild(keySpan);
            btn.appendChild(textSpan);
            btn.appendChild(icon);

            btn.addEventListener("click", () => selectQuizOption(idx));
            elements.quizOptionsGrid.appendChild(btn);
        });

        const firstBtn = elements.quizOptionsGrid.querySelector(".quiz-option-btn");
        if (firstBtn && document.activeElement && document.activeElement.tagName === "BUTTON") {
            try { firstBtn.focus(); } catch {}
        }
    }

    // 5. Next Button State
    if (elements.quizNextBtn) {
        elements.quizNextBtn.disabled = true;
        const isLast = (quizState.currentIndex === total - 1);
        if (elements.quizNextBtnText) {
            elements.quizNextBtnText.textContent = isLast ? "View Results" : "Next Question";
        }
        const nextIcon = elements.quizNextBtn.querySelector("i");
        if (nextIcon) {
            nextIcon.className = isLast ? "fas fa-flag-checkered" : "fas fa-arrow-right";
        }
    }
}

/**
 * Handle user selection of a multiple-choice option
 * @param {number} selectedIndex
 */
function selectQuizOption(selectedIndex) {
    if (quizState.isAnswerSubmitted) return;
    if (!quizState.questions || quizState.currentIndex >= quizState.questions.length) return;

    quizState.isAnswerSubmitted = true;
    const q = quizState.questions[quizState.currentIndex];
    const isCorrect = (selectedIndex === q.correctOptionIndex);

    if (isCorrect) {
        quizState.correctCount++;
    } else {
        quizState.incorrectCount++;
    }

    quizState.userAnswers.push({
        questionIndex: quizState.currentIndex,
        selectedOptionIndex: selectedIndex,
        isCorrect,
        promptText: q.promptText,
        promptLang: q.promptLang,
        chosenText: q.options[selectedIndex],
        correctText: q.correctAnswer,
        targetLang: q.targetLang,
        targetLangCode: q.targetLangCode,
        entryId: q.entryId
    });

    // Update buttons styling and disable further interaction
    const optionBtns = elements.quizOptionsGrid?.querySelectorAll(".quiz-option-btn") || [];
    optionBtns.forEach((btn, idx) => {
        btn.disabled = true;
        const icon = btn.querySelector(".quiz-opt-icon");

        if (idx === selectedIndex) {
            btn.classList.add("selected");
            btn.setAttribute("aria-checked", "true");
            if (isCorrect) {
                btn.classList.add("correct");
                btn.setAttribute("aria-label", `${q.options[idx]}, your correct answer`);
                if (icon) icon.className = "quiz-opt-icon fas fa-check-circle";
            } else {
                btn.classList.add("incorrect");
                btn.setAttribute("aria-label", `${q.options[idx]}, your incorrect answer`);
                if (icon) icon.className = "quiz-opt-icon fas fa-times-circle";
            }
        }

        if (!isCorrect && idx === q.correctOptionIndex) {
            btn.classList.add("correct-highlight");
            btn.setAttribute("aria-label", `${q.options[idx]}, correct answer`);
            if (icon) icon.className = "quiz-opt-icon fas fa-check-circle";
        }
    });

    // Feedback banner
    if (elements.quizFeedbackBanner) {
        elements.quizFeedbackBanner.hidden = false;
        elements.quizFeedbackBanner.className = `quiz-feedback-banner ${isCorrect ? "correct" : "incorrect"}`;
        elements.quizFeedbackBanner.textContent = "";

        const iconEl = document.createElement("i");
        iconEl.className = isCorrect ? "fas fa-check-circle" : "fas fa-times-circle";
        iconEl.setAttribute("aria-hidden", "true");

        const msgSpan = document.createElement("span");
        if (isCorrect) {
            msgSpan.textContent = `Correct! "${q.correctAnswer}" is the right translation.`;
        } else {
            msgSpan.textContent = `Incorrect. The correct translation is "${q.correctAnswer}".`;
        }

        elements.quizFeedbackBanner.appendChild(iconEl);
        elements.quizFeedbackBanner.appendChild(msgSpan);
    }

    // Enable Next button and set focus
    if (elements.quizNextBtn) {
        elements.quizNextBtn.disabled = false;
        try { elements.quizNextBtn.focus(); } catch {}
    }

    showStatus(isCorrect ? "Correct answer!" : `Incorrect. Correct answer: ${q.correctAnswer}`, isCorrect ? "success" : "info", 2000);
}

/**
 * Advance to next question or complete quiz
 */
function nextQuizQuestion() {
    if (quizState.status !== "active" || !quizState.isAnswerSubmitted) return;
    quizState.isAnswerSubmitted = false;

    if (quizState.currentIndex < quizState.questions.length - 1) {
        quizState.currentIndex++;
        renderQuizQuestion();
    } else {
        finishQuiz();
    }
}

/**
 * Finalize quiz and transition to results view
 */
function finishQuiz() {
    quizState.status = "completed";

    if (!quizState.isAttemptRecorded && typeof progressState !== "undefined") {
        quizState.isAttemptRecorded = true;
        const total = quizState.questions.length;
        const correct = quizState.correctCount;
        const incorrect = quizState.incorrectCount;
        const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
        const timestamp = Date.now();
        const dateStr = new Date(timestamp).toISOString();
        const todayKey = dateStr.split("T")[0];

        const attempt = {
            id: generateUniqueId(),
            timestamp,
            date: dateStr,
            totalQuestions: total,
            correctCount: correct,
            incorrectCount: incorrect,
            percentage: pct,
            direction: quizState.direction || "forward",
            languagePair: quizState.selectedLanguagePair || "all"
        };

        if (Array.isArray(progressState.quizHistory)) {
            progressState.quizHistory.push(attempt);
        }

        // Daily activity tracking
        if (!progressState.dailyActivity) progressState.dailyActivity = {};
        if (!progressState.dailyActivity[todayKey]) {
            progressState.dailyActivity[todayKey] = {
                date: todayKey,
                flashcardReviews: 0,
                quizAttempts: 0,
                quizCorrect: 0,
                quizIncorrect: 0
            };
        }
        progressState.dailyActivity[todayKey].quizAttempts++;
        progressState.dailyActivity[todayKey].quizCorrect += correct;
        progressState.dailyActivity[todayKey].quizIncorrect += incorrect;

        // Persist safely via StorageAdapter
        if (typeof StorageAdapter !== "undefined" && typeof StorageAdapter.save === "function") {
            StorageAdapter.save(undefined, {
                quizHistory: progressState.quizHistory,
                flashcardStats: {
                    totalReviews: progressState.flashcardReviews,
                    cardAssessments: progressState.cardAssessments
                },
                dailyActivity: progressState.dailyActivity
            });
        }

        if (typeof updateProgressDashboard === "function") {
            updateProgressDashboard();
        }
        if (typeof renderProgressView === "function") {
            renderProgressView();
        }
    }

    renderQuizView();
    showStatus("Quiz completed! Review your results.", "success", 3000);
}

/**
 * Render quiz results breakdown, score message, and incorrect-answer review
 */
function renderQuizResults() {
    const total = quizState.questions.length;
    const correct = quizState.correctCount;
    const incorrect = quizState.incorrectCount;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    if (elements.quizResultsTotal) elements.quizResultsTotal.textContent = String(total);
    if (elements.quizResultsCorrect) elements.quizResultsCorrect.textContent = String(correct);
    if (elements.quizResultsIncorrect) elements.quizResultsIncorrect.textContent = String(incorrect);
    if (elements.quizResultsPercent) elements.quizResultsPercent.textContent = `${pct}%`;

    let message = "";
    if (pct === 100) {
        message = "Outstanding! Perfect score — you know these translations by heart!";
    } else if (pct >= 80) {
        message = "Great job! You have a solid grasp of this vocabulary.";
    } else if (pct >= 60) {
        message = "Good effort! A little more practice will help you master them all.";
    } else {
        message = "Keep practicing! Review your mistakes below to strengthen your memory.";
    }
    if (elements.quizResultsMessage) elements.quizResultsMessage.textContent = message;

    // Review incorrect answers
    const incorrectAnswers = quizState.userAnswers.filter(a => !a.isCorrect);
    if (elements.quizReviewSection) {
        if (incorrectAnswers.length > 0) {
            elements.quizReviewSection.hidden = false;
            if (elements.quizReviewToggleText) {
                elements.quizReviewToggleText.textContent = `Review Incorrect Answers (${incorrectAnswers.length})`;
            }
            if (elements.quizReviewToggleBtn) {
                elements.quizReviewToggleBtn.setAttribute("aria-expanded", "false");
                const icon = elements.quizReviewToggleBtn.querySelector(".toggle-icon");
                if (icon) {
                    icon.className = "fas fa-chevron-down toggle-icon";
                }
            }
            if (elements.quizReviewList) {
                elements.quizReviewList.hidden = true;
                elements.quizReviewList.innerHTML = "";
                incorrectAnswers.forEach(ans => {
                    const item = document.createElement("div");
                    item.className = "quiz-review-item";

                    const promptEl = document.createElement("div");
                    promptEl.className = "quiz-review-prompt";
                    promptEl.textContent = `Prompt (${ans.promptLang}): "${ans.promptText}"`;

                    const ansWrap = document.createElement("div");
                    ansWrap.className = "quiz-review-answers";

                    const userAnsEl = document.createElement("div");
                    userAnsEl.className = "quiz-review-ans user-incorrect";
                    const xIcon = document.createElement("i");
                    xIcon.className = "fas fa-times-circle";
                    xIcon.setAttribute("aria-hidden", "true");
                    const userTextSpan = document.createElement("span");
                    userTextSpan.textContent = `Your answer: ${ans.chosenText}`;
                    userAnsEl.appendChild(xIcon);
                    userAnsEl.appendChild(userTextSpan);

                    const correctAnsEl = document.createElement("div");
                    correctAnsEl.className = "quiz-review-ans correct-answer";
                    const checkIcon = document.createElement("i");
                    checkIcon.className = "fas fa-check-circle";
                    checkIcon.setAttribute("aria-hidden", "true");
                    const correctTextSpan = document.createElement("span");
                    correctTextSpan.textContent = `Correct translation (${ans.targetLang}): ${ans.correctText}`;
                    correctAnsEl.appendChild(checkIcon);
                    correctAnsEl.appendChild(correctTextSpan);

                    const speakBtn = document.createElement("button");
                    speakBtn.type = "button";
                    speakBtn.className = "card-icon-btn";
                    speakBtn.title = "Listen to correct answer";
                    speakBtn.setAttribute("aria-label", `Listen to ${ans.correctText}`);
                    speakBtn.innerHTML = `<i class="fas fa-volume-up" aria-hidden="true"></i>`;
                    speakBtn.addEventListener("click", () => {
                        pronounceText(ans.correctText, ans.targetLangCode, "correct translation", speakBtn);
                    });
                    correctAnsEl.appendChild(speakBtn);

                    ansWrap.appendChild(userAnsEl);
                    ansWrap.appendChild(correctAnsEl);

                    item.appendChild(promptEl);
                    item.appendChild(ansWrap);
                    elements.quizReviewList.appendChild(item);
                });
            }
        } else {
            elements.quizReviewSection.hidden = true;
        }
    }
}

/**
 * Retake the quiz with current settings
 */
function retakeQuiz() {
    startQuiz();
}

/**
 * Return from active quiz or results to the quiz setup configuration view
 */
function exitQuizToSetup() {
    quizState.status = "idle";
    quizState.questions = [];
    quizState.userAnswers = [];
    quizState.isAnswerSubmitted = false;
    renderQuizView();
}

/* ==========================================================================
   Learning Progress Dashboard
   ========================================================================== */

/**
 * Calculate learning metrics from current notebook entries and session activity
 * @returns {{
 *   totalVocabulary: number,
 *   favoriteCount: number,
 *   flashcardsReviewed: number,
 *   quizAttemptsCount: number,
 *   totalQuizCorrect: number,
 *   totalQuizIncorrect: number,
 *   totalQuizAnswers: number,
 *   overallQuizAccuracy: number,
 *   quizHistory: Array<Object>
 * }}
 */
function getProgressMetrics() {
    const totalVocabulary = Array.isArray(notebookState.entries) ? notebookState.entries.length : 0;
    const favoriteCount = Array.isArray(notebookState.entries)
        ? notebookState.entries.filter(e => Boolean(e.isFavorite)).length
        : 0;

    const flashcardsReviewed = (typeof progressState !== "undefined" && progressState.flashcardReviews) ? progressState.flashcardReviews : 0;

    const attempts = (typeof progressState !== "undefined" && Array.isArray(progressState.quizHistory))
        ? progressState.quizHistory
        : [];
    const quizAttemptsCount = attempts.length;

    const totalQuizCorrect = attempts.reduce((acc, att) => acc + (att.correctCount || 0), 0);
    const totalQuizIncorrect = attempts.reduce((acc, att) => acc + (att.incorrectCount || 0), 0);
    const totalQuizAnswers = totalQuizCorrect + totalQuizIncorrect;

    const overallQuizAccuracy = totalQuizAnswers > 0
        ? Math.round((totalQuizCorrect / totalQuizAnswers) * 100)
        : 0;

    const dailyActivity = (typeof progressState !== "undefined" && progressState.dailyActivity)
        ? progressState.dailyActivity
        : {};

    return {
        totalVocabulary,
        favoriteCount,
        flashcardsReviewed,
        quizAttemptsCount,
        totalQuizCorrect,
        totalQuizIncorrect,
        totalQuizAnswers,
        overallQuizAccuracy,
        quizHistory: attempts,
        dailyActivity
    };
}

/**
 * Update summary dashboard counters in the DOM
 */
function updateProgressDashboard() {
    const metrics = getProgressMetrics();

    if (elements.progressTotalVocab) {
        elements.progressTotalVocab.textContent = String(metrics.totalVocabulary);
    }
    if (elements.progressTotalFavs) {
        elements.progressTotalFavs.textContent = String(metrics.favoriteCount);
    }
    if (elements.progressFlashcardsReviewed) {
        elements.progressFlashcardsReviewed.textContent = String(metrics.flashcardsReviewed);
    }
    if (elements.progressQuizAttempts) {
        elements.progressQuizAttempts.textContent = String(metrics.quizAttemptsCount);
    }
    if (elements.progressQuizCorrect) {
        elements.progressQuizCorrect.textContent = String(metrics.totalQuizCorrect);
    }
    if (elements.progressQuizIncorrect) {
        elements.progressQuizIncorrect.textContent = String(metrics.totalQuizIncorrect);
    }
    if (elements.progressQuizAccuracy) {
        elements.progressQuizAccuracy.textContent = metrics.totalQuizAnswers > 0 ? `${metrics.overallQuizAccuracy}%` : "0%";
    }
}

/**
 * Render the complete learning progress dashboard, updating stats, visual score history, and daily activity
 */
function renderProgressView() {
    const metrics = getProgressMetrics();
    updateProgressDashboard();

    // 1. Render Recent Quiz History
    if (elements.progressEmptyState && elements.progressHistoryContainer && elements.progressHistoryList) {
        if (metrics.quizAttemptsCount === 0) {
            elements.progressEmptyState.hidden = false;
            elements.progressHistoryContainer.hidden = true;
            elements.progressHistoryList.innerHTML = "";
        } else {
            elements.progressEmptyState.hidden = true;
            elements.progressHistoryContainer.hidden = false;
            elements.progressHistoryList.innerHTML = "";

            // Display attempts newest first
            const reversedAttempts = [...metrics.quizHistory].reverse();
            reversedAttempts.forEach((attempt, revIdx) => {
                const attemptNumber = metrics.quizHistory.length - revIdx;
                const item = document.createElement("div");
                item.className = "progress-attempt-card";

                const topRow = document.createElement("div");
                topRow.className = "attempt-top-row";

                const metaWrap = document.createElement("div");
                metaWrap.className = "attempt-meta";

                const numSpan = document.createElement("span");
                numSpan.className = "attempt-number";
                numSpan.textContent = `Attempt #${attemptNumber}`;

                const dirSpan = document.createElement("span");
                dirSpan.className = "attempt-badge";
                dirSpan.textContent = attempt.direction === "reverse" ? "Translation → Original" : "Original → Translation";

                const timeSpan = document.createElement("span");
                timeSpan.className = "attempt-time";
                const dt = new Date(attempt.timestamp);
                timeSpan.textContent = isNaN(dt.getTime()) ? "" : dt.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                metaWrap.appendChild(numSpan);
                metaWrap.appendChild(dirSpan);
                if (timeSpan.textContent) {
                    metaWrap.appendChild(timeSpan);
                }

                // Score badge with accessible styling
                const scoreBadge = document.createElement("span");
                let badgeClass = "needs-work";
                if (attempt.percentage === 100) badgeClass = "perfect";
                else if (attempt.percentage >= 80) badgeClass = "good";
                else if (attempt.percentage >= 60) badgeClass = "average";
                scoreBadge.className = `attempt-score-badge ${badgeClass}`;
                scoreBadge.textContent = `${attempt.percentage}%`;

                topRow.appendChild(metaWrap);
                topRow.appendChild(scoreBadge);

                // Progress bar track
                const track = document.createElement("div");
                track.className = "progress-score-track";
                track.setAttribute("role", "progressbar");
                track.setAttribute("aria-valuenow", String(attempt.percentage));
                track.setAttribute("aria-valuemin", "0");
                track.setAttribute("aria-valuemax", "100");
                track.setAttribute("aria-label", `Score ${attempt.percentage}%: ${attempt.correctCount} of ${attempt.totalQuestions} correct`);

                const fill = document.createElement("div");
                fill.className = `progress-score-fill ${attempt.percentage < 60 ? "needs-work" : ""}`;
                fill.style.width = `${Math.min(100, Math.max(0, attempt.percentage))}%`;
                track.appendChild(fill);

                // Bottom detail row
                const bottomRow = document.createElement("div");
                bottomRow.className = "attempt-bottom-row";

                const summarySpan = document.createElement("span");
                summarySpan.textContent = `${attempt.correctCount} of ${attempt.totalQuestions} questions correct`;

                const statDetail = document.createElement("div");
                statDetail.className = "attempt-stat-detail";

                const correctSpan = document.createElement("span");
                correctSpan.className = "attempt-stat-item correct";
                correctSpan.textContent = `✓ ${attempt.correctCount} correct`;

                const incorrectSpan = document.createElement("span");
                incorrectSpan.className = "attempt-stat-item incorrect";
                incorrectSpan.textContent = `✕ ${attempt.incorrectCount} incorrect`;

                statDetail.appendChild(correctSpan);
                statDetail.appendChild(incorrectSpan);

                bottomRow.appendChild(summarySpan);
                bottomRow.appendChild(statDetail);

                item.appendChild(topRow);
                item.appendChild(track);
                item.appendChild(bottomRow);

                elements.progressHistoryList.appendChild(item);
            });
        }
    }

    // 2. Render Daily Learning Activity
    if (elements.progressDailyEmptyState && elements.progressDailyContainer && elements.progressDailyList) {
        const dailyKeys = Object.keys(metrics.dailyActivity || {}).sort().reverse();
        let totalActiveDays = 0;

        elements.progressDailyList.innerHTML = "";

        dailyKeys.forEach(dateKey => {
            const dayData = metrics.dailyActivity[dateKey];
            if (!dayData) return;
            const hasActivity = (dayData.quizAttempts > 0) || (dayData.flashcardReviews > 0);
            if (!hasActivity) return;

            totalActiveDays++;
            const item = document.createElement("div");
            item.className = "progress-daily-item";
            item.setAttribute("role", "listitem");

            const dateSpan = document.createElement("div");
            dateSpan.className = "daily-item-date";
            const calIcon = document.createElement("i");
            calIcon.className = "fas fa-calendar-day";
            calIcon.setAttribute("aria-hidden", "true");
            dateSpan.appendChild(calIcon);
            dateSpan.appendChild(document.createTextNode(` ${dateKey}`));

            const badgesWrap = document.createElement("div");
            badgesWrap.className = "daily-item-badges";

            if (dayData.quizAttempts > 0) {
                const quizPill = document.createElement("span");
                quizPill.className = "daily-stat-pill quiz";
                const qIcon = document.createElement("i");
                qIcon.className = "fas fa-graduation-cap";
                qIcon.setAttribute("aria-hidden", "true");
                quizPill.appendChild(qIcon);
                quizPill.appendChild(document.createTextNode(` ${dayData.quizAttempts} ${dayData.quizAttempts === 1 ? 'quiz' : 'quizzes'} (${dayData.quizCorrect}/${dayData.quizCorrect + dayData.quizIncorrect} correct)`));
                badgesWrap.appendChild(quizPill);
            }

            if (dayData.flashcardReviews > 0) {
                const fcPill = document.createElement("span");
                fcPill.className = "daily-stat-pill flashcard";
                const fcIcon = document.createElement("i");
                fcIcon.className = "fas fa-layer-group";
                fcIcon.setAttribute("aria-hidden", "true");
                fcPill.appendChild(fcIcon);
                fcPill.appendChild(document.createTextNode(` ${dayData.flashcardReviews} ${dayData.flashcardReviews === 1 ? 'card' : 'cards'} reviewed`));
                badgesWrap.appendChild(fcPill);
            }

            item.appendChild(dateSpan);
            item.appendChild(badgesWrap);
            elements.progressDailyList.appendChild(item);
        });

        if (totalActiveDays === 0) {
            elements.progressDailyEmptyState.hidden = false;
            elements.progressDailyContainer.hidden = true;
        } else {
            elements.progressDailyEmptyState.hidden = true;
            elements.progressDailyContainer.hidden = false;
        }
    }
}

/* ==========================================================================
   Navigation & Accessible Modal Focus Trap
   ========================================================================== */

/**
 * Switch view between Translator, Vocabulary Notebook, Practice, and Progress
 * @param {"translator" | "notebook" | "practice" | "progress"} targetTab
 */
function switchTab(targetTab) {
    const validTabs = ["translator", "notebook", "practice", "progress"];
    const activeTab = validTabs.includes(targetTab) ? targetTab : "translator";
    notebookState.activeTab = activeTab;

    const tabConfig = [
        { key: "translator", tab: elements.tabTranslator, panel: elements.panelTranslator },
        { key: "notebook", tab: elements.tabNotebook, panel: elements.panelNotebook },
        { key: "practice", tab: elements.tabPractice, panel: elements.panelPractice },
        { key: "progress", tab: elements.tabProgress, panel: elements.panelProgress }
    ];

    tabConfig.forEach(({ key, tab, panel }) => {
        const isActive = key === activeTab;
        if (tab) {
            tab.classList.toggle("active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
            tab.setAttribute("tabindex", isActive ? "0" : "-1");
        }
        if (panel) {
            panel.hidden = !isActive;
            panel.classList.toggle("active", isActive);
        }
    });

    if (activeTab === "notebook") {
        if (typeof renderNotebookView === "function") renderNotebookView();
    } else if (activeTab === "practice") {
        if (typeof renderPracticeView === "function") renderPracticeView();
    } else if (activeTab === "progress") {
        if (typeof renderProgressView === "function") renderProgressView();
    } else if (typeof updateSaveButtonState === "function") {
        updateSaveButtonState();
    }
}


/**
 * Find all focusable elements inside the confirmation modal
 * @returns {Array<HTMLElement>}
 */
function getModalFocusableElements() {
    if (!elements.confirmModal) return [];
    return Array.from(elements.confirmModal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
}

/**
 * Open confirmation modal for clearing all entries with focus trap
 * @param {HTMLElement} [invokerElement]
 */
function openClearAllModal(invokerElement) {
    if (notebookState.entries.length === 0) return;
    if (!elements.confirmModal) return;

    elements.confirmModal._previousFocus = invokerElement || document.activeElement;
    elements.confirmModal.hidden = false;

    // Focus Cancel button by default to avoid accidental deletion
    if (elements.modalCancelBtn) {
        elements.modalCancelBtn.focus();
    }
}

/**
 * Close confirmation modal and restore focus safely to invoking control
 */
function closeClearAllModal() {
    if (!elements.confirmModal) return;
    elements.confirmModal.hidden = true;

    const previousFocus = elements.confirmModal._previousFocus;
    elements.confirmModal._previousFocus = null;

    if (previousFocus && document.body.contains(previousFocus) && typeof previousFocus.focus === "function" && !previousFocus.disabled) {
        try {
            previousFocus.focus();
        } catch {}
    } else if (elements.notebookClearAllBtn && !elements.notebookClearAllBtn.disabled) {
        try {
            elements.notebookClearAllBtn.focus();
        } catch {}
    } else if (elements.tabNotebook) {
        try {
            elements.tabNotebook.focus();
        } catch {}
    }
}

/**
 * Handle Tab focus trap and Escape cancellation inside modal
 * @param {KeyboardEvent} e
 */
function handleModalKeydown(e) {
    if (!elements.confirmModal || elements.confirmModal.hidden) return;

    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeClearAllModal();
        return;
    }

    if (e.key === "Tab") {
        const focusable = getModalFocusableElements();
        if (focusable.length === 0) {
            e.preventDefault();
            return;
        }

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
            // Shift + Tab: wrap to last element
            if (document.activeElement === firstElement || !elements.confirmModal.contains(document.activeElement)) {
                e.preventDefault();
                lastElement.focus();
            }
        } else {
            // Tab: wrap to first element
            if (document.activeElement === lastElement || !elements.confirmModal.contains(document.activeElement)) {
                e.preventDefault();
                firstElement.focus();
            }
        }
    }
}

/**
 * Guard against focus escaping modal
 * @param {FocusEvent} e
 */
function handleModalFocusIn(e) {
    if (!elements.confirmModal || elements.confirmModal.hidden) return;
    if (!elements.confirmModal.contains(e.target)) {
        e.stopPropagation();
        const focusable = getModalFocusableElements();
        if (focusable.length > 0) {
            focusable[0].focus();
        }
    }
}

/**
 * Find all focusable elements inside the reset confirmation modal
 * @returns {Array<HTMLElement>}
 */
function getResetModalFocusableElements() {
    if (!elements.progressResetModal) return [];
    return Array.from(elements.progressResetModal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
}

/**
 * Open confirmation modal for resetting learning history with focus trap
 * @param {HTMLElement} [invokerElement]
 */
function openResetHistoryModal(invokerElement) {
    if (!elements.progressResetModal) return;

    elements.progressResetModal._previousFocus = invokerElement || document.activeElement;
    elements.progressResetModal.hidden = false;

    if (elements.resetModalCancelBtn) {
        elements.resetModalCancelBtn.focus();
    }
}

/**
 * Close reset confirmation modal and restore focus safely to invoking control
 */
function closeResetHistoryModal() {
    if (!elements.progressResetModal) return;
    elements.progressResetModal.hidden = true;

    const previousFocus = elements.progressResetModal._previousFocus;
    elements.progressResetModal._previousFocus = null;

    if (previousFocus && document.body.contains(previousFocus) && typeof previousFocus.focus === "function" && !previousFocus.disabled) {
        try {
            previousFocus.focus();
        } catch {}
    } else if (elements.progressResetHistoryBtn && !elements.progressResetHistoryBtn.disabled) {
        try {
            elements.progressResetHistoryBtn.focus();
        } catch {}
    } else if (elements.tabProgress) {
        try {
            elements.tabProgress.focus();
        } catch {}
    }
}

/**
 * Handle Tab focus trap and Escape cancellation inside reset modal
 * @param {KeyboardEvent} e
 */
function handleResetModalKeydown(e) {
    if (!elements.progressResetModal || elements.progressResetModal.hidden) return;

    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeResetHistoryModal();
        return;
    }

    if (e.key === "Tab") {
        const focusable = getResetModalFocusableElements();
        if (focusable.length === 0) {
            e.preventDefault();
            return;
        }

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
            if (document.activeElement === firstElement || !elements.progressResetModal.contains(document.activeElement)) {
                e.preventDefault();
                lastElement.focus();
            }
        } else {
            if (document.activeElement === lastElement || !elements.progressResetModal.contains(document.activeElement)) {
                e.preventDefault();
                firstElement.focus();
            }
        }
    }
}

/**
 * Guard against focus escaping reset modal
 * @param {FocusEvent} e
 */
function handleResetModalFocusIn(e) {
    if (!elements.progressResetModal || elements.progressResetModal.hidden) return;
    if (!elements.progressResetModal.contains(e.target)) {
        e.stopPropagation();
        const focusable = getResetModalFocusableElements();
        if (focusable.length > 0) {
            focusable[0].focus();
        }
    }
}

/**
 * Reset learning history without modifying vocabulary entries or favorites
 */
function resetLearningHistory() {
    if (StorageAdapter.isProtected) {
        progressState.flashcardReviews = 0;
        progressState.cardAssessments = {};
        progressState.dailyActivity = {};
        progressState.quizHistory = [];
        if (progressState.reviewedCardIds) {
            progressState.reviewedCardIds.clear();
        }
        practiceState.sessionResults.clear();
        StorageAdapter.memoryStore.learningHistory = {
            quizHistory: [],
            flashcardStats: { totalReviews: 0, cardAssessments: {} },
            dailyActivity: {}
        };
        renderProgressView();
        if (notebookState.activeTab === "practice") {
            renderPracticeView();
        }
        showStatus("Storage is in protected recovery mode. Learning history was reset in memory without modifying storage.", "info", 6000);
        return;
    }

    const emptyHistory = {
        quizHistory: [],
        flashcardStats: {
            totalReviews: 0,
            cardAssessments: {}
        },
        dailyActivity: {}
    };

    const saveRes = StorageAdapter.save(notebookState.entries, emptyHistory);

    if (saveRes.success) {
        progressState.flashcardReviews = 0;
        progressState.cardAssessments = {};
        progressState.dailyActivity = {};
        progressState.quizHistory = [];
        if (progressState.reviewedCardIds) {
            progressState.reviewedCardIds.clear();
        }
        practiceState.sessionResults.clear();
        renderProgressView();
        if (notebookState.activeTab === "practice") {
            renderPracticeView();
        }

        if (saveRes.persistedToDisk) {
            showStatus("Learning history was permanently reset. Your vocabulary entries were preserved.", "success", 4000);
        } else {
            showStatus("Learning history was reset for this session (running in session memory mode).", "info", 4000);
        }
    } else {
        showStatus("Failed to reset learning history: " + (saveRes.error || "Storage write error"), "error", 5000);
    }
}

/**
 * Handle keyboard navigation specifically for active Quiz mode
 * @param {KeyboardEvent} e
 */
function handleQuizKeydown(e) {
    if (notebookState.activeTab !== "practice" || practiceState.subMode !== "quiz") return;
    if (quizState.status !== "active") return;
    if (elements.confirmModal && !elements.confirmModal.hidden) return;
    if (elements.progressResetModal && !elements.progressResetModal.hidden) return;

    // Ignore if user is currently typing in an input, textarea, or select
    const targetTag = e.target?.tagName?.toLowerCase();
    if (targetTag === "input" || targetTag === "textarea" || targetTag === "select") return;

    // Multiple choice keys 1-4
    if (["1", "2", "3", "4"].includes(e.key)) {
        const optionIndex = parseInt(e.key, 10) - 1;
        const currentQ = quizState.questions[quizState.currentIndex];
        if (currentQ && optionIndex < currentQ.options.length && !quizState.isAnswerSubmitted) {
            e.preventDefault();
            selectQuizOption(optionIndex);
        }
    } else if (e.key === "Enter") {
        if (quizState.isAnswerSubmitted) {
            e.preventDefault();
            nextQuizQuestion();
        }
    } else if (e.key === "Escape") {
        e.preventDefault();
        exitQuizToSetup();
    }
}

/* ==========================================================================
   Event Listeners & Initialization
   ========================================================================== */

let isListenersInitialized = false;

function initializeEventListeners() {
    if (isListenersInitialized) return;
    isListenersInitialized = true;

    // Navigation Tabs
    if (elements.tabTranslator) {
        elements.tabTranslator.addEventListener("click", () => switchTab("translator"));
    }

    if (elements.tabNotebook) {
        elements.tabNotebook.addEventListener("click", () => switchTab("notebook"));
    }

    if (elements.tabPractice) {
        elements.tabPractice.addEventListener("click", () => switchTab("practice"));
    }

    if (elements.tabProgress) {
        elements.tabProgress.addEventListener("click", () => switchTab("progress"));
    }

    // Keyboard navigation across tabs (ArrowLeft, ArrowRight, Home, End)
    const tabList = [
        { el: elements.tabTranslator, key: "translator" },
        { el: elements.tabNotebook, key: "notebook" },
        { el: elements.tabPractice, key: "practice" },
        { el: elements.tabProgress, key: "progress" }
    ].filter(item => Boolean(item.el));

    tabList.forEach((item, index) => {
        item.el.addEventListener("keydown", (e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                const nextIndex = (index + 1) % tabList.length;
                tabList[nextIndex].el.focus();
                switchTab(tabList[nextIndex].key);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                const prevIndex = (index - 1 + tabList.length) % tabList.length;
                tabList[prevIndex].el.focus();
                switchTab(tabList[prevIndex].key);
            } else if (e.key === "Home") {
                e.preventDefault();
                tabList[0].el.focus();
                switchTab(tabList[0].key);
            } else if (e.key === "End") {
                e.preventDefault();
                tabList[tabList.length - 1].el.focus();
                switchTab(tabList[tabList.length - 1].key);
            }
        });
    });

    // Translation Controls
    if (elements.translateBtn) {
        elements.translateBtn.addEventListener("click", () => translateText());
    }

    if (elements.exchangeBtn) {
        elements.exchangeBtn.addEventListener("click", () => swapLanguages());
    }

    if (elements.saveTranslationBtn) {
        elements.saveTranslationBtn.addEventListener("click", () => saveCurrentTranslation());
    }

    // Language selection changes: cancel in-flight and invalidate old translation
    const handleLanguageChange = () => {
        if (state.isTranslating) {
            cancelActiveRequest();
            clearStatus();
        }
        if (elements.toText && elements.toText.value) {
            elements.toText.value = "";
            elements.toText.placeholder = "Press Translate to update translation...";
        }
        state.lastTranslatedFromCode = "";
        state.lastTranslatedToCode = "";
        updateSaveButtonState();
    };

    if (elements.selectFrom) {
        elements.selectFrom.addEventListener("change", handleLanguageChange);
    }

    if (elements.selectTo) {
        elements.selectTo.addEventListener("change", handleLanguageChange);
    }

    // Source text changes & Keyboard Shortcut
    if (elements.fromText) {
        elements.fromText.addEventListener("input", () => {
            const currentText = elements.fromText.value.trim();

            if (state.isTranslating) {
                cancelActiveRequest();
                clearStatus();
            }

            if (!currentText) {
                if (elements.toText) {
                    elements.toText.value = "";
                    elements.toText.placeholder = "Translation will appear here...";
                }
                state.lastTranslatedSourceText = "";
                clearStatus();
                updateSaveButtonState();
                return;
            }

            if (elements.toText && elements.toText.value && currentText !== state.lastTranslatedSourceText) {
                elements.toText.value = "";
                elements.toText.placeholder = "Press Translate to update translation...";
            }

            updateSaveButtonState();
        });

        elements.fromText.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                translateText();
            }
        });
    }

    // Translator Action Buttons: Copy & Speech
    if (elements.fromCopyBtn) {
        elements.fromCopyBtn.addEventListener("click", (e) => copyText(true, e.currentTarget));
    }

    if (elements.toCopyBtn) {
        elements.toCopyBtn.addEventListener("click", (e) => copyText(false, e.currentTarget));
    }

    if (elements.fromVolumeBtn) {
        elements.fromVolumeBtn.addEventListener("click", (e) => speakText(true, e.currentTarget));
    }

    if (elements.toVolumeBtn) {
        elements.toVolumeBtn.addEventListener("click", (e) => speakText(false, e.currentTarget));
    }

    // Notebook Toolbar Controls
    if (elements.notebookSearchInput) {
        elements.notebookSearchInput.addEventListener("input", (e) => {
            notebookState.searchQuery = e.target.value;
            if (elements.notebookSearchClearBtn) {
                elements.notebookSearchClearBtn.hidden = !e.target.value;
            }
            renderNotebookView();
        });
    }

    if (elements.notebookSearchClearBtn) {
        elements.notebookSearchClearBtn.addEventListener("click", () => {
            if (elements.notebookSearchInput) {
                elements.notebookSearchInput.value = "";
                elements.notebookSearchInput.focus();
            }
            notebookState.searchQuery = "";
            elements.notebookSearchClearBtn.hidden = true;
            renderNotebookView();
        });
    }

    if (elements.notebookLangFilter) {
        elements.notebookLangFilter.addEventListener("change", (e) => {
            notebookState.languageFilter = e.target.value;
            renderNotebookView();
        });
    }

    if (elements.notebookFavFilterBtn) {
        elements.notebookFavFilterBtn.addEventListener("click", () => {
            notebookState.favoritesOnly = !notebookState.favoritesOnly;
            elements.notebookFavFilterBtn.setAttribute("aria-pressed", notebookState.favoritesOnly ? "true" : "false");
            const icon = elements.notebookFavFilterBtn.querySelector("i");
            if (icon) {
                icon.className = notebookState.favoritesOnly ? "fas fa-star" : "far fa-star";
            }
            renderNotebookView();
        });
    }

    if (elements.notebookClearAllBtn) {
        elements.notebookClearAllBtn.addEventListener("click", (e) => openClearAllModal(e.currentTarget));
    }

    if (elements.notebookResetFiltersBtn) {
        elements.notebookResetFiltersBtn.addEventListener("click", () => resetNotebookFilters());
    }

    if (elements.emptyStartTranslatingBtn) {
        elements.emptyStartTranslatingBtn.addEventListener("click", () => {
            switchTab("translator");
            elements.fromText?.focus();
        });
    }

    // Practice & Flashcard Controls
    if (elements.flashcardFlipBtn) {
        elements.flashcardFlipBtn.addEventListener("click", () => toggleFlashcardAnswer());
    }

    if (elements.practiceKnewItBtn) {
        elements.practiceKnewItBtn.addEventListener("click", () => recordPracticeResult("knew"));
    }

    if (elements.practiceNeedWorkBtn) {
        elements.practiceNeedWorkBtn.addEventListener("click", () => recordPracticeResult("practice"));
    }

    if (elements.practicePrevBtn) {
        elements.practicePrevBtn.addEventListener("click", () => navigatePracticeCard("prev"));
    }

    if (elements.practiceNextBtn) {
        elements.practiceNextBtn.addEventListener("click", () => navigatePracticeCard("next"));
    }

    if (elements.practiceRestartBtn) {
        elements.practiceRestartBtn.addEventListener("click", () => restartPracticeSession());
    }

    if (elements.practiceEmptyTranslateBtn) {
        elements.practiceEmptyTranslateBtn.addEventListener("click", () => {
            switchTab("translator");
            elements.fromText?.focus();
        });
    }

    if (elements.practiceEmptyNotebookBtn) {
        elements.practiceEmptyNotebookBtn.addEventListener("click", () => {
            switchTab("notebook");
            elements.notebookSearchInput?.focus();
        });
    }

    if (elements.flashcardFrontSpeakBtn) {
        elements.flashcardFrontSpeakBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const currentEntry = notebookState.entries[practiceState.currentIndex];
            if (currentEntry) {
                pronounceText(currentEntry.sourceText, currentEntry.fromCode, "original text", elements.flashcardFrontSpeakBtn);
            }
        });
    }

    if (elements.flashcardBackSpeakBtn) {
        elements.flashcardBackSpeakBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const currentEntry = notebookState.entries[practiceState.currentIndex];
            if (currentEntry) {
                pronounceText(currentEntry.translatedText, currentEntry.toCode, "translated text", elements.flashcardBackSpeakBtn);
            }
        });
    }

    if (elements.flashcard) {
        elements.flashcard.addEventListener("keydown", (e) => {
            if (e.key === " " || e.key === "Enter") {
                if (e.target === elements.flashcard) {
                    e.preventDefault();
                    toggleFlashcardAnswer();
                }
            } else if (e.key === "ArrowLeft") {
                if (e.target === elements.flashcard) {
                    e.preventDefault();
                    navigatePracticeCard("prev");
                }
            } else if (e.key === "ArrowRight") {
                if (e.target === elements.flashcard) {
                    e.preventDefault();
                    navigatePracticeCard("next");
                }
            }
        });
    }

    // Confirmation Modal Controls
    if (elements.modalCancelBtn) {
        elements.modalCancelBtn.addEventListener("click", () => closeClearAllModal());
    }

    if (elements.modalConfirmBtn) {
        elements.modalConfirmBtn.addEventListener("click", () => {
            closeClearAllModal();
            clearAllEntries();
        });
    }

    if (elements.confirmModal) {
        // Close on backdrop click outside modal card
        elements.confirmModal.addEventListener("click", (e) => {
            if (e.target === elements.confirmModal) {
                closeClearAllModal();
            }
        });

        // Focus trap & escape key handler (safe document listeners)
        document.removeEventListener("keydown", handleModalKeydown);
        document.addEventListener("keydown", handleModalKeydown);

        document.removeEventListener("focusin", handleModalFocusIn);
        document.addEventListener("focusin", handleModalFocusIn);
    }

    // Practice Sub-Mode Controls (Flashcards vs Quiz)
    if (elements.practiceModeFlashcardsBtn) {
        elements.practiceModeFlashcardsBtn.addEventListener("click", () => switchPracticeSubMode("flashcards"));
    }

    if (elements.practiceModeQuizBtn) {
        elements.practiceModeQuizBtn.addEventListener("click", () => switchPracticeSubMode("quiz"));
    }

    // Quiz Setup Controls
    if (elements.quizDirForwardBtn) {
        elements.quizDirForwardBtn.addEventListener("click", () => {
            quizState.direction = "forward";
            elements.quizDirForwardBtn.classList.add("active");
            elements.quizDirForwardBtn.setAttribute("aria-checked", "true");
            if (elements.quizDirReverseBtn) {
                elements.quizDirReverseBtn.classList.remove("active");
                elements.quizDirReverseBtn.setAttribute("aria-checked", "false");
            }
            updateQuizSetupOptions();
        });
    }

    if (elements.quizDirReverseBtn) {
        elements.quizDirReverseBtn.addEventListener("click", () => {
            quizState.direction = "reverse";
            elements.quizDirReverseBtn.classList.add("active");
            elements.quizDirReverseBtn.setAttribute("aria-checked", "true");
            if (elements.quizDirForwardBtn) {
                elements.quizDirForwardBtn.classList.remove("active");
                elements.quizDirForwardBtn.setAttribute("aria-checked", "false");
            }
            updateQuizSetupOptions();
        });
    }

    if (elements.quizLangPairSelect) {
        elements.quizLangPairSelect.addEventListener("change", (e) => {
            quizState.selectedLanguagePair = e.target.value;
            updateQuizSetupOptions();
        });
    }

    if (elements.quizCountSelect) {
        elements.quizCountSelect.addEventListener("change", (e) => {
            quizState.questionCount = e.target.value === "all" ? "all" : parseInt(e.target.value, 10);
        });
    }

    if (elements.quizShuffleCheck) {
        elements.quizShuffleCheck.addEventListener("change", (e) => {
            quizState.shuffleOrder = e.target.checked;
        });
    }

    if (elements.quizStartBtn) {
        elements.quizStartBtn.addEventListener("click", () => startQuiz());
    }

    // Active Quiz Controls
    if (elements.quizQuitBtn) {
        elements.quizQuitBtn.addEventListener("click", () => exitQuizToSetup());
    }

    if (elements.quizNextBtn) {
        elements.quizNextBtn.addEventListener("click", () => nextQuizQuestion());
    }

    if (elements.quizPromptSpeakBtn) {
        elements.quizPromptSpeakBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (quizState.status === "active" && quizState.questions && quizState.questions[quizState.currentIndex]) {
                const q = quizState.questions[quizState.currentIndex];
                pronounceText(q.promptText, q.promptLangCode, "question prompt", elements.quizPromptSpeakBtn);
            }
        });
    }

    // Quiz Results & Review Controls
    if (elements.quizRetakeBtn) {
        elements.quizRetakeBtn.addEventListener("click", () => retakeQuiz());
    }

    if (elements.quizSettingsBtn) {
        elements.quizSettingsBtn.addEventListener("click", () => exitQuizToSetup());
    }

    if (elements.quizBackFlashcardsBtn) {
        elements.quizBackFlashcardsBtn.addEventListener("click", () => switchPracticeSubMode("flashcards"));
    }

    if (elements.quizWarningFlashcardsBtn) {
        elements.quizWarningFlashcardsBtn.addEventListener("click", () => switchPracticeSubMode("flashcards"));
    }

    if (elements.quizWarningTranslateBtn) {
        elements.quizWarningTranslateBtn.addEventListener("click", () => {
            switchTab("translator");
            elements.fromText?.focus();
        });
    }

    if (elements.quizReviewToggleBtn) {
        elements.quizReviewToggleBtn.addEventListener("click", () => {
            if (!elements.quizReviewList) return;
            const isCurrentlyHidden = elements.quizReviewList.hidden;
            elements.quizReviewList.hidden = !isCurrentlyHidden;
            elements.quizReviewToggleBtn.setAttribute("aria-expanded", isCurrentlyHidden ? "true" : "false");
            const icon = elements.quizReviewToggleBtn.querySelector(".toggle-icon");
            if (icon) {
                icon.className = isCurrentlyHidden ? "fas fa-chevron-up toggle-icon" : "fas fa-chevron-down toggle-icon";
            }
        });
    }

    // Learning Progress Dashboard Action Buttons
    if (elements.progressEmptyQuizBtn) {
        elements.progressEmptyQuizBtn.addEventListener("click", () => {
            switchTab("practice");
            switchPracticeSubMode("quiz");
        });
    }

    if (elements.progressEmptyFlashcardsBtn) {
        elements.progressEmptyFlashcardsBtn.addEventListener("click", () => {
            switchTab("practice");
            switchPracticeSubMode("flashcards");
        });
    }

    if (elements.progressResetHistoryBtn) {
        elements.progressResetHistoryBtn.addEventListener("click", (e) => openResetHistoryModal(e.currentTarget));
    }

    // Reset Confirmation Modal Controls
    if (elements.resetModalCancelBtn) {
        elements.resetModalCancelBtn.addEventListener("click", () => closeResetHistoryModal());
    }

    if (elements.resetModalConfirmBtn) {
        elements.resetModalConfirmBtn.addEventListener("click", () => {
            closeResetHistoryModal();
            resetLearningHistory();
        });
    }

    if (elements.progressResetModal) {
        elements.progressResetModal.addEventListener("click", (e) => {
            if (e.target === elements.progressResetModal) {
                closeResetHistoryModal();
            }
        });

        document.removeEventListener("keydown", handleResetModalKeydown);
        document.addEventListener("keydown", handleResetModalKeydown);

        document.removeEventListener("focusin", handleResetModalFocusIn);
        document.addEventListener("focusin", handleResetModalFocusIn);
    }

    // Document-level keyboard listener for Quiz shortcuts (1-4, Enter, Escape)
    document.removeEventListener("keydown", handleQuizKeydown);
    document.addEventListener("keydown", handleQuizKeydown);
}

function initializeApp() {
    // 1. Populate translator dropdowns
    populateLanguageOptions(elements.selectFrom, DEFAULT_SOURCE_CODE);
    populateLanguageOptions(elements.selectTo, DEFAULT_TARGET_CODE);

    // 2. Initialize storage adapter and load entries & learning history
    StorageAdapter.init();
    const loadResult = StorageAdapter.load();
    notebookState.entries = loadResult.entries;

    if (loadResult.learningHistory) {
        progressState.flashcardReviews = loadResult.learningHistory.flashcardStats?.totalReviews || 0;
        progressState.cardAssessments = loadResult.learningHistory.flashcardStats?.cardAssessments || {};
        progressState.dailyActivity = loadResult.learningHistory.dailyActivity || {};
        progressState.quizHistory = Array.isArray(loadResult.learningHistory.quizHistory) ? loadResult.learningHistory.quizHistory : [];
    }

    // 3. Initialize UI state
    updateNotebookBadge();
    updateNotebookLanguageFilterOptions();
    renderNotebookView();
    syncPracticeState();
    updateSaveButtonState();
    updateProgressDashboard();
    renderProgressView();

    // 4. Attach event listeners
    initializeEventListeners();

    // 5. Notify user of storage conditions if relevant
    if (loadResult.notice === "UNSUPPORTED_VERSION_PRESERVED") {
        showStatus(`A newer storage version (v${loadResult.unsupportedVersion}) was detected. Existing storage was preserved; changes are saved in memory for this session only.`, "info", 8000);
    } else if (loadResult.notice === "CORRUPTED_JSON_PRESERVED" || loadResult.notice === "INVALID_STRUCTURE_PRESERVED" || loadResult.notice === "CORRUPTED_ENTRIES_PRESERVED" || loadResult.notice === "PROTECTED_RECOVERY_ACTIVE") {
        showStatus("Stored vocabulary contained corrupted data. Started clean session in protected recovery mode without overwriting storage.", "info", 7000);
    } else if (loadResult.notice === "SESSION_FALLBACK_ACTIVE" || loadResult.notice === "STORAGE_READ_FAILED") {
        showStatus("Local storage is unavailable. Running in session memory mode (entries will not survive page refresh).", "info", 6500);
    } else if (loadResult.notice === "VERSION_1_MIGRATED") {
        showStatus("Saved vocabulary and progress were safely migrated to schema v2.", "info", 5000);
    } else if (loadResult.notice === "VERSION_1_MIGRATION_FAILED_SESSION_ONLY") {
        showStatus("Version 1 entries were loaded for this session, but could not be saved to disk. Original data preserved.", "info", 7000);
    } else if (loadResult.notice === "LEGACY_DATA_MIGRATED") {
        showStatus("Legacy saved translations were safely migrated to version 2 schema.", "info", 5000);
    } else if (loadResult.notice === "LEGACY_MIGRATION_FAILED_SESSION_ONLY") {
        showStatus("Legacy entries were loaded for this session, but could not be saved to disk. Original data preserved.", "info", 7000);
    }
}

// Initialize on DOM ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
} else {
    initializeApp();
}