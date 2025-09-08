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

// -----------------------------------------------------------------------------
// --- ALL FUNCTION DEFINITIONS (DEFINED BEFORE USE) ---
// -----------------------------------------------------------------------------

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

function getCollection(path) {
    return collection(db, `users/${userId}/${path}`);
}

async function reloadAllData() {
    if (!isAuthReady) return;
    Object.values(activeListeners).forEach(unsub => unsub());
    activeListeners = {};
    
    const collectionsToLoad = {
        'income': loadIncome, 'expenses': loadExpenses, 'subscriptions': loadSubscriptions,
        'budgets': loadBudgets, 'paymentMethods': loadPaymentMethods, 'categories': loadCategories,
        'people': loadPeople, 'creditCardPoints': loadPoints, 'groceryItems': loadGroceryItems,
        'groceryShoppingLists': loadGroceryShoppingLists, 'investmentAccounts': loadInvestmentAccounts
    };

    for (const [name, loader] of Object.entries(collectionsToLoad)) {
        await loadData(name, loader);
    }

    initialDataLoaded = true;
    setTimeout(() => feather.replace(), 100);
}

async function loadData(collectionName, renderFunction) {
    const q = query(getCollection(collectionName));
    activeListeners[collectionName] = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderFunction(data);
    }, (error) => {
        console.error(`Error listening to ${collectionName}:`, error);
        showNotification(`Failed to load ${collectionName} data.`, true);
    });
}

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
        
        if (budget.payType === 'Auto' && currentDay >= budget.dueDay && !isPaid) {
            const updatedPaidMonths = [...(budget.paidMonths || []), currentMonthStr];
            batch.update(docSnap.ref, { paidMonths: updatedPaidMonths });
            updatesMade = true;
        }
    });

    if (updatesMade) {
        await batch.commit();
        showNotification('Auto-paid bills have been marked as paid.');
    }
}

// --- DATA RENDERERS ---
function addEmptyRow(tbody, colspan, message = "No data found.") {
    if (tbody.rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center text-gray-500 p-4">${message}</td></tr>`;
    }
}

async function loadInvestmentAccounts(accounts) {
    const listEl = document.getElementById('investmentList');
    const totalEl = document.getElementById('totalInvestmentsValue');
    listEl.innerHTML = '';
    if (!accounts || accounts.length === 0) {
        listEl.innerHTML = '<p class="text-gray-500">No investment accounts added yet.</p>';
        totalEl.textContent = formatCurrency(0);
        return;
    }

    let totalValue = 0;
    accounts.sort((a, b) => a.name.localeCompare(b.name)).forEach(acc => {
        totalValue += acc.total || 0;
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center p-3 border rounded-lg bg-gray-50';
        div.innerHTML = `
            <div>
                <p class="font-semibold">${acc.name}</p>
                <p class="text-lg">${formatCurrency(acc.total)}</p>
            </div>
            <div>
                <button onclick="editInvestmentAccount('${acc.id}')" class="text-blue-500 hover:underline">Edit</button>
                <button onclick="deleteInvestmentAccount('${acc.id}')" class="text-red-500 hover:underline ml-2">Delete</button>
            </div>`;
        listEl.appendChild(div);
    });

    totalEl.textContent = formatCurrency(totalValue);
    if (document.getElementById('reportsView').offsetParent !== null) {
        generateReports();
    }
}

