const Settlement = {
    selectedMonth: null,

    async render(el) {
        const wsId = getWorkspaceId();
        el.innerHTML = '<div class="spinner"></div>';

        const now = new Date();
        if (!this.selectedMonth) {
            this.selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        const currentMonth = this.selectedMonth;

        const [wsRes, classesRes, studentsRes, paymentsRes, ledgerRes] = await Promise.all([
            db.from('workspaces').select('split_ratio').eq('id', wsId).single(),
            db.from('classes').select('id, name').eq('workspace_id', wsId).eq('archived', false),
            db.from('students').select('id, name').eq('workspace_id', wsId),
            db.from('payments').select('*').eq('workspace_id', wsId),
            db.from('student_ledger').select('*').eq('workspace_id', wsId)
        ]);

        const splitRatio = wsRes.data?.split_ratio || 50;
        const classes = classesRes.data || [];
        const students = studentsRes.data || [];
        const payments = paymentsRes.data || [];
        const ledger = ledgerRes.data || [];

        const studentMap = {};
        students.forEach(s => studentMap[s.id] = s.name);

        const monthStart = currentMonth + '-01';
        const nextMonthDate = new Date(selYear, selMon, 1);
        const monthEnd = nextMonthDate.toISOString().split('T')[0];

        const monthPayments = payments.filter(p => p.date >= monthStart && p.date < monthEnd);
        const monthLedger = ledger.filter(e => e.date >= monthStart && e.date < monthEnd);
        const totalPayments = monthPayments.reduce((s, p) => s + (p.amount || 0), 0);
        const totalCharged = monthLedger.reduce((s, e) => s + (e.debit || 0), 0);

        // Per-tutor collections using received_by_name
        const tutorCollected = {};
        TUTORS.forEach(t => tutorCollected[t] = 0);
        monthPayments.forEach(p => {
            const name = p.received_by_name || '';
            if (tutorCollected[name] !== undefined) {
                tutorCollected[name] += (p.amount || 0);
            }
        });

        // Student balances
        const balances = {};
        students.forEach(s => balances[s.id] = 0);
        ledger.forEach(e => {
            if (balances[e.student_id] !== undefined) {
                balances[e.student_id] += (e.debit || 0) - (e.credit || 0);
            }
        });

        const totalOutstanding = Object.values(balances).reduce((s, b) => s + Math.max(0, b), 0);
        const allTimePayments = payments.reduce((s, p) => s + (p.amount || 0), 0);

        // Class revenue
        const classRevenue = {};
        classes.forEach(c => classRevenue[c.id] = { name: c.name, amount: 0 });
        monthLedger.forEach(e => {
            if (e.ref_type === 'attendance' && e.ref_id && classRevenue[e.ref_id]) {
                classRevenue[e.ref_id].amount += (e.debit || 0);
            }
        });

        // Settlement calculation
        const t1 = TUTORS[0]; // WH
        const t2 = TUTORS[1]; // YD
        const t1Collected = tutorCollected[t1] || 0;
        const t2Collected = tutorCollected[t2] || 0;
        const t1ShouldGet = totalPayments * splitRatio / 100;
        const t2ShouldGet = totalPayments * (100 - splitRatio) / 100;
        const t1Diff = t1Collected - t1ShouldGet;

        let settlementMessage = '';
        let settlementAmount = 0;
        let settlementClass = '';
        if (totalPayments < 0.01) {
            settlementMessage = 'No payments received this month yet.';
            settlementClass = 'muted';
        } else if (Math.abs(t1Diff) < 0.01) {
            settlementMessage = 'All settled — no one owes anything!';
            settlementClass = 'success';
        } else if (t1Diff > 0) {
            settlementAmount = t1Diff;
            settlementMessage = `${t1} owes ${t2}`;
            settlementClass = 'warning';
        } else {
            settlementAmount = Math.abs(t1Diff);
            settlementMessage = `${t2} owes ${t1}`;
            settlementClass = 'warning';
        }

        const [selYear, selMon] = currentMonth.split('-').map(Number);
        const monthName = new Date(selYear, selMon - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });

        // Build month options (last 12 months)
        const monthOptions = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
            monthOptions.push({ val, label });
        }

        el.innerHTML = `
            <div class="filter-bar">
                <div class="flex gap-12" style="align-items:center">
                    <h3>Settlement</h3>
                    <select id="month-picker" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg-input);color:var(--text);font-weight:600">
                        ${monthOptions.map(m => `<option value="${m.val}" ${m.val === currentMonth ? 'selected' : ''}>${m.label}</option>`).join('')}
                    </select>
                </div>
                <button class="btn btn-sm btn-secondary" onclick="Settlement.exportSummary()">Export CSV</button>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon green">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>
                    </div>
                    <div class="stat-info">
                        <h4>${formatCurrency(totalCharged)}</h4>
                        <p>Charged This Month</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon purple">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    </div>
                    <div class="stat-info">
                        <h4>${formatCurrency(totalPayments)}</h4>
                        <p>Received This Month</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon orange">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </div>
                    <div class="stat-info">
                        <h4>${formatCurrency(totalOutstanding)}</h4>
                        <p>Total Outstanding</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon red">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                    </div>
                    <div class="stat-info">
                        <h4>${formatCurrency(allTimePayments)}</h4>
                        <p>All-Time Revenue</p>
                    </div>
                </div>
            </div>

            <!-- WHO OWES WHO -->
            <div class="card mb-24" style="border: 2px solid ${settlementClass === 'success' ? 'var(--success)' : settlementClass === 'warning' ? 'var(--warning)' : 'var(--border)'}">
                <div class="card-header">
                    <h3>Settlement Summary</h3>
                    <div class="flex gap-8" style="align-items:center">
                        <label class="text-sm text-muted">Split Ratio:</label>
                        <select id="split-ratio" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:14px;background:var(--bg-input);color:var(--text)">
                            <option value="50" ${splitRatio === 50 ? 'selected' : ''}>50 / 50</option>
                            <option value="60" ${splitRatio === 60 ? 'selected' : ''}>60 / 40</option>
                            <option value="70" ${splitRatio === 70 ? 'selected' : ''}>70 / 30</option>
                            <option value="40" ${splitRatio === 40 ? 'selected' : ''}>40 / 60</option>
                        </select>
                    </div>
                </div>

                <div class="table-wrapper mb-16">
                    <table>
                        <thead>
                            <tr>
                                <th>Tutor</th>
                                <th>Collected</th>
                                <th>Fair Share (${splitRatio}/${100-splitRatio})</th>
                                <th>Difference</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="font-bold">${t1}</td>
                                <td>${formatCurrency(t1Collected)}</td>
                                <td>${formatCurrency(t1ShouldGet)}</td>
                                <td class="${t1Diff > 0.01 ? 'debit' : t1Diff < -0.01 ? 'credit' : ''} font-bold">
                                    ${t1Diff > 0.01 ? '+' : ''}${formatCurrency(t1Diff)}
                                </td>
                            </tr>
                            <tr>
                                <td class="font-bold">${t2}</td>
                                <td>${formatCurrency(t2Collected)}</td>
                                <td>${formatCurrency(t2ShouldGet)}</td>
                                <td class="${-t1Diff > 0.01 ? 'debit' : -t1Diff < -0.01 ? 'credit' : ''} font-bold">
                                    ${-t1Diff > 0.01 ? '+' : ''}${formatCurrency(-t1Diff)}
                                </td>
                            </tr>
                            <tr style="border-top:2px solid var(--border)">
                                <td class="font-bold">Total</td>
                                <td class="font-bold">${formatCurrency(totalPayments)}</td>
                                <td class="font-bold">${formatCurrency(totalPayments)}</td>
                                <td></td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- The verdict -->
                <div style="background:${settlementClass === 'success' ? 'var(--success-light)' : settlementClass === 'warning' ? 'var(--warning-light)' : 'var(--bg)'};border-radius:var(--radius);padding:24px;text-align:center">
                    <p class="text-muted" style="margin-bottom:8px;font-size:15px">${settlementMessage}</p>
                    ${settlementAmount > 0.01 ? `
                        <h2 style="font-size:36px;font-weight:700;color:var(--warning)">${formatCurrency(settlementAmount)}</h2>
                    ` : totalPayments > 0.01 ? `
                        <h2 style="font-size:28px;font-weight:700;color:var(--success)">All Even!</h2>
                    ` : ''}
                </div>
            </div>

            <div class="card mb-24">
                <div class="card-header">
                    <h3>Revenue by Class</h3>
                </div>
                ${Object.values(classRevenue).length === 0 ? '<p class="text-muted text-center">No class data this month.</p>' : `
                    <div class="table-wrapper">
                        <table>
                            <thead><tr><th>Class</th><th>Revenue (Charged)</th></tr></thead>
                            <tbody>
                                ${Object.values(classRevenue).map(c => `
                                    <tr>
                                        <td class="font-bold">${c.name}</td>
                                        <td>${formatCurrency(c.amount)}</td>
                                    </tr>
                                `).join('')}
                                <tr style="border-top:2px solid var(--border)">
                                    <td class="font-bold">Total</td>
                                    <td class="font-bold">${formatCurrency(Object.values(classRevenue).reduce((s,c) => s + c.amount, 0))}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                `}
            </div>

            <div class="card mb-24">
                <div class="card-header">
                    <h3>Payments by Tutor (This Month)</h3>
                </div>
                ${monthPayments.length === 0 ? '<p class="text-muted text-center">No payments this month.</p>' : `
                    <div class="table-wrapper">
                        <table>
                            <thead><tr><th>Date</th><th>Student</th><th>Amount</th><th>Received By</th></tr></thead>
                            <tbody>
                                ${monthPayments.sort((a,b) => a.date.localeCompare(b.date)).map(p => `
                                    <tr>
                                        <td>${formatDate(p.date)}</td>
                                        <td>${studentMap[p.student_id] || '—'}</td>
                                        <td class="credit font-bold">${formatCurrency(p.amount)}</td>
                                        <td><span class="badge badge-info">${p.received_by_name || '—'}</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>

            <div class="card">
                <div class="card-header">
                    <h3>Outstanding Students</h3>
                </div>
                ${Object.entries(balances).filter(([,b]) => b > 0.01).length === 0
                    ? '<p class="text-muted text-center">All students are settled!</p>'
                    : `
                    <div class="table-wrapper">
                        <table>
                            <thead><tr><th>Student</th><th>Balance Owed</th></tr></thead>
                            <tbody>
                                ${Object.entries(balances)
                                    .filter(([,b]) => b > 0.01)
                                    .sort((a,b) => b[1] - a[1])
                                    .map(([sid, bal]) => `
                                        <tr class="clickable" onclick="Router.navigate('student/${sid}')">
                                            <td class="font-bold">${studentMap[sid] || 'Unknown'}</td>
                                            <td class="debit font-bold">${formatCurrency(bal)}</td>
                                        </tr>
                                    `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;

        document.getElementById('month-picker').addEventListener('change', (e) => {
            this.selectedMonth = e.target.value;
            this.render(el);
        });

        document.getElementById('split-ratio').addEventListener('change', async (e) => {
            const newRatio = parseInt(e.target.value);
            await db.from('workspaces').update({ split_ratio: newRatio }).eq('id', wsId);
            this.render(el);
        });
    },

    async exportSummary() {
        const wsId = getWorkspaceId();
        const now = new Date();
        const currentMonth = this.selectedMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const [selYear, selMon] = currentMonth.split('-').map(Number);
        const monthStart = currentMonth + '-01';
        const nextMonth = new Date(selYear, selMon, 1);
        const monthEnd = nextMonth.toISOString().split('T')[0];

        const [studentsRes, paymentsRes, ledgerRes] = await Promise.all([
            db.from('students').select('id, name').eq('workspace_id', wsId),
            db.from('payments').select('*').eq('workspace_id', wsId),
            db.from('student_ledger').select('*').eq('workspace_id', wsId)
        ]);

        const students = studentsRes.data || [];
        const payments = paymentsRes.data || [];
        const ledger = ledgerRes.data || [];

        const balances = {};
        students.forEach(s => balances[s.id] = 0);
        ledger.forEach(e => {
            if (balances[e.student_id] !== undefined) {
                balances[e.student_id] += (e.debit || 0) - (e.credit || 0);
            }
        });

        const monthPayments = payments.filter(p => p.date >= monthStart && p.date < monthEnd);
        const totalMp = monthPayments.reduce((s, p) => s + p.amount, 0);

        const rows = [['Student', 'Total Balance', 'Payments This Month', 'Received By']];
        students.forEach(s => {
            const sp = monthPayments.filter(p => p.student_id === s.id);
            const mp = sp.reduce((sum, p) => sum + p.amount, 0);
            const receivers = [...new Set(sp.map(p => p.received_by_name || '—'))].join('; ');
            rows.push([s.name, (balances[s.id] || 0).toFixed(2), mp.toFixed(2), receivers]);
        });

        rows.push([]);
        rows.push(['--- TUTOR SETTLEMENT ---']);
        TUTORS.forEach(t => {
            const collected = monthPayments.filter(p => p.received_by_name === t).reduce((s, p) => s + p.amount, 0);
            rows.push([t, '', collected.toFixed(2), 'Collected']);
        });
        rows.push(['TOTAL', '', totalMp.toFixed(2)]);

        const csv = rows.map(r => (Array.isArray(r) ? r : [r]).map(c => `"${c}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `settlement_${currentMonth}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Settlement exported');
    }
};
