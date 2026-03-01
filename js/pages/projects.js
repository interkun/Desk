import { db, auth } from "../firebase.js";
import { 
    collection, addDoc, query, where, getDocs, orderBy, limit, startAfter,
    doc, deleteDoc, updateDoc, serverTimestamp, writeBatch, onSnapshot, getCountFromServer 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { showToast, showConfirm } from "../services/sweet-alert.js";

// --- STATE MANAGEMENT ---
let state = {
    user: null,
    projects: [],
    lastDoc: null,
    isLoading: false,
    hasMore: true,
    filter: 'All', 
    searchQuery: '',
    searchTimeout: null,
    activeProjectId: null
};

let listeners = {
    tasks: null,
    chat: null
};

// Creator Templates
const TEMPLATES = {
    'YouTube': { icon: 'fa-youtube', color: 'text-red-500', tasks: ['Idea', 'Scripting', 'Filming', 'Editing', 'Thumbnail', 'Upload'] },
    'Instagram': { icon: 'fa-instagram', color: 'text-pink-500', tasks: ['Concept', 'Filming', 'Editing', 'Caption', 'Post'] },
    'Sponsorship': { icon: 'fa-handshake', color: 'text-blue-500', tasks: ['Proposal', 'Negotiation', 'Contract', 'Content', 'Invoice'] }
};

// --- INITIALIZATION ---
export async function init() {
    console.log("[PROJECTS] Engine v2.1 Loaded (Compact & Stats Fixed)");
    
    auth.onAuthStateChanged(user => {
        if (user) {
            state.user = user;
            resetAndLoadProjects();
            setupTemplatesUI();
        }
    });

    const grid = document.getElementById('projects-grid');
    if(grid) {
        grid.addEventListener('scroll', () => {
            if(grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 50) {
                window.loadMoreProjects();
            }
        });
    }
}

window.loadProjects = init;

// --- CORE DATA LOGIC ---

async function resetAndLoadProjects() {
    state.projects = [];
    state.lastDoc = null;
    state.hasMore = true;
    document.getElementById('projects-grid').innerHTML = ''; 
    
    // 🔥 Fix: Update Counts Immediately
    updateCounts(); 
    
    await fetchProjects();
}

// 🔥 New Function to Count Documents for Stats
async function updateCounts() {
    if(!state.user) return;

    try {
        const coll = collection(db, "projects");
        
        // 1. Total
        const qAll = query(coll, where("userId", "==", state.user.uid));
        const snapAll = await getCountFromServer(qAll);
        setText('count-all', snapAll.data().count);

        // 2. In Progress (Idea, Scripting, Filming)
        const qProg = query(coll, where("userId", "==", state.user.uid), where("status", "in", ["Idea", "Scripting", "Filming"]));
        const snapProg = await getCountFromServer(qProg);
        setText('count-active', snapProg.data().count);

        // 3. Editing
        const qEdit = query(coll, where("userId", "==", state.user.uid), where("status", "==", "Editing"));
        const snapEdit = await getCountFromServer(qEdit);
        setText('count-review', snapEdit.data().count);

        // 4. Published
        const qDone = query(coll, where("userId", "==", state.user.uid), where("status", "==", "Published"));
        const snapDone = await getCountFromServer(qDone);
        setText('count-done', snapDone.data().count);

    } catch(e) {
        console.error("Error fetching counts:", e);
    }
}

async function fetchProjects() {
    if (state.isLoading || !state.hasMore) return;
    state.isLoading = true;

    const loader = document.getElementById('load-more-container');
    if(loader) loader.classList.remove('hidden');

    try {
        let constraints = [
            where("userId", "==", state.user.uid),
            orderBy("createdAt", "desc"),
            limit(20)
        ];

        // Filter Logic
        if (state.filter === 'In Progress') {
            constraints = [where("userId", "==", state.user.uid), where("status", "in", ["Idea", "Scripting", "Filming"]), orderBy("createdAt", "desc"), limit(20)];
        } else if (state.filter !== 'All') {
            constraints = [where("userId", "==", state.user.uid), where("status", "==", state.filter), orderBy("createdAt", "desc"), limit(20)];
        }

        if (state.lastDoc) constraints.push(startAfter(state.lastDoc));

        const q = query(collection(db, "projects"), ...constraints);
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            state.hasMore = false;
            if(state.projects.length === 0) document.getElementById('empty-state').classList.remove('hidden');
        } else {
            state.lastDoc = snapshot.docs[snapshot.docs.length - 1];
            const newProjects = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            state.projects = [...state.projects, ...newProjects];
            renderProjectList(newProjects);
        }

    } catch (e) {
        console.warn("Query Error (Check Indexes):", e);
    } finally {
        state.isLoading = false;
        if(loader) loader.classList.add('hidden');
    }
}

