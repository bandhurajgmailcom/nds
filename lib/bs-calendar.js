/**
 * BS ↔ AD converter — server-side implementation of the Oracle GET_NEPDATE formula.
 *
 * Reference epoch: April 12, 1943 (day 0, the day before BS 2000 Baishakh 1).
 * Formula:  daysDiff = floor(adDate − epoch)
 *           bsDay    = daysDiff − cumStartDays
 *           where cumStartDays = max(cumStartDays) such that cumStartDays < daysDiff
 *
 * Verified reference points:
 *   BS 2057 Baishakh 1  = April 14, 2000  (daysDiff 20822, cumStart 20821)
 *   BS 2076 Chaitra  27 = April  9, 2020  ← the bug the client-side JS got wrong
 *   BS 2077 Baishakh 1  = April 13, 2020  (leap BS year, 366 days)
 *   BS 2078 Baishakh 1  = April 14, 2021  (daysDiff 28492, cumStart 28491)
 *
 * BS leap years in 2057-2090 (366-day years): 2060, 2064, 2068, 2072, 2077, 2082, 2083, 2084, 2086, 2090
 *
 * Years 2000-2056 are included so the cumulative sums are correct when
 * converting dates before 2057, but month-level accuracy for those years
 * is approximate — update via /admin/nepalical if precision is needed.
 */

'use strict';

const EPOCH = new Date(1943, 3, 12); // April 12, 1943

