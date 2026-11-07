const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('ADVERTENCIA: DATABASE_URL no está definida en .env. El sistema funcionará en modo fallback.');
}

const pool = new Pool({
  connectionString: connectionString || undefined,
  ssl: connectionString ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Error imprevisto en el cliente de PostgreSQL:', err);
});

// Catálogo oficial de pizzas del local
const officialPizzas = [
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

// Inicialización de tablas y estado limpio para el local
async function initDatabase() {
  if (!connectionString) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Tabla de Configuración general (Propinas, estados)
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_config (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL
      );
    `);

    // 2. Tabla de Personal
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_staff (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        role VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Categorías de la Carta
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_categories (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        icon VARCHAR(80) NOT NULL,
        sort_order INT DEFAULT 0
      );
    `);

    // 4. Platos y Bebidas
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_menu_items (
        id VARCHAR(50) PRIMARY KEY,
        category_id VARCHAR(50) NOT NULL,
        name VARCHAR(150) NOT NULL,
        price NUMERIC(12, 2) NOT NULL,
        description TEXT DEFAULT '',
        is_available BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Pedidos activos en mesas del salón
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_table_orders (
        table_name VARCHAR(50) PRIMARY KEY,
        items JSONB DEFAULT '[]'::jsonb,
        note TEXT DEFAULT '',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. Comandas de cocina
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_kitchen_orders (
        id VARCHAR(50) PRIMARY KEY,
        table_name VARCHAR(50) NOT NULL,
        waiter_name VARCHAR(150) NOT NULL,
        time VARCHAR(20) NOT NULL,
        status VARCHAR(30) DEFAULT 'pending',
        printed BOOLEAN DEFAULT FALSE,
        items JSONB NOT NULL,
        total NUMERIC(12, 2) NOT NULL,
        note TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. Registro de pagos y mesas cobradas
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_payment_history (
        id VARCHAR(50) PRIMARY KEY,
        table_name VARCHAR(50) NOT NULL,
        waiter VARCHAR(150) NOT NULL,
        time VARCHAR(20) NOT NULL,
        method VARCHAR(50) NOT NULL,
        total NUMERIC(12, 2) NOT NULL,
        paid_with NUMERIC(12, 2) NOT NULL,
        tip NUMERIC(12, 2) DEFAULT 0,
        items_summary TEXT DEFAULT '',
        items JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 8. Cierres de noche archivados
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_night_reports (
        id VARCHAR(50) PRIMARY KEY,
        date_str VARCHAR(100) NOT NULL,
        total_sales NUMERIC(12, 2) NOT NULL,
        cash_sales NUMERIC(12, 2) NOT NULL,
        transfer_sales NUMERIC(12, 2) NOT NULL,
        tips_pool NUMERIC(12, 2) NOT NULL,
        orders_count INT NOT NULL,
        note TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Configuración de propinas en $0 si no existe
    const tipsCheck = await client.query("SELECT * FROM pos_config WHERE key = 'general_tips_pool'");
    if (tipsCheck.rows.length === 0) {
      await client.query(`
        INSERT INTO pos_config (key, value)
        VALUES ('general_tips_pool', '0'::jsonb);
      `);
    }

    // Contraseña inicial del administrador Perello (1234 si no existe aún)
    const pwdCheck = await client.query("SELECT * FROM pos_config WHERE key = 'admin_password'");
    if (pwdCheck.rows.length === 0) {
      await client.query(`
        INSERT INTO pos_config (key, value)
        VALUES ('admin_password', '"1234"'::jsonb);
      `);
    }

    // Personal: Asegurar que exista el encargado Perello sin borrar los mozos creados
    await client.query(`
      INSERT INTO pos_staff (id, name, role)
      VALUES ('admin_perello', 'Perello (Encargado)', 'Cocina / Admin')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Categorías base (si no existen aún)
    const catCheck = await client.query('SELECT COUNT(*) FROM pos_categories');
    if (parseInt(catCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO pos_categories (id, name, icon, sort_order) VALUES
          ('pizzas', 'Pizzas', 'fa-pizza-slice', 1),
          ('milanesas', 'Sándwiches de Milanesa', 'fa-burger', 2),
          ('minutas', 'Hamburguesas y Papas', 'fa-utensils', 3),
          ('bebidas', 'Bebidas', 'fa-wine-glass', 4);
      `);
    }

    for (const p of officialPizzas) {
      await client.query(`
        INSERT INTO pos_menu_items (id, category_id, name, price, description)
        VALUES ($1, 'pizzas', $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          description = EXCLUDED.description;
      `, [p.id, p.name, p.price, p.desc]);
    }

    // Sincronizar precios en tabla legacy pizzas_precios si existe
    const legacyCheck = await client.query("SELECT to_regclass('public.pizzas_precios') AS tbl");
    if (legacyCheck.rows[0] && legacyCheck.rows[0].tbl) {
      await client.query(`
        UPDATE pizzas_precios
        SET precio_entera = CASE
          WHEN name = 'Muzzarella' THEN 15000
          WHEN name IN ('Provenzal', 'Cebollada', 'Margarita') THEN 16000
          WHEN name IN ('Rucula', 'Calabresa', 'Especial', 'Napolitana') THEN 17000
          WHEN name IN ('3 Quesos', 'Roquefort', 'Anchoas') THEN 18000
          ELSE precio_entera
        END,
        updated_at = CURRENT_TIMESTAMP;
      `);
    }

    // Mesas iniciales del salón (sin borrar mesas adicionales agregadas por el usuario)
    const defaultTables = ["Mesa 01", "Mesa 02", "Mesa 03", "Mesa 04", "Mesa 05", "Mesa 06", "Mesa Barra", "Para Llevar"];
    for (const tbl of defaultTables) {
      await client.query(`
        INSERT INTO pos_table_orders (table_name, items, note)
        VALUES ($1, '[]'::jsonb, '')
        ON CONFLICT (table_name) DO NOTHING;
      `, [tbl]);
    }

    // Consolidar comandas activas por mesa para que cada mesa tenga 1 sola comanda en cocina
    const activeOrdersRes = await client.query("SELECT * FROM pos_kitchen_orders WHERE status != 'paid' ORDER BY created_at ASC");
    const byTable = {};
    for (const r of activeOrdersRes.rows) {
      if (!byTable[r.table_name]) byTable[r.table_name] = [];
      byTable[r.table_name].push(r);
    }
    for (const tbl of Object.keys(byTable)) {
      const orders = byTable[tbl];
      if (orders.length > 1) {
        const target = orders[orders.length - 1];
        let mergedItems = [];
        let mergedTotal = 0;
        let hasPending = false;
        let notes = [];
        for (const ord of orders) {
          const items = Array.isArray(ord.items) ? ord.items : [];
          for (const it of items) {
            const itemStatus = it.status || (ord.status === 'delivered' ? 'delivered' : 'pending');
            if (itemStatus === 'pending') hasPending = true;
            mergedItems.push({
              ...it,
              status: itemStatus
            });
            mergedTotal += Number(it.price || 0) * Number(it.qty || 1);
          }
          if (ord.note && !notes.includes(ord.note)) notes.push(ord.note);
        }
        const finalStatus = hasPending ? 'pending' : 'delivered';
        await client.query(`
          UPDATE pos_kitchen_orders
          SET items = $1::jsonb, total = $2, status = $3, note = $4
          WHERE id = $5
        `, [JSON.stringify(mergedItems), mergedTotal, finalStatus, notes.join(' | '), target.id]);

        const idsToDelete = orders.slice(0, orders.length - 1).map(o => o.id);
        await client.query("DELETE FROM pos_kitchen_orders WHERE id = ANY($1)", [idsToDelete]);
      }
    }

    await client.query('COMMIT');
    console.log('Base de datos Neon PostgreSQL conectada y sincronizada.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al inicializar la base de datos Neon:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDatabase,
  officialPizzas
};
