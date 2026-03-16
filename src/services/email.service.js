import { AppError } from "#utils/AppError.js";
import { HTTP_CODES } from "#src/constants.js";

let cachedTransporter = null;

function resolveDeliveryMode() {
  const configuredMode = String(process.env.EMAIL_DELIVERY_MODE || "")
    .trim()
    .toLowerCase();

  const hasMailSmtpConfig =
    Boolean(process.env.MAIL_HOST) &&
    Boolean(process.env.MAIL_USER) &&
    Boolean(process.env.MAIL_PASS);

  const hasSmtpConfig =
    Boolean(process.env.SMTP_HOST) &&
    Boolean(process.env.SMTP_USER) &&
    Boolean(process.env.SMTP_PASSWORD);

  if (configuredMode === "webhook" || configuredMode === "gmail") {
    return configuredMode;
  }

  if (configuredMode === "smtp") {
    return "smtp";
  }

  if (configuredMode === "log") {
    // Ưu tiên gửi thật nếu đã có đủ SMTP vars kiểu MAIL_*
    if (hasMailSmtpConfig || hasSmtpConfig) return "smtp";
    return "log";
  }

  if (hasMailSmtpConfig || hasSmtpConfig) return "smtp";
  return "log";
}

function buildEmailBody({ username, verificationUrl }) {
  const safeUsername = username || "đồng chí";

  const text = [
    `Xin chào ${safeUsername},`,
    "",
    "Vui lòng xác minh email để kích hoạt đầy đủ tính năng tài khoản.",
    `Link xác minh: ${verificationUrl}`,
    "",
    "Nếu bạn không yêu cầu thao tác này, vui lòng bỏ qua email.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <p>Xin chào <strong>${safeUsername}</strong>,</p>
      <p>Vui lòng xác minh email để kích hoạt đầy đủ tính năng tài khoản.</p>
      <p>
        <a href="${verificationUrl}" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;">
          Xác minh email
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280">Nếu bạn không yêu cầu thao tác này, vui lòng bỏ qua email.</p>
    </div>
  `;

  return { text, html };
}

async function getNodemailerTransporter() {
  if (cachedTransporter) return cachedTransporter;

  let nodemailer;
  try {
    nodemailer = await import("nodemailer");
  } catch {
    throw new AppError({
      message:
        "nodemailer is not installed. Run: npm install nodemailer",
      statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
    });
  }

  const mode = resolveDeliveryMode();

  if (mode === "gmail") {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) {
      throw new AppError({
        message: "GMAIL_USER or GMAIL_APP_PASSWORD not defined",
        statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
      });
    }

    cachedTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user,
        pass,
      },
    });
    return cachedTransporter;
  }

  if (mode === "smtp") {
    const host = process.env.SMTP_HOST || process.env.MAIL_HOST;
    const port = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
    const user = process.env.SMTP_USER || process.env.MAIL_USER;
    const pass = process.env.SMTP_PASSWORD || process.env.MAIL_PASS;
    const secureFromEnv = process.env.SMTP_SECURE;
    const secure =
      secureFromEnv === undefined
        ? port === 465
        : String(secureFromEnv).toLowerCase() === "true";

    if (!host || !user || !pass) {
      throw new AppError({
        message: "SMTP_HOST/SMTP_USER/SMTP_PASSWORD not defined",
        statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
      });
    }

    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });
    return cachedTransporter;
  }

  throw new AppError({
    message: `Unsupported mail transport mode: ${mode}`,
    statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
  });
}

async function deliverEmail({ to, subject, text, html, attachments = [] }) {
  const mode = resolveDeliveryMode();
  const from =
    process.env.EMAIL_FROM ||
    process.env.MAIL_FROM ||
    process.env.GMAIL_USER ||
    process.env.SMTP_USER ||
    process.env.MAIL_USER;

  if (mode === "log") {
    console.log("[Email][LOG]", {
      to,
      subject,
    });
    return { delivered: true, mode: "log" };
  }

  if (mode === "webhook") {
    const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new AppError({
        message: "EMAIL_WEBHOOK_URL not defined",
        statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
      });
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        text,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new AppError({
        message: `Email webhook failed (${response.status}): ${body}`,
        statusCode: HTTP_CODES.BAD_REQUEST,
      });
    }

    return { delivered: true, mode: "webhook" };
  }

  if (mode === "gmail" || mode === "smtp") {
    const transporter = await getNodemailerTransporter();
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      attachments,
    });

    return {
      delivered: true,
      mode,
      messageId: info?.messageId || null,
    };
  }

  throw new AppError({
    message: `Unsupported EMAIL_DELIVERY_MODE: ${mode}`,
    statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
  });
}

export async function sendVerifyEmail({ to, username, verificationUrl }) {
  const subject = "Xac minh email tai khoan";
  const { text, html } = buildEmailBody({ username, verificationUrl });
  const result = await deliverEmail({
    to,
    subject,
    text,
    html,
  });

  if (result.mode === "log") {
    console.log("[VerifyEmail][LOG]", {
      to,
      subject,
      hasVerificationUrl: Boolean(verificationUrl),
    });
  }

  return result;
}

export async function sendSystemEmail({
  to,
  subject,
  text,
  html,
  attachments = [],
}) {
  return deliverEmail({
    to,
    subject,
    text,
    html,
    attachments,
  });
}
