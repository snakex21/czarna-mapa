// =============================================================================
// EDYTOR-GENEALOGIA.JS — CRUD dla osób w genealogii
// =============================================================================

const EdytorGenealogiaView = {
    osoby: [],
    edytowana: null,

    async init() {
        const content = document.getElementById('edytor-genealogia-content');
        content.innerHTML = `
            <div class="search-bar" style="padding:0 0 16px 0;">
                <input type="text" id="genealogy-editor-search" placeholder="Szukaj osoby...">
            </div>
            <div id="genealogy-editor-list"></div>`;

        document.getElementById('genealogy-editor-search').addEventListener('input', (e) => {
            this.szukaj(e.target.value);
        });

        document.getElementById('btn-dodaj-osobe').onclick = () => this.pokazFormularz();

        await this.laduj('');
    },

    async laduj(query) {
        try {
            const drzewo = await API.genealogia.pobierzDrzewo();
            this.osoby = drzewo.osoby || [];
            this.szukaj(query);
        } catch (e) {
            document.getElementById('genealogy-editor-list').innerHTML =
                `<p class="text-muted">Blad: ${e}</p>`;
        }
    },

    szukaj(query) {
        const q = query.toLowerCase().trim();
        let filtered = this.osoby;
        if (q) {
            filtered = this.osoby.filter(o =>
                o.imie_nazwisko.toLowerCase().includes(q) ||
                (o.numer_domu && o.numer_domu.includes(q))
            );
        }

        const list = document.getElementById('genealogy-editor-list');
        const limit = filtered.slice(0, 100);

        list.innerHTML = limit.map(o => `
            <div class="data-card editor-card">
                <div class="editor-card-info">
                    <strong>${o.imie_nazwisko}</strong>
                    <span class="card-meta">
                        ${o.rok_urodzenia ? `*${o.rok_urodzenia}` : ''}
                        ${o.rok_smierci ? `†${o.rok_smierci}` : ''}
                        ${o.numer_domu ? `· Dom ${o.numer_domu}` : ''}
                    </span>
                </div>
                <div class="editor-card-actions">
                    <button class="btn-small" onclick="EdytorGenealogiaView.edytuj(${o.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-small btn-danger" onclick="EdytorGenealogiaView.usun(${o.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    },

    pokazFormularz(osoba = null) {
        this.edytowana = osoba;
        const content = document.getElementById('edytor-genealogia-content');
        const o = osoba || {};

        // Opcje dla rodziców
        const opcjeOsob = this.osoby.map(p =>
            `<option value="${p.id}" ${(o.id_ojca === p.id || o.id_matki === p.id) ? 'selected' : ''}>${p.imie_nazwisko}</option>`
        ).join('');

        content.innerHTML = `
            <div class="editor-form">
                <button class="btn-back" onclick="EdytorGenealogiaView.init()">
                    <i class="fas fa-arrow-left"></i> Powrot
                </button>
                <h2>${osoba ? 'Edytuj' : 'Dodaj'} osobe</h2>

                <div class="form-group">
                    <label>Imie i nazwisko *</label>
                    <input type="text" id="f-imie" value="${this.esc(o.imie_nazwisko || '')}">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Plec</label>
                        <select id="f-plec">
                            <option value="">?</option>
                            <option value="M" ${o.plec === 'M' ? 'selected' : ''}>Mezczyzna</option>
                            <option value="K" ${o.plec === 'K' ? 'selected' : ''}>Kobieta</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Numer domu</label>
                        <input type="text" id="f-dom" value="${this.esc(o.numer_domu || '')}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Rok urodzenia</label>
                        <input type="number" id="f-urodz" value="${o.rok_urodzenia || ''}">
                    </div>
                    <div class="form-group">
                        <label>Rok smierci</label>
                        <input type="number" id="f-smierc" value="${o.rok_smierci || ''}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Ojciec</label>
                        <select id="f-ojciec">
                            <option value="">Brak</option>
                            ${opcjeOsob}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Matka</label>
                        <select id="f-matka">
                            <option value="">Brak</option>
                            ${opcjeOsob}
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Uwagi</label>
                    <textarea id="f-uwagi" rows="3">${this.esc(o.uwagi || '')}</textarea>
                </div>

                <button class="btn-primary" onclick="EdytorGenealogiaView.zapisz()">
                    <i class="fas fa-save"></i> Zapisz
                </button>
            </div>`;
    },

    esc(s) {
        if (!s) return '';
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },

    async zapisz() {
        const get = (id) => document.getElementById(id)?.value;

        const o = {
            id: this.edytowana?.id || null,
            json_id: this.edytowana?.json_id || Math.floor(Math.random() * 100000),
            imie_nazwisko: get('f-imie') || '',
            plec: get('f-plec') || null,
            numer_domu: get('f-dom') || null,
            rok_urodzenia: get('f-urodz') ? parseInt(get('f-urodz')) : null,
            rok_smierci: get('f-smierc') ? parseInt(get('f-smierc')) : null,
            id_ojca: get('f-ojciec') ? parseInt(get('f-ojciec')) : null,
            id_matki: get('f-matka') ? parseInt(get('f-matka')) : null,
            uwagi: get('f-uwagi') || null,
        };

        try {
            if (this.edytowana) {
                await API.genealogia.aktualizujOsobe(o);
            } else {
                await API.genealogia.dodajOsobe(o);
            }
            this.init();
        } catch (e) {
            alert(`Blad zapisu: ${e}`);
        }
    },

    async edytuj(id) {
        try {
            const drzewo = await API.genealogia.pobierzDrzewo();
            const osoba = drzewo.osoby.find(o => o.id === id);
            if (osoba) this.pokazFormularz(osoba);
        } catch (e) {
            alert(`Blad: ${e}`);
        }
    },

    async usun(id) {
        if (!confirm('Usunac te osobe?')) return;
        try {
            await API.genealogia.usunOsobe(id);
            this.init();
        } catch (e) {
            alert(`Blad: ${e}`);
        }
    },
};
