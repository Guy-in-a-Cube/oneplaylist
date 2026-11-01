/* ============================================
   OnePlaylist — Download (Track + Album Zip)
   ============================================ */

const Download = (() => {
  const activeTracks = new Set();
  let archiveBusy = false;

  // Download a single track
  async function downloadTrack(fileUrl, title) {
    if (activeTracks.has(fileUrl)) {
      App.showToast('This track is already downloading.');
      return;
    }
    activeTracks.add(fileUrl);
    App.showToast(`Downloading "${title}"...`);
    try {
      const blob = await fetchFile(fileUrl);
      saveBlob(blob, `${sanitizeFilename(title)}.mp3`);
      App.showToast(`Download ready: "${title}"`);
    } catch (err) {
      console.error('Track download error:', err);
      App.showToast(`Download failed for "${title}". Please try again.`);
    } finally {
      activeTracks.delete(fileUrl);
    }
  }

  // Download entire album as ZIP
  async function downloadAlbum(album) {
    if (!album || album.tracks.length === 0) {
      App.showToast('There are no songs to download.');
      return;
    }
    await downloadArchive([album], album.title, `${sanitizeFilename(album.title)}.zip`);
  }

  // Download all albums as a single ZIP
  async function downloadAll() {
    const library = App.getLibrary();
    if (!library || !library.albums.some(album => album.tracks.length > 0)) {
      App.showToast('There are no songs to download.');
      return;
    }
    await downloadArchive(library.albums, 'All Albums', 'oneplaylist.zip');
  }

  async function downloadArchive(albums, title, filename) {
    if (archiveBusy) {
      App.showToast('An album download is already in progress.');
      return;
    }
    archiveBusy = true;
    const progress = showProgressUI(title);
    const totalFiles = albums.reduce((sum, album) => sum + album.tracks.length + 1, 0);
    let completed = 0;
    let missingCovers = 0;

    try {
      const zip = new JSZip();
      const folderNames = new Set();
      for (const album of albums) {
        const baseName = sanitizeFilename(album.title);
        let folderName = baseName;
        let suffix = 2;
        while (folderNames.has(folderName)) folderName = `${baseName}-${suffix++}`;
        folderNames.add(folderName);
        const folder = zip.folder(folderName);
        if (!await addCoverToFolder(folder, album.cover)) missingCovers++;
        completed++;
        updateProgress(progress, completed / totalFiles);

        completed += await addTracksToFolder(folder, album.tracks, (n) => {
          updateProgress(progress, (completed + n) / totalFiles);
        });
      }

      updateProgressText(progress, 'Creating ZIP...');
      await triggerZipDownload(zip, filename);
      App.showToast(missingCovers
        ? `Download ready: "${title}" (cover art unavailable for ${missingCovers} album${missingCovers === 1 ? '' : 's'})`
        : `Download ready: "${title}"`);
    } catch (err) {
      console.error('Archive download error:', err);
      App.showToast('Download failed. Please try again.');
    } finally {
      archiveBusy = false;
      removeProgressUI(progress);
    }
  }

  async function fetchFile(fileUrl) {
    const response = await fetch(App.mediaUrl(fileUrl));
    if (!response.ok) throw new Error(`Could not download "${fileUrl}" (HTTP ${response.status})`);
    const blob = await response.blob();
    if (blob.size === 0) throw new Error(`The file "${fileUrl}" is empty`);
    return blob;
  }

  // Shared: fetch and add cover art to a zip folder
  async function addCoverToFolder(folder, coverUrl) {
    try {
      const blob = await fetchFile(coverUrl);
      const ext = coverUrl.split('.').pop() || 'jpg';
      folder.file(`cover.${ext}`, blob);
      return true;
    } catch (e) {
      console.warn('Could not include cover art in zip:', e);
    }
    return false;
  }

  // Shared: fetch tracks concurrently (batched) and add to zip folder
  async function addTracksToFolder(folder, tracks, onProgress) {
    const BATCH_SIZE = 4;
    let done = 0;

    for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
      const batch = tracks.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (track) => {
        return { track, blob: await fetchFile(track.file) };
      }));

      for (const result of results) {
        const baseName = `${String(result.track.trackNumber).padStart(2, '0')}-${sanitizeFilename(result.track.title)}`;
        let filename = `${baseName}.mp3`;
        let suffix = 2;
        while (folder.file(filename)) filename = `${baseName}-${suffix++}.mp3`;
        folder.file(filename, result.blob);
        done++;
        onProgress(done);
      }
    }
    return done;
  }

  // Shared: generate ZIP and trigger browser download
  async function triggerZipDownload(zip, filename) {
    const content = await zip.generateAsync({
      type: 'blob',
      compression: 'STORE'
    });
    saveBlob(content, filename);
  }

  function saveBlob(content, filename) {
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      a.remove();
      // Let the browser consume the object URL before releasing its bytes.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  // Progress UI
  function showProgressUI(title) {
    const el = document.createElement('div');
    el.className = 'download-progress';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <div class="download-progress-title">Downloading "${App.escapeHtml(title)}"...</div>
      <div class="download-progress-bar">
        <div class="download-progress-fill" style="width: 0%"></div>
      </div>`;
    document.body.appendChild(el);
    return el;
  }

  function updateProgress(el, fraction) {
    const fill = el.querySelector('.download-progress-fill');
    if (fill) fill.style.width = `${Math.round(fraction * 100)}%`;
  }

  function updateProgressText(el, text) {
    const title = el.querySelector('.download-progress-title');
    if (title) title.textContent = text;
  }

  function removeProgressUI(el) {
    setTimeout(() => { el?.remove(); }, 500);
  }

  // Sanitize filename
  function sanitizeFilename(name) {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase() || 'untitled';
  }

  return {
    downloadTrack,
    downloadAlbum,
    downloadAll
  };
})();
