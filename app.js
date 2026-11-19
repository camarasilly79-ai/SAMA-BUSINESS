
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
  const { data, error } = await supabaseClient.functions.invoke(
    "create-business",
    {
      body: {
        business_name: businessName,
        full_name: fullName
      }
    }
  );

  if (error) {
    throw new Error(error.message || "La création de l'entreprise a échoué.");
  }

  if (!data?.business_id) {
    throw new Error("Supabase n'a pas retourné l'identifiant de l'entreprise.");
  }

  currentBusinessId = data.business_id;
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
    .select("plan,status,trial_started_at,trial_ends_at,base_plan,promo_plan,promo_ends_at,current_period_end")
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

  const trialEnd = sub.trial_ends_at
    ? new Date(sub.trial_ends_at)
    : null;

  const promoEnd = sub.promo_ends_at
    ? new Date(sub.promo_ends_at)
    : null;

  let message = "";

  if (sub.status === "trial") {
    message = trialEnd
      ? `Essai gratuit de 7 jours — fin le ${trialEnd.toLocaleDateString("fr-FR")}.`
      : "Ton essai gratuit est en cours.";
  } else if (sub.promo_plan && promoEnd) {
    message = `Avantage temporaire : ${planNames[sub.promo_plan] || sub.promo_plan} jusqu'au ${promoEnd.toLocaleDateString("fr-FR")}.`;
  } else {
    message = `Abonnement : ${planNames[sub.plan] || sub.plan}.`;
  }

  target.textContent = message;

  const banner = $("subscriptionBanner");
  if (banner) banner.hidden = false;
}

/* APPLICATION */

async function startApplication() {
  if (!db) db = await openDB();

  showApp();

  if ($("welcomeName")) {
    $("welcomeName").textContent =
      currentUser.user_metadata?.full_name || currentUser.email;
  }

  if ($("businessLabel")) {
    $("businessLabel").textContent = currentBusinessName;
  }

  if ($("connection")) {
    $("connection").textContent = "Connecté à Supabase";
  }

  renderSubscription();
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

  const profit = revenue - expenseTotal;

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
    <div class="record">
      <strong>${escapeHTML(product.name)}</strong>
      <div>${formatMoney(product.price)} · Stock : ${escapeHTML(product.stock)}</div>
      <small class="muted">Coût d'achat : ${formatMoney(product.cost)}</small>
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

  if (!name || price < 0 || stock < 0) {
    setMessage("productMessage", "Vérifie les informations du produit.", true);
    return;
  }

  await put("products", {
    id: uuid(),
    name,
    price,
    cost,
    stock,
    threshold: 5,
    date: new Date().toISOString()
  });

  $("productForm").reset();
  setMessage("productMessage", "Produit enregistré avec succès.");
  await render();
}

/* ENREGISTRER UNE VENTE */

async function addSale(event) {
  event.preventDefault();

  const productId = $("saleProduct")?.value;
  const quantity = Number($("saleQty")?.value);
  const payment = $("salePayment")?.value || "cash";

  if (!productId || quantity <= 0) {
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

  product.stock = Number(product.stock) - quantity;

  await put("products", product);

  await put("sales", {
    id: uuid(),
    productId,
    productName: product.name,
    quantity,
    unitPrice: Number(product.price),
    total: Number(product.price) * quantity,
    payment,
    date: new Date().toISOString()
  });

  $("saleForm").reset();
  setMessage("saleMessage", "Vente enregistrée. Stock mis à jour.");
  await render();
}

/* AJOUT DÉPENSE */

async function addExpense(event) {
  event.preventDefault();

  const name = $("expenseName")?.value.trim();
  const amount = Number($("expenseAmount")?.value);

  if (!name || amount <= 0) {
    setMessage("expenseMessage", "Entre un nom et un montant valide.", true);
    return;
  }

  await put("expenses", {
    id: uuid(),
    name,
    amount,
    date: new Date().toISOString()
  });

  $("expenseForm").reset();
  setMessage("expenseMessage", "Dépense enregistrée.");
  await render();
}

/* NAVIGATION */

function setupNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const viewName = button.dataset.view;

      document.querySelectorAll("[data-view]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });

      document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle("active", view.id === viewName);
      });
    });
  });
}

/* LANGUE */

function setupLanguage() {
  const language = $("language");
  if (!language) return;

  const saved = localStorage.getItem("sama_language") || "fr";
  language.value = saved;

  language.addEventListener("change", () => {
    localStorage.setItem("sama_language", language.value);
  });
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

