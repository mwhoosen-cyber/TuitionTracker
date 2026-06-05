const Auth = {
    currentUser: null,
    currentProfile: null,
    currentWorkspace: null,

    init() {
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
    },

    showError(msg) {
        const el = document.getElementById('auth-error');
        el.textContent = msg;
        el.style.display = 'block';
    },

    clearError() {
        document.getElementById('auth-error').style.display = 'none';
    },

    async handleLogin(e) {
        e.preventDefault();
        this.clearError();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        const { data, error } = await db.auth.signInWithPassword({ email, password });
        if (error) return this.showError(error.message);

        this.currentUser = data.user;
        await this.ensureProfileAndWorkspace();
    },

    async ensureProfileAndWorkspace() {
        // Auto-create profile if missing
        const { data: profile } = await db.from('profiles')
            .select()
            .eq('id', this.currentUser.id)
            .single();

        if (!profile) {
            await db.from('profiles').upsert({
                id: this.currentUser.id,
                full_name: 'Admin',
                email: this.currentUser.email
            });
            this.currentProfile = { id: this.currentUser.id, full_name: 'Admin', email: this.currentUser.email };
        } else {
            this.currentProfile = profile;
        }

        // Auto-create workspace if none exists
        const { data: membership } = await db.from('workspace_members')
            .select('workspace_id')
            .eq('user_id', this.currentUser.id)
            .limit(1)
            .single();

        if (!membership) {
            const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const { data: ws, error } = await db.from('workspaces').insert({
                name: 'Tuition Centre',
                invite_code: inviteCode,
                split_ratio: 50,
                created_by: this.currentUser.id
            }).select().single();

            if (error) {
                this.showError('Failed to create workspace: ' + error.message);
                return;
            }

            await db.from('workspace_members').insert({
                workspace_id: ws.id,
                user_id: this.currentUser.id,
                role: 'owner'
            });

            setWorkspaceId(ws.id);
            this.currentWorkspace = ws;
        } else {
            const { data: ws } = await db.from('workspaces')
                .select()
                .eq('id', membership.workspace_id)
                .single();

            setWorkspaceId(ws.id);
            this.currentWorkspace = ws;
        }

        this.enterApp();
    },

    enterApp() {
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        document.getElementById('workspace-display-name').textContent = this.currentWorkspace.name;
        document.getElementById('invite-code-display').textContent = 'Code: ' + this.currentWorkspace.invite_code;
        document.getElementById('user-display').textContent = this.currentProfile?.full_name || this.currentUser.email;

        if (window.location.hash === '#login' || !window.location.hash) {
            window.location.hash = '#dashboard';
        }
        Router.resolve();
        App.initRealtime();
    },

    async logout() {
        await db.auth.signOut();
        localStorage.removeItem('workspace_id');
        this.currentUser = null;
        this.currentProfile = null;
        this.currentWorkspace = null;
        document.getElementById('app').style.display = 'none';
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('login-form').style.display = 'flex';
        window.location.hash = '#login';
    },

    async checkSession() {
        // Always require manual login — clear any existing session
        await db.auth.signOut();
        return false;
    }
};
