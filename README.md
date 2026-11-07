# 🌐 Language Translator & Vocabulary Notebook

A lightweight, accessible, and responsive client-side Language Translator and personal Vocabulary Notebook built with semantic HTML5, modern vanilla CSS, and JavaScript (ES6+). It supports real-time text translation across 90+ world languages with dual-provider fallback, race-condition mitigation, text-to-speech pronunciation, clipboard copy, keyboard navigation, and vocabulary management via a resilient, versioned `StorageAdapter` (supporting both persistent `localStorage` and in-memory session fallback).

---

## ✨ Features

- **🌍 Extensive Language Catalog:** Select from a catalog of 90+ world languages (97 mapped in [`countries.js`](countries.js), defaulting to English `en-GB` and Hindi `hi-IN`). Display names have been carefully verified (including Urdu `ur-PK`, Belarusian `be-BY`, and Punjabi `pa-IN`).
- **⚡ Resilient Dual-Provider Translation & Timeout Reliability:**
  - **Primary Provider:** Google Web Client unofficial endpoint (`translate.googleapis.com/translate_a/single?client=gtx`).
  - **Fallback Provider:** MyMemory Translated API (`api.mymemory.translated.net/get`) with regional BCP-47 and ISO-639-1 subtag pair resolution.
  - **Configurable Per-Provider Timeout:** Each provider request is bounded by a 12-second timeout (`TRANSLATION_TIMEOUT_MS = 12000`). If Google Translate times out, fallback to MyMemory is automatically attempted. If both time out, a clear timeout error is displayed.
  - **Memory & Resource Cleanup:** All timeout timers (`clearTimeout`) and abort event listeners (`removeEventListener`) are cleared immediately upon completion, failure, or cancellation to eliminate memory leaks.
- **🛡️ Race-Condition & Cancellation Protection:**
  - In-flight translation requests are tracked and sequenced via `AbortController`. Outdated responses from older requests cannot overwrite newer translations.
  - User cancellation (via language swapping, editing source text, or changing language pair) aborts active requests immediately and **does not** trigger fallback.
- **🔒 Translation Privacy Notice:** A clean, accessible privacy notice positioned in the Translator interface informing users that translation text is transmitted over the internet to Google Translate or MyMemory and advising against entering passwords or sensitive personal data. Fully responsive down to 320px viewports with high-contrast mode support.
- **📖 Persistent Vocabulary Notebook:** Save valuable translations to build a personal vocabulary collection. Search, filter by language or favorites, practice pronunciation, copy, delete, and reload saved entries directly back into the translator.
- **💾 Safe Versioned StorageAdapter (LocalStorage + Session Fallback):**
  - **Persistent Mode:** Uses `localStorage` when accessible (`translator_vocab_notebook_v1`), saving both vocabulary entries and learning history under Schema Version 2.
  - **Schema Versioning & Safe Migration:** Supports versions `[1, 2]` with `CURRENT_VERSION = 2`. Automatically migrates Version 1 schemas and legacy formats to Version 2 upon load without losing saved vocabulary or favorites.
  - **Protected Recovery Mode:** If corrupted JSON, invalid structures, or unsupported future schema versions (e.g. `v99`) are encountered, the raw payload on disk is **never overwritten**. Salvaged entries and history are served in-memory for the current session.
  - **Session Fallback Mode:** When `localStorage` is disabled or blocked (e.g. strict privacy modes or sandboxed frames), automatically falls back to in-memory persistence for the active session and explicitly notifies the user.
  - **Quota & Error Handling:** Catches `QuotaExceededError` without silently dropping records or corrupting disk state.
- **♿ Accessible Semantics, Focus Trap & Live Status:**
  - Semantic WAI-ARIA tab navigation (`role="tablist"`, `role="tab"`, `role="tabpanel"`).
  - Accessible confirmation modal dialogs (`role="dialog"`, `aria-modal="true"`) for clearing all notebook vocabulary and resetting learning history. Both dialogs feature a **keyboard focus trap** (traps <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd>, supports <kbd>Escape</kbd> to cancel, and restores focus to the invoking control).
  - ARIA live region (`role="status"`, `aria-live="polite"`) for real-time announcements.
- **🔄 Language & Text Swapping:** Swap source and target languages alongside their text values using the swap button, or via keyboard (<kbd>Enter</kbd> / <kbd>Space</kbd>).
- **🔊 Text-to-Speech (TTS):** Pronounce source and translated text in both the Translator and Vocabulary Notebook cards using the browser's native Web Speech API (`SpeechSynthesis`).
- **📋 One-Click Copy with Visual Feedback:** Copy text directly using the Clipboard API with automatic fallback to `document.execCommand('copy')` and checkmark feedback.
- **⌨️ Keyboard Shortcuts & Full Tab Navigation:**
  - Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> (or <kbd>Cmd</kbd> + <kbd>Enter</kbd>) in the input field to trigger translation instantly.
  - Navigate tabs using <kbd>ArrowLeft</kbd>, <kbd>ArrowRight</kbd>, <kbd>Home</kbd>, and <kbd>End</kbd>.
  - Close modals with <kbd>Escape</kbd>.
- **🎴 Flashcard Practice Mode (Phase 2, Step 1):** Practice saved vocabulary entries with interactive flashcards:
  - **Single Source of Truth:** Cards are generated directly from saved Vocabulary Notebook entries without a separate database or redundant state.
  - **Two-Sided Cards:** Front displays the source word/phrase and source language; back reveals the saved translation and target language.
  - **Answer Reveal:** Accessible toggle to show and hide answers (<kbd>Space</kbd> / <kbd>Enter</kbd> or click).
  - **Sequential Navigation:** Previous and Next card navigation with strict boundary disabling.
  - **Persistent Evaluation Tracking:** Rate recall using *"I knew it"* or *"Need more practice"* with clear visual feedback, status badges, and real-time score indicators. Assessments and review totals are safely persisted locally.
  - **Audio Pronunciation:** Listen to native pronunciation for both the prompt and translation faces.
  - **Empty & Mutation Safety:** Displays a welcoming empty state with shortcuts to the Translator and Notebook when no vocabulary exists, and gracefully adapts when cards are saved, deleted, or cleared during practice.
