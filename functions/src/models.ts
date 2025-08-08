export type QueueItem = {
  conversationId: string;
  userMessageId: string;
  createdAt: FirebaseFirestore.Timestamp;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
};

export type ConversationDoc = {
  assistantId?: string;
  threadId?: string | null;
  status?: "open" | "closed";
  title?: string;
  recipientEmail?: string | null;
};
