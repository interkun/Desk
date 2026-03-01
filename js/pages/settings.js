import { db, auth } from "../firebase.js";
import { 
    doc, getDoc, onSnapshot, updateDoc, setDoc, serverTimestamp, collection, addDoc, query, where, getDocs 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
    sendPasswordResetEmail, updateProfile 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { showToast, showConfirm } from "../services/sweet-alert.js";

console.log("⚙ Settings: Custom UI & Cloudflare Integration Active");

const CLOUDFLARE_API_URL = "https://interkun-payment-worker.interkunhq.workers.dev"; 

const PLANS = {
    'free': { id: 'free', name: 'Starter', price: 0, commission: 10 },
    'pro': { id: 'pro', name: 'Creator Pro', price: 1999, commission: 5 }
};

let userUnsubscribe;

// Formatting numbers (e.g., 1500 to 1.5K) exactly like creator.js
const formatMetric = (num) => {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
};

// --- INIT ---
export function init() {
    auth.onAuthStateChanged((user) => {
        if (user) {
            checkGoogleAuthCallback(); // Naya function add kiya
            loadUserProfile(user);
            listenToUserData(user.uid);
        }
    });
}

window.loadSettings = init;

// --- 1. PROFILE & RATING LOGIC ---
async function loadUserProfile(user) {
    const defaultName = user.displayName || user.email.split('@')[0];
    const initial = defaultName.charAt(0).toUpperCase();
    
    setText('display-email-text', user.email);
    setValue('display-name-input', user.displayName || '');

    // Fetch Seller Data
    try {
        const sellerSnap = await getDoc(doc(db, "sellers", user.uid));
        let avatar = "https://via.placeholder.com/150";
        let shopName = defaultName;

        if (sellerSnap.exists()) {
            const sData = sellerSnap.data();
            if (sData.shopLogo) avatar = sData.shopLogo;
            if (sData.shopName) shopName = sData.shopName;
        }

        setText('card-shop-name', shopName);
        const imgEl = document.getElementById('card-avatar');
        if (imgEl) imgEl.src = avatar;

    } catch(e) { console.error("Error loading seller profile:", e); }

    // Fetch Ratings from "reviews" collection (100% synced with review.js & styled like creator.js)
    try {
        const q = query(collection(db, "reviews"), where("sellerId", "==", user.uid));
        const querySnapshot = await getDocs(q);

        let totalRating = 0;
        let totalReviews = 0;

        querySnapshot.forEach((doc) => {
            const reviewData = doc.data();
            if (typeof reviewData.rating === 'number' && reviewData.rating >= 1 && reviewData.rating <= 5) {
                totalRating += reviewData.rating;
                totalReviews++;
            }
        });

        const ratingEl = document.getElementById('creator-rating-badge');
        
        if (ratingEl) {
            if (totalReviews > 0) {
                const averageRating = totalRating / totalReviews;
                ratingEl.innerHTML = `
                    <div class="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-full shadow-md w-fit mt-2">
                        <span class="text-sm font-bold">${averageRating.toFixed(1)}</span>
                        <i class="fa-solid fa-star text-yellow-400 text-xs"></i>
                        <span class="w-px h-3 bg-white/20 mx-1"></span>
                        <span class="text-[10px] text-slate-300 font-medium">${formatMetric(totalReviews)} Reviews</span>
                    </div>
                `;
            } else {
                ratingEl.innerHTML = `
                    <div class="mt-2">
                        <span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-500 w-fit">
                            <i class="fa-solid fa-star text-slate-400"></i> New Creator
                        </span>
                    </div>`;
            }
        }

    } catch(e) { console.error("Error loading ratings:", e); }
}

window.handleUpdateProfile = async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    const newName = document.getElementById('display-name-input').value.trim();
    
    if(!newName) return showToast("Name cannot be empty", "warning");

    const btn = e.target.querySelector('button');
    const oldText = btn.innerText;
    btn.innerText = "Saving..."; btn.disabled = true;

    try {
        await updateProfile(user, { displayName: newName });
        await setDoc(doc(db, "users", user.uid), { 
            displayName: newName, updatedAt: serverTimestamp()
        }, { merge: true });

        await updateDoc(doc(db, "sellers", user.uid), { shopName: newName }).catch(()=>{});

        showToast('Profile Updated', 'success');
        loadUserProfile(user); 
    } catch (error) { 
        showToast(error.message, 'error'); 
    } finally { 
        btn.innerText = oldText; btn.disabled = false; 
    }
};