- **🎯 Vocabulary Quiz Mode & Scoring (Phase 2, Step 2):** Test recall with interactive multiple-choice quizzes generated from saved notebook entries:
  - **Practice Sub-Navigation:** Seamlessly toggle between **Flashcards** and **Quiz** modes within the Practice tab without resetting notebook data or breaking flashcard progress.
  - **Customizable Quiz Setup:** Choose translation direction (*Original → Translation* or *Translation → Original*), filter by specific language pair to avoid mixing unrelated languages, choose quiz length (5, 10, or all available entries), and toggle question shuffling.
  - **Smart Distractor Generation:** Generates 4 distinct choices per question when available, prioritizing matching target-language entries and eliminating duplicate answer choices.
  - **Graceful Small Pool Handling:** Adapts to 2–3 choices with an informative banner when pool size is small, and displays a friendly warning banner disabling quiz start when fewer than 2 entries are saved.
  - **Immediate Accessible Feedback:** Displays clear correct/incorrect states via icons, badges, and the correct translation reveal. Guarantees each question contributes to score only once.
  - **Persistent Results & Incorrect Review:** Summary shows total questions, correct/incorrect tallies, percentage score, encouraging message, and an expandable review list of incorrect answers with TTS audio. Completed attempts are persisted to disk upon finish.
  - **Keyboard Navigation:** Use keys <kbd>1</kbd>–<kbd>4</kbd> to select options, <kbd>Enter</kbd> to advance, and <kbd>Escape</kbd> to exit to setup.
- **📊 Persistent Learning Progress Dashboard (Phase 3, Steps 1 & 2):** Real-time analytics and score tracking safely persisted across sessions:
  - **Main Navigation Tab:** Integrated via accessible fourth tab **Progress** with keyboard navigation and ARIA semantics.
  - **Persistent Learning History:** Completed quiz attempts, question counts, correct/incorrect totals, percentages, direction, language pair, flashcard review totals, and per-card assessments survive page reloads via `StorageAdapter`.
  - **Daily Learning Activity:** Chronological timeline of active learning days derived from real event timestamps (`YYYY-MM-DD`), displaying quiz attempt counts, accuracy, and flashcard review counts.
  - **Recent Quiz History List:** Visual score cards with attempt numbers, timestamps, language direction tags, score percentage badges, and accessible CSS progress meters (`role="progressbar"`).
  - **Reset Learning History:** Dedicated confirmation dialog with keyboard focus trap allows permanently clearing learning history without deleting saved vocabulary entries or favorites. Respects protected recovery mode.
- **🎨 Modern Visual Design:** Glassmorphic card styling, vibrant purple/indigo gradients, high-contrast `:focus-visible` outlines, responsive layouts for desktop and mobile down to 320px, and `@media (prefers-reduced-motion)` support.

---

## 📚 Vocabulary Notebook & StorageAdapter Architecture

The Vocabulary Notebook and Learning Progress features allow users to save translations, practice flashcards, and complete quizzes with full local persistence across browser sessions without requiring an external database, servers, or user accounts.

### Storage Schema (`translator_vocab_notebook_v1` — Schema Version 2)

```json
{
  "version": 2,
  "entries": [
    {
      "id": "vocab_m8q9z3p_k4x12y9",
      "sourceText": "Hello world",
      "translatedText": "हैलो वर्ल्ड",
      "fromCode": "en-GB",
      "fromName": "English",
      "toCode": "hi-IN",
      "toName": "Hindi",
      "createdAt": 1729844520000,
      "isFavorite": true
    }
  ],
  "learningHistory": {
    "quizHistory": [
      {
        "id": "quiz_k9x2m4p_q7z1",
        "timestamp": 1729851200000,
        "date": "2026-10-25T10:13:20.000Z",
        "totalQuestions": 5,
        "correctCount": 4,
        "incorrectCount": 1,
        "percentage": 80,
        "direction": "forward",
        "languagePair": "en-GB|hi-IN"
      }
    ],
    "flashcardStats": {
      "totalReviews": 12,
      "cardAssessments": {
        "vocab_m8q9z3p_k4x12y9": {
          "knewCount": 5,
          "practiceCount": 1,
          "lastAssessment": "knew",
          "lastReviewed": 1729851000000
        }
      }
    },
    "dailyActivity": {
      "2026-10-25": {
        "date": "2026-10-25",
        "flashcardReviews": 6,
        "quizAttempts": 1,
        "quizCorrect": 4,
        "quizIncorrect": 1
      }
    }
  }
}
```

#### Field Specifications:

| Section | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| **Root** | `version` | `number` | Current schema version (`2`). Supported versions: `[1, 2]`. |
| **Root** | `entries` | `Array<Object>` | Array of saved vocabulary entry objects. |
| **Entries** | `id` | `string` | Unique identifier generated via `crypto.randomUUID()` with timestamp fallback. |
| **Entries** | `sourceText` | `string` | Normalized source text that was translated. |
| **Entries** | `translatedText` | `string` | Sanitized translated result string. |
| **Entries** | `fromCode` | `string` | Source language BCP-47 code (e.g. `en-GB`, `ur-PK`). |
| **Entries** | `fromName` | `string` | Localized source language display name (e.g. `English`, `Urdu`). |
| **Entries** | `toCode` | `string` | Target language BCP-47 code (e.g. `hi-IN`). |
| **Entries** | `toName` | `string` | Localized target language display name (e.g. `Hindi`). |
| **Entries** | `createdAt` | `number` | Unix timestamp (milliseconds) recorded at save time. |
| **Entries** | `isFavorite` | `boolean` | Flag indicating whether the entry is marked as favorite. |
| **Learning** | `quizHistory` | `Array<Object>` | Chronological array of completed quiz attempt records. |
| **Quiz** | `id` | `string` | Unique identifier for the quiz attempt. |
| **Quiz** | `timestamp` | `number` | Completion timestamp in epoch milliseconds. |
| **Quiz** | `date` | `string` | ISO 8601 date string. |
| **Quiz** | `totalQuestions` | `number` | Number of questions in the completed quiz. |
| **Quiz** | `correctCount` | `number` | Number of correctly answered questions. |
| **Quiz** | `incorrectCount`| `number` | Number of incorrectly answered questions. |
| **Quiz** | `percentage` | `number` | Final score percentage (`Math.round((correct / total) * 100)`). |
| **Quiz** | `direction` | `string` | Quiz translation direction (`"forward"` or `"reverse"`). |
| **Quiz** | `languagePair` | `string` | Selected language pair code or `"all"`. |
| **Flashcards** | `totalReviews` | `number` | Cumulative total of recorded flashcard assessments. |
| **Flashcards** | `cardAssessments`| `Object` | Per-entry assessment counts (`knewCount`, `practiceCount`, `lastAssessment`, `lastReviewed`). |
| **Daily** | `dailyActivity` | `Object` | Date-keyed map (`YYYY-MM-DD`) tracking daily quiz attempts, correct/incorrect totals, and flashcard reviews. |

