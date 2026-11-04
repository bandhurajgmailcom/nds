// Bikram Sambat (BS) Nepali Calendar converter
const BS_MONTHS = ['Baishakh','Jestha','Ashadh','Shrawan','Bhadra','Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'];
const BS_NEPALI_MONTHS = ['बैशाख','जेठ','असार','साउन','भदौ','असोज','कात्तिक','मंसिर','पुष','माघ','फागुन','चैत'];
const BS_DAYS = ['आइतबार','सोमबार','मंगलबार','बुधबार','बिहीबार','शुक्रबार','शनिबार'];
const BS_DAYS_EN = ['Aaitabar','Sombar','Mangalbar','Budhabar','Bihibar','Sukrabar','Sanibar'];

// Days in each BS month per year (fallback; overwritten by server data)
let BS_DATA = {
  2078: [31,31,32,31,31,31,30,30,29,30,29,31],
  2079: [31,32,31,32,31,30,30,30,29,29,30,30],
  2080: [31,32,31,32,31,30,30,30,29,29,30,30],
  2081: [31,31,32,31,31,31,30,29,30,29,30,30],
  2082: [31,32,31,32,31,30,30,30,29,30,30,30],
  2083: [31,31,32,32,31,30,30,30,29,30,30,30],
  2084: [31,31,32,32,31,30,30,30,29,30,30,30],
  2085: [31,32,31,32,31,30,30,29,30,29,30,30],
};

// Fetch live data from RNEPALICAL table and override
fetch('/api/nepalical').then(r => r.json()).then(data => {
  if (data && Object.keys(data).length > 0) {
    BS_DATA = data;
    updateNepaliDate();
  }
}).catch(() => {});

function getMonthDays(year, month) {
  if (BS_DATA[year]) return BS_DATA[year][month];
  const approx = [31,31,32,32,31,30,30,29,30,29,30,30];
  return approx[month];
}

// Reference: 14 April 2021 AD = 1 Baishakh 2078 BS
// Using 2078 to avoid ~6-day accumulated error from fallback data for 2057-2074.
function adToBs(ad) {
  const refDate = new Date(2021, 3, 14); // months are 0-indexed in JS
  const diffDays = Math.floor((ad - refDate) / (1000 * 60 * 60 * 24));

  let bsYear = 2078, bsMonth = 0, bsDay = 1;
  let remaining = diffDays;

  if (remaining >= 0) {
    while (remaining > 0) {
      const monthDays = getMonthDays(bsYear, bsMonth);
      const daysLeft = monthDays - bsDay + 1;
      if (remaining >= daysLeft) {
        remaining -= daysLeft;
        bsDay = 1;
        bsMonth++;
        if (bsMonth >= 12) { bsMonth = 0; bsYear++; }
      } else {
        bsDay += remaining;
        remaining = 0;
      }
    }
  } else {
    remaining = Math.abs(remaining);
    while (remaining > 0) {
      if (remaining >= bsDay) {
        remaining -= bsDay;
        bsMonth--;
        if (bsMonth < 0) { bsMonth = 11; bsYear--; }
        bsDay = getMonthDays(bsYear, bsMonth);
      } else {
        bsDay -= remaining;
        remaining = 0;
      }
    }
  }
  return { year: bsYear, month: bsMonth, day: bsDay };
}

function toNepaliDigits(n) {
  const d = ['०','१','२','३','४','५','६','७','८','९'];
  return String(n).split('').map(c => d[parseInt(c)] || c).join('');
}

function updateNepaliDate() {
  const now = new Date();
  const bs = adToBs(now);
  const dayNameNp = BS_DAYS[now.getDay()];
  const dayNameEn = BS_DAYS_EN[now.getDay()];
  const monthNp = BS_NEPALI_MONTHS[bs.month];
  const monthEn = BS_MONTHS[bs.month];

  const npStr = `${dayNameNp}, ${toNepaliDigits(bs.day)} ${monthNp} ${toNepaliDigits(bs.year)}`;
  const enStr = `${dayNameEn}, ${bs.day} ${monthEn} ${bs.year} BS`;

  document.querySelectorAll('#nepaliDate').forEach(el => {
    el.innerHTML = `<span title="${enStr}">${npStr}</span>`;
  });
}

document.addEventListener('DOMContentLoaded', updateNepaliDate);
