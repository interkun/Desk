import { db, auth } from "../firebase.js";
import { 
    collection, getDocs, query, where, orderBy, deleteDoc, doc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { formatCurrency } from "../services/formatters.js";
import { showToast } from "../services/sweet-alert.js";

let state = {
    user: null,
    items: [],
    activeFilter: 'all',
    searchTerm: ''
};

export async function init() {
    console.log("[CONTENT] Listing Engine...");
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            state.user = user;
            await loadContent();
        }
    });
}

window.loadContent = init;

async function loadContent() {
    const grid = document.getElementById('content-grid');
    if(!grid) return;
    
    grid.innerHTML = `<div id="initial-loader" class="col-span-full flex justify-center py-20 items-center"><div class="w-10 h-10 border-4 border-slate-100 border-t-slate-900 rounded-full animate-spin"></div></div>`;
    state.items = [];

    try {
        let q = query(collection(db, "products"), where("sellerId", "==", state.user.uid), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);

        if(snap.empty) {
            grid.innerHTML = '';
            document.getElementById('content-empty')?.classList.remove('hidden');
            document.getElementById('content-empty')?.classList.add('flex');
        } else {
            snap.docs.forEach(doc => {
                state.items.push({ id: doc.id, ...doc.data() });
            });
            renderUI(); // Naya render function call kiya
        }
        updateStats();

    } catch (e) {
        console.error("Load Error:", e);
        grid.innerHTML = `<div class="col-span-full text-center text-red-500 font-bold text-xs py-10">Error loading data. Please check console.</div>`;
    }
}

// --- CENTRALIZED RENDER FUNCTION ---
function renderUI() {
    const grid = document.getElementById('content-grid');
    const empty = document.getElementById('content-empty');
    grid.innerHTML = '';

    // 1. Filter & Search Apply karna
    let filteredData = state.items.filter(item => {
        const matchFilter = state.activeFilter === 'all' || item.type === state.activeFilter;
        const matchSearch = (item.title || '').toLowerCase().includes(state.searchTerm);
        return matchFilter && matchSearch;
    });

    // 2. Empty State Handle karna
    if (filteredData.length === 0) {
        empty?.classList.remove('hidden');
        empty?.classList.add('flex');
        return;
    } else {
        empty?.classList.add('hidden');
        empty?.classList.remove('flex');
    }

    // 3. Cards Draw karna
    filteredData.forEach(item => {
        grid.appendChild(createCardElement(item));
    });
}

// --- COMPACT CARD COMPONENT ---
function createCardElement(item) {
    const typeMap = {
        'call': { color: 'text-orange-600', bg: 'bg-orange-50', icon: 'fa-video', label: '1:1 Call' },
        'digital': { color: 'text-blue-600', bg: 'bg-blue-50', icon: 'fa-file-zipper', label: 'Digital File' },
        'webinar': { color: 'text-purple-600', bg: 'bg-purple-50', icon: 'fa-users', label: 'Webinar' },
        'dm': { color: 'text-pink-600', bg: 'bg-pink-50', icon: 'fa-comment-dots', label: 'Priority DM' }
    };
    const t = typeMap[item.type] || typeMap['call'];
    const imageSrc = item.coverImage || 'https://placehold.co/400x300/f1f5f9/94a3b8?text=No+Image';

    const div = document.createElement('div');
    div.className = "bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-100 transition overflow-hidden group flex flex-col";
    
    div.innerHTML = `
        <div class="h-32 bg-slate-100 relative overflow-hidden">
            <img src="${imageSrc}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" alt="${item.title}">
            <div class="absolute top-2 right-2 px-2 py-1 rounded-lg text-[10px] font-bold shadow-sm uppercase tracking-wider ${t.bg} ${t.color}">
                <i class="fa-solid ${t.icon} mr-1"></i> ${t.label}
            </div>
        </div>

        <div class="p-3 flex flex-col flex-1">
            <h3 class="text-sm font-bold text-slate-900 line-clamp-1 mb-1" title="${item.title}">${item.title || 'Untitled'}</h3>
            <p class="text-[10px] font-medium text-slate-400 mb-3 line-clamp-1">${item.description || 'No description provided.'}</p>
            
            <div class="mt-auto pt-2 border-t border-slate-50 flex items-center justify-between">
                <span class="text-sm font-black text-slate-800">${formatCurrency(item.price)}</span>
                <div class="flex gap-1">
                    <button onclick="window.editProduct('${item.id}')" class="w-8 h-8 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-900 hover:text-white transition flex items-center justify-center text-xs shadow-sm">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button onclick="window.deleteProduct('${item.id}')" class="w-8 h-8 rounded-xl bg-slate-50 text-slate-600 hover:bg-red-50 hover:text-red-600 transition flex items-center justify-center text-xs shadow-sm">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    return div;
}

// --- ACTIONS ---

window.editProduct = (id) => {
    window.location.hash = `#publish?edit=${id}`;
};

window.deleteProduct = async (id) => {
    if(!confirm("Permanently delete this product?")) return;
    try {
        await deleteDoc(doc(db, "products", id));
        showToast("Deleted successfully", "success");
        await loadContent(); // Refresh list after delete
    } catch(e) {
        console.error(e);
        showToast("Error deleting", "error");
    }
};

// TAB FILTER LOGIC (Fixed size & color toggle)
window.filterContent = (type) => {
    state.activeFilter = type;
    
    const activeClass = "filter-btn px-5 py-2.5 rounded-2xl text-xs font-bold bg-slate-900 text-white shadow-md transition-all whitespace-nowrap";
    const inactiveClass = "filter-btn px-5 py-2.5 rounded-2xl text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:border-blue-300 transition-all whitespace-nowrap";

    // Subhi buttons ko inactive karo pehle
    ['all', 'call', 'digital', 'webinar'].forEach(f => {
        const btn = document.getElementById(`filter-${f}`);
        if(btn) {
            btn.className = (f === type) ? activeClass : inactiveClass;
        }
    });
    
    renderUI(); // Re-render the grid based on new filter
};

// SEARCH LOGIC
window.handleSearchContent = (e) => {
    state.searchTerm = e.target.value.toLowerCase();
    renderUI(); // Re-render the grid based on search text
};

function updateStats() {
    const el = document.getElementById('stat-total');
    if(el) el.innerText = `${state.items.length} Items`;
}