---

### Storage Adapter Design, Migration & Resilience Policies

1. **Storage Availability & Session Fallback:**
   - The app runs a non-destructive storage probe to verify if `window.localStorage` is accessible.
   - If `localStorage` is blocked, unavailable, or restricted (e.g. private/incognito mode or restrictive browser security policies), the `StorageAdapter` automatically switches to in-memory session mode.
   - In fallback mode, the user is explicitly informed: *"Local storage is unavailable. Running in session memory mode (entries will not survive page refresh)."*

2. **Schema Versioning & Automated Migration:**
   - **Supported Versions:** `SUPPORTED_VERSIONS: [1, 2]`, `CURRENT_VERSION: 2`.
   - **Version 1 to Version 2 Migration:** When existing stored data with `version: 1` is detected, `StorageAdapter.load()` preserves all existing vocabulary entries and favorite states intact, initializes an empty learning history payload, and upgrades the stored schema version to `2`.
   - **Legacy Formats:** Pre-versioned raw arrays (`[...]`) or legacy objects without a version field (`{ entries: [...] }`) are cleanly migrated to Version 2 format with sanitized entries and default learning history.
   - **Migration Write-Failure Guard:** If saving the upgraded Version 2 payload to disk fails due to quota or permissions, `StorageAdapter` avoids corrupting disk data, preserves the raw payload, switches to protected in-memory mode, and serves the salvaged entries during the active session.

3. **Protected Recovery Mode (Data Preservation):**
   - **Corrupted JSON:** If `localStorage` contains malformed JSON, the raw string is **never overwritten**. The adapter sets `isProtected = true` and `protectionReason = "CORRUPTED_JSON"`, switches to session memory, and informs the user.
   - **Unsupported Future Versions:** If a newer, unsupported schema version (e.g. `version: 99`) is detected, the stored data is preserved untouched on disk (`protectionReason = "UNSUPPORTED_VERSION"`). Read-compatible entries and quiz records are salvaged in-memory for the current session.
   - **Destructive Write Block:** While in protected mode, any calls to `StorageAdapter.save()` modify only in-memory session state; the disk payload is never overwritten.

4. **Quota Exceeded Handling:**
   - If the browser's storage quota is exceeded (`QuotaExceededError`), the adapter catches the exception without modifying or corrupting existing records on disk.
   - The application does not silently drop items; it alerts the user: *"Local storage quota exceeded. Could not save data. Please delete older entries or reset learning history to free up space."*

5. **Learning History Reset vs. Vocabulary Retention:**
   - The dashboard includes a dedicated **Reset Learning History** action.
   - Clicking *Reset Learning History* opens an accessible confirmation modal (`#progress-reset-confirm-modal`).
   - Confirming reset clears completed quiz attempts, flashcard review statistics, and daily activity tracking while **preserving 100% of saved vocabulary entries and favorites**.
   - If storage is in protected recovery mode, the reset operates strictly in memory without altering protected disk data.

---

### ⚠️ Persistence Scope & Limitations

- **Browser & Device Scoped:** Data stored in `localStorage` is isolated to the specific browser, profile, and device on which it was created. It **does not synchronize across devices, different browsers, or private browsing profiles**.
- **Historical Tracking Horizon:** Persistent learning history tracking begins from the introduction of Phase 3, Step 2. Earlier flashcard or quiz sessions from prior versions without persistent tracking are not fabricated retroactively.
- **In-Memory Fallback Scope:** When running in session memory fallback mode, entries and progress **never survive a page reload or tab closure**.
- **Storage Limits:** Standard browser `localStorage` quotas typically allow ~5MB to 10MB per origin.
- **Clearing Browsing Data:** Clearing cookies and site data in browser settings will delete saved vocabulary entries and learning history.

---

## 🌐 Language Catalog & Provider Code Mappings

The catalog in [`countries.js`](countries.js) provides 97 language codes and localized display names.

### Display Name Accuracy
- **Urdu (`ur-PK`):** Correctly labeled "Urdu" (previously labeled "Pakistani").
- **Belarusian (`be-BY`):** Correctly labeled "Belarusian" (previously misspelled "Bielarus").
- **Punjabi (`pa-IN`):** Standard English spelling "Punjabi".

### Provider-Specific Code Resolution
- **Google Web Client:** Translates using the primary ISO-639-1 language subtag (e.g. `en-GB` → `en`, `ur-PK` → `ur`, `hi-IN` → `hi`).
- **MyMemory Translated API:** Attempts the full BCP-47 language pair (e.g. `en-GB|ur-PK`), and automatically falls back to primary subtag pairs (e.g. `en|ur`) if regional matching is rejected by the API.

### ⚠️ Language Coverage Notice
While [`countries.js`](countries.js) lists 90+ regional language codes, **not every language is supported by external free translation engines**. For example, lesser-resourced or regional creoles (such as Coptic, Fanagalo, Bajan, or Palauan) may not be supported by available providers. When an unsupported language pair is chosen, the application catches the provider error, restores UI state, and displays: *"The language pair (Source → Target) is not supported by available translation providers."* rather than failing silently.

---

## ⚡ Translation Architecture, Request Reliability & Privacy Notice

The translation engine implements a dual-provider fallback architecture with per-provider timeouts, user cancellation synchronization, and a permanent privacy disclosure.

### 1. Translation Provider Order & Fallback
Translation requests strictly follow this prioritized order:
1. **Google Web Client (Primary Provider):**
   - Client-side unofficial endpoint (`translate.googleapis.com/translate_a/single?client=gtx`).
   - Requires zero API keys or user credentials.
   - If Google responds successfully, its translation is rendered immediately.
2. **MyMemory Translated API (Fallback Provider):**
   - Free crowdsourced translation memory endpoint (`api.mymemory.translated.net/get`).
   - Invoked automatically if Google Translate fails (e.g. HTTP 500/503, CORS block, or request timeout).
   - Resolves full BCP-47 regional pairs first, with automatic fallback to primary ISO subtags if regional matching is rejected.
3. **Failure Handling:**
   - If both providers fail or time out, a clean and user-friendly error message is displayed (e.g., *"Translation request timed out..."* or *"Translation service is currently unreachable..."*).

