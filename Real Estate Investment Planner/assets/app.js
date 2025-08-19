// Minimal why-only comments
const $ = (id) => document.getElementById(id);
const nf0 = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const pf1 = (x) => (x * 100).toFixed(1) + '%';

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }

// State
let houses = [];
let lastSchedules = []; // for per-house CSV export

function defaultHouse(i) {
  // simple stagger for variety
  return {
    label: `Property #${i+1}`,
    homePrice: i === 0 ? 500000 : 400000,
    extraMonthly: 0,
    downPaymentPct: 20,
    aprPct: 6.5,
    termYears: 30,
    taxPct: 1.2,
    insuranceYearly: 1200,
    hoaMonthly: 0,
    // rental
    rentMonthly: i === 0 ? 2600 : 2300,
    vacancyPct: 5,
    mgmtPct: 8,
    maintPct: 5,
  };
}

function reindexLabels() {
  // why: keep numbering contiguous after deletions
  houses.forEach((h, i) => { h.label = `Property #${i+1}`; });
}

function monthlyPI(loan, r, n) {
  if (loan <= 0 || n <= 0) return 0;
  if (r === 0) return loan / n;
  const x = Math.pow(1 + r, n);
  return (loan * r * x) / (x - 1);
}

function amortize(loan, r, n, basePI, extra) {
  let bal = loan, month = 0, totalInt = 0; const rows = [];
  while (bal > 0 && month < n + 600) {
    month += 1;
    const interest = bal * r;
    let principal = Math.min(basePI + extra - interest, bal);
    if (principal < 0) principal = 0; // why: avoid negative principal when payment < interest
    const payment = principal + interest;
    bal = Math.max(bal - principal, 0);
    totalInt += interest;
    rows.push({ month, payment, extra, interest, principal, balance: bal });
    if (bal <= 0) break;
  }
  return { monthsToPayoff: rows.length, totalInterest: totalInt, schedule: rows };
}

function monthsFmt(m) { return Math.floor(m/12) + 'y ' + (m%12) + 'm'; }

