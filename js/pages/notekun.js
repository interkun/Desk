import { db, auth } from "../firebase.js";
import { 
    collection, addDoc, query, where, getDocs, 
    doc, deleteDoc, updateDoc, serverTimestamp, orderBy, limit, startAfter 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { showToast, showConfirm } from "../services/sweet-alert.js";

console.log("🚀 Notekun v2.0 Loaded (Optimized)");

// --- STATE ---
const NOTES_PER_PAGE = 20;
let state = {
    user: null,
    notes: [],
    lastDoc: null,
    hasMore: true,
    isLoading: false,
    filter: 'all', // all, script, sponsor, todo, trash
    searchQuery: '',
    searchTimeout: null,
    isChecklist: false
};

// --- INIT ---
export function init() {
    auth.onAuthStateChanged(user => {
        if (user) {
            state.user = user;
            resetAndLoad();
            setupScrollListener();
        }
    });
}
window.loadNotekun = init;

// --- DATA LOGIC ---
async function resetAndLoad() {
    state.notes = [];
    state.lastDoc = null;
    state.hasMore = true;
    document.getElementById('notes-grid').innerHTML = '';
    document.getElementById('empty-state').classList.add('hidden');
    
    await fetchNotes();
}

async function fetchNotes() {
    if (state.isLoading || !state.hasMore) return;
    state.isLoading = true;
    document.getElementById('loading-indicator').classList.remove('hidden');

    try {
        let constraints = [
            where("userId", "==", state.user.uid),
            orderBy("isPinned", "desc"), // Pinned first
            orderBy("updatedAt", "desc"), // Then newest
            limit(NOTES_PER_PAGE)
        ];

        // Filter Logic
        if (state.filter === 'trash') {
            constraints = [where("userId", "==", state.user.uid), where("status", "==", "trash"), orderBy("updatedAt", "desc"), limit(NOTES_PER_PAGE)];
        } else {
            // Normal Active Notes
            constraints.push(where("status", "==", "active"));
            if (state.filter !== 'all') {
                constraints.push(where("category", "==", state.filter));
            }
        }

        if (state.lastDoc) constraints.push(startAfter(state.lastDoc));

        const q = query(collection(db, "notes"), ...constraints);
        const snap = await getDocs(q);

        if (snap.empty) {
            state.hasMore = false;
            if(state.notes.length === 0) document.getElementById('empty-state').classList.remove('hidden');
        } else {
            state.lastDoc = snap.docs[snap.docs.length - 1];
            snap.forEach(doc => {
                const note = { id: doc.id, ...doc.data() };
                state.notes.push(note);
                renderNoteCard(note);
            });
        }
    } catch (e) {
        console.warn("Index needed or fetch error:", e);
    } finally {
        state.isLoading = false;
        document.getElementById('loading-indicator').classList.add('hidden');
    }
}

// --- RENDERING ---
function renderNoteCard(note) {
    const grid = document.getElementById('notes-grid');
    if(!grid) return;

    // Search Filter (Client Side for speed on loaded items)
    if(state.searchQuery && !note.title.toLowerCase().includes(state.searchQuery) && !note.content.toLowerCase().includes(state.searchQuery)) return;

    const div = document.createElement('div');
    
    // Colors
    const colors = {
        'white': 'bg-white border-slate-200',
        'yellow': 'bg-yellow-50 border-yellow-200',
        'blue': 'bg-blue-50 border-blue-200',
        'red': 'bg-red-50 border-red-200',
        'green': 'bg-green-50 border-green-200'
    };
    const colorClass = colors[note.color] || colors['white'];
    const pinnedClass = note.isPinned ? 'border-orange-200 shadow-md ring-1 ring-orange-100' : '';

    // Content Preview
    let contentPreview = '';
    if (note.type === 'checklist' && note.checklist) {
        contentPreview = `<div class="space-y-1 mt-2">
            ${note.checklist.slice(0, 3).map(i => `
                <div class="flex items-center gap-2 text-[10px] text-slate-600">
                    <i class="fas ${i.done ? 'fa-check-square text-green-500' : 'fa-square text-slate-300'}"></i>
                    <span class="${i.done ? 'line-through opacity-50' : ''} truncate">${i.text}</span>
                </div>`).join('')}
             ${note.checklist.length > 3 ? `<p class="text-[9px] text-slate-400 font-bold">+${note.checklist.length - 3} more</p>` : ''}
        </div>`;
    } else {
        contentPreview = `<p class="text-xs text-slate-600 mt-2 line-clamp-4 leading-relaxed">${note.content || 'Empty note'}</p>`;
    }

    div.className = `p-4 rounded-2xl border shadow-sm hover:shadow-lg transition-all cursor-pointer flex flex-col h-48 relative group animate-fade-in ${colorClass} ${pinnedClass}`;
    div.onclick = () => window.editNote(note.id);

    div.innerHTML = `
        <div class="flex justify-between items-start mb-1">
            <span class="text-[9px] font-black uppercase tracking-wider text-slate-400 px-1.5 py-0.5 rounded bg-white/50 border border-black/5">${note.category}</span>
            ${note.isPinned ? '<i class="fas fa-thumbtack text-orange-400 text-xs transform rotate-45"></i>' : ''}
        </div>
        
        <h4 class="font-bold text-slate-800 text-sm line-clamp-1">${note.title || 'Untitled'}</h4>
        ${contentPreview}
        
        <div class="mt-auto pt-3 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span class="text-[9px] font-bold text-slate-400">${new Date(note.updatedAt?.seconds * 1000 || Date.now()).toLocaleDateString()}</span>
            <div class="flex gap-2">
                ${state.filter === 'trash' 
                    ? `<button onclick="event.stopPropagation(); window.restoreNote('${note.id}')" class="text-green-500 hover:bg-green-100 p-1 rounded"><i class="fas fa-trash-restore"></i></button>
                       <button onclick="event.stopPropagation(); window.permanentDelete('${note.id}')" class="text-red-500 hover:bg-red-100 p-1 rounded"><i class="fas fa-times"></i></button>`
                    : `<button onclick="event.stopPropagation(); window.moveToTrash('${note.id}')" class="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1 rounded transition"><i class="fas fa-trash"></i></button>`
                }
            </div>
        </div>
    `;
    grid.appendChild(div);
}

// --- ACTIONS ---

// --- ACTIONS ---

window.filterNotes = (cat) => {
    state.filter = cat;
    
    // 1. Reset ALL buttons to Inactive Style (White BG, Grey Text)
    document.querySelectorAll('.filter-btn').forEach(b => {
        // Remove Active Dark Styles
        b.classList.remove('bg-slate-900', 'text-white', 'shadow-md', 'active');
        
        // Add Inactive Light Styles (Restore Border & Hover)
        b.classList.add('bg-white', 'text-slate-600', 'border', 'border-slate-200', 'hover:bg-slate-50');
    });
    
    // 2. Set ACTIVE button style (Dark BG, White Text)
    const activeBtn = document.getElementById(`filter-${cat}`);
    if(activeBtn) {
        // Remove Inactive Styles (Conflict hatane ke liye)
        activeBtn.classList.remove('bg-white', 'text-slate-600', 'border', 'border-slate-200', 'hover:bg-slate-50');
        
        // Add Active Dark Styles
        activeBtn.classList.add('bg-slate-900', 'text-white', 'shadow-md', 'active');
    }
    
    resetAndLoad();
};

window.handleSearchNote = (e) => {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => {
        state.searchQuery = e.target.value.toLowerCase();
        // Local Filter for Speed (if data is small) OR Reset Load (if huge)
        // For UX, let's just re-render current list first
        document.getElementById('notes-grid').innerHTML = '';
        state.notes.forEach(renderNoteCard);
        
        if(document.getElementById('notes-grid').innerHTML === '') {
            document.getElementById('empty-state').classList.remove('hidden');
        } else {
            document.getElementById('empty-state').classList.add('hidden');
        }
    }, 300);
};

