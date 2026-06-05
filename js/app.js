// Utility functions
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function openModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

function formatCurrency(amount) {
    return 'R ' + Number(amount || 0).toFixed(2);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function todayStr() {
    return new Date().toISOString().split('T')[0];
}

const pageTitles = {
    dashboard: 'Dashboard',
    classes: 'Classes',
    students: 'Students',
    attendance: 'Attendance',
    payments: 'Payments',
    settlement: 'Monthly Settlement',
    student: 'Student Account'
};

// Main App
const App = {
    realtimeChannel: null,

    init() {
        Auth.init();

        // Register routes
        Router.register('login', () => {});
        Router.register('dashboard', (el) => Dashboard.render(el));
        Router.register('classes', (el) => Classes.render(el));
        Router.register('students', (el) => Students.render(el));
        Router.register('attendance', (el) => Attendance.render(el));
        Router.register('student', (el, id) => Ledger.render(el, id));
        Router.register('payments', (el) => Payments.render(el));
        Router.register('settlement', (el) => Settlement.render(el));

        // Sidebar toggle
        document.getElementById('menu-toggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
            this.toggleOverlay(true);
        });

        document.getElementById('sidebar-close').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('open');
            this.toggleOverlay(false);
        });

        // Dark mode
        document.getElementById('btn-dark-mode').addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
            localStorage.setItem('theme', isDark ? 'light' : 'dark');
        });

        if (localStorage.getItem('theme') === 'dark' ||
            (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }

        // Logout
        document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

        // Update page title on route change
        const origResolve = Router.resolve.bind(Router);
        Router.resolve = async function() {
            await origResolve();
            const { page } = Router.getParams();
            document.getElementById('page-title').textContent = pageTitles[page] || 'Dashboard';
            // Close sidebar on mobile after navigation
            document.getElementById('sidebar').classList.remove('open');
            App.toggleOverlay(false);
        };

        // Close modal on overlay click
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeModal();
        });

        // Always initialize the router (registers hashchange listener)
        Router.init();

        // Check existing session
        Auth.checkSession();
    },

    toggleOverlay(show) {
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            document.body.appendChild(overlay);
            overlay.addEventListener('click', () => {
                document.getElementById('sidebar').classList.remove('open');
                this.toggleOverlay(false);
            });
        }
        overlay.classList.toggle('active', show);
    },

    initRealtime() {
        if (this.realtimeChannel) {
            db.removeChannel(this.realtimeChannel);
        }

        this.realtimeChannel = db.channel('workspace-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
                if (Router.currentRoute === 'attendance' || Router.currentRoute === 'dashboard') Router.resolve();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
                if (Router.currentRoute === 'payments' || Router.currentRoute === 'dashboard' || Router.currentRoute === 'student') Router.resolve();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'student_ledger' }, () => {
                if (Router.currentRoute === 'student' || Router.currentRoute === 'dashboard') Router.resolve();
            })
            .subscribe();
    }
};

// Dashboard
const Dashboard = {
    async render(el) {
        const wsId = getWorkspaceId();
        el.innerHTML = '<div class="spinner"></div>';

        const [classRes, studentRes, ledgerRes, paymentRes] = await Promise.all([
            db.from('classes').select('*').eq('workspace_id', wsId).eq('archived', false),
            db.from('students').select('*').eq('workspace_id', wsId),
            db.from('student_ledger').select('*').eq('workspace_id', wsId),
            db.from('payments').select('*').eq('workspace_id', wsId)
        ]);

        const classes = classRes.data || [];
        const students = studentRes.data || [];
        const ledger = ledgerRes.data || [];
        const payments = paymentRes.data || [];

        const balances = {};
        students.forEach(s => balances[s.id] = 0);
        ledger.forEach(entry => {
            if (balances[entry.student_id] !== undefined) {
                balances[entry.student_id] += (entry.debit || 0) - (entry.credit || 0);
            }
        });

        const totalOutstanding = Object.values(balances).reduce((sum, b) => sum + Math.max(0, b), 0);
        const totalRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const studentsWithBalance = Object.values(balances).filter(b => b > 0.01).length;

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const monthPayments = payments.filter(p => p.date >= monthStart);
        const monthRevenue = monthPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

        el.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon purple">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    </div>
                    <div class="stat-info">
                        <h4>${classes.length}</h4>
                        <p>Active Classes</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon green">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                    </div>
                    <div class="stat-info">
                        <h4>${students.length}</h4>
                        <p>Total Students</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon orange">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    </div>
                    <div class="stat-info">
                        <h4>${formatCurrency(monthRevenue)}</h4>
                        <p>Revenue This Month</p>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon red">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </div>
                    <div class="stat-info">
                        <h4>${formatCurrency(totalOutstanding)}</h4>
                        <p>${studentsWithBalance} Student${studentsWithBalance !== 1 ? 's' : ''} Outstanding</p>
                    </div>
                </div>
            </div>

            <div class="card mb-24">
                <div class="card-header">
                    <h3>Quick Actions</h3>
                </div>
                <div class="quick-actions">
                    <button class="quick-action-btn" onclick="Router.navigate('attendance')">+ Mark Attendance</button>
                    <button class="quick-action-btn" onclick="Router.navigate('payments')">+ Log Payment</button>
                    <button class="quick-action-btn" onclick="Router.navigate('classes')">+ Add Class</button>
                    <button class="quick-action-btn" onclick="Router.navigate('students')">+ Add Student</button>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3>Outstanding Balances</h3>
                </div>
                ${studentsWithBalance === 0 ? '<p class="text-muted text-center">All students are up to date!</p>' : `
                <div class="table-wrapper">
                    <table>
                        <thead><tr><th>Student</th><th>Balance</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                            ${students.filter(s => (balances[s.id] || 0) > 0.01).sort((a,b) => (balances[b.id] || 0) - (balances[a.id] || 0)).map(s => `
                                <tr class="clickable" onclick="Router.navigate('student/${s.id}')">
                                    <td>${s.name}</td>
                                    <td class="debit font-bold">${formatCurrency(balances[s.id])}</td>
                                    <td><span class="badge ${balances[s.id] > 500 ? 'badge-danger' : 'badge-warning'}">${balances[s.id] > 500 ? 'Overdue' : 'Pending'}</span></td>
                                    <td><button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); Router.navigate('payments')">Pay</button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                `}
            </div>
        `;
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => App.init());
