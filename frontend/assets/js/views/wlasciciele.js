// =============================================================================
// WLASCICIELE.JS — Widok listy właścicieli
// =============================================================================

const WlascicieleView = {
    async init() {
        const searchInput = document.getElementById('wlasciciele-search');
        searchInput.addEventListener('input', () => this.szukaj(searchInput.value));

        await this.szukaj('');
    },

    async szukaj(query) {
        const lista = document.getElementById('wlasciciele-list');
        lista.innerHTML = '<div class="loading">Ładowanie...</div>';

        const wlasciciele = query
            ? await API.wlasciciele.szukaj(query)
            : await API.wlasciciele.pobierzWszystkich();

        if (wlasciciele.length === 0) {
            lista.innerHTML = '<p class="text-muted">Brak wyników</p>';
            return;
        }

        lista.innerHTML = wlasciciele.map(w => `
            <div class="data-card" data-id="${w.id}">
                <h3>${w.nazwa_wlasciciela}</h3>
                <div class="card-meta">
                    ${w.numer_protokolu ? `<span>Protokół nr ${w.numer_protokolu}</span>` : ''}
                    ${w.numer_domu ? `<span>Dom nr ${w.numer_domu}</span>` : ''}
                    ${w.miejsce_protokolu ? `<span>${w.miejsce_protokolu}</span>` : ''}
                </div>
                ${w.historia_wlasnosci ? `<p class="card-desc">${w.historia_wlasnosci.substring(0, 200)}...</p>` : ''}
            </div>
        `).join('');

        // Kliknięcie rozwija szczegóły
        lista.querySelectorAll('.data-card').forEach(card => {
            card.addEventListener('click', async () => {
                const id = parseInt(card.dataset.id);
                const wlasciciel = await API.wlasciciele.pobierz(id);
                this.pokazSzczegoly(wlasciciel);
            });
        });
    },

    pokazSzczegoly(wlasciciel) {
        if (!wlasciciel) return;

        const lista = document.getElementById('wlasciciele-list');
        lista.innerHTML = `
            <div class="detail-view">
                <button class="btn-back" onclick="WlascicieleView.szukaj('')">
                    <i class="fas fa-arrow-left"></i> Powrót
                </button>
                <h2>${wlasciciel.nazwa_wlasciciela}</h2>
                <div class="detail-grid">
                    ${wlasciciel.numer_protokolu ? `<div><strong>Protokół:</strong> ${wlasciciel.numer_protokolu}</div>` : ''}
                    ${wlasciciel.numer_domu ? `<div><strong>Dom:</strong> ${wlasciciel.numer_domu}</div>` : ''}
                    ${wlasciciel.data_protokolu ? `<div><strong>Data:</strong> ${wlasciciel.data_protokolu}</div>` : ''}
                    ${wlasciciel.miejsce_protokolu ? `<div><strong>Miejsce:</strong> ${wlasciciel.miejsce_protokolu}</div>` : ''}
                </div>
                ${wlasciciel.historia_wlasnosci ? `<section><h3>Historia własności</h3><p>${wlasciciel.historia_wlasnosci}</p></section>` : ''}
                ${wlasciciel.genealogia ? `<section><h3>Genealogia</h3><p>${wlasciciel.genealogia}</p></section>` : ''}
                ${wlasciciel.uwagi ? `<section><h3>Uwagi</h3><p>${wlasciciel.uwagi}</p></section>` : ''}
                ${wlasciciel.interpretacja_i_wnioski ? `<section><h3>Wnioski</h3><p>${wlasciciel.interpretacja_i_wnioski}</p></section>` : ''}
            </div>
        `;
    },
};