### 2. Request Timeout & AbortController Synchronization
- **Configurable Timeout:** Bounded by `TRANSLATION_TIMEOUT_MS = 12000` (12 seconds per provider request).
- **Per-Provider AbortController:** Each provider call runs with its own controller signal tied to a `setTimeout` timer.
- **Resource Cleanup:** In the `finally` block of `callProviderWithTimeout()`, active timeout timers are cleared via `clearTimeout()` and parent abort listeners are removed via `removeEventListener()`, guaranteeing zero memory leaks or dangling timer references.
- **Distinguishing Timeout vs. Cancellation:** Timeout errors reject with `name: "TimeoutError"` and message `"TIMEOUT"`, which triggers fallback to MyMemory. User cancellations reject with `name: "AbortError"` and message `"USER_CANCELLED"`, which aborts the entire translation pipeline immediately.

### 3. User Cancellation Semantics
- When the user cancels an in-flight translation (by editing source text, switching languages, or clicking the swap button):
  - `cancelActiveRequest()` aborts `state.currentAbortController` and increments `state.activeRequestId`.
  - The active provider request is immediately aborted.
  - **Fallback is NOT triggered:** MyMemory is never called after user cancellation.
  - The loading button is immediately restored to its idle state (*Translate Text* with arrow).
  - No error toast or status banner is shown.

### 4. Translation Privacy Notice
- Located visibly within the Translator interface below the translation controls.
- Displays the verified disclosure:
  > **Privacy notice:** Text entered for translation is sent over the internet to Google Translate or MyMemory. Avoid entering passwords or sensitive personal information.
- Rendered with `role="note"`, `aria-label="Translation privacy notice"`, and a FontAwesome shield icon (`fas fa-shield-alt`).
- Uses application CSS variables (`--border-color`, `--radius-sm`, `--primary`, `--text-main`).
- Fully responsive on mobile viewports down to 320px with high-contrast mode borders under `@media (forced-colors: active)`.

---

## ♿ Modal Focus Trap & Accessibility Implementation

The confirmation modal dialog for clearing all vocabulary entries enforces strict accessibility standards:
- **ARIA Semantics:** Uses `role="dialog"`, `aria-modal="true"`, `aria-labelledby="confirm-modal-title"`, and `aria-describedby="confirm-modal-desc"`.
- **Keyboard Focus Trap:** When open, focus is trapped exclusively inside the modal card. Pressing <kbd>Tab</kbd> on the last button cycles to the first; pressing <kbd>Shift</kbd> + <kbd>Tab</kbd> on the first button cycles to the last. Focus cannot escape to the background document.
- **Default Focus Safety:** Focus defaults to the *Cancel* button upon opening to prevent accidental bulk deletion.
- **Escape Key & Backdrop Dismissal:** Pressing <kbd>Escape</kbd> or clicking the background backdrop cancels the modal.
- **Focus Restoration:** Upon closing, keyboard focus is reliably restored to the control that opened it (*Clear All* button).

---

## 🎴 Flashcard Practice Mode (Phase 2, Step 1)

The **Practice** tab introduces an interactive, accessible flashcard review experience to help learners reinforce vocabulary saved in their notebook.

### Core Architecture & Behavioral Rules

1. **Single Source of Truth:**
   - Flashcards are generated directly from the existing saved vocabulary entries in `notebookState.entries`.
   - No secondary storage or duplicate database is used.

2. **Two-Sided Flashcard Experience:**
   - **Front Face:** Displays the source word or phrase and its source language display name (e.g., `English`). Includes a native text-to-speech pronunciation button and recall hint.
   - **Back Face:** Reveals the saved translation and target language display name (e.g., `Hindi`). Includes pronunciation audio and active session evaluation status.
   - **Reveal / Hide Control:** A prominent button toggles between *"Show Answer"* and *"Hide Answer"*, with proper `aria-expanded` state tracking and polite live announcements.

3. **Sequential Navigation & Boundary Handling:**
   - **Progress Counter:** Live counter displays current position (e.g., *"Card 3 of 12"*).
   - **Previous / Next Controls:** Step backwards and forwards through cards.
   - **Strict Boundary Guards:** The *Previous* button is disabled on Card 1; the *Next* button is disabled on the final card. Moving between cards retains session evaluation results.

4. **Session-Only Evaluation & Feedback:**
   - **Self-Assessment Actions:** Learners mark each card with **"I knew it"** (green check) or **"Need more practice"** (purple redo).
   - **Visual Feedback:** Selected evaluation is immediately indicated with active button styles and a status tag on the answer face.
   - **Session Score Summary:** Header displays real-time tally of known vs. practice cards for the current session.
   - **Session Restart:** A *Restart* button resets the session back to Card 1, conceals revealed answers, and clears the session results Map.
   - **Scope Boundary:** In this phase, progress evaluation is strictly **in-memory for the current session** (`practiceState.sessionResults`). No permanent learning statistics, streaks, or spaced-repetition schedules are saved to disk.

5. **Graceful Handling of Notebook Data Changes:**
   - **Empty State:** If the notebook contains 0 entries, a friendly empty state appears explaining that words must be saved in the Notebook first, providing direct action buttons to *"Go to Translator"* and *"View Notebook"*.
   - **Real-Time Deletion / Addition:** When cards are saved, deleted individually, or cleared via the confirmation modal, `syncPracticeState()` safely prunes deleted entries from session results, clamps the active index within bounds, and transitions to the empty state if all entries are removed without throwing errors or displaying stale cards.

6. **Accessibility & Safety:**
   - Keyboard navigation supports <kbd>Space</kbd> or <kbd>Enter</kbd> to reveal/hide answers, and <kbd>ArrowLeft</kbd> / <kbd>ArrowRight</kbd> to step between cards when focused.
   - ARIA live region (`aria-live="polite"`) announces revealed answers and evaluation results cleanly.
   - Pure, safe DOM APIs (`textContent`, `document.createTextNode`) are used for user text rendering, guaranteeing protection against script injection.

---

## 🎯 Vocabulary Quiz Mode & Scoring (Phase 2, Step 2)

Integrated directly into the **Practice** tab, **Quiz Mode** provides interactive multiple-choice recall assessments based on words saved in the Vocabulary Notebook.

### Architecture & Behavioral Rules

1. **Sub-Mode Navigation:**
   - The Practice tab features a sub-navigation bar allowing instant toggling between **Flashcards** and **Quiz**.
   - Switching between sub-modes preserves notebook entries and translator state intact.

