/* ==========================================
   GRADEFLOW
   File: server/services/gemini.js

   Gemini AI Service
   Supports text, images, PDFs, audio and video

   Improvements:
   - Secure API-key header
   - Request timeout
   - Limited retries for temporary failures
   - Attachment validation
   - Response validation
   - Better error handling
========================================== */

const API_KEY = process.env.GEMINI_API_KEY;

const MODEL =
    process.env.GEMINI_MODEL ||
    "gemini-3.8-flash";

const ENDPOINT =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 15 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 2;

const ALLOWED_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/csv",
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/mp4",
    "audio/webm",
    "audio/aac",
    "audio/flac",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/mpeg"
]);

const RETRYABLE_STATUS_CODES = new Set([
    429,
    500,
    502,
    503,
    504
]);

const BASE64_PATTERN =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;


/* ==========================================
   VALIDATE ATTACHMENTS
========================================== */

function prepareAttachments(attachments) {
    if (attachments === undefined || attachments === null) {
        return [];
    }

    if (!Array.isArray(attachments)) {
        throw new Error("Attachments must be an array.");
    }

    if (attachments.length > MAX_FILES) {
        throw new Error(
            "You can attach up to 3 files per message."
        );
    }

    let totalBytes = 0;

    return attachments.map((file) => {
        if (
            !file ||
            typeof file.mimeType !== "string" ||
            typeof file.data !== "string"
        ) {
            throw new Error("An attachment is invalid.");
        }

        const mimeType = file.mimeType
            .split(";")[0]
            .trim()
            .toLowerCase();

        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
            throw new Error(
                `This file type is not supported: ${mimeType}`
            );
        }

        // Accept plain Base64 only, not data URLs.
        const data = file.data;

        if (
            !data ||
            data.length % 4 !== 0 ||
            !BASE64_PATTERN.test(data)
        ) {
            throw new Error(
                "An attachment contains invalid Base64 data."
            );
        }

        const bytes = Buffer.from(data, "base64");

        if (bytes.length === 0) {
            throw new Error("An attachment is empty.");
        }

        if (bytes.length > MAX_FILE_BYTES) {
            throw new Error(
                "Each attachment must be 5 MB or smaller."
            );
        }

        totalBytes += bytes.length;

        if (totalBytes > MAX_TOTAL_FILE_BYTES) {
            throw new Error(
                "The total attachment size cannot exceed 15 MB."
            );
        }

        return {
            inlineData: {
                mimeType,
                data
            }
        };
    });
}


/* ==========================================
   WAIT HELPER
========================================== */

function wait(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}


/* ==========================================
   RETRY DELAY
========================================== */

function getRetryDelay(response, attempt) {
    const retryAfter = response?.headers?.get("retry-after");

    if (retryAfter) {
        const seconds = Number(retryAfter);

        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(seconds * 1000, 10_000);
        }

        const retryDate = Date.parse(retryAfter);

        if (Number.isFinite(retryDate)) {
            return Math.min(
                Math.max(retryDate - Date.now(), 0),
                10_000
            );
        }
    }

    // Exponential backoff with a small random delay.
    const baseDelay = 1000 * Math.pow(2, attempt);

    return Math.min(
        baseDelay + Math.floor(Math.random() * 500),
        10_000
    );
}


/* ==========================================
   BUILD REQUEST BODY
========================================== */

function buildRequestBody({
    prompt,
    attachments,
    systemInstruction,
    temperature,
    responseMimeType,
    responseSchema,
    maxOutputTokens
}) {
    const parts = [];

    if (prompt) {
        parts.push({
            text: prompt
        });
    }

    // Attach files to the same user message as the prompt.
    parts.push(...attachments);

    const requestBody = {
        contents: [
            {
                role: "user",
                parts
            }
        ],

        generationConfig: {
            temperature,
            maxOutputTokens,

            ...(responseMimeType
                ? { responseMimeType }
                : {}),

            ...(responseSchema
                ? { responseSchema }
                : {})
        }
    };

    if (
        typeof systemInstruction === "string" &&
        systemInstruction.trim()
    ) {
        requestBody.systemInstruction = {
            parts: [
                {
                    text: systemInstruction.trim()
                }
            ]
        };
    }

    return requestBody;
}


/* ==========================================
   SEND REQUEST TO GEMINI
========================================== */