async function loadIncome(incomes) {
    const list = document.getElementById('incomeList');
    const summaryEl = document.getElementById('incomeSummary');
    list.innerHTML = '';
    let recurringTotal = 0, oneTimeTotal = 0;
    const sourceTotals = {};
    incomes.forEach(income => {
        (income.type === 'recurring') ? recurringTotal += income.amount : oneTimeTotal += income.amount;
        sourceTotals[income.source] = (sourceTotals[income.source] || 0) + income.amount;
        list.insertRow().innerHTML = `
            <td class="border px-4 py-2">${income.name}</td>
            <td class="border px-4 py-2">${income.source}</td>
            <td class="border px-4 py-2">${income.type}</td>
            <td class="border px-4 py-2 text-right">${formatCurrency(income.amount)}</td>
            <td class="border px-4 py-2">${income.date || 'N/A'}</td>
            <td class="border px-4 py-2 text-center">
                <button onclick="editIncome('${income.id}')" class="text-blue-500 hover:underline">Edit</button>
                <button onclick="deleteIncome('${income.id}')" class="text-red-500 hover:underline ml-2">Delete</button>
            </td>`;
    });
    addEmptyRow(list, 6);
    summaryEl.innerHTML = `
        <div><p class="font-semibold">Recurring Total:</p> <p class="text-lg">${formatCurrency(recurringTotal)}</p></div>
        <div><p class="font-semibold">One-Time Total:</p> <p class="text-lg">${formatCurrency(oneTimeTotal)}</p></div>
        ${Object.entries(sourceTotals).map(([source, total]) => `<div><p class="font-semibold">${source}:</p> <p class="text-lg">${formatCurrency(total)}</p></div>`).join('')}`;
    await updateBudgetSummary();
    await updateDashboard();
}

async function loadExpenses(expenses) {
    const list = document.getElementById('expenseList');
    list.innerHTML = '';
    expenses.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(expense => {
        const hasItems = expense.items && expense.items.length > 0;
        const itemizeButtonText = hasItems ? 'View Items' : 'Itemize';
        const itemizeButtonClass = hasItems ? 'text-green-500' : 'text-blue-500';
        list.insertRow().innerHTML = `
            <td class="border px-4 py-2">${expense.payee}</td>
            <td class="border px-4 py-2">${expense.category} / ${expense.subcategory}</td>
            <td class="border px-4 py-2">${expense.paymentType}</td>
            <td class="border px-4 py-2 text-right">${formatCurrency(expense.amount)}</td>
            <td class="border px-4 py-2">${expense.date}</td>
            <td class="border px-4 py-2 text-center">
                <button onclick="openItemizationModal('${expense.id}')" class="${itemizeButtonClass} hover:underline">${itemizeButtonText}</button>
                <button onclick="editExpense('${expense.id}')" class="text-blue-500 hover:underline ml-2">Edit</button>
                <button onclick="deleteExpense('${expense.id}')" class="text-red-500 hover:underline ml-2">Delete</button>
            </td>`;
    });
    addEmptyRow(list, 6);
    await renderExpenseCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
    await updateDashboard();
}

async function loadSubscriptions(subscriptions) {
    const list = document.getElementById('subscriptionList');
    list.innerHTML = '';
    const activeSubs = subscriptions.filter(s => s.status === 'active');
    document.getElementById('totalSubscriptionCost').textContent = formatCurrency(activeSubs.reduce((sum, s) => sum + s.amount, 0));
    subscriptions.forEach(sub => {
        list.insertRow().innerHTML = `
            <td class="border px-4 py-2">${sub.name}</td>
            <td class="border px-4 py-2 text-right">${formatCurrency(sub.amount)}</td>
            <td class="border px-4 py-2">${sub.startDate}</td>
            <td class="border px-4 py-2">${sub.paymentMethod || 'N/A'}</td>
            <td class="border px-4 py-2">${sub.status}</td>
            <td class="border px-4 py-2 text-center">
                 <button onclick="toggleSubscriptionStatus('${sub.id}', '${sub.status}')" class="text-yellow-500 hover:underline">${sub.status === 'active' ? 'Cancel' : 'Reactivate'}</button>
                <button onclick="editSubscription('${sub.id}')" class="text-blue-500 hover:underline ml-2">Edit</button>
                <button onclick="deleteSubscription('${sub.id}')" class="text-red-500 hover:underline ml-2">Delete</button>
            </td>`;
    });
    addEmptyRow(list, 6);
    await renderExpenseCalendar(calendarDate.getFullYear(), calendarDate.getMonth());
    await updateBudgetSummary();
}

