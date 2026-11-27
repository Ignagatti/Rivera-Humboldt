const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { pool, initDatabase, officialPizzas } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// También servir la raíz para acceso directo si se solicita
app.use(express.static(__dirname));

// Broadcast WebSocket a todos los clientes conectados (Cocina, Mozos, Caja)
function broadcast(payload) {
  const message = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Saludo inicial de confirmación de conexión
  ws.send(JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() }));
});

// Heartbeat ping cada 25 segundos para mantener vivas las conexiones en iOS y Android
const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => {
  clearInterval(pingInterval);
});

// ================= API ENDPOINTS =================

// 1. Obtener estado completo actual sincronizado desde Neon DB
app.get('/api/state', async (req, res) => {
  try {
    // Propinas
    const tipsRes = await pool.query("SELECT value FROM pos_config WHERE key = 'general_tips_pool'");
    const generalTipsPool = tipsRes.rows.length > 0 ? Number(tipsRes.rows[0].value) : 0;

    // Configuración de Ticket (Nombre, Alias, Mensaje, Propina sugerida)
    const ticketCfgRes = await pool.query("SELECT value FROM pos_config WHERE key = 'ticket_config'");
    const defaultTicketConfig = {
      businessName: 'SARMIENTO',
      alias: '',
      footerMessage: '¡Muchas gracias por elegir Sarmiento!',
      showSuggestedTip: true
    };
    const ticketConfig = (ticketCfgRes.rows.length > 0 && ticketCfgRes.rows[0].value && typeof ticketCfgRes.rows[0].value === 'object')
      ? { ...defaultTicketConfig, ...ticketCfgRes.rows[0].value }
      : defaultTicketConfig;
    // Migración de marca: Rivera -> Sarmiento (solo si quedó el valor por defecto anterior)
    if (/^rivera$/i.test(String(ticketConfig.businessName || '').trim())) {
      ticketConfig.businessName = 'SARMIENTO';
    }
    if (/elegir Sarmiento/i.test(String(ticketConfig.footerMessage || ''))) {
      ticketConfig.footerMessage = String(ticketConfig.footerMessage).replace(/elegir Sarmiento/i, 'elegir Sarmiento');
    }

    // Personal
    const staffRes = await pool.query("SELECT id, name, role FROM pos_staff ORDER BY created_at ASC");
    const staffList = staffRes.rows;

    // Categorías y Productos (SELECT * para compatibilidad total con cualquier versión de esquema)
    const catRes = await pool.query("SELECT * FROM pos_categories ORDER BY sort_order ASC, name ASC");
    const itemRes = await pool.query("SELECT * FROM pos_menu_items ORDER BY name ASC");

    const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
    const menuData = {};
    for (const cat of catRes.rows) {
      const catDays = Array.isArray(cat.available_days) ? cat.available_days.map(Number) : ALL_DAYS;
      menuData[cat.id] = {
        id: cat.id,
        name: cat.name,
        icon: cat.icon,
        availableDays: catDays,
        isActive: cat.is_active !== false,
        items: itemRes.rows
          .filter(i => i.category_id === cat.id)
          .map(i => ({
            id: i.id,
            name: i.name,
            price: Number(i.price),
            desc: i.description || '',
            isAvailable: i.is_available !== false,
            availableDays: Array.isArray(i.available_days) ? i.available_days.map(Number) : null,
            subcategory: i.subcategory || '',
            perPerson: i.per_person === true
          }))
      };
    }

    // Asegurar que la categoría 'pizzas' siempre tenga cargadas las pizzas oficiales en la carta y base de datos
    if (!menuData['pizzas']) {
      menuData['pizzas'] = {
        id: 'pizzas',
        name: 'Pizzas',
        icon: 'fa-pizza-slice',
        availableDays: ALL_DAYS,
        isActive: true,
        items: []
      };
    }
    if (!Array.isArray(menuData['pizzas'].items) || menuData['pizzas'].items.length === 0) {
      for (const p of (officialPizzas || [])) {
        try {
          await pool.query(`
            INSERT INTO pos_menu_items (id, category_id, name, price, description)
            VALUES ($1, 'pizzas', $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              price = EXCLUDED.price,
              description = EXCLUDED.description
          `, [p.id, p.name, p.price, p.desc]);
        } catch (_) { }
      }
      menuData['pizzas'].items = (officialPizzas || []).map(p => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        desc: p.desc || ''
      }));
    }

    // Garantizar que 'Pizza libre' siempre quede al inicio de la categoría pizzas
    if (menuData['pizzas'] && Array.isArray(menuData['pizzas'].items)) {
      menuData['pizzas'].items.sort((a, b) => {
        const aIsLibre = a.id === 'pz_libre' || a.name.toLowerCase().includes('pizza libre');
        const bIsLibre = b.id === 'pz_libre' || b.name.toLowerCase().includes('pizza libre');
        if (aIsLibre && !bIsLibre) return -1;
        if (!aIsLibre && bIsLibre) return 1;
        return a.name.localeCompare(b.name);
      });
    }

    // Pedidos en Mesas (ordenados naturalmente: Mesa 01..25, luego Mesa Barra, Para Llevar)
    const tablesRes = await pool.query(`
      SELECT table_name, items, note 
      FROM pos_table_orders 
      ORDER BY 
        CASE 
          WHEN table_name ~* '^Mesa\\s*(\\d+)' THEN 1 
          WHEN table_name ~* 'barra' THEN 2 
          WHEN table_name ~* 'llevar' THEN 3 
          ELSE 4 
        END,
        NULLIF(substring(table_name from '\\d+'), '')::int,
        table_name ASC
    `);
    const ordersByTable = {};
    const availableTables = [];
    for (const row of tablesRes.rows) {
      availableTables.push(row.table_name);
      ordersByTable[row.table_name] = {
        items: row.items || [],
        note: row.note || ''
      };
    }

    // Comandas de Cocina
    const kitchenRes = await pool.query("SELECT id, table_name, waiter_name, time, status, printed, items, total, note FROM pos_kitchen_orders ORDER BY created_at DESC LIMIT 100");
    const kitchenOrders = kitchenRes.rows.map(r => ({
      id: r.id,
      table: r.table_name,
      waiterName: r.waiter_name,
      time: r.time,
      status: r.status,
      printed: r.printed,
      items: r.items,
      total: Number(r.total),
      note: r.note || ''
    }));

    // Registro de Pagos
    const payRes = await pool.query("SELECT id, table_name, waiter, time, method, total, paid_with, tip, items_summary, items, waiter_tips FROM pos_payment_history ORDER BY created_at DESC LIMIT 200");
    const paymentHistory = payRes.rows.map(r => ({
      id: r.id,
      table: r.table_name,
      waiter: r.waiter,
      time: r.time,
      method: r.method,
      total: Number(r.total),
      paidWith: Number(r.paid_with),
      tip: Number(r.tip),
      itemsSummary: r.items_summary,
      items: r.items,
      waiterTips: r.waiter_tips || null
    }));

    // Cierres de noche archivados
    const reportRes = await pool.query("SELECT id, date_str, total_sales, cash_sales, transfer_sales, tips_pool, orders_count, note, created_at FROM pos_night_reports ORDER BY created_at DESC");
    const savedNightReports = reportRes.rows.map(r => ({
      id: r.id,
      dateStr: r.date_str,
      createdAt: r.created_at,
      totalSales: Number(r.total_sales),
      cashSales: Number(r.cash_sales),
      transferSales: Number(r.transfer_sales),
      tipsPool: Number(r.tips_pool),
      ordersCount: Number(r.orders_count),
      note: r.note || ''
    }));

    res.json({
      success: true,
      data: {
        staffList,
        generalTipsPool,
        ticketConfig,
        menuData,
        availableTables,
        ordersByTable,
        kitchenOrders,
        paymentHistory,
        savedNightReports
      }
    });
  } catch (err) {
    console.warn('Advertencia al obtener estado general de Neon DB:', err.message);
    res.status(503).json({
      success: false,
      error: err.message
    });
  }
});

