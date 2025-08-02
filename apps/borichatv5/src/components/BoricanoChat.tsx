import React, { FC, useEffect, useRef, useState } from 'react';

interface BoricanoChatProps {
  userId?: string;
}

const INACTIVITY_WARNING_DURATION = 2 * 60 * 1000;
const INACTIVITY_CLOSE_DURATION_AFTER_WARNING = 1 * 60 * 1000;
const INITIAL_AUTO_CLOSE_DURATION = 1 * 60 * 1000;

function prepareTextForTTS(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g, '')
    .trim();
}

function isMapConfirmation(text: string): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase();
  const affirmatives = ['yes', 'ok', 'sure', 'dale', 'si', 'sí', 'claro'];
  if (affirmatives.some((w) => normalized.includes(w))) return true;
  return /coor|map/.test(normalized);
}

const startAssistantRun = async (message: string, threadId: string | null) => {
  const res = await fetch('/functions/openai-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, threadId }),
  });
  return res.json();
};

const getAssistantRunResult = async (
  threadId: string,
  runId: string,
  language: string,
  sessionState: any
) => {
  const res = await fetch('/functions/openai-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, runId, language, sessionState }),
  });
  return res.json();
};

const enviarEmailAlHuesped = async (email: string, message: string) => {
  await fetch('/functions/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, message }),
  });
};

const generateAudio = async (text: string, language: string) => {
  const res = await fetch('/functions/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  return res.json();
};

const saveChatMessage = async (
  sessionId: string | null,
  role: string,
  message: string
) => {
  await fetch('/functions/save-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, role, message }),
  });
};

