/* ==========================================
   GRADEFLOW
   File: server/services/resend.js

   Resend Email Service
========================================== */

import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM;

if (!apiKey) {
    console.warn("RESEND_API_KEY is not configured.");
}

if (!from) {
    console.warn("RESEND_FROM is not configured.");
}

const resend = apiKey ? new Resend(apiKey) : null;


/* ==========================================
   BASIC EMAIL
========================================== */

export async function sendEmail({
    to,
    subject,
    html,
    text = ""
}) {
    if (!resend) {
        throw new Error("Resend is not configured.");
    }

    if (!from) {
        throw new Error("RESEND_FROM is not configured.");
    }

    if (!to) {
        throw new Error("Recipient email is required.");
    }

    const result = await resend.emails.send({
        from,
        to,
        subject,
        html,
        text
    });

    if (result.error) {
        throw new Error(
            result.error.message ||
            "Resend could not send the email."
        );
    }

    return result;
}


/* ==========================================
   PASSWORD RESET EMAIL
========================================== */

export async function sendPasswordResetEmail({
    to,
    resetUrl
}) {
    const subject = "Reset your GradeFlow password";

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

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
        background:#111;
        border:1px solid #292929;
        border-radius:20px;
        padding:35px;
        color:#ffffff;
    ">

        <div style="
            font-size:28px;
            font-weight:700;
            margin-bottom:10px;
        ">
            GradeFlow
        </div>

        <div style="
            color:#b9b9b9;
            font-size:14px;
            margin-bottom:30px;
        ">
            Your academic progress, organized.
        </div>

        <h1 style="
            font-size:24px;
            margin-bottom:15px;
        ">
            Reset your password
        </h1>

        <p style="
            color:#cfcfcf;
            line-height:1.6;
            font-size:15px;
        ">
            We received a request to reset your GradeFlow password.
        </p>

        <p style="
            color:#cfcfcf;
            line-height:1.6;
            font-size:15px;
        ">
            Click the button below to continue.
        </p>

        <div style="margin:30px 0;">

            <a
                href="${escapeHtml(resetUrl)}"
                style="
                    display:inline-block;
                    padding:14px 22px;
                    border-radius:12px;
                    background:#ffffff;
                    color:#000000;
                    text-decoration:none;
                    font-weight:700;
                "
            >
                Reset Password
            </a>

        </div>

        <p style="
            color:#888;
            font-size:13px;
            line-height:1.6;
        ">
            If you did not request a password reset, you can safely
            ignore this email.
        </p>

        <div style="
            margin-top:30px;
            padding-top:20px;
            border-top:1px solid #292929;
            color:#666;
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

Open this link to reset your password:

${resetUrl}

If you did not request this, you can safely ignore this email.
`;

    return sendEmail({
        to,
        subject,
        html,
        text
    });
}


/* ==========================================
   WELCOME EMAIL
========================================== */

export async function sendWelcomeEmail({
    to,
    name = "there"
}) {
    const subject = "Welcome to GradeFlow";

    const safeName = escapeHtml(name);

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport"
      content="width=device-width, initial-scale=1.0">
<title>Welcome to GradeFlow</title>
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
        background:#111;
        border:1px solid #292929;
        border-radius:20px;
        padding:35px;
        color:white;
    ">

        <h1>
            Welcome to GradeFlow, ${safeName}.
        </h1>

        <p style="
            color:#cfcfcf;
            line-height:1.6;
        ">
            Your GradeFlow account has been created successfully.
        </p>

        <p style="
            color:#cfcfcf;
            line-height:1.6;
        ">
            You can now calculate grades, track your academic
            progress and use GradeFlow's upcoming AI features.
        </p>

    </div>

</div>

</body>
</html>
`;

    return sendEmail({
        to,
        subject,
        html,
        text: `Welcome to GradeFlow, ${name}. Your account has been created successfully.`
    });
}


/* ==========================================
   ESCAPE HTML
========================================== */

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}