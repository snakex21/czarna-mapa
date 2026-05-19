// =============================================================================
// ROUTER.JS — Client-side routing między widokami
// =============================================================================

const Router = {
    currentView: 'mapa',

    init() {
        // Obsługa kliknięć w sidebar
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                this.navigate(view);
            });
        });
    },

    navigate(view) {
        // Ukryj wszystkie widoki
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

        // Pokaż wybrany
        const target = document.getElementById(`view-${view}`);
        if (target) {
            target.classList.add('active');
        }

        // Aktualizuj sidebar
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === view);
        });

        this.currentView = view;

        // Zainicjalizuj widok jeśli trzeba
        this.initView(view);
    },

    initView(view) {
        switch(view) {
            case 'mapa':
                // Oryginalna mapa ma wlasny system inicjalizacji
                if (typeof initMapIfNeeded !== 'undefined') initMapIfNeeded();
                // Odswiez mape po zmianie widoku
                setTimeout(() => { if (typeof map !== 'undefined' && map) map.invalidateSize(); }, 100);
                break;
            case 'wlasciciele':
                if (typeof WlascicieleView !== 'undefined') WlascicieleView.init();
                break;
            case 'genealogia':
                if (typeof GenealogiaView !== 'undefined') GenealogiaView.init();
                break;
            case 'demografia':
                if (typeof DemografiaView !== 'undefined') DemografiaView.init();
                break;
            case 'protokoly':
                if (typeof ProtokolyView !== 'undefined') ProtokolyView.init();
                break;
            case 'edytor-wlasciciele':
                if (typeof EdytorWlascicieleView !== 'undefined') EdytorWlascicieleView.init();
                break;
            case 'edytor-genealogia':
                if (typeof EdytorGenealogiaView !== 'undefined') EdytorGenealogiaView.init();
                break;
        }
    }
};
