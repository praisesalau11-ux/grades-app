/* ==========================================
   GRADEFLOW
   File: server/routes/auth.js

   Authentication-related backend routes
========================================== */

import express from "express";
import {
    sendEmail,
    sendWelcomeEmail
} from "../services/resend.js";

const router = express.Router();


/* ==========================================
   HEALTH TEST
========================================== */

router.get("/status", (req, res) => {
    return res.json({
        success: true,
        service: "GradeFlow Auth",
        resendConfigured:
            Boolean(process.env.RESEND_API_KEY),
        firebaseConfigured:
            Boolean(process.env.FIREBASE_API_KEY)
    });
});


/* ==========================================
   TEST EMAIL
========================================== */

router.post("/test-email", async (req, res) => {
    try {

        const {
            email
        } = req.body || {};

        if (
            !email ||
            typeof email !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Email is required."
            });
        }

        await sendWelcomeEmail({
            to: email,
            name: "GradeFlow user"
        });

        return res.json({
            success: true,
            message: "Test email sent successfully."
        });

    } catch (error) {

        console.error(
            "Test email error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "The test email could not be sent."
        });
    }
});


/* ==========================================
   GENERIC EMAIL
========================================== */

router.post("/send-email", async (req, res) => {
    try {

        const {
            to,
            subject,
            html,
            text
        } = req.body || {};

        if (!to || !subject || !html) {
            return res.status(400).json({
                success: false,
                message:
                    "Recipient, subject and HTML are required."
            });
        }

        await sendEmail({
            to,
            subject,
            html,
            text
        });

        return res.json({
            success: true,
            message: "Email sent successfully."
        });

    } catch (error) {

        console.error(
            "Email error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Email could not be sent."
        });
    }
});


export default router;