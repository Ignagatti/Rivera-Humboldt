/**
 * Sarmiento POS - Lógica Completa de la Aplicación
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

let availableTables = (() => {
    const list = [];
    for (let i = 1; i <= 25; i++) {
        list.push(`Mesa ${i < 10 ? '0' + i : i}`);
    }
    list.push("Mesa Barra", "Para Llevar");
    return list;
})();
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

// Registro de pedidos ya notificados para no repetir sonido en polling continuo
let knownReadyOrderIds = new Set();

async function playWaiterNotificationSound() {
    // 1. Vibración táctil potente en el teléfono móvil del mozo
    try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([400, 150, 400, 150, 600]);
        }
    } catch (e) {
        console.warn('Vibración no soportada o bloqueada:', e);
    }

    // 2. Timbre acústico brillante de aviso de pedido listo
    try {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxClass) return;
        if (!globalAudioContext) {
            globalAudioContext = new AudioCtxClass();
        }
        if (globalAudioContext.state === 'suspended') {
            await globalAudioContext.resume().catch(() => {});
        }

        const ctx = globalAudioContext;
        const now = ctx.currentTime;

        // Tono 1 (880 Hz - Campanada metálica inicial brillante)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        osc1.frequency.exponentialRampToValueAtTime(860, now + 0.5);
        gain1.gain.setValueAtTime(0.7, now);
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
        gain2.gain.setValueAtTime(0.8, now + 0.15);
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
        gain3.gain.setValueAtTime(0.5, now + 0.18);
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

function sortTablesNaturally(tables) {
    if (!Array.isArray(tables)) return [];
    return [...tables].sort((a, b) => {
        const getPriority = (t) => {
            if (/^mesa\s*\d+/i.test(t)) return 1;
            if (/barra/i.test(t)) return 2;
            if (/llevar/i.test(t)) return 3;
            return 4;
        };
        const pA = getPriority(a);
        const pB = getPriority(b);
        if (pA !== pB) return pA - pB;

        const numA = parseInt((a.match(/\d+/) || [])[0], 10);
        const numB = parseInt((b.match(/\d+/) || [])[0], 10);
        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
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
            if (d.ticketConfig && typeof d.ticketConfig === 'object') {
                ticketConfig = { ...ticketConfig, ...d.ticketConfig };
                try { localStorage.setItem('rivera_ticket_config', JSON.stringify(ticketConfig)); } catch (_) {}
            }
            if (d.menuData && Object.keys(d.menuData).length > 0) menuData = d.menuData;
            if (Array.isArray(d.availableTables) && d.availableTables.length > 0) {
                availableTables = sortTablesNaturally(d.availableTables);
            }
            if (d.ordersByTable) ordersByTable = d.ordersByTable;
            if (Array.isArray(d.paymentHistory)) paymentHistory = d.paymentHistory;
            if (Array.isArray(d.savedNightReports)) savedNightReports = d.savedNightReports;

            // Sincronizar comandas de cocina y notificaciones estrictamente desde la base de datos
            if (Array.isArray(d.kitchenOrders)) {
                kitchenOrders = d.kitchenOrders;
                const currentReadyOrders = kitchenOrders.filter(o => o.status === 'ready');
                const newlyReadyOrders = currentReadyOrders.filter(o => !knownReadyOrderIds.has(o.id));

                waiterNotifications = currentReadyOrders.map(o => ({
                    id: o.id,
                    table: o.table,
                    time: o.time,
                    items: o.items,
                    waiterName: o.waiterName
                }));

                // Si se detecta un nuevo pedido listo para retirar (en amarillo)
                if (newlyReadyOrders.length > 0) {
                    newlyReadyOrders.forEach(o => knownReadyOrderIds.add(o.id));

                    const isKitchenScreen = !document.getElementById('admin-workspace').classList.contains('hidden') && activeAdminTab === 'kitchen';
                    if (!isKitchenScreen) {
                        playWaiterNotificationSound();
                        showToast(`¡${newlyReadyOrders[0].table} lista para retirar en Cocina!`, 'warning');
                    }
                }

                // Sincronizar mesas activas con sus comandas de cocina
                kitchenOrders.forEach(ko => {
                    if (ko.status !== 'paid' && ko.table) {
                        syncTableWithActiveKitchenOrder(ko.table);
                    }
                });
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
            if (msg.order && msg.order.table) {
                syncTableWithActiveKitchenOrder(msg.order.table);
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

                knownReadyOrderIds.add(msg.order.id);

                // El aviso acústico y la vibración suenan y vibran en el celular del mozo / salón
                // NUNCA en la pantalla fija de Cocina
                const isKitchenScreen = !document.getElementById('admin-workspace').classList.contains('hidden') && activeAdminTab === 'kitchen';

                if (!isKitchenScreen) {
                    playWaiterNotificationSound();
                    showToast(`¡${msg.order.table} lista para retirar en Cocina!`, 'warning');
                }
                updateWaiterNotificationUI();
            }

            saveLocalState();
            refreshActiveViews();
            break;

        case 'KITCHEN_ORDER_DELETED':
            kitchenOrders = kitchenOrders.filter(o => o.id !== msg.id);
            if (msg.table && ordersByTable[msg.table]) {
                ordersByTable[msg.table] = { items: [], note: "" };
            }
            waiterNotifications = waiterNotifications.filter(n => n.id !== msg.id);
            saveLocalState();
            refreshActiveViews();
            break;

        case 'TABLE_ADDED':
            if (msg.tableName && !availableTables.includes(msg.tableName)) {
                availableTables = sortTablesNaturally([...availableTables, msg.tableName]);
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
            ordersByTable[msg.tableName] = {
                items: msg.items || [],
                note: msg.note || ''
            };
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
            if (pOrder) {
                pOrder.printed = true;
                if (Array.isArray(msg.items)) {
                    pOrder.items = msg.items;
                } else if (Array.isArray(pOrder.items)) {
                    pOrder.items.forEach(it => it.printed = true);
                }
            }
            saveLocalState();
            if (activeAdminTab === 'kitchen') renderKitchenOrders();
            break;

        case 'TICKET_CONFIG_UPDATED':
            if (msg.ticketConfig && typeof msg.ticketConfig === 'object') {
                ticketConfig = { ...ticketConfig, ...msg.ticketConfig };
                try { localStorage.setItem('rivera_ticket_config', JSON.stringify(ticketConfig)); } catch (_) {}
            }
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

// ================= SINCRONIZACIÓN Y CONSOLIDACIÓN TOTAL DE COMANDAS =================

function syncTableWithActiveKitchenOrder(tableName) {
    if (!tableName) return;
    const activeCmd = kitchenOrders.find(o => o.table === tableName && o.status !== 'paid');
    if (!ordersByTable[tableName]) {
        ordersByTable[tableName] = { items: [], note: "" };
    }
    const tableOrder = ordersByTable[tableName];

    if (!activeCmd || !Array.isArray(activeCmd.items) || activeCmd.items.length === 0) {
        return;
    }

    if (!Array.isArray(tableOrder.items)) {
        tableOrder.items = [];
    }

    // Si la mesa no tiene ítems locales, hidratar directamente desde la comanda de cocina
    if (tableOrder.items.length === 0) {
        tableOrder.items = activeCmd.items.map(it => ({
            id: it.id || `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            menuItemId: it.menuItemId || it.id,
            name: it.name,
            price: Number(it.price) || 0,
            qty: Number(it.qty) || 1,
            sentQty: Number(it.qty) || 1,
            note: it.note || '',
            isPizzaLibre: Boolean(it.isPizzaLibre),
            libreRound: it.libreRound || null
        }));
        if (!tableOrder.note && activeCmd.note) {
            tableOrder.note = activeCmd.note;
        }
        return;
    }

    // Si la mesa YA tiene ítems, sumar por nombre + precio en activeCmd
    const kitchenTotals = new Map();
    activeCmd.items.forEach(it => {
        const key = `${(it.name || '').trim().toLowerCase()}___${Number(it.price) || 0}`;
        const current = kitchenTotals.get(key) || { qty: 0, sample: it };
        current.qty += Number(it.qty) || 1;
        kitchenTotals.set(key, current);
    });

    const seenKeys = new Set();
    tableOrder.items.forEach(it => {
        const key = `${(it.name || '').trim().toLowerCase()}___${Number(it.price) || 0}`;
        seenKeys.add(key);
        if (kitchenTotals.has(key)) {
            const kData = kitchenTotals.get(key);
            it.sentQty = Math.max(Number(it.sentQty) || 0, kData.qty);
            if (it.qty < it.sentQty) {
                it.qty = it.sentQty;
            }
        }
    });

    // Agregar platos que están en cocina pero que faltaban en el borrador local de la mesa
    kitchenTotals.forEach((kData, key) => {
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            const it = kData.sample;
            tableOrder.items.push({
                id: it.id || `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                menuItemId: it.menuItemId || it.id,
                name: it.name,
                price: Number(it.price) || 0,
                qty: kData.qty,
                sentQty: kData.qty,
                note: it.note || '',
                isPizzaLibre: Boolean(it.isPizzaLibre),
                libreRound: it.libreRound || null
            });
        }
    });

    if (!tableOrder.note && activeCmd.note) {
        tableOrder.note = activeCmd.note;
    }
}

function getTableConsolidatedOrder(tableName) {
    const table = tableName || currentTable;
    const tableOrder = ordersByTable[table] || { items: [], note: "" };
    const activeCmd = kitchenOrders.find(o => o.table === table && o.status !== 'paid');

    const consolidatedMap = new Map();

    // 1. Agregar todos los ítems de la comanda activa de cocina como base confiable
    if (activeCmd && Array.isArray(activeCmd.items)) {
        activeCmd.items.forEach(it => {
            const cleanName = stripBracketNotes(it.name || '').trim();
            const key = `${cleanName.toLowerCase()}___${Number(it.price) || 0}`;
            if (consolidatedMap.has(key)) {
                consolidatedMap.get(key).qty += Number(it.qty) || 1;
                consolidatedMap.get(key).sentQty += Number(it.qty) || 1;
                if (it.note && !consolidatedMap.get(key).note) {
                    consolidatedMap.get(key).note = it.note;
                }
            } else {
                consolidatedMap.set(key, {
                    id: it.id || `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    menuItemId: it.menuItemId || it.id,
                    name: cleanName,
                    price: Number(it.price) || 0,
                    qty: Number(it.qty) || 1,
                    sentQty: Number(it.qty) || 1,
                    note: it.note || '',
                    isPizzaLibre: Boolean(it.isPizzaLibre),
                    libreRound: it.libreRound || null
                });
            }
        });
    }

    // 2. Sumar ítems de tableOrder (si no hay cocina, se suman todos; si hay cocina, solo la diferencia pendiente)
    if (Array.isArray(tableOrder.items)) {
        tableOrder.items.forEach(it => {
            const sent = Number(it.sentQty) || 0;
            const unsent = Math.max(0, (Number(it.qty) || 0) - sent);
            const cleanName = stripBracketNotes(it.name || '').trim();
            const key = `${cleanName.toLowerCase()}___${Number(it.price) || 0}`;

            if (!activeCmd) {
                if (consolidatedMap.has(key)) {
                    consolidatedMap.get(key).qty += Number(it.qty) || 1;
                } else {
                    consolidatedMap.set(key, {
                        ...it,
                        name: cleanName,
                        price: Number(it.price) || 0,
                        qty: Number(it.qty) || 1
                    });
                }
            } else if (unsent > 0) {
                if (consolidatedMap.has(key)) {
                    consolidatedMap.get(key).qty += unsent;
                } else {
                    consolidatedMap.set(key, {
                        ...it,
                        name: cleanName,
                        price: Number(it.price) || 0,
                        qty: unsent,
                        sentQty: 0
                    });
                }
            }
        });
    }

    const items = Array.from(consolidatedMap.values());
    const total = items.reduce((acc, i) => acc + (Number(i.price) * Number(i.qty)), 0);
    const waiterName = (activeCmd && activeCmd.waiterName)
        ? activeCmd.waiterName
        : ((tableOrder && tableOrder.waiterName) ? tableOrder.waiterName : (currentUser ? currentUser.name : 'Mozo'));

    return {
        items,
        total,
        waiterName,
        note: (activeCmd && activeCmd.note) || tableOrder.note || '',
        activeCmd
    };
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

        const consolidated = getTableConsolidatedOrder(tName);
        const total = consolidated.total;
        const itemsCount = consolidated.items.reduce((acc, i) => acc + (Number(i.qty) || 0), 0);

        // Detectar si la mesa tiene platos pendientes de enviar a cocina
        const unsentCount = Array.isArray(tableOrder.items)
            ? tableOrder.items.reduce((acc, i) => acc + Math.max(0, (Number(i.qty) || 0) - (Number(i.sentQty) || 0)), 0)
            : 0;
        const hasUnsentItems = unsentCount > 0;

        if (activeCmd) {
            if (activeCmd.status === 'ready') {
                statusText = "¡LISTO PARA ENTREGAR!";
                statusBadge = "bg-amber-500 text-white border-amber-600 font-extrabold shadow-sm";
                borderClass = "border-2 border-amber-500 bg-amber-50/80 shadow-lg shadow-amber-500/20 ring-4 ring-amber-400/40 animate-pulse";
                dotColor = "bg-amber-500 animate-ping";
                isReadyInKitchen = true;
            } else if (hasUnsentItems) {
                statusText = "Comanda sin enviar";
                statusBadge = "bg-amber-100 text-amber-900 border-amber-300 font-bold";
                borderClass = "border-amber-400 bg-amber-50/30 hover:border-amber-500";
                dotColor = "bg-amber-500";
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
        } else if (total > 0) {
            if (hasUnsentItems) {
                statusText = "Comanda sin enviar";
                statusBadge = "bg-amber-100 text-amber-900 border-amber-300 font-bold";
                borderClass = "border-amber-400 bg-amber-50/30 hover:border-amber-500";
                dotColor = "bg-amber-500";
            } else {
                statusText = "Ocupada";
                statusBadge = "bg-slate-100 text-slate-700 border-slate-200 font-semibold";
                borderClass = "border-blue-200 bg-white";
                dotColor = "bg-blue-400";
            }
        }

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
                        <button onclick="openPaymentByTable('${tName}')" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs transition-all shadow-sm flex items-center justify-center space-x-1.5 cursor-pointer">
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

    // Sincronizar mesa con los ítems ya confirmados en comanda de cocina
    syncTableWithActiveKitchenOrder(tableName);

    // Cargar nota actual
    const tableOrder = ordersByTable[tableName] || { items: [], note: "" };
    document.getElementById('order-note').value = tableOrder.note || "";

    document.getElementById('waiter-tables-view').classList.add('hidden');
    document.getElementById('waiter-order-view').classList.remove('hidden');
    setMobileDrawerState(false);

    searchQuery = "";
    showFullMenuOverride = false;
    document.getElementById('menu-search-input').value = "";
    document.getElementById('clear-search-btn').classList.add('hidden');

    renderCategoryTabs();
    renderMenuGrid();
    renderOrderList();
    updateAdminNavButtons();
}

function backToTablesView() {
    const tableOrder = ordersByTable[currentTable];
    if (tableOrder && tableOrder.items) {
        const unsent = tableOrder.items.reduce((acc, i) => acc + Math.max(0, i.qty - (i.sentQty || 0)), 0);
        if (unsent > 0) {
            showToast(`Atención: ${currentTable} tiene ${unsent} plato(s) sin enviar a cocina`, 'warning');
        }
    }
    document.getElementById('waiter-order-view').classList.add('hidden');
    document.getElementById('waiter-tables-view').classList.remove('hidden');
    setMobileDrawerState(false);
    renderTablesGrid();
    updateAdminNavButtons();
}

// ================= MENÚ DEL DÍA Y DISPONIBILIDAD POR DÍA DE LA SEMANA =================

const WEEK_DAYS_ORDERED = [
    { id: 1, short: 'L', label: 'Lun' },
    { id: 2, short: 'M', label: 'Mar' },
    { id: 3, short: 'X', label: 'Mié' },
    { id: 4, short: 'J', label: 'Jue' },
    { id: 5, short: 'V', label: 'Vie' },
    { id: 6, short: 'S', label: 'Sáb' },
    { id: 0, short: 'D', label: 'Dom' }
];
let showFullMenuOverride = false;
let expandedAdminItemDaysId = null;

function getTodayDayIndex() {
    return new Date().getDay(); // 0=Dom .. 6=Sáb
}

function getTodayDayName() {
    const today = getTodayDayIndex();
    const found = WEEK_DAYS_ORDERED.find(d => d.id === today);
    return found ? found.label : '';
}

function getCategoryDays(cat) {
    if (!cat) return [0, 1, 2, 3, 4, 5, 6];
    return Array.isArray(cat.availableDays) ? cat.availableDays.map(Number) : [0, 1, 2, 3, 4, 5, 6];
}

function isCategoryAvailableToday(cat) {
    if (!cat) return false;
    if (cat.isActive === false) return false;
    return getCategoryDays(cat).includes(getTodayDayIndex());
}

function isItemAvailableToday(item, cat) {
    if (!item) return false;
    if (item.isAvailable === false) return false;
    if (Array.isArray(item.availableDays)) {
        return item.availableDays.map(Number).includes(getTodayDayIndex());
    }
    return isCategoryAvailableToday(cat);
}

function formatDaysSummary(daysArray) {
    if (!Array.isArray(daysArray) || daysArray.length === 0) return 'Ningún día';
    if (daysArray.length >= 7) return 'Todos los días';
    return WEEK_DAYS_ORDERED.filter(d => daysArray.includes(d.id)).map(d => d.label).join(', ');
}

function hasOffDayMenuContent() {
    for (const cKey of Object.keys(menuData)) {
        const cat = menuData[cKey];
        if (!isCategoryAvailableToday(cat)) return true;
        if (Array.isArray(cat.items) && cat.items.some(it => !isItemAvailableToday(it, cat))) return true;
    }
    return false;
}

function toggleShowFullMenu() {
    showFullMenuOverride = !showFullMenuOverride;
    renderCategoryTabs();
    renderMenuGrid();
}

// ================= VISTA B: TOMA DE PEDIDO DENTRO DE LA MESA =================

function renderCategoryTabs() {
    const container = document.getElementById('category-tabs');
    if (!container) return;

    const allCats = Object.keys(menuData);
    const todayCats = allCats.filter(cKey => isCategoryAvailableToday(menuData[cKey]));
    const visibleCats = (showFullMenuOverride || todayCats.length === 0) ? allCats : todayCats;

    if (!visibleCats.includes(activeCategory) && visibleCats.length > 0) {
        activeCategory = visibleCats[0];
    }

    const tabsHtml = visibleCats.map(cKey => {
        const cat = menuData[cKey];
        const isActive = activeCategory === cKey;
        const isOffToday = !isCategoryAvailableToday(cat);
        const btnClass = isActive
            ? 'bg-[#2563eb] text-white shadow-md shadow-blue-500/20'
            : (isOffToday
                ? 'bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-300 border-dashed'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200');

        return `
            <button onclick="selectCategory('${cKey}')" class="px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shrink-0 cursor-pointer ${btnClass}">
                <i class="fa-solid ${cat.icon || 'fa-utensils'} text-xs"></i>
                <span>${cat.name}</span>
                ${isOffToday ? `<span class="text-[9px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-amber-200/80 text-amber-950'} font-extrabold">Fuera de hoy</span>` : ''}
            </button>
        `;
    }).join('');

    const showToggleBtn = hasOffDayMenuContent() || showFullMenuOverride;
    const toggleBtnHtml = showToggleBtn ? `
        <button type="button" onclick="toggleShowFullMenu()"
            class="px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shrink-0 cursor-pointer ${showFullMenuOverride ? 'bg-slate-800 text-white hover:bg-slate-900' : 'bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-300'}">
            <i class="fa-solid ${showFullMenuOverride ? 'fa-calendar-day' : 'fa-layer-group'} text-[11px]"></i>
            <span>${showFullMenuOverride ? `Solo hoy (${getTodayDayName()})` : 'Ver toda la carta'}</span>
        </button>
    ` : '';

    container.innerHTML = tabsHtml + toggleBtnHtml;
}

function selectCategory(catKey) {
    activeCategory = catKey;
    activeSubcategory = 'all';
    renderCategoryTabs();
    renderMenuGrid();
}

// ================= SUBCATEGORÍAS (BEBIDAS POR TIPO) Y COBRO POR PERSONA (PARRILLA) =================

let activeSubcategory = 'all';
let activePerPersonModalItem = null;
let perPersonModalCount = 1;

function inferBeverageSubcategory(item) {
    const text = `${item && item.name ? item.name : ''} ${item && item.desc ? item.desc : ''}`.toLowerCase();
    if (/agua|soda|villavicencio|eco de los andes|glaciar|ivess|saborizada|aquarius|levite|levité|h2oh|ser\b/.test(text)) {
        return 'Aguas y Saborizadas';
    }
    if (/coca|sprite|fanta|pepsi|7up|seven|paso de los toros|tonica|tónica|pomelo|gaseosa|schweppes|mirinda|manaos|pritty|jugo|cepita|limonada|exprimido|monster|red bull|speed/.test(text)) {
        return 'Gaseosas y Jugos';
    }
    if (/cerveza|liso|pilsen|santa fe|pinta|ipa|apa|stout|honey|golden|quilmes|patagonia|corona|heineken|stella|brahma|andes|imperial|lata|laton|latón|porron|porrón|chopp|schneider|budweiser|amstel|miller|kunstmann|grolsch|warsteiner/.test(text)) {
        return 'Cervezas';
    }
    if (/vino|champan|champán|champagne|espumante|sidra|santa julia|navarro correa|dada|dadá|malbec|cabernet|merlot|syrah|tintillo|blanco|rosado|chandon|rutini|trumpeter|luigi bosca|alamos|cosecha|jarra de vino|copa de vino|torrontes|torrontés|alma mora|portillo|valentin|valentín|salentein/.test(text)) {
        return 'Vinos y Espumantes';
    }
    if (/fernet|campari|gin|gancia|vermut|aperol|cynar|trago|whisky|vodka|ron|caipirinha|mojito|negroni|daikiri|aperitivo|baileys|tequila/.test(text)) {
        return 'Tragos y Aperitivos';
    }
    return 'Otras Bebidas';
}

function getEffectiveItemSubcategory(item, catKey) {
    if (!item) return '';
    if (item.subcategory && String(item.subcategory).trim()) {
        return String(item.subcategory).trim();
    }
    const cat = menuData[catKey];
    const catName = (cat && cat.name) ? cat.name.toLowerCase() : String(catKey || '').toLowerCase();
    if (catKey === 'bebidas' || catName.includes('bebida') || catName.includes('trago') || catName.includes('cerveza')) {
        return inferBeverageSubcategory(item);
    }
    return '';
}

function isPerPersonMenuItem(item, catKey) {
    if (!item) return false;
    if (item.id === 'pz_libre' || String(item.name || '').toLowerCase().includes('pizza libre')) return false;
    if (typeof item.perPerson === 'boolean') return item.perPerson;
    const nameLower = String(item.name || '').toLowerCase();
    const descLower = String(item.desc || '').toLowerCase();
    const cat = menuData[catKey];
    const catLower = (cat && cat.name) ? cat.name.toLowerCase() : String(catKey || '').toLowerCase();
    if (descLower.includes('por persona') || nameLower.includes('por persona') || nameLower.includes('parrilla')) {
        return true;
    }
    if (catLower.includes('parrilla') && (nameLower.includes('parrilla') || nameLower.includes('libre') || nameLower.includes('completa') || nameLower.includes('asado'))) {
        return true;
    }
    return false;
}

function selectSubcategory(subName) {
    activeSubcategory = subName || 'all';
    renderMenuGrid();
}

function fillSubcatInput(inputId, value) {
    const el = document.getElementById(inputId);
    if (el) el.value = value;
}

function openPerPersonItemModal(itemId) {
    const loc = findMenuItemLocation(itemId);
    const item = loc ? loc.item : findMenuItemById(itemId);
    if (!item) return;

    activePerPersonModalItem = {
        item,
        catKey: loc ? loc.catKey : activeCategory
    };
    perPersonModalCount = 1;

    const titleEl = document.getElementById('per-person-modal-title');
    const subEl = document.getElementById('per-person-modal-subtitle');
    const noteEl = document.getElementById('per-person-modal-note');
    if (titleEl) titleEl.innerText = item.name;
    if (subEl) subEl.innerText = `${Number(item.price).toLocaleString()} por persona`;
    if (noteEl) noteEl.value = '';

    updatePerPersonModalDisplay();
    const modal = document.getElementById('per-person-item-modal');
    if (modal) modal.classList.remove('hidden');
}

function closePerPersonItemModal() {
    const modal = document.getElementById('per-person-item-modal');
    if (modal) modal.classList.add('hidden');
    activePerPersonModalItem = null;
}

function changePerPersonModalCount(delta) {
    let next = (perPersonModalCount || 1) + delta;
    if (next < 1) next = 1;
    perPersonModalCount = next;
    updatePerPersonModalDisplay();
}

function updatePerPersonModalDisplay() {
    const price = (activePerPersonModalItem && activePerPersonModalItem.item)
        ? Number(activePerPersonModalItem.item.price) || 0
        : 0;
    const count = perPersonModalCount || 1;
    const total = price * count;
    const countEl = document.getElementById('per-person-modal-count');
    const totalEl = document.getElementById('per-person-modal-total');
    if (countEl) countEl.innerText = count;
    if (totalEl) totalEl.innerText = `${total.toLocaleString()}`;
}

function confirmAddPerPersonItem() {
    if (!activePerPersonModalItem || !activePerPersonModalItem.item) return;
    const { item, catKey } = activePerPersonModalItem;
    const persons = perPersonModalCount || 1;
    const noteEl = document.getElementById('per-person-modal-note');
    const noteText = noteEl ? noteEl.value.trim() : '';

    if (!ordersByTable[currentTable]) {
        ordersByTable[currentTable] = { items: [], note: "" };
    }

    const tableItems = ordersByTable[currentTable].items;
    const subcat = getEffectiveItemSubcategory(item, catKey);

    tableItems.push({
        id: `${item.id}_p_${Date.now().toString().slice(-5)}`,
        menuItemId: item.id,
        categoryId: catKey,
        subcategory: subcat,
        baseName: item.name,
        name: `${item.name} (${persons} persona${persons === 1 ? '' : 's'})`,
        price: Number(item.price),
        qty: persons,
        sentQty: 0,
        perPerson: true,
        personsCount: persons,
        note: noteText
    });

    closePerPersonItemModal();
    saveCurrentTableState();
    renderOrderList();
    renderMenuGrid();
    showToast(`${item.name} (${persons} persona${persons === 1 ? '' : 's'}) agregado a ${currentTable}`, 'success');
}

async function toggleItemPerPerson(catKey, itemId) {
    if (!menuData[catKey] || !Array.isArray(menuData[catKey].items)) return;
    const item = menuData[catKey].items.find(i => i.id === itemId);
    if (!item) return;

    const currentVal = isPerPersonMenuItem(item, catKey);
    item.perPerson = !currentVal;

    saveLocalState();
    renderAdminMenuManager();
    renderMenuGrid();

    try {
        const res = await fetch('/api/menu/item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: item.id,
                categoryId: catKey,
                name: item.name,
                price: item.price,
                desc: item.desc || '',
                subcategory: item.subcategory || '',
                perPerson: item.perPerson
            })
        });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error actualizando modo por persona en Neon DB:', e);
    }

    showToast(`"${item.name}": ${item.perPerson ? 'cobro por cantidad de personas activado' : 'cobro por unidad estándar'}`, 'info');
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
const COMMON_EXCLUSION_FLAVORS = [
    'Cebolla',
    'Anchoas',
    'Roquefort',
    'Rúcula',
    'Provenzal (Ajo)',
    'Calabresa',
    'Margarita',
    'Especial (Jamón)',
    'Napolitana (Tomate)',
    '3 Quesos'
];
let selectedExclusionChips = [];
let selectedRoundFlavors = [];

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

// ================= PIZZA LIBRE: DETECCIÓN DE ESTADO Y RONDAS =================

function getActivePizzaLibre(tableName) {
    const tableOrder = ordersByTable[tableName];
    const tableItems = (tableOrder && Array.isArray(tableOrder.items)) ? tableOrder.items : [];

    // Recopilar ítems de Pizza Libre en el borrador de la mesa
    const libreItems = tableItems.filter(i =>
        i.isPizzaLibre ||
        (i.id && String(i.id).startsWith('pz_libre')) ||
        (i.name && String(i.name).toLowerCase().includes('pizza libre'))
    );

    // Recopilar también en las comandas activas de cocina para esta mesa
    const activeKitchenCmds = kitchenOrders.filter(o => o.table === tableName && o.status !== 'paid');
    activeKitchenCmds.forEach(cmd => {
        if (Array.isArray(cmd.items)) {
            cmd.items.forEach(ki => {
                if (ki.isPizzaLibre || (ki.name && String(ki.name).toLowerCase().includes('pizza libre'))) {
                    libreItems.push(ki);
                }
            });
        }
    });

    if (libreItems.length === 0) {
        return { active: false, persons: 0, currentRound: 0, nextRound: 1, exclusions: '' };
    }

    let persons = 1;
    let exclusions = '';
    let maxRound = 1;

    for (const it of libreItems) {
        if (it.librePersons && it.librePersons > 0) {
            persons = it.librePersons;
        } else if (it.qty && it.qty > 1 && (!it.libreRound || it.libreRound === 1)) {
            persons = it.qty;
        }

        if (it.libreExclusions && !exclusions) {
            exclusions = it.libreExclusions;
        } else if (it.note && !exclusions && it.note.includes('NO QUIEREN:')) {
            const match = it.note.match(/NO QUIEREN:\s*([^|\]]+)/i);
            if (match) exclusions = match[1].trim();
        }

        if (it.libreRound && it.libreRound > maxRound) {
            maxRound = it.libreRound;
        } else if (it.name) {
            const m = it.name.match(/(\d+)(?:ra|da|ta|ma)\s*Ronda/i);
            if (m) {
                const rNum = parseInt(m[1], 10);
                if (rNum > maxRound) maxRound = rNum;
            }
        }
    }

    return {
        active: true,
        persons: persons,
        currentRound: maxRound,
        nextRound: maxRound + 1,
        exclusions: exclusions
    };
}

function renderPizzaLibreBanner() {
    const bannerElem = document.getElementById('pizza-libre-active-banner');
    if (!bannerElem) return;

    const libre = getActivePizzaLibre(currentTable);
    if (!libre.active) {
        bannerElem.classList.add('hidden');
        bannerElem.innerHTML = '';
        return;
    }

    bannerElem.classList.remove('hidden');
    bannerElem.innerHTML = `
        <div class="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-sm">
            <div class="flex items-center space-x-3 min-w-0">
                <div class="w-10 h-10 rounded-xl bg-[#2563eb] text-white flex flex-col items-center justify-center font-bold shrink-0 shadow-sm">
                    <span class="text-[8px] uppercase tracking-wider text-blue-200 leading-none">Ronda</span>
                    <span class="text-base font-black leading-none mt-0.5">${libre.currentRound}</span>
                </div>
                <div class="min-w-0">
                    <div class="flex items-center space-x-2">
                        <span class="font-bold text-xs sm:text-sm text-blue-950">Pizza Libre Activa (${libre.persons} persona${libre.persons === 1 ? '' : 's'})</span>
                        <span class="text-[10px] bg-blue-100 text-[#2563eb] font-bold px-2 py-0.5 rounded-full border border-blue-200">Ronda ${libre.currentRound}</span>
                    </div>
                    ${libre.exclusions ? `
                        <p class="text-[11px] text-slate-700 truncate mt-0.5">
                            <span class="font-bold text-rose-600">No quieren:</span> ${libre.exclusions}
                        </p>
                    ` : `
                        <p class="text-[10px] text-slate-400 mt-0.5">Sin exclusiones indicadas</p>
                    `}
                </div>
            </div>
            <button type="button" onclick="openNextRoundModal()"
                class="bg-[#2563eb] hover:bg-blue-600 active:scale-95 text-white font-bold px-3.5 py-2.5 rounded-xl text-xs flex items-center justify-center space-x-2 shadow-md shadow-blue-500/20 transition-all shrink-0 cursor-pointer">
                <i class="fa-solid fa-arrows-rotate text-xs"></i>
                <span>Pedir ${libre.nextRound}da Ronda ($0)</span>
            </button>
        </div>
    `;
}

// Modal de Pizza Libre (1ra Ronda: cantidad de personas y gustos que NO quieren)
function openPizzaLibreModal() {
    pizzaLibreCount = 1;
    selectedExclusionChips = [];

    const textInput = document.getElementById('pizza-libre-exclusions-text');
    if (textInput) textInput.value = '';

    const chipsContainer = document.getElementById('pizza-libre-exclusion-chips');
    if (chipsContainer) {
        chipsContainer.innerHTML = COMMON_EXCLUSION_FLAVORS.map(flavor => `
            <button type="button" onclick="toggleExclusionChip('${flavor}')" id="excl-chip-${flavor.replace(/[^a-zA-Z0-9]/g, '')}"
                class="px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all cursor-pointer">
                <span>Sin ${flavor}</span>
            </button>
        `).join('');
    }

    updatePizzaLibreModalDisplay();
    document.getElementById('pizza-libre-modal').classList.remove('hidden');
}

function closePizzaLibreModal() {
    document.getElementById('pizza-libre-modal').classList.add('hidden');
}

function toggleExclusionChip(flavor) {
    const idx = selectedExclusionChips.indexOf(flavor);
    const chipId = `excl-chip-${flavor.replace(/[^a-zA-Z0-9]/g, '')}`;
    const btn = document.getElementById(chipId);

    if (idx >= 0) {
        selectedExclusionChips.splice(idx, 1);
        if (btn) {
            btn.className = "px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all cursor-pointer";
        }
    } else {
        selectedExclusionChips.push(flavor);
        if (btn) {
            btn.className = "px-2.5 py-1 rounded-xl text-[11px] font-bold bg-rose-500 text-white border border-rose-600 shadow-sm transition-all cursor-pointer";
        }
    }

    const textInput = document.getElementById('pizza-libre-exclusions-text');
    if (textInput) {
        textInput.value = selectedExclusionChips.map(f => `Sin ${f}`).join(', ');
    }
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
    const textInput = document.getElementById('pizza-libre-exclusions-text');
    const exclusionsText = textInput ? textInput.value.trim() : '';

    if (!ordersByTable[currentTable]) {
        ordersByTable[currentTable] = { items: [], note: "" };
    }

    const tableItems = ordersByTable[currentTable].items;
    let noteText = '';
    if (exclusionsText) {
        noteText = `NO QUIEREN: ${exclusionsText}`;
    }

    tableItems.push({
        id: `pz_libre_${Date.now().toString().slice(-6)}`,
        name: `Pizza libre (1ra Ronda - ${persons} persona${persons === 1 ? '' : 's'})`,
        price: unitPrice,
        qty: persons,
        sentQty: 0,
        isPizza: true,
        isPizzaLibre: true,
        libreRound: 1,
        librePersons: persons,
        libreExclusions: exclusionsText,
        note: noteText
    });

    closePizzaLibreModal();
    saveCurrentTableState();
    renderOrderList();
    renderMenuGrid();

    showToast(`Pizza libre (1ra Ronda - ${persons} personas) agregada a ${currentTable}`, 'success');
}

// Modal de Siguiente Ronda (2da Ronda, 3ra Ronda...) a $0
function openNextRoundModal() {
    const libre = getActivePizzaLibre(currentTable);
    if (!libre.active) {
        openPizzaLibreModal();
        return;
    }

    selectedRoundFlavors = [];
    const nextRound = libre.nextRound;

    const modalTitle = document.getElementById('next-round-modal-title');
    const modalSubtitle = document.getElementById('next-round-modal-subtitle');
    const exclInput = document.getElementById('next-round-exclusions-input');
    const notesInput = document.getElementById('next-round-notes');

    if (modalTitle) modalTitle.innerText = `Pedir ${nextRound}da Ronda`;
    if (modalSubtitle) modalSubtitle.innerText = `${currentTable} - ${libre.persons} personas (Ronda ${nextRound})`;
    if (exclInput) exclInput.value = libre.exclusions || '';
    if (notesInput) notesInput.value = '';

    const chipsContainer = document.getElementById('next-round-flavor-chips');
    if (chipsContainer) {
        const flavors = getPizzaFlavorsCatalog().filter(p => p.id !== 'pz_libre' && !p.name.toLowerCase().includes('pizza libre'));
        chipsContainer.innerHTML = flavors.map(p => `
            <button type="button" onclick="toggleRoundFlavorChip('${p.name}')" id="round-chip-${p.id}"
                class="px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all cursor-pointer">
                <span>${p.name}</span>
            </button>
        `).join('');
    }

    document.getElementById('pizza-libre-next-round-modal').classList.remove('hidden');
}

function closeNextRoundModal() {
    document.getElementById('pizza-libre-next-round-modal').classList.add('hidden');
}

function toggleRoundFlavorChip(flavorName) {
    const idx = selectedRoundFlavors.indexOf(flavorName);
    const flavors = getPizzaFlavorsCatalog();
    const item = flavors.find(p => p.name === flavorName);
    const chipId = item ? `round-chip-${item.id}` : null;
    const btn = chipId ? document.getElementById(chipId) : null;

    if (idx >= 0) {
        selectedRoundFlavors.splice(idx, 1);
        if (btn) {
            btn.className = "px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all cursor-pointer";
        }
    } else {
        selectedRoundFlavors.push(flavorName);
        if (btn) {
            btn.className = "px-2.5 py-1 rounded-xl text-[11px] font-bold bg-[#2563eb] text-white border border-blue-600 shadow-sm transition-all cursor-pointer";
        }
    }

    const notesInput = document.getElementById('next-round-notes');
    if (notesInput) {
        notesInput.value = selectedRoundFlavors.join(', ');
    }
}

function confirmAddNextRound() {
    const libre = getActivePizzaLibre(currentTable);
    const nextRound = libre.nextRound;

    const exclInput = document.getElementById('next-round-exclusions-input');
    const notesInput = document.getElementById('next-round-notes');
    const updatedExclusions = exclInput ? exclInput.value.trim() : (libre.exclusions || '');
    const roundNotes = notesInput ? notesInput.value.trim() : '';

    if (!ordersByTable[currentTable]) {
        ordersByTable[currentTable] = { items: [], note: "" };
    }

    const tableItems = ordersByTable[currentTable].items;

    let fullNote = `Ronda ${nextRound}`;
    if (roundNotes) {
        fullNote += ` | Gustos: ${roundNotes}`;
    }
    if (updatedExclusions) {
        fullNote += ` | NO QUIEREN: ${updatedExclusions}`;
    }

    tableItems.push({
        id: `pz_libre_r${nextRound}_${Date.now().toString().slice(-6)}`,
        name: `Pizza libre (${nextRound}da Ronda)`,
        price: 0,
        qty: 1,
        sentQty: 0,
        isPizza: true,
        isPizzaLibre: true,
        libreRound: nextRound,
        librePersons: libre.persons,
        libreExclusions: updatedExclusions,
        note: fullNote
    });

    closeNextRoundModal();
    saveCurrentTableState();
    renderOrderList();
    renderMenuGrid();

    showToast(`${nextRound}da Ronda de Pizza Libre agregada ($0) lista para marchar a cocina`, 'success');
}

// Interacción al hacer clic en un gusto de pizza según el modo activo
function onPizzaItemClicked(itemId) {
    const item = findMenuItemById(itemId);
    if (!item) return;

    // Si es Pizza Libre, abre modal según si ya está activa la mesa o es la primera ronda
    if (item.id === 'pz_libre' || item.name.toLowerCase().includes('pizza libre')) {
        const libre = getActivePizzaLibre(currentTable);
        if (libre.active) {
            openNextRoundModal();
        } else {
            openPizzaLibreModal();
        }
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

    // MODO 2: Dos gustos (marcas 2 pizzas y se agrega en formato Gusto1 / Gusto2)
    if (pizzaSelectionMode === 2) {
        if (selectedPizzaFlavors.length === 0) {
            selectedPizzaFlavors.push(item);
            renderMenuGrid();
            showToast(`Gusto 1: ${item.name}. Ahora marca el segundo gusto`, 'info');
        } else if (selectedPizzaFlavors.length === 1) {
            const f1 = selectedPizzaFlavors[0];
            const f2 = item;
            const avgPrice = Math.round((f1.price + f2.price) / 2);
            const pizzaTitle = `Pizza: ${f1.name} / ${f2.name}`;

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

    // MODO 3: Tres gustos (precio fijo de $20.000 en formato Gusto1 / Gusto2 / Gusto3)
    if (pizzaSelectionMode === 3) {
        if (selectedPizzaFlavors.length === 0) {
            selectedPizzaFlavors.push(item);
            renderMenuGrid();
            showToast(`Gusto 1: ${item.name}. Marca el segundo gusto`, 'info');
        } else if (selectedPizzaFlavors.length === 1) {
            selectedPizzaFlavors.push(item);
            renderMenuGrid();
            showToast(`Gusto 1: ${selectedPizzaFlavors[0].name} / Gusto 2: ${item.name}. Marca el tercer gusto`, 'info');
        } else if (selectedPizzaFlavors.length === 2) {
            const f1 = selectedPizzaFlavors[0];
            const f2 = selectedPizzaFlavors[1];
            const f3 = item;
            const pizzaTitle = `Pizza: ${f1.name} / ${f2.name} / ${f3.name}`;
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

    renderPizzaLibreBanner();

    let itemsToDisplay = [];
    const isPizzasView = activeCategory === 'pizzas' && searchQuery.length === 0;

    if (searchQuery.length > 0) {
        // El buscador SIEMPRE busca en TODA la carta (incluyendo platos de otros días como excepción)
        Object.keys(menuData).forEach(catKey => {
            const cat = menuData[catKey];
            (cat.items || []).forEach(item => {
                const matchName = item.name.toLowerCase().includes(searchQuery);
                const matchDesc = item.desc && item.desc.toLowerCase().includes(searchQuery);
                const matchCat = cat.name && cat.name.toLowerCase().includes(searchQuery);
                if (matchName || matchDesc || matchCat) {
                    itemsToDisplay.push({
                        ...item,
                        categoryKey: catKey,
                        categoryName: cat.name,
                        isOffToday: !isItemAvailableToday(item, cat)
                    });
                }
            });
        });
        // Mostrar primero los platos de hoy, y debajo los que están "Fuera de hoy"
        itemsToDisplay.sort((a, b) => Number(a.isOffToday) - Number(b.isOffToday));
    } else {
        const cat = menuData[activeCategory];
        if (cat && Array.isArray(cat.items) && cat.items.length > 0) {
            const mapped = cat.items.map(item => ({
                ...item,
                categoryKey: activeCategory,
                categoryName: cat.name,
                isOffToday: !isItemAvailableToday(item, cat)
            }));
            itemsToDisplay = showFullMenuOverride
                ? mapped
                : mapped.filter(it => !it.isOffToday);
        } else if (activeCategory === 'pizzas') {
            itemsToDisplay = OFFICIAL_PIZZAS.map(item => ({
                ...item,
                categoryKey: 'pizzas',
                categoryName: 'Pizzas',
                isOffToday: false
            }));
        }

        // En la categoría de pizzas, 'Pizza libre' siempre se ubica primera en la grilla
        if (activeCategory === 'pizzas') {
            itemsToDisplay.sort((a, b) => {
                const aLibre = a.id === 'pz_libre' || a.name.toLowerCase().includes('pizza libre');
                const bLibre = b.id === 'pz_libre' || b.name.toLowerCase().includes('pizza libre');
                if (aLibre && !bLibre) return -1;
                if (!aLibre && bLibre) return 1;
                return 0;
            });
        }
    }

    // Barra de Subcategorías (ej. Bebidas: Cervezas, Gaseosas y Jugos, Aguas, Vinos, Tragos)
    const subcatBar = document.getElementById('subcategory-filter-bar');
    if (subcatBar) {
        if (searchQuery.length === 0 && !isPizzasView && itemsToDisplay.length > 0) {
            const subcatCounts = {};
            itemsToDisplay.forEach(it => {
                const sub = getEffectiveItemSubcategory(it, it.categoryKey || activeCategory);
                it._effectiveSubcat = sub;
                if (sub) {
                    subcatCounts[sub] = (subcatCounts[sub] || 0) + 1;
                }
            });
            const subcatKeys = Object.keys(subcatCounts);
            if (subcatKeys.length > 0) {
                if (activeSubcategory !== 'all' && !subcatCounts[activeSubcategory]) {
                    activeSubcategory = 'all';
                }
                subcatBar.classList.remove('hidden');
                const allActive = activeSubcategory === 'all';
                const allBtn = `
                    <button type="button" onclick="selectSubcategory('all')"
                        class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${allActive ? 'bg-slate-900 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}">
                        Todas (${itemsToDisplay.length})
                    </button>
                `;
                const pills = subcatKeys.map(sc => {
                    const isAct = activeSubcategory === sc;
                    return `
                        <button type="button" onclick="selectSubcategory('${sc.replace(/'/g, "\\'") }')"
                            class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${isAct ? 'bg-[#2563eb] text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}">
                            ${escapeHtmlSafe(sc)} (${subcatCounts[sc]})
                        </button>
                    `;
                }).join('');
                subcatBar.innerHTML = `<div class="flex items-center gap-1.5 overflow-x-auto pb-1">${allBtn}${pills}</div>`;
                if (activeSubcategory !== 'all') {
                    itemsToDisplay = itemsToDisplay.filter(it => it._effectiveSubcat === activeSubcategory);
                }
            } else {
                subcatBar.classList.add('hidden');
                subcatBar.innerHTML = '';
            }
        } else {
            subcatBar.classList.add('hidden');
            subcatBar.innerHTML = '';
        }
    }

    if (itemsToDisplay.length === 0) {
        const modesBarEmpty = document.getElementById('pizza-modes-bar');
        if (modesBarEmpty) modesBarEmpty.classList.add('hidden');
        container.innerHTML = searchQuery.length > 0 ? `
            <div class="col-span-full text-center py-12 text-slate-400 space-y-2">
                <i class="fa-solid fa-magnifying-glass text-2xl"></i>
                <p class="text-xs">No se encontraron productos para "${searchQuery}".</p>
            </div>
        ` : `
            <div class="col-span-full text-center py-12 text-slate-400 space-y-3">
                <i class="fa-solid fa-calendar-day text-2xl"></i>
                <p class="text-xs">No hay platos habilitados hoy (${getTodayDayName()}) en esta categoría.</p>
                ${!showFullMenuOverride ? `
                    <button type="button" onclick="toggleShowFullMenu()"
                        class="bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold px-3.5 py-2 rounded-xl text-xs transition-all cursor-pointer">
                        Ver toda la carta igualmente
                    </button>
                ` : ''}
            </div>
        `;
        return;
    }

    const currentItems = (ordersByTable[currentTable] && ordersByTable[currentTable].items) || [];

    // Barra de Modos de Pizza (1 Gusto, 2 Gustos, 3 Gustos) situada FUERA de menu-grid
    const modesBar = document.getElementById('pizza-modes-bar');
    if (modesBar) {
        if (isPizzasView) {
            modesBar.classList.remove('hidden');
            let statusBarHtml = '';
            if (pizzaSelectionMode === 2) {
                if (selectedPizzaFlavors.length === 0) {
                    statusBarHtml = `
                        <div class="mt-2 py-1.5 px-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-center justify-between">
                            <span>Modo 2 Gustos: selecciona el <strong>primer gusto</strong>...</span>
                        </div>
                    `;
                } else if (selectedPizzaFlavors.length === 1) {
                    statusBarHtml = `
                        <div class="mt-2 py-1.5 px-3 bg-blue-100 border border-blue-300 rounded-xl text-xs text-blue-950 flex items-center justify-between font-medium">
                            <span>Gusto 1: <strong>${selectedPizzaFlavors[0].name}</strong>. Marca el segundo gusto.</span>
                            <button type="button" onclick="cancelPizzaSelection()" class="text-rose-600 text-xs font-bold hover:underline cursor-pointer">Cancelar</button>
                        </div>
                    `;
                }
            } else if (pizzaSelectionMode === 3) {
                if (selectedPizzaFlavors.length === 0) {
                    statusBarHtml = `
                        <div class="mt-2 py-1.5 px-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 flex items-center justify-between">
                            <span>Modo 3 Gustos ($20.000 fijo): selecciona el <strong>primer gusto</strong>...</span>
                        </div>
                    `;
                } else if (selectedPizzaFlavors.length === 1) {
                    statusBarHtml = `
                        <div class="mt-2 py-1.5 px-3 bg-indigo-100 border border-indigo-300 rounded-xl text-xs text-indigo-950 flex items-center justify-between font-medium">
                            <span>Gusto 1: <strong>${selectedPizzaFlavors[0].name}</strong>. Marca el segundo gusto...</span>
                            <button type="button" onclick="cancelPizzaSelection()" class="text-rose-600 text-xs font-bold hover:underline cursor-pointer">Cancelar</button>
                        </div>
                    `;
                } else if (selectedPizzaFlavors.length === 2) {
                    statusBarHtml = `
                        <div class="mt-2 py-1.5 px-3 bg-indigo-100 border border-indigo-300 rounded-xl text-xs text-indigo-950 flex items-center justify-between font-medium">
                            <span>${selectedPizzaFlavors[0].name} / ${selectedPizzaFlavors[1].name}. Marca el 3er gusto para agregar ($20.000).</span>
                            <button type="button" onclick="cancelPizzaSelection()" class="text-rose-600 text-xs font-bold hover:underline cursor-pointer">Cancelar</button>
                        </div>
                    `;
                }
            }

            modesBar.innerHTML = `
                <div class="bg-white border border-slate-200 rounded-2xl p-1.5 shadow-sm">
                    <div class="grid grid-cols-3 gap-1.5">
                        <button type="button" onclick="setPizzaSelectionMode(1)"
                            class="py-2 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${pizzaSelectionMode === 1 ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}">
                            <span>1 Gusto</span>
                            <span class="text-[10px] font-normal ${pizzaSelectionMode === 1 ? 'text-blue-100' : 'text-slate-400'}">Entera</span>
                        </button>
                        <button type="button" onclick="setPizzaSelectionMode(2)"
                            class="py-2 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${pizzaSelectionMode === 2 ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}">
                            <span>2 Gustos</span>
                            <span class="text-[10px] font-normal ${pizzaSelectionMode === 2 ? 'text-blue-100' : 'text-slate-400'}">Mitad y mitad</span>
                        </button>
                        <button type="button" onclick="setPizzaSelectionMode(3)"
                            class="py-2 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${pizzaSelectionMode === 3 ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}">
                            <span>3 Gustos</span>
                            <span class="text-[10px] font-normal ${pizzaSelectionMode === 3 ? 'text-blue-100' : 'text-slate-400'}">$20.000 fijo</span>
                        </button>
                    </div>
                    ${statusBarHtml}
                </div>
            `;
        } else {
            modesBar.classList.add('hidden');
            modesBar.innerHTML = '';
        }
    }

    const cardsHtml = itemsToDisplay.map(item => {
        const isPizza = item.categoryKey === 'pizzas' || (item.categoryName && item.categoryName.toLowerCase().includes('pizza'));
        const isPizzaLibre = item.id === 'pz_libre' || item.name.toLowerCase().includes('pizza libre');
        const isPerPerson = !isPizza && isPerPersonMenuItem(item, item.categoryKey || activeCategory);
        const effSubcat = item._effectiveSubcat || getEffectiveItemSubcategory(item, item.categoryKey || activeCategory);
        const orderMatches = currentItems.filter(i => i.id === item.id || i.menuItemId === item.id);
        const qty = orderMatches.reduce((acc, i) => acc + (Number(i.qty) || 0), 0);

        const isSelectedFlavor = selectedPizzaFlavors.some(f => f.id === item.id);
        let cardBorderClass = "border-slate-200 hover:border-blue-400";
        if (item.isOffToday) {
            cardBorderClass = "border-amber-300 border-dashed bg-amber-50/20 hover:border-amber-500";
        }
        if (isSelectedFlavor) {
            cardBorderClass = "border-2 border-[#2563eb] bg-blue-50/40 shadow-sm";
        }

        let actionButton = '';
        if (isPizzaLibre) {
            const libre = getActivePizzaLibre(currentTable);
            if (libre.active) {
                actionButton = `
                    <button type="button" onclick="openNextRoundModal()" class="bg-[#2563eb] hover:bg-blue-600 active:scale-95 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1 cursor-pointer">
                        <i class="fa-solid fa-arrows-rotate text-[10px]"></i>
                        <span>Ronda ${libre.nextRound} ($0)</span>
                    </button>
                `;
            } else {
                actionButton = `
                    <button type="button" onclick="openPizzaLibreModal()" class="bg-[#2563eb] hover:bg-blue-600 active:scale-95 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1 cursor-pointer">
                        <i class="fa-solid fa-users text-[10px]"></i>
                        <span>Elegir</span>
                    </button>
                `;
            }
        } else if (isPizza) {
            if (pizzaSelectionMode === 1) {
                actionButton = `
                    <button type="button" onclick="onPizzaItemClicked('${item.id}')" class="bg-[#2563eb] hover:bg-blue-600 active:scale-95 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1 cursor-pointer">
                        <i class="fa-solid fa-plus text-[10px]"></i>
                        <span>Agregar</span>
                    </button>
                `;
            } else if (pizzaSelectionMode === 2) {
                actionButton = `
                    <button type="button" onclick="onPizzaItemClicked('${item.id}')" class="${isSelectedFlavor ? 'bg-blue-700 text-white' : 'bg-[#2563eb] hover:bg-blue-600 text-white'} active:scale-95 font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1 cursor-pointer">
                        <i class="fa-solid ${isSelectedFlavor ? 'fa-check' : 'fa-plus'} text-[10px]"></i>
                        <span>${isSelectedFlavor ? 'Gusto 1' : 'Elegir'}</span>
                    </button>
                `;
            } else if (pizzaSelectionMode === 3) {
                const idx = selectedPizzaFlavors.findIndex(f => f.id === item.id);
                const label = isSelectedFlavor ? `Gusto ${idx + 1}` : 'Elegir';
                actionButton = `
                    <button type="button" onclick="onPizzaItemClicked('${item.id}')" class="${isSelectedFlavor ? 'bg-indigo-700 text-white' : 'bg-[#2563eb] hover:bg-blue-600 text-white'} active:scale-95 font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1 cursor-pointer">
                        <i class="fa-solid ${isSelectedFlavor ? 'fa-check' : 'fa-plus'} text-[10px]"></i>
                        <span>${label}</span>
                    </button>
                `;
            }
        } else if (isPerPerson) {
            actionButton = `
                <button type="button" onclick="openPerPersonItemModal('${item.id}')" class="bg-[#2563eb] hover:bg-blue-600 active:scale-95 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1 cursor-pointer">
                    <i class="fa-solid fa-users text-[10px]"></i>
                    <span>Personas</span>
                </button>
            `;
        } else {
            actionButton = `
                <button type="button" onclick="addToOrder('${item.id}')" class="bg-[#2563eb] hover:bg-blue-600 active:scale-95 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition-all shadow-sm flex items-center space-x-1 cursor-pointer">
                    <i class="fa-solid fa-plus text-[10px]"></i>
                    <span>Agregar</span>
                </button>
            `;
        }

        return `
            <div onclick="${isPizza ? `onPizzaItemClicked('${item.id}')` : `addToOrder('${item.id}')`}" class="bg-white border ${cardBorderClass} rounded-2xl p-3.5 shadow-sm transition-all flex flex-col justify-between min-h-[128px] cursor-pointer group">
                <div>
                    <div class="flex items-start justify-between gap-1">
                        <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <h4 class="font-bold text-sm text-slate-800 leading-snug truncate">${item.name}</h4>
                            ${isPizzaLibre ? '<span class="bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase tracking-wider shrink-0">Libre</span>' : ''}
                            ${isPerPerson ? '<span class="bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase tracking-wider shrink-0">Por persona</span>' : ''}
                            ${effSubcat ? `<span class="bg-slate-100 text-slate-600 border border-slate-200 text-[9px] font-bold px-1.5 py-0.2 rounded-full shrink-0">${escapeHtmlSafe(effSubcat)}</span>` : ''}
                        </div>
                        <span class="font-bold text-sm text-[#2563eb] shrink-0 ml-1">${item.price.toLocaleString()}${(isPizzaLibre || isPerPerson) ? '<span class="text-[9px] font-normal text-slate-400">/pers</span>' : ''}</span>
                    </div>
                    <p class="text-[11px] text-slate-500 line-clamp-2 mt-1 leading-tight min-h-[26px]">${item.desc || ''}</p>
                </div>

                <div class="flex items-center justify-between pt-2 border-t border-slate-50" onclick="event.stopPropagation()">
                    ${qty > 0 ? `
                        <span class="bg-blue-50 text-[#2563eb] border border-blue-200 text-xs px-2.5 py-0.5 rounded-full font-bold">
                            ${qty} en comanda
                        </span>
                    ` : (item.isOffToday ? `
                        <span class="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] px-2 py-0.5 rounded-full font-bold">
                            Fuera de hoy
                        </span>
                    ` : `
                        <span class="text-[10px] text-slate-400">Disponible</span>
                    `)}

                    ${actionButton}
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = cardsHtml;
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

    const loc = findMenuItemLocation(itemId);
    const catKey = loc ? loc.catKey : (item.categoryKey || activeCategory);

    // Si es pizza, derivar a la lógica de selección de pizza
    const isPizza = catKey === 'pizzas' || (menuData.pizzas && menuData.pizzas.items.some(i => i.id === itemId));
    if (isPizza) {
        onPizzaItemClicked(itemId);
        return;
    }

    // Si está configurado por cantidad de personas (ej. Parrilla), abrir selector de comensales
    if (isPerPersonMenuItem(item, catKey)) {
        openPerPersonItemModal(itemId);
        return;
    }

    if (!ordersByTable[currentTable]) {
        ordersByTable[currentTable] = { items: [], note: "" };
    }

    const tableItems = ordersByTable[currentTable].items;
    const existing = tableItems.find(i =>
        i.id === itemId ||
        i.menuItemId === itemId ||
        (i.name && item.name && i.name.trim().toLowerCase() === item.name.trim().toLowerCase() && Number(i.price) === Number(item.price))
    );

    if (existing) {
        existing.qty += 1;
    } else {
        tableItems.push({
            id: item.id,
            menuItemId: item.id,
            categoryId: catKey,
            subcategory: getEffectiveItemSubcategory(item, catKey),
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

async function updateQuantity(itemId, delta) {
    if (!ordersByTable[currentTable]) return;
    const tableItems = ordersByTable[currentTable].items;
    const itemIndex = tableItems.findIndex(i => i.id === itemId);
    if (itemIndex < 0) return;

    const item = tableItems[itemIndex];

    if (delta < 0) {
        const sent = Number(item.sentQty) || 0;
        const currentQty = Number(item.qty) || 1;
        const isReducingSentItem = currentQty <= sent;

        if (isReducingSentItem && sent > 0) {
            const confirmed = confirm(`¿Deseas descontar 1x "${item.name}" de la comanda de cocina y de la cuenta de ${currentTable}?`);
            if (!confirmed) return;

            // Descontar de la comanda activa de cocina si existe
            const activeCmd = kitchenOrders.find(o => o.table === currentTable && o.status !== 'paid');
            if (activeCmd) {
                try {
                    await fetch(`/api/orders/${activeCmd.id}/remove-item`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            itemId: item.id,
                            name: item.name,
                            price: item.price,
                            qty: 1
                        })
                    });
                } catch (e) {
                    console.warn('Error al descontar ítem de comanda en backend:', e);
                }

                // Ajustar comanda activa local
                const kIdx = (activeCmd.items || []).findIndex(it =>
                    it.id === item.id ||
                    (it.name || '').trim().toLowerCase() === (item.name || '').trim().toLowerCase()
                );
                if (kIdx >= 0) {
                    const kIt = activeCmd.items[kIdx];
                    if (kIt.qty > 1) {
                        kIt.qty -= 1;
                    } else {
                        activeCmd.items.splice(kIdx, 1);
                    }
                    activeCmd.total = activeCmd.items.reduce((acc, i) => acc + (Number(i.price) * Number(i.qty)), 0);
                    if (activeCmd.items.length === 0) {
                        kitchenOrders = kitchenOrders.filter(o => o.id !== activeCmd.id);
                    }
                }
            }

            item.sentQty = Math.max(0, sent - 1);
            showToast(`1x ${item.name} descontado de la comanda y de la cuenta`, 'info');
        }
    }

    item.qty += delta;

    if (item.qty <= 0) {
        tableItems.splice(itemIndex, 1);
    } else if (item.sentQty && item.qty < item.sentQty) {
        item.sentQty = item.qty;
    }

    saveCurrentTableState();
    renderOrderList();
    renderMenuGrid();
    renderTablesGrid();
}

async function promptDeleteItemFromTable(itemId) {
    if (!ordersByTable[currentTable]) return;
    const tableItems = ordersByTable[currentTable].items;
    const itemIndex = tableItems.findIndex(i => i.id === itemId);
    if (itemIndex < 0) return;

    const item = tableItems[itemIndex];
    const sent = Number(item.sentQty) || 0;
    const currentQty = Number(item.qty) || 1;

    const confirmed = confirm(`¿Estás seguro de eliminar completamente "${item.name}" (${currentQty}x) de la cuenta de ${currentTable}?`);
    if (!confirmed) return;

    if (sent > 0) {
        const activeCmd = kitchenOrders.find(o => o.table === currentTable && o.status !== 'paid');
        if (activeCmd) {
            try {
                await fetch(`/api/orders/${activeCmd.id}/remove-item`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        itemId: item.id,
                        name: item.name,
                        price: item.price,
                        qty: currentQty
                    })
                });
            } catch (e) {
                console.warn('Error al eliminar ítem de comanda en backend:', e);
            }

            activeCmd.items = (activeCmd.items || []).filter(it =>
                it.id !== item.id &&
                (it.name || '').trim().toLowerCase() !== (item.name || '').trim().toLowerCase()
            );
            activeCmd.total = activeCmd.items.reduce((acc, i) => acc + (Number(i.price) * Number(i.qty)), 0);
            if (activeCmd.items.length === 0) {
                kitchenOrders = kitchenOrders.filter(o => o.id !== activeCmd.id);
            }
        }
    }

    tableItems.splice(itemIndex, 1);
    saveCurrentTableState();
    renderOrderList();
    renderMenuGrid();
    renderTablesGrid();
    showToast(`"${item.name}" eliminado de la mesa`, 'info');
}

async function cancelCurrentTableOrderPrompt() {
    const table = currentTable;
    if (!table) return;

    const consolidated = getTableConsolidatedOrder(table);
    if (!consolidated || (consolidated.total === 0 && (!consolidated.items || consolidated.items.length === 0))) {
        showToast(`La ${table} no tiene pedidos cargados`, 'info');
        return;
    }

    const confirmed = confirm(`¿Estás seguro de anular todo el pedido de ${table}? Se cancelará la comanda de cocina y la mesa quedará liberada.`);
    if (!confirmed) return;

    try {
        await fetch(`/api/tables/${encodeURIComponent(table)}/cancel-order`, {
            method: 'POST'
        });
    } catch (e) {
        console.warn('Error al anular pedido en servidor:', e);
    }

    ordersByTable[table] = { items: [], note: "" };
    kitchenOrders = kitchenOrders.filter(o => o.table !== table || o.status === 'paid');

    saveLocalState();
    backToTablesView();
    showToast(`Pedido de ${table} anulado. Mesa liberada.`, 'success');
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
    isDrawerOpen = !!open;
    const content = document.getElementById('order-drawer-content');
    const chevron = document.getElementById('drawer-chevron');
    const backdrop = document.getElementById('order-drawer-backdrop');

    if (open) {
        if (content) content.classList.remove('hidden');
        if (chevron) chevron.classList.add('rotate-180');
        if (backdrop) backdrop.classList.remove('hidden');
    } else {
        if (content) content.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
        if (backdrop) backdrop.classList.add('hidden');
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
    const ticketBtn = document.getElementById('ticket-table-btn');
    const alertBanner = document.getElementById('table-unsent-alert-banner');

    const consolidated = getTableConsolidatedOrder(currentTable);
    const totalQty = consolidated.items.reduce((acc, i) => acc + (Number(i.qty) || 0), 0);
    const totalPrice = consolidated.total;
    const newItemsCount = items.reduce((acc, i) => acc + Math.max(0, (Number(i.qty) || 0) - (Number(i.sentQty) || 0)), 0);

    if (itemCountBadge) itemCountBadge.innerText = `${totalQty} ítem${totalQty === 1 ? '' : 's'}`;
    if (drawerTitleMobile) drawerTitleMobile.innerText = `Ver Comanda (${totalQty} ítem${totalQty === 1 ? '' : 's'})`;
    if (drawerTotalPreview) drawerTotalPreview.innerText = `$${totalPrice.toLocaleString()}`;
    if (totalPriceElem) totalPriceElem.innerText = `$${totalPrice.toLocaleString()}`;

    // Cartelito de alerta: Comanda sin enviar
    if (alertBanner) {
        if (newItemsCount > 0) {
            alertBanner.className = "p-3 bg-amber-50 border-2 border-amber-500 rounded-2xl flex items-center justify-between gap-2 text-amber-900 shadow-sm animate-pulse mb-3";
            alertBanner.innerHTML = `
                <div class="flex items-center space-x-2">
                    <span class="w-3 h-3 rounded-full bg-amber-500 animate-ping shrink-0"></span>
                    <div>
                        <p class="font-black text-xs uppercase tracking-wide text-amber-900">[ALERTA] COMANDA SIN ENVIAR</p>
                        <p class="text-[11px] text-amber-800">Tienes <strong>${newItemsCount}</strong> plato${newItemsCount === 1 ? '' : 's'} pendiente${newItemsCount === 1 ? '' : 's'} de enviar a cocina.</p>
                    </div>
                </div>
                <button onclick="sendOrderToKitchen()" class="bg-amber-500 hover:bg-amber-600 text-white font-black px-3.5 py-2 rounded-xl text-xs shadow-md transition-all shrink-0 cursor-pointer flex items-center space-x-1.5 active:scale-95">
                    <i class="fa-solid fa-paper-plane"></i>
                    <span>Enviar Ya</span>
                </button>
            `;
        } else {
            alertBanner.className = "hidden";
            alertBanner.innerHTML = "";
        }
    }

    if (items.length === 0 && totalQty === 0) {
        container.innerHTML = `
            <div class="text-center py-6 text-slate-400 space-y-1">
                <i class="fa-solid fa-receipt text-xl"></i>
                <p class="text-xs">No hay productos agregados en ${currentTable}</p>
            </div>
        `;
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.className = "w-full bg-slate-100 text-slate-400 font-bold py-2.5 px-2 rounded-xl text-xs flex items-center justify-center space-x-1.5 cursor-not-allowed";
            sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i><span>Enviar</span>';
        }
        if (payBtn) payBtn.disabled = true;
        if (ticketBtn) ticketBtn.disabled = true;
        return;
    }

    if (payBtn) payBtn.disabled = false;
    if (ticketBtn) ticketBtn.disabled = false;

    if (sendBtn) {
        if (newItemsCount > 0) {
            sendBtn.disabled = false;
            sendBtn.className = "w-full bg-amber-500 hover:bg-amber-600 text-white font-black py-2.5 px-2 rounded-xl text-xs transition-all shadow-md shadow-amber-500/25 flex items-center justify-center space-x-1.5 cursor-pointer ring-2 ring-amber-400 ring-offset-1 animate-pulse active:scale-95";
            sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i><span>Enviar (${newItemsCount})</span>`;
        } else {
            sendBtn.disabled = true;
            sendBtn.className = "w-full bg-slate-100 text-slate-400 font-bold py-2.5 px-2 rounded-xl text-xs flex items-center justify-center space-x-1.5 cursor-not-allowed";
            sendBtn.innerHTML = '<i class="fa-solid fa-check-double text-emerald-500"></i><span>Enviado</span>';
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

                <div class="flex items-center space-x-1 bg-slate-50 border border-slate-200 rounded-xl p-1 shrink-0">
                    <button onclick="updateQuantity('${item.id}', -1)" class="w-6 h-6 rounded-lg bg-white text-slate-700 hover:bg-slate-100 flex items-center justify-center font-bold shadow-sm transition-all cursor-pointer" title="Restar 1 unidad">
                        <i class="fa-solid fa-minus text-[9px]"></i>
                    </button>
                    <span class="font-bold w-5 text-center text-slate-800 text-xs">${item.qty}</span>
                    <button onclick="updateQuantity('${item.id}', 1)" class="w-6 h-6 rounded-lg bg-white text-[#2563eb] hover:bg-blue-50 flex items-center justify-center font-bold shadow-sm transition-all cursor-pointer" title="Sumar 1 unidad">
                        <i class="fa-solid fa-plus text-[9px]"></i>
                    </button>
                    <button onclick="promptDeleteItemFromTable('${item.id}')" class="w-6 h-6 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-all cursor-pointer ml-0.5" title="Eliminar este plato de la cuenta">
                        <i class="fa-solid fa-trash-can text-[9px]"></i>
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
                name: item.name,
                note: item.note || '',
                price: item.price,
                qty: diff,
                isPizzaLibre: item.isPizzaLibre || false,
                libreRound: item.libreRound || null,
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
        // Unificar en la comanda activa existente preservando la bandera printed de los ítems previos
        const prevItems = (existingCmd.items || []).map(it => ({
            ...it,
            printed: typeof it.printed === 'boolean' ? it.printed : Boolean(existingCmd.printed)
        }));
        const formattedNew = newItemsToSend.map(it => ({ ...it, status: 'pending', printed: false, sentAt: timeStr, isAddon: true }));
        existingCmd.items = [...prevItems, ...formattedNew];
        existingCmd.total = existingCmd.items.reduce((acc, i) => acc + (i.price * i.qty), 0);
        existingCmd.status = 'pending';
        existingCmd.time = timeStr;
        if (!existingCmd.waiterName || !waiter.toLowerCase().includes('encargado')) {
            existingCmd.waiterName = waiter;
        }
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
            items: newItemsToSend.map(it => ({ ...it, status: 'pending', printed: false, sentAt: timeStr })),
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
    const consolidated = getTableConsolidatedOrder(tableName);
    const total = consolidated.total;

    if (total <= 0) return;
    activePaymentTotal = total;

    const cmd = consolidated.activeCmd;
    document.getElementById('pay-modal-subtitle').innerText = `${tableName}${cmd ? ' • ' + cmd.id : ''}`;
    document.getElementById('pay-modal-total').innerText = `$${total.toLocaleString()}`;

    // Mozo asociado a la mesa: SIEMPRE tiene la prioridad para la propina y cobro
    const tableWaiter = (consolidated && consolidated.waiterName) ? consolidated.waiterName : '';
    const isCurrentAdmin = currentUser && (currentUser.role.includes('Admin') || currentUser.role.includes('Cocina') || currentUser.role.includes('Encargado'));
    
    // Si quien cobra es el Encargado/Admin pero la mesa la atendió un mozo, el mozo asociado es el seleccionado por defecto
    const preferredWaiter = (!isCurrentAdmin && currentUser && currentUser.name)
        ? currentUser.name
        : (tableWaiter || (currentUser ? currentUser.name : 'Mozo'));

    const waiterSelect = document.getElementById('pay-waiter-select');
    if (waiterSelect) {
        let staffOptions = staffList;
        if (!staffOptions || staffOptions.length === 0) {
            staffOptions = [{ id: 'm1', name: preferredWaiter || 'Mozo', role: 'Mozo' }];
        }
        waiterSelect.innerHTML = staffOptions.map(s => {
            const isSelected = (s.name === preferredWaiter) || (!preferredWaiter && s.role !== 'Cocina / Admin');
            return `<option value="${s.name}" ${isSelected ? 'selected' : ''}>${s.name} (${s.role || 'Personal'})${s.name === tableWaiter ? ' • Atendió esta mesa' : ''}</option>`;
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

    const consolidated = getTableConsolidatedOrder(activePaymentTable);
    const cmd = consolidated.activeCmd;
    let itemsList = consolidated.items;
    const itemsSummary = itemsList.map(i => `${i.qty}x ${i.name}`).join(', ') || 'Consumo salón';

    // Mozo asociado a la mesa (quien atendió)
    const tableWaiter = (consolidated && consolidated.waiterName) ? consolidated.waiterName : '';
    const waiterSelect = document.getElementById('pay-waiter-select');
    const selectedWaiter = waiterSelect ? waiterSelect.value : '';

    // Si el usuario seleccionado o activo es Encargado/Admin, pero la mesa fue atendida por un mozo,
    // la propina y venta se asocian SIEMPRE al mozo que atendió la mesa
    let finalWaiter = selectedWaiter;
    const isSelectedAdmin = !selectedWaiter || selectedWaiter.toLowerCase().includes('encargado') || selectedWaiter.toLowerCase().includes('admin');
    if (isSelectedAdmin && tableWaiter && !tableWaiter.toLowerCase().includes('encargado') && !tableWaiter.toLowerCase().includes('admin')) {
        finalWaiter = tableWaiter;
    }
    if (!finalWaiter) {
        finalWaiter = tableWaiter || (currentUser ? currentUser.name : 'Mozo');
    }

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const paymentRecord = {
        id: `PAG-${101 + paymentHistory.length}`,
        table: activePaymentTable,
        waiter: finalWaiter, // Mozo asociado que recibe la propina
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
    setMobileDrawerState(false);
    document.getElementById('admin-workspace').classList.add('hidden');
    document.getElementById('waiter-order-view').classList.add('hidden');
    document.getElementById('waiter-tables-view').classList.remove('hidden');
    renderTablesGrid();
    updateAdminNavButtons();
}

function switchToAdminWorkspace(tab = 'kitchen') {
    setMobileDrawerState(false);
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
        const unprintedPending = pendingItems.filter(i => typeof i.printed === 'boolean' ? !i.printed : !cmd.printed);
        const hasAlreadyPrintedItems = (cmd.items || []).some(i => typeof i.printed === 'boolean' ? i.printed : Boolean(cmd.printed));
        const printBtnLabel = unprintedPending.length > 0
            ? (hasAlreadyPrintedItems ? `Imprimir Nuevos (${unprintedPending.length})` : 'Imprimir Comanda')
            : 'Reimprimir Comanda';
        const printBtnClass = (unprintedPending.length > 0 && hasAlreadyPrintedItems)
            ? 'text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-1 rounded-lg text-[11px] font-bold flex items-center space-x-1 cursor-pointer transition-all'
            : 'text-slate-600 hover:text-slate-900 text-[11px] font-semibold flex items-center space-x-1 cursor-pointer';

        // Acumular platos idénticos en pantalla de cocina para no mostrar tarjetas gigantes
        const groupedPendingMap = new Map();
        pendingItems.forEach(it => {
            const cleanName = stripBracketNotes(it.name || '').trim();
            const key = `${cleanName.toLowerCase()}___${(it.note || '').trim().toLowerCase()}`;
            if (groupedPendingMap.has(key)) {
                groupedPendingMap.get(key).qty += Number(it.qty) || 1;
                if (it.isAddon) groupedPendingMap.get(key).isAddon = true;
            } else {
                groupedPendingMap.set(key, {
                    ...it,
                    name: cleanName,
                    qty: Number(it.qty) || 1
                });
            }
        });
        const displayPending = Array.from(groupedPendingMap.values());

        const groupedDeliveredMap = new Map();
        deliveredItems.forEach(it => {
            const cleanName = stripBracketNotes(it.name || '').trim();
            const key = `${cleanName.toLowerCase()}___${Number(it.price) || 0}`;
            if (groupedDeliveredMap.has(key)) {
                groupedDeliveredMap.get(key).qty += Number(it.qty) || 1;
            } else {
                groupedDeliveredMap.set(key, {
                    ...it,
                    name: cleanName,
                    qty: Number(it.qty) || 1
                });
            }
        });
        const displayDelivered = Array.from(groupedDeliveredMap.values());

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
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="text-[11px] font-bold text-slate-400 block">${cmd.id}</span>
                                <button onclick="cancelEntireKitchenOrderPrompt('${cmd.id}', '${cmd.table}')" class="text-rose-600 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1" title="Anular comanda completa enviada por error">
                                    <i class="fa-solid fa-trash-can text-[9px]"></i>
                                    <span>Anular Pedido</span>
                                </button>
                            </div>
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
                                ${displayPending.map((item, idx) => `
                                    <div class="flex items-center justify-between text-xs py-1 px-1.5 rounded-lg bg-white/70 border border-amber-100">
                                        <div class="flex items-center space-x-2 min-w-0">
                                            <span class="inline-block bg-amber-200 text-amber-900 px-2 py-0.5 rounded-md font-black text-xs shrink-0">${item.qty}x</span>
                                            <div class="min-w-0">
                                                <span class="font-bold text-slate-900 truncate block">${stripBracketNotes(item.name)}</span>
                                                ${item.note ? `<span class="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded font-semibold block mt-0.5">${item.note}</span>` : ''}
                                            </div>
                                            ${item.isAddon ? '<span class="bg-indigo-100 text-indigo-700 text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0">Agregado</span>' : ''}
                                        </div>
                                        <div class="flex items-center space-x-1 shrink-0 ml-2">
                                            <button onclick="deliverIndividualKitchenItem('${cmd.id}', '${item.id || item.name}')" title="Marcar este plato como entregado" class="px-2 py-1 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-bold flex items-center space-x-1 shrink-0 active:scale-95 transition-all cursor-pointer">
                                                <i class="fa-solid fa-check"></i>
                                                <span class="hidden sm:inline">Entregar</span>
                                            </button>
                                            <button onclick="deleteIndividualKitchenItem('${cmd.id}', '${item.id || ''}', '${(item.name || '').replace(/'/g, "\\'")}', ${item.price || 0})" title="Quitar este plato de la comanda y de la cuenta de la mesa" class="p-1 hover:bg-rose-50 text-slate-300 hover:text-rose-600 rounded-lg text-[11px] transition-all cursor-pointer">
                                                <i class="fa-solid fa-trash-can"></i>
                                            </button>
                                        </div>
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
                                ${displayDelivered.map(item => `
                                    <div class="flex items-center justify-between py-1 px-1 text-[11px] border-b border-slate-100 last:border-b-0">
                                        <span class="flex items-center space-x-1.5 text-slate-600 truncate min-w-0">
                                            <i class="fa-solid fa-check text-emerald-500 text-[10px] shrink-0"></i>
                                            <span class="truncate"><strong>${item.qty}x</strong> ${item.name}</span>
                                        </span>
                                        <div class="flex items-center space-x-1.5 shrink-0 ml-1">
                                            <span class="text-slate-400 text-[10px]">$${((item.price || 0) * (item.qty || 1)).toLocaleString()}</span>
                                            <button onclick="deleteIndividualKitchenItem('${cmd.id}', '${item.id || ''}', '${(item.name || '').replace(/'/g, "\\'")}', ${item.price || 0})" title="Quitar este plato de la comanda y de la cuenta de la mesa" class="p-1 hover:bg-rose-50 text-slate-300 hover:text-rose-600 rounded-lg text-[10px] transition-all cursor-pointer">
                                                <i class="fa-solid fa-trash-can"></i>
                                            </button>
                                        </div>
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

                    <div class="pt-1 flex items-center justify-between border-t border-slate-50 gap-2">
                        <div class="flex items-center space-x-2">
                            <button onclick="openKitchenTicketPrint('${cmd.id}')" class="${printBtnClass}" title="Imprimir comanda para cocina (solo platos nuevos sin imprimir)">
                                <i class="fa-solid fa-print"></i>
                                <span>${printBtnLabel}</span>
                            </button>
                            <button onclick="openTableBillTicketPrint('${cmd.table}', '${(cmd.waiterName || '').replace(/'/g, "\\'")}')" class="text-[#2563eb] hover:text-blue-800 text-[11px] font-bold flex items-center space-x-1 cursor-pointer bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg border border-blue-200 transition-all" title="Imprimir ticket pre-cuenta para que el mozo cobre en la mesa">
                                <i class="fa-solid fa-receipt"></i>
                                <span>Ticket Mesa (Cobrar)</span>
                            </button>
                        </div>
                        <div class="text-right shrink-0">
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

async function deleteIndividualKitchenItem(cmdId, itemId, itemName, itemPrice) {
    const cmd = kitchenOrders.find(o => o.id === cmdId);
    if (!cmd) return;

    const confirmed = confirm(`¿Eliminar 1x "${itemName}" de la comanda ${cmd.id} (${cmd.table})? Se descontará automáticamente de la cuenta de la mesa.`);
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/orders/${cmdId}/remove-item`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                itemId,
                name: itemName,
                price: Number(itemPrice) || 0,
                qty: 1
            })
        });

        if (res.ok) {
            const data = await res.json();
            if (data.orderDeleted) {
                kitchenOrders = kitchenOrders.filter(o => o.id !== cmdId);
                if (ordersByTable[cmd.table]) {
                    ordersByTable[cmd.table] = { items: [], note: "" };
                }
            } else if (data.order) {
                const idx = kitchenOrders.findIndex(o => o.id === cmdId);
                if (idx >= 0) kitchenOrders[idx] = data.order;
            }
        }
    } catch (e) {
        console.warn('Error al quitar plato de cocina:', e);
    }

    // Sincronizar comanda en memoria
    const kIdx = (cmd.items || []).findIndex(it =>
        (itemId && it.id === itemId) ||
        (it.name || '').trim().toLowerCase() === (itemName || '').trim().toLowerCase()
    );
    if (kIdx >= 0) {
        if (cmd.items[kIdx].qty > 1) {
            cmd.items[kIdx].qty -= 1;
        } else {
            cmd.items.splice(kIdx, 1);
        }
        cmd.total = cmd.items.reduce((acc, i) => acc + (Number(i.price) * Number(i.qty)), 0);
        if (cmd.items.length === 0) {
            kitchenOrders = kitchenOrders.filter(o => o.id !== cmdId);
        }
    }

    // Sincronizar mesa local
    if (ordersByTable[cmd.table] && Array.isArray(ordersByTable[cmd.table].items)) {
        const tItems = ordersByTable[cmd.table].items;
        const tIdx = tItems.findIndex(it =>
            (itemId && it.id === itemId) ||
            (it.name || '').trim().toLowerCase() === (itemName || '').trim().toLowerCase()
        );
        if (tIdx >= 0) {
            if (tItems[tIdx].qty > 1) {
                tItems[tIdx].qty -= 1;
                tItems[tIdx].sentQty = Math.max(0, (tItems[tIdx].sentQty || 1) - 1);
            } else {
                tItems.splice(tIdx, 1);
            }
        }
    }

    saveLocalState();
    refreshActiveViews();
    showToast(`1x ${itemName} eliminado de la comanda y de la cuenta`, 'success');
}

async function cancelEntireKitchenOrderPrompt(cmdId, tableName) {
    const confirmed = confirm(`¿Estás seguro de anular y borrar completamente el pedido ${cmdId} de ${tableName}? La comanda se eliminará de cocina y la mesa quedará liberada.`);
    if (!confirmed) return;

    try {
        await fetch(`/api/orders/${cmdId}`, {
            method: 'DELETE'
        });
    } catch (e) {
        console.warn('Error al anular comanda en servidor:', e);
    }

    kitchenOrders = kitchenOrders.filter(o => o.id !== cmdId);
    if (tableName && ordersByTable[tableName]) {
        ordersByTable[tableName] = { items: [], note: "" };
    }

    saveLocalState();
    refreshActiveViews();
    showToast(`Pedido ${cmdId} de ${tableName} anulado y borrado`, 'success');
}

// ================= IMPRESIÓN DE TICKET TÉRMICO (DIRECTA USB/SERIAL/RAWBT + 80MM/58MM) =================

let currentTicketRawText = "";
let currentTicketData = null;
let directUsbPrinter = null;
let directSerialPort = null;
let rawBtEnabled = localStorage.getItem('rivera_rawbt_enabled') === '1';
let printerPaperWidth = Number(localStorage.getItem('rivera_paper_width')) === 58 ? 58 : 80;
let winPrintEndpoint = null; // { listUrl, printUrl }
let winPrintersList = [];
let selectedWinPrinter = localStorage.getItem('rivera_win_printer') || '';
let ticketConfig = (() => {
    const defaults = {
        businessName: 'SARMIENTO',
        alias: '',
        footerMessage: '¡Muchas gracias por elegir Sarmiento!',
        showSuggestedTip: true
    };
    try {
        const saved = JSON.parse(localStorage.getItem('rivera_ticket_config') || 'null');
        if (saved && typeof saved === 'object') return { ...defaults, ...saved };
    } catch (_) {}
    return defaults;
})();

function openTicketConfigModal() {
    const bizInput = document.getElementById('cfg-ticket-business');
    const aliasInput = document.getElementById('cfg-ticket-alias');
    const footerInput = document.getElementById('cfg-ticket-footer');
    const tipToggle = document.getElementById('cfg-ticket-tip-toggle');

    if (bizInput) bizInput.value = ticketConfig.businessName || 'SARMIENTO';
    if (aliasInput) aliasInput.value = ticketConfig.alias || '';
    if (footerInput) footerInput.value = ticketConfig.footerMessage || '';
    if (tipToggle) tipToggle.checked = Boolean(ticketConfig.showSuggestedTip);

    document.getElementById('ticket-config-modal').classList.remove('hidden');
}

function closeTicketConfigModal() {
    document.getElementById('ticket-config-modal').classList.add('hidden');
}

async function saveTicketConfig() {
    const bizInput = document.getElementById('cfg-ticket-business');
    const aliasInput = document.getElementById('cfg-ticket-alias');
    const footerInput = document.getElementById('cfg-ticket-footer');
    const tipToggle = document.getElementById('cfg-ticket-tip-toggle');

    const newConfig = {
        businessName: (bizInput ? bizInput.value.trim() : '') || 'SARMIENTO',
        alias: aliasInput ? aliasInput.value.trim() : '',
        footerMessage: footerInput ? footerInput.value.trim() : '',
        showSuggestedTip: tipToggle ? Boolean(tipToggle.checked) : true
    };

    ticketConfig = newConfig;
    try {
        localStorage.setItem('rivera_ticket_config', JSON.stringify(ticketConfig));
    } catch (_) {}

    closeTicketConfigModal();

    // Si el modal de ticket está abierto, actualizar la vista previa inmediatamente
    const ticketModal = document.getElementById('ticket-print-modal');
    if (ticketModal && !ticketModal.classList.contains('hidden') && currentTicketData) {
        if (currentTicketData.type === 'kitchen' && currentTicketData.id) {
            openKitchenTicketPrint(currentTicketData.id);
        } else if (currentTicketData.type === 'bill' && currentTicketData.table) {
            openTableBillTicketPrint(currentTicketData.table, currentTicketData.waiter);
        }
    }

    try {
        const res = await fetch('/api/config/ticket', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ticketConfig)
        });
        if (res.ok) {
            showToast('Configuración de ticket guardada en la base de datos', 'success');
        } else {
            showToast('Configuración guardada localmente (sincronización pendiente)', 'info');
        }
    } catch (err) {
        console.warn('Error guardando configuración de ticket:', err);
        showToast('Configuración guardada localmente', 'info');
    }
}

function stripBracketNotes(name) {
    return String(name || '')
        .replace(/\s*\[[^\]]*\]\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeKitchenItemForPrint(item) {
    const rawName = String(item.name || '');
    const bracketMatch = rawName.match(/\[([^\]]+)\]/);
    const cleanName = stripBracketNotes(rawName);
    const extractedNote = (item.note && String(item.note).trim())
        ? String(item.note).trim()
        : (bracketMatch ? bracketMatch[1].trim() : '');
    return {
        ...item,
        name: cleanName,
        note: extractedNote
    };
}

function formatBillItemName(item) {
    let clean = stripBracketNotes(item.name);
    const isLibre = item.isPizzaLibre || /^pizza\s+libre\b/i.test(clean);
    if (isLibre) {
        return 'Pizza libre';
    }
    return clean;
}

function filterBillItems(items) {
    const validItems = (items || [])
        .filter(i => {
            const price = Number(i.price || 0);
            const isFreeRound = price === 0 && (i.isPizzaLibre || /ronda/i.test(String(i.name || '')));
            return !isFreeRound;
        })
        .map(i => ({
            ...i,
            name: formatBillItemName(i),
            price: Number(i.price || 0),
            qty: Number(i.qty || 1),
            note: ''
        }));

    // Consolidar ítems con mismo nombre y precio para que el ticket del cliente salga limpio (ej: 2x Coca Cola en vez de dos renglones separados)
    const grouped = new Map();
    validItems.forEach(i => {
        const key = `${(i.name || '').trim().toLowerCase()}___${i.price}`;
        if (grouped.has(key)) {
            grouped.get(key).qty += i.qty;
        } else {
            grouped.set(key, { ...i });
        }
    });

    return Array.from(grouped.values());
}

function markKitchenOrderPrinted(cmdId) {
    const cmd = kitchenOrders.find(o => o.id === cmdId);
    if (cmd) {
        cmd.printed = true;
        if (Array.isArray(cmd.items)) {
            cmd.items.forEach(it => it.printed = true);
        }
        saveLocalState();
        if (activeAdminTab === 'kitchen') {
            renderKitchenOrders();
        }
    }
    fetch(`/api/orders/${cmdId}/print`, { method: 'PUT' }).catch(e => console.warn(e));
}

function openKitchenTicketPrint(cmdId) {
    const cmd = kitchenOrders.find(o => o.id === cmdId);
    if (!cmd) return;

    const now = new Date();
    const dateStr = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const businessName = (ticketConfig && ticketConfig.businessName) ? ticketConfig.businessName : 'SARMIENTO';

    const pendingItems = (cmd.items || []).filter(i => (i.status || cmd.status) !== 'delivered');
    const unprintedPending = pendingItems.filter(i => typeof i.printed === 'boolean' ? !i.printed : !cmd.printed);

    // Imprimir SOLO los productos nuevos que todavía no salieron en un ticket anterior.
    // Si ya se imprimió todo, queda en modo Reimpresión de los pendientes actuales.
    const isReprint = unprintedPending.length === 0;
    const rawItemsToPrint = unprintedPending.length > 0
        ? unprintedPending
        : (pendingItems.length > 0 ? pendingItems : (cmd.items || []));

    // Limpiar notas incrustadas entre [corchetes] y acumular ítems idénticos para no generar tickets gigantes
    const normalizedRaw = rawItemsToPrint.map(normalizeKitchenItemForPrint);
    const groupedKitchen = new Map();
    normalizedRaw.forEach(it => {
        const cleanName = stripBracketNotes(it.name || '').trim();
        const normKey = `${cleanName.toLowerCase()}___${(it.note || '').trim().toLowerCase()}`;
        if (groupedKitchen.has(normKey)) {
            groupedKitchen.get(normKey).qty += Number(it.qty) || 1;
        } else {
            groupedKitchen.set(normKey, {
                ...it,
                name: cleanName,
                qty: Number(it.qty) || 1
            });
        }
    });
    const itemsToPrint = Array.from(groupedKitchen.values());

    // Evitar repetir la nota general si ya está contenida en las observaciones de un plato
    const rawCmdNote = (cmd.note || '').trim();
    const itemNotesLower = itemsToPrint.map(i => (i.note || '').toLowerCase()).filter(Boolean);
    const generalNote = (rawCmdNote && !itemNotesLower.some(n => n.includes(rawCmdNote.toLowerCase())))
        ? rawCmdNote
        : '';

    currentTicketData = {
        type: 'kitchen',
        businessName,
        id: cmd.id,
        table: cmd.table,
        dateStr,
        time: cmd.time,
        waiter: cmd.waiterName,
        itemsToPrint,
        isReprint,
        note: generalNote
    };

    const subtitleLabel = isReprint ? 'REIMPRESIÓN - COMANDA' : 'COMANDA DE COCINA';

    const modalTitle = document.getElementById('ticket-modal-title');
    const modalSubtitle = document.getElementById('ticket-modal-subtitle');
    if (modalTitle) modalTitle.innerText = isReprint ? "Reimprimir Comanda (Cocina)" : "Comanda de Cocina (3nStar 80mm)";
    if (modalSubtitle) modalSubtitle.innerText = isReprint
        ? `${cmd.table} - Ya impresa anteriormente`
        : `${cmd.table} - ${itemsToPrint.length} producto${itemsToPrint.length === 1 ? '' : 's'} nuevo${itemsToPrint.length === 1 ? '' : 's'}`;

    const container = document.getElementById('printable-ticket-area');
    container.innerHTML = `
        <div class="font-mono text-black">
            <div class="text-center border-b border-black pb-2 mb-2">
                <h2 class="font-bold text-lg uppercase tracking-wider leading-tight">${escapeHtmlSafe(businessName)}</h2>
                <p class="text-[11px] font-medium uppercase tracking-wide mt-0.5">${subtitleLabel}</p>
            </div>

            <div class="text-center border-b border-black py-1.5 mb-2">
                <div class="text-lg font-bold uppercase leading-tight">${escapeHtmlSafe(cmd.table)}</div>
                <div class="text-[11px] font-normal">COMANDA: ${escapeHtmlSafe(cmd.id)}</div>
            </div>

            <div class="border-b border-dashed border-black pb-2 mb-2 space-y-0.5 text-[11px] font-normal">
                <div class="flex justify-between">
                    <span>FECHA: ${dateStr}</span>
                    <span>HORA: ${cmd.time} hs</span>
                </div>
                <div>MOZO: ${escapeHtmlSafe(cmd.waiterName)}</div>
            </div>

            ${itemsToPrint.length > 0 ? `
                <div class="border-b border-black pb-2 mb-2">
                    <div class="text-center font-bold text-xs uppercase tracking-wide border-b border-dashed border-black pb-1 mb-2">
                        POR PREPARAR
                    </div>
                    <div class="space-y-1.5">
                        ${itemsToPrint.map(i => `
                            <div class="border-b border-dotted border-slate-400 pb-1.5 last:border-b-0 last:pb-0">
                                <div class="flex items-start gap-2">
                                    <span class="font-bold text-sm leading-snug shrink-0">${i.qty}x</span>
                                    <div class="flex-1 min-w-0">
                                        <div class="font-normal text-sm leading-snug break-words">${escapeHtmlSafe(i.name)}</div>
                                        ${i.note ? `<div class="text-xs font-normal text-slate-800 mt-0.5">OBS: ${escapeHtmlSafe(i.note)}</div>` : ''}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${generalNote ? `
                <div class="border border-black p-2 my-1.5">
                    <div class="font-bold text-[11px] uppercase border-b border-dashed border-black pb-0.5 mb-1">OBSERVACIONES:</div>
                    <p class="text-xs font-normal leading-snug break-words">${escapeHtmlSafe(generalNote)}</p>
                </div>
            ` : ''}
        </div>
    `;

    currentTicketRawText =
        `*${subtitleLabel} - ${businessName.toUpperCase()}*\n` +
        `Mesa: ${cmd.table} | Comanda: ${cmd.id}\n` +
        `Fecha: ${dateStr} | Hora: ${cmd.time} hs\n` +
        `Mozo: ${cmd.waiterName}\n` +
        `--------------------------------\n` +
        itemsToPrint.map(i => `- [${i.qty}x] ${i.name}${i.note ? ` | OBS: ${i.note}` : ''}`).join('\n') + '\n' +
        (generalNote ? `*OBSERVACIONES:* ${generalNote}\n` : '');

    updatePrinterStatusUI();
    if (!winPrintEndpoint || !selectedWinPrinter) {
        discoverWindowsBridge(true);
    }
    document.getElementById('ticket-print-modal').classList.remove('hidden');
}

function openTableBillTicketPrint(tableName, explicitWaiterName = '') {
    const table = tableName || currentTable || activePaymentTable;
    if (!table) {
        showToast('Selecciona una mesa primero', 'info');
        return;
    }

    const consolidated = getTableConsolidatedOrder(table);
    const rawItems = consolidated.items;

    if (!rawItems || rawItems.length === 0) {
        showToast(`La ${table} no tiene productos registrados`, 'info');
        return;
    }

    // En la cuenta del cliente NO van observaciones internas de cocina ni rondas $0
    const items = filterBillItems(rawItems);
    const total = items.reduce((acc, i) => acc + (i.price * i.qty), 0);
    const suggestedTip10 = Math.round(total * 0.10);
    const totalWithTip10 = total + suggestedTip10;

    // Siempre a nombre del mozo asociado a la mesa
    const waiterName = (explicitWaiterName && String(explicitWaiterName).trim())
        ? String(explicitWaiterName).trim()
        : consolidated.waiterName;

    const now = new Date();
    const dateStr = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const businessName = (ticketConfig && ticketConfig.businessName) ? ticketConfig.businessName : 'SARMIENTO';
    const alias = (ticketConfig && ticketConfig.alias) ? ticketConfig.alias.trim() : '';
    const footerMessage = (ticketConfig && ticketConfig.footerMessage) ? ticketConfig.footerMessage.trim() : '';
    const showSuggestedTip = ticketConfig ? Boolean(ticketConfig.showSuggestedTip) : true;

    currentTicketData = {
        type: 'bill',
        businessName,
        alias,
        footerMessage,
        showSuggestedTip,
        table,
        waiter: waiterName,
        dateStr,
        timeStr,
        items,
        total,
        suggestedTip10,
        totalWithTip10
    };

    const modalTitle = document.getElementById('ticket-modal-title');
    const modalSubtitle = document.getElementById('ticket-modal-subtitle');
    if (modalTitle) modalTitle.innerText = "Ticket Cuenta (3nStar 80mm)";
    if (modalSubtitle) modalSubtitle.innerText = `${table} - Mozo: ${waiterName}`;

    const container = document.getElementById('printable-ticket-area');
    container.innerHTML = `
        <div class="font-mono text-black text-xs">
            <div class="text-center border-b border-black pb-2 mb-2">
                <h2 class="font-bold text-lg uppercase tracking-wider leading-tight">${escapeHtmlSafe(businessName)}</h2>
                <p class="text-[11px] font-medium uppercase mt-0.5">CONTROL DE MESA / CUENTA</p>
                <p class="text-[10px] font-normal mt-0.5">NO VÁLIDO COMO FACTURA FISCAL</p>
            </div>

            <div class="text-center border-b border-dashed border-black pb-2 mb-2">
                <div class="text-base font-bold uppercase">${escapeHtmlSafe(table)}</div>
                <div class="flex justify-between text-[11px] font-normal mt-1">
                    <span>FECHA: ${dateStr}</span>
                    <span>HORA: ${timeStr} hs</span>
                </div>
                <div class="text-left text-[11px] font-normal mt-0.5">MOZO: ${escapeHtmlSafe(waiterName)}</div>
            </div>

            <div class="border-b border-black pb-2 mb-2">
                <div class="flex justify-between font-bold text-[11px] uppercase border-b border-dashed border-black pb-1 mb-1.5">
                    <span>CANT / PRODUCTO</span>
                    <span>SUBTOTAL</span>
                </div>
                <div class="space-y-1.5">
                    ${items.map(i => `
                        <div class="flex justify-between items-start gap-2 text-xs font-normal">
                            <span class="leading-snug break-words"><strong class="font-semibold">${i.qty}x</strong> ${escapeHtmlSafe(i.name)}</span>
                            <span class="shrink-0 font-normal">$${(i.price * i.qty).toLocaleString('es-AR')}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="border-b border-dashed border-black pb-2 mb-2 space-y-1">
                <div class="flex justify-between items-center text-sm font-bold">
                    <span>TOTAL:</span>
                    <span>$${total.toLocaleString('es-AR')}</span>
                </div>
                ${showSuggestedTip ? `
                    <div class="flex justify-between text-[11px] font-normal pt-1 border-t border-dotted border-slate-400">
                        <span>Propina sugerida (10%):</span>
                        <span>$${suggestedTip10.toLocaleString('es-AR')}</span>
                    </div>
                    <div class="flex justify-between text-xs font-semibold">
                        <span>Total con 10% propina:</span>
                        <span>$${totalWithTip10.toLocaleString('es-AR')}</span>
                    </div>
                ` : ''}
            </div>

            ${alias ? `
                <div class="text-center border border-dashed border-black p-1.5 my-2">
                    <div class="text-[10px] font-normal uppercase">ALIAS TRANSFERENCIA</div>
                    <div class="text-xs font-bold break-all mt-0.5">${escapeHtmlSafe(alias)}</div>
                </div>
            ` : ''}

            ${footerMessage ? `
                <div class="text-center pt-1 text-[11px] font-normal whitespace-pre-line">${escapeHtmlSafe(footerMessage)}</div>
            ` : ''}
        </div>
    `;

    currentTicketRawText =
        `*${businessName.toUpperCase()} - CUENTA*\n` +
        `Mesa: ${table}\n` +
        `Mozo: ${waiterName}\n` +
        `Fecha: ${dateStr} ${timeStr} hs\n` +
        `--------------------------------\n` +
        items.map(i => `- ${i.qty}x ${i.name} = $${(i.price * i.qty).toLocaleString('es-AR')}`).join('\n') + '\n' +
        `--------------------------------\n` +
        `*TOTAL: $${total.toLocaleString('es-AR')}*\n` +
        (showSuggestedTip ? `Propina sugerida 10%: $${suggestedTip10.toLocaleString('es-AR')}\n*Total con 10% propina: $${totalWithTip10.toLocaleString('es-AR')}*\n` : '') +
        (alias ? `\nAlias transferencia: ${alias}\n` : '') +
        (footerMessage ? `\n${footerMessage}` : '');

    updatePrinterStatusUI();
    if (!winPrintEndpoint || !selectedWinPrinter) {
        discoverWindowsBridge(true);
    }
    document.getElementById('ticket-print-modal').classList.remove('hidden');
}

function copyTicketText() {
    if (!currentTicketRawText) {
        const area = document.getElementById('printable-ticket-area');
        if (area) {
            currentTicketRawText = area.innerText;
        }
    }
    if (!currentTicketRawText) {
        showToast('No hay contenido para copiar', 'info');
        return;
    }
    navigator.clipboard.writeText(currentTicketRawText).then(() => {
        showToast('Ticket copiado al portapapeles para WhatsApp', 'success');
    }).catch(err => {
        console.warn('Error al copiar ticket:', err);
        showToast('No se pudo copiar automáticamente', 'error');
    });
}

function closeTicketPrintModal() {
    document.getElementById('ticket-print-modal').classList.add('hidden');
}

// ================= MOTOR DE IMPRESIÓN TÉRMICA DIRECTA (SIN GUARDAR COMO PDF) =================

function setPaperWidth(mm) {
    printerPaperWidth = mm === 58 ? 58 : 80;
    localStorage.setItem('rivera_paper_width', String(printerPaperWidth));
    updatePrinterStatusUI();
}

function updatePrinterStatusUI() {
    const dot = document.getElementById('printer-status-dot');
    const txt = document.getElementById('printer-status-text');
    const btn80 = document.getElementById('btn-paper-80');
    const btn58 = document.getElementById('btn-paper-58');
    const btnWin = document.getElementById('btn-connect-win');
    const btnSerial = document.getElementById('btn-connect-serial');
    const btnRawBt = document.getElementById('btn-toggle-rawbt');
    const printLabel = document.getElementById('btn-execute-print-label');
    const winSelectWrap = document.getElementById('windows-printer-select-wrap');
    const winSelect = document.getElementById('windows-printer-select');

    const activePill = "px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#2563eb] text-white cursor-pointer";
    const inactivePill = "px-2 py-0.5 rounded-lg text-[10px] font-bold bg-white text-slate-600 border border-slate-200 cursor-pointer";
    if (btn80) btn80.className = printerPaperWidth === 80 ? activePill : inactivePill;
    if (btn58) btn58.className = printerPaperWidth === 58 ? activePill : inactivePill;

    const btnIdle = "bg-white hover:bg-blue-50 text-slate-700 hover:text-[#2563eb] border border-slate-200 rounded-xl py-1.5 px-2 text-[10px] font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer";
    const btnActive = "bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600 rounded-xl py-1.5 px-2 text-[10px] font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer shadow-sm";

    const isWinActive = Boolean(winPrintEndpoint && selectedWinPrinter);
    if (btnWin) btnWin.className = isWinActive ? btnActive : btnIdle;
    if (btnSerial) btnSerial.className = directSerialPort ? btnActive : btnIdle;
    if (btnRawBt) btnRawBt.className = rawBtEnabled ? btnActive : btnIdle;

    if (winSelectWrap && winSelect) {
        if (isWinActive && winPrintersList.length > 0) {
            winSelectWrap.classList.remove('hidden');
            winSelect.innerHTML = winPrintersList.map(p => {
                const tag = p.isThermal ? ' (Térmica)' : '';
                const portStr = p.port ? ` [${p.port}]` : '';
                return `<option value="${escapeHtmlSafe(p.name)}" ${p.name === selectedWinPrinter ? 'selected' : ''}>${escapeHtmlSafe(p.name)}${portStr}${tag}</option>`;
            }).join('');
        } else {
            winSelectWrap.classList.add('hidden');
        }
    }

    if (isWinActive) {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500 shrink-0";
        if (txt) txt.innerText = `Directa Windows: ${selectedWinPrinter}`;
        if (printLabel) printLabel.innerText = "Imprimir Directo";
    } else if (directUsbPrinter) {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500 shrink-0";
        if (txt) txt.innerText = `Directa USB: ${directUsbPrinter.name}`;
        if (printLabel) printLabel.innerText = "Imprimir Directo";
    } else if (directSerialPort) {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500 shrink-0";
        if (txt) txt.innerText = "Directa COM / Bluetooth";
        if (printLabel) printLabel.innerText = "Imprimir Directo";
    } else if (rawBtEnabled) {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500 shrink-0";
        if (txt) txt.innerText = "Directa Android (RawBT)";
        if (printLabel) printLabel.innerText = "Imprimir Directo";
    } else {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-slate-400 shrink-0";
        if (txt) txt.innerText = `Impresora del sistema (${printerPaperWidth}mm)`;
        if (printLabel) printLabel.innerText = "Imprimir";
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function discoverWindowsBridge(silent = true) {
    const candidates = [
        { listUrl: 'http://127.0.0.1:9100/printers', printUrl: 'http://127.0.0.1:9100/print' },
        { listUrl: '/api/printers', printUrl: '/api/print-raw' }
    ];

    for (const c of candidates) {
        try {
            const res = await fetchWithTimeout(c.listUrl, { method: 'GET' }, 6000);
            if (!res.ok) continue;
            const data = await res.json();
            if (data && data.success && Array.isArray(data.printers) && data.printers.length > 0) {
                winPrintEndpoint = c;
                winPrintersList = data.printers;

                // Elegir impresora guardada si existe, si no priorizar la primera térmica física (ej. POS-80C)
                const savedExists = winPrintersList.some(p => p.name === selectedWinPrinter);
                if (!savedExists) {
                    const thermal = winPrintersList.find(p => p.isThermal) || winPrintersList.find(p => !p.isVirtual) || winPrintersList[0];
                    selectedWinPrinter = thermal ? thermal.name : '';
                    if (selectedWinPrinter) {
                        localStorage.setItem('rivera_win_printer', selectedWinPrinter);
                    }
                }
                localStorage.setItem('rivera_printer_mode', 'windows');
                updatePrinterStatusUI();
                if (!silent) {
                    showToast(`Vinculada directo en Windows: ${selectedWinPrinter}`, 'success');
                }
                return true;
            }
        } catch (e) {
            // Probar siguiente candidato
        }
    }

    if (!silent) {
        showToast('No se detectó el puente local. Abre "iniciar-impresora.bat" en la PC de cocina para vincular POS-80C.', 'warning');
    }
    return false;
}

async function connectWindowsBridgePrinter() {
    if (directSerialPort) {
        try { await directSerialPort.close(); } catch (e) {}
        directSerialPort = null;
    }
    rawBtEnabled = false;
    localStorage.setItem('rivera_rawbt_enabled', '0');

    await discoverWindowsBridge(false);
}

function onWindowsPrinterSelected(printerName) {
    selectedWinPrinter = printerName || '';
    if (selectedWinPrinter) {
        localStorage.setItem('rivera_win_printer', selectedWinPrinter);
        showToast(`Impresora seleccionada: ${selectedWinPrinter}`, 'success');
    }
    updatePrinterStatusUI();
}

async function openUsbDevice(device) {
    if (!device.opened) {
        await device.open();
    }
    if (device.configuration === null) {
        await device.selectConfiguration(1);
    }

    let selectedInterface = null;
    let selectedEndpoint = null;

    // Priorizar interfaz clase 7 (Impresora USB estándar)
    for (const iface of device.configuration.interfaces) {
        const alt = iface.alternates[0];
        if (!alt) continue;
        const outEp = alt.endpoints.find(ep => ep.direction === 'out');
        if (outEp) {
            if (alt.interfaceClass === 7) {
                selectedInterface = iface.interfaceNumber;
                selectedEndpoint = outEp.endpointNumber;
                break;
            }
            if (selectedInterface === null) {
                selectedInterface = iface.interfaceNumber;
                selectedEndpoint = outEp.endpointNumber;
            }
        }
    }

    if (selectedInterface === null || selectedEndpoint === null) {
        throw new Error('No se encontró un canal de salida de impresión en este dispositivo USB.');
    }

    await device.claimInterface(selectedInterface);
    return {
        device,
        interfaceNumber: selectedInterface,
        endpointNumber: selectedEndpoint,
        name: device.productName || 'Térmica USB'
    };
}

async function connectDirectUsbPrinter() {
    if (directUsbPrinter) {
        try {
            await directUsbPrinter.device.close();
        } catch (e) {}
        directUsbPrinter = null;
        localStorage.removeItem('rivera_printer_mode');
        updatePrinterStatusUI();
        showToast('Impresora USB desconectada', 'info');
        return;
    }

    if (!('usb' in navigator)) {
        showToast('Tu navegador no soporta USB directo. Usa Chrome o Edge en PC.', 'warning');
        return;
    }

    try {
        const device = await navigator.usb.requestDevice({ filters: [] });
        directUsbPrinter = await openUsbDevice(device);
        if (directSerialPort) {
            try { await directSerialPort.close(); } catch (e) {}
            directSerialPort = null;
        }
        rawBtEnabled = false;
        localStorage.setItem('rivera_rawbt_enabled', '0');
        localStorage.setItem('rivera_printer_mode', 'usb');
        updatePrinterStatusUI();
        showToast(`Impresora USB conectada: ${directUsbPrinter.name}`, 'success');
    } catch (err) {
        if (err && err.name === 'NotFoundError') return;
        console.warn('Error conectando USB directo:', err);
        showToast('No se pudo abrir el puerto USB directo. Prueba COM / BT o verifica el driver de Windows.', 'error');
    }
}

async function connectDirectSerialPrinter() {
    if (directSerialPort) {
        try {
            await directSerialPort.close();
        } catch (e) {}
        directSerialPort = null;
        localStorage.removeItem('rivera_printer_mode');
        updatePrinterStatusUI();
        showToast('Puerto COM / Bluetooth desconectado', 'info');
        return;
    }

    if (!('serial' in navigator)) {
        showToast('Tu navegador no soporta puerto Serial/COM. Usa Chrome o Edge en PC.', 'warning');
        return;
    }

    try {
        const port = await navigator.serial.requestPort();
        try {
            await port.open({ baudRate: 9600 });
        } catch (e) {
            await port.open({ baudRate: 115200 });
        }
        directSerialPort = port;
        if (directUsbPrinter) {
            try { await directUsbPrinter.device.close(); } catch (e) {}
            directUsbPrinter = null;
        }
        rawBtEnabled = false;
        localStorage.setItem('rivera_rawbt_enabled', '0');
        localStorage.setItem('rivera_printer_mode', 'serial');
        updatePrinterStatusUI();
        showToast('Impresora COM / Bluetooth conectada en modo directo', 'success');
    } catch (err) {
        if (err && err.name === 'NotFoundError') return;
        console.warn('Error conectando puerto Serial:', err);
        showToast('No se pudo abrir el puerto COM / Bluetooth seleccionado.', 'error');
    }
}

function toggleRawBtMode() {
    rawBtEnabled = !rawBtEnabled;
    localStorage.setItem('rivera_rawbt_enabled', rawBtEnabled ? '1' : '0');
    if (rawBtEnabled) {
        if (directUsbPrinter) {
            try { directUsbPrinter.device.close(); } catch (e) {}
            directUsbPrinter = null;
        }
        if (directSerialPort) {
            try { directSerialPort.close(); } catch (e) {}
            directSerialPort = null;
        }
        localStorage.setItem('rivera_printer_mode', 'rawbt');
        showToast('Modo RawBT activado para impresión térmica directa en Android', 'success');
    } else {
        localStorage.removeItem('rivera_printer_mode');
        showToast('Modo RawBT desactivado', 'info');
    }
    updatePrinterStatusUI();
}

async function autoReconnectDirectPrinter() {
    const savedMode = localStorage.getItem('rivera_printer_mode');

    // Siempre intentar detectar automáticamente el puente local Windows (POS-80C / 3nStar RPT004)
    if (!savedMode || savedMode === 'windows') {
        const foundWin = await discoverWindowsBridge(true);
        if (foundWin) return;
    }

    if (savedMode === 'serial' && 'serial' in navigator) {
        try {
            const ports = await navigator.serial.getPorts();
            if (ports.length > 0) {
                const port = ports[0];
                if (!port.readable && !port.writable) {
                    try { await port.open({ baudRate: 9600 }); } catch (e) { await port.open({ baudRate: 115200 }); }
                }
                directSerialPort = port;
                updatePrinterStatusUI();
            }
        } catch (e) {
            console.warn('Reconexión Serial diferida:', e);
        }
    } else if (savedMode === 'usb' && 'usb' in navigator) {
        try {
            const devices = await navigator.usb.getDevices();
            if (devices.length > 0) {
                directUsbPrinter = await openUsbDevice(devices[0]);
                updatePrinterStatusUI();
            }
        } catch (e) {
            console.warn('Reconexión USB diferida:', e);
        }
    }
}

window.addEventListener('load', () => {
    autoReconnectDirectPrinter();
});

// Mapa de codificación PC850 (ESC t 2) para impresoras térmicas 3nStar RPT004 (acentos y ñ nativos)
const PC850_MAP = {
    'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3,
    'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9,
    'ñ': 0xA4, 'Ñ': 0xA5, 'ü': 0x81, 'Ü': 0x9A,
    '¡': 0xAD, '¿': 0xA8, '°': 0xF8, 'º': 0xA7, 'ª': 0xA6,
    '•': 0x2D, '–': 0x2D, '—': 0x2D
};

function encodePC850Bytes(str) {
    const out = [];
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (PC850_MAP[ch] !== undefined) {
            out.push(PC850_MAP[ch]);
        } else {
            const code = ch.charCodeAt(0);
            if (code === 0x0A || (code >= 0x20 && code <= 0x7E)) {
                out.push(code);
            } else {
                // Fallback seguro para cualquier símbolo fuera de PC850
                const stripped = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                for (let j = 0; j < stripped.length; j++) {
                    const c2 = stripped.charCodeAt(j);
                    if (c2 >= 0x20 && c2 <= 0x7E) out.push(c2);
                }
            }
        }
    }
    return out;
}

function wrapTextWords(text, maxCols) {
    const words = String(text || '').trim().split(/\s+/);
    const lines = [];
    let current = '';

    for (const word of words) {
        if (!word) continue;
        if (current.length === 0) {
            if (word.length <= maxCols) {
                current = word;
            } else {
                for (let i = 0; i < word.length; i += maxCols) {
                    const chunk = word.slice(i, i + maxCols);
                    if (i + maxCols < word.length) lines.push(chunk);
                    else current = chunk;
                }
            }
        } else if (current.length + 1 + word.length <= maxCols) {
            current += ' ' + word;
        } else {
            lines.push(current);
            if (word.length <= maxCols) {
                current = word;
            } else {
                current = '';
                for (let i = 0; i < word.length; i += maxCols) {
                    const chunk = word.slice(i, i + maxCols);
                    if (i + maxCols < word.length) lines.push(chunk);
                    else current = chunk;
                }
            }
        }
    }
    if (current.length > 0) lines.push(current);
    return lines.length > 0 ? lines : [''];
}

function buildEscPosBytes(data) {
    // 3nStar RPT004 / POS-80C (80mm papel / 72mm imprimible / 576 dots -> Font A 12x24 = 48 cols)
    const is80mm = printerPaperWidth !== 58;
    const cols1x = is80mm ? 48 : 32;
    const cols2x = is80mm ? 24 : 16;

    const sepDash = '-'.repeat(cols1x);
    const sepEq = '='.repeat(cols1x);
    const bytes = [];

    const pushBytes = (arr) => {
        for (let i = 0; i < arr.length; i++) bytes.push(arr[i]);
    };
    const pushText = (text) => {
        pushBytes(encodePC850Bytes(text));
    };
    const pushLine = (text = '') => {
        pushText(text + '\n');
    };
    const feedDots = (dots) => {
        pushBytes([0x1B, 0x4A, Math.max(0, Math.min(255, dots))]);
    };
    const pushLeftRight = (left, right, maxCols = cols1x) => {
        const l = String(left || '');
        const r = String(right || '');
        const maxLeft = Math.max(6, maxCols - r.length - 1);
        if (l.length <= maxLeft) {
            const spaces = Math.max(1, maxCols - l.length - r.length);
            pushLine(l + ' '.repeat(spaces) + r);
        } else {
            const wrapped = wrapTextWords(l, maxLeft);
            const first = wrapped[0];
            const spaces = Math.max(1, maxCols - first.length - r.length);
            pushLine(first + ' '.repeat(spaces) + r);
            for (let idx = 1; idx < wrapped.length; idx++) {
                pushLine('  ' + wrapped[idx]);
            }
        }
    };

    // Comandos ESC/POS limpios: trazo normal nítido (BOLD_OFF por defecto) para evitar letra gruesa o empastada
    const INIT = [0x1B, 0x40];
    const CODEPAGE_PC850 = [0x1B, 0x74, 0x02];
    const FONT_A = [0x1B, 0x4D, 0x00];                              // Font A estándar 12x24
    const LEFT_MARGIN_0 = [0x1D, 0x4C, 0x00, 0x00];
    const PRINT_WIDTH = is80mm
        ? [0x1D, 0x57, 0x40, 0x02]
        : [0x1D, 0x57, 0x80, 0x01];
    const LINE_SPACING_DEFAULT = [0x1B, 0x32];                      // Interlineado natural ESC 2
    const ALIGN_LEFT = [0x1B, 0x61, 0x00];
    const ALIGN_CENTER = [0x1B, 0x61, 0x01];
    const BOLD_ON = [0x1B, 0x45, 0x01];
    const BOLD_OFF = [0x1B, 0x45, 0x00];
    const DOUBLE_STRIKE_OFF = [0x1B, 0x47, 0x00];                   // Desactivar doble pasada para trazo fino y limpio
    const SIZE_1X = [0x1D, 0x21, 0x00];                             // 1x ancho, 1x alto (48 cols, fino y nítido)
    const SIZE_1X2 = [0x1D, 0x21, 0x01];                            // 1x ancho, 2x alto (48 cols, alto pero estilizado)
    const SIZE_2X2 = [0x1D, 0x21, 0x11];                            // 2x ancho, 2x alto (24 cols, solo títulos)
    const FEED_AND_CUT = [0x1B, 0x64, 0x04, 0x1D, 0x56, 0x42, 0x03];

    pushBytes(INIT);
    pushBytes(CODEPAGE_PC850);
    pushBytes(FONT_A);
    pushBytes(LEFT_MARGIN_0);
    pushBytes(PRINT_WIDTH);
    pushBytes(LINE_SPACING_DEFAULT);
    pushBytes(DOUBLE_STRIKE_OFF);
    pushBytes(BOLD_OFF);

    if (!data) {
        pushBytes(ALIGN_LEFT);
        pushBytes(SIZE_1X);
        pushLine(currentTicketRawText || '');
        pushBytes(FEED_AND_CUT);
        return new Uint8Array(bytes);
    }

    const bizNameUpper = String((data && data.businessName) || (ticketConfig && ticketConfig.businessName) || 'SARMIENTO').toUpperCase();

    if (data.type === 'kitchen') {
        const kitchenItems = Array.isArray(data.itemsToPrint) ? data.itemsToPrint : (data.pendingItems || []);
        const kitchenSubtitle = data.isReprint ? 'REIMPRESION - COMANDA' : 'COMANDA DE COCINA';

        // 1. ENCABEZADO (Trazo limpio sin negrita forzada)
        pushBytes(ALIGN_CENTER);
        pushBytes(BOLD_OFF);
        pushBytes(SIZE_1X2);
        pushLine(bizNameUpper);
        pushBytes(SIZE_1X);
        pushLine(kitchenSubtitle);
        pushLine(sepDash);

        // 2. MESA Y COMANDA
        pushBytes(ALIGN_CENTER);
        pushBytes(SIZE_2X2);
        pushLine(String(data.table || '').toUpperCase());
        pushBytes(SIZE_1X);
        pushLine(`Comanda: ${data.id}`);
        pushLine(sepDash);

        // 3. FECHA, HORA Y MOZO (Tamaño 1x normal y fino)
        pushBytes(ALIGN_LEFT);
        pushBytes(SIZE_1X);
        const dateLabel = data.dateStr ? `Fecha: ${data.dateStr}` : '';
        const timeLabel = `Hora: ${data.time} hs`;
        if (dateLabel) {
            pushLeftRight(dateLabel, timeLabel, cols1x);
        } else {
            pushLine(timeLabel);
        }
        pushLine(`Mozo: ${data.waiter}`);
        pushLine(sepDash);

        // 4. PRODUCTOS POR PREPARAR (1x2 estilizado sin ensanchar la letra y sin BOLD_ON grueso)
        if (kitchenItems.length > 0) {
            pushBytes(ALIGN_LEFT);
            kitchenItems.forEach((i, idx) => {
                const qtyTag = `${i.qty}x `;
                const indent = ' '.repeat(qtyTag.length);
                const availForName = Math.max(12, cols1x - qtyTag.length);
                const wrappedName = wrapTextWords(i.name, availForName);

                pushBytes(BOLD_OFF);
                pushBytes(SIZE_1X2);
                pushLine(qtyTag + wrappedName[0]);
                for (let k = 1; k < wrappedName.length; k++) {
                    pushLine(indent + wrappedName[k]);
                }

                if (i.note) {
                    pushBytes(SIZE_1X);
                    const noteLines = wrapTextWords(`OBS: ${i.note}`, cols1x - 3);
                    noteLines.forEach(nl => pushLine('   ' + nl));
                }

                pushBytes(SIZE_1X);
                if (idx < kitchenItems.length - 1) {
                    feedDots(6);
                }
            });
            pushBytes(SIZE_1X);
            pushLine(sepDash);
        }

        // 5. OBSERVACIONES GENERALES
        if (data.note) {
            pushBytes(ALIGN_LEFT);
            pushBytes(SIZE_1X);
            pushLine('OBSERVACIONES:');
            const obsLines = wrapTextWords(data.note, cols1x);
            obsLines.forEach(ol => pushLine(ol));
            pushLine(sepDash);
        }
    } else if (data.type === 'closure') {
        pushBytes(ALIGN_CENTER);
        pushBytes(BOLD_OFF);
        pushBytes(SIZE_1X2);
        pushLine(bizNameUpper);
        pushBytes(SIZE_1X);
        pushLine('CIERRE DE TURNO / AUDITORIA');
        pushLine(sepDash);

        pushBytes(ALIGN_LEFT);
        pushLeftRight(`Fecha: ${data.dateStr}`, `Hora: ${data.time}`, cols1x);
        pushLine(sepDash);

        pushBytes(BOLD_ON);
        pushLeftRight('FACTURACION TOTAL:', `$${data.totalSales.toLocaleString('es-AR')}`, cols1x);
        pushBytes(BOLD_OFF);
        pushLeftRight('  Efectivo en caja:', `$${data.cashSales.toLocaleString('es-AR')}`, cols1x);
        pushLeftRight('  Transferencias:', `$${data.transferSales.toLocaleString('es-AR')}`, cols1x);
        pushLeftRight('  Pozo de propinas:', `$${data.tipsPool.toLocaleString('es-AR')}`, cols1x);
        pushLeftRight('  Mesas cobradas:', `${data.ordersCount}`, cols1x);
        pushLine(sepDash);

        pushBytes(ALIGN_CENTER);
        pushLine('VENTAS POR CATEGORIA');
        pushBytes(ALIGN_LEFT);
        (data.categories || []).forEach(c => {
            pushLeftRight(String(c.name).toUpperCase(), `$${Number(c.revenue).toLocaleString('es-AR')}`, cols1x);
            pushLine(`  ${formatSalesQtyLabel(c.units, c.persons)} (${c.pct}%)`);
            (c.subList || []).forEach(s => {
                pushLeftRight(`   - ${s.name}: ${formatSalesQtyLabel(s.units, s.persons)}`, `$${Number(s.revenue).toLocaleString('es-AR')}`, cols1x);
            });
        });
        pushLine(sepDash);

        if (Array.isArray(data.topProducts) && data.topProducts.length > 0) {
            pushBytes(ALIGN_CENTER);
            pushLine('LO MAS VENDIDO');
            pushBytes(ALIGN_LEFT);
            data.topProducts.forEach((p, idx) => {
                pushLeftRight(`${idx + 1}. ${p.name}`, `${p.qty} ${p.isPersons ? 'pers.' : 'u.'}`, cols1x);
            });
            pushLine(sepDash);
        }

        if (Array.isArray(data.topFlavors) && data.topFlavors.length > 0) {
            pushBytes(ALIGN_CENTER);
            pushLine('GUSTOS DE PIZZA MAS VENDIDOS');
            pushBytes(ALIGN_LEFT);
            data.topFlavors.slice(0, 5).forEach((f, idx) => {
                pushLeftRight(`${idx + 1}. ${f.name}`, `${f.pizzaEquiv} piz. (${f.orders} ped.)`, cols1x);
            });
            pushLine(sepDash);
        }

        pushBytes(ALIGN_CENTER);
        pushLine('SARMIENTO POS');
    } else {
        // TICKET CUENTA / PRE-CUENTA (Tipografía clásica fina y prolija de 1x)
        pushBytes(ALIGN_CENTER);
        pushBytes(BOLD_OFF);
        pushBytes(SIZE_1X2);
        pushLine(bizNameUpper);
        pushBytes(SIZE_1X);
        pushLine('CONTROL DE MESA / CUENTA');
        pushLine('NO VALIDO COMO FACTURA FISCAL');
        pushLine(sepDash);

        pushBytes(ALIGN_CENTER);
        pushBytes(BOLD_ON);
        pushLine(String(data.table || '').toUpperCase());
        pushBytes(BOLD_OFF);
        pushBytes(ALIGN_LEFT);
        pushLeftRight(`Fecha: ${data.dateStr}`, `${data.timeStr} hs`, cols1x);
        pushLine(`Mozo: ${data.waiter}`);
        pushLine(sepDash);

        pushLeftRight('CANT / PRODUCTO', 'SUBTOTAL', cols1x);
        pushLine(sepDash);

        (data.items || []).forEach(i => {
            pushBytes(BOLD_OFF);
            pushBytes(SIZE_1X);
            const label = `${i.qty}x ${formatBillItemName(i)}`;
            const sub = `$${(i.price * i.qty).toLocaleString('es-AR')}`;
            pushLeftRight(label, sub, cols1x);
        });

        pushLine(sepDash);

        pushBytes(BOLD_ON);
        pushBytes(SIZE_1X2);
        pushLeftRight('TOTAL:', `$${data.total.toLocaleString('es-AR')}`, cols1x);
        pushBytes(SIZE_1X);
        pushBytes(BOLD_OFF);

        if (data.showSuggestedTip) {
            feedDots(4);
            pushLeftRight('Propina sugerida (10%):', `$${data.suggestedTip10.toLocaleString('es-AR')}`, cols1x);
            pushLeftRight('Total con 10% propina:', `$${data.totalWithTip10.toLocaleString('es-AR')}`, cols1x);
        }

        if (data.alias && String(data.alias).trim()) {
            pushLine(sepDash);
            pushBytes(ALIGN_CENTER);
            pushLine('ALIAS TRANSFERENCIA:');
            const aliasLines = wrapTextWords(String(data.alias).trim(), cols1x);
            aliasLines.forEach(al => pushLine(al));
        }

        if (data.footerMessage && String(data.footerMessage).trim()) {
            pushLine(sepDash);
            pushBytes(ALIGN_CENTER);
            const rawLines = String(data.footerMessage).trim().split('\n');
            rawLines.forEach(rl => {
                wrapTextWords(rl, cols1x).forEach(wl => pushLine(wl));
            });
        }
    }

    pushBytes(FEED_AND_CUT);
    return new Uint8Array(bytes);
}

function uint8ToBase64(uint8) {
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
}

function escapeHtmlSafe(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildThermalPrintHtml(data) {
    const is80mm = printerPaperWidth !== 58;
    const printWidthMm = is80mm ? 72 : 48;
    const bizName = (data && data.businessName) || (ticketConfig && ticketConfig.businessName) || 'SARMIENTO';

    let bodyContent = '';
    if (!data) {
        const ticketArea = document.getElementById('printable-ticket-area');
        bodyContent = ticketArea ? ticketArea.innerHTML : `<pre>${escapeHtmlSafe(currentTicketRawText)}</pre>`;
    } else if (data.type === 'kitchen') {
        const kitchenItems = Array.isArray(data.itemsToPrint) ? data.itemsToPrint : (data.pendingItems || []);
        const kitchenSubtitle = data.isReprint ? 'REIMPRESIÓN - COMANDA' : 'COMANDA DE COCINA';
        bodyContent = `
            <div class="header-block">
                <div class="brand-title">${escapeHtmlSafe(bizName)}</div>
                <div class="doc-subtitle">${kitchenSubtitle}</div>
            </div>

            <div class="table-banner">
                <div class="table-name">${escapeHtmlSafe(data.table)}</div>
                <div class="cmd-id">Comanda: ${escapeHtmlSafe(data.id)}</div>
            </div>

            <div class="meta-block">
                <div class="meta-row">
                    <span>Fecha: ${escapeHtmlSafe(data.dateStr || '')}</span>
                    <span>Hora: ${escapeHtmlSafe(data.time)} hs</span>
                </div>
                <div class="meta-row">
                    <span>Mozo: ${escapeHtmlSafe(data.waiter)}</span>
                </div>
            </div>

            ${kitchenItems.length > 0 ? `
                <div class="section-title">POR PREPARAR</div>
                <div class="items-list">
                    ${kitchenItems.map(i => `
                        <div class="kitchen-item">
                            <div class="kitchen-item-row">
                                <span class="qty-box">${i.qty}x</span>
                                <div class="item-main">
                                    <div class="item-name">${escapeHtmlSafe(i.name)}</div>
                                    ${i.note ? `<div class="item-note">OBS: ${escapeHtmlSafe(i.note)}</div>` : ''}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            ${data.note ? `
                <div class="obs-box">
                    <div class="obs-label">OBSERVACIONES:</div>
                    <div class="obs-text">${escapeHtmlSafe(data.note)}</div>
                </div>
            ` : ''}
        `;
    } else if (data.type === 'closure') {
        const topFlavorsHtml = (Array.isArray(data.topFlavors) && data.topFlavors.length > 0)
            ? data.topFlavors.slice(0, 5).map((f, idx) => `
                <div class="meta-row">
                    <span>${idx + 1}. ${escapeHtmlSafe(f.name)}</span>
                    <span style="text-align:right;">${f.pizzaEquiv} piz. (${f.orders} ped.)</span>
                </div>
            `).join('')
            : '<div class="legal-note">Sin pizzas registradas</div>';

        bodyContent = `
            <div class="header-block">
                <div class="brand-title">${escapeHtmlSafe(bizName)}</div>
                <div class="doc-subtitle">CIERRE DE TURNO / AUDITORIA</div>
            </div>

            <div class="meta-block">
                <div class="meta-row">
                    <span>Fecha: ${escapeHtmlSafe(data.dateStr)}</span>
                    <span>Hora: ${escapeHtmlSafe(data.time)} hs</span>
                </div>
            </div>

            <div class="meta-block">
                <div class="meta-row strong-row">
                    <span>FACTURACION TOTAL:</span>
                    <span>$${data.totalSales.toLocaleString('es-AR')}</span>
                </div>
                <div class="meta-row">
                    <span>Efectivo en caja:</span>
                    <span>$${data.cashSales.toLocaleString('es-AR')}</span>
                </div>
                <div class="meta-row">
                    <span>Transferencias:</span>
                    <span>$${data.transferSales.toLocaleString('es-AR')}</span>
                </div>
                <div class="meta-row">
                    <span>Pozo de propinas:</span>
                    <span>$${data.tipsPool.toLocaleString('es-AR')}</span>
                </div>
                <div class="meta-row">
                    <span>Mesas cobradas:</span>
                    <span>${data.ordersCount}</span>
                </div>
            </div>

            <div class="meta-block">
                <div class="cmd-id" style="text-align:center; margin-bottom: 1mm;">VENTAS POR CATEGORIA</div>
                ${(data.categories || []).map(c => `
                    <div class="meta-row strong-row">
                        <span>${escapeHtmlSafe(c.name)} (${formatSalesQtyLabel(c.units, c.persons)})</span>
                        <span>$${Number(c.revenue).toLocaleString('es-AR')}</span>
                    </div>
                    ${(c.subList || []).map(s => `
                        <div class="meta-row">
                            <span>&nbsp;&nbsp;- ${escapeHtmlSafe(s.name)}: ${formatSalesQtyLabel(s.units, s.persons)}</span>
                            <span>$${Number(s.revenue).toLocaleString('es-AR')}</span>
                        </div>
                    `).join('')}
                `).join('') || '<div class="legal-note">Sin ventas registradas</div>'}
            </div>

            <div class="meta-block">
                <div class="cmd-id" style="text-align:center; margin-bottom: 1mm;">LO MAS VENDIDO</div>
                ${(data.topProducts || []).map((p, idx) => `
                    <div class="meta-row">
                        <span>${idx + 1}. ${escapeHtmlSafe(p.name)}</span>
                        <span>${p.qty} ${p.isPersons ? 'pers.' : 'u.'}</span>
                    </div>
                `).join('') || '<div class="legal-note">Sin ventas registradas</div>'}
            </div>

            <div class="meta-block">
                <div class="cmd-id" style="text-align:center; margin-bottom: 1mm;">TOP GUSTOS DE PIZZA</div>
                ${topFlavorsHtml}
            </div>

            <div class="footer-block">
                <div class="legal-note" style="text-align:center;">Sarmiento POS - Resumen de Turno</div>
            </div>
        `;
    } else {
        bodyContent = `
            <div class="header-block">
                <div class="brand-title">${escapeHtmlSafe(bizName)}</div>
                <div class="doc-subtitle">CONTROL DE MESA / CUENTA</div>
                <div class="legal-note">NO VÁLIDO COMO FACTURA FISCAL</div>
            </div>

            <div class="table-banner">
                <div class="table-name">${escapeHtmlSafe(data.table)}</div>
            </div>

            <div class="meta-block">
                <div class="meta-row">
                    <span>Fecha: ${escapeHtmlSafe(data.dateStr)}</span>
                    <span>Hora: ${escapeHtmlSafe(data.timeStr)} hs</span>
                </div>
                <div class="meta-row">
                    <span>Mozo: ${escapeHtmlSafe(data.waiter)}</span>
                </div>
            </div>

            <div class="bill-cols-header">
                <span>CANT / PRODUCTO</span>
                <span>SUBTOTAL</span>
            </div>

            <div class="items-list">
                ${(data.items || []).map(i => `
                    <div class="bill-item">
                        <div class="bill-item-row">
                            <span class="bill-item-name">${i.qty}x ${escapeHtmlSafe(formatBillItemName(i))}</span>
                            <span class="bill-item-price">$${(i.price * i.qty).toLocaleString('es-AR')}</span>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="total-block">
                <span>TOTAL:</span>
                <span>$${data.total.toLocaleString('es-AR')}</span>
            </div>

            ${data.showSuggestedTip ? `
                <div class="tips-block">
                    <div class="meta-row">
                        <span>Propina sugerida (10%):</span>
                        <span>$${data.suggestedTip10.toLocaleString('es-AR')}</span>
                    </div>
                    <div class="meta-row strong-row">
                        <span>Total con 10% propina:</span>
                        <span>$${data.totalWithTip10.toLocaleString('es-AR')}</span>
                    </div>
                </div>
            ` : ''}

            ${data.alias ? `
                <div class="obs-box" style="text-align:center;">
                    <div class="obs-label" style="border-bottom:none; margin-bottom:0.5mm;">ALIAS TRANSFERENCIA</div>
                    <div class="obs-text" style="word-break:break-all;">${escapeHtmlSafe(data.alias)}</div>
                </div>
            ` : ''}

            ${data.footerMessage ? `
                <div class="footer-block">
                    <div class="footer-thanks" style="white-space:pre-line;">${escapeHtmlSafe(data.footerMessage)}</div>
                </div>
            ` : ''}
        `;
    }

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ticket Sarmiento POS</title>
<style>
  @page {
    size: ${printWidthMm}mm auto;
    margin: 0mm !important;
  }
  * {
    box-sizing: border-box;
    color: #000000 !important;
  }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: ${printWidthMm}mm !important;
    max-width: ${printWidthMm}mm !important;
    background: #ffffff !important;
    font-family: 'Courier New', Courier, monospace;
    font-weight: 400;
  }
  .ticket-root {
    width: ${printWidthMm}mm;
    padding: 1mm 0mm 4mm 0mm;
  }
  .header-block {
    text-align: center;
    padding-bottom: 1.5mm;
    border-bottom: 0.3mm solid #000;
  }
  .brand-title {
    font-size: ${is80mm ? '15pt' : '12pt'};
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .doc-subtitle {
    font-size: ${is80mm ? '9.5pt' : '8.5pt'};
    font-weight: 400;
    margin-top: 0.5mm;
    text-transform: uppercase;
  }
  .legal-note {
    font-size: ${is80mm ? '8.5pt' : '7.5pt'};
    font-weight: 400;
    margin-top: 0.5mm;
  }
  .table-banner {
    text-align: center;
    padding: 1.5mm 0;
    border-bottom: 0.3mm solid #000;
  }
  .table-name {
    font-size: ${is80mm ? '14pt' : '11.5pt'};
    font-weight: 700;
    line-height: 1.15;
    text-transform: uppercase;
  }
  .cmd-id {
    font-size: ${is80mm ? '9.5pt' : '8.5pt'};
    font-weight: 400;
    margin-top: 0.5mm;
  }
  .meta-block {
    padding: 1.5mm 0;
    border-bottom: 0.3mm dashed #000;
    font-size: ${is80mm ? '9.5pt' : '8.5pt'};
    font-weight: 400;
    line-height: 1.3;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    gap: 2mm;
  }
  .strong-row {
    font-weight: 700;
  }
  .section-title {
    text-align: center;
    font-size: ${is80mm ? '10.5pt' : '9pt'};
    font-weight: 700;
    padding: 1.5mm 0 1mm 0;
    border-bottom: 0.3mm dashed #000;
  }
  .items-list {
    width: 100%;
  }
  .kitchen-item {
    padding: 1.5mm 0;
    border-bottom: 0.25mm dotted #000;
  }
  .kitchen-item:last-child {
    border-bottom: 0.3mm solid #000;
  }
  .kitchen-item-row {
    display: flex;
    align-items: flex-start;
    gap: 2mm;
  }
  .qty-box {
    font-size: ${is80mm ? '12pt' : '10pt'};
    font-weight: 700;
    line-height: 1.2;
    flex-shrink: 0;
  }
  .item-main {
    flex: 1;
    min-width: 0;
  }
  .item-name {
    font-size: ${is80mm ? '12pt' : '10pt'};
    font-weight: 400;
    line-height: 1.2;
    word-wrap: break-word;
  }
  .item-note {
    font-size: ${is80mm ? '10pt' : '8.5pt'};
    font-weight: 400;
    margin-top: 0.5mm;
    line-height: 1.2;
  }
  .obs-box {
    margin: 1.5mm 0;
    padding: 1.5mm;
    border: 0.3mm solid #000;
  }
  .obs-label {
    font-size: ${is80mm ? '9.5pt' : '8.5pt'};
    font-weight: 700;
    margin-bottom: 0.5mm;
  }
  .obs-text {
    font-size: ${is80mm ? '10.5pt' : '9pt'};
    font-weight: 400;
    line-height: 1.2;
  }
  .bill-cols-header {
    display: flex;
    justify-content: space-between;
    font-size: ${is80mm ? '9.5pt' : '8.5pt'};
    font-weight: 700;
    padding: 1mm 0;
    border-bottom: 0.3mm dashed #000;
  }
  .bill-item {
    padding: 1mm 0;
  }
  .bill-item:last-child {
    padding-bottom: 1.5mm;
    border-bottom: 0.3mm solid #000;
  }
  .bill-item-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 2mm;
    font-size: ${is80mm ? '10pt' : '8.5pt'};
    font-weight: 400;
    line-height: 1.25;
  }
  .bill-item-name {
    flex: 1;
    word-wrap: break-word;
  }
  .bill-item-price {
    flex-shrink: 0;
  }
  .total-block {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5mm 0;
    font-size: ${is80mm ? '12.5pt' : '10.5pt'};
    font-weight: 700;
    border-bottom: 0.3mm dashed #000;
  }
  .tips-block {
    padding: 1.5mm 0;
    border-bottom: 0.3mm dashed #000;
    font-size: ${is80mm ? '9.5pt' : '8.5pt'};
    font-weight: 400;
    line-height: 1.35;
  }
  .footer-block {
    text-align: center;
    padding-top: 2mm;
  }
  .footer-thanks {
    font-size: ${is80mm ? '9.5pt' : '8.5pt'};
    font-weight: 400;
  }
</style>
</head>
<body>
  <div class="ticket-root">${bodyContent}</div>
</body>
</html>`;
}

function printViaCleanIframe() {
    const oldFrame = document.getElementById('rivera-print-iframe');
    if (oldFrame) oldFrame.remove();

    const iframe = document.createElement('iframe');
    iframe.id = 'rivera-print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(buildThermalPrintHtml(currentTicketData));
    doc.close();

    iframe.contentWindow.focus();
    setTimeout(() => {
        try {
            iframe.contentWindow.print();
        } catch (err) {
            console.warn('Fallback a window.print:', err);
            window.print();
        }
        setTimeout(() => {
            if (iframe && iframe.parentNode) {
                iframe.parentNode.removeChild(iframe);
            }
        }, 2500);
    }, 150);
}

async function triggerBrowserPrint() {
    const confirmKitchenPrinted = () => {
        if (currentTicketData && currentTicketData.type === 'kitchen' && currentTicketData.id) {
            markKitchenOrderPrinted(currentTicketData.id);
        }
    };

    // 0. Impresión RAW ESC/POS directa por Windows (POS-80C / 3nStar RPT004) - Sin ventana de Guardar como PDF
    if (!winPrintEndpoint && !directUsbPrinter && !directSerialPort && !rawBtEnabled) {
        await discoverWindowsBridge(true);
    }
    if (winPrintEndpoint && selectedWinPrinter) {
        try {
            const bytes = buildEscPosBytes(currentTicketData);
            const dataBase64 = uint8ToBase64(bytes);
            const res = await fetchWithTimeout(winPrintEndpoint.printUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    printerName: selectedWinPrinter,
                    dataBase64
                })
            }, 15000);
            const result = await res.json();
            if (!res.ok || !result.success) {
                throw new Error((result && result.error) || 'Error enviando ticket a Windows');
            }
            confirmKitchenPrinted();
            showToast(`Ticket impreso directo en ${selectedWinPrinter}`, 'success');
            closeTicketPrintModal();
            return;
        } catch (err) {
            console.error('Error imprimiendo directo en Windows:', err);
            showToast(`Error imprimiendo en ${selectedWinPrinter}: ${err.message}`, 'error');
            return;
        }
    }

    // 1. Impresión directa por cable USB (ESC/POS) - Sin ventana de Guardar como PDF
    if (directUsbPrinter) {
        try {
            const bytes = buildEscPosBytes(currentTicketData);
            await directUsbPrinter.device.transferOut(directUsbPrinter.endpointNumber, bytes);
            confirmKitchenPrinted();
            showToast('Ticket impreso directo por USB', 'success');
            closeTicketPrintModal();
            return;
        } catch (err) {
            console.error('Error imprimiendo por USB directo:', err);
            directUsbPrinter = null;
            updatePrinterStatusUI();
            showToast('Se desconectó la impresora USB. Reconecta o usa impresora del sistema.', 'error');
            return;
        }
    }

    // 2. Impresión directa por puerto Serial / COM / Bluetooth - Sin ventana de Guardar como PDF
    if (directSerialPort && directSerialPort.writable) {
        let writer = null;
        try {
            const bytes = buildEscPosBytes(currentTicketData);
            writer = directSerialPort.writable.getWriter();
            await writer.write(bytes);
            writer.releaseLock();
            confirmKitchenPrinted();
            showToast('Ticket impreso directo por puerto COM/BT', 'success');
            closeTicketPrintModal();
            return;
        } catch (err) {
            if (writer) {
                try { writer.releaseLock(); } catch (e) {}
            }
            console.error('Error imprimiendo por Serial/COM:', err);
            directSerialPort = null;
            updatePrinterStatusUI();
            showToast('Se desconectó el puerto COM/BT. Reconecta o usa impresora del sistema.', 'error');
            return;
        }
    }

    // 3. Impresión directa en Android con RawBT - Sin ventana de Guardar como PDF
    if (rawBtEnabled) {
        try {
            const bytes = buildEscPosBytes(currentTicketData);
            const b64 = uint8ToBase64(bytes);
            confirmKitchenPrinted();
            window.location.href = `rawbt:base64,${b64}`;
            showToast('Ticket enviado directo a impresora RawBT', 'success');
            closeTicketPrintModal();
            return;
        } catch (err) {
            console.error('Error enviando a RawBT:', err);
            showToast('No se pudo abrir RawBT. Verifica que la app esté instalada.', 'error');
            return;
        }
    }

    // 4. Impresión por spooler del sistema (Windows/Mac) en iframe térmico dedicado
    confirmKitchenPrinted();
    printViaCleanIframe();
}

// ================= PESTAÑA 2: CARTA / MENÚ =================

let adminFilterCatKey = 'all';

function setAdminFilterCat(cKey) {
    adminFilterCatKey = cKey || 'all';
    renderAdminMenuManager();
}

function renderAdminMenuManager() {
    // 1. Selector de categorías para agregar productos
    const select = document.getElementById('new-item-cat');
    const prevSelectedCat = select ? select.value : '';
    select.innerHTML = Object.keys(menuData).map(cKey => `
        <option value="${cKey}">${menuData[cKey].name}</option>
    `).join('');
    if (prevSelectedCat && menuData[prevSelectedCat]) {
        select.value = prevSelectedCat;
    }

    const todayName = getTodayDayName();

    // 2. Lista de categorías existentes con programación por días y switch Activa/Pausada
    const catList = document.getElementById('admin-categories-list');
    catList.innerHTML = Object.keys(menuData).map(cKey => {
        const cat = menuData[cKey];
        const catDays = getCategoryDays(cat);
        const isAllDays = catDays.length >= 7;
        const isActive = cat.isActive !== false;
        const visibleToday = isCategoryAvailableToday(cat);

        const dayPillsHtml = WEEK_DAYS_ORDERED.map(d => {
            const selected = catDays.includes(d.id);
            return `
                <button type="button" onclick="toggleCategoryDay('${cKey}', ${d.id})"
                    class="w-7 h-7 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${selected ? 'bg-[#2563eb] text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}"
                    title="${d.label}">
                    ${d.short}
                </button>
            `;
        }).join('');

        return `
            <div class="p-2.5 rounded-2xl bg-slate-50 border ${visibleToday ? 'border-slate-200' : 'border-amber-300 bg-amber-50/30'} text-xs space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center space-x-2 min-w-0">
                        <i class="fa-solid ${cat.icon || 'fa-utensils'} text-[#2563eb] shrink-0"></i>
                        <span class="font-bold text-slate-800 truncate">${cat.name}</span>
                        <span class="text-[10px] text-slate-400 shrink-0">(${cat.items.length})</span>
                    </div>
                    <div class="flex items-center space-x-1.5 shrink-0">
                        <button type="button" onclick="toggleCategoryActive('${cKey}')"
                            class="px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${isActive ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-200' : 'bg-slate-200 text-slate-600 border border-slate-300 hover:bg-slate-300'}"
                            title="Activar o pausar categoría temporalmente">
                            ${isActive ? 'Activa' : 'Pausada'}
                        </button>
                        <button onclick="deleteCategory('${cKey}')" class="text-rose-500 hover:text-rose-700 p-1.5 min-w-[30px] min-h-[30px] flex items-center justify-center rounded-xl hover:bg-rose-50 transition-colors cursor-pointer" title="Eliminar Categoría">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-slate-200/70">
                    <div class="flex items-center gap-1 flex-wrap">
                        <button type="button" onclick="setCategoryAllDays('${cKey}')"
                            class="px-2 h-7 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${isAllDays ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}">
                            Todos
                        </button>
                        ${dayPillsHtml}
                    </div>
                    <span class="text-[10px] font-semibold ${visibleToday ? 'text-emerald-700' : 'text-amber-800'}">
                        ${visibleToday ? `Visible hoy (${todayName})` : `Oculta hoy (${todayName})`}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    // 3. Catálogo agrupado por categoría con control rápido por plato (Hoy ON/OFF y Días)
    const menuItemsList = document.getElementById('admin-menu-items-list');
    const catFilterBar = document.getElementById('admin-items-cat-filter');
    const adminSearchEl = document.getElementById('admin-items-search');
    const adminQuery = adminSearchEl ? adminSearchEl.value.trim().toLowerCase() : '';

    let totalItems = 0;
    const catKeys = Object.keys(menuData);
    catKeys.forEach(k => {
        totalItems += (menuData[k] && Array.isArray(menuData[k].items)) ? menuData[k].items.length : 0;
    });

    if (adminFilterCatKey !== 'all' && !menuData[adminFilterCatKey]) {
        adminFilterCatKey = 'all';
    }

    if (catFilterBar) {
        const allBtn = `
            <button type="button" onclick="setAdminFilterCat('all')"
                class="px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all shrink-0 cursor-pointer ${adminFilterCatKey === 'all' ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
                Todas (${totalItems})
            </button>
        `;
        const catBtns = catKeys.map(cKey => {
            const c = menuData[cKey];
            const count = Array.isArray(c.items) ? c.items.length : 0;
            const act = adminFilterCatKey === cKey;
            return `
                <button type="button" onclick="setAdminFilterCat('${cKey}')"
                    class="px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all shrink-0 cursor-pointer ${act ? 'bg-[#2563eb] text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
                    ${c.name} (${count})
                </button>
            `;
        }).join('');
        catFilterBar.innerHTML = allBtn + catBtns;
    }

    const keysToRender = adminFilterCatKey === 'all' ? catKeys : [adminFilterCatKey];

    menuItemsList.innerHTML = keysToRender.map(cKey => {
        const cat = menuData[cKey];
        if (!cat) return '';
        const catScheduleLabel = cat.isActive === false ? 'Pausada' : formatDaysSummary(getCategoryDays(cat));
        const filteredItems = (cat.items || []).filter(it => {
            if (!adminQuery) return true;
            const sub = getEffectiveItemSubcategory(it, cKey).toLowerCase();
            return it.name.toLowerCase().includes(adminQuery) ||
                   (it.desc && it.desc.toLowerCase().includes(adminQuery)) ||
                   sub.includes(adminQuery);
        });

        if (adminQuery && filteredItems.length === 0) return '';

        return `
            <div class="space-y-2">
                <h5 class="font-bold text-xs text-slate-700 flex items-center justify-between bg-slate-100 p-2.5 rounded-xl gap-2">
                    <span class="flex items-center space-x-1.5 min-w-0">
                        <i class="fa-solid ${cat.icon || 'fa-utensils'} text-[#2563eb]"></i>
                        <span class="truncate">${cat.name} (${filteredItems.length})</span>
                    </span>
                    <span class="text-[10px] font-semibold text-slate-500 shrink-0">${catScheduleLabel}</span>
                </h5>
                <div class="space-y-1.5">
                    ${filteredItems.length === 0 ? `<p class="text-[11px] text-slate-400 py-2 pl-2">Sin productos cargados en esta categoría.</p>` : filteredItems.map(item => {
                        const isAvail = item.isAvailable !== false;
                        const hasCustomDays = Array.isArray(item.availableDays);
                        const itemToday = isItemAvailableToday(item, cat);
                        const isExpanded = expandedAdminItemDaysId === item.id;

                        let scheduleBadge = '';
                        if (!isAvail) {
                            scheduleBadge = '<span class="text-[9px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-bold">Pausado</span>';
                        } else if (hasCustomDays) {
                            scheduleBadge = `<span class="text-[9px] px-1.5 py-0.2 rounded-full bg-blue-50 text-[#2563eb] border border-blue-200 font-bold">${formatDaysSummary(item.availableDays)}</span>`;
                        }

                        const itemDayPills = isExpanded ? `
                            <div class="mt-2 pt-2 border-t border-slate-200 flex flex-wrap items-center gap-1">
                                <button type="button" onclick="setItemInheritCategoryDays('${cKey}', '${item.id}')"
                                    class="px-2 h-7 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${!hasCustomDays ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}">
                                    Según categoría
                                </button>
                                <button type="button" onclick="setItemAllDays('${cKey}', '${item.id}')"
                                    class="px-2 h-7 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${(hasCustomDays && item.availableDays.length >= 7) ? 'bg-[#2563eb] text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}">
                                    Todos
                                </button>
                                ${WEEK_DAYS_ORDERED.map(d => {
                                    const activeDay = hasCustomDays && item.availableDays.includes(d.id);
                                    return `
                                        <button type="button" onclick="toggleItemDay('${cKey}', '${item.id}', ${d.id})"
                                            class="w-7 h-7 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${activeDay ? 'bg-[#2563eb] text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'}"
                                            title="${d.label}">
                                            ${d.short}
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                        ` : '';

                        return `
                            <div class="p-2 rounded-xl ${itemToday ? 'bg-slate-50 hover:bg-white border-slate-200' : 'bg-amber-50/30 border-amber-200'} border text-xs">
                                <div class="flex items-center justify-between gap-2">
                                    <div class="flex-1 min-w-0 pr-1">
                                        <div class="flex items-center gap-1.5 flex-wrap">
                                            <h6 class="font-bold text-slate-800 truncate">${item.name}</h6>
                                            ${scheduleBadge}
                                            ${isPerPersonMenuItem(item, cKey) ? '<span class="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold">Por persona</span>' : ''}
                                            ${getEffectiveItemSubcategory(item, cKey) ? `<span class="text-[9px] px-1.5 py-0.2 rounded-full bg-slate-200/80 text-slate-700 font-semibold">${escapeHtmlSafe(getEffectiveItemSubcategory(item, cKey))}</span>` : ''}
                                        </div>
                                        ${item.desc ? `<p class="text-[11px] text-slate-400 truncate">${item.desc}</p>` : ''}
                                    </div>
                                    <div class="flex items-center space-x-1 shrink-0">
                                        <span class="font-bold text-slate-900 mr-1">$${item.price.toLocaleString()}</span>
                                        <button type="button" onclick="toggleItemAvailableToday('${cKey}', '${item.id}')"
                                            class="px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${isAvail ? 'bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-200' : 'bg-slate-200 text-slate-600 border border-slate-300 hover:bg-slate-300'}"
                                            title="Activar o pausar este plato">
                                            ${isAvail ? 'Sí' : 'No'}
                                        </button>
                                        ${cKey !== 'pizzas' ? `
                                        <button type="button" onclick="toggleItemPerPerson('${cKey}', '${item.id}')"
                                            class="px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${isPerPersonMenuItem(item, cKey) ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}"
                                            title="Activar/desactivar selector de cantidad de personas (como Pizza Libre / Parrilla)">
                                            <i class="fa-solid fa-users text-[9px] mr-0.5"></i>Pers.
                                        </button>
                                        ` : ''}
                                        <button type="button" onclick="toggleItemDaysEditor('${item.id}')"
                                            class="px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${hasCustomDays || isExpanded ? 'bg-blue-100 text-[#2563eb] border border-blue-300' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}"
                                            title="Elegir días específicos para este plato">
                                            Días
                                        </button>
                                        <button onclick="openEditMenuItemModal('${cKey}', '${item.id}')" class="text-slate-400 hover:text-blue-600 p-1.5 min-w-[30px] min-h-[30px] flex items-center justify-center rounded-xl hover:bg-blue-50 transition-colors cursor-pointer" title="Editar precio o datos">
                                            <i class="fa-solid fa-pen text-xs"></i>
                                        </button>
                                        <button onclick="deleteMenuItem('${cKey}', '${item.id}')" class="text-slate-400 hover:text-rose-600 p-1.5 min-w-[30px] min-h-[30px] flex items-center justify-center rounded-xl hover:bg-rose-50 transition-colors cursor-pointer" title="Eliminar">
                                            <i class="fa-solid fa-trash-can text-xs"></i>
                                        </button>
                                    </div>
                                </div>
                                ${itemDayPills}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');

    document.getElementById('admin-total-products-badge').innerText = `${totalItems} ítems`;
}

async function saveCategoryAvailabilityToServer(cKey) {
    const cat = menuData[cKey];
    if (!cat) return;
    renderAdminMenuManager();
    renderCategoryTabs();
    renderMenuGrid();

    try {
        await fetch(`/api/menu/category/${encodeURIComponent(cKey)}/availability`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                availableDays: getCategoryDays(cat),
                isActive: cat.isActive !== false
            })
        });
    } catch (e) {
        console.warn('Error guardando disponibilidad de categoría:', e);
    }
}

async function toggleCategoryActive(cKey) {
    const cat = menuData[cKey];
    if (!cat) return;
    cat.isActive = cat.isActive === false ? true : false;
    await saveCategoryAvailabilityToServer(cKey);
    showToast(`${cat.name}: ${cat.isActive ? 'Activada' : 'Pausada'}`, 'info');
}

async function setCategoryAllDays(cKey) {
    const cat = menuData[cKey];
    if (!cat) return;
    cat.availableDays = [0, 1, 2, 3, 4, 5, 6];
    cat.isActive = true;
    await saveCategoryAvailabilityToServer(cKey);
    showToast(`${cat.name}: disponible todos los días`, 'success');
}

async function toggleCategoryDay(cKey, dayId) {
    const cat = menuData[cKey];
    if (!cat) return;
    const current = getCategoryDays(cat);
    const exists = current.includes(dayId);
    let next;
    if (exists) {
        next = current.filter(d => d !== dayId);
    } else {
        next = [...current, dayId].sort((a, b) => a - b);
    }
    cat.availableDays = next;
    await saveCategoryAvailabilityToServer(cKey);
}

function toggleItemDaysEditor(itemId) {
    expandedAdminItemDaysId = (expandedAdminItemDaysId === itemId) ? null : itemId;
    renderAdminMenuManager();
}

async function saveItemAvailabilityToServer(cKey, itemId) {
    const cat = menuData[cKey];
    if (!cat) return;
    const item = cat.items.find(i => i.id === itemId);
    if (!item) return;

    renderAdminMenuManager();
    renderCategoryTabs();
    renderMenuGrid();

    try {
        await fetch(`/api/menu/item/${encodeURIComponent(itemId)}/availability`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                availableDays: Array.isArray(item.availableDays) ? item.availableDays : null,
                isAvailable: item.isAvailable !== false
            })
        });
    } catch (e) {
        console.warn('Error guardando disponibilidad de plato:', e);
    }
}

async function toggleItemAvailableToday(cKey, itemId) {
    const cat = menuData[cKey];
    if (!cat) return;
    const item = cat.items.find(i => i.id === itemId);
    if (!item) return;
    item.isAvailable = item.isAvailable === false ? true : false;
    await saveItemAvailabilityToServer(cKey, itemId);
    showToast(`${item.name}: ${item.isAvailable ? 'Disponible' : 'Pausado'}`, 'info');
}

async function setItemInheritCategoryDays(cKey, itemId) {
    const cat = menuData[cKey];
    if (!cat) return;
    const item = cat.items.find(i => i.id === itemId);
    if (!item) return;
    item.availableDays = null;
    await saveItemAvailabilityToServer(cKey, itemId);
    showToast(`${item.name}: usa los días de ${cat.name}`, 'info');
}

async function setItemAllDays(cKey, itemId) {
    const cat = menuData[cKey];
    if (!cat) return;
    const item = cat.items.find(i => i.id === itemId);
    if (!item) return;
    item.availableDays = [0, 1, 2, 3, 4, 5, 6];
    item.isAvailable = true;
    await saveItemAvailabilityToServer(cKey, itemId);
}

async function toggleItemDay(cKey, itemId, dayId) {
    const cat = menuData[cKey];
    if (!cat) return;
    const item = cat.items.find(i => i.id === itemId);
    if (!item) return;
    // Si heredaba de categoría, partir del día tocado para elegir rápido (ej: tocar S -> solo Sábado)
    const current = Array.isArray(item.availableDays) ? item.availableDays.map(Number) : [];
    const exists = current.includes(dayId);
    item.availableDays = exists
        ? current.filter(d => d !== dayId)
        : [...current, dayId].sort((a, b) => a - b);
    await saveItemAvailabilityToServer(cKey, itemId);
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
        availableDays: [0, 1, 2, 3, 4, 5, 6],
        isActive: true,
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
    const subcatEl = document.getElementById('new-item-subcat');
    const perPersonEl = document.getElementById('new-item-per-person');
    const subcategory = subcatEl ? subcatEl.value.trim() : '';
    const perPerson = perPersonEl ? Boolean(perPersonEl.checked) : false;

    if (!catKey || !name || isNaN(price) || price <= 0) {
        showToast('Completa el nombre y un precio válido mayor a 0', 'warning');
        return;
    }

    const newItemId = `it_${Date.now().toString().slice(-6)}`;
    const newItem = {
        id: newItemId,
        name: name,
        price: price,
        desc: desc,
        subcategory: subcategory,
        perPerson: perPerson,
        isAvailable: true,
        availableDays: null
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
    if (subcatEl) subcatEl.value = "";
    if (perPersonEl) perPersonEl.checked = false;

    try {
        const res = await fetch('/api/menu/item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: newItemId, categoryId: catKey, name, price, desc, subcategory, perPerson })
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

function openEditMenuItemModal(catKey, itemId) {
    if (!menuData[catKey] || !Array.isArray(menuData[catKey].items)) return;
    const item = menuData[catKey].items.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('edit-item-cat').value = catKey;
    document.getElementById('edit-item-id').value = item.id;
    document.getElementById('edit-item-name').value = item.name;
    document.getElementById('edit-item-price').value = item.price;
    document.getElementById('edit-item-desc').value = item.desc || '';
    const subcatEl = document.getElementById('edit-item-subcat');
    if (subcatEl) subcatEl.value = item.subcategory || '';
    const perPersonEl = document.getElementById('edit-item-per-person');
    if (perPersonEl) perPersonEl.checked = isPerPersonMenuItem(item, catKey);

    document.getElementById('admin-edit-item-modal').classList.remove('hidden');
}

function closeEditMenuItemModal() {
    document.getElementById('admin-edit-item-modal').classList.add('hidden');
}

async function saveEditedMenuItem() {
    const catKey = document.getElementById('edit-item-cat').value;
    const itemId = document.getElementById('edit-item-id').value;
    const name = document.getElementById('edit-item-name').value.trim();
    const price = parseFloat(document.getElementById('edit-item-price').value) || 0;
    const desc = document.getElementById('edit-item-desc').value.trim();
    const subcatEl = document.getElementById('edit-item-subcat');
    const perPersonEl = document.getElementById('edit-item-per-person');
    const subcategory = subcatEl ? subcatEl.value.trim() : '';
    const perPerson = perPersonEl ? Boolean(perPersonEl.checked) : false;

    if (!name || price <= 0) {
        showToast('Ingresa un nombre y precio válido', 'warning');
        return;
    }

    if (menuData[catKey]) {
        const item = menuData[catKey].items.find(i => i.id === itemId);
        if (item) {
            item.name = name;
            item.price = price;
            item.desc = desc;
            item.subcategory = subcategory;
            item.perPerson = perPerson;
        }
    }

    saveLocalState();
    closeEditMenuItemModal();
    renderAdminMenuManager();
    renderMenuGrid();

    try {
        const res = await fetch('/api/menu/item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: itemId, categoryId: catKey, name, price, desc, subcategory, perPerson })
        });
        if (res.ok) {
            isOnlineWithServer = true;
            setConnectionIndicator(true);
        }
    } catch (e) {
        console.warn('Error guardando cambios en Neon DB:', e);
    }

    showToast(`Plato "${name}" actualizado en la base de datos`, 'success');
}

// ================= PESTAÑA 3: REPORTE DE LA NOCHE Y PDF =================

// ================= AUDITORÍA Y ANALÍTICA DE PIZZAS Y GUSTOS =================

function normalizePizzaFlavorName(name) {
    if (!name) return '';
    let clean = String(name).trim()
        .replace(/^Pizza\s+/i, '')
        .replace(/^\d+\/\d+\s*/, '')
        .replace(/\(Entera\)/i, '')
        .replace(/\[.*?\]/g, '')
        .trim();
    if (clean.length === 0) return '';
    return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function parsePizzaFlavorsFromItem(itemName, itemNote) {
    const result = [];
    const name = String(itemName || '').trim();
    const note = String(itemNote || '').trim();
    const lowerName = name.toLowerCase();

    // Caso Pizza Libre: detectar si se especificaron gustos en las notas
    if (lowerName.includes('pizza libre')) {
        const m = note.match(/Gustos:\s*([^|\]\n]+)/i);
        if (m) {
            const parts = m[1].split(/,| y |\+/i).map(s => normalizePizzaFlavorName(s)).filter(Boolean);
            const frac = parts.length > 0 ? (1 / parts.length) : 0.5;
            parts.forEach(p => result.push({ flavor: p, fraction: frac, isLibre: true }));
        }
        return result;
    }

    // Separador con barra ' / ' (ej: Pizza: Muzzarella / Roquefort)
    if (name.includes(' / ')) {
        const raw = name.replace(/^Pizza:\s*/i, '').replace(/^Pizza\s+/i, '');
        const parts = raw.split(' / ').map(s => normalizePizzaFlavorName(s)).filter(Boolean);
        const frac = parts.length > 0 ? (1 / parts.length) : 1;
        parts.forEach(p => result.push({ flavor: p, fraction: frac, isLibre: false }));
        return result;
    }

    // Formato con fracciones '1/2' o '1/3'
    if (name.includes('1/2') || name.includes('1/3') || /gustos/i.test(name)) {
        const afterColon = name.includes(':') ? name.split(':')[1] : name;
        const parts = afterColon.split('+').map(s => normalizePizzaFlavorName(s)).filter(Boolean);
        const frac = parts.length > 0 ? (1 / parts.length) : (name.includes('1/3') ? (1 / 3) : 0.5);
        parts.forEach(p => result.push({ flavor: p, fraction: frac, isLibre: false }));
        return result;
    }

    // Entera tradicional
    const single = normalizePizzaFlavorName(name);
    if (single) {
        result.push({ flavor: single, fraction: 1.0, isLibre: false });
    }
    return result;
}