async function loadBudgets(budgets) {
    const subsSnapshot = await getDocs(query(getCollection('subscriptions')));
    const subscriptions = subsSnapshot.docs.map(doc => doc.data());
    const list = document.getElementById('budgetList');
    list.innerHTML = '';
    const currentMonthStr = `${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, '0')}`;
    budgets.forEach(budget => {
        const isPaid = (budget.paidMonths || []).includes(currentMonthStr);
        const row = list.insertRow();
        row.className = isPaid ? 'bg-green-50 text-gray-500 line-through' : '';
        const statusHTML = isPaid ? `<button onclick="toggleBudgetPaidStatus('${budget.id}')" class="text-sm text-green-700 font-semibold flex items-center justify-center w-full"><i data-feather="check-circle" class="w-4 h-4 mr-1"></i> Paid</button>` : `<button onclick="toggleBudgetPaidStatus('${budget.id}')" class="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded-md hover:bg-gray-300">Mark Paid</button>`;
        row.innerHTML = `
            <td class="border px-4 py-2">${budget.category}</td>
            <td class="border px-4 py-2">${budget.subcategory}</td>
            <td class="border px-4 py-2">${budget.paymentMethod || 'Any'}</td>
            <td class="border px-4 py-2">${budget.payType || 'Manual'}</td>
            <td class="border px-4 py-2 text-right">${budget.dueDay || 'N/A'}</td>
            <td class="border px-4 py-2 text-right">${formatCurrency(budget.amount)}</td>
            <td class="border px-4 py-2 text-center">${statusHTML}</td>
            <td class="border px-4 py-2 text-center">
                <button onclick="editBudget('${budget.id}')" class="text-blue-500 hover:underline">Edit</button>
                <button onclick="deleteBudget('${budget.id}')" class="text-red-500 hover:underline ml-2">Delete</button>
            </td>`;
    });
    const activeSubCost = subscriptions.filter(s => s.status === 'active').reduce((sum, s) => sum + s.amount, 0);
    if (activeSubCost > 0) {
        list.insertRow().innerHTML = `
            <td class="border px-4 py-2 font-semibold">Subscriptions</td><td class="border px-4 py-2">Recurring</td>
            <td class="border px-4 py-2">Various</td><td class="border px-4 py-2">Auto</td>
            <td class="border px-4 py-2 text-right">Varies</td><td class="border px-4 py-2 text-right">${formatCurrency(activeSubCost)}</td>
            <td class="border px-4 py-2 text-center text-sm font-semibold text-green-700">Paid (Auto)</td>
            <td class="border px-4 py-2 text-center text-sm text-gray-500">Auto</td>`;
    }
    addEmptyRow(list, 8);
    await updateBudgetSummary();
    feather.replace();
}

async function loadPaymentMethods(methods) {
    const list = document.getElementById('paymentMethodList');
    list.innerHTML = '';
    const selects = ['expensePaymentType', 'budgetPaymentMethod', 'subscriptionPaymentMethod', 'pointsCard'].map(id => document.getElementById(id));
    selects.forEach(s => s.innerHTML = '<option value="">Select Method</option>');
    methods.forEach(method => {
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center p-2 border-b';
        li.innerHTML = `
            <span class="flex items-center">
                <i class="h-5 w-5 mr-2 text-gray-500" data-feather="${method.type === 'Credit Card' ? 'credit-card' : 'briefcase'}"></i>
                ${method.name} (${method.type})
            </span>
            <div>
                <button onclick="editPaymentMethod('${method.id}')" class="text-blue-500 hover:underline">Edit</button>
                <button onclick="deletePaymentMethod('${method.id}')" class="text-red-500 hover:underline ml-2">Delete</button>
            </div>`;
        list.appendChild(li);
        selects.forEach(select => {
            if (select.id === 'pointsCard' && method.type !== 'Credit Card') return;
            select.add(new Option(method.name, method.name));
        });
    });
    feather.replace();
}

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

