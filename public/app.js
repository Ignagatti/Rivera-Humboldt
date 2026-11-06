/**
 * Rivera POS - Lógica Completa de la Aplicación
 * Sistema POS Mobile-First con Sincronización en Tiempo Real (Neon PostgreSQL + WebSockets + LocalStorage Fallback)
 */

const STORAGE_KEY = 'rivera_pos_state_v2';
const LEGACY_STORAGE_KEY = 'restoflow_pos_state_v2';

// Estado global de la aplicación
let staffList = [
    { id: 'admin_perello', name: 'Perello (Encargado)', role: 'Cocina / Admin' }
];

let currentUser = null;
let generalTipsPool = 0;
let activeAdminTab = 'kitchen';
let kitchenFilterStatus = 'all';

const OFFICIAL_PIZZAS = [
    { id: 'pz_libre', name: 'Pizza libre', price: 16000, desc: 'Por persona' },
    { id: 'pz_muz', name: 'Muzzarella', price: 15000, desc: 'Salsa casera, muzzarella, y orégano' },
    { id: 'pz_ceb', name: 'Cebolla', price: 16000, desc: 'Cebolla' },
    { id: 'pz_prov', name: 'Provenzal', price: 16000, desc: 'Ajo y perejil' },
    { id: 'pz_marg', name: 'Margarita', price: 16000, desc: 'Huevo rallado y oregano' },
    { id: 'pz_esp', name: 'Especial', price: 17000, desc: 'Jamón cocido y huevo' },
    { id: 'pz_nap', name: 'Napolitana', price: 17000, desc: 'Rodajas de tomate, provenzal y queso sardo' },
    { id: 'pz_cal', name: 'Calabresa', price: 17000, desc: 'Rodajas de salame' },
    { id: 'pz_ruc', name: 'Rucula', price: 17000, desc: 'Rucula y queso sardo' },
    { id: 'pz_anc', name: 'Anchoa', price: 18000, desc: 'Anchoas y orégano' },
    { id: 'pz_roq', name: 'Roquefort', price: 18000, desc: 'Roquefort' },
    { id: 'pz_3q', name: '3 Quesos', price: 18000, desc: 'Roquefort y sardo' }
];

// Catálogo de categorías base
let menuData = {
    pizzas: {
        id: 'pizzas',
        name: "Pizzas",
        icon: "fa-pizza-slice",
        items: [...OFFICIAL_PIZZAS]
    },
    milanesas: {
        id: 'milanesas',
        name: "Sándwiches de Milanesa",
        icon: "fa-burger",
        items: []
    },
    minutas: {
        id: 'minutas',
        name: "Hamburguesas y Papas",
        icon: "fa-utensils",
        items: []
    },
    bebidas: {
        id: 'bebidas',
        name: "Bebidas",
        icon: "fa-wine-glass",
        items: []
    }
};

let availableTables = ["Mesa 01", "Mesa 02", "Mesa 03", "Mesa 04", "Mesa 05", "Mesa 06", "Mesa Barra", "Para Llevar"];
let currentTable = "Mesa 01";
let activeCategory = "pizzas";
let searchQuery = "";
let isDrawerOpen = false;

let ordersByTable = {};
availableTables.forEach(t => {
    ordersByTable[t] = { items: [], note: "" };
});

let kitchenOrders = [];
let paymentHistory = [];
let savedNightReports = [];
let waiterNotifications = [];
let activePaymentTable = null;
let activePaymentTotal = 0;
let selectedPaymentMethod = "Efectivo";

let isOnlineWithServer = false;
let socket = null;

// ================= SONIDO Y VIBRACIÓN PARA CELULAR DEL MOZO =================
let globalAudioContext = null;

function unlockMobileAudio() {
    try {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxClass) return;
        if (!globalAudioContext) {
            globalAudioContext = new AudioCtxClass();
        }
        if (globalAudioContext.state === 'suspended') {
            globalAudioContext.resume().catch(() => {});
        }
    } catch (e) {
        console.warn('AudioContext no inicializado:', e);
    }
}

// Desbloquear audio automáticamente con el primer toque o click en el celular
window.addEventListener('touchstart', unlockMobileAudio, { passive: true });
window.addEventListener('click', unlockMobileAudio, { passive: true });

function playWaiterNotificationSound() {
    // 1. Vibración táctil en el teléfono móvil del mozo
    try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([350, 120, 350, 120, 500]);
        }
    } catch (e) {}

    // 2. Timbre acústico brillante de aviso de pedido listo
    try {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxClass) return;
        if (!globalAudioContext) {
            globalAudioContext = new AudioCtxClass();
        }
        if (globalAudioContext.state === 'suspended') {
            globalAudioContext.resume().catch(() => {});
        }

        const ctx = globalAudioContext;
        const now = ctx.currentTime;

        // Tono 1 (880 Hz - Campanada metálica inicial brillante)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        osc1.frequency.exponentialRampToValueAtTime(860, now + 0.5);
        gain1.gain.setValueAtTime(0.5, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.6);

        // Tono 2 (1320 Hz - Segundo repique armónico alegre tipo "ding!")
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1320, now + 0.15);
        osc2.frequency.exponentialRampToValueAtTime(1300, now + 0.85);
        gain2.gain.setValueAtTime(0.001, now);
        gain2.gain.setValueAtTime(0.6, now + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.15);
        osc2.stop(now + 0.9);

        // Tono 3 (1760 Hz - Brillo de campana de mostrador)
        const osc3 = ctx.createOscillator();
        const gain3 = ctx.createGain();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(1760, now + 0.18);
        gain3.gain.setValueAtTime(0.001, now);
        gain3.gain.setValueAtTime(0.35, now + 0.18);
        gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        osc3.connect(gain3);
        gain3.connect(ctx.destination);
        osc3.start(now + 0.18);
        osc3.stop(now + 0.7);
    } catch (e) {
        console.warn('Error reproduciendo sonido en celular:', e);
    }
}

// Alias para compatibilidad
const playKitchenBellSound = playWaiterNotificationSound;

// ================= SINCRONIZACIÓN Y PERSISTENCIA (100% NEON DB) =================

function loadLocalState() {
    // Deshabilitado: el sistema opera 100% en tiempo real con Neon PostgreSQL
}

function saveLocalState() {
    // Deshabilitado: la persistencia es exclusivamente en Neon PostgreSQL
}

// Cargar estado directamente desde la API de Neon DB
async function fetchServerState(silent = false) {
    try {
        const res = await fetch('/api/state');
        if (!res.ok) throw new Error('Respuesta del servidor no exitosa');
        const data = await res.json();
        if (data.success && data.data) {
            const d = data.data;
            if (Array.isArray(d.staffList) && d.staffList.length > 0) staffList = d.staffList;
            if (typeof d.generalTipsPool === 'number') generalTipsPool = d.generalTipsPool;
            if (d.menuData && Object.keys(d.menuData).length > 0) menuData = d.menuData;
            if (Array.isArray(d.availableTables) && d.availableTables.length > 0) availableTables = d.availableTables;
            if (d.ordersByTable) ordersByTable = d.ordersByTable;
            if (Array.isArray(d.paymentHistory)) paymentHistory = d.paymentHistory;
            if (Array.isArray(d.savedNightReports)) savedNightReports = d.savedNightReports;

            // Sincronizar comandas de cocina y notificaciones estrictamente desde la base de datos
            if (Array.isArray(d.kitchenOrders)) {
                kitchenOrders = d.kitchenOrders;
                waiterNotifications = kitchenOrders
                    .filter(o => o.status === 'ready')
                    .map(o => ({
                        id: o.id,
                        table: o.table,
                        time: o.time,
                        items: o.items,
                        waiterName: o.waiterName
                    }));
            }

            isOnlineWithServer = true;
            setConnectionIndicator(true);
            updateWaiterNotificationUI();
            updateHeaderIndicators();

            if (silent) {
                refreshActiveViewsQuietly();
            } else {
                refreshActiveViews();
            }
            return true;
        }
    } catch (err) {
        console.warn('Conectando a Neon DB...', err.message);
        isOnlineWithServer = false;
        setConnectionIndicator(false);
    }
    return false;
}

function setConnectionIndicator(online) {
    const pill = document.getElementById('db-connection-pill');
    const liveDot = document.getElementById('header-live-dot');

    if (pill) {
        if (online) {
            pill.className = "text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold";
            pill.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Neon DB en vivo';
        } else {
            pill.className = "text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-medium";
            pill.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> Conectando a Neon DB...';
        }
    }

    if (liveDot) {
        liveDot.className = online ? "w-2 h-2 rounded-full bg-emerald-500 shadow-sm" : "w-2 h-2 rounded-full bg-amber-400 animate-pulse";
        liveDot.title = online ? "Sincronización en vivo activa con Neon DB" : "Conectando con Neon DB...";
    }
}

// Inicializar conexión WebSocket para recepción de comandas en tiempo real
function initWebSocket() {
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleRealtimeMessage(message);
            } catch (e) {
                console.error('Error parseando mensaje WS:', e);
            }
        };

        socket.onclose = () => {
            setConnectionIndicator(false);
            // Reintentar reconexión automática en 4 segundos
            setTimeout(initWebSocket, 4000);
        };

        socket.onerror = () => {
            socket.close();
        };
    } catch (e) {
        console.warn('WebSocket no disponible, trabajando en modo local:', e);
    }
}

function handleRealtimeMessage(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'KITCHEN_ORDER_NEW':
            // Nueva comanda o agregados enviados a cocina
            const existingIdx = kitchenOrders.findIndex(o => o.id === msg.order.id || (o.table === msg.order.table && o.status !== 'paid'));
            if (existingIdx >= 0) {
                kitchenOrders[existingIdx] = msg.order;
            } else {
                kitchenOrders.unshift(msg.order);
            }
            saveLocalState();
            refreshActiveViews();
            break;

        case 'ORDER_STATUS_CHANGED':
            // Estado de comanda o platos modificado
            const oIdx = kitchenOrders.findIndex(o => o.id === msg.id || (msg.order && o.table === msg.order.table && o.status !== 'paid'));
            if (oIdx >= 0 && msg.order) {
                kitchenOrders[oIdx] = msg.order;
            }

            if (msg.status === 'delivered') {
                waiterNotifications = waiterNotifications.filter(n => n.id !== msg.id);
                updateWaiterNotificationUI();
            }

            // Si el estado es "ready", registrar la notificación
            if (msg.status === 'ready') {
                waiterNotifications.unshift({
                    id: msg.order.id,
                    table: msg.order.table,
                    time: msg.order.time,
                    items: (msg.order.items || []).filter(i => (i.status || msg.order.status) !== 'delivered'),
                    waiterName: msg.order.waiterName
                });

                // VERIFICACIÓN ESTRICTA: El aviso acústico y la vibración suenan y vibran ÚNICAMENTE en el celular del mozo
                // NUNCA en la parte de administración / cocina
                const isAdmin = currentUser && (
                    currentUser.role.includes('Admin') ||
                    currentUser.role.includes('Cocina') ||
                    currentUser.role.includes('Encargado')
                );

                if (!isAdmin) {
                    playWaiterNotificationSound();

                    const isAssignedWaiter = currentUser && currentUser.name && msg.order.waiterName &&
                        (currentUser.name.trim().toLowerCase() === msg.order.waiterName.trim().toLowerCase());

                    if (isAssignedWaiter) {
                        showToast(`¡${msg.order.table} lista en Cocina! Retirar por mostrador`, 'warning');
                    } else {
                        showToast(`¡${msg.order.table} lista en Cocina! (${msg.order.waiterName || 'Salón'})`, 'info');
                    }
                }
                updateWaiterNotificationUI();
            }

            saveLocalState();
            refreshActiveViews();
            break;

        case 'TABLE_ADDED':
            if (msg.tableName && !availableTables.includes(msg.tableName)) {
                availableTables.push(msg.tableName);
                if (!ordersByTable[msg.tableName]) {
                    ordersByTable[msg.tableName] = { items: [], note: "" };
                }
                saveLocalState();
                if (!document.getElementById('waiter-tables-view').classList.contains('hidden')) {
                    renderTablesGrid();
                }
            }
            break;

        case 'TABLE_DELETED':
            if (msg.tableName) {
                availableTables = availableTables.filter(t => t !== msg.tableName);
                delete ordersByTable[msg.tableName];
                saveLocalState();
                if (!document.getElementById('waiter-tables-view').classList.contains('hidden')) {
                    renderTablesGrid();
                }
            }
            break;

        case 'TABLE_UPDATED':
            if (ordersByTable[msg.tableName]) {
                ordersByTable[msg.tableName] = {
                    items: msg.items || [],
                    note: msg.note || ''
                };
            }
            saveLocalState();
            if (currentTable === msg.tableName && !document.getElementById('waiter-order-view').classList.contains('hidden')) {
                renderOrderList();
            }
            if (!document.getElementById('waiter-tables-view').classList.contains('hidden')) {
                renderTablesGrid();
            }
            break;

        case 'ORDER_PRINTED':
            const pOrder = kitchenOrders.find(o => o.id === msg.id);
            if (pOrder) pOrder.printed = true;
            saveLocalState();
            if (activeAdminTab === 'kitchen') renderKitchenOrders();
            break;

        case 'PAYMENT_COMPLETED':
            paymentHistory.unshift(msg.payment);
            if (ordersByTable[msg.table]) {
                ordersByTable[msg.table] = { items: [], note: "" };
            }
            kitchenOrders.forEach(c => {
                if (c.table === msg.table && c.status !== 'paid') c.status = 'paid';
            });
            if (typeof msg.newTipsPool === 'number') {
                generalTipsPool = msg.newTipsPool;
            }
            saveLocalState();
            updateHeaderIndicators();
            refreshActiveViews();
            break;

        case 'MENU_REFRESH_REQUESTED':
        case 'STAFF_REFRESH_REQUESTED':
        case 'STATE_REFRESH_REQUESTED':
            fetchServerState().then(() => {
                renderStaffLoginList();
                updateHeaderIndicators();
                refreshActiveViews();
            });
            break;
    }
}

function refreshActiveViews() {
    updateHeaderIndicators();
    updateWaiterNotificationUI();

    if (!document.getElementById('admin-workspace').classList.contains('hidden')) {
        if (activeAdminTab === 'kitchen') renderKitchenOrders();
        else if (activeAdminTab === 'report') renderNightReportView();
        else if (activeAdminTab === 'staff') renderAdminStaffList();
        else if (activeAdminTab === 'menu') renderAdminMenuManager();
    } else if (!document.getElementById('waiter-tables-view').classList.contains('hidden')) {
        renderTablesGrid();
    } else if (!document.getElementById('waiter-order-view').classList.contains('hidden')) {
        renderOrderList();
        renderMenuGrid();
        renderCategoryTabs();
    }
    updateAdminNavButtons();
}

function refreshActiveViewsQuietly() {
    updateHeaderIndicators();
    updateWaiterNotificationUI();

    if (!document.getElementById('admin-workspace').classList.contains('hidden')) {
        if (activeAdminTab === 'kitchen') renderKitchenOrders();
        else if (activeAdminTab === 'report') renderNightReportView();
        else if (activeAdminTab === 'staff') renderAdminStaffList();
    } else if (!document.getElementById('waiter-tables-view').classList.contains('hidden')) {
        renderTablesGrid();
    } else if (!document.getElementById('login-view').classList.contains('hidden')) {
        renderStaffLoginList();
    }
}

let smartPollingInterval = null;
function initSmartPolling() {
    if (smartPollingInterval) clearInterval(smartPollingInterval);
    // Cada 2.5 segundos sincroniza con Neon DB de forma transparente para Vercel Serverless
    smartPollingInterval = setInterval(() => {
        fetchServerState(true);
    }, 2500);
}

// ================= INICIALIZACIÓN =================
window.onload = async function () {
    // 1. Limpiar completamente cualquier residuo previo de localStorage
    try {
        if (window.localStorage) {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(LEGACY_STORAGE_KEY);
            localStorage.removeItem('rivera_admin_pwd');
            localStorage.removeItem('restoflow_admin_pwd');
        }
    } catch (e) {}

    waiterNotifications = [];
    updateWaiterNotificationUI();

    // 2. Cargar estado directamente desde Neon DB
    await fetchServerState();
    renderStaffLoginList();
    updateHeaderIndicators();

    // 3. Iniciar WebSocket (para local/VPS) y Smart Polling (para Vercel / serverless)
    initWebSocket();
    initSmartPolling();
};

// ================= ROLES Y PANTALLA DE INGRESO =================