function computePizzaAndFlavorStats(payments = paymentHistory) {
    let librePersonsTotal = 0;
    let libreTablesCount = 0;
    let libreRevenue = 0;
    let libreRoundsCount = 0;

    let traditionalPizzasCount = 0;
    let traditionalRevenue = 0;

    const flavorStats = {};

    payments.forEach(p => {
        let pLibrePersons = 0;
        let pLibreRevenue = 0;
        let pTableHadLibre = false;

        if (Array.isArray(p.items) && p.items.length > 0) {
            p.items.forEach(it => {
                const isLibre = Boolean(
                    it.isPizzaLibre || 
                    (it.id && String(it.id).startsWith('pz_libre')) || 
                    (it.name && /pizza\s*libre/i.test(it.name))
                );

                if (isLibre) {
                    pTableHadLibre = true;
                    libreRoundsCount += 1;

                    if (it.price > 0) {
                        const persons = it.librePersons || it.qty || 1;
                        pLibrePersons += persons;
                        pLibreRevenue += (it.price * (it.qty || persons));
                    } else if (!pLibrePersons && it.librePersons) {
                        pLibrePersons = it.librePersons;
                    }

                    const flavors = parsePizzaFlavorsFromItem(it.name, it.note);
                    flavors.forEach(f => {
                        const fname = f.flavor;
                        if (!flavorStats[fname]) flavorStats[fname] = { orders: 0, pizzaEquiv: 0 };
                        flavorStats[fname].orders += 1;
                        flavorStats[fname].pizzaEquiv += f.fraction;
                    });
                } else {
                    const isPizzaItem = Boolean(
                        it.isPizza || 
                        (it.id && String(it.id).startsWith('pz_')) || 
                        (it.name && /pizza/i.test(it.name))
                    );

                    if (isPizzaItem) {
                        const qty = it.qty || 1;
                        traditionalPizzasCount += qty;
                        traditionalRevenue += (it.price * qty);

                        const flavors = parsePizzaFlavorsFromItem(it.name, it.note);
                        flavors.forEach(f => {
                            const fname = f.flavor;
                            if (!flavorStats[fname]) flavorStats[fname] = { orders: 0, pizzaEquiv: 0 };
                            flavorStats[fname].orders += qty;
                            flavorStats[fname].pizzaEquiv += (f.fraction * qty);
                        });
                    }
                }
            });
        } else if (p.itemsSummary) {
            if (/pizza\s*libre/i.test(p.itemsSummary)) {
                pTableHadLibre = true;
                const m = p.itemsSummary.match(/(\d+)\s*personas/i) || p.itemsSummary.match(/(\d+)x\s*Pizza libre/i);
                pLibrePersons = m ? parseInt(m[1], 10) : 1;
                pLibreRevenue = p.total;
                libreRoundsCount += 1;
            }
        }

        if (pTableHadLibre) {
            libreTablesCount += 1;
            librePersonsTotal += (pLibrePersons || 1);
            libreRevenue += pLibreRevenue;
        }
    });

    const totalPizzasDespachadas = traditionalPizzasCount + libreRoundsCount;

    const sortedFlavors = Object.keys(flavorStats)
        .map(name => ({
            name,
            orders: flavorStats[name].orders,
            pizzaEquiv: Math.round(flavorStats[name].pizzaEquiv * 10) / 10
        }))
        .sort((a, b) => (b.pizzaEquiv !== a.pizzaEquiv ? b.pizzaEquiv - a.pizzaEquiv : b.orders - a.orders));

    return {
        librePersonsTotal,
        libreTablesCount,
        libreRevenue,
        libreRoundsCount,
        traditionalPizzasCount,
        traditionalRevenue,
        totalPizzasDespachadas,
        sortedFlavors
    };
}

