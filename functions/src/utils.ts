import * as admin from "firebase-admin";

let app: admin.app.App | null = null;

export function getAdmin() {
  if (!app) app = admin.apps.length ? admin.app() : admin.initializeApp();
  return app;
}

export const db = () => getAdmin().firestore();
export const FieldValue = admin.firestore.FieldValue;