function houseCardHTML(h, i) {
  return `
  <section class="card" aria-labelledby="house${i}">
    <div class="house-head">
      <h3 id="house${i}" class="house-title">${h.label}</h3>
      <div class="house-actions">
        <button id="h${i}_remove" class="btn danger" ${houses.length===1 ? 'disabled' : ''} aria-label="Remove ${h.label}">Remove</button>
        <button id="h${i}_export" class="btn">Export CSV</button>
      </div>
    </div>

    <div class="row">
      <label>
        <div class="lab">Home Price</div>
        <div class="input"><span>$</span><input id="h${i}_homePrice" type="number" step="1000" value="${h.homePrice}"></div>
      </label>
      <label>
        <div class="lab">Extra Monthly (your own)</div>
        <div class="input"><span>$</span><input id="h${i}_extraMonthly" type="number" step="50" value="${h.extraMonthly}"></div>
      </label>
    </div>

    <details style="margin-top:10px;">
      <summary>Advanced assumptions</summary>
      <div class="row" style="margin-top:10px;">
        <label>
          <div class="lab">Down Payment (%)</div>
          <div class="input"><input id="h${i}_downPaymentPct" type="number" step="0.5" value="${h.downPaymentPct}"></div>
        </label>
        <label>
          <div class="lab">APR (%)</div>
          <div class="input"><input id="h${i}_aprPct" type="number" step="0.125" value="${h.aprPct}"></div>
        </label>
        <label>
          <div class="lab">Term (years)</div>
          <div class="input"><input id="h${i}_termYears" type="number" step="1" value="${h.termYears}"></div>
        </label>
        <label>
          <div class="lab">Property Tax (%)</div>
          <div class="input"><input id="h${i}_taxPct" type="number" step="0.1" value="${h.taxPct}"></div>
        </label>
        <label>
          <div class="lab">Insurance (yearly)</div>
          <div class="input"><span>$</span><input id="h${i}_insuranceYearly" type="number" step="50" value="${h.insuranceYearly}"></div>
        </label>
        <label>
          <div class="lab">HOA (monthly)</div>
          <div class="input"><span>$</span><input id="h${i}_hoaMonthly" type="number" step="10" value="${h.hoaMonthly}"></div>
        </label>
      </div>
    </details>

    <details style="margin-top:10px;">
      <summary>Rental settings (after payoff)</summary>
      <div class="row" style="margin-top:10px;">
        <label>
          <div class="lab">Rent (monthly)</div>
          <div class="input"><span>$</span><input id="h${i}_rentMonthly" type="number" step="50" value="${h.rentMonthly}"></div>
        </label>
        <label>
          <div class="lab">Vacancy (%)</div>
          <div class="input"><input id="h${i}_vacancyPct" type="number" step="0.5" value="${h.vacancyPct}"></div>
        </label>
        <label>
          <div class="lab">Management (%)</div>
          <div class="input"><input id="h${i}_mgmtPct" type="number" step="0.5" value="${h.mgmtPct}"></div>
        </label>
        <label>
          <div class="lab">Maintenance (%)</div>
          <div class="input"><input id="h${i}_maintPct" type="number" step="0.5" value="${h.maintPct}"></div>
        </label>
        <p class="subtle" style="grid-column: 1 / -1;">Net rent = Rent × (1 - vacancy) - (mgmt% × rent) - (maint% × rent) - taxes - insurance - HOA.</p>
      </div>
    </details>

    <div class="stats" style="margin-top:12px;">
      <div class="stat"><div class="name">Loan Amount</div><div id="h${i}_loanAmount" class="value">$0</div><div id="h${i}_downSub" class="subtle"></div></div>
      <div class="stat"><div class="name">Monthly P&I</div><div id="h${i}_basePI" class="value">$0</div><div id="h${i}_rateSub" class="subtle"></div></div>
      <div class="stat"><div class="name">All-In (initial)</div><div id="h${i}_withAllIn" class="value">$0</div><div id="h${i}_costsSub" class="subtle"></div></div>
      <div class="stat"><div class="name">DTI (initial)</div><div id="h${i}_dtiVal" class="value">0%</div><div id="h${i}_dtiSub" class="subtle"></div></div>
      <div class="stat"><div class="name">Base Payoff</div><div id="h${i}_basePayoff" class="value">0y 0m</div><div id="h${i}_baseInt" class="subtle"></div></div>
      <div class="stat"><div class="name">Accelerated Payoff</div><div id="h${i}_accPayoff" class="value">0y 0m</div><div id="h${i}_accInt" class="subtle"></div></div>
      <div class="stat"><div class="name">Extra Applied (initial)</div><div id="h${i}_extraApplied" class="value">$0</div><div id="h${i}_extraSub" class="subtle"></div></div>
      <div class="stat"><div class="name">Net Rent (after payoff)</div><div id="h${i}_netRent" class="value">$0</div><div id="h${i}_rentSub" class="subtle"></div></div>
    </div>

    <div style="overflow-x:auto; margin-top:12px;">
      <h4 class="subtle" style="margin:0 0 6px;">First 12 months (accelerated)</h4>
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th>Payment</th>
            <th>Interest</th>
            <th>Principal</th>
            <th>Extra</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody id="h${i}_amBody"></tbody>
      </table>
    </div>
  </section>`;
}

function readHouseFromDOM(i) {
  const v = (id) => parseFloat(document.getElementById(id).value) || 0;
  const h = houses[i];
  h.homePrice = clamp(v(`h${i}_homePrice`), 0, 50_000_000);
  h.extraMonthly = clamp(v(`h${i}_extraMonthly`), 0, 1_000_000);
  h.downPaymentPct = clamp(v(`h${i}_downPaymentPct`), 0, 100);
  h.aprPct = clamp(v(`h${i}_aprPct`), 0, 30);
  h.termYears = clamp(v(`h${i}_termYears`), 1, 50);
  h.taxPct = clamp(v(`h${i}_taxPct`), 0, 10);
  h.insuranceYearly = clamp(v(`h${i}_insuranceYearly`), 0, 50_000);
  h.hoaMonthly = clamp(v(`h${i}_hoaMonthly`), 0, 10_000);
  h.rentMonthly = clamp(v(`h${i}_rentMonthly`), 0, 10_000_000);
  h.vacancyPct = clamp(v(`h${i}_vacancyPct`), 0, 100);
  h.mgmtPct = clamp(v(`h${i}_mgmtPct`), 0, 100);
  h.maintPct = clamp(v(`h${i}_maintPct`), 0, 100);
}

function netRentForHouse(h) {
  const taxesMonthly = (h.homePrice * (h.taxPct/100))/12;
  const insuranceMonthly = h.insuranceYearly/12;
  const grossAdj = h.rentMonthly * (1 - h.vacancyPct/100);
  const mgmt = h.rentMonthly * (h.mgmtPct/100);
  const maint = h.rentMonthly * (h.maintPct/100);
  return Math.max(grossAdj - mgmt - maint - taxesMonthly - h.hoaMonthly - insuranceMonthly, 0);
}

