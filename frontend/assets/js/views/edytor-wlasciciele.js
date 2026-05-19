// =============================================================================
// EDYTOR-WLASCICIELE.JS — CRUD dla właścicieli
// =============================================================================

const EdytorWlascicieleView = {
    wlasciciele: [],
    edytowany: null,

    async init() {
        await this.ladujListe();
    },

    async ladujListe() {
        const content = document.getElementById('edytor-wlasciciele-content');
        content.innerHTML = '<div class="loading">Ladowanie...</div>';

        try {
            this.wlasciciele = await API.wlasciciele.pobierzWszystkich();
            this.renderListe();
        } catch (e) {
            content.innerHTML = `<p class="text-muted">Blad: ${e}</p>`;
        }
    },

    renderListe() {
        const content = document.getElementById('edytor-wlasciciele-content');

        content.innerHTML = `
            <div class="editor-list">
                ${this.wlasciciele.map(w => `
                    <div class="data-card editor-card">
                        <div class="editor-card-info">
                            <strong>${w.nazwa_wlasciciela}</strong>
                            <span class="card-meta">
                                ${w.numer_protokolu ? `Prot. ${w.numer_protokolu}` : ''}
                                ${w.numer_domu ? `· Dom ${w.numer_domu}` : ''}
                            </span>
                        </div>
                        <div class="editor-card-actions">
                            <button class="btn-small" onclick="EdytorWlascicieleView.edytuj(${w.id})">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-small btn-danger" onclick="EdytorWlascicieleView.usun(${w.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>`;

        // Przycisk dodawania
        document.getElementById('btn-dodaj-wlasciciela').onclick = () => this.pokazFormularz();
    },

    pokazFormularz(wlasciciel = null) {
        this.edytowany = wlasciciel;
        const content = document.getElementById('edytor-wlasciciele-content');
        const w = wlasciciel || {};

        content.innerHTML = `
            <div class="editor-form">
                <button class="btn-back" onclick="EdytorWlascicieleView.ladujListe()">
                    <i class="fas fa-arrow-left"></i> Powrot
                </button>
                <h2>${wlasciciel ? 'Edytuj' : 'Dodaj'} wlasciciela</h2>

                <div class="form-group">
                    <label>Nazwa wlasciciela *</label>
                    <input type="text" id="f-nazwa" value="${this.esc(w.nazwa_wlasciciela || '')}">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Numer protokolu</label>
                        <input type="number" id="f-protokol" value="${w.numer_protokolu || ''}">
                    </div>
                    <div class="form-group">
                        <label>Numer domu</label>
                        <input type="text" id="f-dom" value="${this.esc(w.numer_domu || '')}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Data protokolu</label>
                        <input type="text" id="f-data" value="${this.esc(w.data_protokolu || '')}">
                    </div>
                    <div class="form-group">
                        <label>Miejsce protokolu</label>
                        <input type="text" id="f-miejsce" value="${this.esc(w.miejsce_protokolu || '')}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Genealogia</label>
                    <textarea id="f-genealogia" rows="3">${this.esc(w.genealogia || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>Historia wlasnosci</label>
                    <textarea id="f-historia" rows="4">${this.esc(w.historia_wlasnosci || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>Uwagi</label>
                    <textarea id="f-uwagi" rows="3">${this.esc(w.uwagi || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>Wspolwlasnosc</label>
                    <textarea id="f-wspolwlasnosc" rows="2">${this.esc(w.wspolwlasnosc || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>Powiazania i transakcje</label>
                    <textarea id="f-powiazania" rows="3">${this.esc(w.powiazania_i_transakcje || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>Interpretacja i wnioski</label>
                    <textarea id="f-wnioski" rows="3">${this.esc(w.interpretacja_i_wnioski || '')}</textarea>
                </div>

                <button class="btn-primary" onclick="EdytorWlascicieleView.zapisz()">
                    <i class="fas fa-save"></i> Zapisz
                </button>
            </div>`;
    },

    esc(s) {
        if (!s) return '';
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },

    async zapisz() {
        const get = (id) => document.getElementById(id)?.value || '';

        const w = {
            id: this.edytowany?.id || null,
            unikalny_klucz: this.edytowany?.unikalny_klucz || `${get('f-nazwa')}_${get('f-protokol') || '0'}`,
            nazwa_wlasciciela: get('f-nazwa'),
            numer_protokolu: get('f-protokol') ? parseInt(get('f-protokol')) : null,
            numer_domu: get('f-dom') || null,
            data_protokolu: get('f-data') || null,
            miejsce_protokolu: get('f-miejsce') || null,
            genealogia: get('f-genealogia') || null,
            historia_wlasnosci: get('f-historia') || null,
            uwagi: get('f-uwagi') || null,
            wspolwlasnosc: get('f-wspolwlasnosc') || null,
            powiazania_i_transakcje: get('f-powiazania') || null,
            interpretacja_i_wnioski: get('f-wnioski') || null,
        };

        try {
            if (this.edytowany) {
                await API.wlasciciele.aktualizuj(w);
            } else {
                await API.wlasciciele.dodaj(w);
            }
            this.ladujListe();
        } catch (e) {
            alert(`Blad zapisu: ${e}`);
        }
    },

    async edytuj(id) {
        try {
            const w = await API.wlasciciele.pobierz(id);
            if (w) this.pokazFormularz(w);
        } catch (e) {
            alert(`Blad: ${e}`);
        }
    },

    async usun(id) {
        if (!confirm('Usunac tego wlasciciela?')) return;
        try {
            await API.wlasciciele.usun(id);
            this.ladujListe();
        } catch (e) {
            alert(`Blad usuwania: ${e}`);
        }
    },
};
