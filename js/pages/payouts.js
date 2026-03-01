import { db, auth } from "../firebase.js";
import { 
    collection, getDocs, query, where, orderBy, limit, addDoc, doc, getDoc, serverTimestamp, updateDoc, increment 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { formatCurrency } from "../services/formatters.js";
import { showToast } from "../services/sweet-alert.js";

// --- STATE ---
let state = {
    user: null,
    profile: null,
    transactions: [],
    filter: 'all'
};

// --- INIT ---
export async function init() {
    console.log("[PAYOUTS] Razorpay Engine Loaded");
    
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            state.user = user;
            await loadData();
        }
    });
}

window.loadPayout = init;

// --- DATA ENGINE ---
async function loadData() {
    const list = document.getElementById('payout-list');
    if(list) list.innerHTML = `<div class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-slate-300 text-2xl"></i></div>`;

    try {
        // 1. Fetch Profile (For Balance & Bank Info)
        const profileSnap = await getDoc(doc(db, "sellers", state.user.uid));
        if(profileSnap.exists()) {
            state.profile = profileSnap.data();
            updateHeaderUI();
        }

        // 2. Fetch Transactions
        const q = query(
            collection(db, "transactions"),
            where("sellerId", "==", state.user.uid),
            orderBy("createdAt", "desc"),
            limit(50)
        );
        
        const snap = await getDocs(q);
        state.transactions = [];
        snap.forEach(d => state.transactions.push({ id: d.id, ...d.data() }));

        renderTransactions();

    } catch(e) {
        console.error("Payout Load Error:", e);
        if(list) list.innerHTML = `<div class="text-center text-red-500 py-10 font-bold text-xs">Failed to load data.</div>`;
    }
}

// --- UI RENDERING ---
function updateHeaderUI() {
    const p = state.profile || {};
    // Default values if fields missing
    const bal = p.walletBalance || 0;
    const life = p.lifetimeEarnings || 0;
    const pend = p.pendingClearance || 0;

    setText('txt-balance', formatCurrency(bal));
    setText('txt-lifetime', formatCurrency(life));
    setText('txt-pending', formatCurrency(pend));
    
    // Enable/Disable Withdraw Button
    const btn = document.getElementById('btn-withdraw-main');
    if(btn) {
        if(bal < 100) { // Minimum limit
            btn.classList.add('opacity-50', 'cursor-not-allowed');
            btn.disabled = true;
            btn.title = "Minimum withdrawal is ₹100";
        } else {
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
            btn.disabled = false;
        }
    }
}

function renderTransactions() {
    const list = document.getElementById('payout-list');
    const empty = document.getElementById('payout-empty');
    if(!list) return;

    list.innerHTML = '';
    
    // Filter
    const filtered = state.transactions.filter(t => {
        if(state.filter === 'all') return true;
        // Puraane 'credit/debit' aur naye 'income/expense' dono ko support karega
        if(state.filter === 'credit') return t.type === 'credit' || t.type === 'income';
        if(state.filter === 'debit') return t.type === 'debit' || t.type === 'expense';
        return false;
    });

    if(filtered.length === 0) {
        if(empty) empty.classList.remove('hidden');
        return;
    }
    if(empty) empty.classList.add('hidden');

    filtered.forEach(tx => {
        const isCredit = (tx.type === 'credit' || tx.type === 'income');
        const color = isCredit ? 'text-emerald-600' : 'text-slate-800';
        const sign = isCredit ? '+' : '-';
        const icon = isCredit ? 'fa-arrow-down' : 'fa-arrow-up';
        const iconBg = isCredit ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500';
        
        const dateStr = tx.createdAt?.seconds ? new Date(tx.createdAt.seconds * 1000).toLocaleDateString() : 'Just now';

        const html = `
        <div class="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-slate-50 transition group">
            
            <div class="col-span-5 md:col-span-4 flex items-center gap-3">
                <div class="w-8 h-8 rounded-full ${iconBg} flex items-center justify-center text-xs shrink-0">
                    <i class="fa-solid ${icon}"></i>
                </div>
                <div class="min-w-0">
                    <p class="text-xs font-bold text-slate-800 truncate">${tx.description || 'Transaction'}</p>
                    <p class="text-[10px] text-slate-400 font-mono truncate">#${tx.id.substring(0,8)}</p>
                </div>
            </div>

            <div class="col-span-3 md:col-span-2 text-right">
                <p class="text-sm font-black ${color}">${sign}${formatCurrency(tx.amount)}</p>
                ${isCredit ? `<p class="text-[9px] text-slate-400">Fees: ${formatCurrency(tx.platformFee || 0)}</p>` : ''}
            </div>

            <div class="col-span-2 md:col-span-2 text-center">
                <span class="text-[9px] font-bold uppercase px-2 py-1 rounded bg-slate-100 text-slate-500">
                    ${tx.status || 'Success'}
                </span>
            </div>

            <div class="hidden md:block md:col-span-2 text-right text-xs font-bold text-slate-500">
                ${dateStr}
            </div>

            <div class="col-span-2 md:col-span-2 text-right">
                <button onclick="window.downloadInvoice('${tx.id}')" class="w-8 h-8 rounded-full border border-slate-200 text-slate-400 hover:bg-slate-900 hover:text-white transition flex items-center justify-center ml-auto">
                    <i class="fa-solid fa-file-invoice"></i>
                </button>
            </div>
        </div>
        `;
        list.insertAdjacentHTML('beforeend', html);
    });
}

