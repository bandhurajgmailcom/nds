const express = require('express');
const router = express.Router();
const db = require('../db/database');

function adminOnly(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'Administrator') return res.status(403).render('error', { message: 'Access denied.' });
  next();
}

const BS_MONTHS = ['Baishakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];

// Recalculate CUMSTARTDAYS and CUMDAYS for all rows after a given id
function recalcFrom(afterId, callback) {
  // Get the CUMDAYS of the row just before afterId
  db.get('SELECT cumdays FROM rnepalical WHERE id < ? ORDER BY id DESC LIMIT 1', [afterId], (err, prev) => {
    let runningCum = prev ? prev.cumdays : 0;
    db.all('SELECT id, days FROM rnepalical WHERE id >= ? ORDER BY id ASC', [afterId], (err2, rows) => {
      if (err2 || !rows.length) return callback && callback();
      const stmt = db.prepare('UPDATE rnepalical SET cumstartdays=?, cumdays=? WHERE id=?');
      rows.forEach(row => {
        const cumstart = runningCum + 1;
        runningCum += row.days;
        stmt.run(cumstart, runningCum, row.id);
      });
      stmt.finalize(callback);
    });
  });
}

// GET: list all RNEPALICAL rows grouped by year
router.get('/', adminOnly, (req, res) => {
  const filterYear = req.query.year || '';
  let sql = 'SELECT * FROM rnepalical ORDER BY bs_year, bs_month';
  const params = [];
  if (filterYear) {
    sql = 'SELECT * FROM rnepalical WHERE bs_year=? ORDER BY bs_month';
    params.push(parseInt(filterYear));
  }
  db.all(sql, params, (err, rows) => {
    db.all('SELECT DISTINCT bs_year FROM rnepalical ORDER BY bs_year', (err2, years) => {
      // Group rows by year for display
      const grouped = {};
      (rows || []).forEach(r => {
        if (!grouped[r.bs_year]) grouped[r.bs_year] = [];
        grouped[r.bs_year].push(r);
      });
      res.render('admin/nepalical', {
        user: req.session.user,
        grouped,
        years: (years || []).map(y => y.bs_year),
        filterYear,
        BS_MONTHS,
        msg: req.query.msg || '',
        error: req.query.error || ''
      });
    });
  });
});

// POST: insert a full new BS year (12 months)
router.post('/add-year', adminOnly, (req, res) => {
  const { bs_year, days } = req.body; // days is array of 12
  const year = parseInt(bs_year);
  if (!year || !days || days.length !== 12) return res.redirect('/admin/nepalical?error=Invalid data');

  // Check if year already exists
  db.get('SELECT COUNT(*) as cnt FROM rnepalical WHERE bs_year=?', [year], (err, row) => {
    if (row && row.cnt > 0) return res.redirect(`/admin/nepalical?error=Year ${year} already exists`);

    const stmt = db.prepare(
      `INSERT INTO rnepalical (bs_year, bs_month, month_name, days, cumstartdays, cumdays) VALUES (?,?,?,?,0,0)`
    );
    for (let i = 0; i < 12; i++) {
      stmt.run(year, i + 1, BS_MONTHS[i], parseInt(days[i]) || 30);
    }
    stmt.finalize(() => {
      // Recalc from the first row of this new year
      db.get('SELECT id FROM rnepalical WHERE bs_year=? ORDER BY bs_month LIMIT 1', [year], (err2, firstRow) => {
        if (firstRow) recalcFrom(firstRow.id, () => res.redirect(`/admin/nepalical?year=${year}&msg=Year ${year} added`));
        else res.redirect('/admin/nepalical?msg=Year added');
      });
    });
  });
});

// POST: update a single month's days
router.post('/update/:id', adminOnly, (req, res) => {
  const id = parseInt(req.params.id);
  const days = parseInt(req.body.days);
  if (!days || days < 28 || days > 32) return res.redirect('/admin/nepalical?error=Days must be 28-32');

  db.run('UPDATE rnepalical SET days=? WHERE id=?', [days, id], (err) => {
    if (err) return res.redirect('/admin/nepalical?error=Update failed');
    recalcFrom(id, () => {
      db.get('SELECT bs_year FROM rnepalical WHERE id=?', [id], (e, row) => {
        const yr = row ? row.bs_year : '';
        res.redirect(`/admin/nepalical?year=${yr}&msg=Updated successfully`);
      });
    });
  });
});

// POST: delete a full year
router.post('/delete-year/:year', adminOnly, (req, res) => {
  const year = parseInt(req.params.year);
  db.get('SELECT MIN(id) as "minId" FROM rnepalical WHERE bs_year=?', [year], (err, row) => {
    const minId = row ? row.minId : null;
    db.run('DELETE FROM rnepalical WHERE bs_year=?', [year], () => {
      if (minId) recalcFrom(minId, () => res.redirect('/admin/nepalical?msg=Year deleted'));
      else res.redirect('/admin/nepalical?msg=Year deleted');
    });
  });
});

// API: return all calendar data as JSON (used by frontend JS)
router.get('/api', (req, res) => {
  db.all('SELECT bs_year, bs_month, days FROM rnepalical ORDER BY bs_year, bs_month', (err, rows) => {
    const data = {};
    (rows || []).forEach(r => {
      if (!data[r.bs_year]) data[r.bs_year] = [];
      data[r.bs_year][r.bs_month - 1] = r.days;
    });
    res.json(data);
  });
});

module.exports = router;
