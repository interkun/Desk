import { db, auth } from "../firebase.js";
import { 
    collection, query, where, orderBy, doc, updateDoc, serverTimestamp, onSnapshot, limit, Timestamp, getDoc, addDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { showToast } from "../services/sweet-alert.js";

let state = {
    user: null,
    bookings: [],
    filter: 'pending', 
    searchTerm: '',
    selectedId: null,
    selectedType: null,
    selectedUserId: null, // NAYA: User ko notification bhejne ke liye
    unsubscribe: null
};

// --- INIT ---
export async function init() {
    if(state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            state.user = user;
            setupRealtimeListener();
        }
    });
}
window.loadBooking = init;

// --- LISTENER ---
function setupRealtimeListener() {
    const loader = document.getElementById('booking-loader');
    if(loader) loader.classList.remove('hidden');

    const q = query(
        collection(db, "bookings"),
        where("sellerId", "==", state.user.uid),
        orderBy("createdAt", "desc"),
        limit(100)
    );

    state.unsubscribe = onSnapshot(q, (snapshot) => {
        state.bookings = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        updateUI();
        if(loader) loader.classList.add('hidden');
    });
}

// --- CORE RENDER LOGIC ---
function updateUI() {
    const pendingCount = state.bookings.filter(b => b.status === 'pending').length;
    const badge = document.getElementById('badge-pending');
    if(badge) {
        badge.innerText = pendingCount;
        badge.classList.toggle('hidden', pendingCount === 0);
    }
    document.getElementById('stat-total').innerText = state.bookings.length;

    let filtered = state.bookings.filter(b => b.status === state.filter);
    
    if(state.searchTerm) {
        const term = state.searchTerm.toLowerCase();
        filtered = filtered.filter(b => 
            (b.userName || '').toLowerCase().includes(term) || 
            (b.serviceTitle || '').toLowerCase().includes(term)
        );
    }

    const grid = document.getElementById('booking-grid');
    const empty = document.getElementById('booking-empty');
    grid.innerHTML = '';

    if(filtered.length === 0) {
        if(empty) empty.classList.remove('hidden');
        return;
    }
    if(empty) empty.classList.add('hidden');

    filtered.forEach(b => grid.insertAdjacentHTML('beforeend', createCard(b)));
}

