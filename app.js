
/* SAMA BUSINESS V1
   Authentification Supabase + gestion locale IndexedDB.
   La synchronisation des données sera ajoutée dans une prochaine étape.
*/

const SUPABASE_URL = "https://pumazxowmymwmfthlbqw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1bWF6eG93bXltd21mdGhsYnF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwMzc5MTIsImV4cCI6MjExMDYxMzkxMn0.2gVhfIMDxx4JlU5LG-pIDuht7T5D50loJOi7TQE3hYY";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const DB_NAME = "sama_business_v1";
const DB_VERSION = 1;

let db;
let currentUser = null;
let currentBusinessId = null;
let currentBusinessName = "";
let currentSubscription = null;
let editingProductId = null;

const $ = (id) => document.getElementById(id);

function setMessage(id, message, error = false) {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.style.color = error ? "#b42318" : "#1d765d";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* BASE DE DONNÉES LOCALE */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains("products")) {
        database.createObjectStore("products", { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains("sales")) {
        database.createObjectStore("sales", { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains("expenses")) {
        database.createObjectStore("expenses", { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function all(storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly")
      .objectStore(storeName).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error);
  });
}

/* SYNCHRONISATION DES PRODUITS AVEC SUPABASE */

function toCloudProduct(product) {
  return {
    id: product.id,
    business_id: currentBusinessId,
    name: product.name,
    sale_price: Number(product.price || 0),
    purchase_cost: Number(product.cost || 0),
    stock_quantity: Number(product.stock || 0),
    low_stock_threshold: Number(product.threshold ?? 5),
    is_active: true
  };
}

function fromCloudProduct(product) {
  return {
    id: product.id,
    name: product.name,
    price: Number(product.sale_price || 0),
    cost: Number(product.purchase_cost || 0),
    stock: Number(product.stock_quantity || 0),
    threshold: Number(product.low_stock_threshold ?? 5),
    date: product.created_at || new Date().toISOString()
  };
}

async function syncProductsFromCloud() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .eq("business_id", currentBusinessId)
    .eq("is_active", true);

  if (error) throw error;

  const localProducts = await all("products");

  // Première synchronisation : récupérer les anciens produits du téléphone.
  if (data.length === 0 && localProducts.length > 0) {
    const productsToUpload = localProducts.map(toCloudProduct);

    const { error: uploadError } = await supabaseClient
      .from("products")
      .upsert(productsToUpload);

    if (uploadError) throw uploadError;

    return;
  }

  // Le cloud devient la référence pour les produits.
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("products", "readwrite");
    const store = transaction.objectStore("products");

    store.clear();

    data.forEach((product) => {
      store.put(fromCloudProduct(product));
    });

    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function syncSalesFromCloud() {
  const { data, error } = await supabaseClient
    .from("sales")
    .select(`
      id,
      total_amount,
      payment_method,
      occurred_at,
      sale_items (
        product_id,
        product_name_snapshot,
        quantity,
        unit_price,
        unit_cost
      )
    `)
    .eq("business_id", currentBusinessId)
    .order("occurred_at", { ascending: false });

  if (error) throw error;

  const localSales = await all("sales");
  const salesMap = new Map(
    localSales.map((sale) => [sale.id, sale])
  );

  data.forEach((sale) => {
    const item = sale.sale_items?.[0];

    salesMap.set(sale.id, {
      id: sale.id,
      productId: item?.product_id || null,
      productName: item?.product_name_snapshot || "Vente",
      quantity: Number(item?.quantity || 0),
      unitPrice: Number(item?.unit_price || 0),
      unitCost: Number(item?.unit_cost || 0),
      total: Number(sale.total_amount || 0),
      payment: sale.payment_method,
      date: sale.occurred_at
    });
  });

  await new Promise((resolve, reject) => {
    const transaction = db.transaction("sales", "readwrite");
    const store = transaction.objectStore("sales");

    store.clear();

    salesMap.forEach((sale) => store.put(sale));

    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function syncExpensesFromCloud() {
  const { data, error } = await supabaseClient
    .from("expenses")
    .select("id,name,amount,category,occurred_at")
    .eq("business_id", currentBusinessId)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  const expenses = (data || []).map((item) => ({
    id: item.id,
    name: item.name,
    amount: Number(item.amount || 0),
    category: item.category || "",
    date: item.occurred_at
  }));
  await new Promise((resolve, reject) => {
    const tx = db.transaction("expenses", "readwrite");
    const store = tx.objectStore("expenses");
    store.clear();
    expenses.forEach((item) => store.put(item));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function dayRecords(records) {
  const today = new Date().toDateString();

  return records.filter((record) => {
    const date = new Date(record.date || record.createdAt || Date.now());
    return date.toDateString() === today;
  });
}

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0)) + " FCFA";
}

/* AUTHENTIFICATION */

function showAuth() {
  if ($("authScreen")) $("authScreen").hidden = false;
  if ($("appShell")) $("appShell").hidden = true;
}

function showApp() {
  if ($("authScreen")) $("authScreen").hidden = true;
  if ($("appShell")) $("appShell").hidden = false;
}

function switchAuthMode() {
  const signup = $("signupForm");
  const login = $("loginForm");

  if (!signup || !login) return;

  const showSignup = signup.hidden;

  signup.hidden = !showSignup;
  login.hidden = showSignup;

  if ($("authSwitchText")) {
    $("authSwitchText").textContent = showSignup
      ? "Déjà un compte ?"
      : "Pas encore de compte ?";
  }

  if ($("authSwitch")) {
    $("authSwitch").textContent = showSignup
      ? "Se connecter"
      : "Créer un compte";
  }

  setMessage("signupMessage", "");
  setMessage("loginMessage", "");
}

async function signup(event) {
  event.preventDefault();

  const fullName = $("fullName")?.value.trim();
  const businessName = $("businessName")?.value.trim();
  const email = $("authEmail")?.value.trim();
  const password = $("authPassword")?.value;

  if (!fullName || !businessName || !email || !password) {
    setMessage("signupMessage", "Remplis tous les champs.", true);
    return;
  }

  if (password.length < 8) {
    setMessage("signupMessage", "Le mot de passe doit contenir au moins 8 caractères.", true);
    return;
  }

  const button = $("signupButton");
  if (button) button.disabled = true;

  setMessage("signupMessage", "Création de ton compte...");

  try {
    localStorage.setItem("sama_pending_business", businessName);
    localStorage.setItem("sama_pending_name", fullName);

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });

    if (error) throw error;

    if (data.session) {
      currentUser = data.user;
      await finishOnboarding(businessName, fullName);
    } else {
      setMessage(
        "signupMessage",
        "Compte créé ! Vérifie ta boîte mail et confirme ton adresse. Ensuite, connecte-toi pour terminer la création de ton entreprise."
      );
    }
  } catch (error) {
    setMessage("signupMessage", error.message || "Impossible de créer le compte.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function login(event) {
  event.preventDefault();

  const email = $("loginEmail")?.value.trim();
  const password = $("loginPassword")?.value;

  if (!email || !password) {
    setMessage("loginMessage", "Entre ton email et ton mot de passe.", true);
    return;
  }

  const button = $("loginButton");
  if (button) button.disabled = true;

  setMessage("loginMessage", "Connexion en cours...");

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    currentUser = data.user;
    await loadUserBusiness();
  } catch (error) {
    setMessage("loginMessage", error.message || "Connexion impossible.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function finishOnboarding(businessName, fullName) {
  const { data: businessId, error } = await supabaseClient.rpc(
    "create_business",
    { p_business_name: businessName, p_full_name: fullName }
  );

  if (error) throw new Error(error.message || "La création de l'entreprise a échoué.");
  if (!businessId) throw new Error("Supabase n'a pas retourné l'identifiant de l'entreprise.");

  currentBusinessId = businessId;
  currentBusinessName = businessName;

  localStorage.removeItem("sama_pending_business");
  localStorage.removeItem("sama_pending_name");

  await loadSubscription();
  await startApplication();
}

async function loadUserBusiness() {
  const { data: memberships, error } = await supabaseClient
    .from("business_members")
    .select("business_id")
    .eq("user_id", currentUser.id)
    .limit(1);

  if (error) throw error;

  if (memberships && memberships.length) {
    currentBusinessId = memberships[0].business_id;

    const { data: business, error: businessError } = await supabaseClient
      .from("businesses")
      .select("name")
      .eq("id", currentBusinessId)
      .single();

    if (businessError) throw businessError;

    currentBusinessName = business.name;
  } else {
    const pendingName = localStorage.getItem("sama_pending_business");
    const fullName =
      localStorage.getItem("sama_pending_name") ||
      currentUser.user_metadata?.full_name ||
      "";

    if (!pendingName) {
      const name = window.prompt("Quel est le nom de ton entreprise ?");
      if (!name || !name.trim()) {
        setMessage("loginMessage", "Entre le nom de ton entreprise pour continuer.", true);
        return;
      }
      await finishOnboarding(name.trim(), fullName);
      return;
    }

    await finishOnboarding(pendingName, fullName);
    return;
  }

  await loadSubscription();
  await startApplication();
}

async function loadSubscription() {
  const { data, error } = await supabaseClient
    .from("subscriptions")
    .select("plan,status,current_period_end")
    .eq("business_id", currentBusinessId)
    .single();

  if (error) throw error;

  currentSubscription = data;
}

function renderSubscription() {
  const target = $("subscriptionInfo");
  if (!target || !currentSubscription) return;

  const sub = currentSubscription;
  const planNames = {
    starter: "Starter",
    business: "Business",
    premium: "Premium"
  };

  let message = "";
  if (sub.status === "trial") {
    message = "Ton essai gratuit est en cours.";
  } else if (sub.status === "active" && sub.current_period_end) {
    message = `Abonnement ${planNames[sub.plan] || sub.plan} actif jusqu'au ${new Date(sub.current_period_end).toLocaleDateString("fr-FR")}.`;
  } else {
    message = `Abonnement : ${planNames[sub.plan] || sub.plan} — statut : ${sub.status}.`;
  }

  target.textContent = message;

  const banner = $("subscriptionBanner");
  if (banner) banner.hidden = false;
}

/* APPLICATION */

async function startApplication() {
  if (!db) db = await openDB();

  showApp();

  renderSubscription();

  try {
    await syncProductsFromCloud();
  } catch (error) {
    console.error("Synchronisation des produits :", error);
    alert("Erreur de synchronisation : " + error.message);
  }

  try {
    await syncSalesFromCloud();
  } catch (error) {
    console.error("Synchronisation des ventes :", error);
    alert("Erreur de synchronisation des ventes : " + error.message);
  }

  try {
    await syncExpensesFromCloud();
  } catch (error) {
    console.error("Synchronisation des dépenses :", error);
    alert("Erreur de synchronisation des dépenses : " + error.message);
  }

  await render();
}
async function logout() {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    alert("Impossible de fermer la session : " + error.message);
    return;
  }

  currentUser = null;
  currentBusinessId = null;
  currentBusinessName = "";
  currentSubscription = null;

  showAuth();
}

/* TABLEAU DE BORD */

async function render() {
  if (!db) return;

  const products = await all("products");
  const sales = await all("sales");
  const expenses = await all("expenses");

  const todaySales = dayRecords(sales);
  const todayExpenses = dayRecords(expenses);

  const revenue = todaySales.reduce(
    (sum, sale) => sum + Number(sale.total || 0), 0
  );

  const expenseTotal = todayExpenses.reduce(
    (sum, expense) => sum + Number(expense.amount || 0), 0
  );

  const costOfGoods = todaySales.reduce((sum, sale) =>
    sum + Number(sale.unitCost || 0) * Number(sale.quantity || 0), 0
  );
  const profit = revenue - costOfGoods - expenseTotal;

  const stockCount = products.reduce(
    (sum, product) => sum + Number(product.stock || 0), 0
  );

  if ($("revenue")) $("revenue").textContent = formatMoney(revenue);
  if ($("expenses")) $("expenses").textContent = formatMoney(expenseTotal);
  if ($("profit")) $("profit").textContent = formatMoney(profit);
  if ($("stockCount")) $("stockCount").textContent = stockCount;

  renderProducts(products);
  renderSales(sales);
  renderExpenses(expenses);
  renderAlerts(products);
  renderRecent(sales, expenses);

  const select = $("saleProduct");
  if (select) {
    const previous = select.value;
    select.innerHTML = '<option value="">Choisir un produit</option>';

    products.forEach((product) => {
      if (Number(product.stock) <= 0) return;

      const option = document.createElement("option");
      option.value = product.id;
      option.textContent = `${product.name} — ${formatMoney(product.price)} (Stock : ${product.stock})`;
      select.appendChild(option);
    });

    if (previous) select.value = previous;
  }
}

function renderProducts(products) {
  const target = $("productsList");
  if (!target) return;

  if (!products.length) {
    target.innerHTML = '<p class="muted">Aucun produit enregistré.</p>';
    return;
  }

  target.innerHTML = products.map((product) => `
    <div class="record product-record">
      <div><strong>${escapeHTML(product.name)}</strong>
      <div>${formatMoney(product.price)} · Stock : ${escapeHTML(product.stock)}</div>
      <small class="muted">Coût d'achat : ${formatMoney(product.cost)}</small></div>
      <div class="record-actions">
        <button type="button" class="button secondary" data-edit-product="${escapeHTML(product.id)}">Modifier</button>
        <button type="button" class="button danger" data-delete-product="${escapeHTML(product.id)}">Supprimer</button>
      </div>
    </div>
  `).join("");
}

function renderSales(sales) {
  const target = $("salesList");
  if (!target) return;

  const sorted = [...sales].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  if (!sorted.length) {
    target.innerHTML = '<p class="muted">Aucune vente enregistrée.</p>';
    return;
  }

  target.innerHTML = sorted.slice(0, 30).map((sale) => `
    <div class="record">
      <strong>${escapeHTML(sale.productName || "Vente")}</strong>
      <div>${escapeHTML(sale.quantity)} unité(s) · ${formatMoney(sale.total)}</div>
      <small class="muted">${new Date(sale.date).toLocaleString("fr-FR")}</small>
    </div>
  `).join("");
}

function renderExpenses(expenses) {
  const target = $("expensesList");
  if (!target) return;

  const sorted = [...expenses].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  if (!sorted.length) {
    target.innerHTML = '<p class="muted">Aucune dépense enregistrée.</p>';
    return;
  }

  target.innerHTML = sorted.slice(0, 30).map((expense) => `
    <div class="record">
      <strong>${escapeHTML(expense.name)}</strong>
      <div>${formatMoney(expense.amount)}</div>
      <small class="muted">${new Date(expense.date).toLocaleString("fr-FR")}</small>
    </div>
  `).join("");
}

function renderAlerts(products) {
  const target = $("alerts");
  if (!target) return;

  const low = products.filter(
    (product) => Number(product.stock) <= Number(product.threshold || 0)
  );

  target.innerHTML = low.length
    ? low.map((product) => `
      <div class="warning">
        Stock faible : <strong>${escapeHTML(product.name)}</strong>
        — ${escapeHTML(product.stock)} restant(s)
      </div>
    `).join("")
    : '<p class="muted">Aucune alerte de stock.</p>';
}

function renderRecent(sales, expenses) {
  const target = $("recent");
  if (!target) return;

  const items = [
    ...sales.map((item) => ({
      label: `Vente : ${item.productName || "Produit"}`,
      amount: item.total,
      date: item.date
    })),
    ...expenses.map((item) => ({
      label: `Dépense : ${item.name}`,
      amount: -Number(item.amount),
      date: item.date
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  target.innerHTML = items.length
    ? items.slice(0, 8).map((item) => `
      <div class="record">
        <strong>${escapeHTML(item.label)}</strong>
        <div>${formatMoney(item.amount)}</div>
        <small class="muted">${new Date(item.date).toLocaleString("fr-FR")}</small>
      </div>
    `).join("")
    : '<p class="muted">Aucune opération récente.</p>';
}

/* AJOUT PRODUIT */


async function addProduct(event) {
  event.preventDefault();
  const name = $("productName")?.value.trim();
  const price = Number($("productPrice")?.value);
  const cost = Number($("productCost")?.value || 0);
  const stock = Number($("productStock")?.value);
  if (!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(stock) || stock < 0 || !currentBusinessId) {
    setMessage("productMessage", "Vérifie les informations du produit.", true);
    return;
  }

  const localProduct = {
    id: editingProductId || uuid(), name, price, cost, stock,
    threshold: 5, date: new Date().toISOString()
  };
  const cloudProduct = toCloudProduct(localProduct);
  const request = editingProductId
    ? supabaseClient.from("products").update({ name, sale_price: price, purchase_cost: cost, stock_quantity: stock, updated_at: new Date().toISOString() }).eq("id", editingProductId).eq("business_id", currentBusinessId)
    : supabaseClient.from("products").insert(cloudProduct);
  const { error } = await request;
  if (error) {
    setMessage("productMessage", "Erreur d'enregistrement : " + error.message, true);
    return;
  }
  await put("products", localProduct);
  editingProductId = null;
  $("productForm").reset();
  const submit = $("productForm")?.querySelector('button[type="submit"]');
  if (submit) submit.textContent = "Ajouter le produit";
  setMessage("productMessage", "Produit enregistré avec succès.");
  await render();
}

async function editProduct(productId) {
  const products = await all("products");
  const product = products.find((item) => item.id === productId);
  if (!product) return;
  editingProductId = productId;
  $("productName").value = product.name;
  $("productPrice").value = product.price;
  $("productCost").value = product.cost;
  $("productStock").value = product.stock;
  const submit = $("productForm")?.querySelector('button[type="submit"]');
  if (submit) submit.textContent = "Enregistrer les modifications";
  $("productForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteProduct(productId) {
  const product = (await all("products")).find((item) => item.id === productId);
  if (!product || !confirm(`Supprimer « ${product.name} » de l'inventaire ?`)) return;
  const { error } = await supabaseClient.from("products")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", productId).eq("business_id", currentBusinessId);
  if (error) {
    setMessage("productMessage", "Suppression impossible : " + error.message, true);
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction("products", "readwrite");
    tx.objectStore("products").delete(productId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  setMessage("productMessage", "Produit retiré de l'inventaire.");
  await render();
}

/* ENREGISTRER UNE VENTE */



async function addSale(event) {
  event.preventDefault();

  const productId = $("saleProduct")?.value;
  const quantity = Number($("saleQty")?.value);
  const payment = $("salePayment")?.value || "cash";

  if (!productId || quantity <= 0 || !currentBusinessId) {
    setMessage("saleMessage", "Choisis un produit et une quantité valide.", true);
    return;
  }

  const products = await all("products");
  const product = products.find((item) => item.id === productId);

  if (!product) {
    setMessage("saleMessage", "Produit introuvable.", true);
    return;
  }

  if (Number(product.stock) < quantity) {
    setMessage("saleMessage", "Stock insuffisant pour cette vente.", true);
    return;
  }

  const { data: saleId, error } = await supabaseClient.rpc(
    "create_sale",
    {
      p_business_id: currentBusinessId,
      p_product_id: productId,
      p_quantity: quantity,
      p_payment_method: payment
    }
  );

  if (error) {
    console.error("Erreur d'enregistrement de la vente :", error);
    setMessage("saleMessage", "Erreur : " + error.message, true);
    return;
  }

  const { data: cloudProduct, error: productError } = await supabaseClient
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("business_id", currentBusinessId)
    .maybeSingle();

  if (cloudProduct) {
    await put("products", fromCloudProduct(cloudProduct));
  } else {
    product.stock = Number(product.stock) - quantity;
    await put("products", product);
    console.error("Actualisation du stock :", productError);
  }

  await put("sales", {
    id: saleId,
    productId,
    productName: product.name,
    quantity,
    unitPrice: Number(product.price),
    unitCost: Number(product.cost || 0),
    total: Number(product.price) * quantity,
    payment,
    date: new Date().toISOString()
  });

  $("saleForm").reset();
  setMessage("saleMessage", "Vente enregistrée et synchronisée avec succès.");

  await render();
}
/* AJOUT DÉPENSE */

async function addExpense(event) {
  event.preventDefault();
  const name = $("expenseName")?.value.trim();
  const amount = Number($("expenseAmount")?.value);
  if (!name || !Number.isFinite(amount) || amount <= 0 || !currentBusinessId) {
    setMessage("expenseMessage", "Entre un motif et un montant valide.", true);
    return;
  }
  const expense = {
    id: uuid(),
    business_id: currentBusinessId,
    name,
    amount: Math.round(amount),
    category: null,
    occurred_at: new Date().toISOString()
  };
  const { error } = await supabaseClient.from("expenses").insert(expense);
  if (error) {
    setMessage("expenseMessage", "Erreur d'enregistrement : " + error.message, true);
    return;
  }
  await put("expenses", {
    id: expense.id, name, amount: expense.amount, category: "", date: expense.occurred_at
  });
  $("expenseForm").reset();
  setMessage("expenseMessage", "Dépense enregistrée et synchronisée.");
  await render();
}

/* NAVIGATION */

function setupNavigation() {
  const initial = document.querySelector("[data-view].active")?.dataset.view || "dashboard";
  document.querySelectorAll(".view").forEach((view) => {
    const selected = view.id === "view-" + initial;
    view.classList.toggle("active", selected);
    view.classList.toggle("hidden", !selected);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const viewName = button.dataset.view;

      document.querySelectorAll("[data-view]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });

      document.querySelectorAll(".view").forEach((view) => {
        const selected = view.id === "view-" + viewName;
        view.classList.toggle("active", selected);
        // .hidden uses display:none !important; remove it from the selected panel.
        view.classList.toggle("hidden", !selected);
      });
    });
  });
}

/* LANGUE : traduction de l'ensemble de l'interface */
const translations = {
  fr: {},
  en: {
    "Bonjour": "Hello", "Votre commerce, mieux organisé.": "Your business, better organized.",
    "ESPACE COMMERÇANT": "BUSINESS SPACE", "Voici la situation de votre commerce.": "Here is your business overview.",
    "Langue": "Language", "Votre abonnement": "Your subscription", "Chargement de votre abonnement…": "Loading your subscription…",
    "Chiffre d'affaires": "Revenue", "Dépenses": "Expenses", "Résultat estimé": "Estimated profit", "Articles en stock": "Items in stock",
    "Aujourd'hui": "Today", "Unités disponibles": "Available units", "Ventes - coûts - dépenses": "Sales - costs - expenses",
    "Accueil": "Home", "Ventes": "Sales", "Produits": "Products", "Vue d'ensemble": "Overview", "Actualiser": "Refresh",
    "Alertes de stock": "Low-stock alerts", "Dernières opérations": "Recent activity", "Aucune alerte de stock.": "No stock alerts.",
    "Aucune opération récente.": "No recent activity.", "Aucune opération enregistrée.": "No activity recorded.",
    "Vos données seront progressivement synchronisées avec votre espace sécurisé.": "Your data will be synchronized with your secure account.",
    "Nouvelle vente": "New sale", "Produit": "Product", "Quantité": "Quantity", "Paiement": "Payment",
    "Espèces": "Cash", "Autre": "Other", "Enregistrer la vente": "Save sale", "Historique des ventes": "Sales history",
    "Aucune vente enregistrée.": "No sales recorded.", "Produits et stocks": "Products and stock", "Nom du produit": "Product name",
    "Prix de vente (FCFA)": "Selling price (FCFA)", "Coût unitaire (FCFA)": "Unit cost (FCFA)", "Stock initial": "Initial stock",
    "Ajouter le produit": "Add product", "Inventaire": "Inventory", "Aucun produit enregistré.": "No products recorded.",
    "Enregistrer une dépense": "Record an expense", "Motif": "Description", "Montant (FCFA)": "Amount (FCFA)",
    "Enregistrer la dépense": "Save expense", "Historique des dépenses": "Expense history", "Aucune dépense enregistrée.": "No expenses recorded.",
    "Déconnexion": "Log out", "Modifier": "Edit", "Supprimer": "Delete", "Coût d'achat :": "Purchase cost:",
    "Stock :": "Stock:", "unité(s)": "unit(s)", "restant(s)": "remaining", "Stock faible :": "Low stock:",
    "Essai gratuit de 7 jours — fin le": "7-day free trial — ends on", "Ton essai gratuit est en cours.": "Your free trial is active.",
    "Créer votre compte": "Create your account", "Démarrez avec 7 jours d'essai gratuit.": "Start with a 7-day free trial.",
    "Votre nom": "Your name", "Nom du commerce": "Business name", "Adresse e-mail": "Email address", "Mot de passe": "Password",
    "Créer mon compte": "Create my account", "Se connecter": "Log in", "Vous avez déjà un compte ?": "Already have an account?",
    "Pas encore de compte ?": "Don't have an account yet?", "Votre nom complet": "Your full name", "8 caractères minimum": "At least 8 characters",
    "Ex. Boutique Camara": "e.g. Camara Shop", "Ex. Baguette": "e.g. Baguette", "Ex. Électricité": "e.g. Electricity",
    "Choisir un produit": "Choose a product", "Aucune vente.": "No sales.", "Aucun produit.": "No products.", "Aucune dépense.": "No expenses."
  },
  wo: {
    "Bonjour": "Asalaam aleekum", "Votre commerce, mieux organisé.": "Sa jaay bi, doxal ko bu baax.",
    "ESPACE COMMERÇANT": "BARABU JAAYKAT", "Voici la situation de votre commerce.": "Nii la sa jaay bi deme.",
    "Langue": "Làkk", "Votre abonnement": "Sa abonmaa", "Chargement de votre abonnement…": "Mi ngi yeb abonmaa…",
    "Chiffre d'affaires": "Li nga jaay", "Dépenses": "Fay yi", "Résultat estimé": "Njariñ wi ñu xayma", "Articles en stock": "Mboot yu nekk ci stock",
    "Aujourd'hui": "Tey", "Unités disponibles": "Lim bi nekk", "Ventes - coûts - dépenses": "Jaay - njëg - fay",
    "Accueil": "Kër", "Ventes": "Jaay yi", "Produits": "Mboot yi", "Vue d'ensemble": "Xoolal bu yàgg", "Actualiser": "Yeesal",
    "Alertes de stock": "Yëgle ci stock", "Dernières opérations": "Jëf yi mujj", "Aucune alerte de stock.": "Amul yëgle ci stock.",
    "Aucune opération récente.": "Amul jëf ju bees.", "Aucune opération enregistrée.": "Amul jëf buñ denc.",
    "Vos données seront progressivement synchronisées avec votre espace sécurisé.": "Sa done yi dinañu and ak sa espace bu wóor.",
    "Nouvelle vente": "Jaay bu bees", "Produit": "Mboot", "Quantité": "Limu", "Paiement": "Fay",
    "Espèces": " xaalis", "Autre": "Beneen", "Enregistrer la vente": "Denc jaay bi", "Historique des ventes": "Jaay yi weesu",
    "Aucune vente enregistrée.": "Amul jaay buñ denc.", "Produits et stocks": "Mboot yi ak stock", "Nom du produit": "Turum mboot",
    "Prix de vente (FCFA)": "Njëgu jaay (FCFA)", "Coût unitaire (FCFA)": "Njëgu benn (FCFA)", "Stock initial": "Stock bu njëkk",
    "Ajouter le produit": "Yokk mboot", "Inventaire": "Li nekk ci stock", "Aucun produit enregistré.": "Amul mboot buñ denc.",
    "Enregistrer une dépense": "Denc fay", "Motif": "Lu tax", "Montant (FCFA)": "Limu xaalis (FCFA)",
    "Enregistrer la dépense": "Denc fay bi", "Historique des dépenses": "Fay yi weesu", "Aucune dépense enregistrée.": "Amul fay buñ denc.",
    "Déconnexion": "Génn", "Modifier": "Soppi", "Supprimer": "Màbb", "Coût d'achat :": "Njëgu jënd:",
    "Stock :": "Stock:", "unité(s)": "benn(y)", "restant(s)": "des", "Créer votre compte": "Sos sa compte", "Démarrez avec 7 jours d'essai gratuit.": "Tambali ak 7 fan yu jarul fay.",
    "Votre nom": "Sa tur", "Nom du commerce": "Turum jaay bi", "Adresse e-mail": "Email", "Mot de passe": "Baatu jàll",
    "Créer mon compte": "Sos sama compte", "Se connecter": "Dugg", "Vous avez déjà un compte ?": "Am nga compte ba léegi?", "Pas encore de compte ?": "Amuloo compte?",
    "Votre nom complet": "Sa tur yépp", "8 caractères minimum": "Lu néew 8 màndarga", "Ex. Boutique Camara": "Misaal: Boutique Camara",
    "Ex. Baguette": "Misaal: Mburu", "Ex. Électricité": "Misaal: Électricité", "Choisir un produit": "Tànn mboot", "Aucune vente.": "Amul jaay.", "Aucun produit.": "Amul mboot.", "Aucune dépense.": "Amul fay."
  }
};

const originalText = new WeakMap();
const originalAttributes = new WeakMap();
let languageObserver = null;
let applyingLanguage = false;

function applyLanguage(code) {
  const dict = translations[code] || translations.fr;
  if (applyingLanguage) return;
  applyingLanguage = true;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const raw = node.nodeValue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (!originalText.has(node)) originalText.set(node, trimmed);
    const original = originalText.get(node);
    const translated = dict[original] || original;
    if (translated !== trimmed) {
      const leading = raw.match(/^\s*/)?.[0] || "";
      const trailing = raw.match(/\s*$/)?.[0] || "";
      node.nodeValue = leading + translated + trailing;
    }
  }

  // Translate placeholders and accessible labels too, while retaining their French originals.
  document.querySelectorAll("input, textarea, select, button").forEach((el) => {
    ["placeholder", "aria-label", "title"].forEach((attr) => {
      if (!el.hasAttribute(attr)) return;
      if (!originalAttributes.has(el)) originalAttributes.set(el, {});
      const saved = originalAttributes.get(el);
      if (!(attr in saved)) saved[attr] = el.getAttribute(attr);
      const original = saved[attr];
      el.setAttribute(attr, dict[original] || original);
    });
  });
  applyingLanguage = false;
}

function setupLanguage() {
  const language = $("language");
  if (!language) return;
  const saved = localStorage.getItem("sama_language") || "fr";
  language.value = saved;
  applyLanguage(saved);
  language.addEventListener("change", () => {
    localStorage.setItem("sama_language", language.value);
    applyLanguage(language.value);
  });
  if (languageObserver) languageObserver.disconnect();
  languageObserver = new MutationObserver(() => applyLanguage(language.value || "fr"));
  languageObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}

/* DÉMARRAGE */

async function init() {
  try {
    if (!window.supabase) {
      throw new Error("La bibliothèque Supabase n'a pas été chargée.");
    }

    setupNavigation();
    setupLanguage();

    $("signupForm")?.addEventListener("submit", signup);
    $("loginForm")?.addEventListener("submit", login);
    $("authSwitch")?.addEventListener("click", switchAuthMode);
    $("logoutButton")?.addEventListener("click", logout);

    $("productForm")?.addEventListener("submit", addProduct);
    $("productsList")?.addEventListener("click", (event) => {
      const editId = event.target.closest("[data-edit-product]")?.dataset.editProduct;
      const deleteId = event.target.closest("[data-delete-product]")?.dataset.deleteProduct;
      if (editId) editProduct(editId);
      if (deleteId) deleteProduct(deleteId);
    });
    $("saleForm")?.addEventListener("submit", addSale);
    $("expenseForm")?.addEventListener("submit", addExpense);

    $("refresh")?.addEventListener("click", render);

    db = await openDB();

    const { data } = await supabaseClient.auth.getSession();

    if (data.session?.user) {
      currentUser = data.session.user;

      try {
        await loadUserBusiness();
      } catch (error) {
        showAuth();
        setMessage("loginMessage", error.message || "Erreur de chargement.", true);
      }
    } else {
      showAuth();
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        currentUser = null;
        showAuth();
      }
    });

  } catch (error) {
    console.error("SAMA BUSINESS :", error);
    showAuth();
    setMessage("loginMessage", error.message || "Erreur de démarrage.", true);
  }
}

document.addEventListener("DOMContentLoaded", init);

