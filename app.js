import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, getDocs, addDoc, writeBatch, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- GLOBAL VARIABLES ---
let app, auth, db, userId;
let isAuthReady = false;
let calendarDate = new Date();
let activeListeners = {};
let initialDataLoaded = false;
let currentSort = { column: null, direction: null };

// --- FIRESTORE SETUP ---
const firebaseConfig = {
    apiKey: "AIzaSyDM0zahTuXrK5PJ9_uVIciVeXyKf6bui0U",
    authDomain: "buddy-c0f56.firebaseapp.com",
    projectId: "buddy-c0f56",
    storageBucket: "buddy-c0f56.firebasestorage.app",
    messagingSenderId: "1002206808117",
    appId: "1:1002206808117:web:2e83aed7bce117afab897c"
};

// --- GLOBAL EXPORTS ---
window.showView = showView;
window.editIncome = editIncome;
window.deleteIncome = deleteIncome;
window.editExpense = editExpense;
window.deleteExpense = deleteExpense;
window.openItemizationModal = openItemizationModal;
window.deleteItemizedEntry = deleteItemizedEntry;
window.toggleSubscriptionStatus = toggleSubscriptionStatus;
window.editSubscription = editSubscription;
window.deleteSubscription = deleteSubscription;
window.toggleBudgetPaidStatus = toggleBudgetPaidStatus;
window.editBudget = editBudget;
window.deleteBudget = deleteBudget;
window.editPaymentMethod = editPaymentMethod;
window.deletePaymentMethod = deletePaymentMethod;
window.deleteCategory = deleteCategory;
window.startEditCategory = startEditCategory;
window.deleteSubcategory = deleteSubcategory;
window.startEditSubcategory = startEditSubcategory;
window.editPerson = editPerson;
window.deletePerson = deletePerson;
window.editPoint = editPoint;
window.deletePoint = deletePoint;
window.deleteGroceryItem = deleteGroceryItem;
window.editGroceryShoppingList = editGroceryShoppingList;
window.deleteGroceryShoppingList = deleteGroceryShoppingList;
window.editInvestmentAccount = editInvestmentAccount;
window.deleteInvestmentAccount = deleteInvestmentAccount;

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                isAuthReady = true;
                document.getElementById('userIdDisplay').textContent = `User ID: ${userId.substring(0, 10)}...`;
                document.getElementById('userIdDisplay').classList.remove('hidden');
                document.getElementById('appContent').classList.remove('hidden');
                document.getElementById('authView').classList.add('hidden');
                await initApp();
            } else {
                isAuthReady = false;
                userId = null;
                Object.values(activeListeners).forEach(unsub => unsub());
                activeListeners = {};
                document.getElementById('userIdDisplay').classList.add('hidden');
                document.getElementById('appContent').classList.add('hidden');
                document.getElementById('authView').classList.remove('hidden');
            }
        });

        // --- AUTHENTICATION LISTENERS ---
        document.getElementById('authForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('emailInput').value;
            const password = document.getElementById('passwordInput').value;
            const action = document.getElementById('authActionBtn').textContent;
            try {
                if (action.includes('Sign Up')) {
                    await createUserWithEmailAndPassword(auth, email, password);
                    showNotification('Account created successfully!');
                } else {
                    await signInWithEmailAndPassword(auth, email, password);
                    showNotification('Signed in successfully!');
                }
            } catch (error) {
                console.error("Auth error:", error);
                showNotification(error.message, true);
            }
        });

        document.getElementById('toggleAuthFormBtn').addEventListener('click', () => {
            const formTitle = document.getElementById('authFormTitle');
            const authActionBtn = document.getElementById('authActionBtn');
            if (authActionBtn.textContent.includes('Sign In')) {
                formTitle.textContent = 'Sign Up';
                authActionBtn.textContent = 'Sign Up';
                document.getElementById('toggleAuthFormBtn').textContent = 'Already have an account? Sign In';
            } else {
                formTitle.textContent = 'Sign In';
                authActionBtn.textContent = 'Sign In';
                document.getElementById('toggleAuthFormBtn').textContent = 'Create an account';
            }
        });

        document.getElementById('signOutBtn').addEventListener('click', async () => {
            try {
                await signOut(auth);
                showNotification('Signed out successfully.');
            } catch (error) {
                console.error("Sign out error:", error);
                showNotification('Failed to sign out.', true);
            }
        });
        
    } catch (error) {
        console.error("Initialization failed:", error);
        showNotification("App failed to initialize. Check console.", true);
    }
});

