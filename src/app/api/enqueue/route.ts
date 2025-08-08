import { NextResponse } from "next/server";
import { getAdminDb } from "../../../lib/firebaseAdmin";

export async function POST(req: Request) {
  try {
    const { text, conversationId } = await req.json();

    if (!text || !conversationId) {
      return NextResponse.json({ error: "Missing text or conversationId" }, { status: 400 });
    }

    const db = getAdminDb();

    // Escribir directamente en conversations/{id}/queue/items/{docId}
    await db
      .collection("conversations")
      .doc(conversationId)
      .collection("queue")
      .doc() // docId automático
      .set({
        role: "user",
        text,
        createdAt: new Date(),
      });

    return NextResponse.json({ status: "queued" });
  } catch (error) {
    console.error("Error en enqueue:", error);
    return NextResponse.json({ error: "Error en enqueue" }, { status: 500 });
  }
}
