/**
 * Nepali Date Picker - Bidirectional BS <-> AD
 * Popup appended to <body> with position:fixed to avoid any clipping.
 * Public /api/nepalical endpoint — accessible to all users.
 */
(function () {
  const BS_MONTHS_EN = ['Baishakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];
  const BS_MONTHS_NP = ['बैशाख','जेठ','असार','साउन','भदौ','असोज','कात्तिक','मंसिर','पुष','माघ','फागुन','चैत'];
  const WEEK_NP = ['आ','सो','मं','बु','बि','शु','श'];

  let BS_DATA = {
    2075: [31,32,31,32,31,30,30,29,30,29,30,30],
    2076: [31,32,31,32,31,30,30,30,29,29,30,30],
    2077: [31,32,31,31,31,30,30,29,30,29,30,30],
    2078: [31,31,32,31,31,31,30,30,29,30,29,31],
    2079: [31,32,31,32,31,30,30,30,29,29,30,30],
    2080: [31,32,31,32,31,30,30,30,29,29,30,30],
    2081: [31,31,32,31,31,31,30,29,30,29,30,30],
    2082: [31,32,31,32,31,30,30,30,29,30,30,30],
    2083: [31,31,32,32,31,30,30,30,29,30,30,30],
    2084: [31,31,32,32,31,30,30,30,29,30,30,30],
    2085: [31,32,31,32,31,30,30,29,30,29,30,30],
    2086: [31,32,31,32,31,30,30,30,29,29,30,31],
  };

  // Reference point: 1 Baishakh 2078 BS = 14 April 2021 AD
  // Using 2078 (not 2057) because BS_DATA has accurate per-year data from 2075 onward.
  // The 2057 reference required 18 years of fallback (~365d/yr) which accumulated ~6d of error.
  const REF_AD = new Date(2021, 3, 14);

  fetch('/api/nepalical')
    .then(r => r.json())
    .then(data => { if (data && Object.keys(data).length) Object.assign(BS_DATA, data); })
    .catch(() => {});

  function getMonthDays(y, m) {
    if (BS_DATA[y] && BS_DATA[y][m] !== undefined) return BS_DATA[y][m];
    return [31,31,32,32,31,30,30,29,30,29,30,30][m];
  }

  /** BS → AD */
  function bsToAd(bsY, bsM, bsD) {
    const RY = 2078, RM = 0, RD = 1;
    const cmp = bsY !== RY ? bsY - RY : bsM !== RM ? bsM - RM : bsD - RD;
    if (cmp === 0) return new Date(REF_AD);
    let days = 0;
    if (cmp > 0) {
      let y = RY, m = RM, d = RD;
      if (y === bsY && m === bsM) {
        days = bsD - d;
      } else {
        days = getMonthDays(y, m) - d + 1;
        if (++m >= 12) { m = 0; y++; }
        while (!(y === bsY && m === bsM)) {
          days += getMonthDays(y, m);
          if (++m >= 12) { m = 0; y++; }
        }
        days += bsD - 1;
      }
      return new Date(REF_AD.getTime() + days * 86400000);
    } else {
      let y = bsY, m = bsM, d = bsD;
      if (y === RY && m === RM) {
        days = RD - d;
      } else {
        days = getMonthDays(y, m) - d + 1;
        if (++m >= 12) { m = 0; y++; }
        while (!(y === RY && m === RM)) {
          days += getMonthDays(y, m);
          if (++m >= 12) { m = 0; y++; }
        }
        days += RD - 1;
      }
      return new Date(REF_AD.getTime() - days * 86400000);
    }
  }

  /** AD → BS */
  function adToBs(ad) {
    const diff = Math.round((ad - REF_AD) / 86400000);
    let y = 2078, m = 0, d = 1, rem = diff;
    if (rem >= 0) {
      while (rem > 0) {
        const md = getMonthDays(y, m), left = md - d + 1;
        if (rem >= left) { rem -= left; d = 1; if (++m >= 12) { m = 0; y++; } }
        else { d += rem; rem = 0; }
      }
    } else {
      rem = -rem;
      while (rem > 0) {
        if (rem >= d) { rem -= d; if (--m < 0) { m = 11; y--; } d = getMonthDays(y, m); }
        else { d -= rem; rem = 0; }
      }
    }
    return { year: y, month: m, day: d };
  }

  function toNp(n) { return String(n).replace(/\d/g, c => '०१२३४५६७८९'[c]); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtAD(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fmtBS(bs) { return BS_MONTHS_NP[bs.month] + ' ' + toNp(bs.day) + ', ' + toNp(bs.year); }
  function fmtBSEn(bs) { return bs.day + ' ' + BS_MONTHS_EN[bs.month] + ' ' + bs.year + ' BS'; }

  let uid = 0;

  // One shared popup element reused by all pickers
  const POPUP = document.createElement('div');
  POPUP.className = 'ndp-popup';
  POPUP.style.display = 'none';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(POPUP));

  let activePicker = null;

  function closePicker() {
    POPUP.style.display = 'none';
    activePicker = null;
  }

  document.addEventListener('click', e => {
    if (activePicker && !activePicker.wrap.contains(e.target) && !POPUP.contains(e.target)) {
      closePicker();
    }
  });

  class NepaliDatePicker {
    constructor(hiddenInput) {
      this.id = uid++;
      this.hidden = hiddenInput;
      this.selBS = null;
      this.selAD = null;
      this.viewY = null;
      this.viewM = null;
      this._build();
    }

    _build() {
      const wrap = document.createElement('div');
      wrap.className = 'ndp-wrap';
      wrap.innerHTML = `
        <div class="ndp-row">
          <div class="ndp-col">
            <div class="ndp-lbl">BS मिति (बि.सं.)</div>
            <button type="button" class="ndp-bs-btn" id="ndp-btn-${this.id}">
              <span class="ndp-bs-text">-- चुन्नुहोस् --</span>
              <span>📅</span>
            </button>
          </div>
          <div class="ndp-arrow" title="Bidirectional BS ↔ AD">⇄</div>
          <div class="ndp-col">
            <div class="ndp-lbl">AD Date (ई.सं.)</div>
            <input type="text" class="ndp-ad-in" placeholder="YYYY-MM-DD" maxlength="10" autocomplete="off">
          </div>
        </div>`;

      this.hidden.parentNode.insertBefore(wrap, this.hidden.nextSibling);
      this.wrap = wrap;
      this.bsBtn = wrap.querySelector('.ndp-bs-btn');
      this.bsText = wrap.querySelector('.ndp-bs-text');
      this.adIn = wrap.querySelector('.ndp-ad-in');

      // Set initial value
      const v = this.hidden.value;
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        this._fromAD(new Date(v + 'T00:00:00'));
      } else {
        this._fromAD(new Date());
      }

      this.bsBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (activePicker === this) { closePicker(); return; }
        activePicker = this;
        this._showPopup();
      });

      this.adIn.addEventListener('input', () => {
        const v = this.adIn.value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
          const d = new Date(v + 'T00:00:00');
          if (!isNaN(d)) {
            this._fromAD(d, true);
            if (activePicker === this) this._renderCal();
          }
        }
      });
    }

    _fromAD(adDate, keepAdText) {
      this.selAD = adDate;
      this.selBS = adToBs(adDate);
      this.viewY = this.selBS.year;
      this.viewM = this.selBS.month;
      this.hidden.value = fmtAD(adDate);
      if (!keepAdText) this.adIn.value = fmtAD(adDate);
      this.bsText.textContent = fmtBS(this.selBS);
      this.bsBtn.title = fmtBSEn(this.selBS);
    }

    _showPopup() {
      // Position popup below the button using fixed coordinates
      const r = this.bsBtn.getBoundingClientRect();
      POPUP.style.top = (r.bottom + window.scrollY + 6) + 'px';
      POPUP.style.left = r.left + 'px';
      POPUP.style.display = 'block';
      this._renderCal();

      // Nudge left if off right edge
      requestAnimationFrame(() => {
        const pr = POPUP.getBoundingClientRect();
        if (pr.right > window.innerWidth - 8) {
          POPUP.style.left = Math.max(8, window.innerWidth - pr.width - 8) + 'px';
        }
      });
    }

    _renderCal() {
      const y = this.viewY, m = this.viewM;
      const dim = getMonthDays(y, m);
      const firstAD = bsToAd(y, m, 1);
      const dow = firstAD.getDay();
      const todayBS = adToBs(new Date());

      const yOpts = Object.keys(BS_DATA).sort((a, b) => a - b)
        .map(yr => `<option value="${yr}"${+yr === y ? ' selected' : ''}>${yr}</option>`).join('');
      const mOpts = BS_MONTHS_NP.map((mn, i) =>
        `<option value="${i}"${i === m ? ' selected' : ''}>${mn} / ${BS_MONTHS_EN[i]}</option>`).join('');

      let grid = WEEK_NP.map(w => `<span class="ndp-wh">${w}</span>`).join('');
      for (let i = 0; i < dow; i++) grid += '<span></span>';
      for (let d = 1; d <= dim; d++) {
        const sel = this.selBS && this.selBS.year === y && this.selBS.month === m && this.selBS.day === d;
        const tod = todayBS.year === y && todayBS.month === m && todayBS.day === d;
        grid += `<button type="button" class="ndp-d${sel ? ' ndp-sel' : ''}${tod ? ' ndp-tod' : ''}" data-d="${d}">${toNp(d)}<sub>${d}</sub></button>`;
      }

      POPUP.innerHTML = `
        <div class="ndp-ph">
          <button type="button" class="ndp-nav" data-a="py">«</button>
          <button type="button" class="ndp-nav" data-a="pm">‹</button>
          <span class="ndp-title">${toNp(y)} &mdash; ${BS_MONTHS_NP[m]}</span>
          <button type="button" class="ndp-nav" data-a="nm">›</button>
          <button type="button" class="ndp-nav" data-a="ny">»</button>
        </div>
        <div class="ndp-selrow">
          <select class="ndp-ysel">${yOpts}</select>
          <select class="ndp-msel">${mOpts}</select>
        </div>
        <div class="ndp-grid">${grid}</div>
        <div class="ndp-equiv">AD: ${this.selAD ? fmtAD(this.selAD) : '—'}</div>
      `;

      POPUP.querySelectorAll('.ndp-nav').forEach(b =>
        b.addEventListener('click', e => { e.stopPropagation(); this._nav(b.dataset.a); }));

      POPUP.querySelectorAll('.ndp-d[data-d]').forEach(b =>
        b.addEventListener('click', e => { e.stopPropagation(); this._pick(+b.dataset.d); }));

      POPUP.querySelector('.ndp-ysel').addEventListener('change', e => {
        e.stopPropagation(); this.viewY = +e.target.value; this._renderCal();
      });
      POPUP.querySelector('.ndp-msel').addEventListener('change', e => {
        e.stopPropagation(); this.viewM = +e.target.value; this._renderCal();
      });
    }

    _nav(a) {
      if (a === 'pm') { if (--this.viewM < 0) { this.viewM = 11; this.viewY--; } }
      else if (a === 'nm') { if (++this.viewM > 11) { this.viewM = 0; this.viewY++; } }
      else if (a === 'py') { this.viewY--; }
      else if (a === 'ny') { this.viewY++; }
      this._renderCal();
    }

    _pick(day) {
      this._fromAD(bsToAd(this.viewY, this.viewM, day));
      closePicker();
      this.hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function initAll() {
    // Ensure popup is in body
    if (!document.body.contains(POPUP)) document.body.appendChild(POPUP);

    document.querySelectorAll('input[type="date"][data-ndp]').forEach(input => {
      input.style.display = 'none';
      new NepaliDatePicker(input);
    });

    // Show BS equivalent in table date cells
    document.querySelectorAll('.ndp-table-bs[data-ad]').forEach(el => {
      const v = el.dataset.ad;
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const d = new Date(v + 'T00:00:00');
        if (!isNaN(d)) {
          const bs = adToBs(d);
          el.textContent = fmtBS(bs);
          el.title = fmtBSEn(bs);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  window.NepaliDatePicker = NepaliDatePicker;
  window.bsToAd = bsToAd;
  window.adToBs = adToBs;
})();