function render() {
  reindexLabels();
  const container = $('houses');
  container.innerHTML = houses.map((h, i) => houseCardHTML(h, i)).join('');

  // Wire per-house inputs & actions
  houses.forEach((_, i) => {
    const ids = [
      `h${i}_homePrice`,`h${i}_extraMonthly`,`h${i}_downPaymentPct`,`h${i}_aprPct`,`h${i}_termYears`,`h${i}_taxPct`,`h${i}_insuranceYearly`,`h${i}_hoaMonthly`,
      `h${i}_rentMonthly`,`h${i}_vacancyPct`,`h${i}_mgmtPct`,`h${i}_maintPct`
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { readHouseFromDOM(i); computeAll(); });
    });

    const expBtn = document.getElementById(`h${i}_export`);
    if (expBtn) expBtn.addEventListener('click', () => {
      const sched = lastSchedules[i] && lastSchedules[i].accel;
      if (sched) {
        const fn = `${houses[i].label.toLowerCase().replace(/ /g,'_')}_amortization.csv`;
        exportCSV(sched.schedule, fn);
      }
    });

    const remBtn = document.getElementById(`h${i}_remove`);
    if (remBtn) remBtn.addEventListener('click', () => removeHouse(i));
  });

  computeAll();
}

function computeAll() {
  const yearlyIncome = clamp(parseFloat($('yearlyIncome').value) || 0, 0, 10_000_000);
  const grossMonthlyIncome = yearlyIncome / 12;
  const allowOverlap = !!$('allowOverlap').checked;
  const leadMonths = clamp(parseInt($('leadMonths').value) || 0, 0, 600);

  // Enable/disable leadMonths input
  $('leadMonths').disabled = !allowOverlap;

  // precompute constants per house
  const H = houses.length;
  const loan = new Array(H);
  const r = new Array(H);
  const n = new Array(H);
  const basePI = new Array(H);
  const taxes = new Array(H);
  const insurance = new Array(H);
  const netRent = new Array(H);

  for (let i = 0; i < H; i++) {
    const h = houses[i];
    loan[i] = Math.max(h.homePrice * (1 - h.downPaymentPct/100), 0);
    r[i] = h.aprPct/100/12;
    n[i] = Math.round(h.termYears * 12);
    basePI[i] = monthlyPI(loan[i], r[i], n[i]);
    taxes[i] = (h.homePrice * (h.taxPct/100))/12;
    insurance[i] = h.insuranceYearly/12;
    netRent[i] = netRentForHouse(h);
  }

  // base (no extra) stats per house regardless of mode
  const baseStats = new Array(H);
  for (let i = 0; i < H; i++) {
    baseStats[i] = amortize(loan[i], r[i], n[i], basePI[i], 0);
  }

  if (!allowOverlap) {
    // Sequential mode (previous behavior)
    let cumulativeNetRent = 0;
    let totalMonths = 0;
    let timelineParts = [];
    lastSchedules = [];

    for (let i = 0; i < H; i++) {
      const h = houses[i];
      const extraApplied = Math.max(h.extraMonthly + cumulativeNetRent, 0);
      const accel = amortize(loan[i], r[i], n[i], basePI[i], extraApplied);

      const withAllIn = basePI[i] + extraApplied + taxes[i] + insurance[i] + h.hoaMonthly;
      const dti = grossMonthlyIncome > 0 ? withAllIn / grossMonthlyIncome : 0;

      $(`h${i}_loanAmount`).textContent = nf0.format(loan[i]);
      $(`h${i}_downSub`).textContent = h.downPaymentPct.toFixed(1) + '% down';
      $(`h${i}_basePI`).textContent = nf0.format(basePI[i]);
      $(`h${i}_rateSub`).textContent = h.aprPct.toFixed(3) + '% APR • ' + h.termYears + ' yrs';
      $(`h${i}_withAllIn`).textContent = nf0.format(withAllIn);
      $(`h${i}_costsSub`).textContent = `Taxes ${nf0.format(taxes[i])} • Ins ${nf0.format(insurance[i])} • HOA ${nf0.format(h.hoaMonthly)}`;
      const dtiEl = $(`h${i}_dtiVal`);
      dtiEl.textContent = pf1(dti);
      dtiEl.classList.remove('ok','warn','bad');
      dtiEl.classList.add(dti <= 0.28 ? 'ok' : dti <= 0.36 ? 'warn' : 'bad');
      $(`h${i}_dtiSub`).textContent = grossMonthlyIncome > 0 ? `of ${nf0.format(grossMonthlyIncome)} income` : 'enter income';

      $(`h${i}_basePayoff`).textContent = monthsFmt(baseStats[i].monthsToPayoff);
      $(`h${i}_baseInt`).textContent = 'Interest: ' + nf0.format(baseStats[i].totalInterest);
      $(`h${i}_accPayoff`).textContent = monthsFmt(accel.monthsToPayoff);
      $(`h${i}_accInt`).textContent = 'Interest: ' + nf0.format(accel.totalInterest);

      $(`h${i}_extraApplied`).textContent = nf0.format(extraApplied);
      $(`h${i}_extraSub`).textContent = `Your extra ${nf0.format(h.extraMonthly)} + rent from prior houses ${nf0.format(cumulativeNetRent)}`;

      // Table
      const tbody = $(`h${i}_amBody`);
      tbody.innerHTML = '';
      for (const row of accel.schedule.slice(0,12)) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${row.month}</td>
          <td>${nf2.format(row.payment)}</td>
          <td>${nf2.format(row.interest)}</td>
          <td>${nf2.format(row.principal)}</td>
          <td>${nf2.format(row.extra)}</td>
          <td>${nf2.format(row.balance)}</td>
        `;
        tbody.appendChild(tr);
      }

      lastSchedules[i] = { base: baseStats[i], accel };

      $(`h${i}_netRent`).textContent = nf0.format(netRent[i]);
      $(`h${i}_rentSub`).textContent = netRent[i] > 0 ? `Starts after payoff (${monthsFmt(accel.monthsToPayoff)})` : 'Adjust rent/expenses';

      cumulativeNetRent += netRent[i];
      totalMonths += accel.monthsToPayoff;
      timelineParts.push(`${houses[i].label}: ${monthsFmt(accel.monthsToPayoff)}`);
    }

    $('totalTimeline').textContent = monthsFmt(totalMonths);
    $('timelineSub').textContent = timelineParts.join(' → ');
    $('cumNetRent').textContent = nf0.format(H ? houses.slice(0,-1).reduce((s, h) => s + netRentForHouse(h), 0) : 0);
    return;
  }

  // Overlap mode: simulate month-by-month

  // 1) Baseline sequential end months to decide starts
  const baselineEnd = new Array(H);
  let baselineNet = 0;
  for (let i = 0; i < H; i++) {
    const h = houses[i];
    const extraApplied = Math.max(h.extraMonthly + baselineNet, 0);
    const accel = amortize(loan[i], r[i], n[i], basePI[i], extraApplied);
    baselineEnd[i] = (i === 0 ? 0 : baselineEnd[i-1]) + accel.monthsToPayoff;
    baselineNet += netRent[i];
  }

  // 2) Start months with lead
  const startMonth = new Array(H);
  for (let i = 0; i < H; i++) {
    startMonth[i] = i === 0 ? 1 : Math.max(1, baselineEnd[i-1] - leadMonths);
  }

  // 3) Simulate
  const bal = loan.slice();
  const paid = new Array(H).fill(false);
  const schedules = new Array(H).fill(null).map(() => []);
  const interestSum = new Array(H).fill(0);
  const monthIndex = new Array(H).fill(0);

  const limit = startMonth[H-1] + n.reduce((a,b)=>a+b,0) + 600; // why: safety
  let m = 0;
  let allDone = false;
  while (!allDone && m < limit) {
    m += 1;

    for (let i = 0; i < H; i++) {
      if (paid[i]) continue;
      if (m < startMonth[i]) continue;

      // extra this month grows as earlier houses pay off
      let extraThisMonth = houses[i].extraMonthly;
      for (let k = 0; k < i; k++) {
        if (paid[k]) extraThisMonth += netRent[k];
      }

      const interest = bal[i] * r[i];
      let principal = Math.min(Math.max(basePI[i] + extraThisMonth - interest, 0), bal[i]);
      const payment = principal + interest;
      bal[i] = Math.max(bal[i] - principal, 0);
      interestSum[i] += interest;
      monthIndex[i] += 1;
      schedules[i].push({ month: monthIndex[i], payment, interest, principal, extra: extraThisMonth, balance: bal[i] });

      if (bal[i] <= 0) {
        paid[i] = true;
      }
    }

    allDone = paid.every(Boolean);
  }

  const totalMonths = m;

  // 4) Render using simulation results
  let timelineParts = [];
  lastSchedules = [];

  for (let i = 0; i < H; i++) {
    const h = houses[i];
    const initialExtra = schedules[i][0] ? schedules[i][0].extra : h.extraMonthly;
    const withAllInInitial = basePI[i] + initialExtra + taxes[i] + insurance[i] + h.hoaMonthly;
    const dti = grossMonthlyIncome > 0 ? withAllInInitial / grossMonthlyIncome : 0;

    $(`h${i}_loanAmount`).textContent = nf0.format(loan[i]);
    $(`h${i}_downSub`).textContent = h.downPaymentPct.toFixed(1) + '% down';
    $(`h${i}_basePI`).textContent = nf0.format(basePI[i]);
    $(`h${i}_rateSub`).textContent = h.aprPct.toFixed(3) + '% APR • ' + h.termYears + ' yrs';
    $(`h${i}_withAllIn`).textContent = nf0.format(withAllInInitial);
    $(`h${i}_costsSub`).textContent = `Taxes ${nf0.format(taxes[i])} • Ins ${nf0.format(insurance[i])} • HOA ${nf0.format(h.hoaMonthly)}`;
    const dtiEl = $(`h${i}_dtiVal`);
    dtiEl.textContent = pf1(dti);
    dtiEl.classList.remove('ok','warn','bad');
    dtiEl.classList.add(dti <= 0.28 ? 'ok' : dti <= 0.36 ? 'warn' : 'bad');
    $(`h${i}_dtiSub`).textContent = grossMonthlyIncome > 0 ? `of ${nf0.format(grossMonthlyIncome)} income` : 'enter income';

    const accelMonths = schedules[i].length;
    $(`h${i}_basePayoff`).textContent = monthsFmt(baseStats[i].monthsToPayoff);
    $(`h${i}_baseInt`).textContent = 'Interest: ' + nf0.format(baseStats[i].totalInterest);
    $(`h${i}_accPayoff`).textContent = monthsFmt(accelMonths);
    $(`h${i}_accInt`).textContent = 'Interest: ' + nf0.format(interestSum[i]);

    $(`h${i}_extraApplied`).textContent = nf0.format(initialExtra);
    $(`h${i}_extraSub`).textContent = `Starts at ${nf0.format(initialExtra)} and grows as prior houses pay off`;

    $(`h${i}_netRent`).textContent = nf0.format(netRent[i]);
    $(`h${i}_rentSub`).textContent = netRent[i] > 0 ? `Contributes after this house payoff` : 'Adjust rent/expenses';

    const tbody = $(`h${i}_amBody`);
    tbody.innerHTML = '';
    for (const row of schedules[i].slice(0,12)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.month}</td>
        <td>${nf2.format(row.payment)}</td>
        <td>${nf2.format(row.interest)}</td>
        <td>${nf2.format(row.principal)}</td>
        <td>${nf2.format(row.extra)}</td>
        <td>${nf2.format(row.balance)}</td>
      `;
      tbody.appendChild(tr);
    }

    lastSchedules[i] = { base: baseStats[i], accel: { monthsToPayoff: accelMonths, totalInterest: interestSum[i], schedule: schedules[i] } };
    timelineParts.push(`${houses[i].label}: ${monthsFmt(accelMonths)}`);
  }

  $('totalTimeline').textContent = monthsFmt(totalMonths);
  $('timelineSub').textContent = `Starts: ${startMonth.map((s,i)=>`${houses[i].label} @ m${s}`).join(', ')} • Durations → ` + timelineParts.join(' | ');
  $('cumNetRent').textContent = nf0.format(H ? houses.slice(0,-1).reduce((s, h) => s + netRentForHouse(h), 0) : 0);
}

