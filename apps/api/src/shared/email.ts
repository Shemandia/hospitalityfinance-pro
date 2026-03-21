type GenericEmailPayload = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail(payload: GenericEmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "noreply@hospitalityfinancepro.com";
  if (!apiKey) return;

  const body = { from, to: [payload.to], subject: payload.subject, html: payload.html };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send email: ${response.status} ${text}`);
  }
}

type ApprovalEmailPayload = {
  to: string;
  approverName: string;
  journalId: string;
  entityId: string;
  approveUrl: string;
  rejectUrl: string;
};

export async function sendApprovalEmail(payload: ApprovalEmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "noreply@hospitalityfinancepro.com";

  if (!apiKey) {
    return;
  }

  const body = {
    from,
    to: [payload.to],
    subject: `Journal ${payload.journalId} requires your approval`,
    html: `
      <p>Hello ${payload.approverName},</p>
      <p>A journal is pending approval for entity <strong>${payload.entityId}</strong>.</p>
      <p>
        <a href="${payload.approveUrl}">Approve</a> |
        <a href="${payload.rejectUrl}">Reject</a>
      </p>
    `
  };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send approval email: ${response.status} ${text}`);
  }
}