// --- 2. SUBSCRIPTION LOGIC (Untouched Cloudflare Engine) ---
function listenToUserData(uid) {
    if (userUnsubscribe) userUnsubscribe();
    
    userUnsubscribe = onSnapshot(doc(db, "users", uid), (docSnap) => {
        const data = docSnap.data() || {};
        const currentPlan = data.plan || 'free'; 
        updatePlanUI(currentPlan);
        updateGoogleIntegrationUI(data.googleRefreshToken ? true : false);
    });
}

function updateGoogleIntegrationUI(isConnected) {
    const statusText = document.getElementById('google-status-text');
    const btnConnect = document.getElementById('btn-google-connect');
    const box = document.getElementById('google-integration-box');
    
    if (!statusText || !btnConnect) return;

    if (isConnected) {
        statusText.innerText = "Connected ✅";
        statusText.className = "text-[9px] text-green-500 font-bold uppercase";
        
        btnConnect.innerText = "Disconnect";
        btnConnect.className = "px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-xl text-[10px] font-bold transition active:scale-95";
        btnConnect.onclick = window.disconnectGoogleCalendar;
        
        box.classList.add('border-green-200', 'bg-green-50/30');
    } else {
        statusText.innerText = "Not Connected";
        statusText.className = "text-[9px] text-slate-500 font-bold uppercase";
        
        btnConnect.innerText = "Connect";
        btnConnect.className = "px-4 py-2 bg-blue-600 text-white shadow-sm rounded-xl text-[10px] font-bold hover:bg-blue-700 transition active:scale-95";
        btnConnect.onclick = window.connectGoogleCalendar;
        
        box.classList.remove('border-green-200', 'bg-green-50/30');
    }
}

function updatePlanUI(planId) {
    const plan = PLANS[planId] || PLANS['free'];

    const cardStrip = document.getElementById('card-plan-strip');
    if (cardStrip) {
        if (planId === 'pro') {
            cardStrip.innerHTML = `<span class="text-blue-400 text-xl mr-2">✦</span> <span class="text-white font-bold text-lg tracking-wide">pro</span>`;
        } else {
            cardStrip.innerHTML = `<span class="text-blue-400 text-xl mr-2">✦</span> <span class="text-white font-bold text-lg tracking-wide">Starter</span>`;
        }
    }

    const badge = document.getElementById('current-commission-badge');
    if(badge) {
        badge.innerText = `${plan.commission}% Platform Fee`;
        badge.className = planId === 'pro' 
            ? "bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-black border border-indigo-200"
            : "bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-black border border-slate-200";
    }

    ['free', 'pro'].forEach(id => {
        const card = document.getElementById(`plan-${id}`);
        const icon = card.querySelector('.active-icon');
        if(!card) return;

        if(id === planId) {
            card.classList.add('ring-2', 'ring-indigo-500', 'bg-indigo-50/30');
            card.classList.remove('border-slate-200');
            if(icon) icon.classList.remove('hidden');
        } else {
            card.classList.remove('ring-2', 'ring-indigo-500', 'bg-indigo-50/30');
            card.classList.add('border-slate-200');
            if(icon) icon.classList.add('hidden');
        }
    });
}

window.buySubscription = async (selectedPlanId) => {
    const user = auth.currentUser;
    const uid = user.uid;
    const snap = await getDoc(doc(db, "users", uid));
    const currentPlan = snap.data()?.plan || 'free';

    if(selectedPlanId === currentPlan) return showToast("You are already on this plan.", "info");

    const plan = PLANS[selectedPlanId];

    if(selectedPlanId === 'free') {
        if(await showConfirm("Switch to Starter?", "Your platform fee will increase to 10%.", "Confirm Switch")) {
            await applyPlanChange(plan);
        }
        return;
    }

    const confirmed = await showConfirm(
        `Upgrade to ${plan.name}`, 
        `Pay ₹${plan.price} & reduce platform fee to ${plan.commission}%.`, 
        `Pay ₹${plan.price}`
    );

    if (confirmed) {
        showToast("Connecting to secure server...", "info");
        try {
            const response = await fetch(CLOUDFLARE_API_URL, {
                method: "POST", 
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId: plan.id, userId: uid })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Server response failed");
            }
            
            const data = await response.json();

            const options = {
                key: "rzp_test_SIJksJUo2OFec5", 
                amount: plan.price * 100, 
                currency: "INR",
                name: "Interkun", 
                description: `${plan.name} Subscription`,
                order_id: data.id,
                handler: async function (response) {
                    try {
                        showToast("Payment Successful! Upgrading...", "info");
                        await applyPlanChange(plan, response.razorpay_payment_id, response.razorpay_order_id, response.razorpay_signature);
                    } catch (error) { 
                        showToast("Upgrade failed. Contact support.", "error"); 
                    }
                },
                prefill: { email: user.email, name: user.displayName || "" },
                theme: { color: "#4F46E5" }
            };

            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', function (response){ 
                alert(`Payment Failed: ${response.error.description}`); 
            });
            rzp.open();

        } catch(e) { 
            console.error("Cloudflare Worker Error:", e);
            alert("Error: " + e.message); 
        }
    }
};

