// functions/src/index.ts
import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1"; // 👈 clave: /v1
import { handleQueuedMessage } from "./handleQueuedMessage";

admin.initializeApp();

export const processQueue = functions.firestore
  .document("conversations/{conversationId}/queue/{docId}")
  .onCreate(handleQueuedMessage);

