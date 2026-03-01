import { db, auth } from "../firebase.js";
import { 
    collection, addDoc, query, where, getDocs, orderBy, limit, 
    doc, deleteDoc, serverTimestamp, updateDoc, getAggregateFromServer, sum, onSnapshot 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { formatCurrency } from "../services/formatters.js";
import { showToast } from "../services/sweet-alert.js";

// --- STATE MANAGER ---
let state = {
    user: null,
    transactions: [],
    isLoading: false,
    filter: 'this_month',
    usdRate: 86.0,
    monthlyBudget: 50000,
    searchTimeout: null // For debouncing
};

// Chart Instances (Prevent Memory Leaks)
let chartInstances = {
    expense: null,
    cashflow: null
};

// Configuration
const categoryConfig = {
    'brand_deal': { color: '#059669', label: 'Brand Deal' },
    'adsense': { color: '#ef4444', label: 'AdSense' },
    'software': { color: '#8b5cf6', label: 'Software' },
    'equipment': { color: '#f97316', label: 'Equipment' },
    'marketing': { color: '#ec4899', label: 'Marketing' },
    'office': { color: '#64748b', label: 'Office' },
    'travel': { color: '#0ea5e9', label: 'Travel' },
    'service': { color: '#eab308', label: 'Service' },
    'other': { color: '#94a3b8', label: 'Other' }
};

// --- INITIALIZATION ---
export async function init() {
    console.log("[FINANCE] Engine v3.1 Loaded (1M+ Optimized)");

    // Cleanup listeners
    if(window.financeUnsubscribe) { window.financeUnsubscribe(); window.financeUnsubscribe = null; }
    if(window.budgetUnsubscribe) { window.budgetUnsubscribe(); window.budgetUnsubscribe = null; }
    
    // Destroy charts
    if (chartInstances.expense) { chartInstances.expense.destroy(); chartInstances.expense = null; }
    if (chartInstances.cashflow) { chartInstances.cashflow.destroy(); chartInstances.cashflow = null; }

    // Auth Listener
    window.financeUnsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
            state.user = user;
            setupBudgetListener();
            loadDashboard();
            fetchLiveUsdRate();
            
            // Set Default Date
            const today = new Date().toISOString().split('T')[0];
            const dateInput = document.getElementById('finDate');
            if(dateInput) dateInput.value = today;
        }
    });
}

window.loadFinance = init;

// --- CORE DATA LOGIC ---

async function loadDashboard() {
    const { start, end } = getDateRange(state.filter);
    const listEl = document.getElementById('transaction-list');
    
    if(listEl) {
        listEl.innerHTML = `
            <div class="flex flex-col items-center justify-center h-40 text-slate-400">
                <i class="fas fa-circle-notch fa-spin text-2xl mb-2"></i>
                <span class="text-[10px] font-bold">Syncing Financials...</span>
            </div>`;
    }

    // Parallel Fetching for Speed
    await Promise.all([
        fetchTransactions(start, end),
        fetchTotals(start, end)
    ]);
}

// 1. Server-Side Aggregation (Efficient for Large Datasets)
// finance.js - Update fetchTotals function
async function fetchTotals(start, end) {
    try {
        const coll = collection(db, "transactions");
        
        // 1. Filtered Period Stats (This Month, Year, etc.)
        const qBase = [where("userId", "==", state.user.uid), where("date", ">=", start), where("date", "<=", end)];
        const incSnap = await getAggregateFromServer(query(coll, ...qBase, where("type", "==", "income")), { total: sum('amount') });
        const expSnap = await getAggregateFromServer(query(coll, ...qBase, where("type", "==", "expense")), { total: sum('amount') });

        // 2. LIFETIME Bank Balance (Total real money available)
        const qLifetime = [where("userId", "==", state.user.uid)];
        const lifeIncSnap = await getAggregateFromServer(query(coll, ...qLifetime, where("type", "==", "income")), { total: sum('amount') });
        const lifeExpSnap = await getAggregateFromServer(query(coll, ...qLifetime, where("type", "==", "expense")), { total: sum('amount') });

        const inc = incSnap.data().total || 0;
        const exp = expSnap.data().total || 0;
        
        // Calculate total available balance in the "Bank"
        const lifetimeIncome = lifeIncSnap.data().total || 0;
        const lifetimeExpense = lifeExpSnap.data().total || 0;
        const totalBankBalance = lifetimeIncome - lifetimeExpense;
        
        updateStatsUI(inc, exp, totalBankBalance); // Pass the new metric
        
    } catch(e) { console.error("Stats Error:", e); }
}