2. **Quiz Configuration:**
   - **Translation Direction:**
     - *Original → Translation:* Prompts with the source word (e.g., `Hello`), options contain translated words (e.g., `Hola`).
     - *Translation → Original:* Prompts with the translation (e.g., `Hola`), options contain source words (e.g., `Hello`).
   - **Language Pair Isolation:** When multiple language pairs exist in the notebook (e.g. English → Spanish and English → French), users can isolate quizzes to a specific language pair to prevent mixing unrelated vocabularies.
   - **Quiz Length:** Select 5, 10, or all available words. The dropdown options automatically clamp according to the eligible entries count.
   - **Shuffle Ordering:** Enabled by default, randomizing question presentation using the Fisher-Yates algorithm.

3. **Multiple-Choice Option Generation & Deduplication:**
   - Generates 4 choices per question when 4 or more eligible entries exist.
   - **Distractor Selection:** Distractors are drawn first from entries matching the target language, then from other notebook entries.
   - **Duplicate Elimination:** Options are deduplicated against the correct answer case-insensitively using a `Set`.
   - **Random Placement:** The correct option index is randomized across positions 1 to 4 using Fisher-Yates shuffling.

4. **Small Notebook Handling:**
   - **2 to 3 Entries:** Questions adapt gracefully to 2 or 3 choices, displaying an informative blue notice banner: *"With N saved entries in this set, questions will feature N answer choices instead of 4."*
   - **Fewer than 2 Entries:** Quiz start is disabled with an amber warning banner explaining that multiple-choice questions require at least 2 entries, providing direct action buttons to *"Switch to Flashcards"* or *"Go to Translator"*.

5. **Question Flow & Single-Score Locking:**
   - Displays live question counter (e.g., *"Question 3 of 10"*), progress bar, language badge, prompt text, and prompt audio button.
   - **Immediate Visual & Accessible Feedback:**
     - Correct choice marked with green highlight and checkmark icon (`fa-check-circle`).
     - Incorrect choice marked with red highlight and cross icon (`fa-times-circle`), while simultaneously highlighting the correct answer in green.
     - Live banner announces result text and reveals the correct translation when incorrect.
     - Never relies on color alone; iconography and textual labels accompany all state changes.
   - **Duplicate Scoring Prevention:** First choice click locks all buttons (`disabled = true`) and sets `quizState.isAnswerSubmitted = true`. Repeated clicks cannot alter scores or record duplicate answers.
   - Advances using the primary *Next Question* button (or *View Results* on the final question).

6. **Scoring, Results & Review:**
   - **Session-Only Memory:** Quiz results are stored in `quizState` for the current quiz session. No permanent statistics or external databases are used.
   - **Summary Metrics:** Large score badge displays percentage score (`Math.round((correct / total) * 100)`), accompanied by total questions, correct count, incorrect count, and an encouraging message tailored to performance.
   - **Review Incorrect Answers:** If mistakes were made, an expandable collapsible accordion displays each missed question with:
     - Prompt text and language.
     - The user's incorrect chosen answer (with cross icon).
     - The correct translation (with check icon and native text-to-speech audio pronunciation button).
   - **Session Controls:** Buttons to *Retake Quiz* (restarts quiz with current configuration), adjust *Quiz Settings*, or return *Back to Flashcards*.

7. **Keyboard Accessibility & Safety:**
   - Press <kbd>1</kbd>, <kbd>2</kbd>, <kbd>3</kbd>, or <kbd>4</kbd> during an active question to select an answer option.
   - Press <kbd>Enter</kbd> to proceed to the next question once an answer is submitted.
   - Press <kbd>Escape</kbd> to exit an active quiz back to setup.
   - Pure, safe DOM manipulation (`textContent`, `appendChild`) is used throughout; saved words are never evaluated as executable HTML.
   - Active quiz safely returns to setup if notebook entries are deleted or cleared during a quiz session (`syncPracticeState`).

---

## 📊 Persistent Learning Progress Dashboard Architecture (Phase 3, Steps 1 & 2)

The **Learning Progress Dashboard** provides users with clear, persistent visibility into their vocabulary acquisition and learning performance across Flashcard and Quiz activities.

### 1. Data Boundaries & Persistence Model

| Scope | Metrics Included | Source of Truth | Persistence Policy |
| :--- | :--- | :--- | :--- |
| **Permanent Vocabulary** | Total Saved Words, Favorites Count | `notebookState.entries` (managed via `StorageAdapter`) | Persists across page reloads via `localStorage` (or session fallback when storage is blocked). |
| **Persistent Learning History** | Lifetime Completed Quizzes, Correct & Incorrect Answers, Overall Accuracy, Flashcards Reviewed, Quiz Attempt History, Daily Learning Activity | `StorageAdapter` (`learningHistory` in Schema v2) | Safely persisted to `localStorage` upon every quiz completion and flashcard assessment. Survives page reloads. |

### 2. Metric Calculation Rules

- **Total Vocabulary & Favorites:** Calculated directly from `notebookState.entries` in real-time. Immediately updates when words are saved, deleted, cleared, or starred.
- **Flashcard Reviews:** Counted **only** when a user explicitly records a recall assessment using *"I knew it"* or *"Need more practice"*. Merely opening, viewing, or flipping a card does not count as a review. Repeated clicks on the assessment buttons for the same card do not produce duplicate increments.
- **Quiz Attempts:** Counted **only** when a quiz is fully completed (reaching the results screen). In-progress quizzes and abandoned sessions do not increment attempts. Deduplicated so duplicate event handlers never record multiple entries.
- **Retakes as Distinct Attempts:** Retaking a quiz via *Retake Quiz* begins a fresh session and, upon completion, is recorded as a separate attempt with its own unique ID, timestamp, score, and breakdown.
- **Lifetime Quiz Answer Totals & Accuracy:** Aggregated from actual completed questions across all recorded attempts:
  $$\text{Accuracy} = \begin{cases} 0\% & \text{if } \text{Total Answers} = 0 \\ \operatorname{round}\left(\frac{\text{Total Correct}}{\text{Total Correct} + \text{Total Incorrect}} \times 100\right)\% & \text{if } \text{Total Answers} > 0 \end{cases}$$
  Zero-answer edge cases cleanly return `0%` without `NaN` or division-by-zero errors.
- **Daily Learning Activity:** Chronological timeline derived exclusively from real recorded event timestamps (`YYYY-MM-DD`). Days without recorded events are never fabricated.

### 3. Reset Learning History & Focus Trap

- **Confirmation Modal:** Accessible dialog (`#progress-reset-confirm-modal`) with ARIA attributes and a strict keyboard focus trap.
- **Data Protection:** Confirming reset permanently wipes quiz attempts, flashcard statistics, and daily activity from storage and memory, while leaving saved vocabulary entries and favorites 100% intact.
- **Cancellation:** Pressing <kbd>Escape</kbd>, clicking *Cancel*, or clicking the backdrop dismisses the dialog and leaves history unchanged, restoring focus to the reset button.
- **Protected Recovery Safety:** If storage is in protected recovery mode (e.g. corrupted JSON on disk), the reset operates only in-memory to prevent destructive disk overwrites.

