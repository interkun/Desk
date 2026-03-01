// js/auth.js

// Firebase services ko import kar rahe hain
// Dhyan rahe: firebase.js usi folder mein hona chahiye
import { auth, googleProvider } from "./firebase.js";
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signInWithPopup, 
    signOut,
    updateProfile, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// --- 1. SECURITY CHECK (Sabse Zaroori) ---
// Yeh function har page load par check karega ki banda login hai ya nahi
onAuthStateChanged(auth, (user) => {
    const currentPath = window.location.pathname;
    
    // Check karo ki hum abhi Login page par hain ya Dashboard par
    // Note: Aapke file ka naam 'login.html' ya 'auth.html' ho sakta hai
    const isLoginPage = currentPath.includes('login.html') || currentPath.includes('auth.html');

    if (user) {
        // CASE: User Login hai
        console.log("User Connected:", user.email);

        // Agar user login hai aur galti se Login page par baitha hai, toh usko Dashboard bhejo
        if (isLoginPage) {
            window.location.href = 'index.html';
        }

        // Agar Dashboard par hai, toh UI mein naam update kar sakte hain (Optional)
        // updateUserNameInUI(user);
        
    } else {
        // CASE: User Login NAHI hai
        console.log("User Disconnected");

        // Agar user login nahi hai aur Dashboard kholne ki koshish kar raha hai
        if (!isLoginPage) {
            // Toh wapas Login page par phek do
            window.location.href = 'login.html';
        }
    }
});


// --- 2. LOGIN / SIGNUP LOGIC ---
// Yeh functions window object par attach kar rahe hain taaki HTML buttons inhe call kar sakein

// Main Auth Function (Login aur Signup dono handle karega)
window.handleAuth = async function(e) {
    e.preventDefault();
    
    // HTML se values uthao
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const submitBtn = document.getElementById('submitBtn');
    
    // Check karo ki Signup mode hai ya Login mode
    // Hum check kar rahe hain ki 'nameField' hidden hai ya nahi
    const nameField = document.getElementById('nameField');
    // Agar nameField dikh raha hai, matlab banda Signup kar raha hai
    const isSignupMode = nameField && !nameField.classList.contains('hidden-field');

    // Button ko loading state mein daalo
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing...';
    submitBtn.disabled = true;

    try {
        if (isSignupMode) {
            // --- SIGN UP KARO ---
            const fullName = document.getElementById('fullName').value;
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            
            // User ka naam set karo
            await updateProfile(userCredential.user, {
                displayName: fullName
            });
            
            alert("Account ban gaya! Dashboard par ja rahe hain...");
            // Redirect karne ki zaroorat nahi, onAuthStateChanged khud kar dega
            
        } else {
            // --- LOGIN KARO ---
            await signInWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged khud Dashboard par le jayega
        }
    } catch (error) {
        console.error("Auth Error:", error);
        alert("Gadbad ho gayi: " + error.message);
        
        // Button ko wapas normal karo
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
};

// Google Login Function
window.handleGoogleLogin = async function() {
    try {
        await signInWithPopup(auth, googleProvider);
        // Safal hone par onAuthStateChanged redirect karega
    } catch (error) {
        console.error("Google Error:", error);
        alert("Google Login Failed: " + error.message);
    }
};

// Logout Function (Dashboard ke liye)
window.logout = async function() {
    try {
        // User se confirm karo
        if(confirm("Kya aap logout karna chahte hain?")) {
            await signOut(auth);
            // onAuthStateChanged khud Login page par bhej dega
        }
    } catch (error) {
        console.error("Logout Error:", error);
    }
};