// --- MODAL & EDITOR ---

window.openNoteModal = () => {
    document.getElementById('noteModal').classList.remove('hidden');
    document.getElementById('noteId').value = '';
    document.getElementById('note-title').value = '';
    document.getElementById('note-content').value = '';
    document.getElementById('checklist-items').innerHTML = '';
    window.selectColor('white');
    
    state.isChecklist = false;
    updateEditorMode();
};

window.editNote = (id) => {
    const note = state.notes.find(n => n.id === id);
    if(!note) return;

    document.getElementById('noteModal').classList.remove('hidden');
    document.getElementById('noteId').value = id;
    document.getElementById('note-title').value = note.title;
    document.getElementById('note-category').value = note.category;
    document.getElementById('notePinned').checked = note.isPinned;
    window.selectColor(note.color || 'white');

    state.isChecklist = note.type === 'checklist';
    if(state.isChecklist) {
        document.getElementById('checklist-items').innerHTML = '';
        note.checklist.forEach(i => window.addChecklistItem(i.text, i.done));
    } else {
        document.getElementById('note-content').value = note.content || '';
    }
    updateEditorMode();
};

window.handleSaveNote = async () => {
    const btn = document.getElementById('saveNoteBtn');
    btn.innerText = "Saving..."; btn.disabled = true;

    try {
        const id = document.getElementById('noteId').value;
        const title = document.getElementById('note-title').value.trim();
        const category = document.getElementById('note-category').value;
        const color = document.getElementById('selectedColor').value;
        const isPinned = document.getElementById('notePinned').checked;

        let content = '';
        let checklist = [];
        let type = 'text';

        if(state.isChecklist) {
            type = 'checklist';
            document.querySelectorAll('#checklist-items > div').forEach(div => {
                const txt = div.querySelector('input[type="text"]').value.trim();
                const done = div.querySelector('input[type="checkbox"]').checked;
                if(txt) checklist.push({ text: txt, done });
            });
        } else {
            content = document.getElementById('note-content').value.trim();
        }

        if(!title && !content && checklist.length === 0) throw new Error("Empty Note");

        const data = {
            userId: state.user.uid,
            title, category, color, isPinned, type, content, checklist,
            status: 'active',
            updatedAt: serverTimestamp()
        };

        if(id) {
            await updateDoc(doc(db, "notes", id), data);
        } else {
            await addDoc(collection(db, "notes"), data);
        }

        window.closeNoteModal();
        showToast("Saved", "success");
        resetAndLoad();

    } catch(e) {
        showToast("Error saving", "error");
    } finally {
        btn.innerText = "Save Note"; btn.disabled = false;
    }
};

