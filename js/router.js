const Router = {
    routes: {},
    currentRoute: null,

    register(hash, renderFn) {
        this.routes[hash] = renderFn;
    },

    navigate(hash) {
        window.location.hash = hash;
    },

    getParams() {
        const hash = window.location.hash.slice(1);
        const parts = hash.split('/');
        return { page: parts[0] || 'login', id: parts[1] || null };
    },

    async resolve() {
        const { page, id } = this.getParams();
        const content = document.getElementById('main-content');
        const renderFn = this.routes[page];

        if (!renderFn) {
            Router.navigate('dashboard');
            return;
        }

        this.currentRoute = page;
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });

        try {
            await renderFn(content, id);
        } catch (err) {
            content.innerHTML = `<div class="error-card"><h2>Error</h2><p>${err.message}</p></div>`;
            console.error('Route error:', err);
        }
    },

    started: false,

    init() {
        if (this.started) return;
        this.started = true;
        window.addEventListener('hashchange', () => this.resolve());
        if (!window.location.hash) {
            window.location.hash = '#login';
        }
        this.resolve();
    }
};
