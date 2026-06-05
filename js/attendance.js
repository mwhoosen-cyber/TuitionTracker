const Attendance = {
    selectedClass: null,
    selectedDate: null,
    selectedHours: 1,
    statuses: {},

    async render(el) {
        const wsId = getWorkspaceId();
        el.innerHTML = '<div class="spinner"></div>';

        const { data: classes } = await db.from('classes')
            .select('id, name, day_of_week, rate, rate_type')
            .eq('workspace_id', wsId)
            .eq('archived', false)
            .order('name');

        if (!this.selectedDate) this.selectedDate = todayStr();

        el.innerHTML = `
            <div class="card mb-24">
                <div class="card-header">
                    <h3>Mark Attendance</h3>
                </div>
                <div class="filter-bar">
                    <div class="form-group" style="min-width:200px">
                        <label>Class</label>
                        <select id="att-class">
                            <option value="">Select class...</option>
                            ${(classes || []).map(c => `<option value="${c.id}" data-rate="${c.rate}" ${c.id === this.selectedClass ? 'selected' : ''}>${c.name} (${c.day_of_week || 'Any day'})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" style="min-width:180px">
                        <label>Date</label>
                        <input type="date" id="att-date" value="${this.selectedDate}">
                    </div>
                    <div class="form-group" style="min-width:160px">
                        <label>Lesson Duration</label>
                        <div class="duration-picker">
                            <select id="att-hours">
                                <option value="0.5" ${this.selectedHours === 0.5 ? 'selected' : ''}>0.5 hrs</option>
                                <option value="1" ${this.selectedHours === 1 ? 'selected' : ''}>1 hr</option>
                                <option value="1.5" ${this.selectedHours === 1.5 ? 'selected' : ''}>1.5 hrs</option>
                                <option value="2" ${this.selectedHours === 2 ? 'selected' : ''}>2 hrs</option>
                                <option value="2.5" ${this.selectedHours === 2.5 ? 'selected' : ''}>2.5 hrs</option>
                                <option value="3" ${this.selectedHours === 3 ? 'selected' : ''}>3 hrs</option>
                            </select>
                        </div>
                    </div>
                    <div style="align-self:flex-end">
                        <button class="btn btn-sm btn-secondary" id="btn-mark-all">Mark All Present</button>
                    </div>
                </div>
                <div id="att-rate-info" class="text-muted text-sm mb-16" style="display:none"></div>
                <div id="attendance-list">
                    ${!this.selectedClass ? '<p class="text-muted text-center">Select a class to mark attendance.</p>' : '<div class="spinner"></div>'}
                </div>
                <div id="att-actions" style="display:none;margin-top:16px">
                    <button class="btn btn-primary btn-full" id="btn-save-attendance">Save Attendance</button>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3>Recent Attendance</h3>
                </div>
                <div id="recent-attendance"><div class="spinner"></div></div>
            </div>
        `;

        const classSelect = document.getElementById('att-class');
        const hoursSelect = document.getElementById('att-hours');

        const updateRateInfo = () => {
            const infoEl = document.getElementById('att-rate-info');
            const opt = classSelect.selectedOptions[0];
            const rate = parseFloat(opt?.dataset?.rate || 0);
            const hours = parseFloat(hoursSelect.value);
            if (rate > 0 && this.selectedClass) {
                const charge = rate * hours;
                infoEl.style.display = 'block';
                infoEl.innerHTML = `Rate: <strong>${formatCurrency(rate)}/hr</strong> × <strong>${hours} hr${hours !== 1 ? 's' : ''}</strong> = <strong>${formatCurrency(charge)}</strong> per student`;
            } else {
                infoEl.style.display = 'none';
            }
        };

        classSelect.addEventListener('change', (e) => {
            this.selectedClass = e.target.value;
            updateRateInfo();
            if (this.selectedClass) this.loadStudents();
        });

        document.getElementById('att-date').addEventListener('change', (e) => {
            this.selectedDate = e.target.value;
            if (this.selectedClass) this.loadStudents();
        });

        hoursSelect.addEventListener('change', (e) => {
            this.selectedHours = parseFloat(e.target.value);
            updateRateInfo();
        });

        document.getElementById('btn-mark-all').addEventListener('click', () => {
            Object.keys(this.statuses).forEach(sid => this.statuses[sid] = 'present');
            this.renderStatuses();
        });

        document.getElementById('btn-save-attendance').addEventListener('click', () => this.saveAttendance());

        if (this.selectedClass) {
            this.loadStudents();
            updateRateInfo();
        }
        this.loadRecentAttendance();
    },

    async loadStudents() {
        const listEl = document.getElementById('attendance-list');
        const actionsEl = document.getElementById('att-actions');
        listEl.innerHTML = '<div class="spinner"></div>';

        const { data: enrollments } = await db.from('class_students')
            .select('student_id, students(id, name)')
            .eq('class_id', this.selectedClass);

        const students = (enrollments || []).map(e => e.students).filter(Boolean);

        if (students.length === 0) {
            listEl.innerHTML = '<p class="text-muted text-center">No students enrolled in this class. Go to Classes > Roster to add students.</p>';
            actionsEl.style.display = 'none';
            return;
        }

        // Check existing attendance for this date
        const { data: existing } = await db.from('attendance')
            .select('student_id, status, lesson_hours')
            .eq('class_id', this.selectedClass)
            .eq('date', this.selectedDate);

        const existingMap = {};
        (existing || []).forEach(a => {
            existingMap[a.student_id] = a.status;
            // Restore previously saved hours
            if (a.lesson_hours) this.selectedHours = parseFloat(a.lesson_hours);
        });

        // Update hours dropdown to match existing
        const hoursSelect = document.getElementById('att-hours');
        if (hoursSelect) hoursSelect.value = this.selectedHours;

        this.statuses = {};
        students.forEach(s => {
            this.statuses[s.id] = existingMap[s.id] || 'present';
        });

        listEl.innerHTML = `
            <div class="attendance-grid" id="att-grid">
                ${students.map(s => `
                    <div class="attendance-row" data-student="${s.id}">
                        <span class="student-name">${s.name}</span>
                        <div class="attendance-toggle">
                            <button data-status="present" class="${this.statuses[s.id] === 'present' ? 'present' : ''}" onclick="Attendance.toggleStatus('${s.id}', 'present')">Present</button>
                            <button data-status="absent" class="${this.statuses[s.id] === 'absent' ? 'absent' : ''}" onclick="Attendance.toggleStatus('${s.id}', 'absent')">Absent</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        actionsEl.style.display = 'block';
    },

    toggleStatus(studentId, status) {
        this.statuses[studentId] = status;
        this.renderStatuses();
    },

    renderStatuses() {
        document.querySelectorAll('.attendance-row').forEach(row => {
            const sid = row.dataset.student;
            const status = this.statuses[sid];
            row.querySelectorAll('.attendance-toggle button').forEach(btn => {
                const btnStatus = btn.dataset.status;
                btn.className = btnStatus === status ? status : '';
            });
        });
    },

    async saveAttendance() {
        const wsId = getWorkspaceId();
        const classId = this.selectedClass;
        const date = this.selectedDate;
        const hours = this.selectedHours;

        const { data: classData } = await db.from('classes')
            .select('name, rate, rate_type')
            .eq('id', classId)
            .single();

        // Clear previous attendance and ledger for this class+date
        await db.from('attendance')
            .delete()
            .eq('class_id', classId)
            .eq('date', date);

        await db.from('student_ledger')
            .delete()
            .eq('ref_type', 'attendance')
            .eq('date', date)
            .in('student_id', Object.keys(this.statuses));

        const attendanceRows = Object.entries(this.statuses).map(([studentId, status]) => ({
            class_id: classId,
            student_id: studentId,
            date,
            status,
            lesson_hours: hours,
            created_by: Auth.currentUser.id
        }));

        const { error } = await db.from('attendance').insert(attendanceRows);
        if (error) return showToast(error.message, 'error');

        const presentStudents = Object.entries(this.statuses)
            .filter(([, s]) => s === 'present')
            .map(([sid]) => sid);

        if (presentStudents.length > 0 && classData) {
            const charge = classData.rate * hours;
            const ledgerRows = presentStudents.map(studentId => ({
                workspace_id: wsId,
                student_id: studentId,
                date,
                description: `${classData.name} — ${hours} hr${hours !== 1 ? 's' : ''} @ ${formatCurrency(classData.rate)}/hr (${formatDate(date)})`,
                debit: charge,
                credit: 0,
                ref_type: 'attendance',
                ref_id: classId
            }));

            await db.from('student_ledger').insert(ledgerRows);
        }

        const charge = classData ? classData.rate * hours : 0;
        showToast(`Attendance saved — ${presentStudents.length} present × ${hours} hrs = ${formatCurrency(charge)} each`);
        this.loadRecentAttendance();
    },

    async loadRecentAttendance() {
        const wsId = getWorkspaceId();
        const container = document.getElementById('recent-attendance');
        if (!container) return;

        const { data } = await db.from('attendance')
            .select('date, status, lesson_hours, class_id, classes(name, rate), students(name)')
            .order('date', { ascending: false })
            .limit(30);

        if (!data || data.length === 0) {
            container.innerHTML = '<p class="text-muted text-center">No attendance records yet.</p>';
            return;
        }

        const grouped = {};
        data.forEach(a => {
            const key = `${a.date}_${a.class_id}`;
            if (!grouped[key]) {
                grouped[key] = {
                    date: a.date,
                    className: a.classes?.name,
                    rate: a.classes?.rate || 0,
                    hours: a.lesson_hours || 1,
                    present: 0,
                    absent: 0
                };
            }
            if (a.status === 'present') grouped[key].present++;
            else grouped[key].absent++;
        });

        container.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Date</th><th>Class</th><th>Duration</th><th>Charge/Student</th><th>Present</th><th>Absent</th></tr></thead>
                    <tbody>
                        ${Object.values(grouped).map(g => `
                            <tr>
                                <td>${formatDate(g.date)}</td>
                                <td>${g.className || '—'}</td>
                                <td>${g.hours} hr${g.hours !== 1 ? 's' : ''}</td>
                                <td class="font-bold">${formatCurrency(g.rate * g.hours)}</td>
                                <td><span class="badge badge-success">${g.present}</span></td>
                                <td><span class="badge badge-danger">${g.absent}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
};
