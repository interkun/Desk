// js/app.js

import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
;

// --- CONFIGURATION & CACHE ---
const CACHE = new Map(); // HTML Cache to make it super fast
let currentCleanup = null; // To store cleanup function of the previous page

const routes = {
    // PRIMARY LINKS
    '#dashboard': { file: 'pages/dashboard.html', title: 'Dashboard - Creatorkun', module: './pages/dashboard.js' },
    
    // ALPHABETICAL ORDER
    '#posts': { file: 'pages/post.html', title: 'Posts Manager', module: './pages/post.js' },
    '#analytics': { file: 'pages/analytics.html', title: 'Analytics', module: './pages/analytics.js' },
    '#finance': { file: 'pages/finance.html', title: 'Finance Overview', module: './pages/finance.js' },
    '#inbox': { file: 'pages/inbox.html', title: 'Inbox', module: './pages/inbox.js' },
    '#marketplace': { file: 'pages/marketplace.html', title: 'Marketplace', module: './pages/marketplace.js' },
    '#marketplace-product': { file: 'pages/marketplace-product.html', title: 'Product View', module: './pages/marketplace-product.js' },
    '#booking': { file: 'pages/booking.html', title: 'Booking', module: './pages/booking.js' },
    '#notekun': { file: 'pages/notekun.html', title: 'Notekun', module: './pages/notekun.js' },
    
    '#projects': { file: 'pages/projects.html', title: 'Project Management', module: './pages/projects.js' },
    '#publish': { file: 'pages/published.html', title: 'Publish Product', module: './pages/published.js' },
    '#schedule': { file: 'pages/schedule.html', title: 'Scheduler', module: './pages/schedule.js' },
    '#massage': { file: 'pages/massage.html', title: 'massage', module: './pages/massage.js' },
    '#templates': { file: 'pages/templates.html', title: 'Content Templates', module: './pages/templates.js' },
    '#notification': { file: 'pages/notification.html', title: 'Notification', module: './pages/notification.js' },
    '#content': { file: 'pages/content.html', title: 'Content', module: './pages/content.js' },
    '#bank': { file: 'pages/bank.html', title: 'Bank Details', module: './pages/bank.js' },
    '#payouts': { file: 'pages/payouts.html', title: 'Payouts', module: './pages/payouts.js' },
    
    // UTILITY LINKS
    '#settings': { file: 'pages/settings.html', title: 'Account Settings', module: './pages/settings.js' },
    '404': { file: 'pages/404.html', title: 'Page Not Found' }
};

// --- ROUTER ENGINE ---
async function router() {
    if (!auth.currentUser) return; 

    const fullHash = window.location.hash || '#dashboard';
    const hash = fullHash.split('?')[0]; 
    const route = routes[hash] || routes['404'];

    // 1. UI Updates Immediate (Perceived Performance)
    document.title = route.title;
    updateActiveMenu(hash);
    
    const mainContent = document.querySelector('main');

    // 2. CLEANUP Previous Page (Fixes "Design change" issues)
    // Agar pichle page ne koi global listener ya timer lagaya tha, usse hatana zaroori hai.
    if (typeof currentCleanup === 'function') {
        try {
            currentCleanup();
            console.log("🧹 Previous page cleaned up.");
        } catch (e) {
            console.warn("Cleanup error:", e);
        }
        currentCleanup = null;
    }

    // 3. Reset Scroll & Show Loader
    window.scrollTo(0, 0);
    mainContent.innerHTML = `<div class="flex h-screen items-center justify-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>`;

    try {
        // 4. CACHING STRATEGY (Fixes "Slow Load")
        // Agar page pehle visit kiya hai, toh network call mat karo.
        let html;
        if (CACHE.has(route.file)) {
            html = CACHE.get(route.file);
        } else {
            const response = await fetch(route.file);
            if (!response.ok) throw new Error('Page not found');
            html = await response.text();
            CACHE.set(route.file, html); // Store in memory
        }

        // Render HTML
        mainContent.innerHTML = html;

        // 5. MODERN SCRIPT LOADING (Dynamic Import)
        if (route.module) {
            try {
                // Dynamic import allows caching by browser and cleaner execution
                const pageModule = await import(route.module + `?v=${Date.now()}`); // Versioning prevents stale cache during dev
                
                // Execute Init Function
                if (pageModule.init) {
                    await pageModule.init();
                }

                // Store Cleanup Function (Agar script export karti hai to)
                if (pageModule.destroy) {
                    currentCleanup = pageModule.destroy;
                }
            } catch (err) {
                console.error(`Error loading script ${route.module}:`, err);
            }
        }

    } catch (error) {
        console.error("Router Error:", error);
        mainContent.innerHTML = `<div class="p-10 text-center text-red-500">
            <h2 class="text-xl font-bold">Error Loading Page</h2>
            <p>${error.message}</p>
        </div>`;
    }

    // Mobile Sidebar Logic
    if(window.innerWidth < 768) {
        const s = document.getElementById('sidebar');
        if(s && !s.classList.contains('-translate-x-full')) {
            toggleSidebar(true);
        }
    }
}

