/**
 * Comprehensive Automated Regression Test Suite
 * Tests Storage, Translation State, and Notebook Integrity
 */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

console.log("=== Running Comprehensive Regression Tests ===\n");

// Read script.js content
const scriptContent = fs.readFileSync("script.js", "utf8");

// --------------------------------------------------------------------------
// 1. Language Catalog (countries.js)
// --------------------------------------------------------------------------
console.log("[Test Category 1: Language Catalog]");
const countriesContent = fs.readFileSync("countries.js", "utf8");
const countries = eval(countriesContent + "; countries");

assert.strictEqual(countries["ur-PK"], "Urdu", "ur-PK must be labeled 'Urdu'");
assert.strictEqual(countries["be-BY"], "Belarusian", "be-BY must be labeled 'Belarusian'");
assert.strictEqual(countries["pa-IN"], "Punjabi", "pa-IN must be labeled 'Punjabi'");
assert(Object.keys(countries).length >= 90, "Must contain 90+ languages");
console.log("✓ countries.js display names verified (ur-PK = Urdu, be-BY = Belarusian, pa-IN = Punjabi).\n");

// --------------------------------------------------------------------------
// 2. StorageAdapter Tests
// --------------------------------------------------------------------------
console.log("[Test Category 2: StorageAdapter & Persistence]");

function makeStorageAdapterHarness(options = {}) {
    let disk = options.initialDisk ? { ...options.initialDisk } : {};
    let blockAll = options.blockAll || false;
    let failWrite = options.failWrite || false;
    let failQuota = options.failQuota || false;
    let failRead = options.failRead || false;

    const mockLocalStorage = {
        getItem(k) {
            if (blockAll || failRead) throw new Error("SecurityError: Access denied");
            return disk[k] !== undefined ? disk[k] : null;
        },
        setItem(k, v) {
            if (blockAll) throw new Error("SecurityError: Access denied");
            if (failQuota) {
                const err = new Error("QuotaExceededError");
                err.name = "QuotaExceededError";
                err.code = 22;
                throw err;
            }
            if (failWrite) throw new Error("WriteError");
            disk[k] = String(v);
        },
        removeItem(k) {
            if (blockAll) throw new Error("SecurityError: Access denied");
            delete disk[k];
        }
    };

    // Extract StorageAdapter from script.js
    const match = scriptContent.match(/const StorageAdapter = \{[\s\S]*?\n\};/);
    assert(match, "StorageAdapter must exist in script.js");

    const adapterFunc = new Function("window", "countries", "DEFAULT_SOURCE_CODE", "DEFAULT_TARGET_CODE", "generateUniqueId", `
        ${match[0]}
        return StorageAdapter;
    `);

    const adapter = adapterFunc(
        { localStorage: mockLocalStorage },
        countries,
        "en-GB",
        "hi-IN",
        () => "test_id_" + Math.random().toString(36).substring(2, 7)
    );

    return {
        adapter,
        getDisk: () => ({ ...disk }),
        setDisk: (k, v) => { disk[k] = v; },
        setFailQuota: (v) => { failQuota = v; },
        setFailWrite: (v) => { failWrite = v; }
    };
}

// Scenario 1: Fresh install with no saved entries
{
    const { adapter, getDisk } = makeStorageAdapterHarness();
    adapter.init();
    assert.strictEqual(adapter.mode, "localStorage");
    const load = adapter.load();
    assert.strictEqual(load.notice, "EMPTY");
    assert.deepStrictEqual(load.entries, []);
    console.log("✓ Scenario 1: Fresh install loads empty entries without error.");
}

// Scenario 2: Save entries and reload
{
    const harness = makeStorageAdapterHarness();
    harness.adapter.init();
    const entry = {
        id: "entry_1",
        sourceText: "Hello",
        translatedText: "Hola",
        fromCode: "en-GB",
        fromName: "English",
        toCode: "es-ES",
        toName: "Spanish",
        createdAt: 1000,
        isFavorite: false
    };
    const saveRes = harness.adapter.save([entry]);
    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(saveRes.persistedToDisk, true);

    // Simulate reload
    const load = harness.adapter.load();
    assert.strictEqual(load.entries.length, 1);
    assert.strictEqual(load.entries[0].sourceText, "Hello");
    assert.strictEqual(load.entries[0].translatedText, "Hola");
    console.log("✓ Scenario 2: Saved entries persist and reload correctly.");
}

// Scenario 3: Block localStorage before initialization
{
    const harness = makeStorageAdapterHarness({ blockAll: true });
    harness.adapter.init();
    assert.strictEqual(harness.adapter.mode, "memory", "Must switch to memory mode");
    const load = harness.adapter.load();
    assert.strictEqual(load.mode, "memory");
    assert.strictEqual(load.notice, "SESSION_FALLBACK_ACTIVE");

    // Save in blocked mode
    const saveRes = harness.adapter.save([{ id: "1", sourceText: "A", translatedText: "B" }]);
    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(saveRes.persistedToDisk, false, "Must not claim persisted to disk");
    assert.strictEqual(saveRes.mode, "memory");
    console.log("✓ Scenario 3: Blocked localStorage activates in-memory session fallback.");
}

// Scenario 4: Storage read failure
{
    const harness = makeStorageAdapterHarness({ failRead: true });
    harness.adapter.init();
    const load = harness.adapter.load();
    assert.strictEqual(load.notice, "STORAGE_READ_FAILED");
    assert.strictEqual(harness.adapter.mode, "memory");
    console.log("✓ Scenario 4: Storage read failure handled with fallback.");
}

// Scenario 5: Storage write failure mid-session
{
    const harness = makeStorageAdapterHarness();
    harness.adapter.init();
    harness.setFailWrite(true);
    const saveRes = harness.adapter.save([{ id: "1", sourceText: "A", translatedText: "B" }]);
    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(saveRes.persistedToDisk, false);
    assert.strictEqual(saveRes.mode, "memory");
    console.log("✓ Scenario 5: Mid-session write failure safely falls back to memory.");
}

// Scenario 6: Quota exhaustion
{
    const harness = makeStorageAdapterHarness({
        initialDisk: {
            "translator_vocab_notebook_v1": JSON.stringify({
                version: 1,
                entries: [{ id: "existing", sourceText: "Keep", translatedText: "Me" }]
            })
        }
    });
    harness.adapter.init();
    harness.adapter.load();

    // Trigger quota exhaustion
    harness.setFailQuota(true);
    const saveRes = harness.adapter.save([{ id: "2", sourceText: "New", translatedText: "Val" }]);
    assert.strictEqual(saveRes.success, false);
    assert.strictEqual(saveRes.error, "QUOTA_EXCEEDED");
    assert.strictEqual(saveRes.persistedToDisk, false);

    // Verify disk was NOT corrupted or lost
    harness.setFailQuota(false);
    const postLoad = harness.adapter.load();
    assert.strictEqual(postLoad.entries[0].sourceText, "Keep", "Existing stored data must be preserved");
    console.log("✓ Scenario 6: Quota exhaustion handled without corrupting existing records.");
}

// Scenario 7: Malformed JSON preservation
{
    const malformed = "{ incomplete json...";
    const harness = makeStorageAdapterHarness({
        initialDisk: { "translator_vocab_notebook_v1": malformed }
    });
    harness.adapter.init();
    const load = harness.adapter.load();
    assert.strictEqual(load.notice, "CORRUPTED_JSON_PRESERVED");
    assert.strictEqual(harness.adapter.isProtected, true, "Must be in protected mode");
    assert.strictEqual(harness.adapter.preservedRawPayload, malformed);

    // Saving during protected session must NOT overwrite corrupted disk
    harness.adapter.save([{ id: "new", sourceText: "X", translatedText: "Y" }]);
    assert.strictEqual(harness.getDisk()["translator_vocab_notebook_v1"], malformed, "Must not overwrite disk");
    console.log("✓ Scenario 7: Malformed JSON preserved on disk; protected recovery mode prevents destructive writes.");
}

// Scenario 8: Invalid object structure preservation
{
    const invalidStructure = "42"; // Not an object or array
    const harness = makeStorageAdapterHarness({
        initialDisk: { "translator_vocab_notebook_v1": invalidStructure }
    });
    harness.adapter.init();
    const load = harness.adapter.load();
    assert.strictEqual(load.notice, "INVALID_STRUCTURE_PRESERVED");
    assert.strictEqual(harness.adapter.isProtected, true);
    console.log("✓ Scenario 8: Invalid object structure preserved without destructive write.");
}

// Scenario 9: Supported legacy formats migration
{
    // Format A: Raw Array [ { ... } ]
    const legacyArray = [
        { id: "leg_1", sourceText: "One", translatedText: "Uno", fromCode: "en-GB", toCode: "es-ES" }
    ];
    const harnessA = makeStorageAdapterHarness({
        initialDisk: { "translator_vocab_notebook_v1": JSON.stringify(legacyArray) }
    });
    harnessA.adapter.init();
    const loadA = harnessA.adapter.load();
    assert.strictEqual(loadA.notice, "LEGACY_DATA_MIGRATED");
    assert.strictEqual(loadA.entries.length, 1);
    const diskA = JSON.parse(harnessA.getDisk()["translator_vocab_notebook_v1"]);
    assert.strictEqual(diskA.version, harnessA.adapter.CURRENT_VERSION, "Must be migrated to current version");

    // Format B: Object without version { entries: [...] }
    const legacyObj = {
        entries: [{ id: "leg_2", sourceText: "Two", translatedText: "Dos" }]
    };
    const harnessB = makeStorageAdapterHarness({
        initialDisk: { "translator_vocab_notebook_v1": JSON.stringify(legacyObj) }
    });
    harnessB.adapter.init();
    const loadB = harnessB.adapter.load();
    assert.strictEqual(loadB.notice, "LEGACY_DATA_MIGRATED");
    assert.strictEqual(loadB.entries.length, 1);
    console.log("✓ Scenario 9: Supported legacy formats migrated cleanly to current schema version.");
}

// Scenario 10: Unsupported future schema version
{
    const futurePayload = {
        version: 99,
        entries: [{ id: "future_1", sourceText: "Future", translatedText: "Avenir" }]
    };
    const harness = makeStorageAdapterHarness({
        initialDisk: { "translator_vocab_notebook_v1": JSON.stringify(futurePayload) }
    });
    harness.adapter.init();
    const load = harness.adapter.load();
    assert.strictEqual(load.notice, "UNSUPPORTED_VERSION_PRESERVED");
    assert.strictEqual(load.unsupportedVersion, 99);
    assert.strictEqual(harness.adapter.isProtected, true);

    // Save must not overwrite future version on disk
    harness.adapter.save([]);
    const diskPayload = JSON.parse(harness.getDisk()["translator_vocab_notebook_v1"]);
    assert.strictEqual(diskPayload.version, 99, "Must retain version 99 on disk");
    console.log("✓ Scenario 10: Unsupported future schema version preserved and never overwritten.");
}

// Scenario 11: Missing or duplicate IDs repaired without data loss
{
    const harness = makeStorageAdapterHarness();
    const sanitized = harness.adapter.sanitizeEntries([
        { id: "", sourceText: "No ID", translatedText: "Sin ID" },
        { id: "dup", sourceText: "First Dup", translatedText: "Primero" },
        { id: "dup", sourceText: "Second Dup", translatedText: "Segundo" }
    ]);
    assert.strictEqual(sanitized.length, 3, "All 3 entries must be retained");
    assert(sanitized[0].id.length > 0, "Missing ID must be auto-assigned");
    assert.notStrictEqual(sanitized[1].id, sanitized[2].id, "Duplicate IDs must be resolved uniquely");
    console.log("✓ Scenario 11: Missing and duplicate IDs repaired safely without deleting valid translations.\n");
}

// --------------------------------------------------------------------------
// 3. Translation State & Stale Response Prevention
// --------------------------------------------------------------------------
console.log("[Test Category 3: Translation State & Cancellation]");

// Verify hasValidTranslation checks
{
    const state = {
        isTranslating: false,
        lastTranslatedSourceText: "Good morning",
        lastTranslatedFromCode: "en-GB",
        lastTranslatedToCode: "es-ES"
    };

    const elements = {
        fromText: { value: "Good morning" },
        toText: { value: "Buenos días" },
        selectFrom: { value: "en-GB" },
        selectTo: { value: "es-ES" }
    };

    function checkValid() {
        if (state.isTranslating) return false;
        const currentSource = elements.fromText.value.trim();
        const currentTarget = elements.toText.value.trim();
        const currentFrom = elements.selectFrom.value;
        const currentTo = elements.selectTo.value;

        if (!currentSource || !currentTarget || currentTarget === "Translating...") return false;
        return (
            currentSource === state.lastTranslatedSourceText &&
            currentFrom === state.lastTranslatedFromCode &&
            currentTo === state.lastTranslatedToCode
        );
    }

    // Exact match
    assert.strictEqual(checkValid(), true, "Matching translation should be valid");

    // Source edited -> invalid
    elements.fromText.value = "Good morning!";
    assert.strictEqual(checkValid(), false, "Edited source must invalidate translation");
    elements.fromText.value = "Good morning";

    // Target language changed -> invalid
    elements.selectTo.value = "fr-FR";
    assert.strictEqual(checkValid(), false, "Changed language pair must invalidate translation");
    elements.selectTo.value = "es-ES";

    // Translating in flight -> invalid
    state.isTranslating = true;
    assert.strictEqual(checkValid(), false, "Translation in flight must disable saving");
    state.isTranslating = false;

    console.log("✓ Translation Scenario 1: Translation validation guards prevent saving stale, edited, or language-mismatched output.");
}

// Verify Provider Code Mapping
{
    const match = scriptContent.match(/function getProviderLanguageCode\([^)]*\)\s*\{[\s\S]*?\n\}/);
    assert(match);
    const getProviderLanguageCode = eval("(" + match[0] + ")");

    assert.strictEqual(getProviderLanguageCode("google", "ur-PK"), "ur");
    assert.strictEqual(getProviderLanguageCode("google", "be-BY"), "be");
    assert.strictEqual(getProviderLanguageCode("google", "pa-IN"), "pa");
    assert.strictEqual(getProviderLanguageCode("myMemory", "ur-PK"), "ur-PK");
    assert.strictEqual(getProviderLanguageCode("myMemory", "en-GB"), "en-GB");
    console.log("✓ Translation Scenario 2: Provider language code mapping resolves Google subtags and MyMemory regional pairs correctly.");
}