function renderStaffLoginList() {
    const container = document.getElementById('staff-selection-list');
    if (!container) return;

    const mozos = staffList.filter(s => s.role.includes('Mozo'));
    const adminUser = staffList.find(s => s.role.includes('Admin') || s.role.includes('Cocina')) || { id: 'admin_perello', name: 'Perello (Encargado)', role: 'Cocina / Admin' };

    let html = '';

    if (mozos.length === 0) {
        html += `
            <div class="bg-blue-50/60 border border-blue-200 rounded-2xl p-4 text-center space-y-2 mb-2">
                <div class="w-10 h-10 rounded-xl bg-white border border-blue-200 text-[#2563eb] flex items-center justify-center mx-auto shadow-sm">
                    <i class="fa-solid fa-user-clock text-base"></i>
                </div>
                <h4 class="font-bold text-xs text-slate-800">Aún no hay mozos registrados en el turno</h4>
                <p class="text-[11px] text-slate-500">Ingresa como Encargado para administrar el salón y dar de alta a tu equipo.</p>
                <button onclick="loginAs('${adminUser.id}')" class="w-full bg-[#2563eb] hover:bg-blue-600 text-white font-bold py-2.5 px-3 rounded-xl text-xs transition-all shadow-md shadow-blue-500/20 flex items-center justify-center space-x-2 cursor-pointer">
                    <i class="fa-solid fa-user-tie"></i>
                    <span>Ingresar como ${adminUser.name}</span>
                </button>
            </div>
        `;
    } else {
        html += mozos.map(s => `
            <button onclick="loginAs('${s.id}')" class="w-full bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 p-3.5 rounded-2xl flex items-center justify-between transition-all group cursor-pointer shadow-sm">
                <div class="flex items-center space-x-3">
                    <div class="w-10 h-10 rounded-xl bg-white border border-slate-200 text-[#2563eb] flex items-center justify-center group-hover:scale-105 transition-transform shadow-sm font-bold">
                        ${s.name.charAt(0)}
                    </div>
                    <div class="text-left">
                        <h4 class="font-bold text-sm text-slate-800 group-hover:text-[#2563eb] transition-colors">${s.name}</h4>
                        <span class="text-[11px] text-slate-500">${s.role}</span>
                    </div>
                </div>
                <i class="fa-solid fa-chevron-right text-xs text-slate-400 group-hover:text-[#2563eb] transition-colors"></i>
            </button>
        `).join('');
    }

    container.innerHTML = html;
}

function openAdminAuthModal(targetId = 'admin_perello') {
    const modal = document.getElementById('admin-auth-modal');
    const input = document.getElementById('admin-auth-input');
    const err = document.getElementById('admin-auth-error');

    if (err) {
        err.innerText = '';
        err.classList.add('hidden');
    }
    if (input) {
        input.value = '';
    }

    modal.dataset.targetStaffId = targetId;
    modal.classList.remove('hidden');

    setTimeout(() => {
        if (input) input.focus();
    }, 100);
}

function closeAdminAuthModal() {
    const modal = document.getElementById('admin-auth-modal');
    if (modal) modal.classList.add('hidden');
}

async function submitAdminAuth() {
    const modal = document.getElementById('admin-auth-modal');
    const input = document.getElementById('admin-auth-input');
    const err = document.getElementById('admin-auth-error');
    const targetId = modal.dataset.targetStaffId || 'admin_perello';

    const pwd = input.value.trim();
    if (!pwd) {
        err.innerText = 'Por favor ingresa la contraseña.';
        err.classList.remove('hidden');
        return;
    }

    try {
        const res = await fetch('/api/auth/admin-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            closeAdminAuthModal();
            loginAs(targetId, true);
        } else {
            err.innerText = data.error || 'Contraseña incorrecta. Intenta nuevamente.';
            err.classList.remove('hidden');
            input.value = '';
            input.focus();
        }
    } catch (e) {
        err.innerText = 'Error al conectar con la base de datos.';
        err.classList.remove('hidden');
    }
}

async function updateAdminPassword() {
    const currentInput = document.getElementById('change-pwd-current');
    const newInput = document.getElementById('change-pwd-new');
    const confirmInput = document.getElementById('change-pwd-confirm');

    const currentPassword = currentInput.value.trim();
    const newPassword = newInput.value.trim();
    const confirmPassword = confirmInput.value.trim();

    if (!currentPassword) {
        showModal('Campo Requerido', 'Ingresa la contraseña actual.');
        return;
    }

    if (!newPassword || newPassword.length < 4) {
        showModal('Contraseña Inválida', 'La nueva contraseña debe tener al menos 4 caracteres.');
        return;
    }

    if (newPassword !== confirmPassword) {
        showModal('No Coinciden', 'La nueva contraseña y su confirmación no coinciden.');
        return;
    }

    try {
        const res = await fetch('/api/auth/admin-password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            currentInput.value = '';
            newInput.value = '';
            confirmInput.value = '';
            showModal('Contraseña Actualizada', 'La clave de acceso del Encargado fue guardada en Neon PostgreSQL con éxito.');
        } else {
            showModal('Error al Actualizar', data.error || 'La contraseña actual no es correcta.');
        }
    } catch (e) {
        showModal('Error al Actualizar', 'Error de conexión con Neon DB.');
    }
}

function loginAs(staffId, isAlreadyAuthenticated = false) {
    currentUser = staffList.find(s => s.id === staffId);
    if (!currentUser) {
        if (staffId === 'admin_perello') {
            currentUser = { id: 'admin_perello', name: 'Perello (Encargado)', role: 'Cocina / Admin' };
        } else {
            return;
        }
    }

    const isAdmin = currentUser.role.includes('Admin') || currentUser.role.includes('Cocina') || currentUser.role.includes('Encargado');

    // Si es admin y no está autenticado, solicitar contraseña
    if (isAdmin && !isAlreadyAuthenticated) {
        openAdminAuthModal(staffId);
        return;
    }

    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('main-header').classList.remove('hidden');

    unlockMobileAudio();

    document.getElementById('header-user-name').innerText = currentUser.name;
    document.getElementById('header-role-badge').innerText = currentUser.role;
    updateHeaderIndicators();
    updateWaiterNotificationUI();

    if (isAdmin) {
        document.getElementById('waiter-tables-view').classList.add('hidden');
        document.getElementById('waiter-order-view').classList.add('hidden');
        document.getElementById('admin-workspace').classList.remove('hidden');
        switchAdminTab(activeAdminTab || 'kitchen');
    } else {
        document.getElementById('admin-workspace').classList.add('hidden');
        document.getElementById('waiter-order-view').classList.add('hidden');
        document.getElementById('waiter-tables-view').classList.remove('hidden');
        renderTablesGrid();
    }
    updateAdminNavButtons();
}

function openAdminDirect() {
    let admin = staffList.find(s => s.role.includes('Admin') || s.role.includes('Cocina') || s.role.includes('Encargado'));
    if (!admin) {
        admin = { id: 'admin_perello', name: 'Perello (Encargado)', role: 'Cocina / Admin' };
        staffList.push(admin);
    }
    openAdminAuthModal(admin.id);
}

function logoutStaff() {
    currentUser = null;
    document.getElementById('main-header').classList.add('hidden');
    document.getElementById('admin-workspace').classList.add('hidden');
    document.getElementById('waiter-tables-view').classList.add('hidden');
    document.getElementById('waiter-order-view').classList.add('hidden');
    document.getElementById('waiter-ready-banner').classList.add('hidden');
    document.getElementById('login-view').classList.remove('hidden');
    updateAdminNavButtons();
}

function updateHeaderIndicators() {
    const tipsElem = document.getElementById('header-tips-summary');
    if (tipsElem) tipsElem.innerText = `Caja Propinas: $${generalTipsPool.toLocaleString()}`;

    const paymentsCountElem = document.getElementById('header-payments-count');
    if (paymentsCountElem) paymentsCountElem.innerText = paymentHistory.length;
}

// ================= NOTIFICACIONES DE COCINA PARA MOZOS =================

function dismissWaiterReadyBanner() {
    const banner = document.getElementById('waiter-ready-banner');
    if (banner) banner.classList.add('hidden');
}

function updateWaiterNotificationUI() {
    const notifBadge = document.getElementById('waiter-notif-badge');
    const banner = document.getElementById('waiter-ready-banner');
    const title = document.getElementById('waiter-banner-title');
    const desc = document.getElementById('waiter-banner-desc');

    if (!currentUser) {
        if (notifBadge) notifBadge.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
        return;
    }

    const isAdmin = currentUser.role.includes('Admin') || currentUser.role.includes('Cocina') || currentUser.role.includes('Encargado');

    // NUNCA mostrar banner flotante de "Retirar por mostrador" ni badge a administración / cocina
    if (isAdmin) {
        if (banner) banner.classList.add('hidden');
        if (notifBadge) notifBadge.classList.add('hidden');
        return;
    }

    // Filtrar notificaciones activas: SOLO las del mozo actual
    const pendingNotifs = waiterNotifications.filter(n => {
        return n.waiterName && currentUser.name && n.waiterName.trim().toLowerCase() === currentUser.name.trim().toLowerCase();
    });

    if (pendingNotifs.length > 0) {
        if (notifBadge) {
            notifBadge.innerText = pendingNotifs.length;
            notifBadge.classList.remove('hidden');
        }

        if (banner) {
            const first = pendingNotifs[0];
            if (title) title.innerText = `¡${first.table} Lista en Cocina!`;
            if (desc) desc.innerText = `Mozo asignado: ${first.waiterName || 'Salón'} • Retirar por mostrador`;
            banner.classList.remove('hidden');
        }
    } else {
        if (notifBadge) notifBadge.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
    }
}

function openWaiterNotificationsModal() {
    const list = document.getElementById('waiter-notifications-list');
    if (!list) return;

    const isAdmin = currentUser && (currentUser.role.includes('Admin') || currentUser.role.includes('Cocina') || currentUser.role.includes('Encargado'));

    // Obtener comandas que estén en estado "ready" asignadas al mozo actual (o todas si es admin)
    const readyOrders = kitchenOrders.filter(o => {
        if (o.status !== 'ready') return false;
        if (isAdmin) return true;
        return o.waiterName && currentUser && o.waiterName.trim().toLowerCase() === currentUser.name.trim().toLowerCase();
    });

    if (readyOrders.length === 0) {
        list.innerHTML = `
            <div class="text-center py-8 text-slate-400 space-y-2">
                <i class="fa-solid fa-bell-slash text-2xl"></i>
                <p class="text-xs">No tienes pedidos pendientes de retiro en cocina.</p>
            </div>
        `;
    } else {
        list.innerHTML = readyOrders.map(o => `
            <div class="bg-amber-50/60 border border-amber-200 rounded-2xl p-3.5 space-y-2.5">
                <div class="flex items-center justify-between">
                    <div>
                        <h4 class="font-bold text-sm text-slate-900">${o.table}</h4>
                        <span class="text-[11px] text-amber-700 font-semibold">${o.id} • ${o.time} hs</span>
                    </div>
                    <span class="bg-amber-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-full animate-pulse">
                        ¡Listo para servir!
                    </span>
                </div>
                
                <div class="text-xs text-slate-700 space-y-1 bg-white/70 p-2.5 rounded-xl border border-amber-100">
                    ${((o.items || []).filter(i => (i.status || o.status) !== 'delivered')).length > 0 ?
                        ((o.items || []).filter(i => (i.status || o.status) !== 'delivered')).map(i => `
                            <div class="flex justify-between items-center">
                                <span><strong class="text-slate-900">${i.qty}x</strong> ${i.name}</span>
                                <span class="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded">Listo</span>
                            </div>
                        `).join('') :
                        (o.items || []).map(i => `
                            <div class="flex justify-between items-center">
                                <span><strong class="text-slate-900">${i.qty}x</strong> ${i.name}</span>
                            </div>
                        `).join('')
                    }
                    ${o.note ? `<p class="text-amber-800 font-medium text-[11px] mt-1">>> Nota: ${o.note}</p>` : ''}
                </div>

                <div class="flex justify-between items-center pt-1">
                    <span class="text-[11px] text-slate-500">Mozo: <strong>${o.waiterName}</strong></span>
                    <button onclick="markOrderDeliveredFromNotif('${o.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1 cursor-pointer">
                        <i class="fa-solid fa-check"></i>
                        <span>Ya lo llevé a la mesa (Entregado)</span>
                    </button>
                </div>
            </div>
        `).join('');
    }

    document.getElementById('waiter-notifications-modal').classList.remove('hidden');
}

function closeWaiterNotificationsModal() {
    document.getElementById('waiter-notifications-modal').classList.add('hidden');
}

