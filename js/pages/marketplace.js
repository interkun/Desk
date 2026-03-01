import { db, auth } from "../firebase.js";
import { 
    doc, getDoc, updateDoc, collection, query, where, orderBy, limit, getDocs, setDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { requireAuth } from "../services/auth-guard.js";
import { formatCurrency } from "../services/formatters.js";
import { showToast } from "../services/sweet-alert.js";

// --- CONSTANTS FOR IMAGES ---
const DEFAULT_AVATAR = "https://ui-avatars.com/api/?name=User&background=f1f5f9&color=64748b";
const DEFAULT_COVER = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop";

// End mein /upload lagana zaroori hai!
const CLOUDFLARE_WORKER_URL = "https://interkun-dp.interkunhq.workers.dev";
// --- STATE MANAGER ---
const state = {
    user: null,
    profile: null,
    isOnline: false, 
    usernameAvailable: true
};

// --- CACHE MANAGER ---
const Cache = {
    get: (key) => {
        const cached = sessionStorage.getItem(key);
        return cached ? JSON.parse(cached) : null;
    },
    set: (key, data) => sessionStorage.setItem(key, JSON.stringify(data)),
    clear: (key) => sessionStorage.removeItem(key)
};

// --- INIT ---
export async function init() {
    console.log("[DASHBOARD] System Booting...");
    
    try {
        state.user = await requireAuth();
        await loadProfile();
        loadStats();
        loadRecentActivity();
        setupEventListeners();
    } catch (e) {
        console.error("Dashboard Init Error:", e);
    }
}

window.loadMarketplace = init;

// --- 1. CORE DATA LOGIC ---
async function loadProfile() {
    const cachedProfile = Cache.get(`profile_${state.user.uid}`);
    
    if (cachedProfile) {
        state.profile = cachedProfile;
        renderHeader(cachedProfile);
    } 

    try {
        const docRef = doc(db, "sellers", state.user.uid);
        const snap = await getDoc(docRef);
        
        if (snap.exists()) {
            state.profile = snap.data();
            Cache.set(`profile_${state.user.uid}`, state.profile); 
            renderHeader(state.profile);
        } else {
            await createInitialProfile();
        }
    } catch(e) { console.error("Profile Fetch Error", e); }
}

async function createInitialProfile() {
    const newProfile = {
        uid: state.user.uid,
        email: state.user.email,
        shopName: state.user.displayName || "Creator",
        username: state.user.uid.substring(0, 8), 
        isOnline: false,
        createdAt: serverTimestamp(),
        stats: { totalEarnings: 0, followersCount: 0, totalSales: 0, pageViews: 0 }
    };
    await setDoc(doc(db, "sellers", state.user.uid), newProfile);
    state.profile = newProfile;
    renderHeader(newProfile);
}

function renderHeader(p) {
    
setText('dash-greeting', `Hello, ${p.shopName.split(' ')[0]} \u{1F44B}`);

    setText('dash-username', `@${p.username}`);
    
    const avatar = p.shopLogo || p.photoURL || DEFAULT_AVATAR;
    const imgEl = document.getElementById('dash-user-avatar');
    if(imgEl) imgEl.src = avatar;

    state.isOnline = p.isOnline || false;
    updateOnlineBtnUI();
}

// --- NEW: Number Formatter (K, M) ---
const formatMetric = (num) => {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num.toString();
};

async function loadStats() {
    const s = state.profile.stats || {};
    
    //
    const views = s.pageViews || 0;
    const sales = s.totalSales || 0;
    const followers = s.followersCount || 0;
    
    // 1. Conversion Rate Calculate
    let conversionRate = 0;
    if (views > 0) {
        conversionRate = ((sales / views) * 100).toFixed(1);
    }

    // 2. UI (formatMetric)
    setText('stat-revenue', formatCurrency(s.totalEarnings || 0));
    
    // formatMetric
    setText('stat-followers', formatMetric(followers));
    setText('stat-sales', formatMetric(sales));
    setText('stat-views', formatMetric(views));
    
    // Conversion Rate
    setText('stat-conversion', `${conversionRate}%`);
}

async function loadRecentActivity() {
    const feed = document.getElementById('activity-feed');
    if(!feed) return;

    // 5 10-
    const q = query(
        collection(db, "orders"), 
        where("sellerId", "==", state.user.uid),
        orderBy("createdAt", "desc"),
        limit(10)
    );

    try {
        const snap = await getDocs(q);
        const noActivity = document.getElementById('no-activity');

        if(snap.empty) {
            feed.innerHTML = '';
            if(noActivity) noActivity.classList.remove('hidden');
        } else {
            if(noActivity) noActivity.classList.add('hidden');
            
            feed.innerHTML = snap.docs.map(doc => {
                const data = doc.data();
                const date = data.createdAt?.seconds ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'Just now';
                
                // --- Status Badge Logic ---
                const isComplete = data.status === 'completed';
                const isPending = data.status === 'pending';
                
                let colorClass = 'bg-blue-100 text-blue-600';
                let icon = 'fa-bag-shopping';
                
                if(isComplete) { colorClass = 'bg-emerald-100 text-emerald-600'; icon = 'fa-check'; }
                if(isPending) { colorClass = 'bg-orange-100 text-orange-600'; icon = 'fa-clock'; }

                // --- UI Render ---
                return `
                <div class="flex justify-between items-center p-3 hover:bg-slate-50 rounded-xl transition cursor-default border-b border-slate-50 last:border-0 group animate-fade-in">
                    <div class="flex gap-3 items-center">
                        <div class="w-8 h-8 rounded-full ${colorClass} flex items-center justify-center shrink-0 font-bold text-xs shadow-sm">
                            <i class="fa-solid ${icon}"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-slate-800 truncate">${data.itemTitle || 'Service / Product'}</p>
                            <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">${data.status || 'Success'} • ${date}</p>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <span class="text-sm font-black text-emerald-600">${formatCurrency(data.amount)}</span>
                    </div>
                </div>
                `;
            }).join('');
        }
    } catch (e) {
        console.warn("Feed Error:", e);
    }
}

// --- 2. LIVE SWITCH LOGIC ---
window.toggleOnlineStatus = async () => {
    const btn = document.getElementById('btn-status-toggle');
    if(btn) btn.classList.add('animate-pulse');

    const newStatus = !state.isOnline;
    
    try {
        await updateDoc(doc(db, "sellers", state.user.uid), {
            isOnline: newStatus,
            lastSeen: serverTimestamp()
        });
        
        state.isOnline = newStatus;
        state.profile.isOnline = newStatus;
        Cache.set(`profile_${state.user.uid}`, state.profile); 
        updateOnlineBtnUI();
        
        showToast(newStatus ? "You are now ONLINE" : "You are now OFFLINE", "success");
    } catch(e) {
        showToast("Failed to update status", "error");
    } finally {
        if(btn) btn.classList.remove('animate-pulse');
    }
};

function updateOnlineBtnUI() {
    const btn = document.getElementById('btn-status-toggle');
    const txt = document.getElementById('txt-status-label');
    
    if(state.isOnline) {
        btn.className = "w-8 h-8 rounded-full bg-green-500 transition-all flex items-center justify-center shadow-lg shadow-green-200 scale-110";
        txt.innerText = "Online";
        txt.className = "text-[10px] font-bold text-green-600 uppercase tracking-wide";
    } else {
        btn.className = "w-8 h-8 rounded-full bg-slate-300 transition-all flex items-center justify-center shadow-sm";
        txt.innerText = "Offline";
        txt.className = "text-[10px] font-bold text-slate-400 uppercase tracking-wide";
    }
}

// --- 3. EDIT STUDIO & KYC ---
window.openEditStudio = () => {
    const modal = document.getElementById('edit-studio-modal');
    const panel = document.getElementById('edit-studio-panel');
    const p = state.profile;

    if(!modal || !panel || !p) return;

    setValue('edit-name', p.shopName);
    setValue('edit-bio', p.bio);
    setValue('edit-username', p.username);
    
    document.getElementById('edit-cover-preview').src = p.coverImage || DEFAULT_COVER;
    document.getElementById('edit-logo-preview').src = p.shopLogo || DEFAULT_AVATAR;

    const kyc = p.kyc || {};
    setValue('kyc-upi', kyc.upiId);
    setValue('kyc-acc-no', kyc.accountNumber);
    setValue('kyc-ifsc', kyc.ifscCode);

    const s = p.socials || {};
    const platforms = ['instagram', 'youtube', 'linkedin', 'twitter', 'telegram'];
    platforms.forEach(plat => {
        setValue(`social-${plat}-link`, s[plat]?.url);
        setValue(`social-${plat}-count`, s[plat]?.count);
    });

    modal.classList.remove('hidden');
    setTimeout(() => panel.classList.remove('translate-x-full'), 10);
};

window.closeEditStudio = () => {
    const modal = document.getElementById('edit-studio-modal');
    const panel = document.getElementById('edit-studio-panel');
    panel.classList.add('translate-x-full');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

window.checkUsername = async () => {
    const input = getValue('edit-username').toLowerCase();
    const msg = document.getElementById('username-msg');
    
    if(input.length < 3) {
        msg.innerText = "Too short"; msg.className = "text-[10px] mt-1 font-bold text-red-500";
        return;
    }
    if(input === state.profile.username) {
         msg.innerText = "Current username"; msg.className = "text-[10px] mt-1 font-bold text-blue-500";
         state.usernameAvailable = true;
         return;
    }

    const q = query(collection(db, "sellers"), where("username", "==", input));
    const snap = await getDocs(q);

    if(snap.empty) {
        msg.innerText = "Available!"; msg.className = "text-[10px] mt-1 font-bold text-green-500";
        state.usernameAvailable = true;
    } else {
        msg.innerText = "Taken"; msg.className = "text-[10px] mt-1 font-bold text-red-500";
        state.usernameAvailable = false;
    }
};

window.saveProfileChanges = async () => {
    if(!state.usernameAvailable) return showToast("Username unavailable", "error");

    const btn = document.getElementById('btn-save-profile');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Saving...`;
    btn.disabled = true;

    try {
        const coverFile = document.getElementById('edit-cover-input').files[0];
        const logoFile = document.getElementById('edit-logo-input').files[0];
        
        let coverUrl = state.profile.coverImage || null;
        let logoUrl = state.profile.shopLogo || null;

        if(coverFile) coverUrl = await uploadViaCloudflareWorker(coverFile, "profile-assets");
        if(logoFile) logoUrl = await uploadViaCloudflareWorker(logoFile, "profile-assets");

        const platforms = ['instagram', 'youtube', 'linkedin', 'twitter', 'telegram'];
        let socialData = {};
        let totalFollowers = 0;

        platforms.forEach(plat => {
            const link = getValue(`social-${plat}-link`);
            const rawCount = getValue(`social-${plat}-count`).replace(/,/g, ''); 
            const count = parseInt(rawCount) || 0;
            if(link) {
                socialData[plat] = { url: link, count: count };
                totalFollowers += count;
            }
        });

        const updates = {
            shopName: getValue('edit-name'),
            bio: getValue('edit-bio'),
            username: getValue('edit-username').toLowerCase(),
            coverImage: coverUrl,
            shopLogo: logoUrl,
            kyc: {
                upiId: getValue('kyc-upi'),
                accountNumber: getValue('kyc-acc-no'),
                ifscCode: getValue('kyc-ifsc').toUpperCase()
            },
            socials: socialData,
            "stats.followersCount": totalFollowers,
            updatedAt: serverTimestamp()
        };

        // 1. Firebase mein profile update karo
        await updateDoc(doc(db, "sellers", state.user.uid), updates);
        
        // ==========================================================
        // 2. AWS TYPESENSE SEARCH ENGINE MEIN SAVE KARO
        // ==========================================================
        try {
            // WARNING: Is URL ko apne Asli Worker URL se replace zaroor karna
            const SEARCH_WORKER_URL = "https://search.interkunhq.workers.dev"; 
            
            const creatorSearchData = {
                id: state.user.uid,
                shopName: updates.shopName,
                username: updates.username,
                shopLogo: updates.shopLogo || "https://placehold.co/100?text=C",
                bio: updates.bio || "",
                followersCount: totalFollowers
            };

            // Worker ko data bhejo
            await fetch(`${SEARCH_WORKER_URL}/api/index-creator`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(creatorSearchData)
            });
            console.log("Creator Indexed in AWS successfully!");
        } catch(e) { 
            console.error("Creator Indexing Failed:", e); 
        }
        // ==========================================================
        
        // 3. UI aur Cache ko update karo
        state.profile = { ...state.profile, ...updates };
        if(!state.profile.stats) state.profile.stats = {};
        state.profile.stats.followersCount = totalFollowers;

        Cache.set(`profile_${state.user.uid}`, state.profile);

        showToast("Profile Saved Successfully!", "success");
        renderHeader(state.profile); 
        window.closeEditStudio();

    } catch (e) {
        console.error("Profile Save Error:", e);
        showToast("Save failed. Try again.", "error");
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
    }
};

// --- NEW SECURE UPLOAD UTILITY FOR 1M USERS (VIA CLOUDFLARE WORKER) ---
async function uploadViaCloudflareWorker(file, folderName = "profile-assets") {
    if (!file) return null;

    // File ka safe naam banana (Spaces hatakar)
    const safeFileName = `${folderName}/${Date.now()}-${file.name.replace(/\s+/g, '-')}`;

    try {
        // Step 1: Cloudflare Worker se S3 Pre-signed URL mangwana
        // Hum yahan /upload route use kar rahe hain jo humne naye worker mein banaya hai
        const res = await fetch(`${CLOUDFLARE_WORKER_URL}/upload?fileName=${encodeURIComponent(safeFileName)}`);
        
        if (!res.ok) {
            const errorText = await res.text();
            console.error("Worker Error:", res.status, errorText);
            throw new Error(`Failed to get pre-signed URL: ${res.status}`);
        }
        
        const { uploadUrl, publicUrl } = await res.json();

        // Step 2: Seedha AWS S3 bucket mein file upload (PUT) karna
        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            body: file,
            headers: {
                'Content-Type': file.type // S3 ko batana ki ye image hai
            }
        });

        if (!uploadRes.ok) throw new Error("File upload failed to AWS S3");

        // Step 3: S3 ka public URL wapas dena jo Database mein save hoga
        return publicUrl; 

    } catch (err) {
        console.error("Upload Logic Error:", err);
        showToast("Upload failed. Please check connection.", "error");
        throw err;
    }
}

// --- 4. SHARE & UTILS ---
window.openShareModal = () => {
    document.getElementById('share-modal').classList.remove('hidden');
    document.getElementById('share-modal-img').src = state.profile.shopLogo || DEFAULT_AVATAR;
    
    // Naya aur sahi URL format
    const link = `${window.location.origin}/creator?id=@${state.profile.username || state.user.uid}`;
    const linkInput = document.getElementById('share-link-input');
    if(linkInput) linkInput.value = link;
};

window.closeShareModal = () => {
    document.getElementById('share-modal').classList.add('hidden');
};

window.copyProfileLink = () => {
    // Copy karne ke liye sahi URL
    const link = `${window.location.origin}/creator?id=@${state.profile.username || state.user.uid}`;
    navigator.clipboard.writeText(link).then(() => {
        showToast("Link Copied!", "success");
    });
};

window.openProfile = () => {
    // Naye tab mein open karne ke liye sahi URL
    const link = `${window.location.origin}/creator?id=@${state.profile.username || state.user.uid}`;
    window.open(link, '_blank');
};

// Uske baad seedha aapka setupEventListeners function aana chahiye:
function setupEventListeners() {
    bindPreview('edit-cover-input', 'edit-cover-preview');
    bindPreview('edit-logo-input', 'edit-logo-preview');
}

function bindPreview(inputId, imgId) {
    document.getElementById(inputId)?.addEventListener('change', (e) => {
        if(e.target.files[0]) {
            document.getElementById(imgId).src = URL.createObjectURL(e.target.files[0]);
        }
    });
}

const setText = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
const setValue = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
const getValue = (id) => document.getElementById(id)?.value.trim();

// Start
init();