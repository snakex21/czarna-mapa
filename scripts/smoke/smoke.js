// Smoke test aplikacji (wstrzykiwany tylko w buildzie -tags smoke).
// Kroki są zapisane w sessionStorage, bo skrypt startuje od nowa na każdej stronie.
(function () {
  if (window.top !== window || !window.location.origin.startsWith('http://127.0.0.1:')) return;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const st = () => JSON.parse(sessionStorage.getItem('smoke') || '{"step":0,"report":{}}');
  const save = s => sessionStorage.setItem('smoke', JSON.stringify(s));
  function showResult() {
    const el = document.getElementById('sync-result');
    el.scrollIntoView({ block: 'center' });
    el.style.outline = '3px solid #e67e22';
  }
  async function loadFileIntoInput(selector, path, name) {
    const b64 = await window.smokeReadFileB64(path);
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], name, { type: 'application/zip' }));
    document.querySelector(selector).files = dt.files;
  }
  window.addEventListener('load', async () => {
    const s = st();
    const R = s.report;
    const dialogs = [];
    window.alert = m => { dialogs.push(String(m)); };
    window.confirm = m => { dialogs.push('confirm: ' + String(m)); return true; };
    try {
      if (s.step === 0) {
        await sleep(2500);
        R.tokenInjected = typeof window.__CZARNA_RPC_TOKEN === 'string' && window.__CZARNA_RPC_TOKEN.length === 64;
        await window.smokeShot('01_strona_startowa.png');
        s.step = 1; save(s);
        location.href = '/mapa/mapa.html';
      } else if (s.step === 1) {
        await sleep(9000);
        R.mapCanvas = !!document.querySelector('canvas.maplibregl-canvas');
        R.mapFeatures = (await API._invoke('api_dzialki')).features.length;
        const res = performance.getEntriesByType('resource').map(e => e.name);
        R.maplibreLocal = res.some(n => n.includes('/assets/vendor/maplibre-gl-'));
        R.unpkgRequests = res.filter(n => n.includes('unpkg.com')).length;
        const owners = await API._invoke('pobierz_wszystkich_wlascicieli');
        const key = owners && owners.length ? owners[0].unikalny_klucz : '';
        R.scanThumbStatus = key ? (await fetch('/obj_thumb?path=' + encodeURIComponent('protokoly/' + key + '/1.jpg') + '&w=240')).status : 'brak wlascicieli';
        await window.smokeShot('02_mapa.png');
        s.step = 2; save(s);
        location.href = '/miejscowosci.html';
      } else if (s.step === 2) {
        await sleep(2500);
        page.openSyncModal();
        // v1.3: baza SQLite ma być zaznaczona domyślnie (nie zaznaczamy jej ręcznie).
        R.includeDbDefault = document.querySelector('.backup-opt[data-key="include_db"]').checked;
        // Skany pomijamy: ZIP ze skanami (~600 MB) przekracza limit importu z okna (575 MB).
        document.querySelector('.backup-opt[data-key="include_protocol_scans"]').checked = false;
        await sleep(500);
        await window.smokeShot('03_okno_backupu.png');
        await page.createFullBackup();
        for (let i = 0; i < 240 && !/\.zip$/m.test(document.getElementById('sync-result').textContent); i++) await sleep(500);
        R.backupResult = document.getElementById('sync-result').textContent;
        showResult();
        await window.smokeShot('04_backup_utworzony.png');
        const backupPath = (R.backupResult.match(/^(.*\.zip)$/m) || [])[1];
        R.backupPath = backupPath;

        await loadFileIntoInput('#zip-import-file', backupPath, 'backup.zip');
        await page.importBackup();
        await sleep(1500);
        R.importResult = document.getElementById('sync-result').textContent;
        showResult();
        await window.smokeShot('05_import_poprawnego_zip.png');

        await loadFileIntoInput('#zip-import-file', window.__SMOKE.malicious, 'malicious_backup.zip');
        await page.importBackup();
        await sleep(1500);
        R.maliciousResult = document.getElementById('sync-result').textContent;
        showResult();
        await window.smokeShot('06_zlosliwy_zip_odrzucony.png');
        R.dialogs = dialogs;
        R.jsonExport = await API._invoke('miejscowosci_eksport_json');

        // Ta sama strona bez tokena (jak obca strona, która zgadnie port).
        const call = async (headers) => (await fetch('/api/rpc', { method: 'POST', headers, body: JSON.stringify({ cmd: 'miejscowosci_lista', args: {} }) })).status;
        R.rpcWithToken = await call({ 'Content-Type': 'application/json', 'X-Czarna-Token': window.__CZARNA_RPC_TOKEN });
        R.rpcWithoutToken = await call({ 'Content-Type': 'application/json' });
        R.rpcTextPlain = await call({ 'Content-Type': 'text/plain', 'X-Czarna-Token': window.__CZARNA_RPC_TOKEN });
        s.step = 3; save(s);
        await window.smokeReport(JSON.stringify(R, null, 2));
        await sleep(500);
        window.smokeQuit();
      }
    } catch (e) {
      R.error = String(e && e.stack || e);
      R.dialogs = dialogs;
      await window.smokeReport(JSON.stringify(R, null, 2));
      window.smokeQuit();
    }
  });
})();