async function markOrderDeliveredFromNotif(cmdId) {
    // Actualizar estado en servidor y local
    const order = kitchenOrders.find(o => o.id === cmdId);
    if (order) {
        order.status = 'delivered';
        if (order.items) {
            order.items.forEach(i => i.status = 'delivered');
        }
    }

    waiterNotifications = waiterNotifications.filter(n => n.id !== cmdId);
    updateWaiterNotificationUI();
    saveLocalState();
    refreshActiveViews();
    closeWaiterNotificationsModal();

    try {
        const res = await fetch(`/api/orders/${cmdId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'delivered', items: order ? order.items : undefined })
        });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Sincronización diferida:', e);
    }

    showToast(`Pedido de ${order ? order.table : 'mesa'} marcado como entregado`, 'success');
}

// ================= VISTA A: MAPA DE SALÓN Y MESAS =================

function renderTablesGrid() {
    const container = document.getElementById('tables-grid-cards');
    if (!container) return;

    container.innerHTML = availableTables.map(tName => {
        const tableOrder = ordersByTable[tName] || { items: [], note: "" };
        const activeCmd = kitchenOrders.find(o => o.table === tName && o.status !== 'paid');

        let statusText = "Libre";
        let statusBadge = "bg-emerald-50 text-emerald-700 border-emerald-200";
        let borderClass = "border-slate-200 bg-white hover:border-blue-400";
        let dotColor = "bg-emerald-500";
        let isReadyInKitchen = false;

        const hasLocalItems = tableOrder.items.length > 0;
        let total = hasLocalItems
            ? tableOrder.items.reduce((acc, i) => acc + (i.price * i.qty), 0)
            : (activeCmd ? activeCmd.total : 0);

        if (activeCmd) {
            if (activeCmd.status === 'ready') {
                statusText = "¡LISTO PARA ENTREGAR!";
                statusBadge = "bg-amber-500 text-white border-amber-600 font-extrabold shadow-sm";
                borderClass = "border-2 border-amber-500 bg-amber-50/80 shadow-lg shadow-amber-500/20 ring-4 ring-amber-400/40 animate-pulse";
                dotColor = "bg-amber-500 animate-ping";
                isReadyInKitchen = true;
            } else if (activeCmd.status === 'pending') {
                statusText = "En Preparación";
                statusBadge = "bg-blue-50 text-[#2563eb] border-blue-200 font-semibold";
                borderClass = "border-blue-300 bg-white hover:border-blue-500";
                dotColor = "bg-[#2563eb]";
            } else if (activeCmd.status === 'delivered') {
                statusText = "Entregado";
                statusBadge = "bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold";
                borderClass = "border-emerald-300 bg-white hover:border-emerald-500";
                dotColor = "bg-emerald-600";
            }
        } else if (hasLocalItems) {
            statusText = "Cargando...";
            statusBadge = "bg-slate-100 text-slate-700 border-slate-200";
            borderClass = "border-blue-200 bg-white";
            dotColor = "bg-blue-400";
        }

        const itemsCount = hasLocalItems
            ? tableOrder.items.reduce((acc, i) => acc + i.qty, 0)
            : (activeCmd ? activeCmd.items.reduce((acc, i) => acc + i.qty, 0) : 0);

        // Detectar si la mesa tiene platos nuevos agregados pendientes de envío
        const hasUnsentItems = hasLocalItems && tableOrder.items.some(i => i.qty > (i.sentQty || 0));

        return `
            <div onclick="selectTable('${tName}')" class="border rounded-3xl p-4 sm:p-5 shadow-sm transition-all cursor-pointer flex flex-col justify-between group ${borderClass} relative">
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-base text-slate-900 group-hover:text-[#2563eb] transition-colors">${tName}</span>
                        <div class="flex items-center space-x-1.5">
                            ${(!activeCmd && total === 0) ? `
                                <button onclick="event.stopPropagation(); deleteTablePrompt('${tName}')" class="w-6 h-6 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center transition-all cursor-pointer" title="Eliminar mesa vacía">
                                    <i class="fa-solid fa-trash-can text-[11px]"></i>
                                </button>
                            ` : ''}
                            <span class="w-2.5 h-2.5 rounded-full ${dotColor}"></span>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-[10px] px-2 py-0.5 rounded-full border ${statusBadge} flex items-center gap-1">
                            ${statusText}
                        </span>
                        ${(hasUnsentItems && activeCmd) ? `
                            <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 font-bold">
                                + Agregados nuevos
                            </span>
                        ` : ''}
                    </div>

                    ${isReadyInKitchen ? `
                        <div class="bg-amber-500 text-white text-xs px-2.5 py-1.5 rounded-xl font-bold flex items-center justify-between shadow-sm">
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-bell-concierge"></i> ¡LISTO! Retirar por cocina</span>
                            <i class="fa-solid fa-arrow-right"></i>
                        </div>
                    ` : ''}

                    <div class="pt-2 text-xs">
                        <span class="text-slate-400 text-[11px] block">${itemsCount} producto${itemsCount === 1 ? '' : 's'}</span>
                        <strong class="text-sm font-bold text-slate-800">$${total.toLocaleString()}</strong>
                    </div>
                </div>

                ${total > 0 ? `
                    <div class="pt-3 border-t border-slate-100 mt-3" onclick="event.stopPropagation()">
                        <button onclick="openPaymentByTable('${tName}')" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs transition-all shadow-sm flex items-center justify-center space-x-1.5">
                            <i class="fa-solid fa-cash-register"></i>
                            <span>Cobrar ($${total.toLocaleString()})</span>
                        </button>
                    </div>
                ` : `
                    <div class="pt-3 border-t border-slate-100 mt-3">
                        <span class="text-[11px] text-[#2563eb] font-semibold flex items-center justify-end group-hover:translate-x-1 transition-transform">
                            Tomar Pedido <i class="fa-solid fa-chevron-right ml-1 text-[9px]"></i>
                        </span>
                    </div>
                `}
            </div>
        `;
    }).join('');
}

function selectTable(tableName) {
    currentTable = tableName;
    document.getElementById('active-table-indicator').innerText = tableName;
    document.getElementById('current-order-title').innerText = `Pedido ${tableName}`;

    // Cargar nota actual
    const tableOrder = ordersByTable[tableName] || { items: [], note: "" };
    document.getElementById('order-note').value = tableOrder.note || "";

    document.getElementById('waiter-tables-view').classList.add('hidden');
    document.getElementById('waiter-order-view').classList.remove('hidden');

    searchQuery = "";
    document.getElementById('menu-search-input').value = "";
    document.getElementById('clear-search-btn').classList.add('hidden');

    renderCategoryTabs();
    renderMenuGrid();
    renderOrderList();
    updateAdminNavButtons();
}

function backToTablesView() {
    document.getElementById('waiter-order-view').classList.add('hidden');
    document.getElementById('waiter-tables-view').classList.remove('hidden');
    setMobileDrawerState(false);
    renderTablesGrid();
    updateAdminNavButtons();
}

// ================= VISTA B: TOMA DE PEDIDO DENTRO DE LA MESA =================

function renderCategoryTabs() {
    const container = document.getElementById('category-tabs');
    if (!container) return;

    const cats = Object.keys(menuData);
    if (!cats.includes(activeCategory) && cats.length > 0) {
        activeCategory = cats[0];
    }

    container.innerHTML = cats.map(cKey => {
        const cat = menuData[cKey];
        const isActive = activeCategory === cKey;
        const btnClass = isActive
            ? 'bg-[#2563eb] text-white shadow-md shadow-blue-500/20'
            : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200';

        return `
            <button onclick="selectCategory('${cKey}')" class="px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shrink-0 ${btnClass}">
                <i class="fa-solid ${cat.icon || 'fa-utensils'} text-xs"></i>
                <span>${cat.name}</span>
            </button>
        `;
    }).join('');
}

function selectCategory(catKey) {
    activeCategory = catKey;
    renderCategoryTabs();
    renderMenuGrid();
}

function filterMenuItems() {
    searchQuery = document.getElementById('menu-search-input').value.trim().toLowerCase();
    const clearBtn = document.getElementById('clear-search-btn');
    if (searchQuery.length > 0) {
        clearBtn.classList.remove('hidden');
    } else {
        clearBtn.classList.add('hidden');
    }
    renderMenuGrid();
}

function clearSearchInput() {
    document.getElementById('menu-search-input').value = "";
    searchQuery = "";
    document.getElementById('clear-search-btn').classList.add('hidden');
    renderMenuGrid();
}

// ================= SISTEMA DE PIZZAS (1, 2 Y 3 GUSTOS) =================

let pizzaSelectionMode = 1; // 1: 1 gusto (entera), 2: 2 gustos, 3: 3 gustos ($20.000)
let selectedPizzaFlavors = []; // gustos seleccionados en modo 2 o 3
let pizzaLibreCount = 1;

function getPizzaFlavorsCatalog() {
    const pizzaCat = menuData['pizzas'];
    if (pizzaCat && Array.isArray(pizzaCat.items) && pizzaCat.items.length > 0) {
        return pizzaCat.items;
    }
    return OFFICIAL_PIZZAS;
}

function setPizzaSelectionMode(mode) {
    pizzaSelectionMode = mode;
    selectedPizzaFlavors = [];
    renderMenuGrid();
}

function cancelPizzaSelection() {
    selectedPizzaFlavors = [];
    renderMenuGrid();
}

// Modal de Pizza Libre (por persona)
function openPizzaLibreModal() {
    pizzaLibreCount = 1;
    updatePizzaLibreModalDisplay();
    document.getElementById('pizza-libre-modal').classList.remove('hidden');
}

function closePizzaLibreModal() {
    document.getElementById('pizza-libre-modal').classList.add('hidden');
}

function changePizzaLibreCount(delta) {
    let q = (pizzaLibreCount || 1) + delta;
    if (q < 1) q = 1;
    pizzaLibreCount = q;
    updatePizzaLibreModalDisplay();
}

function updatePizzaLibreModalDisplay() {
    const total = (pizzaLibreCount || 1) * 16000;
    const countElem = document.getElementById('pizza-libre-count');
    const totalElem = document.getElementById('pizza-libre-total-display');
    if (countElem) countElem.innerText = pizzaLibreCount;
    if (totalElem) totalElem.innerText = `$${total.toLocaleString()}`;
}

function confirmAddPizzaLibre() {
    const persons = pizzaLibreCount || 1;
    const unitPrice = 16000;

    if (!ordersByTable[currentTable]) {
        ordersByTable[currentTable] = { items: [], note: "" };
    }

    const tableItems = ordersByTable[currentTable].items;
    tableItems.push({
        id: `pz_libre_${Date.now().toString().slice(-6)}`,
        name: `Pizza libre (${persons} persona${persons === 1 ? '' : 's'})`,
        price: unitPrice,
        qty: persons,
        sentQty: 0,
        isPizza: true
    });

    closePizzaLibreModal();
    saveCurrentTableState();
    renderOrderList();
    renderMenuGrid();

    showToast(`Pizza libre para ${persons} persona${persons === 1 ? '' : 's'} agregada a ${currentTable}`, 'success');
}

// Interacción al hacer clic en un gusto de pizza según el modo activo
function onPizzaItemClicked(itemId) {
    const item = findMenuItemById(itemId);
    if (!item) return;

    // Si es Pizza Libre, siempre abre el modal para elegir personas
    if (item.id === 'pz_libre' || item.name.toLowerCase().includes('pizza libre')) {
        openPizzaLibreModal();
        return;
    }

    if (!ordersByTable[currentTable]) {
        ordersByTable[currentTable] = { items: [], note: "" };
    }
    const tableItems = ordersByTable[currentTable].items;

    // MODO 1: Entera y se va agregando directamente
    if (pizzaSelectionMode === 1) {
        tableItems.push({
            id: `pz_${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`,
            name: `Pizza ${item.name} (Entera)`,
            price: item.price,
            qty: 1,
            sentQty: 0,
            isPizza: true
        });
        saveCurrentTableState();
        renderOrderList();
        renderMenuGrid();
        showToast(`Pizza ${item.name} entera agregada a ${currentTable}`, 'success');
        return;
    }

    // MODO 2: Dos gustos (marcas 2 pizzas y se agrega)
    if (pizzaSelectionMode === 2) {
        if (selectedPizzaFlavors.length === 0) {
            selectedPizzaFlavors.push(item);
            renderMenuGrid();
            showToast(`Mitad 1: ${item.name}. Ahora marca la segunda mitad`, 'info');
        } else if (selectedPizzaFlavors.length === 1) {
            const f1 = selectedPizzaFlavors[0];
            const f2 = item;
            const avgPrice = Math.round((f1.price + f2.price) / 2);
            const pizzaTitle = `Pizza 2 Gustos: 1/2 ${f1.name} + 1/2 ${f2.name}`;

            tableItems.push({
                id: `pz_${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`,
                name: pizzaTitle,
                price: avgPrice,
                qty: 1,
                sentQty: 0,
                isPizza: true
            });

            selectedPizzaFlavors = [];
            saveCurrentTableState();
            renderOrderList();
            renderMenuGrid();
            showToast(`${pizzaTitle} agregada a ${currentTable}`, 'success');
        }
        return;
    }

    // MODO 3: Tres gustos (precio fijo de $20.000 sin importar el valor de los gustos)
    if (pizzaSelectionMode === 3) {
        if (selectedPizzaFlavors.length === 0) {
            selectedPizzaFlavors.push(item);
            renderMenuGrid();
            showToast(`1/3: ${item.name}. Ahora marca el segundo tercio`, 'info');
        } else if (selectedPizzaFlavors.length === 1) {
            selectedPizzaFlavors.push(item);
            renderMenuGrid();
            showToast(`1/3: ${selectedPizzaFlavors[0].name} + 1/3: ${item.name}. Marca el tercer tercio`, 'info');
        } else if (selectedPizzaFlavors.length === 2) {
            const f1 = selectedPizzaFlavors[0];
            const f2 = selectedPizzaFlavors[1];
            const f3 = item;
            const pizzaTitle = `Pizza 3 Gustos: 1/3 ${f1.name} + 1/3 ${f2.name} + 1/3 ${f3.name}`;
            const fixedPrice = 20000; // Precio fijo sin importar los sabores

            tableItems.push({
                id: `pz_${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`,
                name: pizzaTitle,
                price: fixedPrice,
                qty: 1,
                sentQty: 0,
                isPizza: true
            });

            selectedPizzaFlavors = [];
            saveCurrentTableState();
            renderOrderList();
            renderMenuGrid();
            showToast(`${pizzaTitle} agregada a ${currentTable} ($20.000)`, 'success');
        }
        return;
    }
}

// Modal alternativo de personalización con notas
let pizzaBuilderState = {
    flavorCount: 1,
    flavor1Id: null,
    flavor2Id: null,
    flavor3Id: null,
    qty: 1,
    currentUnitPrice: 0,
    currentTitle: ''
};

function openPizzaBuilderModal(preselectedFlavorId = null) {
    const flavors = getPizzaFlavorsCatalog().filter(f => f.id !== 'pz_libre');
    if (flavors.length === 0) return;

    pizzaBuilderState.flavorCount = 1;
    pizzaBuilderState.qty = 1;

    if (preselectedFlavorId && preselectedFlavorId !== 'pz_libre') {
        const found = flavors.find(f => f.id === preselectedFlavorId);
        pizzaBuilderState.flavor1Id = found ? found.id : flavors[0].id;
    } else {
        pizzaBuilderState.flavor1Id = flavors[0].id;
    }

    pizzaBuilderState.flavor2Id = flavors.length > 1 ? flavors[1].id : flavors[0].id;
    pizzaBuilderState.flavor3Id = flavors.length > 2 ? flavors[2].id : flavors[0].id;

    populatePizzaFlavorSelects(flavors);

    const subtitleElem = document.getElementById('pizza-modal-subtitle');
    if (subtitleElem) subtitleElem.innerText = `${currentTable} - Personalización`;

    const noteInput = document.getElementById('pizza-note-input');
    if (noteInput) noteInput.value = '';

    const customInput = document.getElementById('pizza-custom-flavor-input');
    if (customInput) customInput.value = '';

    const qtyInput = document.getElementById('pizza-qty-input');
    if (qtyInput) qtyInput.value = 1;

    setPizzaFlavorsCount(1);
    document.getElementById('pizza-builder-modal').classList.remove('hidden');
}

function closePizzaBuilderModal() {
    const modal = document.getElementById('pizza-builder-modal');
    if (modal) modal.classList.add('hidden');
}

function populatePizzaFlavorSelects(flavors) {
    const s1 = document.getElementById('select-pizza-flavor-1');
    const s2 = document.getElementById('select-pizza-flavor-2');
    const s3 = document.getElementById('select-pizza-flavor-3');

    const optionsHtml = flavors.map(f => `
        <option value="${f.id}" data-price="${f.price}" data-name="${f.name}">
            ${f.name} - $${f.price.toLocaleString()}
        </option>
    `).join('');

    if (s1) {
        s1.innerHTML = optionsHtml;
        s1.value = pizzaBuilderState.flavor1Id;
    }
    if (s2) {
        s2.innerHTML = optionsHtml;
        s2.value = pizzaBuilderState.flavor2Id;
    }
    if (s3) {
        s3.innerHTML = optionsHtml;
        s3.value = pizzaBuilderState.flavor3Id;
    }
}

function setPizzaFlavorsCount(count) {
    pizzaBuilderState.flavorCount = count;

    const btn1 = document.getElementById('btn-pizza-gustos-1');
    const btn2 = document.getElementById('btn-pizza-gustos-2');
    const btn3 = document.getElementById('btn-pizza-gustos-3');

    const cGusto2 = document.getElementById('container-gusto-2');
    const cGusto3 = document.getElementById('container-gusto-3');
    const labelGusto1 = document.getElementById('label-gusto-1');
    const labelGusto2 = document.getElementById('label-gusto-2');

    const activeClass = "py-2.5 px-2 rounded-2xl border-2 border-[#2563eb] bg-blue-50/80 text-[#2563eb] font-bold text-xs flex flex-col items-center justify-center gap-1 transition-all shadow-sm";
    const inactiveClass = "py-2.5 px-2 rounded-2xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 font-bold text-xs flex flex-col items-center justify-center gap-1 transition-all";

    if (btn1) btn1.className = count === 1 ? activeClass : inactiveClass;
    if (btn2) btn2.className = count === 2 ? activeClass : inactiveClass;
    if (btn3) btn3.className = count === 3 ? activeClass : inactiveClass;

    if (count === 1) {
        if (cGusto2) cGusto2.classList.add('hidden');
        if (cGusto3) cGusto3.classList.add('hidden');
        if (labelGusto1) labelGusto1.innerText = "Gusto de la Pizza (Entera)";
    } else if (count === 2) {
        if (cGusto2) cGusto2.classList.remove('hidden');
        if (cGusto3) cGusto3.classList.add('hidden');
        if (labelGusto1) labelGusto1.innerText = "Primer Gusto (1/2)";
        if (labelGusto2) labelGusto2.innerText = "Segundo Gusto (1/2)";
    } else if (count === 3) {
        if (cGusto2) cGusto2.classList.remove('hidden');
        if (cGusto3) cGusto3.classList.remove('hidden');
        if (labelGusto1) labelGusto1.innerText = "Primer Gusto (1/3)";
        if (labelGusto2) labelGusto2.innerText = "Segundo Gusto (1/3)";
    }

    updatePizzaBuilderPreview();
}

function onPizzaFlavorSelectChange() {
    const s1 = document.getElementById('select-pizza-flavor-1');
    const s2 = document.getElementById('select-pizza-flavor-2');
    const s3 = document.getElementById('select-pizza-flavor-3');

    if (s1) pizzaBuilderState.flavor1Id = s1.value;
    if (s2) pizzaBuilderState.flavor2Id = s2.value;
    if (s3) pizzaBuilderState.flavor3Id = s3.value;

    updatePizzaBuilderPreview();
}

function changePizzaModalQty(delta) {
    let q = (pizzaBuilderState.qty || 1) + delta;
    if (q < 1) q = 1;
    pizzaBuilderState.qty = q;
    const qtyInput = document.getElementById('pizza-qty-input');
    if (qtyInput) qtyInput.value = q;
    updatePizzaBuilderPreview();
}

function updatePizzaBuilderPreview() {
    const flavors = getPizzaFlavorsCatalog().filter(f => f.id !== 'pz_libre');
    const count = pizzaBuilderState.flavorCount;
    const f1 = flavors.find(f => f.id === pizzaBuilderState.flavor1Id) || flavors[0];
    const f2 = flavors.find(f => f.id === pizzaBuilderState.flavor2Id) || flavors[0];
    const f3 = flavors.find(f => f.id === pizzaBuilderState.flavor3Id) || flavors[0];

    const p1Elem = document.getElementById('price-gusto-1');
    const p2Elem = document.getElementById('price-gusto-2');
    const p3Elem = document.getElementById('price-gusto-3');
    if (p1Elem && f1) p1Elem.innerText = `$${f1.price.toLocaleString()}`;
    if (p2Elem && f2) p2Elem.innerText = `$${f2.price.toLocaleString()}`;
    if (p3Elem && f3) p3Elem.innerText = `$${f3.price.toLocaleString()}`;

    let unitPrice = 0;
    let pizzaTitle = "";
    let calcText = "";

    const customFlavor = document.getElementById('pizza-custom-flavor-input')?.value.trim();

    if (count === 1) {
        unitPrice = f1.price;
        pizzaTitle = `Pizza ${f1.name} (Entera)`;
        calcText = `$${unitPrice.toLocaleString()} c/u (Pizza completa de 1 gusto)`;
    } else if (count === 2) {
        unitPrice = Math.round((f1.price + f2.price) / 2);
        pizzaTitle = `Pizza 2 Gustos: 1/2 ${f1.name} + 1/2 ${f2.name}`;
        calcText = `1/2 ${f1.name} + 1/2 ${f2.name} = $${unitPrice.toLocaleString()} c/u`;
    } else if (count === 3) {
        unitPrice = 20000; // PRECIO FIJO DE $20.000
        pizzaTitle = `Pizza 3 Gustos: 1/3 ${f1.name} + 1/3 ${f2.name} + 1/3 ${f3.name}`;
        calcText = `Precio fijo: $20.000`;
    }

    if (customFlavor) {
        pizzaTitle += ` [Especial: ${customFlavor}]`;
    }

    const subtotal = unitPrice * (pizzaBuilderState.qty || 1);

    const nameElem = document.getElementById('pizza-preview-name');
    const calcElem = document.getElementById('pizza-preview-calculation');
    const totalElem = document.getElementById('pizza-preview-total');

    if (nameElem) nameElem.innerText = pizzaTitle;
    if (calcElem) calcElem.innerText = calcText;
    if (totalElem) totalElem.innerText = `$${subtotal.toLocaleString()}`;

    pizzaBuilderState.currentUnitPrice = unitPrice;
    pizzaBuilderState.currentTitle = pizzaTitle;
}

function confirmAddPizzaToOrder() {
    updatePizzaBuilderPreview();

    const title = pizzaBuilderState.currentTitle;
    const unitPrice = pizzaBuilderState.currentUnitPrice;
    const qty = pizzaBuilderState.qty || 1;
    const kitchenNote = document.getElementById('pizza-note-input')?.value.trim() || '';

    if (!title || !unitPrice || unitPrice <= 0) {
        showToast('Error al calcular los gustos de la pizza', 'warning');
        return;
    }

    if (!ordersByTable[currentTable]) {
        ordersByTable[currentTable] = { items: [], note: "" };
    }

    const tableItems = ordersByTable[currentTable].items;

    const existing = tableItems.find(i => i.name === title && (i.note || '') === kitchenNote && (i.qty > (i.sentQty || 0)));
    if (existing) {
        existing.qty += qty;
    } else {
        tableItems.push({
            id: `pz_${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`,
            name: title,
            price: unitPrice,
            qty: qty,
            sentQty: 0,
            isPizza: true,
            flavorCount: pizzaBuilderState.flavorCount,
            note: kitchenNote
        });
    }

    closePizzaBuilderModal();
    saveCurrentTableState();
    renderOrderList();
    renderMenuGrid();

    showToast(`${qty}x ${title} agregada a ${currentTable}`, 'success');
}

function renderMenuGrid() {
    const container = document.getElementById('menu-grid');
    if (!container) return;

    let itemsToDisplay = [];
    const isPizzasView = activeCategory === 'pizzas' && searchQuery.length === 0;

    if (searchQuery.length > 0) {
        Object.keys(menuData).forEach(catKey => {
            const cat = menuData[catKey];
            cat.items.forEach(item => {
                const matchName = item.name.toLowerCase().includes(searchQuery);
                const matchDesc = item.desc && item.desc.toLowerCase().includes(searchQuery);
                if (matchName || matchDesc) {
                    itemsToDisplay.push({ ...item, categoryKey: catKey, categoryName: cat.name });
                }
            });
        });
    } else {
        const cat = menuData[activeCategory];
        if (cat && Array.isArray(cat.items) && cat.items.length > 0) {
            itemsToDisplay = cat.items.map(item => ({ ...item, categoryKey: activeCategory, categoryName: cat.name }));
        } else if (activeCategory === 'pizzas') {
            itemsToDisplay = OFFICIAL_PIZZAS.map(item => ({ ...item, categoryKey: 'pizzas', categoryName: 'Pizzas' }));
        }
    }

    if (itemsToDisplay.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-12 text-slate-400 space-y-2">
                <i class="fa-solid fa-magnifying-glass text-2xl"></i>
                <p class="text-xs">No se encontraron productos para "${searchQuery}".</p>
            </div>
        `;
        return;
    }

    const currentItems = (ordersByTable[currentTable] && ordersByTable[currentTable].items) || [];

    // TRES BOTONES EN LA SECCIÓN DE PIZZAS (1 gusto, 2 gustos, 3 gustos)
    let pizzaToolbarHtml = '';
    if (isPizzasView) {
        let statusBarHtml = '';
        if (pizzaSelectionMode === 2) {
            if (selectedPizzaFlavors.length === 0) {
                statusBarHtml = `
                    <div class="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-900 flex items-center justify-between">
                        <span>Modo 2 Gustos: selecciona la primera mitad...</span>
                    </div>
                `;
            } else if (selectedPizzaFlavors.length === 1) {
                statusBarHtml = `
                    <div class="bg-blue-100 border border-blue-300 rounded-xl px-3 py-2 text-xs text-blue-950 flex items-center justify-between font-medium">
                        <span>Mitad 1: <strong>${selectedPizzaFlavors[0].name}</strong>. Marca la segunda mitad para agregar.</span>
                        <button type="button" onclick="cancelPizzaSelection()" class="text-rose-600 text-[11px] font-bold hover:underline cursor-pointer">Cancelar</button>
                    </div>
                `;
            }
        } else if (pizzaSelectionMode === 3) {
            if (selectedPizzaFlavors.length === 0) {
                statusBarHtml = `
                    <div class="bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2 text-xs text-indigo-900 flex items-center justify-between">
                        <span>Modo 3 Gustos ($20.000 fijo): selecciona el primer tercio...</span>
                    </div>
                `;
            } else if (selectedPizzaFlavors.length === 1) {
                statusBarHtml = `
                    <div class="bg-indigo-100 border border-indigo-300 rounded-xl px-3 py-2 text-xs text-indigo-950 flex items-center justify-between font-medium">
                        <span>1/3: <strong>${selectedPizzaFlavors[0].name}</strong>. Marca el segundo tercio...</span>
                        <button type="button" onclick="cancelPizzaSelection()" class="text-rose-600 text-[11px] font-bold hover:underline cursor-pointer">Cancelar</button>
                    </div>
                `;
            } else if (selectedPizzaFlavors.length === 2) {
                statusBarHtml = `
                    <div class="bg-indigo-100 border border-indigo-300 rounded-xl px-3 py-2 text-xs text-indigo-950 flex items-center justify-between font-medium">
                        <span>1/3: <strong>${selectedPizzaFlavors[0].name}</strong> + 1/3: <strong>${selectedPizzaFlavors[1].name}</strong>. Marca el tercer tercio para agregar ($20.000).</span>
                        <button type="button" onclick="cancelPizzaSelection()" class="text-rose-600 text-[11px] font-bold hover:underline cursor-pointer">Cancelar</button>
                    </div>
                `;
            }
        }

        pizzaToolbarHtml = `
            <div class="col-span-full space-y-2 mb-2">
                <div class="bg-white border border-slate-200 rounded-2xl p-1.5 shadow-sm grid grid-cols-3 gap-1.5">
                    <button type="button" onclick="setPizzaSelectionMode(1)"
                        class="py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${pizzaSelectionMode === 1 ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}">
                        <span>1 Gusto</span>
                        <span class="text-[10px] font-normal ${pizzaSelectionMode === 1 ? 'text-blue-100' : 'text-slate-400'}">Entera</span>
                    </button>
                    <button type="button" onclick="setPizzaSelectionMode(2)"
                        class="py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${pizzaSelectionMode === 2 ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}">
                        <span>2 Gustos</span>
                        <span class="text-[10px] font-normal ${pizzaSelectionMode === 2 ? 'text-blue-100' : 'text-slate-400'}">Mitad y mitad</span>
                    </button>
                    <button type="button" onclick="setPizzaSelectionMode(3)"
                        class="py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${pizzaSelectionMode === 3 ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}">
                        <span>3 Gustos</span>
                        <span class="text-[10px] font-normal ${pizzaSelectionMode === 3 ? 'text-blue-100' : 'text-slate-400'}">$20.000 fijo</span>
                    </button>
                </div>
                ${statusBarHtml}
            </div>
        `;
    }

    const cardsHtml = itemsToDisplay.map(item => {
        const isPizza = item.categoryKey === 'pizzas' || (item.categoryName && item.categoryName.toLowerCase().includes('pizza')) || activeCategory === 'pizzas';
        const isPizzaLibre = item.id === 'pz_libre' || item.name.toLowerCase().includes('pizza libre');
        const orderItem = currentItems.find(i => i.id === item.id);
        const qty = orderItem ? orderItem.qty : 0;

        const isSelectedFlavor = selectedPizzaFlavors.some(f => f.id === item.id);
        let selectedIndexBadge = '';
        if (isSelectedFlavor) {
            const idx = selectedPizzaFlavors.findIndex(f => f.id === item.id);
            if (pizzaSelectionMode === 2) {
                selectedIndexBadge = `<span class="bg-[#2563eb] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Mitad 1</span>`;
            } else if (pizzaSelectionMode === 3) {
                selectedIndexBadge = `<span class="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Tercio ${idx + 1}</span>`;
            }
        }

        let cardBorderClass = "border-slate-200 hover:border-blue-300";
        if (isSelectedFlavor) {
            cardBorderClass = "border-2 border-[#2563eb] bg-blue-50/40 shadow-md ring-2 ring-blue-300/40";
        }

        let actionButton = '';
        if (isPizzaLibre) {
            actionButton = `
                <button type="button" onclick="openPizzaLibreModal()" class="bg-[#2563eb] hover:bg-blue-600 active:scale-95 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1.5 cursor-pointer">
                    <i class="fa-solid fa-users text-[10px]"></i>
                    <span>Elegir Personas</span>
                </button>
            `;
        } else if (isPizza) {
            if (pizzaSelectionMode === 1) {
                actionButton = `
                    <button type="button" onclick="onPizzaItemClicked('${item.id}')" class="bg-[#2563eb] hover:bg-blue-600 active:scale-95 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1.5 cursor-pointer">
                        <i class="fa-solid fa-plus text-[10px]"></i>
                        <span>Agregar</span>
                    </button>
                `;
            } else if (pizzaSelectionMode === 2) {
                actionButton = `
                    <button type="button" onclick="onPizzaItemClicked('${item.id}')" class="${isSelectedFlavor ? 'bg-blue-700' : 'bg-[#2563eb] hover:bg-blue-600'} active:scale-95 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1.5 cursor-pointer">
                        <i class="fa-solid fa-check text-[10px]"></i>
                        <span>${isSelectedFlavor ? 'Mitad 1' : 'Elegir Mitad'}</span>
                    </button>
                `;
            } else if (pizzaSelectionMode === 3) {
                actionButton = `
                    <button type="button" onclick="onPizzaItemClicked('${item.id}')" class="${isSelectedFlavor ? 'bg-indigo-700' : 'bg-[#2563eb] hover:bg-blue-600'} active:scale-95 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1.5 cursor-pointer">
                        <i class="fa-solid fa-check text-[10px]"></i>
                        <span>${isSelectedFlavor ? 'Seleccionada' : 'Elegir Tercio'}</span>
                    </button>
                `;
            }
        } else {
            actionButton = `
                <button type="button" onclick="addToOrder('${item.id}')" class="bg-[#2563eb] hover:bg-blue-600 active:scale-95 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1.5 cursor-pointer">
                    <i class="fa-solid fa-plus text-[10px]"></i>
                    <span>Agregar</span>
                </button>
            `;
        }

        return `
            <div onclick="${isPizza ? `onPizzaItemClicked('${item.id}')` : ''}" class="bg-white border ${cardBorderClass} rounded-2xl p-3.5 shadow-sm transition-all flex flex-col justify-between space-y-2 cursor-pointer">
                <div>
                    <div class="flex items-start justify-between gap-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <h4 class="font-bold text-sm text-slate-800 leading-snug">${item.name}</h4>
                            ${selectedIndexBadge}
                        </div>
                        <span class="font-bold text-sm text-[#2563eb] shrink-0">$${item.price.toLocaleString()}</span>
                    </div>
                    ${item.desc ? `<p class="text-[11px] text-slate-500 line-clamp-2 mt-0.5 leading-tight">${item.desc}</p>` : ''}
                </div>

                <div class="flex items-center justify-between pt-1" onclick="event.stopPropagation()">
                    ${qty > 0 ? `
                        <span class="bg-blue-50 text-[#2563eb] border border-blue-200 text-xs px-2.5 py-0.5 rounded-full font-bold">
                            ${qty} en comanda
                        </span>
                    ` : `
                        <span class="text-[10px] text-slate-400">Disponible</span>
                    `}

                    ${actionButton}
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = pizzaToolbarHtml + cardsHtml;
}

function findMenuItemById(itemId) {
    for (const catKey in menuData) {
        const item = menuData[catKey].items.find(i => i.id === itemId);
        if (item) return item;
    }
    const pizzaFlavor = OFFICIAL_PIZZAS.find(i => i.id === itemId);
    if (pizzaFlavor) return pizzaFlavor;
    return null;
}

function addToOrder(itemId) {
    const item = findMenuItemById(itemId);
    if (!item) return;

    // Si es pizza, derivar a la lógica de selección de pizza
    const isPizza = item.categoryKey === 'pizzas' || activeCategory === 'pizzas' || (menuData.pizzas && menuData.pizzas.items.some(i => i.id === itemId));
    if (isPizza) {
        onPizzaItemClicked(itemId);
        return;
    }

    if (!ordersByTable[currentTable]) {
        ordersByTable[currentTable] = { items: [], note: "" };
    }

    const tableItems = ordersByTable[currentTable].items;
    const existing = tableItems.find(i => i.id === itemId);

    if (existing) {
        existing.qty += 1;
    } else {
        tableItems.push({
            id: item.id,
            name: item.name,
            qty: 1,
            sentQty: 0,
            price: item.price
        });
    }

    saveCurrentTableState();
    renderOrderList();
    renderMenuGrid();
}

function updateQuantity(itemId, delta) {
    const tableItems = ordersByTable[currentTable].items;
    const itemIndex = tableItems.findIndex(i => i.id === itemId);
    if (itemIndex < 0) return;

    const item = tableItems[itemIndex];
    item.qty += delta;

    if (item.qty <= 0) {
        tableItems.splice(itemIndex, 1);
    } else if (item.sentQty && item.qty < item.sentQty) {
        item.sentQty = item.qty;
    }

    saveCurrentTableState();
    renderOrderList();
    renderMenuGrid();
}

function saveCurrentNote(val) {
    if (!ordersByTable[currentTable]) {
        ordersByTable[currentTable] = { items: [], note: "" };
    }
    ordersByTable[currentTable].note = val;
    saveCurrentTableState();
}

async function saveCurrentTableState() {
    saveLocalState();
    try {
        const res = await fetch(`/api/tables/${encodeURIComponent(currentTable)}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ordersByTable[currentTable])
        });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Sincronización diferida en mesa:', e);
    }
}

// ================= BOTTOM DRAWER DESPLEGABLE MÓVIL =================

function toggleOrderDrawer() {
    setMobileDrawerState(!isDrawerOpen);
}

function setMobileDrawerState(open) {
    isDrawerOpen = open;
    const content = document.getElementById('order-drawer-content');
    const chevron = document.getElementById('drawer-chevron');

    if (open) {
        content.classList.remove('hidden');
        if (chevron) chevron.classList.add('rotate-180');
    } else {
        content.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    }
}

function renderOrderList() {
    const tableOrder = ordersByTable[currentTable] || { items: [], note: "" };
    const items = tableOrder.items || [];
    const container = document.getElementById('order-items-list');
    const itemCountBadge = document.getElementById('item-count-badge');
    const drawerTitleMobile = document.getElementById('drawer-title-mobile');
    const drawerTotalPreview = document.getElementById('drawer-total-preview');
    const totalPriceElem = document.getElementById('order-total-price');
    const sendBtn = document.getElementById('send-order-btn');
    const payBtn = document.getElementById('pay-table-btn');

    const totalQty = items.reduce((acc, i) => acc + i.qty, 0);
    const totalPrice = items.reduce((acc, i) => acc + (i.price * i.qty), 0);
    const newItemsCount = items.reduce((acc, i) => acc + Math.max(0, i.qty - (i.sentQty || 0)), 0);

    if (itemCountBadge) itemCountBadge.innerText = `${totalQty} ítem${totalQty === 1 ? '' : 's'}`;
    if (drawerTitleMobile) drawerTitleMobile.innerText = `Ver Comanda (${totalQty} ítem${totalQty === 1 ? '' : 's'})`;
    if (drawerTotalPreview) drawerTotalPreview.innerText = `$${totalPrice.toLocaleString()}`;
    if (totalPriceElem) totalPriceElem.innerText = `$${totalPrice.toLocaleString()}`;

    if (items.length === 0) {
        container.innerHTML = `
            <div class="text-center py-6 text-slate-400 space-y-1">
                <i class="fa-solid fa-receipt text-xl"></i>
                <p class="text-xs">No hay productos agregados en ${currentTable}</p>
            </div>
        `;
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i><span>Enviar a Cocina</span>';
        }
        if (payBtn) payBtn.disabled = true;
        return;
    }

    if (payBtn) payBtn.disabled = false;

    if (sendBtn) {
        if (newItemsCount > 0) {
            sendBtn.disabled = false;
            sendBtn.className = "w-full bg-[#2563eb] hover:bg-blue-600 text-white font-bold py-2.5 rounded-xl text-xs transition-all shadow-md shadow-blue-500/20 flex items-center justify-center space-x-2 cursor-pointer";
            sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i><span>Enviar a Cocina (${newItemsCount} nuevo${newItemsCount === 1 ? '' : 's'})</span>`;
        } else {
            sendBtn.disabled = true;
            sendBtn.className = "w-full bg-slate-100 text-slate-400 font-bold py-2.5 rounded-xl text-xs flex items-center justify-center space-x-2 cursor-not-allowed";
            sendBtn.innerHTML = '<i class="fa-solid fa-check-double text-emerald-500"></i><span>Todo enviado a cocina</span>';
        }
    }

    container.innerHTML = items.map(item => {
        const sent = item.sentQty || 0;
        const unsent = Math.max(0, item.qty - sent);

        let statusPill = '';
        if (sent > 0 && unsent === 0) {
            statusPill = `<span class="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded font-semibold">${sent} en cocina</span>`;
        } else if (sent > 0 && unsent > 0) {
            statusPill = `<span class="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded font-semibold">${sent} en cocina</span> <span class="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded font-bold">+${unsent} nuevo</span>`;
        } else {
            statusPill = `<span class="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded font-bold">Por enviar</span>`;
        }

        return `
            <div class="py-2 flex items-center justify-between gap-2 text-xs border-b border-slate-50 last:border-b-0">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <h5 class="font-bold text-slate-800 break-words leading-tight">${item.name}</h5>
                        ${statusPill}
                    </div>
                    ${item.note ? `<p class="text-[10px] text-amber-700 font-semibold italic mt-0.5"><i class="fa-solid fa-note-sticky text-[9px] mr-1"></i>${item.note}</p>` : ''}
                    <span class="text-slate-400 text-[11px]">$${item.price.toLocaleString()} c/u</span>
                </div>

                <div class="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-xl p-1 shrink-0">
                    <button onclick="updateQuantity('${item.id}', -1)" class="w-6 h-6 rounded-lg bg-white text-slate-700 hover:bg-slate-100 flex items-center justify-center font-bold shadow-sm transition-all cursor-pointer">
                        <i class="fa-solid fa-minus text-[9px]"></i>
                    </button>
                    <span class="font-bold w-5 text-center text-slate-800 text-xs">${item.qty}</span>
                    <button onclick="updateQuantity('${item.id}', 1)" class="w-6 h-6 rounded-lg bg-white text-[#2563eb] hover:bg-blue-50 flex items-center justify-center font-bold shadow-sm transition-all cursor-pointer">
                        <i class="fa-solid fa-plus text-[9px]"></i>
                    </button>
                </div>

                <span class="font-bold text-slate-900 w-16 text-right shrink-0">
                    $${(item.price * item.qty).toLocaleString()}
                </span>
            </div>
        `;
    }).join('');
}

async function sendOrderToKitchen() {
    const tableOrder = ordersByTable[currentTable];
    if (!tableOrder || tableOrder.items.length === 0) return;

    // Calcular SOLAMENTE los ítems nuevos o cantidades agregadas que no fueron enviadas antes
    const newItemsToSend = [];
    tableOrder.items.forEach(item => {
        const sent = item.sentQty || 0;
        const diff = item.qty - sent;
        if (diff > 0) {
            newItemsToSend.push({
                id: item.id || `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                name: item.name + (item.note ? ` [${item.note}]` : ''),
                price: item.price,
                qty: diff,
                isAddon: sent > 0,
                status: 'pending'
            });
        }
    });

    if (newItemsToSend.length === 0) {
        showToast('Todos los platos de esta mesa ya fueron enviados a cocina', 'info');
        return;
    }

    // Buscar si ya existe una comanda activa para esta mesa
    const existingCmd = kitchenOrders.find(o => o.table === currentTable && o.status !== 'paid');
    const isAddon = Boolean(existingCmd);

    const waiter = currentUser ? currentUser.name : "Mozo";
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const roundTotal = newItemsToSend.reduce((acc, i) => acc + (i.price * i.qty), 0);
    const cmdId = existingCmd ? existingCmd.id : `CMD-${Math.floor(100 + Math.random() * 900)}`;

    const newCmdPayload = {
        id: cmdId,
        table: currentTable,
        waiterName: waiter,
        time: timeStr,
        status: "pending",
        printed: false,
        items: newItemsToSend,
        total: roundTotal,
        note: tableOrder.note || ""
    };

    // Marcar como enviados todos los ítems actuales de la mesa
    tableOrder.items.forEach(item => {
        item.sentQty = item.qty;
    });

    // Guardar mesa actualizada (con los sentQty) en Neon DB
    saveCurrentTableState();

    if (existingCmd) {
        // Unificar en la comanda activa existente
        const formattedNew = newItemsToSend.map(it => ({ ...it, status: 'pending', sentAt: timeStr, isAddon: true }));
        existingCmd.items = [...(existingCmd.items || []), ...formattedNew];
        existingCmd.total = existingCmd.items.reduce((acc, i) => acc + (i.price * i.qty), 0);
        existingCmd.status = 'pending';
        existingCmd.time = timeStr;
        existingCmd.waiterName = waiter;
        existingCmd.printed = false;
        if (tableOrder.note) existingCmd.note = tableOrder.note;
    } else {
        const fullNewCmd = {
            id: cmdId,
            table: currentTable,
            waiterName: waiter,
            time: timeStr,
            status: "pending",
            printed: false,
            items: newItemsToSend.map(it => ({ ...it, status: 'pending', sentAt: timeStr })),
            total: roundTotal,
            note: tableOrder.note || ""
        };
        kitchenOrders.unshift(fullNewCmd);
    }

    saveLocalState();
    refreshActiveViews();

    try {
        const res = await fetch('/api/orders/send-kitchen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newCmdPayload)
        });
        if (res.ok) {
            const data = await res.json();
            if (data.order) {
                const idx = kitchenOrders.findIndex(o => o.id === data.order.id || (o.table === data.order.table && o.status !== 'paid'));
                if (idx >= 0) kitchenOrders[idx] = data.order;
                else kitchenOrders.unshift(data.order);
                saveLocalState();
                refreshActiveViews();
            }
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error enviando comanda a la base de datos:', e);
    }

    // Regresar de inmediato al menú de mesas en el salón (sin alertas bloqueantes)
    backToTablesView();

    // Notificación sutil no intrusiva de éxito
    const toastMsg = isAddon
        ? `Nuevos platos agregados a la comanda de ${currentTable}`
        : `Comanda de ${currentTable} enviada a cocina`;
    showToast(toastMsg, 'success');
}