async function loadPeople(people) {
    const list = document.getElementById('peopleList');
    list.innerHTML = '';
    people.forEach(person => {
        list.insertAdjacentHTML('beforeend', `
            <li class="flex justify-between items-center p-2 border-b">
                <span>${person.name} (Birthday: ${person.birthday})</span>
                <div>
                    <button onclick="editPerson('${person.id}')" class="text-blue-500 hover:underline">Edit</button>
                    <button onclick="deletePerson('${person.id}')" class="text-red-500 hover:underline ml-2">Delete</button>
                </div>
            </li>`);
    });
    if (people.length === 0) list.innerHTML = '<p class="text-gray-500 p-2">No people added yet.</p>';
    updateDashboard();
}

async function loadPoints(points) {
    const list = document.getElementById('pointsList');
    list.innerHTML = '';
    points.forEach(point => {
        list.insertRow().innerHTML = `
            <td class="border px-4 py-2">${point.category}</td>
            <td class="border px-4 py-2">${point.subcategory}</td>
            <td class="border px-4 py-2">${point.card}</td>
            <td class="border px-4 py-2 text-right">${point.multiplier}x</td>
            <td class="border px-4 py-2 text-center">
                <button onclick="editPoint('${point.id}')" class="text-blue-500 hover:underline">Edit</button>
                <button onclick="deletePoint('${point.id}')" class="text-red-500 hover:underline ml-2">Delete</button>
            </td>`;
    });
    addEmptyRow(list, 5);
}

async function loadGroceryItems(items) {
    const listEl = document.getElementById('groceryItemList');
    const dataListEl = document.getElementById('groceryDataList');
    const selectEl = document.getElementById('groceryItemSelect');
    listEl.innerHTML = '';
    dataListEl.innerHTML = '';
    selectEl.innerHTML = '<option value="">Select an item</option>';
    items.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
        listEl.insertAdjacentHTML('beforeend', `
            <li class="flex justify-between items-center p-2 border-b">
                <span>${item.name}</span>
                <button onclick="deleteGroceryItem('${item.id}')" class="text-red-500 hover:underline">Delete</button>
            </li>`);
        dataListEl.add(new Option('', item.name));
        selectEl.add(new Option(item.name, item.name));
    });
    if (items.length === 0) listEl.innerHTML = '<p class="text-gray-500 p-2">No grocery items added yet.</p>';
}

async function loadGroceryShoppingLists(lists) {
    const listEl = document.getElementById('shoppingLists');
    listEl.innerHTML = '';
    if (lists.length === 0) {
        listEl.innerHTML = '<p class="text-gray-500">No shopping lists found. Create one above!</p>';
        return;
    }
    lists.sort((a, b) => b.createdAt.seconds - a.createdAt.seconds).forEach(list => {
        const totalCost = list.items.reduce((sum, item) => sum + (item.amount || 0), 0);
        const itemsHTML = list.items.map(item => `<li class="ml-4 text-sm">- ${item.name} (${formatCurrency(item.amount || 0)})</li>`).join('');
        listEl.insertAdjacentHTML('beforeend', `
            <div class="bg-gray-50 p-4 rounded-lg shadow-sm mb-4">
                <div class="flex justify-between items-center">
                    <h4 class="font-semibold text-lg">${list.name}</h4>
                    <span class="text-sm text-gray-600">${new Date(list.createdAt.seconds * 1000).toLocaleDateString()}</span>
                </div>
                <p class="text-xl font-bold mt-2">Total: ${formatCurrency(totalCost)}</p>
                <p class="font-semibold mt-2">Items:</p>
                <ul class="list-disc list-inside mt-1">${itemsHTML}</ul>
                <div class="flex justify-end gap-2 mt-4">
                   <button onclick="editGroceryShoppingList('${list.id}')" class="px-3 py-1 bg-blue-500 text-white text-sm rounded-md hover:bg-blue-600">Edit</button>
                   <button onclick="deleteGroceryShoppingList('${list.id}')" class="px-3 py-1 bg-red-500 text-white text-sm rounded-md hover:bg-red-600">Delete</button>
                </div>
            </div>`);
    });
}

