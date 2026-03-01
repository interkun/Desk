// --- 1. IMPORTS (LATEST VERSION 11.6.1) ---

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";

// Auth Imports
import { 
    getAuth, 
    GoogleAuthProvider,
    onAuthStateChanged, 
    signInWithEmailAndPassword, 
    signInWithPopup,
    signOut, 
    createUserWithEmailAndPassword, 
    updateProfile 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// Firestore Imports
import { 
    getFirestore, 
    collection, 
    getDocs, 
    getDoc, 
    addDoc, 
    setDoc, 
    doc, 
    updateDoc, 
    deleteDoc, 
    query, 
    where, 
    orderBy, 
    limit, 
    serverTimestamp, 
    increment,
    arrayUnion,
    arrayRemove,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- 2. CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBOJw6tO533mfm-PYciaDuQuV7Zvmg6aq0",
  authDomain: "interkun-dc9aa.firebaseapp.com",
  projectId: "interkun-dc9aa",
  storageBucket: "interkun-dc9aa.firebasestorage.app",
  messagingSenderId: "647008178517",
  appId: "1:647008178517:web:eb063af91056bb6a715fdc",
  measurementId: "G-3S4QVDLCBK"
};

// --- 3. INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// --- 4. EXPORTS ---
export { 
    // Core Instances
    app, 
    auth, 
    db, 
    googleProvider,

    // Auth Functions
    onAuthStateChanged, 
    signInWithEmailAndPassword, 
    signInWithPopup, 
    signOut, 
    createUserWithEmailAndPassword, 
    updateProfile,

    // Firestore Functions
    collection, 
    getDocs, 
    getDoc, 
    addDoc, 
    setDoc, 
    doc, 
    updateDoc, 
    deleteDoc, 
    query, 
    where, 
    orderBy, 
    limit, 
    serverTimestamp, 
    increment,
    arrayUnion,
    arrayRemove,
    onSnapshot
};