// ================= CHECKOUT Y PROPINA A VOLUNTAD (POR RESTA) =================

function openPaymentByTable(tableName) {
    activePaymentTable = tableName;
    const tableOrder = ordersByTable[tableName];
    const cmd = kitchenOrders.find(o => o.table === tableName && o.status !== 'paid');

    let total = 0;
    if (tableOrder && tableOrder.items.length > 0) {
        total = tableOrder.items.reduce((acc, i) => acc + (i.price * i.qty), 0);
    } else if (cmd) {
        total = cmd.total;
    }

    if (total <= 0) return;
    activePaymentTotal = total;

    document.getElementById('pay-modal-subtitle').innerText = `${tableName}${cmd ? ' • ' + cmd.id : ''}`;
    document.getElementById('pay-modal-total').innerText = `$${total.toLocaleString()}`;

    // Poblar y seleccionar mozo que cobra la mesa
    const waiterSelect = document.getElementById('pay-waiter-select');
    if (waiterSelect) {
        const preferredWaiter = (currentUser && currentUser.name) || (cmd && cmd.waiterName) || '';
        let staffOptions = staffList;
        if (!staffOptions || staffOptions.length === 0) {
            staffOptions = [{ id: 'm1', name: preferredWaiter || 'Mozo', role: 'Mozo' }];
        }
        waiterSelect.innerHTML = staffOptions.map(s => {
            const isSelected = (preferredWaiter === s.name) || (!preferredWaiter && s.role !== 'Cocina / Admin');
            return `<option value="${s.name}" ${isSelected ? 'selected' : ''}>${s.name} (${s.role || 'Personal'})</option>`;
        }).join('');
    }

    selectPaymentMethod('Efectivo');
    document.getElementById('payment-modal').classList.remove('hidden');
}

