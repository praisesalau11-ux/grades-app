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
    process.env.FRONTEND_URL || "";


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

/*
   FRONTEND_URL can contain multiple origins:

   FRONTEND_URL=https://grades-flow.netlify.app,http://127.0.0.1:5500,http://localhost:5500

   This allows:
   - Production Netlify site
   - Local Live Server using 127.0.0.1
   - Local Live Server using localhost
*/

const configuredOrigins = FRONTEND_URL
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);


/*
   Always allow these development origins.
   This fixes local testing from Live Server.
*/

const developmentOrigins = [
    "http://127.0.0.1:5500",
    "http://localhost:5500"
];


/*
   Combine configured + development origins
   and remove duplicates.
*/

const allowedOrigins = [
    ...new Set([
        ...configuredOrigins,
        ...developmentOrigins
    ])
];


console.log(
    "GradeFlow CORS allowed origins:",
    allowedOrigins
);


app.use(
    cors({
        origin(origin, callback) {

            /*
               Requests without an Origin header are allowed.

               Examples:
               - Render health checks
               - Server-to-server requests
               - Some development tools
            */

            if (!origin) {
                return callback(null, true);
            }


            /*
               Check whether the browser's origin
               is in our allowed list.
            */

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }


            /*
               Reject unknown origins.
            */

            console.warn(
                "GradeFlow CORS blocked origin:",
                origin
            );

            return callback(
                new Error("CORS origin not allowed.")
            );
        },


        /*
           HTTP methods used by GradeFlow.
        */

        methods: [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS"
        ],


        /*
           Headers accepted by the backend.
        */

        allowedHeaders: [
            "Content-Type",
            "Authorization"
        ],


        /*
           Explicitly handle browser
           preflight requests.
        */

        optionsSuccessStatus: 204
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


    /*
       CORS error
    */

    if (
        error?.message ===
        "CORS origin not allowed."
    ) {

        return res.status(403).json({
            success: false,
            message: "Origin not allowed."
        });

    }


    /*
       General server error
    */

    res.status(500).json({
        success: false,
        message:
            "An unexpected server error occurred."
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
            `GradeFlow frontend: ${FRONTEND_URL || "Not configured"}`
        );

    }
);