### 4. Activity Visualization & Accessibility

- **Score History Visualization:** An accessible horizontal score-history list rendering each completed attempt with attempt number, timestamp, translation direction pill, score percentage badge, and an animated progress meter (`role="progressbar"` with `aria-valuenow`).
- **Daily Learning Activity:** Displays active days with calendar icons, quiz attempt counts, accuracy breakdown, and flashcard review totals.
- **Empty State:** When no quizzes or assessments have been completed, friendly empty states are rendered with direct action buttons to *"Take a Quiz"* or *"Review Flashcards"*.
- **Color Independence:** Success and need-work states use distinct symbols (✓ and ✕), percentage badges, and explicit text labels alongside color coding.
- **Zero JavaScript Runtime Dependencies:** Built strictly with semantic HTML5, modern vanilla CSS, and standard ECMAScript (ES6+) without npm packages, bundlers, or third-party JavaScript frameworks (no React, Vue, jQuery, etc.).
- **Externally Hosted Visual Assets:** The application loads two CDN-hosted assets for styling and iconography:
  - Google Fonts CDN: `Poppins` font family (`fonts.googleapis.com`).
  - FontAwesome CDN: Version 5.15.3 icon stylesheet and webfonts (`cdnjs.cloudflare.com`).

---

## 🚀 Running the Project Locally

No build tools, compilation steps, or JavaScript package managers are required.

1. Clone or download the repository files:
   ```bash
   git clone https://github.com/Anuragchakradhari/My-Project.git
   ```

2. Open [`index.html`](index.html) directly in any browser:
   - Double-click `index.html` to open as a local file, or
   - Serve using a local development server:
     ```bash
     # Using Python 3
     python -m http.server 8080

     # Or using Node.js
     npx serve .
     ```

3. Navigate to `http://localhost:8080` in your web browser.

### 🧪 Running Automated Regression Tests

Run the comprehensive automated regression suite using Node.js:
```bash
node test_suite.js
```
This suite verifies **89 comprehensive automated scenarios across 10 categories**:
- **Category 1: Language Catalog (1 Scenario):** Display names for Urdu, Belarusian, Punjabi, and 90+ mapped codes.
- **Category 2: StorageAdapter & Persistence (11 Scenarios):** All 11 storage scenarios (quota exhaustion, blocked storage, malformed JSON preservation, unsupported schema versions, legacy migrations, missing/duplicate ID recovery).
- **Category 3: Translation Reliability, Timeout & Privacy Notice (18 Scenarios):**
  1. Stale response prevention and translation validation guards.
  2. Provider language code mapping (Google primary subtags vs. MyMemory regional pairs).
  3. Google provider successful response.
  4. Google failure cleanly falling back to MyMemory.
  5. Both providers failing handled gracefully.
  6. Rate-limiting (429) and unsupported language (400) responses categorized.
  7. Per-provider timeout triggers and distinguishes `TimeoutError` from cancellation.
  8. Deterministic timer tracking (`setTimeout`, `clearTimeout`, execution) and abort listener cleanup across all 4 terminal paths (success, failure, timeout, cancellation).
  9. Google timeout cleanly triggering fallback to MyMemory.
  10. Fallback provider timeout and combined `TRANSLATION_TIMEOUT` error.
  11. User cancellation aborting active request immediately without calling fallback.
  12. User cancellation during fallback halting execution cleanly.
  13. Outdated response cannot overwrite newer translation (exercising extracted `translateText` and `cancelActiveRequest`).
  14. Loading state transitions and `cancelActiveRequest()` reset behavior after all terminal outcomes.
  15. Privacy notice DOM structure, exact disclosure content, and ARIA semantics.
  16. Privacy notice responsive styles verified for 320px viewport and forced-colors mode.
  17. Real headless browser verification across 6 viewports (320px, 360px, 375px, 440px, 768px, 1024px) checking horizontal overflow (`scrollWidth <= clientWidth`), notice visibility, bounding rect, text wrapping, and nav bar overflow.
  18. Real headless browser accessibility tree inspection (Chrome AXTree verification of `role="note"` and computed accessible name).
- **Category 4: Notebook & Accessibility (2 Scenarios):** Duplicate save prevention, search, language filters, and favorites toggle.
- **Category 5: Modal Accessibility & Focus (1 Scenario):** Focus restoration safely targeting invoking element and cleaning up state.
- **Category 6: Asynchronous State & Language Swapping (4 Scenarios):** Rapid consecutive requests (race condition), swap with completed translation, swap during in-flight request, and identical language mirroring.
- **Category 7: Flashcard Practice Mode & State (7 Scenarios):** Empty notebook friendly state, front/back rendering, answer reveal/hide toggling, boundary navigation, session evaluation tracking ("I knew it" / "Need more practice"), session restart, and graceful entry deletion/clear synchronization.
- **Category 8: Vocabulary Quiz Mode & Scoring (13 Scenarios):** Quiz generation, translation directions, question count clamping and shuffle, unique choices (no duplicate options), correct/incorrect evaluation with feedback banners, single-contribution score locking, score calculation, small notebook pool handling, review incorrect answers accordion, quiz retake reset, active quiz mutation safety, quiz navigation guard, and accordion reset.
- **Category 9: Learning Progress Dashboard (11 Scenarios):** Total vocabulary and favorite calculations, flashcard reviews counted strictly upon recorded assessment, quiz attempts counted only after completion, correct/incorrect answer aggregation, accurate accuracy percentage calculations including zero-answer edge cases, quiz retakes counted as separate completed attempts, duplicate increment prevention on rerenders, dynamic dashboard synchronization on vocabulary mutations, empty-state vs. history toggling, tab switching state preservation, and regression coverage.
- **Category 10: Persistent Learning History & Data Safeguards (21 Scenarios):**
  1. Saving and reloading quiz history with timestamps, questions, correct/incorrect answers, percentages, direction, and language pair.
  2. Saving and reloading flashcard review totals and per-card assessments.
  3. Schema migration from supported Version 1 to Version 2.
  4. Preservation of vocabulary entries and favorites during migration.
  5. Corrupted storage handling with protected recovery mode (never overwrites disk).
  6. Unsupported future schema version (`v99`) preservation.
  7. Read failures, write failures, and quota exhaustion safeguards without data loss.
  8. In-memory fallback behavior when storage is blocked.
  9. Exactly-once quiz recording preventing duplicate attempt entries.
  10. Retakes recorded as distinct completed attempts with unique IDs.
  11. Correct lifetime accuracy calculation and zero-answer handling.
  12. Daily learning activity derived exclusively from real timestamps.
  13. Learning history reset without deleting vocabulary entries or favorites.
  14. Reset cancellation leaves persistent history unchanged.
  15. Tab switching and dashboard rerenders produce zero duplicate activity.
  16. Full regression coverage across categories 1 through 9.
  17. Quota exhaustion synchronization maintaining in-memory session state.
  18. Learning history reset clearing session assessments for clean practice restart.
  19. Missing daily activity cleanly derived from quiz history records upon load.
  20. Mobile navigation layout rules preventing horizontal overflow down to 320px–375px.
  21. Progress empty-state and history persistence after browser refresh.