function selectPaymentMethod(method) {
    selectedPaymentMethod = method;
    const btnEfectivo = document.getElementById('btn-method-efectivo');
    const btnTransfer = document.getElementById('btn-method-transferencia');
    const paidLabel = document.getElementById('cash-paid-label');

    if (method === 'Efectivo') {
        btnEfectivo.className = "py-2.5 px-3 rounded-xl border-2 border-[#2563eb] bg-blue-50/70 text-[#2563eb] font-bold text-xs flex items-center justify-center space-x-2 transition-all";
        btnTransfer.className = "py-2.5 px-3 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 font-semibold text-xs flex items-center justify-center space-x-2 transition-all";
        paidLabel.innerText = "2. ¿Cuánto dejó en efectivo el cliente?";
    } else {
        btnTransfer.className = "py-2.5 px-3 rounded-xl border-2 border-[#2563eb] bg-blue-50/70 text-[#2563eb] font-bold text-xs flex items-center justify-center space-x-2 transition-all";
        btnEfectivo.className = "py-2.5 px-3 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 font-semibold text-xs flex items-center justify-center space-x-2 transition-all";
        paidLabel.innerText = "2. ¿Cuánto transfirió el cliente?";
    }

    document.getElementById('cash-paid-input').value = activePaymentTotal;
    onCashPaidInput();
}

function onCashPaidInput() {
    const paid = parseFloat(document.getElementById('cash-paid-input').value) || 0;
    const tip = Math.max(0, paid - activePaymentTotal);
    document.getElementById('tip-calculated-display').innerText = `$${tip.toLocaleString()}`;
}

function closePaymentModal() {
    document.getElementById('payment-modal').classList.add('hidden');
    activePaymentTable = null;
}

async function confirmPaymentAndFinish() {
    if (!activePaymentTable) return;

    const paidWith = parseFloat(document.getElementById('cash-paid-input').value) || activePaymentTotal;
    const tip = Math.max(0, paidWith - activePaymentTotal);

    if (tip > 0) {
        generalTipsPool += tip;
    }

    const tableOrder = ordersByTable[activePaymentTable];
    const cmd = kitchenOrders.find(o => o.table === activePaymentTable && o.status !== 'paid');
    let itemsList = (tableOrder && tableOrder.items.length > 0) ? tableOrder.items : (cmd ? cmd.items : []);
    const itemsSummary = itemsList.map(i => `${i.qty}x ${i.name}`).join(', ') || 'Consumo salón';

    // Mozo que cobró la mesa (desde selector de modal o usuario activo)
    const waiterSelect = document.getElementById('pay-waiter-select');
    const waiterName = (waiterSelect && waiterSelect.value)
        ? waiterSelect.value
        : (currentUser ? currentUser.name : (cmd ? cmd.waiterName : 'Mozo'));

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const paymentRecord = {
        id: `PAG-${101 + paymentHistory.length}`,
        table: activePaymentTable,
        waiter: waiterName, // Mozo que realizó el cobro
        time: timeStr,
        method: selectedPaymentMethod,
        total: activePaymentTotal,
        paidWith: paidWith,
        tip: tip,
        itemsSummary: itemsSummary,
        items: itemsList.map(i => ({ ...i }))
    };

    paymentHistory.unshift(paymentRecord);

    if (ordersByTable[activePaymentTable]) {
        ordersByTable[activePaymentTable] = { items: [], note: "" };
    }

    kitchenOrders.forEach(c => {
        if (c.table === activePaymentTable && c.status !== 'paid') {
            c.status = 'paid';
        }
    });

    const closedTable = activePaymentTable;
    const methodUsed = selectedPaymentMethod;
    const totalAmount = activePaymentTotal;

    saveLocalState();
    closePaymentModal();
    updateHeaderIndicators();

    // Sincronizar con servidor Neon DB
    try {
        const res = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(paymentRecord)
        });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error sincronizando cobro con Neon DB:', e);
    }

    refreshActiveViews();

    showModal(
        `${closedTable} Pagada (${methodUsed})`,
        `Cobró: ${waiterName} • Total: $${totalAmount.toLocaleString()} • Pagó: $${paidWith.toLocaleString()} • Propina: $${tip.toLocaleString()}. Mesa liberada.`
    );
}

// ================= MODAL DE REGISTRO DE PAGOS =================

function openPaymentHistoryModal() {
    renderPaymentHistoryList();
    document.getElementById('payment-history-modal').classList.remove('hidden');
}

function closePaymentHistoryModal() {
    document.getElementById('payment-history-modal').classList.add('hidden');
}

function openPaymentHistoryFromTips() {
    closeTipsModal();
    openPaymentHistoryModal();
}