// 2. Guardar borrador de comanda en mesa (cuando el mozo agrega/quita ítems en su celular)
app.post('/api/tables/:tableName/save', async (req, res) => {
  const { tableName } = req.params;
  const { items, note } = req.body;

  try {
    await pool.query(`
      INSERT INTO pos_table_orders (table_name, items, note, updated_at)
      VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (table_name)
      DO UPDATE SET items = EXCLUDED.items, note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP
    `, [tableName, JSON.stringify(items || []), note || '']);

    broadcast({
      type: 'TABLE_UPDATED',
      tableName,
      items: items || [],
      note: note || ''
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error al guardar comanda en mesa:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2b. Agregar nueva mesa al salón
app.post('/api/tables/add', async (req, res) => {
  const { tableName } = req.body;
  if (!tableName || !String(tableName).trim()) {
    return res.status(400).json({ success: false, error: 'El nombre de la mesa es requerido.' });
  }
  const cleanName = String(tableName).trim();

  try {
    await pool.query(`
      INSERT INTO pos_table_orders (table_name, items, note, updated_at)
      VALUES ($1, '[]'::jsonb, '', CURRENT_TIMESTAMP)
      ON CONFLICT (table_name) DO NOTHING;
    `, [cleanName]);

    broadcast({
      type: 'TABLE_ADDED',
      tableName: cleanName
    });

    res.json({ success: true, tableName: cleanName });
  } catch (err) {
    console.error('Error al agregar mesa:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2c. Eliminar mesa del salón (solo si no tiene pedidos pendientes)
app.delete('/api/tables/:tableName', async (req, res) => {
  const { tableName } = req.params;
  try {
    const cmdCheck = await pool.query(
      "SELECT COUNT(*) FROM pos_kitchen_orders WHERE table_name = $1 AND status != 'paid'",
      [tableName]
    );

    if (parseInt(cmdCheck.rows[0].count) > 0) {
      return res.status(400).json({ success: false, error: 'No se puede eliminar una mesa con pedidos activos en cocina.' });
    }

    await pool.query("DELETE FROM pos_table_orders WHERE table_name = $1", [tableName]);

    broadcast({
      type: 'TABLE_DELETED',
      tableName
    });

    res.json({ success: true, tableName });
  } catch (err) {
    console.error('Error al eliminar mesa:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Enviar comanda a cocina
app.post('/api/orders/send-kitchen', async (req, res) => {
  const { id, table, waiterName, time, status, printed, items, total, note } = req.body;

  try {
    // Buscar si ya existe una comanda activa para esta mesa
    const activeRes = await pool.query(
      "SELECT * FROM pos_kitchen_orders WHERE table_name = $1 AND status != 'paid' ORDER BY created_at DESC LIMIT 1",
      [table]
    );

    let finalOrder;

    if (activeRes.rows.length > 0) {
      const existing = activeRes.rows[0];
      const existingItems = (Array.isArray(existing.items) ? existing.items : []).map(it => ({
        ...it,
        printed: typeof it.printed === 'boolean' ? it.printed : Boolean(existing.printed)
      }));

      const newItemsFormatted = (items || []).map(it => ({
        ...it,
        id: it.id || `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: it.name,
        note: it.note || '',
        price: Number(it.price),
        qty: Number(it.qty),
        status: 'pending',
        printed: false,
        sentAt: time,
        isAddon: true,
        isPizzaLibre: it.isPizzaLibre || false,
        libreRound: it.libreRound || null
      }));

      // Mantener los existentes acumulando cantidades si ambos están pendientes y sin imprimir
      const mergedItems = [];
      const incomingList = [...newItemsFormatted];

      existingItems.forEach(ex => {
        if (!ex.printed && ex.status === 'pending') {
          const incIdx = incomingList.findIndex(inc =>
            (inc.name || '').trim().toLowerCase() === (ex.name || '').trim().toLowerCase() &&
            Number(inc.price) === Number(ex.price) &&
            (inc.note || '').trim().toLowerCase() === (ex.note || '').trim().toLowerCase()
          );
          if (incIdx >= 0) {
            ex.qty = (Number(ex.qty) || 1) + (Number(incomingList[incIdx].qty) || 1);
            incomingList.splice(incIdx, 1);
          }
        }
        mergedItems.push(ex);
      });
      incomingList.forEach(inc => mergedItems.push(inc));
      const mergedTotal = mergedItems.reduce((acc, i) => acc + (Number(i.price) * Number(i.qty)), 0);
      const mergedNote = note
        ? (existing.note && existing.note !== note ? `${existing.note} | ${note}` : note)
        : (existing.note || '');

      // Conservar el mozo original de la mesa si un encargado agrega un plato adicional
      const isIncomingEncargado = waiterName && String(waiterName).toLowerCase().includes('encargado');
      const resolvedWaiterName = (existing.waiter_name && isIncomingEncargado)
        ? existing.waiter_name
        : (waiterName || existing.waiter_name);

      await pool.query(`
        UPDATE pos_kitchen_orders
        SET waiter_name = $1,
            time = $2,
            status = 'pending',
            printed = FALSE,
            items = $3::jsonb,
            total = $4,
            note = $5
        WHERE id = $6
      `, [resolvedWaiterName, time, JSON.stringify(mergedItems), mergedTotal, mergedNote, existing.id]);

      finalOrder = {
        id: existing.id,
        table,
        waiterName: resolvedWaiterName,
        time,
        status: 'pending',
        printed: false,
        items: mergedItems,
        total: mergedTotal,
        note: mergedNote
      };
    } else {
      const cmdId = id || `CMD-${Math.floor(100 + Math.random() * 900)}`;
      const formattedItems = (items || []).map(it => ({
        ...it,
        id: it.id || `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: it.name,
        note: it.note || '',
        price: Number(it.price),
        qty: Number(it.qty),
        status: 'pending',
        printed: false,
        sentAt: time,
        isPizzaLibre: it.isPizzaLibre || false,
        libreRound: it.libreRound || null
      }));
      const calcTotal = formattedItems.reduce((acc, i) => acc + (Number(i.price) * Number(i.qty)), 0);

      await pool.query(`
        INSERT INTO pos_kitchen_orders (id, table_name, waiter_name, time, status, printed, items, total, note, created_at)
        VALUES ($1, $2, $3, $4, 'pending', FALSE, $5::jsonb, $6, $7, CURRENT_TIMESTAMP)
      `, [cmdId, table, waiterName, time, JSON.stringify(formattedItems), calcTotal, note || '']);

      finalOrder = {
        id: cmdId,
        table,
        waiterName,
        time,
        status: 'pending',
        printed: false,
        items: formattedItems,
        total: calcTotal,
        note: note || ''
      };
    }

    // Sincronizar pos_table_orders para que la mesa contenga todos los platos enviados consolidados
    const tableItemsMap = new Map();
    (finalOrder.items || []).forEach(it => {
      const cleanName = String(it.name || '').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
      const key = `${cleanName.toLowerCase()}___${Number(it.price) || 0}`;
      if (tableItemsMap.has(key)) {
        tableItemsMap.get(key).qty += Number(it.qty) || 1;
        tableItemsMap.get(key).sentQty += Number(it.qty) || 1;
      } else {
        tableItemsMap.set(key, {
          ...it,
          id: it.id,
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
    const tableItemsForDb = Array.from(tableItemsMap.values());

    await pool.query(`
      INSERT INTO pos_table_orders (table_name, items, note, updated_at)
      VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (table_name)
      DO UPDATE SET items = EXCLUDED.items, note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP
    `, [table, JSON.stringify(tableItemsForDb), finalOrder.note || '']);

    broadcast({
      type: 'KITCHEN_ORDER_NEW',
      order: finalOrder
    });

    broadcast({
      type: 'TABLE_UPDATED',
      tableName: table,
      items: tableItemsForDb,
      note: finalOrder.note || ''
    });

    res.json({ success: true, order: finalOrder });
  } catch (err) {
    console.error('Error al enviar comanda a cocina:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Cambiar estado de una comanda (pending -> ready -> delivered -> paid) o actualizar platos individuales
app.put('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, items } = req.body;

  try {
    const orderRes = await pool.query("SELECT * FROM pos_kitchen_orders WHERE id = $1", [id]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Comanda no encontrada' });
    }

    const currentOrder = orderRes.rows[0];
    let updatedItems = items;

    if (!updatedItems) {
      const existingItems = Array.isArray(currentOrder.items) ? currentOrder.items : [];
      if (status === 'delivered') {
        // Al marcar entregada, todos los ítems pendientes pasan a entregados
        updatedItems = existingItems.map(it => ({ ...it, status: 'delivered' }));
      } else {
        updatedItems = existingItems;
      }
    }

    const result = await pool.query(`
      UPDATE pos_kitchen_orders
      SET status = $1, items = $2::jsonb
      WHERE id = $3
      RETURNING id, table_name, waiter_name, time, status, printed, items, total, note
    `, [status, JSON.stringify(updatedItems), id]);

    const updated = result.rows[0];
    const orderData = {
      id: updated.id,
      table: updated.table_name,
      waiterName: updated.waiter_name,
      time: updated.time,
      status: updated.status,
      printed: updated.printed,
      items: updated.items,
      total: Number(updated.total),
      note: updated.note || ''
    };

    broadcast({
      type: 'ORDER_STATUS_CHANGED',
      id,
      status,
      order: orderData
    });

    res.json({ success: true, order: orderData });
  } catch (err) {
    console.error('Error al actualizar estado de comanda:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Marcar comanda e ítems como impresos en ticket térmico (evita reimpresión duplicada)
app.put('/api/orders/:id/print', async (req, res) => {
  const { id } = req.params;

  try {
    const existingRes = await pool.query("SELECT items FROM pos_kitchen_orders WHERE id = $1", [id]);
    let updatedItems = null;

    if (existingRes.rows.length > 0 && Array.isArray(existingRes.rows[0].items)) {
      updatedItems = existingRes.rows[0].items.map(it => ({
        ...it,
        printed: true
      }));
      await pool.query(
        "UPDATE pos_kitchen_orders SET printed = TRUE, items = $1::jsonb WHERE id = $2",
        [JSON.stringify(updatedItems), id]
      );
    } else {
      await pool.query("UPDATE pos_kitchen_orders SET printed = TRUE WHERE id = $1", [id]);
    }

    broadcast({
      type: 'ORDER_PRINTED',
      id,
      items: updatedItems
    });

    res.json({ success: true, items: updatedItems });
  } catch (err) {
    console.error('Error al marcar comanda como impresa:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.1 Anular y borrar comanda completa enviada sin querer
app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const orderRes = await pool.query("SELECT * FROM pos_kitchen_orders WHERE id = $1", [id]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Comanda no encontrada' });
    }

    const order = orderRes.rows[0];
    const tableName = order.table_name;

    // Eliminar la comanda
    await pool.query("DELETE FROM pos_kitchen_orders WHERE id = $1", [id]);

    // Verificar si quedan otras comandas activas para esta mesa
    const remainingRes = await pool.query(
      "SELECT * FROM pos_kitchen_orders WHERE table_name = $1 AND status != 'paid' ORDER BY created_at DESC",
      [tableName]
    );

    let tableItemsForDb = [];
    let noteForDb = '';

    if (remainingRes.rows.length > 0) {
      const tableItemsMap = new Map();
      remainingRes.rows.forEach(r => {
        (r.items || []).forEach(it => {
          const key = `${(it.name || '').trim().toLowerCase()}___${Number(it.price) || 0}`;
          if (tableItemsMap.has(key)) {
            tableItemsMap.get(key).qty += Number(it.qty) || 1;
            tableItemsMap.get(key).sentQty += Number(it.qty) || 1;
          } else {
            tableItemsMap.set(key, {
              id: it.id,
              name: it.name,
              price: Number(it.price) || 0,
              qty: Number(it.qty) || 1,
              sentQty: Number(it.qty) || 1,
              note: it.note || '',
              isPizzaLibre: Boolean(it.isPizzaLibre),
              libreRound: it.libreRound || null
            });
          }
        });
      });
      tableItemsForDb = Array.from(tableItemsMap.values());
      noteForDb = remainingRes.rows[0].note || '';
    }

    await pool.query(`
      INSERT INTO pos_table_orders (table_name, items, note, updated_at)
      VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (table_name)
      DO UPDATE SET items = EXCLUDED.items, note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP
    `, [tableName, JSON.stringify(tableItemsForDb), noteForDb]);

    broadcast({
      type: 'KITCHEN_ORDER_DELETED',
      id,
      table: tableName
    });

    broadcast({
      type: 'TABLE_UPDATED',
      tableName,
      items: tableItemsForDb,
      note: noteForDb
    });

    res.json({ success: true, id, table: tableName });
  } catch (err) {
    console.error('Error al anular comanda:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.2 Quitar o decrementar un plato individual de la comanda y de la cuenta de la mesa
app.post('/api/orders/:id/remove-item', async (req, res) => {
  const { id } = req.params;
  const { itemId, name, price, qty, targetStatus } = req.body;
  let remainingToRemove = Number(qty) || 1;

  const cleanStr = (s) => String(s || '').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const targetCleanName = cleanStr(name);

  try {
    const orderRes = await pool.query("SELECT * FROM pos_kitchen_orders WHERE id = $1", [id]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Comanda no encontrada' });
    }

    const order = orderRes.rows[0];
    const tableName = order.table_name;
    const items = Array.isArray(order.items) ? [...order.items] : [];

    const matchesItem = (it) => {
      if (itemId && it.id === itemId) {
        if (!targetCleanName || cleanStr(it.name) === targetCleanName) return true;
      }
      if (targetCleanName && cleanStr(it.name) === targetCleanName) {
        if (price === undefined || price === null || Number(it.price) === Number(price)) return true;
      }
      return false;
    };

    const candidateIndices = [];
    for (let i = items.length - 1; i >= 0; i--) {
      if (matchesItem(items[i])) {
        candidateIndices.push(i);
      }
    }

    if (candidateIndices.length === 0) {
      return res.status(404).json({ success: false, error: 'Plato no encontrado en la comanda' });
    }

    // Priorizar el estado solicitado ('pending' al borrar desde "Por Preparar", 'delivered' desde "Ya Entregados")
    const prefStatus = targetStatus === 'delivered' ? 'delivered' : 'pending';
    candidateIndices.sort((a, b) => {
      const stA = (items[a].status || order.status) === 'delivered' ? 'delivered' : 'pending';
      const stB = (items[b].status || order.status) === 'delivered' ? 'delivered' : 'pending';
      if (stA === prefStatus && stB !== prefStatus) return -1;
      if (stA !== prefStatus && stB === prefStatus) return 1;
      return b - a;
    });

    const indicesToSplice = [];
    for (const idx of candidateIndices) {
      if (remainingToRemove <= 0) break;
      const targetItem = items[idx];
      const currentQty = Number(targetItem.qty) || 1;
      if (currentQty > remainingToRemove) {
        targetItem.qty = currentQty - remainingToRemove;
        if (targetItem.perPerson && targetItem.baseName) {
          targetItem.name = `${targetItem.baseName} (${targetItem.qty} persona${targetItem.qty === 1 ? '' : 's'})`;
          targetItem.personsCount = targetItem.qty;
        }
        remainingToRemove = 0;
      } else {
        remainingToRemove -= currentQty;
        indicesToSplice.push(idx);
      }
    }

    indicesToSplice.sort((a, b) => b - a).forEach(idx => {
      items.splice(idx, 1);
    });

    if (items.length === 0) {
      // Si la comanda se quedó sin ítems, anularla completa
      await pool.query("DELETE FROM pos_kitchen_orders WHERE id = $1", [id]);

      await pool.query(`
        INSERT INTO pos_table_orders (table_name, items, note, updated_at)
        VALUES ($1, '[]'::jsonb, '', CURRENT_TIMESTAMP)
        ON CONFLICT (table_name)
        DO UPDATE SET items = '[]'::jsonb, note = '', updated_at = CURRENT_TIMESTAMP
      `, [tableName]);

      broadcast({
        type: 'KITCHEN_ORDER_DELETED',
        id,
        table: tableName
      });

      broadcast({
        type: 'TABLE_UPDATED',
        tableName,
        items: [],
        note: ''
      });

      return res.json({ success: true, orderDeleted: true, id, table: tableName });
    }

    const newTotal = items.reduce((acc, i) => acc + (Number(i.price) * Number(i.qty)), 0);
    const hasPendingLeft = items.some(it => (it.status || order.status) !== 'delivered');
    const nextOrderStatus = hasPendingLeft ? (order.status === 'delivered' ? 'pending' : order.status) : 'delivered';

    const updateRes = await pool.query(`
      UPDATE pos_kitchen_orders
      SET items = $1::jsonb, total = $2, status = $3
      WHERE id = $4
      RETURNING id, table_name, waiter_name, time, status, printed, items, total, note
    `, [JSON.stringify(items), newTotal, nextOrderStatus, id]);

    const updated = updateRes.rows[0];
    const orderData = {
      id: updated.id,
      table: updated.table_name,
      waiterName: updated.waiter_name,
      time: updated.time,
      status: updated.status,
      printed: updated.printed,
      items: updated.items,
      total: Number(updated.total),
      note: updated.note || ''
    };

    // Sincronizar pos_table_orders con los ítems consolidados
    const tableItemsMap = new Map();
    items.forEach(it => {
      const cleanName = String(it.name || '').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
      const key = `${cleanName.toLowerCase()}___${Number(it.price) || 0}`;
      if (tableItemsMap.has(key)) {
        tableItemsMap.get(key).qty += Number(it.qty) || 1;
        tableItemsMap.get(key).sentQty += Number(it.qty) || 1;
      } else {
        tableItemsMap.set(key, {
          ...it,
          id: it.id,
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
    const tableItemsForDb = Array.from(tableItemsMap.values());

    await pool.query(`
      INSERT INTO pos_table_orders (table_name, items, note, updated_at)
      VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (table_name)
      DO UPDATE SET items = EXCLUDED.items, note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP
    `, [tableName, JSON.stringify(tableItemsForDb), updated.note || '']);

    broadcast({
      type: 'ORDER_STATUS_CHANGED',
      id,
      status: updated.status,
      order: orderData
    });

    broadcast({
      type: 'TABLE_UPDATED',
      tableName,
      items: tableItemsForDb,
      note: updated.note || ''
    });

    res.json({ success: true, order: orderData });
  } catch (err) {
    console.error('Error al quitar plato de la comanda:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.3 Anular / vaciar mesa completa y sus pedidos activos
app.post('/api/tables/:tableName/cancel-order', async (req, res) => {
  const { tableName } = req.params;

  try {
    const cmdRes = await pool.query(
      "SELECT id FROM pos_kitchen_orders WHERE table_name = $1 AND status != 'paid'",
      [tableName]
    );

    await pool.query(
      "DELETE FROM pos_kitchen_orders WHERE table_name = $1 AND status != 'paid'",
      [tableName]
    );

    await pool.query(`
      INSERT INTO pos_table_orders (table_name, items, note, updated_at)
      VALUES ($1, '[]'::jsonb, '', CURRENT_TIMESTAMP)
      ON CONFLICT (table_name)
      DO UPDATE SET items = '[]'::jsonb, note = '', updated_at = CURRENT_TIMESTAMP
    `, [tableName]);

    cmdRes.rows.forEach(r => {
      broadcast({
        type: 'KITCHEN_ORDER_DELETED',
        id: r.id,
        table: tableName
      });
    });

    broadcast({
      type: 'TABLE_UPDATED',
      tableName,
      items: [],
      note: ''
    });

    res.json({ success: true, table: tableName });
  } catch (err) {
    console.error('Error al anular pedido de mesa:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Cobro de mesa (Checkout con propina voluntaria)
app.post('/api/checkout', async (req, res) => {
  const { table, waiter, time, method, total, paidWith, tip, itemsSummary, items, waiterTips } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Blindaje anti-doble-cobro simultáneo entre dos dispositivos (PC y celular):
    // Bloquear la fila de la mesa con FOR UPDATE y verificar que siga teniendo ítems o comanda sin pagar.
    const tableLockRes = await client.query(
      "SELECT items FROM pos_table_orders WHERE table_name = $1 FOR UPDATE",
      [table]
    );
    const activeCmdCheck = await client.query(
      "SELECT id FROM pos_kitchen_orders WHERE table_name = $1 AND status != 'paid' LIMIT 1",
      [table]
    );
    const tableHasItems = tableLockRes.rows.length > 0 && Array.isArray(tableLockRes.rows[0].items) && tableLockRes.rows[0].items.length > 0;
    const hasActiveCmd = activeCmdCheck.rows.length > 0;

    if (!tableHasItems && !hasActiveCmd) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        alreadyPaid: true,
        error: `La ${table} ya fue cobrada y liberada desde otro dispositivo.`
      });
    }

    // Resolver mozo asociado a la mesa:
    // Solo si quien cobra es explícitamente "Perello (Encargado)" o no seleccionó a nadie (vacío),
    // se le asocia la propina al mozo que tomó la comanda.
    // Si se seleccionó a cualquier mozo o persona específica (ej. Ignacio, Gonzalo, Paula, Sol, Matias, etc.),
    // SE RESPETA SIEMPRE ESA ELECCIÓN y NO se sobreescribe.
    let resolvedWaiter = waiter;
    const isIncomingEncargado = !waiter || String(waiter).toLowerCase().includes('encargado');

    if (isIncomingEncargado && (!waiterTips || Object.keys(waiterTips).length === 0)) {
      const orderRes = await client.query(`
        SELECT waiter_name 
        FROM pos_kitchen_orders 
        WHERE table_name = $1 AND waiter_name IS NOT NULL AND waiter_name != ''
          AND waiter_name NOT ILIKE '%encargado%'
        ORDER BY created_at DESC 
        LIMIT 1
      `, [table]);

      if (orderRes.rows.length > 0 && orderRes.rows[0].waiter_name) {
        resolvedWaiter = orderRes.rows[0].waiter_name;
      }
    }

    const paymentId = `PAG-${Date.now().toString().slice(-6)}-${Math.floor(10 + Math.random() * 90)}`;

    // Guardar en historial de pagos asignando al mozo correspondiente
    await client.query(`
      INSERT INTO pos_payment_history (id, table_name, waiter, time, method, total, paid_with, tip, items_summary, items, waiter_tips, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, CURRENT_TIMESTAMP)
    `, [paymentId, table, resolvedWaiter, time, method, total, paidWith, tip || 0, itemsSummary || '', JSON.stringify(items || []), waiterTips ? JSON.stringify(waiterTips) : null]);

    // Limpiar mesa
    await client.query(`
      UPDATE pos_table_orders
      SET items = '[]'::jsonb, note = '', updated_at = CURRENT_TIMESTAMP
      WHERE table_name = $1
    `, [table]);

    // Marcar comandas de cocina activas como pagadas
    await client.query(`
      UPDATE pos_kitchen_orders
      SET status = 'paid'
      WHERE table_name = $1 AND status != 'paid'
    `, [table]);

    // Sumar propina a la caja general de propinas
    let newTipsPool = 0;
    if (tip > 0) {
      const tipsRes = await client.query("SELECT value FROM pos_config WHERE key = 'general_tips_pool'");
      const currentTips = tipsRes.rows.length > 0 ? Number(tipsRes.rows[0].value) : 0;
      newTipsPool = currentTips + Number(tip);

      await client.query(`
        INSERT INTO pos_config (key, value)
        VALUES ('general_tips_pool', $1::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [JSON.stringify(newTipsPool)]);
    } else {
      const tipsRes = await client.query("SELECT value FROM pos_config WHERE key = 'general_tips_pool'");
      newTipsPool = tipsRes.rows.length > 0 ? Number(tipsRes.rows[0].value) : 0;
    }

    await client.query('COMMIT');

    const paymentRecord = {
      id: paymentId,
      table,
      waiter: resolvedWaiter,
      waiterTips: waiterTips || null,
      time,
      method,
      total,
      paidWith,
      tip: tip || 0,
      itemsSummary,
      items: items || []
    };

    broadcast({
      type: 'PAYMENT_COMPLETED',
      table,
      payment: paymentRecord,
      newTipsPool
    });

    res.json({ success: true, payment: paymentRecord, newTipsPool });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al procesar cobro:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 6b. Restaurar una mesa ya cobrada (revierte el pago y si la mesa está ocupada la abre como "Bis")
app.post('/api/payments/:id/restore', async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const payRes = await client.query(
      "SELECT * FROM pos_payment_history WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (payRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Pago no encontrado o ya restaurado.' });
    }

    const payment = payRes.rows[0];
    const originalTable = String(payment.table_name || 'Mesa').trim();
    const restoredItems = (Array.isArray(payment.items) ? payment.items : []).map(it => ({
      ...it,
      qty: Number(it.qty) || 1,
      sentQty: Number(it.qty) || 1,
      price: Number(it.price) || 0,
      status: 'delivered',
      printed: true
    }));

    // Verificar si la mesa original ya está ocupada por nuevos clientes
    const isTableBusy = async (tName) => {
      const tblRes = await client.query("SELECT items FROM pos_table_orders WHERE table_name = $1", [tName]);
      const hasDraft = tblRes.rows.length > 0 && Array.isArray(tblRes.rows[0].items) && tblRes.rows[0].items.length > 0;
      const cmdRes = await client.query("SELECT id FROM pos_kitchen_orders WHERE table_name = $1 AND status != 'paid' LIMIT 1", [tName]);
      return hasDraft || cmdRes.rows.length > 0;
    };

    let targetTable = originalTable;
    let openedAsBis = false;

    if (await isTableBusy(targetTable)) {
      openedAsBis = true;
      const baseName = originalTable.replace(/\s+Bis(\s+\d+)?$/i, '').trim();
      let candidate = `${baseName} Bis`;
      let suffix = 2;
      while (await isTableBusy(candidate)) {
        candidate = `${baseName} Bis ${suffix}`;
        suffix++;
      }
      targetTable = candidate;
    }

    // 1. Restaurar los ítems en pos_table_orders (crea la fila si es "Bis")
    await client.query(`
      INSERT INTO pos_table_orders (table_name, items, note, updated_at)
      VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (table_name)
      DO UPDATE SET items = EXCLUDED.items, note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP
    `, [targetTable, JSON.stringify(restoredItems), `Restaurada (${payment.id})`]);

    // 2. Crear comanda activa en cocina marcada como 'delivered' (ya servida) para que sume en el total y permita cobrarla de nuevo
    const restoredCmdId = `CMD-R${Date.now().toString().slice(-4)}`;
    const restoredTotal = restoredItems.reduce((acc, i) => acc + (Number(i.price) * Number(i.qty)), 0) || Number(payment.total) || 0;
    const restoredWaiter = payment.waiter || 'Mozo';
    const restoredTime = payment.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    await client.query(`
      INSERT INTO pos_kitchen_orders (id, table_name, waiter_name, time, status, printed, items, total, note, created_at)
      VALUES ($1, $2, $3, $4, 'delivered', TRUE, $5::jsonb, $6, $7, CURRENT_TIMESTAMP)
    `, [restoredCmdId, targetTable, restoredWaiter, restoredTime, JSON.stringify(restoredItems), restoredTotal, `Mesa restaurada desde cobro ${payment.id}`]);

    // 3. Eliminar el pago del historial
    await client.query("DELETE FROM pos_payment_history WHERE id = $1", [id]);

    // 4. Descontar la propina del pozo general si tenía propina
    const tipToSubtract = Number(payment.tip) || 0;
    let newTipsPool = 0;
    const tipsRes = await client.query("SELECT value FROM pos_config WHERE key = 'general_tips_pool'");
    const currentTips = tipsRes.rows.length > 0 ? Number(tipsRes.rows[0].value) : 0;
    newTipsPool = Math.max(0, currentTips - tipToSubtract);

    if (tipToSubtract > 0) {
      await client.query(`
        INSERT INTO pos_config (key, value)
        VALUES ('general_tips_pool', $1::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [JSON.stringify(newTipsPool)]);
    }

    await client.query('COMMIT');

    broadcast({ type: 'STATE_REFRESH_REQUESTED' });

    res.json({
      success: true,
      restoredTable: targetTable,
      originalTable,
      openedAsBis,
      newTipsPool
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al restaurar mesa cobrada:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 7. Categorías: Crear nueva
app.post('/api/menu/category', async (req, res) => {
  const { id, name, icon } = req.body;
  try {
    const catId = id || name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    await pool.query(`
      INSERT INTO pos_categories (id, name, icon, sort_order)
      VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM pos_categories))
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon
    `, [catId, name, icon || 'fa-utensils']);

    broadcast({ type: 'MENU_REFRESH_REQUESTED' });
    res.json({ success: true, categoryId: catId });
  } catch (err) {
    console.error('Error al crear categoría:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Categorías: Eliminar
app.delete('/api/menu/category/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM pos_menu_items WHERE category_id = $1", [id]);
    await client.query("DELETE FROM pos_categories WHERE id = $1", [id]);
    await client.query('COMMIT');

    broadcast({ type: 'MENU_REFRESH_REQUESTED' });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al eliminar categoría:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 9. Productos: Agregar / Editar (y actualizar precio en cuentas activas no cobradas)
app.post('/api/menu/item', async (req, res) => {
  const { id, categoryId, name, price, desc, subcategory, perPerson } = req.body;
  try {
    const itemId = id || `it_${Date.now().toString().slice(-6)}`;
    const newPrice = Number(price) || 0;

    await pool.query(`ALTER TABLE pos_menu_items ADD COLUMN IF NOT EXISTS subcategory VARCHAR(80) DEFAULT '';`);
    await pool.query(`ALTER TABLE pos_menu_items ADD COLUMN IF NOT EXISTS per_person BOOLEAN DEFAULT FALSE;`);

    const prevRes = await pool.query("SELECT name, price FROM pos_menu_items WHERE id = $1", [itemId]);
    const oldName = prevRes.rows.length > 0 ? prevRes.rows[0].name : name;

    await pool.query(`
      INSERT INTO pos_menu_items (id, category_id, name, price, description, subcategory, per_person)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        category_id = EXCLUDED.category_id,
        name = EXCLUDED.name,
        price = EXCLUDED.price,
        description = EXCLUDED.description,
        subcategory = EXCLUDED.subcategory,
        per_person = EXCLUDED.per_person
    `, [itemId, categoryId, name, newPrice, desc || '', String(subcategory || '').trim().slice(0, 80), perPerson === true]);

    if (categoryId === 'pizzas') {
      try {
        await pool.query(`
          UPDATE pizzas_precios
          SET precio_entera = $1, updated_at = CURRENT_TIMESTAMP
          WHERE LOWER(name) = LOWER($2)
        `, [newPrice, name]);
      } catch (_) { }
    }

    // Propagar el nuevo precio a las cuentas activas (mesas abiertas y comandas no cobradas), NUNCA a las ya cobradas
    let updatedActiveTables = 0;
    if (newPrice > 0) {
      const cleanBase = (s) => String(s || '')
        .replace(/\s*\[[^\]]*\]\s*/g, ' ')
        .replace(/\s*\(\d+\s*personas?\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      const targetNewBase = cleanBase(name);
      const targetOldBase = cleanBase(oldName);
      const isLibreItem = itemId === 'pz_libre' || targetNewBase === 'pizza libre';

      const matchesEditedMenuItem = (it) => {
        if (!it) return false;
        if (isLibreItem) {
          const itIsLibre = Boolean(it.isPizzaLibre || (it.id && String(it.id).startsWith('pz_libre')) || /^pizza\s+libre/i.test(String(it.name || '')));
          return itIsLibre && Number(it.price) > 0;
        }
        if (it.id === itemId || it.menuItemId === itemId) return true;
        if (it.id && String(it.id).startsWith(itemId + '_p_')) return true;
        const itBase = cleanBase(it.baseName || it.name);
        if (itBase && (itBase === targetNewBase || (targetOldBase && itBase === targetOldBase))) return true;
        if (categoryId === 'pizzas') {
          const rawLower = cleanBase(it.name);
          if (rawLower === `pizza ${targetNewBase} (entera)` || (targetOldBase && rawLower === `pizza ${targetOldBase} (entera)`)) {
            return true;
          }
        }
        return false;
      };

      // 1. Actualizar en pos_table_orders (mesas abiertas)
      const tRes = await pool.query("SELECT table_name, items, note FROM pos_table_orders");
      for (const row of tRes.rows) {
        const items = Array.isArray(row.items) ? row.items : [];
        let changed = false;
        const updatedItems = items.map(it => {
          if (matchesEditedMenuItem(it) && Number(it.price) !== newPrice) {
            changed = true;
            return { ...it, price: newPrice };
          }
          return it;
        });

        if (changed) {
          // Consolidar filas que ahora compartan mismo nombre y precio
          const mergedMap = new Map();
          updatedItems.forEach(it => {
            const cleanName = String(it.name || '').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
            const key = `${cleanName.toLowerCase()}___${Number(it.price) || 0}`;
            if (mergedMap.has(key)) {
              mergedMap.get(key).qty = (Number(mergedMap.get(key).qty) || 0) + (Number(it.qty) || 0);
              mergedMap.get(key).sentQty = (Number(mergedMap.get(key).sentQty) || 0) + (Number(it.sentQty) || 0);
            } else {
              mergedMap.set(key, { ...it, name: cleanName });
            }
          });
          const finalTableItems = Array.from(mergedMap.values());

          await pool.query(
            "UPDATE pos_table_orders SET items = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE table_name = $2",
            [JSON.stringify(finalTableItems), row.table_name]
          );
          broadcast({
            type: 'TABLE_UPDATED',
            tableName: row.table_name,
            items: finalTableItems,
            note: row.note || ''
          });
          updatedActiveTables++;
        }
      }

      // 2. Actualizar en pos_kitchen_orders (SOLO comandas activas con status != 'paid')
      const kRes = await pool.query("SELECT id, table_name, waiter_name, time, status, printed, items, total, note FROM pos_kitchen_orders WHERE status != 'paid'");
      for (const row of kRes.rows) {
        const items = Array.isArray(row.items) ? row.items : [];
        let changed = false;
        const updatedItems = items.map(it => {
          if (matchesEditedMenuItem(it) && Number(it.price) !== newPrice) {
            changed = true;
            return { ...it, price: newPrice };
          }
          return it;
        });

        if (changed) {
          const newTotal = updatedItems.reduce((acc, i) => acc + (Number(i.price) * Number(i.qty)), 0);
          await pool.query(
            "UPDATE pos_kitchen_orders SET items = $1::jsonb, total = $2 WHERE id = $3",
            [JSON.stringify(updatedItems), newTotal, row.id]
          );
          const orderData = {
            id: row.id,
            table: row.table_name,
            waiterName: row.waiter_name,
            time: row.time,
            status: row.status,
            printed: row.printed,
            items: updatedItems,
            total: newTotal,
            note: row.note || ''
          };
          broadcast({
            type: 'ORDER_STATUS_CHANGED',
            id: row.id,
            status: row.status,
            order: orderData
          });
        }
      }
    }

    broadcast({ type: 'MENU_REFRESH_REQUESTED' });
    res.json({ success: true, itemId, updatedActiveTables });
  } catch (err) {
    console.error('Error al agregar/editar plato:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Productos: Eliminar
app.delete('/api/menu/item/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM pos_menu_items WHERE id = $1", [id]);
    broadcast({ type: 'MENU_REFRESH_REQUESTED' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error al eliminar plato:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10b. Disponibilidad por días / estado activo de Categoría (Menú del Día / Parrilla sábados)
app.put('/api/menu/category/:id/availability', async (req, res) => {
  const { id } = req.params;
  const { availableDays, isActive } = req.body || {};

  try {
    const curRes = await pool.query("SELECT available_days, is_active FROM pos_categories WHERE id = $1", [id]);
    if (curRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Categoría no encontrada' });
    }

    const nextDays = Array.isArray(availableDays)
      ? availableDays.map(Number).filter(d => d >= 0 && d <= 6)
      : (Array.isArray(curRes.rows[0].available_days) ? curRes.rows[0].available_days : [0, 1, 2, 3, 4, 5, 6]);
    const nextActive = typeof isActive === 'boolean' ? isActive : (curRes.rows[0].is_active !== false);

    await pool.query(
      "UPDATE pos_categories SET available_days = $1::jsonb, is_active = $2 WHERE id = $3",
      [JSON.stringify(nextDays), nextActive, id]
    );

    broadcast({ type: 'MENU_REFRESH_REQUESTED' });
    res.json({ success: true, availableDays: nextDays, isActive: nextActive });
  } catch (err) {
    console.error('Error actualizando disponibilidad de categoría:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10c. Disponibilidad por días / estado activo de Plato individual
app.put('/api/menu/item/:id/availability', async (req, res) => {
  const { id } = req.params;
  const { availableDays, isAvailable } = req.body || {};

  try {
    const curRes = await pool.query("SELECT available_days, is_available FROM pos_menu_items WHERE id = $1", [id]);
    if (curRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Plato no encontrado' });
    }

    let nextDays = curRes.rows[0].available_days;
    if (availableDays === null) {
      nextDays = null; // Heredar días de la categoría
    } else if (Array.isArray(availableDays)) {
      nextDays = availableDays.map(Number).filter(d => d >= 0 && d <= 6);
    }

    const nextAvailable = typeof isAvailable === 'boolean' ? isAvailable : (curRes.rows[0].is_available !== false);

    await pool.query(
      "UPDATE pos_menu_items SET available_days = $1::jsonb, is_available = $2 WHERE id = $3",
      [nextDays === null ? null : JSON.stringify(nextDays), nextAvailable, id]
    );

    broadcast({ type: 'MENU_REFRESH_REQUESTED' });
    res.json({ success: true, availableDays: nextDays, isAvailable: nextAvailable });
  } catch (err) {
    console.error('Error actualizando disponibilidad de plato:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Personal: Agregar
app.post('/api/staff', async (req, res) => {
  const { id, name, role } = req.body;
  try {
    const staffId = id || `user_${Date.now().toString().slice(-5)}`;
    await pool.query(`
      INSERT INTO pos_staff (id, name, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role
    `, [staffId, name, role]);
    broadcast({ type: 'STAFF_REFRESH_REQUESTED' });
    res.json({ success: true, id: staffId });
  } catch (err) {
    console.error('Error al agregar personal:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Personal: Alternar Rol
app.put('/api/staff/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  try {
    await pool.query("UPDATE pos_staff SET role = $1 WHERE id = $2", [role, id]);
    broadcast({ type: 'STAFF_REFRESH_REQUESTED' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error al cambiar rol:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Personal: Eliminar
app.delete('/api/staff/:id', async (req, res) => {
  const { id } = req.params;
  if (id === 'admin_perello') {
    return res.status(400).json({ success: false, error: 'No se puede eliminar al Encargado principal.' });
  }
  try {
    await pool.query("DELETE FROM pos_staff WHERE id = $1", [id]);
    broadcast({ type: 'STAFF_REFRESH_REQUESTED' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error al eliminar personal:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Guardar Cierre de Noche
app.post('/api/night-report/close', async (req, res) => {
  const { id, dateStr, totalSales, cashSales, transferSales, tipsPool, ordersCount, note, resetShift } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reportId = id || `CIERRE-${Date.now().toString().slice(-6)}-${Math.floor(10 + Math.random() * 90)}`;

    await client.query(`
      INSERT INTO pos_night_reports (id, date_str, total_sales, cash_sales, transfer_sales, tips_pool, orders_count, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [reportId, dateStr, totalSales, cashSales, transferSales, tipsPool, ordersCount, note || '']);

    if (resetShift) {
      // Reiniciar caja de propinas a 0
      await client.query(`
        INSERT INTO pos_config (key, value)
        VALUES ('general_tips_pool', '0'::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `);

      // Limpiar historial de cobros del turno anterior
      await client.query("DELETE FROM pos_payment_history");

      // Limpiar mesas activas y comandas
      await client.query("UPDATE pos_table_orders SET items = '[]'::jsonb, note = ''");
      await client.query("UPDATE pos_kitchen_orders SET status = 'paid' WHERE status != 'paid'");
    }

    await client.query('COMMIT');

    broadcast({ type: 'STATE_REFRESH_REQUESTED' });
    res.json({ success: true, reportId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al cerrar noche:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 15. Validar contraseña de Admin / Encargado (acceso al panel)
app.post('/api/auth/admin-login', async (req, res) => {
  const { password } = req.body;
  try {
    const pwdRes = await pool.query("SELECT value FROM pos_config WHERE key = 'admin_password'");
    let currentStoredPwd = '1234';
    if (pwdRes.rows.length > 0) {
      const val = pwdRes.rows[0].value;
      currentStoredPwd = typeof val === 'string' ? val : JSON.stringify(val).replace(/^"|"$/g, '');
    }

    if (String(password).trim() === String(currentStoredPwd).trim()) {
      return res.json({ success: true, message: 'Acceso autorizado' });
    } else {
      return res.status(401).json({ success: false, error: 'Contraseña incorrecta. Intenta nuevamente.' });
    }
  } catch (err) {
    console.error('Error al validar contraseña de admin:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 16. Cambiar contraseña de Admin / Encargado desde el Panel de Administración
app.put('/api/auth/admin-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    if (!newPassword || String(newPassword).trim().length < 4) {
      return res.status(400).json({ success: false, error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
    }

    const pwdRes = await pool.query("SELECT value FROM pos_config WHERE key = 'admin_password'");
    let currentStoredPwd = '1234';
    if (pwdRes.rows.length > 0) {
      const val = pwdRes.rows[0].value;
      currentStoredPwd = typeof val === 'string' ? val : JSON.stringify(val).replace(/^"|"$/g, '');
    }

    if (String(currentPassword).trim() !== String(currentStoredPwd).trim()) {
      return res.status(401).json({ success: false, error: 'La contraseña actual no es correcta.' });
    }

    const cleanedNewPwd = String(newPassword).trim();
    await pool.query(`
      INSERT INTO pos_config (key, value)
      VALUES ('admin_password', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [JSON.stringify(cleanedNewPwd)]);

    res.json({ success: true, message: 'Contraseña de administrador actualizada con éxito.' });
  } catch (err) {
    console.error('Error al cambiar contraseña de admin:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= CONFIGURACIÓN DE TICKET (ALIAS, MENSAJE, PROPINA) =================
app.put('/api/config/ticket', async (req, res) => {
  const { businessName, alias, footerMessage, showSuggestedTip } = req.body || {};
  const cleanConfig = {
    businessName: String(businessName || 'SARMIENTO').trim() || 'SARMIENTO',
    alias: String(alias || '').trim(),
    footerMessage: String(footerMessage || '').trim(),
    showSuggestedTip: Boolean(showSuggestedTip)
  };

  try {
    await pool.query(`
      INSERT INTO pos_config (key, value)
      VALUES ('ticket_config', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [JSON.stringify(cleanConfig)]);

    broadcast({
      type: 'TICKET_CONFIG_UPDATED',
      ticketConfig: cleanConfig
    });

    res.json({ success: true, ticketConfig: cleanConfig });
  } catch (err) {
    console.error('Error guardando configuración de ticket:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= IMPRESIÓN TÉRMICA RAW DIRECTA (WINDOWS LOCAL) =================
const { listWindowsPrinters, sendRawBytesToWindowsPrinter } = require('./win-raw-printer');

app.get('/api/printers', async (req, res) => {
  if (process.env.VERCEL || process.platform !== 'win32') {
    return res.json({ success: false, localOnly: true, printers: [] });
  }
  try {
    const printers = await listWindowsPrinters();
    res.json({ success: true, printers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, printers: [] });
  }
});

app.post('/api/print-raw', async (req, res) => {
  if (process.env.VERCEL || process.platform !== 'win32') {
    return res.status(400).json({ success: false, error: 'Impresión RAW directa solo disponible en servidor local Windows o Puente de Impresión.' });
  }
  const { printerName, dataBase64 } = req.body || {};
  if (!printerName || !dataBase64) {
    return res.status(400).json({ success: false, error: 'Faltan printerName o dataBase64' });
  }
  try {
    const buffer = Buffer.from(dataBase64, 'base64');
    const result = await sendRawBytesToWindowsPrinter(printerName, buffer);
    res.json(result);
  } catch (err) {
    console.error('Error enviando ticket RAW a impresora Windows:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

let dbInitPromise = null;
function ensureDbReady() {
  if (!dbInitPromise) {
    dbInitPromise = initDatabase().catch(err => {
      console.error('Error inicializando base de datos Neon:', err);
      dbInitPromise = null;
      throw err;
    });
  }
  return dbInitPromise;
}

// Middleware para asegurar que Neon DB esté lista en entornos serverless (Vercel)
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) {
    try {
      await ensureDbReady();
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Conectando con la base de datos Neon...' });
    }
  }
  next();
});

// Iniciar servidor local o exportar para Vercel
const PORT = process.env.PORT || 3000;

if (!process.env.VERCEL) {
  ensureDbReady()
    .then(() => {
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`===============================================`);
        console.log(` Sarmiento POS Servidor Activo en puerto ${PORT}`);
        console.log(` Web & Mobile: http://localhost:${PORT}`);
        console.log(` WebSocket Real-Time sincronizado en /ws`);
        console.log(`===============================================`);
      });
    })
    .catch(err => {
      console.error('Fallo fatal al inicializar la base de datos:', err);
    });
}

module.exports = app;
