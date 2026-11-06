const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

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

    // Personal
    const staffRes = await pool.query("SELECT id, name, role FROM pos_staff ORDER BY created_at ASC");
    const staffList = staffRes.rows;

    // Categorías y Productos
    const catRes = await pool.query("SELECT id, name, icon, sort_order FROM pos_categories ORDER BY sort_order ASC, name ASC");
    const itemRes = await pool.query("SELECT id, category_id, name, price, description, is_available FROM pos_menu_items ORDER BY name ASC");

    const menuData = {};
    for (const cat of catRes.rows) {
      menuData[cat.id] = {
        id: cat.id,
        name: cat.name,
        icon: cat.icon,
        items: itemRes.rows
          .filter(i => i.category_id === cat.id)
          .map(i => ({
            id: i.id,
            name: i.name,
            price: Number(i.price),
            desc: i.description || ''
          }))
      };
    }

    // Asegurar que la categoría 'pizzas' siempre tenga cargadas las pizzas oficiales en la carta y base de datos
    if (!menuData['pizzas']) {
      menuData['pizzas'] = {
        id: 'pizzas',
        name: 'Pizzas',
        icon: 'fa-pizza-slice',
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
        } catch (_) {}
      }
      menuData['pizzas'].items = (officialPizzas || []).map(p => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        desc: p.desc || ''
      }));
    }

    // Pedidos en Mesas
    const tablesRes = await pool.query("SELECT table_name, items, note FROM pos_table_orders ORDER BY table_name ASC");
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
    const payRes = await pool.query("SELECT id, table_name, waiter, time, method, total, paid_with, tip, items_summary, items FROM pos_payment_history ORDER BY created_at DESC LIMIT 200");
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
      items: r.items
    }));

    // Cierres de noche archivados
    const reportRes = await pool.query("SELECT id, date_str, total_sales, cash_sales, transfer_sales, tips_pool, orders_count, note FROM pos_night_reports ORDER BY created_at DESC");
    const savedNightReports = reportRes.rows.map(r => ({
      id: r.id,
      dateStr: r.date_str,
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
        menuData,
        availableTables,
        ordersByTable,
        kitchenOrders,
        paymentHistory,
        savedNightReports
      }
    });
  } catch (err) {
    console.warn('Advertencia al obtener estado general de Neon DB (usando fallback seguro):', err.message);
    res.json({
      success: true,
      data: {
        staffList: [
          { id: 'admin_perello', name: 'Perello (Encargado)', role: 'Cocina / Admin' }
        ],
        generalTipsPool: 0,
        menuData: {
          pizzas: {
            id: 'pizzas',
            name: 'Pizzas',
            icon: 'fa-pizza-slice',
            items: (officialPizzas || []).map(p => ({ id: p.id, name: p.name, price: Number(p.price), desc: p.desc || '' }))
          },
          milanesas: { id: 'milanesas', name: 'Sándwiches de Milanesa', icon: 'fa-burger', items: [] },
          minutas: { id: 'minutas', name: 'Hamburguesas y Papas', icon: 'fa-utensils', items: [] },
          bebidas: { id: 'bebidas', name: 'Bebidas', icon: 'fa-wine-glass', items: [] }
        },
        availableTables: ["Mesa 01", "Mesa 02", "Mesa 03", "Mesa 04", "Mesa 05", "Mesa 06", "Mesa Barra", "Para Llevar"],
        ordersByTable: {},
        kitchenOrders: [],
        paymentHistory: [],
        savedNightReports: []
      }
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
      const existingItems = Array.isArray(existing.items) ? existing.items : [];

      const newItemsFormatted = (items || []).map(it => ({
        id: it.id || `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: it.name,
        note: it.note || '',
        price: Number(it.price),
        qty: Number(it.qty),
        status: 'pending',
        sentAt: time,
        isAddon: true,
        isPizzaLibre: it.isPizzaLibre || false,
        libreRound: it.libreRound || null
      }));

      // Mantener los existentes (con su estado actual) y agregar los nuevos como 'pending'
      const mergedItems = [...existingItems, ...newItemsFormatted];
      const mergedTotal = mergedItems.reduce((acc, i) => acc + (Number(i.price) * Number(i.qty)), 0);
      const mergedNote = note
        ? (existing.note ? `${existing.note} | ${note}` : note)
        : (existing.note || '');

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
      `, [waiterName || existing.waiter_name, time, JSON.stringify(mergedItems), mergedTotal, mergedNote, existing.id]);

      finalOrder = {
        id: existing.id,
        table,
        waiterName: waiterName || existing.waiter_name,
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
        id: it.id || `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: it.name,
        note: it.note || '',
        price: Number(it.price),
        qty: Number(it.qty),
        status: 'pending',
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

    broadcast({
      type: 'KITCHEN_ORDER_NEW',
      order: finalOrder
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

// 5. Marcar comanda como impresa en ticket térmico
app.put('/api/orders/:id/print', async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("UPDATE pos_kitchen_orders SET printed = TRUE WHERE id = $1", [id]);

    broadcast({
      type: 'ORDER_PRINTED',
      id
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error al marcar comanda como impresa:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Cobro de mesa (Checkout con propina voluntaria)
app.post('/api/checkout', async (req, res) => {
  const { table, waiter, time, method, total, paidWith, tip, itemsSummary, items } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const paymentId = `PAG-${Date.now().toString().slice(-4)}`;

    // Guardar en historial de pagos
    await client.query(`
      INSERT INTO pos_payment_history (id, table_name, waiter, time, method, total, paid_with, tip, items_summary, items, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, CURRENT_TIMESTAMP)
    `, [paymentId, table, waiter, time, method, total, paidWith, tip || 0, itemsSummary || '', JSON.stringify(items || [])]);

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
      waiter,
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

// 9. Productos: Agregar
app.post('/api/menu/item', async (req, res) => {
  const { id, categoryId, name, price, desc } = req.body;
  try {
    const itemId = id || `it_${Date.now().toString().slice(-6)}`;
    await pool.query(`
      INSERT INTO pos_menu_items (id, category_id, name, price, description)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        category_id = EXCLUDED.category_id,
        name = EXCLUDED.name,
        price = EXCLUDED.price,
        description = EXCLUDED.description
    `, [itemId, categoryId, name, price, desc || '']);

    if (categoryId === 'pizzas') {
      try {
        await pool.query(`
          UPDATE pizzas_precios
          SET precio_entera = $1, updated_at = CURRENT_TIMESTAMP
          WHERE LOWER(name) = LOWER($2)
        `, [price, name]);
      } catch (_) {}
    }

    broadcast({ type: 'MENU_REFRESH_REQUESTED' });
    res.json({ success: true, itemId });
  } catch (err) {
    console.error('Error al agregar plato:', err);
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

    const reportId = id || `CIERRE-${Date.now().toString().slice(-4)}`;

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
        console.log(` Rivera POS Servidor Activo en puerto ${PORT}`);
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
