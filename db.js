const { Pool } = require('pg');
require('dotenv').config();

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

    // Mesas iniciales del salón (sin borrar mesas adicionales agregadas por el usuario)
    const defaultTables = ["Mesa 01", "Mesa 02", "Mesa 03", "Mesa 04", "Mesa 05", "Mesa 06", "Mesa Barra", "Para Llevar"];
    for (const tbl of defaultTables) {
      await client.query(`
        INSERT INTO pos_table_orders (table_name, items, note)
        VALUES ($1, '[]'::jsonb, '')
        ON CONFLICT (table_name) DO NOTHING;
      `, [tbl]);
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
  initDatabase
};
