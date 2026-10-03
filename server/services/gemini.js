/* ==========================================
   GRADEFLOW
   File: server/services/gemini.js

   Gemini AI Service
========================================== */

const API_KEY = process.env.GEMINI_API_KEY;

const MODEL =
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash";

const ENDPOINT =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;


/* ==========================================
   ASK GEMINI
========================================== */

export async function askGemini({
    prompt,
    systemInstruction = "",
    temperature = 0.7
}) {
    if (!API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured.");
    }

    if (!prompt || typeof prompt !== "string") {
        throw new Error("A prompt is required.");
    }

    const contents = [];

    if (systemInstruction) {
        contents.push({
            role: "user",
            parts: [
                {
                    text:
                        `System instructions:\n${systemInstruction}\n\n` +
                        `Now follow those instructions for the user's request.`
                }
            ]
        });
    }

    contents.push({
        role: "user",
        parts: [
            {
                text: prompt
            }
        ]
    });

    const response = await fetch(
        `${ENDPOINT}?key=${encodeURIComponent(API_KEY)}`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                contents,

                generationConfig: {
                    temperature,
                    maxOutputTokens: 4096
                }
            })
        }
    );

    let data = null;

    try {
        data = await response.json();
    } catch {
        throw new Error(
            "Gemini returned an invalid response."
        );
    }

    if (!response.ok) {
        const message =
            data?.error?.message ||
            "Gemini request failed.";

        throw new Error(message);
    }

    const text =
        data?.candidates?.[0]?.content?.parts
            ?.map(part => part?.text || "")
            .join("")
            .trim();

    if (!text) {
        throw new Error(
            "Gemini returned an empty response."
        );
    }

    return {
        text,
        raw: data
    };
}