import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.js";
import aiRoutes from "./routes/ai.js";
import studyStudioRoutes from "./routes/study-studio.js";


/* ==========================================
   APPLICATION
========================================== */

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

const PORT = Number(process.env.PORT) || 10000;

const FRONTEND_URL = process.env.FRONTEND_URL || "";


/* ==========================================
   CORS
========================================== */

const productionOrigins = [
  "https://grades-flow.netlify.app"
];

const developmentOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:5501",
  "http://localhost:5501"
];

const configuredOrigins = FRONTEND_URL
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const allowedOrigins = [
  ...new Set([
    ...productionOrigins,
    ...developmentOrigins,
    ...configuredOrigins
  ])
];

console.log("GradeFlow allowed origins:", allowedOrigins);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn("Blocked CORS origin:", origin);

    return callback(new Error("CORS origin not allowed."));
  },

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS"
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization"
  ],

  optionsSuccessStatus: 204
};


/* ==========================================
   SECURITY
========================================== */

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(cors(corsOptions));

app.use(
  express.json({
    limit: "24mb"
  })
);


/* ==========================================
   GLOBAL RATE LIMIT
========================================== */

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    message: "Too many requests. Please try again later."
  }
});

app.use(globalLimiter);


/* ==========================================
   AI RATE LIMIT
========================================== */

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    message: "Too many AI requests. Please wait."
  }
});


/* ==========================================
   HEALTH CHECKS
========================================== */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "GradeFlow API is running."
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "GradeFlow API",
    status: "healthy"
  });
});


/* ==========================================
   AUTHENTICATION ROUTES
========================================== */

app.use("/api/auth", authRoutes);


/* ==========================================
   EXISTING AI ROUTES
========================================== */

app.use("/api/ai", aiLimiter, aiRoutes);


/* ==========================================
   STUDY STUDIO ROUTES
========================================== */

app.use(
  "/api/study-studio",
  aiLimiter,
  studyStudioRoutes
);


/* ==========================================
   404 HANDLER
========================================== */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found."
  });
});


/* ==========================================
   ERROR HANDLER
========================================== */

app.use((error, req, res, next) => {
  console.error("GradeFlow server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(error.status || 500).json({
    success: false,
    message: error.message || "Internal server error."
  });
});


/* ==========================================
   START SERVER
========================================== */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`GradeFlow server running on port ${PORT}`);
});