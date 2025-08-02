import { onRequest } from "firebase-functions/v2/https";
import OpenAI from "openai";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

let cachedAssistantId: string | null = null;

async function getAssistant(client: OpenAI): Promise<string> {
  if (cachedAssistantId) return cachedAssistantId;

  const docRef = db.collection("settings").doc("assistant");
  const snap = await docRef.get();
  if (snap.exists) {
    const data = snap.data() as { assistantId?: string };
    if (data?.assistantId) {
      cachedAssistantId = data.assistantId;
      return cachedAssistantId;
    }
  }

  // TODO: adjust assistant creation parameters as needed.
  const assistant = await client.beta.assistants.create({
    model: "gpt-4o-mini",
    name: "BoriChat Assistant",
  });
  cachedAssistantId = assistant.id;
  await docRef.set({ assistantId: cachedAssistantId }, { merge: true });
  return cachedAssistantId;
}

function cleanTextForTTS(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function removeCitations(text: string): string {
  if (typeof text !== "string") return text;
  return text.replace(/【\d+:\w+†[^\]]+】/g, "");
}

export const openaiRun = onRequest(
  { region: "us-east1", timeoutSeconds: 540 },
  async (req, res) => {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.status(401).json({ error: "Missing OpenAI API key" });
        return;
      }

      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      const { message, threadId } = req.body ?? {};
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      const client = new OpenAI({ apiKey });
      const assistantId = await getAssistant(client);

      let threadIdToUse = threadId as string | undefined;
      if (!threadIdToUse) {
        const thread = await client.beta.threads.create();
        threadIdToUse = thread.id;
      }

      await client.beta.threads.messages.create(threadIdToUse, {
        role: "user",
        content: message,
      });

      const stream = await client.beta.threads.runs.createAndStream(threadIdToUse, {
        assistant_id: assistantId,
      });

      let runId: string | undefined;
      let botResponseText = "";

      for await (const event of stream) {
        if (event.type === "thread.run.created") {
          runId = event.data.id;
        } else if (event.type === "thread.message.delta") {
          const delta = event.data.delta;
          const content = delta?.content?.[0];
          if (content?.type === "text") {
            botResponseText += content.text.value;
          }
        } else if (event.type === "error") {
          throw new Error(event.error?.message || "OpenAI stream error");
        }
      }

      botResponseText = removeCitations(botResponseText);

      // --- Extract or generate Google Maps link ---
      let mapsLink = "";
      const linkRegex = /(https?:\/\/(?:www\.)?(?:maps\.app\.goo\.gl|google\.[^\s]+\/maps[^\s]*))/i;
      const linkMatch = botResponseText.match(linkRegex);
      if (linkMatch) {
        mapsLink = linkMatch[1];
        botResponseText = botResponseText.replace(linkMatch[0], '').trim();
      } else {
        const coordMatch = botResponseText.match(/(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/);
        if (coordMatch) {
          const lat = coordMatch[1];
          const lng = coordMatch[2];
          mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        } else {
          const placeRegex = /(?:recomiendo|recomendar|visita|visit|checkout|ve a|dir[íi]gete a)\s+([^\.\n]+)/i;
          const placeMatch = botResponseText.match(placeRegex);
          if (placeMatch) {
            const place = placeMatch[1].trim();
            if (place) {
              mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
            }
          }
        }
      }

      let awaitingMapConfirmation: string | null = null;
      let lastMapLink: string | null = null;
      if (mapsLink) {
        botResponseText += `\n\nWould you like the Google Maps link?`;
        awaitingMapConfirmation = mapsLink;
        lastMapLink = mapsLink;
      }

      const languageForTTS = /wepa|[áéíóúñ¿¡]/i.test(botResponseText) ? "es" : "en";
      const cleanedTextForTTS = cleanTextForTTS(
        botResponseText
          .replace(/https?:\/\/\S+/g, '')
          .replace(/(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/g, '')
      );

      res.json({
        runId,
        threadId: threadIdToUse,
        status: "completed",
        botResponseText,
        cleanedTextForTTS,
        languageForTTS,
        awaitingMapConfirmation,
        lastMapLink,
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);

// TODO: Implement robust retry logic similar to Wix's fetchWithRetry if needed.
// TODO: Handle session state persistence outside this function if required.
