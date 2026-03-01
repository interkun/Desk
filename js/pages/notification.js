import { db, auth } from "../firebase.js"; 
import { 
    collection, query, where, orderBy, limit, getDocs, addDoc, serverTimestamp,
    doc, updateDoc, writeBatch, deleteDoc, onSnapshot 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let unsubscribe = null;

export function init() {
    const user = auth.currentUser;
    if(user) {
        loadNotifications(user.uid);
    } else {
        renderState('empty'); // You can change this to redirect to login
    }
}

// Ensure this is globally available for the router
window.loadNotification = init;

function loadNotifications(uid) {
    const list = document.getElementById('full-notify-list');
    
    if(list) list.innerHTML = `<div class="flex flex-col items-center justify-center py-20"><i class="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500 mb-4"></i><p class="text-slate-500 text-sm">Loading...</p></div>`;

    const q = query(
        collection(db, "notifications"),
        where("userId", "==", uid),
        orderBy("createdAt", "desc"),
        limit(50)
    );

    unsubscribe = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            renderState('empty');
            return;
        }
        renderState('list');
        renderList(snapshot.docs);
    });
}

function renderList(docs) {
    const list = document.getElementById('full-notify-list');
    if(!list) return;

    list.innerHTML = docs.map(docSnap => {
        const item = { id: docSnap.id, ...docSnap.data() };
        
        // Advanced Multi-Type Styling
        let style = { icon: 'fa-circle-info', bg: 'bg-slate-50', text: 'text-slate-500' };

        if(item.type === 'money') style = { icon: 'fa-indian-rupee-sign', bg: 'bg-emerald-50', text: 'text-emerald-600' };
        if(item.type === 'sale') style = { icon: 'fa-cart-shopping', bg: 'bg-blue-50', text: 'text-blue-600' }; // Digital Asset Sale
        if(item.type === 'meeting') style = { icon: 'fa-calendar-check', bg: 'bg-indigo-50', text: 'text-indigo-600' }; // New 1:1 Booking
        if(item.type === 'webinar') style = { icon: 'fa-tower-broadcast', bg: 'bg-red-50', text: 'text-red-600' };
        if(item.type === 'warning') style = { icon: 'fa-triangle-exclamation', bg: 'bg-orange-50', text: 'text-orange-600' };

        const unreadClass = !item.read ? 'bg-blue-50/20 border-l-4 border-l-blue-500' : 'bg-white';
        
        return `
        <div onclick="window.NotifyPage.handleClick('${item.id}', '${item.link || '#'}')" 
             class="relative flex gap-4 p-5 cursor-pointer hover:bg-slate-50 transition border-b border-slate-50 ${unreadClass}">
            
            <div class="w-12 h-12 rounded-2xl ${style.bg} ${style.text} flex items-center justify-center shrink-0 text-lg shadow-sm">
                <i class="fa-solid ${style.icon}"></i>
            </div>

            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-center mb-0.5">
                    <h4 class="text-sm font-black text-slate-800">${item.title}</h4>
                    <span class="text-[9px] text-slate-400 font-bold uppercase">${timeAgo(item.createdAt)}</span>
                </div>
                <p class="text-xs text-slate-500 line-clamp-2 leading-relaxed font-medium">
                    ${item.message}
                </p>
            </div>
        </div>`;
    }).join('');
}

function renderState(state) {
    const list = document.getElementById('full-notify-list');
    const empty = document.getElementById('notify-empty');
    if(!list || !empty) return;

    if (state === 'empty') {
        list.classList.add('hidden');
        empty.classList.remove('hidden');
    } else {
        list.classList.remove('hidden');
        empty.classList.add('hidden');
    }
}

// --- GLOBAL EXPORTS ---
window.NotifyPage = {
    handleClick: async (id, link) => {
        if(link && link !== '#') window.location.hash = link;
        try { await updateDoc(doc(db, "notifications", id), { read: true }); } catch(e) {}
    },
    delete: async (id) => {
        try { await deleteDoc(doc(db, "notifications", id)); } catch(e) { console.error(e); }
    },
    markAllRead: async () => {
        const btn = document.querySelector("#mark-read-btn"); 
        if(btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

        try {
            const user = auth.currentUser;
            if(!user) return;
            const q = query(collection(db, "notifications"), where("userId", "==", user.uid), where("read", "==", false));
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                const batch = writeBatch(db);
                snapshot.forEach((doc) => batch.update(doc.ref, { read: true }));
                await batch.commit();
            }
            if(btn) { btn.innerHTML = '<i class="fa-solid fa-check"></i> <span class="hidden sm:inline">Done</span>'; setTimeout(() => btn.innerHTML = '<i class="fa-solid fa-check-double"></i> <span class="hidden sm:inline">Mark all read</span>', 2000); }
        } catch (error) { console.error(error); }
    },

    // 🚀 NEW: Function to send notifications easily
    sendTestNotification: async () => {
        const user = auth.currentUser;
        if(!user) return alert("Login first!");
        
        try {
            await addDoc(collection(db, "notifications"), {
                userId: user.uid,
                title: "New Order Received! 🎉",
                message: "Someone just purchased your 'React Mastery' course.",
                type: "order", // Types: 'info', 'success', 'warning', 'money', 'order'
                read: false,
                link: "#finance", // Where it should go on click
                createdAt: serverTimestamp()
            });
            alert("Notification Sent! Check the UI.");
        } catch(e) { console.error(e); }
    }
};

function timeAgo(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return "Just now";
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return date.toLocaleDateString();
}