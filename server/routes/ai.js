/* ==========================================
   GRADEFLOW
   File: server/routes/ai.js

   AI Routes
========================================== */

import express from "express";
import { askGemini } from "../services/gemini.js";

const router = express.Router();


/* ==========================================
   AI CHAT
========================================== */

router.post("/chat", async (req, res) => {
    try {

        const {
            message,
            context = ""
        } = req.body || {};

        if (
            !message ||
            typeof message !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "A message is required."
            });
        }

        if (message.length > 10000) {
            return res.status(400).json({
                success: false,
                message: "Message is too long."
            });
        }

        const systemInstruction = `
You are GradeFlow AI, an academic assistant.

Your job is to help students understand academic
subjects, grades, calculations, revision and study
planning.

Rules:

1. Explain things clearly.
2. Show mathematical steps when appropriate.
3. Do not invent grades or academic records.
4. If GradeFlow data is provided, distinguish actual
   user data from your interpretation.
5. If you are uncertain, say so.
6. Do not claim to be a teacher, school or official.
7. Encourage learning rather than simply giving answers
   when the user is studying.
`;

        const prompt = `
Student request:

${message}

GradeFlow context, if available:

${context}
`;

        const result = await askGemini({
            prompt,
            systemInstruction
        });

        return res.json({
            success: true,
            response: result.text
        });

    } catch (error) {

        console.error(
            "GradeFlow AI error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "GradeFlow AI could not process your request."
        });
    }
});


/* ==========================================
   EXPLAIN GRADE
========================================== */

router.post("/explain-grade", async (req, res) => {
    try {

        const {
            subject,
            score,
            percentage,
            grade
        } = req.body || {};

        const prompt = `
Explain this student's grade in a simple educational way.

Subject: ${subject || "Unknown"}
Score: ${score ?? "Unknown"}
Percentage: ${percentage ?? "Unknown"}
Grade: ${grade || "Unknown"}

Explain:
- what the result means
- what was done well
- what the student could improve
- one practical study suggestion

Do not invent information that was not provided.
`;

        const result = await askGemini({
            prompt,
            systemInstruction:
                "You are GradeFlow's grade-analysis assistant.",
            temperature: 0.5
        });

        return res.json({
            success: true,
            response: result.text
        });

    } catch (error) {

        console.error(
            "Grade explanation error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Grade explanation could not be generated."
        });
    }
});


export default router;