function exportCSV(schedule, filename) {
  const header = ['Month','Payment','Extra','Interest','Principal','Balance'];
  const body = schedule.map(r => [r.month, r.payment, r.extra ?? 0, r.interest, r.principal, r.balance]
    .map(n => typeof n === 'number' ? n.toFixed(2) : String(n)).join(','))
    .join('\n');
  const csv = header.join(',') + '\n' + body;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function resetDefaults() {
  houses = [defaultHouse(0)];
  $('yearlyIncome').value = 120000;
  $('allowOverlap').checked = false;
  $('leadMonths').value = 6;
  $('leadMonths').disabled = true;
  render();
}

function addHouse() {
  houses.push(defaultHouse(houses.length));
  render();
}

function removeHouse(i) {
  if (houses.length <= 1) return; // why: keep at least one house
  const name = houses[i].label;
  if (!confirm(`Remove ${name}?`)) return; // why: avoid accidental deletion
  houses.splice(i, 1);
  render();
}

// Wire global events
window.addEventListener('DOMContentLoaded', () => {
  $('resetBtn').addEventListener('click', resetDefaults);
  $('addHouseBtn').addEventListener('click', addHouse);
  $('yearlyIncome').addEventListener('input', computeAll);
  $('allowOverlap').addEventListener('change', () => { $('leadMonths').disabled = !$('allowOverlap').checked; computeAll(); });
  $('leadMonths').addEventListener('input', computeAll);
  resetDefaults();
});