async function sendGeminiRequest(requestBody) {
    let lastError;

    for (
        let attempt = 0;
        attempt <= MAX_RETRIES;
        attempt++
    ) {
        let response;

        try {
            response = await fetch(ENDPOINT, {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": API_KEY
                },

                body: JSON.stringify(requestBody),

                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT_MS
                )
            });

        } catch (error) {
            lastError = error;

            const isTimeout =
                error?.name === "TimeoutError" ||
                error?.name === "AbortError";

            const isNetworkError =
                error?.name === "TypeError";

            if (
                attempt < MAX_RETRIES &&
                (isTimeout || isNetworkError)
            ) {
                await wait(
                    Math.min(
                        1000 * Math.pow(2, attempt),
                        5000
                    )
                );

                continue;
            }

            if (isTimeout || isNetworkError) {
                throw new Error(
                    "Could not connect to Gemini or the request timed out. Please try again."
                );
            }

            throw new Error(
                "An unexpected error occurred while contacting Gemini."
            );
        }

        let data;

        try {
            const responseText = await response.text();

            data = responseText
                ? JSON.parse(responseText)
                : {};

        } catch {
            throw new Error(
                "Gemini returned an invalid response."
            );
        }

        if (!response.ok) {
            const message =
                data?.error?.message ||
                "Gemini request failed.";

            if (
                RETRYABLE_STATUS_CODES.has(response.status) &&
                attempt < MAX_RETRIES
            ) {
                await wait(
                    getRetryDelay(response, attempt)
                );

                continue;
            }

            // Do not include the API key in errors.
            const safeMessage = String(message)
                .split(API_KEY)
                .join("[REDACTED]")
                .slice(0, 500);

            throw new Error(
                `Gemini API error (${response.status}): ${safeMessage}`
            );
        }

        return data;
    }

    throw lastError || new Error(
        "Gemini request failed after multiple attempts."
    );
}


/* ==========================================
   EXTRACT GEMINI RESPONSE
========================================== */

function extractGeminiText(data) {
    const candidate = data?.candidates?.[0];

    if (!candidate) {
        throw new Error(
            "Gemini did not return a response candidate."
        );
    }

    const finishReason = candidate.finishReason;

    if (finishReason === "SAFETY") {
        throw new Error(
            "Gemini could not answer because the request was blocked by its safety filters."
        );
    }

    if (finishReason === "MAX_TOKENS") {
        throw new Error(
            "Gemini reached its response limit before completing the answer. Try a shorter request."
        );
    }

    if (
        finishReason &&
        !["STOP", "UNSPECIFIED"].includes(finishReason)
    ) {
        throw new Error(
            `Gemini could not complete the response. Reason: ${finishReason}`
        );
    }

    const text = candidate.content?.parts
        ?.map((part) => {
            return typeof part?.text === "string"
                ? part.text
                : "";
        })
        .join("")
        .trim();

    if (!text) {
        throw new Error(
            "Gemini returned no text. Try a different prompt or a supported file."
        );
    }

    return {
        text,
        finishReason: finishReason || "UNKNOWN"
    };
}


/* ==========================================
   ASK GEMINI
========================================== */

export async function askGemini({
    prompt,
    attachments = [],
    systemInstruction = "",
    temperature = 0.7,
    responseMimeType,
    responseSchema,
    maxOutputTokens = 4096
}) {
    if (!API_KEY) {
        throw new Error(
            "GEMINI_API_KEY is not configured."
        );
    }

    if (typeof prompt !== "string") {
        throw new Error(
            "The prompt must be text."
        );
    }

    if (
        typeof temperature !== "number" ||
        !Number.isFinite(temperature) ||
        temperature < 0 ||
        temperature > 2
    ) {
        throw new Error(
            "Temperature must be a number between 0 and 2."
        );
    }

    if (
        !Number.isInteger(maxOutputTokens) ||
        maxOutputTokens < 1
    ) {
        throw new Error(
            "maxOutputTokens must be a positive integer."
        );
    }

    if (
        responseMimeType !== undefined &&
        typeof responseMimeType !== "string"
    ) {
        throw new Error(
            "responseMimeType must be text."
        );
    }

    if (
        responseSchema !== undefined &&
        (
            !responseSchema ||
            typeof responseSchema !== "object" ||
            Array.isArray(responseSchema)
        )
    ) {
        throw new Error(
            "responseSchema must be a valid object."
        );
    }

    const cleanPrompt = prompt.trim();

    const preparedAttachments =
        prepareAttachments(attachments);

    if (
        !cleanPrompt &&
        preparedAttachments.length === 0
    ) {
        throw new Error(
            "Enter a message or attach a file before sending."
        );
    }

    const requestBody = buildRequestBody({
        prompt: cleanPrompt,
        attachments: preparedAttachments,
        systemInstruction,
        temperature,
        responseMimeType,
        responseSchema,
        maxOutputTokens
    });

    const data = await sendGeminiRequest(requestBody);

    const extracted = extractGeminiText(data);

    return {
        text: extracted.text,
        raw: data,
        finishReason: extracted.finishReason
    };
}