// 2. Transaction List Fetching
async function fetchTransactions(start, end) {
    if(state.isLoading) return;
    state.isLoading = true;

    try {
        // Fetch up to 100 recent transactions for charts
        let q = query(
            collection(db, "transactions"),
            where("userId", "==", state.user.uid),
            where("date", ">=", start),
            where("date", "<=", end),
            orderBy("date", "desc"),
            limit(100) 
        );

        const snap = await getDocs(q);
        const list = document.getElementById('transaction-list');
        
        if(list) list.innerHTML = '';

        if(!snap.empty) {
            state.transactions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Render first 30 items for UI responsiveness
            state.transactions.slice(0, 30).forEach(tx => renderTxItem(tx));
            
            // Charts use all fetched data
            prepareChartData(state.transactions);
            
        } else {
            if(list) list.innerHTML = `<div class="text-center py-10 text-slate-400 text-xs font-bold uppercase">No records found for this period</div>`;
            prepareChartData([]); // Clear charts
        }

    } catch(e) { 
        console.error(e); 
        const list = document.getElementById('transaction-list');
        if(list) list.innerHTML = `<div class="text-center text-red-400 py-10 text-xs">Error loading data. Try again.</div>`;
    }
    finally { state.isLoading = false; }
}

// --- CHARTS LOGIC (ROBUST) ---

function prepareChartData(items) {
    const catTotals = {};
    const dailyStats = {};
    
    // Process Data
    items.forEach(t => {
        if (t.type === 'expense') {
            catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
        }
        
        const d = t.date; // YYYY-MM-DD
        if (!dailyStats[d]) dailyStats[d] = { income: 0, expense: 0 };
        // Payouts (debit) ko charts me add nahi karna taaki profit minus na ho
        if (t.type === 'income' || t.type === 'credit') {
            dailyStats[d].income += t.amount;
        } else if (t.type === 'expense') {
            dailyStats[d].expense += t.amount;
        }
    });
    
    // Fill last 7 days for smoothness (UX)
    const filledStats = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        filledStats[dateStr] = dailyStats[dateStr] || { income: 0, expense: 0 };
    }
    
    renderCharts(catTotals, filledStats);
}

function renderCharts(catData, dailyData) {
    // 1. Safety Check: If Canvas doesn't exist, stop.
    const ctx1 = document.getElementById('expenseChart');
    const ctx2 = document.getElementById('cashFlowChart');
    if (!ctx1 || !ctx2) return;

    // 2. Retry Logic: If Chart.js library isn't loaded yet
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js not ready, retrying...");
        setTimeout(() => renderCharts(catData, dailyData), 500);
        return;
    }

    // 3. Render Expense Doughnut
    if (chartInstances.expense) chartInstances.expense.destroy();
    
    const labels = Object.keys(catData);
    const dataValues = Object.values(catData);
    const bgColors = labels.map(l => categoryConfig[l]?.color || '#94a3b8');

    chartInstances.expense = new Chart(ctx1, {
        type: 'doughnut',
        data: {
            labels: labels.map(l => categoryConfig[l]?.label || l),
            datasets: [{ data: dataValues, backgroundColor: bgColors, borderWidth: 0, hoverOffset: 4 }]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, cutout: '75%',
            plugins: { legend: { display: false } },
            animation: { animateScale: true, animateRotate: true }
        }
    });

    // 4. Render Cashflow Bar
    if (chartInstances.cashflow) chartInstances.cashflow.destroy();

    const dates = Object.keys(dailyData).sort();
    const incomeData = dates.map(d => dailyData[d].income);
    const expenseData = dates.map(d => dailyData[d].expense);

    chartInstances.cashflow = new Chart(ctx2, {
        type: 'bar',
        data: {
            labels: dates.map(d => d.substring(5)), // MM-DD
            datasets: [
                { label: 'Income', data: incomeData, backgroundColor: '#10b981', borderRadius: 4, barPercentage: 0.6 },
                { label: 'Expense', data: expenseData, backgroundColor: '#ef4444', borderRadius: 4, barPercentage: 0.6 }
            ]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            scales: { 
                x: { grid: { display: false }, ticks: { font: { size: 9 } } }, 
                y: { display: false } 
            }, 
            plugins: { legend: { display: false } } 
        }
    });
}

// --- UI RENDERING ---

