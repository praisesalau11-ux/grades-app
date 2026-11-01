import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import {
    adminDb
} from "./services/firebaseAdmin.js";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import trustRoutes from "./routes/trustRoutes.js";

/* ==========================================
   TrustNet Backend
   File: server/server.js

   Main API Server
========================================== */


/* ==========================================
   LOAD ENVIRONMENT VARIABLES
========================================== */

dotenv.config();


/* ==========================================
   CREATE EXPRESS APPLICATION
========================================== */

const app =
    express();


/* ==========================================
   SERVER CONFIGURATION
========================================== */

const PORT =
    process.env.PORT || 5000;


/* ==========================================
   CORS
========================================== */

app.use(
    cors({
        origin: true,
        credentials: true
    })
);


/* ==========================================
   JSON BODY PARSER
========================================== */

app.use(
    express.json({
        limit: "10mb"
    })
);


/* ==========================================
   URL-ENCODED BODY PARSER
========================================== */

app.use(
    express.urlencoded({
        extended: true,
        limit: "10mb"
    })
);


/* ==========================================
   REQUEST LOGGER
========================================== */

app.use((req, res, next) => {

    const timestamp =
        new Date().toISOString();

    console.log(
        `[${timestamp}] ${req.method} ${req.originalUrl}`
    );

    next();

});


/* ==========================================
   ROOT ROUTE
========================================== */

app.get("/", (req, res) => {

    res.status(200).json({

        success: true,

        name:
            "TrustNet API",

        message:
            "TrustNet backend is running.",

        version:
            "1.0.0",

        status:
            "online"

    });

});


/* ==========================================
   API INFORMATION
========================================== */

app.get("/api", (req, res) => {

    res.status(200).json({

        success: true,

        name:
            "TrustNet API",

        version:
            "1.0.0",

        endpoints: {

            health:
                "/api/health",

            firebase:
                "/api/health/firebase",

            auth:
                "/api/auth",

            users:
                "/api/users",

            trust:
                "/api/trust",

            ai:
                "/api/ai"

        }

    });

});


/* ==========================================
   GENERAL HEALTH CHECK
========================================== */

app.get("/api/health", (req, res) => {

    res.status(200).json({

        success: true,

        service:
            "TrustNet Backend",

        status:
            "healthy",

        timestamp:
            new Date().toISOString()

    });

});


/* ==========================================
   FIREBASE CONNECTION TEST
========================================== */

app.get(
    "/api/health/firebase",
    async (req, res) => {

        try {

            const testDocument =
                await adminDb
                    .collection("_system")
                    .doc("health")
                    .get();


            res.status(200).json({

                success: true,

                service:
                    "Firebase Admin",

                status:
                    "connected",

                firestore:
                    testDocument.exists
                        ? "reachable"
                        : "reachable",

                timestamp:
                    new Date().toISOString()

            });

        } catch (error) {

            console.error(
                "Firebase connection error:",
                error
            );


            res.status(500).json({

                success: false,

                service:
                    "Firebase Admin",

                status:
                    "error",

                error:
                    error.message

            });

        }

    }
);


/* ==========================================
   AUTHENTICATION ROUTES
========================================== */

app.use(
    "/api/auth",
    authRoutes
);


/* ==========================================
   USER ROUTES
========================================== */

app.use(
    "/api/users",
    userRoutes
);

/* ==========================================
   TRUST ROUTES
========================================== */


app.use(
    "/api/trust",
    trustRoutes
);

/* ==========================================
   FUTURE ROUTES
========================================== */

/*
User routes
Trust routes
AI routes
Marketplace routes
Business routes
People routes
Product routes
Service routes
Job routes
Opportunity routes
Information routes
Message routes
Community routes
Social routes
Decision routes
AI Agent routes
Profile routes
Settings routes

will be connected here after
their individual files are created.
*/


/* ==========================================
   404 ROUTE
========================================== */

app.use((req, res) => {

    res.status(404).json({

        success: false,

        error:
            "Route not found.",

        path:
            req.originalUrl

    });

});


/* ==========================================
   GLOBAL ERROR HANDLER
========================================== */

app.use(
    (err, req, res, next) => {

        console.error(
            "TrustNet Server Error:",
            err
        );


        const statusCode =
            err.statusCode || 500;


        res.status(statusCode).json({

            success: false,

            error:
                process.env.NODE_ENV === "production"
                    ? "Internal server error."
                    : err.message

        });

    }
);


/* ==========================================
   START SERVER
========================================== */

app.listen(
    PORT,
    () => {

        console.log("");

        console.log(
            "=========================================="
        );

        console.log(
            "           TRUSTNET BACKEND"
        );

        console.log(
            "=========================================="
        );

        console.log("");

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            `Local: http://localhost:${PORT}`
        );

        console.log("");

        console.log(
            "API:"
        );

        console.log(
            `http://localhost:${PORT}/api`
        );

        console.log("");

        console.log(
            "Health:"
        );

        console.log(
            `http://localhost:${PORT}/api/health`
        );

        console.log("");

        console.log(
            "Firebase:"
        );

        console.log(
            `http://localhost:${PORT}/api/health/firebase`
        );

        console.log("");

        console.log(
            "Authentication:"
        );

        console.log(
            `http://localhost:${PORT}/api/auth`
        );

        console.log("");

        console.log(
            "=========================================="
        );

        console.log("");

    }
);