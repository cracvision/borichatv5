"use client";

import { useState, useEffect, useRef } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../lib/firebaseClient";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: any;
}

interface ChatUIProps {
  conversationId: string | null;
  onUserActivity?: () => void;
}

export default function ChatUI({ conversationId, onUserActivity }: ChatUIProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 📡 Escuchar mensajes en: conversations/{id}/messages
  useEffect(() => {
    if (!conversationId) return;

    const msgsRef = collection(db, "conversations", conversationId, "messages");
    const q = query(msgsRef, orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        role: doc.data().role,
        text: doc.data().text,
        createdAt: doc.data().createdAt,
      }));
      setMessages(msgs);
      scrollToBottom();
    });

    return () => unsubscribe();
  }, [conversationId]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // ✉️ Enviar mensaje
  const sendMessage = async () => {
    if (!input.trim() || !conversationId) return;
    setLoading(true);
    onUserActivity?.();

    // Guarda el mensaje del usuario en la subcolección messages
    await addDoc(collection(db, "conversations", conversationId, "messages"), {
      role: "user",
      text: input,
      createdAt: serverTimestamp(),
    });

    // Encola para Functions en: conversations/{id}/queue/items
    await fetch("/api/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input, conversationId }),
    });

    setInput("");
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`p-3 rounded-lg max-w-xl flex flex-col gap-2 ${
              m.role === "user" ? "bg-blue-600 self-end" : "bg-gray-700 self-start"
            }`}
          >
            <span>{m.text}</span>
            {m.role === "assistant" && (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch("/api/tts", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ text: m.text }),
                    });
                    if (!res.ok) throw new Error("TTS request failed");
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const audio = new Audio(url);
                    await audio.play();
                  } catch (err) {
                    console.error("Error reproduciendo TTS:", err);
                  }
                }}
                className="bg-purple-500 hover:bg-purple-600 px-2 py-1 rounded text-sm"
              >
                🔊 Reproducir voz
              </button>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 flex gap-2 border-t border-gray-700">
        <input
          className="flex-1 p-2 rounded bg-gray-800 border border-gray-600 focus:outline-none"
          placeholder="Escribe tu mensaje..."
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            onUserActivity?.();
          }}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button
          className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded disabled:opacity-50"
          onClick={sendMessage}
          disabled={loading}
        >
          {loading ? "..." : "Enviar"}
        </button>
      </div>
    </div>
  );
}
