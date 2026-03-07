import { db, auth } from "../firebase.js";
import { 
    collection, query, where, orderBy, getDocs, doc, updateDoc, serverTimestamp, addDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { requireAuth } from "../services/auth-guard.js";

let state = {
    user: null,
    allMessages: [],
    currentTab: 'pending',
    searchTerm: ''
};

export async function init() {
    state.user = await requireAuth();
    await loadMessages();
}
window.loadMessagesPage = init; 

// ✅ FIX: Firebase Index aur Permission Denied Error Bypass
async function loadMessages() {
    const loader = document.getElementById('messages-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        // Sirf sellerId se data mangwayenge (Rules ke hisaab se yeh 100% allow hai)
        const q = query(
            collection(db, "bookings"),
            where("sellerId", "==", state.user.uid),
            orderBy("createdAt", "desc")
        );

        const snap = await getDocs(q);

        // Saare documents nikal lo
        const allData = snap.docs.map(doc => {
            return { id: doc.id, ...doc.data() };
        });

        // ✅ JS mein sirf "dm" filter kar lo (Index banane ki zaroorat hi nahi padegi)
        state.allMessages = allData
            .filter(b => b.type === "dm")
            .map(item => {
                return {
                    ...item,
                    sortDate: item.messageSentAt?.seconds || item.purchasedAt?.seconds || 0
                };
            }).sort((a, b) => b.sortDate - a.sortDate);

        refreshDisplay();

    } catch (error) {
        console.error("Error loading messages:", error);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function switchTab(tab) {
    state.currentTab = tab;
    
    ['pending', 'completed'].forEach(s => {
        const btn = document.getElementById(`tab-${s}`);
        if (btn) {
            btn.className = s === tab
                ? "filter-tab px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 bg-slate-900 text-white shadow-md"
                : "filter-tab px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 text-slate-500 hover:bg-slate-50";
        }
    });
    refreshDisplay();
}

function handleSearch(e) {
    state.searchTerm = e.target.value;
    refreshDisplay();
}

function refreshDisplay() {
    const container = document.getElementById('messages-grid');
    const empty = document.getElementById('messages-empty');
    if (!container) return;
    
    container.innerHTML = '';

    // 1. Update Badge & Counts
    const pendingCount = state.allMessages.filter(b => b.status === 'pending').length;
    const badge = document.getElementById('badge-pending-msgs');
    if(badge) {
        badge.innerText = pendingCount;
        badge.classList.toggle('hidden', pendingCount === 0);
    }
    const totalEl = document.getElementById('stat-total-msgs');
    if(totalEl) totalEl.innerText = state.allMessages.length;

    // 2. Tab Filter
    let filtered = state.allMessages.filter(item => {
        return state.currentTab === 'pending' ? item.status === 'pending' : item.status === 'completed';
    });

    // 3. Search Filter
    if(state.searchTerm) {
        const term = state.searchTerm.toLowerCase();
        filtered = filtered.filter(b => 
            (b.userName || '').toLowerCase().includes(term) || 
            (b.title || '').toLowerCase().includes(term) ||
            (b.userQuery || '').toLowerCase().includes(term)
        );
    }

    if (filtered.length === 0) {
        if(empty) empty.classList.remove('hidden');
        return;
    }
    if(empty) empty.classList.add('hidden');

    // 4. Render Cards
    filtered.forEach(item => {
        const dateStr = item.messageSentAt 
            ? new Date(item.messageSentAt.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) 
            : 'Waiting for user';

        const hasUserQueried = item.userQuery && item.userQuery.length > 0;
        
        let actionBtn = '';
        if (state.currentTab === 'pending') {
            if (hasUserQueried) {
                const safeQuery = item.userQuery.replace(/'/g, "&apos;").replace(/"/g, "&quot;");
                actionBtn = `<button onclick="window.MessagesAdmin.openModal('${item.id}', '${safeQuery}')" 
                    class="w-full mt-3 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-bold shadow-md hover:bg-slate-800 transition">
                    Write Reply
                </button>`;
            } else {
                actionBtn = `<button disabled 
                    class="w-full mt-3 py-2 bg-slate-50 border border-slate-100 text-slate-400 rounded-xl text-[10px] font-bold cursor-not-allowed">
                    Waiting for user
                </button>`;
            }
        } else {
            actionBtn = `<div class="mt-3 pt-3 border-t border-slate-100 text-[10px] font-medium text-slate-600 line-clamp-2">
                <span class="font-bold text-emerald-600">Reply:</span> ${item.sellerReply || ''}
            </div>`;
        }

        const badgeToUse = state.currentTab === 'completed' 
            ? `<span class="text-[9px] font-bold text-emerald-600 uppercase tracking-widest"><i class="fa-solid fa-check-double mr-1"></i>Answered</span>`
            : (hasUserQueried 
                ? `<span class="bg-orange-50 text-orange-600 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider inline-block">Needs Action</span>`
                : `<span class="bg-slate-100 text-slate-500 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider inline-block">Awaiting User</span>`);

        const cardHTML = `
            <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] hover:border-orange-100 transition group relative flex flex-col justify-between">
                <div>
                    <div class="flex justify-between items-start mb-3">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center text-sm">
                                <i class="fa-solid fa-comments"></i>
                            </div>
                            <div>
                                <h4 class="text-xs font-black text-slate-800 uppercase tracking-wide">DM Session</h4>
                                <div class="flex items-center gap-1.5 mt-0.5">
                                    <i class="fa-regular fa-clock text-[10px] text-slate-400"></i>
                                    <span class="text-[10px] font-bold text-slate-600">${dateStr}</span>
                                </div>
                            </div>
                        </div>
                        ${badgeToUse}
                    </div>
                    <div class="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <p class="text-[10px] font-bold text-slate-400 uppercase mb-1">Client: ${item.userName || 'Guest User'}</p>
                        <p class="text-sm font-bold text-slate-800 truncate mb-1">${item.title}</p>
                        <div class="border-t border-slate-200/60 pt-2 mt-1">
                            <p class="text-[11px] text-slate-600 font-medium italic line-clamp-2">
                                "${item.userQuery || 'No question submitted yet...'}"
                            </p>
                        </div>
                    </div>
                </div>
                ${actionBtn}
            </div>
        `;
        container.insertAdjacentHTML('beforeend', cardHTML);
    });
}

function openModal(id, userQuery) {
    document.getElementById('hidden-booking-id').value = id;
    document.getElementById('modal-reply-id').innerText = `ID: ${id.substring(0, 8).toUpperCase()}`;
    document.getElementById('modal-user-query').innerText = userQuery;
    document.getElementById('admin-reply-text').value = '';
    document.getElementById('admin-reply-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('admin-reply-modal').classList.add('hidden');
}

// ✅ FIX: Reply ke baad user ko notification bhi bhejo
async function sendReply() {
    const id = document.getElementById('hidden-booking-id').value;
    const replyText = document.getElementById('admin-reply-text').value.trim();
    const btn = document.getElementById('btn-send-reply');

    if (!replyText) return alert("Please write a reply before sending.");

    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;
    btn.disabled = true;

    try {
        await updateDoc(doc(db, "bookings", id), {
            sellerReply: replyText,
            repliedAt: serverTimestamp(),
            status: 'completed',
            updatedAt: serverTimestamp()
        });

        const bookingData = state.allMessages.find(m => m.id === id);
        if (bookingData?.userId) {
            await addDoc(collection(db, "notifications"), {
                userId: bookingData.userId,
                title: "Creator ne reply diya! 💬",
                message: `${state.user.displayName || 'Creator'} ne aapke DM question ka jawab de diya. Library mein check karein.`,
                type: "sale",
                read: false,
                link: "#library",
                createdAt: serverTimestamp()
            });
        }

        closeModal();
        await loadMessages(); 
    } catch (e) {
        console.error("Reply Error:", e);
        alert("Failed to send reply. Please try again.");
    } finally {
        btn.innerHTML = `<span>Send Reply</span> <i class="fa-solid fa-paper-plane text-[10px]"></i>`;
        btn.disabled = false;
    }
}

// Export
window.MessagesAdmin = {
    switchTab,
    openModal,
    closeModal,
    sendReply,
    handleSearch
};