window.loadMoreProjects = fetchProjects;

function renderProjectList(projects) {
    const grid = document.getElementById('projects-grid');
    document.getElementById('empty-state').classList.add('hidden');

    projects.forEach(p => {
        if (state.searchQuery && !p.name.toLowerCase().includes(state.searchQuery)) return;

        const el = document.createElement('div');
        
        // Status Colors
        let statusColor = 'bg-slate-100 text-slate-600';
        if(p.status === 'Idea') statusColor = 'bg-purple-50 text-purple-600';
        if(p.status === 'Filming') statusColor = 'bg-red-50 text-red-600';
        if(p.status === 'Published') statusColor = 'bg-emerald-50 text-emerald-600';
        if(p.status === 'Scripting') statusColor = 'bg-blue-50 text-blue-600';
        if(p.status === 'Editing') statusColor = 'bg-orange-50 text-orange-600';

        const progress = p.totalTasks > 0 ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0;

        el.className = "bg-white p-4 rounded-3xl border border-slate-100 shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer group relative";
        el.onclick = () => window.openTaskModal(p.id, p.name);

        // Removed Team Avatars from HTML below
        el.innerHTML = `
            <div class="flex justify-between items-start mb-3">
                <span class="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border border-transparent ${statusColor}">
                    ${p.status || 'Draft'}
                </span>
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="event.stopPropagation(); window.editProject('${p.id}')" class="w-7 h-7 rounded-full bg-slate-50 hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition flex items-center justify-center"><i class="fas fa-pen text-xs"></i></button>
                    <button onclick="event.stopPropagation(); window.deleteProject('${p.id}')" class="w-7 h-7 rounded-full bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 transition flex items-center justify-center"><i class="fas fa-trash text-xs"></i></button>
                </div>
            </div>

            <h4 class="text-base font-black text-slate-800 mb-1 line-clamp-1">${p.name}</h4>
            <p class="text-xs font-medium text-slate-500 mb-4 line-clamp-2 h-8">${p.description || 'No description added.'}</p>

            <div class="flex items-center gap-2 mb-3">
                <div class="flex-1 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div class="h-full bg-slate-800 rounded-full transition-all duration-500" style="width: ${progress}%"></div>
                </div>
                <span class="text-[9px] font-bold text-slate-400">${progress}%</span>
            </div>

            <div class="flex justify-between items-center border-t border-slate-50 pt-3">
                <div class="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                    <i class="far fa-clock"></i> ${p.deadline ? new Date(p.deadline).toLocaleDateString(undefined, {month:'short', day:'numeric'}) : 'No Date'}
                </div>
                ${p.link ? `<a href="${p.link}" target="_blank" onclick="event.stopPropagation()" class="text-slate-400 hover:text-blue-600 text-xs"><i class="fas fa-external-link-alt"></i></a>` : ''}
            </div>
        `;
        grid.appendChild(el);
    });
}

// --- SEARCH & FILTER ---

window.handleSearch = (e) => {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => {
        state.searchQuery = e.target.value.toLowerCase();
        resetAndLoadProjects(); 
    }, 400); 
};

window.setProjectFilter = (status) => {
    state.filter = status === 'Total' ? 'All' : status;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('ring-2', 'ring-blue-100'));
    
    // Fix ID matching
    let btnId = 'filter-All';
    if(status === 'In Progress') btnId = 'filter-Progress';
    else if(status === 'Editing') btnId = 'filter-Editing';
    else if(status === 'Published') btnId = 'filter-Published';
    
    const btn = document.getElementById(btnId);
    if(btn) btn.classList.add('ring-2', 'ring-blue-100');
    
    resetAndLoadProjects();
};

// --- ACTIONS ---

window.openProjectModal = () => {
    document.getElementById('projectModal').classList.remove('hidden');
    document.getElementById('projectForm').reset();
    document.getElementById('editingProjectId').value = '';
    document.getElementById('projectModalTitle').innerText = "Start New Project";
    document.getElementById('saveProjectBtn').innerText = "Launch Project";
};