async function applyPlanChange(plan, paymentId = null, orderId = null, signature = null) {
    try {
        const uid = auth.currentUser.uid;
        await updateDoc(doc(db, "users", uid), { plan: plan.id, commissionRate: plan.commission, planUpdatedAt: serverTimestamp() });
        await updateDoc(doc(db, "sellers", uid), { platformFee: plan.commission }).catch(()=>{});

        if (paymentId) {
            await addDoc(collection(db, "transactions"), {
                userId: uid, type: "subscription", planName: plan.name, amount: plan.price,
                paymentId, orderId, signature, status: "success", createdAt: serverTimestamp()
            });
        }
        showToast(`Plan upgraded to ${plan.name} 🎉`, 'success');
    } catch (e) { showToast('Action failed', 'error'); }
}

// --- 3. SECURITY & FIXED LOGOUT ---
window.handlePasswordReset = async () => {
    const user = auth.currentUser;
    if(await showConfirm('Reset Password?', `Send link to ${user.email}?`, 'Send Email')) {
        try { await sendPasswordResetEmail(auth, user.email); showToast('Check your email inbox.', 'success'); } 
        catch (e) { showToast(e.message, 'error'); }
    }
};

// ==========================================
// 4. GOOGLE MEET INTEGRATION LOGIC
// ==========================================

// Jab user Google se wapas aata hai, toh URL se token nikal kar save karna
async function checkGoogleAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get('status');
    const creatorId = urlParams.get('creatorId');
    const refreshToken = urlParams.get('refreshToken');

    if (status === 'success' && refreshToken && creatorId) {
        try {
            // URL ko clean kar do taaki refresh karne par dobara call na ho
            window.history.replaceState({}, document.title, window.location.pathname);
            
            showToast("Saving connection...", "info");
            
            // Token ko user ke Firestore document mein save karna
            await updateDoc(doc(db, "users", creatorId), {
                googleRefreshToken: refreshToken,
                googleConnectedAt: serverTimestamp()
            });

            showToast("Google Meet Connected! 🎉", "success");
        } catch (error) {
            console.error("Error saving token:", error);
            showToast("Failed to save connection", "error");
        }
    }
}

// Button Click: Worker par redirect karna
window.connectGoogleCalendar = () => {
    const user = auth.currentUser;
    if (!user) return showToast("Please login first", "error");
    
    // Aapka worker URL
    const workerUrl = "https://googlemeet.interkunhq.workers.dev/google/login";
    
    // Frontend redirect kar dega worker par, creatorId ke sath
    window.location.href = `${workerUrl}?creatorId=${user.uid}`;
};

// Disconnect Handle Karna
window.disconnectGoogleCalendar = async () => {
    if(await showConfirm("Disconnect Google?", "New meetings will not be auto-scheduled.", "Yes, Disconnect")) {
        try {
            const uid = auth.currentUser.uid;
            await updateDoc(doc(db, "users", uid), {
                googleRefreshToken: null // Database se token hata do
            });
            showToast("Google Meet Disconnected", "success");
        } catch (error) {
            showToast("Error disconnecting", "error");
        }
    }
};

window.handleLogout = async () => {
    const btn = document.getElementById('btn-logout');
    const txt = document.getElementById('txt-logout');
    
    if(await showConfirm("Log Out?", "Are you sure you want to exit?", "Yes, Logout")) {
        try {
            // Visual Feedback: Button ko click hote hi badal do
            if(btn) btn.classList.add('opacity-50', 'pointer-events-none');
            if(txt) txt.innerText = "Logging out...";
            
            await auth.signOut();
            window.location.reload(); 
        } catch (error) {
            if(btn) btn.classList.remove('opacity-50', 'pointer-events-none');
            if(txt) txt.innerText = "Log Out";
            showToast("Error logging out", "error");
        }
    }
};

const setText = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
const setValue = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };