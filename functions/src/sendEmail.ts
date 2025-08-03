import { onRequest } from "firebase-functions/v2/https";
import SibApiV3Sdk from "@sendinblue/client";

export const sendEmail = onRequest(
  { region: "us-east1", timeoutSeconds: 120 },
  async (req, res) => {
    const { email, message } = req.body || {};
    if (!email || !message) {
      return res.status(400).json({ error: "email and message required" });
    }
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: "BREVO_API_KEY missing" });
    }

    const client = new SibApiV3Sdk.TransactionalEmailsApi();
    client.setApiKey(
      SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey,
      apiKey
    );

    try {
      const result = await client.sendTransacEmail({
        sender: { email: "bori@vistapelicano.com", name: "Borí Cano" },
        subject: "Mensaje de Borí Cano",
        to: [{ email }],
        htmlContent: `<p>${message}</p>`,
      });
      return res.json({ status: "sent", messageId: result?.messageId });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "send failed" });
    }
  }
);