// --- UPDATED CARD COMPONENT ---
function createCard(b) {
    let dateObj = new Date();
    let isScheduled = false;

    if (b.scheduledAt) {
        if (b.scheduledAt.seconds) {
            dateObj = new Date(b.scheduledAt.seconds * 1000); 
        } else {
            dateObj = new Date(b.scheduledAt); 
        }
        isScheduled = true;
    } else if (b.createdAt && b.createdAt.seconds) {
        dateObj = new Date(b.createdAt.seconds * 1000);
    }
    
    const today = new Date();
    const isToday = dateObj.toDateString() === today.toDateString();
    
    let dateDisplay = isScheduled ? dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Pending Schedule';
    if(isToday && isScheduled) dateDisplay = "Today";
    
    const timeDisplay = isScheduled ? dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

    const typeMap = {
        'call': { icon: 'fa-video', bg: 'bg-purple-50', text: 'text-purple-600', label: '1:1 Video Call' },
        'dm': { icon: 'fa-comments', bg: 'bg-orange-50', text: 'text-orange-600', label: 'Priority DM' },
        'webinar': { icon: 'fa-users', bg: 'bg-blue-50', text: 'text-blue-600', label: 'Webinar' }
    };
    const style = typeMap[b.type] || typeMap['call'];

    let footerHtml = '';
    
    // YAHAN LOGIC CHANGE HUA HAI
    if(b.status === 'pending') {
        footerHtml = `
            <div class="grid grid-cols-2 gap-2 mt-4">
                 <button onclick="window.openReschedule('${b.id}')" class="py-2.5 rounded-xl text-[10px] font-bold bg-slate-50 text-slate-600 hover:bg-slate-100 transition">
                    Reschedule
                </button>
                <button onclick="window.openApprove('${b.id}', '${b.type}', '${b.userId}')" class="py-2.5 rounded-xl text-[10px] font-bold bg-slate-900 text-white shadow-md">
                    Accept & Link
                </button>
            </div>`;
    } 
    else if (b.status === 'confirmed') {
        // 🚀 FIX: Agar link nahi hai, toh Creator ko "Add Link" ka button do
        let primaryBtn = '';
        if (b.meetLink && b.meetLink.trim() !== '') {
            primaryBtn = `<a href="${b.meetLink}" target="_blank" class="flex-[2] py-2.5 rounded-xl bg-blue-600 text-white text-[10px] font-black text-center shadow-lg shadow-blue-200 hover:bg-blue-700 transition flex items-center justify-center">
                            <i class="fa-solid fa-door-open mr-1"></i> JOIN MEETING
                           </a>`;
        } else {
            primaryBtn = `<button onclick="window.openApprove('${b.id}', 'call', '${b.userId}')" class="flex-[2] py-2.5 rounded-xl bg-orange-500 text-white text-[10px] font-black text-center shadow-lg shadow-orange-200 hover:bg-orange-600 transition flex items-center justify-center">
                            <i class="fa-solid fa-link mr-1"></i> ADD MEET LINK
                           </button>`;
        }
        
        footerHtml = `
            <div class="flex flex-col gap-2 mt-4">
                <div class="flex gap-2">
                    ${primaryBtn}
                    <button onclick="window.openReschedule('${b.id}')" class="flex-1 py-2.5 rounded-xl bg-slate-50 text-slate-600 text-[10px] font-bold hover:bg-slate-100 transition border border-slate-100">
                        Edit Time
                    </button>
                </div>
                <button onclick="window.markCompleted('${b.id}')" class="w-full py-2 text-[10px] font-bold text-emerald-600 border border-emerald-100 rounded-xl bg-emerald-50/30 hover:bg-emerald-50">
                    Mark Session as Completed
                </button>
            </div>
        `;
    }

    return `
        <div class="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm relative group">
            <div class="flex justify-between items-start mb-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-2xl ${style.bg} ${style.text} flex items-center justify-center text-sm shadow-inner">
                        <i class="fa-solid ${style.icon}"></i>
                    </div>
                    <div>
                        <h4 class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${style.label}</h4>
                        <p class="text-xs font-bold text-slate-800">${dateDisplay} ${timeDisplay ? 'at ' + timeDisplay : ''}</p>
                    </div>
                </div>
                <span class="px-2 py-1 rounded-lg text-[9px] font-black uppercase ${b.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}">${b.status}</span>
            </div>

            <div class="bg-slate-50 rounded-2xl p-3 border border-slate-100 mb-2">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 shadow-sm">
                            ${(b.userName || 'U').charAt(0).toUpperCase()}
                        </div>
                        <p class="text-xs font-bold text-slate-700">${b.userName || 'Client'}</p>
                    </div>
                    ${b.meetLink ? `
                    <button onclick="window.copyLink('${b.meetLink}')" class="text-slate-400 hover:text-blue-600 p-1">
                        <i class="fa-solid fa-copy text-xs"></i>
                    </button>` : ''}
                </div>
            </div>

            ${footerHtml}
        </div>`;
}

// --- ACTIONS ---
window.filterBookings = (status) => {
    state.filter = status;
    ['pending', 'confirmed', 'completed', 'cancelled'].forEach(s => {
        const btn = document.getElementById(`tab-${s}`);
        if (btn) {
            btn.className = s === status 
                ? "filter-tab px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 bg-slate-900 text-white shadow-md"
                : "filter-tab px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 text-slate-500 hover:bg-slate-50";
        }
    });
    updateUI();
};

window.handleSearch = (e) => {
    state.searchTerm = e.target.value;
    updateUI();
};

window.copyLink = (url) => {
    navigator.clipboard.writeText(url);
    showToast("Link Copied!", "success");
};

window.openReschedule = (id) => {
    state.selectedId = id;
    document.getElementById('modal-reschedule').classList.remove('hidden');
};

