/* ==========================================
   GRADEFLOW
   File: server/routes/auth.js

   Firebase REST + Resend Authentication Routes

   NO Firebase service account required.
========================================== */

import express from "express";

import {
    sendEmail
} from "../services/resend.js";

const router = express.Router();

const FIREBASE_API_KEY =
    process.env.FIREBASE_API_KEY;

const FRONTEND_URL =
    process.env.FRONTEND_URL;


/* ==========================================
   PASSWORD RESET EMAIL
========================================== */

router.post("/forgot-password", async (req, res) => {

    try {

        const email =
            String(req.body?.email || "")
                .trim()
                .toLowerCase();

        if (!isValidEmail(email)) {

            return res.status(400).json({
                success: false,
                message: "Enter a valid email address."
            });

        }


        if (!FIREBASE_API_KEY) {

            console.error(
                "FIREBASE_API_KEY is missing."
            );

            return res.status(500).json({
                success: false,
                message:
                    "Password reset service is not configured."
            });

        }


        if (!FRONTEND_URL) {

            console.error(
                "FRONTEND_URL is missing."
            );

            return res.status(500).json({
                success: false,
                message:
                    "Password reset service is not configured."
            });

        }


        /*
         * Ask Firebase Authentication to generate
         * the official password reset code.
         */

        const firebaseResponse = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    requestType: "PASSWORD_RESET",
                    email
                })
            }
        );


        let firebaseData = null;

        try {
            firebaseData =
                await firebaseResponse.json();
        } catch {
            firebaseData = null;
        }


        /*
         * Never reveal whether the email exists.
         */

        if (!firebaseResponse.ok) {

            console.error(
                "Firebase password reset error:",
                firebaseData
            );

            return res.json({
                success: true,
                message:
                    "If a GradeFlow account exists for that email, a password reset email has been sent."
            });

        }


        const oobCode =
            firebaseData?.oobCode;


        if (!oobCode) {

            console.error(
                "Firebase did not return an oobCode."
            );

            return res.status(500).json({
                success: false,
                message:
                    "Password reset could not be prepared."
            });

        }


        /*
         * Send the Firebase reset code through
         * our own GradeFlow email.
         */

        const resetUrl =
            `${FRONTEND_URL}/reset-password.html?oobCode=${encodeURIComponent(oobCode)}`;


        await sendPasswordResetEmail({
            to: email,
            resetUrl
        });


        return res.json({
            success: true,
            message:
                "If a GradeFlow account exists for that email, a password reset email has been sent."
        });


    } catch (error) {

        console.error(
            "Forgot-password error:",
            error
        );


        return res.status(500).json({
            success: false,
            message:
                "Password reset could not be completed. Please try again."
        });

    }

});


/* ==========================================
   EMAIL TEST
========================================== */

router.post("/test-email", async (req, res) => {

    try {

        const email =
            String(req.body?.email || "")
                .trim()
                .toLowerCase();


        if (!isValidEmail(email)) {

            return res.status(400).json({
                success: false,
                message: "Enter a valid email address."
            });

        }


        await sendEmail({
            to: email,

            subject:
                "GradeFlow email test",

            html: `
                <div style="
                    font-family:Arial,sans-serif;
                    padding:30px;
                ">
                    <h1>GradeFlow</h1>

                    <p>
                        Your GradeFlow Resend email
                        service is working.
                    </p>
                </div>
            `,

            text:
                "Your GradeFlow Resend email service is working."
        });


        return res.json({
            success: true,
            message: "Test email sent."
        });


    } catch (error) {

        console.error(
            "Test email error:",
            error
        );


        return res.status(500).json({
            success: false,
            message:
                "Test email could not be sent."
        });

    }

});


/* ==========================================
   HELPERS
========================================== */

function isValidEmail(email) {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email);

}


/* ==========================================
   PASSWORD RESET EMAIL TEMPLATE
========================================== */

async function sendPasswordResetEmail({
    to,
    resetUrl
}) {

    const safeUrl =
        escapeHtml(resetUrl);


    const html = `
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>Reset your GradeFlow password</title>

</head>


<body style="
    margin:0;
    padding:0;
    background:#080808;
    font-family:Arial,Helvetica,sans-serif;
">

<div style="
    max-width:600px;
    margin:0 auto;
    padding:40px 20px;
">

    <div style="
        background:#111111;
        border:1px solid #292929;
        border-radius:20px;
        padding:35px;
        color:#ffffff;
    ">

        <div style="
            font-size:28px;
            font-weight:700;
            margin-bottom:8px;
        ">
            GradeFlow
        </div>


        <div style="
            color:#999999;
            font-size:14px;
            margin-bottom:30px;
        ">
            Your academic progress, organized.
        </div>


        <h1 style="
            font-size:25px;
            margin:0 0 15px;
        ">
            Reset your password
        </h1>


        <p style="
            color:#cccccc;
            line-height:1.6;
            font-size:15px;
        ">
            We received a request to reset the
            password for your GradeFlow account.
        </p>


        <p style="
            color:#cccccc;
            line-height:1.6;
            font-size:15px;
        ">
            Click the button below to create a
            new password.
        </p>


        <div style="
            margin:30px 0;
        ">

            <a
                href="${safeUrl}"
                style="
                    display:inline-block;
                    background:#ffffff;
                    color:#000000;
                    text-decoration:none;
                    font-weight:700;
                    padding:14px 24px;
                    border-radius:12px;
                "
            >
                Reset Password
            </a>

        </div>


        <p style="
            color:#888888;
            font-size:13px;
            line-height:1.6;
        ">
            If you did not request this password reset,
            you can safely ignore this email.
        </p>


        <div style="
            margin-top:30px;
            padding-top:20px;
            border-top:1px solid #292929;
            color:#666666;
            font-size:12px;
        ">
            GradeFlow
        </div>

    </div>

</div>

</body>

</html>
`;


    const text = `
GradeFlow

Reset your password

We received a request to reset your GradeFlow password.

Open this link:

${resetUrl}

If you did not request this password reset,
you can safely ignore this email.
`;


    return sendEmail({
        to,
        subject:
            "Reset your GradeFlow password",
        html,
        text
    });

}


/* ==========================================
   HTML ESCAPE
========================================== */

function escapeHtml(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


export default router;