// --- PROFILE UPDATE (Optimized) ---
async function updateSidebarProfile(user) {
    if (!user || !user.uid) return;

    // Local Storage for instant load (Optimistic UI)
    const cachedPlan = localStorage.getItem(`userPlan_${user.uid}`);
    if (cachedPlan) {
        renderPlanUI(user, JSON.parse(cachedPlan));
    }

    try {
        const currentPlan = await getUserPlanDetails(user.uid);
        // Update Cache
        localStorage.setItem(`userPlan_${user.uid}`, JSON.stringify(currentPlan));
        renderPlanUI(user, currentPlan);
    } catch (e) {
        console.error("Profile Update Error:", e);
    }
}

function renderPlanUI(user, plan) {
    const initials = user.displayName 
        ? user.displayName.charAt(0).toUpperCase() + (user.displayName.split(' ')[1]?.charAt(0)?.toUpperCase() || '') 
        : user.email.charAt(0).toUpperCase();

    const nameEl = document.getElementById('sidebar-user-name');
    const initialsEl = document.getElementById('sidebar-initials');
    const planEl = document.getElementById('sidebar-user-plan');
    
    if (nameEl) nameEl.innerText = user.displayName || user.email.split('@')[0];
    if (planEl) planEl.innerText = plan.name || 'Free Tier';
    
    if (initialsEl) {
        initialsEl.innerText = initials;
        initialsEl.className = `h-10 w-10 rounded-full flex items-center justify-center text-white font-bold bg-${plan.color || 'slate'}-600`;
    }
}

// --- MENU HIGHLIGHT LOGIC (Optimized) ---
function updateActiveMenu(hash) {
    // Using simple selectors to reduce DOM traversal
    document.querySelectorAll('.nav-item, .nav-item-bottom').forEach(link => {
        const linkHash = link.getAttribute('href');
        const isMatch = linkHash === hash;
        
        const textSpan = link.querySelector('span');
        
        if (isMatch) {
            link.classList.add('text-blue-600');
            link.classList.remove('text-slate-400');
            if(textSpan) {
                textSpan.classList.remove('font-medium');
                textSpan.classList.add('font-semibold');
            }
        } else {
            link.classList.remove('text-blue-600');
            link.classList.add('text-slate-400');
            if(textSpan) {
                textSpan.classList.remove('font-semibold');
                textSpan.classList.add('font-medium');
            }
        }
    });
}

// --- INITIALIZATION ---
// Initialize only once
let isAppInitialized = false;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        await updateSidebarProfile(user); 
        
        if (!isAppInitialized) {
            window.addEventListener('hashchange', router);
            isAppInitialized = true;
            router(); // Load initial route
        }
    } else {
        window.location.href = 'login.html';
    }
});

// --- GLOBAL UTILS ---
window.toggleSidebar = function(forceClose = false) {
    const s = document.getElementById('sidebar');
    const o = document.getElementById('sidebar-overlay');
    if (!s) return;
    
    const shouldClose = forceClose || !s.classList.contains('-translate-x-full');
    
    if (shouldClose) {
        s.classList.add('-translate-x-full');
        if(o) o.classList.add('hidden');
    } else {
        s.classList.remove('-translate-x-full');
        if(o) o.classList.remove('hidden');
    }
};

window.logout = async function() {
    if(confirm("Are you sure you want to logout?")) await signOut(auth);

};
