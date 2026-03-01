import { db, auth } from "../firebase.js";
import { 
    collection, query, where, onSnapshot, orderBy, doc, updateDoc, getDocs, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { showToast, showConfirm } from "../services/sweet-alert.js";

console.log("🚀 Project Scheduler: Linked to Projects");

let isPageActive = false;
let unsubscribe = null;
let allScheduledProjects = [];

// --- 1. OPEN MODAL ---
window.openScheduleModal = function(preSelectedDate = null) {
    const modal = document.getElementById('scheduleModal');
    if(modal) modal.classList.remove('hidden');
    document.getElementById('scheduleForm').reset();

    // Default Date logic
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('scheduleDate').value = preSelectedDate || today;
    document.getElementById('scheduleDate').min = today;
};

window.closeScheduleModal = () => document.getElementById('scheduleModal').classList.add('hidden');
window.setSmartTime = (time) => document.getElementById('scheduleTime').value = time;

// --- 2. HANDLE SCHEDULING (Connected to Projects) ---
window.handleSchedule = async function(e) {
    e.preventDefault();
    const projectId = document.getElementById('schedulePostId').value; // Now selecting Projects
    const date = document.getElementById('scheduleDate').value;
    const time = document.getElementById('scheduleTime').value;
    
    // Validate Past Date
    if (new Date(`${date}T${time}`) < new Date()) {
        return showToast("Cannot schedule in the past!", "error");
    }

    if (!projectId) return showToast("Please select a project.", "warning");

    // Conflict Check
    const hasConflict = allScheduledProjects.some(p => p.scheduleDate === date && p.scheduleTime === time && p.id !== projectId);
    if (hasConflict && !await showConfirm("Conflict!", "Another project is scheduled then. Overlap?", "Yes")) return;

    const btn = e.target.querySelector('button[type="submit"]');
    btn.innerText = "Scheduling...";
    btn.disabled = true;

    try {
        // 🔥 UPDATED: Updating 'projects' collection instead of 'posts'
        await updateDoc(doc(db, "projects", projectId), {
            scheduleDate: date,
            scheduleTime: time,
            status: 'Published', // Auto move to Published/Scheduled stage
            updatedAt: serverTimestamp()
        });
        
        window.closeScheduleModal();
        showToast("Project Scheduled!", "success");
    } catch (error) {
        showToast(error.message, "error");
    } finally {
        btn.innerText = "Schedule";
        btn.disabled = false;
    }
};

window.removeSchedule = async function(id) {
    if(await showConfirm("Unschedule?", "Project moves back to Editing stage.", "Unschedule")) {
        try {
            await updateDoc(doc(db, "projects", id), {
                scheduleDate: null, 
                scheduleTime: null,
                status: 'Editing' // Move back to Editing
            });
            showToast("Schedule removed.", "success");
        } catch (e) { showToast("Error removing schedule", "error"); }
    }
};

// --- 3. SYNC & DATA LOADING ---
function startSync() {
    if (isPageActive) return;
    const user = auth.currentUser;
    if (!user) { setTimeout(startSync, 500); return; }
    isPageActive = true;

    loadProjectsForDropdown(user.uid);

    // 🔥 UPDATED: Listening to 'projects' collection
    const q = query(
        collection(db, "projects"),
        where("userId", "==", user.uid),
        where("scheduleDate", "!=", null), 
        orderBy("scheduleDate", "asc")
    );
    
    unsubscribe = onSnapshot(q, (snapshot) => {
        const listContainer = document.getElementById('upcoming-list');
        if(!listContainer) return;
        
        listContainer.innerHTML = '';
        allScheduledProjects = [];
        
        if (snapshot.empty) listContainer.innerHTML = `<div class="text-center text-slate-400 py-4 text-xs">No upcoming projects.</div>`;

        snapshot.forEach(docSnap => {
            const proj = docSnap.data();
            allScheduledProjects.push({ id: docSnap.id, ...proj }); 
            renderScheduledItem(listContainer, docSnap.id, proj);
        });
        
        updateCalendar(allScheduledProjects); 
    });
}

function stopSync() {
    if (isPageActive) { isPageActive = false; if (unsubscribe) unsubscribe(); }
}

// --- 4. HELPERS ---
async function loadProjectsForDropdown(uid) {
    const dropdown = document.getElementById('schedulePostId');
    if(!dropdown) return;
    dropdown.innerHTML = '<option value="">Loading...</option>';

    const q = query(collection(db, "projects"), where("userId", "==", uid), where("status", "!=", "Published"));
    const snap = await getDocs(q);
    
    dropdown.innerHTML = '<option value="" disabled selected>Select a Project</option>';
    snap.forEach(d => {
        const p = d.data();
        // Showing status in uppercase to match settings style
        dropdown.innerHTML += `<option value="${d.id}">${p.name.toUpperCase()} [${p.status}]</option>`;
    });
}

function renderScheduledItem(container, id, project) {
    const date = new Date(project.scheduleDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const div = document.createElement('div');
    
    // Classes matched with Settings Plan Cards
    div.className = "flex justify-between items-center p-3 border border-slate-100 bg-white rounded-2xl hover:border-slate-200 transition mb-3 shadow-sm";
    
    div.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center shadow-sm">
                <i class="fas fa-clock text-[10px]"></i>
            </div>
            <div>
                <h4 class="text-xs font-black text-slate-800 truncate w-32 md:w-40">${project.name}</h4>
                <p class="text-[9px] text-slate-400 font-bold uppercase tracking-wider">${date} � ${project.scheduleTime}</p>
            </div>
        </div>
        <button onclick="window.removeSchedule('${id}')" class="w-8 h-8 rounded-full hover:bg-red-50 text-slate-300 hover:text-red-500 transition flex items-center justify-center">
            <i class="fas fa-times text-xs"></i>
        </button>
    `;
    container.appendChild(div);
}

function updateCalendar(projects) {
    const calendarEl = document.getElementById('calendar-view');
    if (!calendarEl) return;
    
    const today = new Date();
    // Added more gap for cleaner look
    let html = '<div class="grid grid-cols-7 gap-2 h-full">';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(today.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const dayName = days[d.getDay()];
        
        // Settings style: Today gets dark background, others light
        const isTodayHeader = i === 0 ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500';
        const isTodayCard = i === 0 ? 'border-slate-300 shadow-md' : 'border-slate-100';
        
        const dailyProjs = projects.filter(p => p.scheduleDate === dateStr);

        html += `
            <div onclick="window.openScheduleModal('${dateStr}')" class="flex flex-col h-full bg-white border ${isTodayCard} rounded-2xl overflow-hidden cursor-pointer hover:border-indigo-300 transition group shadow-sm">
                <div class="p-2 text-center text-[9px] font-black uppercase tracking-tighter ${isTodayHeader}">${dayName} ${d.getDate()}</div>
                <div class="flex-1 p-1.5 space-y-1 overflow-y-auto bg-white">
                    ${dailyProjs.map(p => `
                        <div class="px-2 py-1.5 bg-indigo-50/50 text-indigo-700 rounded-lg text-[8px] font-black truncate border border-indigo-100/50">
                            ${p.scheduleTime} ${p.name}
                        </div>
                    `).join('')}
                    ${dailyProjs.length === 0 ? '<div class="h-full flex items-center justify-center opacity-10"><i class="fas fa-plus text-[10px]"></i></div>' : ''}
                </div>
            </div>`;
    }
    calendarEl.innerHTML = html + '</div>';
}

// Observer & Init
const observer = new MutationObserver(() => {
    const el = document.getElementById('calendar-view');
    if (el && !isPageActive) startSync();
    else if (!el && isPageActive) stopSync();
});
observer.observe(document.body, { childList: true, subtree: true });
if(document.getElementById('calendar-view')) startSync();