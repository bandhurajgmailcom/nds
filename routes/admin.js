const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
let createCanvas, registerFont;
try {
  const canvasMod = require('canvas');
  createCanvas  = canvasMod.createCanvas;
  registerFont  = canvasMod.registerFont;
  // Register a bundled free font so text renders on any server (Linux/Vercel)
  const fontPath = require('path').join(__dirname, '..', 'fonts', 'Roboto-Regular.ttf');
  if (require('fs').existsSync(fontPath)) {
    registerFont(fontPath, { family: 'Roboto' });
  }
} catch (_) { createCanvas = null; }

function drawPieChart(catData) {
  const W = 760, H = 490;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#F0F4F8';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(8, 8, W - 16, H - 16);

  // Title bar
  ctx.fillStyle = '#0D47A1';
  ctx.fillRect(8, 8, W - 16, 46);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 15px Roboto';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Raw Material Cost Distribution by Category', W / 2, 31);

  const COLORS = ['#1565C0','#2E7D32','#E65100','#6A1B9A','#00695C',
                  '#C62828','#37474F','#0277BD','#558B2F','#AD1457'];
  const total = catData.reduce((s, c) => s + c.amount, 0);

  if (!catData.length || total === 0) {
    ctx.fillStyle = '#9E9E9E'; ctx.font = '14px Roboto';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No cost data available', W / 2, H / 2);
    return canvas.toBuffer('image/png');
  }

  // Pie
  const cx = 205, cy = 265, r = 168;
  let startAngle = -Math.PI / 2;
  catData.forEach((cat, i) => {
    const angle = (cat.amount / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + angle);
    ctx.closePath();
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const pct = cat.amount / total;
    if (pct >= 0.06) {
      const mid = startAngle + angle / 2;
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px Roboto';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((pct * 100).toFixed(1) + '%', cx + r * 0.62 * Math.cos(mid), cy + r * 0.62 * Math.sin(mid));
    }
    startAngle += angle;
  });

  // Inner circle (donut effect)
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.38, 0, 2 * Math.PI);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.fillStyle = '#0D47A1';
  ctx.font = 'bold 11px Roboto';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Total', cx, cy - 10);
  ctx.font = 'bold 12px Roboto';
  ctx.fillText('Rs. ' + total.toFixed(0), cx, cy + 8);

  // Legend
  const lx = 412, sy = 68, rowH = 34, boxS = 14;
  catData.forEach((cat, i) => {
    const y = sy + i * rowH;
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.fillRect(lx, y, boxS, boxS);
    let label = cat.category.length > 22 ? cat.category.slice(0, 20) + '…' : cat.category;
    ctx.fillStyle = '#1A1A1A';
    ctx.font = 'bold 12px Roboto';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, lx + boxS + 8, y);
    ctx.fillStyle = '#555555';
    ctx.font = '11px Roboto';
    const pct = (cat.amount / total * 100).toFixed(1);
    ctx.fillText('Rs. ' + cat.amount.toFixed(2) + '  (' + pct + '%)', lx + boxS + 8, y + 16);
  });

  // Grand total line in legend
  const gy = sy + catData.length * rowH + 6;
  ctx.strokeStyle = '#0D47A1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(lx, gy);
  ctx.lineTo(W - 16, gy);
  ctx.stroke();
  ctx.fillStyle = '#0D47A1';
  ctx.font = 'bold 12px Roboto';
  ctx.textBaseline = 'top';
  ctx.fillText('Grand Total:  Rs. ' + total.toFixed(2), lx, gy + 6);

  // Border
  ctx.strokeStyle = '#CFD8DC';
  ctx.lineWidth = 1;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  return canvas.toBuffer('image/png');
}

function adminOnly(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'Administrator') return res.status(403).render('error', { message: 'Access denied.' });
  next();
}

// Users management
router.get('/users', adminOnly, (req, res) => {
  db.all('SELECT id, username, role, created_at FROM users ORDER BY id', (err, users) => {
    res.render('admin/users', {
      users: users || [],
      user: req.session.user,
      success: req.query.success || '',
      error: req.query.error || ''
    });
  });
});

router.post('/users/add', adminOnly, (req, res) => {
  const { username, password, role } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hash, role], (err) => {
    if (err) return res.redirect('/admin/users?error=Username already exists');
    res.redirect('/admin/users?success=User added');
  });
});

router.post('/users/delete/:id', adminOnly, (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) return res.redirect('/admin/users?error=Cannot delete yourself');
  db.run('DELETE FROM users WHERE id = ?', [req.params.id], () => res.redirect('/admin/users?success=User deleted'));
});

router.post('/users/change-password/:id', adminOnly, (req, res) => {
  const id = parseInt(req.params.id);
  const { new_password } = req.body;
  if (!new_password || new_password.length < 4)
    return res.redirect('/admin/users?error=Password must be at least 4 characters');
  const hash = bcrypt.hashSync(new_password, 10);
  db.run('UPDATE users SET password = ? WHERE id = ?', [hash, id], (err) => {
    if (err) return res.redirect('/admin/users?error=Update failed');
    res.redirect('/admin/users?success=Password updated');
  });
});

// Products management — backed by NDS_PRICELIST
router.get('/products', adminOnly, (req, res) => {
  const search = (req.query.search || '').trim();
  const sql = search
    ? `SELECT * FROM NDS_PRICELIST WHERE PRODUCT ILIKE ? OR CATEGORY ILIKE ? OR SUBCATEGORY ILIKE ? ORDER BY SN`
    : `SELECT * FROM NDS_PRICELIST ORDER BY SN`;
  const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
  db.all(sql, params, (err, products) => {
    db.all('SELECT DISTINCT CATEGORY FROM NDS_PRICELIST WHERE CATEGORY IS NOT NULL ORDER BY CATEGORY', (e2, cats) => {
      db.all('SELECT DISTINCT SUBCATEGORY FROM NDS_PRICELIST WHERE SUBCATEGORY IS NOT NULL ORDER BY SUBCATEGORY', (e3, subcats) => {
        db.all('SELECT DISTINCT UNIT FROM NDS_PRICELIST WHERE UNIT IS NOT NULL ORDER BY UNIT', (e4, unitRows) => {
          db.all('SELECT DISTINCT QTY FROM NDS_PRICELIST WHERE QTY IS NOT NULL ORDER BY QTY', (e5, qtyRows) => {
            res.render('admin/products', {
              products: products || [],
              categories: (cats || []).map(r => r.CATEGORY || r.category),
              subcategories: (subcats || []).map(r => r.SUBCATEGORY || r.subcategory),
              units: (unitRows || []).map(r => r.UNIT || r.unit),
              qtys: (qtyRows || []).map(r => r.QTY || r.qty),
              search,
              user: req.session.user,
              success: req.query.success || '',
              error: req.query.error || ''
            });
          });
        });
      });
    });
  });
});