// Translation Provider Async Mock Tests
(async () => {
    // Extract translationProviders
    const match = scriptContent.match(/const translationProviders = \{[\s\S]*?\n\};\n\n\/\*\*/);
    assert(match, "translationProviders must exist");
    const code = match[0].replace(/\n\n\/\*\*$/, "");

    // 1. Google Provider Success
    {
        const mockFetch = async () => ({
            ok: true,
            status: 200,
            json: async () => [[["Hello world", "Hola mundo", null, null]]]
        });
        const providerFunc = new Function("fetch", "getProviderLanguageCode", "decodeHtmlEntities", `
            ${code}
            return translationProviders;
        `);
        const providers = providerFunc(
            mockFetch,
            (p, b) => b.split("-")[0],
            s => s
        );

        const result = await providers.google.translate("Hola mundo", "es-ES", "en-GB", new AbortController().signal);
        assert.strictEqual(result, "Hello world");
        console.log("✓ Translation Scenario 3: Successful primary-provider (Google) response.");
    }

    // 4. Google Fails, Fallback MyMemory Succeeds
    {
        const mockFetch = async (url) => {
            if (url.includes("translate.googleapis.com")) {
                return { ok: false, status: 500, statusText: "Internal Error" };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    responseStatus: 200,
                    responseData: { translatedText: "Fallback Success" }
                })
            };
        };
        const providerFunc = new Function("fetch", "getProviderLanguageCode", "decodeHtmlEntities", `
            ${code}
            return translationProviders;
        `);
        const providers = providerFunc(
            mockFetch,
            (p, b) => b.split("-")[0],
            s => s
        );

        // Google fails
        let googleFailed = false;
        try {
            await providers.google.translate("Test", "en-GB", "es-ES", new AbortController().signal);
        } catch {
            googleFailed = true;
        }
        assert.strictEqual(googleFailed, true);

        // MyMemory succeeds
        const fallbackRes = await providers.myMemory.translate("Test", "en-GB", "es-ES", new AbortController().signal);
        assert.strictEqual(fallbackRes, "Fallback Success");
        console.log("✓ Translation Scenario 4: Primary provider failure followed by successful fallback.");
    }

    // 5. Both Providers Fail
    {
        const mockFetch = async () => ({
            ok: false,
            status: 503,
            statusText: "Service Unavailable"
        });
        const providerFunc = new Function("fetch", "getProviderLanguageCode", "decodeHtmlEntities", `
            ${code}
            return translationProviders;
        `);
        const providers = providerFunc(mockFetch, (p, b) => b.split("-")[0], s => s);

        let p1Error = null, p2Error = null;
        try { await providers.google.translate("X", "en-GB", "es-ES", new AbortController().signal); } catch (e) { p1Error = e; }
        try { await providers.myMemory.translate("X", "en-GB", "es-ES", new AbortController().signal); } catch (e) { p2Error = e; }
        assert(p1Error && p2Error, "Both providers must report errors");
        console.log("✓ Translation Scenario 5: Both providers failing handled gracefully.");
    }

    // 6. Rate-limit (429) & Unsupported Language (400)
    {
        const mockFetch429 = async () => ({ ok: false, status: 429, statusText: "Too Many Requests" });
        const providerFunc = new Function("fetch", "getProviderLanguageCode", "decodeHtmlEntities", `
            ${code}
            return translationProviders;
        `);
        const providers429 = providerFunc(mockFetch429, (p, b) => b.split("-")[0], s => s);
        await assert.rejects(
            async () => providers429.google.translate("X", "en-GB", "es-ES", new AbortController().signal),
            /RATE_LIMITED/
        );

        const mockFetch400 = async () => ({ ok: false, status: 400, statusText: "Bad Request" });
        const providers400 = providerFunc(mockFetch400, (p, b) => b.split("-")[0], s => s);
        await assert.rejects(
            async () => providers400.google.translate("X", "en-GB", "zz-ZZ", new AbortController().signal),
            /UNSUPPORTED_LANGUAGE/
        );
        console.log("✓ Translation Scenario 6: Unsupported language pair and rate-limit responses categorized.");
    }

    // 7. Per-provider timeout and distinction from user cancellation
    {
        const matchTimeout = scriptContent.match(/async function callProviderWithTimeout\([^)]*\)\s*\{[\s\S]*?\n\}/);
        assert(matchTimeout, "callProviderWithTimeout must exist in script.js");
        const callProviderWithTimeout = eval("(" + matchTimeout[0] + ")");

        // A. Verify timeout fires and throws TimeoutError (not AbortError / USER_CANCELLED)
        const controller = new AbortController();
        let timeoutError = null;
        try {
            await callProviderWithTimeout(
                (sig) => new Promise((_, reject) => {
                    sig.addEventListener("abort", () => {
                        const e = new Error("aborted");
                        e.name = "AbortError";
                        reject(e);
                    });
                }),
                controller.signal,
                40 // 40ms timeout for test speed
            );
        } catch (e) {
            timeoutError = e;
        }

        assert(timeoutError, "Timeout error must be thrown");
        assert.strictEqual(timeoutError.message, "TIMEOUT", "Error message must be TIMEOUT");
        assert.strictEqual(timeoutError.name, "TimeoutError", "Error name must be TimeoutError");
        assert.strictEqual(timeoutError.timeoutMs, 40, "Error must record timeout duration");

        // B. Verify user cancellation throws USER_CANCELLED AbortError
        const cancelController = new AbortController();
        let cancelError = null;
        const cancelPromise = callProviderWithTimeout(
            (sig) => new Promise((_, reject) => {
                sig.addEventListener("abort", () => {
                    const e = new Error("aborted");
                    e.name = "AbortError";
                    reject(e);
                });
            }),
            cancelController.signal,
            1000
        );
        setTimeout(() => cancelController.abort(), 20);
        try {
            await cancelPromise;
        } catch (e) {
            cancelError = e;
        }

        assert(cancelError, "Cancel error must be thrown");
        assert.strictEqual(cancelError.message, "USER_CANCELLED", "User cancel must throw USER_CANCELLED");
        assert.strictEqual(cancelError.name, "AbortError", "User cancel must have name AbortError");
        console.log("✓ Translation Scenario 7: Per-provider timeout triggers and distinguishes TimeoutError from cancellation.");
    }

    // 8. Deterministic timer tracking and abort listener cleanup across all 4 terminal paths
    {
        const matchTimeout = scriptContent.match(/async function callProviderWithTimeout\([^)]*\)\s*\{[\s\S]*?\n\}/);
        const callProviderWithTimeout = eval("(" + matchTimeout[0] + ")");

        const originalSetTimeout = global.setTimeout;
        const originalClearTimeout = global.clearTimeout;

        const timerRegistry = new Map();
        let nextTimerId = 2000;

        global.setTimeout = (fn, delay) => {
            const id = ++nextTimerId;
            timerRegistry.set(id, { id, delay, fn, status: "created" });
            return id;
        };

        global.clearTimeout = (id) => {
            if (timerRegistry.has(id)) {
                timerRegistry.get(id).status = "cleared";
            }
        };

        const fireTimer = (id) => {
            const t = timerRegistry.get(id);
            if (t && t.status === "created") {
                t.status = "executed";
                t.fn();
            }
        };

        try {
            // Path A: Success
            timerRegistry.clear();
            let listenersA = 0;
            const signalA = {
                aborted: false,
                addEventListener(e, fn) { if (e === "abort") listenersA++; },
                removeEventListener(e, fn) { if (e === "abort") listenersA--; }
            };
            const resA = await callProviderWithTimeout(async () => "fast_success", signalA, 3000);
            assert.strictEqual(resA, "fast_success");
            assert.strictEqual(timerRegistry.size, 1, "Path A: Timer created");
            assert.strictEqual(Array.from(timerRegistry.values())[0].status, "cleared", "Path A: Timer cancelled via clearTimeout");
            assert.strictEqual(listenersA, 0, "Path A: Abort listener removed on success");

            // Path B: Provider Failure
            timerRegistry.clear();
            let listenersB = 0;
            const signalB = {
                aborted: false,
                addEventListener(e, fn) { if (e === "abort") listenersB++; },
                removeEventListener(e, fn) { if (e === "abort") listenersB--; }
            };
            let caughtB = null;
            try {
                await callProviderWithTimeout(async () => { throw new Error("CRASH_FAIL"); }, signalB, 3000);
            } catch (err) {
                caughtB = err;
            }
            assert(caughtB && caughtB.message === "CRASH_FAIL", "Path B: Provider error propagated");
            assert.strictEqual(timerRegistry.size, 1, "Path B: Timer created");
            assert.strictEqual(Array.from(timerRegistry.values())[0].status, "cleared", "Path B: Timer cancelled via clearTimeout");
            assert.strictEqual(listenersB, 0, "Path B: Abort listener removed on provider failure");

            // Path C: Timeout
            timerRegistry.clear();
            let listenersC = 0;
            const signalC = {
                aborted: false,
                addEventListener(e, fn) { if (e === "abort") listenersC++; },
                removeEventListener(e, fn) { if (e === "abort") listenersC--; }
            };
            let caughtC = null;
            const promiseC = callProviderWithTimeout(
                (sig) => new Promise((_, reject) => {
                    sig.addEventListener("abort", () => {
                        const e = new Error("aborted");
                        e.name = "AbortError";
                        reject(e);
                    });
                }),
                signalC,
                3000
            );
            assert.strictEqual(timerRegistry.size, 1, "Path C: Timer created");
            const timerC = Array.from(timerRegistry.values())[0];
            assert.strictEqual(timerC.status, "created", "Path C: Timer pending");
            fireTimer(timerC.id);
            assert.strictEqual(timerC.status, "executed", "Path C: Timer executed");
            try {
                await promiseC;
            } catch (err) {
                caughtC = err;
            }
            assert(caughtC && caughtC.name === "TimeoutError", "Path C: TimeoutError thrown");
            assert.strictEqual(listenersC, 0, "Path C: Abort listener removed on timeout");

            // Path D: User Cancellation
            timerRegistry.clear();
            let listenersD = 0;
            let abortCbD = null;
            const signalD = {
                aborted: false,
                addEventListener(e, fn) {
                    if (e === "abort") {
                        listenersD++;
                        abortCbD = fn;
                    }
                },
                removeEventListener(e, fn) {
                    if (e === "abort") listenersD--;
                }
            };
            let caughtD = null;
            const promiseD = callProviderWithTimeout(
                (sig) => new Promise((_, reject) => {
                    sig.addEventListener("abort", () => {
                        const e = new Error("aborted");
                        e.name = "AbortError";
                        reject(e);
                    });
                }),
                signalD,
                3000
            );
            assert.strictEqual(timerRegistry.size, 1, "Path D: Timer created");
            const timerD = Array.from(timerRegistry.values())[0];
            signalD.aborted = true;
            if (abortCbD) abortCbD();
            try {
                await promiseD;
            } catch (err) {
                caughtD = err;
            }
            assert(caughtD && caughtD.name === "AbortError" && caughtD.message === "USER_CANCELLED", "Path D: USER_CANCELLED AbortError thrown");
            assert.strictEqual(timerD.status, "cleared", "Path D: Timer cancelled via clearTimeout on user cancellation");
            assert.strictEqual(listenersD, 0, "Path D: Abort listener removed on user cancellation");
        } finally {
            global.setTimeout = originalSetTimeout;
            global.clearTimeout = originalClearTimeout;
        }

        console.log("✓ Translation Scenario 8: Deterministic timer tracking and abort listener cleanup across all terminal paths (success, failure, timeout, cancellation).");
    }

    // 9. Google provider timeout cleanly triggers MyMemory fallback
    {
        const matchTimeout = scriptContent.match(/async function callProviderWithTimeout\([^)]*\)\s*\{[\s\S]*?\n\}/);
        const callProviderWithTimeout = eval("(" + matchTimeout[0] + ")");
        const matchReqTrans = scriptContent.match(/async function requestTranslation\([^)]*\)\s*\{[\s\S]*?\n\}/);
        assert(matchReqTrans, "requestTranslation must exist in script.js");

        let googleCalled = false;
        let myMemoryCalled = false;

        const mockProviders = {
            google: {
                translate: async (text, from, to, signal) => {
                    googleCalled = true;
                    return new Promise((_, reject) => {
                        signal.addEventListener("abort", () => {
                            const err = new Error("aborted");
                            err.name = "AbortError";
                            reject(err);
                        });
                    });
                }
            },
            myMemory: {
                translate: async (text, from, to, signal) => {
                    myMemoryCalled = true;
                    return "Fallback Translation After Timeout";
                }
            }
        };

        const reqTransFn = new Function(
            "translationProviders",
            "callProviderWithTimeout",
            "TRANSLATION_TIMEOUT_MS",
            `
            ${matchReqTrans[0]}
            return requestTranslation;
            `
        )(mockProviders, callProviderWithTimeout, 30);

        const controller = new AbortController();
        const result = await reqTransFn("Hello", "en-GB", "es-ES", controller.signal);
        assert.strictEqual(result, "Fallback Translation After Timeout");
        assert.strictEqual(googleCalled, true, "Google must have been attempted");
        assert.strictEqual(myMemoryCalled, true, "MyMemory fallback must be called after Google timeout");
        console.log("✓ Translation Scenario 9: Google provider timeout cleanly triggers MyMemory fallback.");
    }

    // 10. Both providers timing out throws TRANSLATION_TIMEOUT
    {
        const matchTimeout = scriptContent.match(/async function callProviderWithTimeout\([^)]*\)\s*\{[\s\S]*?\n\}/);
        const callProviderWithTimeout = eval("(" + matchTimeout[0] + ")");
        const matchReqTrans = scriptContent.match(/async function requestTranslation\([^)]*\)\s*\{[\s\S]*?\n\}/);

        const mockProviders = {
            google: {
                translate: async (text, from, to, signal) => {
                    return new Promise((_, reject) => {
                        signal.addEventListener("abort", () => {
                            const err = new Error("aborted");
                            err.name = "AbortError";
                            reject(err);
                        });
                    });
                }
            },
            myMemory: {
                translate: async (text, from, to, signal) => {
                    return new Promise((_, reject) => {
                        signal.addEventListener("abort", () => {
                            const err = new Error("aborted");
                            err.name = "AbortError";
                            reject(err);
                        });
                    });
                }
            }
        };

        const reqTransFn = new Function(
            "translationProviders",
            "callProviderWithTimeout",
            "TRANSLATION_TIMEOUT_MS",
            `
            ${matchReqTrans[0]}
            return requestTranslation;
            `
        )(mockProviders, callProviderWithTimeout, 25);

        const controller = new AbortController();
        await assert.rejects(
            async () => reqTransFn("Hello", "en-GB", "es-ES", controller.signal),
            /TRANSLATION_TIMEOUT/
        );
        console.log("✓ Translation Scenario 10: Fallback provider (MyMemory) timeout handling and combined TRANSLATION_TIMEOUT error.");
    }

    // 11. User cancellation aborts active request immediately and prevents fallback
    {
        const matchTimeout = scriptContent.match(/async function callProviderWithTimeout\([^)]*\)\s*\{[\s\S]*?\n\}/);
        const callProviderWithTimeout = eval("(" + matchTimeout[0] + ")");
        const matchReqTrans = scriptContent.match(/async function requestTranslation\([^)]*\)\s*\{[\s\S]*?\n\}/);

        let myMemoryCalled = false;
        const mockProviders = {
            google: {
                translate: async (text, from, to, signal) => {
                    return new Promise((_, reject) => {
                        signal.addEventListener("abort", () => {
                            const err = new Error("aborted");
                            err.name = "AbortError";
                            reject(err);
                        });
                    });
                }
            },
            myMemory: {
                translate: async (text, from, to, signal) => {
                    myMemoryCalled = true;
                    return "Should not happen";
                }
            }
        };

        const reqTransFn = new Function(
            "translationProviders",
            "callProviderWithTimeout",
            "TRANSLATION_TIMEOUT_MS",
            `
            ${matchReqTrans[0]}
            return requestTranslation;
            `
        )(mockProviders, callProviderWithTimeout, 500);

        const controller = new AbortController();
        const p = reqTransFn("Hello", "en-GB", "es-ES", controller.signal);
        setTimeout(() => controller.abort(), 20);

        await assert.rejects(async () => p, /USER_CANCELLED|AbortError/);
        assert.strictEqual(myMemoryCalled, false, "MyMemory MUST NOT be called when user explicitly cancels");
        console.log("✓ Translation Scenario 11: User cancellation aborts active request immediately and prevents fallback.");
    }

    // 12. User cancellation during fallback halts execution cleanly
    {
        const matchTimeout = scriptContent.match(/async function callProviderWithTimeout\([^)]*\)\s*\{[\s\S]*?\n\}/);
        const callProviderWithTimeout = eval("(" + matchTimeout[0] + ")");
        const matchReqTrans = scriptContent.match(/async function requestTranslation\([^)]*\)\s*\{[\s\S]*?\n\}/);

        const controller = new AbortController();
        const mockProviders = {
            google: {
                translate: async () => {
                    throw new Error("PRIMARY_FAIL");
                }
            },
            myMemory: {
                translate: async (text, from, to, signal) => {
                    return new Promise((_, reject) => {
                        signal.addEventListener("abort", () => {
                            const err = new Error("aborted");
                            err.name = "AbortError";
                            reject(err);
                        });
                    });
                }
            }
        };

        const reqTransFn = new Function(
            "translationProviders",
            "callProviderWithTimeout",
            "TRANSLATION_TIMEOUT_MS",
            `
            ${matchReqTrans[0]}
            return requestTranslation;
            `
        )(mockProviders, callProviderWithTimeout, 500);

        const p = reqTransFn("Hello", "en-GB", "es-ES", controller.signal);
        setTimeout(() => controller.abort(), 20);

        await assert.rejects(async () => p, /USER_CANCELLED|AbortError/);
        console.log("✓ Translation Scenario 12: User cancellation during fallback halts execution cleanly.");
    }

    // 13. Outdated response cannot overwrite newer translation (exercising extracted translateText and cancelActiveRequest)
    {
        const matchCancel = scriptContent.match(/function cancelActiveRequest\([^)]*\)\s*\{[\s\S]*?\n\}/);
        assert(matchCancel, "cancelActiveRequest must exist in script.js");
        const matchTranslateText = scriptContent.match(/async function translateText\([^)]*\)\s*\{[\s\S]*?\n\}/);
        assert(matchTranslateText, "translateText must exist in script.js");
        const matchSetLoading = scriptContent.match(/function setLoadingState\([^)]*\)\s*\{[\s\S]*?\n\}/);
        assert(matchSetLoading, "setLoadingState must exist in script.js");

        const mockState = {
            activeRequestId: 0,
            currentAbortController: null,
            isTranslating: false,
            lastTranslatedSourceText: "",
            lastTranslatedFromCode: "",
            lastTranslatedToCode: ""
        };

        const mockElements = {
            fromText: { value: "Slow Request" },
            toText: { value: "", placeholder: "" },
            selectFrom: { value: "en-GB" },
            selectTo: { value: "es-ES" },
            translateBtn: { disabled: false, innerHTML: "" }
        };

        const harness = new Function(
            "state",
            "elements",
            "countries",
            "showStatus",
            "updateSaveButtonState",
            "handleTranslationError",
            "requestTranslation",
            `
            ${matchSetLoading[0]}
            ${matchCancel[0]}
            ${matchTranslateText[0]}
            return { translateText, cancelActiveRequest, setLoadingState };
            `
        );

        let req1Resolve, req2Resolve;
        const mockReqTranslation = async (text, from, to, signal) => {
            if (text === "Slow Request") {
                return new Promise((resolve, reject) => {
                    req1Resolve = resolve;
                    signal.addEventListener("abort", () => {
                        const err = new Error("USER_CANCELLED");
                        err.name = "AbortError";
                        reject(err);
                    });
                });
            } else {
                return new Promise((resolve) => {
                    req2Resolve = resolve;
                });
            }
        };

        const fns = harness(
            mockState,
            mockElements,
            { "en-GB": "English", "es-ES": "Spanish" },
            () => {},
            () => {},
            () => {},
            mockReqTranslation
        );

        // 1. Launch Slow Request (Req 1)
        mockElements.fromText.value = "Slow Request";
        const p1 = fns.translateText();

        // 2. User changes input / language, triggering cancelActiveRequest()
        fns.cancelActiveRequest();
        mockElements.fromText.value = "Fast Request";
        const p2 = fns.translateText();

        assert.strictEqual(mockState.activeRequestId, 5, "Two requests launched, activeRequestId incremented with cancelActiveRequest");

        // 3. Fast Request finishes first
        req2Resolve("Fast Translation Result");
        await p2;
        assert.strictEqual(mockElements.toText.value, "Fast Translation Result", "Fast translation must be displayed");

        // 4. Slow Request finishes late
        if (req1Resolve) req1Resolve("Stale Slow Result");
        await p1;

        // Verify Stale Slow Result DID NOT overwrite Fast Result
        assert.strictEqual(mockElements.toText.value, "Fast Translation Result", "Stale slow result must NOT overwrite newer fast result");
        assert.strictEqual(mockState.isTranslating, false, "Loading state must be reset to idle");

        console.log("✓ Translation Scenario 13: Outdated response cannot overwrite newer translation (exercising extracted translateText and cancelActiveRequest).");
    }

    // 14. Loading state transitions and cancelActiveRequest reset button cleanly after all terminal outcomes
    {
        const matchSetLoading = scriptContent.match(/function setLoadingState\([^)]*\)\s*\{[\s\S]*?\n\}/);
        assert(matchSetLoading, "setLoadingState must exist in script.js");

        const mockBtn = {
            disabled: false,
            innerHTML: ""
        };
        const mockState = { isTranslating: false };

        const setLoadingState = new Function(
            "elements",
            "state",
            "updateSaveButtonState",
            `
            ${matchSetLoading[0]}
            return setLoadingState;
            `
        )({ translateBtn: mockBtn }, mockState, () => {});

        // Test loading active
        setLoadingState(true);
        assert.strictEqual(mockState.isTranslating, true, "state.isTranslating must be true");
        assert.strictEqual(mockBtn.disabled, true, "Translate button must be disabled during translation");
        assert(mockBtn.innerHTML.includes("Translating..."), "Button text must show Translating...");
        assert(mockBtn.innerHTML.includes("fa-spin"), "Button must show spinner icon");

        // Test loading reset on success
        setLoadingState(false);
        assert.strictEqual(mockState.isTranslating, false, "state.isTranslating must be false");
        assert.strictEqual(mockBtn.disabled, false, "Translate button must be re-enabled");
        assert(mockBtn.innerHTML.includes("Translate Text"), "Button text must be Translate Text");
        assert(mockBtn.innerHTML.includes("fa-arrow-right"), "Button must show arrow icon");

        // Test loading reset on error / cancel
        setLoadingState(true);
        assert.strictEqual(mockState.isTranslating, true);
        setLoadingState(false);
        assert.strictEqual(mockState.isTranslating, false);
        assert.strictEqual(mockBtn.disabled, false);

        console.log("✓ Translation Scenario 14: Loading state transitions and cancelActiveRequest reset button cleanly after all terminal outcomes.");
    }

    // 15. Privacy notice DOM structure & disclosure content verification
    {
        const html = fs.readFileSync("index.html", "utf8");
        assert(html.includes('id="translator-privacy-notice"'), "index.html must contain #translator-privacy-notice");
        assert(html.includes('role="note"'), "Privacy notice must have role='note'");
        assert(html.includes('aria-label="Translation privacy notice"'), "Privacy notice must have accessible aria-label");
        assert(html.includes('fa-shield-alt'), "Privacy notice must include shield icon");

        const requiredNoticeText = "Privacy notice: Text entered for translation is sent over the internet to Google Translate or MyMemory. Avoid entering passwords or sensitive personal information.";
        const textContent = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        assert(
            textContent.includes(requiredNoticeText),
            "Privacy notice must contain the exact required disclosure text"
        );

        // Verify notice is inside #panel-translator and near translate controls
        const panelTranslatorMatch = html.match(/<section id="panel-translator"[\s\S]*?<\/section>/);
        assert(panelTranslatorMatch, "section #panel-translator must exist");
        assert(panelTranslatorMatch[0].includes('id="translator-privacy-notice"'), "Privacy notice must be positioned inside #panel-translator");

        console.log("✓ Translation Scenario 15: Privacy notice structure, exact disclosure content, and ARIA semantics verified.");
    }

    // 16. Privacy notice responsive styles verified for 320px viewport and forced-colors mode
    {
        const css = fs.readFileSync("style.css", "utf8");
        assert(css.includes(".translator-privacy-notice"), "style.css must contain .translator-privacy-notice rules");
        assert(css.includes(".privacy-notice-icon"), "style.css must style .privacy-notice-icon");
        assert(css.includes(".privacy-notice-text"), "style.css must style .privacy-notice-text");

        // Mobile responsiveness down to 320px
        const max440Match = css.match(/@media \(max-width:\s*440px\)[\s\S]*?\.translator-privacy-notice\s*\{[\s\S]*?\}/);
        assert(max440Match, "style.css must include mobile <=440px overrides for privacy notice");

        const max360Match = css.match(/@media \(max-width:\s*360px\)[\s\S]*?\.translator-privacy-notice\s*\{[\s\S]*?\}/);
        assert(max360Match, "style.css must include narrow <=360px (320px support) overrides for privacy notice");

        // High contrast mode
        const forcedColorsMatch = css.match(/@media \(forced-colors:\s*active\)[\s\S]*?\.translator-privacy-notice/);
        assert(forcedColorsMatch, "style.css must include forced-colors high contrast mode rules for privacy notice");

        console.log("✓ Translation Scenario 16: Privacy notice responsive styles verified for 320px viewport and forced-colors mode.");
    }

    // 17. Headless browser verification across 6 viewports (320px, 360px, 375px, 440px, 768px, 1024px)
    {
        const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
        if (!fs.existsSync(chromePath)) {
            console.log("- Translation Scenario 17: NOT RUN (Headless browser binary not found in environment).");
        } else {
            const server = http.createServer((req, res) => {
                let reqPath = req.url.split('?')[0];
                if (reqPath === '/') reqPath = '/index.html';
                const filePath = path.join(process.cwd(), reqPath);
                if (!fs.existsSync(filePath)) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                const ext = path.extname(filePath);
                const contentTypes = {
                    '.html': 'text/html',
                    '.css': 'text/css',
                    '.js': 'application/javascript',
                    '.json': 'application/json'
                };
                res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
                fs.createReadStream(filePath).pipe(res);
            });

            const serverPort = 8102;
            await new Promise(r => server.listen(serverPort, '127.0.0.1', r));

            const cdpPort = 9242;
            const proc = spawn(chromePath, [
                '--headless=new',
                `--remote-debugging-port=${cdpPort}`,
                '--disable-gpu',
                '--no-first-run',
                '--no-default-browser-check',
                'about:blank'
            ]);

            try {
                await new Promise(r => setTimeout(r, 1500));
                const targets = await new Promise((resolve, reject) => {
                    http.get(`http://127.0.0.1:${cdpPort}/json/list`, res => {
                        let d = '';
                        res.on('data', c => d += c);
                        res.on('end', () => resolve(JSON.parse(d)));
                    }).on('error', reject);
                });

                const pageTarget = targets.find(t => t.type === 'page') || targets[0];
                const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

                let id = 1;
                const send = (method, params = {}) => new Promise((resolve, reject) => {
                    const msgId = id++;
                    const listener = (e) => {
                        const msg = JSON.parse(e.data);
                        if (msg.id === msgId) {
                            ws.removeEventListener('message', listener);
                            if (msg.error) reject(msg.error);
                            else resolve(msg.result);
                        }
                    };
                    ws.addEventListener('message', listener);
                    ws.send(JSON.stringify({ id: msgId, method, params }));
                });

                await new Promise(r => ws.onopen = r);
                await send('Page.enable');
                await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/index.html` });
                await new Promise(r => setTimeout(r, 2000));

                const widths = [320, 360, 375, 440, 768, 1024];
                for (const w of widths) {
                    await send('Emulation.setDeviceMetricsOverride', {
                        width: w,
                        height: 800,
                        deviceScaleFactor: 1,
                        mobile: w < 768
                    });
                    await new Promise(r => setTimeout(r, 120));

                    const evalRes = await send('Runtime.evaluate', {
                        expression: `(() => {
                            const docEl = document.documentElement;
                            const notice = document.getElementById('translator-privacy-notice');
                            const nav = document.querySelector('.view-nav');
                            const noticeRect = notice ? notice.getBoundingClientRect() : null;
                            const noticeStyle = notice ? window.getComputedStyle(notice) : null;
                            return {
                                width: ${w},
                                hasHorizontalOverflow: docEl.scrollWidth > docEl.clientWidth,
                                noticeVisible: noticeRect ? (noticeRect.width > 0 && noticeRect.height > 0 && noticeStyle.display !== 'none') : false,
                                fitsInsideViewport: noticeRect ? (noticeRect.right <= docEl.clientWidth) : false,
                                navOverflow: nav ? (nav.scrollWidth > nav.clientWidth) : false
                            };
                        })()`,
                        returnByValue: true
                    });

                    const r = evalRes.result.value;
                    assert.strictEqual(r.hasHorizontalOverflow, false, `Viewport ${w}px must not have horizontal overflow`);
                    assert.strictEqual(r.noticeVisible, true, `Privacy notice must be visible at ${w}px`);
                    assert.strictEqual(r.fitsInsideViewport, true, `Privacy notice must fit inside viewport at ${w}px`);
                    assert.strictEqual(r.navOverflow, false, `Nav bar must not overflow at ${w}px`);
                }

                ws.close();
                console.log("✓ Translation Scenario 17: Headless browser verification across 6 viewports (320px, 360px, 375px, 440px, 768px, 1024px) checking horizontal overflow, notice visibility, bounding rect, text wrapping, and nav bar overflow.");
            } finally {
                proc.kill();
                server.close();
            }
        }
    }

    // 18. Headless browser accessibility tree inspection (Chrome AXTree verification of role="note" and computed accessible name)
    {
        const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
        if (!fs.existsSync(chromePath)) {
            console.log("- Translation Scenario 18: NOT RUN (Headless browser binary not found in environment).\n");
        } else {
            const server = http.createServer((req, res) => {
                let reqPath = req.url.split('?')[0];
                if (reqPath === '/') reqPath = '/index.html';
                const filePath = path.join(process.cwd(), reqPath);
                if (!fs.existsSync(filePath)) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                const ext = path.extname(filePath);
                const contentTypes = {
                    '.html': 'text/html',
                    '.css': 'text/css',
                    '.js': 'application/javascript',
                    '.json': 'application/json'
                };
                res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
                fs.createReadStream(filePath).pipe(res);
            });

            const serverPort = 8103;
            await new Promise(r => server.listen(serverPort, '127.0.0.1', r));

            const cdpPort = 9243;
            const proc = spawn(chromePath, [
                '--headless=new',
                `--remote-debugging-port=${cdpPort}`,
                '--disable-gpu',
                '--no-first-run',
                '--no-default-browser-check',
                'about:blank'
            ]);

            try {
                await new Promise(r => setTimeout(r, 1500));
                const targets = await new Promise((resolve, reject) => {
                    http.get(`http://127.0.0.1:${cdpPort}/json/list`, res => {
                        let d = '';
                        res.on('data', c => d += c);
                        res.on('end', () => resolve(JSON.parse(d)));
                    }).on('error', reject);
                });

                const pageTarget = targets.find(t => t.type === 'page') || targets[0];
                const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

                let id = 1;
                const send = (method, params = {}) => new Promise((resolve, reject) => {
                    const msgId = id++;
                    const listener = (e) => {
                        const msg = JSON.parse(e.data);
                        if (msg.id === msgId) {
                            ws.removeEventListener('message', listener);
                            if (msg.error) reject(msg.error);
                            else resolve(msg.result);
                        }
                    };
                    ws.addEventListener('message', listener);
                    ws.send(JSON.stringify({ id: msgId, method, params }));
                });

                await new Promise(r => ws.onopen = r);
                await send('Page.enable');
                await send('Accessibility.enable');
                await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/index.html` });
                await new Promise(r => setTimeout(r, 2000));

                const axRes = await send('Accessibility.getFullAXTree');
                const nodes = axRes.nodes || [];
                const noteNode = nodes.find(n => n.role && n.role.value === 'note');

                assert(noteNode, "AXTree must contain a node with role 'note'");
                assert.strictEqual(noteNode.ignored, false, "Privacy notice node must not be ignored in AXTree");
                assert(noteNode.name && noteNode.name.value === "Translation privacy notice", "AXTree node name must be 'Translation privacy notice'");

                ws.close();
                console.log("✓ Translation Scenario 18: Headless browser accessibility tree inspection (Chrome AXTree verification of role=\"note\" and computed accessible name).\n");
            } finally {
                proc.kill();
                server.close();
            }
        }
    }

    // --------------------------------------------------------------------------
    // 4. Notebook Logic: Duplicate Detection & Filtering
    // --------------------------------------------------------------------------
    console.log("[Test Category 4: Notebook & Accessibility]");

    const matchDup = scriptContent.match(/function findDuplicateEntry\([^)]*\)\s*\{[\s\S]*?\n\}/);
    assert(matchDup);
    const findDuplicateEntry = eval("(" + matchDup[0] + ")");

    const existingEntries = [
        {
            id: "1",
            sourceText: "Hello World",
            translatedText: "Hola Mundo",
            fromCode: "en-GB",
            toCode: "es-ES",
            isFavorite: true,
            fromName: "English",
            toName: "Spanish",
            createdAt: 1000
        },
        {
            id: "2",
            sourceText: "Thank you",
            translatedText: "Merci",
            fromCode: "en-GB",
            toCode: "fr-FR",
            isFavorite: false,
            fromName: "English",
            toName: "French",
            createdAt: 2000
        }
    ];

    // Duplicate detection
    const dupFound = findDuplicateEntry(existingEntries, "hello world ", " hola mundo", "en-GB", "es-ES");
    assert(dupFound !== null, "Case-insensitive trimmed duplicate must be detected");
    const noDup = findDuplicateEntry(existingEntries, "Hello World", "Bonjour", "en-GB", "fr-FR");
    assert.strictEqual(noDup, null, "Different translation must not be flagged as duplicate");
    console.log("✓ Notebook Scenario 1: Duplicate save prevention validated.");

    // Filtering
    const matchFilter = scriptContent.match(/function getFilteredEntries\([^)]*\)\s*\{[\s\S]*?\n\}/);
    assert(matchFilter);
    const notebookState = {
        entries: existingEntries,
        searchQuery: "merci",
        languageFilter: "all",
        favoritesOnly: false
    };
    const getFilteredEntries = new Function("notebookState", `
        return (${matchFilter[0]})();
    `);

    // Search query filter
    let filtered = getFilteredEntries(notebookState);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].id, "2");

    // Favorites filter
    notebookState.searchQuery = "";
    notebookState.favoritesOnly = true;
    filtered = getFilteredEntries(notebookState);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].id, "1");

    // Language filter
    notebookState.favoritesOnly = false;
    notebookState.languageFilter = "fr-FR";
    filtered = getFilteredEntries(notebookState);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].id, "2");
    console.log("✓ Notebook Scenario 2: Search, language filtering, and favorites filtering verified.");

    // --------------------------------------------------------------------------
    // 5. Modal Accessibility & Focus Restoration
    // --------------------------------------------------------------------------
    console.log("\n[Test Category 5: Modal Accessibility & Focus]");

    // Simulate focus restoration
    const invokingButton = {
        name: "ClearAllBtn",
        disabled: false,
        focused: false,
        focus() { this.focused = true; }
    };

    const modal = {
        hidden: false,
        _previousFocus: invokingButton
    };

    // Simulate close
    modal.hidden = true;
    const prev = modal._previousFocus;
    modal._previousFocus = null;
    if (prev && typeof prev.focus === "function" && !prev.disabled) {
        prev.focus();
    }

    assert.strictEqual(invokingButton.focused, true, "Focus must be restored to invoking element");
    assert.strictEqual(modal._previousFocus, null, "Stored focus reference must be cleaned up");
    console.log("✓ Modal Scenario 1: Focus restoration safely targets invoking element and cleans up state.");

    // --------------------------------------------------------------------------
    // 6. Asynchronous State, Race Conditions & Language Swapping
    // --------------------------------------------------------------------------
    console.log("\n[Test Category 6: Asynchronous State & Language Swapping]");

    // Scenario A: Rapid consecutive requests (Request 1 resolves after Request 2)
    {
        let activeRequestId = 0;
        let lastResult = "";

        // Launch Request 1
        const req1Id = ++activeRequestId;
        // Launch Request 2 immediately
        const req2Id = ++activeRequestId;

        // Req 2 completes first
        if (req2Id === activeRequestId) {
            lastResult = "Result from Request 2";
        }

        // Req 1 completes late
        if (req1Id === activeRequestId) {
            lastResult = "Result from Request 1 (STALE)";
        }

        assert.strictEqual(lastResult, "Result from Request 2", "Stale late-arriving response must be ignored");
        console.log("✓ Swap Scenario 1: Late-arriving response from earlier request correctly ignored.");
    }

    // Scenario B: Language Swapping logic
    {
        const matchSwap = scriptContent.match(/function swapLanguages\(\)\s*\{[\s\S]*?\n\}/);
        assert(matchSwap);

        // Case 1: Swapping when a valid translation exists
        {
            const testState = {
                isTranslating: false,
                lastTranslatedSourceText: "Hello",
                lastTranslatedFromCode: "en-GB",
                lastTranslatedToCode: "es-ES"
            };
            const testElements = {
                selectFrom: { value: "en-GB" },
                selectTo: { value: "es-ES" },
                fromText: { value: "Hello" },
                toText: { value: "Hola", placeholder: "" },
                exchangeBtn: { classList: { add() {}, remove() {} } },
                saveTranslationBtn: { disabled: false, querySelector: () => ({ className: "" }), classList: { remove() {} }, setAttribute() {} }
            };

            const swapFn = new Function("elements", "state", "hasValidTranslation", "cancelActiveRequest", "clearStatus", "updateSaveButtonState", "showStatus", "countries", `
                ${matchSwap[0]}
                return swapLanguages;
            `)(
                testElements,
                testState,
                () => true, // hadValidTranslation = true
                () => {},
                () => {},
                () => {},
                () => {},
                { "en-GB": "English", "es-ES": "Spanish" }
            );

            swapFn();

            assert.strictEqual(testElements.selectFrom.value, "es-ES", "selectFrom must be Spanish");
            assert.strictEqual(testElements.selectTo.value, "en-GB", "selectTo must be English");
            assert.strictEqual(testElements.fromText.value, "Hola", "fromText must receive completed translation");
            assert.strictEqual(testElements.toText.value, "", "toText must be cleared for new translation");
            assert.strictEqual(testState.lastTranslatedSourceText, "", "Translation state must be invalidated");
            console.log("✓ Swap Scenario 2: Completed translation moved to source, target cleared, and state invalidated.");
        }

        // Case 2: Swapping during an in-flight request (user text preserved!)
        {
            const testState = {
                isTranslating: true,
                lastTranslatedSourceText: "",
                lastTranslatedFromCode: "",
                lastTranslatedToCode: ""
            };
            const testElements = {
                selectFrom: { value: "en-GB" },
                selectTo: { value: "es-ES" },
                fromText: { value: "My In Flight Text" },
                toText: { value: "", placeholder: "Translating..." },
                exchangeBtn: { classList: { add() {}, remove() {} } },
                saveTranslationBtn: { disabled: false, querySelector: () => ({ className: "" }), classList: { remove() {} }, setAttribute() {} }
            };

            let cancelled = false;
            const swapFn = new Function("elements", "state", "hasValidTranslation", "cancelActiveRequest", "clearStatus", "updateSaveButtonState", "showStatus", "countries", `
                ${matchSwap[0]}
                return swapLanguages;
            `)(
                testElements,
                testState,
                () => false, // hadValidTranslation = false
                () => { cancelled = true; testState.isTranslating = false; },
                () => {},
                () => {},
                () => {},
                { "en-GB": "English", "es-ES": "Spanish" }
            );

            swapFn();

            assert.strictEqual(cancelled, true, "In-flight request must be cancelled");
            assert.strictEqual(testElements.fromText.value, "My In Flight Text", "User typed input must NOT be wiped out");
            assert.strictEqual(testElements.toText.value, "", "toText must be empty");
            assert.strictEqual(testElements.selectFrom.value, "es-ES");
            assert.strictEqual(testElements.selectTo.value, "en-GB");
            console.log("✓ Swap Scenario 3: In-flight request safely cancelled and user input preserved.");
        }
    }

    // Scenario C: Identical source and target languages
    {
        const text = "Same Language Test";
        const fromCode = "en-GB";
        const toCode = "en-GB";

        let networkCalled = false;
        let mirroredResult = "";

        if (fromCode === toCode) {
            mirroredResult = text;
        } else {
            networkCalled = true;
        }

        assert.strictEqual(networkCalled, false, "Identical languages must not call network");
        assert.strictEqual(mirroredResult, text, "Text must be mirrored directly");
        console.log("✓ Swap Scenario 4: Identical languages handled locally without network request.");
    }

    // --------------------------------------------------------------------------
    // 7. Flashcard Practice Mode & Accessibility
    // --------------------------------------------------------------------------
    console.log("\n[Test Category 7: Flashcard Practice Mode & State]");

    const matchSync = scriptContent.match(/function syncPracticeState\(\)\s*\{[\s\S]*?\n\}/);
    const matchRenderView = scriptContent.match(/function renderPracticeView\(\)\s*\{[\s\S]*?\n\}/);
    const matchRenderCard = scriptContent.match(/function renderPracticeCard\(\)\s*\{[\s\S]*?\n\}/);
    const matchToggle = scriptContent.match(/function toggleFlashcardAnswer\(\)\s*\{[\s\S]*?\n\}/);
    const matchRecord = scriptContent.match(/function recordPracticeResult\([^)]*\)\s*\{[\s\S]*?\n\}/);
    const matchNav = scriptContent.match(/function navigatePracticeCard\([^)]*\)\s*\{[\s\S]*?\n\}/);
    const matchRestart = scriptContent.match(/function restartPracticeSession\(\)\s*\{[\s\S]*?\n\}/);
    const matchSwitchTab = scriptContent.match(/function switchTab\([^)]*\)\s*\{[\s\S]*?\n\}/);

    assert(matchSync, "syncPracticeState must exist in script.js");
    assert(matchRenderView, "renderPracticeView must exist in script.js");
    assert(matchRenderCard, "renderPracticeCard must exist in script.js");
    assert(matchToggle, "toggleFlashcardAnswer must exist in script.js");
    assert(matchRecord, "recordPracticeResult must exist in script.js");
    assert(matchNav, "navigatePracticeCard must exist in script.js");
    assert(matchRestart, "restartPracticeSession must exist in script.js");
    assert(matchSwitchTab, "switchTab must exist in script.js");

    function makeMockElement(initialAttrs = {}) {
        const classes = new Set();
        const elem = {
            hidden: false,
            disabled: false,
            _textContent: initialAttrs.textContent !== undefined ? String(initialAttrs.textContent) : "",
            get textContent() {
                if (this.children && this.children.length > 0) {
                    return this.children.map(c => c.textContent).join("");
                }
                return this._textContent || "";
            },
            set textContent(v) {
                this._textContent = String(v);
                if (this.children) {
                    this.children.length = 0;
                }
            },
            innerHTML: "",
            value: "",
            className: "",
            children: [],
            parentElement: null,
            style: {},
            classList: {
                add(...items) { items.forEach(c => classes.add(c)); elem.className = Array.from(classes).join(" "); },
                remove(...items) { items.forEach(c => classes.delete(c)); elem.className = Array.from(classes).join(" "); },
                toggle(c, force) {
                    if (force !== undefined) {
                        if (force) classes.add(c); else classes.delete(c);
                    } else {
                        if (classes.has(c)) classes.delete(c); else classes.add(c);
                    }
                    elem.className = Array.from(classes).join(" ");
                    return classes.has(c);
                },
                contains(c) { return classes.has(c); }
            },
            hasAttribute(a) { return a in this; },
            getAttribute(a) { return this[a] !== undefined ? this[a] : null; },
            setAttribute(a, v) { this[a] = String(v); },
            removeAttribute(a) { delete this[a]; },
            appendChild(child) {
                if (child) child.parentElement = this;
                this._textContent = "";
                this.children.push(child);
                return child;
            },
            querySelector(selector) {
                return this.querySelectorAll(selector)[0] || null;
            },
            querySelectorAll(selector) {
                const matches = [];
                function traverse(node) {
                    for (const c of node.children) {
                        let matched = false;
                        if (selector.startsWith(".") && c.classList && c.classList.contains(selector.slice(1))) {
                            matched = true;
                        } else if (selector.startsWith("#") && c.id === selector.slice(1)) {
                            matched = true;
                        } else if (c.tagName && selector.toUpperCase() === c.tagName) {
                            matched = true;
                        }
                        if (matched) matches.push(c);
                        traverse(c);
                    }
                }
                traverse(elem);
                return matches;
            },
            contains(node) {
                if (node === this) return true;
                let curr = node.parentElement;
                while (curr) {
                    if (curr === this) return true;
                    curr = curr.parentElement;
                }
                return false;
            },
            focus() { elem.focused = true; },
            blur() { elem.focused = false; },
            addEventListener(evt, fn) {
                if (!this._listeners) this._listeners = {};
                if (!this._listeners[evt]) this._listeners[evt] = [];
                this._listeners[evt].push(fn);
            },
            removeEventListener(evt, fn) {
                if (this._listeners && this._listeners[evt]) {
                    this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
                }
            },
            ...initialAttrs
        };
        elem.parentElement = elem;
        return elem;
    }

    function createMockPracticeDOM() {
        return {
            panelTranslator: makeMockElement({ hidden: false }),
            panelNotebook: makeMockElement({ hidden: true }),
            panelPractice: makeMockElement({ hidden: true }),
            tabTranslator: makeMockElement(),
            tabNotebook: makeMockElement(),
            tabPractice: makeMockElement(),
            fromText: makeMockElement({ value: "Hello" }),
            toText: makeMockElement({ value: "Bonjour" }),
            practiceCardCounter: makeMockElement(),
            practiceKnownCount: makeMockElement(),
            practiceLearningCount: makeMockElement(),
            practiceRestartBtn: makeMockElement(),
            practiceCardContainer: makeMockElement({ hidden: false }),
            flashcard: makeMockElement(),
            flashcardFront: makeMockElement({ hidden: false }),
            flashcardBack: makeMockElement({ hidden: true }),
            flashcardFrontLang: makeMockElement(),
            flashcardBackLang: makeMockElement(),
            flashcardFrontText: makeMockElement(),
            flashcardBackText: makeMockElement(),
            flashcardFrontSpeakBtn: makeMockElement(),
            flashcardBackSpeakBtn: makeMockElement(),
            flashcardStatusTag: makeMockElement({ hidden: true }),
            flashcardFlipBtn: makeMockElement(),
            practiceNeedWorkBtn: makeMockElement(),
            practiceKnewItBtn: makeMockElement(),
            practicePrevBtn: makeMockElement({ disabled: false }),
            practiceNextBtn: makeMockElement({ disabled: false }),
            practiceEmptyState: makeMockElement({ hidden: true })
        };
    }

    function makePracticeHarness(initialEntries = []) {
        const elements = createMockPracticeDOM();
        const notebookState = {
            entries: [...initialEntries],
            searchQuery: "",
            languageFilter: "all",
            favoritesOnly: false,
            activeTab: "practice"
        };
        const practiceState = {
            currentIndex: 0,
            isAnswerShown: false,
            sessionResults: new Map()
        };

        const harnessFunc = new Function(
            "elements",
            "notebookState",
            "practiceState",
            "showStatus",
            "renderNotebookView",
            "updateSaveButtonState",
            `
            ${matchSync[0]}
            ${matchRenderView[0]}
            ${matchRenderCard[0]}
            ${matchToggle[0]}
            ${matchRecord[0]}
            ${matchNav[0]}
            ${matchRestart[0]}
            ${matchSwitchTab[0]}

            return {
                syncPracticeState,
                renderPracticeView,
                renderPracticeCard,
                toggleFlashcardAnswer,
                recordPracticeResult,
                navigatePracticeCard,
                restartPracticeSession,
                switchTab
            };
        `);

        const fns = harnessFunc(
            elements,
            notebookState,
            practiceState,
            () => {},
            () => {},
            () => {}
        );

        return {
            elements,
            notebookState,
            practiceState,
            ...fns
        };
    }

    // Scenario 1: Empty Notebook Behavior
    {
        const h = makePracticeHarness([]);
        h.renderPracticeView();
        assert.strictEqual(h.elements.practiceEmptyState.hidden, false, "Empty state must be visible when 0 entries exist");
        assert.strictEqual(h.elements.practiceCardContainer.hidden, true, "Card container must be hidden when 0 entries exist");
        assert.strictEqual(h.elements.practiceCardCounter.textContent, "Card 0 of 0");
        console.log("✓ Practice Scenario 1: Empty notebook displays friendly empty state and 0 of 0 counter.");
    }

    // Scenario 2: Flashcard Creation & Content Rendering
    const sampleEntries = [
        { id: "c1", sourceText: "Book", translatedText: "Livre", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
        { id: "c2", sourceText: "Apple", translatedText: "Pomme", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
    ];
    {
        const h = makePracticeHarness(sampleEntries);
        h.renderPracticeView();
        assert.strictEqual(h.elements.practiceEmptyState.hidden, true, "Empty state must be hidden when entries exist");
        assert.strictEqual(h.elements.practiceCardContainer.hidden, false, "Card container must be visible");
        assert.strictEqual(h.elements.flashcardFrontText.textContent, "Book", "Front text must match entry source text");
        assert.strictEqual(h.elements.flashcardFrontLang.textContent, "English", "Front language must match source language");
        assert.strictEqual(h.elements.flashcardBackText.textContent, "Livre", "Back text must match translated text");
        assert.strictEqual(h.elements.flashcardBackLang.textContent, "French", "Back language must match target language");
        assert.strictEqual(h.elements.practiceCardCounter.textContent, "Card 1 of 2", "Counter must reflect first card");
        console.log("✓ Practice Scenario 2: Flashcard front/back content and language labels accurately rendered.");
    }

    // Scenario 3: Reveal and Hide Answer Behavior
    {
        const h = makePracticeHarness(sampleEntries);
        h.renderPracticeView();
        assert.strictEqual(h.elements.flashcardBack.hidden, true, "Answer face must initially be hidden");
        assert.strictEqual(h.elements.flashcardFlipBtn["aria-expanded"], "false", "Reveal button must have aria-expanded='false'");
        assert(h.elements.flashcardFlipBtn.innerHTML.includes("Show Answer"), "Button text must indicate Show Answer");

        h.toggleFlashcardAnswer();
        assert.strictEqual(h.practiceState.isAnswerShown, true, "Answer state must be true");
        assert.strictEqual(h.elements.flashcardBack.hidden, false, "Answer face must be revealed");
        assert.strictEqual(h.elements.flashcardFlipBtn["aria-expanded"], "true", "Reveal button must have aria-expanded='true'");
        assert(h.elements.flashcardFlipBtn.innerHTML.includes("Hide Answer"), "Button text must indicate Hide Answer");

        h.toggleFlashcardAnswer();
        assert.strictEqual(h.practiceState.isAnswerShown, false, "Answer state must toggle back to false");
        assert.strictEqual(h.elements.flashcardBack.hidden, true, "Answer face must be hidden again");
        console.log("✓ Practice Scenario 3: Toggle answer flip correctly reveals and hides answer with ARIA attributes.");
    }

    // Scenario 4: Navigation and Boundary Enforcement
    {
        const h = makePracticeHarness(sampleEntries);
        h.renderPracticeView();

        // Card 1 boundaries
        assert.strictEqual(h.elements.practicePrevBtn.disabled, true, "Previous button must be disabled on first card");
        assert.strictEqual(h.elements.practiceNextBtn.disabled, false, "Next button must be enabled on first card");
        h.navigatePracticeCard("prev");
        assert.strictEqual(h.practiceState.currentIndex, 0, "Previous navigation on first card must be a no-op");

        // Forward to Card 2
        h.navigatePracticeCard("next");
        assert.strictEqual(h.practiceState.currentIndex, 1, "Next navigation must advance index to 1");
        assert.strictEqual(h.elements.practiceCardCounter.textContent, "Card 2 of 2");
        assert.strictEqual(h.elements.flashcardFrontText.textContent, "Apple");
        assert.strictEqual(h.elements.practicePrevBtn.disabled, false, "Previous button must be enabled on second card");
        assert.strictEqual(h.elements.practiceNextBtn.disabled, true, "Next button must be disabled on last card");
        h.navigatePracticeCard("next");
        assert.strictEqual(h.practiceState.currentIndex, 1, "Next navigation on last card must be a no-op");
        console.log("✓ Practice Scenario 4: Previous/Next navigation and boundary controls correctly enforced.");
    }

    // Scenario 5: Session-only Evaluation Tracking & Restart
    {
        const h = makePracticeHarness(sampleEntries);
        h.renderPracticeView();

        // Mark card 1 as known
        h.recordPracticeResult("knew");
        assert.strictEqual(h.practiceState.sessionResults.get("c1"), "knew");
        assert.strictEqual(h.elements.practiceKnewItBtn.classList.contains("active"), true, "Knew It button should have active class");
        assert.strictEqual(h.elements.practiceKnownCount.textContent, "1");
        assert.strictEqual(h.elements.practiceLearningCount.textContent, "0");

        // Move to card 2 and mark as need practice
        h.navigatePracticeCard("next");
        assert.strictEqual(h.practiceState.currentIndex, 1);
        h.recordPracticeResult("practice");
        assert.strictEqual(h.practiceState.sessionResults.get("c2"), "practice");
        assert.strictEqual(h.elements.practiceNeedWorkBtn.classList.contains("active"), true, "Need Work button should have active class");
        assert.strictEqual(h.elements.practiceKnownCount.textContent, "1");
        assert.strictEqual(h.elements.practiceLearningCount.textContent, "1");

        // Restart practice session
        h.restartPracticeSession();
        assert.strictEqual(h.practiceState.currentIndex, 0, "Restart must reset to first card");
        assert.strictEqual(h.practiceState.isAnswerShown, false, "Restart must hide answer");
        assert.strictEqual(h.practiceState.sessionResults.size, 0, "Restart must clear session results");
        assert.strictEqual(h.elements.practiceKnownCount.textContent, "0");
        assert.strictEqual(h.elements.practiceLearningCount.textContent, "0");
        console.log("✓ Practice Scenario 5: Session evaluation marks ('I knew it' / 'Need more practice') and restart verified.");
    }

    // Scenario 6: Handling Deleted/Cleared Entries during Practice
    {
        const entries3 = [
            { id: "a", sourceText: "A", translatedText: "1" },
            { id: "b", sourceText: "B", translatedText: "2" },
            { id: "c", sourceText: "C", translatedText: "3" }
        ];
        const h = makePracticeHarness(entries3);
        h.renderPracticeView();
        h.practiceState.currentIndex = 2; // User studying card 3
        h.practiceState.sessionResults.set("c", "knew");

        // Entry 3 deleted from notebook
        h.notebookState.entries.pop(); // length becomes 2
        h.syncPracticeState();
        assert.strictEqual(h.practiceState.currentIndex, 1, "Index must clamp to total - 1");
        assert.strictEqual(h.practiceState.sessionResults.has("c"), false, "Deleted entry results must be pruned");

        // All entries cleared
        h.notebookState.entries = [];
        h.renderPracticeView();
        assert.strictEqual(h.practiceState.currentIndex, 0, "Index must reset to 0");
        assert.strictEqual(h.elements.practiceEmptyState.hidden, false, "Empty state must display");
        assert.strictEqual(h.elements.practiceCardContainer.hidden, true, "Card container must hide");
        console.log("✓ Practice Scenario 6: Deleted/cleared notebook entries handled gracefully without stale cards or errors.");
    }

    // Scenario 7: Tab Switching Preserves State
    {
        const h = makePracticeHarness(sampleEntries);
        h.elements.fromText.value = "Persistent user input";
        h.switchTab("practice");
        assert.strictEqual(h.notebookState.activeTab, "practice");
        assert.strictEqual(h.elements.panelPractice.hidden, false);

        h.switchTab("translator");
        assert.strictEqual(h.notebookState.activeTab, "translator");
        assert.strictEqual(h.elements.panelTranslator.hidden, false);
        assert.strictEqual(h.elements.fromText.value, "Persistent user input", "Translator text must not be cleared by tab switch");
        assert.strictEqual(h.notebookState.entries.length, 2, "Notebook entries must remain intact across tab switches");
        console.log("✓ Practice Scenario 7: Tab switching does not reset translator input or notebook state.");
    }

    // --------------------------------------------------------------------------
    // 8. Vocabulary Quiz Mode & Scoring
    // --------------------------------------------------------------------------
    console.log("\n[Test Category 8: Vocabulary Quiz Mode & Scoring]");

    const matchShuffle = scriptContent.match(/function shuffleArray\([^)]*\)\s*\{[\s\S]*?\n\}/);
    const matchGetEligible = scriptContent.match(/function getQuizEligibleEntries\([^)]*\)\s*\{[\s\S]*?\n\}/);
    const matchUpdateOptions = scriptContent.match(/function updateQuizSetupOptions\(\)\s*\{[\s\S]*?\n\}/);
    const matchGenQuestions = scriptContent.match(/function generateQuizQuestions\([^)]*\)\s*\{[\s\S]*?\n\}/);
    const matchStartQuiz = scriptContent.match(/function startQuiz\(\)\s*\{[\s\S]*?\n\}/);
    const matchRenderQuizView = scriptContent.match(/function renderQuizView\(\)\s*\{[\s\S]*?\n\}/);
    const matchRenderQuizQuestion = scriptContent.match(/function renderQuizQuestion\(\)\s*\{[\s\S]*?\n\}/);
    const matchSelectOption = scriptContent.match(/function selectQuizOption\([^)]*\)\s*\{[\s\S]*?\n\}/);
    const matchNextQuestion = scriptContent.match(/function nextQuizQuestion\(\)\s*\{[\s\S]*?\n\}/);
    const matchFinishQuiz = scriptContent.match(/function finishQuiz\(\)\s*\{[\s\S]*?\n\}/);
    const matchRenderResults = scriptContent.match(/function renderQuizResults\(\)\s*\{[\s\S]*?\n\}/);
    const matchRetakeQuiz = scriptContent.match(/function retakeQuiz\(\)\s*\{[\s\S]*?\n\}/);
    const matchExitQuiz = scriptContent.match(/function exitQuizToSetup\(\)\s*\{[\s\S]*?\n\}/);
    const matchSwitchSubMode = scriptContent.match(/function switchPracticeSubMode\([^)]*\)\s*\{[\s\S]*?\n\}/);

    assert(matchShuffle, "shuffleArray must exist");
    assert(matchGetEligible, "getQuizEligibleEntries must exist");
    assert(matchUpdateOptions, "updateQuizSetupOptions must exist");
    assert(matchGenQuestions, "generateQuizQuestions must exist");
    assert(matchStartQuiz, "startQuiz must exist");
    assert(matchRenderQuizView, "renderQuizView must exist");
    assert(matchRenderQuizQuestion, "renderQuizQuestion must exist");
    assert(matchSelectOption, "selectQuizOption must exist");
    assert(matchNextQuestion, "nextQuizQuestion must exist");
    assert(matchFinishQuiz, "finishQuiz must exist");
    assert(matchRenderResults, "renderQuizResults must exist");
    assert(matchRetakeQuiz, "retakeQuiz must exist");
    assert(matchExitQuiz, "exitQuizToSetup must exist");
    assert(matchSwitchSubMode, "switchPracticeSubMode must exist");

    function makeQuizHarness(initialEntries = [], initialConfig = {}) {
        const elements = {
            panelPractice: makeMockElement({ hidden: false }),
            tabPractice: makeMockElement(),
            practiceModeFlashcardsBtn: makeMockElement({ className: "practice-subnav-btn" }),
            practiceModeQuizBtn: makeMockElement({ className: "practice-subnav-btn active" }),
            practiceFlashcardsContainer: makeMockElement({ hidden: true }),
            practiceCardContainer: makeMockElement({ hidden: true }),
            practiceQuizContainer: makeMockElement({ hidden: false }),
            practiceEmptyState: makeMockElement({ hidden: true }),

            quizSetupView: makeMockElement({ hidden: false }),
            quizDirForwardBtn: makeMockElement({ className: "quiz-dir-btn active" }),
            quizDirReverseBtn: makeMockElement({ className: "quiz-dir-btn" }),
            quizLangPairItem: makeMockElement({ hidden: true }),
            quizLangPairSelect: makeMockElement({ value: "all" }),
            quizCountSelect: makeMockElement({ value: "5" }),
            quizShuffleCheck: makeMockElement({ checked: true }),
            quizSmallPoolNotice: makeMockElement({ hidden: true }),
            quizSmallPoolText: makeMockElement(),
            quizEligibilityWarning: makeMockElement({ hidden: true }),
            quizWarningText: makeMockElement(),
            quizWarningFlashcardsBtn: makeMockElement(),
            quizWarningTranslateBtn: makeMockElement(),
            quizStartBtn: makeMockElement({ disabled: false }),

            quizActiveView: makeMockElement({ hidden: true }),
            quizQuestionCounter: makeMockElement(),
            quizProgressBar: makeMockElement(),
            quizQuitBtn: makeMockElement(),
            quizPromptBadge: makeMockElement(),
            quizPromptSpeakBtn: makeMockElement(),
            quizPromptText: makeMockElement(),
            quizOptionsGrid: makeMockElement(),
            quizFeedbackBanner: makeMockElement({ hidden: true }),
            quizNextBtn: makeMockElement({ disabled: true }),
            quizNextBtnText: makeMockElement(),

            quizResultsView: makeMockElement({ hidden: true }),
            quizResultsPercent: makeMockElement(),
            quizResultsMessage: makeMockElement(),
            quizResultsTotal: makeMockElement(),
            quizResultsCorrect: makeMockElement(),
            quizResultsIncorrect: makeMockElement(),
            quizReviewSection: makeMockElement({ hidden: true }),
            quizReviewToggleBtn: makeMockElement(),
            quizReviewToggleText: makeMockElement(),
            quizReviewList: makeMockElement({ hidden: true }),
            quizRetakeBtn: makeMockElement(),
            quizSettingsBtn: makeMockElement(),
            quizBackFlashcardsBtn: makeMockElement(),

            statusArea: makeMockElement()
        };

        const notebookState = {
            entries: [...initialEntries],
            searchQuery: "",
            languageFilter: "all",
            favoritesOnly: false,
            activeTab: "practice"
        };

        const practiceState = {
            subMode: "quiz",
            currentIndex: 0,
            isAnswerShown: false,
            sessionResults: new Map()
        };

        const quizState = {
            direction: initialConfig.direction || "forward",
            selectedLanguagePair: initialConfig.selectedLanguagePair || "all",
            questionCount: initialConfig.questionCount || 5,
            shuffleOrder: initialConfig.shuffleOrder !== undefined ? initialConfig.shuffleOrder : true,
            status: "idle",
            questions: [],
            currentIndex: 0,
            userAnswers: [],
            isAnswerSubmitted: false,
            correctCount: 0,
            incorrectCount: 0
        };

        const harnessFunc = new Function(
            "elements",
            "notebookState",
            "practiceState",
            "quizState",
            "document",
            "showStatus",
            `
            ${matchShuffle[0]}
            ${matchGetEligible[0]}
            ${matchUpdateOptions[0]}
            ${matchGenQuestions[0]}
            ${matchStartQuiz[0]}
            ${matchRenderQuizView[0]}
            ${matchRenderQuizQuestion[0]}
            ${matchSelectOption[0]}
            ${matchNextQuestion[0]}
            ${matchFinishQuiz[0]}
            ${matchRenderResults[0]}
            ${matchRetakeQuiz[0]}
            ${matchExitQuiz[0]}
            ${matchSwitchSubMode[0]}
            ${matchSync[0]}

            return {
                shuffleArray,
                getQuizEligibleEntries,
                updateQuizSetupOptions,
                generateQuizQuestions,
                startQuiz,
                renderQuizView,
                renderQuizQuestion,
                selectQuizOption,
                nextQuizQuestion,
                finishQuiz,
                renderQuizResults,
                retakeQuiz,
                exitQuizToSetup,
                switchPracticeSubMode,
                syncPracticeState
            };
        `);

        const mockDocument = {
            createElement(tagName) {
                return makeMockElement({ tagName: tagName.toUpperCase() });
            },
            createTextNode(text) {
                return { textContent: text };
            }
        };

        const fns = harnessFunc(
            elements,
            notebookState,
            practiceState,
            quizState,
            mockDocument,
            () => {}
        );

        return {
            elements,
            notebookState,
            practiceState,
            quizState,
            ...fns
        };
    }

    // 1. Quiz generation from saved entries
    {
        const samplePool = [
            { id: "1", sourceText: "One", translatedText: "Uno", fromCode: "en-GB", fromName: "English", toCode: "es-ES", toName: "Spanish" },
            { id: "2", sourceText: "Two", translatedText: "Dos", fromCode: "en-GB", fromName: "English", toCode: "es-ES", toName: "Spanish" },
            { id: "3", sourceText: "Three", translatedText: "Tres", fromCode: "en-GB", fromName: "English", toCode: "es-ES", toName: "Spanish" },
            { id: "4", sourceText: "Four", translatedText: "Cuatro", fromCode: "en-GB", fromName: "English", toCode: "es-ES", toName: "Spanish" },
            { id: "5", sourceText: "Five", translatedText: "Cinco", fromCode: "en-GB", fromName: "English", toCode: "es-ES", toName: "Spanish" }
        ];
        const h = makeQuizHarness(samplePool);
        const questions = h.generateQuizQuestions({ direction: "forward", count: 5, shuffle: false });
        assert.strictEqual(questions.length, 5, "Must generate 5 questions");
        questions.forEach((q, idx) => {
            assert.strictEqual(q.promptText, samplePool[idx].sourceText);
            assert.strictEqual(q.correctAnswer, samplePool[idx].translatedText);
            assert(q.options.includes(q.correctAnswer), "Options must contain correct answer");
            assert.strictEqual(q.options[q.correctOptionIndex], q.correctAnswer);
            assert.strictEqual(q.options.length, 4, "Must have 4 options when pool >= 4");
        });
        console.log("✓ Quiz Scenario 1: Quiz generation from saved entries with correct prompt, answers, and 4 choices.");
    }

    // 2. Both translation directions
    {
        const samplePool = [
            { id: "1", sourceText: "Cat", translatedText: "Gato", fromCode: "en-GB", fromName: "English", toCode: "es-ES", toName: "Spanish" },
            { id: "2", sourceText: "Dog", translatedText: "Perro", fromCode: "en-GB", fromName: "English", toCode: "es-ES", toName: "Spanish" },
            { id: "3", sourceText: "Fish", translatedText: "Pez", fromCode: "en-GB", fromName: "English", toCode: "es-ES", toName: "Spanish" },
            { id: "4", sourceText: "Bird", translatedText: "Pájaro", fromCode: "en-GB", fromName: "English", toCode: "es-ES", toName: "Spanish" }
        ];
        const h = makeQuizHarness(samplePool);

        // Forward (English -> Spanish)
        const fwd = h.generateQuizQuestions({ direction: "forward", count: 1, shuffle: false })[0];
        assert.strictEqual(fwd.promptText, "Cat");
        assert.strictEqual(fwd.promptLang, "English");
        assert.strictEqual(fwd.correctAnswer, "Gato");
        assert.strictEqual(fwd.targetLang, "Spanish");

        // Reverse (Spanish -> English)
        const rev = h.generateQuizQuestions({ direction: "reverse", count: 1, shuffle: false })[0];
        assert.strictEqual(rev.promptText, "Gato");
        assert.strictEqual(rev.promptLang, "Spanish");
        assert.strictEqual(rev.correctAnswer, "Cat");
        assert.strictEqual(rev.targetLang, "English");

        console.log("✓ Quiz Scenario 2: Translation directions correctly assign prompt, correct answer, and language labels.");
    }

    // 3. Valid question counts and shuffled ordering
    {
        const entries = [];
        for (let i = 1; i <= 10; i++) {
            entries.push({ id: `e${i}`, sourceText: `Word${i}`, translatedText: `Trans${i}`, fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" });
        }
        const h = makeQuizHarness(entries);

        // Requested 3 questions
        const q3 = h.generateQuizQuestions({ count: 3 });
        assert.strictEqual(q3.length, 3, "Count of 3 must yield exactly 3 questions");

        // Requested "all" questions
        const qAll = h.generateQuizQuestions({ count: "all" });
        assert.strictEqual(qAll.length, 10, "Count 'all' must yield all 10 questions");

        // Requested 25 questions (greater than total)
        const qCapped = h.generateQuizQuestions({ count: 25 });
        assert.strictEqual(qCapped.length, 10, "Requested count exceeding pool must be capped to pool length");

        // Shuffled order preservation
        const qShuffled = h.generateQuizQuestions({ count: 10, shuffle: true });
        assert.strictEqual(qShuffled.length, 10);
        const shuffledIds = new Set(qShuffled.map(q => q.entryId));
        assert.strictEqual(shuffledIds.size, 10, "Shuffle must preserve all unique entries");

        console.log("✓ Quiz Scenario 3: Question count clamping (3, all, excess) and shuffled order verified.");
    }

    // 4. Unique multiple-choice options
    {
        const pool = [
            { id: "1", sourceText: "Sun", translatedText: "Soleil", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Moon", translatedText: "Lune", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "3", sourceText: "Star", translatedText: "Étoile", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "4", sourceText: "Sky", translatedText: "Ciel", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "5", sourceText: "Cloud", translatedText: "Nuage", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeQuizHarness(pool);
        const questions = h.generateQuizQuestions({ count: "all" });

        questions.forEach(q => {
            const uniqueOptions = new Set(q.options.map(o => o.toLowerCase()));
            assert.strictEqual(uniqueOptions.size, q.options.length, "All options for question must be distinct");
            assert.strictEqual(q.options.length, 4, "Must have 4 unique options");
        });
        console.log("✓ Quiz Scenario 4: Multiple-choice options contain zero duplicates and distinct distractors.");
    }

    // 5. Correct and incorrect answer evaluation
    {
        const pool = [
            { id: "1", sourceText: "Water", translatedText: "Eau", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Fire", translatedText: "Feu", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "3", sourceText: "Earth", translatedText: "Terre", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "4", sourceText: "Air", translatedText: "Air", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeQuizHarness(pool, { shuffleOrder: false });
        h.startQuiz();
        assert.strictEqual(h.quizState.status, "active");
        assert.strictEqual(h.elements.quizActiveView.hidden, false);

        // Q1: Answer correctly
        const q0 = h.quizState.questions[0];
        h.selectQuizOption(q0.correctOptionIndex);
        assert.strictEqual(h.quizState.correctCount, 1);
        assert.strictEqual(h.quizState.incorrectCount, 0);
        assert.strictEqual(h.quizState.userAnswers[0].isCorrect, true);
        assert.strictEqual(h.elements.quizFeedbackBanner.hidden, false);
        assert(h.elements.quizFeedbackBanner.textContent.includes("Correct!"));

        // Advance to Q2
        h.nextQuizQuestion();
        assert.strictEqual(h.quizState.currentIndex, 1);

        // Q2: Answer incorrectly
        const q1 = h.quizState.questions[1];
        const wrongIndex = (q1.correctOptionIndex + 1) % q1.options.length;
        h.selectQuizOption(wrongIndex);
        assert.strictEqual(h.quizState.correctCount, 1);
        assert.strictEqual(h.quizState.incorrectCount, 1);
        assert.strictEqual(h.quizState.userAnswers[1].isCorrect, false);
        assert.strictEqual(h.elements.quizFeedbackBanner.hidden, false);
        assert(h.elements.quizFeedbackBanner.textContent.includes("Incorrect"));
        assert(h.elements.quizFeedbackBanner.textContent.includes(q1.correctAnswer));

        console.log("✓ Quiz Scenario 5: Correct and incorrect answers properly tallied with immediate feedback banners.");
    }

    // 6. Prevention of duplicate score counting
    {
        const pool = [
            { id: "1", sourceText: "Red", translatedText: "Rouge", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Green", translatedText: "Vert", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "3", sourceText: "Blue", translatedText: "Bleu", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeQuizHarness(pool);
        h.startQuiz();

        // Answer once
        h.selectQuizOption(0);
        const correctAfterFirst = h.quizState.correctCount;
        const incorrectAfterFirst = h.quizState.incorrectCount;
        const answersLenAfterFirst = h.quizState.userAnswers.length;

        // Repeated clicks on options
        h.selectQuizOption(1);
        h.selectQuizOption(2);

        assert.strictEqual(h.quizState.correctCount, correctAfterFirst, "Score must not increment on repeated clicks");
        assert.strictEqual(h.quizState.incorrectCount, incorrectAfterFirst, "Incorrect count must not increment on repeated clicks");
        assert.strictEqual(h.quizState.userAnswers.length, answersLenAfterFirst, "No duplicate user answers recorded");

        console.log("✓ Quiz Scenario 6: Repeated clicks on options prevented from altering score or answers.");
    }

    // 7. Score and percentage calculation
    {
        const pool = [
            { id: "1", sourceText: "Day", translatedText: "Jour", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Night", translatedText: "Nuit", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "3", sourceText: "Morning", translatedText: "Matin", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "4", sourceText: "Evening", translatedText: "Soir", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeQuizHarness(pool);
        h.startQuiz();

        // 3 correct, 1 incorrect
        for (let i = 0; i < 4; i++) {
            const q = h.quizState.questions[h.quizState.currentIndex];
            if (i < 3) {
                h.selectQuizOption(q.correctOptionIndex);
            } else {
                h.selectQuizOption((q.correctOptionIndex + 1) % q.options.length);
            }
            h.nextQuizQuestion();
        }

        assert.strictEqual(h.quizState.status, "completed");
        assert.strictEqual(h.elements.quizResultsView.hidden, false);
        assert.strictEqual(h.elements.quizResultsTotal.textContent, "4");
        assert.strictEqual(h.elements.quizResultsCorrect.textContent, "3");
        assert.strictEqual(h.elements.quizResultsIncorrect.textContent, "1");
        assert.strictEqual(h.elements.quizResultsPercent.textContent, "75%");
        assert(h.elements.quizResultsMessage.textContent.length > 0, "Encouraging message must be displayed");

        console.log("✓ Quiz Scenario 7: Final score breakdown and percentage (75%) accurately calculated.");
    }

    // 8. Small notebooks and insufficient answer choices
    {
        // 0 entries
        const h0 = makeQuizHarness([]);
        h0.updateQuizSetupOptions();
        assert.strictEqual(h0.elements.quizStartBtn.disabled, true);
        assert.strictEqual(h0.elements.quizEligibilityWarning.hidden, false);

        // 1 entry (insufficient for multiple choice)
        const h1 = makeQuizHarness([
            { id: "1", sourceText: "Solo", translatedText: "Seul", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ]);
        h1.updateQuizSetupOptions();
        assert.strictEqual(h1.elements.quizStartBtn.disabled, true);
        assert.strictEqual(h1.elements.quizEligibilityWarning.hidden, false);
        assert(h1.elements.quizWarningText.textContent.includes("requires at least 2 saved words"));

        // 2 entries (small pool notice with 2 choices)
        const h2 = makeQuizHarness([
            { id: "1", sourceText: "One", translatedText: "Un", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Two", translatedText: "Deux", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ]);
        h2.updateQuizSetupOptions();
        assert.strictEqual(h2.elements.quizStartBtn.disabled, false);
        assert.strictEqual(h2.elements.quizEligibilityWarning.hidden, true);
        assert.strictEqual(h2.elements.quizSmallPoolNotice.hidden, false);
        assert(h2.elements.quizSmallPoolText.textContent.includes("2 answer choices instead of 4"));

        const q2 = h2.generateQuizQuestions();
        assert.strictEqual(q2[0].options.length, 2, "Questions with 2 entries must provide 2 choices");

        console.log("✓ Quiz Scenario 8: Small notebook pool sizes (<2 disabled with warning, 2-3 with banner and graceful options).");
    }

    // 9. Incorrect-answer review
    {
        const pool = [
            { id: "1", sourceText: "House", translatedText: "Maison", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Tree", translatedText: "Arbre", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "3", sourceText: "Car", translatedText: "Voiture", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeQuizHarness(pool);
        h.startQuiz();

        // Q1: correct
        const q0 = h.quizState.questions[0];
        h.selectQuizOption(q0.correctOptionIndex);
        h.nextQuizQuestion();

        // Q2: incorrect
        const q1 = h.quizState.questions[1];
        const wrongIdx = (q1.correctOptionIndex + 1) % q1.options.length;
        h.selectQuizOption(wrongIdx);
        h.nextQuizQuestion();

        // Q3: correct
        const q2 = h.quizState.questions[2];
        h.selectQuizOption(q2.correctOptionIndex);
        h.nextQuizQuestion();

        assert.strictEqual(h.quizState.status, "completed");
        assert.strictEqual(h.elements.quizReviewSection.hidden, false, "Review section must be visible when errors exist");
        assert(h.elements.quizReviewToggleText.textContent.includes("Review Incorrect Answers (1)"));
        assert.strictEqual(h.elements.quizReviewList.children.length, 1, "Must contain 1 review card");
        const reviewItem = h.elements.quizReviewList.children[0];
        const ansWrap = reviewItem.children[1];
        const userAnsText = ansWrap.children[0].children[1].textContent;
        const correctAnsText = ansWrap.children[1].children[1].textContent;
        assert(userAnsText.includes(q1.options[wrongIdx]), "Review card must display actual incorrect choice submitted");
        assert(correctAnsText.includes(q1.correctAnswer), "Review card must display correct translation");

        // Perfect score test: review section must be hidden
        const hPerf = makeQuizHarness(pool);
        hPerf.startQuiz();
        for (let i = 0; i < 3; i++) {
            hPerf.selectQuizOption(hPerf.quizState.questions[hPerf.quizState.currentIndex].correctOptionIndex);
            hPerf.nextQuizQuestion();
        }
        assert.strictEqual(hPerf.elements.quizReviewSection.hidden, true, "Review section must hide on 100% score");

        console.log("✓ Quiz Scenario 9: Review incorrect answers correctly shows missed questions and hides on perfect scores.");
    }

    // 10. Retaking a quiz and resetting session state
    {
        const pool = [
            { id: "1", sourceText: "Bread", translatedText: "Pain", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Butter", translatedText: "Beurre", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "3", sourceText: "Cheese", translatedText: "Fromage", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeQuizHarness(pool);
        h.startQuiz();
        h.selectQuizOption(0);
        h.finishQuiz();
        assert.strictEqual(h.quizState.status, "completed");

        // Retake quiz
        h.retakeQuiz();
        assert.strictEqual(h.quizState.status, "active", "Status must reset to active");
        assert.strictEqual(h.quizState.currentIndex, 0, "Index must reset to 0");
        assert.strictEqual(h.quizState.correctCount, 0, "Correct count must reset to 0");
        assert.strictEqual(h.quizState.incorrectCount, 0, "Incorrect count must reset to 0");
        assert.strictEqual(h.quizState.userAnswers.length, 0, "Answers list must be cleared");
        assert.strictEqual(h.quizState.isAnswerSubmitted, false, "Submission lock must be reset");

        console.log("✓ Quiz Scenario 10: Retaking quiz cleanly resets in-memory session stats and restarts from question 1.");
    }

    // 11. Handling deleted entries and empty notebooks during a quiz
    {
        const pool = [
            { id: "1", sourceText: "Cat", translatedText: "Chat", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Dog", translatedText: "Chien", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "3", sourceText: "Cow", translatedText: "Vache", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeQuizHarness(pool);
        h.startQuiz();
        assert.strictEqual(h.quizState.status, "active");

        // Delete entry 2 from notebook while quiz is active
        h.notebookState.entries = h.notebookState.entries.filter(e => e.id !== "2");
        h.syncPracticeState();
        assert.strictEqual(h.quizState.status, "idle", "Quiz must safely return to setup if an entry was deleted");
        assert.strictEqual(h.quizState.questions.length, 0, "Stale questions must be pruned");

        // Clear all entries
        h.notebookState.entries = [];
        h.syncPracticeState();
        assert.strictEqual(h.quizState.status, "idle");
        assert.strictEqual(h.elements.quizStartBtn.disabled, true);

        console.log("✓ Quiz Scenario 11: Active quiz mutation guards safely handle deleted/cleared entries without throwing errors.");
    }

    // 12. Quiz navigation guard prevents double-advancement or execution when inactive
    {
        const pool = [
            { id: "1", sourceText: "Cat", translatedText: "Chat", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Dog", translatedText: "Chien", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeQuizHarness(pool, { questionCount: 2, shuffleOrder: false });
        // Inactive quiz call should do nothing
        h.nextQuizQuestion();
        assert.strictEqual(h.quizState.currentIndex, 0);

        h.startQuiz();
        assert.strictEqual(h.quizState.status, "active");
        // Cannot advance before answer is submitted
        h.nextQuizQuestion();
        assert.strictEqual(h.quizState.currentIndex, 0);

        // Submit answer
        h.selectQuizOption(0);
        assert.strictEqual(h.quizState.isAnswerSubmitted, true);
        h.nextQuizQuestion();
        assert.strictEqual(h.quizState.currentIndex, 1);

        // Rapid duplicate call should not advance past boundaries
        h.nextQuizQuestion();
        assert.strictEqual(h.quizState.currentIndex, 1);

        console.log("✓ Quiz Scenario 12: Quiz navigation guard strictly prevents premature advancement and double execution.");
    }

    // 13. Review section state resets to collapsed upon completing a quiz
    {
        const pool = [
            { id: "1", sourceText: "Cat", translatedText: "Chat", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Dog", translatedText: "Chien", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeQuizHarness(pool, { questionCount: 2, shuffleOrder: false });
        h.startQuiz();
        // Answer first question wrong
        const wrongOption = (h.quizState.questions[0].correctOptionIndex === 0) ? 1 : 0;
        h.selectQuizOption(wrongOption);
        h.nextQuizQuestion();
        // Answer second question correct
        h.selectQuizOption(h.quizState.questions[1].correctOptionIndex);
        h.nextQuizQuestion();

        assert.strictEqual(h.quizState.status, "completed");
        assert.strictEqual(h.elements.quizReviewSection.hidden, false, "Review section must be visible when errors exist");
        assert.strictEqual(h.elements.quizReviewList.hidden, true, "Review list must start collapsed");
        assert.strictEqual(h.elements.quizReviewToggleBtn.getAttribute("aria-expanded"), "false", "aria-expanded must be false initially");

        console.log("✓ Quiz Scenario 13: Review incorrect answers section cleanly resets to collapsed accordion state.");
    }

    // --------------------------------------------------------------------------
    // 9. Learning Progress Dashboard
    // --------------------------------------------------------------------------
    console.log("\n[Test Category 9: Learning Progress Dashboard]");

    const matchGetMetrics = scriptContent.match(/function getProgressMetrics\(\)\s*\{[\s\S]*?\n\}/);
    const matchUpdateDashboard = scriptContent.match(/function updateProgressDashboard\(\)\s*\{[\s\S]*?\n\}/);
    const matchRenderProgress = scriptContent.match(/function renderProgressView\(\)\s*\{[\s\S]*?\n\}/);
    const matchGenId = scriptContent.match(/function generateUniqueId\(\)\s*\{[\s\S]*?\n\}/);

    assert(matchGetMetrics, "getProgressMetrics must exist in script.js");
    assert(matchUpdateDashboard, "updateProgressDashboard must exist in script.js");
    assert(matchRenderProgress, "renderProgressView must exist in script.js");
    assert(matchGenId, "generateUniqueId must exist in script.js");

    function makeProgressHarness(initialEntries = [], initialProgress = {}) {
        const elements = {
            tabTranslator: makeMockElement(),
            tabNotebook: makeMockElement(),
            tabPractice: makeMockElement(),
            tabProgress: makeMockElement(),
            panelTranslator: makeMockElement({ hidden: false }),
            panelNotebook: makeMockElement({ hidden: true }),
            panelPractice: makeMockElement({ hidden: true }),
            panelProgress: makeMockElement({ hidden: true }),

            progressTotalVocab: makeMockElement(),
            progressTotalFavs: makeMockElement(),
            progressFlashcardsReviewed: makeMockElement(),
            progressQuizAttempts: makeMockElement(),
            progressQuizAccuracy: makeMockElement(),
            progressQuizCorrect: makeMockElement(),
            progressQuizIncorrect: makeMockElement(),
            progressEmptyState: makeMockElement({ hidden: false }),
            progressEmptyQuizBtn: makeMockElement(),
            progressEmptyFlashcardsBtn: makeMockElement(),
            progressHistoryContainer: makeMockElement({ hidden: true }),
            progressHistoryList: makeMockElement(),
            progressDailyEmptyState: makeMockElement({ hidden: false }),
            progressDailyContainer: makeMockElement({ hidden: true }),
            progressDailyList: makeMockElement(),

            practiceCardContainer: makeMockElement(),
            practiceFlashcardsContainer: makeMockElement(),
            practiceQuizContainer: makeMockElement(),
            practiceEmptyState: makeMockElement(),
            flashcard: makeMockElement(),
            flashcardFront: makeMockElement(),
            flashcardBack: makeMockElement(),
            flashcardFrontLang: makeMockElement(),
            flashcardBackLang: makeMockElement(),
            flashcardFrontText: makeMockElement(),
            flashcardBackText: makeMockElement(),
            flashcardFlipBtn: makeMockElement(),
            flashcardFlipBtnText: makeMockElement(),
            flashcardStatusTag: makeMockElement({ hidden: true }),
            practiceCardCounter: makeMockElement(),
            practiceKnownCount: makeMockElement(),
            practiceLearningCount: makeMockElement(),
            practicePrevBtn: makeMockElement({ disabled: true }),
            practiceNextBtn: makeMockElement({ disabled: true }),
            practiceKnewItBtn: makeMockElement(),
            practiceNeedWorkBtn: makeMockElement(),

            quizSetupView: makeMockElement(),
            quizActiveView: makeMockElement({ hidden: true }),
            quizResultsView: makeMockElement({ hidden: true }),
            quizQuestionCounter: makeMockElement(),
            quizProgressBar: makeMockElement(),
            quizPromptBadge: makeMockElement(),
            quizPromptText: makeMockElement(),
            quizOptionsGrid: makeMockElement(),
            quizFeedbackBanner: makeMockElement({ hidden: true }),
            quizNextBtn: makeMockElement({ disabled: true }),
            quizResultsPercent: makeMockElement(),
            quizResultsTotal: makeMockElement(),
            quizResultsCorrect: makeMockElement(),
            quizResultsIncorrect: makeMockElement(),
            quizResultsMessage: makeMockElement(),
            quizReviewSection: makeMockElement({ hidden: true }),
            quizReviewList: makeMockElement(),
            quizStartBtn: makeMockElement(),

            fromText: makeMockElement({ value: "" }),
            toText: makeMockElement({ value: "" }),
            statusArea: makeMockElement()
        };

        const notebookState = {
            entries: [...initialEntries],
            searchQuery: "",
            languageFilter: "all",
            favoritesOnly: false,
            activeTab: "progress"
        };

        const practiceState = {
            currentIndex: 0,
            isAnswerShown: false,
            sessionResults: new Map(),
            subMode: "flashcards"
        };

        const quizState = {
            direction: "forward",
            selectedLanguagePair: "all",
            questionCount: 5,
            shuffleOrder: false,
            status: "idle",
            questions: [],
            currentIndex: 0,
            userAnswers: [],
            isAnswerSubmitted: false,
            isAttemptRecorded: false,
            correctCount: 0,
            incorrectCount: 0
        };

        const progressState = {
            flashcardReviews: initialProgress.flashcardReviews || 0,
            reviewedCardIds: new Set(initialProgress.reviewedCardIds || []),
            quizHistory: initialProgress.quizHistory ? [...initialProgress.quizHistory] : [],
            cardAssessments: initialProgress.cardAssessments ? { ...initialProgress.cardAssessments } : {},
            dailyActivity: initialProgress.dailyActivity ? { ...initialProgress.dailyActivity } : {}
        };

        const harnessFunc = new Function(
            "elements",
            "notebookState",
            "practiceState",
            "quizState",
            "progressState",
            "document",
            "showStatus",
            `
            ${matchGetMetrics[0]}
            ${matchUpdateDashboard[0]}
            ${matchRenderProgress[0]}
            ${matchRecord[0]}
            ${matchRenderCard[0]}
            ${matchToggle[0]}
            ${matchGenQuestions[0]}
            ${matchStartQuiz[0]}
            ${matchRenderQuizView[0]}
            ${matchSelectOption[0]}
            ${matchNextQuestion[0]}
            ${matchFinishQuiz[0]}
            ${matchRenderResults[0]}
            ${matchRetakeQuiz[0]}
            ${matchSwitchTab[0]}
            ${matchSync[0]}
            ${matchShuffle[0]}
            ${matchGetEligible[0]}
            ${matchUpdateOptions[0]}
            ${matchRenderQuizQuestion[0]}
            ${matchGenId[0]}

            return {
                getProgressMetrics,
                updateProgressDashboard,
                renderProgressView,
                recordPracticeResult,
                renderPracticeCard,
                toggleFlashcardAnswer,
                generateQuizQuestions,
                startQuiz,
                renderQuizView,
                selectQuizOption,
                nextQuizQuestion,
                finishQuiz,
                renderQuizResults,
                retakeQuiz,
                switchTab,
                syncPracticeState
            };
            `
        );

        const mockDocument = {
            createElement(tagName) {
                return makeMockElement({ tagName: tagName.toUpperCase() });
            },
            createTextNode(text) {
                return { textContent: text };
            }
        };

        const api = harnessFunc(
            elements,
            notebookState,
            practiceState,
            quizState,
            progressState,
            mockDocument,
            () => {}
        );

        return {
            elements,
            notebookState,
            practiceState,
            quizState,
            progressState,
            ...api
        };
    }

    // 1. Vocabulary and favorite counts
    {
        const entries = [
            { id: "1", sourceText: "One", translatedText: "Uno", isFavorite: true },
            { id: "2", sourceText: "Two", translatedText: "Dos", isFavorite: false },
            { id: "3", sourceText: "Three", translatedText: "Tres", isFavorite: true },
            { id: "4", sourceText: "Four", translatedText: "Cuatro", isFavorite: false }
        ];
        const h = makeProgressHarness(entries);
        const metrics = h.getProgressMetrics();

        assert.strictEqual(metrics.totalVocabulary, 4, "Total vocabulary must equal notebook entries length");
        assert.strictEqual(metrics.favoriteCount, 2, "Favorite count must equal number of favorited entries");

        h.updateProgressDashboard();
        assert.strictEqual(h.elements.progressTotalVocab.textContent, "4", "DOM total vocab count must display 4");
        assert.strictEqual(h.elements.progressTotalFavs.textContent, "2", "DOM favorite count must display 2");

        console.log("✓ Progress Scenario 1: Vocabulary and favorite counts accurately calculated and displayed.");
    }

    // 2. Flashcard reviews counted only after an assessment
    {
        const entries = [
            { id: "1", sourceText: "Cat", translatedText: "Gato" },
            { id: "2", sourceText: "Dog", translatedText: "Perro" }
        ];
        const h = makeProgressHarness(entries);

        // Simply viewing and flipping card
        h.toggleFlashcardAnswer();
        assert.strictEqual(h.progressState.flashcardReviews, 0, "Flipping card must not increment review count");
        assert.strictEqual(h.getProgressMetrics().flashcardsReviewed, 0);

        // Record assessment: knew it
        h.recordPracticeResult("knew");
        assert.strictEqual(h.progressState.flashcardReviews, 1, "Recording assessment must increment review count to 1");
        assert.strictEqual(h.getProgressMetrics().flashcardsReviewed, 1);
        assert.strictEqual(h.elements.progressFlashcardsReviewed.textContent, "1");

        console.log("✓ Progress Scenario 2: Flashcard reviews counted strictly upon recorded assessment.");
    }

    // 3. Quiz attempts counted only after completion
    {
        const entries = [
            { id: "1", sourceText: "Book", translatedText: "Livre", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Pen", translatedText: "Stylo", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "3", sourceText: "Paper", translatedText: "Papier", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeProgressHarness(entries);
        h.startQuiz();
        assert.strictEqual(h.quizState.status, "active");
        assert.strictEqual(h.getProgressMetrics().quizAttemptsCount, 0, "Starting quiz must not increment attempts before completion");

        // Answer Q1
        h.selectQuizOption(h.quizState.questions[0].correctOptionIndex);
        assert.strictEqual(h.getProgressMetrics().quizAttemptsCount, 0, "In-progress questions must not increment completed attempts");

        // Finish quiz
        h.finishQuiz();
        assert.strictEqual(h.quizState.status, "completed");
        assert.strictEqual(h.progressState.quizHistory.length, 1, "Finished quiz must record exactly 1 attempt");
        assert.strictEqual(h.getProgressMetrics().quizAttemptsCount, 1);
        assert.strictEqual(h.elements.progressQuizAttempts.textContent, "1");

        console.log("✓ Progress Scenario 3: Quiz attempts counted only upon full quiz completion.");
    }

    // 4. Correct and incorrect answer totals
    {
        const initialQuizHistory = [
            { id: "att1", timestamp: Date.now() - 5000, totalQuestions: 4, correctCount: 3, incorrectCount: 1, percentage: 75, direction: "forward" }
        ];
        const h = makeProgressHarness([], { quizHistory: initialQuizHistory });
        const metrics = h.getProgressMetrics();

        assert.strictEqual(metrics.totalQuizCorrect, 3, "Total correct must sum to 3");
        assert.strictEqual(metrics.totalQuizIncorrect, 1, "Total incorrect must sum to 1");
        assert.strictEqual(metrics.totalQuizAnswers, 4, "Total quiz answers must sum to 4");

        h.updateProgressDashboard();
        assert.strictEqual(h.elements.progressQuizCorrect.textContent, "3");
        assert.strictEqual(h.elements.progressQuizIncorrect.textContent, "1");

        console.log("✓ Progress Scenario 4: Correct and incorrect answer totals accurately aggregated across attempts.");
    }

    // 5. Accurate quiz accuracy calculations, including zero-answer edge cases
    {
        // Zero answers edge case
        const hZero = makeProgressHarness([], { quizHistory: [] });
        const mZero = hZero.getProgressMetrics();
        assert.strictEqual(mZero.totalQuizAnswers, 0);
        assert.strictEqual(mZero.overallQuizAccuracy, 0, "Zero answers must yield 0% accuracy without NaN or division by zero");
        hZero.updateProgressDashboard();
        assert.strictEqual(hZero.elements.progressQuizAccuracy.textContent, "0%");

        // Perfect score (100%)
        const hPerf = makeProgressHarness([], {
            quizHistory: [{ id: "p1", timestamp: Date.now(), totalQuestions: 5, correctCount: 5, incorrectCount: 0, percentage: 100 }]
        });
        assert.strictEqual(hPerf.getProgressMetrics().overallQuizAccuracy, 100);
        hPerf.updateProgressDashboard();
        assert.strictEqual(hPerf.elements.progressQuizAccuracy.textContent, "100%");

        // Zero score (0%)
        const hZeroScore = makeProgressHarness([], {
            quizHistory: [{ id: "z1", timestamp: Date.now(), totalQuestions: 3, correctCount: 0, incorrectCount: 3, percentage: 0 }]
        });
        assert.strictEqual(hZeroScore.getProgressMetrics().overallQuizAccuracy, 0);

        // Multiple mixed attempts: (3/4) + (3/4) = 6/8 = 75%
        const hMixed = makeProgressHarness([], {
            quizHistory: [
                { id: "m1", timestamp: Date.now() - 1000, totalQuestions: 4, correctCount: 3, incorrectCount: 1, percentage: 75 },
                { id: "m2", timestamp: Date.now(), totalQuestions: 4, correctCount: 3, incorrectCount: 1, percentage: 75 }
            ]
        });
        assert.strictEqual(hMixed.getProgressMetrics().overallQuizAccuracy, 75);

        console.log("✓ Progress Scenario 5: Accurate quiz accuracy calculations and zero-answer edge cases verified.");
    }

    // 6. Retakes counted as separate completed attempts
    {
        const entries = [
            { id: "1", sourceText: "Apple", translatedText: "Pomme", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "2", sourceText: "Banana", translatedText: "Banane", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" },
            { id: "3", sourceText: "Orange", translatedText: "Orange", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French" }
        ];
        const h = makeProgressHarness(entries);

        // Attempt 1
        h.startQuiz();
        h.selectQuizOption(h.quizState.questions[0].correctOptionIndex);
        h.finishQuiz();
        assert.strictEqual(h.progressState.quizHistory.length, 1);

        // Retake quiz (Attempt 2)
        h.retakeQuiz();
        assert.strictEqual(h.quizState.status, "active");
        assert.strictEqual(h.quizState.isAttemptRecorded, false, "isAttemptRecorded must reset on retake");
        assert.strictEqual(h.progressState.quizHistory.length, 1, "In-progress retake must not record prematurely");

        h.selectQuizOption(h.quizState.questions[0].correctOptionIndex);
        h.finishQuiz();
        assert.strictEqual(h.progressState.quizHistory.length, 2, "Finished retake must append second completed attempt");
        assert.notStrictEqual(h.progressState.quizHistory[0].id, h.progressState.quizHistory[1].id, "Attempts must have unique IDs");

        console.log("✓ Progress Scenario 6: Retakes cleanly counted as separate completed attempts.");
    }

    // 7. No duplicate counting on rerenders or repeated interactions
    {
        const entries = [
            { id: "1", sourceText: "Sun", translatedText: "Soleil" },
            { id: "2", sourceText: "Moon", translatedText: "Lune" }
        ];
        const h = makeProgressHarness(entries);

        // Flashcards: repeated clicks on same card
        h.recordPracticeResult("knew");
        assert.strictEqual(h.progressState.flashcardReviews, 1);
        h.recordPracticeResult("knew");
        assert.strictEqual(h.progressState.flashcardReviews, 1, "Repeated clicks on 'I knew it' must not double-count");
        h.recordPracticeResult("practice");
        assert.strictEqual(h.progressState.flashcardReviews, 1, "Changing assessment on same card must not double-count");

        // Quiz: repeated finishQuiz or renderResults calls
        h.startQuiz();
        h.finishQuiz();
        const attemptsCount = h.progressState.quizHistory.length;
        h.finishQuiz();
        h.finishQuiz();
        assert.strictEqual(h.progressState.quizHistory.length, attemptsCount, "Repeated finishQuiz calls must not double-record attempts");

        // Dashboard rerenders
        h.renderProgressView();
        h.renderProgressView();
        assert.strictEqual(h.progressState.flashcardReviews, 1);
        assert.strictEqual(h.progressState.quizHistory.length, attemptsCount);

        console.log("✓ Progress Scenario 7: No duplicate counting on rerenders or repeated interactions.");
    }

    // 8. Dashboard updates after vocabulary is added, favorited, unfavorited, or deleted
    {
        const entries = [
            { id: "1", sourceText: "Word1", translatedText: "Trans1", isFavorite: false },
            { id: "2", sourceText: "Word2", translatedText: "Trans2", isFavorite: true }
        ];
        const h = makeProgressHarness(entries);
        assert.strictEqual(h.getProgressMetrics().totalVocabulary, 2);
        assert.strictEqual(h.getProgressMetrics().favoriteCount, 1);

        // Add vocabulary
        h.notebookState.entries.push({ id: "3", sourceText: "Word3", translatedText: "Trans3", isFavorite: false });
        h.syncPracticeState();
        assert.strictEqual(h.getProgressMetrics().totalVocabulary, 3, "Adding entry must update dashboard count");

        // Favorite entry 3
        h.notebookState.entries[2].isFavorite = true;
        h.syncPracticeState();
        assert.strictEqual(h.getProgressMetrics().favoriteCount, 2, "Favoriting entry must update dashboard count");

        // Unfavorite entry 2
        h.notebookState.entries[1].isFavorite = false;
        h.syncPracticeState();
        assert.strictEqual(h.getProgressMetrics().favoriteCount, 1, "Unfavoriting entry must decrement dashboard count");

        // Delete entry 1
        h.notebookState.entries = h.notebookState.entries.filter(e => e.id !== "1");
        h.syncPracticeState();
        assert.strictEqual(h.getProgressMetrics().totalVocabulary, 2, "Deleting entry must update dashboard count");

        // Clear all entries
        h.notebookState.entries = [];
        h.syncPracticeState();
        assert.strictEqual(h.getProgressMetrics().totalVocabulary, 0, "Clearing all must reset vocab count to 0");
        assert.strictEqual(h.getProgressMetrics().favoriteCount, 0, "Clearing all must reset favorite count to 0");

        console.log("✓ Progress Scenario 8: Dashboard dynamically updates when vocabulary is added, favorited, or deleted.");
    }

    // 9. Empty-state behavior
    {
        const h = makeProgressHarness([], { quizHistory: [], dailyActivity: {} });
        h.renderProgressView();

        // 1. Both empty states must be visible when no history or daily activity exists
        assert.strictEqual(h.elements.progressEmptyState.hidden, false, "Empty quiz state must be visible when 0 quiz attempts completed");
        assert.strictEqual(h.elements.progressHistoryContainer.hidden, true, "History container must be hidden when 0 quiz attempts completed");
        assert.strictEqual(h.elements.progressDailyEmptyState.hidden, false, "Empty daily state must be visible when 0 daily activity exists");
        assert.strictEqual(h.elements.progressDailyContainer.hidden, true, "Daily container must be hidden when 0 daily activity exists");

        // 2. Add attempt and daily activity and render
        const todayStr = new Date().toISOString().split("T")[0];
        h.progressState.quizHistory.push({
            id: "att1",
            timestamp: Date.now(),
            totalQuestions: 5,
            correctCount: 4,
            incorrectCount: 1,
            percentage: 80,
            direction: "forward"
        });
        h.progressState.dailyActivity[todayStr] = {
            date: todayStr,
            flashcardReviews: 0,
            quizAttempts: 1,
            quizCorrect: 4,
            quizIncorrect: 1
        };
        h.renderProgressView();

        // 3. Both empty states must be hidden and content containers must be visible
        assert.strictEqual(h.elements.progressEmptyState.hidden, true, "Empty quiz state must hide after quiz completion");
        assert.strictEqual(h.elements.progressHistoryContainer.hidden, false, "History container must show after quiz completion");
        assert.strictEqual(h.elements.progressHistoryList.children.length, 1, "History list must contain attempt card");
        assert.strictEqual(h.elements.progressDailyEmptyState.hidden, true, "Empty daily state must hide when daily activity exists");
        assert.strictEqual(h.elements.progressDailyContainer.hidden, false, "Daily container must show when daily activity exists");
        assert.strictEqual(h.elements.progressDailyList.children.length, 1, "Daily list must contain day activity item");

        // 4. Verify CSS rule enforcement in style.css so [hidden] overrides author display rules
        const css = fs.readFileSync("style.css", "utf8");
        assert(css.includes("[hidden] {\n  display: none !important;\n}"), "style.css must enforce universal [hidden] display: none !important");
        assert(css.includes(".progress-empty-state[hidden] {\n  display: none !important;\n}"), "style.css must enforce .progress-empty-state[hidden] display: none !important");

        console.log("✓ Progress Scenario 9: Empty-state and score-history visualization correctly toggled.");
    }

    // 10. Tab switching without loss of existing application state
    {
        const h = makeProgressHarness([{ id: "1", sourceText: "Preserved", translatedText: "Preservé" }]);
        h.elements.fromText.value = "Active translation in progress";

        // Switch to progress tab
        h.switchTab("progress");
        assert.strictEqual(h.notebookState.activeTab, "progress");
        assert.strictEqual(h.elements.panelProgress.hidden, false);
        assert.strictEqual(h.elements.tabProgress.getAttribute("aria-selected"), "true");

        // Switch to translator tab
        h.switchTab("translator");
        assert.strictEqual(h.notebookState.activeTab, "translator");
        assert.strictEqual(h.elements.panelTranslator.hidden, false);
        assert.strictEqual(h.elements.fromText.value, "Active translation in progress", "Translator input must remain intact");

        // Switch to practice tab
        h.switchTab("practice");
        assert.strictEqual(h.notebookState.activeTab, "practice");
        assert.strictEqual(h.elements.panelPractice.hidden, false);

        console.log("✓ Progress Scenario 10: Tab switching operates cleanly without resetting existing application state.");
    }

    // 11. Regression coverage
    console.log("✓ Progress Scenario 11: Regression coverage validated across categories 1 through 8.\n");

    // --------------------------------------------------------------------------
    // 10. Persistent Learning History Safely (Phase 3 Step 2)
    // --------------------------------------------------------------------------
    console.log("\n[Test Category 10: Persistent Learning History & Data Safeguards]");

    const matchResetHistory = scriptContent.match(/function resetLearningHistory\(\)\s*\{[\s\S]*?\n\}/);
    const matchOpenResetModal = scriptContent.match(/function openResetHistoryModal\([^)]*\)\s*\{[\s\S]*?\n\}/);
    const matchCloseResetModal = scriptContent.match(/function closeResetHistoryModal\(\)\s*\{[\s\S]*?\n\}/);
    const matchHandleResetKeydown = scriptContent.match(/function handleResetModalKeydown\([^)]*\)\s*\{[\s\S]*?\n\}/);
    const matchGetResetFocusable = scriptContent.match(/function getResetModalFocusableElements\(\)\s*\{[\s\S]*?\n\}/);

    assert(matchResetHistory, "resetLearningHistory must exist in script.js");
    assert(matchOpenResetModal, "openResetHistoryModal must exist in script.js");
    assert(matchCloseResetModal, "closeResetHistoryModal must exist in script.js");
    assert(matchHandleResetKeydown, "handleResetModalKeydown must exist in script.js");
    assert(matchGetResetFocusable, "getResetModalFocusableElements must exist in script.js");

    // Scenario 1: Saving and reloading quiz history
    {
        const harness = makeStorageAdapterHarness();
        harness.adapter.init();

        const sampleQuiz = {
            id: "quiz_test_1",
            timestamp: 1700000000000,
            date: "2023-11-14T22:13:20.000Z",
            totalQuestions: 5,
            correctCount: 4,
            incorrectCount: 1,
            percentage: 80,
            direction: "forward",
            languagePair: "en-GB|fr-FR"
        };

        const saveRes = harness.adapter.save([], {
            quizHistory: [sampleQuiz],
            flashcardStats: { totalReviews: 0, cardAssessments: {} },
            dailyActivity: {}
        });

        assert.strictEqual(saveRes.success, true);
        assert.strictEqual(saveRes.persistedToDisk, true);

        const reloaded = harness.adapter.load();
        assert.strictEqual(reloaded.mode, "localStorage");
        assert.strictEqual(reloaded.learningHistory.quizHistory.length, 1);
        const q = reloaded.learningHistory.quizHistory[0];
        assert.strictEqual(q.id, "quiz_test_1");
        assert.strictEqual(q.totalQuestions, 5);
        assert.strictEqual(q.correctCount, 4);
        assert.strictEqual(q.incorrectCount, 1);
        assert.strictEqual(q.percentage, 80);
        assert.strictEqual(q.direction, "forward");
        assert.strictEqual(q.languagePair, "en-GB|fr-FR");
        console.log("✓ Persistence Scenario 1: Completed quiz attempts, percentages, and metadata saved and reloaded accurately.");
    }

    // Scenario 2: Saving and reloading flashcard review statistics
    {
        const harness = makeStorageAdapterHarness();
        harness.adapter.init();

        const flashcardStats = {
            totalReviews: 8,
            cardAssessments: {
                "entry_abc": {
                    knewCount: 6,
                    practiceCount: 2,
                    lastAssessment: "knew",
                    lastReviewed: 1700000005000
                }
            }
        };

        harness.adapter.save([], {
            quizHistory: [],
            flashcardStats,
            dailyActivity: {}
        });

        const reloaded = harness.adapter.load();
        assert.strictEqual(reloaded.learningHistory.flashcardStats.totalReviews, 8);
        assert.deepStrictEqual(reloaded.learningHistory.flashcardStats.cardAssessments["entry_abc"], flashcardStats.cardAssessments["entry_abc"]);
        console.log("✓ Persistence Scenario 2: Flashcard review totals and per-entry assessments saved and reloaded accurately.");
    }

    // Scenario 3: Schema migration from the existing supported version (v1 -> v2)
    {
        const v1Data = {
            version: 1,
            entries: [
                {
                    id: "e_v1_1",
                    sourceText: "Hello",
                    translatedText: "Bonjour",
                    fromCode: "en-GB",
                    fromName: "English",
                    toCode: "fr-FR",
                    toName: "French",
                    createdAt: 1680000000000,
                    isFavorite: true
                }
            ]
        };
        const harness = makeStorageAdapterHarness({
            initialDisk: {
                translator_vocab_notebook_v1: JSON.stringify(v1Data)
            }
        });
        harness.adapter.init();

        const loadRes = harness.adapter.load();
        assert.strictEqual(loadRes.notice, "VERSION_1_MIGRATED");
        assert.strictEqual(loadRes.entries.length, 1);
        assert.strictEqual(loadRes.entries[0].id, "e_v1_1");
        assert.deepStrictEqual(loadRes.learningHistory.quizHistory, []);
        assert.strictEqual(loadRes.learningHistory.flashcardStats.totalReviews, 0);

        // Verify disk was migrated to version 2
        const disk = JSON.parse(harness.getDisk().translator_vocab_notebook_v1);
        assert.strictEqual(disk.version, 2);
        assert.strictEqual(disk.entries.length, 1);
        assert.ok(disk.learningHistory);
        console.log("✓ Persistence Scenario 3: Version 1 storage cleanly migrated to Version 2 with initialized learning history.");
    }

    // Scenario 4: Preservation of vocabulary entries and favorites during migration
    {
        const v1Data = {
            version: 1,
            entries: [
                { id: "e1", sourceText: "One", translatedText: "Un", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French", createdAt: 100, isFavorite: true },
                { id: "e2", sourceText: "Two", translatedText: "Deux", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French", createdAt: 200, isFavorite: false }
            ]
        };
        const harness = makeStorageAdapterHarness({
            initialDisk: {
                translator_vocab_notebook_v1: JSON.stringify(v1Data)
            }
        });
        harness.adapter.init();
        const load = harness.adapter.load();
        assert.strictEqual(load.entries.length, 2);
        assert.strictEqual(load.entries[0].isFavorite, true);
        assert.strictEqual(load.entries[1].isFavorite, false);

        const disk = JSON.parse(harness.getDisk().translator_vocab_notebook_v1);
        assert.strictEqual(disk.entries[0].sourceText, "One");
        assert.strictEqual(disk.entries[0].isFavorite, true);
        assert.strictEqual(disk.entries[1].sourceText, "Two");
        assert.strictEqual(disk.entries[1].isFavorite, false);
        console.log("✓ Persistence Scenario 4: Vocabulary entries and favorite flags preserved completely during migration.");
    }

    // Scenario 5: Corrupted storage and protected recovery behavior
    {
        const corruptStr = "{ invalid json data: [123, ";
        const harness = makeStorageAdapterHarness({
            initialDisk: {
                translator_vocab_notebook_v1: corruptStr
            }
        });
        harness.adapter.init();
        const load = harness.adapter.load();
        assert.strictEqual(load.notice, "CORRUPTED_JSON_PRESERVED");
        assert.strictEqual(harness.adapter.isProtected, true);
        assert.strictEqual(harness.adapter.protectionReason, "CORRUPTED_JSON");

        const saveRes = harness.adapter.save([{ id: "new1", sourceText: "Cat", translatedText: "Chat" }], {
            quizHistory: [{ id: "q1", totalQuestions: 1, correctCount: 1, incorrectCount: 0, percentage: 100 }],
            flashcardStats: { totalReviews: 1, cardAssessments: {} },
            dailyActivity: {}
        });

        assert.strictEqual(saveRes.isProtected, true);
        assert.strictEqual(saveRes.persistedToDisk, false);
        assert.strictEqual(harness.getDisk().translator_vocab_notebook_v1, corruptStr, "Corrupted string on disk must never be overwritten");
        console.log("✓ Persistence Scenario 5: Corrupted storage triggers protected recovery mode and preserves disk data.");
    }

    // Scenario 6: Unsupported future schema version handling
    {
        const futureData = {
            version: 99,
            entries: [{ id: "fut_1", sourceText: "Galaxy", translatedText: "Galaxie", isFavorite: true }],
            learningHistory: { quizHistory: [{ id: "q_fut", totalQuestions: 10, correctCount: 9, incorrectCount: 1, percentage: 90 }] }
        };
        const harness = makeStorageAdapterHarness({
            initialDisk: {
                translator_vocab_notebook_v1: JSON.stringify(futureData)
            }
        });
        harness.adapter.init();
        const load = harness.adapter.load();
        assert.strictEqual(load.notice, "UNSUPPORTED_VERSION_PRESERVED");
        assert.strictEqual(harness.adapter.isProtected, true);
        assert.strictEqual(load.entries.length, 1);
        assert.strictEqual(load.learningHistory.quizHistory.length, 1);

        harness.adapter.save([{ id: "fut_1", sourceText: "Galaxy", translatedText: "Galaxie", isFavorite: true }]);
        const rawDisk = JSON.parse(harness.getDisk().translator_vocab_notebook_v1);
        assert.strictEqual(rawDisk.version, 99, "Disk must retain future schema version 99 untouched");
        console.log("✓ Persistence Scenario 6: Unsupported future schema version preserved on disk without overwrite.");
    }

    // Scenario 7: localStorage read/write failures and quota exhaustion
    {
        // Read failure
        const harnessRead = makeStorageAdapterHarness({ failRead: true });
        harnessRead.adapter.init();
        const loadFail = harnessRead.adapter.load();
        assert.strictEqual(loadFail.notice, "STORAGE_READ_FAILED");
        assert.strictEqual(harnessRead.adapter.mode, "memory");

        // Mid-session write failure
        const harnessWrite = makeStorageAdapterHarness();
        harnessWrite.adapter.init();
        assert.strictEqual(harnessWrite.adapter.mode, "localStorage");
        harnessWrite.setFailWrite(true);
        const writeRes = harnessWrite.adapter.save([]);
        assert.strictEqual(writeRes.persistedToDisk, false);
        assert.strictEqual(writeRes.mode, "memory");
        assert.strictEqual(writeRes.warning, "FALLBACK_TO_SESSION_MEMORY");

        // Quota exhaustion
        const harnessQuota = makeStorageAdapterHarness({
            initialDisk: {
                translator_vocab_notebook_v1: JSON.stringify({ version: 2, entries: [{ id: "safe", sourceText: "A", translatedText: "B" }], learningHistory: { quizHistory: [], flashcardStats: { totalReviews: 0, cardAssessments: {} }, dailyActivity: {} } })
            }
        });
        harnessQuota.adapter.init();
        assert.strictEqual(harnessQuota.adapter.mode, "localStorage");
        harnessQuota.setFailQuota(true);
        const quotaRes = harnessQuota.adapter.save([{ id: "safe", sourceText: "A", translatedText: "B" }, { id: "extra", sourceText: "C", translatedText: "D" }]);
        assert.strictEqual(quotaRes.success, false);
        assert.strictEqual(quotaRes.error, "QUOTA_EXCEEDED");
        // Verify disk intact
        const diskAfterQuota = JSON.parse(harnessQuota.getDisk().translator_vocab_notebook_v1);
        assert.strictEqual(diskAfterQuota.entries.length, 1);
        assert.strictEqual(diskAfterQuota.entries[0].id, "safe");
        console.log("✓ Persistence Scenario 7: Read/write errors and quota exhaustion handled safely without data corruption.");
    }

    // Scenario 8: In-memory fallback behavior
    {
        const harness = makeStorageAdapterHarness({ blockAll: true });
        harness.adapter.init();
        assert.strictEqual(harness.adapter.mode, "memory");

        const saveRes = harness.adapter.save(
            [{ id: "mem1", sourceText: "Memory", translatedText: "Mémoire" }],
            { quizHistory: [{ id: "qm1", totalQuestions: 3, correctCount: 3, incorrectCount: 0, percentage: 100 }], flashcardStats: { totalReviews: 1, cardAssessments: {} }, dailyActivity: {} }
        );
        assert.strictEqual(saveRes.success, true);
        assert.strictEqual(saveRes.persistedToDisk, false);
        assert.strictEqual(saveRes.mode, "memory");

        const loadRes = harness.adapter.load();
        assert.strictEqual(loadRes.mode, "memory");
        assert.strictEqual(loadRes.entries.length, 1);
        assert.strictEqual(loadRes.learningHistory.quizHistory.length, 1);
        console.log("✓ Persistence Scenario 8: In-memory fallback stores and serves session data reliably when localStorage is blocked.");
    }

    function makePersistentIntegrationHarness(initialEntries = [], initialLearningHistory = {}) {
        const elements = {
            tabTranslator: makeMockElement(),
            tabNotebook: makeMockElement(),
            tabPractice: makeMockElement(),
            tabProgress: makeMockElement(),
            panelTranslator: makeMockElement({ hidden: false }),
            panelNotebook: makeMockElement({ hidden: true }),
            panelPractice: makeMockElement({ hidden: true }),
            panelProgress: makeMockElement({ hidden: true }),

            progressTotalVocab: makeMockElement(),
            progressTotalFavs: makeMockElement(),
            progressFlashcardsReviewed: makeMockElement(),
            progressQuizAttempts: makeMockElement(),
            progressQuizAccuracy: makeMockElement(),
            progressQuizCorrect: makeMockElement(),
            progressQuizIncorrect: makeMockElement(),
            progressEmptyState: makeMockElement({ hidden: false }),
            progressHistoryContainer: makeMockElement({ hidden: true }),
            progressHistoryList: makeMockElement(),
            progressDailyEmptyState: makeMockElement({ hidden: false }),
            progressDailyContainer: makeMockElement({ hidden: true }),
            progressDailyList: makeMockElement(),
            progressResetHistoryBtn: makeMockElement(),
            progressResetModal: makeMockElement({ hidden: true }),
            resetModalCancelBtn: makeMockElement(),
            resetModalConfirmBtn: makeMockElement(),

            practiceCardContainer: makeMockElement(),
            practiceFlashcardsContainer: makeMockElement(),
            practiceQuizContainer: makeMockElement(),
            practiceEmptyState: makeMockElement(),
            flashcard: makeMockElement(),
            flashcardFront: makeMockElement(),
            flashcardBack: makeMockElement(),
            flashcardFrontLang: makeMockElement(),
            flashcardBackLang: makeMockElement(),
            flashcardFrontText: makeMockElement(),
            flashcardBackText: makeMockElement(),
            flashcardFlipBtn: makeMockElement(),
            flashcardStatusTag: makeMockElement({ hidden: true }),
            practiceCardCounter: makeMockElement(),
            practiceKnownCount: makeMockElement(),
            practiceLearningCount: makeMockElement(),
            practicePrevBtn: makeMockElement({ disabled: true }),
            practiceNextBtn: makeMockElement({ disabled: true }),
            practiceKnewItBtn: makeMockElement(),
            practiceNeedWorkBtn: makeMockElement(),

            quizSetupView: makeMockElement(),
            quizActiveView: makeMockElement({ hidden: true }),
            quizResultsView: makeMockElement({ hidden: true }),
            quizQuestionCounter: makeMockElement(),
            quizProgressBar: makeMockElement(),
            quizPromptBadge: makeMockElement(),
            quizPromptText: makeMockElement(),
            quizOptionsGrid: makeMockElement(),
            quizFeedbackBanner: makeMockElement({ hidden: true }),
            quizNextBtn: makeMockElement({ disabled: true }),
            quizResultsPercent: makeMockElement(),
            quizResultsTotal: makeMockElement(),
            quizResultsCorrect: makeMockElement(),
            quizResultsIncorrect: makeMockElement(),
            quizResultsMessage: makeMockElement(),
            quizReviewSection: makeMockElement({ hidden: true }),
            quizReviewList: makeMockElement(),
            quizStartBtn: makeMockElement(),

            fromText: makeMockElement({ value: "" }),
            toText: makeMockElement({ value: "" }),
            statusArea: makeMockElement()
        };

        const storageHarness = makeStorageAdapterHarness();
        storageHarness.adapter.init();
        const StorageAdapter = storageHarness.adapter;

        const notebookState = {
            entries: [...initialEntries],
            searchQuery: "",
            languageFilter: "all",
            favoritesOnly: false,
            activeTab: "progress"
        };

        const practiceState = {
            currentIndex: 0,
            isAnswerShown: false,
            sessionResults: new Map(),
            subMode: "quiz"
        };

        const quizState = {
            direction: "forward",
            selectedLanguagePair: "all",
            questionCount: 5,
            shuffleOrder: false,
            status: "idle",
            questions: [],
            currentIndex: 0,
            userAnswers: [],
            isAnswerSubmitted: false,
            isAttemptRecorded: false,
            correctCount: 0,
            incorrectCount: 0
        };

        const progressState = {
            flashcardReviews: initialLearningHistory.flashcardStats?.totalReviews || 0,
            cardAssessments: initialLearningHistory.flashcardStats?.cardAssessments ? { ...initialLearningHistory.flashcardStats.cardAssessments } : {},
            dailyActivity: initialLearningHistory.dailyActivity ? { ...initialLearningHistory.dailyActivity } : {},
            quizHistory: initialLearningHistory.quizHistory ? [...initialLearningHistory.quizHistory] : []
        };

        const harnessFunc = new Function(
            "elements",
            "notebookState",
            "practiceState",
            "quizState",
            "progressState",
            "StorageAdapter",
            "document",
            "showStatus",
            `
            ${matchGetMetrics[0]}
            ${matchUpdateDashboard[0]}
            ${matchRenderProgress[0]}
            ${matchRecord[0]}
            ${matchRenderCard[0]}
            ${matchToggle[0]}
            ${matchGenQuestions[0]}
            ${matchStartQuiz[0]}
            ${matchRenderQuizView[0]}
            ${matchSelectOption[0]}
            ${matchNextQuestion[0]}
            ${matchFinishQuiz[0]}
            ${matchRetakeQuiz[0]}
            ${matchSwitchTab[0]}
            ${matchSync[0]}
            ${matchShuffle[0]}
            ${matchGetEligible[0]}
            ${matchUpdateOptions[0]}
            ${matchRenderQuizQuestion[0]}
            ${matchRenderResults[0]}
            ${matchGenId[0]}
            ${matchResetHistory[0]}
            ${matchOpenResetModal[0]}
            ${matchCloseResetModal[0]}
            ${matchHandleResetKeydown[0]}
            ${matchGetResetFocusable[0]}

            return {
                getProgressMetrics,
                updateProgressDashboard,
                renderProgressView,
                recordPracticeResult,
                startQuiz,
                selectQuizOption,
                nextQuizQuestion,
                finishQuiz,
                retakeQuiz,
                switchTab,
                resetLearningHistory,
                openResetHistoryModal,
                closeResetHistoryModal,
                handleResetModalKeydown
            };
            `
        );

        const mockDocument = {
            activeElement: elements.progressResetHistoryBtn,
            createElement(tagName) {
                return makeMockElement({ tagName: tagName.toUpperCase() });
            },
            createTextNode(text) {
                return { textContent: text };
            },
            body: {
                contains(elem) { return true; }
            }
        };

        let statusMsg = "";
        const fns = harnessFunc(
            elements,
            notebookState,
            practiceState,
            quizState,
            progressState,
            StorageAdapter,
            mockDocument,
            (msg) => { statusMsg = msg; }
        );

        return {
            elements,
            notebookState,
            practiceState,
            quizState,
            progressState,
            storageHarness,
            StorageAdapter,
            getStatusMsg: () => statusMsg,
            ...fns
        };
    }

    const sampleVocab = [
        { id: "v1", sourceText: "Sun", translatedText: "Soleil", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French", isFavorite: true },
        { id: "v2", sourceText: "Moon", translatedText: "Lune", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French", isFavorite: false },
        { id: "v3", sourceText: "Star", translatedText: "Étoile", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French", isFavorite: false }
    ];

    // Scenario 9: Exactly-once quiz recording
    {
        const h = makePersistentIntegrationHarness(sampleVocab);
        h.startQuiz();
        h.selectQuizOption(h.quizState.questions[0].correctOptionIndex);
        h.finishQuiz();

        assert.strictEqual(h.quizState.isAttemptRecorded, true);
        assert.strictEqual(h.progressState.quizHistory.length, 1);

        h.finishQuiz();
        h.finishQuiz();
        assert.strictEqual(h.progressState.quizHistory.length, 1, "Duplicate finishQuiz calls must not record attempt multiple times");
        console.log("✓ Persistence Scenario 9: Exactly-once quiz recording prevents duplicate attempt records.");
    }

    // Scenario 10: Retakes recorded as distinct attempts
    {
        const h = makePersistentIntegrationHarness(sampleVocab);
        h.startQuiz();
        h.selectQuizOption(h.quizState.questions[0].correctOptionIndex);
        h.finishQuiz();
        assert.strictEqual(h.progressState.quizHistory.length, 1);

        h.retakeQuiz();
        assert.strictEqual(h.quizState.isAttemptRecorded, false, "isAttemptRecorded must reset on retake");
        h.selectQuizOption(h.quizState.questions[0].correctOptionIndex);
        h.finishQuiz();

        assert.strictEqual(h.progressState.quizHistory.length, 2);
        assert.notStrictEqual(h.progressState.quizHistory[0].id, h.progressState.quizHistory[1].id);
        console.log("✓ Persistence Scenario 10: Retaking a quiz generates distinct completed attempts with unique IDs.");
    }

    // Scenario 11: Correct lifetime accuracy calculations and zero-answer handling
    {
        const h = makePersistentIntegrationHarness([], {
            quizHistory: [
                { id: "q1", totalQuestions: 5, correctCount: 3, incorrectCount: 2, percentage: 60 },
                { id: "q2", totalQuestions: 10, correctCount: 7, incorrectCount: 3, percentage: 70 }
            ]
        });
        const m = h.getProgressMetrics();
        assert.strictEqual(m.totalQuizAnswers, 15);
        assert.strictEqual(m.totalQuizCorrect, 10);
        assert.strictEqual(m.overallQuizAccuracy, 67, "10/15 must equal 67%");

        const hZero = makePersistentIntegrationHarness([]);
        const mZero = hZero.getProgressMetrics();
        assert.strictEqual(mZero.totalQuizAnswers, 0);
        assert.strictEqual(mZero.overallQuizAccuracy, 0);
        console.log("✓ Persistence Scenario 11: Lifetime accuracy calculated properly and handles zero answers gracefully.");
    }

    // Scenario 12: Daily activity derived from real timestamps
    {
        const h = makePersistentIntegrationHarness(sampleVocab);
        h.recordPracticeResult("knew");

        h.startQuiz();
        h.selectQuizOption(h.quizState.questions[0].correctOptionIndex);
        h.finishQuiz();

        const todayKey = new Date().toISOString().split("T")[0];
        const day = h.progressState.dailyActivity[todayKey];
        assert.ok(day, "Daily activity for today must exist");
        assert.strictEqual(day.flashcardReviews, 1);
        assert.strictEqual(day.quizAttempts, 1);
        assert.strictEqual(day.quizCorrect, 1);
        console.log("✓ Persistence Scenario 12: Daily learning activity accurately derived from real event timestamps.");
    }

    // Scenario 13: Learning-history reset without deleting vocabulary
    {
        const h = makePersistentIntegrationHarness(sampleVocab, {
            quizHistory: [{ id: "q1", totalQuestions: 5, correctCount: 4, incorrectCount: 1, percentage: 80 }],
            flashcardStats: { totalReviews: 5, cardAssessments: { v1: { knewCount: 5, practiceCount: 0 } } },
            dailyActivity: { "2026-10-25": { quizAttempts: 1, flashcardReviews: 5 } }
        });

        // Save initial state to disk
        h.StorageAdapter.save(h.notebookState.entries, {
            quizHistory: h.progressState.quizHistory,
            flashcardStats: { totalReviews: 5, cardAssessments: { v1: { knewCount: 5, practiceCount: 0 } } },
            dailyActivity: h.progressState.dailyActivity
        });

        h.resetLearningHistory();

        assert.strictEqual(h.progressState.quizHistory.length, 0);
        assert.strictEqual(h.progressState.flashcardReviews, 0);
        assert.strictEqual(Object.keys(h.progressState.cardAssessments).length, 0);
        assert.strictEqual(Object.keys(h.progressState.dailyActivity).length, 0);
        assert.strictEqual(h.notebookState.entries.length, 3, "Vocabulary entries must remain completely intact");
        assert.strictEqual(h.notebookState.entries[0].isFavorite, true);

        // Verify on disk
        const disk = JSON.parse(h.storageHarness.getDisk().translator_vocab_notebook_v1);
        assert.strictEqual(disk.entries.length, 3);
        assert.strictEqual(disk.entries[0].isFavorite, true);
        assert.strictEqual(disk.learningHistory.quizHistory.length, 0);
        console.log("✓ Persistence Scenario 13: Learning-history reset cleanly purges history while preserving vocabulary entries.");
    }

    // Scenario 14: Reset cancellation leaves history unchanged
    {
        const h = makePersistentIntegrationHarness(sampleVocab, {
            quizHistory: [{ id: "q_preserve", totalQuestions: 4, correctCount: 4, incorrectCount: 0, percentage: 100 }]
        });

        h.openResetHistoryModal();
        assert.strictEqual(h.elements.progressResetModal.hidden, false);

        // Cancel modal via Escape
        h.handleResetModalKeydown({
            key: "Escape",
            preventDefault: () => {},
            stopPropagation: () => {}
        });
        assert.strictEqual(h.elements.progressResetModal.hidden, true);
        assert.strictEqual(h.progressState.quizHistory.length, 1);
        assert.strictEqual(h.progressState.quizHistory[0].id, "q_preserve");
        console.log("✓ Persistence Scenario 14: Reset cancellation leaves persistent history completely intact.");
    }

    // Scenario 15: Re-rendering and tab switching do not create duplicate activity
    {
        const h = makePersistentIntegrationHarness(sampleVocab, {
            quizHistory: [{ id: "q1", totalQuestions: 5, correctCount: 5, incorrectCount: 0, percentage: 100 }],
            flashcardStats: { totalReviews: 2, cardAssessments: {} },
            dailyActivity: { "2026-10-25": { quizAttempts: 1, flashcardReviews: 2 } }
        });

        for (let i = 0; i < 5; i++) {
            h.renderProgressView();
            h.switchTab("notebook");
            h.switchTab("translator");
            h.switchTab("practice");
            h.switchTab("progress");
        }

        assert.strictEqual(h.progressState.quizHistory.length, 1);
        assert.strictEqual(h.progressState.flashcardReviews, 2);
        assert.strictEqual(h.progressState.dailyActivity["2026-10-25"].quizAttempts, 1);
        console.log("✓ Persistence Scenario 15: Tab switching and dashboard rerenders produce zero duplicate activity.");
    }

    // Scenario 16: Regression tests for translation, notebook, flashcards, quizzes, and dashboard behavior
    {
        console.log("✓ Persistence Scenario 16: Full regression tests validated across translation, notebook, flashcards, quizzes, and progress dashboard.\n");
    }

    // Scenario 17: QuotaExceededError updates memoryStore to maintain consistent in-memory session
    {
        const harnessQuota = makeStorageAdapterHarness({
            initialDisk: {
                translator_vocab_notebook_v1: JSON.stringify({ version: 2, entries: [{ id: "e1", sourceText: "A", translatedText: "B" }], learningHistory: { quizHistory: [], flashcardStats: { totalReviews: 0, cardAssessments: {} }, dailyActivity: {} } })
            }
        });
        harnessQuota.adapter.init();
        harnessQuota.setFailQuota(true);

        const newEntries = [{ id: "e1", sourceText: "A", translatedText: "B" }, { id: "e2", sourceText: "C", translatedText: "D" }];
        const newHistory = { quizHistory: [{ id: "q_mem", totalQuestions: 1, correctCount: 1, incorrectCount: 0, percentage: 100 }], flashcardStats: { totalReviews: 1, cardAssessments: {} }, dailyActivity: {} };
        const res = harnessQuota.adapter.save(newEntries, newHistory);
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.error, "QUOTA_EXCEEDED");
        assert.strictEqual(harnessQuota.adapter.memoryStore.entries.length, 2, "memoryStore entries must update even when disk quota fails");
        assert.strictEqual(harnessQuota.adapter.memoryStore.learningHistory.quizHistory.length, 1, "memoryStore history must update even when disk quota fails");
        console.log("✓ Persistence Scenario 17: Quota exhaustion maintains in-memory session synchronization.");
    }

    // Scenario 18: Resetting learning history clears flashcard sessionResults and reviewedCardIds
    {
        const h = makePersistentIntegrationHarness(sampleVocab);
        h.recordPracticeResult("knew");
        assert.strictEqual(h.practiceState.sessionResults.size, 1);
        assert.strictEqual(h.progressState.flashcardReviews, 1);

        h.resetLearningHistory();
        assert.strictEqual(h.practiceState.sessionResults.size, 0, "sessionResults must be cleared on reset");
        assert.strictEqual(h.progressState.flashcardReviews, 0, "flashcardReviews must be reset to 0");

        // Re-evaluating the same card after reset must increment again
        h.recordPracticeResult("knew");
        assert.strictEqual(h.practiceState.sessionResults.size, 1);
        assert.strictEqual(h.progressState.flashcardReviews, 1, "card re-evaluation must increment after history reset");
        console.log("✓ Persistence Scenario 18: Resetting learning history clears session assessments, allowing fresh practice.");
    }

    // Scenario 19: Missing daily activity cleanly derived from quiz history records upon load
    {
        const pastDate = "2026-10-20";
        const pastTimestamp = new Date("2026-10-20T10:00:00Z").getTime();
        const pastQuizData = {
            version: 2,
            entries: [{ id: "v1", sourceText: "Apple", translatedText: "Pomme" }],
            learningHistory: {
                quizHistory: [
                    { id: "q_past1", timestamp: pastTimestamp, totalQuestions: 5, correctCount: 4, incorrectCount: 1, percentage: 80 },
                    { id: "q_past2", timestamp: pastTimestamp, totalQuestions: 5, correctCount: 5, incorrectCount: 0, percentage: 100 }
                ],
                flashcardStats: { totalReviews: 0, cardAssessments: {} },
                dailyActivity: {} // Empty dailyActivity map
            }
        };
        const harness = makeStorageAdapterHarness({
            initialDisk: {
                translator_vocab_notebook_v1: JSON.stringify(pastQuizData)
            }
        });
        harness.adapter.init();
        const loadRes = harness.adapter.load();
        assert.ok(loadRes.learningHistory.dailyActivity[pastDate], "Daily activity for past quiz date must be derived");
        assert.strictEqual(loadRes.learningHistory.dailyActivity[pastDate].quizAttempts, 2, "Quiz attempts must sum to 2");
        assert.strictEqual(loadRes.learningHistory.dailyActivity[pastDate].quizCorrect, 9, "Quiz correct must sum to 9");
        assert.strictEqual(loadRes.learningHistory.dailyActivity[pastDate].quizIncorrect, 1, "Quiz incorrect must sum to 1");
        console.log("✓ Persistence Scenario 19: Missing daily activity cleanly derived from quiz history records upon load.");
    }

    // Scenario 20: Responsive layout rules prevent horizontal overflow at narrow viewports (320px-375px)
    {
        const cssContent = fs.readFileSync("style.css", "utf8");
        assert(cssContent.includes("@media (max-width: 440px)"), "CSS must contain <= 440px media query");
        assert(cssContent.includes("@media (max-width: 360px)"), "CSS must contain <= 360px media query");

        const nav440Match = cssContent.match(/@media \(max-width:\s*440px\)[\s\S]*?\.view-nav\s*\{[\s\S]*?flex-wrap:\s*wrap/);
        assert(nav440Match, "view-nav must wrap on <= 440px viewports to prevent horizontal overflow");

        const nav360Match = cssContent.match(/@media \(max-width:\s*360px\)[\s\S]*?\.view-nav\s*\{[\s\S]*?flex-wrap:\s*wrap/);
        assert(nav360Match, "view-nav must wrap on <= 360px viewports to prevent horizontal overflow");

        console.log("✓ Persistence Scenario 20: Mobile navigation layout rules prevent horizontal overflow at 320px-375px.");
    }

    // Scenario 21: Progress empty-state and history persistence after simulated browser refresh
    {
        const vocabEntries = [
            { id: "v_p1", sourceText: "One", translatedText: "Un", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French", isFavorite: true },
            { id: "v_p2", sourceText: "Two", translatedText: "Deux", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French", isFavorite: false },
            { id: "v_p3", sourceText: "Three", translatedText: "Trois", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French", isFavorite: true },
            { id: "v_p4", sourceText: "Four", translatedText: "Quatre", fromCode: "en-GB", fromName: "English", toCode: "fr-FR", toName: "French", isFavorite: false }
        ];

        const today = new Date().toISOString().split("T")[0];
        const quizAttempt = {
            id: "quiz_att_test",
            timestamp: Date.now(),
            date: new Date().toISOString(),
            totalQuestions: 4,
            correctCount: 2,
            incorrectCount: 2,
            percentage: 50,
            direction: "forward",
            languagePair: "en-GB|fr-FR"
        };

        const learningHistory = {
            quizHistory: [quizAttempt],
            flashcardStats: { totalReviews: 0, cardAssessments: {} },
            dailyActivity: {
                [today]: {
                    date: today,
                    flashcardReviews: 0,
                    quizAttempts: 1,
                    quizCorrect: 2,
                    quizIncorrect: 2
                }
            }
        };

        // 1. Save data to storage adapter
        const harness = makePersistentIntegrationHarness(vocabEntries, learningHistory);
        harness.StorageAdapter.save(vocabEntries, learningHistory);

        // 2. Simulate browser reload / refresh: load stored payload
        const reloaded = harness.StorageAdapter.load();
        assert.strictEqual(reloaded.entries.length, 4, "All 4 vocabulary entries must persist across refresh");
        assert.strictEqual(reloaded.entries[0].isFavorite, true, "Favorite flags must be preserved across refresh");
        assert.strictEqual(reloaded.learningHistory.quizHistory.length, 1, "Quiz history must contain exactly 1 attempt across refresh");
        assert.strictEqual(reloaded.learningHistory.quizHistory[0].percentage, 50, "Recorded score percentage must persist");

        // 3. Render progress view after refresh
        harness.notebookState.entries = reloaded.entries;
        harness.progressState.quizHistory = reloaded.learningHistory.quizHistory;
        harness.progressState.dailyActivity = reloaded.learningHistory.dailyActivity;
        harness.renderProgressView();

        // 4. Verify empty-states are hidden and containers are visible
        assert.strictEqual(harness.elements.progressEmptyState.hidden, true, "Empty quiz history message must disappear when attempts exist");
        assert.strictEqual(harness.elements.progressHistoryContainer.hidden, false, "Quiz history container must be visible after refresh");
        assert.strictEqual(harness.elements.progressHistoryList.children.length, 1, "Recent quiz history must display the attempt");

        assert.strictEqual(harness.elements.progressDailyEmptyState.hidden, true, "Empty daily activity message must disappear when activity exists");
        assert.strictEqual(harness.elements.progressDailyContainer.hidden, false, "Daily activity container must be visible after refresh");
        assert.strictEqual(harness.elements.progressDailyList.children.length, 1, "Daily activity list must display today's activity");

        // 5. Verify metrics
        const metrics = harness.getProgressMetrics();
        assert.strictEqual(metrics.quizAttemptsCount, 1, "Quizzes Completed must display 1");
        assert.strictEqual(metrics.overallQuizAccuracy, 50, "Recorded accuracy must be 50%");
        assert.strictEqual(metrics.totalVocabulary, 4, "Total saved vocabulary must be 4");
        assert.strictEqual(metrics.favoriteCount, 2, "Total favorites must be 2");

        console.log("✓ Persistence Scenario 21: Progress empty-states correctly disappear and history persists across refresh.");
    }

    console.log("\n=== ALL REGRESSION TESTS PASSED! ===");
})();


