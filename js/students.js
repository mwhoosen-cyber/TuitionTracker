const Students = {
    async render(el) {
        const wsId = getWorkspaceId();
        el.innerHTML = '<div class="spinner"></div>';

        const [studentsRes, ledgerRes] = await Promise.all([
            db.from('students').select('*').eq('workspace_id', wsId).order('name'),
            db.from('student_ledger').select('student_id, debit, credit').eq('workspace_id', wsId)
        ]);

        const students = studentsRes.data || [];
        const ledger = ledgerRes.data || [];

        const balances = {};
        students.forEach(s => balances[s.id] = 0);
        ledger.forEach(e => {
            if (balances[e.student_id] !== undefined) {
                balances[e.student_id] += (e.debit || 0) - (e.credit || 0);
            }
        });

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <div class="search-bar" style="flex:1;max-width:300px">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input type="text" id="student-search" placeholder="Search students...">
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="Students.openAddModal()">+ Add Student</button>
                </div>
                ${students.length === 0 ? `
                    <div class="empty-state">
                        <h3>No students yet</h3>
                        <p>Add your first student to begin tracking.</p>
                        <button class="btn btn-primary" onclick="Students.openAddModal()">+ Add Student</button>
                    </div>
                ` : `
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Payment Type</th>
                                    <th>Balance</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="students-tbody">
                                ${students.map(s => this.renderRow(s, balances[s.id] || 0)).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;

        document.getElementById('student-search')?.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            const tbody = document.getElementById('students-tbody');
            if (!tbody) return;
            tbody.innerHTML = students
                .filter(s => s.name.toLowerCase().includes(q))
                .map(s => this.renderRow(s, balances[s.id] || 0))
                .join('');
        });
    },

    renderRow(s, balance) {
        const statusClass = balance > 0.01 ? (balance > 500 ? 'danger' : 'warning') : 'success';
        const statusText = balance > 0.01 ? (balance > 500 ? 'Overdue' : 'Pending') : 'Paid';
        return `
            <tr class="clickable" onclick="Router.navigate('student/${s.id}')">
                <td class="font-bold">${s.name}</td>
                <td><span class="badge badge-info">${s.payment_type === 'per_month' ? 'Monthly' : 'Per Lesson'}</span></td>
                <td class="${balance > 0.01 ? 'debit' : 'credit'} font-bold">${formatCurrency(balance)}</td>
                <td><span class="badge badge-${statusClass}">${statusText}</span></td>
                <td>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); Students.openEditModal('${s.id}')">Edit</button>
                    </div>
                </td>
            </tr>
        `;
    },

    openAddModal() {
        openModal('Add Student', `
            <form id="student-form">
                <div class="form-group">
                    <label>Student Name</label>
                    <input type="text" id="student-name" required placeholder="Full name">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" id="student-email" placeholder="Optional">
                    </div>
                    <div class="form-group">
                        <label>Phone</label>
                        <input type="tel" id="student-phone" placeholder="Optional">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Payment Type</label>
                        <select id="student-payment-type">
                            <option value="per_lesson">Per Lesson</option>
                            <option value="per_month">Per Month</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Monthly Rate (R)</label>
                        <input type="number" id="student-monthly-rate" step="0.01" min="0" value="0" placeholder="For monthly students">
                    </div>
                </div>
                <button type="submit" class="btn btn-primary btn-full">Save Student</button>
            </form>
        `);

        document.getElementById('student-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveStudent();
        });
    },

    async saveStudent(editId = null) {
        const wsId = getWorkspaceId();
        const data = {
            workspace_id: wsId,
            name: document.getElementById('student-name').value,
            email: document.getElementById('student-email').value,
            phone: document.getElementById('student-phone').value,
            payment_type: document.getElementById('student-payment-type').value,
            monthly_rate: parseFloat(document.getElementById('student-monthly-rate').value) || 0
        };

        if (editId) {
            const { error } = await db.from('students').update(data).eq('id', editId);
            if (error) return showToast(error.message, 'error');
            showToast('Student updated');
        } else {
            const { error } = await db.from('students').insert(data);
            if (error) return showToast(error.message, 'error');
            showToast('Student added');
        }

        closeModal();
        Router.resolve();
    },

    async openEditModal(id) {
        const { data: s } = await db.from('students').select().eq('id', id).single();
        if (!s) return;

        openModal('Edit Student', `
            <form id="student-form">
                <div class="form-group">
                    <label>Student Name</label>
                    <input type="text" id="student-name" required value="${s.name}">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" id="student-email" value="${s.email || ''}">
                    </div>
                    <div class="form-group">
                        <label>Phone</label>
                        <input type="tel" id="student-phone" value="${s.phone || ''}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Payment Type</label>
                        <select id="student-payment-type">
                            <option value="per_lesson" ${s.payment_type === 'per_lesson' ? 'selected' : ''}>Per Lesson</option>
                            <option value="per_month" ${s.payment_type === 'per_month' ? 'selected' : ''}>Per Month</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Monthly Rate (R)</label>
                        <input type="number" id="student-monthly-rate" step="0.01" min="0" value="${s.monthly_rate || 0}">
                    </div>
                </div>
                <div class="btn-group" style="margin-top:8px">
                    <button type="submit" class="btn btn-primary" style="flex:1">Update Student</button>
                    <button type="button" class="btn btn-danger" onclick="Students.deleteStudent('${s.id}')">Delete</button>
                </div>
            </form>
        `);

        document.getElementById('student-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveStudent(id);
        });
    },

    async deleteStudent(id) {
        if (!confirm('Delete this student? All attendance and payment records will be lost.')) return;
        await db.from('students').delete().eq('id', id);
        closeModal();
        showToast('Student deleted');
        Router.resolve();
    }
};