window.editProject = (id) => {
    const p = state.projects.find(x => x.id === id);
    if(!p) return;

    document.getElementById('projectModal').classList.remove('hidden');
    document.getElementById('editingProjectId').value = id;
    document.getElementById('projectModalTitle').innerText = "Edit Details";
    document.getElementById('saveProjectBtn').innerText = "Save Changes";
    
    document.getElementById('projectName').value = p.name;
    document.getElementById('projectDesc').value = p.description || '';
    document.getElementById('projectStage').value = p.status || 'Idea';
    document.getElementById('projectDeadline').value = p.deadline || '';
    document.getElementById('projectLink').value = p.link || '';
};

window.closeProjectModal = () => document.getElementById('projectModal').classList.add('hidden');

window.handleSaveProject = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveProjectBtn');
    btn.disabled = true; btn.innerText = "Processing...";

    try {
        const id = document.getElementById('editingProjectId').value;
        const name = document.getElementById('projectName').value;
        const status = document.getElementById('projectStage').value;
        const desc = document.getElementById('projectDesc').value;
        const deadline = document.getElementById('projectDeadline').value;
        const link = document.getElementById('projectLink').value;
        const templateKey = document.getElementById('selectedTemplate').value;

        // Note: 'team' field removed from data object
        const data = {
            userId: state.user.uid,
            name, status, description: desc, deadline, link,
            updatedAt: serverTimestamp()
        };

        if (id) {
            await updateDoc(doc(db, "projects", id), data);
            showToast("Project Updated", "success");
        } else {
            data.createdAt = serverTimestamp();
            data.completedTasks = 0;
            data.totalTasks = 0;
            
            const docRef = await addDoc(collection(db, "projects"), data);
            
            if(templateKey && TEMPLATES[templateKey]) {
                const batch = writeBatch(db);
                TEMPLATES[templateKey].tasks.forEach(tName => {
                    const tRef = doc(collection(db, "projects", docRef.id, "tasks"));
                    batch.set(tRef, { name: tName, completed: false, createdAt: serverTimestamp() });
                });
                await updateDoc(docRef, { totalTasks: TEMPLATES[templateKey].tasks.length });
                await batch.commit();
            }
            showToast("Project Launched!", "success");
        }
        
        window.closeProjectModal();
        resetAndLoadProjects();

    } catch(err) {
        showToast("Error saving project", "error");
        console.error(err);
    } finally {
        btn.disabled = false;
    }
};

// --- TASKS & CHAT ---
// (Tasks & Chat Logic Remains Same, no changes needed there)

window.openTaskModal = (id, title) => {
    state.activeProjectId = id;
    document.getElementById('taskModal').classList.remove('hidden');
    document.getElementById('taskModalTitle').innerText = title;
    document.getElementById('currentProjectId').value = id;
    window.switchProjectTab('tasks');
    subscribeToTasks(id);
};

window.closeTaskModal = () => {
    document.getElementById('taskModal').classList.add('hidden');
    state.activeProjectId = null;
    if(listeners.tasks) listeners.tasks();
    if(listeners.chat) listeners.chat();
};

window.switchProjectTab = (tab) => {
    const taskView = document.getElementById('view-tasks');
    const chatView = document.getElementById('view-chat');
    const btnTask = document.getElementById('tab-tasks');
    const btnChat = document.getElementById('tab-chat');

    if(tab === 'tasks') {
        taskView.classList.remove('hidden');
        chatView.classList.add('hidden');
        btnTask.className = "text-xs font-bold text-blue-600 border-b-2 border-blue-600 pb-1";
        btnChat.className = "text-xs font-bold text-slate-400 hover:text-slate-600 pb-1";
        if(listeners.chat) listeners.chat();
        subscribeToTasks(state.activeProjectId);
    } else {
        taskView.classList.add('hidden');
        chatView.classList.remove('hidden');
        btnChat.className = "text-xs font-bold text-blue-600 border-b-2 border-blue-600 pb-1";
        btnTask.className = "text-xs font-bold text-slate-400 hover:text-slate-600 pb-1";
        if(listeners.tasks) listeners.tasks();
        subscribeToChat(state.activeProjectId);
    }
};