async function initApp() {
    if (!isAuthReady) return;
    
    await processAutoPaidBudgets();
    await reloadAllData();
    setupForms();
    setupTableSorting();
    setupCalendarNav();
    setupHamburgerMenu();
    setupItemizationModal();
    setupSalaryCalculator();
    
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    document.getElementById('reportMonth').value = `${year}-${month}`;
    document.getElementById('reportYear').value = year;
    await generateReports();
    await generateYearlyReports();
    
    showView('dashboardView', document.querySelector('[onclick*="dashboardView"]'));
    document.getElementById('currentDate').textContent = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// --- CORE FUNCTIONS ---
function resetAllForms() {
    const forms = ['incomeForm', 'expenseForm', 'subscriptionForm', 'budgetForm', 'pointsForm', 'investmentForm', 'paymentMethodForm', 'categoryForm', 'personForm', 'groceryItemForm', 'createShoppingListForm'];
    forms.forEach(formId => {
        const form = document.getElementById(formId);
        if (form) {
            form.reset();
            const hiddenId = form.querySelector('input[type="hidden"]');
            if (hiddenId) hiddenId.value = '';
        }
    });
}

function showView(viewId, element) {
    resetAllForms();
    document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    document.getElementById('pageTitle').textContent = element ? element.textContent.trim() : 'Dashboard';

    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active-nav'));
    if (element) element.classList.add('active-nav');

    document.getElementById('homeLink').classList.toggle('hidden', viewId === 'dashboardView');

    if (window.innerWidth < 768) {
        document.getElementById('sidebar').classList.add('-translate-x-full');
    }
}

// ... (The rest of the JS file is identical to the previous version, with the following additions/changes)
// Replace the corresponding functions in your app.js file with these updated versions.

// --- DATA RENDERERS (add the empty row helper) ---
function addEmptyRow(tbody, colspan, message = "No data found.") {
    if (tbody.rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center text-gray-500 p-4">${message}</td></tr>`;
    }
}
//...
// In loadIncome, loadExpenses, etc., add this call before the end of the function:
// addEmptyRow(list, 6); // (the colspan should match the number of columns)


// --- NEW FUNCTION TO PROCESS AUTO-PAY ---
async function processAutoPaidBudgets() {
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonthStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}`;

    const budgetsSnapshot = await getDocs(query(getCollection('budgets')));
    const batch = writeBatch(db);
    let updatesMade = false;

    budgetsSnapshot.forEach(docSnap => {
        const budget = { id: docSnap.id, ...docSnap.data() };
        const isPaid = (budget.paidMonths || []).includes(currentMonthStr);
        
        // Check if it's an auto-pay bill, the due day has passed, and it's not already paid
        if (budget.payType === 'Auto' && currentDay >= budget.dueDay && !isPaid) {
            const updatedPaidMonths = [...(budget.paidMonths || []), currentMonthStr];
            batch.update(docSnap.ref, { paidMonths: updatedPaidMonths });
            updatesMade = true;
        }
    });

    if (updatesMade) {
        await batch.commit();
        showNotification('Auto-paid bills have been updated.');
    }
}


// --- MODIFIED DASHBOARD AND SUBCATEGORY FUNCTIONS ---

// Update the `loadCategories` function to fix the subcategory bug
async function loadCategories(categories) {
    const list = document.getElementById('categoryList');
    list.innerHTML = '';
    const selects = ['expenseCategory', 'budgetCategory', 'pointsCategory'].map(id => document.getElementById(id));
    selects.forEach(s => s.innerHTML = '<option value="">Select Category</option>');
    
    const icons = { 'Home': 'home', 'Food': 'shopping-cart', 'School': 'book-open', 'Auto': 'truck', 'Subscriptions': 'repeat', 'Entertainment': 'film', 'Phone': 'smartphone', 'Internet': 'wifi', 'Projects': 'tool', 'Health': 'heart', 'Shopping': 'tag', 'Travel': 'map-pin' };
    
    categories.forEach(cat => {
        const icon = icons[cat.name] || 'folder';
        const div = document.createElement('div');
        div.className = 'p-2 border-b';
        div.innerHTML = `
            <div class="flex justify-between items-center">
                <span class="font-semibold flex items-center">
                    <i class="h-5 w-5 mr-2 text-gray-500" data-feather="${icon}"></i>
                    <span class="category-name">${cat.name}</span>
                    <button onclick="startEditCategory(this, '${cat.id}')" class="text-blue-500 hover:underline ml-2 text-xs p-1">edit</button>
                </span>
                <button onclick="deleteCategory('${cat.id}')" class="text-red-500 hover:underline">Delete</button>
            </div>
            <form class="subcategoryForm mt-2" data-category-id="${cat.id}">
                <input type="text" placeholder="New Subcategory" class="p-1 border rounded-md text-sm" required>
                <button type="submit" class="px-2 py-1 bg-green-500 text-white rounded-md text-sm">Add</button>
            </form>
            <ul class="ml-4 mt-2">
                ${(cat.subcategories || []).map(sub => `
                    <li class="flex items-center justify-between">
                        <span class="subcategory-name">- ${sub}</span>
                        <div>
                            <button onclick="startEditSubcategory(this, '${cat.id}', '${sub}')" class="text-blue-500 text-xs p-1">edit</button>
                            <button onclick="deleteSubcategory('${cat.id}', '${sub}')" class="text-red-500 text-xs p-1">x</button>
                        </div>
                    </li>`).join('')}
            </ul>`;
        list.appendChild(div);
        selects.forEach(s => s.add(new Option(cat.name, cat.name)));
    });
    feather.replace();
}

// Update `setupForms` to fix the subcategory add logic
document.getElementById('categoryList').addEventListener('submit', async (e) => {
    if (e.target.classList.contains('subcategoryForm')) {
        e.preventDefault();
        const categoryId = e.target.dataset.categoryId;
        const subcategoryName = e.target.querySelector('input').value;
        if (!subcategoryName) return;

        const docRef = doc(getCollection('categories'), categoryId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const category = docSnap.data();
            // FIX: Handle cases where subcategories array might not exist
            const updatedSubcategories = [...(category.subcategories || []), subcategoryName];
            await updateDoc(docRef, { subcategories: updatedSubcategories });
            e.target.querySelector('input').value = '';
            showNotification('Subcategory added.');
        }
    }
});

// Replace `updateDashboardSummaryCards` with the new `updateDashboardMetrics`
async function updateDashboardMetrics() {
    const today = new Date();
    const currentMonthStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}`;

    // Fetch all needed data
    const expensesSnapshot = await getDocs(query(getCollection('expenses')));
    const budgetsSnapshot = await getDocs(query(getCollection('budgets')));
    const subscriptionsSnapshot = await getDocs(query(getCollection('subscriptions')));
    
    // Calculate Spent
    const monthlyExpenses = expensesSnapshot.docs.map(d => d.data()).filter(e => e.date.startsWith(currentMonthStr));
    const totalSpent = monthlyExpenses.reduce((sum, e) => sum + e.amount, 0);

    // Calculate Budgeted
    const totalBudgetedAmount = budgetsSnapshot.docs.map(d => d.data()).reduce((sum, b) => sum + b.amount, 0);
    const activeSubCost = subscriptionsSnapshot.docs.map(d => d.data()).filter(s => s.status === 'active').reduce((sum, s) => sum + s.amount, 0);
    const totalBudgeted = totalBudgetedAmount + activeSubCost;

    // Calculate Remaining
    const remaining = totalBudgeted - totalSpent;

    // Update Desktop UI
    document.getElementById('desktopBudgeted').textContent = formatCurrency(totalBudgeted);
    document.getElementById('desktopSpent').textContent = formatCurrency(totalSpent);
    document.getElementById('desktopRemaining').textContent = formatCurrency(remaining);
    document.getElementById('desktopRemaining').className = `text-2xl font-bold ${remaining >= 0 ? 'text-green-600' : 'text-red-600'}`;
    
    // Update Mobile UI
    document.getElementById('summaryBudgeted').textContent = formatCurrency(totalBudgeted);
    document.getElementById('summarySpent').textContent = formatCurrency(totalSpent);
    document.getElementById('summaryRemaining').textContent = formatCurrency(remaining);
    document.getElementById('summaryRemaining').className = `text-lg font-bold ${remaining >= 0 ? 'text-green-600' : 'text-red-600'}`;
}