// --- FORM HANDLERS & SETUP ---
function setupForms() {
    document.getElementById('investmentForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = { name: e.target.investmentName.value, total: parseFloat(e.target.investmentTotal.value) };
        const id = e.target.investmentId.value;
        if (id) await updateDoc(doc(getCollection('investmentAccounts'), id), data);
        else await addDoc(getCollection('investmentAccounts'), data);
        e.target.reset();
        showNotification('Investment account saved.');
    });

    document.getElementById('incomeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = { name: e.target.incomeName.value, source: e.target.incomeSource.value, type: e.target.incomeType.value, amount: parseFloat(e.target.incomeAmount.value), date: e.target.incomeDate.value };
        const id = e.target.incomeId.value;
        if (id) await updateDoc(doc(getCollection('income'), id), data);
        else await addDoc(getCollection('income'), data);
        e.target.reset();
        showNotification('Income saved.');
    });

    document.getElementById('expenseForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = { payee: e.target.expensePayee.value, category: e.target.expenseCategory.value, subcategory: e.target.expenseSubcategory.value, paymentType: e.target.expensePaymentType.value, amount: parseFloat(e.target.expenseAmount.value), date: e.target.expenseDate.value, notes: e.target.expenseNotes.value };
        const id = e.target.expenseId.value;
        if (id) {
            const docRef = doc(getCollection('expenses'), id);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) data.items = docSnap.data().items || [];
            await updateDoc(docRef, data);
        } else {
            data.items = [];
            await addDoc(getCollection('expenses'), data);
        }
        e.target.reset();
        showNotification('Expense saved.');
    });

    document.getElementById('subscriptionForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = e.target.subscriptionId.value;
        const data = { name: e.target.subscriptionName.value, amount: parseFloat(e.target.subscriptionAmount.value), startDate: e.target.subscriptionStartDate.value, paymentMethod: e.target.subscriptionPaymentMethod.value };
        if (id) await updateDoc(doc(getCollection('subscriptions'), id), data);
        else {
            data.status = 'active';
            await addDoc(getCollection('subscriptions'), data);
        }
        e.target.reset();
        showNotification('Subscription saved.');
    });

    document.getElementById('budgetForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = { category: e.target.budgetCategory.value, subcategory: e.target.budgetSubcategory.value, amount: parseFloat(e.target.budgetAmount.value), paymentMethod: e.target.budgetPaymentMethod.value, payType: e.target.budgetPayType.value, dueDay: parseInt(e.target.budgetDueDay.value) || null };
        const id = e.target.budgetId.value;
        if(id){
            const docRef = doc(getCollection('budgets'), id);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) data.paidMonths = docSnap.data().paidMonths || [];
            await updateDoc(docRef, data);
        } else {
            data.paidMonths = [];
            await addDoc(getCollection('budgets'), data);
        }
        e.target.reset();
        showNotification('Budget saved.');
    });

    document.getElementById('paymentMethodForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = { name: e.target.paymentMethodName.value, type: e.target.paymentMethodType.value };
        const id = e.target.paymentMethodId.value;
        if (id) await updateDoc(doc(getCollection('paymentMethods'), id), data);
        else await addDoc(getCollection('paymentMethods'), data);
        e.target.reset();
        showNotification('Payment method saved.');
    });

    document.getElementById('categoryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addDoc(getCollection('categories'), { name: e.target.categoryName.value, subcategories: [] });
        e.target.reset();
        showNotification('Category added.');
    });

    document.getElementById('personForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = { name: e.target.personName.value, birthday: e.target.personBirthday.value };
        const id = e.target.personId.value;
        if (id) await updateDoc(doc(getCollection('people'), id), data);
        else await addDoc(getCollection('people'), data);
        e.target.reset();
        showNotification('Person saved.');
    });

    document.getElementById('groceryItemForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addDoc(getCollection('groceryItems'), { name: e.target.newGroceryItemName.value });
        e.target.reset();
        showNotification('Grocery item added.');
    });

    document.getElementById('pointsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = { category: e.target.pointsCategory.value, subcategory: e.target.pointsSubcategory.value, card: e.target.pointsCard.value, multiplier: parseFloat(e.target.pointsMultiplier.value) };
        const id = e.target.pointsId.value;
        if (id) await updateDoc(doc(getCollection('creditCardPoints'), id), data);
        else await addDoc(getCollection('creditCardPoints'), data);
        e.target.reset();
        showNotification('Point rule saved.');
    });

    document.getElementById('createShoppingListForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const listName = e.target.shoppingListName.value;
        const itemsRaw = e.target.shoppingListItems.value;
        if (!listName || !itemsRaw) return showNotification('Please enter a list name and at least one item.', true);
        
        const items = itemsRaw.split('\n').map(line => {
            const [name, amount] = line.split(',');
            return { name: name.trim(), amount: parseFloat(amount) || 0 };
        }).filter(item => item.name);
        
        const data = { name: listName, items: items };
        const id = e.target.shoppingListId.value;
        if (id) {
            await updateDoc(doc(getCollection('groceryShoppingLists'), id), data);
            showNotification('Shopping list updated!');
        } else {
            data.createdAt = serverTimestamp();
            await addDoc(getCollection('groceryShoppingLists'), data);
            showNotification('Shopping list created!');
        }
        e.target.reset();
        e.target.querySelector('button[type="submit"]').textContent = 'Save List';
    });
    
    document.getElementById('cancelEditListBtn').addEventListener('click', () => {
        const form = document.getElementById('createShoppingListForm');
        form.reset();
        form.shoppingListId.value = '';
        form.querySelector('button[type="submit"]').textContent = 'Save List';
    });

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
                const updatedSubcategories = [...(category.subcategories || []), subcategoryName];
                await updateDoc(docRef, { subcategories: updatedSubcategories });
                e.target.querySelector('input').value = '';
                showNotification('Subcategory added.');
            }
        }
    });

    // Event listeners for other UI elements
    document.getElementById('exportButton').addEventListener('click', exportData);
    document.getElementById('importFile').addEventListener('change', importData);
    document.getElementById('importCsvFile').addEventListener('change', importCsvData);
    document.getElementById('expenseCategory').addEventListener('change', (e) => handleCategoryChange(e.target.value, 'expenseSubcategory'));
    document.getElementById('budgetCategory').addEventListener('change', (e) => handleCategoryChange(e.target.value, 'budgetSubcategory'));
    document.getElementById('pointsCategory').addEventListener('change', (e) => handleCategoryChange(e.target.value, 'pointsSubcategory'));
    document.getElementById('toggleCalendarBtn').addEventListener('click', () => {
        const calendarContainer = document.getElementById('calendarContainer');
        const btn = document.getElementById('toggleCalendarBtn');
        calendarContainer.classList.toggle('hidden');
        btn.textContent = calendarContainer.classList.contains('hidden') ? 'View Calendar' : 'Hide Calendar';
    });
    document.getElementById('reportMonth').addEventListener('change', generateReports);
    document.getElementById('reportYear').addEventListener('change', generateYearlyReports);
    document.getElementById('groceryItemSelect').addEventListener('change', generateYearlyReports);
}

// ... (All Edit/Delete and Utility functions go here, they are unchanged from the previous version)

// --- GLOBAL EXPORTS (Must be after all function definitions) ---
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

// --- APP INITIALIZATION (Runs last) ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        // This is the critical fix: Setup auth listeners immediately.
        setupAuthView();

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
        
    } catch (error) {
        console.error("Initialization failed:", error);
        showNotification("App failed to initialize. Check console.", true);
    }
});
