const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Convert SQLite ? placeholders to PostgreSQL $1, $2, ...
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Add uppercase key aliases so existing code using row.COLUMN_NAME keeps working
function normalizeRow(row) {
  if (!row) return row;
  const result = { ...row };
  for (const k of Object.keys(row)) {
    result[k.toUpperCase()] = row[k];
  }
  return result;
}

function normalizeRows(rows) {
  return rows ? rows.map(normalizeRow) : [];
}

// SQLite-compatible db interface wrapping pg Pool
const db = {
  get(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    pool.query(convertPlaceholders(sql), params, (err, result) => {
      callback(err, result && result.rows.length ? normalizeRow(result.rows[0]) : undefined);
    });
  },

  all(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    pool.query(convertPlaceholders(sql), params, (err, result) => {
      callback(err, result ? normalizeRows(result.rows) : []);
    });
  },

  run(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    const isInsert = /^\s*INSERT/i.test(sql);
    let pgSql = convertPlaceholders(sql);
    if (isInsert) pgSql += ' RETURNING id';
    pool.query(pgSql, params, (err, result) => {
      if (callback) {
        const lastID = isInsert && result && result.rows && result.rows[0] ? result.rows[0].id : null;
        callback.call({ lastID }, err);
      }
    });
  },

  // Simulate SQLite prepared statements as a batch collector
  prepare(sql) {
    const pgSql = convertPlaceholders(sql);
    const batch = [];
    return {
      run(...args) { batch.push(args); },
      finalize(callback) {
        if (!batch.length) return callback && callback();
        Promise.all(batch.map(p => pool.query(pgSql, p)))
          .then(() => callback && callback())
          .catch(err => callback && callback(err));
      }
    };
  }
};

// --- Schema & seed ---