// Replace the old `renderDashboardTransactions`
async function renderDashboardTransactions(budgets, subscriptions, expenses) {
    const mobileList = document.getElementById('mobileTransactionsList');
    const desktopList = document.getElementById('desktopTransactionsList');
    mobileList.innerHTML = '';
    desktopList.innerHTML = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysLater = new Date(today);
    sevenDaysLater.setDate(today.getDate() + 7);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    let transactions = [];

    // Add upcoming MANUAL pay bills
    budgets.forEach(b => {
        if (b.dueDay && b.payType !== 'Auto') {
            const dueDate = new Date(today.getFullYear(), today.getMonth(), b.dueDay);
            if (dueDate >= today && dueDate <= sevenDaysLater) {
                transactions.push({
                    date: dueDate.toISOString().slice(0, 10),
                    description: `${b.category} / ${b.subcategory}`,
                    amount: b.amount,
                    type: 'upcoming_manual'
                });
            }
        }
    });

    // Add upcoming subscriptions (treated as auto-pay)
    subscriptions.filter(s => s.status === 'active').forEach(s => {
        const subDay = new Date(s.startDate).getDate();
        let nextDueDate = new Date(today.getFullYear(), today.getMonth(), subDay);
        if(nextDueDate < today) nextDueDate.setMonth(nextDueDate.getMonth() + 1);
        
        if (nextDueDate >= today && nextDueDate <= sevenDaysLater) {
             transactions.push({ date: nextDueDate.toISOString().slice(0, 10), description: s.name, amount: s.amount, type: 'upcoming' });
        }
    });

    // Add recent expenses
    expenses.forEach(e => {
        const expenseDate = new Date(e.date + 'T00:00:00');
        if (expenseDate <= today && expenseDate >= sevenDaysAgo) {
            transactions.push({ date: e.date, description: e.payee, amount: e.amount, type: 'recent' });
        }
    });
    
    transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    const grouped = transactions.reduce((acc, t) => {
        (acc[t.date] = acc[t.date] || []).push(t);
        return acc;
    }, {});
    
    let html = '';
    if (Object.keys(grouped).length === 0) {
        html = '<p class="text-gray-500">No transactions in the next or last 7 days.</p>';
    } else {
         for (const dateStr in grouped) {
            const date = new Date(dateStr + 'T00:00:00');
            const dateHeader = date.toDateString() === today.toDateString() ? 'Today' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            html += `<div class="mt-4"><p class="font-bold text-gray-700">${dateHeader}</p><ul class="mt-1 space-y-2">`;
            grouped[dateStr].forEach(t => {
                let amountClass = 'text-red-600'; // recent
                let icon = '';
                if (t.type === 'upcoming') amountClass = 'text-yellow-600'; // auto-pay / subscription
                if (t.type === 'upcoming_manual') {
                    amountClass = 'text-orange-500 font-bold'; // manual pay
                    icon = `<i data-feather="alert-circle" class="w-4 h-4 mr-2 inline-block"></i>`;
                }
                 html += `
                    <li class="flex justify-between items-center bg-white p-2 rounded-md shadow-sm">
                        <span class="flex items-center">${icon}${t.description}</span>
                        <span class="font-semibold ${amountClass}">${formatCurrency(t.amount)}</span>
                    </li>`;
            });
            html += '</ul></div>';
         }
    }
    
    mobileList.innerHTML = html;
    desktopList.innerHTML = html;
    feather.replace();
}

// Replace the old `updateDashboard` function to call the new metrics function
async function updateDashboard() {
    if (!initialDataLoaded) return;
    const incomes = (await getDocs(query(getCollection('income')))).docs.map(doc => doc.data());
    const expenses = (await getDocs(query(getCollection('expenses')))).docs.map(doc => doc.data());
    const people = (await getDocs(query(getCollection('people')))).docs.map(doc => doc.data());
    const budgets = (await getDocs(query(getCollection('budgets')))).docs.map(doc => doc.data());
    const subscriptions = (await getDocs(query(getCollection('subscriptions')))).docs.map(doc => doc.data());

    updateDashboardMetrics(); // This replaces the old summary card function
    renderDashboardTransactions(budgets, subscriptions, expenses);
    updateDashboardDesktopBudgets(budgets, subscriptions, expenses);
    updateDashboardBirthdays(people);
    updateDashboardSpendByCategory(expenses);
}