function updateStatsUI(inc, exp, bankBalance) {
    // 1. Calculate Period Profit (Filter ke hisaab se)
    const profit = inc - exp;
    
    // 2. Update Basic Display Stats
    setText('display-income', formatCurrency(inc));
    setText('display-expense', formatCurrency(exp));
    setText('display-profit', formatCurrency(profit));

    // 3. Update NEW Bank Balance (Lifetime Available Money)
    // Check lagaya hai taaki HTML me ID na ho to error na aaye
    const bankEl = document.getElementById('display-bank-balance');
    if (bankEl) {
        setText('display-bank-balance', formatCurrency(bankBalance));
    }

    // 4. Profit Badge Logic (Healthy vs Deficit)
    const badge = document.getElementById('profit-badge');
    if(badge) {
        if(profit >= 0) {
            badge.className = "inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-emerald-500/10 backdrop-blur-sm text-[10px] font-bold text-emerald-400 border border-emerald-500/20";
            badge.innerHTML = `<i class="fas fa-chart-line"></i> Healthy`;
        } else {
            badge.className = "inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-red-500/10 backdrop-blur-sm text-[10px] font-bold text-red-400 border border-red-500/20";
            badge.innerHTML = `<i class="fas fa-arrow-down"></i> Deficit`;
        }
    }

    // 5. Budget Bar Logic (Safe Division)
    const budget = state.monthlyBudget || 1; 
    const percent = Math.min((exp / budget) * 100, 100);
    const bar = document.getElementById('budget-bar');
    
    if(bar) {
        bar.style.width = `${percent}%`;
        bar.className = `h-full transition-all duration-1000 rounded-full ${percent > 90 ? 'bg-red-500' : 'bg-emerald-500'}`;
        const bText = document.getElementById('budget-text');
        if(bText) bText.innerText = `${percent.toFixed(0)}% Used of ${formatCurrency(budget)}`;
    }
}

function renderTxItem(tx) {
    const list = document.getElementById('transaction-list');
    if(!list) return;

    // Naya Logic: Income, Expense, aur Payout (debit) ko pehchanne ke liye
    const isCredit = tx.type === 'income' || tx.type === 'credit';
    const isWithdrawal = tx.type === 'debit'; 

    // Colors set karna
    let iconColor = isCredit ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500';
    let iconType = isCredit ? 'fa-arrow-down' : 'fa-arrow-up';
    let sign = isCredit ? '+' : '-';
    let textColor = isCredit ? 'text-emerald-600' : 'text-slate-800';

    // Agar withdrawal (payout) hai toh Blue color aur Bank icon dikhayega
    if (isWithdrawal) {
        iconColor = 'bg-blue-100 text-blue-600';
        iconType = 'fa-building-columns';
        textColor = 'text-blue-600';
    }

    const div = document.createElement('div');
    div.className = "flex justify-between items-center p-4 hover:bg-slate-50 rounded-2xl transition cursor-pointer border-b border-slate-50 last:border-0 group animate-fade-in";
    
    div.innerHTML = `
        <div class="flex items-center gap-4">
            <div class="w-10 h-10 rounded-full ${iconColor} flex items-center justify-center text-sm shadow-sm">
                <i class="fa-solid ${iconType}"></i>
            </div>
            <div class="min-w-0">
                <p class="text-sm font-bold text-slate-800 truncate max-w-[150px] md:max-w-xs">${tx.description || 'Transaction'}</p>
                <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">${tx.category || 'Transfer'} • ${tx.date || 'N/A'}</p>
            </div>
        </div>
        <div class="text-right shrink-0">
            <span class="text-sm font-black ${textColor}">
                ${sign} ${formatCurrency(tx.amount)}
            </span>
            <div class="flex justify-end gap-2 mt-1 opacity-0 group-hover:opacity-100 transition">
                <button onclick="window.deleteTransaction('${tx.id}')" class="text-[10px] text-red-400 font-bold hover:underline">DELETE</button>
            </div>
        </div>
    `;
    list.appendChild(div);
}

// --- ACTIONS & HANDLERS ---

window.handleAddTransaction = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-tx');
    if(btn) { btn.disabled = true; btn.innerText = "Saving..."; }

    try {
        const amtInput = document.getElementById('finAmount').value;
        if(!amtInput) throw new Error("Amount required");

        const amt = parseFloat(amtInput);
        const curr = document.getElementById('finCurrency').value;
        
        // Auto-Conversion (Simplistic)
        const finalAmt = curr === 'USD' ? amt * state.usdRate : amt;

        await addDoc(collection(db, "transactions"), {
            userId: state.user.uid,
            type: document.querySelector('input[name="type"]:checked').value,
            amount: finalAmt,
            originalAmount: amt,
            currency: curr,
            category: document.getElementById('finCategory').value,
            date: document.getElementById('finDate').value,
            description: document.getElementById('finDesc').value || "Untitled",
            createdAt: serverTimestamp()
        });

        showToast("Transaction Saved", "success");
        window.closeFinanceModal();
        e.target.reset(); // Clear form
        loadDashboard(); 

    } catch(err) { 
        console.error(err);
        showToast(err.message || "Error saving", "error"); 
    }
    finally { 
        if(btn) { btn.disabled = false; btn.innerText = "Save Transaction"; }
    }
};