// --- ACTIONS ---

window.refreshPayouts = () => loadData();

window.filterTx = (type) => {
    state.filter = type;
    // Update Tab Styles
    ['all', 'credit', 'debit'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if(t === type) {
            btn.className = "px-4 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-800 shadow-sm transition";
        } else {
            btn.className = "px-4 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800 transition";
        }
    });
    renderTransactions();
};

// --- WITHDRAWAL LOGIC ---
window.openWithdrawModal = () => {
    // Check if KYC exists
    const bank = state.profile?.kyc || {};
    if(!bank.accountNumber && !bank.upiId) {
        showToast("Please add Bank Details in Settings first.", "warning");
        return;
    }

    const bankText = bank.upiId ? `UPI: ${bank.upiId}` : `Bank: **${bank.accountNumber?.slice(-4)}`;
    setText('modal-bank-text', bankText);
    
    // Set max withdrawable
    document.getElementById('inp-withdraw-amount').value = state.profile.walletBalance || 0;
    
    document.getElementById('modal-withdraw').classList.remove('hidden');
};

// REPLACE the 'btn-confirm-withdraw' event listener 
document.getElementById('btn-confirm-withdraw').addEventListener('click', async () => {
    const amount = Number(getValue('inp-withdraw-amount'));
    const balance = state.profile?.walletBalance || 0;
    
    // settings.js se 100% sync - profile se platformFee nikalna (Default 10)
    const platformFeeRate = state.profile?.platformFee || 10; 

    if(amount <= 0 || amount > balance) return showToast("Invalid Amount", "error");
    if(amount < 100) return showToast("Minimum withdrawal is ₹100", "warning");

    // Fees ka calculation
    const platformCut = (amount * platformFeeRate) / 100;
    const finalCreatorPayout = amount - platformCut;

    const btn = document.getElementById('btn-confirm-withdraw');
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;
    btn.disabled = true;

    try {
        // Aaj ki date string format mein
        const todayDate = new Date().toISOString().split('T')[0];

        // 1. Transaction document with transparent cut details
        await addDoc(collection(db, "transactions"), {
    sellerId: state.user.uid,
    userId: state.user.uid,       
    type: 'income',               // <-- UPDATE: Ise 'expense' se 'income' karein taaki finance me '+' ho
    category: 'software',         // <-- UPDATE: 'service' ya 'software' rakhein jo finance.js ke charts support karte hain
    date: todayDate,              
    amount: finalCreatorPayout,   // <-- Sirf final payout amount bank me jayega
    feePercentageApplied: platformFeeRate,
    platformFeeAmount: platformCut, 
    description: `Marketplace Payout to Bank`, // <-- Clear description
    status: 'processing', 
    createdAt: serverTimestamp(),
    method: state.profile.kyc?.upiId ? 'UPI' : 'Bank Transfer',
    bankDetails: state.profile.kyc 
});

        // 2. Reduce Wallet Balance Immediately (pura amount)
        const sellerRef = doc(db, "sellers", state.user.uid);
        await updateDoc(sellerRef, {
            walletBalance: increment(-amount),
            pendingClearance: increment(amount) 
        });

        showToast("Withdrawal Requested!", "success");
        window.closeModals();
        loadData(); 

    } catch(e) {
        console.error(e);
        showToast("Request Failed", "error");
    } finally {
        btn.innerHTML = `Confirm Transfer <i class="fa-solid fa-paper-plane"></i>`;
        btn.disabled = false;
    }
});

// --- INVOICE LOGIC (Smart Invoicing) ---
window.downloadInvoice = (id) => {
    const tx = state.transactions.find(t => t.id === id);
    if(!tx) return;

    showToast("Generating Invoice...", "info");
    
    // In production, call a Cloud Function to generate PDF
    // For now, we simulate a download
    setTimeout(() => {
        showToast("Invoice Downloaded (Mock)", "success");
        console.log(`Invoice generated for TX: ${id}, Amount: ${tx.amount}`);
        // window.open(pdfUrl, '_blank');
    }, 1500);
};

window.openSettings = () => {
    // Redirect to profile edit (Marketplace Edit Studio)
    window.location.hash = '#marketplace';
    setTimeout(() => window.openEditStudio(), 500); 
};

window.closeModals = () => {
    document.getElementById('modal-withdraw').classList.add('hidden');
};

// Helper
const setText = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
const getValue = (id) => document.getElementById(id).value;