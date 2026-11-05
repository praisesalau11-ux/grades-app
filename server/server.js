
/* ==========================================
   GRADEFLOW
   File: server/server.js

   Main Express Server
   Author: Salau Praise
   Project: GradeFlow
========================================== */

import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.js";
import aiRoutes from "./routes/ai.js";
import studyStudioRoutes from "./routes/study-studio.js";

/* ==========================================
   APP
========================================== */

const app = express();

app.set("trust proxy", 1);

app.disable("x-powered-by");


/* ==========================================
   CONFIGURATION
========================================== */

const PORT = Number(process.env.PORT) || 10000;

const FRONTEND_URL = process.env.FRONTEND_URL || "";


/* ==========================================
   CORS CONFIGURATION
========================================== */

// Production website
const productionOrigins = [
    "https://grades-flow.netlify.app"
];

// Local development websites
const developmentOrigins = [
    "http://127.0.0.1:5500",
    "http://localhost:5500"
];

// Additional origins from Render environment variables
const configuredOrigins = FRONTEND_URL
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

// Combine all permitted origins
const allowedOrigins = [
    ...new Set([
        ...productionOrigins,
        ...developmentOrigins,
        ...configuredOrigins
    ])
];

console.log(
    "GradeFlow allowed origins:",
    allowedOrigins
);

const corsOptions = {
    origin(origin, callback) {

        // Allow server-to-server requests
        if (!origin) {
            return callback(null, true);
        }

        // Check permitted browser origins
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        console.warn(
            "Blocked CORS origin:",
            origin
        );

        return callback(
            new Error("CORS origin not allowed.")
        );
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
   SECURITY HEADERS
========================================== */

app.use(
    helmet({
        crossOriginResourcePolicy: false
    })
);


/* ==========================================
   APPLY CORS BEFORE API ROUTES
========================================== */

app.use(cors(corsOptions));


/* ==========================================
   BODY PARSER
========================================== */

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
   ROOT
========================================== */

app.get("/", (req, res) => {

    res.json({
        success: true,
        service: "GradeFlow Server",
        author: "Salau Praise",
        status: "online"
    });

});


/* ==========================================
   HEALTH CHECK
========================================== */

app.get("/api/health", (req, res) => {

    res.json({
        success: true,
        status: "healthy",
        service: "GradeFlow Server",
        time: new Date().toISOString()
    });

});


/* ==========================================
   AUTH ROUTES
========================================== */

app.use(
    "/api/auth",
    authRoutes
);


/* ==========================================
   AI ROUTES
========================================== */

app.use(
    "/api/ai",
    aiLimiter,
    aiRoutes
);

/* ==========================================
   STUDY STUDIO ROUTES
========================================== */

app.use(
    "/api/study-studio",
    studyStudioRoutes
);

/* ==========================================
   404 HANDLER
========================================== */

app.use((req, res) => {

    res.status(404).json({

        success: false,

        message: "Endpoint not found."

    });

});


/* ==========================================
   ERROR HANDLER
========================================== */

app.use((error, req, res, next) => {

    console.error(
        "GradeFlow server error:",
        error
    );

    // CORS error
    if (
        error?.message ===
        "CORS origin not allowed."
    ) {

        return res.status(403).json({

            success: false,

            message: "Origin not allowed."

        });

    }

    // General server error
    return res.status(500).json({

        success: false,

        message: "An unexpected server error occurred."

    });

});


/* ==========================================
   START SERVER
========================================== */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `GradeFlow server running on port ${PORT}`
        );

        console.log(
            `Frontend: ${allowedOrigins.join(", ")}`
        );

        console.log(
            "GradeFlow AI backend is ready."
        );

    }
);
