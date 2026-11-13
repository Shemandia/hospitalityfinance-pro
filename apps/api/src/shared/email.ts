import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { config } from "../config.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(url: string): string {
  // Only allow http/https URLs
  if (/^https?:\/\//i.test(url)) return escapeHtml(url);
  return "#";
}

// ── SES Client (lazy init) ───────────────────────────────────────────────────

let sesClient: SESClient | null = null;

function getSesClient(): SESClient | null {
  if (sesClient) return sesClient;

  const {
    AWS_SES_REGION: region,
    AWS_SES_ACCESS_KEY_ID: accessKeyId,
    AWS_SES_SECRET_ACCESS_KEY: secretAccessKey
  } = config();

  if (!region || !accessKeyId || !secretAccessKey) return null;

  sesClient = new SESClient({
    region,
    credentials: { accessKeyId, secretAccessKey }
  });
  return sesClient;
}

function getFromEmail(): string {
  return (
    config().SES_FROM_EMAIL ?? config().RESEND_FROM_EMAIL ?? "noreply@hospitalityfinancepro.com"
  );
}

const isDev = () => config().NODE_ENV !== "production";

// ── Generic email ────────────────────────────────────────────────────────────

type GenericEmailPayload = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail(payload: GenericEmailPayload): Promise<void> {
  const client = getSesClient();
  const from = getFromEmail();

  // Fallback 1: Try legacy Resend API (backwards compat)
  const resendApiKey = config().RESEND_API_KEY;
  if (!client && resendApiKey) {
    const body = { from, to: [payload.to], subject: payload.subject, html: payload.html };
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to send email via Resend: ${response.status} ${text}`);
    }
    return;
  }

  // Fallback 2: No email provider configured — log to console
  if (!client) {
    if (isDev()) {
      console.log(
        `\n📧 EMAIL (console fallback)\n  To: ${payload.to}\n  Subject: ${payload.subject}\n  ──────\n${payload.html.replace(/<[^>]+>/g, "").trim()}\n  ──────\n`
      );
    }
    return;
  }

  // Primary: AWS SES
  try {
    await client.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [payload.to] },
        Message: {
          Subject: { Data: payload.subject, Charset: "UTF-8" },
          Body: { Html: { Data: payload.html, Charset: "UTF-8" } }
        }
      })
    );
  } catch (err: any) {
    // If SES domain is not verified or sandbox issue, fall back to console logging
    const sesError = err?.name ?? err?.Code ?? "";
    const recoverableErrors = [
      "MessageRejected",
      "MailFromDomainNotVerified",
      "ConfigurationSetDoesNotExist",
      "AccountSendingPaused"
    ];

    if (recoverableErrors.includes(sesError) || isDev()) {
      console.warn(`⚠️  SES send failed (${sesError}): ${err.message}`);
      console.log(
        `📧 EMAIL (SES fallback)\n  To: ${payload.to}\n  Subject: ${payload.subject}\n  Body: ${payload.html.replace(/<[^>]+>/g, "").substring(0, 500)}`
      );
      return;
    }

    // Non-recoverable errors in production: re-throw
    throw err;
  }
}

// ── Welcome / invite email ──────────────────────────────────────────────

type WelcomeEmailPayload = {
  to: string;
  userName: string;
  tenantName: string;
  loginUrl: string;
  temporaryPassword: string;
};

export async function sendWelcomeEmail(payload: WelcomeEmailPayload): Promise<void> {
  await sendEmail({
    to: payload.to,
    subject: `Welcome to ${escapeHtml(payload.tenantName)} — HospitalityFinance Pro`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Welcome to HospitalityFinance Pro</h2>
        <p>Hello ${escapeHtml(payload.userName)},</p>
        <p>An account has been created for you at <strong>${escapeHtml(payload.tenantName)}</strong>.</p>
        <table style="margin: 20px 0; border-collapse: collapse; width: 100%;">
          <tr>
            <td style="padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 13px; color: #64748b; width: 130px;">Username</td>
            <td style="padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: 600;">${escapeHtml(payload.to)}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">Temporary Password</td>
            <td style="padding: 10px 14px; border: 1px solid #e2e8f0; font-family: monospace; font-size: 14px; letter-spacing: 0.5px;">${escapeHtml(payload.temporaryPassword)}</td>
          </tr>
        </table>
        <p style="margin: 24px 0;">
          <a href="${sanitizeUrl(payload.loginUrl)}"
             style="background: #22b8a0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
            Log In Now
          </a>
        </p>
        <p style="color: #ef4444; font-size: 13px; font-weight: 600;">You will be required to change your password on first login.</p>
        <p style="color: #64748b; font-size: 13px;">If you did not expect this invitation, please contact your administrator.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 11px;">HospitalityFinance Pro</p>
      </div>
    `
  });
}

// ── Approval email ───────────────────────────────────────────────────────────

type ApprovalEmailPayload = {
  to: string;
  approverName: string;
  journalId: string;
  entityId: string;
  approveUrl: string;
  rejectUrl: string;
};

export async function sendApprovalEmail(payload: ApprovalEmailPayload): Promise<void> {
  await sendEmail({
    to: payload.to,
    subject: `Journal ${escapeHtml(payload.journalId)} requires your approval`,
    html: `
      <p>Hello ${escapeHtml(payload.approverName)},</p>
      <p>A journal is pending approval for entity <strong>${escapeHtml(payload.entityId)}</strong>.</p>
      <p>
        <a href="${sanitizeUrl(payload.approveUrl)}">Approve</a> |
        <a href="${sanitizeUrl(payload.rejectUrl)}">Reject</a>
      </p>
    `
  });
}

// ── Password reset email ─────────────────────────────────────────────────────

type PasswordResetEmailPayload = {
  to: string;
  resetUrl: string;
  tenantName: string;
};

export async function sendPasswordResetEmail(payload: PasswordResetEmailPayload): Promise<void> {
  await sendEmail({
    to: payload.to,
    subject: "Reset your HospitalityFinance Pro password",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #0f172a;">Password Reset</h2>
        <p>You requested a password reset for your <strong>${escapeHtml(payload.tenantName)}</strong> account.</p>
        <p>Click the link below to set a new password. This link expires in 1 hour.</p>
        <p style="margin: 24px 0;">
          <a href="${sanitizeUrl(payload.resetUrl)}"
             style="background: #22b8a0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
            Reset Password
          </a>
        </p>
        <p style="color: #64748b; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 11px;">HospitalityFinance Pro</p>
      </div>
    `
  });
}
