// ==========================================================================
// KODE APLIKASI WEB PETA GIS - TABLE-BASED PILL MARKER & 100% SELF-CONTAINED SINGLE-FILE EXPORTER
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  let map;
  let currentBasemap;
  let geojsonLayers = {};
  let poiMarkers = [];
  let currentActiveCategory = 'all';
  let activeSelectedPoi = null;

  // Editor State
  let isEditorMode = false;
  let currentEditorTool = null;
  let activeDrawingPoints = [];
  let activeDrawingPolyline = null;
  let activeDrawingPolygon = null;
  let activeDrawingMarkers = [];

  // Custom Export Polygon Shape State
  let exportPolygonPoints = [];
  let exportPolygonShape = null;
  let exportPolygonMarkers = [];
  let exportMode = 'crop';

  // Local Storage Data Management
  let activeData = loadSavedDataFromStorage();

  function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function safeSetValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  // Inisialisasi Aplikasi
  try {
    setupHeaderAndStats();
    initMap();
    renderGeoJSONLayers();
    renderPoiMarkers();
    populatePoiSidebarList();

    setupTabEvents();
    setupSearchAndFilterEvents();
    setupLayerToggles();
    setupBasemapSwitcher();
    setupModalEvents();
    setupHeaderActions();
    setupVisualEditorControls();
    setupCustomExportTool();
  } catch (err) {
    console.error('Error saat inisialisasi aplikasi Peta:', err);
  }

  // -------------------------------------------------------------
  // 1. Data Storage & Local Persistence
  // -------------------------------------------------------------
  function loadSavedDataFromStorage() {
    const saved = localStorage.getItem('DUKUH_SEMPU_CUSTOM_GIS_DATA');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.profile && (parsed.pois || parsed.profile.nama)) return parsed;
      } catch (e) {
        console.error('Gagal membaca data dari LocalStorage:', e);
      }
    }
    if (typeof DUKUH_SEMPU_DATA !== 'undefined' && DUKUH_SEMPU_DATA && DUKUH_SEMPU_DATA.profile) {
      return JSON.parse(JSON.stringify(DUKUH_SEMPU_DATA));
    }
    return { profile: {}, statistik: {}, pois: [] };
  }

  function saveCurrentDataToStorage() {
    localStorage.setItem('DUKUH_SEMPU_CUSTOM_GIS_DATA', JSON.stringify(activeData));
    setupHeaderAndStats();
    renderGeoJSONLayers();
    renderPoiMarkers();
    populatePoiSidebarList();
    autoFitMapToBounds();
  }

  // -------------------------------------------------------------
  // 2. Header & Stats Binder
  // -------------------------------------------------------------
  function setupHeaderAndStats() {
    const prof = activeData.profile || {};
    const stat = activeData.statistik || {};

    safeSetText('header-title', (prof.nama || 'PETA DIGITAL INTERAKTIF').toUpperCase());
    
    const subtitleParts = [prof.desa, prof.kecamatan, prof.kabupaten, prof.provinsi].filter(Boolean);
    safeSetText('header-subtitle', subtitleParts.length > 0 ? subtitleParts.join(', ') : 'Visual Map Editor - Klik & Edit Langsung');

    if (prof.koordinatPusat && prof.koordinatPusat.length === 2) {
      safeSetText('header-coords-text', `${prof.koordinatPusat[0]}°, ${prof.koordinatPusat[1]}°`);
    }

    safeSetText('stat-penduduk', stat.pendudukTotal || 0);
    safeSetText('stat-luas', prof.luasTotalHektar || 0);
    safeSetText('info-box-desc-1', prof.deskripsi || 'Belum ada deskripsi wilayah.');

    safeSetValue('edit-profile-nama', prof.nama || '');
    safeSetValue('edit-profile-desa-kec', [prof.desa, prof.kecamatan].filter(Boolean).join(', '));
    safeSetValue('edit-profile-kab-prov', [prof.kabupaten, prof.provinsi].filter(Boolean).join(', '));
    safeSetValue('edit-profile-desc', prof.deskripsi || '');
  }
  // -------------------------------------------------------------
  // Auto-fit Map View to all POI Markers & GeoJSON Boundaries
  // -------------------------------------------------------------
  function autoFitMapToBounds() {
    if (!map) return;
    const bounds = L.latLngBounds();

    // 1. Extend with POI coordinates
    const pois = activeData.pois || [];
    pois.forEach(p => {
      if (typeof p.lat === 'number' && typeof p.lng === 'number') {
        bounds.extend([p.lat, p.lng]);
      }
    });

    // 2. Extend with GeoJSON layers bounds
    Object.values(geojsonLayers).forEach(l => {
      if (l && typeof l.getBounds === 'function') {
        try {
          const b = l.getBounds();
          if (b && b.isValid()) bounds.extend(b);
        } catch (e) {}
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18, animate: true });
    }
  }

  // -------------------------------------------------------------
  // 3. Leaflet Map Engine
  // -------------------------------------------------------------
  function initMap() {
    const center = (activeData.profile && activeData.profile.koordinatPusat) ? activeData.profile.koordinatPusat : [-7.7745, 110.7305];
    const zoom = (activeData.profile && activeData.profile.zoomAwal) ? activeData.profile.zoomAwal : 16;

    map = L.map('map', {
      center: center,
      zoom: zoom,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    const basemaps = {
      osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true }),
      satellite: L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { subdomains: ['0', '1', '2', '3'], maxZoom: 20, crossOrigin: true }),
      hybrid: L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { subdomains: ['0', '1', '2', '3'], maxZoom: 20, crossOrigin: true }),
      dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, crossOrigin: true })
    };

    currentBasemap = basemaps.satellite;
    currentBasemap.addTo(map);
    map._basemaps = basemaps;

    // Multi-stage invalidateSize & Auto-Fit to bounds
    setTimeout(() => { if (map) map.invalidateSize(); }, 100);
    setTimeout(() => { if (map) map.invalidateSize(); autoFitMapToBounds(); }, 400);
    setTimeout(() => { if (map) map.invalidateSize(); autoFitMapToBounds(); }, 1000);

    map.on('click', (e) => {
      const latlng = e.latlng;

      if (currentEditorTool === 'export-polygon') {
        exportPolygonPoints.push(latlng);
        const marker = L.circleMarker(latlng, { radius: 5, color: '#10b981', fillColor: '#fff', fillOpacity: 1 }).addTo(map);
        exportPolygonMarkers.push(marker);

        if (exportPolygonShape) map.removeLayer(exportPolygonShape);
        if (exportPolygonPoints.length >= 2) {
          exportPolygonShape = L.polygon(exportPolygonPoints, {
            color: '#10b981',
            weight: 2,
            dashArray: '6, 6',
            fillColor: 'transparent',
            fillOpacity: 0
          }).addTo(map);
        }
        return;
      }

      if (!isEditorMode || !currentEditorTool) return;

      if (currentEditorTool === 'add-poi') {
        openPoiFormForNewPoint(latlng.lat, latlng.lng);
        stopCurrentDrawingTool();
      } 
      else if (currentEditorTool === 'add-polygon' || currentEditorTool === 'add-line') {
        activeDrawingPoints.push(latlng);
        const marker = L.circleMarker(latlng, { radius: 5, color: '#f59e0b', fillColor: '#fff', fillOpacity: 1 }).addTo(map);
        activeDrawingMarkers.push(marker);

        if (currentEditorTool === 'add-polygon') {
          if (activeDrawingPolygon) map.removeLayer(activeDrawingPolygon);
          if (activeDrawingPoints.length >= 2) {
            activeDrawingPolygon = L.polygon(activeDrawingPoints, { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.3 }).addTo(map);
          }
        } 
        else if (currentEditorTool === 'add-line') {
          if (activeDrawingPolyline) map.removeLayer(activeDrawingPolyline);
          if (activeDrawingPoints.length >= 2) {
            activeDrawingPolyline = L.polyline(activeDrawingPoints, { color: '#3b82f6', weight: 4 }).addTo(map);
          }
        }
      }
    });

    map.on('dblclick', (e) => {
      if (currentEditorTool === 'export-polygon') {
        L.DomEvent.stopPropagation(e);
        finishDrawingExportPolygon();
      }
      else if (isEditorMode && (currentEditorTool === 'add-polygon' || currentEditorTool === 'add-line')) {
        L.DomEvent.stopPropagation(e);
        finishDrawingShape();
      }
    });
  }

  // -------------------------------------------------------------
  // 4. VISUAL EDITOR CONTROLS
  // -------------------------------------------------------------
  function setupVisualEditorControls() {
    const btnToggleEditor = document.getElementById('btn-toggle-editor');
    const editorStatusText = document.getElementById('editor-status-text');
    const banner = document.getElementById('editor-active-banner');
    const bannerText = document.getElementById('editor-instruction-text');
    const btnCancel = document.getElementById('btn-cancel-editor-action');
    const btnFinish = document.getElementById('btn-finish-editor-action');

    if (btnToggleEditor) {
      btnToggleEditor.addEventListener('click', () => {
        isEditorMode = !isEditorMode;
        if (isEditorMode) {
          btnToggleEditor.classList.add('active');
          if (editorStatusText) editorStatusText.textContent = 'ON';
          alert('Mode Editor Aktif! Anda kini bisa menambah marker dan menggambar wilayah langsung di peta.');
        } else {
          btnToggleEditor.classList.remove('active');
          if (editorStatusText) editorStatusText.textContent = 'OFF';
          stopCurrentDrawingTool();
        }
      });
    }

    const btnAddPoi = document.getElementById('btn-add-poi-mode');
    if (btnAddPoi) {
      btnAddPoi.addEventListener('click', () => {
        if (!isEditorMode) {
          isEditorMode = true;
          if (btnToggleEditor) btnToggleEditor.classList.add('active');
          if (editorStatusText) editorStatusText.textContent = 'ON';
        }
        currentEditorTool = 'add-poi';
        if (banner) banner.style.display = 'flex';
        if (btnFinish) btnFinish.style.display = 'none';
        if (bannerText) bannerText.innerHTML = '📍 <strong>Mode Tambah Marker POI:</strong> Klik titik lokasi mana saja pada peta!';
        map.getContainer().style.cursor = 'crosshair';
      });
    }

    const btnAddPoly = document.getElementById('btn-add-polygon-mode');
    if (btnAddPoly) {
      btnAddPoly.addEventListener('click', () => {
        if (!isEditorMode) {
          isEditorMode = true;
          if (btnToggleEditor) btnToggleEditor.classList.add('active');
          if (editorStatusText) editorStatusText.textContent = 'ON';
        }
        clearDrawingTempLayers();
        currentEditorTool = 'add-polygon';
        if (banner) banner.style.display = 'flex';
        if (btnFinish) btnFinish.style.display = 'inline-flex';
        if (bannerText) bannerText.innerHTML = '⬡ <strong>Mode Gambar Polygon:</strong> Klik sudut-sudut wilayah di peta (Klik "Selesai Gambar" jika selesai)';
        map.getContainer().style.cursor = 'crosshair';
      });
    }

    const btnAddLine = document.getElementById('btn-add-line-mode');
    if (btnAddLine) {
      btnAddLine.addEventListener('click', () => {
        if (!isEditorMode) {
          isEditorMode = true;
          if (btnToggleEditor) btnToggleEditor.classList.add('active');
          if (editorStatusText) editorStatusText.textContent = 'ON';
        }
        clearDrawingTempLayers();
        currentEditorTool = 'add-line';
        if (banner) banner.style.display = 'flex';
        if (btnFinish) btnFinish.style.display = 'inline-flex';
        if (bannerText) bannerText.innerHTML = '📏 <strong>Mode Gambar Jalan/Irigasi:</strong> Klik titik-titik jalur di peta (Klik "Selesai Gambar" jika selesai)';
        map.getContainer().style.cursor = 'crosshair';
      });
    }

    if (btnFinish) {
      btnFinish.addEventListener('click', () => {
        if (currentEditorTool === 'export-polygon') {
          finishDrawingExportPolygon();
        } else if (currentEditorTool === 'add-polygon' || currentEditorTool === 'add-line') {
          finishDrawingShape();
        }
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        stopCurrentDrawingTool();
      });
    }

    const btnSaveProf = document.getElementById('btn-save-profile');
    if (btnSaveProf) {
      btnSaveProf.addEventListener('click', () => {
        activeData.profile.nama = document.getElementById('edit-profile-nama').value.trim() || 'Peta Digital';
        
        const desacec = document.getElementById('edit-profile-desa-kec').value.split(',');
        activeData.profile.desa = desacec[0] ? desacec[0].trim() : '';
        activeData.profile.kecamatan = desacec[1] ? desacec[1].trim() : '';

        const kabprov = document.getElementById('edit-profile-kab-prov').value.split(',');
        activeData.profile.kabupaten = kabprov[0] ? kabprov[0].trim() : '';
        activeData.profile.provinsi = kabprov[1] ? kabprov[1].trim() : '';

        activeData.profile.deskripsi = document.getElementById('edit-profile-desc').value.trim();

        saveCurrentDataToStorage();
        alert('Profil Wilayah berhasil disimpan!');
      });
    }

    const btnReset = document.getElementById('btn-reset-all');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (confirm('Apakah Anda yakin ingin menghapus semua data dan mengosongkan peta kembali?')) {
          localStorage.removeItem('DUKUH_SEMPU_CUSTOM_GIS_DATA');
          activeData = JSON.parse(JSON.stringify(DUKUH_SEMPU_DATA));
          saveCurrentDataToStorage();
          alert('Data berhasil di-reset!');
        }
      });
    }

    const formPoi = document.getElementById('poi-editor-form');
    if (formPoi) {
      formPoi.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const id = document.getElementById('form-poi-id').value || `poi-${Date.now()}`;
        const nama = document.getElementById('form-poi-nama').value.trim();
        const kategori = document.getElementById('form-poi-kategori').value;
        const color = document.getElementById('form-poi-color').value;
        const lat = parseFloat(document.getElementById('form-poi-lat').value);
        const lng = parseFloat(document.getElementById('form-poi-lng').value);
        const alamat = document.getElementById('form-poi-alamat').value.trim();
        const deskripsi = document.getElementById('form-poi-desc').value.trim();

        let icon = 'location-dot';
        let fotoBadge = '📍';
        if (kategori === 'Pendidikan') { icon = 'graduation-cap'; fotoBadge = '🏫'; }
        else if (kategori === 'Ibadah') { icon = 'mosque'; fotoBadge = '🕌'; }
        else if (kategori === 'UMKM') { icon = 'store'; fotoBadge = '🧵'; }
        else if (kategori === 'Kesehatan') { icon = 'heart-pulse'; fotoBadge = '🩺'; }
        else if (kategori === 'Pertanian') { icon = 'wheat-awn'; fotoBadge = '🌾'; }

        if (!activeData.pois) activeData.pois = [];

        const existingIndex = activeData.pois.findIndex(p => p.id === id);
        const newPoi = { id, nama, kategori, icon, color, lat, lng, alamat, deskripsi, fotoBadge, fasilitas: [] };

        if (existingIndex >= 0) {
          activeData.pois[existingIndex] = newPoi;
        } else {
          activeData.pois.push(newPoi);
        }

        saveCurrentDataToStorage();
        document.getElementById('modal-poi-form').classList.remove('active');
        alert(`Titik Lokasi "${nama}" berhasil disimpan!`);
      });
    }
  }

  function stopCurrentDrawingTool() {
    currentEditorTool = null;
    const banner = document.getElementById('editor-active-banner');
    const btnFinish = document.getElementById('btn-finish-editor-action');
    if (banner) banner.style.display = 'none';
    if (btnFinish) btnFinish.style.display = 'none';
    if (map) map.getContainer().style.cursor = '';
    clearDrawingTempLayers();
  }

  function clearDrawingTempLayers() {
    activeDrawingPoints = [];
    if (activeDrawingPolyline && map) map.removeLayer(activeDrawingPolyline);
    if (activeDrawingPolygon && map) map.removeLayer(activeDrawingPolygon);
    activeDrawingMarkers.forEach(m => { if (map) map.removeLayer(m); });
    activeDrawingMarkers = [];
    activeDrawingPolyline = null;
    activeDrawingPolygon = null;
  }

  function openPoiFormForNewPoint(lat, lng) {
    safeSetValue('form-poi-id', '');
    safeSetValue('form-poi-nama', '');
    safeSetValue('form-poi-lat', lat.toFixed(6));
    safeSetValue('form-poi-lng', lng.toFixed(6));
    safeSetValue('form-poi-alamat', '');
    safeSetValue('form-poi-desc', '');
    
    const title = document.getElementById('form-poi-title');
    if (title) title.innerHTML = '<i class="fa-solid fa-plus-circle"></i> Tambah Titik Lokasi Baru';
    
    const modal = document.getElementById('modal-poi-form');
    if (modal) modal.classList.add('active');
  }

  function finishDrawingShape() {
    if (activeDrawingPoints.length < 2) {
      alert('Tentukan minimal 2 atau 3 titik di peta!');
      return;
    }

    const shapeName = prompt('Masukkan Nama Area / Garis Jalan ini:', 'Area Baru');
    if (!shapeName) {
      stopCurrentDrawingTool();
      return;
    }

    const coords = activeDrawingPoints.map(p => [p.lng, p.lat]);

    if (currentEditorTool === 'add-polygon') {
      coords.push(coords[0]);
      const feature = {
        "type": "Feature",
        "properties": { "kategori": "Area", "label": shapeName, "color": "#f59e0b" },
        "geometry": { "type": "Polygon", "coordinates": [coords] }
      };

      if (!activeData.landUseGeoJSON) activeData.landUseGeoJSON = { "type": "FeatureCollection", "features": [] };
      activeData.landUseGeoJSON.features.push(feature);
    } 
    else if (currentEditorTool === 'add-line') {
      const feature = {
        "type": "Feature",
        "properties": { "tipe": "Jalan", "nama": shapeName, "color": "#3b82f6", "width": 4 },
        "geometry": { "type": "LineString", "coordinates": coords }
      };

      if (!activeData.infrastrukturGeoJSON) activeData.infrastrukturGeoJSON = { "type": "FeatureCollection", "features": [] };
      activeData.infrastrukturGeoJSON.features.push(feature);
    }

    saveCurrentDataToStorage();
    stopCurrentDrawingTool();
    alert(`Batas Wilayah / Garis "${shapeName}" berhasil disimpan ke peta!`);
  }

  // -------------------------------------------------------------
  // 5. CUSTOM EXPORT AREA TOOL
  // -------------------------------------------------------------
  function setupCustomExportTool() {
    const modalExport = document.getElementById('modal-export-custom');
    const btnOpenHeader = document.getElementById('btn-open-export-modal');
    const btnOpenSide = document.getElementById('btn-side-export-custom');
    const btnCloseModal = document.getElementById('modal-export-close');
    const btnDrawBox = document.getElementById('btn-draw-crop-box');
    const btnFullMode = document.getElementById('btn-select-full-view');
    const btnStartDrawing = document.getElementById('btn-start-drawing-crop');
    const pdfOptions = document.getElementById('pdf-options-container');
    const btnProcessExport = document.getElementById('btn-process-export');

    const openExportModal = () => {
      if (modalExport) modalExport.classList.add('active');
    };

    if (btnOpenHeader) btnOpenHeader.addEventListener('click', openExportModal);
    if (btnOpenSide) btnOpenSide.addEventListener('click', openExportModal);

    if (btnCloseModal && modalExport) {
      btnCloseModal.addEventListener('click', () => {
        modalExport.classList.remove('active');
        clearExportPolygonLayers();
      });
    }

    if (btnDrawBox) {
      btnDrawBox.addEventListener('click', () => {
        exportMode = 'crop';
        btnDrawBox.classList.add('active');
        if (btnFullMode) btnFullMode.classList.remove('active');
      });
    }

    if (btnFullMode) {
      btnFullMode.addEventListener('click', () => {
        exportMode = 'full';
        btnFullMode.classList.add('active');
        if (btnDrawBox) btnDrawBox.classList.remove('active');
        clearExportPolygonLayers();
      });
    }

    if (btnStartDrawing) {
      btnStartDrawing.addEventListener('click', () => {
        exportMode = 'crop';
        if (modalExport) modalExport.classList.remove('active');
        
        clearExportPolygonLayers();
        currentEditorTool = 'export-polygon';
        
        if (map) map.getContainer().style.cursor = 'crosshair';

        const banner = document.getElementById('editor-active-banner');
        const bannerText = document.getElementById('editor-instruction-text');
        const btnFinish = document.getElementById('btn-finish-editor-action');
        if (banner) banner.style.display = 'flex';
        if (btnFinish) btnFinish.style.display = 'inline-flex';
        if (bannerText) bannerText.innerHTML = '✏️ <strong>Mode Gambar Garis Batas Ekspor:</strong> Klik titik-titik di sekitar wilayah (Klik "Selesai Gambar" jika selesai)';
      });
    }

    const formatRadios = document.querySelectorAll('input[name="export-format"]');
    formatRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        const val = e.target.value;
        document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('active'));
        e.target.closest('.radio-card').classList.add('active');

        if (pdfOptions) {
          pdfOptions.style.display = val === 'pdf' ? 'block' : 'none';
        }
      });
    });

    if (btnProcessExport) {
      btnProcessExport.addEventListener('click', async () => {
        const format = document.querySelector('input[name="export-format"]:checked').value;
        const orientation = document.getElementById('export-pdf-orientation').value;
        const incHeader = document.getElementById('export-inc-header').checked;
        const incLegend = document.getElementById('export-inc-legend').checked;
        const incDate = document.getElementById('export-inc-date').checked;

        btnProcessExport.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses Ekspor Peta...';
        btnProcessExport.disabled = true;

        try {
          await generateMapCapture(format, orientation, incHeader, incLegend, incDate);
        } catch (err) {
          console.error('Error saat ekspor:', err);
          alert('Terjadi kesalahan saat memproses ekspor peta.');
        } finally {
          btnProcessExport.innerHTML = '<i class="fa-solid fa-download"></i> Generasi & Unduh Berkas';
          btnProcessExport.disabled = false;
          if (modalExport) modalExport.classList.remove('active');
          clearExportPolygonLayers();
        }
      });
    }
  }

  function finishDrawingExportPolygon() {
    if (exportPolygonPoints.length < 2) {
      alert('Tentukan minimal 2 atau 3 titik untuk garis batas area ekspor!');
      return;
    }

    currentEditorTool = null;
    const banner = document.getElementById('editor-active-banner');
    const btnFinish = document.getElementById('btn-finish-editor-action');
    if (banner) banner.style.display = 'none';
    if (btnFinish) btnFinish.style.display = 'none';
    if (map) map.getContainer().style.cursor = '';

    const modalExport = document.getElementById('modal-export-custom');
    const statusText = document.getElementById('crop-status-text');
    if (statusText) {
      statusText.innerHTML = '✅ <strong style="color:var(--primary);">Garis batas polygon wilayah berhasil ditandai!</strong> Siap untuk diekspor.';
    }
    if (modalExport) modalExport.classList.add('active');
  }

  function clearExportPolygonLayers() {
    exportPolygonPoints = [];
    if (exportPolygonShape && map) map.removeLayer(exportPolygonShape);
    exportPolygonMarkers.forEach(m => { if (map) map.removeLayer(m); });
    exportPolygonMarkers = [];
    exportPolygonShape = null;
  }

  async function generateMapCapture(format, pdfOrientation, incHeader, incLegend, incDate) {
    const tempExportShape = exportPolygonShape;
    const tempExportPoints = [...exportPolygonPoints];

    const isBatasVisible = geojsonLayers.batas && map && map.hasLayer(geojsonLayers.batas);
    if (isBatasVisible) map.removeLayer(geojsonLayers.batas);

    // Temporarily hide export crop boundary line & markers
    if (exportPolygonShape && map) map.removeLayer(exportPolygonShape);
    exportPolygonMarkers.forEach(m => { if (map) map.removeLayer(m); });
    if (activeDrawingPolyline && map) map.removeLayer(activeDrawingPolyline);
    if (activeDrawingPolygon && map) map.removeLayer(activeDrawingPolygon);
    activeDrawingMarkers.forEach(m => { if (map) map.removeLayer(m); });

    const mapElement = document.getElementById('map');
    if (map) map.invalidateSize(false);

    let canvas;
    try {
      canvas = await html2canvas(mapElement, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        logging: false,
        onclone: (clonedDoc) => {
          const clonedTitles = clonedDoc.querySelectorAll('.pill-title');
          clonedTitles.forEach(t => {
            t.style.color = '#ffffff';
            t.style.fontFamily = 'Arial, sans-serif';
            t.style.fontWeight = 'bold';
            t.style.fontSize = '12px';
          });
        }
      });
    } finally {
      // Restore layers to the map view
      if (tempExportShape && map) tempExportShape.addTo(map);
      exportPolygonMarkers.forEach(m => { if (map) m.addTo(map); });
      if (activeDrawingPolyline && map) activeDrawingPolyline.addTo(map);
      if (activeDrawingPolygon && map) activeDrawingPolygon.addTo(map);
      activeDrawingMarkers.forEach(m => { if (map) m.addTo(map); });
      if (isBatasVisible && map) map.addLayer(geojsonLayers.batas);
    }

    let finalCanvas = canvas;

    if (exportMode === 'crop' && tempExportShape && tempExportPoints.length >= 3 && map) {
      try {
        const bounds = tempExportShape.getBounds();
        const nw = bounds.getNorthWest();
        const se = bounds.getSouthEast();

        const nwPoint = map.latLngToContainerPoint(nw);
        const sePoint = map.latLngToContainerPoint(se);

        const scale = 2;
        const minX = Math.min(nwPoint.x, sePoint.x);
        const minY = Math.min(nwPoint.y, sePoint.y);

        const cropX = Math.max(0, minX * scale);
        const cropY = Math.max(0, minY * scale);
        const cropW = Math.max(50, Math.abs(sePoint.x - nwPoint.x) * scale);
        const cropH = Math.max(50, Math.abs(sePoint.y - nwPoint.y) * scale);

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const ctx = cropCanvas.getContext('2d');

        if (format === 'jpeg') {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, cropW, cropH);
        }

        // Clip strictly along the user's custom polygon coordinates!
        ctx.beginPath();
        tempExportPoints.forEach((pt, idx) => {
          const p = map.latLngToContainerPoint(pt);
          const x = (p.x - minX) * scale;
          const y = (p.y - minY) * scale;
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.clip();

        ctx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        
        finalCanvas = cropCanvas;
      } catch (e) {
        console.error('Failed to crop canvas to polygon bounds:', e);
      }
    }

    const mapImgData = finalCanvas.toDataURL(`image/${format === 'jpeg' ? 'jpeg' : 'png'}`, 0.95);
    const prof = activeData.profile || {};
    const titleText = (prof.nama || 'PETA DIGITAL').toUpperCase();
    const subText = [prof.desa, prof.kecamatan, prof.kabupaten, prof.provinsi].filter(Boolean).join(', ');
    const timestampText = new Date().toLocaleString('id-ID');

    if (format === 'pdf') {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF(pdfOrientation === 'portrait' ? 'p' : 'l', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      let currentY = 14;

      if (incHeader) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(16);
        pdf.setTextColor(16, 185, 129);
        pdf.text(titleText, 14, currentY);

        currentY += 6;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.setTextColor(100, 116, 139);
        pdf.text(subText, 14, currentY);

        currentY += 8;
      }

      const maxImgWidth = pageWidth - 28;
      const maxImgHeight = pageHeight - currentY - 20;

      let pdfImgWidth = maxImgWidth;
      let pdfImgHeight = (finalCanvas.height * maxImgWidth) / finalCanvas.width;

      if (pdfImgHeight > maxImgHeight) {
        pdfImgHeight = maxImgHeight;
        pdfImgWidth = (finalCanvas.width * maxImgHeight) / finalCanvas.height;
      }

      const xOffset = 14 + (maxImgWidth - pdfImgWidth) / 2;

      pdf.addImage(mapImgData, 'PNG', xOffset, currentY, pdfImgWidth, pdfImgHeight);
      currentY += pdfImgHeight + 6;

      if (incDate) {
        pdf.setFontSize(8);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Tanggal Ekspor: ${timestampText} | Peta Digital GIS Interaktif`, 14, pageHeight - 8);
      }

      pdf.save(`Peta_${titleText.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
    } else {
      const a = document.createElement('a');
      a.href = mapImgData;
      a.download = `Peta_${titleText.replace(/\s+/g, '_')}_${Date.now()}.${format}`;
      a.click();
    }
  }

  // -------------------------------------------------------------
  // 6. Render GeoJSON & POI Markers
  // -------------------------------------------------------------
  function renderGeoJSONLayers() {
    if (!map) return;
    Object.values(geojsonLayers).forEach(l => { if (l && map.hasLayer(l)) map.removeLayer(l); });
    geojsonLayers = {};

    const hasFeatures = (col) => col && Array.isArray(col.features) && col.features.length > 0;

    if (hasFeatures(activeData.batasDukuhGeoJSON)) {
      geojsonLayers.batas = L.geoJSON(activeData.batasDukuhGeoJSON, {
        style: { color: '#10b981', weight: 3, dashArray: '8, 6', fillColor: '#10b981', fillOpacity: 0.08 }
      }).addTo(map);
    }

    if (hasFeatures(activeData.zonasiRTGeoJSON)) {
      geojsonLayers.rt = L.geoJSON(activeData.zonasiRTGeoJSON, {
        style: (f) => ({ color: f.properties.color || '#3b82f6', weight: 2, fillColor: f.properties.color || '#3b82f6', fillOpacity: 0.22 }),
        onEachFeature: (f, l) => l.bindTooltip(`<b>${f.properties.rt || 'RT'}</b>`, { sticky: true })
      }).addTo(map);
    }

    if (hasFeatures(activeData.landUseGeoJSON)) {
      geojsonLayers.landUse = L.geoJSON(activeData.landUseGeoJSON, {
        style: (f) => ({ color: f.properties.color || '#ef4444', weight: 2, fillColor: f.properties.color || '#ef4444', fillOpacity: 0.3 }),
        onEachFeature: (f, l) => l.bindTooltip(`Area: <b>${f.properties.label || f.properties.kategori}</b>`, { sticky: true })
      }).addTo(map);
    }

    if (hasFeatures(activeData.infrastrukturGeoJSON)) {
      geojsonLayers.infrastruktur = L.geoJSON(activeData.infrastrukturGeoJSON, {
        style: (f) => ({ color: f.properties.color || '#f97316', weight: f.properties.width || 3 }),
        onEachFeature: (f, l) => l.bindTooltip(`Jalur: <b>${f.properties.nama || ''}</b>`, { sticky: true })
      }).addTo(map);
    }
  }

  function renderPoiMarkers() {
    if (!map) return;
    poiMarkers.forEach(m => map.removeLayer(m));
    poiMarkers = [];

    const pois = activeData.pois || [];
    pois.forEach(poi => {
      if (typeof poi.lat !== 'number' || typeof poi.lng !== 'number') return;

      const markerHtml = `
        <div class="unified-pill-marker" style="border-color: ${poi.color || '#10b981'}; background-color: #0f172a !important;">
          <table style="border-collapse: collapse; margin: 0; padding: 0; background: transparent;">
            <tr>
              <td style="padding: 0 5px 0 0; vertical-align: middle;">
                <div class="pill-icon" style="background-color: ${poi.color || '#10b981'}; color: #ffffff !important;">
                  <i class="fa-solid fa-${poi.icon || 'location-dot'}" style="color: #ffffff !important;"></i>
                </div>
              </td>
              <td style="padding: 0 8px 0 0; vertical-align: middle; white-space: nowrap;">
                <span class="pill-title" style="color: #ffffff !important; font-family: Arial, sans-serif; font-weight: bold; font-size: 12px; display: inline-block;">${poi.nama}</span>
              </td>
            </tr>
          </table>
        </div>
      `;

      const customIcon = L.divIcon({
        html: markerHtml,
        className: 'leaflet-pill-marker-container',
        iconSize: null,
        iconAnchor: [15, 16],
        popupAnchor: [0, -18]
      });

      const marker = L.marker([poi.lat, poi.lng], { icon: customIcon }).addTo(map);

      marker.bindPopup(`
        <div class="popup-content">
          <h4>${poi.fotoBadge || '📍'} ${poi.nama}</h4>
          <p><i class="fa-solid fa-tag"></i> ${poi.kategori || 'Lokasi'}</p>
          <p>${(poi.deskripsi || '').substring(0, 80)}...</p>
          <button class="popup-btn" onclick="openPoiModalById('${poi.id}')">Detail / Hapus</button>
        </div>
      `);
      marker.poiData = poi;
      poiMarkers.push(marker);
    });
  }

  window.openPoiModalById = function(id) {
    const poi = (activeData.pois || []).find(p => p.id === id);
    if (poi) openModal(poi);
  };

  function populatePoiSidebarList() {
    const container = document.getElementById('poi-list-container');
    const badgeCount = document.getElementById('poi-count-badge');
    if (!container) return;

    const searchInput = document.getElementById('search-input');
    const searchVal = (searchInput ? searchInput.value : '').toLowerCase().trim();

    const pois = activeData.pois || [];
    const filtered = pois.filter(poi => {
      const matchCat = (currentActiveCategory === 'all' || (poi.kategori && poi.kategori.includes(currentActiveCategory)));
      const matchSearch = (poi.nama || '').toLowerCase().includes(searchVal) || (poi.deskripsi || '').toLowerCase().includes(searchVal);
      return matchCat && matchSearch;
    });

    if (badgeCount) badgeCount.textContent = `${filtered.length} Titik`;
    container.innerHTML = '';

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 15px; color:var(--text-muted);">
          <i class="fa-solid fa-folder-open" style="font-size:2.5rem; margin-bottom:12px; opacity:0.4; display:block;"></i>
          <p style="font-size:0.85rem; font-weight:600; color:var(--text-main); margin-bottom:4px;">Belum Ada Titik Lokasi</p>
          <p style="font-size:0.75rem;">Gunakan tab <strong>Edit Web</strong> untuk menambah lokasi langsung dari peta!</p>
        </div>
      `;
      return;
    }

    filtered.forEach(poi => {
      const card = document.createElement('div');
      card.className = 'poi-card';
      card.innerHTML = `
        <div class="poi-icon-badge" style="background:${poi.color || '#10b981'}">
          <i class="fa-solid fa-${poi.icon || 'location-dot'}"></i>
        </div>
        <div class="poi-info">
          <h4>${poi.nama}</h4>
          <p>${poi.alamat || '-'}</p>
          <div class="poi-meta"><span class="poi-tag">${poi.kategori || 'Lokasi'}</span></div>
        </div>
      `;

      card.addEventListener('click', () => {
        if (map) {
          map.flyTo([poi.lat, poi.lng], 18, { duration: 1 });
          const targetMarker = poiMarkers.find(m => m.poiData.id === poi.id);
          if (targetMarker) targetMarker.openPopup();
          if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.add('collapsed');
          }
        }
      });

      container.appendChild(card);
    });
  }

  // -------------------------------------------------------------
  // 7. Tab & Controls UI
  // -------------------------------------------------------------
  function setupTabEvents() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const target = document.getElementById(btn.getAttribute('data-tab'));
        if (target) target.classList.add('active');
      });
    });

    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle && sidebar) {
      if (window.innerWidth <= 768) {
        sidebar.classList.add('collapsed');
      }
      sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        setTimeout(() => { if (map) map.invalidateSize(); }, 300);
      });
    }
  }

  function setupSearchAndFilterEvents() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', populatePoiSidebarList);

    const chips = document.querySelectorAll('#category-filter .chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentActiveCategory = chip.getAttribute('data-cat');
        populatePoiSidebarList();
      });
    });
  }

  function setupLayerToggles() {
    const toggles = [
      { id: 'layer-toggle-batas', layer: geojsonLayers.batas },
      { id: 'layer-toggle-rt', layer: geojsonLayers.rt },
      { id: 'layer-toggle-pemukiman', layer: geojsonLayers.landUse },
      { id: 'layer-toggle-sawah', layer: geojsonLayers.landUse },
      { id: 'layer-toggle-infrastruktur', layer: geojsonLayers.infrastruktur }
    ];

    toggles.forEach(t => {
      const el = document.getElementById(t.id);
      if (el) {
        el.addEventListener('change', (e) => {
          if (t.layer && map) {
            if (e.target.checked) map.addLayer(t.layer);
            else map.removeLayer(t.layer);
          }
        });
      }
    });
  }

  function setupBasemapSwitcher() {
    const items = document.querySelectorAll('.basemap-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        items.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        const key = item.getAttribute('data-basemap');
        if (currentBasemap && map) map.removeLayer(currentBasemap);
        if (map && map._basemaps && map._basemaps[key]) {
          currentBasemap = map._basemaps[key];
          currentBasemap.addTo(map);
        }
      });
    });
  }

  // -------------------------------------------------------------
  // 8. Modals
  // -------------------------------------------------------------
  function setupModalEvents() {
    const modal = document.getElementById('modal-detail');
    const closeBtn = document.getElementById('modal-close');
    if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    
    const formClose = document.getElementById('modal-form-close');
    const formModal = document.getElementById('modal-poi-form');
    if (formClose && formModal) formClose.addEventListener('click', () => formModal.classList.remove('active'));

    const btnZoom = document.getElementById('btn-zoom-to-poi');
    if (btnZoom) {
      btnZoom.addEventListener('click', () => {
        if (activeSelectedPoi && map) {
          modal.classList.remove('active');
          map.flyTo([activeSelectedPoi.lat, activeSelectedPoi.lng], 18, { duration: 1 });
        }
      });
    }

    const btnDel = document.getElementById('btn-delete-poi');
    if (btnDel) {
      btnDel.addEventListener('click', () => {
        if (activeSelectedPoi && confirm(`Hapus titik lokasi "${activeSelectedPoi.nama}"?`)) {
          activeData.pois = (activeData.pois || []).filter(p => p.id !== activeSelectedPoi.id);
          saveCurrentDataToStorage();
          if (modal) modal.classList.remove('active');
          alert('Titik lokasi berhasil dihapus!');
        }
      });
    }
  }

  function openModal(poi) {
    activeSelectedPoi = poi;
    const modal = document.getElementById('modal-detail');
    if (!modal) return;

    safeSetText('modal-banner-icon', poi.fotoBadge || '📍');
    safeSetText('modal-cat-badge', poi.kategori || 'Lokasi');
    const catBadge = document.getElementById('modal-cat-badge');
    if (catBadge) catBadge.style.borderColor = poi.color || '#10b981';

    safeSetText('modal-title', poi.nama);
    safeSetText('modal-address', poi.alamat || '-');
    safeSetText('modal-desc', poi.deskripsi || '-');

    modal.classList.add('active');
  }

  // -------------------------------------------------------------
  // 9. Download Generated data.js & Standalone Public HTML File
  // -------------------------------------------------------------
  function setupHeaderActions() {
    const downloadDataJs = () => {
      const code = `/* ==========================================================================
   DATA SPASIAL & KEWILAYAHAN (DIGENERATE DARI VISUAL MAP EDITOR)
   ========================================================================== */

const DUKUH_SEMPU_DATA = ${JSON.stringify(activeData, null, 2)};
`;

      const blob = new Blob([code], { type: 'text/javascript;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data.js`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const downloadPublicHtml = async () => {
      try {
        const res = await fetch('peta_publik_standalone.html');
        let htmlText = await res.text();

        // Bake current activeData dynamically into script
        const dataScript = `<script>
  const DUKUH_SEMPU_DATA = ${JSON.stringify(activeData, null, 2)};
  localStorage.setItem('DUKUH_SEMPU_CUSTOM_GIS_DATA', JSON.stringify(DUKUH_SEMPU_DATA));
</script>`;

        htmlText = htmlText.replace('<script src="data.js"></script>', `${dataScript}`);

        const blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `peta_publik_standalone.html`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Error downloading standalone public viewer html:', err);
        alert('Gagal mengunduh halaman publik.');
      }
    };

    const btnExpHeader = document.getElementById('btn-export-code');
    if (btnExpHeader) btnExpHeader.addEventListener('click', downloadDataJs);

    const btnExpSide = document.getElementById('btn-download-json');
    if (btnExpSide) btnExpSide.addEventListener('click', downloadDataJs);

    const btnPublicHtml = document.getElementById('btn-download-public-html');
    if (btnPublicHtml) btnPublicHtml.addEventListener('click', downloadPublicHtml);
  }

});
