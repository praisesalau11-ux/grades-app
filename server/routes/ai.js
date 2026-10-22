import { Router } from "express";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { askGemini } from "../services/gemini.js";

const router = Router();

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || "grades-calculator-72499";

function normalizeOrigin(value) {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Only allow your actual frontend origins.
const ALLOWED_ORIGINS = new Set(
  [
    "https://praisesalau11-ux.github.io",
    normalizeOrigin(process.env.FRONTEND_ORIGIN)
  ].filter(Boolean)
);

const firebaseKeys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

// Basic per-user rate limit: 15 requests per minute.
const rateLimits = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 15;

function allowRequest(uid) {
  const now = Date.now();
  const item = rateLimits.get(uid);

  if (!item || now - item.start >= WINDOW_MS) {
    rateLimits.set(uid, { start: now, count: 1 });
    return true;
  }

  if (item.count >= MAX_REQUESTS) return false;

  item.count += 1;
  return true;
}

function cleanText(value, max = 4000) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

function cleanHistory(value) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-12)
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.text === "string"
    )
    .map((item) => ({
      role: item.role,
      text: cleanText(item.text, 2500)
    }))
    .filter((item) => item.text.length > 0);
}

function cleanAcademicContext(value) {
  if (!value || typeof value !== "object") {
    return { history: [], goals: [] };
  }

  const history = Array.isArray(value.history)
    ? value.history.slice(0, 8).map((item) => ({
        gpa: item?.gpa ?? null,
        gpaScale: item?.gpaScale ?? null,
        percentage: item?.percentage ?? null,
        subjects: Array.isArray(item?.subjects)
          ? item.subjects.slice(0, 20)
          : [],
        time: item?.time ?? null,
        date: item?.date ?? null
      }))
    : [];

  const goals = Array.isArray(value.goals)
    ? value.goals.slice(0, 8).map((item) => ({
        title: cleanText(item?.title, 150),
        description: cleanText(item?.description, 500),
        target: item?.target ?? null,
        progress: item?.progress ?? null,
        status: cleanText(item?.status, 60)
      }))
    : [];

  return { history, goals };
}

// CORS and origin validation.
router.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    console.warn("GradeFlow AI blocked origin:", origin);

    return res.status(403).json({
      error: "This website is not allowed to use GradeFlow AI."
    });
  }

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

router.post("/chat", async (req, res) => {
  try {
    // Require a Firebase ID token.
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({
        error: "Please sign in to use GradeFlow AI."
      });
    }

    let claims;

    try {
      const result = await jwtVerify(match[1], firebaseKeys, {
        issuer: `https://securetoken.google.com/${PROJECT_ID}`,
        audience: PROJECT_ID,
        algorithms: ["RS256"]
      });

      claims = result.payload;
    } catch (error) {
      console.warn("Firebase token verification failed:", error.message);

      return res.status(401).json({
        error: "Your sign-in token is invalid or expired. Sign in again."
      });
    }

    if (
      typeof claims.sub !== "string" ||
      claims.sub.length === 0 ||
      claims.sub.length > 128
    ) {
      return res.status(401).json({
        error: "The sign-in token does not contain a valid user."
      });
    }

    // Limit requests per authenticated user.
    if (!allowRequest(claims.sub)) {
      return res.status(429).json({
        error: "Too many requests. Please wait a minute and try again."
      });
    }

    const message = cleanText(req.body?.message);

    if (!message) {
      return res.status(400).json({
        error: "Enter a message first."
      });
    }

    if (
      typeof req.body?.message === "string" &&
      req.body.message.length > 4000
    ) {
      return res.status(413).json({
        error: "Messages must be 4,000 characters or fewer."
      });
    }

    const history = cleanHistory(req.body?.history);
    const academicContext = cleanAcademicContext(
      req.body?.academicContext
    );

    const transcript = history
      .map(
        (item) =>
          `${item.role === "assistant" ? "Assistant" : "Student"}: ${item.text}`
      )
      .join("\n\n");

    const prompt = [
      "Recent conversation:",
      transcript || "(No earlier messages.)",
      "",
      "Student's current message:",
      message,
      "",
      "Academic context supplied by the GradeFlow client:",
      JSON.stringify(academicContext),
      "",
      "Answer the current question. Do not invent missing grades or claim that you changed database records."
    ].join("\n");

    const result = await askGemini({
      prompt,
      systemInstruction: [
        "You are GradeFlow AI, a clear and patient educational assistant.",
        "Help students learn school subjects, prepare for exams, practise with quizzes, plan revision, and understand academic progress.",
        "Explain difficult ideas step by step and use examples.",
        "Treat academic context as information supplied by the client, not independently verified database truth.",
        "Never invent GPA values, grades, goals, or actions.",
        "Do not claim to update or delete records.",
        "Give practical, age-appropriate educational advice."
      ].join(" "),
      temperature: 0.7
    });

    return res.json({ reply: result.text });
  } catch (error) {
    console.error("GradeFlow AI error:", error.message);

    if (error.message?.includes("GEMINI_API_KEY")) {
      return res.status(503).json({
        error: "Gemini is not configured on the backend."
      });
    }

    return res.status(500).json({
      error: "GradeFlow AI could not answer right now. Please try again."
    });
  }
});

export default router;