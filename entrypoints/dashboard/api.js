/**
 * api.js — External AI Summary API
 * API key stored in chrome.storage.local only — never written to disk.
 */

const API_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const API_MODEL    = "gpt-4o-mini";
const MAX_CONTENT_CHARS = 12000;

/**
 * Generate a summary of a conversation via OpenAI API.
 * @param {string} content  - Full conversation text
 * @param {string} apiKey   - OpenAI API key
 * @returns {Promise<string>} Summary as plain text
 * @throws {Error} with a user-friendly message on any failure
 */
export async function generateSummary(content, apiKey) {
    if (!content || typeof content !== 'string' || !content.trim()) {
        throw new Error("No content to summarise.");
    }
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk-')) {
        throw new Error("Invalid API key format. Key should start with 'sk-'.");
    }

    let response;
    try {
        response = await fetch(API_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: API_MODEL,
                max_tokens: 512,
                messages: [
                    {
                        role: "system",
                        content: "You are a research assistant. Summarise the following AI conversation concisely in 3-5 bullet points, highlighting key decisions, conclusions, and open questions."
                    },
                    {
                        role: "user",
                        content: content.slice(0, MAX_CONTENT_CHARS)
                    }
                ]
            })
        });
    } catch (networkErr) {
        // fetch() itself threw — no network, DNS failure, etc.
        throw new Error("Network error: could not reach OpenAI. Check your internet connection.");
    }

    if (!response.ok) {
        let errMsg = `API error ${response.status}`;
        try {
            const errBody = await response.json();
            errMsg = errBody?.error?.message || errMsg;
        } catch (_) { /* ignore JSON parse failure on error body */ }

        // Provide actionable messages for common status codes
        if (response.status === 401) throw new Error("Invalid API key. Please check your key in Settings.");
        if (response.status === 429) throw new Error("Rate limit exceeded. Please wait a moment and try again.");
        if (response.status === 500) throw new Error("OpenAI server error. Please try again later.");
        throw new Error(errMsg);
    }

    let data;
    try {
        data = await response.json();
    } catch (_) {
        throw new Error("Could not parse API response. Please try again.");
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text || typeof text !== 'string' || !text.trim()) {
        throw new Error("API returned an empty summary. Please try again.");
    }

    return text;
}

/**
 * Read the stored API key from chrome.storage.local.
 * @returns {Promise<string|null>}
 */
export function getApiKey() {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(['apiKey'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error("[REXOW api] getApiKey error:", chrome.runtime.lastError.message);
                    resolve(null);
                    return;
                }
                resolve(result?.apiKey || null);
            });
        } catch (e) {
            console.error("[REXOW api] getApiKey threw:", e);
            resolve(null);
        }
    });
}

/**
 * Persist the API key to chrome.storage.local.
 * @param {string} key
 * @returns {Promise<void>}
 */
export function saveApiKey(key) {
    return new Promise((resolve, reject) => {
        if (!key || typeof key !== 'string' || !key.trim()) {
            reject(new Error("API key cannot be empty."));
            return;
        }
        try {
            chrome.storage.local.set({ apiKey: key.trim() }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        } catch (e) {
            reject(e);
        }
    });
}
