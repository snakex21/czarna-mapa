// =============================================================================
// PROTOKOLY.JS — Widok protokołów katastralnych ze zdjęciami
// =============================================================================

const ProtokolyView = {
    protokoly: [],

    async init() {
        const container = document.getElementById('protokoly-content');
        container.innerHTML = '<div class="loading">Ladowanie protokolow...</div>';

        try {
            this.protokoly = await API.protokoly.pobierzListe();
            this.renderListe();
        } catch (e) {
            container.innerHTML = `<p class="text-muted">Blad: ${e}</p>`;
        }
    },

    renderListe() {
        const container = document.getElementById('protokoly-content');

        if (!this.protokoly || this.protokoly.length === 0) {
            container.innerHTML = '<p class="text-muted">Brak protokolow</p>';
            return;
        }

        container.innerHTML = this.protokoly.map((p, i) => `
            <div class="data-card protocol-card" data-index="${i}">
                <div class="protocol-card-header">
                    <h3>
                        ${p.numer_protokolu ? `Nr ${p.numer_protokolu} — ` : ''}
                        ${p.nazwa}
                    </h3>
                    ${p.zdjecia_count > 0 ? `<span class="badge">${p.zdjecia_count} zdj.</span>` : ''}
                </div>
                <div class="card-meta">
                    ${p.numer_domu ? `<span><i class="fas fa-home"></i> Dom ${p.numer_domu}</span>` : ''}
                    ${p.data_protokolu ? `<span><i class="fas fa-calendar"></i> ${p.data_protokolu}</span>` : ''}
                    ${p.miejsce_protokolu ? `<span><i class="fas fa-map-pin"></i> ${p.miejsce_protokolu}</span>` : ''}
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.protocol-card').forEach(card => {
            card.addEventListener('click', () => {
                const idx = parseInt(card.dataset.index);
                this.pokazProtokol(idx);
            });
        });
    },

    async pokazProtokol(index) {
        const p = this.protokoly[index];
        if (!p) return;

        const container = document.getElementById('protokoly-content');

        container.innerHTML = `
            <div class="detail-view">
                <button class="btn-back" onclick="ProtokolyView.renderListe()">
                    <i class="fas fa-arrow-left"></i> Powrot do listy
                </button>
                <h2>${p.numer_protokolu ? `Protokol nr ${p.numer_protokolu}` : 'Protokol'}</h2>
                <h3>${p.nazwa}</h3>
                <div class="detail-grid">
                    ${p.numer_domu ? `<div><strong>Dom:</strong> ${p.numer_domu}</div>` : ''}
                    ${p.data_protokolu ? `<div><strong>Data:</strong> ${p.data_protokolu}</div>` : ''}
                    ${p.miejsce_protokolu ? `<div><strong>Miejsce:</strong> ${p.miejsce_protokolu}</div>` : ''}
                </div>
                <div id="zdjecia-container">
                    ${p.zdjecia_count > 0 ? '<div class="loading">Ladowanie zdjec...</div>' : '<p class="text-muted">Brak zdjec</p>'}
                </div>
            </div>`;

        if (p.zdjecia_count > 0) {
            try {
                const zdjecia = await API.protokoly.ladujZdjecia(p.klucz || p.nazwa);
                this.renderZdjecia(zdjecia);
            } catch (e) {
                document.getElementById('zdjecia-container').innerHTML =
                    `<p class="text-muted">Blad ladowania zdjec: ${e}</p>`;
            }
        }
    },

    renderZdjecia(zdjecia) {
        const container = document.getElementById('zdjecia-container');
        if (!zdjecia || zdjecia.length === 0) {
            container.innerHTML = '<p class="text-muted">Brak zdjec</p>';
            return;
        }

        container.innerHTML = '<div class="photo-gallery">' +
            zdjecia.map((z, i) => `
                <div class="photo-item">
                    <img src="${z}" alt="Strona ${i+1}" loading="lazy"
                         onclick="ProtokolyView.zoomPhoto(this.src)">
                    <span>Str. ${i+1}</span>
                </div>
            `).join('') +
            '</div>';
    },

    zoomPhoto(src) {
        let overlay = document.getElementById('photo-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'photo-overlay';
            overlay.className = 'photo-overlay';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `<img src="${src}" style="max-width:90vw; max-height:90vh; cursor:zoom-out;">`;
        overlay.onclick = function() { this.remove(); };
    },
};
