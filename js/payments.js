const TUTORS = ['WH', 'YD'];

const Payments = {
    async render(el) {
        const wsId = getWorkspaceId();
        el.innerHTML = '<div class="spinner"></div>';

        const [studentsRes, paymentsRes] = await Promise.all([
            db.from('students').select('id, name').eq('workspace_id', wsId).order('name'),
            db.from('payments').select('*, students(name)').eq('workspace_id', wsId).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(50)
        ]);

        const students = studentsRes.data || [];
        const payments = paymentsRes.data || [];

        el.innerHTML = `
            <div class="card mb-24">
                <div class="card-header">
                    <h3>Log Payment</h3>
                </div>
                <form id="payment-form">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Student</label>
                            <select id="pay-student" required>
                                <option value="">Select student...</option>
                                ${students.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Received By</label>
                            <select id="pay-received-by" required>
                                <option value="">Who received it?</option>
                                ${TUTORS.map(t => `<option value="${t}">${t}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Amount (R)</label>
                            <input type="number" id="pay-amount" step="0.01" min="0.01" required placeholder="0.00">
                        </div>
                        <div class="form-group">
                            <label>Date</label>
                            <input type="date" id="pay-date" value="${todayStr()}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Comment</label>
                        <input type="text" id="pay-comment" placeholder="Optional note">
                    </div>
                    <div id="pay-quick-btns" class="quick-actions mb-16" style="display:none"></div>
                    <button type="submit" class="btn btn-success btn-full">Log Payment</button>
                </form>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3>Payment History</h3>
                </div>
                ${payments.length === 0 ? '<p class="text-muted text-center">No payments recorded yet.</p>' : `
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Student</th>
                                    <th>Amount</th>
                                    <th>Received By</th>
                                    <th>Comment</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${payments.map(p => `
                                    <tr>
                                        <td>${formatDate(p.date)}</td>
                                        <td class="font-bold">${p.students?.name || '—'}</td>
                                        <td class="credit font-bold">${formatCurrency(p.amount)}</td>
                                        <td><span class="badge badge-info">${p.received_by_name || '—'}</span></td>
                                        <td class="text-muted">${p.comment || '—'}</td>
                                        <td>
                                            <button class="btn btn-sm btn-secondary" onclick="Payments.printReceipt('${p.id}')">Receipt</button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;

        document.getElementById('pay-student').addEventListener('change', async (e) => {
            const studentId = e.target.value;
            const quickBtns = document.getElementById('pay-quick-btns');
            if (!studentId) { quickBtns.style.display = 'none'; return; }

            const { data: ledger } = await db.from('student_ledger')
                .select('debit, credit')
                .eq('student_id', studentId);

            let balance = 0;
            (ledger || []).forEach(e => balance += (e.debit || 0) - (e.credit || 0));

            if (balance > 0.01) {
                quickBtns.style.display = 'flex';
                quickBtns.innerHTML = `
                    <button type="button" class="quick-action-btn" onclick="document.getElementById('pay-amount').value='${balance.toFixed(2)}'">Full — ${formatCurrency(balance)}</button>
                    ${balance > 1 ? `<button type="button" class="quick-action-btn" onclick="document.getElementById('pay-amount').value='${(balance/2).toFixed(2)}'">Half — ${formatCurrency(balance/2)}</button>` : ''}
                `;
            } else {
                quickBtns.style.display = 'flex';
                quickBtns.innerHTML = '<span class="text-muted text-sm">This student has no outstanding balance.</span>';
            }
        });

        document.getElementById('payment-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const studentId = document.getElementById('pay-student').value;
            const amount = parseFloat(document.getElementById('pay-amount').value);
            const date = document.getElementById('pay-date').value;
            const comment = document.getElementById('pay-comment').value;
            const receivedBy = document.getElementById('pay-received-by').value;

            if (!studentId || !amount) return showToast('Select a student and enter amount', 'error');
            if (!receivedBy) return showToast('Select who received the payment', 'error');

            const { error } = await db.from('payments').insert({
                workspace_id: wsId,
                student_id: studentId,
                amount,
                date,
                comment,
                received_by_name: receivedBy,
                created_by: Auth.currentUser.id
            });

            if (error) return showToast(error.message, 'error');

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
            document.getElementById('payment-form').reset();
            document.getElementById('pay-date').value = todayStr();
            document.getElementById('pay-quick-btns').style.display = 'none';
            Router.resolve();
        });
    },

    async printReceipt(paymentId) {
        const { data: p } = await db.from('payments')
            .select('*, students(name)')
            .eq('id', paymentId)
            .single();

        if (!p) return;

        const receiptWindow = window.open('', '_blank', 'width=400,height=500');
        receiptWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Payment Receipt</title>
                <style>
                    body { font-family: -apple-system, sans-serif; padding: 40px; max-width: 400px; margin: 0 auto; }
                    h1 { font-size: 20px; text-align: center; margin-bottom: 24px; }
                    .line { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
                    .line:last-child { border: none; }
                    .label { color: #666; }
                    .value { font-weight: 600; }
                    .total { font-size: 24px; text-align: center; margin: 24px 0; color: #10b981; }
                    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 32px; }
                    @media print { body { padding: 20px; } }
                </style>
            </head>
            <body>
                <h1>Payment Receipt</h1>
                <div class="line"><span class="label">Student</span><span class="value">${p.students?.name}</span></div>
                <div class="line"><span class="label">Date</span><span class="value">${formatDate(p.date)}</span></div>
                <div class="line"><span class="label">Received By</span><span class="value">${p.received_by_name || '—'}</span></div>
                <div class="line"><span class="label">Comment</span><span class="value">${p.comment || '—'}</span></div>
                <div class="total">R ${Number(p.amount).toFixed(2)}</div>
                <div class="footer">
                    ${Auth.currentWorkspace?.name || 'Tuition Tracker'}<br>
                    Generated ${new Date().toLocaleString()}
                </div>
                <script>window.print();</script>
            </body>
            </html>
        `);
    }
};
