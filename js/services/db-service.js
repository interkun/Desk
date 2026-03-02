// js/services/db-service.js

import { db } from "../firebase.js"; // Path check karein ("../firebase.js" agar root me hai)
import { 
    doc, 
    getDoc, 
    setDoc, 
    addDoc, 
    updateDoc, 
    collection, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- CONFIGURATION ---
const PLANS = {
    'free': { name: 'Free Tier', color: 'slate', storageMB: 500 },
    'pro': { name: 'Pro Plan', color: 'blue', storageMB: 5000 },
    'unlimited': { name: 'Unlimited', color: 'red', storageMB: 100000 }
};

// --- 1. USER PLAN LOGIC (App.js ke liye) ---
export async function getUserPlanDetails(uid) {
    try {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);
        
        let planId = 'free';

        if (userSnap.exists()) {
            planId = userSnap.data().plan || 'free';
        } else {
            // First time setup
            await setDoc(userRef, { plan: 'free', storageUsed: 0 }, { merge: true });
        }
        
        return PLANS[planId] || PLANS['free'];
    } catch (error) {
        console.error("Plan Fetch Error:", error);
        return PLANS['free'];
    }
}

// --- 2. CREATE DOCUMENT (Published.js ke liye) ---
export async function createDocument(collectionName, data) {
    try {
        const docRef = await addDoc(collection(db, collectionName), {
            ...data,
            createdAt: serverTimestamp()
        });
        return docRef.id;
    } catch (error) {
        console.error(`Error creating in ${collectionName}:`, error);
        throw error; // Error wapas bhejo taaki UI ko pata chale
    }
}

// --- 3. UPDATE DOCUMENT (Published.js ke liye) ---
export async function updateDocument(collectionName, docId, data) {
    try {
        const docRef = doc(db, collectionName, docId);
        await updateDoc(docRef, {
            ...data,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error(`Error updating ${collectionName}/${docId}:`, error);
        throw error;
    }
}