window.handleSaveRecurring = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-rec');
    if(btn) { btn.disabled = true; btn.innerText = "Processing..."; }

    try {
        const recTypeEl = document.querySelector('input[name="recType"]:checked');
        const amountEl = document.getElementById('recAmount');
        const descEl = document.getElementById('recDesc');

        if(!recTypeEl || !amountEl.value || !descEl.value) {
            throw new Error("Please fill all fields");
        }

        await addDoc(collection(db, "recurring_transactions"), {
            userId: state.user.uid,
            type: recTypeEl.value,
            amount: parseFloat(amountEl.value),
            category: document.getElementById('recCategory').value,
            description: descEl.value,
            frequency: document.getElementById('recFrequency').value,
            createdAt: serverTimestamp()
        });

        showToast("Recurring Payment Added!", "success");
        window.closeRecurringModal();
        e.target.reset();

    } catch(err) { 
        showToast(err.message, "error"); 
    } finally {
        if(btn) { btn.disabled = false; btn.innerText = "Add Recurring"; }
    }
};

window.deleteTransaction = async (id) => {
    if(!confirm("Are you sure? This cannot be undone.")) return;
    try {
        await deleteDoc(doc(db, "transactions", id));
        showToast("Deleted", "success");
        // Remove from UI immediately for speed
        state.transactions = state.transactions.filter(t => t.id !== id);
        loadDashboard(); // Re-sync totals
    } catch(e) { showToast("Error deleting", "error"); }
};

// --- UTILS & SEARCH ---

window.handleSearch = (e) => {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => {
        const term = e.target.value.toLowerCase();
        const list = document.getElementById('transaction-list');
        list.innerHTML = '';
        
        // Client-side search (Fast for <100 items)
        const filtered = state.transactions.filter(t => 
            (t.description && t.description.toLowerCase().includes(term)) ||
            (t.category && t.category.toLowerCase().includes(term))
        );

        if(filtered.length === 0) {
            list.innerHTML = `<div class="text-center py-4 text-xs text-slate-400">No matches found</div>`;
        } else {
            filtered.forEach(tx => renderTxItem(tx));
        }
    }, 300); // 300ms Debounce
};

function setupBudgetListener() {
    window.budgetUnsubscribe = onSnapshot(doc(db, "users", state.user.uid), (docSnap) => {
        if(docSnap.exists()) {
            state.monthlyBudget = docSnap.data().budget || 50000;
            const bar = document.getElementById('budget-bar'); // Force update if visible
            if(bar) loadDashboard();
        }
    });
}

window.saveBudgetSettings = () => {
    const val = document.getElementById('monthlyBudgetInput').value;
    if(val) {
        updateDoc(doc(db, "users", state.user.uid), { budget: parseFloat(val) });
        state.monthlyBudget = parseFloat(val);
        window.closeBudgetModal();
        showToast("Budget Updated", "success");
        loadDashboard();
    }
};

window.applyTimeFilter = () => {
    state.filter = document.getElementById('timeFilter').value;
    loadDashboard();
};

function getDateRange(type) {
    const now = new Date();
    // Default: This Month
    let start = new Date(now.getFullYear(), now.getMonth(), 1);
    let end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    if(type === 'last_month') {
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
    }
    else if(type === 'year') {
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31);
    }
    
    // Formatting YYYY-MM-DD
    const formatDate = (d) => {
        const offset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - offset).toISOString().split('T')[0];
    };

    return { start: formatDate(start), end: formatDate(end) };
}

async function fetchLiveUsdRate() {
    try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
        state.usdRate = data.rates.INR;
        setText('current-rate-display', `1 USD = ₹${state.usdRate}`);
    } catch(e) {
        console.warn("Rate fetch failed, using default");
        setText('current-rate-display', `1 USD = ₹86.00 (Offline)`);
    }
}

const setText = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };

// Modal Toggle Utils
window.openFinanceModal = () => document.getElementById('financeModal').classList.remove('hidden');
window.closeFinanceModal = () => document.getElementById('financeModal').classList.add('hidden');
window.openBudgetModal = () => document.getElementById('budgetModal').classList.remove('hidden');
window.closeBudgetModal = () => document.getElementById('budgetModal').classList.add('hidden');
window.openRecurringModal = () => document.getElementById('recurringModal').classList.remove('hidden');
window.closeRecurringModal = () => document.getElementById('recurringModal').classList.add('hidden');