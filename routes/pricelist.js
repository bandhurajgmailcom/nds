const express = require('express');
const router = express.Router();
const db = require('../db/database');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function adminOnly(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'Administrator') return res.status(403).render('error', { message: 'Access denied. Admins only.' });
  next();
}

// Next SN for Add modal
router.get('/next-sn', requireLogin, (req, res) => {
  db.get('SELECT COALESCE(MAX(SN), 0) + 1 as "nextSN" FROM NDS_PRICELIST', (err, row) => {
    res.json({ nextSN: row ? row.nextSN : 1 });
  });
});

// Product name suggestions for search autocomplete
router.get('/suggest', requireLogin, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  db.all(
    'SELECT DISTINCT PRODUCT FROM NDS_PRICELIST WHERE PRODUCT LIKE ? ORDER BY PRODUCT LIMIT 20',
    [`%${q}%`],
    (err, rows) => res.json((rows || []).map(r => r.PRODUCT))
  );
});

// View pricelist — all logged-in users
router.get('/', requireLogin, (req, res) => {
  const search = req.query.search || '';
  const selectedCategories = req.query.category ? [].concat(req.query.category).filter(Boolean) : [];
  const selectedSubcategories = req.query.subcategory ? [].concat(req.query.subcategory).filter(Boolean) : [];
  const selectedUnits = req.query.unit ? [].concat(req.query.unit).filter(Boolean) : [];
  const selectedQtys = req.query.qty ? [].concat(req.query.qty).filter(Boolean) : [];
  const limit = parseInt(req.query.limit) || 25;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const allowedSortCols = ['SN', 'CATEGORY', 'SUBCATEGORY', 'PRODUCT', 'UNIT', 'QTY', 'WHOLESALE', 'MRP'];
  const sortby = allowedSortCols.includes((req.query.sortby || '').toUpperCase()) ? req.query.sortby.toUpperCase() : 'SN';
  const sortdir = req.query.sortdir === 'desc' ? 'DESC' : 'ASC';

  let where = 'WHERE 1=1';
  const filterParams = [];

  if (search) {
    where += ' AND (PRODUCT LIKE ? OR DESCRIPTION LIKE ? OR SUBCATEGORY LIKE ?)';
    filterParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (selectedCategories.length) {
    where += ` AND CATEGORY IN (${selectedCategories.map(() => '?').join(',')})`;
    filterParams.push(...selectedCategories);
  }
  if (selectedSubcategories.length) {
    where += ` AND SUBCATEGORY IN (${selectedSubcategories.map(() => '?').join(',')})`;
    filterParams.push(...selectedSubcategories);
  }
  if (selectedUnits.length) {
    where += ` AND UNIT IN (${selectedUnits.map(() => '?').join(',')})`;
    filterParams.push(...selectedUnits);
  }
  if (selectedQtys.length) {
    where += ` AND QTY IN (${selectedQtys.map(() => '?').join(',')})`;
    filterParams.push(...selectedQtys);
  }

  const countQuery = `SELECT COUNT(*) as total FROM NDS_PRICELIST ${where}`;
  const offset = (page - 1) * (limit > 0 ? limit : 0);
  let dataQuery = `SELECT * FROM NDS_PRICELIST ${where} ORDER BY ${sortby} ${sortdir}`;
  const dataParams = [...filterParams];
  if (limit > 0) {
    dataQuery += ' LIMIT ? OFFSET ?';
    dataParams.push(limit, offset);
  }

  db.get(countQuery, filterParams, (err, countRow) => {
    const totalItems = countRow ? countRow.total : 0;
    const totalPages = limit > 0 ? Math.ceil(totalItems / limit) : 1;

    db.all(dataQuery, dataParams, (err, items) => {
      db.all('SELECT DISTINCT CATEGORY FROM NDS_PRICELIST WHERE CATEGORY IS NOT NULL ORDER BY CATEGORY', (err2, cats) => {
        db.all('SELECT DISTINCT SUBCATEGORY FROM NDS_PRICELIST WHERE SUBCATEGORY IS NOT NULL ORDER BY SUBCATEGORY', (err3, subcats) => {
          db.all('SELECT DISTINCT CATEGORY, SUBCATEGORY FROM NDS_PRICELIST WHERE CATEGORY IS NOT NULL AND SUBCATEGORY IS NOT NULL ORDER BY CATEGORY, SUBCATEGORY', (err4, catSubRows) => {
            db.all('SELECT DISTINCT UNIT FROM NDS_PRICELIST WHERE UNIT IS NOT NULL ORDER BY UNIT', (err5, unitRows) => {
              db.all('SELECT DISTINCT QTY FROM NDS_PRICELIST WHERE QTY IS NOT NULL ORDER BY QTY', (err6, qtyRows) => {
                const catSubcatMap = {};
                (catSubRows || []).forEach(r => {
                  if (!catSubcatMap[r.CATEGORY]) catSubcatMap[r.CATEGORY] = [];
                  catSubcatMap[r.CATEGORY].push(r.SUBCATEGORY);
                });
                res.render('pricelist', {
                  user: req.session.user,
                  items: items || [],
                  categories: cats || [],
                  subcategories: subcats || [],
                  catSubcatPairs: catSubRows || [],
                  catSubcatMap,
                  units: (unitRows || []).map(r => r.UNIT),
                  qtys: (qtyRows || []).map(r => r.QTY),
                  search,
                  selectedCategories,
                  selectedSubcategories,
                  selectedUnits,
                  selectedQtys,
                  limit,
                  page,
                  totalItems,
                  totalPages,
                  sortby,
                  sortdir,
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

// Export filtered pricelist as CSV — all logged-in users
router.get('/export.csv', requireLogin, (req, res) => {
  const search = req.query.search || '';
  const selectedCategories = req.query.category ? [].concat(req.query.category).filter(Boolean) : [];
  const selectedSubcategories = req.query.subcategory ? [].concat(req.query.subcategory).filter(Boolean) : [];
  const selectedUnits = req.query.unit ? [].concat(req.query.unit).filter(Boolean) : [];
  const selectedQtys = req.query.qty ? [].concat(req.query.qty).filter(Boolean) : [];
  const allowedSortCols = ['SN', 'CATEGORY', 'SUBCATEGORY', 'PRODUCT', 'UNIT', 'QTY', 'WHOLESALE', 'MRP'];
  const sortby = allowedSortCols.includes((req.query.sortby || '').toUpperCase()) ? req.query.sortby.toUpperCase() : 'SN';
  const sortdir = req.query.sortdir === 'desc' ? 'DESC' : 'ASC';

  let where = 'WHERE 1=1';
  const filterParams = [];

  if (search) {
    where += ' AND (PRODUCT LIKE ? OR DESCRIPTION LIKE ? OR SUBCATEGORY LIKE ?)';
    filterParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (selectedCategories.length) {
    where += ` AND CATEGORY IN (${selectedCategories.map(() => '?').join(',')})`;
    filterParams.push(...selectedCategories);
  }
  if (selectedSubcategories.length) {
    where += ` AND SUBCATEGORY IN (${selectedSubcategories.map(() => '?').join(',')})`;
    filterParams.push(...selectedSubcategories);
  }
  if (selectedUnits.length) {
    where += ` AND UNIT IN (${selectedUnits.map(() => '?').join(',')})`;
    filterParams.push(...selectedUnits);
  }
  if (selectedQtys.length) {
    where += ` AND QTY IN (${selectedQtys.map(() => '?').join(',')})`;
    filterParams.push(...selectedQtys);
  }

  const dataQuery = `SELECT SN, CATEGORY, SUBCATEGORY, PRODUCT, UNIT, QTY, WHOLESALE, MRP, BARCODE, DESCRIPTION FROM NDS_PRICELIST ${where} ORDER BY ${sortby} ${sortdir}`;

  db.all(dataQuery, filterParams, (err, items) => {
    if (err) return res.status(500).send('Failed to export pricelist');

    const columns = ['SN', 'CATEGORY', 'SUBCATEGORY', 'PRODUCT', 'UNIT', 'QTY', 'WHOLESALE', 'MRP', 'BARCODE', 'DESCRIPTION'];
    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [columns.join(',')];
    (items || []).forEach(item => {
      lines.push(columns.map(col => escapeCsv(item[col])).join(','));
    });
    const csv = '﻿' + lines.join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pricelist-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  });
});

// Add — admin only
router.post('/add', adminOnly, (req, res) => {
  const { SN, PRODUCT, WHOLESALE, MRP, CATEGORY, UNIT, QTY, BARCODE, URL, SUBCATEGORY, DESCRIPTION } = req.body;
  db.run(
    `INSERT INTO NDS_PRICELIST (SN, PRODUCT, WHOLESALE, MRP, CATEGORY, UNIT, QTY, BARCODE, URL, SUBCATEGORY, DESCRIPTION)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [SN || null, PRODUCT || null, WHOLESALE || null, MRP || null, CATEGORY || null,
     UNIT || null, QTY || null, BARCODE || null, URL || null, SUBCATEGORY || null, DESCRIPTION || null],
    (err) => {
      if (err) return res.redirect('/pricelist?error=Failed to add item');
      res.redirect('/pricelist?success=Item added successfully');
    }
  );
});

// Edit — admin only
router.post('/edit/:id', adminOnly, (req, res) => {
  const { SN, PRODUCT, WHOLESALE, MRP, CATEGORY, UNIT, QTY, BARCODE, URL, SUBCATEGORY, DESCRIPTION } = req.body;
  db.run(
    `UPDATE NDS_PRICELIST SET SN=?, PRODUCT=?, WHOLESALE=?, MRP=?, CATEGORY=?, UNIT=?, QTY=?, BARCODE=?, URL=?, SUBCATEGORY=?, DESCRIPTION=?
     WHERE ID=?`,
    [SN || null, PRODUCT || null, WHOLESALE || null, MRP || null, CATEGORY || null,
     UNIT || null, QTY || null, BARCODE || null, URL || null, SUBCATEGORY || null, DESCRIPTION || null,
     req.params.id],
    (err) => {
      if (err) return res.redirect('/pricelist?error=Failed to update item');
      res.redirect('/pricelist?success=Item updated successfully');
    }
  );
});

// Delete — admin only
router.post('/delete/:id', adminOnly, (req, res) => {
  db.run('DELETE FROM NDS_PRICELIST WHERE ID = ?', [req.params.id], (err) => {
    if (err) return res.redirect('/pricelist?error=Failed to delete item');
    res.redirect('/pricelist?success=Item deleted');
  });
});

module.exports = router;