const BoricanoChat: FC<BoricanoChatProps> = ({ userId }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const activityWarningTimeoutId = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const activityCloseTimeoutId = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const initialAutoCloseTimeoutId = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const pollingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const [chatTranscript, setChatTranscript] = useState<
    { role: string; content: string; language?: string }[]
  >([]);
  const [lastBotResponse, setLastBotResponse] = useState('');
  const [hasUserInteractedInitially, setHasUserInteractedInitially] =
    useState(false);
  const [currentSessionState, setCurrentSessionState] = useState<{
    threadId: string | null;
    awaitingMapConfirmation: string | null;
    lastMapLink: string | null;
    includeMapLink: boolean;
  }>({
    threadId: null,
    awaitingMapConfirmation: null,
    lastMapLink: null,
    includeMapLink: false,
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const postToIframe = (data: any) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(data, '*');
    }
  };

  const clearAllTimers = () => {
    if (initialAutoCloseTimeoutId.current) {
      clearTimeout(initialAutoCloseTimeoutId.current);
      initialAutoCloseTimeoutId.current = null;
    }
    if (activityWarningTimeoutId.current) {
      clearTimeout(activityWarningTimeoutId.current);
      activityWarningTimeoutId.current = null;
    }
    if (activityCloseTimeoutId.current) {
      clearTimeout(activityCloseTimeoutId.current);
      activityCloseTimeoutId.current = null;
    }
  };

  const resetChatSessionState = () => {
    setChatTranscript([]);
    setLastBotResponse('');
    setHasUserInteractedInitially(false);
    setCurrentSessionState({
      threadId: null,
      awaitingMapConfirmation: null,
      lastMapLink: null,
      includeMapLink: false,
    });
    setCurrentSessionId(null);
  };

  const startInitialAutoCloseTimer = () => {
    clearAllTimers();
    if (!hasUserInteractedInitially) {
      initialAutoCloseTimeoutId.current = setTimeout(() => {
        postToIframe({
          type: 'forceCloseChat',
          reason: 'initial_inactivity',
          message: 'Timeout! Chat closed due to inactivity. 🦤',
        });
        resetChatSessionState();
      }, INITIAL_AUTO_CLOSE_DURATION);
    }
  };

  const resetActivityTimers = () => {
    if (!hasUserInteractedInitially) return;
    if (activityWarningTimeoutId.current) {
      clearTimeout(activityWarningTimeoutId.current);
      activityWarningTimeoutId.current = null;
    }
    if (activityCloseTimeoutId.current) {
      clearTimeout(activityCloseTimeoutId.current);
      activityCloseTimeoutId.current = null;
    }
    activityWarningTimeoutId.current = setTimeout(() => {
      postToIframe({
        type: 'activityWarning',
        message: `Still there? Chat will close in ${
          INACTIVITY_CLOSE_DURATION_AFTER_WARNING / 60000
        } minute(s).`,
      });
      activityCloseTimeoutId.current = setTimeout(() => {
        postToIframe({
          type: 'forceCloseChat',
          reason: 'session_timeout',
          message: 'Timeout! Chat closed due to inactivity. 🦤',
        });
        resetChatSessionState();
      }, INACTIVITY_CLOSE_DURATION_AFTER_WARNING);
    }, INACTIVITY_WARNING_DURATION);
  };

  const handleUserActivity = () => {
    if (!hasUserInteractedInitially) {
      setHasUserInteractedInitially(true);
      setCurrentSessionId(Date.now().toString());
      if (initialAutoCloseTimeoutId.current) {
        clearTimeout(initialAutoCloseTimeoutId.current);
        initialAutoCloseTimeoutId.current = null;
      }
      resetActivityTimers();
    } else {
      resetActivityTimers();
    }
  };

  const processUserChatMessage = async (userMessage: string) => {
    setChatTranscript((prev) => [...prev, { role: 'user', content: userMessage }]);
    await saveChatMessage(currentSessionId, 'user', userMessage);
    postToIframe({ type: 'showTypingIndicator' });

    if (
      currentSessionState.awaitingMapConfirmation &&
      isMapConfirmation(userMessage)
    ) {
      setCurrentSessionState((prev) => ({ ...prev, includeMapLink: true }));
    }

    try {
      const startResult = await startAssistantRun(
        userMessage,
        currentSessionState.threadId
      );
      if (startResult.error) throw new Error(startResult.error);
      setCurrentSessionState((prev) => ({
        ...prev,
        threadId: startResult.threadId,
      }));
      startPolling(startResult.runId, startResult.threadId);
    } catch (error) {
      postToIframe({
        type: 'botError',
        text: 'Oops! Something went wrong. Try again? 🌊',
      });
      postToIframe({ type: 'hideTypingIndicator' });
      resetActivityTimers();
    }
  };

  const startPolling = (runId: string, threadId: string) => {
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
    }
    pollingInterval.current = setInterval(async () => {
      try {
        const result = await getAssistantRunResult(
          threadId,
          runId,
          'en',
          currentSessionState
        );
        setCurrentSessionState((prev) => ({
          ...prev,
          awaitingMapConfirmation: result.awaitingMapConfirmation,
          lastMapLink: result.lastMapLink,
          includeMapLink: false,
        }));
        if (result.status === 'completed') {
          if (pollingInterval.current) clearInterval(pollingInterval.current);
          setLastBotResponse(result.botResponseText);
          setChatTranscript((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: result.botResponseText,
              language: result.languageForTTS,
            },
          ]);
          await saveChatMessage(
            currentSessionId,
            'assistant',
            result.botResponseText
          );
          postToIframe({ type: 'botMessage', text: result.botResponseText });
          postToIframe({ type: 'hideTypingIndicator' });
          resetActivityTimers();
        } else if (result.status === 'failed') {
          if (pollingInterval.current) clearInterval(pollingInterval.current);
          postToIframe({ type: 'botError', text: result.botResponseText });
          postToIframe({ type: 'hideTypingIndicator' });
          resetActivityTimers();
        }
      } catch {
        if (pollingInterval.current) clearInterval(pollingInterval.current);
        postToIframe({ type: 'hideTypingIndicator' });
      }
    }, 3000);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    resetChatSessionState();
    startInitialAutoCloseTimer();

    const handleMessage = async (event: MessageEvent) => {
      const messageFromIframe = event.data;
      if (typeof messageFromIframe === 'string') {
        handleUserActivity();
        await processUserChatMessage(messageFromIframe);
      } else if (
        messageFromIframe &&
        typeof messageFromIframe.type !== 'undefined'
      ) {
        switch (messageFromIframe.type) {
          case 'chatInitialized':
            break;
          case 'userInputFocus':
            handleUserActivity();
            break;
          case 'sendToGuest':
            handleUserActivity();
            if (lastBotResponse) {
              try {
                await enviarEmailAlHuesped(
                  messageFromIframe.email,
                  lastBotResponse
                );
                const successMsg =
                  messageFromIframe.language === 'es'
                    ? '✅ ¡Email enviado con éxito!'
                    : '✅ Email sent successfully!';
                postToIframe({ type: 'botMessage', text: successMsg });
              } catch {
                const errorMsg =
                  messageFromIframe.language === 'es'
                    ? '❌ ¡Problema al enviar el email! Intenta de nuevo.'
                    : '❌ Problem sending email. Try again.';
                postToIframe({ type: 'botError', text: errorMsg });
              }
            } else {
              const noResponseMsg =
                messageFromIframe.language === 'es'
                  ? '🤔 ¡No hay respuesta para enviar! Chatea primero.'
                  : '🤔 No response to send. Chat first!';
              postToIframe({ type: 'botMessage', text: noResponseMsg });
            }
            break;
          case 'playAudio':
            handleUserActivity();
            try {
              const ttsText = prepareTextForTTS(messageFromIframe.text);
              const audioData = await generateAudio(
                ttsText,
                messageFromIframe.language
              );
              if (audioData && !audioData.error) {
                if (typeof window !== 'undefined') {
                  try {
                    const audio = new Audio(audioData.audioUri);
                    audio.play();
                  } catch {}
                }
                postToIframe({
                  type: 'audioResponse',
                  text: messageFromIframe.text,
                  audioData: audioData.audioUri,
                  originalText: messageFromIframe.text,
                });
              } else {
                const errorMsg =
                  messageFromIframe.language === 'es'
                    ? '❌ ¡No se pudo generar el audio!'
                    : '❌ Could not generate audio.';
                postToIframe({ type: 'botError', text: errorMsg });
              }
            } catch {
              const errorMsg =
                messageFromIframe.language === 'es'
                  ? '❌ ¡Fallo al generar el audio!'
                  : '❌ Audio generation failed.';
              postToIframe({ type: 'botError', text: errorMsg });
            }
            break;
          default:
            break;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      clearAllTimers();
      if (pollingInterval.current) clearInterval(pollingInterval.current);
    };
  }, [hasUserInteractedInitially, lastBotResponse, currentSessionState]);

  return (
    <div className="bori-chat">
      {/* Chat container - styles will be added with Tailwind */}
      <iframe ref={iframeRef} style={{ display: 'none' }} />
    </div>
  );
};

export default BoricanoChat;