function subscribeToTasks(pid) {
    const list = document.getElementById('taskList');
    list.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin text-slate-400"></i></div>';
    
    if(listeners.tasks) listeners.tasks();

    const q = query(collection(db, "projects", pid, "tasks"), orderBy("createdAt", "asc"));
    
    listeners.tasks = onSnapshot(q, (snap) => {
        list.innerHTML = '';
        let completed = 0;
        
        if(snap.empty) list.innerHTML = `<p class="text-center text-[10px] text-slate-400 py-4 uppercase font-bold tracking-wider">No Tasks Yet</p>`;

        snap.forEach(d => {
            const t = d.data();
            if(t.completed) completed++;
            
            const div = document.createElement('div');
            div.className = `flex items-center justify-between p-3 rounded-xl border ${t.completed ? 'bg-slate-50 border-transparent opacity-60' : 'bg-white border-slate-100'} transition`;
            div.innerHTML = `
                <label class="flex items-center gap-3 cursor-pointer flex-1">
                    <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="window.toggleTask('${pid}', '${d.id}', this.checked)" 
                        class="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-0">
                    <span class="text-xs font-bold ${t.completed ? 'line-through text-slate-400' : 'text-slate-700'}">${t.name}</span>
                </label>
                <button onclick="window.deleteTask('${pid}', '${d.id}')" class="text-slate-300 hover:text-red-500 px-2"><i class="fas fa-times"></i></button>
            `;
            list.appendChild(div);
        });
        updateDoc(doc(db, "projects", pid), { totalTasks: snap.size, completedTasks: completed });
    });
}

window.handleAddTask = async (e) => {
    e.preventDefault();
    const input = document.getElementById('taskName');
    const pid = document.getElementById('currentProjectId').value;
    if(!input.value.trim()) return;
    await addDoc(collection(db, "projects", pid, "tasks"), { name: input.value.trim(), completed: false, createdAt: serverTimestamp() });
    input.value = '';
};

window.toggleTask = async (pid, tid, status) => { await updateDoc(doc(db, "projects", pid, "tasks", tid), { completed: status }); };
window.deleteTask = async (pid, tid) => deleteDoc(doc(db, "projects", pid, "tasks", tid));

function subscribeToChat(pid) {
    const list = document.getElementById('chatList');
    list.innerHTML = '<div class="text-center py-4"><i class="fas fa-circle-notch fa-spin text-slate-300"></i></div>';
    if(listeners.chat) listeners.chat();
    const q = query(collection(db, "projects", pid, "comments"), orderBy("createdAt", "asc"));
    listeners.chat = onSnapshot(q, (snap) => {
        list.innerHTML = '';
        if(snap.empty) { list.innerHTML = `<div class="text-center py-10 opacity-50"><p class="text-[10px]">Start discussion</p></div>`; return; }
        snap.forEach(d => {
            const m = d.data();
            const isMe = m.senderId === state.user.uid;
            const div = document.createElement('div');
            div.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'} mb-2`;
            div.innerHTML = `<div class="max-w-[80%] ${isMe ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-700'} px-4 py-2 rounded-2xl text-xs font-medium">${m.text}</div>`;
            list.appendChild(div);
        });
        list.scrollTop = list.scrollHeight;
    });
}

window.handleSendChat = async (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const pid = document.getElementById('currentProjectId').value;
    if(!input.value.trim()) return;
    await addDoc(collection(db, "projects", pid, "comments"), { text: input.value.trim(), senderId: state.user.uid, createdAt: serverTimestamp() });
    input.value = '';
};

function setupTemplatesUI() {
    const c = document.getElementById('template-container');
    if(!c) return;
    c.innerHTML = '';
    Object.keys(TEMPLATES).forEach(key => {
        const t = TEMPLATES[key];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.onclick = () => {
            document.getElementById('selectedTemplate').value = key;
            document.querySelectorAll('.tpl-btn').forEach(b => b.classList.remove('bg-blue-50', 'border-blue-500'));
            btn.classList.add('bg-blue-50', 'border-blue-500');
        };
        btn.className = "tpl-btn flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition shrink-0";
        btn.innerHTML = `<i class="fab ${t.icon} ${t.color}"></i> <span class="text-xs font-bold text-slate-700">${key}</span>`;
        c.appendChild(btn);
    });
}

window.deleteProject = async (id) => {
    if(!await showConfirm("Delete Project?", "Irreversible.", "Delete")) return;
    try {
        await deleteDoc(doc(db, "projects", id));
        state.projects = state.projects.filter(p => p.id !== id);
        renderProjectList(state.projects); 
        updateCounts(); // Refresh Stats
        showToast("Project Deleted", "success");
    } catch(e) { showToast("Error deleting", "error"); }
};

const setText = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };