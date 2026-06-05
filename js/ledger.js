const Ledger = {
    async render(el, studentId) {
        const wsId = getWorkspaceId();
        el.innerHTML = '<div class="spinner"></div>';

        const [studentRes, ledgerRes] = await Promise.all([
            db.from('students').select('*').eq('id', studentId).single(),
            db.from('student_ledger').select('*').eq('student_id', studentId).order('date').order('created_at')
        ]);

        const student = studentRes.data;
        if (!student) {
            el.innerHTML = '<div class="error-card"><h2>Student not found</h2><p><a href="#students">Back to students</a></p></div>';
            return;
        }

        const entries = ledgerRes.data || [];
        let runningBalance = 0;
        const ledgerWithBalance = entries.map(e => {
            runningBalance += (e.debit || 0) - (e.credit || 0);
            return { ...e, balance: runningBalance };
        });

        const balance = runningBalance;
        const balanceClass = balance > 0.01 ? 'positive' : (balance < -0.01 ? 'negative' : 'zero');

        el.innerHTML = `
            <div style="margin-bottom:16px">
                <a href="#students" class="btn btn-secondary btn-sm">&larr; Back to Students</a>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-info">
                        <h4>${student.name}</h4>
                        <p>${student.payment_type === 'per_month' ? 'Monthly' : 'Per Lesson'} Student${student.email ? ' — ' + student.email : ''}</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-info">
                        <h4 class="ledger-balance ${balanceClass}">${formatCurrency(balance)}</h4>
                        <p>${balance > 0.01 ? 'Amount Owed' : balance < -0.01 ? 'Credit Balance' : 'Settled'}</p>
                    </div>
                </div>
            </div>

            <div class="card mb-24">
                <div class="card-header">
                    <h3>Transaction History</h3>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-secondary" onclick="Ledger.addAdjustment('${studentId}')">+ Adjustment</button>
                        <button class="btn btn-sm btn-secondary" onclick="Ledger.exportCSV('${studentId}', '${student.name}')">Export CSV</button>
                    </div>
                </div>
                ${entries.length === 0 ? '<p class="text-muted text-center">No transactions yet.</p>' : `
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Description</th>
                                    <th>Debit</th>
                                    <th>Credit</th>
                                    <th>Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${ledgerWithBalance.map(e => `
                                    <tr>
                                        <td>${formatDate(e.date)}</td>
                                        <td>${e.description}</td>
                                        <td class="debit">${e.debit > 0 ? formatCurrency(e.debit) : ''}</td>
                                        <td class="credit">${e.credit > 0 ? formatCurrency(e.credit) : ''}</td>
                                        <td class="font-bold ${e.balance > 0.01 ? 'debit' : 'credit'}">${formatCurrency(e.balance)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>

            <div class="card">
                <div class="card-header">
                    <h3>Quick Payment</h3>
                </div>
                <div id="ledger-quick-actions" class="quick-actions mb-16">
                    ${balance > 0.01 ? '<p class="text-muted text-sm">Select who received the payment, then use quick buttons or enter a custom amount.</p>' : '<p class="text-muted">No balance outstanding.</p>'}
                </div>
                <form id="custom-pay-form">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Received By</label>
                            <select id="ledger-received-by" required>
                                <option value="">Who received it?</option>
                                ${TUTORS.map(t => `<option value="${t}">${t}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Custom Amount (R)</label>
                            <input type="number" id="pay-amount" step="0.01" min="0.01" placeholder="Amount">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Comment</label>
                        <input type="text" id="pay-comment" placeholder="Optional note">
                    </div>
                    ${balance > 0.01 ? `
                    <div class="quick-actions mb-16">
                        <button type="button" class="quick-action-btn" onclick="Ledger.quickPay('${studentId}', ${balance})">Full Payment — ${formatCurrency(balance)}</button>
                        ${balance > 1 ? `<button type="button" class="quick-action-btn" onclick="Ledger.quickPay('${studentId}', ${(balance / 2).toFixed(2)})">Half Payment — ${formatCurrency(balance / 2)}</button>` : ''}
                    </div>
                    ` : ''}
                    <button type="submit" class="btn btn-success btn-full">Log Custom Payment</button>
                </form>
            </div>
        `;

        document.getElementById('custom-pay-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = parseFloat(document.getElementById('pay-amount').value);
            const comment = document.getElementById('pay-comment').value;
            const receivedBy = document.getElementById('ledger-received-by').value;
            if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');
            if (!receivedBy) return showToast('Select who received the payment', 'error');
            await this.logPayment(studentId, amount, comment, receivedBy);
        });
    },

    async quickPay(studentId, amount) {
        const receivedBy = document.getElementById('ledger-received-by')?.value;
        if (!receivedBy) return showToast('Select who received the payment first', 'error');
        await this.logPayment(studentId, amount, 'Quick payment', receivedBy);
    },

    async logPayment(studentId, amount, comment = '', receivedBy = '') {
        const wsId = getWorkspaceId();
        const date = todayStr();
        if (!receivedBy) receivedBy = TUTORS[0];

        const { error: payErr } = await db.from('payments').insert({
            workspace_id: wsId,
            student_id: studentId,
            amount,
            date,
            comment,
            received_by_name: receivedBy,
            created_by: Auth.currentUser.id
        });

        if (payErr) return showToast(payErr.message, 'error');

        await db.from('student_ledger').insert({
            workspace_id: wsId,
            student_id: studentId,
            date,
            description: `Payment received (${receivedBy})${comment ? ' — ' + comment : ''}`,
            debit: 0,
            credit: amount,
            ref_type: 'payment'
        });

        showToast(`Payment of ${formatCurrency(amount)} logged — received by ${receivedBy}`);
        Router.resolve();
    },

    addAdjustment(studentId) {
        openModal('Add Adjustment', `
            <form id="adj-form">
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" id="adj-desc" required placeholder="e.g. Discount, Correction">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Type</label>
                        <select id="adj-type">
                            <option value="debit">Charge (Debit)</option>
                            <option value="credit">Credit</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Amount (R)</label>
                        <input type="number" id="adj-amount" step="0.01" min="0.01" required>
                    </div>
                </div>
                <div class="form-group">
                    <label>Date</label>
                    <input type="date" id="adj-date" value="${todayStr()}">
                </div>
                <button type="submit" class="btn btn-primary btn-full">Save Adjustment</button>
            </form>
        `);

        document.getElementById('adj-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const wsId = getWorkspaceId();
            const type = document.getElementById('adj-type').value;
            const amount = parseFloat(document.getElementById('adj-amount').value);

            await db.from('student_ledger').insert({
                workspace_id: wsId,
                student_id: studentId,
                date: document.getElementById('adj-date').value,
                description: document.getElementById('adj-desc').value,
                debit: type === 'debit' ? amount : 0,
                credit: type === 'credit' ? amount : 0,
                ref_type: 'adjustment'
            });

            closeModal();
            showToast('Adjustment added');
            Router.resolve();
        });
    },

    async exportCSV(studentId, studentName) {
        const { data } = await db.from('student_ledger')
            .select('*')
            .eq('student_id', studentId)
            .order('date')
            .order('created_at');

        if (!data || data.length === 0) return showToast('No data to export', 'info');

        let balance = 0;
        const rows = [['Date', 'Description', 'Debit', 'Credit', 'Balance']];
        data.forEach(e => {
            balance += (e.debit || 0) - (e.credit || 0);
            rows.push([e.date, e.description, e.debit || '', e.credit || '', balance.toFixed(2)]);
        });

        const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${studentName.replace(/\s+/g, '_')}_statement.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('CSV exported');
    }
};