router.post('/products/add', adminOnly, (req, res) => {
  const { sn, product, category, subcategory, unit, qty, wholesale, mrp, description } = req.body;
  if (!product || !product.trim()) return res.redirect('/admin/products?error=Product name is required');
  db.run(
    `INSERT INTO NDS_PRICELIST (SN, PRODUCT, CATEGORY, SUBCATEGORY, UNIT, QTY, WHOLESALE, MRP, DESCRIPTION)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sn ? parseInt(sn) : null, product.trim(), category || null, subcategory || null,
     unit || null, qty || null, wholesale ? parseFloat(wholesale) : null,
     mrp ? parseFloat(mrp) : null, description || null],
    (err) => {
      if (err) return res.redirect('/admin/products?error=Failed to add product');
      res.redirect('/admin/products?success=Product added');
    });
});

router.post('/products/update/:id', adminOnly, (req, res) => {
  const { sn, product, category, subcategory, unit, qty, wholesale, mrp, description } = req.body;
  if (!product || !product.trim()) return res.redirect('/admin/products?error=Product name is required');
  db.run(
    `UPDATE NDS_PRICELIST SET SN=?, PRODUCT=?, CATEGORY=?, SUBCATEGORY=?, UNIT=?, QTY=?, WHOLESALE=?, MRP=?, DESCRIPTION=?
     WHERE ID=?`,
    [sn ? parseInt(sn) : null, product.trim(), category || null, subcategory || null,
     unit || null, qty || null, wholesale ? parseFloat(wholesale) : null,
     mrp ? parseFloat(mrp) : null, description || null, req.params.id],
    (err) => {
      if (err) return res.redirect('/admin/products?error=Update failed');
      res.redirect('/admin/products?success=Product updated');
    });
});

router.post('/products/delete/:id', adminOnly, (req, res) => {
  db.run('DELETE FROM NDS_PRICELIST WHERE ID = ?', [req.params.id], () =>
    res.redirect('/admin/products?success=Product deleted'));
});

// Raw Materials management
router.get('/rawmaterials', adminOnly, (req, res) => {
  db.all('SELECT * FROM raw_materials ORDER BY name', (err, materials) => {
    db.all('SELECT * FROM rm_categories ORDER BY name', (err2, categories) => {
      db.all('SELECT * FROM rm_units ORDER BY name', (err3, units) => {
        res.render('admin/rawmaterials', {
          materials: materials || [],
          categories: categories || [],
          units: units || [],
          user: req.session.user,
          success: req.query.success || '',
          error: req.query.error || ''
        });
      });
    });
  });
});

router.post('/rawmaterials/add', adminOnly, (req, res) => {
  const { name, category, unit, price, notes } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin/rawmaterials?error=Name is required');
  const priceVal = price ? parseFloat(price) : null;
  db.run('INSERT INTO raw_materials (name, category, unit, price, notes) VALUES (?, ?, ?, ?, ?)',
    [name.trim(), category, unit, priceVal, notes],
    (err) => {
      if (err) return res.redirect('/admin/rawmaterials?error=Raw material already exists');
      res.redirect('/admin/rawmaterials?success=Raw material added');
    });
});

router.post('/rawmaterials/edit/:id', adminOnly, (req, res) => {
  const { name, category, unit, price } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin/rawmaterials?error=Name is required');
  const priceVal = price ? parseFloat(price) : null;
  db.run('UPDATE raw_materials SET name=?, category=?, unit=?, price=? WHERE id=?',
    [name.trim(), category || null, unit || null, priceVal, req.params.id],
    (err) => {
      if (err) return res.redirect('/admin/rawmaterials?error=Could not update raw material');
      res.redirect('/admin/rawmaterials?success=Raw material updated');
    });
});

router.post('/rawmaterials/delete/:id', adminOnly, (req, res) => {
  db.run('DELETE FROM raw_materials WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.redirect('/admin/rawmaterials?error=Cannot delete — used in a recipe');
    res.redirect('/admin/rawmaterials?success=Raw material deleted');
  });
});

// Category picklist
router.post('/rawmaterials/categories/add', adminOnly, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/admin/rawmaterials?error=Category name required');
  db.run('INSERT INTO rm_categories (name) VALUES (?)', [name], (err) => {
    if (err) return res.redirect('/admin/rawmaterials?error=Category already exists');
    res.redirect('/admin/rawmaterials?success=Category added');
  });
});

router.post('/rawmaterials/categories/delete/:id', adminOnly, (req, res) => {
  db.run('DELETE FROM rm_categories WHERE id = ?', [req.params.id], () => {
    res.redirect('/admin/rawmaterials?success=Category removed');
  });
});

// Unit picklist
router.post('/rawmaterials/units/add', adminOnly, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/admin/rawmaterials?error=Unit name required');
  db.run('INSERT INTO rm_units (name) VALUES (?)', [name], (err) => {
    if (err) return res.redirect('/admin/rawmaterials?error=Unit already exists');
    res.redirect('/admin/rawmaterials?success=Unit added');
  });
});

router.post('/rawmaterials/units/delete/:id', adminOnly, (req, res) => {
  db.run('DELETE FROM rm_units WHERE id = ?', [req.params.id], () => {
    res.redirect('/admin/rawmaterials?success=Unit removed');
  });
});

// Recipe summary — one row per product with batch header + rolled-up ingredient cost
const RECIPE_SUMMARY_SQL = `
  SELECT
    p.ID            AS product_id,
    p.PRODUCT       AS name,
    p.CATEGORY      AS category,
    p.SUBCATEGORY   AS subcategory,
    p.WHOLESALE     AS wholesale,
    p.QTY           AS qty_pack,
    h.base_quantity,
    h.base_unit,
    h.batch_output_qty,
    h.discount,
    h.overhead_pct,
    h.production_loss_pct,
    h.damage_pct,
    COALESCE(rm_agg.raw_cost, 0) + COALESCE(sub_agg.sub_cost, 0) AS total_cost,
    COALESCE(rm_agg.ingredient_count, 0)                          AS ingredient_count,
    COALESCE(rm_agg.missing_prices, 0)                            AS missing_prices
  FROM product_recipe_headers h
  JOIN NDS_PRICELIST p ON p.ID = h.product_id
  LEFT JOIN (
    SELECT
      pr.product_id,
      SUM(pr.quantity * r.price)                       AS raw_cost,
      COUNT(pr.id)                                     AS ingredient_count,
      SUM(CASE WHEN r.price IS NULL THEN 1 ELSE 0 END) AS missing_prices
    FROM product_recipes pr
    LEFT JOIN raw_materials r ON r.id = pr.raw_material_id
    GROUP BY pr.product_id
  ) rm_agg ON rm_agg.product_id = h.product_id
  LEFT JOIN (
    SELECT
      prs.product_id,
      SUM(prs.quantity * sub_rm.raw_cost / NULLIF(sub_h.batch_output_qty, 0)) AS sub_cost
    FROM product_recipe_sub prs
    JOIN product_recipe_headers sub_h ON sub_h.product_id = prs.sub_product_id
    LEFT JOIN (
      SELECT pr2.product_id, SUM(pr2.quantity * r2.price) AS raw_cost
      FROM product_recipes pr2
      LEFT JOIN raw_materials r2 ON r2.id = pr2.raw_material_id
      GROUP BY pr2.product_id
    ) sub_rm ON sub_rm.product_id = prs.sub_product_id
    WHERE sub_h.batch_output_qty > 0
    GROUP BY prs.product_id
  ) sub_agg ON sub_agg.product_id = h.product_id
  ORDER BY p.CATEGORY, p.SUBCATEGORY, p.PRODUCT
`;

// Categories hidden from the Recipes, Recipe Summary and Recipe Detail pages (and exports)
const RECIPE_HIDDEN_CATEGORIES = ['Ice-Cream', 'Dairy', 'Cheese', 'Sweets'];
const recipeVisible = r => !RECIPE_HIDDEN_CATEGORIES.includes(r.category);

// Recipe summary
router.get('/recipe-summary', adminOnly, (req, res) => {
  db.all(RECIPE_SUMMARY_SQL, (err, rows) => {
    res.render('admin/recipe-summary', {
      rows: (rows || []).filter(recipeVisible),
      user: req.session.user,
      error: err ? err.message : ''
    });
  });
});

// Recipe summary — spreadsheet export (honours category / subcategory / product filters)
router.get('/recipe-summary/export', adminOnly, async (req, res) => {
  try {
    const fCat  = (req.query.category || '').trim();
    const fSub  = (req.query.subcategory || '').trim();
    const fName = (req.query.product || '').trim().toLowerCase();
    const result = await pool.query(RECIPE_SUMMARY_SQL);
    const rows = result.rows.filter(r =>
      recipeVisible(r) &&
      (!fCat  || (r.category || '') === fCat) &&
      (!fSub  || (r.subcategory || '') === fSub) &&
      (!fName || (r.name || '').toLowerCase().includes(fName))
    );

    let companyName = "nd's";
    try {
      const sRes = await pool.query(`SELECT key, value FROM app_settings`);
      const sm = {}; sRes.rows.forEach(r => { sm[r.key] = r.value; });
      if (sm.company_name) companyName = sm.company_name;
    } catch (_) {}

    const safeN = v => (v != null && Number.isFinite(v)) ? v : null;
    const C = {
      darkBlue: '0D47A1', midBlue: '1565C0', lightBlue: 'BBDEFB', subhead: 'E3F2FD',
      green: '2E7D32', red: 'C62828', orange: 'E65100', grey: '757575',
      white: 'FFFFFF', black: '000000', incomeFg: '1976D2',
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Nepal Dairy NDS';
    wb.created = new Date();
    wb.views = [{ x: 0, y: 0, width: 26250, height: 15000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];

    const ws = wb.addWorksheet('Recipe Summary', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                   margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
      views: [{ state: 'frozen', ySplit: 5, topLeftCell: 'A6' }]
    });

    const COLS = 15;
    ws.columns = [
      { width: 30 }, { width: 9 }, { width: 16 }, { width: 16 },
      { width: 10 }, { width: 10 }, { width: 12 }, { width: 12 },
      { width: 10 }, { width: 12 }, { width: 14 }, { width: 14 },
      { width: 14 }, { width: 10 }, { width: 12 }
    ];

    const addMergedRow = (text, rowH, styleOpts) => {
      const r = ws.addRow([]);
      const rn = r.number;
      r.height = rowH || 20;
      ws.mergeCells(rn, 1, rn, COLS);
      const anchor = ws.getCell(rn, 1);
      anchor.value = text;
      if (styleOpts.bg) anchor.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + styleOpts.bg } };
      anchor.font = { bold: !!styleOpts.bold, italic: !!styleOpts.italic, size: styleOpts.size || 11,
                       color: { argb: 'FF' + (styleOpts.fg || C.black) }, name: 'Calibri' };
      anchor.alignment = { horizontal: styleOpts.hAlign || 'left', vertical: 'middle' };
      return r;
    };

    const dateStr = new Date().toLocaleDateString('en-NP', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const filterBits = [fCat && `Category: ${fCat}`, fSub && `Sub-category: ${fSub}`, fName && `Product contains: "${req.query.product.trim()}"`].filter(Boolean);
    addMergedRow(companyName, 42, { bg: C.darkBlue, fg: C.white, bold: true, size: 20 });
    addMergedRow('Recipe Summary Report', 30, { bg: C.midBlue, fg: C.white, bold: true, size: 14 });
    addMergedRow(`Date: ${dateStr}` + (filterBits.length ? '   |   ' + filterBits.join('   ·   ') : ''), 20, { bg: C.subhead, fg: C.grey, italic: true, size: 10 });
    ws.addRow([]).height = 6;

    const thinGrey = { style: 'thin', color: { argb: 'FFD0D0D0' } };
    const sc = (cell, { bg, fg, bold, italic, size, hAlign, numFmt } = {}) => {
      if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
      cell.font = { bold: !!bold, italic: !!italic, size: size || 10, color: { argb: 'FF' + (fg || C.black) }, name: 'Calibri' };
      cell.alignment = { horizontal: hAlign || 'left', vertical: 'middle', wrapText: true };
      if (numFmt) cell.numFmt = numFmt;
      cell.border = { top: thinGrey, left: thinGrey, bottom: thinGrey, right: thinGrey };
    };

    const headerRow = ws.addRow([
      'Product', 'QTY/Pack', 'Category', 'Sub-category', 'Batch Qty', 'Batch Unit',
      'Output Qty (pcs)', 'Overhead Exp (%)', 'Return %', 'Sellable (pcs)',
      'Total Cost (Rs.)', 'Total Income (Rs.)', 'Total Margin (Rs.)', 'Margin %', 'Margin/pc (Rs.)'
    ]);
    headerRow.height = 30;
    headerRow.eachCell(cell => sc(cell, { bg: C.midBlue, fg: C.white, bold: true, hAlign: 'center' }));

    let lastCat;
    let anyMissing = false;
    rows.forEach(r => {
      const cat = r.category || '(No Category)';
      if (cat !== lastCat) {
        lastCat = cat;
        addMergedRow(cat, 18, { bg: C.lightBlue, fg: C.midBlue, bold: true });
      }

      const rawCost        = r.total_cost != null ? parseFloat(r.total_cost) : null;
      const wholesale      = r.wholesale != null ? parseFloat(r.wholesale) : null;
      const discount       = r.discount != null ? parseFloat(r.discount) : 0;
      const overheadPct    = r.overhead_pct != null ? parseFloat(r.overhead_pct) : 0;
      const productionLoss = r.production_loss_pct != null ? parseFloat(r.production_loss_pct) : 0;
      const damagePct      = r.damage_pct != null ? parseFloat(r.damage_pct) : 0;
      const outputQty      = r.batch_output_qty != null ? parseFloat(r.batch_output_qty) : null;
      const sellableQty    = outputQty != null ? outputQty * (1 - damagePct / 100) : null;
      const effWS          = wholesale != null ? wholesale / (1 + discount / 100) : null;
      const lossCost       = rawCost != null ? rawCost * (1 + productionLoss / 100) : null;
      const totalCost      = lossCost != null ? lossCost * (1 + overheadPct / 100) : null;
      const totalIncome    = effWS != null && sellableQty != null ? effWS * sellableQty : null;
      const hasMissing     = parseInt(r.missing_prices) > 0;
      const totalMargin    = totalIncome != null && totalCost != null && !hasMissing ? totalIncome - totalCost : null;
      const marginPct      = totalMargin != null && totalIncome > 0 ? totalMargin / totalIncome : null;
      const marginPc       = totalMargin != null && sellableQty > 0 ? totalMargin / sellableQty : null;
      if (hasMissing) anyMissing = true;

      const qtyPack = r.qty_pack != null && r.qty_pack !== '' && Number.isFinite(Number(r.qty_pack)) ? Number(r.qty_pack) : (r.qty_pack || null);
      const row = ws.addRow([
        r.name + (hasMissing ? ' *' : ''), qtyPack, r.category || '', r.subcategory || '',
        safeN(r.base_quantity != null ? parseFloat(r.base_quantity) : null), r.base_unit || '',
        safeN(outputQty),
        overheadPct > 0 ? overheadPct / 100 : null,
        damagePct > 0 ? damagePct / 100 : null,
        safeN(sellableQty), safeN(rawCost), safeN(totalIncome), safeN(totalMargin),
        safeN(marginPct), safeN(marginPc)
      ]);
      row.height = 18;
      const mFg = totalMargin != null ? (totalMargin >= 0 ? C.green : C.red) : C.black;
      for (let col = 1; col <= COLS; col++) {
        const opts = { bg: C.white };
        if ([2, 5, 7].includes(col)) opts.hAlign = 'right';
        if (col === 10) { opts.hAlign = 'right'; opts.numFmt = '#,##0.0'; }
        if (col === 8 || col === 9) { opts.hAlign = 'right'; opts.numFmt = '0.0%'; }
        if ([11, 12, 13, 15].includes(col)) { opts.hAlign = 'right'; opts.numFmt = '#,##0.00'; }
        if (col === 14) { opts.hAlign = 'right'; opts.numFmt = '0.0%'; }
        if (col === 12) opts.fg = C.incomeFg;
        if (col === 13 || col === 14 || col === 15) { opts.fg = mFg; opts.bold = totalMargin != null; }
        sc(row.getCell(col), opts);
      }
    });

    if (!rows.length) {
      addMergedRow('No recipes match the selected filters.', 20, { fg: C.grey, italic: true });
    }
    if (anyMissing) {
      ws.addRow([]);
      addMergedRow('* Some ingredient prices are missing — Total Cost and Margin for those rows may be understated.', 18, { fg: C.orange, italic: true, size: 10 });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="recipe-summary.xlsx"');
    const xlsBuf = await wb.xlsx.writeBuffer();
    res.end(xlsBuf);
  } catch (e) {
    console.error('Recipe summary export error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Recipe detail — header (same as Recipe Summary) plus full ingredient breakdown per product
router.get('/recipe-detail', adminOnly, (req, res) => {
  db.all(`
    SELECT
      p.ID            AS product_id,
      p.PRODUCT       AS name,
      p.CATEGORY      AS category,
      p.SUBCATEGORY   AS subcategory,
      p.WHOLESALE     AS wholesale,
      p.QTY           AS qty_pack,
      h.base_quantity,
      h.base_unit,
      h.batch_output_qty,
      h.discount,
      h.overhead_pct,
      h.production_loss_pct,
      h.damage_pct,
      COALESCE(rm_agg.raw_cost, 0) + COALESCE(sub_agg.sub_cost, 0) AS total_cost,
      COALESCE(rm_agg.ingredient_count, 0)                          AS ingredient_count,
      COALESCE(rm_agg.missing_prices, 0)                            AS missing_prices
    FROM product_recipe_headers h
    JOIN NDS_PRICELIST p ON p.ID = h.product_id
    LEFT JOIN (
      SELECT
        pr.product_id,
        SUM(pr.quantity * r.price)                       AS raw_cost,
        COUNT(pr.id)                                     AS ingredient_count,
        SUM(CASE WHEN r.price IS NULL THEN 1 ELSE 0 END) AS missing_prices
      FROM product_recipes pr
      LEFT JOIN raw_materials r ON r.id = pr.raw_material_id
      GROUP BY pr.product_id
    ) rm_agg ON rm_agg.product_id = h.product_id
    LEFT JOIN (
      SELECT
        prs.product_id,
        SUM(prs.quantity * sub_rm.raw_cost / NULLIF(sub_h.batch_output_qty, 0)) AS sub_cost
      FROM product_recipe_sub prs
      JOIN product_recipe_headers sub_h ON sub_h.product_id = prs.sub_product_id
      LEFT JOIN (
        SELECT pr2.product_id, SUM(pr2.quantity * r2.price) AS raw_cost
        FROM product_recipes pr2
        LEFT JOIN raw_materials r2 ON r2.id = pr2.raw_material_id
        GROUP BY pr2.product_id
      ) sub_rm ON sub_rm.product_id = prs.sub_product_id
      WHERE sub_h.batch_output_qty > 0
      GROUP BY prs.product_id
    ) sub_agg ON sub_agg.product_id = h.product_id
    ORDER BY p.CATEGORY, p.SUBCATEGORY, p.PRODUCT
  `, (err, rows) => {
    if (err) {
      return res.render('admin/recipe-detail', {
        rows: [], ingredients: [], subRecipes: [],
        user: req.session.user,
        error: err.message
      });
    }
    db.all(`
      SELECT pr.product_id, pr.quantity, pr.unit, pr.notes,
             r.name AS raw_material_name, r.unit AS rm_unit, r.price AS rm_price
      FROM product_recipes pr
      LEFT JOIN raw_materials r ON r.id = pr.raw_material_id
      ORDER BY pr.product_id, r.name
    `, (errI, ingredients) => {
      db.all(`
        SELECT prs.product_id, prs.sub_product_id, prs.quantity, prs.unit,
               p.PRODUCT AS sub_product_name, p.CATEGORY AS sub_product_category,
               p.SUBCATEGORY AS sub_product_subcategory,
               h.batch_output_qty AS sub_output_qty,
               COALESCE(SUM(pr2.quantity * rm2.price), 0) AS sub_total_cost,
               COUNT(pr2.id) AS sub_ingredient_count,
               COUNT(CASE WHEN rm2.price IS NULL AND pr2.id IS NOT NULL THEN 1 END) AS sub_missing_price_count
        FROM product_recipe_sub prs
        JOIN NDS_PRICELIST p ON p.ID = prs.sub_product_id
        LEFT JOIN product_recipe_headers h ON h.product_id = prs.sub_product_id
        LEFT JOIN product_recipes pr2 ON pr2.product_id = prs.sub_product_id
        LEFT JOIN raw_materials rm2 ON rm2.id = pr2.raw_material_id
        GROUP BY prs.id, prs.product_id, prs.sub_product_id, prs.quantity, prs.unit,
                 p.PRODUCT, p.CATEGORY, p.SUBCATEGORY, h.batch_output_qty
        ORDER BY prs.product_id, p.PRODUCT
      `, (errS, subRecipes) => {
        res.render('admin/recipe-detail', {
          rows: (rows || []).filter(recipeVisible),
          ingredients: ingredients || [],
          subRecipes: subRecipes || [],
          user: req.session.user,
          error: errI ? errI.message : (errS ? errS.message : '')
        });
      });
    });
  });
});

// Recipe detail — spreadsheet export (product header rows + ingredient/sub-recipe rows)
router.get('/recipe-detail/export', adminOnly, async (req, res) => {
  try {
    const rowsQ = await pool.query(RECIPE_SUMMARY_SQL);
    const ingQ = await pool.query(`
      SELECT pr.product_id, pr.quantity, pr.unit, pr.notes,
             r.name AS raw_material_name, r.unit AS rm_unit, r.price AS rm_price
      FROM product_recipes pr
      LEFT JOIN raw_materials r ON r.id = pr.raw_material_id
      ORDER BY pr.product_id, r.name
    `);
    const subQ = await pool.query(`
      SELECT prs.product_id, prs.sub_product_id, prs.quantity, prs.unit,
             p.PRODUCT AS sub_product_name, p.CATEGORY AS sub_product_category,
             p.SUBCATEGORY AS sub_product_subcategory,
             h.batch_output_qty AS sub_output_qty,
             COALESCE(SUM(pr2.quantity * rm2.price), 0) AS sub_total_cost,
             COUNT(pr2.id) AS sub_ingredient_count,
             COUNT(CASE WHEN rm2.price IS NULL AND pr2.id IS NOT NULL THEN 1 END) AS sub_missing_price_count
      FROM product_recipe_sub prs
      JOIN NDS_PRICELIST p ON p.ID = prs.sub_product_id
      LEFT JOIN product_recipe_headers h ON h.product_id = prs.sub_product_id
      LEFT JOIN product_recipes pr2 ON pr2.product_id = prs.sub_product_id
      LEFT JOIN raw_materials rm2 ON rm2.id = pr2.raw_material_id
      GROUP BY prs.id, prs.product_id, prs.sub_product_id, prs.quantity, prs.unit,
               p.PRODUCT, p.CATEGORY, p.SUBCATEGORY, h.batch_output_qty
      ORDER BY prs.product_id, p.PRODUCT
    `);

    const ingByProduct = {};
    ingQ.rows.forEach(i => {
      (ingByProduct[i.product_id] = ingByProduct[i.product_id] || []).push(i);
    });
    const subsByProduct = {};
    subQ.rows.forEach(s => {
      (subsByProduct[s.product_id] = subsByProduct[s.product_id] || []).push(s);
    });

    let companyName = "nd's";
    try {
      const sRes = await pool.query(`SELECT key, value FROM app_settings`);
      const sm = {}; sRes.rows.forEach(r => { sm[r.key] = r.value; });
      if (sm.company_name) companyName = sm.company_name;
    } catch (_) {}

    const safeN = v => (v != null && Number.isFinite(v)) ? v : null;
    const C = {
      darkBlue: '0D47A1', midBlue: '1565C0', lightBlue: 'BBDEFB',
      subhead: 'E3F2FD', subRecipeBg: 'F3F8FF', altRow: 'FAFAFA',
      green: '2E7D32', red: 'C62828', orange: 'E65100', grey: '757575',
      white: 'FFFFFF', black: '000000', incomeFg: '1976D2',
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Nepal Dairy NDS';
    wb.created = new Date();
    wb.views = [{ x: 0, y: 0, width: 26250, height: 15000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];

    const ws = wb.addWorksheet('Recipe Detail', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                   margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
      views: [{ state: 'frozen', ySplit: 5, topLeftCell: 'A6' }]
    });

    const COLS = 21;
    ws.columns = [
      { width: 14 }, { width: 16 }, { width: 26 }, { width: 12 },
      { width: 11 }, { width: 11 }, { width: 13 }, { width: 9 },
      { width: 9 }, { width: 12 }, { width: 13 }, { width: 14 },
      { width: 14 }, { width: 9 }, { width: 12 },
      { width: 26 }, { width: 10 }, { width: 22 }, { width: 15 }, { width: 12 }, { width: 22 }
    ];

    const addMergedRow = (text, rowH, styleOpts) => {
      const r = ws.addRow([]);
      const rn = r.number;
      r.height = rowH || 20;
      ws.mergeCells(rn, 1, rn, COLS);
      const anchor = ws.getCell(rn, 1);
      anchor.value = text;
      if (styleOpts.bg) anchor.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + styleOpts.bg } };
      anchor.font = { bold: !!styleOpts.bold, italic: !!styleOpts.italic, size: styleOpts.size || 11,
                       color: { argb: 'FF' + (styleOpts.fg || C.black) }, name: 'Calibri' };
      anchor.alignment = { horizontal: styleOpts.hAlign || 'left', vertical: 'middle' };
      return r;
    };

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-NP', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    addMergedRow(companyName, 42, { bg: C.darkBlue, fg: C.white, bold: true, size: 20 });
    addMergedRow('Recipe Detail Report — Ingredient Breakdown by Product', 30, { bg: C.midBlue, fg: C.white, bold: true, size: 14 });
    addMergedRow(`Date: ${dateStr}`, 20, { bg: C.subhead, fg: C.grey, italic: true, size: 10 });
    ws.addRow([]).height = 6;

    const thinGrey = { style: 'thin', color: { argb: 'FFD0D0D0' } };
    const sc = (cell, { bg, fg, bold, italic, size, hAlign, numFmt } = {}) => {
      if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
      cell.font = { bold: !!bold, italic: !!italic, size: size || 10, color: { argb: 'FF' + (fg || C.black) }, name: 'Calibri' };
      cell.alignment = { horizontal: hAlign || 'left', vertical: 'middle' };
      if (numFmt) cell.numFmt = numFmt;
      cell.border = { top: thinGrey, left: thinGrey, bottom: thinGrey, right: thinGrey };
    };

    const headerRow = ws.addRow([
      'Category', 'Sub-category', 'Product', 'Row Type',
      'Batch Qty', 'Batch Unit', 'Output Qty (pcs)', 'Loss %', 'Return %', 'Sellable (pcs)',
      'Total Cost (Rs.)', 'Total Income (Rs.)', 'Total Margin (Rs.)', 'Margin %', 'Margin/pc (Rs.)',
      'Ingredient', 'Qty', 'Unit', 'Price/Unit (Rs.)', 'Cost (Rs.)', 'Notes'
    ]);
    headerRow.height = 26;
    headerRow.eachCell(cell => sc(cell, { bg: C.midBlue, fg: C.white, bold: true, hAlign: 'center' }));

    let lastCat = null;
    rowsQ.rows.filter(recipeVisible).forEach(r => {
      if (r.category !== lastCat) {
        lastCat = r.category;
        addMergedRow(r.category || '(No Category)', 18, { bg: C.lightBlue, fg: C.midBlue, bold: true, hAlign: 'left' });
      }

      const rawCost        = r.total_cost != null ? parseFloat(r.total_cost) : null;
      const wholesale      = r.wholesale != null ? parseFloat(r.wholesale) : null;
      const discount       = r.discount != null ? parseFloat(r.discount) : 0;
      const overheadPct    = r.overhead_pct != null ? parseFloat(r.overhead_pct) : 0;
      const productionLoss = r.production_loss_pct != null ? parseFloat(r.production_loss_pct) : 0;
      const damagePct      = r.damage_pct != null ? parseFloat(r.damage_pct) : 0;
      const outputQty      = r.batch_output_qty != null ? parseFloat(r.batch_output_qty) : null;
      const sellableQty    = outputQty != null ? outputQty * (1 - damagePct / 100) : null;
      const effWS          = wholesale != null ? wholesale / (1 + discount / 100) : null;
      const lossCost       = rawCost != null ? rawCost * (1 + productionLoss / 100) : null;
      const totalCost       = lossCost != null ? lossCost * (1 + overheadPct / 100) : null;
      const totalIncome    = effWS != null && sellableQty != null ? effWS * sellableQty : null;
      const totalMargin    = totalIncome != null && totalCost != null && !parseInt(r.missing_prices) ? totalIncome - totalCost : null;
      const marginPct      = totalMargin != null && totalIncome > 0 ? totalMargin / totalIncome : null;
      const marginPc       = totalMargin != null && sellableQty > 0 ? totalMargin / sellableQty : null;

      const hr = ws.addRow([
        r.category || '', r.subcategory || '', r.name, 'PRODUCT',
        safeN(r.base_quantity), r.base_unit || '', safeN(outputQty),
        productionLoss > 0 ? productionLoss / 100 : null,
        damagePct > 0 ? damagePct / 100 : null,
        safeN(sellableQty), safeN(totalCost), safeN(totalIncome), safeN(totalMargin),
        safeN(marginPct), safeN(marginPc),
        '', null, '', null, null, ''
      ]);
      hr.height = 18;
      const mFg = totalMargin != null ? (totalMargin >= 0 ? C.green : C.red) : C.black;
      hr.eachCell((cell, colNum) => {
        const opts = { bg: C.subhead, bold: true };
        if (colNum === 7 || colNum === 10) opts.hAlign = 'right';
        if (colNum === 8 || colNum === 9) { opts.hAlign = 'right'; opts.numFmt = '0.0%'; }
        if (colNum === 11 || colNum === 12 || colNum === 13 || colNum === 15) { opts.hAlign = 'right'; opts.numFmt = '#,##0.00'; }
        if (colNum === 14) { opts.hAlign = 'right'; opts.numFmt = '0.0%'; opts.fg = mFg; }
        if (colNum === 13) opts.fg = mFg;
        if (colNum === 12) opts.fg = C.incomeFg;
        sc(cell, opts);
      });

      const ingredientsList = ingByProduct[r.product_id] || [];
      const subsList = subsByProduct[r.product_id] || [];

      ingredientsList.forEach(item => {
        const itemCost = item.rm_price != null ? item.quantity * item.rm_price : null;
        const ir = ws.addRow([
          r.category || '', r.subcategory || '', r.name, 'INGREDIENT',
          null, '', null, null, null, null, null, null, null, null, null,
          item.raw_material_name || '(deleted raw material)',
          safeN(item.quantity), item.unit || item.rm_unit || '',
          safeN(item.rm_price != null ? parseFloat(item.rm_price) : null),
          safeN(itemCost), item.notes || ''
        ]);
        ir.eachCell((cell, colNum) => {
          const opts = { bg: C.white };
          if (colNum === 17 || colNum === 19 || colNum === 20) { opts.hAlign = 'right'; opts.numFmt = '#,##0.00'; }
          sc(cell, opts);
        });
      });

      subsList.forEach(sub => {
        const subOutputQty = sub.sub_output_qty ? parseFloat(sub.sub_output_qty) : 0;
        const subTotalCost = parseFloat(sub.sub_total_cost) || 0;
        const subIngCount  = parseInt(sub.sub_ingredient_count) || 0;
        const subMissing   = parseInt(sub.sub_missing_price_count) || 0;
        const subCostPerUnit = (subIngCount > 0 && subOutputQty > 0 && subMissing === 0) ? subTotalCost / subOutputQty : null;
        const subItemCost = subCostPerUnit != null ? subCostPerUnit * sub.quantity : null;
        const sr = ws.addRow([
          r.category || '', r.subcategory || '', r.name, 'SUB-RECIPE',
          null, '', null, null, null, null, null, null, null, null, null,
          sub.sub_product_name, safeN(sub.quantity), sub.unit || '',
          safeN(subCostPerUnit), safeN(subItemCost), ''
        ]);
        sr.eachCell((cell, colNum) => {
          const opts = { bg: C.subRecipeBg };
          if (colNum === 17 || colNum === 19 || colNum === 20) { opts.hAlign = 'right'; opts.numFmt = '#,##0.00'; }
          sc(cell, opts);
        });
      });

      if (!ingredientsList.length && !subsList.length) {
        const er = ws.addRow([
          r.category || '', r.subcategory || '', r.name, 'INGREDIENT',
          null, '', null, null, null, null, null, null, null, null, null,
          'No ingredients recorded', null, '', null, null, ''
        ]);
        er.eachCell(cell => sc(cell, { bg: C.white, italic: true, fg: C.grey }));
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="recipe-detail.xlsx"');
    const xlsBuf = await wb.xlsx.writeBuffer();
    res.end(xlsBuf);
  } catch (e) {
    console.error('Recipe detail export error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Recipes management
router.get('/recipes', adminOnly, (req, res) => {
  const selectedProductId = req.query.product_id ? parseInt(req.query.product_id) : null;
  db.all('SELECT ID as id, PRODUCT as name, CATEGORY as category, SUBCATEGORY as subcategory, UNIT as unit, QTY as qty, WHOLESALE as wholesale, MRP as mrp FROM NDS_PRICELIST ORDER BY CATEGORY, SUBCATEGORY, PRODUCT', (errP, allProducts) => {
    const products = (allProducts || []).filter(recipeVisible);
    // A hidden-category product opened by direct link falls back to the plain Recipes page
    if (selectedProductId && !products.some(p => p.id == selectedProductId)) return res.redirect('/admin/recipes');
    db.all('SELECT * FROM raw_materials ORDER BY name', (errR, materials) => {
      db.all('SELECT * FROM rm_units ORDER BY name', (errU, units) => {
        const recipeQuery = selectedProductId
          ? `SELECT pr.id, pr.product_id, pr.raw_material_id, pr.quantity, pr.unit, pr.notes,
                    p.PRODUCT AS product_name, p.CATEGORY AS product_category,
                    r.name AS raw_material_name, r.unit AS rm_unit, r.price AS rm_price
             FROM product_recipes pr
             JOIN NDS_PRICELIST p ON p.ID = pr.product_id
             JOIN raw_materials r ON r.id = pr.raw_material_id
             WHERE pr.product_id = ?
             ORDER BY r.name`
          : `SELECT pr.id, pr.product_id, pr.raw_material_id, pr.quantity, pr.unit, pr.notes,
                    p.PRODUCT AS product_name, p.CATEGORY AS product_category,
                    r.name AS raw_material_name, r.unit AS rm_unit, r.price AS rm_price
             FROM product_recipes pr
             JOIN NDS_PRICELIST p ON p.ID = pr.product_id
             JOIN raw_materials r ON r.id = pr.raw_material_id
             ORDER BY p.PRODUCT, r.name`;
        const recipeParams = selectedProductId ? [selectedProductId] : [];
        db.all(recipeQuery, recipeParams, (errRec, recipes) => {
          const headerQuery = selectedProductId
            ? 'SELECT * FROM product_recipe_headers WHERE product_id = ?'
            : 'SELECT * FROM product_recipe_headers';
          const headerParams = selectedProductId ? [selectedProductId] : [];
          db.all(headerQuery, headerParams, (errH, headers) => {
            db.all('SELECT * FROM rm_categories ORDER BY name', (errC, rmCategories) => {
              const subQuery = selectedProductId
                ? `SELECT prs.id, prs.product_id, prs.sub_product_id, prs.quantity, prs.unit,
                          p.PRODUCT AS sub_product_name, p.CATEGORY AS sub_product_category,
                          p.SUBCATEGORY AS sub_product_subcategory,
                          h.base_quantity AS sub_batch_qty, h.base_unit AS sub_batch_unit,
                          h.batch_output_qty AS sub_output_qty,
                          COALESCE(SUM(pr.quantity * rm.price), 0) AS sub_total_cost,
                          COUNT(pr.id) AS sub_ingredient_count,
                          COUNT(CASE WHEN rm.price IS NULL AND pr.id IS NOT NULL THEN 1 END) AS sub_missing_price_count
                   FROM product_recipe_sub prs
                   JOIN NDS_PRICELIST p ON p.ID = prs.sub_product_id
                   LEFT JOIN product_recipe_headers h ON h.product_id = prs.sub_product_id
                   LEFT JOIN product_recipes pr ON pr.product_id = prs.sub_product_id
                   LEFT JOIN raw_materials rm ON rm.id = pr.raw_material_id
                   WHERE prs.product_id = ?
                   GROUP BY prs.id, prs.product_id, prs.sub_product_id, prs.quantity, prs.unit,
                            p.PRODUCT, p.CATEGORY, p.SUBCATEGORY,
                            h.base_quantity, h.base_unit, h.batch_output_qty
                   ORDER BY p.PRODUCT`
                : `SELECT prs.id, prs.product_id, prs.sub_product_id, prs.quantity, prs.unit,
                          p.PRODUCT AS sub_product_name
                   FROM product_recipe_sub prs
                   JOIN NDS_PRICELIST p ON p.ID = prs.sub_product_id
                   ORDER BY p.PRODUCT`;
              const subParams = selectedProductId ? [selectedProductId] : [];
              db.all(subQuery, subParams, (errSub, subRecipes) => {
                res.render('admin/recipes', {
                  products: products || [],
                  materials: materials || [],
                  units: units || [],
                  recipes: recipes || [],
                  headers: headers || [],
                  rmCategories: rmCategories || [],
                  subRecipes: subRecipes || [],
                  selectedProductId,
                  user: req.session.user,
                  success: req.query.success || '',
                  error: req.query.error || ''
                });
              });
            });
          });
        });
      });
    });
  });
});

router.post('/recipes/set-base', adminOnly, (req, res) => {
  const { product_id, base_quantity, base_unit, batch_output_qty, discount, overhead_pct, production_loss_pct, damage_pct } = req.body;
  if (!product_id || !base_quantity || !batch_output_qty) return res.redirect(`/admin/recipes?product_id=${product_id || ''}&error=Product, batch quantity and batch output qty are required`);
  const discountVal      = discount            !== undefined && discount            !== '' ? parseFloat(discount)            : null;
  const overheadVal      = overhead_pct        !== undefined && overhead_pct        !== '' ? parseFloat(overhead_pct)        : null;
  const productionLosVal = production_loss_pct !== undefined && production_loss_pct !== '' ? parseFloat(production_loss_pct) : null;
  const damageVal        = damage_pct          !== undefined && damage_pct          !== '' ? parseFloat(damage_pct)          : null;
  db.run(
    `INSERT INTO product_recipe_headers (product_id, base_quantity, base_unit, batch_output_qty, discount, overhead_pct, production_loss_pct, damage_pct)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET base_quantity = excluded.base_quantity, base_unit = excluded.base_unit, batch_output_qty = excluded.batch_output_qty, discount = excluded.discount, overhead_pct = excluded.overhead_pct, production_loss_pct = excluded.production_loss_pct, damage_pct = excluded.damage_pct`,
    [parseInt(product_id), parseFloat(base_quantity), base_unit || null, batch_output_qty ? parseFloat(batch_output_qty) : null, discountVal, overheadVal, productionLosVal, damageVal],
    (err) => {
      if (err) return res.redirect(`/admin/recipes?product_id=${product_id}&error=Could not save batch size`);
      res.redirect(`/admin/recipes?product_id=${product_id}&success=Batch size saved`);
    }
  );
});

router.post('/recipes/add', adminOnly, (req, res) => {
  const { product_id, raw_material_id, quantity, unit, notes } = req.body;
  if (!product_id || !raw_material_id || !quantity || !unit)
    return res.redirect(`/admin/recipes?product_id=${product_id || ''}&error=Product, raw material, quantity and unit are required`);
  db.run(
    'INSERT INTO product_recipes (product_id, raw_material_id, quantity, unit, notes) VALUES (?, ?, ?, ?, ?)',
    [parseInt(product_id), parseInt(raw_material_id), parseFloat(quantity), unit, notes],
    (err) => {
      if (err) return res.redirect(`/admin/recipes?product_id=${product_id}&error=That raw material is already in this recipe`);
      res.redirect(`/admin/recipes?product_id=${product_id}&success=Ingredient added`);
    }
  );
});

router.post('/recipes/update/:id', adminOnly, (req, res) => {
  const { product_id, quantity, unit, notes } = req.body;
  if (!quantity) return res.redirect(`/admin/recipes?product_id=${product_id || ''}&error=Quantity is required`);
  db.run(
    'UPDATE product_recipes SET quantity = ?, unit = ?, notes = ? WHERE id = ?',
    [parseFloat(quantity), unit || null, notes || null, parseInt(req.params.id)],
    (err) => {
      if (err) return res.redirect(`/admin/recipes?product_id=${product_id || ''}&error=Update failed`);
      res.redirect(`/admin/recipes?product_id=${product_id || ''}&success=Ingredient updated`);
    }
  );
});

router.post('/recipes/delete/:id', adminOnly, (req, res) => {
  const { product_id } = req.body;
  db.run('DELETE FROM product_recipes WHERE id = ?', [req.params.id], () => {
    res.redirect(`/admin/recipes?product_id=${product_id || ''}&success=Ingredient removed`);
  });
});

router.post('/recipes/add-sub', adminOnly, (req, res) => {
  const { product_id, sub_product_id, quantity, unit } = req.body;
  if (!product_id || !sub_product_id || !quantity || !unit)
    return res.redirect(`/admin/recipes?product_id=${product_id || ''}&error=Product, sub-recipe product, quantity and unit are required`);
  if (parseInt(product_id) === parseInt(sub_product_id))
    return res.redirect(`/admin/recipes?product_id=${product_id}&error=A product cannot use itself as an ingredient`);
  db.run(
    'INSERT INTO product_recipe_sub (product_id, sub_product_id, quantity, unit) VALUES (?, ?, ?, ?)',
    [parseInt(product_id), parseInt(sub_product_id), parseFloat(quantity), unit],
    (err) => {
      if (err) return res.redirect(`/admin/recipes?product_id=${product_id}&error=That product is already in this recipe`);
      res.redirect(`/admin/recipes?product_id=${product_id}&success=Product ingredient added`);
    }
  );
});

router.post('/recipes/update-sub/:id', adminOnly, (req, res) => {
  const { product_id, quantity, unit } = req.body;
  if (!quantity) return res.redirect(`/admin/recipes?product_id=${product_id || ''}&error=Quantity is required`);
  db.run(
    'UPDATE product_recipe_sub SET quantity = ?, unit = ? WHERE id = ?',
    [parseFloat(quantity), unit || null, parseInt(req.params.id)],
    (err) => {
      if (err) return res.redirect(`/admin/recipes?product_id=${product_id || ''}&error=Update failed`);
      res.redirect(`/admin/recipes?product_id=${product_id || ''}&success=Product ingredient updated`);
    }
  );
});

router.post('/recipes/delete-sub/:id', adminOnly, (req, res) => {
  const { product_id } = req.body;
  db.run('DELETE FROM product_recipe_sub WHERE id = ?', [req.params.id], () => {
    res.redirect(`/admin/recipes?product_id=${product_id || ''}&success=Product ingredient removed`);
  });
});

// Raw Material Receipt — aggregate raw material needs across all products
router.get('/raw-material-receipt', adminOnly, (req, res) => {
  db.all(`
    SELECT h.product_id, h.base_quantity, h.base_unit, h.batch_output_qty,
           h.discount, h.overhead_pct, h.production_loss_pct, h.damage_pct,
           p.PRODUCT AS product_name, p.CATEGORY AS category, p.SUBCATEGORY AS subcategory,
           p.WHOLESALE AS wholesale
    FROM product_recipe_headers h
    JOIN NDS_PRICELIST p ON p.ID = h.product_id
    WHERE h.batch_output_qty IS NOT NULL AND h.batch_output_qty > 0
    ORDER BY p.CATEGORY, p.SUBCATEGORY, p.PRODUCT
  `, (err, headers) => {
    if (err || !headers || !headers.length) {
      return res.render('admin/raw-material-receipt', {
        headers: [], recipes: [], subRecipes: [], subIngredients: [],
        user: req.session.user, error: err ? err.message : ''
      });
    }
    const productIds = headers.map(h => h.product_id);
    db.all(`
      SELECT pr.product_id, pr.raw_material_id, pr.quantity, pr.unit,
             r.name AS raw_material_name, r.unit AS rm_unit, r.price AS rm_price, r.category AS rm_category
      FROM product_recipes pr
      JOIN raw_materials r ON r.id = pr.raw_material_id
      WHERE pr.product_id IN (${productIds.map(() => '?').join(',')})
    `, productIds, (errR, recipes) => {
      db.all(`
        SELECT prs.product_id, prs.sub_product_id, prs.quantity, prs.unit,
               p.PRODUCT AS sub_product_name,
               h2.batch_output_qty AS sub_output_qty
        FROM product_recipe_sub prs
        JOIN NDS_PRICELIST p ON p.ID = prs.sub_product_id
        LEFT JOIN product_recipe_headers h2 ON h2.product_id = prs.sub_product_id
        WHERE prs.product_id IN (${productIds.map(() => '?').join(',')})
      `, productIds, (errSub, subRecipes) => {
        const subProductIds = [...new Set((subRecipes || []).map(sr => sr.sub_product_id))];
        if (!subProductIds.length) {
          return res.render('admin/raw-material-receipt', {
            headers, recipes: recipes || [], subRecipes: subRecipes || [], subIngredients: [],
            user: req.session.user, error: errR ? errR.message : ''
          });
        }
        db.all(`
          SELECT pr.product_id, pr.raw_material_id, pr.quantity, pr.unit,
                 r.name AS raw_material_name, r.unit AS rm_unit, r.price AS rm_price, r.category AS rm_category
          FROM product_recipes pr
          JOIN raw_materials r ON r.id = pr.raw_material_id
          WHERE pr.product_id IN (${subProductIds.map(() => '?').join(',')})
        `, subProductIds, (errSI, subIngredients) => {
          res.render('admin/raw-material-receipt', {
            headers, recipes: recipes || [],
            subRecipes: subRecipes || [],
            subIngredients: subIngredients || [],
            user: req.session.user,
            error: errR || errSub || errSI ? ((errR || errSub || errSI).message) : ''
          });
        });
      });
    });
  });
});

// Excel export for Raw Material Receipt
router.post('/raw-material-receipt/export-excel', adminOnly, (req, res) => {
  const { scaleInputs } = req.body;
  if (!scaleInputs || typeof scaleInputs !== 'object') return res.status(400).json({ error: 'Invalid input' });

  const productIds = Object.keys(scaleInputs).map(Number).filter(id => parseFloat(scaleInputs[id]) > 0);
  if (!productIds.length) return res.status(400).json({ error: 'No products selected' });

  db.all(`
    SELECT h.product_id, h.base_quantity, h.base_unit, h.batch_output_qty,
           h.discount, h.overhead_pct,
           p.PRODUCT AS product_name, p.CATEGORY AS category, p.SUBCATEGORY AS subcategory,
           p.WHOLESALE AS wholesale
    FROM product_recipe_headers h
    JOIN NDS_PRICELIST p ON p.ID = h.product_id
    WHERE h.product_id IN (${productIds.map(() => '?').join(',')})
    ORDER BY p.CATEGORY, p.SUBCATEGORY, p.PRODUCT
  `, productIds, (err, headers) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(`
      SELECT pr.product_id, pr.raw_material_id, pr.quantity, pr.unit,
             r.name AS raw_material_name, r.unit AS rm_unit, r.price AS rm_price, r.category AS rm_category
      FROM product_recipes pr
      JOIN raw_materials r ON r.id = pr.raw_material_id
      WHERE pr.product_id IN (${productIds.map(() => '?').join(',')})
    `, productIds, (errR, recipes) => {
      if (errR) return res.status(500).json({ error: errR.message });

      db.all(`
        SELECT prs.product_id, prs.sub_product_id, prs.quantity, prs.unit,
               p.PRODUCT AS sub_product_name,
               h2.batch_output_qty AS sub_output_qty
        FROM product_recipe_sub prs
        JOIN NDS_PRICELIST p ON p.ID = prs.sub_product_id
        LEFT JOIN product_recipe_headers h2 ON h2.product_id = prs.sub_product_id
        WHERE prs.product_id IN (${productIds.map(() => '?').join(',')})
      `, productIds, (errSub, subRecipes) => {
        const subProductIds = [...new Set((subRecipes || []).map(sr => sr.sub_product_id))];

        async function buildExcel(subIngredients) {
          subIngredients = subIngredients || [];

          // ── Compute data ────────────────────────────────────────────────────
          const summaryRows = [];
          const aggregated  = {};

          function addToAgg(ing, reqQty) {
            const key = ing.raw_material_id;
            if (!aggregated[key]) {
              aggregated[key] = { name: ing.raw_material_name, category: ing.rm_category || null,
                unit: ing.unit || ing.rm_unit || null, price: ing.rm_price,
                totalQty: 0, totalCost: 0, missingPrice: false };
            }
            aggregated[key].totalQty += reqQty;
            if (ing.rm_price != null) aggregated[key].totalCost += reqQty * ing.rm_price;
            else aggregated[key].missingPrice = true;
          }

          headers.forEach(h => {
            const targetPcs = parseFloat(scaleInputs[h.product_id]);
            if (!targetPcs || targetPcs <= 0) return;
            const batchOut = parseFloat(h.batch_output_qty);
            if (!batchOut || batchOut <= 0) return;
            const factor = targetPcs / batchOut;

            let baseCost = 0, allPriced = true;

            recipes.filter(r => r.product_id === h.product_id).forEach(ing => {
              const reqQty = ing.quantity * factor;
              if (ing.rm_price != null) baseCost += ing.quantity * ing.rm_price;
              else allPriced = false;
              addToAgg(ing, reqQty);
            });

            (subRecipes || []).filter(sr => sr.product_id === h.product_id).forEach(sr => {
              const subOut = parseFloat(sr.sub_output_qty);
              if (!subOut || subOut <= 0) return;
              const subFactor = factor * parseFloat(sr.quantity) / subOut;
              const subQtyRatio = parseFloat(sr.quantity) / subOut;
              subIngredients.filter(si => si.product_id === sr.sub_product_id).forEach(ing => {
                if (ing.rm_price != null) baseCost += ing.quantity * subQtyRatio * ing.rm_price;
                else allPriced = false;
                addToAgg(ing, ing.quantity * subFactor);
              });
            });

        const scaledRawCost   = baseCost * factor;
        const overhead        = parseFloat(h.overhead_pct) || 0;
        const overheadAmt     = scaledRawCost * overhead / 100;
        const scaledTotalCost = scaledRawCost + overheadAmt;
        const wholesale       = h.wholesale != null ? parseFloat(h.wholesale) : null;
        const discount        = parseFloat(h.discount) || 0;
        const effWS           = wholesale != null ? wholesale / (1 + discount / 100) : null;
        const totalIncome     = effWS != null ? effWS * targetPcs : null;
        const totalMargin     = totalIncome != null && allPriced ? totalIncome - scaledTotalCost : null;
        const marginPc        = totalMargin != null && targetPcs > 0 ? totalMargin / targetPcs : null;
        const marginPct       = totalMargin != null && totalIncome > 0 ? totalMargin / totalIncome : null;

        summaryRows.push({ product_name: h.product_name, category: h.category || '',
          subcategory: h.subcategory || '', scaled_output_qty: targetPcs,
          scaledTotalCost, overheadAmt, overhead, totalIncome, totalMargin,
          marginPc, marginPct, allPriced });
      });

      const rmItems = Object.values(aggregated).sort((a, b) => {
        const c = (a.category || '').localeCompare(b.category || '');
        return c !== 0 ? c : a.name.localeCompare(b.name);
      });

      // ── Build Excel ───────────────────────────────────────────────────────
      // safeN: convert Infinity / NaN → null so ExcelJS never writes invalid XML
      const safeN = v => (v != null && Number.isFinite(v)) ? v : null;

      // Load company name from settings
      let companyName = "nd's";
      try {
        const sRes = await pool.query(`SELECT key, value FROM app_settings`);
        const sm = {}; sRes.rows.forEach(r => { sm[r.key] = r.value; });
        if (sm.company_name) companyName = sm.company_name;
      } catch (_) {}

      try {
        const C = { // colours (no # prefix, ARGB without alpha)
          darkBlue:  '0D47A1', midBlue:   '1565C0', lightBlue: 'BBDEFB',
          subhead:   'E3F2FD', altRow:    'F5F5F5',
          totalBg:   'FFF8E1', totalFg:   'E65100',
          green:     '2E7D32', red:       'C62828',
          orange:    'E65100', grey:      '757575',
          white:     'FFFFFF', black:     '000000',
          blueText:  '1565C0', incomeFg:  '1976D2',
          purple:    '6A1B9A',
        };

        const wb = new ExcelJS.Workbook();
        wb.creator  = 'Nepal Dairy NDS';
        wb.created  = new Date();
        // Define a workbook view so worksheets' workbookViewId="0" has a valid target
        wb.views = [{ x: 0, y: 0, width: 26250, height: 15000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];

        const now     = new Date();
        const dateStr = now.toLocaleDateString('en-NP', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const thinGrey  = { style: 'thin',   color: { argb: 'FFD0D0D0' } };
        const medBlue   = { style: 'medium', color: { argb: 'FF' + C.midBlue } };
        const hairGrey  = { style: 'hair',   color: { argb: 'FFD0D0D0' } };

        function sc(cell, { bg, fg, bold, italic, size, hAlign, vAlign, numFmt, wrap, border } = {}) {
          if (bg)    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
          cell.font       = { bold: !!bold, italic: !!italic, size: size || 11,
                               color: { argb: 'FF' + (fg || C.black) }, name: 'Calibri' };
          cell.alignment  = { horizontal: hAlign || 'left', vertical: vAlign || 'middle',
                               wrapText: !!wrap };
          if (numFmt) cell.numFmt = numFmt;
          const b = border !== false;
          if (b) cell.border = { top: thinGrey, left: thinGrey, bottom: thinGrey, right: thinGrey };
        }

        // ── Sheet 1: Production Summary ────────────────────────────────────
        const ws1 = wb.addWorksheet('Production Summary', {
          pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1,
                       fitToHeight: 1, margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
          views: [{ state: 'frozen', ySplit: 5, topLeftCell: 'A6' }]
        });
        const COLS1 = 11;
        ws1.columns = [
          { width: 16 }, { width: 16 }, { width: 28 }, { width: 12 },
          { width: 15 }, { width: 11 }, { width: 16 }, { width: 16 },
          { width: 16 }, { width: 11 }, { width: 14 }
        ];

        const addMergedRow = (ws, cols, text, rowH, styleOpts) => {
          const r  = ws.addRow([]);   // no cell values — OOXML: non-anchor cells must be empty
          const rn = r.number;
          r.height = rowH || 20;
          ws.mergeCells(`A${rn}:${String.fromCharCode(64 + cols)}${rn}`);
          // Style only the anchor cell; Excel renders its fill across the entire merged region
          const anchor = ws.getCell(`A${rn}`);
          anchor.value = text;
          if (styleOpts.bg) anchor.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + styleOpts.bg } };
          anchor.font      = { bold: !!styleOpts.bold, italic: !!styleOpts.italic,
                                size: styleOpts.size || 11,
                                color: { argb: 'FF' + (styleOpts.fg || C.black) }, name: 'Calibri' };
          anchor.alignment = { horizontal: styleOpts.hAlign || 'left', vertical: 'middle', wrapText: false };
          return r;
        };

        // Header rows
        addMergedRow(ws1, COLS1, companyName, 42,
          { bg: C.darkBlue, fg: C.white, bold: true, size: 20, border: false });
        addMergedRow(ws1, COLS1, 'Production Summary — Raw Material Receipt', 30,
          { bg: C.midBlue,  fg: C.white, bold: true, size: 14, border: false });
        addMergedRow(ws1, COLS1, `Date: ${dateStr}`, 20,
          { bg: C.subhead,  fg: C.grey,  italic: true, size: 10, border: false });
        ws1.addRow([]); // blank
        ws1.getRow(4).height = 6;

        // Column headers — 2-line wrapping via \n
        const h1 = ws1.addRow([
          'Category', 'Sub-\ncategory', 'Product', 'Output\n(pcs)',
          'Overhead\n(Rs.)', 'Overhead\n%', 'Total Cost\n(Rs.)',
          'Total Income\n(Rs.)', 'Total Margin\n(Rs.)', 'Margin\n%', 'Margin / pc\n(Rs.)'
        ]);
        h1.height = 34;
        h1.eachCell(cell => sc(cell, { bg: C.midBlue, fg: C.white, bold: true, size: 11, hAlign: 'center', vAlign: 'middle', wrap: true }));
        h1.getCell(1).border = { ...h1.getCell(1).border, left: medBlue };

        // Data rows
        let gCost = 0, gOvh = 0, gInc = 0, gMar = 0, gOut = 0;
        let catOvh = 0, catCost = 0, catInc = 0, catMar = 0, catOut = 0;
        let lastCat = null, alt = 0;

        const flushCatSubtotal1 = (cat) => {
          if (cat === null) return;
          const cMarFg  = catMar >= 0 ? C.green : C.red;
          const cMPct   = catInc > 0 ? catMar / catInc : null;
          const cMPctFg = cMPct != null && cMPct >= 0 ? C.green : C.red;
          const st = ws1.addRow([
            `Sub-Total: ${cat || '(No Category)'}`, // 1
            null, null,                              // 2-3
            safeN(catOut),                           // 4 Output
            safeN(catOvh),                           // 5 Overhead Rs.
            null,                                    // 6
            safeN(catCost),                          // 7 Total Cost
            safeN(catInc),                           // 8 Total Income
            safeN(catMar),                           // 9 Total Margin
            safeN(cMPct),                            // 10 Margin %
            null                                     // 11
          ]);
          st.height = 19;
          sc(st.getCell(1),  { bg: C.subhead, fg: C.purple, bold: true, size: 11, hAlign: 'left' });
          st.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
          sc(st.getCell(2),  { bg: C.subhead }); sc(st.getCell(3), { bg: C.subhead });
          sc(st.getCell(4),  { bg: C.subhead, fg: C.purple,   bold: true, size: 11, hAlign: 'center' });
          sc(st.getCell(5),  { bg: C.subhead, fg: C.orange,   bold: true, size: 11, hAlign: 'right', numFmt: '#,##0.00' });
          sc(st.getCell(6),  { bg: C.subhead });
          sc(st.getCell(7),  { bg: C.subhead, fg: C.purple,   bold: true, size: 11, hAlign: 'right', numFmt: '#,##0.00' });
          sc(st.getCell(8),  { bg: C.subhead, fg: C.incomeFg, bold: true, size: 11, hAlign: 'right', numFmt: '#,##0.00' });
          sc(st.getCell(9),  { bg: C.subhead, fg: cMarFg,     bold: true, size: 11, hAlign: 'right', numFmt: '#,##0.00' });
          sc(st.getCell(10), { bg: C.subhead, fg: cMPctFg,    bold: true, size: 11, hAlign: 'right', numFmt: '0.0%' });
          sc(st.getCell(11), { bg: C.subhead });
          catOvh = 0; catCost = 0; catInc = 0; catMar = 0; catOut = 0;
        };

        summaryRows.forEach(r => {
          if (r.category !== lastCat) {
            flushCatSubtotal1(lastCat);
            lastCat = r.category;
            addMergedRow(ws1, COLS1, r.category || '(No Category)', 18,
              { bg: C.lightBlue, fg: C.midBlue, bold: true, size: 11, hAlign: 'left' });
          }
          alt++;
          const bg = alt % 2 === 0 ? C.altRow : C.white;
          const mFg  = r.totalMargin != null ? (r.totalMargin >= 0 ? C.green : C.red) : C.black;
          const mpFg = r.marginPct   != null ? (r.marginPct   >= 0 ? C.green : C.red) : C.black;

          const dr = ws1.addRow([
            r.category || '(No Category)',        // 1 Category
            r.subcategory || '—',                 // 2 Sub-category
            r.product_name,                       // 3 Product
            safeN(r.scaled_output_qty),           // 4 Output
            safeN(r.overheadAmt),                 // 5 Overhead (Rs.)
            r.overhead > 0 ? r.overhead / 100 : null, // 6 Overhead %
            safeN(r.scaledTotalCost),             // 7 Total Cost
            safeN(r.totalIncome),                 // 8 Total Income
            safeN(r.totalMargin),                 // 9 Total Margin
            safeN(r.marginPct),                   // 10 Margin %
            safeN(r.marginPc)                     // 11 Margin / pc
          ]);
          dr.height = 18;
          sc(dr.getCell(1),  { bg, size: 11, bold: true, fg: C.midBlue });
          sc(dr.getCell(2),  { bg, size: 11 });
          sc(dr.getCell(3),  { bg, size: 11, bold: true });
          sc(dr.getCell(4),  { bg, size: 11, hAlign: 'center' });
          sc(dr.getCell(5),  { bg, size: 11, hAlign: 'right', numFmt: '#,##0.00', fg: C.orange });
          sc(dr.getCell(6),  { bg, size: 11, hAlign: 'right', numFmt: '0.0%',     fg: C.orange });
          sc(dr.getCell(7),  { bg, size: 11, hAlign: 'right', numFmt: '#,##0.00' });
          sc(dr.getCell(8),  { bg, size: 11, hAlign: 'right', numFmt: '#,##0.00', fg: C.incomeFg });
          sc(dr.getCell(9),  { bg, size: 11, hAlign: 'right', numFmt: '#,##0.00', fg: mFg,  bold: true });
          sc(dr.getCell(10), { bg, size: 11, hAlign: 'right', numFmt: '0.0%',     fg: mpFg, bold: true });
          sc(dr.getCell(11), { bg, size: 11, hAlign: 'right', numFmt: '#,##0.00' });

          gCost += r.scaledTotalCost; gOvh += r.overheadAmt; gOut += r.scaled_output_qty;
          catOvh += r.overheadAmt; catCost += r.scaledTotalCost; catOut += r.scaled_output_qty;
          if (r.totalIncome != null)  { gInc += r.totalIncome;  catInc += r.totalIncome; }
          if (r.totalMargin != null)  { gMar += r.totalMargin;  catMar += r.totalMargin; }
        });
        flushCatSubtotal1(lastCat);

        // Total row
        const gMPct = gInc > 0 ? gMar / gInc : null;
        const tr1 = ws1.addRow(['TOTAL', null, null, safeN(gOut), safeN(gOvh), null, safeN(gCost), safeN(gInc), safeN(gMar), safeN(gMPct), null]);
        tr1.height = 22;
        sc(tr1.getCell(1),  { bg: C.totalBg, fg: C.totalFg, bold: true, size: 12 });
        sc(tr1.getCell(2),  { bg: C.totalBg });
        sc(tr1.getCell(3),  { bg: C.totalBg });
        sc(tr1.getCell(4),  { bg: C.totalBg, fg: C.totalFg, bold: true, size: 12, hAlign: 'center' });
        sc(tr1.getCell(5),  { bg: C.totalBg, fg: C.orange,  bold: true, size: 12, hAlign: 'right', numFmt: '#,##0.00' });
        sc(tr1.getCell(6),  { bg: C.totalBg });
        sc(tr1.getCell(7),  { bg: C.totalBg, fg: C.totalFg, bold: true, size: 12, hAlign: 'right', numFmt: '#,##0.00' });
        sc(tr1.getCell(8),  { bg: C.totalBg, fg: C.incomeFg, bold: true, size: 12, hAlign: 'right', numFmt: '#,##0.00' });
        sc(tr1.getCell(9),  { bg: C.totalBg, fg: gMar >= 0 ? C.green : C.red, bold: true, size: 12, hAlign: 'right', numFmt: '#,##0.00' });
        sc(tr1.getCell(10), { bg: C.totalBg, fg: gMPct != null && gMPct >= 0 ? C.green : C.red, bold: true, size: 12, hAlign: 'right', numFmt: '0.0%' });
        sc(tr1.getCell(11), { bg: C.totalBg });
        // thick bottom border on total row
        for (let c = 1; c <= COLS1; c++) {
          const cell = tr1.getCell(c);
          cell.border = { ...cell.border, bottom: medBlue, top: medBlue };
        }

        // Footnote
        ws1.addRow([]);
        if (summaryRows.some(r => !r.allPriced)) {
          const fn = ws1.addRow(['* Some ingredient prices are missing — costs may be understated.']);
          ws1.mergeCells(`A${fn.number}:K${fn.number}`);
          sc(ws1.getCell(`A${fn.number}`), { fg: C.orange, italic: true, size: 10, border: false });
        }
        const footRow1 = ws1.addRow([]);
        const lastR1   = footRow1.number;
        ws1.mergeCells(`A${lastR1}:J${lastR1}`);
        ws1.getCell(`A${lastR1}`).value = 'Prepared by: Nepal Dairy NDS System';
        sc(ws1.getCell(`A${lastR1}`), { fg: C.grey, italic: true, size: 9, border: false });
        ws1.getCell(`K${lastR1}`).value = `Printed: ${dateStr}`;
        sc(ws1.getCell(`K${lastR1}`), { fg: C.grey, italic: true, size: 9, hAlign: 'right', border: false });

        // ── Sheet 2: Raw Material Requirements ────────────────────────────
        const ws2 = wb.addWorksheet('Raw Material Requirements', {
          pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1,
                       fitToHeight: 1, margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
          views: [{ state: 'frozen', ySplit: 5, topLeftCell: 'A6' }]
        });
        const COLS2 = 7;
        ws2.columns = [
          { width: 8 }, { width: 24 }, { width: 34 },
          { width: 12 }, { width: 16 }, { width: 20 }, { width: 20 }
        ];

        addMergedRow(ws2, COLS2, companyName, 42,
          { bg: C.darkBlue, fg: C.white, bold: true, size: 20, border: false });
        addMergedRow(ws2, COLS2, 'Raw Material Requirements — Procurement Sheet', 30,
          { bg: C.midBlue,  fg: C.white, bold: true, size: 14, border: false });
        addMergedRow(ws2, COLS2, `Date: ${dateStr}`, 22,
          { bg: C.subhead,  fg: C.grey,  italic: true, size: 11, border: false });
        ws2.addRow([]);
        ws2.getRow(4).height = 8;

        const h2 = ws2.addRow(['SN','Category','Raw Material','Unit','Required Qty','Price / Unit (Rs.)','Total Cost (Rs.)']);
        h2.height = 22;
        h2.eachCell(cell => sc(cell, { bg: C.midBlue, fg: C.white, bold: true, size: 11, hAlign: 'center', vAlign: 'middle' }));

        let grandRM = 0, anyMissingRM = false, lastRMCat = null, sn = 0, alt2 = 0;
        let catRM = 0, catHasMissing = false;

        const flushCatSubtotal = (cat) => {
          if (cat === null) return;
          const stRow = ws2.addRow([null, null, `Sub-Total: ${cat || '(No Category)'}`, null, null, null, safeN(catRM)]);
          stRow.height = 19;
          for (let c = 1; c <= COLS2; c++) {
            sc(stRow.getCell(c), { bg: C.subhead, size: 11,
              fg: c === 3 ? C.midBlue : (c === 7 ? (catHasMissing ? C.orange : C.midBlue) : C.black),
              bold: c === 3 || c === 7,
              hAlign: c === 3 ? 'right' : (c === 7 ? 'right' : 'left'),
              numFmt: c === 7 ? '#,##0.00' : undefined });
          }
          catRM = 0; catHasMissing = false;
        };

        rmItems.forEach(item => {
          if (item.category !== lastRMCat) {
            flushCatSubtotal(lastRMCat);
            lastRMCat = item.category;
            addMergedRow(ws2, COLS2, item.category || '(No Category)', 18,
              { bg: C.lightBlue, fg: C.midBlue, bold: true, size: 11, hAlign: 'left' });
          }
          sn++; alt2++;
          const bg = alt2 % 2 === 0 ? C.altRow : C.white;
          const fmtQ = safeN(parseFloat(item.totalQty.toFixed(4)));
          const dr2 = ws2.addRow([
            sn, item.category, item.name, item.unit, fmtQ,
            item.price != null ? safeN(parseFloat(item.price)) : null,
            !item.missingPrice ? safeN(item.totalCost) : null
          ]);
          dr2.height = 18;
          sc(dr2.getCell(1), { bg, size: 11, hAlign: 'center' });
          sc(dr2.getCell(2), { bg, size: 11, fg: C.blueText });
          sc(dr2.getCell(3), { bg, size: 11, bold: true });
          sc(dr2.getCell(4), { bg, size: 11, hAlign: 'center' });
          sc(dr2.getCell(5), { bg, size: 12, hAlign: 'right', bold: true, numFmt: '#,##0.####' });
          sc(dr2.getCell(6), { bg, size: 11, hAlign: 'right', numFmt: '#,##0.00',
            fg: item.price != null ? C.black : C.orange });
          sc(dr2.getCell(7), { bg, size: 11, hAlign: 'right', numFmt: '#,##0.00',
            fg: item.missingPrice ? C.orange : C.black });

          if (!item.missingPrice) { grandRM += item.totalCost; catRM += item.totalCost; }
          if (item.missingPrice)  { anyMissingRM = true; catHasMissing = true; }
        });
        flushCatSubtotal(lastRMCat);

        // Total row
        const tr2 = ws2.addRow([null, null, 'GRAND TOTAL', null, null, null, safeN(grandRM)]);
        tr2.height = 22;
        sc(tr2.getCell(1), { bg: C.totalBg }); sc(tr2.getCell(2), { bg: C.totalBg });
        sc(tr2.getCell(3), { bg: C.totalBg, fg: C.totalFg, bold: true, size: 12, hAlign: 'right' });
        sc(tr2.getCell(4), { bg: C.totalBg }); sc(tr2.getCell(5), { bg: C.totalBg });
        sc(tr2.getCell(6), { bg: C.totalBg });
        sc(tr2.getCell(7), { bg: C.totalBg, fg: C.totalFg, bold: true, size: 12, hAlign: 'right', numFmt: '#,##0.00' });
        for (let c = 1; c <= COLS2; c++) {
          const cell = tr2.getCell(c);
          cell.border = { ...cell.border, bottom: medBlue, top: medBlue };
        }

        ws2.addRow([]);
        if (anyMissingRM) {
          const fn2 = ws2.addRow(['* Some ingredient prices are missing — total may be understated.']);
          ws2.mergeCells(`A${fn2.number}:G${fn2.number}`);
          sc(ws2.getCell(`A${fn2.number}`), { fg: C.orange, italic: true, size: 10, border: false });
        }
        const footRow2 = ws2.addRow([]);
        const lastR2   = footRow2.number;
        ws2.mergeCells(`A${lastR2}:F${lastR2}`);
        ws2.getCell(`A${lastR2}`).value = 'Prepared by: Nepal Dairy NDS System';
        sc(ws2.getCell(`A${lastR2}`), { fg: C.grey, italic: true, size: 9, border: false });
        ws2.getCell(`G${lastR2}`).value = `Printed: ${dateStr}`;
        sc(ws2.getCell(`G${lastR2}`), { fg: C.grey, italic: true, size: 9, hAlign: 'right', border: false });

        // ── Pie chart: cost by category ───────────────────────────────────
        // Use totalCost > 0 so items with partial pricing still appear in the chart
        const catTotals = {};
        rmItems.forEach(item => {
          if (item.totalCost > 0) {
            const k = item.category || '(No Category)';
            catTotals[k] = (catTotals[k] || 0) + item.totalCost;
          }
        });
        const catData = Object.entries(catTotals)
          .map(([category, amount]) => ({ category, amount }))
          .sort((a, b) => b.amount - a.amount);

        if (createCanvas) {
          ws2.addRow([]);
          addMergedRow(ws2, COLS2, 'Cost Distribution by Category', 30,
            { bg: C.darkBlue, fg: C.white, bold: true, size: 14, border: false });

          // Reserve rows for the chart (each ~19pt ≈ 25px; 490px image needs ~20 rows, reserve 27)
          const tlRow = ws2.lastRow.number;
          const CHART_ROWS = 27;
          for (let i = 0; i < CHART_ROWS; i++) ws2.addRow([]).height = 19;

          const chartPng = drawPieChart(catData);
          const imgId = wb.addImage({ buffer: chartPng, extension: 'png' });
          // tl.row is 0-indexed: tlRow (1-indexed header row#) equals the 0-indexed row after it
          ws2.addImage(imgId, {
            tl: { col: 0, row: tlRow },
            ext: { width: 760, height: 490 }
          });
        }

        // ── Send file ─────────────────────────────────────────────────────
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="raw-material-receipt.xlsx"');
        const xlsBuf = await wb.xlsx.writeBuffer();
        res.end(xlsBuf);
      } catch (e) {
        console.error('Excel export error:', e);
        res.status(500).json({ error: e.message });
      }
        } // end buildExcel

        if (!subProductIds.length) { buildExcel([]); return; }

        db.all(`
          SELECT pr.product_id, pr.raw_material_id, pr.quantity, pr.unit,
                 r.name AS raw_material_name, r.unit AS rm_unit, r.price AS rm_price, r.category AS rm_category
          FROM product_recipes pr
          JOIN raw_materials r ON r.id = pr.raw_material_id
          WHERE pr.product_id IN (${subProductIds.map(() => '?').join(',')})
        `, subProductIds, (errSI, subIngredients) => {
          buildExcel(subIngredients || []);
        });
      }); // end subRecipes callback
    });   // end recipes callback
  });     // end headers callback
});       // end router.post

// ── App Setup ────────────────────────────────────────────────────────────────
router.get('/setup', adminOnly, (req, res) => {
  db.all('SELECT key, value FROM app_settings ORDER BY key', (err, rows) => {
    const settings = {};
    (rows || []).forEach(r => { settings[r.key] = r.value; });
    res.render('admin/setup', {
      user: req.session.user,
      settings,
      error: err ? err.message : null,
      success: req.query.success ? 'Settings saved successfully.' : null
    });
  });
});

router.post('/setup', adminOnly, (req, res) => {
  const fields = ['company_name', 'company_address', 'company_phone', 'company_email', 'company_pan'];
  let pending = fields.length;
  let firstErr = null;

  const finish = () => {
    if (firstErr) {
      db.all('SELECT key, value FROM app_settings ORDER BY key', (e, rows) => {
        const settings = {};
        (rows || []).forEach(r => { settings[r.key] = r.value; });
        res.render('admin/setup', { user: req.session.user, settings, error: firstErr, success: null });
      });
    } else {
      res.redirect('/admin/setup?success=1');
    }
  };

  fields.forEach(key => {
    const val = (req.body[key] || '').trim();
    db.run(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, val],
      (err) => { if (err && !firstErr) firstErr = err.message; if (--pending === 0) finish(); }
    );
  });
});

module.exports = router;
