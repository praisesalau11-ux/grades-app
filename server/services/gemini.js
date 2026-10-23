
/* ==========================================
   GRADEFLOW
   File: server/services/gemini.js

   Gemini AI Service
   Supports text, images, PDFs, audio and video
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
        throw new Error("You can attach up to 3 files per message.");
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
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
        ) {
            throw new Error("An attachment contains invalid Base64 data.");
        }

        const bytes = Buffer.from(data, "base64");

        if (bytes.length === 0) {
            throw new Error("An attachment is empty.");
        }

        if (bytes.length > MAX_FILE_BYTES) {
            throw new Error("Each attachment must be 5 MB or smaller.");
        }

        totalBytes += bytes.length;

        if (totalBytes > MAX_TOTAL_FILE_BYTES) {
            throw new Error("The total attachment size cannot exceed 15 MB.");
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
   ASK GEMINI
========================================== */

export async function askGemini({
    prompt,
    attachments = [],
    systemInstruction = "",
    temperature = 0.7
}) {
    if (!API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured.");
    }

    if (typeof prompt !== "string") {
        throw new Error("The prompt must be text.");
    }

    const cleanPrompt = prompt.trim();
    const preparedAttachments = prepareAttachments(attachments);

    if (!cleanPrompt && preparedAttachments.length === 0) {
        throw new Error(
            "Enter a message or attach a file before sending."
        );
    }

    const parts = [];

    if (cleanPrompt) {
        parts.push({
            text: cleanPrompt
        });
    }

    // Attach files to the same user message as the prompt.
    parts.push(...preparedAttachments);

    const requestBody = {
        contents: [
            {
                role: "user",
                parts
            }
        ],

        generationConfig: {
            temperature,
            maxOutputTokens: 4096
        }
    };

    // Send instructions through Gemini's dedicated field.
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

    let response;

    try {
        response = await fetch(
            `${ENDPOINT}?key=${encodeURIComponent(API_KEY)}`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify(requestBody)
            }
        );
    } catch {
        throw new Error(
            "Could not connect to Gemini. Check the backend's internet connection."
        );
    }

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error("Gemini returned an invalid response.");
    }

    if (!response.ok) {
        const message =
            data?.error?.message ||
            "Gemini request failed.";

        // Avoid exposing credentials or request details.
        throw new Error(
            `Gemini API error (${response.status}): ${message}`
        );
    }

    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts
        ?.map((part) => part?.text || "")
        .join("")
        .trim();

    if (!text) {
        if (candidate?.finishReason === "SAFETY") {
            throw new Error(
                "Gemini could not answer because the request was blocked by its safety filters."
            );
        }

        throw new Error(
            "Gemini returned no text. Try a different prompt or a supported file."
        );
    }

    return {
        text,
        raw: data
    };
}
