/* ==========================================
   GRADEFLOW
   File: server/server.js

   Main Express Server
========================================== */

import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.js";
import aiRoutes from "./routes/ai.js";


/* ==========================================
   APP
========================================== */

const app = express();


/* ==========================================
   CONFIG
========================================== */

const PORT =
    Number(process.env.PORT) || 10000;

const FRONTEND_URL =
    process.env.FRONTEND_URL;


/* ==========================================
   SECURITY
========================================== */

app.disable("x-powered-by");

app.use(
    helmet({
        crossOriginResourcePolicy: false
    })
);


/* ==========================================
   CORS
========================================== */

const allowedOrigins = FRONTEND_URL
    ? FRONTEND_URL
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean)
    : [];

app.use(
    cors({
        origin(origin, callback) {

            // Allow requests with no Origin header.
            // Useful for health checks/server tools.
            if (!origin) {
                return callback(null, true);
            }

            if (
                allowedOrigins.length === 0 ||
                allowedOrigins.includes(origin)
            ) {
                return callback(null, true);
            }

            return callback(
                new Error("CORS origin not allowed.")
            );
        },

        methods: [
            "GET",
            "POST",
            "OPTIONS"
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization"
        ]
    })
);


/* ==========================================
   BODY
========================================== */

app.use(
    express.json({
        limit: "50kb"
    })
);


/* ==========================================
   GLOBAL RATE LIMIT
========================================== */

const globalLimiter =
    rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 100,
        standardHeaders: "draft-7",
        legacyHeaders: false,

        message: {
            success: false,
            message:
                "Too many requests. Please try again later."
        }
    });

app.use(globalLimiter);


/* ==========================================
   AI RATE LIMIT
========================================== */

const aiLimiter =
    rateLimit({
        windowMs: 60 * 1000,
        limit: 20,
        standardHeaders: "draft-7",
        legacyHeaders: false,

        message: {
            success: false,
            message:
                "Too many AI requests. Please wait."
        }
    });


/* ==========================================
   ROOT
========================================== */

app.get("/", (req, res) => {

    res.json({
        success: true,
        service: "GradeFlow Server",
        status: "online"
    });

});


/* ==========================================
   HEALTH
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
   ROUTES
========================================== */

app.use(
    "/api/auth",
    authRoutes
);

app.use(
    "/api/ai",
    aiLimiter,
    aiRoutes
);


/* ==========================================
   404
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

    if (
        error?.message ===
        "CORS origin not allowed."
    ) {
        return res.status(403).json({
            success: false,
            message: "Origin not allowed."
        });
    }

    res.status(500).json({
        success: false,
        message:
            "An unexpected server error occurred."
    });

});


/* ==========================================
   START
========================================== */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `GradeFlow server running on port ${PORT}`
        );

    }
);