const BS_MONTHS = ['Baishakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];
const BS_SEED = {
  2078: [31,31,32,31,31,31,30,30,29,30,29,31],
  2079: [31,32,31,32,31,30,30,30,29,29,30,30],
  2080: [31,32,31,32,31,30,30,30,29,29,30,30],
  2081: [31,31,32,31,31,31,30,29,30,29,30,30],
  2082: [31,32,31,32,31,30,30,30,29,30,30,30],
  2083: [31,31,32,32,31,30,30,30,29,30,30,30],
};

async function initializeDB() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Administrator','Lab','Sales','Print')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('Administrator','Lab','Sales','Print'))`);

    await client.query(`CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      subcategory TEXT,
      unit TEXT,
      price REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory TEXT`);

    await client.query(`CREATE TABLE IF NOT EXISTS lab_tests (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      test_date TEXT,
      fat REAL,
      snf REAL,
      moisture REAL,
      result TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id),
      quantity REAL,
      unit TEXT,
      sale_date TEXT,
      customer TEXT,
      total_amount REAL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS nds_pricelist (
      id SERIAL PRIMARY KEY,
      sn INTEGER,
      product TEXT,
      wholesale REAL,
      mrp REAL,
      category TEXT,
      unit TEXT,
      qty TEXT,
      barcode INTEGER,
      url TEXT,
      subcategory TEXT,
      description TEXT
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS nds_orders (
      id SERIAL PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      customer_address TEXT,
      order_date TEXT NOT NULL,
      bs_date TEXT,
      ready_date TEXT,
      payment_method TEXT DEFAULT 'QR Code',
      payment_status TEXT DEFAULT 'Pending',
      order_status TEXT DEFAULT 'New',
      total_amount REAL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add customer_email column if it doesn't exist (for existing installs)
    await client.query(`ALTER TABLE nds_orders ADD COLUMN IF NOT EXISTS customer_email TEXT`);

    await client.query(`CREATE TABLE IF NOT EXISTS nds_order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES nds_orders(id),
      order_no TEXT NOT NULL,
      product_id INTEGER,
      product TEXT NOT NULL,
      category TEXT,
      subcategory TEXT,
      unit TEXT,
      qty_pack TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      mrp REAL NOT NULL,
      amount REAL NOT NULL
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS rnepalical (
      id SERIAL PRIMARY KEY,
      bs_year INTEGER NOT NULL,
      bs_month INTEGER NOT NULL,
      month_name TEXT NOT NULL,
      days INTEGER NOT NULL,
      cumstartdays INTEGER,
      cumdays INTEGER,
      UNIQUE(bs_year, bs_month)
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS calendar_notes (
      id SERIAL PRIMARY KEY,
      bs_date TEXT NOT NULL UNIQUE,
      note TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS product_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS product_units (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS rm_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS rm_units (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS raw_materials (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT,
      unit TEXT,
      price REAL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS price REAL`);

    await client.query(`CREATE TABLE IF NOT EXISTS product_recipes (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL,
      raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, raw_material_id)
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS product_recipe_headers (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL UNIQUE,
      base_quantity REAL NOT NULL DEFAULT 1,
      base_unit TEXT,
      batch_output_qty REAL
    )`);
    await client.query(`ALTER TABLE product_recipe_headers ADD COLUMN IF NOT EXISTS batch_output_qty REAL`);
    await client.query(`ALTER TABLE product_recipe_headers ADD COLUMN IF NOT EXISTS discount REAL`);
    await client.query(`ALTER TABLE product_recipe_headers ADD COLUMN IF NOT EXISTS overhead_pct REAL`);
    await client.query(`ALTER TABLE product_recipe_headers ADD COLUMN IF NOT EXISTS production_loss_pct REAL`);
    await client.query(`ALTER TABLE product_recipe_headers ADD COLUMN IF NOT EXISTS damage_pct REAL`);

    await client.query(`CREATE TABLE IF NOT EXISTS product_recipe_sub (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL,
      sub_product_id INTEGER NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, sub_product_id)
    )`);

    // Re-point product_id FKs from products → nds_pricelist
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE product_recipes DROP CONSTRAINT IF EXISTS product_recipes_product_id_fkey;
      EXCEPTION WHEN undefined_object THEN NULL; END $$
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE product_recipe_headers DROP CONSTRAINT IF EXISTS product_recipe_headers_product_id_fkey;
      EXCEPTION WHEN undefined_object THEN NULL; END $$
    `);

    // RAW_MILK_DAILY — Raw milk collection records
    await client.query(`CREATE TABLE IF NOT EXISTS raw_milk_daily (
      rmd_id          SERIAL PRIMARY KEY,
      district        VARCHAR(25),
      supplier        VARCHAR(60),
      quantity        NUMERIC(12,2),
      fat             NUMERIC(6,3),
      snf             NUMERIC(6,3),
      ts              NUMERIC(7,4),
      fat_rate        NUMERIC(6,3),
      snf_rate        NUMERIC(6,3),
      ts_rate         NUMERIC(7,4),
      topping         NUMERIC(5,2),
      premium         NUMERIC(5,2),
      created         TIMESTAMP,
      updated         TIMESTAMP,
      created_np      VARCHAR(25),
      updated_np      VARCHAR(25),
      created_by      VARCHAR(100),
      updated_by      VARCHAR(100),
      last_purchased_date TIMESTAMP,
      last_purchased_np   VARCHAR(25),
      rate            NUMERIC(11,4),
      total_amount    NUMERIC(13,3),
      purchased_date  TIMESTAMP NOT NULL,
      purchased_np    VARCHAR(25),
      premium_fat     NUMERIC(5,3),
      premium_snf     NUMERIC(5,3),
      premium_amount  NUMERIC(12,2),
      snf_penalty     NUMERIC(9,2),
      fat_penalty     NUMERIC(9,2),
      penalty         NUMERIC(9,2),
      penalty_amount  NUMERIC(9,2),
      smp             NUMERIC(9,0),
      ghee            NUMERIC(9,0),
      chamber         NUMERIC(1,0),
      clr             NUMERIC(5,2),
      incharge        VARCHAR(35),
      driver          VARCHAR(35),
      tanker          NUMERIC(6,0),
      source          VARCHAR(9),
      temperature     NUMERIC(3,1),
      acidity         NUMERIC(4,2),
      cob             VARCHAR(8),
      aditn           VARCHAR(8),
      fat_amt         NUMERIC(7,1),
      snf_amt         NUMERIC(7,1),
      ts_amt          NUMERIC(7,0),
      rm_id           NUMERIC,
      fat_kg          NUMERIC(9,2),
      snf_kg          NUMERIC(9,2),
      ts_kg           NUMERIC(9,2),
      km              NUMERIC(4,0),
      diesel_rate     NUMERIC(5,2),
      transport_rate  NUMERIC(5,2),
      transport_cost  NUMERIC(8,2),
      total_cost      NUMERIC(9,2),
      rent            NUMERIC(8,2),
      top_amt         NUMERIC(7,1),
      receive         VARCHAR(25),
      receive_id      NUMERIC
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS raw_milk_receive (
      receive_id  SERIAL PRIMARY KEY,
      receive     VARCHAR(50) NOT NULL,
      active      BOOLEAN DEFAULT TRUE
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS raw_milk_rate (
      rm_id               SERIAL PRIMARY KEY,
      district            VARCHAR(25),
      supplier            VARCHAR(100),
      quantity            NUMERIC(12,2),
      fat                 NUMERIC(6,3),
      snf                 NUMERIC(6,3),
      ts                  NUMERIC(5,4),
      fat_rate            NUMERIC(6,3),
      snf_rate            NUMERIC(6,3),
      ts_rate             NUMERIC(5,4),
      topping             NUMERIC(5,2),
      premium             NUMERIC(5,2),
      created             TIMESTAMP,
      updated             TIMESTAMP,
      created_np          VARCHAR(25),
      updated_np          VARCHAR(25),
      created_by          VARCHAR(100),
      updated_by          VARCHAR(100),
      last_purchased_date TIMESTAMP,
      last_purchased_np   VARCHAR(25),
      rate                NUMERIC(9,2),
      total_amount        NUMERIC(12,2),
      premium_fat         NUMERIC(5,3),
      premium_snf         NUMERIC(5,3),
      smp                 NUMERIC(9,0),
      ghee                NUMERIC(9,0),
      rate_change_date    TIMESTAMP,
      rate_change_date_np VARCHAR(25),
      active              VARCHAR(1)
    )`);

    // Add columns if upgrading from older schema
    const rmrCols = [
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS quantity            NUMERIC(12,2)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS fat                 NUMERIC(6,3)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS snf                 NUMERIC(6,3)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS ts                  NUMERIC(5,4)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS ts_rate             NUMERIC(5,4)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS created             TIMESTAMP`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS updated             TIMESTAMP`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS created_np          VARCHAR(25)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS updated_np          VARCHAR(25)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS created_by          VARCHAR(100)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS updated_by          VARCHAR(100)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS last_purchased_date TIMESTAMP`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS last_purchased_np   VARCHAR(25)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS rate                NUMERIC(9,2)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS total_amount        NUMERIC(12,2)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS premium_fat         NUMERIC(5,3)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS premium_snf         NUMERIC(5,3)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS smp                 NUMERIC(9,0)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS ghee                NUMERIC(9,0)`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS rate_change_date    TIMESTAMP`,
      `ALTER TABLE raw_milk_rate ADD COLUMN IF NOT EXISTS rate_change_date_np VARCHAR(25)`,
    ];
    for (const sql of rmrCols) await client.query(sql);

    // Trigger: auto-set created/updated timestamps on raw_milk_rate insert/update
    // created_by/updated_by/created_np/updated_np are set by the application
    await client.query(`
      CREATE OR REPLACE FUNCTION fn_raw_milk_rate_audit()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          NEW.created := CURRENT_TIMESTAMP;
          NEW.updated := CURRENT_TIMESTAMP;
        ELSIF TG_OP = 'UPDATE' THEN
          NEW.updated := CURRENT_TIMESTAMP;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`DROP TRIGGER IF EXISTS raw_milk_rate_t1 ON raw_milk_rate`);
    await client.query(`
      CREATE TRIGGER raw_milk_rate_t1
      BEFORE INSERT OR UPDATE ON raw_milk_rate
      FOR EACH ROW EXECUTE FUNCTION fn_raw_milk_rate_audit()
    `);

    await client.query(`CREATE TABLE IF NOT EXISTS raw_milk_transport_rate (
      id          SERIAL PRIMARY KEY,
      district    VARCHAR(25),
      supplier    VARCHAR(25),
      fr          VARCHAR(25),
      to1         VARCHAR(25),
      km          NUMERIC(6,2),
      rate        NUMERIC(6,2),
      rent        NUMERIC(6,2),
      created     TIMESTAMP,
      updated     TIMESTAMP,
      created_np  VARCHAR(25),
      updated_np  VARCHAR(25),
      created_by  VARCHAR(100),
      updated_by  VARCHAR(100),
      diesel_rate NUMERIC(6,2),
      tanker      NUMERIC(8,0),
      driver      VARCHAR(20),
      active      VARCHAR(1)
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS raw_milk_incharge (
      incharge_id SERIAL PRIMARY KEY,
      incharge    VARCHAR(32) NOT NULL
    )`);


    // Add columns to raw_milk_daily if upgrading from older schema
    const rmdCols = [
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS fat_kg         NUMERIC(9,2)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS snf_kg         NUMERIC(9,2)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS ts_kg          NUMERIC(9,2)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS km             NUMERIC(4,0)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS diesel_rate    NUMERIC(5,2)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS transport_rate NUMERIC(5,2)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS transport_cost NUMERIC(8,2)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS total_cost     NUMERIC(9,2)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS rent           NUMERIC(8,2)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS top_amt        NUMERIC(7,1)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS receive        VARCHAR(25)`,
      `ALTER TABLE raw_milk_daily ADD COLUMN IF NOT EXISTS receive_id     NUMERIC`,
    ];
    for (const sql of rmdCols) await client.query(sql);

    // Indexes for raw_milk_daily
    await client.query(`CREATE INDEX IF NOT EXISTS raw_milk_daily_idx1 ON raw_milk_daily (purchased_date, purchased_np)`);
    await client.query(`CREATE INDEX IF NOT EXISTS raw_milk_daily_idx2 ON raw_milk_daily (purchased_np, tanker, chamber, source)`);

    // Trigger: auto-set created/updated timestamps and user on insert/update
    await client.query(`
      CREATE OR REPLACE FUNCTION fn_raw_milk_daily_audit()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          NEW.created    := CURRENT_TIMESTAMP;
          NEW.updated    := CURRENT_TIMESTAMP;
          IF NEW.created_by IS NULL THEN NEW.created_by := CURRENT_USER; END IF;
          IF NEW.updated_by IS NULL THEN NEW.updated_by := CURRENT_USER; END IF;
        ELSIF TG_OP = 'UPDATE' THEN
          NEW.updated    := CURRENT_TIMESTAMP;
          IF NEW.updated_by IS NULL THEN NEW.updated_by := CURRENT_USER; END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`DROP TRIGGER IF EXISTS raw_milk_daily_t1 ON raw_milk_daily`);
    await client.query(`
      CREATE TRIGGER raw_milk_daily_t1
      BEFORE INSERT OR UPDATE ON raw_milk_daily
      FOR EACH ROW EXECUTE FUNCTION fn_raw_milk_daily_audit()
    `);

    await client.query(`CREATE TABLE IF NOT EXISTS app_settings (
      id    SERIAL PRIMARY KEY,
      key   TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL DEFAULT ''
    )`);
    const defaultSettings = [
      ['company_name',    'Nepal Dairy Pvt. Ltd.'],
      ['company_address', ''],
      ['company_phone',   ''],
      ['company_email',   ''],
      ['company_pan',     ''],
    ];
    for (const [key, value] of defaultSettings) {
      await client.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    // Seed default users
    const users = [
      ['admin',     bcrypt.hashSync('admin123', 10), 'Administrator'],
      ['labuser',   bcrypt.hashSync('lab123',   10), 'Lab'],
      ['salesuser', bcrypt.hashSync('sales123', 10), 'Sales'],
    ];
    for (const [username, password, role] of users) {
      await client.query(
        `INSERT INTO users (username, password, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING`,
        [username, password, role]
      );
    }

    // Seed sample products
    const products = [
      [1, 'Full Cream Milk', 'Milk',         'Liter', 85],
      [2, 'Butter',          'Fat Products', 'Kg',    650],
      [3, 'Cheese',          'Dairy',        'Kg',    900],
      [4, 'Yogurt',          'Fermented',    'Kg',    180],
      [5, 'Ghee',            'Fat Products', 'Kg',    1200],
    ];
    for (const [id, name, category, unit, price] of products) {
      await client.query(
        `INSERT INTO products (id, name, category, unit, price) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [id, name, category, unit, price]
      );
    }

    // Seed Nepali calendar data if empty
    const { rows } = await client.query('SELECT COUNT(*) as cnt FROM rnepalical');
    if (parseInt(rows[0].cnt) === 0) {
      let cumdays = 0;
      for (const year of Object.keys(BS_SEED).sort()) {
        for (let mi = 0; mi < BS_SEED[year].length; mi++) {
          const days = BS_SEED[year][mi];
          const cumstart = cumdays + 1;
          cumdays += days;
          await client.query(
            `INSERT INTO rnepalical (bs_year, bs_month, month_name, days, cumstartdays, cumdays)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (bs_year, bs_month) DO NOTHING`,
            [parseInt(year), mi + 1, BS_MONTHS[mi], days, cumstart, cumdays]
          );
        }
      }
    }

    console.log('Connected to PostgreSQL and schema ready.');
  } catch (err) {
    console.error('DB init error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

initializeDB().catch(err => {
  console.error('Fatal DB init error:', err.message);
  process.exit(1);
});

module.exports = db;
