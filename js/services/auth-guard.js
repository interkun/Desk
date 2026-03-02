// js/services/auth-guard.js

// ✅ Correction: Sirf '../' use karein agar firebase.js 'js' folder mein hai
import { auth } from "../firebase.js"; 
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

export const requireAuth = () => {
    return new Promise((resolve, reject) => {
        // 1. Agar user pehle se memory mein hai (Fastest)
        if (auth.currentUser) {
            resolve(auth.currentUser);
            return;
        }

        // 2. Agar page reload hua hai, to wait karo (Safe)
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe(); // Listener hata do (Best Practice)
            if (user) {
                resolve(user);
            } else {
                console.warn("User not logged in");
                // Yahan aap chaho to login page par bhej sakte ho:
                // window.location.href = "/login.html"; 
                reject("No user found");
            }
        });
    });
};