---

## 🧪 Comprehensive Manual & Automated Testing Checklist

| Category | Test Case | Steps to Test | Expected Result |
| :--- | :--- | :--- | :--- |
| **Language Catalog** | **Urdu Label** | Check `countries["ur-PK"]` in dropdown or code. | Displays `"Urdu"` (never `"Pakistani"`). |
| **Language Catalog** | **Belarusian & Punjabi** | Check `countries["be-BY"]` and `countries["pa-IN"]`. | Displays `"Belarusian"` and `"Punjabi"`. |
| **Translator** | **Empty Input** | Leave textarea empty; click *Translate Text*. | Status announces *"Please enter text to translate."*; save button remains disabled. |
| **Translator** | **Urdu Translation** | Enter `"Hello"`, select English → Urdu, click *Translate Text*. | Output displays `"سلام"`; save button enables. |
| **Translator** | **Identical Languages** | Set both dropdowns to English; enter text; click *Translate Text*. | Text is mirrored immediately; save button enables. |
| **Translator** | **Language Swap** | Enter text; click swap button. | Languages and textarea values swap; icon rotates 180°; status announces swap. |
| **Translator** | **Cancellation & Race Conditions** | Start a translation and immediately edit the source textarea. | Active request is cancelled via `AbortController`; outdated translation discarded. |
| **Translator** | **Keyboard Shortcut** | Type in source textarea; press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> (or <kbd>Cmd</kbd> + <kbd>Enter</kbd>). | Translation initiates immediately without clicking button. |
| **Translator** | **Privacy Notice** | Open Translator view; inspect area below translation controls. | Displays visible privacy notice with shield icon advising against entering passwords or sensitive info; scales cleanly at 320px. |
| **Translator** | **Request Timeout & Fallback** | Trigger a translation where primary provider hangs or times out. | Automatically falls back to MyMemory provider after 12s timeout; returns translation or timeout error if both fail. |
| **Translator** | **User Cancellation & Fallback Guard** | Initiate translation and immediately change language or edit source. | Aborts active request immediately; does NOT trigger fallback to MyMemory; restores button to idle state. |
| **Notebook** | **Save Translation** | Translate text and click the bookmark save icon. | Button animates; live status announces success; tab badge increases to `1`. |
| **Notebook** | **Save Disabled on Empty/Error** | Clear source text or cause an error. | Save button is disabled (`disabled` attribute and low opacity). |
| **Notebook** | **Duplicate Detection** | Click save bookmark a second time on the same translation. | Duplicate feedback announced; no duplicate entry is added; badge remains unchanged. |
| **Notebook** | **Tab Navigation & ARIA** | Click *Vocabulary Notebook* tab (or press <kbd>ArrowRight</kbd> when tab is focused). | Notebook panel opens (`hidden` removed); tab has `aria-selected="true"`. |
| **Notebook** | **Card Rendering & Metadata** | Switch to Vocabulary Notebook after saving. | Card displays language badge (e.g. `English → Urdu`), timestamp, source, translation, and action buttons. |
| **Notebook** | **Favorite Toggling** | Click star icon on saved card. | Star turns gold (`fas fa-star`, `active`); status confirms favorite; persists on reload. |
| **Notebook** | **Favorites Filter** | Click *Favorites* toggle in toolbar. | Displays only favorite items; updates results count counter; toggling off restores all. |
| **Notebook** | **Live Search** | Type query in search input; then type non-matching query. | Query matches card; non-matching query shows empty search state with *Clear Filters* button. |
| **Notebook** | **Language Filter** | Select language from filter dropdown. | Displays only cards matching selected language code in source or target. |
| **Notebook** | **Card Pronunciation & Copy** | Click audio or copy button on a notebook card. | Pronounces text or copies to clipboard with visual feedback without page reload. |
| **Notebook** | **Open in Translator** | Click *Open in Translator* on a saved card. | Switches to Translator view; populates source text, translation, and language dropdowns. |
| **Notebook** | **Individual Deletion** | Click trash icon on a saved card. | Card is removed; tab badge updates; status announces deletion. |
| **Modal Trap** | **Focus Trap (Tab / Shift+Tab)** | Open *Clear All* modal; press <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd>. | Focus cycles strictly between *Cancel* and *Delete All*; cannot escape to background. |
| **Modal Trap** | **Escape & Focus Restoration** | Open modal; press <kbd>Escape</kbd> (or click *Cancel*). | Modal closes; focus restored to the *Clear All* button; entries preserved. |
| **Modal Trap** | **Confirmed Deletion** | Open modal; click *Delete All*. | Entries deleted; empty state appears (*"Your Notebook is Empty"*); badge displays `0`. |
| **Practice** | **Empty Notebook State** | Switch to *Practice* tab with 0 saved vocabulary entries. | Displays *"No Vocabulary to Practice"* empty state with buttons to go to Translator or Notebook. |
| **Practice** | **Sub-Mode Toggle** | Click *Quiz* button in the Practice sub-navigation. | Switches view to Quiz Setup; preserves Flashcard and Notebook state. |
| **Practice** | **Flashcard Front Content** | Save entries and switch to Practice Flashcards. | Displays Card 1 of N, original word/phrase, and source language tag (e.g. English); answer face is hidden. |
| **Practice** | **Reveal / Hide Answer** | Click *Show Answer* button (or press <kbd>Space</kbd>/<kbd>Enter</kbd> on card). | Back face becomes visible displaying translation and target language; button updates to *Hide Answer* (`aria-expanded="true"`). |
| **Practice** | **Card Pronunciation** | Click speaker icon on front or back of flashcard. | Speaks prompt or translation using Web Speech API without flipping card. |
| **Practice** | **Previous / Next Boundaries** | Navigate using *Previous* and *Next* buttons (or arrow keys). | First card has *Previous* disabled; last card has *Next* disabled; index clamps safely. |
| **Practice** | **Assessment Counting Rule** | View and flip card without rating; then click *"I knew it"*. | Flip does not increment review count; clicking assessment button increments count by 1. |
| **Practice** | **Restart Session** | Click *Restart* in practice header. | Returns to Card 1; conceals answer; clears session results; score pills reset to 0. |
| **Practice** | **Deletion Synchronization** | Delete a card in Notebook while practicing. | Flashcard index clamps gracefully; deleted card is removed from session results without stale references. |
| **Practice** | **Tab Switching Isolation** | Type text in Translator, switch to Practice, then back to Translator. | Translator input is fully preserved; no unwanted resets occur. |
| **Quiz** | **Setup Configuration** | Choose direction (*Translation → Original*), select question count, toggle shuffle. | Settings update cleanly; question counts clamp to eligible saved entries. |
| **Quiz** | **Small Pool Notice (2-3 Entries)** | Save 2 entries and open Quiz setup. | Displays blue notice banner explaining that questions will have 2 options instead of 4; Start Quiz is enabled. |
| **Quiz** | **Insufficient Pool Warning (< 2 Entries)** | Delete all but 1 entry and open Quiz setup. | Displays amber warning banner explaining at least 2 entries are required; Start Quiz is disabled; provides links to Flashcards and Translator. |
| **Quiz** | **Multiple-Choice Question Flow** | Start quiz with >=4 entries. | Question counter (*Question 1 of N*) and progress bar render; 4 unique choices displayed without duplicates. |
| **Quiz** | **Correct Answer Feedback** | Click the correct answer choice. | Choice turns green with checkmark icon; feedback banner announces correct answer; Next Question button enables. |
| **Quiz** | **Incorrect Answer Feedback** | Click an incorrect answer choice. | Chosen button turns red with cross icon; correct answer is highlighted green; feedback banner reveals the correct translation. |
| **Quiz** | **Single Score Locking** | Click another option after an answer has already been selected. | Buttons remain disabled; score does not increment a second time; answer cannot be changed. |
| **Quiz** | **Question Pronunciation** | Click speaker icon next to prompt text in quiz card. | Speaks the prompt in the native language using Web Speech API without submitting an answer. |
| **Quiz** | **Keyboard Shortcuts** | Press keys <kbd>1</kbd>–<kbd>4</kbd> during active question; press <kbd>Enter</kbd> after answering. | Selects corresponding option; advances to next question. |
| **Quiz** | **Results Screen & Scoring** | Answer all questions and reach the completion view. | Score badge displays calculated percentage; stat cards show total, correct, and incorrect answers; displays encouraging message. |
| **Quiz** | **Review Incorrect Answers** | Click *Review Incorrect Answers* on results screen with mistakes. | Expands review accordion showing prompt, user's answer, correct answer, and TTS audio button. |
| **Quiz** | **Retake Quiz** | Click *Retake Quiz* button on results screen. | Resets session score and index; restarts quiz from Question 1 with fresh randomized options. |
| **Quiz** | **Mid-Quiz Mutation Guard** | Delete an entry in Notebook while a quiz is in progress. | When returning to Practice, quiz safely exits to setup without throwing errors or displaying undefined text. |
| **Progress** | **Vocabulary & Favorites Sync** | Save translations and star items in Notebook; switch to Progress. | Saved Words and Favorites counters immediately reflect exact counts. |
| **Progress** | **Flashcard Review Persistence** | Rate cards as "I knew it"; reload browser page. | Flashcard review counts persist accurately across reloads. |
| **Progress** | **Quiz History Persistence** | Complete a quiz; reload browser page. | Completed quiz attempt, score, accuracy, and date persist in dashboard across reloads. |
| **Progress** | **Daily Activity Timeline** | Complete quiz and flashcards; view Daily Learning Activity card. | Shows today's date (`YYYY-MM-DD`) with exact counts of quizzes and flashcards completed. |
| **Progress** | **Accuracy Calculation** | Complete a quiz with 4 of 5 correct (80%); complete second with 2 of 3 (total 6/8 = 75%). | Accuracy reflects exact cumulative ratio (75%); handles 0-answer edge cases cleanly as 0%. |
| **Progress** | **Retake Accounting** | Click *Retake Quiz* on results screen and complete second attempt. | Attempt count increments to 2; history list displays both distinct attempt cards. |
| **Progress** | **Reset History Modal Trap** | Click *Reset History* button in Progress header. | Opens confirmation modal; focus traps on Cancel button; Escape key dismisses safely. |
| **Progress** | **Reset History Confirmation** | Confirm reset in modal. | Clears quiz attempts, flashcard reviews, and daily activity; preserves 100% of saved vocabulary and favorites. |
| **StorageAdapter** | **Schema Migration (v1 -> v2)** | Load stored data with `version: 1`. | Upgrades schema to Version 2; initializes empty learning history; preserves all entries and favorites. |
| **StorageAdapter** | **Protected Recovery Mode** | Place corrupted JSON or `version: 99` in localStorage. | Preserves raw disk string untouched; loads safely in memory fallback mode; write calls modify only session memory. |
| **StorageAdapter** | **Session Memory Fallback** | Simulate unavailable/blocked `localStorage`. | Adapter switches to memory mode; saves work for session; warns user entries will not survive reload. |
| **StorageAdapter** | **Quota Error Handling** | Simulate `QuotaExceededError`. | Catches error; alerts user; leaves disk storage and in-memory state consistent. |
| **Responsive** | **Mobile Layout (320px–375px)** | Resize viewport down to 320px. | All 4 tabs fit cleanly; metric cards wrap into responsive grid; score-history bars scale without horizontal overflow. |

---

## 📂 Project Structure

```plaintext
Language-Translator/
├── index.html        # Semantic HTML5 layout, ARIA tabs (Translator, Notebook, Practice, Progress), reset modal
├── style.css         # Modern design system, focus indicators, flashcards, quiz & persistent dashboard styling
├── script.js         # Core logic: translation pipeline, StorageAdapter v2, notebook, flashcards, quiz & progress engines
├── countries.js      # Global language code catalog (97 verified entries)
├── test_suite.js     # Comprehensive regression test suite (Node.js, 10 categories, 16 persistence scenarios)
└── README.md         # Comprehensive project documentation & regression checklist
```