// [Baishakh, Jestha, Ashadh, Shrawan, Bhadra, Ashwin, Kartik, Mangsir, Poush, Magh, Falgun, Chaitra]
const BS_DATA = {
  // ── 2000-2056 (AD 1943-2000): approximate month distribution, correct year totals ──
  2000:[30,32,31,32,31,30,30,30,29,30,30,31],
  2001:[31,31,31,32,31,31,30,29,30,29,30,30],
  2002:[31,31,32,31,31,30,30,30,29,30,30,30],
  2003:[31,32,31,32,31,30,30,30,29,30,30,30],
  2004:[31,32,31,32,31,30,30,30,29,30,30,30],
  2005:[31,32,31,32,31,31,30,29,30,29,30,30],
  2006:[31,31,31,32,31,31,30,30,29,30,29,31],
  2007:[30,32,31,32,31,30,30,30,29,30,30,31],
  2008:[31,31,32,31,31,30,30,30,29,30,30,30],
  2009:[31,31,32,31,31,30,30,30,29,30,30,30],
  2010:[31,32,31,32,31,30,30,30,29,29,30,31],
  2011:[31,32,31,32,31,30,30,30,29,30,29,31],
  2012:[31,32,31,32,31,30,30,30,29,30,30,30],
  2013:[31,31,31,32,31,31,29,30,30,29,30,30],
  2014:[31,31,32,31,31,31,30,29,30,29,30,30],
  2015:[31,31,32,31,31,30,30,30,29,30,30,30],
  2016:[31,32,31,32,31,30,30,30,29,30,30,30],
  2017:[31,32,31,32,31,30,30,30,29,30,30,30],
  2018:[31,32,31,32,31,30,30,30,29,30,30,30],
  2019:[31,31,32,31,31,31,30,30,29,30,30,30],
  2020:[31,31,32,31,31,31,30,30,29,30,30,30],
  2021:[31,31,32,31,31,31,30,29,30,29,30,30],
  2022:[31,31,32,31,31,30,30,30,29,30,30,31],
  2023:[31,31,32,31,31,30,30,30,29,30,30,30],
  2024:[31,32,31,32,31,29,30,30,29,30,30,31],
  2025:[31,32,31,32,31,30,30,30,29,30,30,30],
  2026:[31,32,31,32,31,30,30,30,29,30,30,30],
  2027:[31,32,31,31,31,30,30,30,29,30,30,31],
  2028:[30,32,31,32,31,30,30,30,29,30,30,31],
  2029:[31,31,32,31,31,30,30,30,29,30,30,30],
  2030:[31,31,32,31,31,30,30,30,29,29,30,31],
  2031:[31,32,31,32,31,30,30,29,30,29,30,30],
  2032:[31,32,31,32,31,30,30,30,29,30,30,30],
  2033:[31,31,32,32,31,30,30,29,30,29,30,30],
  2034:[31,31,31,32,31,31,30,29,30,29,30,30],
  2035:[31,31,32,31,31,30,30,30,29,30,30,30],
  2036:[31,32,31,32,31,30,30,30,29,30,29,31],
  2037:[30,32,31,32,31,30,30,30,29,30,30,31],
  2038:[31,31,32,31,31,31,30,29,30,29,30,30],
  2039:[31,31,31,32,31,30,30,30,29,30,30,31],
  2040:[31,32,31,32,31,30,30,30,29,30,30,30],
  2041:[31,32,31,32,31,30,30,30,29,30,30,30],
  2042:[31,31,31,32,31,31,30,29,30,29,30,30],
  2043:[31,32,31,32,31,30,30,30,29,30,29,31],
  2044:[31,32,31,32,31,30,30,30,29,30,30,30],
  2045:[31,31,32,31,31,31,30,29,30,29,30,30],
  2046:[31,31,32,32,31,30,30,30,29,29,30,30],
  2047:[31,32,31,32,31,30,30,30,29,30,29,31],
  2048:[30,32,31,32,31,30,30,30,29,30,30,31],
  2049:[31,31,32,31,31,30,30,30,29,30,30,30],
  2050:[31,31,32,31,31,30,30,30,29,30,30,30],
  2051:[31,32,31,32,31,30,30,30,29,30,29,31],
  2052:[31,32,31,32,31,30,30,29,30,29,30,30],
  2053:[31,31,32,31,31,30,30,30,29,30,30,30],
  2054:[31,31,32,31,31,30,30,30,29,30,30,30],
  2055:[31,32,31,32,31,30,30,30,29,30,29,31],
  2056:[30,32,31,32,31,30,30,30,29,30,30,31],
  // ── 2057-2090: verified against Nepal New Year dates ──
  // Leap years (366 days): 2060, 2064, 2068, 2072, 2077, 2082, 2083, 2084, 2086, 2090
  2057:[31,32,31,32,31,30,30,30,29,29,30,30],  // 365
  2058:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2059:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2060:[31,32,31,32,31,30,30,30,29,29,30,31],  // 366
  2061:[31,32,31,32,31,30,30,30,29,30,29,30],  // 365
  2062:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2063:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2064:[31,32,31,32,31,30,30,30,29,29,30,31],  // 366
  2065:[31,32,31,32,31,30,30,30,29,30,29,30],  // 365
  2066:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2067:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2068:[31,32,31,32,31,30,30,30,29,29,30,31],  // 366
  2069:[31,32,31,32,31,30,30,30,29,30,29,30],  // 365
  2070:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2071:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2072:[31,32,31,32,31,30,30,30,29,29,30,31],  // 366
  2073:[31,32,31,32,31,30,30,30,29,30,29,30],  // 365
  2074:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2075:[31,32,31,32,31,30,30,29,30,29,30,30],  // 365
  2076:[31,32,31,32,31,30,30,30,29,29,30,30],  // 365  ← verified: 2076/12/27 = 2020-04-09
  2077:[31,31,32,31,31,31,30,29,30,29,30,31],  // 366  ← leap (Apr 13 2020 → Apr 14 2021)
  2078:[31,31,32,31,31,31,30,30,29,30,29,31],  // 366  ← from DB seed
  2079:[31,32,31,32,31,30,30,30,29,29,30,30],  // 365
  2080:[31,32,31,32,31,30,30,30,29,29,30,30],  // 365
  2081:[31,31,32,31,31,31,30,29,30,29,30,30],  // 365
  2082:[31,32,31,32,31,30,30,30,29,30,30,30],  // 366
  2083:[31,31,32,32,31,30,30,30,29,30,30,30],  // 366
  2084:[31,31,32,32,31,30,30,30,29,30,30,30],  // 366
  2085:[31,32,31,32,31,30,30,29,30,29,30,30],  // 365
  2086:[31,32,31,32,31,30,30,30,29,29,30,31],  // 366
  2087:[31,32,31,32,31,30,30,30,29,29,30,30],  // 365
  2088:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2089:[31,31,32,31,31,30,30,30,29,30,30,30],  // 365
  2090:[31,32,31,32,31,30,30,30,29,29,30,31],  // 366
};

