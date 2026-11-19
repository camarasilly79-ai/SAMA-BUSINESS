/* SAMA BUSINESS V1 - prototype local-first.
   This version stores data in IndexedDB on this device.
   Remote Supabase synchronization is intentionally not enabled yet. */
const DB_NAME='sama_business_v1', DB_VERSION=1;
let db;
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('fr-FR').format(Number(n)||0)+' FCFA';
const today=()=>new Date().toISOString().slice(0,10);
function openDB(){return new Promise((resolve,reject)=>{
 const req=indexedDB.open(DB_NAME,DB_VERSION);
 req.onupgradeneeded=()=>{const d=req.result;
  for(const name of ['products','sales','expenses']) if(!d.objectStoreNames.contains(name)) d.createObjectStore(name,{keyPath:'id'});
 };
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});}
function all(store){return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function put(store,obj){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(obj);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
function uuid(){return crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2);}
function dayRecords(items){return items.filter(x=>x.created_at.slice(0,10)===today());}
async function render(){
 const [products,sales,expenses]=await Promise.all([all('products'),all('sales'),all('expenses')]);
 const ds=dayRecords(sales),de=dayRecords(expenses);
 const revenue=ds.reduce((a,x)=>a+x.total,0),cost=ds.reduce((a,x)=>a+x.cost_total,0),expense=de.reduce((a,x)=>a+x.amount,0);
 $('revenue').textContent=money(revenue);$('expenses').textContent=money(expense);$('profit').textContent=money(revenue-cost-expense);
 $('stockCount').textContent=products.reduce((a,p)=>a+p.stock,0);
 $('saleProduct').innerHTML=products.map(p=>`<option value="${p.id}">${escapeHTML(p.name)} · ${money(p.price)} (stock ${p.stock})</option>`).join('')||'<option value="">Ajoutez d’abord un produit</option>';
 $('productsList').innerHTML=products.map(p=>`<div class="record"><span><b>${escapeHTML(p.name)}</b><small>Vente ${money(p.price)} · Coût ${money(p.cost)}</small></span><b>${p.stock} unités</b></div>`).join('')||'Aucun produit.';
 $('salesList').innerHTML=[...sales].reverse().map(s=>`<div class="record"><span><b>${escapeHTML(s.product_name)} × ${s.quantity}</b><small>${new Date(s.created_at).toLocaleString('fr-FR')} · ${escapeHTML(s.payment)}</small></span><b>${money(s.total)}</b></div>`).join('')||'Aucune vente.';
 $('expensesList').innerHTML=[...expenses].reverse().map(e=>`<div class="record"><span>${escapeHTML(e.name)}<small>${new Date(e.created_at).toLocaleString('fr-FR')}</small></span><b>${money(e.amount)}</b></div>`).join('')||'Aucune dépense.';
 $('alerts').innerHTML=products.filter(p=>p.stock<=p.threshold).map(p=>`<div class="record"><span>${escapeHTML(p.name)}</span><b>Stock bas : ${p.stock}</b></div>`).join('')||'Aucune alerte.';
 const recent=[...sales.map(x=>({...x,type:'Vente',label:x.product_name,amount:x.total})),...expenses.map(x=>({...x,type:'Dépense',label:x.name,amount:x.amount}))].sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,6);
 $('recent').innerHTML=recent.map(x=>`<div class="record"><span>${x.type} · ${escapeHTML(x.label)}<small>${new Date(x.created_at).toLocaleString('fr-FR')}</small></span><b>${money(x.amount)}</b></div>`).join('')||'Aucune opération enregistrée.';
}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setMessage(id,msg){$(id).textContent=msg;}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));
 document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!=='view-'+b.dataset.view));
}));
$('productForm').addEventListener('submit',async e=>{
 e.preventDefault();const name=$('productName').value.trim(),price=Number($('productPrice').value),cost=Number($('productCost').value),stock=Number($('productStock').value);
 if(!name||!Number.isSafeInteger(price)||price<1||!Number.isSafeInteger(cost)||cost<0||!Number.isFinite(stock)||stock<0){setMessage('productMessage','Vérifiez les valeurs saisies.');return;}
 await put('products',{id:uuid(),name,price,cost,stock,threshold:5,created_at:new Date().toISOString()});
 e.target.reset();$('productStock').value=0;setMessage('productMessage','Produit enregistré sur cet appareil.');await render();
});
$('saleForm').addEventListener('submit',async e=>{
 e.preventDefault();const id=$('saleProduct').value,p=(await all('products')).find(x=>x.id===id),q=Number($('saleQty').value);
 if(!p||!Number.isSafeInteger(q)||q<1||q>p.stock){setMessage('saleMessage','Produit introuvable ou stock insuffisant.');return;}
 const sale={id:uuid(),product_id:p.id,product_name:p.name,quantity:q,unit_price:p.price,unit_cost:p.cost,total:p.price*q,cost_total:p.cost*q,payment:$('salePayment').value,created_at:new Date().toISOString()};
 p.stock-=q;
 await put('products',p);await put('sales',sale);$('saleQty').value=1;setMessage('saleMessage','Vente enregistrée hors connexion ou en ligne sur cet appareil.');await render();
});
$('expenseForm').addEventListener('submit',async e=>{
 e.preventDefault();const name=$('expenseName').value.trim(),amount=Number($('expenseAmount').value);
 if(!name||!Number.isSafeInteger(amount)||amount<1){setMessage('expenseMessage','Saisissez un motif et un montant valide.');return;}
 await put('expenses',{id:uuid(),name,amount,created_at:new Date().toISOString()});e.target.reset();setMessage('expenseMessage','Dépense enregistrée sur cet appareil.');await render();
});
$('refresh').addEventListener('click',render);
$('language').addEventListener('change',e=>{localStorage.setItem('sama_language',e.target.value);alert('La langue est mémorisée. Les traductions complètes seront ajoutées dans une prochaine version.');});
$('language').value=localStorage.getItem('sama_language')||'fr';
$('saveConfig').addEventListener('click',()=>{const cfg={url:$('supabaseUrl').value.trim(),key:$('supabaseKey').value.trim(),businessId:$('businessId').value.trim()};localStorage.setItem('sama_config',JSON.stringify(cfg));setMessage('configMessage','Configuration mémorisée localement. La synchronisation serveur n’est pas encore activée.');});
window.addEventListener('online',updateConnection);window.addEventListener('offline',updateConnection);
function updateConnection(){$('connection').textContent=navigator.onLine?'● Connecté (appareil)':'● Hors connexion';}
(async()=>{try{db=await openDB();updateConnection();await render();}catch(err){console.error(err);alert('Impossible d’ouvrir le stockage local. Essayez un navigateur récent.');}})();

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('PWA cache unavailable',err)));}