// ================= REPORTES POR CATEGORÍA (TODA LA CARTA) =================

function findMenuItemLocation(itemId) {
    if (!itemId) return null;
    for (const catKey in menuData) {
        const cat = menuData[catKey];
        const found = (cat && Array.isArray(cat.items)) ? cat.items.find(i => i.id === itemId) : null;
        if (found) return { catKey, cat, item: found };
    }
    return null;
}

function isPizzaLibreSoldItem(it) {
    return Boolean(
        it && (it.isPizzaLibre ||
        (it.id && String(it.id).startsWith('pz_libre')) ||
        (it.name && /pizza\s*libre/i.test(it.name)))
    );
}

function getSoldItemBaseName(it) {
    if (it.baseName) return it.baseName;
    return String(it.name || '').replace(/\s*\(\d+\s*personas?\)\s*$/i, '').trim();
}

function resolveSoldItemCategory(it) {
    const loc = findMenuItemLocation(it.menuItemId) || findMenuItemLocation(it.id);
    let catKey = it.categoryId || (loc ? loc.catKey : '');
    if (!catKey && (isPizzaLibreSoldItem(it) || it.isPizza || (it.id && String(it.id).startsWith('pz_')))) {
        catKey = 'pizzas';
    }
    if (!catKey) catKey = 'otros';
    const cat = menuData[catKey];
    return {
        catKey,
        catName: cat ? cat.name : (catKey === 'pizzas' ? 'Pizzas' : 'Otros'),
        icon: (cat && cat.icon) ? cat.icon : (catKey === 'pizzas' ? 'fa-pizza-slice' : 'fa-utensils'),
        subcategory: String(it.subcategory || (loc && loc.item.subcategory) || '').trim()
    };
}

