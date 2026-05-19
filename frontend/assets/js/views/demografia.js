// =============================================================================
// DEMOGRAFIA.JS — Widok danych demograficznych
// =============================================================================

const DemografiaView = {
    async init() {
        const container = document.getElementById('demografia-content');
        container.innerHTML = '<div class="loading">Ładowanie...</div>';

        const dane = await API.demografia.pobierz();

        if (!dane || dane.length === 0) {
            container.innerHTML = '<p class="text-muted">Brak danych demograficznych</p>';
            return;
        }

        container.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Rok</th>
                        <th>Populacja</th>
                        <th>Katolicy</th>
                        <th>Żydzi</th>
                        <th>Inni</th>
                        <th>Opis</th>
                    </tr>
                </thead>
                <tbody>
                    ${dane.map(d => `
                        <tr>
                            <td>${d.rok}</td>
                            <td>${d.populacja_ogolem || '-'}</td>
                            <td>${d.katolicy || '-'}</td>
                            <td>${d.zydzi || '-'}</td>
                            <td>${d.inni || '-'}</td>
                            <td>${d.opis || ''}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    },
};
