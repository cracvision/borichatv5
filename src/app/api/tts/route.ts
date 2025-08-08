import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    // Generar audio usando tts-1-hd
    const mp3 = await openai.audio.speech.create({
      model: "tts-1-hd",
      voice: "alloy", // Puedes cambiar la voz
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
      },
    });
  } catch (error) {
    console.error("Error en /api/tts:", error);
    return NextResponse.json({ error: "TTS failed" }, { status: 500 });
  }
}