window.moveToTrash = async (id) => {
    await updateDoc(doc(db, "notes", id), { status: 'trash', updatedAt: serverTimestamp() });
    showToast("Moved to Trash", "info");
    resetAndLoad();
};

window.restoreNote = async (id) => {
    await updateDoc(doc(db, "notes", id), { status: 'active', updatedAt: serverTimestamp() });
    showToast("Restored", "success");
    resetAndLoad();
};

window.permanentDelete = async (id) => {
    if(await showConfirm("Delete Permanently?", "This cannot be undone.", "Delete")) {
        await deleteDoc(doc(db, "notes", id));
        showToast("Deleted", "success");
        resetAndLoad();
    }
};

// --- EDITOR UTILS ---
window.toggleChecklistMode = () => {
    state.isChecklist = !state.isChecklist;
    updateEditorMode();
};

function updateEditorMode() {
    const txt = document.getElementById('note-content');
    const list = document.getElementById('checklist-container');
    const btn = document.getElementById('checklistBtn');

    if(state.isChecklist) {
        txt.classList.add('hidden');
        list.classList.remove('hidden');
        btn.innerHTML = `<i class="fas fa-align-left"></i> Text Mode`;
        if(document.getElementById('checklist-items').children.length === 0) window.addChecklistItem();
    } else {
        txt.classList.remove('hidden');
        list.classList.add('hidden');
        btn.innerHTML = `<i class="fas fa-list-ul"></i> Checklist`;
    }
}

window.addChecklistItem = (text = '', done = false) => {
    const div = document.createElement('div');
    div.className = "flex items-center gap-2";
    div.innerHTML = `
        <input type="checkbox" class="w-4 h-4 accent-blue-600 rounded" ${done ? 'checked' : ''}>
        <input type="text" value="${text}" placeholder="List item..." class="flex-1 bg-transparent border-b border-slate-100 focus:border-blue-300 outline-none text-sm py-1">
        <button onclick="this.parentElement.remove()" class="text-slate-300 hover:text-red-500"><i class="fas fa-times"></i></button>
    `;
    document.getElementById('checklist-items').appendChild(div);
};

window.selectColor = (c) => {
    document.getElementById('selectedColor').value = c;
    ['white','yellow','blue','red','green'].forEach(col => {
        document.getElementById(`col-${col}`).classList.remove('ring-2', 'ring-slate-400');
    });
    document.getElementById(`col-${c}`).classList.add('ring-2', 'ring-slate-400');
};

window.closeNoteModal = () => document.getElementById('noteModal').classList.add('hidden');

function setupScrollListener() {
    const grid = document.getElementById('notes-grid');
    if(grid) {
        const container = grid.parentElement;
        container.onscroll = () => {
            if (container.scrollTop + container.clientHeight >= container.scrollHeight - 50) {
                fetchNotes();
            }
        };
    }
}