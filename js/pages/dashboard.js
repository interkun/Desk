import { db, auth } from "../firebase.js";
import { collection, query, where, getDocs, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { formatCurrency } from "../services/formatters.js";

console.log(" Business Dashboard Loaded");

let isDashboardLoaded = false;

// --- WATCHER (Smart Reload) ---
function startDashboardWatcher() {
    setInterval(() => {
        const el = document.getElementById('dash-revenue');
        if (el) {
            if (el.innerText === '0' || !isDashboardLoaded) {
                const user = auth.currentUser;
                if (user) {
                    loadAllData(user);
                    isDashboardLoaded = true;
                }
            }
        } else {
            isDashboardLoaded = false;
        }
    }, 1500);
}

async function loadAllData(user) {
    updateGreeting(user);
    await Promise.all([
        fetchFinanceOverview(user.uid),
        fetchProjectOverview(user.uid),
        fetchInboxOverview(user.uid),
        fetchLatestNote(user.uid)
    ]);
}

function updateGreeting(user) {
    const h = new Date().getHours();
    const g = h < 12 ? "Good Morning" : h < 18 ? "Good Afternoon" : "Good Evening";
    
    const timeEl = document.getElementById('greeting-time');
    const nameEl = document.getElementById('user-name');
    
    if(timeEl) timeEl.innerText = g;
    if(nameEl) nameEl.innerText = user.displayName ? user.displayName.split(' ')[0] : 'Partner';
}

// --- 1. REVENUE (This Month) ---
async function fetchFinanceOverview(uid) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    
    const q = query(collection(db, "transactions"), where("userId", "==", uid));
    const snap = await getDocs(q);
    
    let profit = 0;
    snap.forEach(d => {
        const t = d.data();
        if (t.date >= startOfMonth) {
            if (t.type === 'income') profit += t.amount;
            else profit -= t.amount;
        }
    });

    const el = document.getElementById('dash-revenue');
    if(el) el.innerText = formatCurrency(profit);
}

// --- 2. PROJECTS & TASKS ---
async function fetchProjectOverview(uid) {
    const q = query(collection(db, "projects"), where("userId", "==", uid));
    const snap = await getDocs(q);
    
    // Update Count
    const countEl = document.getElementById('dash-projects');
    if(countEl) countEl.innerText = snap.size;

    // Update Urgent List
    const list = document.getElementById('urgent-tasks-list');
    if(!list) return;
    list.innerHTML = '';
    
    let tasksFound = false;
    
    // Sort locally by High priority first
    const projects = snap.docs.map(d => d.data()).sort((a,b) => (a.priority === 'High' ? -1 : 1));

    projects.slice(0, 4).forEach(p => {
        tasksFound = true;
        const isHigh = p.priority === 'High';
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 rounded-xl cursor-pointer transition border border-transparent hover:border-slate-200";
        div.onclick = () => window.location.hash = '#projects';
        
        div.innerHTML = `
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-2 h-2 rounded-full ${isHigh ? 'bg-red-500 animate-pulse' : 'bg-blue-500'}"></div>
                <div>
                    <h4 class="text-xs font-bold text-slate-700 truncate">${p.name}</h4>
                    <p class="text-[9px] font-bold text-slate-400 uppercase">${p.status || 'Active'}</p>
                </div>
            </div>
            <span class="text-[9px] font-black px-2 py-1 rounded ${isHigh ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}">
                ${p.priority || 'NORMAL'}
            </span>
        `;
        list.appendChild(div);
    });

    if(!tasksFound) {
        list.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-slate-300 py-4"><i class="fas fa-check-circle text-2xl mb-1"></i><p class="text-[10px] font-bold">All clear!</p></div>`;
    }
}

// --- 3. INBOX & DEALS (UPDATED FOR PENDING BOOKINGS) ---
async function fetchInboxOverview(uid) {
    // 1. Bookings collection se "pending" data fetch karna
    const q = query(
        collection(db, "bookings"), 
        where("sellerId", "==", uid),
        where("status", "==", "pending") // Sirf pending bookings laayein
    );
    
    const snap = await getDocs(q);
    
    // 2. "Potential Deals" ke number ko pending count se update karna
    const dealEl = document.getElementById('dash-deals');
    if(dealEl) dealEl.innerText = snap.size; // snap.size se total pending count mil jayega

    // 3. Niche ki Recent Activity list ko update karna
    const list = document.getElementById('recent-activity-list');
    if(!list) return;
    list.innerHTML = '';

    // Agar koi pending booking nahi hai
    if(snap.empty) {
        list.innerHTML = '<p class="text-[10px] text-slate-400 text-center py-4 font-bold">No pending deals</p>';
        return;
    }

    // Firebase Index Error se bachne ke liye JavaScript mein sort karna (Newest first)
    const pendingBookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    pendingBookings.sort((a, b) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeB - timeA;
    });

    // Sirf top 5 pending dikhane ke liye
    pendingBookings.slice(0, 5).forEach(b => {
        const div = document.createElement('div');
        div.className = "flex items-start gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition";
        div.onclick = () => window.location.hash = '#booking'; // Click karne par booking page khul jayega

        div.innerHTML = `
            <div class="w-8 h-8 rounded-full bg-orange-50 border border-orange-100 flex items-center justify-center shrink-0 text-orange-500 shadow-sm">
                <i class="fa-regular fa-clock text-xs"></i>
            </div>
            <div class="min-w-0 flex-1 pt-0.5">
                <div class="flex justify-between items-center mb-0.5">
                    <p class="text-[11px] font-bold text-slate-800 truncate pr-2">${b.userName || 'Client'}</p>
                    <span class="text-[8px] font-black text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded uppercase">Pending</span>
                </div>
                <p class="text-[10px] text-slate-500 truncate capitalize">${b.type || 'Session'} Request</p>
            </div>
        `;
        list.appendChild(div);
    });
}

// --- 4. NOTE PREVIEW ---
async function fetchLatestNote(uid) {
    // This is a placeholder. In real app, fetch from localStorage or Firestore 'notes' collection.
    const note = localStorage.getItem(`notekun_${uid}`);
    const el = document.getElementById('dash-note-preview');
    if(el && note) {
        el.innerText = note.substring(0, 50) + "...";
    }
}

// Start
startDashboardWatcher();