window.confirmReschedule = async () => {
    const dateVal = document.getElementById('res-date').value;
    const timeVal = document.getElementById('res-time').value;

    if(!dateVal || !timeVal) return showToast("Select Date & Time", "warning");

    const btn = document.querySelector('#modal-reschedule button[onclick="window.confirmReschedule()"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Updating Time...`;
    btn.disabled = true;

    try {
        const newDateTimeStr = `${dateVal}T${timeVal}`;
        const sellerId = state.user.uid;

        const bookingSnap = await getDoc(doc(db, "bookings", state.selectedId));
        const bookingData = bookingSnap.data();
        if (!bookingData) throw new Error("Booking not found");

        const userSnap = await getDoc(doc(db, "users", bookingData.userId));
        const clientEmail = userSnap.data()?.email || "client@example.com";

        let newMeetLink = bookingData.meetLink;

        if (bookingData.status === 'confirmed') {
            const startTimeISO = new Date(`${dateVal}T${timeVal}:00`).toISOString();
            const endTimeDate = new Date(`${dateVal}T${timeVal}:00`);
            endTimeDate.setMinutes(endTimeDate.getMinutes() + 45); 
            const endTimeISO = endTimeDate.toISOString();

            const response = await fetch("https://googlemeet.interkunhq.workers.dev/create-meeting", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    creatorId: sellerId, 
                    startTime: startTimeISO,
                    endTime: endTimeISO,
                    summary: `Rescheduled Call: ${bookingData.title || 'Session'}`,
                    description: `This session was rescheduled by the creator.\nClient Email: ${clientEmail}`,
                    guestEmail: clientEmail 
                })
            });

            const apiData = await response.json();
            if (apiData.success && apiData.meetLink) {
                newMeetLink = apiData.meetLink; 
            }
        }
        
        await updateDoc(doc(db, "bookings", state.selectedId), {
            scheduledAt: newDateTimeStr, 
            meetLink: newMeetLink || "",
            rescheduled: true,
            updatedAt: serverTimestamp()
        });

        const formattedTime = new Date(newDateTimeStr).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
        await addDoc(collection(db, "notifications"), {
            userId: bookingData.userId,
            title: "Session Rescheduled! ⏳",
            message: `${state.user.displayName || 'Creator'} has rescheduled your session to ${formattedTime}.`,
            type: "warning", 
            read: false,
            link: "#library",
            createdAt: serverTimestamp()
        });

        showToast("Session Rescheduled & Notified!", "success");
        window.closeModals();
    } catch(e) {
        showToast("Update Failed: " + e.message, "error");
    } finally {
        if(btn) { btn.innerHTML = originalText; btn.disabled = false; }
    }
};

// --- APPROVE & LINK LOGIC (USER NOTIFICATION ADDED) ---
window.openApprove = (id, type, userId) => {
    state.selectedId = id;
    state.selectedType = type;
    state.selectedUserId = userId; // User ka ID save kiya

    document.getElementById('modal-approve').classList.remove('hidden');
    
    const content = document.getElementById('approve-content');
    if(type === 'call') {
        content.innerHTML = `
            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Meeting Link</label>
            <input type="url" id="inp-meet-link" placeholder="Paste GMeet / Zoom Link" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none">
        `;
    } else {
        content.innerHTML = `<p class="text-sm font-bold text-slate-600 text-center">Confirm this session?</p>`;
    }
    
    document.getElementById('btn-approve-action').onclick = async () => {
        const btn = document.getElementById('btn-approve-action');
        btn.innerText = "Processing...";
        btn.disabled = true;

        try {
            let data = { status: 'confirmed', updatedAt: serverTimestamp() };
            let link = "";

            if(type === 'call') {
                link = document.getElementById('inp-meet-link').value;
                if(!link) {
                    btn.innerText = "Confirm"; btn.disabled = false;
                    return showToast("Link required", "warning");
                }
                data.meetLink = link;
            }

            // 1. Update Booking
            await updateDoc(doc(db, "bookings", state.selectedId), data);

            // 2. 🚀 Send Notification to User
            if (state.selectedUserId) {
                await addDoc(collection(db, "notifications"), {
                    userId: state.selectedUserId,
                    title: "Meeting Link Added! 🔗",
                    message: `The creator has shared the meeting link for your upcoming session. Check your library.`,
                    type: "meeting", // Renders purple icon
                    read: false,
                    link: "#library",
                    createdAt: serverTimestamp()
                });
            }

            window.closeModals();
            showToast("Link Shared & Client Notified!", "success");
        } catch (error) {
            console.error(error);
            showToast("Failed to share link", "error");
        } finally {
            btn.innerText = "Confirm"; btn.disabled = false;
        }
    };
};

window.markCompleted = async (id) => updateDoc(doc(db, "bookings", id), { status: 'completed' });
window.deleteBooking = async (id) => { if(confirm("Delete record?")) updateDoc(doc(db, "bookings", id), { status: 'cancelled' }); };
window.closeModals = () => document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));