import * as admin from "firebase-admin";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

export async function handleQueuedMessage(
  snapshot: admin.firestore.QueryDocumentSnapshot,
  context: any
) {
  const { conversationId } = context.params;
  const data = snapshot.data();
  const { text, role } = data;

  if (!process.env.OPENAI_API_KEY || !ASSISTANT_ID) {
    console.error("Missing OPENAI_API_KEY or OPENAI_ASSISTANT_ID");
    return null;
  }

  if (!conversationId || !text || role !== "user") {
    console.warn("⚠️ Mensaje inválido en queue:", { conversationId, data });
    return null;
  }

  const db = admin.firestore();
  const convoRef = db.collection("conversations").doc(conversationId);

  try {
    // 1) Asegurar threadId en el doc de la conversación
    const convoSnap = await convoRef.get();
    let threadId: string | undefined = convoSnap.exists
      ? (convoSnap.get("threadId") as string | undefined)
      : undefined;

    if (!threadId) {
      const thread = await openai.beta.threads.create({});
      threadId = thread.id;
      await convoRef.set(
        { threadId, createdAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    // 2) Añadir el mensaje del usuario al thread
    await openai.beta.threads.messages.create(threadId!, {
      role: "user",
      content: text,
    });

    // 3) Ejecutar el Assistant
    const run = await openai.beta.threads.runs.create(threadId!, {
      assistant_id: ASSISTANT_ID,
    });

    // 4) Poll hasta terminar
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, Math.min(500 + i * 250, 4000)));
      const r2 = await openai.beta.threads.runs.retrieve(threadId!, run.id);
      if (["failed", "cancelled", "expired"].includes(r2.status as string)) {
        throw new Error(`Run ${r2.status}`);
      }
      if (r2.status === "completed") break;
    }

    // 5) Último mensaje del assistant
    const msgs = await openai.beta.threads.messages.list(threadId!, {
      order: "desc",
      limit: 1,
    });
    const latest = msgs.data[0];
    const assistantText =
      latest && (latest.content[0] as any)?.type === "text"
        ? (latest.content[0] as any).text.value
        : "(sin texto)";

    // 6) Guardar respuesta en subcolección messages
    await convoRef.collection("messages").add({
      role: "assistant",
      text: assistantText,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return null;
  } catch (err) {
    console.error("❌ Error procesando mensaje:", err);
    return null;
  }
}
