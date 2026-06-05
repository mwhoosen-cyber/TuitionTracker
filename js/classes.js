const Classes = {
    showArchived: false,

    async render(el) {
        const wsId = getWorkspaceId();
        el.innerHTML = '<div class="spinner"></div>';

        let query = db.from('classes').select('*, class_students(student_id)').eq('workspace_id', wsId);
        if (!this.showArchived) query = query.eq('archived', false);
        const { data: classes } = await query.order('name');

        el.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h3>Classes</h3>
                    <div class="btn-group">
                        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);cursor:pointer">
                            <input type="checkbox" id="show-archived" ${this.showArchived ? 'checked' : ''}>
                            Show Archived
                        </label>
                        <button class="btn btn-primary btn-sm" onclick="Classes.openAddModal()">+ Add Class</button>
                    </div>
                </div>
                ${!classes || classes.length === 0 ? `
                    <div class="empty-state">
                        <h3>No classes yet</h3>
                        <p>Create your first class to get started.</p>
                        <button class="btn btn-primary" onclick="Classes.openAddModal()">+ Add Class</button>
                    </div>
                ` : `
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Day</th>
                                    <th>Time</th>
                                    <th>Rate</th>
                                    <th>Students</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${classes.map(c => `
                                    <tr style="${c.archived ? 'opacity:0.5' : ''}">
                                        <td class="font-bold">${c.name}</td>
                                        <td>${c.day_of_week || '—'}</td>
                                        <td>${c.time || '—'}</td>
                                        <td>${formatCurrency(c.rate)} <span class="text-muted text-sm">/${c.rate_type === 'per_month' ? 'mo' : 'lesson'}</span></td>
                                        <td><span class="badge badge-info">${c.class_students?.length || 0}</span></td>
                                        <td>
                                            <div class="btn-group">
                                                <button class="btn btn-sm btn-secondary" onclick="Classes.openEditModal('${c.id}')">Edit</button>
                                                <button class="btn btn-sm btn-secondary" onclick="Classes.openRoster('${c.id}')">Roster</button>
                                                <button class="btn btn-sm ${c.archived ? 'btn-success' : 'btn-warning'}" onclick="Classes.toggleArchive('${c.id}', ${!c.archived})">${c.archived ? 'Restore' : 'Archive'}</button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;

        document.getElementById('show-archived')?.addEventListener('change', (e) => {
            this.showArchived = e.target.checked;
            this.render(el);
        });
    },

    openAddModal() {
        openModal('Add Class', `
            <form id="class-form">
                <div class="form-group">
                    <label>Class Name</label>
                    <input type="text" id="class-name" required placeholder="e.g. Maths Grade 10">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Day</label>
                        <select id="class-day">
                            <option value="">Select day</option>
                            <option>Monday</option><option>Tuesday</option><option>Wednesday</option>
                            <option>Thursday</option><option>Friday</option><option>Saturday</option><option>Sunday</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Time</label>
                        <input type="time" id="class-time">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Rate (R)</label>
                        <input type="number" id="class-rate" step="0.01" min="0" required placeholder="150.00">
                    </div>
                    <div class="form-group">
                        <label>Rate Type</label>
                        <select id="class-rate-type">
                            <option value="per_lesson">Per Lesson</option>
                            <option value="per_month">Per Month</option>
                        </select>
                    </div>
                </div>
                <button type="submit" class="btn btn-primary btn-full">Save Class</button>
            </form>
        `);

        document.getElementById('class-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveClass();
        });
    },

    async saveClass(editId = null) {
        const wsId = getWorkspaceId();
        const data = {
            workspace_id: wsId,
            name: document.getElementById('class-name').value,
            day_of_week: document.getElementById('class-day').value,
            time: document.getElementById('class-time').value,
            rate: parseFloat(document.getElementById('class-rate').value) || 0,
            rate_type: document.getElementById('class-rate-type').value
        };

        if (editId) {
            const { error } = await db.from('classes').update(data).eq('id', editId);
            if (error) return showToast(error.message, 'error');
            showToast('Class updated');
        } else {
            const { error } = await db.from('classes').insert(data);
            if (error) return showToast(error.message, 'error');
            showToast('Class added');
        }

        closeModal();
        Router.resolve();
    },

    async openEditModal(id) {
        const { data: c } = await db.from('classes').select().eq('id', id).single();
        if (!c) return;

        openModal('Edit Class', `
            <form id="class-form">
                <div class="form-group">
                    <label>Class Name</label>
                    <input type="text" id="class-name" required value="${c.name}">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Day</label>
                        <select id="class-day">
                            <option value="">Select day</option>
                            ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d =>
                                `<option ${d === c.day_of_week ? 'selected' : ''}>${d}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Time</label>
                        <input type="time" id="class-time" value="${c.time || ''}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Rate (R)</label>
                        <input type="number" id="class-rate" step="0.01" min="0" required value="${c.rate}">
                    </div>
                    <div class="form-group">
                        <label>Rate Type</label>
                        <select id="class-rate-type">
                            <option value="per_lesson" ${c.rate_type === 'per_lesson' ? 'selected' : ''}>Per Lesson</option>
                            <option value="per_month" ${c.rate_type === 'per_month' ? 'selected' : ''}>Per Month</option>
                        </select>
                    </div>
                </div>
                <div class="btn-group" style="margin-top:8px">
                    <button type="submit" class="btn btn-primary" style="flex:1">Update Class</button>
                    <button type="button" class="btn btn-danger" onclick="Classes.deleteClass('${c.id}')">Delete</button>
                </div>
            </form>
        `);

        document.getElementById('class-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveClass(id);
        });
    },

    async toggleArchive(id, archived) {
        await db.from('classes').update({ archived }).eq('id', id);
        showToast(archived ? 'Class archived' : 'Class restored');
        Router.resolve();
    },

    async deleteClass(id) {
        if (!confirm('Delete this class? This will remove all associated data.')) return;
        await db.from('classes').delete().eq('id', id);
        closeModal();
        showToast('Class deleted');
        Router.resolve();
    },

    async openRoster(classId) {
        const wsId = getWorkspaceId();
        const [enrollRes, studentsRes, classRes] = await Promise.all([
            db.from('class_students').select('student_id').eq('class_id', classId),
            db.from('students').select('id, name').eq('workspace_id', wsId).order('name'),
            db.from('classes').select('name').eq('id', classId).single()
        ]);

        const enrolled = new Set((enrollRes.data || []).map(e => e.student_id));
        const students = studentsRes.data || [];

        openModal(`Roster — ${classRes.data?.name || 'Class'}`, `
            <p class="text-muted text-sm mb-16">Check students to enroll them in this class.</p>
            ${students.length === 0 ? '<p class="text-muted">No students yet. Add students first.</p>' : `
                <div style="display:flex;flex-direction:column;gap:8px">
                    ${students.map(s => `
                        <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg);border-radius:var(--radius);cursor:pointer">
                            <input type="checkbox" data-student="${s.id}" ${enrolled.has(s.id) ? 'checked' : ''} onchange="Classes.toggleEnrollment('${classId}', '${s.id}', this.checked)">
                            <span>${s.name}</span>
                        </label>
                    `).join('')}
                </div>
            `}
        `);
    },

    async toggleEnrollment(classId, studentId, enroll) {
        if (enroll) {
            await db.from('class_students').insert({ class_id: classId, student_id: studentId });
        } else {
            await db.from('class_students').delete().eq('class_id', classId).eq('student_id', studentId);
        }
    }
};