function formatSalesQtyLabel(units, persons) {
    const parts = [];
    if (units > 0) parts.push(`${units} u.`);
    if (persons > 0) parts.push(`${persons} pers.`);
    return parts.length > 0 ? parts.join(' + ') : '0 u.';
}

function computeCategorySales(payments = paymentHistory) {
    const cats = {};
    let grandRevenue = 0;

    payments.forEach(p => {
        const items = Array.isArray(p.items) ? p.items : [];
        items.forEach(it => {
            const qty = Number(it.qty) || 0;
            const price = Number(it.price) || 0;
            const revenue = qty * price;
            const info = resolveSoldItemCategory(it);

            if (!cats[info.catKey]) {
                cats[info.catKey] = { key: info.catKey, name: info.catName, icon: info.icon, units: 0, persons: 0, revenue: 0, extraRounds: 0, subs: {} };
            }
            const c = cats[info.catKey];

            let units = 0;
            let persons = 0;
            if (isPizzaLibreSoldItem(it)) {
                if (price > 0) persons = Number(it.librePersons) || qty || 1;
                else c.extraRounds += 1;
            } else if (it.perPerson) {
                persons = qty;
            } else {
                units = qty;
            }

            c.units += units;
            c.persons += persons;
            c.revenue += revenue;
            grandRevenue += revenue;

            if (info.subcategory) {
                if (!c.subs[info.subcategory]) c.subs[info.subcategory] = { name: info.subcategory, units: 0, persons: 0, revenue: 0 };
                const s = c.subs[info.subcategory];
                s.units += units;
                s.persons += persons;
                s.revenue += revenue;
            }
        });
    });

    const list = Object.values(cats)
        .map(c => ({
            ...c,
            pct: grandRevenue > 0 ? Math.round((c.revenue / grandRevenue) * 1000) / 10 : 0,
            subList: Object.values(c.subs).sort((a, b) => b.revenue - a.revenue)
        }))
        .sort((a, b) => b.revenue - a.revenue);

    return { list, grandRevenue };
}