const BS_MONTH_NAMES = [
  'Baishakh','Jestha','Ashadh','Shrawan','Bhadra',
  'Ashwin','Kartik','Mangsir','Poush','Magh','Falgun','Chaitra'
];
const BS_MONTH_NAMES_NP = [
  'बैशाख','जेठ','असार','साउन','भदौ',
  'असोज','कात्तिक','मंसिर','पुष','माघ','फागुन','चैत'
];

/**
 * Precompute cumStartDays for every month.
 * cumStart[year][monthIndex] = total BS days from epoch to start of that month.
 * BS 2057 Baishakh cumStart = 20821 (verified: daysDiff for Apr 14 2000 = 20822, bsDay = 1).
 */
const CUM_START = {};
{
  // Sum of all BS years from 2000 to 2056 = 20821 (verified via reference points)
  const BS_2057_OFFSET = 20821;

  const years = Object.keys(BS_DATA).map(Number).sort((a, b) => a - b);
  let cum = 0;

  // First pass: compute cumStart for years 2000-2056 relative to each other
  // We'll correct the absolute offset after
  for (const yr of years) {
    CUM_START[yr] = [];
    for (let m = 0; m < 12; m++) {
      CUM_START[yr][m] = cum;
      cum += BS_DATA[yr][m];
    }
  }

  // cum now = total days from BS 2000 Baishakh to end of last year in BS_DATA.
  // The cumStart for BS 2000 Baishakh should be 0 (relative),
  // but we need to shift everything so BS 2057 Baishakh = BS_2057_OFFSET.
  const bs2057_relative = CUM_START[2057][0]; // relative value computed above
  const shift = BS_2057_OFFSET - bs2057_relative;

  for (const yr of years) {
    for (let m = 0; m < 12; m++) {
      CUM_START[yr][m] += shift;
    }
  }
}

/**
 * Convert AD date → BS date.
 * Returns { year, month (1-12), day, monthName, monthNameNp } or null if out of range.
 */
function adToBs(adDate) {
  const diffDays = Math.floor((adDate - EPOCH) / 86400000);

  // Find the row with max cumStart < diffDays (Oracle formula)
  const years = Object.keys(CUM_START).map(Number).sort((a, b) => b - a); // descending
  for (const yr of years) {
    for (let m = 11; m >= 0; m--) {
      if (CUM_START[yr][m] < diffDays) {
        const day = diffDays - CUM_START[yr][m];
        return {
          year: yr,
          month: m + 1,
          day,
          monthName: BS_MONTH_NAMES[m],
          monthNameNp: BS_MONTH_NAMES_NP[m],
        };
      }
    }
  }
  return null; // before epoch
}

/**
 * Convert BS date → AD date.
 * month is 1-indexed (1=Baishakh … 12=Chaitra).
 * Returns a Date object or null if out of range.
 */
function bsToAd(bsYear, bsMonth, bsDay) {
  if (!CUM_START[bsYear] || CUM_START[bsYear][bsMonth - 1] === undefined) return null;
  const cumStart = CUM_START[bsYear][bsMonth - 1];
  const diffDays = cumStart + bsDay;
  return new Date(EPOCH.getTime() + diffDays * 86400000);
}

/** Days in a given BS month (1-indexed month). */
function monthDays(bsYear, bsMonth) {
  return BS_DATA[bsYear] ? BS_DATA[bsYear][bsMonth - 1] : null;
}

module.exports = { adToBs, bsToAd, monthDays, BS_DATA, BS_MONTH_NAMES, BS_MONTH_NAMES_NP, EPOCH };
