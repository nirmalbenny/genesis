import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

initializeApp();

export const db = getFirestore();
export const auth = getAuth();
/** The project's default bucket (from FIREBASE_CONFIG). Only Cloud Functions use it: storage.rules deny all clients. */
export const bucket = () => getStorage().bucket();