function computeProductRanking(payments = paymentHistory) {
    const stats = {};
    const add = (key, catName, qty, revenue, isPersons) => {
        if (!stats[key]) stats[key] = { name: key, catName, qty: 0, revenue: 0, isPersons };
        stats[key].qty += qty;
        stats[key].revenue += revenue;
    };

    payments.forEach(p => {
        if (Array.isArray(p.items) && p.items.length > 0) {
            p.items.forEach(it => {
                const qty = Number(it.qty) || 0;
                const price = Number(it.price) || 0;
                const info = resolveSoldItemCategory(it);
                if (isPizzaLibreSoldItem(it)) {
                    if (price > 0) {
                        add('Pizza Libre (por persona)', info.catName, Number(it.librePersons) || qty || 1, price * qty, true);
                    }
                } else if (it.perPerson) {
                    add(`${getSoldItemBaseName(it)} (por persona)`, info.catName, qty, price * qty, true);
                } else {
                    add(it.name, info.catName, qty, price * qty, false);
                }
            });
        } else if (p.itemsSummary) {
            String(p.itemsSummary).split(',').map(s => s.trim()).filter(Boolean).forEach(part => {
                const m = part.match(/^(\d+)x\s*(.+)$/);
                const qty = m ? parseInt(m[1], 10) : 1;
                const name = m ? m[2].trim() : part;
                if (/pizza\s*libre/i.test(name)) {
                    if (/ronda\)/i.test(name) && !/1ra/i.test(name)) return;
                    add('Pizza Libre (por persona)', 'Pizzas', qty, 0, true);
                } else {
                    add(name, 'Otros', qty, 0, false);
                }
            });
        }
    });

    return Object.values(stats).sort((a, b) => (b.qty - a.qty) || (b.revenue - a.revenue));
}

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

    // 1. Ventas por Categoría (toda la carta) con desglose por tipo / subcategoría
    const catSales = computeCategorySales(paymentHistory);
    const catBadge = document.getElementById('rep-cat-summary-badge');
    if (catBadge) {
        const totUnits = catSales.list.reduce((a, c) => a + c.units, 0);
        const totPersons = catSales.list.reduce((a, c) => a + c.persons, 0);
        catBadge.innerText = `${catSales.list.length} categoría${catSales.list.length === 1 ? '' : 's'} | ${formatSalesQtyLabel(totUnits, totPersons)}`;
    }
    const catContainer = document.getElementById('rep-category-breakdown');
    if (catContainer) {
        if (catSales.list.length === 0) {
            catContainer.innerHTML = `<p class="col-span-full text-xs text-slate-400 py-6 text-center">Sin ventas registradas en el turno.</p>`;
        } else {
            catContainer.innerHTML = catSales.list.map(c => `
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <span class="flex items-center gap-1.5 min-w-0">
                            <i class="fa-solid ${c.icon} text-[#2563eb] text-xs shrink-0"></i>
                            <span class="font-bold text-sm text-slate-900 truncate">${c.name}</span>
                        </span>
                        <span class="text-[10px] font-bold text-slate-500 shrink-0">${c.pct}% de ventas</span>
                    </div>
                    <div class="flex items-end justify-between gap-2">
                        <span class="text-xs font-bold text-slate-700">${formatSalesQtyLabel(c.units, c.persons)}</span>
                        <strong class="text-base text-slate-900">$${c.revenue.toLocaleString()}</strong>
                    </div>
                    <div class="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <div class="bg-[#2563eb] h-1.5 rounded-full" style="width: ${Math.min(100, c.pct)}%"></div>
                    </div>
                    ${c.extraRounds > 0 ? `<p class="text-[10px] text-slate-500">Rondas extra de libre servidas: ${c.extraRounds}</p>` : ''}
                    ${c.subList.length > 0 ? `
                        <div class="pt-1.5 border-t border-slate-200 space-y-1">
                            ${c.subList.map(s => `
                                <div class="flex justify-between text-[11px] text-slate-600">
                                    <span class="truncate mr-2">${s.name}</span>
                                    <span class="shrink-0"><strong class="text-slate-800">${formatSalesQtyLabel(s.units, s.persons)}</strong> | $${s.revenue.toLocaleString()}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `).join('');
        }
    }

    // 2. Ranking de Gustos de Pizza Más Vendidos
    const pizzaStats = computePizzaAndFlavorStats(paymentHistory);
    const flavorsListElem = document.getElementById('rep-top-flavors-list');
    if (flavorsListElem) {
        if (pizzaStats.sortedFlavors.length === 0) {
            flavorsListElem.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">Sin consumo de pizzas registrado en este turno.</p>`;
        } else {
            const maxEquiv = pizzaStats.sortedFlavors[0].pizzaEquiv || 1;
            flavorsListElem.innerHTML = pizzaStats.sortedFlavors.map((f, idx) => {
                const pct = Math.round((f.pizzaEquiv / maxEquiv) * 100);
                return `
                    <div class="space-y-1 text-xs">
                        <div class="flex justify-between items-center">
                            <span class="font-bold text-slate-800 truncate mr-2">
                                <span class="text-slate-400 font-semibold mr-1">${idx + 1}°.</span> ${f.name}
                            </span>
                            <div class="text-right shrink-0">
                                <strong class="text-slate-900">${f.pizzaEquiv} piz.</strong>
                                <span class="text-slate-400 text-[10px] ml-1">(${f.orders} ped.)</span>
                            </div>
                        </div>
                        <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div class="bg-amber-500 h-1.5 rounded-full" style="width: ${pct}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // 3. Ranking general de lo más vendido (toda la carta, servicios por persona unificados)
    const sortedProducts = computeProductRanking(paymentHistory);
    const maxQty = sortedProducts.length > 0 ? (sortedProducts[0].qty || 1) : 1;
    const topList = document.getElementById('rep-top-products-list');

    if (sortedProducts.length === 0) {
        topList.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">Sin ventas registradas en el turno.</p>`;
    } else {
        topList.innerHTML = sortedProducts.map((p, idx) => {
            const pct = Math.round((p.qty / maxQty) * 100);
            return `
                <div class="space-y-1 text-xs">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-slate-800 truncate mr-2">
                            <span class="text-slate-400 font-semibold mr-1">${idx + 1}°.</span> ${p.name}
                            <span class="text-[10px] text-slate-400 font-medium ml-1">${p.catName}</span>
                        </span>
                        <div class="text-right shrink-0">
                            <strong class="text-slate-900">${p.qty} ${p.isPersons ? 'pers.' : 'u.'}</strong>
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

    // 4. Rendimiento por Mozo
    const waiterStats = {};
    activeWaiters.forEach(w => {
        waiterStats[w.name] = { closed: 0, sales: 0, tips: 0 };
    });

    paymentHistory.forEach(p => {
        let wName = p.waiter || 'Otro';
        const isWAdmin = wName.toLowerCase().includes('encargado') || wName.toLowerCase().includes('admin');
        if (isWAdmin && p.table) {
            const matchCmd = kitchenOrders.find(k => k.table === p.table && k.waiterName && !k.waiterName.toLowerCase().includes('encargado') && !k.waiterName.toLowerCase().includes('admin'));
            if (matchCmd) {
                wName = matchCmd.waiterName;
                p.waiter = matchCmd.waiterName;
            }
        }

        if (!waiterStats[wName]) {
            waiterStats[wName] = { closed: 0, sales: 0, tips: 0 };
        }
        waiterStats[wName].closed += 1;
        waiterStats[wName].sales += p.total;
        waiterStats[wName].tips += (p.tip || 0);
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
                    ${r.librePersons !== undefined ? `<span>Pizza Libre: <strong class="text-blue-700">${r.librePersons} personas</strong></span>` : ''}
                    ${r.pizzasCount !== undefined ? `<span>Pizzas: <strong class="text-amber-700">${r.pizzasCount} u.</strong></span>` : ''}
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

    const catSales = computeCategorySales(paymentHistory);
    const pizzaStats = computePizzaAndFlavorStats(paymentHistory);
    const ranking = computeProductRanking(paymentHistory);

    const catLines = catSales.list.length > 0
        ? catSales.list.map(c => {
            let line = `- ${c.name}: ${formatSalesQtyLabel(c.units, c.persons)} | $${c.revenue.toLocaleString()} (${c.pct}%)`;
            c.subList.forEach(s => {
                line += `\n     ${s.name}: ${formatSalesQtyLabel(s.units, s.persons)} | $${s.revenue.toLocaleString()}`;
            });
            return line;
        }).join('\n')
        : '- Sin ventas registradas';

    const topProducts = ranking.length > 0
        ? ranking.slice(0, 10).map((p, idx) => `${idx + 1}. ${p.name}: ${p.qty} ${p.isPersons ? 'pers.' : 'u.'}`).join('\n')
        : '- Sin ventas registradas';

    const topFlavors = pizzaStats.sortedFlavors.length > 0
        ? pizzaStats.sortedFlavors.slice(0, 5).map((f, idx) => `${idx + 1}. ${f.name}: ${f.pizzaEquiv} pizzas (${f.orders} ped.)`).join('\n')
        : '- Sin consumo de pizzas registrado';

    const tablesBreakdown = paymentHistory.map(p =>
        `- ${p.table} (${p.method}): Cobró ${p.waiter} | Total: $${p.total.toLocaleString()} | Pagó: $${(p.paidWith || p.total).toLocaleString()} | Propina: $${(p.tip || 0).toLocaleString()}`
    ).join('\n');

    const text = `*CIERRE NOCTURNO - SARMIENTO POS*\n` +
        `Fecha: ${dateStr}\n\n` +
        `Facturación Total: $${totalSales.toLocaleString()}\n` +
        `Efectivo en Caja: $${totalCash.toLocaleString()}\n` +
        `Transferencias: $${totalTransfer.toLocaleString()}\n` +
        `Caja de Propinas: $${generalTipsPool.toLocaleString()}\n` +
        `Mesas Cobradas: ${ordersCount}\n\n` +
        `*VENTAS POR CATEGORÍA:*\n${catLines}\n\n` +
        `*LO MÁS VENDIDO (TOP 10):*\n${topProducts}\n\n` +
        `*GUSTOS DE PIZZA MÁS VENDIDOS:*\n${topFlavors}\n\n` +
        `*RESUMEN DE COBRANZAS DE MESAS:*\n` +
        (tablesBreakdown || 'Sin cobranzas registradas') + '\n\n' +
        `_Generado automáticamente desde Sarmiento POS_`;

    navigator.clipboard.writeText(text).then(() => {
        showModal('Resumen Copiado', 'El texto fue copiado al portapapeles con las ventas por categoría, lo más vendido, los gustos de pizza y los cobros por mozo, listo para enviar por WhatsApp.');
    }).catch(err => {
        console.error(err);
    });
}

function downloadNightReportCSV() {
    const catSales = computeCategorySales(paymentHistory);
    const pizzaStats = computePizzaAndFlavorStats(paymentHistory);
    const ranking = computeProductRanking(paymentHistory);
    const q = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;

    let csv = "ID,Mesa,Mozo que Cobro,Hora,Metodo,Total,Pago,Propina,Personas (servicios por persona),Detalle\n";
    paymentHistory.forEach(p => {
        let personsInTable = 0;
        if (Array.isArray(p.items)) {
            p.items.forEach(it => {
                if (isPizzaLibreSoldItem(it)) {
                    if (Number(it.price) > 0) personsInTable += (Number(it.librePersons) || Number(it.qty) || 1);
                } else if (it.perPerson) {
                    personsInTable += Number(it.qty) || 0;
                }
            });
        }
        csv += `${q(p.id)},${q(p.table)},${q(p.waiter)},${q(p.time)},${q(p.method)},${p.total},${p.paidWith || p.total},${p.tip || 0},${personsInTable},${q(p.itemsSummary || '')}\n`;
    });

    csv += "\n--- VENTAS POR CATEGORIA ---\n";
    csv += "Categoria,Subcategoria,Unidades,Personas,Facturado,% de Ventas\n";
    catSales.list.forEach(c => {
        csv += `${q(c.name)},${q('(Total)')},${c.units},${c.persons},${c.revenue},${c.pct}\n`;
        c.subList.forEach(s => {
            csv += `${q(c.name)},${q(s.name)},${s.units},${s.persons},${s.revenue},\n`;
        });
    });

    csv += "\n--- LO MAS VENDIDO ---\n";
    csv += "Posicion,Producto,Categoria,Cantidad,Tipo,Facturado\n";
    ranking.forEach((p, idx) => {
        csv += `${idx + 1},${q(p.name)},${q(p.catName)},${p.qty},${q(p.isPersons ? 'Personas' : 'Unidades')},${p.revenue}\n`;
    });

    csv += "\n--- GUSTOS DE PIZZA MAS VENDIDOS ---\n";
    csv += "Posicion,Gusto,Pizzas Equivalentes,Pedidos\n";
    pizzaStats.sortedFlavors.forEach((f, idx) => {
        csv += `${idx + 1},${q(f.name)},${f.pizzaEquiv},${f.orders}\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Ventas_Turno_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function printNightReportThermal() {
    const totalSales = paymentHistory.reduce((acc, p) => acc + p.total, 0);
    const totalCash = paymentHistory.filter(p => p.method === 'Efectivo').reduce((acc, p) => acc + p.total, 0);
    const totalTransfer = paymentHistory.filter(p => p.method === 'Transferencia').reduce((acc, p) => acc + p.total, 0);
    const ordersCount = paymentHistory.length;
    const pizzaStats = computePizzaAndFlavorStats(paymentHistory);
    const catSales = computeCategorySales(paymentHistory);
    const ranking = computeProductRanking(paymentHistory);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date().toLocaleDateString('es-AR');

    const closureTicketData = {
        type: 'closure',
        dateStr,
        time: timeStr,
        totalSales,
        cashSales: totalCash,
        transferSales: totalTransfer,
        tipsPool: generalTipsPool,
        ordersCount,
        categories: catSales.list,
        topProducts: ranking.slice(0, 10),
        topFlavors: pizzaStats.sortedFlavors
    };

    if (winPrintEndpoint && selectedWinPrinter) {
        try {
            const bytes = buildEscPosBytes(closureTicketData);
            const dataBase64 = uint8ToBase64(bytes);
            const res = await fetchWithTimeout(winPrintEndpoint.printUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    printerName: selectedWinPrinter,
                    dataBase64
                })
            }, 15000);
            const result = await res.json();
            if (!res.ok || !result.success) {
                throw new Error((result && result.error) || 'Error imprimiendo cierre');
            }
            showToast(`Cierre de turno impreso en ${selectedWinPrinter}`, 'success');
            return;
        } catch (err) {
            console.error('Error imprimiendo cierre en Windows:', err);
            showToast(`Error imprimiendo cierre: ${err.message}`, 'error');
            return;
        }
    }

    currentTicketData = closureTicketData;
    triggerBrowserPrint();
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

    const pizzaStats = computePizzaAndFlavorStats(paymentHistory);
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
        librePersons: pizzaStats.librePersonsTotal,
        pizzasCount: pizzaStats.totalPizzasDespachadas,
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

    availableTables = sortTablesNaturally([...availableTables, cleanName]);
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
