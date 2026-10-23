import { Router } from "express";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { askGemini } from "../services/gemini.js";

const router = Router();

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || "grades-calculator-72499";

const MAX_MESSAGE_LENGTH = 4000;
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

function normalizeOrigin(value) {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const ALLOWED_ORIGINS = new Set(
  [
    "https://praisesalau11-ux.github.io",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    normalizeOrigin(process.env.FRONTEND_ORIGIN)
  ].filter(Boolean)
);

const firebaseKeys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

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

function cleanAttachments(value) {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    throw new Error("Attachments must be supplied as a list.");
  }

  if (value.length > MAX_FILES) {
    throw new Error(`You can attach up to ${MAX_FILES} files per message.`);
  }

  let totalBytes = 0;

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("An attachment is invalid.");
    }

    const name =
      typeof item.name === "string"
        ? item.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180)
        : "attachment";

    const mimeType =
      typeof item.mimeType === "string"
        ? item.mimeType.toLowerCase().trim()
        : "";

    const data = typeof item.data === "string" ? item.data : "";

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error(`Unsupported file type for "${name}".`);
    }

    if (!data || data.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8) {
      throw new Error(`"${name}" is empty or exceeds the 5 MB file limit.`);
    }

    // Reject malformed Base64 instead of silently accepting bad data.
    if (
      data.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
    ) {
      throw new Error(`The uploaded data for "${name}" is invalid.`);
    }

    const bytes = Buffer.from(data, "base64");

    if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
      throw new Error(`"${name}" must be no larger than 5 MB.`);
    }

    totalBytes += bytes.length;

    if (totalBytes > MAX_TOTAL_FILE_BYTES) {
      throw new Error("All attachments combined must be 15 MB or less.");
    }

    return {
      name,
      mimeType,
      data
    };
  });
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
    // Require a valid Firebase ID token.
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

    if (!allowRequest(claims.sub)) {
      return res.status(429).json({
        error: "Too many requests. Please wait a minute and try again."
      });
    }

    const rawMessage = req.body?.message;

    if (
      typeof rawMessage === "string" &&
      rawMessage.length > MAX_MESSAGE_LENGTH
    ) {
      return res.status(413).json({
        error: "Messages must be 4,000 characters or fewer."
      });
    }

    const message = cleanText(rawMessage);
    let attachments;

    try {
      attachments = cleanAttachments(req.body?.attachments);
    } catch (error) {
      return res.status(400).json({
        error: error.message || "One or more attachments are invalid."
      });
    }

    if (!message && attachments.length === 0) {
      return res.status(400).json({
        error: "Enter a message or attach a file first."
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
      message || "Please inspect the attached file or files and explain their relevant contents.",
      "",
      "Academic context supplied by the GradeFlow client:",
      JSON.stringify(academicContext),
      "",
      "Answer the current question using the attachments when relevant.",
      "If a file cannot be interpreted, explain the limitation instead of guessing.",
      "Do not invent missing grades or claim to have changed database records."
    ].join("\n");

    const result = await askGemini({
      prompt,
      attachments: attachments.map(({ mimeType, data }) => ({
        mimeType,
        data
      })),
      systemInstruction: [
        "You are GradeFlow AI, a clear and patient educational assistant.",
        "Help students learn school subjects, prepare for exams, practise with quizzes, plan revision, and understand academic progress.",
        "Explain difficult ideas step by step and use examples.",
        "When files are attached, inspect their contents when supported and relevant to the student's request.",
        "Treat academic context as information supplied by the client, not independently verified database truth.",
        "Never invent GPA values, grades, goals, or actions.",
        "Do not claim to update or delete records.",
        "Give practical, age-appropriate educational advice."
      ].join(" "),
      temperature: 0.7
    });

    return res.json({ reply: result.text });
  } catch (error) {
    console.error("GradeFlow AI error:", error);

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