function renderPaymentHistoryList() {
    const totalSales = paymentHistory.reduce((acc, p) => acc + p.total, 0);
    const totalCash = paymentHistory.filter(p => p.method === 'Efectivo').reduce((acc, p) => acc + p.total, 0);
    const totalTransfer = paymentHistory.filter(p => p.method === 'Transferencia').reduce((acc, p) => acc + p.total, 0);

    document.getElementById('reg-total-sales').innerText = `$${totalSales.toLocaleString()}`;
    document.getElementById('reg-total-cash').innerText = `$${totalCash.toLocaleString()}`;
    document.getElementById('reg-total-transfer').innerText = `$${totalTransfer.toLocaleString()}`;
    document.getElementById('reg-total-tips').innerText = `$${generalTipsPool.toLocaleString()}`;

    const container = document.getElementById('payment-history-list');
    if (paymentHistory.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 text-slate-400">
                <p class="text-xs">Todavía no hay pagos registrados en este turno.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = paymentHistory.map(p => {
        const isCash = p.method === 'Efectivo';
        const badgeClass = isCash
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-indigo-50 text-indigo-700 border-indigo-200';
        const iconClass = isCash ? 'fa-money-bill-wave' : 'fa-building-columns';
        const paidAmount = p.paidWith || p.total;

        return `
            <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <div class="space-y-1 min-w-0">
                    <div class="flex items-center flex-wrap gap-1.5">
                        <span class="font-bold text-slate-900 text-sm">${p.table}</span>
                        <span class="px-2 py-0.5 rounded-full border text-[10px] font-bold flex items-center gap-1 ${badgeClass}">
                            <i class="fa-solid ${iconClass}"></i> ${p.method}
                        </span>
                        <span class="text-[11px] text-slate-400">${p.time}</span>
                        <span class="bg-blue-50 text-[#2563eb] border border-blue-200 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1">
                            <i class="fa-solid fa-user-check text-[9px]"></i> Cobró: ${p.waiter}
                        </span>
                    </div>
                    <p class="text-[11px] text-slate-500">${p.itemsSummary}</p>
                </div>
                <div class="flex sm:flex-col items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 shrink-0 text-right space-y-0.5">
                    <div class="text-xs">
                        <span class="text-slate-500 font-medium">Total:</span> <strong class="text-slate-900 text-sm">$${p.total.toLocaleString()}</strong>
                    </div>
                    <div class="text-[11px] space-x-2">
                        <span class="text-slate-600">Pagó: <strong class="text-slate-800">$${paidAmount.toLocaleString()}</strong></span>
                        <span class="text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full font-bold">
                            Propina: $${(p.tip || 0).toLocaleString()}
                        </span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ================= CAJA DE PROPINAS =================

function openTipsModal() {
    document.getElementById('tips-grand-total').innerText = `$${generalTipsPool.toLocaleString()}`;
    document.getElementById('tips-modal').classList.remove('hidden');
}

function closeTipsModal() {
    document.getElementById('tips-modal').classList.add('hidden');
}

// ================= PANEL DE ADMINISTRACIÓN Y COCINA (4 PESTAÑAS) =================

function switchAdminTab(tabName) {
    activeAdminTab = tabName;

    const tabs = ['kitchen', 'menu', 'report', 'staff'];
    tabs.forEach(t => {
        const btn = document.getElementById(`admin-tab-${t}`);
        const view = document.getElementById(`admin-subview-${t}`);
        if (t === tabName) {
            btn.className = "flex-1 min-w-fit px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-[#2563eb] shadow-sm transition-all flex items-center justify-center space-x-1.5 whitespace-nowrap active:scale-95";
            view.classList.remove('hidden');
        } else {
            btn.className = "flex-1 min-w-fit px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition-all flex items-center justify-center space-x-1.5 whitespace-nowrap active:scale-95";
            view.classList.add('hidden');
        }
    });

    if (tabName === 'kitchen') renderKitchenOrders();
    else if (tabName === 'menu') renderAdminMenuManager();
    else if (tabName === 'report') renderNightReportView();
    else if (tabName === 'staff') renderAdminStaffList();
}

function switchToWaiterTables() {
    document.getElementById('admin-workspace').classList.add('hidden');
    document.getElementById('waiter-order-view').classList.add('hidden');
    document.getElementById('waiter-tables-view').classList.remove('hidden');
    renderTablesGrid();
    updateAdminNavButtons();
}

function switchToAdminWorkspace(tab = 'kitchen') {
    document.getElementById('waiter-tables-view').classList.add('hidden');
    document.getElementById('waiter-order-view').classList.add('hidden');
    document.getElementById('admin-workspace').classList.remove('hidden');
    switchAdminTab(tab || activeAdminTab || 'kitchen');
    updateAdminNavButtons();
}

function updateAdminNavButtons() {
    const headerAdminBtn = document.getElementById('header-admin-nav-btn');
    const headerSalonBtn = document.getElementById('header-salon-nav-btn');
    const salonAdminBtn = document.getElementById('salon-back-admin-btn');
    const orderAdminBtn = document.getElementById('order-back-admin-btn');

    if (!currentUser) {
        if (headerAdminBtn) headerAdminBtn.classList.add('hidden');
        if (headerSalonBtn) headerSalonBtn.classList.add('hidden');
        if (salonAdminBtn) salonAdminBtn.classList.add('hidden');
        if (orderAdminBtn) orderAdminBtn.classList.add('hidden');
        return;
    }

    const isAdmin = currentUser.role.includes('Admin') || currentUser.role.includes('Cocina') || currentUser.role.includes('Encargado');

    if (!isAdmin) {
        if (headerAdminBtn) headerAdminBtn.classList.add('hidden');
        if (headerSalonBtn) headerSalonBtn.classList.add('hidden');
        if (salonAdminBtn) salonAdminBtn.classList.add('hidden');
        if (orderAdminBtn) orderAdminBtn.classList.add('hidden');
        return;
    }

    const adminWorkspace = document.getElementById('admin-workspace');
    const isInAdmin = adminWorkspace && !adminWorkspace.classList.contains('hidden');

    if (headerAdminBtn) {
        if (isInAdmin) headerAdminBtn.classList.add('hidden');
        else headerAdminBtn.classList.remove('hidden');
    }

    if (headerSalonBtn) {
        // En mobile y desktop, el panel admin tiene su propio botón "Ver Salón" destacado.
        // Ocultamos el botón duplicado de la barra superior para no saturar la pantalla.
        headerSalonBtn.classList.add('hidden');
    }

    if (salonAdminBtn) {
        if (isInAdmin) salonAdminBtn.classList.add('hidden');
        else salonAdminBtn.classList.remove('hidden');
    }

    if (orderAdminBtn) {
        if (isInAdmin) orderAdminBtn.classList.add('hidden');
        else orderAdminBtn.classList.remove('hidden');
    }
}

// ================= PESTAÑA 1: COCINA EN VIVO (TABLERO UNIFICADO POR MESA) =================

function setKitchenFilter(filter) {
    kitchenFilterStatus = filter;
    renderKitchenOrders();
}

function renderKitchenOrders() {
    const container = document.getElementById('kitchen-orders-grid');
    if (!container) return;

    // Solo comandas de mesas activas (no cobradas)
    const activeOrders = kitchenOrders.filter(o => o.status !== 'paid');

    // Calcular contadores por pestaña
    const countAll = activeOrders.length;
    const countPending = activeOrders.filter(o => {
        const pending = (o.items || []).filter(i => (i.status || o.status) !== 'delivered');
        return pending.length > 0 || o.status === 'pending' || o.status === 'ready';
    }).length;
    const countReady = activeOrders.filter(o => o.status === 'ready').length;
    const countDelivered = activeOrders.filter(o => {
        const pending = (o.items || []).filter(i => (i.status || o.status) !== 'delivered');
        return pending.length === 0 || o.status === 'delivered';
    }).length;

    // Actualizar badges y estilo en los botones de filtro
    const filterDefs = [
        { id: 'all', label: `Todas (${countAll})` },
        { id: 'pending', label: `Pendientes (${countPending})` },
        { id: 'ready', label: `¡Listos! (${countReady})` },
        { id: 'delivered', label: `Entregadas (${countDelivered})` }
    ];

    filterDefs.forEach(f => {
        const btn = document.getElementById(`kfilter-${f.id}`);
        if (!btn) return;
        btn.innerText = f.label;
        if (f.id === kitchenFilterStatus) {
            btn.className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-[#2563eb] text-white transition-all shadow-sm whitespace-nowrap active:scale-95";
        } else {
            btn.className = "px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition-all whitespace-nowrap active:scale-95";
        }
    });

    let filtered = activeOrders;
    if (kitchenFilterStatus === 'pending') {
        filtered = activeOrders.filter(o => {
            const pending = (o.items || []).filter(i => (i.status || o.status) !== 'delivered');
            return pending.length > 0 || o.status === 'pending' || o.status === 'ready';
        });
    } else if (kitchenFilterStatus === 'ready') {
        filtered = activeOrders.filter(o => o.status === 'ready');
    } else if (kitchenFilterStatus === 'delivered') {
        filtered = activeOrders.filter(o => {
            const pending = (o.items || []).filter(i => (i.status || o.status) !== 'delivered');
            return pending.length === 0 || o.status === 'delivered';
        });
    }

    if (filtered.length === 0) {
        let emptyMsg = "No hay comandas activas en cocina.";
        if (kitchenFilterStatus === 'pending') emptyMsg = "¡Todo al día! No hay platos pendientes por preparar en cocina.";
        else if (kitchenFilterStatus === 'ready') emptyMsg = "No hay pedidos listos esperando ser retirados por los mozos.";
        else if (kitchenFilterStatus === 'delivered') emptyMsg = "Aún no hay comandas entregadas en esta jornada.";

        container.innerHTML = `
            <div class="col-span-full text-center py-12 bg-white rounded-2xl border border-slate-200/80 shadow-sm text-slate-400 space-y-2.5 p-6">
                <div class="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 text-slate-400 flex items-center justify-center mx-auto text-xl">
                    <i class="fa-solid fa-utensils"></i>
                </div>
                <p class="text-xs font-medium text-slate-500">${emptyMsg}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(cmd => {
        const pendingItems = (cmd.items || []).filter(i => (i.status || cmd.status) !== 'delivered');
        const deliveredItems = (cmd.items || []).filter(i => (i.status || cmd.status) === 'delivered');
        const pendingQty = pendingItems.reduce((acc, i) => acc + (Number(i.qty) || 1), 0);
        const deliveredQty = deliveredItems.reduce((acc, i) => acc + (Number(i.qty) || 1), 0);

        let statusBadge = "";
        let cardBorder = "border-slate-200 bg-white";

        if (cmd.status === 'ready') {
            statusBadge = `
                <span class="bg-blue-600 text-white px-2.5 py-1 rounded-full text-[11px] font-extrabold shadow-sm animate-pulse flex items-center gap-1.5">
                    <i class="fa-solid fa-bell"></i>
                    <span>¡Listo para Mozo!</span>
                </span>
            `;
            cardBorder = "border-blue-400 ring-2 ring-blue-300/40 bg-blue-50/15";
        } else if (pendingItems.length > 0) {
            statusBadge = `
                <span class="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5">
                    <i class="fa-solid fa-fire text-amber-600"></i>
                    <span>Por Cocinar (${pendingQty})</span>
                </span>
            `;
            cardBorder = "border-amber-300 ring-1 ring-amber-200/60 bg-white";
        } else {
            statusBadge = `
                <span class="bg-emerald-100 text-emerald-900 border border-emerald-300 px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5">
                    <i class="fa-solid fa-circle-check text-emerald-600"></i>
                    <span>Todo Entregado (${deliveredQty})</span>
                </span>
            `;
            cardBorder = "border-emerald-300 bg-emerald-50/10";
        }

        return `
            <div class="border rounded-2xl p-4 shadow-sm flex flex-col justify-between space-y-3.5 transition-all ${cardBorder}">
                <div class="space-y-3">
                    <!-- Encabezado de la comanda de la mesa -->
                    <div class="flex items-start justify-between border-b border-slate-100 pb-2.5 gap-2">
                        <div class="min-w-0">
                            <span class="text-[11px] font-bold text-slate-400 block">${cmd.id}</span>
                            <h3 class="text-lg font-black text-slate-900 truncate">${cmd.table}</h3>
                            <span class="text-[11px] text-slate-500 font-medium">Mozo: <strong class="text-slate-800">${cmd.waiterName}</strong></span>
                        </div>
                        <div class="flex flex-col items-end gap-1 shrink-0">
                            ${statusBadge}
                            <span class="text-[10px] text-slate-400 font-semibold">${cmd.time} hs</span>
                        </div>
                    </div>

                    <!-- SECTOR 1: PLATOS POR PREPARAR AHORA (PENDIENTES) -->
                    ${pendingItems.length > 0 ? `
                        <div class="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-3 space-y-2">
                            <div class="flex items-center justify-between text-xs font-bold text-amber-950 border-b border-amber-200/70 pb-1.5">
                                <span class="flex items-center gap-1.5">
                                    <i class="fa-solid fa-fire text-amber-600"></i>
                                    <span>POR PREPARAR AHORA (${pendingQty})</span>
                                </span>
                                <span class="text-[10px] text-amber-700 font-semibold">${cmd.time} hs</span>
                            </div>
                            <div class="space-y-1.5">
                                ${pendingItems.map((item, idx) => `
                                    <div class="flex items-center justify-between text-xs py-1 px-1.5 rounded-lg bg-white/70 border border-amber-100">
                                        <div class="flex items-center space-x-2 min-w-0">
                                            <span class="inline-block bg-amber-200 text-amber-900 px-2 py-0.5 rounded-md font-black text-xs shrink-0">${item.qty}x</span>
                                            <span class="font-bold text-slate-900 truncate">${item.name}</span>
                                            ${item.isAddon ? '<span class="bg-indigo-100 text-indigo-700 text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0">Agregado</span>' : ''}
                                        </div>
                                        <button onclick="deliverIndividualKitchenItem('${cmd.id}', '${item.id || item.name}')" title="Marcar este plato como entregado" class="ml-2 px-2 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-bold flex items-center space-x-1 shrink-0 active:scale-95 transition-all cursor-pointer">
                                            <i class="fa-solid fa-check"></i>
                                            <span class="hidden sm:inline">Entregar</span>
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <!-- SECTOR 2: YA ENTREGADOS EN MESA (ACUMULADOS) -->
                    ${deliveredItems.length > 0 ? `
                        <div class="bg-slate-50 border border-slate-200 rounded-2xl p-2.5 space-y-1.5">
                            <div class="flex items-center justify-between text-[11px] font-bold text-slate-600 border-b border-slate-200 pb-1">
                                <span class="flex items-center gap-1.5">
                                    <i class="fa-solid fa-circle-check text-emerald-600"></i>
                                    <span>YA ENTREGADOS EN MESA (${deliveredQty})</span>
                                </span>
                            </div>
                            <div class="space-y-1 max-h-36 overflow-y-auto pr-1">
                                ${deliveredItems.map(item => `
                                    <div class="flex items-center justify-between py-0.5 px-1 text-[11px]">
                                        <span class="flex items-center space-x-1.5 text-slate-600 truncate">
                                            <i class="fa-solid fa-check text-emerald-500 text-[10px] shrink-0"></i>
                                            <span class="truncate"><strong>${item.qty}x</strong> ${item.name}</span>
                                        </span>
                                        <span class="text-slate-400 text-[10px] shrink-0 ml-1">$${((item.price || 0) * (item.qty || 1)).toLocaleString()}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <!-- SECTOR 3: OBSERVACIONES -->
                    ${cmd.note ? `
                        <div class="bg-amber-50/70 border border-amber-200 rounded-xl p-2 text-xs text-amber-900 font-medium">
                            <span class="font-bold uppercase text-[10px] block">Observaciones:</span>
                            >> ${cmd.note}
                        </div>
                    ` : ''}
                </div>

                <!-- Footer de la tarjeta y botones de acción -->
                <div class="pt-3 border-t border-slate-100 space-y-2.5">
                    ${pendingItems.length > 0 ? `
                        <div class="grid grid-cols-2 gap-2">
                            <button onclick="updateOrderStatus('${cmd.id}', 'ready')" class="py-2.5 px-2 text-xs font-bold rounded-xl border ${cmd.status === 'ready' ? 'bg-[#2563eb] text-white border-[#2563eb] shadow-sm' : 'bg-blue-50 text-[#2563eb] border-blue-200 hover:bg-blue-100'} transition-all active:scale-95 flex items-center justify-center space-x-1.5 cursor-pointer">
                                <i class="fa-solid fa-bell"></i>
                                <span>${cmd.status === 'ready' ? '¡Listo Avisado!' : '¡Avisar Listo!'}</span>
                            </button>
                            <button onclick="deliverAllPendingForTable('${cmd.id}')" class="py-2.5 px-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-all active:scale-95 shadow-sm flex items-center justify-center space-x-1.5 cursor-pointer">
                                <i class="fa-solid fa-check-double"></i>
                                <span>Entregar Todo</span>
                            </button>
                        </div>
                    ` : `
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex-1 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-center text-xs font-bold text-emerald-700 flex items-center justify-center space-x-1.5">
                                <i class="fa-solid fa-circle-check"></i>
                                <span>Todo entregado en mesa</span>
                            </div>
                            <button onclick="reopenTableOrderToPending('${cmd.id}')" class="px-2.5 py-2 text-[11px] font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all cursor-pointer" title="Reabrir a pendiente">
                                <i class="fa-solid fa-rotate-left"></i>
                            </button>
                        </div>
                    `}

                    <div class="pt-1 flex items-center justify-between border-t border-slate-50">
                        <button onclick="openKitchenTicketPrint('${cmd.id}')" class="text-slate-500 hover:text-slate-800 text-[11px] font-semibold flex items-center space-x-1 cursor-pointer">
                            <i class="fa-solid fa-print"></i>
                            <span>${cmd.printed ? 'Ticket (Impreso)' : 'Imprimir Ticket'}</span>
                        </button>
                        <div class="text-right">
                            <span class="text-[10px] text-slate-400 block font-medium">Total Mesa:</span>
                            <strong class="text-xs sm:text-sm font-black text-slate-900">$${cmd.total.toLocaleString()}</strong>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function updateOrderStatus(id, newStatus) {
    const cmd = kitchenOrders.find(o => o.id === id);
    if (!cmd) return;

    cmd.status = newStatus;

    if (newStatus === 'ready') {
        // En administración / cocina NO se reproduce sonido.
        // La notificación acústica y vibración se envían por WebSocket al celular del mozo.
        waiterNotifications.unshift({
            id: cmd.id,
            table: cmd.table,
            time: cmd.time,
            items: (cmd.items || []).filter(i => (i.status || cmd.status) !== 'delivered'),
            waiterName: cmd.waiterName
        });
        updateWaiterNotificationUI();
    } else if (newStatus === 'delivered') {
        if (cmd.items) {
            cmd.items.forEach(i => i.status = 'delivered');
        }
        waiterNotifications = waiterNotifications.filter(n => n.id !== id);
        updateWaiterNotificationUI();
    }

    saveLocalState();
    renderKitchenOrders();
    renderTablesGrid();

    try {
        const res = await fetch(`/api/orders/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus, items: cmd.items })
        });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error actualizando comanda en base de datos:', e);
    }
}

async function deliverIndividualKitchenItem(cmdId, itemIdOrName) {
    const cmd = kitchenOrders.find(o => o.id === cmdId);
    if (!cmd || !cmd.items) return;

    const item = cmd.items.find(i => (i.id === itemIdOrName || i.name === itemIdOrName) && (i.status || cmd.status) !== 'delivered');
    if (!item) return;

    item.status = 'delivered';

    const hasRemainingPending = cmd.items.some(i => (i.status || cmd.status) !== 'delivered');
    cmd.status = hasRemainingPending ? 'pending' : 'delivered';

    if (!hasRemainingPending) {
        waiterNotifications = waiterNotifications.filter(n => n.id !== cmdId);
        updateWaiterNotificationUI();
    }

    saveLocalState();
    renderKitchenOrders();
    renderTablesGrid();

    try {
        await fetch(`/api/orders/${cmdId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: cmd.status, items: cmd.items })
        });
    } catch (e) {
        console.warn('Error sincronizando plato entregado:', e);
    }
}

async function deliverAllPendingForTable(cmdId) {
    const cmd = kitchenOrders.find(o => o.id === cmdId);
    if (!cmd || !cmd.items) return;

    cmd.items.forEach(i => {
        i.status = 'delivered';
    });
    cmd.status = 'delivered';

    waiterNotifications = waiterNotifications.filter(n => n.id !== cmdId);
    updateWaiterNotificationUI();

    saveLocalState();
    renderKitchenOrders();
    renderTablesGrid();

    try {
        await fetch(`/api/orders/${cmdId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'delivered', items: cmd.items })
        });
    } catch (e) {
        console.warn('Error sincronizando entrega:', e);
    }

    showToast(`Comanda de ${cmd.table} entregada en mesa`, 'success');
}

async function reopenTableOrderToPending(cmdId) {
    const cmd = kitchenOrders.find(o => o.id === cmdId);
    if (!cmd) return;

    cmd.status = 'pending';
    if (cmd.items) {
        cmd.items.forEach(i => i.status = 'pending');
    }

    saveLocalState();
    renderKitchenOrders();
    renderTablesGrid();

    try {
        await fetch(`/api/orders/${cmdId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'pending', items: cmd.items })
        });
    } catch (e) {
        console.warn('Error reabriendo comanda:', e);
    }
}

// ================= IMPRESIÓN DE TICKET TÉRMICO 80MM =================

function openKitchenTicketPrint(cmdId) {
    const cmd = kitchenOrders.find(o => o.id === cmdId);
    if (!cmd) return;

    cmd.printed = true;
    saveLocalState();

    fetch(`/api/orders/${cmdId}/print`, { method: 'PUT' }).catch(e => console.warn(e));

    const pendingItems = (cmd.items || []).filter(i => (i.status || cmd.status) !== 'delivered');
    const deliveredItems = (cmd.items || []).filter(i => (i.status || cmd.status) === 'delivered');

    const container = document.getElementById('printable-ticket-area');
    container.innerHTML = `
        <div class="text-center space-y-1 border-b border-dashed border-slate-400 pb-2">
            <h2 class="font-bold text-sm uppercase tracking-wide">RIVERA POS</h2>
            <p class="text-[10px]">COMANDA DE COCINA</p>
        </div>

        <div class="py-2 border-b border-dashed border-slate-400 space-y-0.5 text-[11px]">
            <div class="flex justify-between">
                <span>COMANDA:</span>
                <strong>${cmd.id}</strong>
            </div>
            <div class="flex justify-between">
                <span>MESA:</span>
                <strong class="text-sm font-black">${cmd.table}</strong>
            </div>
            <div class="flex justify-between">
                <span>HORA:</span>
                <span>${cmd.time} hs</span>
            </div>
            <div class="flex justify-between">
                <span>MOZO:</span>
                <span>${cmd.waiterName}</span>
            </div>
        </div>

        ${pendingItems.length > 0 ? `
            <div class="py-2 border-b border-dashed border-slate-400 space-y-1.5">
                <div class="flex justify-between font-bold text-[10px] uppercase text-black">
                    <span>* POR PREPARAR / PENDIENTES *</span>
                    <span>SUBTOTAL</span>
                </div>
                ${pendingItems.map(i => `
                    <div class="flex justify-between items-start text-xs font-black">
                        <span>${i.qty}x ${i.name} ${i.isAddon ? '(AGREGADO)' : ''}</span>
                        <span>$${(i.price * i.qty).toLocaleString()}</span>
                    </div>
                `).join('')}
            </div>
        ` : ''}

        ${deliveredItems.length > 0 ? `
            <div class="py-2 border-b border-dashed border-slate-400 space-y-1 text-slate-600">
                <div class="flex justify-between font-semibold text-[9px] uppercase text-slate-500">
                    <span>[ YA ENTREGADOS ANTERIORMENTE ]</span>
                    <span>SUBTOTAL</span>
                </div>
                ${deliveredItems.map(i => `
                    <div class="flex justify-between items-start text-[11px]">
                        <span>✓ ${i.qty}x ${i.name}</span>
                        <span>$${(i.price * i.qty).toLocaleString()}</span>
                    </div>
                `).join('')}
            </div>
        ` : ''}

        ${cmd.note ? `
            <div class="py-2 border-b border-dashed border-slate-400">
                <span class="font-bold uppercase text-[10px] block text-slate-500">NOTAS / OBSERVACIONES:</span>
                <p class="text-xs font-bold mt-0.5 text-black">>> ${cmd.note}</p>
            </div>
        ` : ''}

        <div class="pt-2 flex justify-between items-center text-sm font-bold">
            <span>TOTAL MESA:</span>
            <span>$${cmd.total.toLocaleString()}</span>
        </div>
    `;

    document.getElementById('ticket-print-modal').classList.remove('hidden');
}

function closeTicketPrintModal() {
    document.getElementById('ticket-print-modal').classList.add('hidden');
}

function triggerBrowserPrint() {
    window.print();
}

// ================= PESTAÑA 2: CARTA / MENÚ =================

function renderAdminMenuManager() {
    // 1. Selector de categorías para agregar productos
    const select = document.getElementById('new-item-cat');
    select.innerHTML = Object.keys(menuData).map(cKey => `
        <option value="${cKey}">${menuData[cKey].name}</option>
    `).join('');

    // 2. Lista de categorías existentes con botón para eliminar
    const catList = document.getElementById('admin-categories-list');
    catList.innerHTML = Object.keys(menuData).map(cKey => {
        const cat = menuData[cKey];
        return `
            <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <div class="flex items-center space-x-2">
                    <i class="fa-solid ${cat.icon || 'fa-utensils'} text-[#2563eb]"></i>
                    <span class="font-bold text-slate-800">${cat.name}</span>
                    <span class="text-[10px] text-slate-400">(${cat.items.length} platos)</span>
                </div>
                <button onclick="deleteCategory('${cKey}')" class="text-rose-500 hover:text-rose-700 p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl hover:bg-rose-50 transition-colors" title="Eliminar Categoría">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        `;
    }).join('');

    // 3. Catálogo agrupado por categoría
    const menuItemsList = document.getElementById('admin-menu-items-list');
    let totalItems = 0;

    menuItemsList.innerHTML = Object.keys(menuData).map(cKey => {
        const cat = menuData[cKey];
        totalItems += cat.items.length;

        return `
            <div class="space-y-2">
                <h5 class="font-bold text-xs text-slate-700 flex items-center space-x-1.5 bg-slate-100 p-2 rounded-xl">
                    <i class="fa-solid ${cat.icon || 'fa-utensils'} text-[#2563eb]"></i>
                    <span>${cat.name} (${cat.items.length})</span>
                </h5>
                <div class="space-y-1.5 pl-1">
                    ${cat.items.map(item => `
                        <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 hover:bg-white border border-slate-200 text-xs">
                            <div class="flex-1 min-w-0 pr-2">
                                <h6 class="font-bold text-slate-800 truncate">${item.name}</h6>
                                ${item.desc ? `<p class="text-[11px] text-slate-400 truncate">${item.desc}</p>` : ''}
                            </div>
                            <div class="flex items-center space-x-3 shrink-0">
                                <span class="font-bold text-slate-900">$${item.price.toLocaleString()}</span>
                                <button onclick="deleteMenuItem('${cKey}', '${item.id}')" class="text-slate-400 hover:text-rose-600 p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl hover:bg-rose-50 transition-colors" title="Eliminar">
                                    <i class="fa-solid fa-trash-can text-xs"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('admin-total-products-badge').innerText = `${totalItems} ítems`;
}

async function createNewCategory() {
    const name = document.getElementById('new-cat-name').value.trim();
    const icon = document.getElementById('new-cat-icon').value;

    if (!name) {
        showToast('Ingresa el nombre de la categoría', 'warning');
        return;
    }

    const catKey = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    if (menuData[catKey]) {
        showToast('Ya existe una categoría con este nombre', 'warning');
        return;
    }

    menuData[catKey] = {
        id: catKey,
        name: name,
        icon: icon,
        items: []
    };

    saveLocalState();
    renderAdminMenuManager();
    renderCategoryTabs();
    document.getElementById('new-cat-name').value = "";

    try {
        const res = await fetch('/api/menu/category', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: catKey, name, icon })
        });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error guardando categoría en Neon DB:', e);
    }

    showToast(`Categoría "${name}" guardada en la base de datos`, 'success');
}

async function deleteCategory(catKey) {
    if (!menuData[catKey]) return;

    delete menuData[catKey];
    saveLocalState();
    renderAdminMenuManager();
    renderCategoryTabs();

    try {
        const res = await fetch(`/api/menu/category/${encodeURIComponent(catKey)}`, { method: 'DELETE' });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error eliminando categoría en Neon DB:', e);
    }

    showToast('Categoría eliminada de la base de datos', 'info');
}

async function addNewMenuItem() {
    const catKey = document.getElementById('new-item-cat').value;
    const name = document.getElementById('new-item-name').value.trim();
    const price = parseFloat(document.getElementById('new-item-price').value);
    const desc = document.getElementById('new-item-desc').value.trim();

    if (!catKey || !name || isNaN(price) || price <= 0) {
        showToast('Completa el nombre y un precio válido mayor a 0', 'warning');
        return;
    }

    const newItemId = `it_${Date.now().toString().slice(-6)}`;
    const newItem = {
        id: newItemId,
        name: name,
        price: price,
        desc: desc
    };

    if (menuData[catKey]) {
        if (!Array.isArray(menuData[catKey].items)) menuData[catKey].items = [];
        menuData[catKey].items.push(newItem);
    }

    saveLocalState();
    renderAdminMenuManager();
    renderMenuGrid();

    document.getElementById('new-item-name').value = "";
    document.getElementById('new-item-price').value = "";
    document.getElementById('new-item-desc').value = "";

    try {
        const res = await fetch('/api/menu/item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: newItemId, categoryId: catKey, name, price, desc })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
            if (data.itemId && data.itemId !== newItemId) {
                const item = menuData[catKey].items.find(i => i.id === newItemId);
                if (item) item.id = data.itemId;
                saveLocalState();
            }
        }
    } catch (e) {
        console.warn('Error guardando plato en Neon DB:', e);
    }

    showToast(`Plato "${name}" guardado en la base de datos`, 'success');
}

async function deleteMenuItem(catKey, itemId) {
    if (!menuData[catKey]) return;

    menuData[catKey].items = menuData[catKey].items.filter(i => i.id !== itemId);
    saveLocalState();
    renderAdminMenuManager();
    renderMenuGrid();

    try {
        const res = await fetch(`/api/menu/item/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error eliminando producto en Neon DB:', e);
    }

    showToast('Plato eliminado de la base de datos', 'info');
}

// ================= PESTAÑA 3: REPORTE DE LA NOCHE Y PDF =================

function renderNightReportView() {
    const nowStr = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('report-current-date').innerText = `Resumen: ${nowStr.charAt(0).toUpperCase() + nowStr.slice(1)}`;

    const totalSales = paymentHistory.reduce((acc, p) => acc + p.total, 0);
    const totalCash = paymentHistory.filter(p => p.method === 'Efectivo').reduce((acc, p) => acc + p.total, 0);
    const totalTransfer = paymentHistory.filter(p => p.method === 'Transferencia').reduce((acc, p) => acc + p.total, 0);
    const ordersCount = paymentHistory.length;
    const avgTicket = ordersCount > 0 ? Math.round(totalSales / ordersCount) : 0;

    // Conteo de mozos activos para la división de propinas
    const activeWaiters = staffList.filter(s => s.role.includes('Mozo'));
    const waiterCount = Math.max(1, activeWaiters.length);
    const tipPerWaiter = Math.round(generalTipsPool / waiterCount);

    document.getElementById('rep-kpi-total').innerText = `$${totalSales.toLocaleString()}`;
    document.getElementById('rep-kpi-orders').innerText = `${ordersCount} mesa${ordersCount === 1 ? '' : 's'} cobrada${ordersCount === 1 ? '' : 's'}`;
    document.getElementById('rep-kpi-cash').innerText = `$${totalCash.toLocaleString()}`;
    document.getElementById('rep-kpi-transfer').innerText = `$${totalTransfer.toLocaleString()}`;
    document.getElementById('rep-kpi-tips').innerText = `$${generalTipsPool.toLocaleString()}`;
    document.getElementById('rep-kpi-tip-split').innerText = `$${tipPerWaiter.toLocaleString()} por mozo (${waiterCount})`;
    document.getElementById('rep-kpi-avg').innerText = `$${avgTicket.toLocaleString()}`;

    // 1. Ranking de lo más vendido del día
    const productStats = {};
    paymentHistory.forEach(p => {
        if (Array.isArray(p.items)) {
            p.items.forEach(i => {
                if (!productStats[i.name]) {
                    productStats[i.name] = { qty: 0, revenue: 0 };
                }
                productStats[i.name].qty += i.qty;
                productStats[i.name].revenue += (i.qty * i.price);
            });
        }
    });

    const sortedProducts = Object.keys(productStats)
        .map(name => ({ name, ...productStats[name] }))
        .sort((a, b) => b.qty - a.qty);

    const maxQty = sortedProducts.length > 0 ? sortedProducts[0].qty : 1;
    const topList = document.getElementById('rep-top-products-list');

    if (sortedProducts.length === 0) {
        topList.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">Sin ventas registradas en el turno.</p>`;
    } else {
        topList.innerHTML = sortedProducts.map((p, idx) => {
            const pct = Math.round((p.qty / maxQty) * 100);
            return `
                <div class="space-y-1 text-xs">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-slate-800">
                            <span class="text-slate-400 font-semibold mr-1">${idx + 1}°.</span> ${p.name}
                        </span>
                        <div class="text-right">
                            <strong class="text-slate-900">${p.qty} u.</strong>
                            <span class="text-slate-400 text-[10px] ml-1">($${p.revenue.toLocaleString()})</span>
                        </div>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div class="bg-[#2563eb] h-1.5 rounded-full" style="width: ${pct}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 2. Rendimiento por Mozo
    const waiterStats = {};
    activeWaiters.forEach(w => {
        waiterStats[w.name] = { closed: 0, sales: 0, tips: 0 };
    });

    paymentHistory.forEach(p => {
        const wName = p.waiter || 'Otro';
        if (!waiterStats[wName]) {
            waiterStats[wName] = { closed: 0, sales: 0, tips: 0 };
        }
        waiterStats[wName].closed += 1;
        waiterStats[wName].sales += p.total;
        waiterStats[wName].tips += p.tip;
    });

    const waiterContainer = document.getElementById('rep-waiter-breakdown');
    waiterContainer.innerHTML = Object.keys(waiterStats).map(wName => {
        const ws = waiterStats[wName];
        return `
            <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex justify-between items-center">
                <div>
                    <h6 class="font-bold text-slate-900">${wName}</h6>
                    <span class="text-[11px] text-slate-400">${ws.closed} mesa${ws.closed === 1 ? '' : 's'} cerrada${ws.closed === 1 ? '' : 's'}</span>
                </div>
                <div class="text-right">
                    <strong class="text-slate-900 block">$${ws.sales.toLocaleString()}</strong>
                    <span class="text-[10px] text-[#2563eb] font-semibold">Propinas: $${ws.tips.toLocaleString()}</span>
                </div>
            </div>
        `;
    }).join('');

    // 3. Detalle completo de mesas cobradas
    document.getElementById('rep-tickets-badge').innerText = `${ordersCount} cobro${ordersCount === 1 ? '' : 's'}`;
    const paymentsTable = document.getElementById('rep-payments-table');

    if (ordersCount === 0) {
        paymentsTable.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">Todavía no hay mesas cobradas en este turno.</p>`;
    } else {
        paymentsTable.innerHTML = paymentHistory.map(p => {
            const isCash = p.method === 'Efectivo';
            const iconClass = isCash ? 'fa-money-bill-wave' : 'fa-building-columns';
            const badgeClass = isCash
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-indigo-50 text-indigo-700 border-indigo-200';
            const paidAmount = p.paidWith || p.total;

            return `
                <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs border-b border-slate-100 last:border-b-0">
                    <div class="space-y-1 min-w-0">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <strong class="text-slate-900 text-sm">${p.table}</strong>
                            <span class="text-[10px] px-2 py-0.5 rounded-full border font-bold flex items-center gap-1 ${badgeClass}">
                                <i class="fa-solid ${iconClass}"></i> ${p.method}
                            </span>
                            <span class="text-[10px] text-slate-400">${p.time}</span>
                            <span class="bg-blue-50 text-[#2563eb] border border-blue-200 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1">
                                <i class="fa-solid fa-user-check text-[9px]"></i> Cobró: ${p.waiter}
                            </span>
                        </div>
                        <p class="text-[11px] text-slate-500 break-words">${p.itemsSummary}</p>
                    </div>
                    <div class="flex sm:flex-col items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 shrink-0 text-right space-y-0.5">
                        <div class="text-xs">
                            <span class="text-slate-500 font-medium">Total:</span> <strong class="text-slate-900 text-sm">$${p.total.toLocaleString()}</strong>
                        </div>
                        <div class="text-[11px] space-x-2">
                            <span class="text-slate-600">Pagó: <strong class="text-slate-800">$${paidAmount.toLocaleString()}</strong></span>
                            <span class="text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full font-bold">
                                Propina: $${(p.tip || 0).toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 4. Historial de Cierres Nocturnos Guardados
    const archiveList = document.getElementById('saved-nights-archive-list');
    if (savedNightReports.length === 0) {
        archiveList.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Aún no se han archivado cierres nocturnos.</p>`;
    } else {
        archiveList.innerHTML = savedNightReports.map(r => `
            <div class="p-3 sm:p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-1.5">
                <div class="flex justify-between items-center">
                    <span class="font-bold text-slate-900 text-xs sm:text-sm truncate">${r.dateStr}</span>
                    <span class="bg-blue-50 text-[#2563eb] text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-200 shrink-0">${r.id}</span>
                </div>
                <div class="flex flex-wrap gap-2 sm:gap-4 text-slate-600">
                    <span>Facturado: <strong>$${r.totalSales.toLocaleString()}</strong></span>
                    <span>Efectivo: <strong>$${r.cashSales.toLocaleString()}</strong></span>
                    <span>Digital: <strong>$${r.transferSales.toLocaleString()}</strong></span>
                    <span>Propinas: <strong class="text-[#2563eb]">$${r.tipsPool.toLocaleString()}</strong></span>
                    <span>Mesas: <strong>${r.ordersCount}</strong></span>
                </div>
                ${r.note ? `<p class="text-[11px] text-slate-500 italic mt-1">>> "${r.note}"</p>` : ''}
            </div>
        `).join('');
    }
}

function downloadNightReportPDF() {
    const element = document.getElementById('pdf-report-container');
    const opt = {
        margin: [8, 8, 8, 8],
        filename: `Reporte_Turno_${new Date().toISOString().slice(0, 10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(element).save();
}

function copyNightReportText() {
    const totalSales = paymentHistory.reduce((acc, p) => acc + p.total, 0);
    const totalCash = paymentHistory.filter(p => p.method === 'Efectivo').reduce((acc, p) => acc + p.total, 0);
    const totalTransfer = paymentHistory.filter(p => p.method === 'Transferencia').reduce((acc, p) => acc + p.total, 0);
    const ordersCount = paymentHistory.length;
    const dateStr = new Date().toLocaleDateString('es-AR');

    let tablesBreakdown = paymentHistory.map(p => 
        `• ${p.table} (${p.method}): Cobró ${p.waiter} | Total: $${p.total.toLocaleString()} | Pagó: $${(p.paidWith || p.total).toLocaleString()} | Propina: $${(p.tip || 0).toLocaleString()}`
    ).join('\n');

    const text = `*CIERRE NOCTURNO - RIVERA POS*\n` +
        `Fecha: ${dateStr}\n\n` +
        `Facturación Total: $${totalSales.toLocaleString()}\n` +
        `Efectivo en Caja: $${totalCash.toLocaleString()}\n` +
        `Transferencias: $${totalTransfer.toLocaleString()}\n` +
        `Caja de Propinas: $${generalTipsPool.toLocaleString()}\n` +
        `Mesas Cobradas: ${ordersCount}\n\n` +
        `*RESUMEN DE COBRANZAS DE MESAS:*\n` +
        (tablesBreakdown || 'Sin cobranzas registradas') + '\n\n' +
        `_Generado automáticamente desde Rivera POS_`;

    navigator.clipboard.writeText(text).then(() => {
        showModal('Resumen Copiado', 'El texto fue copiado al portapapeles con el detalle de quién cobró cada mesa, total, lo pagado y propina, listo para enviar por WhatsApp.');
    }).catch(err => {
        console.error(err);
    });
}

function downloadNightReportCSV() {
    let csv = "ID,Mesa,Mozo que Cobro,Hora,Metodo,Total,Pago,Propina,Detalle\n";
    paymentHistory.forEach(p => {
        const cleanSummary = (p.itemsSummary || '').replace(/"/g, '""');
        csv += `"${p.id}","${p.table}","${p.waiter}","${p.time}","${p.method}",${p.total},${p.paidWith || p.total},${p.tip || 0},"${cleanSummary}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Ventas_Turno_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function openCloseNightModal() {
    const totalSales = paymentHistory.reduce((acc, p) => acc + p.total, 0);
    document.getElementById('close-modal-sales').innerText = `$${totalSales.toLocaleString()}`;
    document.getElementById('close-modal-tips').innerText = `$${generalTipsPool.toLocaleString()}`;
    document.getElementById('close-night-modal').classList.remove('hidden');
}

function closeNightModalCancel() {
    document.getElementById('close-night-modal').classList.add('hidden');
}

async function confirmNightClosure() {
    const totalSales = paymentHistory.reduce((acc, p) => acc + p.total, 0);
    const totalCash = paymentHistory.filter(p => p.method === 'Efectivo').reduce((acc, p) => acc + p.total, 0);
    const totalTransfer = paymentHistory.filter(p => p.method === 'Transferencia').reduce((acc, p) => acc + p.total, 0);
    const note = document.getElementById('close-night-note').value.trim();
    const shouldReset = document.getElementById('reset-after-close-checkbox').checked;

    const reportId = `CIERRE-${Date.now().toString().slice(-4)}`;
    const dateStr = `Hoy • ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} hs`;

    const newReport = {
        id: reportId,
        dateStr: dateStr,
        totalSales: totalSales,
        cashSales: totalCash,
        transferSales: totalTransfer,
        tipsPool: generalTipsPool,
        ordersCount: paymentHistory.length,
        note: note,
        resetShift: shouldReset
    };

    savedNightReports.unshift(newReport);

    if (shouldReset) {
        generalTipsPool = 0;
        paymentHistory = [];
        availableTables.forEach(t => {
            ordersByTable[t] = { items: [], note: "" };
        });
        kitchenOrders.forEach(o => {
            if (o.status !== 'paid') o.status = 'paid';
        });
    }

    saveLocalState();
    closeNightModalCancel();
    updateHeaderIndicators();
    renderNightReportView();

    try {
        const res = await fetch('/api/night-report/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newReport)
        });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error archivando cierre en Neon DB:', e);
    }

    showModal('Cierre de Turno Guardado', `El reporte ${reportId} fue archivado con éxito en la base de datos.`);
}

// ================= PESTAÑA 4: MOZOS / PERSONAL =================

function renderAdminStaffList() {
    const container = document.getElementById('admin-staff-list');
    document.getElementById('staff-count-badge').innerText = `${staffList.length} usuarios`;

    container.innerHTML = staffList.map(s => {
        const tablesClosed = paymentHistory.filter(p => p.waiter === s.name).length;
        const isMozo = s.role.includes('Mozo');

        return `
            <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <div class="flex items-center space-x-3 min-w-0">
                    <div class="w-9 h-9 rounded-xl bg-blue-50 text-[#2563eb] flex items-center justify-center font-bold border border-blue-200 shrink-0">
                        ${s.name.charAt(0)}
                    </div>
                    <div class="min-w-0">
                        <h5 class="font-bold text-slate-800 truncate">${s.name}</h5>
                        <span class="text-[11px] text-slate-400 block truncate">${s.role} • ${tablesClosed} mesas cobradas</span>
                    </div>
                </div>

                <div class="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                    <button onclick="toggleStaffRole('${s.id}')" class="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 font-semibold transition-all text-xs active:scale-95">
                        Cambiar a ${isMozo ? 'Cocina' : 'Mozo'}
                    </button>
                    <button onclick="removeStaffMember('${s.id}')" class="text-rose-500 hover:text-rose-700 p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl hover:bg-rose-50 transition-colors" title="Dar de baja">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function addNewStaffMember() {
    const name = document.getElementById('new-staff-name').value.trim();
    const role = document.getElementById('new-staff-role').value;

    if (!name) {
        showToast('Ingresa el nombre del personal', 'warning');
        return;
    }

    const newId = `user_${Date.now().toString().slice(-5)}`;
    staffList.push({ id: newId, name, role });

    saveLocalState();
    renderAdminStaffList();
    renderStaffLoginList();
    document.getElementById('new-staff-name').value = "";

    try {
        const res = await fetch('/api/staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: newId, name, role })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
            if (data.id && data.id !== newId) {
                const s = staffList.find(x => x.id === newId);
                if (s) s.id = data.id;
                saveLocalState();
            }
        }
    } catch (e) {
        console.warn('Error guardando personal en Neon DB:', e);
    }

    showToast(`Personal "${name}" (${role}) guardado en la base de datos`, 'success');
}

async function toggleStaffRole(staffId) {
    const s = staffList.find(x => x.id === staffId);
    if (!s) return;

    s.role = s.role.includes('Mozo') ? 'Cocina / Admin' : 'Mozo';

    saveLocalState();
    renderAdminStaffList();
    renderStaffLoginList();

    try {
        const res = await fetch(`/api/staff/${encodeURIComponent(staffId)}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: s.role })
        });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error cambiando rol en Neon DB:', e);
    }

    showToast(`Rol de "${s.name}" actualizado a ${s.role}`, 'info');
}

async function removeStaffMember(staffId) {
    if (staffId === 'admin_perello') {
        showToast('No puedes eliminar al Encargado principal', 'warning');
        return;
    }

    const s = staffList.find(x => x.id === staffId);
    const staffName = s ? s.name : 'Personal';

    staffList = staffList.filter(s => s.id !== staffId);

    saveLocalState();
    renderAdminStaffList();
    renderStaffLoginList();

    try {
        const res = await fetch(`/api/staff/${encodeURIComponent(staffId)}`, { method: 'DELETE' });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error eliminando personal en Neon DB:', e);
    }

    showToast(`"${staffName}" eliminado de la base de datos`, 'info');
}

// ================= MODAL GENÉRICO DE AVISOS (CERO ALERTS NATIVOS) =================

function showModal(title, message) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    document.getElementById('custom-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('custom-modal').classList.add('hidden');
}

// ================= SISTEMA DE TOASTS FLOTANTES NO BLOQUEANTES =================

function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-4 inset-x-0 flex flex-col items-center pointer-events-none z-50 space-y-2 px-4';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const bgClass = type === 'success'
        ? 'bg-slate-900/90 text-white border-emerald-500/40 shadow-emerald-950/20'
        : type === 'warning'
            ? 'bg-amber-600 text-white border-amber-400 shadow-amber-950/20'
            : type === 'error'
                ? 'bg-rose-600 text-white border-rose-400 shadow-rose-950/20'
                : 'bg-slate-900/90 text-white border-blue-500/40 shadow-blue-950/20';

    const iconClass = type === 'success'
        ? 'fa-circle-check text-emerald-400'
        : type === 'warning'
            ? 'fa-bell text-white'
            : type === 'error'
                ? 'fa-circle-exclamation text-white'
                : 'fa-circle-info text-blue-400';

    toast.className = `pointer-events-auto transform transition-all duration-300 ease-out translate-y-0 opacity-100 flex items-center space-x-2.5 px-4 py-2.5 rounded-2xl shadow-xl border backdrop-blur-md text-xs font-semibold max-w-sm ${bgClass}`;
    toast.innerHTML = `
        <i class="fa-solid ${iconClass} text-sm shrink-0"></i>
        <span class="truncate">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', '-translate-y-2');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, 1800);
}

// ================= MODAL DE CONFIRMACIÓN =================

let confirmCallback = null;

function showConfirmModal(title, message, onConfirm) {
    const titleElem = document.getElementById('confirm-modal-title');
    const msgElem = document.getElementById('confirm-modal-message');
    const modal = document.getElementById('confirm-modal');

    if (titleElem) titleElem.innerText = title;
    if (msgElem) msgElem.innerText = message;
    confirmCallback = onConfirm;
    if (modal) modal.classList.remove('hidden');
}

function closeConfirmModal(confirmed = false) {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
    if (confirmed && typeof confirmCallback === 'function') {
        confirmCallback();
    }
    confirmCallback = null;
}

// ================= GESTIÓN DINÁMICA DE MESAS =================

function openAddTableModal() {
    const modal = document.getElementById('add-table-modal');
    const input = document.getElementById('new-table-name-input');
    if (modal) {
        if (input) input.value = '';
        modal.classList.remove('hidden');
        setTimeout(() => { if (input) input.focus(); }, 100);
    }
}

function closeAddTableModal() {
    const modal = document.getElementById('add-table-modal');
    if (modal) modal.classList.add('hidden');
}

async function submitAddNewTable() {
    const input = document.getElementById('new-table-name-input');
    if (!input) return;
    const cleanName = input.value.trim();

    if (!cleanName) {
        showToast('Ingresa un nombre para la mesa', 'warning');
        return;
    }

    if (availableTables.some(t => t.toLowerCase() === cleanName.toLowerCase())) {
        showToast('Ya existe una mesa con ese nombre', 'warning');
        return;
    }

    availableTables.push(cleanName);
    ordersByTable[cleanName] = { items: [], note: "" };
    saveLocalState();
    closeAddTableModal();
    renderTablesGrid();
    showToast(`Mesa "${cleanName}" agregada al salón`, 'success');

    try {
        const res = await fetch('/api/tables/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableName: cleanName })
        });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error al guardar mesa en el servidor:', e);
    }
}

async function deleteTablePrompt(tableName) {
    const activeCmd = kitchenOrders.find(o => o.table === tableName && o.status !== 'paid');
    const tableOrder = ordersByTable[tableName];
    const hasItems = tableOrder && tableOrder.items && tableOrder.items.length > 0;

    if (activeCmd || hasItems) {
        showToast(`No puedes eliminar "${tableName}" porque tiene consumos activos`, 'error');
        return;
    }

    showConfirmModal(
        'Eliminar Mesa',
        `¿Seguro que deseas eliminar "${tableName}" del plano del salón?`,
        async () => {
            availableTables = availableTables.filter(t => t !== tableName);
            delete ordersByTable[tableName];
            saveLocalState();
            renderTablesGrid();
            showToast(`Mesa "${tableName}" eliminada`, 'info');

            try {
                const res = await fetch(`/api/tables/${encodeURIComponent(tableName)}`, {
                    method: 'DELETE'
                });
                if (res.ok) {
                    isOnlineWithServer = true;
                    setConnectionIndicator(true);
                }
            } catch (e) {
                console.warn('Error eliminando mesa en el servidor:', e);
            }
        }
    );
}
