"use client";

import { useEffect, useState, useRef } from "react";
import ChatUI from "../components/ChatUI";
import { db } from "../lib/firebaseClient";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

export default function HomePage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const inactivityWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ⏱ Configuración de tiempos
  const INACTIVITY_WARNING_DURATION = 2 * 60 * 1000; // 2 min
  const INACTIVITY_CLOSE_DURATION_AFTER_WARNING = 1 * 60 * 1000; // 1 min
  const INITIAL_AUTO_CLOSE_DURATION = 1 * 60 * 1000; // 1 min

  // 📡 Generar nueva conversación al cargar
  useEffect(() => {
    const newConvId = crypto.randomUUID();
    setConversationId(newConvId);
    startInactivityTimers();
    return () => clearInactivityTimers();
  }, []);

  // 🕒 Manejo de timers
  const startInactivityTimers = () => {
    clearInactivityTimers();
    inactivityWarningTimeoutRef.current = setTimeout(() => {
      console.warn("⚠️ Advertencia: inactividad detectada");
      inactivityCloseTimeoutRef.current = setTimeout(() => {
        console.warn("💤 Conversación cerrada por inactividad");
        endConversation();
      }, INACTIVITY_CLOSE_DURATION_AFTER_WARNING);
    }, INACTIVITY_WARNING_DURATION);
  };

  const clearInactivityTimers = () => {
    if (inactivityWarningTimeoutRef.current) {
      clearTimeout(inactivityWarningTimeoutRef.current);
      inactivityWarningTimeoutRef.current = null;
    }
    if (inactivityCloseTimeoutRef.current) {
      clearTimeout(inactivityCloseTimeoutRef.current);
      inactivityCloseTimeoutRef.current = null;
    }
  };

  // 🔚 Cierra la conversación y guarda en Firestore
  const endConversation = async () => {
    if (conversationId) {
      await addDoc(collection(db, "conversations"), {
        conversationId,
        endedAt: serverTimestamp(),
      });
      setConversationId(null);
    }
  };

  return (
    <main>
      <ChatUI
        conversationId={conversationId}
        onUserActivity={startInactivityTimers}
      />
    </main>
  );
}
