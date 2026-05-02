/* ============================================
   OnePlaylist — Download (Track + Album Zip)
   ============================================ */

const Download = (() => {

  // Download a single track
  function downloadTrack(fileUrl, title) {
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = sanitizeFilename(title) + '.mp3';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    App.showToast(`Downloading "${title}"`);
  }

  // Download entire album as ZIP
  async function downloadAlbum(album) {
    const library = App.getLibrary();
    if (!library || !album) return;

    const progress = showProgressUI(album.title);
    const totalFiles = album.tracks.length + 1;
    let completed = 0;

    try {
      const zip = new JSZip();
      const folder = zip.folder(sanitizeFilename(album.title));

      completed += await addCoverToFolder(folder, album.cover);
      updateProgress(progress, completed / totalFiles);

      completed += await addTracksToFolder(folder, album.tracks, (n) => {
        updateProgress(progress, (completed + n) / totalFiles);
      });

      updateProgressText(progress, 'Creating ZIP...');
      triggerZipDownload(zip, `${sanitizeFilename(album.title)}.zip`);
      App.showToast(`Downloaded "${album.title}"`);
    } catch (err) {
      console.error('Album download error:', err);
      App.showToast('Download failed. Please try again.');
    } finally {
      removeProgressUI(progress);
    }
  }

  // Download all albums as a single ZIP
  async function downloadAll() {
    const library = App.getLibrary();
    if (!library) return;

    const progress = showProgressUI('All Albums');
    const totalTracks = library.albums.reduce((sum, a) => sum + a.tracks.length, 0);
    const totalFiles = totalTracks + library.albums.length;
    let completed = 0;

    try {
      const zip = new JSZip();

      for (const album of library.albums) {
        const folder = zip.folder(sanitizeFilename(album.title));

        completed += await addCoverToFolder(folder, album.cover);
        updateProgress(progress, completed / totalFiles);

        completed += await addTracksToFolder(folder, album.tracks, (n) => {
          updateProgress(progress, (completed + n) / totalFiles);
        });
      }

      updateProgressText(progress, 'Creating ZIP...');
      triggerZipDownload(zip, 'oneplaylist.zip');
      App.showToast('Downloaded all albums');
    } catch (err) {
      console.error('Download all error:', err);
      App.showToast('Download failed. Please try again.');
    } finally {
      removeProgressUI(progress);
    }
  }

  // Shared: fetch and add cover art to a zip folder
  async function addCoverToFolder(folder, coverUrl) {
    try {
      const resp = await fetch(coverUrl);
      if (resp.ok) {
        const blob = await resp.blob();
        const ext = coverUrl.split('.').pop() || 'jpg';
        folder.file(`cover.${ext}`, blob);
      }
    } catch (e) {
      console.warn('Could not include cover art in zip:', e);
    }
    return 1;
  }

  // Shared: fetch tracks concurrently (batched) and add to zip folder
  async function addTracksToFolder(folder, tracks, onProgress) {
    const BATCH_SIZE = 4;
    let done = 0;

    for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
      const batch = tracks.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (track) => {
        try {
          const resp = await fetch(track.file);
          if (resp.ok) {
            return { track, blob: await resp.blob() };
          }
        } catch (e) {
          console.warn(`Could not add track "${track.title}" to zip:`, e);
        }
        return null;
      }));

      for (const result of results) {
        if (result) {
          const filename = `${String(result.track.trackNumber).padStart(2, '0')}-${sanitizeFilename(result.track.title)}.mp3`;
          folder.file(filename, result.blob);
        }
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
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Progress UI
  function showProgressUI(title) {
    const el = document.createElement('div');
    el.className = 'download-progress';
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
      .toLowerCase();
  }

  return {
    downloadTrack,
    downloadAlbum,
    downloadAll
  };
})();
